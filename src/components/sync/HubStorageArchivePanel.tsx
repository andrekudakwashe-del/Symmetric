import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  HardDrive,
  RefreshCw,
  Archive,
  Download,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileArchive,
  Eye,
  EyeOff,
  Clock,
  Layers,
  CloudUpload,
} from 'lucide-react';
import { meshSyncService } from '../../services/meshSyncService';
import type {
  HubArchiveCreateResult,
  HubArchiveDownloadProgress,
  HubArchiveDownloadResult,
  HubArchiveEvictionReceipt,
  HubArchivePackSummary,
  HubStorageSnapshot,
} from '../../services/mesh/hubStorageService';
import { getCurrentCompany, getSessionUser } from '../../db/roomDatabase';
import { getTenantAuthToken } from '../../services/sync/highWaterMarks';

function formatBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateRange(fromTs?: number, toTs?: number): string {
  const fmt = (ts?: number) => {
    if (!ts || !Number.isFinite(ts)) return '—';
    try {
      return new Date(ts).toLocaleDateString();
    } catch {
      return '—';
    }
  };
  if (!fromTs && !toTs) return 'All archived dates';
  return `${fmt(fromTs)} → ${fmt(toTs)}`;
}

interface ParsedEnvelopePreview {
  rawEnvelope: Record<string, any>;
  fileName: string;
  fileSizeBytes: number;
  packId: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  hubId: string;
  recordCount: number;
  t1Only: boolean;
  encrypted: boolean;
  kdf: string;
  fromTs?: number;
  toTs?: number;
  createdAt?: number;
  entityCounts: Record<string, number>;
}

interface CloudIngestReceiptItem {
  packId: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  hubId: string;
  ingestedAt: number;
  ingestedBy: string;
  ingestedCount: number;
  skippedDuplicateCount: number;
  skippedT2Count: number;
  blockedT2Types?: string[];
  entityCounts?: Record<string, number>;
}

interface CloudIngestResponse {
  ok: boolean;
  alreadyIngested?: boolean;
  bypassClockDriftApplied?: boolean;
  packId?: string;
  tenantId?: string;
  branchId?: string;
  branchName?: string;
  ingestedCount?: number;
  previouslyIngestedCount?: number;
  skippedDuplicateCount?: number;
  skippedT2Count?: number;
  skippedInvalidCount?: number;
  blockedT2Types?: string[];
  entityCounts?: Record<string, number>;
  message?: string;
  error?: string;
  code?: string;
}

const HubStorageArchivePanel: React.FC = () => {
  const [storageSnap, setStorageSnap] = useState<HubStorageSnapshot>(() =>
    meshSyncService.getHubStorageSnapshot()
  );
  const [hubSecurity, setHubSecurity] = useState(() => meshSyncService.getHubSecurityStatus());

  // Hub RPC states
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isLoadingPacks, setIsLoadingPacks] = useState(false);
  const [packs, setPacks] = useState<HubArchivePackSummary[]>([]);
  const [evictionReceipts, setEvictionReceipts] = useState<HubArchiveEvictionReceipt[]>([]);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [rpcNotice, setRpcNotice] = useState<string | null>(null);

  // Create archive pack form
  const [preserveRecentDays, setPreserveRecentDays] = useState<number>(7);
  const [includeSynced, setIncludeSynced] = useState<boolean>(true);
  const [createPassphrase, setCreatePassphrase] = useState<string>('');
  const [showCreatePass, setShowCreatePass] = useState<boolean>(false);
  const [isCreatingPack, setIsCreatingPack] = useState<boolean>(false);
  const [lastCreatedPack, setLastCreatedPack] = useState<HubArchiveCreateResult | null>(null);

  // Chunked download & post-download eviction lock state
  const [downloadingPackId, setDownloadingPackId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<HubArchiveDownloadProgress | null>(null);
  const [verifiedDownloads, setVerifiedDownloads] = useState<
    Record<string, { payloadSha256: string; fileName: string; downloadedAt: number }>
  >({});
  const [evictCandidatePackId, setEvictCandidatePackId] = useState<string | null>(null);
  const [evictSafetyChecked, setEvictSafetyChecked] = useState<boolean>(false);
  const [isEvicting, setIsEvicting] = useState<boolean>(false);

  // Cloud delayed `.saimpack` importer states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedArchive, setSelectedArchive] = useState<ParsedEnvelopePreview | null>(null);
  const [fileParseError, setFileParseError] = useState<string | null>(null);
  const [importPassphrase, setImportPassphrase] = useState<string>('');
  const [showImportPass, setShowImportPass] = useState<boolean>(false);
  const [isIngestingToCloud, setIsIngestingToCloud] = useState<boolean>(false);
  const [cloudIngestResult, setCloudIngestResult] = useState<CloudIngestResponse | null>(null);
  const [cloudReceipts, setCloudReceipts] = useState<CloudIngestReceiptItem[]>([]);
  const [isLoadingCloudReceipts, setIsLoadingCloudReceipts] = useState<boolean>(false);

  const activeCompany = getCurrentCompany();
  const activeUser = getSessionUser();
  const activeCompanyId = String(activeCompany?.company_id || 'COMP-001').trim().toUpperCase();
  const isMutuallyAuthenticated = hubSecurity.isMutuallyAuthenticated;

  useEffect(() => {
    const unsubStorage = meshSyncService.subscribeHubStorage((snap) => setStorageSnap(snap));
    const onSecurityUpdate = () => setHubSecurity(meshSyncService.getHubSecurityStatus());
    window.addEventListener('saimetric_hub_security_updated', onSecurityUpdate);
    return () => {
      unsubStorage();
      window.removeEventListener('saimetric_hub_security_updated', onSecurityUpdate);
    };
  }, []);

  const refreshHubStatusAndPacks = useCallback(async () => {
    if (!meshSyncService.getHubSecurityStatus().isMutuallyAuthenticated) return;
    setRpcError(null);
    setIsLoadingStatus(true);
    setIsLoadingPacks(true);
    try {
      const [statusRes, listRes] = await Promise.allSettled([
        meshSyncService.queryHubStorageStatus(),
        meshSyncService.listHubArchivePacks(),
      ]);
      if (listRes.status === 'fulfilled') {
        setPacks(listRes.value.packs);
        setEvictionReceipts(listRes.value.evictionReceipts);
      } else {
        setRpcError(listRes.reason?.message || 'Could not list archive packs from Hub.');
      }
      if (statusRes.status === 'rejected' && listRes.status === 'fulfilled') {
        setRpcError(statusRes.reason?.message || 'Could not query Hub storage status.');
      }
    } finally {
      setIsLoadingStatus(false);
      setIsLoadingPacks(false);
    }
  }, []);

  const fetchCloudReceipts = useCallback(async () => {
    const token = getTenantAuthToken(activeCompanyId);
    if (!token) return;
    setIsLoadingCloudReceipts(true);
    try {
      const res = await fetch(
        `/api/archive-pack/receipts?tenantId=${encodeURIComponent(activeCompanyId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'x-company-id': activeCompanyId,
            ...(activeUser?.id ? { 'x-user-id': String(activeUser.id) } : {}),
            ...(activeUser?.email ? { 'x-user-email': String(activeUser.email) } : {}),
          },
        }
      );
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.ok && Array.isArray(json.receipts)) {
          setCloudReceipts(json.receipts);
        }
      }
    } catch {
      // Offline or unreachable cloud server — keep UI non-blocking
    } finally {
      setIsLoadingCloudReceipts(false);
    }
  }, [activeCompanyId, activeUser?.email, activeUser?.id]);

  useEffect(() => {
    if (isMutuallyAuthenticated) {
      void refreshHubStatusAndPacks();
    }
  }, [isMutuallyAuthenticated, refreshHubStatusAndPacks]);

  useEffect(() => {
    void fetchCloudReceipts();
  }, [fetchCloudReceipts]);

  const handleCreateArchivePack = async (e: React.FormEvent) => {
    e.preventDefault();
    setRpcError(null);
    setRpcNotice(null);
    setIsCreatingPack(true);
    try {
      const created = await meshSyncService.createHubArchivePack({
        preserveRecentDays,
        includeSynced,
        passphrase: createPassphrase.trim() || undefined,
      });
      setLastCreatedPack(created);
      setRpcNotice(
        `Created ${created.fileName} (${created.recordCount.toLocaleString()} T1 records, ${formatBytes(
          created.compressedBytes
        )}). Download and verify the file before evicting.`
      );
      setCreatePassphrase('');
      await refreshHubStatusAndPacks();
    } catch (err: any) {
      setRpcError(err?.message || 'Failed to create archive pack on Local Hub.');
    } finally {
      setIsCreatingPack(false);
    }
  };

  const handleDownloadPack = async (pack: HubArchivePackSummary) => {
    setRpcError(null);
    setRpcNotice(null);
    setDownloadingPackId(pack.packId);
    setDownloadProgress({
      packId: pack.packId,
      receivedChunks: 0,
      totalChunks: 1,
      receivedBytes: 0,
      percent: 0,
    });

    try {
      const result: HubArchiveDownloadResult = await meshSyncService.downloadHubArchivePack(
        pack.packId,
        {
          autoSaveToBrowser: true,
          onProgress: (prog) => setDownloadProgress(prog),
        }
      );
      setVerifiedDownloads((prev) => ({
        ...prev,
        [result.packId]: {
          payloadSha256: result.payloadSha256,
          fileName: result.fileName,
          downloadedAt: Date.now(),
        },
      }));
      setRpcNotice(
        `Verified & downloaded ${result.fileName} (${formatBytes(
          result.bytes
        )}, ${result.totalChunks} chunks, SHA-256 verified). Confirm it is saved on your device/USB before evicting Hub records.`
      );
    } catch (err: any) {
      setRpcError(err?.message || `Download failed for ${pack.packId}.`);
    } finally {
      setDownloadingPackId(null);
      setDownloadProgress(null);
    }
  };

  const handleConfirmEvict = async (packId: string) => {
    const dlRecord = verifiedDownloads[packId];
    if (!dlRecord || !evictSafetyChecked) return;
    setRpcError(null);
    setRpcNotice(null);
    setIsEvicting(true);
    try {
      const ack = await meshSyncService.confirmHubArchiveEvict(packId, dlRecord.payloadSha256);
      setRpcNotice(
        `Evicted ${ack.removedCount.toLocaleString()} archived records for ${ack.packId}. Hub WAL storage status updated.`
      );
      setEvictCandidatePackId(null);
      setEvictSafetyChecked(false);
      await refreshHubStatusAndPacks();
    } catch (err: any) {
      setRpcError(err?.message || `Eviction failed for ${packId}.`);
    } finally {
      setIsEvicting(false);
    }
  };

  const handleArchiveFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileParseError(null);
    setCloudIngestResult(null);
    setSelectedArchive(null);

    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 24 * 1024 * 1024) {
      setFileParseError('Selected file exceeds the 24 MB upload limit.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || parsed.format !== 'SAIMETRIC_ARCHIVE_PACK_V1') {
        setFileParseError('Invalid file format. Expected SAIMETRIC_ARCHIVE_PACK_V1 (.saimpack).');
        return;
      }
      if (!parsed.packId || !parsed.tenantId || !parsed.branchId || !parsed.payloadBase64) {
        setFileParseError('Archive envelope is missing required metadata (packId, tenantId, branchId, payloadBase64).');
        return;
      }

      setSelectedArchive({
        rawEnvelope: parsed,
        fileName: file.name,
        fileSizeBytes: file.size,
        packId: String(parsed.packId),
        tenantId: String(parsed.tenantId).toUpperCase(),
        branchId: String(parsed.branchId),
        branchName: String(parsed.branchName || parsed.branchId),
        hubId: String(parsed.hubId || 'UNKNOWN'),
        recordCount: Number(parsed.recordCount) || 0,
        t1Only: parsed.t1Only !== false,
        encrypted: Boolean(parsed.encrypted),
        kdf: String(parsed.kdf || (parsed.encrypted ? 'pbkdf2-sha256' : 'none')),
        fromTs: parsed.fromTs ? Number(parsed.fromTs) : undefined,
        toTs: parsed.toTs ? Number(parsed.toTs) : undefined,
        createdAt: parsed.createdAt ? Number(parsed.createdAt) : undefined,
        entityCounts:
          parsed.entityCounts && typeof parsed.entityCounts === 'object' ? parsed.entityCounts : {},
      });
    } catch {
      setFileParseError('Could not read .saimpack JSON file. Make sure the file is not corrupted.');
    }
  };

  const handleUploadToCloud = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedArchive) return;
    if (selectedArchive.encrypted && !importPassphrase.trim()) {
      setCloudIngestResult({
        ok: false,
        error: 'This .saimpack archive is encrypted. Enter its passphrase to decrypt and ingest.',
      });
      return;
    }

    const token = getTenantAuthToken(activeCompanyId);
    if (!token) {
      setCloudIngestResult({
        ok: false,
        error: 'Cloud authentication token is missing. Please sign in online before ingesting an archive pack.',
      });
      return;
    }

    setIsIngestingToCloud(true);
    setCloudIngestResult(null);
    try {
      const res = await fetch('/api/archive-pack/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-company-id': activeCompanyId,
          ...(activeUser?.id ? { 'x-user-id': String(activeUser.id) } : {}),
          ...(activeUser?.email ? { 'x-user-email': String(activeUser.email) } : {}),
        },
        body: JSON.stringify({
          envelope: selectedArchive.rawEnvelope,
          ...(importPassphrase.trim() ? { passphrase: importPassphrase.trim() } : {}),
        }),
      });
      const json: CloudIngestResponse = await res.json().catch(() => ({
        ok: false,
        error: `Cloud server returned HTTP ${res.status}`,
      }));
      setCloudIngestResult(json);
      if (json.ok) {
        setImportPassphrase('');
        void fetchCloudReceipts();
      }
    } catch (err: any) {
      setCloudIngestResult({
        ok: false,
        error: err?.message || 'Network error while uploading .saimpack archive to Cloud.',
      });
    } finally {
      setIsIngestingToCloud(false);
    }
  };

  const cap = storageSnap.storageCapacity;
  const stage = storageSnap.bannerStage;
  const stageBadgeClass =
    stage === 'CRITICAL_STORAGE'
      ? 'bg-rose-500/20 text-rose-200 border-rose-500/40'
      : stage === 'ARCHIVE_RECOMMENDED_90'
      ? 'bg-orange-500/20 text-orange-200 border-orange-500/40'
      : stage === 'WARNING_75'
      ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

  const usageBarClass =
    stage === 'CRITICAL_STORAGE'
      ? 'bg-rose-500'
      : stage === 'ARCHIVE_RECOMMENDED_90'
      ? 'bg-orange-500'
      : stage === 'WARNING_75'
      ? 'bg-amber-400'
      : 'bg-emerald-500';

  const tenantMismatchWarning =
    selectedArchive && selectedArchive.tenantId !== activeCompanyId;

  return (
    <div className="p-4 sm:p-5 space-y-5">
      {/* SECTION 1: Live Hub Encrypted WAL Telemetry & Authenticated WS RPCs */}
      <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">
                Local Hub Encrypted WAL Storage &amp; Offline Archives
              </h3>
              <p className="text-[11px] text-slate-400">
                Engine:{' '}
                <span className="font-mono text-slate-300">
                  {cap?.engine || 'PURE_JS_ENCRYPTED_WAL_V1'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border ${stageBadgeClass}`}
            >
              {stage.replace(/_/g, ' ')}
            </span>
            <button
              type="button"
              disabled={!isMutuallyAuthenticated || isLoadingStatus}
              onClick={() => void refreshHubStatusAndPacks()}
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
              <span>Query Status</span>
            </button>
          </div>
        </div>

        {/* Auth guard notice */}
        {!isMutuallyAuthenticated && (
          <div className="p-3 rounded-xl bg-amber-950/35 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Mutual-HMAC Auth Required for Live Hub RPCs</p>
              <p className="text-[11px] text-amber-200/80 mt-0.5">
                Connect and complete Mutual-HMAC pairing (<code>AUTH_OK</code>) with your Local Hub
                v4.2.0+ to query WAL telemetry, create encrypted <code>.saimpack</code> archives, or
                evict archived records. You can still upload previously saved{' '}
                <code>.saimpack</code> files to Cloud below.
              </p>
            </div>
          </div>
        )}

        {/* Storage capacity gauge & telemetry metrics */}
        {cap ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-bold">
                  WAL Record Capacity ({cap.totalRecords.toLocaleString()}
                  {cap.softRecordLimit > 0 ? ` / ${cap.softRecordLimit.toLocaleString()}` : ''})
                </span>
                <span className="font-mono font-black text-white">
                  {cap.usagePct.toFixed(1)}%
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${usageBarClass}`}
                  style={{ width: `${Math.min(100, Math.max(2, cap.usagePct))}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-bold">T1 / T2 Records</p>
                <p className="font-mono font-black text-slate-100 mt-0.5">
                  {cap.t1Count.toLocaleString()} / {cap.t2Count.toLocaleString()}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-bold">Unsynced T1</p>
                <p className="font-mono font-black text-amber-300 mt-0.5">
                  {cap.unsyncedT1Count.toLocaleString()}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-bold">WAL / Snapshot</p>
                <p className="font-mono font-bold text-slate-200 mt-0.5">
                  {formatBytes(cap.walBytes)} / {formatBytes(cap.snapshotBytes)}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <p className="text-[10px] text-slate-400 uppercase font-bold">Disk / Quota</p>
                <p className="font-mono font-bold text-slate-200 mt-0.5">
                  {formatBytes(cap.diskBytes)}
                  {cap.maxStorageMb > 0 ? ` / ${cap.maxStorageMb} MB` : ''}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            No WAL telemetry received yet. Click <strong>Query Status</strong> once connected to a
            Local Hub v4.2.0+.
          </p>
        )}

        {/* RPC Notices & Errors */}
        {rpcNotice && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>{rpcNotice}</span>
          </div>
        )}
        {rpcError && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-200 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{rpcError}</span>
          </div>
        )}

        {/* Create Encrypted .saimpack Form */}
        {isMutuallyAuthenticated && (
          <form
            onSubmit={handleCreateArchivePack}
            className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-black text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                <Archive className="w-3.5 h-3.5" />
                <span>Create Encrypted .saimpack Archive (T1 Only)</span>
              </h4>
              {lastCreatedPack && (
                <span className="text-[10px] font-mono text-emerald-300">
                  Last: {lastCreatedPack.packId} ({lastCreatedPack.compressionRatioPct.toFixed(0)}%
                  saved)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Preserve Recent Days on Hub
                </label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={preserveRecentDays}
                  onChange={(e) => setPreserveRecentDays(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Archive Encryption Passphrase (Optional — AES-256-GCM / PBKDF2)
                </label>
                <div className="relative">
                  <input
                    type={showCreatePass ? 'text' : 'password'}
                    value={createPassphrase}
                    onChange={(e) => setCreatePassphrase(e.target.value)}
                    placeholder="Enter strong passphrase for cloud upload later..."
                    autoComplete="new-password"
                    className="w-full pl-3 pr-9 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                    aria-label="Toggle passphrase visibility"
                  >
                    {showCreatePass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSynced}
                  onChange={(e) => setIncludeSynced(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-950 text-indigo-500"
                />
                <span>Include already cloud-synced T1 history in archive pack</span>
              </label>

              <button
                type="submit"
                disabled={isCreatingPack}
                className="text-xs font-black px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer"
              >
                {isCreatingPack ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Packing Archive...</span>
                  </>
                ) : (
                  <>
                    <FileArchive className="w-3.5 h-3.5" />
                    <span>Create .saimpack Archive</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Active Download Progress Bar */}
        {downloadingPackId && downloadProgress && (
          <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/35 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-indigo-200 font-bold">
              <span>
                Downloading {downloadingPackId} ({downloadProgress.receivedChunks}/
                {downloadProgress.totalChunks} chunks • {formatBytes(downloadProgress.receivedBytes)})
              </span>
              <span className="font-mono">{downloadProgress.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-900 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-150"
                style={{ width: `${downloadProgress.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Hub Archive Packs List */}
        {isMutuallyAuthenticated && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-200 uppercase tracking-wider">
                Hub Archive Packs ({packs.length})
              </h4>
              {isLoadingPacks && (
                <span className="text-[11px] text-slate-400">Refreshing list...</span>
              )}
            </div>

            {packs.length === 0 ? (
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
                No offline archive packs stored on this Local Hub yet.
              </div>
            ) : (
              <div className="space-y-2">
                {packs.map((pack) => {
                  const dlInfo = verifiedDownloads[pack.packId];
                  const isDownloadingThis = downloadingPackId === pack.packId;
                  const isConfirmingEvict = evictCandidatePackId === pack.packId;

                  return (
                    <div
                      key={pack.packId}
                      className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-black text-white">
                              {pack.fileName}
                            </span>
                            {pack.encrypted ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5" />
                                Encrypted
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 inline-flex items-center gap-1">
                                <Unlock className="w-2.5 h-2.5" />
                                Gzip
                              </span>
                            )}
                            {pack.evicted && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                                Evicted
                              </span>
                            )}
                            {dlInfo && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 inline-flex items-center gap-1">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                Verified &amp; Saved
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {pack.recordCount.toLocaleString()} T1 records •{' '}
                            {formatBytes(pack.compressedBytes)} compressed ({formatBytes(pack.uncompressedBytes)} raw) •{' '}
                            {formatDateRange(pack.fromTs, pack.toTs)}
                          </p>
                          {pack.payloadSha256 && (
                            <p className="text-[10px] font-mono text-slate-500 truncate">
                              SHA-256: {pack.payloadSha256.slice(0, 24)}…
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={Boolean(downloadingPackId)}
                            onClick={() => void handleDownloadPack(pack)}
                            className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{isDownloadingThis ? 'Downloading...' : 'Download'}</span>
                          </button>

                          {!pack.evicted && (
                            <button
                              type="button"
                              disabled={!dlInfo || isEvicting}
                              onClick={() => {
                                setEvictCandidatePackId(
                                  isConfirmingEvict ? null : pack.packId
                                );
                                setEvictSafetyChecked(false);
                              }}
                              title={
                                dlInfo
                                  ? 'Confirm eviction of archived records from Hub WAL'
                                  : 'Download and verify this .saimpack file first to unlock eviction'
                              }
                              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 disabled:opacity-35 text-rose-300 border border-rose-500/35 transition flex items-center gap-1.5 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Evict</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Two-step Post-Download Eviction Safety Gate */}
                      {isConfirmingEvict && dlInfo && (
                        <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 space-y-2.5">
                          <p className="text-xs font-bold text-rose-200">
                            Confirm Hub WAL Eviction for {pack.packId}
                          </p>
                          <p className="text-[11px] text-rose-200/80">
                            This permanently removes the archived historical T1 records from the Local
                            Hub&apos;s WAL to reclaim capacity while keeping live T2 master tables and
                            recent days intact.
                          </p>
                          <label className="flex items-start gap-2 text-xs text-rose-100 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={evictSafetyChecked}
                              onChange={(e) => setEvictSafetyChecked(e.target.checked)}
                              className="mt-0.5 rounded border-rose-400 bg-slate-950 text-rose-500"
                            />
                            <span>
                              I confirm <strong>{dlInfo.fileName}</strong> is safely saved on this
                              admin device, USB drive, or laptop (SHA-256:{' '}
                              <code className="font-mono">{dlInfo.payloadSha256.slice(0, 16)}…</code>
                              ).
                            </span>
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={!evictSafetyChecked || isEvicting}
                              onClick={() => void handleConfirmEvict(pack.packId)}
                              className="text-xs font-black px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white transition cursor-pointer"
                            >
                              {isEvicting ? 'Evicting...' : 'Confirm Eviction on Hub'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEvictCandidatePackId(null);
                                setEvictSafetyChecked(false);
                              }}
                              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Hub Eviction Receipts */}
            {evictionReceipts.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  <span>Hub Eviction Receipts ({evictionReceipts.length})</span>
                </h5>
                <div className="divide-y divide-slate-800 rounded-xl bg-slate-900/70 border border-slate-800 overflow-hidden">
                  {evictionReceipts.slice(0, 5).map((r) => (
                    <div
                      key={`${r.packId}-${r.evictedAt}`}
                      className="px-3 py-2 flex items-center justify-between text-[11px] text-slate-300"
                    >
                      <span className="font-mono font-bold">{r.packId}</span>
                      <span>
                        -{r.removedCount.toLocaleString()} records •{' '}
                        {new Date(r.evictedAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION 2: Cloud Backend Delayed `.saimpack` Importer (POST /api/archive-pack/ingest) */}
      <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0">
            <CloudUpload className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white">
              Cloud Delayed Archive Importer (.saimpack)
            </h3>
            <p className="text-[11px] text-slate-400">
              Upload a saved branch <code>.saimpack</code> file weeks or months later when Internet
              returns. Historical T1 records are upserted idempotently without overwriting live T2
              prices, stock, customers, or staff.
            </p>
          </div>
        </div>

        <form onSubmit={handleUploadToCloud} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".saimpack,application/json,.json"
              onChange={handleArchiveFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-bold px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>Select .saimpack File</span>
            </button>
            {selectedArchive && (
              <span className="text-xs font-mono text-emerald-300 truncate">
                {selectedArchive.fileName} ({formatBytes(selectedArchive.fileSizeBytes)})
              </span>
            )}
          </div>

          {fileParseError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{fileParseError}</span>
            </div>
          )}

          {selectedArchive && (
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Pack ID</span>
                  <span className="font-mono font-bold text-white">{selectedArchive.packId}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Tenant / Branch</span>
                  <span className="font-mono font-bold text-slate-200">
                    {selectedArchive.tenantId} • {selectedArchive.branchName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Records / Range</span>
                  <span className="font-mono font-bold text-slate-200">
                    {selectedArchive.recordCount.toLocaleString()} ({formatDateRange(selectedArchive.fromTs, selectedArchive.toTs)})
                  </span>
                </div>
              </div>

              {tenantMismatchWarning && (
                <div className="p-2.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-200 text-[11px] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Tenant mismatch: archive belongs to{' '}
                    <strong className="font-mono">{selectedArchive.tenantId}</strong>, while your
                    active company is <strong className="font-mono">{activeCompanyId}</strong>.
                    Cloud ingestion will reject unauthorized cross-tenant uploads.
                  </span>
                </div>
              )}

              {selectedArchive.encrypted && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Decryption Passphrase ({selectedArchive.kdf} / AES-256-GCM)
                  </label>
                  <div className="relative">
                    <input
                      type={showImportPass ? 'text' : 'password'}
                      value={importPassphrase}
                      onChange={(e) => setImportPassphrase(e.target.value)}
                      placeholder="Enter passphrase used when creating this archive..."
                      autoComplete="off"
                      className="w-full pl-3 pr-9 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowImportPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                      aria-label="Toggle import passphrase visibility"
                    >
                      {showImportPass ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span>T1 historical upsert only • T2 master tables protected</span>
                </span>
                <button
                  type="submit"
                  disabled={isIngestingToCloud}
                  className="text-xs font-black px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isIngestingToCloud ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Decrypting &amp; Ingesting...</span>
                    </>
                  ) : (
                    <>
                      <CloudUpload className="w-3.5 h-3.5" />
                      <span>Upload &amp; Ingest to Cloud</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {cloudIngestResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                cloudIngestResult.ok
                  ? 'bg-emerald-950/35 border-emerald-500/35 text-emerald-100'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              }`}
            >
              {cloudIngestResult.ok ? (
                <>
                  <div className="flex items-center gap-2 font-black">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      {cloudIngestResult.alreadyIngested
                        ? `Archive ${cloudIngestResult.packId} Already Ingested (Idempotent No-Op)`
                        : `Archive ${cloudIngestResult.packId} Ingested to Cloud`}
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-200/90">
                    {cloudIngestResult.alreadyIngested
                      ? cloudIngestResult.message
                      : `Upserted ${(cloudIngestResult.ingestedCount ?? 0).toLocaleString()} T1 records as cloud-synced • ${(cloudIngestResult.skippedDuplicateCount ?? 0).toLocaleString()} duplicates skipped • ${(cloudIngestResult.skippedT2Count ?? 0).toLocaleString()} T2 master records safely ignored.`}
                  </p>
                </>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{cloudIngestResult.error || 'Cloud archive ingestion failed.'}</span>
                </div>
              )}
            </div>
          )}
        </form>

        {/* Cloud Ingestion Receipts History */}
        {(cloudReceipts.length > 0 || isLoadingCloudReceipts) && (
          <div className="space-y-1.5 pt-1">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Cloud Archive Ingestion History ({cloudReceipts.length})
            </h4>
            <div className="divide-y divide-slate-800 rounded-xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              {cloudReceipts.slice(0, 6).map((rec) => (
                <div
                  key={`${rec.tenantId}-${rec.packId}`}
                  className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300"
                >
                  <div>
                    <span className="font-mono font-bold text-white">{rec.packId}</span>
                    <span className="text-slate-400 ml-2">{rec.branchName}</span>
                  </div>
                  <div className="text-slate-400">
                    <span className="text-emerald-300 font-bold">
                      +{rec.ingestedCount.toLocaleString()} T1
                    </span>
                    {' • '}
                    {new Date(rec.ingestedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HubStorageArchivePanel;
