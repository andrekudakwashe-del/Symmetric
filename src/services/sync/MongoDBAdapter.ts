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

export class MongoDBAdapter implements SyncAdapter {
  readonly name = 'MongoDBAdapter';
  readonly myDatabaseType = 'mongodb' as const;

  private paused = false;
  private receiveHandlers: Set<(envelope: SyncEnvelope) => void> = new Set();

  public pause(): void {
    if (!this.paused) {
      this.paused = true;
      console.log('[MongoDBAdapter] 🛑 Paused (Local Hub active, HUB_ONLY mode, or non-mongodb tenant).');
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
      console.log('[MongoDBAdapter] 🟢 Resumed (Single Active Cloud Adapter: mongodb).');
    }
  }

  public isPaused(): boolean {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || cfg.strategy === 'HUB_ONLY') {
      return true;
    }
    return this.paused;
  }

  async connect(): Promise<void> {}

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
        error: `MongoDBAdapter disabled: active databaseType is ${config.databaseType}`,
      };
    }

    if (this.isPaused()) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'MongoDBAdapter paused (Local Hub is active)',
      };
    }

    const spec = ENTITY_REGISTRY[envelope.entityType];
    if (!spec || !spec.requiresBroadcast) {
      return { success: true, packetId: envelope.packetId };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'Device offline; MongoDB record retained in offline queue for retry.',
      };
    }

    const dataApiUrl = String(config.credentials.url || '').trim().replace(/\/+$/, '');
    const dataApiKey = String(config.credentials.apiKey || '').trim();
    if (!dataApiUrl || !dataApiKey) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'MongoDB HTTP Data API URL/key missing; record retained in offline queue for retry.',
      };
    }

    const d: any =
      envelope.data && typeof envelope.data === 'object' ? { ...envelope.data } : { value: envelope.data };
    const compId = d.company_id || d.companyId || getCurrentCompany()?.company_id || 'COMP-001';
    const branchId = d.branch_id || d.branchId || envelope.targetBranchId || getCurrentBranchId() || 'ALL';
    const collection = mapEntityTypeToCloudTable(envelope.entityType);
    const idVal = String(d.id || d.account_id || d.transfer_id || d.settlementId || d.itemId || d.customerId || d.grvNumber || envelope.entityId);

    let response: Response;
    try {
      response = await fetch(`${dataApiUrl}/action/updateOne`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': dataApiKey,
        },
        body: JSON.stringify({
          collection,
          database: config.credentials.database || 'saimetric_pos',
          filter: { id: idVal, company_id: compId },
          update: {
            $set: {
              ...d,
              id: idVal,
              company_id: compId,
              branch_id: branchId,
              updatedAt: envelope.updatedAt || Date.now(),
            },
          },
          upsert: true,
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (netErr: any) {
      const isTimeout = netErr?.name === 'TimeoutError' || netErr?.name === 'AbortError';
      return {
        success: false,
        packetId: envelope.packetId,
        error: isTimeout
          ? 'MongoDB sync timed out; record retained in offline queue for retry.'
          : netErr?.message || 'MongoDB network error; record retained in offline queue for retry.',
      };
    }

    if (!response.ok && response.status !== 200 && response.status !== 201) {
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        packetId: envelope.packetId,
        error: `MongoDB sync failed with HTTP ${response.status}${errText ? `: ${errText}` : ''}`,
      };
    }

    envelope.isCloudSynced = true;
    if (envelope.data && typeof envelope.data === 'object') {
      (envelope.data as any).isCloudSynced = true;
    }

    markRecordsCloudSynced(
      [envelope.entityId, idVal].filter(Boolean),
      [envelope.packetId, d.clientRequestId].filter(Boolean) as string[],
      envelope.entityType,
      false
    );

    return {
      success: true,
      packetId: envelope.packetId,
    };
  }

  async requestCatchUp(_sinceTimestamp: number): Promise<CatchUpResult> {
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType || this.isPaused()) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }
    return { envelopes: [], cutoffTimestamp: Date.now() };
  }

  async drainOfflineQueue(): Promise<void> {
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType || this.isPaused()) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const dataApiUrl = String(config.credentials.url || '').trim().replace(/\/+$/, '');
    const dataApiKey = String(config.credentials.apiKey || '').trim();
    if (!dataApiUrl || !dataApiKey) return;

    const pendingLs = getSyncQueue().filter((q) => q.status === 'pending' || q.status === 'failed');
    for (const item of pendingLs) {
      try {
        const collection = mapEntityTypeToCloudTable(item.sheetName);
        const recId = String(item.payload?.id || item.payload?.itemId || item.id || '');
        const response = await fetch(`${dataApiUrl}/action/updateOne`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': dataApiKey,
          },
          body: JSON.stringify({
            collection,
            database: config.credentials.database || 'saimetric_pos',
            filter: { id: recId },
            update: { $set: item.payload },
            upsert: true,
          }),
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

    try {
      const idbPending = await getPendingSyncQueueItems(Date.now());
      for (const item of idbPending) {
        try {
          const collection = mapEntityTypeToCloudTable(item.sheetName);
          const recId = String(item.payload?.id || item.payload?.itemId || item.id || '');
          const response = await fetch(`${dataApiUrl}/action/updateOne`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': dataApiKey,
            },
            body: JSON.stringify({
              collection,
              database: config.credentials.database || 'saimetric_pos',
              filter: { id: recId },
              update: { $set: item.payload },
              upsert: true,
            }),
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
