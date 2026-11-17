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
  return await _saveAndSyncHandler(envelope);
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
  }

  await onAcceptedPersist();
  return { accepted: true };
};
