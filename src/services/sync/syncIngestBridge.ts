import { SyncEnvelope } from './SyncEnvelope';
import { BroadcastResult } from './SyncAdapter';

export interface BridgeTombstoneRecord {
  id?: string;
  entityType: string;
  entityId: string;
  isDeleted?: boolean;
  deletedAt: number;
  deletedAtIso?: string;
}

export type SyncCoreIngestBridgeFn = (
  envelope: SyncEnvelope,
  existingRecord?: any,
  onAcceptedPersist?: (envelope: SyncEnvelope) => void | Promise<void>
) => Promise<{ accepted: boolean; reason?: string }>;

export type SyncCoreSaveAndSyncBridgeFn = (
  envelope: SyncEnvelope
) => Promise<BroadcastResult>;

let _ingestHandler: SyncCoreIngestBridgeFn | null = null;
let _saveAndSyncHandler: SyncCoreSaveAndSyncBridgeFn | null = null;
let _appScriptsPausedChecker: (() => boolean) | null = null;
let _tombstoneLookupProvider: (() => BridgeTombstoneRecord[]) | null = null;

export const registerSyncCoreIngestBridge = (fn: SyncCoreIngestBridgeFn): void => {
  _ingestHandler = fn;
};

export const registerSyncCoreSaveAndSyncBridge = (fn: SyncCoreSaveAndSyncBridgeFn): void => {
  _saveAndSyncHandler = fn;
};

export const saveAndSyncThroughBridge = async (
  envelope: SyncEnvelope
): Promise<BroadcastResult | null> => {
  if (!_saveAndSyncHandler) return null;
  try {
    return await _saveAndSyncHandler(envelope);
  } catch (err: any) {
    return {
      success: false,
      packetId: envelope.packetId,
      error: err?.message || 'Sync deferred to offline queue',
    };
  }
};

export const registerTombstoneLookup = (fn: () => BridgeTombstoneRecord[]): void => {
  _tombstoneLookupProvider = fn;
};

export const getTombstonesFromBridge = (): BridgeTombstoneRecord[] => {
  if (_tombstoneLookupProvider) {
    try {
      const list = _tombstoneLookupProvider();
      if (Array.isArray(list)) return list;
    } catch {}
  }
  return [];
};

export const registerAppScriptsPausedChecker = (fn: () => boolean): void => {
  _appScriptsPausedChecker = fn;
};

export const isAppScriptsIngestPaused = (): boolean => {
  return _appScriptsPausedChecker ? _appScriptsPausedChecker() : false;
};

export const routeCloudRecordThroughSyncCore = async (
  envelope: SyncEnvelope,
  existingRecord: any,
  onAcceptedPersist: () => void | Promise<void>
): Promise<{ accepted: boolean; reason?: string }> => {
  if (isAppScriptsIngestPaused()) {
    return { accepted: false, reason: 'APPSCRIPTS_PAUSED' };
  }

  if (_ingestHandler) {
    return await _ingestHandler(envelope, existingRecord, async () => {
      await onAcceptedPersist();
    });
  }

  // Fallback before SyncCore is mounted (boot safety): still protect existing T2 user edits & tombstones
  if (envelope.class === 'T2') {
    const incomingTs = Number(envelope.hubTimestamp ?? envelope.updatedAt ?? 0);
    if (envelope.action !== 'DELETE') {
      const tomb = getTombstonesFromBridge().find(
        (t) => t.entityType === envelope.entityType && String(t.entityId) === String(envelope.entityId)
      );
      const tombDeletedAt = tomb ? Number(tomb.deletedAt || 0) : 0;
      if (tombDeletedAt > 0 && (incomingTs === 0 || tombDeletedAt >= incomingTs)) {
        return { accepted: false, reason: 'RESURRECTION_BLOCKED' };
      }
    }

    if (existingRecord) {
      const incomingVersion = Number(envelope.version ?? envelope.data?.version ?? 0);
      const existingVersion = Number(existingRecord.version || 0);
      const existingTs = Number(existingRecord.hubTimestamp ?? existingRecord.updatedAt ?? 0);
      const incomingSource = String(
        envelope.mutationSource || envelope.data?.mutationSource || (incomingTs === 0 && incomingVersion === 0 ? 'SEED' : '')
      ).toUpperCase();
      const existingSource = String(
        existingRecord.mutationSource || (existingVersion > 0 ? 'USER_EDIT' : '')
      ).toUpperCase();

      if (incomingSource === 'SEED' && (existingSource === 'USER_EDIT' || existingVersion > 0 || existingTs > 0)) {
        return { accepted: false, reason: 'STALE_T2_SEED_BLOCKED' };
      }
      if (incomingTs <= 0 && (existingTs > 0 || existingVersion > 0 || existingSource === 'USER_EDIT')) {
        return { accepted: false, reason: 'STALE_T2_BOOT_GUARD' };
      }
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

      if (!incomingHasNewerPin) {
        if (existingVersion > 0 && incomingVersion > 0) {
          if (incomingVersion < existingVersion) {
            return { accepted: false, reason: 'STALE_T2_BOOT_GUARD' };
          }
          if (incomingVersion === existingVersion && existingTs > 0 && incomingTs > 0 && existingTs - incomingTs > 60000) {
            return { accepted: false, reason: 'STALE_T2_BOOT_GUARD' };
          }
        } else if (existingVersion > 0 && incomingVersion === 0 && existingSource === 'USER_EDIT') {
          if (incomingTs <= existingTs + 60000) {
            return { accepted: false, reason: 'STALE_T2_BOOT_GUARD' };
          }
        } else if (existingTs > 0 && incomingTs > 0 && existingTs - incomingTs > 60000) {
          return { accepted: false, reason: 'STALE_T2_BOOT_GUARD' };
        }

        const isLocalDirty = Boolean(existingRecord.isDirty || existingRecord.dirty || existingRecord.synced === false);
        if (isLocalDirty && incomingVersion <= existingVersion && incomingTs <= existingTs + 60000) {
          return { accepted: false, reason: 'STALE_T2_DIRTY_LOCAL' };
        }
      }

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

  await onAcceptedPersist();
  return { accepted: true };
};
