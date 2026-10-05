import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Download,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  FileCheck,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  createEncryptedBackupFile,
  downloadBackupFileToDevice,
  calculateDeltaCutoff,
  getLastBackupTimestamp,
  BackupType,
} from '../../services/databaseBackupService';

interface DatabaseBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: BackupType;
  staffName?: string;
  onSuccess?: (fileName: string) => void;
}

export const DatabaseBackupModal: React.FC<DatabaseBackupModalProps> = ({
  isOpen,
  onClose,
  defaultType = 'DELTA',
  staffName = 'Manager',
  onSuccess,
}) => {
  const [backupType, setBackupType] = useState<BackupType>(defaultType);
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [shiftNotes, setShiftNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [downloadSuccessName, setDownloadSuccessName] = useState<string | null>(null);

  if (!isOpen) return null;

  const lastBackupStr = getLastBackupTimestamp();
  const deltaInfo = calculateDeltaCutoff();

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

    setIsProcessing(true);

    try {
      const { fileName, encryptedContent, manifest } = await createEncryptedBackupFile(
        backupType,
        password,
        staffName,
        shiftNotes.trim() || undefined
      );

      // Download file to user's device
      downloadBackupFileToDevice(fileName, encryptedContent);
      setDownloadSuccessName(fileName);

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
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-5 animate-fadeIn">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Shield className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Generate Encrypted Backup
              </h3>
              <p className="text-xs text-slate-400">
                AES-256 encrypted file ready to save locally or upload to Google Drive
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
            <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-600/60 text-emerald-200 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Backup Created &amp; Downloaded!</span>
              </div>
              <p className="font-mono text-[11px] text-white break-all">{downloadSuccessName}</p>
              <p className="text-[11px] text-slate-300">
                The encrypted file has been downloaded to your device downloads folder. You can now safely upload it to
                Google Drive, send via email, or copy to a USB flash drive.
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

            {/* Backup Type Choice */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300">1. Select Backup / Export Purpose</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {/* EOD Handover Option for Supervisors */}
                <button
                  type="button"
                  onClick={() => setBackupType('EOD_HANDOVER')}
                  className={`p-3 rounded-2xl border text-left transition ${
                    backupType === 'EOD_HANDOVER'
                      ? 'bg-emerald-950 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <strong className="block text-xs mb-1 text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    EOD Supervisor Handover
                  </strong>
                  <span className="text-[10px] block opacity-80 leading-relaxed">
                    Designed for supervisors to send to off-site owner. Includes today's sales, drawer cash count, cash lifts, and shift scorecard.
                  </span>
                </button>

                {/* Admin Master Push for Owner */}
                <button
                  type="button"
                  onClick={() => setBackupType('ADMIN_MASTER_UPDATE')}
                  className={`p-3 rounded-2xl border text-left transition ${
                    backupType === 'ADMIN_MASTER_UPDATE'
                      ? 'bg-amber-950 border-amber-500 text-white shadow-sm ring-1 ring-amber-500/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <strong className="block text-xs mb-1 text-amber-300 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    Owner Master Push (Catalog &amp; Rates)
                  </strong>
                  <span className="text-[10px] block opacity-80 leading-relaxed">
                    For Company Owner. Exports products, prices, pack ratios, rates &amp; permissions. 🛡️ Safe: Cannot overwrite branch sales.
                  </span>
                </button>

                {/* Daily Delta */}
                <button
                  type="button"
                  onClick={() => setBackupType('DELTA')}
                  className={`p-3 rounded-2xl border text-left transition ${
                    backupType === 'DELTA'
                      ? 'bg-indigo-950 border-indigo-500 text-white shadow-sm ring-1 ring-indigo-500/50'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <strong className="block text-xs mb-1 text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Daily Delta Archive
                  </strong>
                  <span className="text-[10px] block opacity-80 leading-relaxed">
                    Fast delta backup with changes since {lastBackupStr ? lastBackupStr.split('T')[0] : 'month start'}.
                  </span>
                </button>

                {/* Full Snapshot */}
                <button
                  type="button"
                  onClick={() => setBackupType('FULL')}
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
                    Complete archive of the entire database. Best for fresh device setups or disaster recovery.
                  </span>
                </button>
              </div>
            </div>

            {/* Optional Shift Notes if EOD Handover */}
            {backupType === 'EOD_HANDOVER' && (
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-300">
                  Supervisor Shift Handover Notes (Optional)
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

            {/* Owner Master Push Guidance */}
            {backupType === 'ADMIN_MASTER_UPDATE' && (
              <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl text-amber-200 text-xs space-y-1">
                <strong className="font-bold flex items-center gap-1 text-amber-300">
                  <span>🛡️ Protected Master Push Guard</span>
                </strong>
                <p className="text-[11px] text-amber-300/80 leading-relaxed">
                  This bundle only contains catalog items, prices, packaging ratios, exchange rates, and permissions. When the supervisor uploads this at the branch terminal, today's counter sales, till cash logs, and customer debt ledger will be 100% preserved.
                </p>
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
                ⚠️ Keep this password safe. Saimetric encrypts the file client-side; without this password, the backup
                file cannot be decrypted if the device is lost.
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
                    <span>Encrypting &amp; Generating...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Encrypted Backup</span>
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
