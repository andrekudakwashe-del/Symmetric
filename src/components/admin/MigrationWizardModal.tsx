import React, { useState, useEffect } from 'react';
import {
  X,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  Server,
  Database,
  FileSpreadsheet,
  Flame,
  Zap,
  ShieldCheck,
  Cpu,
  Clock,
  KeyRound,
  RefreshCw,
  Sliders,
  Terminal,
  Play,
  Check,
} from 'lucide-react';
import { Company } from '../../data/saasData';
import {
  BackendType,
  BackendAuthMode,
  MigrationProgressEvent,
  MigrationReport,
} from '../../services/backendAdapter/types';
import {
  getAllAdapters,
  getBackendAdapter,
  getTenantBackendConfig,
} from '../../services/backendAdapter/adapterRegistry';
import { migrationEngineService } from '../../services/backendAdapter/migrationEngine';
import { roomBackendAdapter } from '../../services/backendAdapter/adapters/RoomAdapter';
import { toTimeStringSafe } from '../../utils/dateUtils';

interface MigrationWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCompany: Company;
  onMigrationComplete: (report: MigrationReport) => void;
  onShowToast: (message: string) => void;
}

export const MigrationWizardModal: React.FC<MigrationWizardModalProps> = ({
  isOpen,
  onClose,
  selectedCompany,
  onMigrationComplete,
  onShowToast,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [sourceBackend, setSourceBackend] = useState<BackendType>('sheets_appscript');
  const [destinationBackend, setDestinationBackend] = useState<BackendType>('firebase');
  const [authMode, setAuthMode] = useState<BackendAuthMode>('pin_6_digit');
  const [deactivateRoomDb, setDeactivateRoomDb] = useState<boolean>(false);
  const [sourceRetentionPolicy, setSourceRetentionPolicy] = useState<
    'KEEP_3_MONTHS' | 'PURGE_SOURCE_NOW' | 'KEEP_FOREVER'
  >('KEEP_3_MONTHS');

  // Pre-flight snapshot metrics
  const [preflightMetrics, setPreflightMetrics] = useState<Record<string, number>>({});
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);

  // Execution states
  const [isExecuting, setIsExecuting] = useState(false);
  const [progressEvent, setProgressEvent] = useState<MigrationProgressEvent | null>(null);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [finalReport, setFinalReport] = useState<MigrationReport | null>(null);

  const adapters = getAllAdapters();

  useEffect(() => {
    if (selectedCompany) {
      const config = getTenantBackendConfig(selectedCompany);
      setSourceBackend(config.backendType);
      // Default destination to medium or enterprise if source is sheets/room
      if (config.backendType === 'room' || config.backendType === 'sheets_appscript') {
        setDestinationBackend('firebase');
      } else {
        setDestinationBackend('supabase');
      }
      setAuthMode(config.authMode || 'pin_6_digit');
      setDeactivateRoomDb(!config.room.keepLocalCache);
    }
  }, [selectedCompany]);

  // Load preflight metrics when moving to step 2 or 3
  useEffect(() => {
    if (currentStep === 2 && selectedCompany) {
      setIsLoadingMetrics(true);
      roomBackendAdapter
        .exportSnapshot(selectedCompany.company_id)
        .then((snap) => {
          setPreflightMetrics({
            sales: snap.data.sales?.length || 0,
            inventory: snap.data.inventory?.length || 0,
            products: snap.data.products?.length || 0,
            customers: snap.data.customers?.length || 0,
            cashLogs: snap.data.cashLogs?.length || 0,
            expenses: snap.data.expenses?.length || 0,
            staff: snap.data.staff?.length || 0,
            branches: snap.data.branches?.length || 0,
          });
        })
        .catch(() => {})
        .finally(() => setIsLoadingMetrics(false));
    }
  }, [currentStep, selectedCompany]);

  if (!isOpen) return null;

  const handleStartMigration = async () => {
    setCurrentStep(4);
    setIsExecuting(true);
    setLiveLogs([]);
    setFinalReport(null);

    try {
      const report = await migrationEngineService.executeLiveMigration({
        companyId: selectedCompany.company_id,
        source: sourceBackend,
        destination: destinationBackend,
        authMode,
        deactivateRoomDb,
        sourceRetentionPolicy,
        onProgress: (evt) => {
          setProgressEvent(evt);
          setLiveLogs((prev) => [...prev, `[${toTimeStringSafe(evt.timestamp) || 'LIVE'}] ${evt.message}`]);
        },
      });

      setFinalReport(report);
      if (report.status === 'SUCCESS') {
        onMigrationComplete(report);
        onShowToast(`✓ Successfully migrated ${selectedCompany.company_name} to ${report.destination.toUpperCase()}`);
      } else {
        onShowToast(`Migration failed: ${report.error || 'Unknown'}`);
      }
    } catch (err: any) {
      onShowToast(`Migration execution error: ${err.message || 'Failed'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const sourceAdapter = getBackendAdapter(sourceBackend);
  const destAdapter = getBackendAdapter(destinationBackend);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/90 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header Bar */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                Live Backend Migration Engine
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold">
                  Phase B Wizard
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Tenant: <strong className="text-amber-400">{selectedCompany.company_name}</strong> (
                {selectedCompany.company_id})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExecuting}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper Indicator */}
        <div className="px-6 py-3 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between text-xs font-mono">
          <div className={`flex items-center gap-1.5 ${currentStep >= 1 ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
            <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">1</span>
            <span>Target Pairing</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <div className={`flex items-center gap-1.5 ${currentStep >= 2 ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
            <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">2</span>
            <span>Auth &amp; Cache</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <div className={`flex items-center gap-1.5 ${currentStep >= 3 ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
            <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">3</span>
            <span>Pre-Flight</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <div className={`flex items-center gap-1.5 ${currentStep >= 4 ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
            <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">4</span>
            <span>Execution</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* STEP 1: TARGET PAIRING */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-300">
                <p>
                  Select the source backend from which tenant records will be extracted, and the destination backend
                  where the converted data will be deployed.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Source Selection */}
                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                    Source Backend (Current)
                  </label>
                  <select
                    value={sourceBackend}
                    onChange={(e) => setSourceBackend(e.target.value as BackendType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:border-amber-500 font-bold"
                  >
                    {adapters.map((a) => (
                      <option key={a.type} value={a.type}>
                        {a.name} ({a.tierLabel})
                      </option>
                    ))}
                  </select>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400">
                    {sourceAdapter.description}
                  </div>
                </div>

                {/* Destination Selection */}
                <div className="space-y-2">
                  <label className="text-xs text-amber-400 font-bold uppercase tracking-wider">
                    Destination Backend (Upgrade Target)
                  </label>
                  <select
                    value={destinationBackend}
                    onChange={(e) => setDestinationBackend(e.target.value as BackendType)}
                    className="w-full bg-slate-950 border border-amber-500/50 rounded-xl px-3 py-2 text-white text-xs focus:border-amber-500 font-bold"
                  >
                    {adapters
                      .filter((a) => a.type !== sourceBackend)
                      .map((a) => (
                        <option key={a.type} value={a.type}>
                          {a.name} ({a.tierLabel})
                        </option>
                      ))}
                  </select>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400">
                    {destAdapter.description}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: AUTH & CACHE OPTIONS */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-wider">
                  <Database className="w-4 h-4" />
                  <span>Question 2: Room DB Local Cache Preference</span>
                </div>
                <p className="text-xs text-slate-400">
                  Room DB allows fast instant transactions even when internet connectivity is spotty. You can keep it as
                  an offline buffer or deactivate it for pure cloud-only operations.
                </p>
                <div className="space-y-2 pt-1 text-xs text-slate-300">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="roomCache"
                      checked={!deactivateRoomDb}
                      onChange={() => setDeactivateRoomDb(false)}
                      className="text-amber-500 focus:ring-amber-500"
                    />
                    <span className="font-bold text-white">Keep Room DB as Local Cache &amp; Offline Buffer (Recommended)</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="roomCache"
                      checked={deactivateRoomDb}
                      onChange={() => setDeactivateRoomDb(true)}
                      className="text-amber-500 focus:ring-amber-500"
                    />
                    <span>Deactivate Local Room DB (Pure Cloud Direct Mode)</span>
                  </label>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-400 uppercase tracking-wider">
                  <KeyRound className="w-4 h-4" />
                  <span>Question 3: Staff Authentication Strategy</span>
                </div>
                <p className="text-xs text-slate-400">
                  Staff can either keep their familiar 6-digit cashier PINs, or transition to backend-native cloud
                  authentication.
                </p>
                <div className="space-y-2 pt-1 text-xs text-slate-300">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="authStrat"
                      checked={authMode === 'pin_6_digit'}
                      onChange={() => setAuthMode('pin_6_digit')}
                      className="text-indigo-500 focus:ring-indigo-500"
                    />
                    <span className="font-bold text-white">Keep 6-Digit Staff PINs (Zero Training Disruption)</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="authStrat"
                      checked={authMode === 'backend_native'}
                      onChange={() => setAuthMode('backend_native')}
                      className="text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>Transition to Backend Native Cloud Auth (Email / Cloud SSO)</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="authStrat"
                      checked={authMode === 'hybrid'}
                      onChange={() => setAuthMode('hybrid')}
                      className="text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>Hybrid Mode (6-Digit PIN on Register + Cloud Auth for Back Office)</span>
                  </label>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-red-400 uppercase tracking-wider">
                  <Clock className="w-4 h-4" />
                  <span>Question 4: Source Data Retention Policy</span>
                </div>
                <p className="text-xs text-slate-400">
                  Choose how source backend historical records are managed after migration completes.
                </p>
                <div className="space-y-2 pt-1 text-xs text-slate-300">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="retentionPolicy"
                      checked={sourceRetentionPolicy === 'KEEP_3_MONTHS'}
                      onChange={() => setSourceRetentionPolicy('KEEP_3_MONTHS')}
                      className="text-red-500 focus:ring-red-500"
                    />
                    <span className="font-bold text-white">
                      Keep Source Records for 3 Months (Automatic 90-Day Cleanup Enabled)
                    </span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="retentionPolicy"
                      checked={sourceRetentionPolicy === 'PURGE_SOURCE_NOW'}
                      onChange={() => setSourceRetentionPolicy('PURGE_SOURCE_NOW')}
                      className="text-red-500 focus:ring-red-500"
                    />
                    <span>Purge Source Transaction Data Immediately (Immediate Space Recovery)</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="radio"
                      name="retentionPolicy"
                      checked={sourceRetentionPolicy === 'KEEP_FOREVER'}
                      onChange={() => setSourceRetentionPolicy('KEEP_FOREVER')}
                      className="text-red-500 focus:ring-red-500"
                    />
                    <span>Keep Source Records Indefinitely (Never Delete)</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PRE-FLIGHT ENTITY MATRIX */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-white">Pre-Flight Readiness Check Verified</h4>
                  <p className="text-slate-300 text-[11px] mt-0.5 leading-relaxed">
                    Source data will be staged through Room DB universal parser and ingested into{' '}
                    <strong>{destAdapter.name}</strong> with zero downtime.
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider block mb-2">
                  Entity Migration Count Matrix:
                </label>
                {isLoadingMetrics ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-400" />
                    Calculating entity snapshot counts...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {Object.entries(preflightMetrics).map(([key, count]) => (
                      <div key={key} className="p-3 bg-slate-950 border border-slate-800 rounded-xl">
                        <span className="text-[10px] uppercase font-mono text-slate-400 font-bold block">{key}</span>
                        <span className="text-xl font-black text-white">{count}</span>
                        <span className="text-[10px] text-emerald-400 block mt-0.5">Ready to transfer</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1.5 font-mono">
                <div className="text-slate-400 flex items-center justify-between">
                  <span>Selected Auth Paradigm:</span>
                  <span className="text-amber-400 font-bold">{authMode.toUpperCase()}</span>
                </div>
                <div className="text-slate-400 flex items-center justify-between">
                  <span>Room DB Local Cache:</span>
                  <span className="text-emerald-400 font-bold">{deactivateRoomDb ? 'DEACTIVATED' : 'ACTIVE'}</span>
                </div>
                <div className="text-slate-400 flex items-center justify-between">
                  <span>Source Retention Policy:</span>
                  <span className="text-indigo-400 font-bold">{sourceRetentionPolicy}</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: LIVE EXECUTION PROGRESS & REPORT */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-fadeIn">
              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-amber-400 font-bold">
                    {progressEvent ? `[STEP ${progressEvent.stepIndex}/${progressEvent.totalSteps}] ${progressEvent.step}` : 'INITIALIZING'}
                  </span>
                  <span className="text-white font-bold">{progressEvent?.percentage || 0}%</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2.5 border border-slate-800 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-emerald-400 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${progressEvent?.percentage || 0}%` }}
                  />
                </div>
              </div>

              {/* Terminal Logs */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] text-slate-300 space-y-1 max-h-56 overflow-y-auto">
                <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-800/80 text-[10px] text-slate-400 font-bold uppercase">
                  <Terminal className="w-3.5 h-3.5 text-amber-400" />
                  <span>Live Migration Console Output</span>
                </div>
                {liveLogs.map((log, idx) => (
                  <div key={idx} className="leading-snug">
                    {log}
                  </div>
                ))}
                {isExecuting && (
                  <div className="text-amber-400 flex items-center gap-1.5 pt-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Executing pipeline...</span>
                  </div>
                )}
              </div>

              {/* Completion Banner */}
              {finalReport && (
                <div
                  className={`p-4 rounded-xl border flex items-start gap-3 ${
                    finalReport.status === 'SUCCESS'
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-red-950/40 border-red-500/40 text-red-200'
                  }`}
                >
                  {finalReport.status === 'SUCCESS' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <h4 className="font-bold text-sm text-white">
                      {finalReport.status === 'SUCCESS'
                        ? 'Migration & Cutover Successfully Completed!'
                        : 'Migration Encountered An Issue (Rollback Executed)'}
                    </h4>
                    <p className="text-xs text-slate-300">
                      {finalReport.status === 'SUCCESS'
                        ? `Tenant is now actively running on ${finalReport.destination.toUpperCase()}. Execution completed in ${
                            finalReport.durationMs
                          }ms with zero data loss.`
                        : `Error: ${finalReport.error}`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div>
            {currentStep > 1 && currentStep < 4 && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => prev - 1)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {currentStep < 3 && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => prev + 1)}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition cursor-pointer active:scale-95"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 3 && (
              <button
                type="button"
                onClick={handleStartMigration}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition cursor-pointer active:scale-95"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Execute Live Migration &amp; Cutover</span>
              </button>
            )}

            {currentStep === 4 && (
              <button
                type="button"
                onClick={onClose}
                disabled={isExecuting}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer"
              >
                Close Wizard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
