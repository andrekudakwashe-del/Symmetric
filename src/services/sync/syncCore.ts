import { SyncEnvelope, SyncAction } from './SyncEnvelope';
import { ENTITY_REGISTRY, EntitySpec } from './EntityRegistry';
import { SyncAdapter, BroadcastResult } from './SyncAdapter';

export class SyncCore {
  private seenPacketIds: Set<string> = new Set<string>();

  constructor(private adapter: SyncAdapter, private deviceId: string) {}

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
      const canonical: SyncEnvelope<T> = {
        ...env,
        class: env.class || spec.class,
        originDeviceId: env.originDeviceId || this.deviceId,
        updatedAt: env.updatedAt || Date.now(),
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
    const recId = (record as any)?.id || (record as any)?.itemId || 'unknown';
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
    };

    this.markPacketSeen(packetId);
    return await this.adapter.broadcast(envelope);
  }

  /**
   * Lesson 4 (No Re-Broadcast), Lesson 5 (Hub is Clock), Lesson 6 (Class Rule),
   * Lesson 8 (IndexedDB First), Lesson 10 (Cross-Device UI Events).
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

    // Lesson 5 + 6 (Class-specific rule)
    if (spec.class === 'T2') {
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
    } else if (spec.class === 'T1') {
      if (existingRecord !== undefined && existingRecord !== null) {
        return { accepted: false, reason: 'DUPLICATE_T1' };
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
