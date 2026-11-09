import { SyncEnvelope, SyncAction } from './SyncEnvelope';
import { ENTITY_REGISTRY, EntitySpec } from './EntityRegistry';
import { SyncAdapter, BroadcastResult } from './SyncAdapter';

export class SyncCore {
  private seenPacketIds: Set<string> = new Set<string>();

  constructor(private adapter: SyncAdapter, private deviceId: string) {}

  getAdapter(): SyncAdapter {
    return this.adapter;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Lesson 1 (Save=Broadcast), Lesson 3 (Fresh Timestamp), Lesson 8 (IndexedDB First).
   * Note: Caller persists to IndexedDB before calling saveAndSync. This method broadcasts.
   */
  async saveAndSync<T>(entityType: string, record: T, branchId: string): Promise<BroadcastResult> {
    const spec = this.getSpec(entityType);
    const action: SyncAction = spec.appendOnly ? 'APPEND' : 'UPSERT';
    const recId = (record as any)?.id || (record as any)?.itemId || 'unknown';
    const packetId = `${entityType}-${recId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const envelope: SyncEnvelope<T> = {
      packetId,
      entityType,
      entityId: String(recId),
      action,
      data: record,
      updatedAt: Date.now(),
      originDeviceId: this.deviceId,
      targetBranchId: branchId,
      class: spec.class,
    };

    return await this.adapter.broadcast(envelope);
  }

  /**
   * Lesson 4 (No Re-Broadcast), Lesson 5 (Hub is Clock), Lesson 6 (Class Rule),
   * Lesson 8 (IndexedDB First), Lesson 10 (Cross-Device UI Events).
   */
  async ingest(
    envelope: SyncEnvelope,
    existingRecord?: any
  ): Promise<{ accepted: boolean; reason?: string }> {
    // Lesson 4 (No Re-Broadcast): reject packets from self
    if (envelope.originDeviceId === this.deviceId) {
      return { accepted: false, reason: 'SELF_ORIGIN' };
    }

    // Lesson 9 (Packet Coverage — dedupe): reject duplicates
    if (this.seenPacketIds.has(envelope.packetId)) {
      return { accepted: false, reason: 'DUPLICATE_PACKET' };
    }
    this.seenPacketIds.add(envelope.packetId);

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

        if (existingTs - incomingTs > 5000) {
          return { accepted: false, reason: 'STALE_T2' };
        }
      }
    } else if (spec.class === 'T1') {
      if (existingRecord !== undefined && existingRecord !== null) {
        return { accepted: false, reason: 'DUPLICATE_T1' };
      }
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
