import { SyncEnvelope, SyncAction } from './SyncEnvelope';
import { ENTITY_REGISTRY, EntitySpec } from './EntityRegistry';
import { SyncAdapter, BroadcastResult } from './SyncAdapter';
import { BridgeTombstoneRecord, getTombstonesFromBridge } from './syncIngestBridge';

const TOMBSTONE_STORAGE_KEY = 'saimetric_room_deleted_records';

export function normalizeTombstoneEntityType(rawType: string): string {
  const norm = String(rawType || '').trim().toLowerCase();
  switch (norm) {
    case 'inventory':
    case 'inventory_item':
    case 'inventory_items':
    case 'inventorymaster':
    case 'product':
    case 'products':
      return 'inventory_item';
    case 'customer':
    case 'customers':
      return 'customer';
    case 'staff':
    case 'salesperson':
    case 'salespeople':
    case 'user':
    case 'users':
      return 'staff';
    case 'supplier':
    case 'suppliers':
      return 'supplier';
    case 'branch':
    case 'branches':
      return 'branch';
    case 'category':
    case 'categories':
    case 'inventory_category':
    case 'inventory_categories':
      return 'inventory_category';
    case 'cash_account':
    case 'cash_accounts':
    case 'cashaccount':
    case 'cashaccounts':
      return 'cash_account';
    case 'credit_group':
    case 'credit_groups':
    case 'creditgroup':
    case 'creditgroups':
      return 'credit_group';
    case 'casual':
    case 'casual_worker':
    case 'casual_workers':
    case 'temporary_casual':
    case 'temporary_casuals':
      return 'casual_worker';
    case 'stocktake_session':
    case 'stocktake_sessions':
      return 'stocktake_session';
    case 'stocktake_segment':
    case 'stocktake_segments':
      return 'stocktake_segment';
    default:
      return norm;
  }
}

export class SyncCore {
  private seenPacketIds: Set<string> = new Set<string>();
  private tombstoneProvider: (() => BridgeTombstoneRecord[]) | null = null;

  constructor(private adapter: SyncAdapter, private deviceId: string) {}

  setTombstoneProvider(provider: () => BridgeTombstoneRecord[]): void {
    this.tombstoneProvider = provider;
  }

  private getLocalTombstones(): BridgeTombstoneRecord[] {
    if (this.tombstoneProvider) {
      try {
        const provided = this.tombstoneProvider();
        if (Array.isArray(provided)) return provided;
      } catch {}
    }

    const fromBridge = getTombstonesFromBridge();
    if (fromBridge.length > 0) return fromBridge;

    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(TOMBSTONE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  }

  private findTombstone(entityType: string, entityId: string): BridgeTombstoneRecord | undefined {
    const cleanUpperId = String(entityId || '').trim().toUpperCase();
    if (!cleanUpperId) return undefined;
    const normIncomingType = normalizeTombstoneEntityType(entityType);
    const tombstones = this.getLocalTombstones();
    let newestMatch: BridgeTombstoneRecord | undefined;
    let newestTs = -1;

    for (const t of tombstones) {
      if (!t || !t.entityId) continue;
      const tId = String(t.entityId).trim().toUpperCase();
      if (tId !== cleanUpperId) continue;
      const tNormType = normalizeTombstoneEntityType(t.entityType);
      if (tNormType && tNormType !== normIncomingType) continue;
      const tTs = this.parseTimestampMs(t.deletedAt ?? t.deletedAtIso);
      if (tTs >= newestTs) {
        newestTs = tTs;
        newestMatch = t;
      }
    }
    return newestMatch;
  }

  getAdapter(): SyncAdapter {
    return this.adapter;
  }

  setAdapter(adapter: SyncAdapter): void {
    this.adapter = adapter;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  setDeviceId(deviceId: string): void {
    this.deviceId = deviceId;
  }

  hasSeenPacket(packetId: string): boolean {
    return this.seenPacketIds.has(packetId);
  }

  markPacketSeen(packetId: string): void {
    if (!packetId) return;
    if (this.seenPacketIds.size > 10000) {
      const first = this.seenPacketIds.values().next().value;
      if (first) this.seenPacketIds.delete(first);
    }
    this.seenPacketIds.add(packetId);
  }

  /**
   * Lesson 1 (Save=Broadcast), Lesson 3 (Fresh Timestamp), Lesson 8 (IndexedDB First).
   * Supports either a pre-built canonical SyncEnvelope or (entityType, record, branchId).
   */
  async saveAndSync<T>(envelope: SyncEnvelope<T>): Promise<BroadcastResult>;
  async saveAndSync<T>(entityType: string, record: T, branchId: string): Promise<BroadcastResult>;
  async saveAndSync<T>(
    entityTypeOrEnvelope: string | SyncEnvelope<T>,
    record?: T,
    branchId?: string
  ): Promise<BroadcastResult> {
    if (typeof entityTypeOrEnvelope !== 'string') {
      const env = entityTypeOrEnvelope;
      const spec = this.getSpec(env.entityType);
      const envCloudSynced = Boolean(
        env.isCloudSynced === true || (env.data as any)?.isCloudSynced === true
      );
      const canonical: SyncEnvelope<T> = {
        ...env,
        class: env.class || spec.class,
        originDeviceId: env.originDeviceId || this.deviceId,
        updatedAt: env.updatedAt || Date.now(),
        ...(envCloudSynced ? { isCloudSynced: true } : {}),
        packetId:
          env.packetId ||
          `${env.entityType}-${env.entityId || 'unknown'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      };
      this.markPacketSeen(canonical.packetId);
      return await this.adapter.broadcast(canonical);
    }

    const entityType: string = entityTypeOrEnvelope;
    const spec = this.getSpec(entityType);
    const action: SyncAction = spec.appendOnly ? 'APPEND' : 'UPSERT';
    const recId =
      (record as any)?.transfer_id ||
      (record as any)?.account_id ||
      (record as any)?.id ||
      (record as any)?.itemId ||
      'unknown';
    const packetId = `${entityType}-${recId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const envelope: SyncEnvelope<T> = {
      packetId,
      entityType,
      entityId: String(recId),
      action,
      data: record as T,
      updatedAt: Date.now(),
      originDeviceId: this.deviceId,
      targetBranchId: branchId || 'ALL',
      class: spec.class,
      ...((record as any)?.isCloudSynced === true ? { isCloudSynced: true } : {}),
    };

    this.markPacketSeen(packetId);
    return await this.adapter.broadcast(envelope);
  }

  /**
   * Lesson 4 (No Re-Broadcast), Lesson 5 (Hub is Clock), Lesson 6 (Class Rule),
   * Lesson 8 (IndexedDB First), Lesson 10 (Cross-Device UI Events).
   * Part A: Universal Tombstone Resurrection Guard for all T2 records.
   */
  async ingest(
    envelope: SyncEnvelope,
    existingRecord?: any,
    onAcceptedPersist?: (envelope: SyncEnvelope) => void | Promise<void>
  ): Promise<{ accepted: boolean; reason?: string }> {
    // Lesson 4 (No Re-Broadcast): reject packets from self
    if (envelope.originDeviceId === this.deviceId) {
      return { accepted: false, reason: 'SELF_ORIGIN' };
    }

    // Lesson 9 (Packet Coverage — dedupe): reject duplicates
    if (this.seenPacketIds.has(envelope.packetId)) {
      return { accepted: false, reason: 'DUPLICATE_PACKET' };
    }
    this.markPacketSeen(envelope.packetId);

    // Entity registry lookup
    const spec = ENTITY_REGISTRY[envelope.entityType];
    if (!spec) {
      return { accepted: false, reason: 'UNKNOWN_ENTITY' };
    }

    // Lesson 5 + 6 (Class-specific rule + Universal Tombstone Resurrection Guard)
    if (spec.class === 'T2') {
      if (envelope.action !== 'DELETE') {
        const tombstone = this.findTombstone(envelope.entityType, envelope.entityId);
        if (tombstone) {
          const tombstoneDeletedAt = this.parseTimestampMs(
            tombstone.deletedAt ?? tombstone.deletedAtIso
          );
          const incomingTs = this.parseTimestampMs(
            envelope.hubTimestamp ?? envelope.updatedAt ?? envelope.data
          );
          if (tombstoneDeletedAt > 0 && tombstoneDeletedAt >= incomingTs) {
            console.warn(
              `[SyncCore Resurrection Guard] 🪦 Blocked resurrection of deleted ${envelope.entityType}:${envelope.entityId} ` +
                `(tombstone.deletedAt=${tombstoneDeletedAt} >= incoming.updatedAt=${incomingTs})`
            );
            return { accepted: false, reason: 'RESURRECTION_BLOCKED' };
          }
        }

        if (existingRecord !== undefined && existingRecord !== null) {
          const existingTs = this.parseTimestampMs(
            existingRecord.hubTimestamp ?? existingRecord.updatedAt ?? existingRecord
          );
          const incomingTs = this.parseTimestampMs(
            envelope.hubTimestamp ?? envelope.updatedAt
          );

          if (existingTs - incomingTs > 60000) {
            return { accepted: false, reason: 'STALE_T2' };
          }
        }
      }
    } else if (spec.class === 'T1') {
      if (existingRecord !== undefined && existingRecord !== null) {
        if (envelope.entityType === 'cash_transfer') {
          const rank = (s?: string): number => {
            const u = String(s || '').toUpperCase().trim();
            if (u === 'DRAFT') return 0;
            if (u === 'PENDING_APPROVAL' || u === 'PENDING_ACCEPTANCE') return 1;
            if (u === 'IN_TRANSIT') return 2;
            if (u === 'APPROVED') return 3;
            if (
              u === 'RECEIVED' ||
              u === 'COMPLETED' ||
              u === 'RETURNED' ||
              u === 'CANCELLED' ||
              u === 'REJECTED'
            ) {
              return 4;
            }
            return 0;
          };
          const prevRank = rank(existingRecord.status);
          const nextRank = rank(envelope.data?.status);
          const prevLogs = Array.isArray(existingRecord.linked_cash_log_ids)
            ? existingRecord.linked_cash_log_ids.length
            : 0;
          const nextLogs = Array.isArray(envelope.data?.linked_cash_log_ids)
            ? envelope.data.linked_cash_log_ids.length
            : 0;
          const sameRank = prevRank === nextRank;
          const hasAdvance = nextRank > prevRank || (sameRank && nextLogs > prevLogs);
          if (!hasAdvance) {
            return { accepted: false, reason: 'DUPLICATE_T1' };
          }
        } else {
          return { accepted: false, reason: 'DUPLICATE_T1' };
        }
      }
    }

    if (onAcceptedPersist) {
      await onAcceptedPersist(envelope);
    }

    // Lesson 10 (Cross-Device UI Events): dispatch UI event
    if (spec.uiEventName && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(spec.uiEventName));
    }

    return { accepted: true };
  }

  /**
   * Lesson 7 (Chunked Ingest): chunks into groups of 50 and yields thread.
   */
  async ingestBatch(envelopes: SyncEnvelope[]): Promise<void> {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < envelopes.length; i += CHUNK_SIZE) {
      const chunk = envelopes.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((e) => this.ingest(e)));
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /**
   * Helper to parse timestamps from numbers, strings, Dates, or record objects.
   */
  private parseTimestampMs(rec: any): number {
    if (rec === undefined || rec === null) {
      return 0;
    }
    if (typeof rec === 'number') {
      return isNaN(rec) ? 0 : rec;
    }
    if (rec instanceof Date) {
      return rec.getTime();
    }
    if (typeof rec === 'string') {
      const num = Number(rec);
      if (!isNaN(num)) return num;
      const parsed = new Date(rec).getTime();
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof rec === 'object') {
      const candidate =
        rec.updatedAt ??
        rec.lastUpdated ??
        rec.hubTimestamp ??
        rec.timestamp ??
        rec.createdAt;
      return this.parseTimestampMs(candidate);
    }
    return 0;
  }

  /**
   * Returns the EntitySpec for a given entity type. Used by adapters.
   */
  getSpec(entityType: string): EntitySpec {
    const spec = ENTITY_REGISTRY[entityType];
    if (!spec) throw new Error(`Unknown entity type: ${entityType}`);
    return spec;
  }
}
