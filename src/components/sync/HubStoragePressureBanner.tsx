import React, { useEffect, useState } from 'react';
import { HardDrive, AlertTriangle, CloudUpload, Archive, X } from 'lucide-react';
import { meshSyncService } from '../../services/meshSyncService';
import type { HubStorageSnapshot } from '../../services/mesh/hubStorageService';
import { Salesperson } from '../../types';

interface HubStoragePressureBannerProps {
  currentUser: Salesperson | null;
  isSuperAdmin?: boolean;
  onOpenArchiveManager: () => void;
  onTriggerCloudSync?: () => void;
}

const ADMIN_MANAGER_ROLES = new Set([
  'OWNER',
  'ADMIN',
  'ADMINISTRATOR',
  'MANAGER',
  'BRANCH_MANAGER',
  'GENERAL_MANAGER',
  'SUPERVISOR',
  'SUPER_ADMIN',
  'SUPERADMIN',
  'ACCOUNTANT',
  'AUDITOR',
]);

function isAdminOrManager(user: Salesperson | null, isSuperAdmin?: boolean): boolean {
  if (isSuperAdmin) return true;
  if (!user) return false;
  const role = String(user.role || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return ADMIN_MANAGER_ROLES.has(role);
}

export const HubStoragePressureBanner: React.FC<HubStoragePressureBannerProps> = ({
  currentUser,
  isSuperAdmin,
  onOpenArchiveManager,
  onTriggerCloudSync,
}) => {
  const [snapshot, setSnapshot] = useState<HubStorageSnapshot>(() =>
    meshSyncService.getHubStorageSnapshot()
  );

  useEffect(() => {
    return meshSyncService.subscribeHubStorage((next) => {
      setSnapshot(next);
    });
  }, []);

  if (!isAdminOrManager(currentUser, isSuperAdmin)) return null;
  if (snapshot.bannerStage === 'NORMAL' || snapshot.isBannerDismissed) return null;

  const stage = snapshot.bannerStage;
  const cap = snapshot.storageCapacity;
  const alert = snapshot.lastPressureAlert;
  const usagePct = Math.round(alert?.usagePct ?? cap?.usagePct ?? 0);
  const totalRecords = alert?.totalRecords ?? cap?.totalRecords ?? 0;
  const softLimit = alert?.softRecordLimit ?? cap?.softRecordLimit ?? 0;
  const unsyncedT1 = alert?.unsyncedT1Count ?? cap?.unsyncedT1Count ?? 0;
  const hubId = alert?.hubId || cap?.hubId || 'Local Hub';

  const isCritical = stage === 'CRITICAL_STORAGE';
  const isArchiveRecommended = stage === 'ARCHIVE_RECOMMENDED_90';
  const isWarning75 = stage === 'WARNING_75';

  const containerStyle = isCritical
    ? 'bg-rose-950/95 border-rose-500/60 text-rose-50'
    : isArchiveRecommended
    ? 'bg-orange-950/95 border-orange-500/60 text-orange-50'
    : 'bg-amber-950/95 border-amber-500/55 text-amber-50';

  const iconBgStyle = isCritical
    ? 'bg-rose-500/20 border-rose-400/40 text-rose-300'
    : isArchiveRecommended
    ? 'bg-orange-500/20 border-orange-400/40 text-orange-300'
    : 'bg-amber-500/20 border-amber-400/40 text-amber-300';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-3 right-3 sm:left-4 sm:right-auto sm:max-w-lg z-40 rounded-2xl border shadow-2xl p-3.5 backdrop-blur-md ${containerStyle}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${iconBgStyle}`}
        >
          {isWarning75 ? (
            <HardDrive className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black tracking-wide">
              {isCritical
                ? `Local Hub Critical Storage (${usagePct}%) — Export Offline Archive Now`
                : isArchiveRecommended
                ? `Local Hub Storage High (${usagePct}%) — Offline Archive Recommended`
                : `Local Hub Storage Warning (${usagePct}%) — Sync to Cloud`}
            </p>
          </div>

          <p className="text-[11px] opacity-90 leading-relaxed">
            {isWarning75 ? (
              <>
                Hub <span className="font-mono font-bold">{hubId}</span> holds{' '}
                <span className="font-mono font-bold">
                  {totalRecords.toLocaleString()}
                  {softLimit > 0 ? ` / ${softLimit.toLocaleString()}` : ''}
                </span>{' '}
                records with{' '}
                <span className="font-mono font-bold">{unsyncedT1.toLocaleString()}</span> unsynced
                T1 transactions. Connect to Cloud to sync and free WAL headroom.
              </>
            ) : (
              <>
                Hub <span className="font-mono font-bold">{hubId}</span> is at{' '}
                <span className="font-mono font-bold">{usagePct}%</span> capacity (
                <span className="font-mono font-bold">
                  {totalRecords.toLocaleString()}
                  {softLimit > 0 ? ` / ${softLimit.toLocaleString()}` : ''}
                </span>{' '}
                records, <span className="font-mono font-bold">{unsyncedT1.toLocaleString()}</span>{' '}
                unsynced T1). Export an encrypted{' '}
                <span className="font-mono font-bold">.saimpack</span> offline archive here or open
                the Hub APK Archive Manager so POS terminals keep trading cleanly offline.
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isWarning75 && onTriggerCloudSync && (
              <button
                type="button"
                onClick={onTriggerCloudSync}
                className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition flex items-center gap-1.5 cursor-pointer"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                <span>Sync to Cloud</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenArchiveManager}
              className={`text-[11px] font-black px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer ${
                isWarning75
                  ? 'bg-slate-900/80 hover:bg-slate-800 text-amber-100 border border-amber-400/35'
                  : isCritical
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-orange-500 hover:bg-orange-400 text-slate-950'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>
                {isWarning75 ? 'Hub Storage & Archives' : 'Export Offline Archive (.saimpack)'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => meshSyncService.dismissHubStorageAlert()}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-black/25 hover:bg-black/40 text-white/80 transition cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => meshSyncService.dismissHubStorageAlert()}
          className="text-white/60 hover:text-white p-1 rounded-lg transition cursor-pointer"
          aria-label="Dismiss hub storage alert"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
