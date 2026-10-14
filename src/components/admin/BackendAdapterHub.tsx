import React, { useState, useEffect } from 'react';
import {
  Server,
  Database,
  FileSpreadsheet,
  Flame,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  KeyRound,
  ShieldCheck,
  ArrowRightLeft,
  Sliders,
  ExternalLink,
  Cpu,
  Clock,
  Sparkles,
  Info,
  Activity,
  HeartPulse,
  ShieldAlert,
  Download,
  Upload,
  Undo2,
  Check,
  XCircle,
  Unplug,
} from 'lucide-react';
import { Company } from '../../data/saasData';
import {
  BackendType,
  BackendAuthMode,
  TenantBackendConfig,
  BackendConnectionTestResult,
  PruneResult,
  DriftAuditReport,
  DisasterRecoveryBackup,
  RollbackResult,
  CircuitBreakerStatus,
} from '../../services/backendAdapter/types';
import {
  getAllAdapters,
  getBackendAdapter,
  getTenantBackendConfig,
  saveTenantBackendConfig,
  checkPackageBackendAlignment,
  getRecommendedBackendForPackageTier,
} from '../../services/backendAdapter/adapterRegistry';
import { runtimeSyncDispatcher, RuntimeDispatchResult } from '../../services/backendAdapter/runtimeSyncDispatcher';
import { migrationFoundationEngine } from '../../services/backendAdapter/migrationFoundation';
import { retentionLifecycleService, PruneAuditRecord } from '../../services/backendAdapter/retentionService';
import { circuitBreakerFailover } from '../../services/backendAdapter/circuitBreakerFailover';
import { driftDetectionService } from '../../services/backendAdapter/driftDetectionService';
import { disasterRecoveryService } from '../../services/backendAdapter/disasterRecoveryService';
import { MigrationWizardModal } from './MigrationWizardModal';
import { MigrationReport } from '../../services/backendAdapter/types';
import { getCompanies, subscribeRoomDatabase } from '../../db/roomDatabase';

interface BackendAdapterHubProps {
  onShowToast: (message: string) => void;
}

export const BackendAdapterHub: React.FC<BackendAdapterHubProps> = ({ onShowToast }) => {
  const [companies, setCompanies] = useState<Company[]>(getCompanies());
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(
    () => getCompanies()[0]?.company_id || 'COMP-001'
  );

  // Active tenant configuration state
  const selectedCompany = companies.find((c) => c.company_id === selectedCompanyId) || companies[0];
  const [currentConfig, setCurrentConfig] = useState<TenantBackendConfig>(() =>
    selectedCompany ? getTenantBackendConfig(selectedCompany) : ({} as any)
  );

  // Testing & Action States
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<BackendConnectionTestResult | null>(null);
  const [isTestingDispatch, setIsTestingDispatch] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<RuntimeDispatchResult | null>(null);
  const [isPruning, setIsPruning] = useState(false);
  const [pruneResult, setPruneResult] = useState<PruneResult | null>(null);
  const [isGeneratingSnapshot, setIsGeneratingSnapshot] = useState(false);
  const [previewConversion, setPreviewConversion] = useState<any | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [pruneLogs, setPruneLogs] = useState<PruneAuditRecord[]>(() => retentionLifecycleService.getPruneAuditLogs());

  // Phase D States: Observability, Circuit Breaker, Drift Detection, Disaster Recovery
  const [circuitStatus, setCircuitStatus] = useState<CircuitBreakerStatus>(() =>
    circuitBreakerFailover.getStatus(selectedCompanyId, currentConfig.backendType || 'sheets_appscript')
  );
  const [driftReport, setDriftReport] = useState<DriftAuditReport | null>(null);
  const [isAuditingDrift, setIsAuditingDrift] = useState(false);
  const [isReconcilingDrift, setIsReconcilingDrift] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<{ success: boolean; message: string } | null>(null);
  const [backups, setBackups] = useState<DisasterRecoveryBackup[]>(() =>
    disasterRecoveryService.listBackups(selectedCompanyId)
  );
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);
  const [newBackupLabel, setNewBackupLabel] = useState('');
  const [confirmRollbackBackup, setConfirmRollbackBackup] = useState<DisasterRecoveryBackup | null>(null);

  // Update when company changes
  useEffect(() => {
    if (selectedCompany) {
      const cfg = getTenantBackendConfig(selectedCompany);
      setCurrentConfig(cfg);
      setCircuitStatus(circuitBreakerFailover.getStatus(selectedCompany.company_id, cfg.backendType));
      setBackups(disasterRecoveryService.listBackups(selectedCompany.company_id));
      setTestResult(null);
      setDispatchResult(null);
      setPruneResult(null);
      setPreviewConversion(null);
      setDriftReport(null);
      setReconcileResult(null);
      setRollbackResult(null);
    }
  }, [selectedCompanyId, selectedCompany]);

  // Subscribe to Room DB updates
  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      setCompanies(getCompanies());
    });
    return unsub;
  }, []);

  const adapters = getAllAdapters();
  const currentAdapter = getBackendAdapter(currentConfig.backendType || 'sheets_appscript');

  const handleBackendChange = (newType: BackendType) => {
    const updated = {
      ...currentConfig,
      backendType: newType,
    };
    setCurrentConfig(updated);
    saveTenantBackendConfig(selectedCompany.company_id, updated);
    onShowToast(`Backend adapter switched to ${getBackendAdapter(newType).name}`);
  };

  const handleSaveConfig = () => {
    saveTenantBackendConfig(selectedCompany.company_id, currentConfig);
    onShowToast(`✓ Backend configuration saved for ${selectedCompany.company_name}`);
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setTestResult(null);
    try {
      const adapter = getBackendAdapter(currentConfig.backendType);
      const res = await adapter.testConnection(currentConfig);
      setTestResult(res);
      if (res.success) {
        onShowToast(`✓ Connection successful! (${res.latencyMs || 0}ms)`);
      } else {
        onShowToast(`Connection check: ${res.message}`);
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        testedAt: new Date().toISOString(),
        message: err.message || 'Unknown network error',
      });
      onShowToast(`Connection error: ${err.message || 'Failed'}`);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleTestLiveDispatch = async () => {
    setIsTestingDispatch(true);
    setDispatchResult(null);
    try {
      const probeItem: any = {
        id: `PROBE-${Date.now()}`,
        action: 'INSERT',
        sheetName: 'AuditLog',
        timestamp: Date.now(),
        retries: 0,
        status: 'pending',
        payload: {
          id: `PROBE-${Date.now()}`,
          company_id: selectedCompany.company_id,
          branch_id: 'BR-MAIN',
          action: 'RUNTIME_PROBE',
          details: `Phase C runtime probe for ${currentAdapter.name}`,
          timestamp: new Date().toISOString(),
        },
      };

      const res = await runtimeSyncDispatcher.dispatchItem(probeItem);
      setDispatchResult(res);
      if (res.success) {
        onShowToast(`✓ Live dispatch successful (${res.latencyMs}ms) to ${res.backendType.toUpperCase()}`);
      } else {
        onShowToast(`Dispatch test notice: ${res.message}`);
      }
    } catch (err: any) {
      setDispatchResult({
        success: false,
        backendType: currentConfig.backendType,
        recordsProcessed: 0,
        latencyMs: 0,
        message: err.message || 'Dispatch probe failed',
        error: String(err),
      });
      onShowToast(`Dispatch test failed: ${err.message || 'Error'}`);
    } finally {
      setIsTestingDispatch(false);
    }
  };

  const handleExecuteManualPrune = async () => {
    const confirmed = window.confirm(
      `Execute manual data prune for "${selectedCompany.company_name}"?\n\nThis will purge sales, cash logs, and expenses older than ${currentConfig.retention.retentionMonths || 3} months. Master items, catalog, branches, and staff remain intact.`
    );
    if (!confirmed) return;

    setIsPruning(true);
    try {
      const res = await migrationFoundationEngine.pruneHistoricalRecords(
        selectedCompany.company_id,
        currentConfig.retention.retentionMonths || 3
      );
      setPruneResult(res);
      onShowToast(`✓ Pruned ${res.totalPrunedRecords} records older than 3 months`);
    } catch (err: any) {
      onShowToast(`Prune failed: ${err.message || 'Error'}`);
    } finally {
      setIsPruning(false);
    }
  };

  const handlePreviewMigrationSchema = async () => {
    setIsGeneratingSnapshot(true);
    try {
      const adapter = getBackendAdapter(currentConfig.backendType);
      const snapshot = await adapter.exportSnapshot(selectedCompany.company_id);
      const converted = migrationFoundationEngine.convertSnapshot(snapshot, currentConfig.backendType);
      setPreviewConversion({
        snapshot,
        converted,
      });
      onShowToast(`✓ Generated universal data representation for ${currentAdapter.name}`);
    } catch (err: any) {
      onShowToast(`Schema preview failed: ${err.message || 'Error'}`);
    } finally {
      setIsGeneratingSnapshot(false);
    }
  };

  // Phase D Action Handlers: Circuit Breaker, Drift Auditing & Disaster Recovery
  const handleTripCircuit = () => {
    circuitBreakerFailover.forceTripCircuit(selectedCompany.company_id, currentConfig.backendType);
    setCircuitStatus(circuitBreakerFailover.getStatus(selectedCompany.company_id, currentConfig.backendType));
    onShowToast(`⚠ Circuit breaker tripped for ${currentConfig.backendType}. Auto-failed over to Room DB.`);
  };

  const handleResetCircuit = () => {
    circuitBreakerFailover.forceResetCircuit(selectedCompany.company_id, currentConfig.backendType);
    setCircuitStatus(circuitBreakerFailover.getStatus(selectedCompany.company_id, currentConfig.backendType));
    onShowToast(`✓ Circuit breaker reset. Remote traffic restored for ${currentConfig.backendType}.`);
  };

  const handleRunDriftAudit = async () => {
    setIsAuditingDrift(true);
    setReconcileResult(null);
    try {
      const report = await driftDetectionService.runAudit(selectedCompany);
      setDriftReport(report);
      if (report.overallStatus === 'HEALTHY') {
        onShowToast('✓ Data Integrity Verified: 100% parity across Room DB and Remote tier!');
      } else {
        onShowToast(`⚠ Drift detected: ${report.totalDiscrepancies} records divergent.`);
      }
    } catch (err: any) {
      onShowToast(`Drift audit error: ${err.message || 'Error'}`);
    } finally {
      setIsAuditingDrift(false);
    }
  };

  const handleReconcileDrift = async () => {
    if (!driftReport) return;
    setIsReconcilingDrift(true);
    try {
      const res = await driftDetectionService.reconcileDrift(selectedCompany, driftReport);
      setReconcileResult(res);
      setDriftReport({
        ...driftReport,
        isReconciled: true,
        overallStatus: 'HEALTHY',
        totalDiscrepancies: 0,
      });
      onShowToast(res.message);
    } catch (err: any) {
      onShowToast(`Reconciliation error: ${err.message || 'Error'}`);
    } finally {
      setIsReconcilingDrift(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    setRollbackResult(null);
    try {
      const label = newBackupLabel.trim() || `Snapshot ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
      const backup = await disasterRecoveryService.createBackup(selectedCompany, label, 'MANUAL_SUPER_ADMIN');
      setBackups(disasterRecoveryService.listBackups(selectedCompany.company_id));
      setNewBackupLabel('');
      onShowToast(`✓ Created Recovery Point: "${backup.label}" (${(backup.sizeBytes / 1024).toFixed(1)} KB)`);
    } catch (err: any) {
      onShowToast(`Backup creation failed: ${err.message || 'Error'}`);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleExecuteRollback = async () => {
    if (!confirmRollbackBackup) return;
    setIsRollingBack(true);
    try {
      const res = await disasterRecoveryService.rollbackToBackup(confirmRollbackBackup.id);
      setRollbackResult(res);
      setConfirmRollbackBackup(null);
      if (res.success) {
        onShowToast(`✓ Emergency Rollback succeeded: Restored ${res.recordsRestored} records!`);
      } else {
        onShowToast(`Rollback notice: ${res.message}`);
      }
    } catch (err: any) {
      onShowToast(`Rollback failed: ${err.message || 'Error'}`);
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleExportBackup = (backup: DisasterRecoveryBackup) => {
    const json = disasterRecoveryService.exportBackupAsJson(backup);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${backup.companyId}_DR_Snapshot_${backup.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast(`✓ Downloaded DR archive for ${backup.companyName}`);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const imported = disasterRecoveryService.importBackupFromJson(content);
        setBackups(disasterRecoveryService.listBackups(selectedCompany.company_id));
        onShowToast(`✓ Imported recovery snapshot: "${imported.label}"`);
      } catch (err: any) {
        onShowToast(`Failed to parse backup archive: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const alignment = checkPackageBackendAlignment(selectedCompany);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Platform Architecture Notice */}
      <div className="bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-emerald-500/10 border border-amber-500/20 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                Multi-Tenant Backend Adapter &amp; Tier Engine
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950 uppercase tracking-wide">
                  Super Admin
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Seamlessly configure each tenant to run on the backend architecture that fits their size and subscription tier.
                Your existing <strong className="text-emerald-400">Google Apps Script</strong> setup is fully preserved as the{' '}
                <strong className="text-emerald-300">Starter Package Adapter</strong>, with zero disruptions to active webhooks.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-xs font-mono">
              Tier Architecture: <span className="text-emerald-400 font-bold">Phase A, B, C &amp; D Complete (Enterprise Resilient)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Package Tier to Backend Alignment Banner */}
      {!alignment.isAligned && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-amber-300 uppercase tracking-wide">
                  Package Alignment Recommendation
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold">
                  {selectedCompany.plan} Plan
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {alignment.recommendationMessage}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => handleBackendChange(alignment.recommendedBackend)}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition cursor-pointer"
            >
              Set to {getBackendAdapter(alignment.recommendedBackend).name}
            </button>
            <button
              type="button"
              onClick={() => setIsWizardOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition cursor-pointer"
            >
              Launch Migration Wizard
            </button>
          </div>
        </div>
      )}

      {/* 4 Package Tiers Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Tier 1: Free / Room DB */}
        <div
          className={`p-4 rounded-2xl border transition ${
            currentConfig.backendType === 'room'
              ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-500/10'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 rounded-xl bg-slate-800 text-amber-400">
              <Database className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-bold">
              FREE TIER
            </span>
          </div>
          <h4 className="text-sm font-bold text-white">Room Database</h4>
          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
            Offline-first Browser IndexedDB storage. Zero external server costs.
          </p>
          <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Accounts Needed:</span>
            <span className="text-emerald-400 font-bold">None (Instant)</span>
          </div>
        </div>

        {/* Tier 2: Starter / Sheets + Apps Script */}
        <div
          className={`p-4 rounded-2xl border transition ${
            currentConfig.backendType === 'sheets_appscript'
              ? 'bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/10'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 rounded-xl bg-slate-800 text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
              STARTER TIER
            </span>
          </div>
          <h4 className="text-sm font-bold text-white">Sheets + Apps Script</h4>
          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
            Direct sync to Google Spreadsheet via Apps Script Webhook. Transparent data.
          </p>
          <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Current Status:</span>
            <span className="text-emerald-400 font-bold">Active &amp; Linked</span>
          </div>
        </div>

        {/* Tier 3: Medium / Firebase */}
        <div
          className={`p-4 rounded-2xl border transition ${
            currentConfig.backendType === 'firebase'
              ? 'bg-amber-500/10 border-amber-500/40 shadow-lg shadow-amber-500/10'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 rounded-xl bg-slate-800 text-amber-500">
              <Flame className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
              MEDIUM TIER
            </span>
          </div>
          <h4 className="text-sm font-bold text-white">Google Firebase</h4>
          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
            Cloud Firestore real-time NoSQL document collections. Granular sub-collections.
          </p>
          <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Code-Free Link:</span>
            <span className="text-indigo-400 font-bold">Ready for Keys</span>
          </div>
        </div>

        {/* Tier 4: Enterprise / Supabase */}
        <div
          className={`p-4 rounded-2xl border transition ${
            currentConfig.backendType === 'supabase'
              ? 'bg-indigo-500/10 border-indigo-500/40 shadow-lg shadow-indigo-500/10'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 rounded-xl bg-slate-800 text-indigo-400">
              <Zap className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold">
              ENTERPRISE TIER
            </span>
          </div>
          <h4 className="text-sm font-bold text-white">Supabase (PostgreSQL)</h4>
          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
            Enterprise Relational SQL tables with Row-Level Security (RLS) tenant isolation.
          </p>
          <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Code-Free Link:</span>
            <span className="text-indigo-400 font-bold">Ready for URL</span>
          </div>
        </div>
      </div>

      {/* Tenant Selector & Configurator */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <label className="text-xs text-slate-400 font-medium">Select Tenant for Backend Adapter Configuration:</label>
            <div className="flex items-center gap-3 mt-1.5">
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white font-bold focus:outline-none focus:border-amber-500 cursor-pointer min-w-[260px]"
              >
                {companies.map((c) => (
                  <option key={c.company_id} value={c.company_id}>
                    {c.company_name} ({c.company_id}) — {c.plan}
                  </option>
                ))}
              </select>
              <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-slate-800 text-slate-300">
                Plan: {selectedCompany?.plan}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveConfig}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Save Configuration</span>
            </button>
          </div>
        </div>

        {/* Adapter Switcher Radio/Tabs */}
        <div>
          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider block mb-2">
            Assigned Backend Target for {selectedCompany?.company_name}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {adapters.map((ad) => {
              const isActive = currentConfig.backendType === ad.type;
              return (
                <button
                  key={ad.type}
                  type="button"
                  onClick={() => handleBackendChange(ad.type)}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    isActive
                      ? 'bg-amber-500/20 border-amber-500 text-white font-bold shadow-md shadow-amber-500/10'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs">{ad.name.split(' ')[0]}</span>
                    {isActive && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{ad.tierLabel}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Credentials & Settings Form depending on selected Adapter */}
        <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                {currentAdapter.name} — Credentials &amp; Connectivity
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTestingConnection ? 'animate-spin' : ''}`} />
                <span>{isTestingConnection ? 'Testing...' : 'Test Connection'}</span>
              </button>
              <button
                type="button"
                onClick={handleTestLiveDispatch}
                disabled={isTestingDispatch}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                title="Send a live runtime sync probe through the active backend adapter"
              >
                <Zap className={`w-3.5 h-3.5 ${isTestingDispatch ? 'animate-spin' : ''}`} />
                <span>{isTestingDispatch ? 'Probing...' : 'Test Runtime Dispatch'}</span>
              </button>
            </div>
          </div>

          {/* Test Feedback Banner */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <div className="font-bold flex items-center gap-2">
                  <span>{testResult.message}</span>
                  {testResult.latencyMs !== undefined && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-300">
                      {testResult.latencyMs}ms latency
                    </span>
                  )}
                </div>
                {testResult.details && (
                  <pre className="text-[10px] font-mono text-slate-400 overflow-x-auto">
                    {JSON.stringify(testResult.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Runtime Dispatch Feedback Banner */}
          {dispatchResult && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                dispatchResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              }`}
            >
              {dispatchResult.success ? (
                <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 space-y-1">
                <div className="font-bold flex items-center gap-2">
                  <span>{dispatchResult.message}</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-300">
                    {dispatchResult.latencyMs}ms latency
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 uppercase">
                    {dispatchResult.backendType}
                  </span>
                </div>
                {dispatchResult.error && (
                  <p className="text-[10px] font-mono text-rose-300">{dispatchResult.error}</p>
                )}
              </div>
            </div>
          )}

          {/* 1. Sheets & Apps Script Form */}
          {currentConfig.backendType === 'sheets_appscript' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-slate-400 font-medium">Google Apps Script Webhook URL:</label>
                <input
                  type="text"
                  value={currentConfig.sheets.webhookUrl || ''}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      sheets: { ...currentConfig.sheets, webhookUrl: e.target.value },
                    })
                  }
                  placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
                <p className="text-[11px] text-slate-400">
                  Matches your existing Code.gs deployment. All branch POS tickets post to this webhook.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Dedicated Spreadsheet File ID:</label>
                <input
                  type="text"
                  value={currentConfig.sheets.spreadsheetId || ''}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      sheets: { ...currentConfig.sheets, spreadsheetId: e.target.value },
                    })
                  }
                  placeholder="1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Branch Isolation Mode:</label>
                <select
                  value={currentConfig.sheets.isolationMode || 'ROW_LEVEL'}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      sheets: {
                        ...currentConfig.sheets,
                        isolationMode: e.target.value as any,
                      },
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:border-amber-500 focus:outline-none"
                >
                  <option value="ROW_LEVEL">ROW_LEVEL (Single Master Sheet with branch tags)</option>
                  <option value="BRANCH_TABS">BRANCH_TABS (Separate Tab per branch)</option>
                  <option value="HYBRID">HYBRID (Dedicated Sheet per Branch)</option>
                </select>
              </div>
            </div>
          )}

          {/* 2. Room DB Form */}
          {currentConfig.backendType === 'room' && (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                <p className="leading-relaxed">
                  Room DB runs directly within the client browser via IndexedDB and local memory cache. It requires zero
                  external API tokens or cloud database instances.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-slate-400 font-medium">Local Cache Quota (MB):</label>
                  <input
                    type="number"
                    value={currentConfig.room.quotaMb || 50}
                    onChange={(e) =>
                      setCurrentConfig({
                        ...currentConfig,
                        room: { ...currentConfig.room, quotaMb: Number(e.target.value) },
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="idbEnabled"
                    checked={currentConfig.room.indexedDbEnabled}
                    onChange={(e) =>
                      setCurrentConfig({
                        ...currentConfig,
                        room: { ...currentConfig.room, indexedDbEnabled: e.target.checked },
                      })
                    }
                    className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500"
                  />
                  <label htmlFor="idbEnabled" className="text-slate-300 cursor-pointer">
                    Enable IndexedDB persistent background storage
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* 3. Firebase Form (Code-Free Linking) */}
          {currentConfig.backendType === 'firebase' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="sm:col-span-2 p-3 bg-indigo-950/30 border border-indigo-500/20 rounded-xl text-indigo-200">
                <p className="flex items-center gap-1.5 font-bold mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Code-Free Linking Prepared
                </p>
                <p className="text-[11px] text-slate-300">
                  When you create your Google Firebase account, simply paste your Project ID below. The backend adapter
                  will immediately begin routing transactions without editing any application source code.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Firebase Project ID:</label>
                <input
                  type="text"
                  value={currentConfig.firebase.projectId || ''}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      firebase: { ...currentConfig.firebase, projectId: e.target.value },
                    })
                  }
                  placeholder="e.g. saimetric-pos-prod"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Firestore Region:</label>
                <input
                  type="text"
                  value={currentConfig.firebase.firestoreRegion || 'us-central1'}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      firebase: { ...currentConfig.firebase, firestoreRegion: e.target.value },
                    })
                  }
                  placeholder="us-central1"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="text-slate-400 font-medium">Web API Key (Optional):</label>
                <input
                  type="text"
                  value={currentConfig.firebase.apiKey || ''}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      firebase: { ...currentConfig.firebase, apiKey: e.target.value },
                    })
                  }
                  placeholder="AIzaSy..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* 4. Supabase Form (Code-Free Linking) */}
          {currentConfig.backendType === 'supabase' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="sm:col-span-2 p-3 bg-indigo-950/30 border border-indigo-500/20 rounded-xl text-indigo-200">
                <p className="flex items-center gap-1.5 font-bold mb-1">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  Code-Free Supabase Linking Prepared
                </p>
                <p className="text-[11px] text-slate-300">
                  When you create your Supabase project, paste your Project URL and Anon Key. The adapter handles PostgreSQL
                  schema tables with Row-Level Security automatically.
                </p>
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="text-slate-400 font-medium">Supabase Project URL:</label>
                <input
                  type="text"
                  value={currentConfig.supabase.projectUrl || ''}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      supabase: { ...currentConfig.supabase, projectUrl: e.target.value },
                    })
                  }
                  placeholder="https://xyzabcdefg.supabase.co"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="text-slate-400 font-medium">Anon / Public API Key:</label>
                <input
                  type="text"
                  value={currentConfig.supabase.anonKey || ''}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      supabase: { ...currentConfig.supabase, anonKey: e.target.value },
                    })
                  }
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* 3 Core Architecture Controls: Room DB Deactivation, Auth PIN Strategy, 3-Month Retention */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {/* Question 2: Room DB Option to Deactivate */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
              <Database className="w-4 h-4" />
              <span>Room DB Local Cache</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Room DB maintains an instant offline buffer. You can deactivate it for pure remote operations.
            </p>
            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-white">
                <input
                  type="checkbox"
                  checked={currentConfig.room.keepLocalCache}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      room: { ...currentConfig.room, keepLocalCache: e.target.checked },
                    })
                  }
                  className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500"
                />
                <span className="font-medium">
                  {currentConfig.room.keepLocalCache ? 'Local Cache Active (Recommended)' : 'Local Cache Deactivated'}
                </span>
              </label>
            </div>
          </div>

          {/* Question 3: 6-Digit PIN vs Backend Auth */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
              <KeyRound className="w-4 h-4" />
              <span>Authentication Mode</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Keep 6-digit staff PINs or switch to backend-native authentication when moving to Firebase/Supabase.
            </p>
            <div className="pt-1">
              <select
                value={currentConfig.authMode}
                onChange={(e) =>
                  setCurrentConfig({
                    ...currentConfig,
                    authMode: e.target.value as BackendAuthMode,
                  })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="pin_6_digit">6-Digit Staff PIN (Default)</option>
                <option value="backend_native">Backend Native Auth (Cloud Email/SSO)</option>
                <option value="hybrid">Hybrid (6-Digit PIN + Cloud Fallback)</option>
              </select>
            </div>
          </div>

          {/* Question 4: 3-Month Retention & Auto Delete */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center gap-2 text-red-400 text-xs font-bold uppercase tracking-wider">
              <Clock className="w-4 h-4" />
              <span>3-Month Data Retention</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Auto-delete historical records after 3 months, or run immediate manual prune on demand.
            </p>
            <div className="pt-1 flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-white">
                <input
                  type="checkbox"
                  checked={currentConfig.retention.autoDeleteEnabled}
                  onChange={(e) =>
                    setCurrentConfig({
                      ...currentConfig,
                      retention: { ...currentConfig.retention, autoDeleteEnabled: e.target.checked },
                    })
                  }
                  className="rounded bg-slate-900 border-slate-700 text-red-500 focus:ring-red-500"
                />
                <span>Auto-Delete (3 Mo.)</span>
              </label>

              <button
                type="button"
                onClick={handleExecuteManualPrune}
                disabled={isPruning}
                className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
              >
                <Trash2 className="w-3 h-3" />
                <span>{isPruning ? 'Pruning...' : 'Prune Now'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Prune Feedback */}
        {pruneResult && (
          <div className="p-3 bg-red-950/30 border border-red-500/30 rounded-xl text-xs text-red-200 flex items-center justify-between">
            <div>
              <span className="font-bold">✓ Manual Data Prune Completed: </span>
              <span>
                Purged {pruneResult.totalPrunedRecords} records older than {pruneResult.retentionCutoffDate.split('T')[0]}{' '}
                (Sales: {pruneResult.details.sales}, Cash: {pruneResult.details.cashLogs}, Expenses:{' '}
                {pruneResult.details.expenses}).
              </span>
            </div>
            <span className="font-mono text-[10px] text-slate-400">
              {new Date(pruneResult.prunedAt).toLocaleTimeString()}
            </span>
          </div>
        )}

        {/* Migration Staging & Universal Conversion Preview */}
        <div className="pt-4 border-t border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-amber-400" />
                Live Cross-Backend Migration Engine (Phase B)
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Migrate tenant data with zero code edits. Room DB extracts all records, converts schemas, and verifies zero data loss.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePreviewMigrationSchema}
                disabled={isGeneratingSnapshot}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer self-start sm:self-auto"
              >
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span>{isGeneratingSnapshot ? 'Extracting...' : 'Preview Schema'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsWizardOpen(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 text-xs font-black flex items-center gap-2 shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4" />
                <span>Launch Live Migration Wizard</span>
              </button>
            </div>
          </div>

          {previewConversion && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs space-y-2">
              <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
                <span className="text-amber-400 font-bold">Target Paradigm: {previewConversion.converted.summary}</span>
                <span>Entities Processed: {previewConversion.converted.entityCount}</span>
              </div>
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800/80 font-mono text-[10px] text-slate-400 max-h-40 overflow-y-auto">
                <pre>{JSON.stringify(previewConversion.converted.payload, null, 2)}</pre>
              </div>
            </div>
          )}

          {/* Retention & Prune Audit Trail */}
          <div className="pt-3 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-red-400" />
                <span>3-Month Retention Cleanup Audit Trail</span>
              </h5>
              <button
                type="button"
                onClick={() => setPruneLogs(retentionLifecycleService.getPruneAuditLogs())}
                className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh History</span>
              </button>
            </div>

            {pruneLogs.length === 0 ? (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60 text-center text-[11px] text-slate-500">
                No past records have been pruned yet. Historical data is maintained according to the active 3-month retention policy.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {pruneLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] flex items-center justify-between"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{log.tenantName}</span>
                        <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                          {log.executionType}
                        </span>
                      </div>
                      <div className="text-slate-400 text-[10px]">
                        Purged {log.totalPruned} items (Sales: {log.details.sales}, Cash: {log.details.cashLogs}, Expenses:{' '}
                        {log.details.expenses}) older than {log.cutoffDate.split('T')[0]}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                      {new Date(log.executedAt).toLocaleDateString()} {new Date(log.executedAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* PHASE D: ENTERPRISE OBSERVABILITY & CIRCUIT BREAKER HEALTH MONITOR    */}
      {/* ===================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                Phase D: Circuit Breaker &amp; Health Telemetry Monitor
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300">
                  Resilience v4
                </span>
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Real-time fault tolerance engine. If remote cloud latency surges or fails, traffic automatically fails over to offline Room DB with zero POS downtime.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={circuitStatus.state === 'OPEN' ? handleResetCircuit : handleTripCircuit}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md ${
                circuitStatus.state === 'OPEN'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                  : 'bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40'
              }`}
            >
              {circuitStatus.state === 'OPEN' ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Reset Breaker &amp; Restore Remote</span>
                </>
              ) : (
                <>
                  <Unplug className="w-3.5 h-3.5" />
                  <span>Test Failover (Trip Circuit)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 4 Backends Telemetry Matrix */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {adapters.map((ad) => {
            const isAssigned = currentConfig.backendType === ad.type;
            const status = circuitBreakerFailover.getStatus(selectedCompany.company_id, ad.type);
            const isTripped = status.state === 'OPEN';

            return (
              <div
                key={ad.type}
                className={`p-3.5 rounded-xl border transition ${
                  isAssigned
                    ? 'bg-slate-950 border-amber-500/40 shadow-md shadow-amber-500/5'
                    : 'bg-slate-950/60 border-slate-800/80 opacity-80'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    {ad.name.split(' ')[0]}
                    {isAssigned && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-500 text-slate-950 text-[9px] font-black uppercase">
                        Active
                      </span>
                    )}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      ad.type === 'room'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : isTripped
                        ? 'bg-rose-500/20 text-rose-400 animate-pulse'
                        : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {ad.type === 'room' ? 'ONLINE (LOCAL)' : isTripped ? 'CIRCUIT OPEN' : 'CIRCUIT CLOSED'}
                  </span>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Failover Status:</span>
                    <span
                      className={`font-mono font-bold ${
                        isTripped ? 'text-amber-400' : 'text-slate-300'
                      }`}
                    >
                      {ad.type === 'room'
                        ? 'Anchor Buffer'
                        : isTripped
                        ? 'Traffic to Room DB'
                        : 'Direct Routing'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Consecutive Errors:</span>
                    <span
                      className={`font-mono ${
                        status.consecutiveFailures > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'
                      }`}
                    >
                      {status.consecutiveFailures} / {status.failureThreshold}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Successful Pushes:</span>
                    <span className="font-mono text-emerald-400 font-bold">{status.successCount}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* PHASE D: CROSS-BACKEND DRIFT DETECTION & SELF-HEALING RECONCILIATION  */}
      {/* ===================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                Phase D: Cross-Backend Drift Detection &amp; Self-Healing
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300">
                  Data Parity Auditor
                </span>
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Compare record checksums between local Room DB and {currentAdapter.name}. Automatically reconcile desynchronized items with 1 click.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRunDriftAudit}
              disabled={isAuditingDrift}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAuditingDrift ? 'animate-spin' : ''}`} />
              <span>{isAuditingDrift ? 'Auditing Entities...' : 'Run Integrity Audit'}</span>
            </button>
            {driftReport && driftReport.totalDiscrepancies > 0 && (
              <button
                type="button"
                onClick={handleReconcileDrift}
                disabled={isReconcilingDrift}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-emerald-600/20"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isReconcilingDrift ? 'animate-spin' : ''}`} />
                <span>{isReconcilingDrift ? 'Reconciling...' : 'Auto-Reconcile Drift'}</span>
              </button>
            )}
          </div>
        </div>

        {reconcileResult && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              reconcileResult.success
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-bold">{reconcileResult.message}</span>
          </div>
        )}

        {driftReport ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    driftReport.overallStatus === 'HEALTHY'
                      ? 'bg-emerald-400'
                      : driftReport.overallStatus === 'DRIFT_WARNING'
                      ? 'bg-amber-400 animate-ping'
                      : 'bg-rose-400'
                  }`}
                />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Audit Status: {driftReport.overallStatus}
                </span>
                <span className="text-slate-400 text-xs">— {driftReport.suggestedResolution}</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                Audited: {new Date(driftReport.auditedAt).toLocaleTimeString()}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
              {driftReport.discrepancies.map((disc) => (
                <div
                  key={disc.entityType}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-300 text-[11px]">{disc.displayName}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                        disc.status === 'IN_SYNC'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {disc.status === 'IN_SYNC' ? 'PARITY' : `${disc.discrepancyCount} DIFF`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Local Room DB:</span>
                    <span className="font-mono text-white font-bold">{disc.localCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{currentAdapter.name.split(' ')[0]}:</span>
                    <span className="font-mono text-emerald-400 font-bold">{disc.remoteCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60 text-center text-xs text-slate-400">
            Click <strong>"Run Integrity Audit"</strong> to scan Sales Orders, Inventory, Customer records, and Cash logs for cross-backend parity.
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* PHASE D: DISASTER RECOVERY VAULT & 1-CLICK ROLLBACK ENGINE            */}
      {/* ===================================================================== */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                Phase D: Disaster Recovery &amp; Snapshot Vault
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300">
                  Zero Data Loss
                </span>
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Generate immutable recovery checkpoints and execute 1-Click Rollbacks in case of unexpected remote cloud incidents.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span>Import Cold Bundle</span>
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>
          </div>
        </div>

        {/* Create Backup Input */}
        <div className="flex flex-col sm:flex-row items-center gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800">
          <input
            type="text"
            value={newBackupLabel}
            onChange={(e) => setNewBackupLabel(e.target.value)}
            placeholder={`Label for new recovery checkpoint (e.g. Pre-Promotion Snapshot)...`}
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={handleCreateBackup}
            disabled={isCreatingBackup}
            className="w-full sm:w-auto px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-md shadow-amber-500/20 shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{isCreatingBackup ? 'Saving Snapshot...' : 'Create Recovery Point'}</span>
          </button>
        </div>

        {rollbackResult && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
              rollbackResult.success
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-bold">{rollbackResult.message}</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              {new Date(rollbackResult.restoredAt).toLocaleTimeString()}
            </span>
          </div>
        )}

        {/* Backups List */}
        <div className="space-y-2">
          {backups.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60 text-center text-xs text-slate-500">
              No recovery snapshots saved yet for {selectedCompany.company_name}. Create a checkpoint above before major migrations or seasonal cutovers.
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {backups.map((bk) => (
                <div
                  key={bk.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{bk.label}</span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-amber-300">
                        {bk.backendSource.toUpperCase()}
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-700 text-[9px] font-mono text-slate-400">
                        {bk.checksum}
                      </span>
                    </div>
                    <div className="text-slate-400 text-[11px] flex items-center gap-3">
                      <span>Records: {bk.totalRecords} (Sales: {bk.snapshot.metrics.totalSales}, Items: {bk.snapshot.metrics.totalInventoryItems})</span>
                      <span>Size: {(bk.sizeBytes / 1024).toFixed(1)} KB</span>
                      <span>Created: {new Date(bk.createdAt).toLocaleDateString()} {new Date(bk.createdAt).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => handleExportBackup(bk)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                      title="Download cold storage JSON bundle"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRollbackBackup(bk)}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>1-Click Rollback</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for 1-Click Rollback */}
      {confirmRollbackBackup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-rose-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-800 text-rose-400">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Emergency Rollback Confirmation</h3>
                <p className="text-xs text-rose-300">Point-in-Time Database Restoration</p>
              </div>
            </div>

            <div className="text-xs text-slate-300 space-y-2">
              <p>
                You are about to restore <strong>{confirmRollbackBackup.companyName}</strong> to recovery point{' '}
                <strong className="text-white">"{confirmRollbackBackup.label}"</strong> created on{' '}
                <span className="font-mono text-amber-300">
                  {new Date(confirmRollbackBackup.createdAt).toLocaleString()}
                </span>.
              </p>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-400 space-y-1">
                <div>Total Entities to Re-hydrate: {confirmRollbackBackup.totalRecords}</div>
                <div>Sales Orders: {confirmRollbackBackup.snapshot.metrics.totalSales}</div>
                <div>Inventory Items: {confirmRollbackBackup.snapshot.metrics.totalInventoryItems}</div>
                <div>Integrity Checksum: {confirmRollbackBackup.checksum}</div>
              </div>
              <p className="text-rose-300 text-[11px]">
                ⚠ Current operational records created after this checkpoint will be replaced with the snapshot data.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmRollbackBackup(null)}
                disabled={isRollingBack}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRollback}
                disabled={isRollingBack}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-rose-600/20"
              >
                <Undo2 className={`w-3.5 h-3.5 ${isRollingBack ? 'animate-spin' : ''}`} />
                <span>{isRollingBack ? 'Restoring Database...' : 'Confirm & Restore'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Migration Wizard Modal */}
      {isWizardOpen && (
        <MigrationWizardModal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          selectedCompany={selectedCompany}
          onMigrationComplete={(report) => {
            setCurrentConfig(getTenantBackendConfig(selectedCompany));
            onShowToast(`✓ Migrated to ${report.destination.toUpperCase()}`);
          }}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};
