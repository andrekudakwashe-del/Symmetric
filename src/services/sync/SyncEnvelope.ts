export type EntityClass = 'T1' | 'T2' | 'T3' | 'T4';
export type SyncAction = 'UPSERT' | 'DELETE' | 'APPEND';

export interface SyncEnvelope<T = any> {
  packetId: string;             // unique, dedupe key: `${entityType}-${entityId}-${Date.now()}-${random}`
  entityType: string;           // key into EntityRegistry
  entityId: string;
  action: SyncAction;
  data: T;
  updatedAt: number;            // authoring timestamp (client clock, ms)
  hubTimestamp?: number;        // authority timestamp (server/Hub clock, ms)
  originDeviceId: string;
  targetBranchId: string;
  class: EntityClass;           // determines LWW vs append-only
}

export type ReconPacketType =
  | 'RECON_SWEEP_TRIGGER'
  | 'SYNC_SNAPSHOT_REQUEST'
  | 'SYNC_SNAPSHOT_RESPONSE'
  | 'SYNC_ID_DIGEST_REQUEST'
  | 'SYNC_ID_DIGEST_RESPONSE'
  | 'RECON_BACKFILL_PAYLOAD'
  | 'RECON_PUSH_BACKFILL_REQUEST'
  | 'HUB_CLOUD_BROADCAST';

export interface EntitySnapshot {
  entityType: string;
  startDate?: string;
  endDate?: string;
  count: number;
  totalSum: number;
  idHash: string;
  generatedAt: number;
}

export interface SyncSnapshotRequestPacket {
  type: 'SYNC_SNAPSHOT_REQUEST';
  sweepId: string;
  entityType: string;
  startDate?: string;
  endDate?: string;
  hubTimestamp: number;
  originDeviceId: string;
}

export interface SyncSnapshotResponsePacket {
  type: 'SYNC_SNAPSHOT_RESPONSE';
  sweepId: string;
  entityType: string;
  snapshot: EntitySnapshot;
  deviceId: string;
  timestamp: number;
}

export interface TransactionDigestItem {
  id: string;
  total?: number;
  status?: string;
  timestamp?: number;
  updatedAt?: number;
}

export interface TransactionsDigestResult {
  entityType: string;
  startDate?: string;
  endDate?: string;
  items: TransactionDigestItem[];
  count: number;
  totalSum: number;
  generatedAt: number;
}

export interface ReconSweepTriggerPacket {
  type: 'RECON_SWEEP_TRIGGER';
  sweepId: string;
  targetEntities: string[];
  dateRange?: { start?: string; end?: string };
  hubTimestamp: number;
  originDeviceId: string;
}

export interface SyncIdDigestRequestPacket {
  type: 'SYNC_ID_DIGEST_REQUEST';
  sweepId: string;
  entityType: string;
  startDate?: string;
  endDate?: string;
  hubTimestamp: number;
  originDeviceId: string;
}

export interface SyncIdDigestResponsePacket {
  type: 'SYNC_ID_DIGEST_RESPONSE';
  sweepId: string;
  entityType: string;
  digest: TransactionsDigestResult;
  deviceId: string;
  timestamp: number;
}

export interface ReconBackfillPayloadPacket {
  type: 'RECON_BACKFILL_PAYLOAD';
  sweepId: string;
  entityType: string;
  records: any[];
  chunkIndex: number;
  totalChunks: number;
  hubTimestamp: number;
  originDeviceId: string;
}

export interface ReconPushBackfillRequestPacket {
  type: 'RECON_PUSH_BACKFILL_REQUEST';
  sweepId?: string;
  entityType: string;
  missingIds: string[];
  hubTimestamp?: number;
  originDeviceId?: string;
}

