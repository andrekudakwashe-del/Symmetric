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
  fetchWithTimeout,
  GAS_TIMEOUTS,
  isTimeoutError,
  parseGasResponseText,
  resolveSafeGasTarget,
} from './sync/gasTransport';
import {
  getCurrentCompany,
  getCurrentCompanyId,
  getCurrentBranch,
  getCurrentBranchId,
  getSessionUser,
  getSheetsConfig,
  saveSheetsConfig,
  isMasterCompanyId,
  saveCompany,
  saveBranch,
  saveSalesperson,
  getSalespeople,
  getAllSalespeople,
  getBranches,
  clearAllSyncQueueItems,
  markReceiptAsSynced,
  markRecordsCloudSynced,
  parseTimestampMs,
} from '../db/roomDatabase';
import { getActiveCloudConfig } from './sync/cloudConfigResolver';
import { retentionLifecycleService } from './backendAdapter/retentionService';
import { Company, SaaSBranch } from '../data/saasData';
import { Salesperson, Branch } from '../types';
import {
  isAppScriptsIngestPaused,
  routeCloudRecordThroughSyncCore,
} from './sync/syncIngestBridge';
import {
  getTenantAuthToken,
  setTenantAuthToken,
  getRoutingEpoch,
  setRoutingEpoch,
  resetCloudCatchupCursors,
} from './sync/highWaterMarks';
import {
  SyncCircuitBreaker,
  CircuitBreakerSnapshot,
  CircuitBreakerState,
  classifySyncError,
  computeJitteredBackoffMs,
  withCrossTabSyncLock,
  isWebLocksSupported,
} from './sync/syncResilience';

const MAX_SYNC_RETRIES = 20;

export interface SyncQueueStats {
  total: number;
  pending: number;
  syncing: number;
  done: number;
  failed: number;
  lastSyncTime?: string;
  lastError?: string;
  circuitState?: CircuitBreakerState;
  circuitCooldownSec?: number;
  webLocksActive?: boolean;
}

type SyncStatsListener = (stats: SyncQueueStats) => void;
type TenantAlertListener = (alert: { type: 'STATUS_CHANGED' | 'SHEET_CHANGED' | 'ISOLATION_CHANGED' | 'TRIAL_EXPIRED'; message: string; details?: any }) => void;

class PersistentSyncEngine {
  private activeCompanyDrains: Set<string> = new Set();
  private circuitBreaker = new SyncCircuitBreaker({
    failureThreshold: 3,
    baseCooldownMs: 30_000,
    maxCooldownMs: 300_000,
  });
  private queueIntervalId: any = null;
  private deltaIntervalId: any = null;
  private tenantIntervalId: any = null;
  private statsListeners: Set<SyncStatsListener> = new Set();
  private alertListeners: Set<TenantAlertListener> = new Set();
  private itemsSyncedListeners: Set<(receipt: { postedClientRequestIds: string[]; postedIds: string[]; sheetName: string }) => void> = new Set();
  private lastBackgroundTime = 0;
  private isInitialized = false;
  private isOutboundSyncPaused = false;

  public getCircuitBreakerSnapshot(): CircuitBreakerSnapshot {
    return this.circuitBreaker.getSnapshot();
  }

  public resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.notifyStats().catch(() => {});
  }

  public pauseOutboundSync(): void {
    this.isOutboundSyncPaused = true;
    console.log('[PersistentSyncEngine] 🛑 Outbound cloud sync suspended (Local Hub is Edge Gateway).');
  }

  public resumeOutboundSync(): void {
    this.isOutboundSyncPaused = false;
    console.log('[PersistentSyncEngine] 🟢 Outbound cloud sync resumed.');
  }

  public isSyncPaused(): boolean {
    return this.isOutboundSyncPaused;
  }

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

    // 2b. Run automated 3-month retention check for all tenants
    retentionLifecycleService.checkAndRunScheduledPrune().catch((e) => {
      console.warn('[SyncEngine] Scheduled retention prune check error:', e);
    });

    // 3. Register Background Sync API if supported
    this.registerBackgroundSync();

    // 4. Force initial drain & delta refresh only if AppScriptsAdapter is not paused
    if (!this.isOutboundSyncPaused && !isAppScriptsIngestPaused()) {
      this.drainSyncQueue().catch((err) => console.warn('[SyncEngine] Initial queue drain error:', err));

      // 5. Force initial delta refresh & tenant context refresh (operational catch-up handled by AppScriptsAdapter)
      this.performDeltaSync().catch((err) => console.warn('[SyncEngine] Initial delta sync error:', err));
      this.refreshTenantContext().catch((err) => console.warn('[SyncEngine] Initial tenant context error:', err));
    }

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
      console.info('[SyncEngine] Device went online. Resetting circuit breaker and triggering immediate queue drain.');
      this.circuitBreaker.reset();
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

  public enqueueSyncItem = this.enqueueWrite.bind(this);

  /**
   * Drains pending items with tenant isolation, cross-tab exclusivity lock,
   * circuit-breaker outage protection, and high-speed batching.
   */
  public async drainSyncQueue(
    companyId?: string,
    options?: { bypassCircuit?: boolean }
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    const activeCloud = getActiveCloudConfig();
    if (activeCloud.databaseType !== 'appscripts') {
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    if (this.isOutboundSyncPaused || isAppScriptsIngestPaused()) {
      console.log('[PersistentSyncEngine] 🛑 Outbound cloud sync suspended (Local Hub is Edge Gateway). Skipping drainSyncQueue.');
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    const activeCompId = companyId || getCurrentCompanyId();

    if (this.activeCompanyDrains.has(activeCompId)) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    if (options?.bypassCircuit) {
      this.circuitBreaker.reset();
    } else if (!this.circuitBreaker.canAttempt()) {
      const snap = this.circuitBreaker.getSnapshot();
      console.info(
        `[SyncEngine] Circuit breaker OPEN (${Math.ceil(snap.cooldownRemainingMs / 1000)}s cooldown remaining); deferring drain.`
      );
      await this.notifyStats(activeCompId);
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    const lockResult = await withCrossTabSyncLock(
      `saimetric_sync_drain_${activeCompId}`,
      async () => this.executeLockedDrain(activeCompId),
      { processed: 0, succeeded: 0, failed: 0 }
    );

    if (!lockResult.acquired) {
      console.info(`[SyncEngine] Another browser tab holds drain lock for ${activeCompId}; skipping duplicate drain.`);
    }
    return lockResult.result;
  }

  private async executeLockedDrain(
    activeCompId: string
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
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
        for (let i = 0; i < invItems.length; i += 20) {
          const chunk = invItems.slice(i, i + 20);
          const clientRequestId = `INV-BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const itemsPayload = chunk.map((b) => ({
            ...b.payload,
            company_id: activeCompId,
            branch_id: b.payload.branch_id || getCurrentBranchId(),
          }));

          try {
            const batchRes = await fetchWithTimeout(
              '/api/sheets/sync-batch',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  company_id: activeCompId,
                  branch_id: getCurrentBranchId(),
                  action: 'sync_inventory',
                  items: itemsPayload,
                  clientRequestId,
                }),
              },
              GAS_TIMEOUTS.WRITE_CLIENT_MS
            );

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
                this.circuitBreaker.recordSuccess();
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

      // 3. High-Speed Bulk Batch Path: Other transactional sheets (Sales, CashLog, Audit_Log, etc. in bounded batches of 15)
      const remainingAfterInv = await getPendingSyncQueueItems(now, activeCompId);
      const nonInvItems = remainingAfterInv.filter(
        (i) => i.sheetName !== 'InventoryMaster' && i.sheetName !== 'Products' && i.action !== 'sync_inventory' && i.action !== 'upsert_product'
      );

      if (nonInvItems.length > 1) {
        for (let i = 0; i < nonInvItems.length; i += 15) {
          const chunk = nonInvItems.slice(i, i + 15);
          const clientRequestId = `BATCH-TX-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          try {
            const batchRes = await fetchWithTimeout(
              '/api/sheets/sync-batch',
              {
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
              },
              GAS_TIMEOUTS.WRITE_CLIENT_MS
            );

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
                try {
                  const bReqIds = chunk.map((c) => c.clientRequestId).filter(Boolean) as string[];
                  const bItemIds = chunk.flatMap((c) => [
                    c.id,
                    c.payload?.id,
                    c.payload?.InvoiceID,
                    c.payload?.saleId,
                    c.payload?.invoiceNumber,
                    c.payload?.grnId,
                    c.payload?.voucherId,
                  ]).filter(Boolean) as string[];
                  markReceiptAsSynced(bReqIds, bItemIds);
                  markRecordsCloudSynced(bItemIds, bReqIds, 'Transactions', false);
                } catch {}
                this.circuitBreaker.recordSuccess();
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
        if (this.circuitBreaker.getSnapshot().state === 'OPEN') {
          console.warn(
            `[SyncEngine] Circuit breaker tripped OPEN mid-drain; deferring remaining ${remainingItems.length - processed} item(s) without burning retries.`
          );
          break;
        }
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
    if (item.action === 'upsert_staff' || item.sheetName === 'Salespeople' || item.sheetName === 'users') {
      const activeStrategy = getCurrentCompany()?.sync_strategy || 'HUB_CLOUD';
      const isLocalHubActive = () => this.isOutboundSyncPaused;
      console.log('[STAFF TRACE] 2. Sync Router. Strategy:', activeStrategy, 'isLocalHubActive:', isLocalHubActive());
    }
    const activeCloud = getActiveCloudConfig();
    if (activeCloud.databaseType !== 'appscripts') {
      return false;
    }
    if (this.isOutboundSyncPaused || isAppScriptsIngestPaused()) {
      console.log(`[PersistentSyncEngine] 🛑 Outbound cloud sync suspended (Local Hub is Edge Gateway). Skipping pushSingleItem for ${item.id} (${item.sheetName}).`);
      return false;
    }
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

        // Mark local entity as synced across Room DB
        try {
          const targetItemIds = [
            item.id,
            item.payload?.id,
            item.payload?.InvoiceID,
            item.payload?.saleId,
            item.payload?.invoiceNumber,
            item.payload?.grnId,
            item.payload?.voucherId,
          ].filter(Boolean) as string[];
          const singleReqIds = item.clientRequestId ? [item.clientRequestId] : [];
          markReceiptAsSynced(singleReqIds, targetItemIds);
          markRecordsCloudSynced(targetItemIds, singleReqIds, item.sheetName, false);
        } catch {}

        // Trigger immediate entity refresh if staff or branch was modified
        if (item.action === 'upsert_staff' || item.sheetName === 'users') {
          this.forceRefreshStaff().catch(() => {});
        } else if (item.action === 'create_branch' || (item.sheetName === 'branches' && item.action !== 'delete_branch')) {
          this.forceRefreshBranches().catch(() => {});
        }

        this.circuitBreaker.recordSuccess();
        await this.notifyStats();
        return true;
      } else {
        throw new Error(result.error || result.message || 'Server rejected write');
      }
    } catch (err: any) {
      const nextRetries = item.retries + 1;
      const errorMsg = err?.message || String(err);
      const category = classifySyncError(errorMsg);

      if (category === 'PERMANENT') {
        // Poison-pill / non-retryable validation or isolation error -> quarantine immediately into DLQ
        await updateSyncItem(item.id, {
          status: 'failed',
          retries: nextRetries,
          lastError: `[Quarantined: permanent error] ${errorMsg}`,
        });
      } else if (nextRetries >= MAX_SYNC_RETRIES) {
        // Exhausted transient retries -> move to Dead-Letter Queue for manual admin inspection
        this.circuitBreaker.recordTransientFailure(errorMsg);
        await updateSyncItem(item.id, {
          status: 'failed',
          retries: nextRetries,
          lastError: `Exceeded ${MAX_SYNC_RETRIES} attempts. Last error: ${errorMsg}`,
        });
      } else {
        // Transient outage -> trip/advance circuit breaker & schedule jittered exponential backoff
        this.circuitBreaker.recordTransientFailure(errorMsg);
        const backoffDelay = computeJitteredBackoffMs(nextRetries);
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

    if (item.action === 'upsert_staff' || item.sheetName === 'Salespeople' || item.sheetName === 'users') {
      const staffObj = item.payload;
      console.log('[STAFF TRACE] 4. AppScripts Outbound:', JSON.stringify(staffObj));
    }

    const activeCloud = getActiveCloudConfig();
    if (activeCloud.databaseType !== 'appscripts') {
      throw new Error(`AppScripts sync disabled: active databaseType is ${activeCloud.databaseType}`);
    }

    const safeTarget = resolveSafeGasTarget({
      companyId: payload.company_id,
      webhookUrl: targetUrl,
      spreadsheetId:
        item.payload?.tenant_sheet_id ||
        item.payload?.sheet_id ||
        item.payload?.spreadsheet_id ||
        currentComp.sheet_id ||
        config.spreadsheetId ||
        '',
    });
    const cleanTargetUrl = safeTarget.webhookUrl;
    if (!cleanTargetUrl || !cleanTargetUrl.startsWith('http')) {
      throw new Error('No Google Apps Script webhook URL configured; record remains in offline queue for retry.');
    }

    const sheetLower = String(item.sheetName || '').toLowerCase();
    const isMasterControlAction =
      item.action === 'upsert_staff' ||
      item.action === 'create_branch' ||
      item.action === 'sync_company' ||
      sheetLower === 'companies' ||
      sheetLower === 'branches' ||
      sheetLower === 'users' ||
      sheetLower === 'salespeople';
    if (
      !isMasterControlAction &&
      payload.company_id &&
      !isMasterCompanyId(payload.company_id) &&
      (safeTarget.blockedMasterSheetLeak || !safeTarget.spreadsheetId)
    ) {
      throw new Error(
        safeTarget.blockedMasterSheetLeak
          ? `MASTER_SHEET_WRITE_BLOCKED: Refused to write tenant ${payload.company_id} row to Master Sheet.`
          : `DEDICATED_SHEET_REQUIRED: Tenant ${payload.company_id} has no dedicated spreadsheet provisioned yet.`
      );
    }

    const cleanPayload = {
      ...payload,
      tenant_sheet_id: safeTarget.spreadsheetId,
      sheet_id: safeTarget.spreadsheetId,
      spreadsheet_id: safeTarget.spreadsheetId,
    };

    // 1. Try server-side proxy route (/api/sheets/sync-row) - requires verified HTTP 200/201
    let proxyNotFound = false;
    try {
      const srvRes = await fetchWithTimeout(
        '/api/sheets/sync-row',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_url: cleanTargetUrl,
            ...cleanPayload,
          }),
        },
        GAS_TIMEOUTS.WRITE_CLIENT_MS
      );

      if (srvRes.status === 200 || srvRes.status === 201 || srvRes.ok) {
        const parsed = parseGasResponseText(await srvRes.text(), srvRes.status);
        const json = parsed.data;
        if (json && json.success !== false && json.status !== 'error') {
          return json;
        }
        throw new Error(json?.error || json?.message || parsed.error || 'Google Apps Script rejected write');
      }

      if (srvRes.status === 404 || srvRes.status >= 502) {
        proxyNotFound = true;
      } else {
        const errJson = await srvRes.json().catch(() => null);
        throw new Error(errJson?.error || `Cloud proxy returned HTTP ${srvRes.status}`);
      }
    } catch (proxyErr: any) {
      if (isTimeoutError(proxyErr)) {
        throw new Error('Cloud sync timed out (55s); record kept in offline queue for retry.');
      }
      if (!proxyNotFound && proxyErr?.name !== 'TypeError') {
        throw proxyErr;
      }
    }

    // 2. Direct browser fetch to Apps Script (strict HTTP 200/201 verification - NO blind no-cors)
    let directRes: Response;
    try {
      directRes = await fetchWithTimeout(
        cleanTargetUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(cleanPayload),
          redirect: 'follow',
        },
        GAS_TIMEOUTS.WRITE_CLIENT_MS
      );
    } catch (directErr: any) {
      if (isTimeoutError(directErr)) {
        throw new Error('Cloud sync timed out (55s); record kept in offline queue for retry.');
      }
      throw new Error(directErr?.message || 'Cloud sync network error; record kept in offline queue for retry.');
    }

    const parsedDirect = parseGasResponseText(await directRes.text(), directRes.status);
    if (directRes.status !== 200 && directRes.status !== 201 && !directRes.ok) {
      throw new Error(parsedDirect.error || `Google Apps Script webhook failed with HTTP ${directRes.status}`);
    }
    if (!parsedDirect.data || parsedDirect.data.success === false || parsedDirect.data.status === 'error') {
      throw new Error(parsedDirect.data?.error || parsedDirect.data?.message || parsedDirect.error || 'Google Apps Script rejected write');
    }

    return parsedDirect.data;
  }

  // ==================== WORK STREAM B: DELTA REFRESH ====================

  /**
   * Delta refresh for Staff and Branches.
   * Calls get_users_since(lastSyncAt) and get_branches_since(lastSyncAt).
   */
  public async performDeltaSync(): Promise<{ usersCount: number; branchesCount: number }> {
    const activeCloud = getActiveCloudConfig();
    if (activeCloud.databaseType !== 'appscripts' || this.isOutboundSyncPaused || isAppScriptsIngestPaused()) {
      console.log('[PersistentSyncEngine] 🛑 Cloud delta sync suspended (Local Hub is Edge Gateway). Skipping performDeltaSync.');
      return { usersCount: 0, branchesCount: 0 };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { usersCount: 0, branchesCount: 0 };
    }

    const currentCompany = getCurrentCompany();
    const companyId = currentCompany.company_id;
    if (!companyId) return { usersCount: 0, branchesCount: 0 };

    let usersCount = 0;
    let branchesCount = 0;

    try {
      // 1. Refresh Users (routed through SyncCore T2 LWW gate)
      const usersMeta = await getSyncMeta('users');
      const sinceUsers = usersMeta?.lastSyncAt || '1970-01-01T00:00:00.000Z';
      const usersRes = await this.fetchServerAction('get_users_since', {
        company_id: companyId,
        since: sinceUsers,
      });

      if (usersRes && usersRes.success && Array.isArray(usersRes.users)) {
        for (const u of usersRes.users) {
          const cloudStaff = u;
          console.log('[STAFF TRACE] 6. AppScripts Ingest. Incoming:', JSON.stringify(cloudStaff));
          const staffId = u.id || u.user_id;
          const existingStaff = getAllSalespeople().find((s) => s.id === staffId);
          const incomingTs = parseTimestampMs(u.updatedAt || u.updated_at || u.lastUpdated) || 0;
          const incomingVersion = Number(u.version || 0);
          const incomingMutationSource =
            u.mutationSource ||
            u.mutation_source ||
            (incomingTs === 0 && incomingVersion === 0 ? 'SEED' : 'MIGRATION');
          const incomingPinVersion = Number(u.pinVersion || u.pin_version || 0);
          const incomingPinUpdatedAt = parseTimestampMs(u.pinUpdatedAt || u.pin_updated_at) || incomingTs;
          const existingPinVersion = Number((existingStaff as any)?.pinVersion || 0);
          const existingPinUpdatedAt = parseTimestampMs((existingStaff as any)?.pinUpdatedAt || existingStaff?.updatedAt);
          const existingHasPin = Boolean(existingStaff?.pin_hash || existingStaff?.pin);
          const shouldKeepExistingPin =
            existingHasPin &&
            (
              !u.pin_hash ||
              (existingPinVersion > 0 && incomingPinVersion === 0) ||
              (existingPinVersion > 0 && incomingPinVersion > 0 && existingPinVersion > incomingPinVersion) ||
              (existingPinUpdatedAt > 0 && incomingPinUpdatedAt > 0 && existingPinUpdatedAt - incomingPinUpdatedAt > 5000) ||
              incomingTs === 0
            );
          const pinHash = shouldKeepExistingPin ? existingStaff?.pin_hash : (u.pin_hash || existingStaff?.pin_hash);
          const pinSalt = shouldKeepExistingPin ? existingStaff?.pin_salt : (u.pin_salt || existingStaff?.pin_salt);
          const effectivePinVersion = Math.max(existingPinVersion, incomingPinVersion);
          const effectivePinUpdatedAt = Math.max(existingPinUpdatedAt, incomingPinUpdatedAt);
          const resolvedBranchId = u.branch_id || u.branchId || existingStaff?.branchId || 'BR-MAIN';
          const resolvedBranchAssignments = u.branchAssignments || existingStaff?.branchAssignments;
          const resolvedAssignedBranchIds =
            u.assignedBranchIds ||
            (Array.isArray(resolvedBranchAssignments) && resolvedBranchAssignments.length > 0
              ? resolvedBranchAssignments.map((a: any) => a.branchId).filter(Boolean)
              : (existingStaff as any)?.assignedBranchIds);
          const userPerson: Salesperson = {
            id: staffId,
            name: u.full_name || u.name || existingStaff?.name || 'Staff',
            email: u.email || existingStaff?.email || '',
            role: (u.role || existingStaff?.role || 'CASHIER').toUpperCase() as any,
            ...(pinHash
              ? { pin_hash: pinHash, ...(pinSalt ? { pin_salt: pinSalt } : {}) }
              : existingStaff?.pin
              ? { pin: existingStaff.pin }
              : { pin: String(u.pin || '1234') }),
            active: (u.is_active !== false && u.active !== 'N' && u.active !== false) ? 'Y' : 'N',
            companyId: u.company_id || companyId,
            branchId: resolvedBranchId,
            branch_id: resolvedBranchId,
            ...(resolvedBranchAssignments ? { branchAssignments: resolvedBranchAssignments } : {}),
            ...(resolvedAssignedBranchIds ? { assignedBranchIds: resolvedAssignedBranchIds } : {}),
            ...(u.permissions || existingStaff?.permissions ? { permissions: u.permissions || existingStaff?.permissions } : {}),
            version: incomingVersion,
            mutationSource: incomingMutationSource,
            ...(effectivePinVersion > 0 ? { pinVersion: effectivePinVersion } : {}),
            ...(effectivePinUpdatedAt > 0 ? { pinUpdatedAt: effectivePinUpdatedAt } : {}),
            ...(incomingTs > 0 ? { updatedAt: incomingTs, lastUpdated: new Date(incomingTs).toISOString() } : {}),
          } as any;

          const resIngest = await routeCloudRecordThroughSyncCore(
            {
              packetId: `CLOUD-STAFF-${staffId}-${incomingTs}-${Math.random().toString(36).substring(2, 6)}`,
              entityType: 'staff',
              entityId: String(staffId),
              action: 'UPSERT',
              data: userPerson,
              updatedAt: incomingTs,
              version: incomingVersion,
              mutationSource: incomingMutationSource,
              originDeviceId: 'APPS_SCRIPT_CLOUD',
              targetBranchId: 'ALL',
              class: 'T2',
            },
            existingStaff,
            () => {
              const savedStaff = saveSalesperson(userPerson, { fromSync: true });
              console.log(
                '[STAFF TRACE] 7. Saved to DB. New Pin:',
                savedStaff.pin_hash,
                'New Branches:',
                (savedStaff as any).assignedBranchIds ?? savedStaff.branchAssignments?.map((b) => b.branchId),
                'Role:',
                savedStaff.role
              );
              usersCount++;
            }
          );
          if (!resIngest.accepted && String(resIngest.reason || '').startsWith('STALE_T2')) {
            console.warn(`[SyncCore Gate] 🛡️ Rejected stale AppScripts staff update for ${staffId} (${resIngest.reason})`);
          }
        }
        const serverTime = usersRes.server_time || new Date().toISOString();
        await setSyncMeta('users', serverTime, serverTime);
      }

      // 2. Refresh Branches (routed through SyncCore T2 LWW gate)
      const branchesMeta = await getSyncMeta('branches');
      const sinceBranches = branchesMeta?.lastSyncAt || '1970-01-01T00:00:00.000Z';
      const branchesRes = await this.fetchServerAction('get_branches_since', {
        company_id: companyId,
        since: sinceBranches,
      });

      if (branchesRes && branchesRes.success && Array.isArray(branchesRes.branches)) {
        for (const b of branchesRes.branches) {
          const rawBrId = String(b.branch_id || b.branchId || b.BranchID || b.id || 'BR-MAIN').trim();
          const lowerBr = rawBrId.toLowerCase();
          const brId = lowerBr === '1' || lowerBr === 'br-main' || lowerBr === 'br001' ? 'BR-MAIN' : rawBrId;
          const existingBranch = getBranches().find((eb) => {
            const eId = String(eb.branchId || eb.id || '').trim().toLowerCase();
            return eId === brId.toLowerCase() || (brId === 'BR-MAIN' && (eId === '1' || eId === 'br001' || eId === 'br-main'));
          });
          const incomingTs = parseTimestampMs(b.updatedAt || b.updated_at || b.lastUpdated || b.UpdatedAt) || 0;
          const rawName = String(b.name || b.branch_name || b.branchName || b.Name || '').trim();
          const rawCode = String(b.code || b.branch_code || b.branchCode || b.Code || '').trim();
          const rawLoc = String(b.location || b.address || b.Location || b.Address || '').trim();
          const existingName = existingBranch?.name && !['branch', 'main branch', 'unnamed branch'].includes(existingBranch.name.trim().toLowerCase()) ? existingBranch.name : '';
          const existingCode = existingBranch?.code && existingBranch.code.trim().toLowerCase() !== brId.toLowerCase() ? existingBranch.code : '';
          const incomingBranchVersion = Number(b.version || 0);
          const incomingBranchSource =
            b.mutationSource ||
            b.mutation_source ||
            (incomingTs === 0 && incomingBranchVersion === 0 ? 'SEED' : 'MIGRATION');
          const branchObj: Branch = {
            id: brId,
            branchId: brId,
            name: (rawName && !['branch', 'unnamed branch'].includes(rawName.toLowerCase())) ? rawName : (existingName || rawName || 'Main Branch'),
            code: (rawCode && rawCode.toLowerCase() !== brId.toLowerCase()) ? rawCode : (existingCode || rawCode || brId),
            location: rawLoc || existingBranch?.location || '',
            address: rawLoc || existingBranch?.address || existingBranch?.location || '',
            company_id: b.company_id || b.companyId || b.CompanyID || companyId,
            companyId: b.company_id || b.companyId || b.CompanyID || companyId,
            is_active: b.is_active !== false,
            version: incomingBranchVersion,
            mutationSource: incomingBranchSource,
            ...(incomingTs > 0 ? { updatedAt: incomingTs, lastUpdated: new Date(incomingTs).toISOString() } : {}),
          } as any;

          await routeCloudRecordThroughSyncCore(
            {
              packetId: `CLOUD-BRANCH-${brId}-${incomingTs}-${Math.random().toString(36).substring(2, 6)}`,
              entityType: 'branch',
              entityId: String(brId),
              action: 'UPSERT',
              data: branchObj,
              updatedAt: incomingTs,
              version: incomingBranchVersion,
              mutationSource: incomingBranchSource,
              originDeviceId: 'APPS_SCRIPT_CLOUD',
              targetBranchId: 'ALL',
              class: 'T2',
            },
            existingBranch,
            () => {
              saveBranch(branchObj, { fromSync: true });
              branchesCount++;
            }
          );
        }
        const serverTime = branchesRes.server_time || new Date().toISOString();
        await setSyncMeta('branches', serverTime, serverTime);
      }

      // 3. Operational entities (inventory, sales, stocktake, cash, wallets) are synced via AppScriptsAdapter.requestCatchUp()
    } catch (err) {
      console.warn('[SyncEngine] Delta sync non-fatal error:', err);
    }

    return { usersCount, branchesCount };
  }

  public async forceRefreshStaff(): Promise<number> {
    if (this.isOutboundSyncPaused || isAppScriptsIngestPaused()) {
      console.log('[PersistentSyncEngine] 🛑 Cloud staff refresh suspended (Local Hub is Edge Gateway). Skipping forceRefreshStaff.');
      return 0;
    }
    const currentCompany = getCurrentCompany();
    const res = await this.fetchServerAction('get_users_since', {
      company_id: currentCompany.company_id,
      since: '1970-01-01T00:00:00.000Z', // full fetch
    });
    let count = 0;
    if (res && res.success && Array.isArray(res.users)) {
      for (const u of res.users) {
        const cloudStaff = u;
        console.log('[STAFF TRACE] 6. AppScripts Ingest. Incoming:', JSON.stringify(cloudStaff));
        const staffId = u.id || u.user_id;
        const existingStaff = getAllSalespeople().find((s) => s.id === staffId);
        const incomingTs = parseTimestampMs(u.updatedAt || u.updated_at || u.lastUpdated) || 0;
        const incomingVersion = Number(u.version || 0);
        const incomingMutationSource =
          u.mutationSource ||
          u.mutation_source ||
          (incomingTs === 0 && incomingVersion === 0 ? 'SEED' : 'MIGRATION');
        const incomingPinVersion = Number(u.pinVersion || u.pin_version || 0);
        const incomingPinUpdatedAt = parseTimestampMs(u.pinUpdatedAt || u.pin_updated_at) || incomingTs;
        const existingPinVersion = Number((existingStaff as any)?.pinVersion || 0);
        const existingPinUpdatedAt = parseTimestampMs((existingStaff as any)?.pinUpdatedAt || existingStaff?.updatedAt);
        const existingHasPin = Boolean(existingStaff?.pin_hash || existingStaff?.pin);
        const shouldKeepExistingPin =
          existingHasPin &&
          (
            !u.pin_hash ||
            (existingPinVersion > 0 && incomingPinVersion === 0) ||
            (existingPinVersion > 0 && incomingPinVersion > 0 && existingPinVersion > incomingPinVersion) ||
            (existingPinUpdatedAt > 0 && incomingPinUpdatedAt > 0 && existingPinUpdatedAt - incomingPinUpdatedAt > 5000) ||
            incomingTs === 0
          );
        const pinHash = shouldKeepExistingPin ? existingStaff?.pin_hash : (u.pin_hash || existingStaff?.pin_hash);
        const pinSalt = shouldKeepExistingPin ? existingStaff?.pin_salt : (u.pin_salt || existingStaff?.pin_salt);
        const effectivePinVersion = Math.max(existingPinVersion, incomingPinVersion);
        const effectivePinUpdatedAt = Math.max(existingPinUpdatedAt, incomingPinUpdatedAt);
        const resolvedBranchId = u.branch_id || u.branchId || existingStaff?.branchId || 'BR-MAIN';
        const resolvedBranchAssignments = u.branchAssignments || existingStaff?.branchAssignments;
        const resolvedAssignedBranchIds =
          u.assignedBranchIds ||
          (Array.isArray(resolvedBranchAssignments) && resolvedBranchAssignments.length > 0
            ? resolvedBranchAssignments.map((a: any) => a.branchId).filter(Boolean)
            : (existingStaff as any)?.assignedBranchIds);
        const userObj: any = {
          id: staffId,
          name: u.full_name || u.name || existingStaff?.name || 'Staff',
          email: u.email || existingStaff?.email || '',
          role: (u.role || existingStaff?.role || 'CASHIER').toUpperCase() as any,
          ...(pinHash
            ? { pin_hash: pinHash, ...(pinSalt ? { pin_salt: pinSalt } : {}) }
            : existingStaff?.pin
            ? { pin: existingStaff.pin }
            : { pin: String(u.pin || '1234') }),
          active: (u.is_active !== false && u.active !== 'N' && u.active !== false) ? 'Y' : 'N',
          companyId: u.company_id || currentCompany.company_id,
          branchId: resolvedBranchId,
          branch_id: resolvedBranchId,
          ...(resolvedBranchAssignments ? { branchAssignments: resolvedBranchAssignments } : {}),
          ...(resolvedAssignedBranchIds ? { assignedBranchIds: resolvedAssignedBranchIds } : {}),
          ...(u.permissions || existingStaff?.permissions ? { permissions: u.permissions || existingStaff?.permissions } : {}),
          version: incomingVersion,
          mutationSource: incomingMutationSource,
          ...(effectivePinVersion > 0 ? { pinVersion: effectivePinVersion } : {}),
          ...(effectivePinUpdatedAt > 0 ? { pinUpdatedAt: effectivePinUpdatedAt } : {}),
          ...(incomingTs > 0 ? { updatedAt: incomingTs, lastUpdated: new Date(incomingTs).toISOString() } : {}),
        };
        await routeCloudRecordThroughSyncCore(
          {
            packetId: `CLOUD-STAFF-FULL-${staffId}-${incomingTs}-${Math.random().toString(36).substring(2, 6)}`,
            entityType: 'staff',
            entityId: String(staffId),
            action: 'UPSERT',
            data: userObj,
            updatedAt: incomingTs,
            version: incomingVersion,
            mutationSource: incomingMutationSource,
            originDeviceId: 'APPS_SCRIPT_CLOUD',
            targetBranchId: 'ALL',
            class: 'T2',
          },
          existingStaff,
          () => {
            const savedStaff = saveSalesperson(userObj, { fromSync: true });
            console.log(
              '[STAFF TRACE] 7. Saved to DB. New Pin:',
              savedStaff.pin_hash,
              'New Branches:',
              (savedStaff as any).assignedBranchIds ?? savedStaff.branchAssignments?.map((b) => b.branchId),
              'Role:',
              savedStaff.role
            );
            count++;
          }
        );
      }
      const serverTime = res.server_time || new Date().toISOString();
      await setSyncMeta('users', serverTime, serverTime);
    }
    return count;
  }

  public async forceRefreshBranches(): Promise<number> {
    if (this.isOutboundSyncPaused || isAppScriptsIngestPaused()) {
      console.log('[PersistentSyncEngine] 🛑 Cloud branches refresh suspended (Local Hub is Edge Gateway). Skipping forceRefreshBranches.');
      return 0;
    }
    const currentCompany = getCurrentCompany();
    const res = await this.fetchServerAction('get_branches_since', {
      company_id: currentCompany.company_id,
      since: '1970-01-01T00:00:00.000Z', // full fetch
    });
    let count = 0;
    if (res && res.success && Array.isArray(res.branches)) {
      for (const b of res.branches) {
        const rawBrId = String(b.branch_id || b.branchId || b.BranchID || b.id || 'BR-MAIN').trim();
        const lowerBr = rawBrId.toLowerCase();
        const brId = lowerBr === '1' || lowerBr === 'br-main' || lowerBr === 'br001' ? 'BR-MAIN' : rawBrId;
        const existingBranch = getBranches().find((eb) => {
          const eId = String(eb.branchId || eb.id || '').trim().toLowerCase();
          return eId === brId.toLowerCase() || (brId === 'BR-MAIN' && (eId === '1' || eId === 'br001' || eId === 'br-main'));
        });
        const incomingTs = parseTimestampMs(b.updatedAt || b.updated_at || b.lastUpdated || b.UpdatedAt) || 0;
        const rawName = String(b.name || b.branch_name || b.branchName || b.Name || '').trim();
        const rawCode = String(b.code || b.branch_code || b.branchCode || b.Code || '').trim();
        const rawLoc = String(b.location || b.address || b.Location || b.Address || '').trim();
        const existingName = existingBranch?.name && !['branch', 'main branch', 'unnamed branch'].includes(existingBranch.name.trim().toLowerCase()) ? existingBranch.name : '';
        const existingCode = existingBranch?.code && existingBranch.code.trim().toLowerCase() !== brId.toLowerCase() ? existingBranch.code : '';
        const incomingBranchVersion = Number(b.version || 0);
        const incomingBranchSource =
          b.mutationSource ||
          b.mutation_source ||
          (incomingTs === 0 && incomingBranchVersion === 0 ? 'SEED' : 'MIGRATION');
        const branchObj: any = {
          id: brId,
          branchId: brId,
          name: (rawName && !['branch', 'unnamed branch'].includes(rawName.toLowerCase())) ? rawName : (existingName || rawName || 'Main Branch'),
          code: (rawCode && rawCode.toLowerCase() !== brId.toLowerCase()) ? rawCode : (existingCode || rawCode || brId),
          location: rawLoc || existingBranch?.location || '',
          address: rawLoc || existingBranch?.address || existingBranch?.location || '',
          company_id: b.company_id || b.companyId || b.CompanyID || currentCompany.company_id,
          companyId: b.company_id || b.companyId || b.CompanyID || currentCompany.company_id,
          is_active: b.is_active !== false,
          version: incomingBranchVersion,
          mutationSource: incomingBranchSource,
          ...(incomingTs > 0 ? { updatedAt: incomingTs, lastUpdated: new Date(incomingTs).toISOString() } : {}),
        };
        await routeCloudRecordThroughSyncCore(
          {
            packetId: `CLOUD-BRANCH-FULL-${brId}-${incomingTs}-${Math.random().toString(36).substring(2, 6)}`,
            entityType: 'branch',
            entityId: String(brId),
            action: 'UPSERT',
            data: branchObj,
            updatedAt: incomingTs,
            version: incomingBranchVersion,
            mutationSource: incomingBranchSource,
            originDeviceId: 'APPS_SCRIPT_CLOUD',
            targetBranchId: 'ALL',
            class: 'T2',
          },
          existingBranch,
          () => {
            saveBranch(branchObj, { fromSync: true });
            count++;
          }
        );
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

          const remoteEpoch = Number(tenantData.routing_epoch || tenantData.current_routing_epoch || 0);
          const localEpoch = getRoutingEpoch(companyId);
          if (remoteEpoch > localEpoch) {
            setRoutingEpoch(companyId, remoteEpoch);
            resetCloudCatchupCursors(companyId, getCurrentBranchId());
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
            resetCloudCatchupCursors(companyId, getCurrentBranchId());
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

    const breaker = this.circuitBreaker.getSnapshot();
    return {
      total: all.length,
      pending,
      syncing,
      done,
      failed,
      lastSyncTime: doneItem?.createdAt,
      lastError: failedItem?.lastError,
      circuitState: breaker.state,
      circuitCooldownSec: Math.ceil(breaker.cooldownRemainingMs / 1000),
      webLocksActive: isWebLocksSupported(),
    };
  }

  public async exportFailedItems(companyId?: string): Promise<PersistentSyncItem[]> {
    const activeComp = companyId || getCurrentCompanyId();
    return await getSyncQueueItems('failed', activeComp);
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
    this.circuitBreaker.reset();
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

  public async retryAllFailed(companyId?: string): Promise<number> {
    const activeComp = companyId || getCurrentCompanyId();
    const all = await getSyncQueueItems('failed', activeComp);
    if (all.length === 0) return 0;
    this.circuitBreaker.reset();
    for (const item of all) {
      await updateSyncItem(item.id, {
        status: 'pending',
        nextRetryAt: Date.now(),
        retries: 0,
        lastError: undefined,
      });
    }
    await this.notifyStats(activeComp);
    this.drainSyncQueue(activeComp, { bypassCircuit: true }).catch(() => {});
    return all.length;
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

  private async fetchServerAction(
    action: string,
    params: Record<string, any>,
    allowRefreshRetry: boolean = true
  ): Promise<any> {
    const currentComp = getCurrentCompany();
    const config = getSheetsConfig();
    const compId = String(params?.company_id || currentComp.company_id || 'COMP-001').trim();
    const jwt = getTenantAuthToken(compId);
    const routingEpoch = getRoutingEpoch(compId);
    const sheetId = String(currentComp.sheet_id || config.spreadsheetId || '').trim();

    const fullParams: Record<string, string> = {};
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fullParams[k] = String(v);
    });
    if (sheetId) fullParams.spreadsheet_id = sheetId;
    if (routingEpoch > 0) fullParams.routing_epoch = String(routingEpoch);
    if (jwt) fullParams.jwt = jwt;

    const targetUrl =
      currentComp.webhook_url ||
      config.webhookUrl ||
      config.masterWebhookUrl ||
      '';

    const handleControlResponse = async (json: any): Promise<any> => {
      if (!json || typeof json !== 'object') return json;
      const code = String(json.code || '').toUpperCase().trim();
      if (
        (code === 'JWT_EXPIRED' || code === 'JWT_INVALID' || code === 'JWT_MISSING') &&
        allowRefreshRetry &&
        action !== 'refresh_token'
      ) {
        const ref = await this.fetchServerAction('refresh_token', { company_id: compId }, false);
        if (ref?.token) {
          setTenantAuthToken(compId, ref.token);
          if (typeof ref.routing_epoch === 'number' && ref.routing_epoch > 0) {
            setRoutingEpoch(compId, ref.routing_epoch);
          }
          return await this.fetchServerAction(action, params, false);
        }
      }
      if (code === 'ROUTING_EPOCH_STALE') {
        const nextEp = Number(json.current_routing_epoch || json.routing_epoch || 0);
        if (nextEp > 0) setRoutingEpoch(compId, nextEp);
        resetCloudCatchupCursors(compId, getCurrentBranchId());
      }
      return json;
    };

    // 1. Direct GET to Google Apps Script if URL available
    const safeActionTarget = resolveSafeGasTarget({ companyId: compId, webhookUrl: targetUrl });
    if (safeActionTarget.webhookUrl && safeActionTarget.webhookUrl.startsWith('http')) {
      try {
        const queryUrl = `${safeActionTarget.webhookUrl}${safeActionTarget.webhookUrl.includes('?') ? '&' : '?'}action=${encodeURIComponent(action)}&${new URLSearchParams(fullParams).toString()}`;
        const res = await fetchWithTimeout(
          queryUrl,
          { method: 'GET', redirect: 'follow' },
          GAS_TIMEOUTS.READ_CLIENT_MS
        );
        if (res.ok) {
          const parsed = parseGasResponseText(await res.text(), res.status);
          if (parsed.data) return await handleControlResponse(parsed.data);
        }
      } catch (e) {
        // Fallback to proxy
      }
    }

    // 2. Server proxy fallback
    try {
      const proxyRes = await fetchWithTimeout(
        `/api/saas/call-action?action=${encodeURIComponent(action)}&${new URLSearchParams(fullParams).toString()}`,
        {
          method: 'GET',
          headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
        },
        GAS_TIMEOUTS.READ_CLIENT_MS
      );
      const json = await proxyRes.json().catch(() => null);
      if (json) return await handleControlResponse(json);
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
export const pauseCloudSyncEngine = () => persistentSyncEngine.pauseOutboundSync();
export const resumeCloudSyncEngine = () => persistentSyncEngine.resumeOutboundSync();
export const isCloudSyncEnginePaused = () => persistentSyncEngine.isSyncPaused();
