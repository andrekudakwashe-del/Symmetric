import { SyncAdapter, BroadcastResult, CatchUpResult } from './SyncAdapter';
import { SyncEnvelope } from './SyncEnvelope';
import { ENTITY_REGISTRY } from './EntityRegistry';
import { getActiveCloudConfig, mapEntityTypeToCloudTable } from './cloudConfigResolver';
import {
  getCurrentCompany,
  getCurrentBranchId,
  getSyncQueue,
  updateSyncQueueItem,
  markRecordsCloudSynced,
} from '../../db/roomDatabase';
import { getPendingSyncQueueItems, updateSyncItem } from '../../db/indexedDBService';
import { persistentSyncEngine } from '../persistentSyncEngine';

export class SupabaseAdapter implements SyncAdapter {
  readonly name = 'SupabaseAdapter';
  readonly myDatabaseType = 'supabase' as const;

  private paused = false;
  private receiveHandlers: Set<(envelope: SyncEnvelope) => void> = new Set();

  public pause(): void {
    if (!this.paused) {
      this.paused = true;
      console.log('[SupabaseAdapter] 🛑 Paused (Local Hub active, HUB_ONLY mode, or non-supabase tenant).');
    }
  }

  public resume(): void {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || cfg.strategy === 'HUB_ONLY') {
      this.paused = true;
      return;
    }
    if (this.paused) {
      this.paused = false;
      console.log('[SupabaseAdapter] 🟢 Resumed (Single Active Cloud Adapter: supabase).');
    }
  }

  public isPaused(): boolean {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || cfg.strategy === 'HUB_ONLY') {
      return true;
    }
    return this.paused;
  }

  async connect(): Promise<void> {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || this.isPaused()) return;
    try {
      await persistentSyncEngine.initialize();
    } catch {}
  }

  async disconnect(): Promise<void> {
    this.pause();
  }

  isConnected(): boolean {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || this.isPaused()) return false;
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  onReceive(handler: (envelope: SyncEnvelope) => void): () => void {
    this.receiveHandlers.add(handler);
    return () => {
      this.receiveHandlers.delete(handler);
    };
  }

  async broadcast(envelope: SyncEnvelope): Promise<BroadcastResult> {
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: `SupabaseAdapter disabled: active databaseType is ${config.databaseType}`,
      };
    }

    if (this.isPaused()) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'SupabaseAdapter paused (Local Hub is active)',
      };
    }

    const spec = ENTITY_REGISTRY[envelope.entityType];
    if (!spec || !spec.requiresBroadcast) {
      return { success: true, packetId: envelope.packetId };
    }

    const sbUrl = String(config.credentials.url || config.credentials.projectUrl || '')
      .trim()
      .replace(/\/+$/, '');
    const sbKey = String(
      config.credentials.serviceRoleKey ||
        config.credentials.apiKey ||
        config.credentials.anonKey ||
        ''
    ).trim();

    if (!sbUrl || !sbKey) {
      throw new Error('Supabase credentials missing; record retained in offline queue for retry.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Device offline; Supabase record retained in offline queue for retry.');
    }

    const d: any =
      envelope.data && typeof envelope.data === 'object' ? { ...envelope.data } : { value: envelope.data };
    if (d && typeof d === 'object' && 'reversalCashLogs' in d) {
      delete d.reversalCashLogs;
    }
    const compId = d.company_id || d.companyId || getCurrentCompany()?.company_id || 'COMP-001';
    const branchId = d.branch_id || d.branchId || envelope.targetBranchId || getCurrentBranchId() || 'ALL';
    const tableName = mapEntityTypeToCloudTable(envelope.entityType);
    const endpoint = `${sbUrl}/rest/v1/${tableName}`;

    const recordPayload = {
      ...d,
      id: d.id || d.itemId || d.customerId || d.grvNumber || envelope.entityId,
      company_id: compId,
      branch_id: branchId,
      updated_at: new Date(envelope.updatedAt || Date.now()).toISOString(),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([recordPayload]),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok && response.status !== 200 && response.status !== 201) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Supabase sync failed with HTTP ${response.status}${errText ? `: ${errText}` : ''}`
      );
    }

    // ONLY confirm isCloudSynced = true after verified HTTP 200/201 response
    envelope.isCloudSynced = true;
    if (envelope.data && typeof envelope.data === 'object') {
      (envelope.data as any).isCloudSynced = true;
    }

    const idList = [
      envelope.entityId,
      d.id,
      d.itemId,
      d.invoice_id,
      d.grvNumber,
      d.customerId,
      d.creditId,
      d.changeId,
    ]
      .filter(Boolean)
      .map(String);
    const reqList = [envelope.packetId, d.clientRequestId].filter(Boolean).map(String);
    markRecordsCloudSynced(idList, reqList, envelope.entityType, false);

    return {
      success: true,
      packetId: envelope.packetId,
    };
  }

  async requestCatchUp(sinceTimestamp: number): Promise<CatchUpResult> {
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType || this.isPaused()) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }

    const sbUrl = String(config.credentials.url || config.credentials.projectUrl || '')
      .trim()
      .replace(/\/+$/, '');
    const sbKey = String(
      config.credentials.serviceRoleKey ||
        config.credentials.apiKey ||
        config.credentials.anonKey ||
        ''
    ).trim();
    if (!sbUrl || !sbKey) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }

    const envelopes: SyncEnvelope[] = [];
    const sinceIso = new Date(sinceTimestamp > 0 ? sinceTimestamp : 0).toISOString();
    const tables = [
      'sales',
      'inventory',
      'customers',
      'staff',
      'expenses',
      'cash_logs',
      'cash_lifts',
      'customer_changes',
      'credit_sales',
      'direct_grvs',
    ];
    const tableToEntityType: Record<string, string> = {
      sales: 'sale',
      inventory: 'inventory_item',
      customers: 'customer',
      staff: 'staff',
      expenses: 'expense',
      cash_logs: 'cash_log',
      cash_lifts: 'cash_lift',
      customer_changes: 'customer_change',
      credit_sales: 'credit_sale',
      direct_grvs: 'direct_grv',
    };

    for (const tbl of tables) {
      try {
        const res = await fetch(
          `${sbUrl}/rest/v1/${tbl}?updated_at=gt.${encodeURIComponent(sinceIso)}&order=updated_at.asc&limit=200`,
          {
            method: 'GET',
            headers: {
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!res.ok) continue;
        const rows = await res.json().catch(() => null);
        if (!Array.isArray(rows)) continue;
        const entityType = tableToEntityType[tbl] || 'staff';
        const spec = ENTITY_REGISTRY[entityType];
        for (const row of rows) {
          const id = String(row?.id || row?.itemId || row?.customerId || '');
          if (!id) continue;
          envelopes.push({
            packetId: `SB-PULL-${entityType}-${id}-${Date.now()}`,
            entityType,
            entityId: id,
            action: spec?.appendOnly ? 'APPEND' : 'UPSERT',
            data: { ...row, isCloudSynced: true },
            updatedAt: row?.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
            originDeviceId: 'SUPABASE_CLOUD',
            targetBranchId: row?.branch_id || 'ALL',
            class: spec?.class || 'T1',
            isCloudSynced: true,
          });
        }
      } catch {}
    }

    return {
      envelopes,
      cutoffTimestamp: Date.now(),
    };
  }

  async drainOfflineQueue(): Promise<void> {
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType || this.isPaused()) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const sbUrl = String(config.credentials.url || config.credentials.projectUrl || '')
      .trim()
      .replace(/\/+$/, '');
    const sbKey = String(
      config.credentials.serviceRoleKey ||
        config.credentials.apiKey ||
        config.credentials.anonKey ||
        ''
    ).trim();
    if (!sbUrl || !sbKey) return;

    // 1. Drain localStorage SYNC_QUEUE items strictly via Supabase PostgREST
    const pendingLs = getSyncQueue().filter((q) => q.status === 'pending' || q.status === 'failed');
    for (const item of pendingLs) {
      try {
        const tbl = mapEntityTypeToCloudTable(item.sheetName);
        const response = await fetch(`${sbUrl}/rest/v1/${tbl}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify([item.payload]),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok && response.status !== 200 && response.status !== 201) {
          updateSyncQueueItem(item.id, {
            status: 'failed',
            retries: (item.retries || 0) + 1,
            error: `HTTP ${response.status}`,
          });
          continue;
        }
        updateSyncQueueItem(item.id, { status: 'synced', error: undefined });
        const recId = String(item.payload?.id || item.payload?.itemId || item.id || '');
        markRecordsCloudSynced(
          [recId, item.id].filter(Boolean),
          [item.payload?.clientRequestId].filter(Boolean) as string[],
          item.sheetName,
          false
        );
      } catch (err: any) {
        updateSyncQueueItem(item.id, {
          status: 'failed',
          retries: (item.retries || 0) + 1,
          error: err?.message || String(err),
        });
      }
    }

    // 2. Drain IndexedDB pending items strictly via Supabase PostgREST
    try {
      const idbPending = await getPendingSyncQueueItems(Date.now());
      for (const item of idbPending) {
        try {
          const tbl = mapEntityTypeToCloudTable(item.sheetName);
          const response = await fetch(`${sbUrl}/rest/v1/${tbl}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
              Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify([item.payload]),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok && response.status !== 200 && response.status !== 201) {
            await updateSyncItem(item.id, {
              status: 'pending',
              retries: (item.retries || 0) + 1,
              nextRetryAt: Date.now() + 15000,
              lastError: `HTTP ${response.status}`,
            });
            continue;
          }
          await updateSyncItem(item.id, { status: 'done', lastError: undefined });
          const recId = String(item.payload?.id || item.payload?.itemId || item.id || '');
          markRecordsCloudSynced(
            [recId, item.id].filter(Boolean),
            [item.clientRequestId].filter(Boolean) as string[],
            item.sheetName,
            false
          );
        } catch (err: any) {
          await updateSyncItem(item.id, {
            status: 'pending',
            retries: (item.retries || 0) + 1,
            nextRetryAt: Date.now() + 15000,
            lastError: err?.message || String(err),
          });
        }
      }
    } catch {}
  }
}
