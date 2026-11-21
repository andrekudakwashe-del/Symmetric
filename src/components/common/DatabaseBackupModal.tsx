import React, { useState, useEffect } from 'react';
import {
  Shield,
  Lock,
  Download,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Calendar,
  Layers,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import {
  createEncryptedBackupFile,
  generateDatabasePayload,
  downloadBackupFileToDevice,
  calculateDeltaCutoff,
  getLastBackupTimestamp,
  BackupType,
  BackupDateRange,
  MAX_RECOMMENDED_BACKUP_BYTES,
} from '../../services/databaseBackupService';

interface DatabaseBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: BackupType;
  staffName?: string;
  clearanceLevel?: number;
  clearanceRole?: string;
  onSuccess?: (fileName: string) => void;
}

function formatDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDaysAgoDateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatDateInput(d);
}

function formatBytesHuman(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const DatabaseBackupModal: React.FC<DatabaseBackupModalProps> = ({
  isOpen,
  onClose,
  defaultType = 'DELTA',
  staffName = 'Manager',
  clearanceLevel,
  clearanceRole,
  onSuccess,
}) => {
  const todayStr = formatDateInput(new Date());
  const defaultDeltaStart = calculateDeltaCutoff().cutoffIso.slice(0, 10);

  const [backupType, setBackupType] = useState<BackupType>(defaultType);
  const [startDate, setStartDate] = useState<string>(
    defaultType === 'EOD_HANDOVER' ? todayStr : defaultDeltaStart
  );
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [includeT1InMaster, setIncludeT1InMaster] = useState<boolean>(true);
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [shiftNotes, setShiftNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadSuccessName, setDownloadSuccessName] = useState<string | null>(null);
  const [downloadMeta, setDownloadMeta] = useState<{
    t1Count: number;
    t2Count: number;
    fileSizeBytes: number;
    exceeds15MB: boolean;
  } | null>(null);

  const [previewStats, setPreviewStats] = useState<{
    t1Count: number;
    t2Count: number;
    estimatedBytes: number;
    exceeds15MB: boolean;
  } | null>(null);

  // Sync sensible default date ranges when switching backup type
  const handleSelectBackupType = (nextType: BackupType) => {
    setBackupType(nextType);
    if (nextType === 'EOD_HANDOVER') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (nextType === 'DELTA') {
      setStartDate(defaultDeltaStart);
      setEndDate(todayStr);
    } else if (nextType === 'ADMIN_MASTER_UPDATE') {
      setStartDate(getDaysAgoDateStr(7));
      setEndDate(todayStr);
    }
  };

  // Compute live T1/T2 counts & >15MB size preview whenever mode or date range changes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const effectiveRange: BackupDateRange | undefined =
      backupType === 'FULL'
        ? undefined
        : backupType === 'ADMIN_MASTER_UPDATE' && !includeT1InMaster
        ? undefined
        : { startDate, endDate };

    const timer = setTimeout(async () => {
      try {
        const preview = await generateDatabasePayload(
          backupType,
          staffName,
          undefined,
          clearanceLevel,
          clearanceRole,
          effectiveRange
        );
        if (!cancelled) {
          // Account for ~33% Base64 encryption overhead when estimating final .saimetric.enc size
          const estEncBytes = Math.round((preview.manifest.estimatedBytes || 0) * 1.35);
          setPreviewStats({
            t1Count: preview.manifest.t1Count || 0,
            t2Count: preview.manifest.t2Count || 0,
            estimatedBytes: estEncBytes,
            exceeds15MB: estEncBytes > MAX_RECOMMENDED_BACKUP_BYTES,
          });
        }
      } catch {
        // Non-fatal preview error
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, backupType, startDate, endDate, includeT1InMaster, staffName, clearanceLevel, clearanceRole]);

  if (!isOpen) return null;

  const lastBackupStr = getLastBackupTimestamp();

  const handleGenerateBackup = async () => {
    setErrorMsg(null);
    if (!password || password.trim().length < 4) {
      setErrorMsg('Please enter an encryption password of at least 4 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please verify your password.');
      return;
    }

    if (backupType !== 'FULL' && startDate && endDate && startDate > endDate) {
      setErrorMsg('Start Date cannot be after End Date.');
      return;
    }

    setIsProcessing(true);

    try {
      const effectiveRange: BackupDateRange | undefined =
        backupType === 'FULL'
          ? undefined
          : backupType === 'ADMIN_MASTER_UPDATE' && !includeT1InMaster
          ? undefined
          : { startDate, endDate };

      const { fileName, encryptedContent, manifest, fileSizeBytes, exceeds15MB } =
        await createEncryptedBackupFile(
          backupType,
          password,
          staffName,
          shiftNotes.trim() || undefined,
          clearanceLevel,
          clearanceRole,
          effectiveRange
        );

      downloadBackupFileToDevice(fileName, encryptedContent);
      setDownloadSuccessName(fileName);
      setDownloadMeta({
        t1Count: manifest.t1Count || 0,
        t2Count: manifest.t2Count || 0,
        fileSizeBytes,
        exceeds15MB,
      });

      if (onSuccess) {
        onSuccess(fileName);
      }
    } catch (err: any) {
      setErrorMsg(`Backup generation failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 animate-fadeIn max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Shield className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Export Hexagonal WhatsApp Sync File
              </h3>
              <p className="text-xs text-slate-400">
                AES-256-GCM encrypted SyncEnvelopes with HMAC-SHA256 tamper protection
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success State */}
        {downloadSuccessName ? (
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-600/60 text-emerald-200 text-xs space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Sync File Created &amp; Downloaded!</span>
              </div>
              <p className="font-mono text-[11px] text-white break-all">{downloadSuccessName}</p>
              {downloadMeta && (
                <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                  <div className="bg-slate-900/70 p-2 rounded-xl border border-emerald-800/50">
                    <span className="text-slate-400 block text-[10px]">T1 Ledger</span>
                    <strong className="text-emerald-300">{downloadMeta.t1Count}</strong>
                  </div>
                  <div className="bg-slate-900/70 p-2 rounded-xl border border-emerald-800/50">
                    <span className="text-slate-400 block text-[10px]">T2 Config</span>
                    <strong className="text-indigo-300">{downloadMeta.t2Count}</strong>
                  </div>
                  <div className="bg-slate-900/70 p-2 rounded-xl border border-emerald-800/50">
                    <span className="text-slate-400 block text-[10px]">File Size</span>
                    <strong className={downloadMeta.exceeds15MB ? 'text-amber-300' : 'text-white'}>
                      {formatBytesHuman(downloadMeta.fileSizeBytes)}
                    </strong>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>HMAC-SHA256 Signed — any post-export file edit will be automatically rejected on import.</span>
              </div>
              {downloadMeta?.exceeds15MB && (
                <div className="p-2.5 rounded-xl bg-amber-950/70 border border-amber-500/60 text-amber-200 text-[11px] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    This file exceeds 15 MB ({formatBytesHuman(downloadMeta.fileSizeBytes)}). For faster WhatsApp delivery, select a shorter date range next time.
                  </span>
                </div>
              )}
              <p className="text-[11px] text-slate-300">
                Send this file via WhatsApp, email, or USB. The receiver's app will route all envelopes safely through SyncCore without overwriting live balances.
              </p>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
            >
              Done
            </button>
          </div>
        ) : (
          /* Form State */
          <div className="space-y-4">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-600/60 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Backup Type Choice — Bi-Directional (Unrestricted by Role) */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300">
                1. Select Sync Export Mode (Bi-Directional: Admin or Salesperson)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleSelectBackupType('EOD_HANDOVER')}
                  className={`p-3 rounded-2xl border text-left transition ${
                    backupType === 'EOD_HANDOVER'
                      ? 'bg-emerald-950 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <strong className="block text-xs mb-1 text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Shift / EOD Handover
                  </strong>
                  <span className="text-[10px] block opacity-80 leading-relaxed">
                    Exports selected date range T1 transactions (Sales, Cash Logs, GRVs, Expenses) + full T2 config + shift scorecard.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectBackupType('ADMIN_MASTER_UPDATE')}
                  className={`p-3 rounded-2xl border text-left transition ${
                    backupType === 'ADMIN_MASTER_UPDATE'
                      ? 'bg-amber-950 border-amber-500 text-white shadow-sm ring-1 ring-amber-500/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <strong className="block text-xs mb-1 text-amber-300 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    Catalog, Prices &amp; GRVs Push
                  </strong>
                  <span className="text-[10px] block opacity-80 leading-relaxed">
                    Full T2 catalog, prices, staff &amp; rates + optional date-range T1 GRVs &amp; supplier payments. Live balances protected.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectBackupType('DELTA')}
                  className={`p-3 rounded-2xl border text-left transition ${
                    backupType === 'DELTA'
                      ? 'bg-indigo-950 border-indigo-500 text-white shadow-sm ring-1 ring-indigo-500/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <strong className="block text-xs mb-1 text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Smart Date-Range Sync
                  </strong>
                  <span className="text-[10px] block opacity-80 leading-relaxed">
                    T1 transactions in your date range (since {lastBackupStr ? lastBackupStr.split('T')[0] : 'month start'}) + full T2 catalog.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectBackupType('FULL')}
                  className={`p-3 rounded-2xl border text-left transition ${
                    backupType === 'FULL'
                      ? 'bg-indigo-950 border-indigo-500 text-white shadow-sm ring-1 ring-indigo-500/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <strong className="block text-xs mb-1 text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Full System Snapshot
                  </strong>
                  <span className="text-[10px] block opacity-80 leading-relaxed">
                    All historical T1 ledger events + full T2 config. Best for fresh device setup or disaster recovery.
                  </span>
                </button>
              </div>
            </div>

            {/* Smart T1 Date Range Filter */}
            {backupType !== 'FULL' && (
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                    <span>T1 Transactions Date Range</span>
                  </label>
                  <div className="flex items-center gap-1">
                    {[
                      { label: 'Today', days: 0 },
                      { label: '7d', days: 7 },
                      { label: '30d', days: 30 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setStartDate(getDaysAgoDateStr(preset.days));
                          setEndDate(todayStr);
                        }}
                        className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {backupType === 'ADMIN_MASTER_UPDATE' && (
                  <label className="flex items-center gap-2 text-[11px] text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeT1InMaster}
                      onChange={(e) => setIncludeT1InMaster(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-900 text-amber-500"
                    />
                    <span>Include T1 GRVs, Stock Movements &amp; Supplier Payments in this date range</span>
                  </label>
                )}

                {(backupType !== 'ADMIN_MASTER_UPDATE' || includeT1InMaster) && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block text-[10px] text-slate-400 mb-1">Start Date</span>
                      <input
                        type="date"
                        value={startDate}
                        max={endDate || todayStr}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <span className="block text-[10px] text-slate-400 mb-1">End Date</span>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-slate-400 leading-relaxed">
                  All T2 Config (Inventory prices, Staff, Customers, Suppliers, Wallets) is always exported as a complete snapshot while existing live balances are protected on import.
                </p>
              </div>
            )}

            {/* Live Envelope & File Size Preview + 15MB Warning Guard */}
            {previewStats && (
              <div
                className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                  previewStats.exceeds15MB
                    ? 'bg-amber-950/60 border-amber-500/70 text-amber-100'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span>
                    T1 Events: <strong className="text-emerald-400">{previewStats.t1Count}</strong> • T2 Config:{' '}
                    <strong className="text-indigo-400">{previewStats.t2Count}</strong>
                  </span>
                  <span className={previewStats.exceeds15MB ? 'text-amber-300 font-bold' : 'text-slate-300'}>
                    Est. {formatBytesHuman(previewStats.estimatedBytes)}
                  </span>
                </div>
                {previewStats.exceeds15MB && (
                  <div className="flex items-start gap-2 text-[11px] text-amber-300 pt-1">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>File Exceeds 15 MB!</strong> Please select a shorter date range for reliable WhatsApp transfer and faster mobile import.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Optional Shift Notes if EOD Handover */}
            {backupType === 'EOD_HANDOVER' && (
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-300">
                  Shift Handover Notes (Optional)
                </label>
                <input
                  type="text"
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                  placeholder="e.g. End of day till counted, $20 customer change left behind, stock variance zero"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            {/* Passphrase Input */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-300 flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-indigo-400" />
                  <span>2. Create Encryption Password</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter strong backup password..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2 text-slate-400 hover:text-white text-xs"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-300">
                  Confirm Encryption Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password to confirm..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
              <p className="text-[10px] text-amber-400/90 leading-normal">
                Encrypted client-side with AES-256-GCM + HMAC-SHA256 tamper seal. Share the password separately from the WhatsApp file.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateBackup}
                disabled={isProcessing || !password.trim() || password !== confirmPassword}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Signing &amp; Encrypting...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Export Signed Sync File</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

