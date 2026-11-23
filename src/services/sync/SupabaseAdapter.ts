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
  parseTimestampMs,
  annotateSaleCloudReceiptMetadata,
} from '../../db/roomDatabase';
import { getPendingSyncQueueItems, updateSyncItem } from '../../db/indexedDBService';
import { persistentSyncEngine } from '../persistentSyncEngine';
import { evaluateSuspiciousBackdate, reportTrustedTimeSample } from '../../utils/clockSecurity';

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

    const outboundTs = envelope.updatedAt && envelope.updatedAt > 0 ? envelope.updatedAt : Date.now();
    const backdateEval = evaluateSuspiciousBackdate(
      d.date || d.Date,
      d.timestamp || d.Timestamp || outboundTs
    );
    const shouldIncludeServerFields =
      envelope.entityType === 'sale' || envelope.entityType === 'cash_log';

    const basePayload: Record<string, any> = {
      ...d,
      id: d.id || d.account_id || d.transfer_id || d.settlementId || d.itemId || d.customerId || d.grvNumber || envelope.entityId,
      company_id: compId,
      branch_id: branchId,
      updated_at: new Date(outboundTs).toISOString(),
      ...(envelope.version !== undefined || d.version !== undefined
        ? { version: Number(envelope.version ?? d.version ?? 0) }
        : {}),
      ...(envelope.mutationSource || d.mutationSource
        ? { mutation_source: envelope.mutationSource || d.mutationSource }
        : {}),
      ...(d.pinVersion !== undefined ? { pin_version: Number(d.pinVersion) } : {}),
      ...(d.pinUpdatedAt ? { pin_updated_at: new Date(d.pinUpdatedAt).toISOString() } : {}),
    };

    const recordPayload = shouldIncludeServerFields
      ? {
          ...basePayload,
          server_received_at: backdateEval.server_received_at,
          suspicious_backdate: backdateEval.suspicious_backdate,
        }
      : basePayload;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify([recordPayload]),
        signal: AbortSignal.timeout(15000),
      });

      if (response.status === 400 && shouldIncludeServerFields) {
        const errPreview = await response.clone().text().catch(() => '');
        if (
          errPreview.includes('server_received_at') ||
          errPreview.includes('suspicious_backdate') ||
          errPreview.includes('PGRST204')
        ) {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
              Prefer: 'resolution=merge-duplicates,return=representation',
            },
            body: JSON.stringify([basePayload]),
            signal: AbortSignal.timeout(15000),
          });
        }
      }
    } catch (netErr: any) {
      const isTimeout = netErr?.name === 'TimeoutError' || netErr?.name === 'AbortError';
      return {
        success: false,
        packetId: envelope.packetId,
        error: isTimeout
          ? 'Supabase sync timed out; record retained in offline queue for retry.'
          : netErr?.message || 'Supabase network error; record retained in offline queue for retry.',
      };
    }

    if (!response.ok && response.status !== 200 && response.status !== 201) {
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        packetId: envelope.packetId,
        error: `Supabase sync failed with HTTP ${response.status}${errText ? `: ${errText}` : ''}`,
      };
    }

    // Extract authoritative cloud server receipt time from HTTP Date header or returned Postgres row
    const hdrDate = response.headers.get('date');
    const returnedRows = await response.clone().json().catch(() => null);
    const returnedRow = Array.isArray(returnedRows) ? returnedRows[0] : null;
    const serverTsMs =
      (returnedRow?.server_received_at ? Date.parse(returnedRow.server_received_at) : NaN) ||
      (hdrDate ? Date.parse(hdrDate) : NaN) ||
      Date.now();
    if (Number.isFinite(serverTsMs) && serverTsMs > 1_600_000_000_000) {
      reportTrustedTimeSample(serverTsMs, 'CLOUD_SERVER');
    }
    const cloudEval = evaluateSuspiciousBackdate(
      d.date || d.Date,
      d.timestamp || d.Timestamp || outboundTs,
      Number.isFinite(serverTsMs) ? serverTsMs : Date.now()
    );
    const finalServerReceivedAt =
      returnedRow?.server_received_at || cloudEval.server_received_at;
    const finalSuspicious = Boolean(
      returnedRow?.suspicious_backdate ?? cloudEval.suspicious_backdate
    );

    if (envelope.entityType === 'sale') {
      const saleId = String(d.id || d.invoice_id || envelope.entityId || '');
      if (saleId) {
        annotateSaleCloudReceiptMetadata(saleId, {
          server_received_at: finalServerReceivedAt,
          suspicious_backdate: finalSuspicious,
        });
      }
    }

    // ONLY confirm isCloudSynced = true after verified HTTP 200/201 response
    envelope.isCloudSynced = true;
    if (envelope.data && typeof envelope.data === 'object') {
      (envelope.data as any).isCloudSynced = true;
      if (envelope.entityType === 'sale') {
        (envelope.data as any).server_received_at = finalServerReceivedAt;
        (envelope.data as any).suspicious_backdate = finalSuspicious;
      }
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
          const incomingTs = parseTimestampMs(row?.updated_at || row?.updatedAt || row?.last_updated || row?.lastUpdated) || 0;
          const incomingVersion = Number(row?.version || 0);
          const mutationSource =
            row?.mutation_source ||
            row?.mutationSource ||
            (incomingTs === 0 && incomingVersion === 0 ? 'SEED' : 'MIGRATION');
          const normalizedData: any = {
            ...row,
            id,
            companyId: row?.company_id || row?.companyId,
            branchId: row?.branch_id || row?.branchId,
            version: incomingVersion,
            mutationSource,
            isCloudSynced: true,
            ...(incomingTs > 0 ? { updatedAt: incomingTs, lastUpdated: new Date(incomingTs).toISOString() } : {}),
            ...(entityType === 'staff'
              ? {
                  name: row?.full_name || row?.name,
                  active: row?.is_active === false || row?.active === 'N' ? 'N' : 'Y',
                  ...(row?.pin_version !== undefined || row?.pinVersion !== undefined
                    ? { pinVersion: Number(row?.pin_version ?? row?.pinVersion ?? 0) }
                    : {}),
                  ...(row?.pin_updated_at || row?.pinUpdatedAt
                    ? { pinUpdatedAt: parseTimestampMs(row?.pin_updated_at || row?.pinUpdatedAt) || undefined }
                    : {}),
                  ...(row?.branch_assignments || row?.branchAssignments
                    ? { branchAssignments: row?.branch_assignments || row?.branchAssignments }
                    : {}),
                  ...(row?.assigned_branch_ids || row?.assignedBranchIds
                    ? { assignedBranchIds: row?.assigned_branch_ids || row?.assignedBranchIds }
                    : {}),
                }
              : {}),
          };
          const isDeletedRow = Boolean(row?.is_deleted === true || row?.deleted_at || row?.deletedAt);
          envelopes.push({
            packetId: `SB-PULL-${entityType}-${id}-${incomingTs}-${Math.random().toString(36).substring(2, 6)}`,
            entityType,
            entityId: id,
            action: isDeletedRow ? 'DELETE' : spec?.appendOnly ? 'APPEND' : 'UPSERT',
            data: normalizedData,
            updatedAt: incomingTs,
            version: incomingVersion,
            mutationSource,
            originDeviceId: 'SUPABASE_CLOUD',
            targetBranchId: row?.branch_id || row?.branchId || 'ALL',
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
