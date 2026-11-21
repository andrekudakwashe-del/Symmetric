import { SyncEnvelope, SyncAction } from './SyncEnvelope';
import { ENTITY_REGISTRY, EntitySpec } from './EntityRegistry';
import { SyncAdapter, BroadcastResult } from './SyncAdapter';
import { BridgeTombstoneRecord, getTombstonesFromBridge } from './syncIngestBridge';

export interface IngestOptions {
  /** LWW clock-skew tolerance in ms (default: 60000ms for live mesh; 5000ms for WhatsApp file imports) */
  lwwToleranceMs?: number;
  /** Allow ingesting envelopes that originated from this same device (e.g. disaster recovery restore) */
  allowSelfOrigin?: boolean;
  /** True when envelopes come from an offline WhatsApp/JSON file import */
  isFileImport?: boolean;
}

export interface BatchIngestOptions extends IngestOptions {
  /** Look up the current local record for T1 dedupe & T2 LWW comparison */
  lookupExisting?: (envelope: SyncEnvelope) => any | Promise<any>;
  /** Persist an accepted envelope to local storage / RoomDB */
  onAcceptedPersist?: (envelope: SyncEnvelope, existingRecord?: any) => void | Promise<void>;
  /** Chunk progress callback */
  onProgress?: (progress: {
    processed: number;
    total: number;
    accepted: number;
    rejected: number;
    currentEntityType?: string;
  }) => void;
}

export interface BatchIngestResult {
  processed: number;
  accepted: number;
  rejected: number;
  t1Accepted: number;
  t1Deduped: number;
  t2Accepted: number;
  t2StaleRejected: number;
  resurrectionBlocked: number;
  selfOriginSkipped: number;
  reasons: Record<string, number>;
}

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
        updatedAt: env.updatedAt !== undefined ? env.updatedAt : Date.now(),
        ...(env.version !== undefined
          ? { version: env.version }
          : (env.data as any)?.version !== undefined
          ? { version: Number((env.data as any).version) }
          : {}),
        ...(env.mutationSource || (env.data as any)?.mutationSource
          ? { mutationSource: env.mutationSource || (env.data as any).mutationSource }
          : {}),
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
    const recVersion = (record as any)?.version !== undefined ? Number((record as any).version) : undefined;
    const recMutationSource = (record as any)?.mutationSource;

    const envelope: SyncEnvelope<T> = {
      packetId,
      entityType,
      entityId: String(recId),
      action,
      data: record as T,
      updatedAt: (record as any)?.updatedAt || Date.now(),
      ...(recVersion !== undefined && !isNaN(recVersion) ? { version: recVersion } : {}),
      ...(recMutationSource ? { mutationSource: recMutationSource } : {}),
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
   * Part A: Universal Tombstone Resurrection Guard + Version/Seed/Dirty-Local Guard for all T2 records.
   */
  async ingest(
    envelope: SyncEnvelope,
    existingRecord?: any,
    onAcceptedPersist?: (envelope: SyncEnvelope, existingRecord?: any) => void | Promise<void>,
    options?: IngestOptions
  ): Promise<{ accepted: boolean; reason?: string }> {
    const lwwToleranceMs = options?.lwwToleranceMs ?? 60000;

    // Lesson 4 (No Re-Broadcast): reject packets from self unless explicitly allowed (e.g. fresh-device file restore)
    if (!options?.allowSelfOrigin && envelope.originDeviceId === this.deviceId) {
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
          // Seed/untimestamped rows (incomingTs === 0) must NEVER resurrect tombstoned records
          if (tombstoneDeletedAt > 0 && (incomingTs === 0 || tombstoneDeletedAt >= incomingTs)) {
            console.warn(
              `[SyncCore Resurrection Guard] 🪦 Blocked resurrection of deleted ${envelope.entityType}:${envelope.entityId} ` +
                `(tombstone.deletedAt=${tombstoneDeletedAt} >= incoming.updatedAt=${incomingTs})`
            );
            return { accepted: false, reason: 'RESURRECTION_BLOCKED' };
          }
        }

        if (existingRecord !== undefined && existingRecord !== null) {
          const existingTs = this.parseTimestampMs(
            existingRecord.hubTimestamp ?? existingRecord.updatedAt ?? existingRecord.lastUpdated ?? existingRecord
          );
          const incomingTs = this.parseTimestampMs(
            envelope.hubTimestamp ?? envelope.updatedAt ?? envelope.data
          );

          const existingVersion = Number(existingRecord.version || 0);
          const incomingVersion = Number(envelope.version ?? envelope.data?.version ?? 0);
          const existingSource = String(
            existingRecord.mutationSource || (existingVersion > 0 ? 'USER_EDIT' : '')
          ).toUpperCase();
          const incomingSource = String(
            envelope.mutationSource || envelope.data?.mutationSource || (incomingTs === 0 && incomingVersion === 0 ? 'SEED' : '')
          ).toUpperCase();

          // 1. Seed / Initial data must NEVER overwrite an existing user edit or timestamped local record
          if (incomingSource === 'SEED' && (existingSource === 'USER_EDIT' || existingVersion > 0 || existingTs > 0)) {
            return { accepted: false, reason: 'STALE_T2_SEED_BLOCKED' };
          }

          // 2. Untimestamped remote record (incomingTs === 0) must NEVER overwrite an existing timestamped/edited local record
          if (incomingTs <= 0 && (existingTs > 0 || existingVersion > 0 || existingSource === 'USER_EDIT')) {
            return { accepted: false, reason: 'STALE_T2' };
          }

          // 2b. Staff monotonic pinVersion guard: never revert a newer offline PIN/password with an older remote one
          const isStaffRecord = envelope.entityType === 'staff';
          const existingPinVer = isStaffRecord ? Number(existingRecord.pinVersion ?? existingRecord.pin_version ?? 0) : 0;
          const incomingPinVer = isStaffRecord ? Number(envelope.data?.pinVersion ?? envelope.data?.pin_version ?? 0) : 0;
          const incomingHasNewerPin =
            isStaffRecord &&
            Boolean(envelope.data?.pin_hash || envelope.data?.pinHash) &&
            incomingPinVer > existingPinVer;
          const localHasNewerPin =
            isStaffRecord &&
            Boolean(existingRecord.pin_hash || existingRecord.pinHash || existingRecord.pin) &&
            existingPinVer > 0 &&
            (incomingPinVer === 0 || existingPinVer > incomingPinVer);

          // 3. Monotonic logical version comparison & LWW timestamp check (default 60000ms live; 5000ms file imports)
          if (!incomingHasNewerPin) {
            if (existingVersion > 0 && incomingVersion > 0) {
              if (incomingVersion < existingVersion) {
                return { accepted: false, reason: 'STALE_T2' };
              }
              if (
                incomingVersion === existingVersion &&
                existingTs > 0 &&
                incomingTs > 0 &&
                existingTs - incomingTs > lwwToleranceMs
              ) {
                return { accepted: false, reason: 'STALE_T2' };
              }
            } else if (existingVersion > 0 && incomingVersion === 0 && existingSource === 'USER_EDIT') {
              // An unversioned cloud/legacy row cannot blindly overwrite a versioned USER_EDIT unless strictly newer
              if (incomingTs <= existingTs + lwwToleranceMs) {
                return { accepted: false, reason: 'STALE_T2' };
              }
            } else if (existingTs > 0 && incomingTs > 0 && existingTs - incomingTs > lwwToleranceMs) {
              return { accepted: false, reason: 'STALE_T2' };
            } else if (options?.isFileImport && existingTs > 0 && incomingTs > 0 && existingTs - incomingTs > 5000) {
              return { accepted: false, reason: 'STALE_T2' };
            }
          }

          // 4. Dirty local edit protection against cloud/bootstrap pulls that haven't strictly beaten local state
          const isCloudPull =
            envelope.originDeviceId === 'APPS_SCRIPT_CLOUD' ||
            envelope.originDeviceId === 'SUPABASE_CLOUD' ||
            envelope.originDeviceId === 'MONGODB_CLOUD' ||
            envelope.originDeviceId === 'SERVER_BOOTSTRAP';
          const isLocalDirty = Boolean(existingRecord.isDirty || existingRecord.dirty || existingRecord.synced === false);
          if (isCloudPull && isLocalDirty && !incomingHasNewerPin) {
            const strictlyNewerVersion = incomingVersion > existingVersion && incomingVersion > 0;
            const strictlyNewerTs = incomingVersion === existingVersion && incomingTs > existingTs + lwwToleranceMs;
            if (!strictlyNewerVersion && !strictlyNewerTs) {
              return { accepted: false, reason: 'STALE_T2_DIRTY_LOCAL' };
            }
          }

          // If remote non-PIN fields are newer but local PIN is strictly newer, preserve local PIN fields on the merged payload
          if (localHasNewerPin && envelope.data && typeof envelope.data === 'object') {
            if (existingRecord.pin !== undefined) (envelope.data as any).pin = existingRecord.pin;
            if (existingRecord.pin_hash || existingRecord.pinHash) {
              (envelope.data as any).pin_hash = existingRecord.pin_hash || existingRecord.pinHash;
            }
            if (existingRecord.pin_salt || existingRecord.pinSalt) {
              (envelope.data as any).pin_salt = existingRecord.pin_salt || existingRecord.pinSalt;
            }
            (envelope.data as any).pinVersion = existingPinVer;
            if (existingRecord.pinUpdatedAt) {
              (envelope.data as any).pinUpdatedAt = existingRecord.pinUpdatedAt;
            }
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
      await onAcceptedPersist(envelope, existingRecord);
    }

    // Lesson 10 (Cross-Device UI Events): dispatch UI event
    if (spec.uiEventName && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(spec.uiEventName));
    }

    return { accepted: true };
  }

  /**
   * Lesson 7 (Chunked Ingest): chunks into groups of 50 and yields thread.
   * Supports full lookupExisting + onAcceptedPersist + configurable LWW tolerance (e.g. 5000ms for WhatsApp file import).
   */
  async ingestBatch(
    envelopes: SyncEnvelope[],
    options?: BatchIngestOptions
  ): Promise<BatchIngestResult> {
    const CHUNK_SIZE = 50;
    const result: BatchIngestResult = {
      processed: 0,
      accepted: 0,
      rejected: 0,
      t1Accepted: 0,
      t1Deduped: 0,
      t2Accepted: 0,
      t2StaleRejected: 0,
      resurrectionBlocked: 0,
      selfOriginSkipped: 0,
      reasons: {},
    };

    const ingestOpts: IngestOptions | undefined = options
      ? {
          lwwToleranceMs: options.lwwToleranceMs,
          allowSelfOrigin: options.allowSelfOrigin,
          isFileImport: options.isFileImport,
        }
      : undefined;

    for (let i = 0; i < envelopes.length; i += CHUNK_SIZE) {
      const chunk = envelopes.slice(i, i + CHUNK_SIZE);
      // Sequential within chunk when persisting to avoid race conditions on shared localStorage arrays
      for (const e of chunk) {
        const spec = ENTITY_REGISTRY[e.entityType];
        const existing = options?.lookupExisting ? await options.lookupExisting(e) : undefined;
        const outcome = await this.ingest(
          e,
          existing,
          options?.onAcceptedPersist,
          ingestOpts
        );
        result.processed++;
        if (outcome.accepted) {
          result.accepted++;
          if (spec?.class === 'T1') result.t1Accepted++;
          else if (spec?.class === 'T2') result.t2Accepted++;
        } else {
          result.rejected++;
          const reason = outcome.reason || 'REJECTED';
          result.reasons[reason] = (result.reasons[reason] || 0) + 1;
          if (reason === 'DUPLICATE_T1' || reason === 'DUPLICATE_PACKET') result.t1Deduped++;
          else if (reason === 'STALE_T2' || reason === 'STALE_T2_SEED_BLOCKED' || reason === 'STALE_T2_DIRTY_LOCAL') result.t2StaleRejected++;
          else if (reason === 'RESURRECTION_BLOCKED') result.resurrectionBlocked++;
          else if (reason === 'SELF_ORIGIN') result.selfOriginSkipped++;
        }
      }

      if (options?.onProgress) {
        options.onProgress({
          processed: result.processed,
          total: envelopes.length,
          accepted: result.accepted,
          rejected: result.rejected,
          currentEntityType: chunk[chunk.length - 1]?.entityType,
        });
      }

      await new Promise((r) => setTimeout(r, 10));
    }

    return result;
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
