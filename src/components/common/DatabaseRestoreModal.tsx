import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Upload,
  FileCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  KeyRound,
  FileText,
  Database,
  Building2,
  Calendar,
  Layers,
  ArrowRight,
  Receipt,
  Banknote,
  Coins,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  restoreEncryptedBackup,
  restoreDatabaseFromPayload,
  RestoreResult,
  BackupPayload,
} from '../../services/databaseBackupService';
import { backupCryptoService } from '../../services/backupCryptoService';

interface DatabaseRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreSuccess?: (result: RestoreResult) => void;
  defaultMode?: 'replace' | 'append' | 'master_only';
}

export const DatabaseRestoreModal: React.FC<DatabaseRestoreModalProps> = ({
  isOpen,
  onClose,
  onRestoreSuccess,
  defaultMode = 'append',
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'append' | 'master_only'>(defaultMode);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [decryptedPayload, setDecryptedPayload] = useState<BackupPayload | null>(null);
  const [successResult, setSuccessResult] = useState<RestoreResult | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    setSuccessResult(null);
    setDecryptedPayload(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileContent(text);
    };
    reader.onerror = () => {
      setErrorMsg('Failed to read the selected file from disk.');
    };
    reader.readAsText(file);
  };

  const handleInspectAndDecrypt = async () => {
    if (!fileContent) {
      setErrorMsg('Please select a backup file (.saimetric.enc or .json) first.');
      return;
    }

    if (!password.trim()) {
      setErrorMsg('Please enter the decryption password for this backup file.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const decResult = await backupCryptoService.decryptBackupPayload(fileContent, password);
      if (!decResult.success || !decResult.data) {
        setErrorMsg(decResult.error || 'Decryption failed. Please verify your password.');
        setIsProcessing(false);
        return;
      }

      setDecryptedPayload(decResult.data);
      const manifest = decResult.data.manifest;

      // Auto-set optimal restore mode
      if (manifest.backupType === 'ADMIN_MASTER_UPDATE' || manifest.isMasterOnly) {
        setRestoreMode('master_only');
      } else if (manifest.backupType === 'EOD_HANDOVER') {
        setRestoreMode('append');
      }
    } catch (err: any) {
      setErrorMsg(`Unexpected decryption error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteCommit = () => {
    if (!decryptedPayload) return;
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const result = restoreDatabaseFromPayload(decryptedPayload, restoreMode);
      if (result.success) {
        setSuccessResult(result);
        if (onRestoreSuccess) {
          onRestoreSuccess(result);
        }
      } else {
        setErrorMsg(result.error || result.message || 'Restore failed.');
      }
    } catch (err: any) {
      setErrorMsg(`Unexpected restore error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const manifest = decryptedPayload?.manifest;
  const handover = manifest?.handoverSummary;
  const isMasterOnly = manifest?.backupType === 'ADMIN_MASTER_UPDATE' || Boolean(manifest?.isMasterOnly);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative space-y-5 animate-fadeIn max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Database className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Restore Database from Backup
              </h3>
              <p className="text-xs text-slate-400">
                Encrypted restore for EOD handovers, master pushes, or complete system snapshots
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
        {successResult ? (
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-600/60 text-emerald-200 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Database Restored Successfully!</span>
              </div>
              <p>{successResult.message}</p>
              <div className="font-mono text-[11px] pt-1 border-t border-emerald-800/60 flex justify-between text-emerald-400">
                <span>Backup Type: {successResult.backupType}</span>
                <span>Records: {successResult.recordsProcessed}</span>
              </div>
              {successResult.protectedTablesPreserved !== undefined && successResult.protectedTablesPreserved > 0 && (
                <div className="text-[10px] text-emerald-300 bg-emerald-900/60 p-2 rounded-xl mt-1">
                  🛡️ <strong>Safety Shield Confirmed:</strong> Branch counter sales, till cash logs, and customer debt ledger were 100% protected and remained untouched.
                </div>
              )}
            </div>

            <button
              onClick={() => {
                onClose();
                window.location.reload();
              }}
              className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer"
            >
              <span>Reload App with Restored Database</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : decryptedPayload ? (
          /* Step 2: Inspection & Confirmation State */
          <div className="space-y-4">
            {/* EOD Handover Scorecard */}
            {handover && (
              <div className="p-4 bg-emerald-950/50 border border-emerald-500/50 rounded-2xl space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-emerald-800/50">
                  <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs">
                    <Receipt className="w-4 h-4 text-emerald-400" />
                    <span>EOD Supervisor Handover Summary</span>
                  </div>
                  <span className="text-[10px] bg-emerald-900 text-emerald-200 px-2 py-0.5 rounded font-mono font-bold">
                    {handover.shiftDate || manifest.timestamp.slice(0, 10)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Total Shift Sales</span>
                    <span className="text-base font-black font-mono text-emerald-400">
                      ${handover.totalSalesUsd.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {handover.totalSalesCount} transactions
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Till Cash Balance</span>
                    <span className="text-base font-black font-mono text-amber-300">
                      ${handover.totalCashInDrawer.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      Variance: ${handover.cashVariance.toFixed(2)}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Credit Issued (F3)</span>
                    <span className="text-xs font-bold font-mono text-rose-300">
                      ${handover.creditIssuedUsd.toFixed(2)}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">Uncollected Change (F3)</span>
                    <span className="text-xs font-bold font-mono text-indigo-300">
                      ${handover.uncollectedChangeUsd.toFixed(2)}
                    </span>
                  </div>
                </div>

                {handover.shiftNotes && (
                  <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 text-[11px] text-slate-300">
                    <strong className="text-slate-400 block text-[10px] uppercase">Supervisor Notes:</strong>
                    <span>"{handover.shiftNotes}"</span>
                  </div>
                )}
              </div>
            )}

            {/* Admin Master Push Safety Guard */}
            {isMasterOnly && (
              <div className="p-4 bg-amber-950/40 border border-amber-500/50 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
                  <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>Owner Master Data Update (Protected Mode)</span>
                </div>
                <p className="text-xs text-amber-200/90 leading-relaxed">
                  🛡️ <strong>Safety Protection Active:</strong> This file contains master catalog items, retail prices, packaging variants, exchange rates, and permissions configured by the owner.
                </p>
                <div className="p-2.5 bg-slate-950/80 rounded-xl border border-amber-500/30 text-[11px] text-emerald-300 font-mono space-y-0.5">
                  <div>✓ Today's Branch Counter Sales: LOCKED &amp; PRESERVED</div>
                  <div>✓ Till Cash Logs &amp; Counts: LOCKED &amp; PRESERVED</div>
                  <div>✓ Customer Debt &amp; Credit Ledger: LOCKED &amp; PRESERVED</div>
                </div>
              </div>
            )}

            {/* General Manifest Details */}
            {!handover && !isMasterOnly && (
              <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs space-y-1.5 font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Type:</span>
                  <span className="text-white font-bold">{manifest.backupType}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Date:</span>
                  <span className="text-white">{manifest.timestamp.replace('T', ' ').slice(0, 19)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Total Records:</span>
                  <span className="text-white font-bold">{manifest.totalRecords}</span>
                </div>
              </div>
            )}

            {/* Restore Mode Selection */}
            {!isMasterOnly && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Choose Ingestion Method</span>
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setRestoreMode('append')}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      restoreMode === 'append'
                        ? 'bg-indigo-950 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <strong className="block text-xs mb-0.5">Smart Append / Merge</strong>
                    <span className="text-[10px] block opacity-80">
                      Merges records without deleting existing branch history.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRestoreMode('replace')}
                    className={`p-2.5 rounded-xl border text-left transition ${
                      restoreMode === 'replace'
                        ? 'bg-indigo-950 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <strong className="block text-xs mb-0.5">Fresh Setup (Replace)</strong>
                    <span className="text-[10px] block opacity-80">
                      Overwrites current data with this snapshot.
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setDecryptedPayload(null)}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleExecuteCommit}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Applying Changes...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {isMasterOnly
                        ? 'Apply Master Catalog Updates'
                        : handover
                        ? 'Merge Shift into My Records'
                        : 'Confirm & Apply Restore'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Step 1: Upload & Password Entry Form */
          <div className="space-y-4">
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-600/60 text-rose-200 text-xs flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* File Upload */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                1. Select Encrypted Backup File (.saimetric.enc)
              </label>
              <label className="border-2 border-dashed border-slate-700 hover:border-indigo-500/80 rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer bg-slate-950/60 hover:bg-slate-950 transition-all text-center">
                <Upload className="w-6 h-6 text-indigo-400 mb-1.5" />
                {selectedFile ? (
                  <div className="text-xs">
                    <span className="font-bold text-white block">{selectedFile.name}</span>
                    <span className="text-slate-400 text-[10px]">
                      {(selectedFile.size / 1024).toFixed(1)} KB • Click to change
                    </span>
                  </div>
                ) : (
                  <div className="text-xs">
                    <span className="font-bold text-indigo-300 block">Click to browse backup file</span>
                    <span className="text-slate-500 text-[10px]">Supports .saimetric.enc and .json</span>
                  </div>
                )}
                <input
                  type="file"
                  accept=".enc,.json,.saimetric"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {/* Decryption Password */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-300 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                <span>2. Decryption Password</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter the password used when creating backup..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-white text-xs"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
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
                onClick={handleInspectAndDecrypt}
                disabled={isProcessing || !fileContent || !password.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Decrypting &amp; Inspecting...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Decrypt &amp; Inspect Payload</span>
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
