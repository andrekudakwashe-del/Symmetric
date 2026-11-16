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

  // Fallback before SyncCore is mounted (boot safety): honor persistence directly
  await onAcceptedPersist();
  return { accepted: true };
};
