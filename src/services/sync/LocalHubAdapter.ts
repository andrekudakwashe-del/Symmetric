import { SyncAdapter, BroadcastResult, CatchUpResult } from './SyncAdapter';
import { SyncEnvelope } from './SyncEnvelope';
import { ENTITY_REGISTRY } from './EntityRegistry';
import { meshSyncService, registerSyncCoreListener } from '../meshSyncService';

export class LocalHubAdapter implements SyncAdapter {
  readonly name = 'LocalHubAdapter';

  async broadcast(envelope: SyncEnvelope): Promise<BroadcastResult> {
    try {
      const isSent = meshSyncService.sendSyncEnvelope(envelope);
      if (!isSent) {
        return {
          success: false,
          packetId: envelope.packetId,
          error: 'Local Hub WebSocket not connected or failed to send',
        };
      }
      return {
        success: true,
        packetId: envelope.packetId,
      };
    } catch (err: any) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: err?.message || String(err),
      };
    }
  }

  onReceive(handler: (envelope: SyncEnvelope) => void): () => void {
    return registerSyncCoreListener((rawPacket: any) => {
      const envelope = this.packetToEnvelope(rawPacket);
      if (envelope) {
        handler(envelope);
      }
    });
  }

  async connect(): Promise<void> {
    meshSyncService.connectLocalHub();
  }

  async disconnect(): Promise<void> {
    meshSyncService.disconnect(true);
  }

  isConnected(): boolean {
    return meshSyncService.isLocalHubActive();
  }

  async requestCatchUp(sinceTimestamp: number): Promise<CatchUpResult> {
    const sinceIso = sinceTimestamp > 0 ? new Date(sinceTimestamp).toISOString() : undefined;
    await meshSyncService.requestCatchUpSync('ALL', sinceIso, false, false);
    return {
      envelopes: [],
      cutoffTimestamp: Date.now(),
    };
  }

  async drainOfflineQueue(): Promise<void> {
    await meshSyncService.drainOfflineQueue();
  }

  private packetToEnvelope(packet: any): SyncEnvelope | null {
    if (!packet || typeof packet !== 'object') {
      return null;
    }

    const rawType = packet.entityType || packet.entity || packet.type || packet.action;
    if (!rawType || typeof rawType !== 'string') {
      return null;
    }

    let entityType = rawType;
    if (!ENTITY_REGISTRY[entityType]) {
      const SUFFIXES = ['_SYNC', '_UPDATE', '_UPDATED', '_RECORD', '_CREATED', '_DELETED', '_CHANGED'];
      const stripped = SUFFIXES.reduce(
        (acc, s) => acc.toUpperCase().endsWith(s) ? acc.slice(0, -s.length) : acc,
        rawType
      );
      const candidateLower = stripped.toLowerCase();
      const rawLower = rawType.toLowerCase();
      if (ENTITY_REGISTRY[candidateLower]) {
        entityType = candidateLower;
      } else if (ENTITY_REGISTRY[rawLower]) {
        entityType = rawLower;
      } else {
        return null;
      }
    }

    const entitySpec = ENTITY_REGISTRY[entityType];
    if (!entitySpec) {
      return null;
    }

    const entityId =
      packet.entityId ||
      packet.itemId ||
      packet.id ||
      packet.invoice_id ||
      packet.sessionId ||
      (packet.payload && (packet.payload.id || packet.payload.itemId));

    if (entityId === undefined || entityId === null || entityId === '') {
      return null;
    }

    const data = packet.data || packet.payload || packet.item || packet.sale || packet;
    const updatedAt = this.parseTimestamp(packet.updatedAt || packet.timestamp || packet.lastUpdated);
    const hubTimestamp = this.parseOptionalTimestamp(packet.hubTimestamp || packet.hub_timestamp);
    const originDeviceId = String(packet.originDeviceId || packet.origin_device_id || '');
    const targetBranchId = String(packet.targetBranchId || packet.target_branch_id || packet.branchId || '');
    const packetId = String(
      packet.packetId ||
      packet.packet_id ||
      packet.id ||
      `${entityType}-${entityId}-${Date.now()}-${Math.random()}`
    );

    return {
      packetId,
      entityType,
      entityId: String(entityId),
      action: 'UPSERT',
      data,
      updatedAt,
      hubTimestamp,
      originDeviceId,
      targetBranchId,
      class: entitySpec.class,
    };
  }

  private parseTimestamp(val: any): number {
    if (val === undefined || val === null) return Date.now();
    if (typeof val === 'number') return isNaN(val) ? Date.now() : val;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
      const num = Number(val);
      if (!isNaN(num)) return num;
      const parsed = new Date(val).getTime();
      return isNaN(parsed) ? Date.now() : parsed;
    }
    return Date.now();
  }

  private parseOptionalTimestamp(val: any): number | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'number') return isNaN(val) ? undefined : val;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
      const num = Number(val);
      if (!isNaN(num)) return num;
      const parsed = new Date(val).getTime();
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }
}
