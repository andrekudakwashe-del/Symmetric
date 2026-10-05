/**
 * Saimetric Persistent Sync Engine (Stage 2)
 *
 * Capabilities:
 * - Persistent Sync Queue in IndexedDB (Work Stream A)
 * - Exponential backoff (1s -> 300s), max 20 retries
 * - Background sync worker every 30s + Background Sync API
 * - Delta refresh for Staff & Branches every 60s (Work Stream B)
 * - Tenant context refresh every 60s + write blocking if suspended (Work Stream C)
 * - Client boot migration & tenant migration triggers (Work Stream D)
 * - Real-time subscriptions for UI badge & diagnostics (Work Stream E)
 */

import {
  initIndexedDB,
  enqueueSyncItem,
  getSyncQueueItems,
  getPendingSyncQueueItems,
  updateSyncItem,
  removeSyncItem,
  clearSyncedItems,
  clearAllSyncQueue,
  compactPendingSyncItems,
  cleanupStaleSyncQueue,
  batchRemoveSyncItems,
  batchUpdateSyncItems,
  healAndNormalizeSyncQueue,
  getSyncMeta,
  setSyncMeta,
  getTenantContext,
  saveTenantContext,
  PersistentSyncItem,
  PersistentSyncStatus,
  PersistentSyncPriority,
  TenantContextRecord,
  CURRENT_SAAS_SCHEMA_VERSION,
} from '../db/indexedDBService';
import {
  getCurrentCompany,
  getCurrentCompanyId,
  getCurrentBranch,
  getCurrentBranchId,
  getSessionUser,
  getSheetsConfig,
  saveSheetsConfig,
  saveCompany,
  saveBranch,
  saveSalesperson,
  getSalespeople,
  getBranches,
  pullTenantInventory,
  clearAllSyncQueueItems,
} from '../db/roomDatabase';
import { Company, SaaSBranch } from '../data/saasData';
import { Salesperson, Branch } from '../types';

// Exponential backoff schedule in milliseconds: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 300s (cap)
const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000];
const MAX_SYNC_RETRIES = 20;

export interface SyncQueueStats {
  total: number;
  pending: number;
  syncing: number;
  done: number;
  failed: number;
  lastSyncTime?: string;
  lastError?: string;
}

type SyncStatsListener = (stats: SyncQueueStats) => void;
type TenantAlertListener = (alert: { type: 'STATUS_CHANGED' | 'SHEET_CHANGED' | 'ISOLATION_CHANGED' | 'TRIAL_EXPIRED'; message: string; details?: any }) => void;

class PersistentSyncEngine {
  private activeCompanyDrains: Set<string> = new Set();
  private queueIntervalId: any = null;
  private deltaIntervalId: any = null;
  private tenantIntervalId: any = null;
  private statsListeners: Set<SyncStatsListener> = new Set();
  private alertListeners: Set<TenantAlertListener> = new Set();
  private itemsSyncedListeners: Set<(receipt: { postedClientRequestIds: string[]; postedIds: string[]; sheetName: string }) => void> = new Set();
  private lastBackgroundTime = 0;
  private isInitialized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.setupVisibilityListeners();
    }
  }

  public onItemsSynced(listener: (receipt: { postedClientRequestIds: string[]; postedIds: string[]; sheetName: string }) => void) {
    this.itemsSyncedListeners.add(listener);
    return () => {
      this.itemsSyncedListeners.delete(listener);
    };
  }

  public notifyItemsSynced(receipt: { postedClientRequestIds: string[]; postedIds: string[]; sheetName: string }) {
    this.itemsSyncedListeners.forEach((fn) => {
      try {
        fn(receipt);
      } catch (e) {
        console.warn('[SyncEngine] ItemsSynced listener error:', e);
      }
    });
  }

  /**
   * Called when another peer terminal on the same branch has successfully posted records to Google Apps Script.
   * Marks matching records as 'done' so this device does not duplicate write actions when gaining internet.
   */
  public async markReceiptAsSynced(clientRequestIds: string[] = [], itemIds: string[] = []): Promise<number> {
    try {
      const reqSet = new Set(clientRequestIds.filter(Boolean));
      const idSet = new Set(itemIds.filter(Boolean));
      if (reqSet.size === 0 && idSet.size === 0) return 0;

      const allPending = await getPendingSyncQueueItems(Date.now());
      const matched = allPending.filter(
        (item) => idSet.has(item.id) || (item.clientRequestId && reqSet.has(item.clientRequestId))
      );

      if (matched.length > 0) {
        await batchUpdateSyncItems(
          matched.map((m) => ({
            id: m.id,
            updates: {
              status: 'done',
              response: { success: true, fromRemoteMeshPeer: true, ackTimestamp: Date.now() },
            },
          }))
        );
        await this.notifyStats();
        return matched.length;
      }
      return 0;
    } catch (e) {
      console.warn('[PersistentSyncEngine] markReceiptAsSynced error:', e);
      return 0;
    }
  }

  // ==================== LIFECYCLE & INITIALIZATION ====================

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. Initialize IndexedDB & run boot migration
    await initIndexedDB();

    // 2. Run queue healing, compaction, and stale cleanup to prevent queue bloat
    try {
      const activeComp = getCurrentCompanyId();
      await healAndNormalizeSyncQueue(activeComp);
      await compactPendingSyncItems(activeComp);
      await cleanupStaleSyncQueue(24);
    } catch (e) {
      console.warn('[SyncEngine] Initial queue compaction/cleanup error:', e);
    }

    // 3. Register Background Sync API if supported
    this.registerBackgroundSync();

    // 4. Force initial drain of any pending items
    this.drainSyncQueue().catch((err) => console.warn('[SyncEngine] Initial queue drain error:', err));

    // 5. Force initial delta refresh & tenant context refresh
    this.performDeltaSync().catch((err) => console.warn('[SyncEngine] Initial delta sync error:', err));
    this.refreshTenantContext().catch((err) => console.warn('[SyncEngine] Initial tenant context error:', err));
    pullTenantInventory().catch(() => {});

    // 6. Start Background Workers
    // - Queue worker: every 30 seconds
    if (this.queueIntervalId) clearInterval(this.queueIntervalId);
    this.queueIntervalId = setInterval(() => {
      this.drainSyncQueue().catch(() => {});
    }, 30000);

    // - Delta refresh (staff & branches): every 60 seconds
    if (this.deltaIntervalId) clearInterval(this.deltaIntervalId);
    this.deltaIntervalId = setInterval(() => {
      this.performDeltaSync().catch(() => {});
    }, 60000);

    // - Tenant context refresh: every 60 seconds
    if (this.tenantIntervalId) clearInterval(this.tenantIntervalId);
    this.tenantIntervalId = setInterval(() => {
      this.refreshTenantContext().catch(() => {});
    }, 60000);

    await this.notifyStats();
  }

  private setupVisibilityListeners(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.lastBackgroundTime = Date.now();
      } else if (document.visibilityState === 'visible') {
        const backgroundDurationMs = Date.now() - this.lastBackgroundTime;
        // Force drain on unlock / focus
        this.drainSyncQueue().catch(() => {});

        // If in background for >60s, force refresh tenant context & delta
        if (backgroundDurationMs >= 60000) {
          this.refreshTenantContext(true).catch(() => {});
          this.performDeltaSync().catch(() => {});
        }
      }
    });

    window.addEventListener('online', () => {
      console.info('[SyncEngine] Device went online. Triggering immediate queue drain.');
      this.drainSyncQueue().catch(() => {});
    });
  }

  private registerBackgroundSync(): void {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready
        .then((reg: any) => {
          if (reg && reg.sync && typeof reg.sync.register === 'function') {
            return reg.sync.register('saimetric-sync-queue');
          }
        })
        .catch(() => {});
    }
  }

  // ==================== WORK STREAM A: PERSISTENT QUEUE ====================

  /**
   * Enqueues a write action to IndexedDB with a unique clientRequestId.
   * Priority items (inventory, price changes, branches, staff) immediately jump to the front of queue.
   */
  public async enqueueWrite(params: {
    action: string;
    sheetName: string;
    payload: Record<string, any>;
    endpoint?: string;
    priority?: PersistentSyncPriority;
  }): Promise<PersistentSyncItem> {
    // Check tenant status before allowing critical writes
    await this.assertTenantCanWrite(params.action);

    const currentComp = getCurrentCompany();
    const currentBranch = getCurrentBranch();
    const config = getSheetsConfig();

    const company_id = params.payload.company_id || params.payload.CompanyID || currentComp.company_id || 'COMP-001';
    const branch_id = params.payload.branch_id || currentBranch.branchId || 'BR-MAIN';

    // Auto-detect priority if not explicitly specified
    let priority: PersistentSyncPriority = params.priority || 'NORMAL';
    if (!params.priority) {
      if (
        params.sheetName === 'InventoryMaster' ||
        params.sheetName === 'Products' ||
        params.action === 'sync_inventory' ||
        params.action === 'upsert_product' ||
        params.action === 'create_branch' ||
        params.action === 'upsert_staff' ||
        params.action === 'approve_direct_grv'
      ) {
        priority = 'HIGH';
      } else if (params.sheetName === 'Audit_Log') {
        priority = 'LOW';
      }
    }

    const clientRequestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const targetEndpoint =
      params.endpoint ||
      currentComp.webhook_url ||
      config.webhookUrl ||
      config.masterWebhookUrl ||
      '';

    const enrichedPayload = {
      company_id,
      branch_id,
      clientRequestId,
      ...params.payload,
    };

    // Deduplicate in-place for InventoryMaster updates:
    // If this product already has a pending update in the queue, update its payload in-place
    // instead of appending another redundant queue item!
    if (params.sheetName === 'InventoryMaster' || params.sheetName === 'Products') {
      const itemId = (params.payload.ItemID || params.payload.itemId || params.payload.id || '').trim().toUpperCase();
      if (itemId) {
        try {
          const pending = await getPendingSyncQueueItems(Date.now() + 86400000, company_id);
          const existingPending = pending.find(
            (p) =>
              (p.sheetName === 'InventoryMaster' || p.sheetName === 'Products') &&
              ((p.payload?.ItemID || p.payload?.itemId || p.payload?.id || '').trim().toUpperCase() === itemId)
          );
          if (existingPending) {
            await updateSyncItem(existingPending.id, {
              payload: { ...existingPending.payload, ...enrichedPayload },
              createdAt: new Date().toISOString(),
              priority: 'HIGH',
              nextRetryAt: Date.now(),
            });
            await this.notifyStats();
            this.pushSingleItem(existingPending).catch(() => {});
            return existingPending;
          }
        } catch (e) {}
      }
    }

    const item = await enqueueSyncItem({
      clientRequestId,
      action: params.action,
      sheetName: params.sheetName,
      endpoint: targetEndpoint,
      payload: enrichedPayload,
      company_id,
      priority,
    });

    await this.notifyStats();

    // High priority items (like inventory updates) get pushed immediately
    this.pushSingleItem(item).catch((err) => {
      console.info(`[SyncEngine] Immediate push for ${item.id} deferred:`, err.message || err);
    });

    return item;
  }

  /**
   * Drains pending items with tenant isolation and high-speed batching for high volume items.
   */
  public async drainSyncQueue(companyId?: string): Promise<{ processed: number; succeeded: number; failed: number }> {
    const activeCompId = companyId || getCurrentCompanyId();

    if (this.activeCompanyDrains.has(activeCompId)) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.activeCompanyDrains.add(activeCompId);
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      // 1. Run queue compaction and stale cleanup first to eliminate redundant duplicate rows
      await compactPendingSyncItems(activeCompId);
      await cleanupStaleSyncQueue(24);

      const now = Date.now();
      const pendingItems = await getPendingSyncQueueItems(now, activeCompId);

      // 2. High-Speed Bulk Batch Path: InventoryMaster & Products (Sync directly to Google Apps Script in batches of 50)
      const invItems = pendingItems.filter(
        (i) => i.sheetName === 'InventoryMaster' || i.sheetName === 'Products' || i.action === 'sync_inventory' || i.action === 'upsert_product'
      );

      if (invItems.length > 0) {
        for (let i = 0; i < invItems.length; i += 50) {
          const chunk = invItems.slice(i, i + 50);
          const clientRequestId = `INV-BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const itemsPayload = chunk.map((b) => ({
            ...b.payload,
            company_id: activeCompId,
            branch_id: b.payload.branch_id || getCurrentBranchId(),
          }));

          try {
            const batchRes = await fetch('/api/sheets/sync-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                company_id: activeCompId,
                branch_id: getCurrentBranchId(),
                action: 'sync_inventory',
                items: itemsPayload,
                clientRequestId,
              }),
              signal: AbortSignal.timeout(25000),
            });

            if (batchRes.ok) {
              const resData = await batchRes.json().catch(() => null);
              if (resData && resData.success !== false) {
                await batchUpdateSyncItems(
                  chunk.map((b) => ({
                    id: b.id,
                    updates: { status: 'done', response: { success: true, batched: true } },
                  }))
                );
                this.notifyItemsSynced({
                  postedClientRequestIds: chunk.map((b) => b.clientRequestId).filter(Boolean) as string[],
                  postedIds: chunk.map((b) => b.id),
                  sheetName: 'InventoryMaster',
                });
                succeeded += chunk.length;
                processed += chunk.length;
                continue;
              }
            }
          } catch (batchErr) {
            console.info('[SyncEngine] Batch inventory sync fallback:', batchErr);
          }
        }
      }

      // 3. High-Speed Bulk Batch Path: Other transactional sheets (Sales, CashLog, Audit_Log, etc. in batches of 25)
      const remainingAfterInv = await getPendingSyncQueueItems(now, activeCompId);
      const nonInvItems = remainingAfterInv.filter(
        (i) => i.sheetName !== 'InventoryMaster' && i.sheetName !== 'Products' && i.action !== 'sync_inventory' && i.action !== 'upsert_product'
      );

      if (nonInvItems.length > 1) {
        for (let i = 0; i < nonInvItems.length; i += 25) {
          const chunk = nonInvItems.slice(i, i + 25);
          const clientRequestId = `BATCH-TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          try {
            const batchRes = await fetch('/api/sheets/sync-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                company_id: activeCompId,
                branch_id: getCurrentBranchId(),
                action: 'batch_sync_writes',
                items: chunk.map((c) => ({
                  id: c.id,
                  sheet: c.sheetName,
                  action: c.action,
                  payload: c.payload,
                  clientRequestId: c.clientRequestId,
                })),
                clientRequestId,
              }),
              signal: AbortSignal.timeout(25000),
            });

            if (batchRes.ok) {
              const resData = await batchRes.json().catch(() => null);
              if (resData && resData.success !== false) {
                await batchUpdateSyncItems(
                  chunk.map((c) => ({
                    id: c.id,
                    updates: { status: 'done', response: { success: true, batched: true } },
                  }))
                );
                this.notifyItemsSynced({
                  postedClientRequestIds: chunk.map((c) => c.clientRequestId).filter(Boolean) as string[],
                  postedIds: chunk.map((c) => c.id),
                  sheetName: 'Transactions',
                });
                succeeded += chunk.length;
                processed += chunk.length;
                continue;
              }
            }
          } catch (e) {
            // fallback to single push
          }
        }
      }

      // 4. Process remaining items prioritized (HIGH priority runs first)
      const remainingItems = await getPendingSyncQueueItems(now, activeCompId);

      for (const item of remainingItems) {
        const success = await this.pushSingleItem(item);
        processed++;
        if (success) {
          succeeded++;
        } else {
          failed++;
        }
      }
    } finally {
      this.activeCompanyDrains.delete(activeCompId);
      await this.notifyStats(activeCompId);
    }

    return { processed, succeeded, failed };
  }

  /**
   * Pushes a single item. Calculates exponential backoff on failure.
   */
  public async pushSingleItem(item: PersistentSyncItem): Promise<boolean> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return false;
    }

    await updateSyncItem(item.id, { status: 'syncing' });
    await this.notifyStats();

    try {
      const result = await this.dispatchToServer(item);

      if (result.success) {
        await updateSyncItem(item.id, {
          status: 'done',
          lastError: undefined,
          response: result,
        });

        this.notifyItemsSynced({
          postedClientRequestIds: item.clientRequestId ? [item.clientRequestId] : [],
          postedIds: [item.id],
          sheetName: item.sheetName,
        });

        // Trigger immediate entity refresh if staff or branch was modified
        if (item.action === 'upsert_staff' || item.sheetName === 'users') {
          this.forceRefreshStaff().catch(() => {});
        } else if (item.action === 'create_branch' || item.sheetName === 'branches') {
          this.forceRefreshBranches().catch(() => {});
        }

        await this.notifyStats();
        return true;
      } else {
        throw new Error(result.error || result.message || 'Server rejected write');
      }
    } catch (err: any) {
      const nextRetries = item.retries + 1;
      const errorMsg = err?.message || String(err);

      if (nextRetries >= MAX_SYNC_RETRIES) {
        // Give up after 20 attempts -> mark failed, require manual retry
        await updateSyncItem(item.id, {
          status: 'failed',
          retries: nextRetries,
          lastError: `Exceeded ${MAX_SYNC_RETRIES} attempts. Last error: ${errorMsg}`,
        });
      } else {
        // Exponential backoff
        const backoffIdx = Math.min(nextRetries - 1, BACKOFF_SCHEDULE_MS.length - 1);
        const backoffDelay = BACKOFF_SCHEDULE_MS[Math.max(0, backoffIdx)];
        const nextRetryAt = Date.now() + backoffDelay;

        await updateSyncItem(item.id, {
          status: 'pending',
          retries: nextRetries,
          nextRetryAt,
          lastError: errorMsg,
        });
      }

      await this.notifyStats();
      return false;
    }
  }

  /**
   * Dispatches the item to the server (Google Apps Script or proxy).
   */
  private async dispatchToServer(item: PersistentSyncItem): Promise<any> {
    const currentComp = getCurrentCompany();
    const config = getSheetsConfig();

    const targetUrl =
      item.endpoint ||
      currentComp.webhook_url ||
      config.webhookUrl ||
      config.masterWebhookUrl ||
      '';

    const payload = {
      action: item.action,
      clientRequestId: item.clientRequestId,
      sheet: config.sheetNameMap[item.sheetName] || item.sheetName,
      company_id: item.payload.company_id || currentComp.company_id,
      company_name: currentComp.company_name,
      branch_id: item.payload.branch_id || getCurrentBranchId(),
      data: item.payload,
      ...item.payload,
    };

    // 1. Try server-side proxy route (/api/sheets/sync-row) - bypasses browser CORS!
    if (targetUrl && targetUrl.startsWith('http')) {
      try {
        const srvRes = await fetch('/api/sheets/sync-row', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_url: targetUrl,
            ...payload,
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (srvRes.ok) {
          const json = await srvRes.json().catch(() => null);
          if (json && (json.success !== false && json.status !== 'error')) {
            return json;
          }
        }
      } catch (proxyErr) {}

      // Direct fallback using no-cors
      try {
        await fetch(targetUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
        return { success: true };
      } catch (err: any) {
        throw err;
      }
    }

    // 2. Local backend fallback proxy if no Apps Script webhook is defined
    try {
      const res = await fetch('/api/saas/call-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Local server might not have /api/saas/call-action
    }

    // If neither is configured, simulate offline retention
    return {
      success: true,
      simulated: true,
      message: 'Locally retained. Will sync when Google Apps Script Webhook URL is connected.',
    };
  }

  // ==================== WORK STREAM B: DELTA REFRESH ====================

  /**
   * Delta refresh for Staff and Branches.
   * Calls get_users_since(lastSyncAt) and get_branches_since(lastSyncAt).
   */
  public async performDeltaSync(): Promise<{ usersCount: number; branchesCount: number }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { usersCount: 0, branchesCount: 0 };
    }

    const currentCompany = getCurrentCompany();
    const companyId = currentCompany.company_id;
    if (!companyId) return { usersCount: 0, branchesCount: 0 };

    let usersCount = 0;
    let branchesCount = 0;

    try {
      // 1. Refresh Users
      const usersMeta = await getSyncMeta('users');
      const sinceUsers = usersMeta?.lastSyncAt || '1970-01-01T00:00:00.000Z';
      const usersRes = await this.fetchServerAction('get_users_since', {
        company_id: companyId,
        since: sinceUsers,
      });

      if (usersRes && usersRes.success && Array.isArray(usersRes.users)) {
        for (const u of usersRes.users) {
          const userPerson: Salesperson = {
            id: u.id || u.user_id,
            name: u.full_name || u.name || 'Staff',
            email: u.email || '',
            role: (u.role || 'CASHIER').toUpperCase() as any,
            pin: String(u.pin || '1234'),
            active: (u.is_active !== false && u.active !== 'N' && u.active !== false) ? 'Y' : 'N',
            companyId: u.company_id || companyId,
            branchId: u.branch_id || 'BR-MAIN',
          };
          saveSalesperson(userPerson);
          usersCount++;
        }
        const serverTime = usersRes.server_time || new Date().toISOString();
        await setSyncMeta('users', serverTime, serverTime);
      }

      // 2. Refresh Branches
      const branchesMeta = await getSyncMeta('branches');
      const sinceBranches = branchesMeta?.lastSyncAt || '1970-01-01T00:00:00.000Z';
      const branchesRes = await this.fetchServerAction('get_branches_since', {
        company_id: companyId,
        since: sinceBranches,
      });

      if (branchesRes && branchesRes.success && Array.isArray(branchesRes.branches)) {
        for (const b of branchesRes.branches) {
          const brId = b.branch_id || b.branchId || 'BR-MAIN';
          const branchObj: Branch = {
            id: brId,
            branchId: brId,
            name: b.name || b.branch_name || 'Branch',
            code: b.code || b.branch_code || brId,
            location: b.location || b.address || '',
            address: b.location || b.address || '',
            company_id: b.company_id || companyId,
            companyId: b.company_id || companyId,
            is_active: b.is_active !== false,
          };
          saveBranch(branchObj);
          branchesCount++;
        }
        const serverTime = branchesRes.server_time || new Date().toISOString();
        await setSyncMeta('branches', serverTime, serverTime);
      }

      // 3. Delta Refresh Tenant Inventory across all devices
      await pullTenantInventory(companyId).catch(() => {});
    } catch (err) {
      console.warn('[SyncEngine] Delta sync non-fatal error:', err);
    }

    return { usersCount, branchesCount };
  }

  public async forceRefreshStaff(): Promise<number> {
    const currentCompany = getCurrentCompany();
    const res = await this.fetchServerAction('get_users_since', {
      company_id: currentCompany.company_id,
      since: '1970-01-01T00:00:00.000Z', // full fetch
    });
    let count = 0;
    if (res && res.success && Array.isArray(res.users)) {
      for (const u of res.users) {
        saveSalesperson({
          id: u.id || u.user_id,
          name: u.full_name || u.name || 'Staff',
          email: u.email || '',
          role: (u.role || 'CASHIER').toUpperCase() as any,
          pin: String(u.pin || '1234'),
          active: (u.is_active !== false && u.active !== 'N' && u.active !== false) ? 'Y' : 'N',
          companyId: u.company_id || currentCompany.company_id,
          branchId: u.branch_id || 'BR-MAIN',
        });
        count++;
      }
      const serverTime = res.server_time || new Date().toISOString();
      await setSyncMeta('users', serverTime, serverTime);
    }
    return count;
  }

  public async forceRefreshBranches(): Promise<number> {
    const currentCompany = getCurrentCompany();
    const res = await this.fetchServerAction('get_branches_since', {
      company_id: currentCompany.company_id,
      since: '1970-01-01T00:00:00.000Z', // full fetch
    });
    let count = 0;
    if (res && res.success && Array.isArray(res.branches)) {
      for (const b of res.branches) {
        const brId = b.branch_id || b.branchId || 'BR-MAIN';
        saveBranch({
          id: brId,
          branchId: brId,
          name: b.name || b.branch_name || 'Branch',
          code: b.code || b.branch_code || brId,
          location: b.location || b.address || '',
          address: b.location || b.address || '',
          company_id: b.company_id || currentCompany.company_id,
          companyId: b.company_id || currentCompany.company_id,
          is_active: b.is_active !== false,
        });
        count++;
      }
      const serverTime = res.server_time || new Date().toISOString();
      await setSyncMeta('branches', serverTime, serverTime);
    }
    return count;
  }

  public async forceRefreshTenantContext(): Promise<void> {
    await this.refreshTenantContext(true);
  }

  // ==================== WORK STREAM C: TENANT CONTEXT ====================

  /**
   * Refreshes Tenant Context from get_tenant_context.
   * Detects changes in subscription_status, sheet_id, branch_isolation_mode.
   */
  public async refreshTenantContext(force: boolean = false): Promise<TenantContextRecord | null> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }

    const currentCompany = getCurrentCompany();
    const companyId = currentCompany.company_id;
    if (!companyId) return null;

    try {
      const localContext = await getTenantContext(companyId);

      const res = await this.fetchServerAction('get_tenant_context', {
        company_id: companyId,
      });

      if (res && res.success) {
        const tenantData = res.tenant || res;
        const remoteUpdated = tenantData.updated_at || '';
        const localUpdated = localContext?.updated_at || '';

        const record: TenantContextRecord = {
          company_id: companyId,
          company_name: tenantData.company_name || currentCompany.company_name,
          subscription_status: (tenantData.subscription_status || currentCompany.subscription_status || 'TRIAL').toUpperCase(),
          plan: (tenantData.plan || currentCompany.plan || 'STARTER').toUpperCase(),
          next_billing_date: tenantData.next_billing_date || currentCompany.next_billing_date || '',
          trial_days_remaining: tenantData.trial_days_remaining ?? currentCompany.trial_days_remaining ?? 14,
          sheet_id: tenantData.sheet_id || currentCompany.sheet_id || '',
          branch_isolation_mode: tenantData.branch_isolation_mode || currentCompany.branch_isolation_mode || 'ROW_LEVEL',
          schema_version: Number(tenantData.schema_version || CURRENT_SAAS_SCHEMA_VERSION),
          updated_at: remoteUpdated,
          lastFetchedAt: new Date().toISOString(),
        };

        // If updated_at > local OR force, handle mutations
        if (force || !localContext || remoteUpdated > localUpdated) {
          // 1. Subscription status changed
          if (localContext && localContext.subscription_status !== record.subscription_status) {
            this.emitAlert({
              type: 'STATUS_CHANGED',
              message: `Tenant subscription changed from ${localContext.subscription_status} to ${record.subscription_status}`,
              details: { oldStatus: localContext.subscription_status, newStatus: record.subscription_status },
            });
          }

          // 2. Sheet ID changed -> switch writes immediately
          if (localContext && localContext.sheet_id !== record.sheet_id && record.sheet_id) {
            console.warn(`[SyncEngine] Tenant sheet_id changed: ${localContext.sheet_id} -> ${record.sheet_id}. Switching writes immediately.`);
            saveCompany({
              ...currentCompany,
              sheet_id: record.sheet_id,
            });
            const config = getSheetsConfig();
            saveSheetsConfig({ ...config, spreadsheetId: record.sheet_id });
            this.emitAlert({
              type: 'SHEET_CHANGED',
              message: `Tenant sheet ID updated. All writes redirected to ${record.sheet_id}`,
              details: { newSheetId: record.sheet_id },
            });
          }

          // 3. Branch isolation mode changed -> warn restart
          if (localContext && localContext.branch_isolation_mode !== record.branch_isolation_mode) {
            this.emitAlert({
              type: 'ISOLATION_CHANGED',
              message: `Branch isolation mode changed to ${record.branch_isolation_mode}. App restart recommended.`,
              details: { newMode: record.branch_isolation_mode },
            });
          }

          // 4. Save to tenantContext store
          await saveTenantContext(record);

          // Update company in roomDatabase to keep UI reactive
          saveCompany({
            ...currentCompany,
            subscription_status: record.subscription_status as any,
            plan: record.plan as any,
            next_billing_date: record.next_billing_date,
            trial_days_remaining: record.trial_days_remaining,
            sheet_id: record.sheet_id,
            branch_isolation_mode: record.branch_isolation_mode as any,
          });
        }

        // Check if trial has expired
        if (this.isTenantTrialExpired(record)) {
          this.emitAlert({
            type: 'TRIAL_EXPIRED',
            message: 'Your 14-day SaaS trial has expired. POS actions are disabled until activated.',
          });
        }

        return record;
      }
    } catch (err) {
      console.warn('[SyncEngine] Tenant context refresh non-fatal error:', err);
    }

    return null;
  }

  /**
   * Evaluates if trial has expired.
   */
  public isTenantTrialExpired(context: TenantContextRecord): boolean {
    if (context.subscription_status !== 'TRIAL') {
      return false;
    }
    if (context.trial_days_remaining <= 0) {
      return true;
    }
    if (context.next_billing_date) {
      const billingTime = new Date(context.next_billing_date).getTime();
      if (!isNaN(billingTime) && billingTime < Date.now()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Asserts tenant can perform critical writes.
   * Throws Error if tenant is SUSPENDED or CANCELLED.
   */
  public async assertTenantCanWrite(action: string): Promise<void> {
    const criticalActions = ['add_sale', 'add_direct_grv', 'approve_direct_grv', 'submit_eod', 'approve_eod'];
    if (!criticalActions.includes(action)) {
      return;
    }

    const currentCompany = getCurrentCompany();
    const context = await getTenantContext(currentCompany.company_id);
    const status = (context?.subscription_status || currentCompany.subscription_status || 'ACTIVE').toUpperCase();

    if (status === 'SUSPENDED' || status === 'CANCELLED') {
      throw new Error(`TENANT_WRITE_BLOCKED: Tenant is in ${status} status. Critical write action "${action}" is disabled.`);
    }

    if (context && this.isTenantTrialExpired(context)) {
      throw new Error(`TRIAL_EXPIRED_WRITE_BLOCKED: Trial period has ended. Please contact administrator to activate subscription.`);
    }
  }

  // ==================== WORK STREAM D: CLIENT BOOT & MIGRATION ====================

  /**
   * Called on login to inspect tenant's stored schema_version.
   * If < CURRENT_SAAS_SCHEMA_VERSION, invokes migrate_tenant.
   */
  public async handleLoginMigrationCheck(tenantSchemaVersion?: number): Promise<void> {
    const ver = tenantSchemaVersion !== undefined ? tenantSchemaVersion : CURRENT_SAAS_SCHEMA_VERSION;
    if (ver < CURRENT_SAAS_SCHEMA_VERSION) {
      console.info(`[SyncEngine] Tenant schema version ${ver} < ${CURRENT_SAAS_SCHEMA_VERSION}. Requesting server migrate_tenant.`);
      try {
        const currentCompany = getCurrentCompany();
        await this.fetchServerAction('migrate_tenant', {
          company_id: currentCompany.company_id,
          target_version: CURRENT_SAAS_SCHEMA_VERSION,
        });
      } catch (err) {
        console.warn('[SyncEngine] migrate_tenant call completed or logged:', err);
      }
    }
  }

  // ==================== WORK STREAM E: DIAGNOSTICS & STATS ====================

  public async getQueueStats(companyId?: string): Promise<SyncQueueStats> {
    const activeComp = companyId || getCurrentCompanyId();
    const all = await getSyncQueueItems(undefined, activeComp);
    const pending = all.filter((i) => i.status === 'pending').length;
    const syncing = all.filter((i) => i.status === 'syncing').length;
    const done = all.filter((i) => i.status === 'done').length;
    const failed = all.filter((i) => i.status === 'failed').length;

    const failedItem = all.slice().reverse().find((i) => i.status === 'failed');
    const doneItem = all.slice().reverse().find((i) => i.status === 'done');

    return {
      total: all.length,
      pending,
      syncing,
      done,
      failed,
      lastSyncTime: doneItem?.createdAt,
      lastError: failedItem?.lastError,
    };
  }

  public async compactAndCleanup(companyId?: string): Promise<{ originalCount: number; compactedCount: number; removedCount: number }> {
    const activeComp = companyId || getCurrentCompanyId();
    await healAndNormalizeSyncQueue(activeComp);
    const result = await compactPendingSyncItems(activeComp);
    await cleanupStaleSyncQueue(12);
    await this.notifyStats(activeComp);
    return result;
  }

  public async retryItem(id: string): Promise<boolean> {
    await updateSyncItem(id, {
      status: 'pending',
      nextRetryAt: Date.now(),
      retries: 0,
      lastError: undefined,
    });
    await this.notifyStats();
    const items = await getSyncQueueItems();
    const item = items.find((i) => i.id === id);
    if (item) {
      return await this.pushSingleItem(item);
    }
    return false;
  }

  public async retryAllFailed(companyId?: string): Promise<void> {
    const activeComp = companyId || getCurrentCompanyId();
    const all = await getSyncQueueItems('failed', activeComp);
    for (const item of all) {
      await updateSyncItem(item.id, {
        status: 'pending',
        nextRetryAt: Date.now(),
        retries: 0,
        lastError: undefined,
      });
    }
    await this.notifyStats(activeComp);
    this.drainSyncQueue(activeComp).catch(() => {});
  }

  public async clearDone(): Promise<number> {
    const count = await clearSyncedItems();
    await this.notifyStats();
    return count;
  }

  public async clearAllQueue(): Promise<void> {
    try {
      await clearAllSyncQueue();
    } catch (e) {}
    try {
      clearAllSyncQueueItems();
    } catch (e) {}
    await this.notifyStats();
  }

  public subscribeStats(listener: SyncStatsListener, companyId?: string): () => void {
    this.statsListeners.add(listener);
    const activeComp = companyId || getCurrentCompanyId();
    this.getQueueStats(activeComp).then((stats) => listener(stats));
    return () => {
      this.statsListeners.delete(listener);
    };
  }

  public subscribeAlerts(listener: TenantAlertListener): () => void {
    this.alertListeners.add(listener);
    return () => {
      this.alertListeners.delete(listener);
    };
  }

  private notifyStatsScheduled = false;

  private async notifyStats(companyId?: string): Promise<void> {
    if (this.notifyStatsScheduled) return;
    this.notifyStatsScheduled = true;
    setTimeout(async () => {
      this.notifyStatsScheduled = false;
      const targetComp = companyId || getCurrentCompanyId();
      const stats = await this.getQueueStats(targetComp);
      this.statsListeners.forEach((fn) => {
        try {
          fn(stats);
        } catch (e) {
          console.error('Stats listener error:', e);
        }
      });
    }, 50);
  }

  private emitAlert(alert: { type: 'STATUS_CHANGED' | 'SHEET_CHANGED' | 'ISOLATION_CHANGED' | 'TRIAL_EXPIRED'; message: string; details?: any }): void {
    console.warn(`[SyncEngine Alert: ${alert.type}] ${alert.message}`, alert.details);
    this.alertListeners.forEach((fn) => {
      try {
        fn(alert);
      } catch (e) {
        console.error('Alert listener error:', e);
      }
    });
  }

  // ==================== INTERNAL SERVER DISPATCHER ====================

  private async fetchServerAction(action: string, params: Record<string, any>): Promise<any> {
    const currentComp = getCurrentCompany();
    const config = getSheetsConfig();

    const targetUrl =
      currentComp.webhook_url ||
      config.webhookUrl ||
      config.masterWebhookUrl ||
      '';

    // 1. Direct GET/POST to Google Apps Script if URL available
    if (targetUrl && targetUrl.startsWith('http')) {
      try {
        const queryUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}action=${encodeURIComponent(action)}&${new URLSearchParams(params).toString()}`;
        const res = await fetch(queryUrl, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json) return json;
        }
      } catch (e) {
        // Fallback to proxy
      }
    }

    // 2. Server proxy fallback
    try {
      const proxyRes = await fetch(`/api/saas/call-action?action=${encodeURIComponent(action)}&${new URLSearchParams(params).toString()}`);
      if (proxyRes.ok) {
        return await proxyRes.json();
      }
    } catch {
      // ignore
    }

    return { success: false, message: 'Action unreachable' };
  }
}

export const persistentSyncEngine = new PersistentSyncEngine();

export const forceRefreshStaff = () => persistentSyncEngine.forceRefreshStaff();
export const forceRefreshBranches = () => persistentSyncEngine.forceRefreshBranches();
export const forceRefreshTenantContext = () => persistentSyncEngine.forceRefreshTenantContext();
export const drainSyncQueue = () => persistentSyncEngine.drainSyncQueue();
export const getSyncQueueStats = () => persistentSyncEngine.getQueueStats();
export const isTenantTrialExpired = (ctx: any) => persistentSyncEngine.isTenantTrialExpired(ctx);
export const assertTenantCanWrite = (act: string) => persistentSyncEngine.assertTenantCanWrite(act);
