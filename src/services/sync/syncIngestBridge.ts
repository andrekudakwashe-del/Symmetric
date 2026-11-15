import { SyncEnvelope } from './SyncEnvelope';

export type SyncCoreIngestBridgeFn = (
  envelope: SyncEnvelope,
  existingRecord?: any,
  onAcceptedPersist?: (envelope: SyncEnvelope) => void | Promise<void>
) => Promise<{ accepted: boolean; reason?: string }>;

let _ingestHandler: SyncCoreIngestBridgeFn | null = null;
let _appScriptsPausedChecker: (() => boolean) | null = null;

export const registerSyncCoreIngestBridge = (fn: SyncCoreIngestBridgeFn): void => {
  _ingestHandler = fn;
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
