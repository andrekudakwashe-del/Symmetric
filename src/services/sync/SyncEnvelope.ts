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
