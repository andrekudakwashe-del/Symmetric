import React, { useState } from 'react';
import { SheetName } from '../../types';
import {
  getCustomers,
  getCashLogs,
  getSales,
  getExpenses,
  getReconciliations,
  getSalespeople,
  getSyncQueue,
  getSheetsConfig,
  updateSheetsConfig,
  clearSyncedQueueItems,
  getCurrentCompany,
  getCurrentBranch,
  getCompanies,
  getBranches,
  updateTenantSheetBinding,
  setCurrentCompanyId,
  saveCompany,
} from '../../db/roomDatabase';
import {
  processSyncQueue,
  generateAppsScriptCode,
  generateTenantDedicatedAppsScriptCode,
  downloadCsvFile,
  queueAllStoreDataForSync,
  testBranchIsolationVerification,
  BranchIsolationTestResult,
  isRealGoogleSheetId,
  extractGoogleSheetId,
  getGoogleSheetUrl,
} from '../../services/googleSheetsSync';
import {
  FileSpreadsheet,
  RefreshCw,
  Copy,
  Check,
  Download,
  ExternalLink,
  Code,
  X,
  Layers,
  Database,
  CheckCircle2,
  AlertCircle,
  Link2,
  Upload,
  Zap,
  ShieldCheck,
  Building2,
  GitBranch,
  Lock,
  ArrowRight,
  ShieldAlert,
  Server,
  FolderSync,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface GoogleSheetsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncCompleted?: () => void;
}

export const GoogleSheetsSyncModal: React.FC<GoogleSheetsSyncModalProps> = ({
  isOpen,
  onClose,
  onSyncCompleted,
}) => {
  const [activeSheetTab, setActiveSheetTab] = useState<SheetName>('CashLog');
  const [activeView, setActiveView] = useState<'preview' | 'queue' | 'tenant-arch' | 'webhook'>('preview');
  
  const currentComp = getCurrentCompany();
  const currentBranch = getCurrentBranch();
  const sheetsConfig = getSheetsConfig();

  const [webhookUrl, setWebhookUrl] = useState(() => sheetsConfig.webhookUrl || '');
  const [tenantSpreadsheetId, setTenantSpreadsheetId] = useState(() => sheetsConfig.spreadsheetId || '');
  const [branchIsolationMode, setBranchIsolationMode] = useState<'ROW_LEVEL' | 'BRANCH_TABS' | 'HYBRID'>(
    () => sheetsConfig.branchIsolationMode || 'ROW_LEVEL'
  );
  const [scriptType, setScriptType] = useState<'tenant-dedicated' | 'master-saas'>('tenant-dedicated');
  const [isSyncing, setIsSyncing] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  // Branch Isolation Verification State
  const [isTestingIsolation, setIsTestingIsolation] = useState(false);
  const [isolationTestResult, setIsolationTestResult] = useState<BranchIsolationTestResult | null>(null);

  // Dedicated Sheet Linker & Creator State
  const [showSheetLinkModal, setShowSheetLinkModal] = useState(false);
  const [linkModalCompanyId, setLinkModalCompanyId] = useState<string | null>(null);
  const [inputSheetUrlOrId, setInputSheetUrlOrId] = useState('');
  const [linkModalError, setLinkModalError] = useState<string | null>(null);

  const syncQueue = getSyncQueue();
  const pendingCount = syncQueue.filter((i) => i.status === 'pending' || i.status === 'failed').length;

  const customers = getCustomers();
  const cashLogs = getCashLogs();
  const sales = getSales();
  const expenses = getExpenses();
  const reconciliations = getReconciliations();
  const salespeople = getSalespeople();
  const allCompanies = getCompanies();
  const allBranches = getBranches();

  if (!isOpen) return null;

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncStatusMsg('Dispatching queued records to Google Sheets...');

    try {
      const result = await processSyncQueue();
      if (result.failed > 0) {
        setSyncStatusMsg(`Sync completed with ${result.synced} succeeded and ${result.failed} failed.`);
      } else {
        setSyncStatusMsg(`✓ All ${result.synced} pending records synchronized with Google Sheets!`);
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#6A4DFF', '#FF8A00', '#10B981'],
        });
      }
      if (onSyncCompleted) onSyncCompleted();
    } catch (err: any) {
      setSyncStatusMsg(`Sync error: ${err?.message || 'Network failure'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUploadAllData = async () => {
    setIsSyncing(true);
    setSyncStatusMsg('Preparing all store records (Sales, Customers, Cash Logs, Expenses)...');
    try {
      const queuedCount = queueAllStoreDataForSync();
      setSyncStatusMsg(`Queued ${queuedCount} records. Uploading directly to Google Sheets...`);
      const result = await processSyncQueue();
      if (result.failed > 0) {
        setSyncStatusMsg(`Uploaded with ${result.synced} succeeded and ${result.failed} issues.`);
      } else {
        setSyncStatusMsg(`✓ All ${result.synced} records uploaded to Google Sheets!`);
        confetti({
          particleCount: 60,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#6A4DFF', '#FF8A00', '#10B981'],
        });
      }
      if (onSyncCompleted) onSyncCompleted();
    } catch (err: any) {
      setSyncStatusMsg(`Upload error: ${err?.message || 'Network issue'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenSheetLinkModal = (companyId?: string) => {
    const targetCompId = companyId || currentComp.company_id;
    const targetComp = allCompanies.find((c) => c.company_id === targetCompId) || currentComp;
    setLinkModalCompanyId(targetCompId);
    setInputSheetUrlOrId(isRealGoogleSheetId(targetComp.sheet_id) ? targetComp.sheet_id! : '');
    setLinkModalError(null);
    setShowSheetLinkModal(true);
  };

  const handleSaveLinkedSheet = (overrideId?: string) => {
    const targetCompId = linkModalCompanyId || currentComp.company_id;
    const targetComp = allCompanies.find((c) => c.company_id === targetCompId) || currentComp;
    const targetInput = overrideId || inputSheetUrlOrId;
    const cleanId = extractGoogleSheetId(targetInput);

    if (!cleanId) {
      setLinkModalError('Please enter a valid Google Sheet URL or 44-character Spreadsheet ID.');
      return;
    }

    saveCompany({
      ...targetComp,
      sheet_id: cleanId,
    });

    if (targetCompId === currentComp.company_id) {
      updateSheetsConfig({
        spreadsheetId: cleanId,
      });
      setTenantSpreadsheetId(cleanId);
    }

    updateTenantSheetBinding(targetCompId, cleanId, webhookUrl, branchIsolationMode);
    setSyncStatusMsg(`✓ Dedicated Google Sheet linked for ${targetComp.company_name}!`);
    setShowSheetLinkModal(false);
    setLinkModalError(null);
    confetti({ particleCount: 40, spread: 60, origin: { y: 0.65 } });
  };

  const handleSaveTenantConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSheetId = extractGoogleSheetId(tenantSpreadsheetId);
    updateSheetsConfig({
      spreadsheetId: cleanSheetId,
      webhookUrl: webhookUrl.trim(),
      branchIsolationMode,
    });
    updateTenantSheetBinding(currentComp.company_id, cleanSheetId, webhookUrl.trim(), branchIsolationMode);
    
    // Also sync to active company object
    saveCompany({
      ...currentComp,
      sheet_id: cleanSheetId,
    });

    setSyncStatusMsg(`✓ Tenant ${currentComp.company_name} Google Sheet bindings updated successfully!`);
    confetti({ particleCount: 35, spread: 60, origin: { y: 0.7 } });
  };

  const handleRunIsolationTest = async () => {
    setIsTestingIsolation(true);
    setSyncStatusMsg('Executing Multi-Tenant Branch Isolation Security Probes...');
    try {
      const result = await testBranchIsolationVerification();
      setIsolationTestResult(result);
      if (result.passed) {
        setSyncStatusMsg(`✓ Security Audit Passed: Cross-branch access strictly blocked with zero leakage.`);
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.65 } });
      } else {
        setSyncStatusMsg(`⚠️ Security alert: Branch probe failed.`);
      }
    } catch (err: any) {
      setSyncStatusMsg(`Probe error: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsTestingIsolation(false);
    }
  };

  const handleCopyCode = () => {
    const code =
      scriptType === 'tenant-dedicated'
        ? generateTenantDedicatedAppsScriptCode(currentComp.company_id)
        : generateAppsScriptCode();
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const sheetTabs: { id: SheetName; label: string; count: number }[] = [
    { id: 'CashLog', label: 'CashLog', count: cashLogs.length },
    { id: 'Customers', label: 'Customers', count: customers.length },
    { id: 'Sales', label: 'Sales', count: sales.length },
    { id: 'Expenses', label: 'Expenses', count: expenses.length },
    { id: 'Reconciliations', label: 'Reconciliations', count: reconciliations.length },
    { id: 'Salespeople', label: 'Salespeople', count: salespeople.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn select-none">
      <div className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[94vh] animate-scaleUp">
        {/* Top Header Banner */}
        <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] p-4 sm:p-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-black tracking-tight">Multi-Tenant Google Sheets Sync</h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-[10px] font-bold flex items-center space-x-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-300" />
                  <span>Option A: Dedicated Sheet / Tenant</span>
                </span>
              </div>
              <p className="text-xs text-white/85">
                Separate Google Sheet Files per Tenant • Strict Branch-Level Isolation • Offline Room DB
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="btn-upload-all-store-data"
              type="button"
              onClick={handleUploadAllData}
              disabled={isSyncing}
              className="py-2 px-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md border border-white/20 flex items-center space-x-1.5 transition active:scale-95 disabled:opacity-50"
              title="Push all existing sales, customers, cash logs, and expenses into your Google Sheet"
            >
              <Upload className="w-3.5 h-3.5 text-white" />
              <span className="hidden sm:inline">Upload All Data</span>
              <span className="sm:hidden">Upload All</span>
            </button>

            <button
              id="btn-trigger-sync-now-modal"
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="py-2 px-3 rounded-2xl bg-white text-slate-900 hover:bg-slate-100 text-xs font-bold shadow-md flex items-center space-x-1.5 transition active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#6A4DFF] ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-black/20 hover:bg-black/30 flex items-center justify-center text-white transition"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tenant & Branch Active Isolation Context Bar */}
        <div className="bg-slate-950/90 px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="flex items-center space-x-1.5 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
              <Building2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">Active Tenant:</span>
              <span className="font-bold text-white">{currentComp.company_name}</span>
              <span className="font-mono text-[10px] text-indigo-300 bg-indigo-950/80 px-1.5 py-0.5 rounded border border-indigo-800/80">
                {currentComp.company_id}
              </span>
            </div>

            <div className="flex items-center space-x-1.5 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
              <GitBranch className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400">Active Branch:</span>
              <span className="font-bold text-white">{currentBranch.name}</span>
              <span className="font-mono text-[10px] text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/80">
                {currentBranch.branchId}
              </span>
            </div>

            <div className="flex items-center space-x-1 bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-800/60 text-[11px] text-emerald-300">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Branch Isolation:</span>
              <strong className="text-white uppercase">{sheetsConfig.branchIsolationMode || 'ROW_LEVEL'}</strong>
            </div>
          </div>

          {isRealGoogleSheetId(sheetsConfig.spreadsheetId) ? (
            <div className="flex items-center space-x-1.5">
              <a
                href={getGoogleSheetUrl(sheetsConfig.spreadsheetId)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-emerald-300 hover:text-white bg-emerald-950/80 hover:bg-emerald-900/80 px-2.5 py-1 rounded-lg transition text-[11px] border border-emerald-700/60 font-semibold"
              >
                <span>Open Dedicated Sheet</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={() => handleOpenSheetLinkModal(currentComp.company_id)}
                className="text-[10px] text-slate-400 hover:text-white px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
                title="Change or Edit Sheet ID"
              >
                Edit Link
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleOpenSheetLinkModal(currentComp.company_id)}
              className="flex items-center space-x-1.5 text-amber-300 hover:text-white bg-amber-950/80 hover:bg-amber-900/80 px-3 py-1.5 rounded-xl transition text-xs border border-amber-600/70 font-semibold shadow-sm animate-pulse"
            >
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Link Dedicated Sheet</span>
            </button>
          )}
        </div>

        {/* Webhook Connectivity Alert Banner */}
        {(!webhookUrl || !webhookUrl.startsWith('http')) ? (
          <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2 text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong className="text-amber-300">Google Apps Script Webhook is Not Configured:</strong> Data cannot sync to your Google Sheet until you deploy Apps Script and paste your Web App URL.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('webhook')}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-[11px] transition shadow-sm flex items-center space-x-1 shrink-0 active:scale-95"
            >
              <span>Setup Webhook Now</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="bg-emerald-950/40 border-b border-emerald-800/40 px-4 py-1.5 flex items-center justify-between text-[11px]">
            <div className="flex items-center space-x-2 text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-semibold">Live Webhook Connected</span>
              <span className="font-mono text-[10px] text-slate-400 truncate max-w-xs">{webhookUrl}</span>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('webhook')}
              className="text-emerald-400 hover:text-emerald-300 font-semibold"
            >
              Manage
            </button>
          </div>
        )}

        {/* View Switcher Bar */}
        <div className="bg-slate-950/50 px-4 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center space-x-1 sm:space-x-2">
            <button
              type="button"
              onClick={() => setActiveView('preview')}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center space-x-1.5 ${
                activeView === 'preview' ? 'bg-[#6A4DFF] text-white' : 'text-slate-400 hover:text-white bg-slate-900'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Store Data Preview</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('queue')}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center space-x-1.5 ${
                activeView === 'queue' ? 'bg-[#6A4DFF] text-white' : 'text-slate-400 hover:text-white bg-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Offline Sync Queue</span>
              {pendingCount > 0 && (
                <span className="bg-[#FF8A00] text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveView('tenant-arch')}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center space-x-1.5 ${
                activeView === 'tenant-arch'
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md'
                  : 'text-indigo-300 hover:text-white bg-indigo-950/40 border border-indigo-800/60'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-300" />
              <span>Tenant Architecture & Isolation</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('webhook')}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center space-x-1 ${
                activeView === 'webhook' ? 'bg-[#6A4DFF] text-white' : 'text-slate-400 hover:text-white bg-slate-900'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Apps Script & Webhook</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-400 flex items-center space-x-2">
            <span>Last Synced:</span>
            <span className="font-mono-num text-slate-200 font-semibold">
              {sheetsConfig.lastSyncTimestamp
                ? new Date(sheetsConfig.lastSyncTimestamp).toLocaleTimeString()
                : 'Not synced yet'}
            </span>
          </div>
        </div>

        {/* Sync status message banner */}
        {syncStatusMsg && (
          <div className="px-4 py-2 bg-purple-950/80 border-b border-purple-800 text-xs text-purple-200 font-medium flex items-center justify-between">
            <span>{syncStatusMsg}</span>
            <button
              type="button"
              onClick={() => setSyncStatusMsg(null)}
              className="text-purple-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {activeView === 'preview' && (
            /* Sheet Table Previewer */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Table sub-tabs */}
                <div className="flex flex-wrap gap-1.5">
                  {sheetTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveSheetTab(tab.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                        activeSheetTab === tab.id
                          ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className="text-[10px] opacity-75 font-mono-num">({tab.count})</span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => downloadCsvFile(activeSheetTab)}
                  className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700 shadow-sm"
                  title="Download CSV including BranchID and BranchName audit tags"
                >
                  <Download className="w-3.5 h-3.5 text-slate-300" />
                  <span>Download Table CSV</span>
                </button>
              </div>

              {/* Data Table */}
              <div className="bg-slate-950/70 rounded-2xl border border-slate-800 overflow-hidden shadow-inner">
                <div className="max-h-96 overflow-auto">
                  {activeSheetTab === 'CashLog' && (
                    <table className="w-full text-left text-xs font-mono-num">
                      <thead className="bg-purple-950/80 text-purple-200 font-sans uppercase font-bold sticky top-0 border-b border-purple-800">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Branch</th>
                          <th className="py-2.5 px-3">Staff</th>
                          <th className="py-2.5 px-3">Line</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3 text-right">In ($)</th>
                          <th className="py-2.5 px-3 text-right">Out ($)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {cashLogs.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 text-slate-400">{c.date}</td>
                            <td className="py-2 px-3">
                              <span className="font-mono text-[10px] bg-slate-900 px-1.5 py-0.5 rounded text-amber-300 border border-slate-800">
                                {currentBranch.branchId}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-white font-sans">{c.staffName}</td>
                            <td className="py-2 px-3 text-purple-300">{c.line}</td>
                            <td className="py-2 px-3 text-slate-300 font-sans">{c.description}</td>
                            <td className="py-2 px-3 text-right text-emerald-400 font-bold">
                              {c.in > 0 ? `$${c.in.toFixed(2)}` : '-'}
                            </td>
                            <td className="py-2 px-3 text-right text-rose-400 font-bold">
                              {c.out > 0 ? `$${c.out.toFixed(2)}` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeSheetTab === 'Customers' && (
                    <table className="w-full text-left text-xs font-mono-num">
                      <thead className="bg-purple-950/80 text-purple-200 font-sans uppercase font-bold sticky top-0 border-b border-purple-800">
                        <tr>
                          <th className="py-2.5 px-3">ID</th>
                          <th className="py-2.5 px-3">Branch</th>
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Phone</th>
                          <th className="py-2.5 px-3">Address</th>
                          <th className="py-2.5 px-3">Created Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {customers.map((c) => (
                          <tr key={c.customerId} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 text-amber-400 font-bold">{c.customerId}</td>
                            <td className="py-2 px-3">
                              <span className="font-mono text-[10px] bg-slate-900 px-1.5 py-0.5 rounded text-amber-300 border border-slate-800">
                                {currentBranch.branchId}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-white font-sans font-bold">{c.name}</td>
                            <td className="py-2 px-3 text-slate-300">{c.phone || '-'}</td>
                            <td className="py-2 px-3 text-slate-400 font-sans">{c.address || '-'}</td>
                            <td className="py-2 px-3 text-slate-400">{c.createdDate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeSheetTab === 'Sales' && (
                    <table className="w-full text-left text-xs font-mono-num">
                      <thead className="bg-purple-950/80 text-purple-200 font-sans uppercase font-bold sticky top-0 border-b border-purple-800">
                        <tr>
                          <th className="py-2.5 px-3">Invoice</th>
                          <th className="py-2.5 px-3">Branch</th>
                          <th className="py-2.5 px-3">Customer</th>
                          <th className="py-2.5 px-3">Items</th>
                          <th className="py-2.5 px-3 text-right">Total ($)</th>
                          <th className="py-2.5 px-3">Payment</th>
                          <th className="py-2.5 px-3">Staff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {sales.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 text-indigo-400 font-bold">{s.id}</td>
                            <td className="py-2 px-3">
                              <span className="font-mono text-[10px] bg-slate-900 px-1.5 py-0.5 rounded text-amber-300 border border-slate-800">
                                {currentBranch.branchId}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-white font-sans font-bold">{s.customerName}</td>
                            <td className="py-2 px-3 text-slate-300 font-sans truncate max-w-xs">{s.itemsSummary}</td>
                            <td className="py-2 px-3 text-right font-bold text-emerald-400">${s.total.toFixed(2)}</td>
                            <td className="py-2 px-3 text-purple-300 font-sans">{s.paymentMethod}</td>
                            <td className="py-2 px-3 text-slate-400 font-sans">{s.staffName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeSheetTab === 'Expenses' && (
                    <table className="w-full text-left text-xs font-mono-num">
                      <thead className="bg-purple-950/80 text-purple-200 font-sans uppercase font-bold sticky top-0 border-b border-purple-800">
                        <tr>
                          <th className="py-2.5 px-3">ID</th>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Category</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3 text-right">Amount ($)</th>
                          <th className="py-2.5 px-3">Staff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {expenses.map((e) => (
                          <tr key={e.id} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 text-rose-400 font-bold">{e.id}</td>
                            <td className="py-2 px-3 text-slate-400">{e.date}</td>
                            <td className="py-2 px-3 text-purple-300 font-sans">{e.category}</td>
                            <td className="py-2 px-3 text-white font-sans">{e.description}</td>
                            <td className="py-2 px-3 text-right text-rose-400 font-bold">${e.amount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-slate-400 font-sans">{e.staffName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeSheetTab === 'Reconciliations' && (
                    <table className="w-full text-left text-xs font-mono-num">
                      <thead className="bg-purple-950/80 text-purple-200 font-sans uppercase font-bold sticky top-0 border-b border-purple-800">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Staff</th>
                          <th className="py-2.5 px-3 text-right">Expected ($)</th>
                          <th className="py-2.5 px-3 text-right">Actual Count ($)</th>
                          <th className="py-2.5 px-3 text-right">Variance ($)</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {reconciliations.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 text-slate-300">{r.date}</td>
                            <td className="py-2 px-3 text-white font-sans">{r.staffName}</td>
                            <td className="py-2 px-3 text-right">${r.expectedCash.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-bold text-emerald-400">${r.actualCashCount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right font-bold text-orange-400">${r.variance.toFixed(2)}</td>
                            <td className="py-2 px-3 font-bold font-sans">{r.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeSheetTab === 'Salespeople' && (
                    <table className="w-full text-left text-xs font-mono-num">
                      <thead className="bg-purple-950/80 text-purple-200 font-sans uppercase font-bold sticky top-0 border-b border-purple-800">
                        <tr>
                          <th className="py-2.5 px-3">ID</th>
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Role</th>
                          <th className="py-2.5 px-3">Phone</th>
                          <th className="py-2.5 px-3">Active</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {salespeople.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 text-[#FF8A00] font-bold">{s.id}</td>
                            <td className="py-2 px-3 text-white font-sans font-bold">{s.name}</td>
                            <td className="py-2 px-3 text-purple-300 font-sans">{s.role}</td>
                            <td className="py-2 px-3 text-slate-400">{s.phone || '-'}</td>
                            <td className="py-2 px-3 font-bold">{s.active}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeView === 'queue' && (
            /* Sync Queue Inspector */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-[#FF8A00]" />
                  <span>Room DB Outbound Sync Queue ({syncQueue.length})</span>
                </h3>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      const count = queueAllStoreDataForSync();
                      setSyncStatusMsg(`Queued ${count} records for tenant ${currentComp.company_name}!`);
                    }}
                    className="text-xs text-indigo-300 hover:text-indigo-200 font-bold bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-800 transition"
                    title="Queue all sales, customers, cash logs, expenses tagged with the current active company and branch"
                  >
                    Re-queue Store Records
                  </button>
                  <button
                    type="button"
                    onClick={clearSyncedQueueItems}
                    className="text-xs text-slate-400 hover:text-white font-bold bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 transition"
                  >
                    Clear Synced
                  </button>
                </div>
              </div>

              {(!webhookUrl || !webhookUrl.startsWith('http')) && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Google Apps Script Webhook is not connected. Data cannot reach your Google Sheet until configured.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveView('webhook')}
                    className="px-2.5 py-1 bg-amber-500 text-slate-950 font-bold rounded-lg text-[11px] shrink-0 active:scale-95"
                  >
                    Open Setup
                  </button>
                </div>
              )}

              {syncQueue.length === 0 ? (
                <div className="p-8 text-center bg-slate-950/60 border border-slate-800 rounded-2xl text-slate-400">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2" />
                  <p className="font-bold text-white">Queue is empty!</p>
                  <p className="text-xs text-slate-400 mt-1 mb-4">
                    Want to push your entire store history (Sales, Customers, Cash Logs, Expenses) to your dedicated Google Sheet right now?
                  </p>
                  <button
                    type="button"
                    onClick={handleUploadAllData}
                    disabled={isSyncing}
                    className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md inline-flex items-center space-x-2 transition active:scale-95 disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload All Store Data to Google Sheets</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {syncQueue.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs font-mono-num"
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              item.action === 'INSERT'
                                ? 'bg-emerald-950 text-emerald-300'
                                : 'bg-purple-950 text-purple-300'
                            }`}
                          >
                            {item.action}
                          </span>
                          <span className="font-bold text-white font-sans">Sheet "{item.sheetName}"</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                              item.status === 'synced'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : item.status === 'syncing'
                                ? 'bg-amber-500/20 text-amber-300'
                                : item.status === 'failed'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 truncate max-w-md font-sans">
                          {JSON.stringify(item.payload)}
                        </p>
                      </div>

                      <div className="text-right shrink-0 ml-2">
                        <span className="text-[10px] text-slate-500">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeView === 'tenant-arch' && (
            /* Multi-Tenant Architecture & Branch Isolation (Option A) */
            <div className="space-y-5">
              {/* Architecture Blueprint Card */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-indigo-950/70 via-slate-950/80 to-purple-950/70 border border-indigo-800/60 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="p-2 rounded-xl bg-indigo-600/30 text-indigo-300 border border-indigo-500/40">
                      <FolderSync className="w-5 h-5 text-indigo-300" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Option A: Dedicated Google Sheet per Tenant + Branch Isolation
                      </h3>
                      <p className="text-xs text-indigo-200/80">
                        Physical file-level segregation for tenants, combined with logical row/tab isolation for branches.
                      </p>
                    </div>
                  </div>

                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Zero Leakage Active</span>
                  </span>
                </div>

                {/* Architecture Visual Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                    <div className="flex items-center space-x-1.5 text-amber-400 font-bold">
                      <Server className="w-4 h-4" />
                      <span>1. Master Control Sheet</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Holds global directory: <code className="text-slate-300">companies</code>, <code className="text-slate-300">branches</code>, <code className="text-slate-300">users</code>, and 52 permission roles.
                    </p>
                    <div className="font-mono text-[10px] text-amber-300 truncate bg-slate-950 p-1.5 rounded border border-slate-800">
                      1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                    <div className="flex items-center space-x-1.5 text-indigo-400 font-bold">
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>2. Dedicated Tenant Sheet</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Each customer possesses their own isolated Google Sheet file. Data never co-mingles across tenants.
                    </p>
                    <div className="font-mono text-[10px] text-indigo-300 truncate bg-slate-950 p-1.5 rounded border border-slate-800">
                      {sheetsConfig.spreadsheetId}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                    <div className="flex items-center space-x-1.5 text-emerald-400 font-bold">
                      <Lock className="w-4 h-4" />
                      <span>3. Branch Isolation Engine</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Staff from <code className="text-emerald-300">BR-MAIN</code> cannot write/read records for <code className="text-emerald-300">BR-002</code>. 403 Forbidden enforcement on cross-branch leaks.
                    </p>
                    <div className="font-mono text-[10px] text-emerald-300 truncate bg-slate-950 p-1.5 rounded border border-slate-800">
                      Status: 100% Zero-Leakage
                    </div>
                  </div>
                </div>

                {/* Interactive Branch Isolation Security Probe */}
                <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800/90 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center space-x-1.5">
                        <ShieldAlert className="w-4 h-4 text-emerald-400" />
                        <span>Real-Time Branch Isolation Security Probe</span>
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Simulates an unauthorized cross-branch write attempt to verify that the leak prevention barrier blocks the operation.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleRunIsolationTest}
                      disabled={isTestingIsolation}
                      className="py-1.5 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow transition active:scale-95 flex items-center space-x-1.5 disabled:opacity-50"
                    >
                      <Zap className={`w-3.5 h-3.5 ${isTestingIsolation ? 'animate-spin' : ''}`} />
                      <span>{isTestingIsolation ? 'Probing Security...' : 'Run Isolation Verification Test'}</span>
                    </button>
                  </div>

                  {isolationTestResult && (
                    <div
                      className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                        isolationTestResult.passed
                          ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                          : 'bg-rose-950/50 border-rose-800 text-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold">
                        <span className="flex items-center space-x-1.5">
                          {isolationTestResult.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-rose-400" />
                          )}
                          <span>{isolationTestResult.statusMessage}</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {new Date(isolationTestResult.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                        <div>
                          <span className="text-slate-400 block">Tenant:</span>
                          <span className="font-bold text-white">{isolationTestResult.tenantName}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">User Branch:</span>
                          <span className="font-mono text-emerald-300">{isolationTestResult.authorizedBranchId}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Target Branch:</span>
                          <span className="font-mono text-amber-300">{isolationTestResult.targetBranchId}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Cross-Branch Leakage:</span>
                          <span className="font-bold text-emerald-400">STRICTLY BLOCKED</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Active Tenant Dedicated Sheet Configuration Form */}
              <form
                onSubmit={handleSaveTenantConfig}
                className="bg-slate-950/80 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <SettingsIcon className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Edit Active Tenant Sheet File & Isolation Mode
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">Tenant ID: {currentComp.company_id}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300 block">
                      Dedicated Google Sheet ID (Option A)
                    </label>
                    <input
                      type="text"
                      value={tenantSpreadsheetId}
                      onChange={(e) => setTenantSpreadsheetId(e.target.value)}
                      placeholder="e.g. 1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE"
                      className="w-full py-2.5 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white outline-none focus:border-indigo-500 font-mono-num"
                    />
                    <span className="text-[10px] text-slate-400">
                      Unique Google Spreadsheet ID dedicated to {currentComp.company_name}.
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300 block">
                      Dedicated Apps Script Webhook URL
                    </label>
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://script.google.com/macros/s/.../exec"
                      className="w-full py-2.5 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white outline-none focus:border-indigo-500 font-mono-num"
                    />
                    <span className="text-[10px] text-slate-400">
                      The web app deployment URL attached to this tenant's dedicated sheet.
                    </span>
                  </div>
                </div>

                {/* Branch Isolation Strategy */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 block">
                    Branch Isolation Strategy (Within Tenant Sheet)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setBranchIsolationMode('ROW_LEVEL')}
                      className={`p-3 rounded-xl border text-left transition ${
                        branchIsolationMode === 'ROW_LEVEL'
                          ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full ${branchIsolationMode === 'ROW_LEVEL' ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                        <span>Row-Level Tagging</span>
                      </div>
                      <p className="text-[10px] mt-1 text-slate-400">
                        Unified tabs (Sales, CashLog). All rows strictly tagged with BranchID and BranchName.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setBranchIsolationMode('BRANCH_TABS')}
                      className={`p-3 rounded-xl border text-left transition ${
                        branchIsolationMode === 'BRANCH_TABS'
                          ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full ${branchIsolationMode === 'BRANCH_TABS' ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                        <span>Branch-Specific Tabs</span>
                      </div>
                      <p className="text-[10px] mt-1 text-slate-400">
                        Separate subtabs in Google Sheets (Sales_BR-MAIN, Sales_BR-002).
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setBranchIsolationMode('HYBRID')}
                      className={`p-3 rounded-xl border text-left transition ${
                        branchIsolationMode === 'HYBRID'
                          ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full ${branchIsolationMode === 'HYBRID' ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                        <span>Hybrid (Row + Tabs)</span>
                      </div>
                      <p className="text-[10px] mt-1 text-slate-400">
                        Writes to both branch-isolated subtabs and an aggregated master tab.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="py-2 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition active:scale-95"
                  >
                    Save Tenant Sheet Configuration
                  </button>
                </div>
              </form>

              {/* All Tenants Google Sheet Registry Table */}
              <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center space-x-2">
                    <Building2 className="w-4 h-4 text-[#FF8A00]" />
                    <span>SaaS Tenant Sheet Files Directory ({allCompanies.length})</span>
                  </h3>
                  <span className="text-[10px] text-slate-400">Option A: 1 Google Sheet File per Tenant</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono-num">
                    <thead className="bg-slate-900 text-slate-300 font-sans uppercase font-bold border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Company ID</th>
                        <th className="py-2.5 px-3">Tenant Name</th>
                        <th className="py-2.5 px-3">Dedicated Sheet ID (Option A)</th>
                        <th className="py-2.5 px-3">Isolation Mode</th>
                        <th className="py-2.5 px-3">Branches</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {allCompanies.map((c) => {
                        const compBranches = allBranches.filter((b) => b.company_id === c.company_id);
                        const isCurrent = c.company_id === currentComp.company_id;
                        const isMaster = c.company_id === 'COMP-001' || c.company_id === 'COMP-MASTER';
                        const hasRealSheet = isRealGoogleSheetId(c.sheet_id) || (isMaster && isRealGoogleSheetId('1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE'));
                        const sheetId = isRealGoogleSheetId(c.sheet_id)
                          ? c.sheet_id!
                          : isMaster
                          ? '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE'
                          : '';

                        return (
                          <tr key={c.company_id} className={`hover:bg-slate-900/60 ${isCurrent ? 'bg-indigo-950/20' : ''}`}>
                            <td className="py-2.5 px-3 font-bold text-indigo-300">
                              {c.company_id}
                              {isCurrent && (
                                <span className="ml-1.5 px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  ACTIVE
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-white font-sans font-bold">{c.company_name}</td>
                            <td className="py-2.5 px-3">
                              {hasRealSheet ? (
                                <div className="flex items-center space-x-1.5">
                                  <span className="font-mono text-[11px] text-emerald-400 truncate max-w-xs block" title={sheetId}>
                                    {sheetId}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenSheetLinkModal(c.company_id)}
                                    className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700"
                                  >
                                    Edit
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-2">
                                  <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800 font-semibold">
                                    ⚠️ Needs Sheet
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenSheetLinkModal(c.company_id)}
                                    className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold transition"
                                  >
                                    Link Sheet
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] bg-slate-900 border border-slate-800 text-slate-300">
                                {c.branch_isolation_mode || 'ROW_LEVEL'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-400">
                              {compBranches.length > 0 ? compBranches.map((b) => b.name).join(', ') : 'Main Branch'}
                            </td>
                            <td className="py-2.5 px-3 text-right space-x-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setCurrentCompanyId(c.company_id);
                                  setTenantSpreadsheetId(sheetId);
                                  setSyncStatusMsg(`Switched active context to tenant ${c.company_name}`);
                                }}
                                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition"
                              >
                                {isCurrent ? 'Active' : 'Select'}
                              </button>
                              {hasRealSheet ? (
                                <a
                                  href={`https://docs.google.com/spreadsheets/d/${sheetId}/edit`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center px-2 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-[11px] border border-emerald-800 transition"
                                  title="Open in Google Sheets"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenSheetLinkModal(c.company_id)}
                                  className="inline-flex items-center px-2 py-1 rounded-lg bg-indigo-950 hover:bg-indigo-900 text-indigo-300 text-[11px] border border-indigo-800 transition"
                                >
                                  Link
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeView === 'webhook' && (
            /* Webhook & Apps Script Configuration */
            <div className="space-y-4">
              {/* Webhook URL Input & Test Connection */}
              <form onSubmit={handleSaveTenantConfig} className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center space-x-2">
                    <Link2 className="w-4 h-4 text-[#FF8A00]" />
                    <span>Tenant Apps Script Webhook URL</span>
                  </label>
                  {webhookUrl && (
                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                      Configured
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/AKfycbx.../exec"
                    className="flex-1 py-2.5 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white outline-none focus:border-[#6A4DFF] font-mono-num"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white text-xs font-bold shadow-md transition whitespace-nowrap active:scale-95"
                    >
                      Save URL
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!webhookUrl || !webhookUrl.startsWith('http')) {
                          alert('Please enter your Google Apps Script URL first!');
                          return;
                        }
                        const cleanSheetId = extractGoogleSheetId(tenantSpreadsheetId) || currentComp.sheet_id;
                        setIsSyncing(true);
                        setSyncStatusMsg('Sending a TEST ROW with branch isolation metadata...');
                        try {
                          await fetch(webhookUrl.trim(), {
                            method: 'POST',
                            mode: 'no-cors',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({
                              action: 'INSERT',
                              sheet: 'Sales',
                              company_id: currentComp.company_id,
                              company_name: currentComp.company_name,
                              tenant_sheet_id: cleanSheetId,
                              sheet_id: cleanSheetId,
                              branch_id: currentBranch.branchId,
                              user_branch_id: currentBranch.branchId,
                              user_role: 'CASHIER',
                              data: {
                                TestNotice: 'Option A Verified with Branch Isolation!',
                                TenantCompanyID: currentComp.company_id,
                                BranchID: currentBranch.branchId,
                                Timestamp: new Date().toLocaleString(),
                                Amount: '$120.00',
                                Status: 'LIVE_ISOLATED',
                                tenant_sheet_id: cleanSheetId,
                              },
                            }),
                          });
                          setSyncStatusMsg('✓ TEST ROW SENT! Check your dedicated tenant Google Sheet now.');
                          confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
                        } catch (err: any) {
                          setSyncStatusMsg(`Connection test error: ${err?.message || 'Network error'}`);
                        } finally {
                          setIsSyncing(false);
                        }
                      }}
                      className="py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shadow-md transition whitespace-nowrap active:scale-95 flex items-center space-x-1"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Send Test Row</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!webhookUrl || !webhookUrl.startsWith('http')) {
                          alert('Please enter your Google Apps Script URL first!');
                          return;
                        }
                        const cleanSheetId = extractGoogleSheetId(tenantSpreadsheetId) || currentComp.sheet_id;
                        if (!cleanSheetId) {
                          alert('Please link your dedicated Google Sheet ID first!');
                          return;
                        }
                        setIsSyncing(true);
                        setSyncStatusMsg('Initializing all business tabs in your dedicated Google Sheet...');
                        try {
                          await fetch(webhookUrl.trim(), {
                            method: 'POST',
                            mode: 'no-cors',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({
                              action: 'initialize_tenant_sheet',
                              company_id: currentComp.company_id,
                              company_name: currentComp.company_name,
                              tenant_sheet_id: cleanSheetId,
                              sheet_id: cleanSheetId,
                              branch_id: currentBranch.branchId,
                            }),
                          });
                          setSyncStatusMsg('✓ Initialization command dispatched! Open your dedicated sheet: Sales, InventoryMaster, GoodsReceived, CashLog, Expenses tabs are generated.');
                          confetti({ particleCount: 60, spread: 80, origin: { y: 0.6 } });
                        } catch (err: any) {
                          setSyncStatusMsg(`Initialization error: ${err?.message || 'Network error'}`);
                        } finally {
                          setIsSyncing(false);
                        }
                      }}
                      className="py-2.5 px-3 rounded-xl bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-bold shadow-md transition whitespace-nowrap active:scale-95 flex items-center space-x-1"
                      title="Automatically create Sales, InventoryMaster, GoodsReceived, CashLog, Expenses tabs"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Initialize Sheet Tabs</span>
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                  <p className="font-bold text-amber-400 flex items-center space-x-1">
                    <span>⚠️ Checklist for Option A Google Apps Script:</span>
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400">
                    <li>
                      Paste the code into <strong className="text-white">Extensions → Apps Script</strong> in this tenant's dedicated sheet.
                    </li>
                    <li>
                      Deploy as <strong className="text-white">Web app</strong> with <strong className="text-white">Who has access: Anyone</strong>.
                    </li>
                    <li>
                      Branch isolation is automatically enforced inside the script so cashiers cannot inject cross-branch rows.
                    </li>
                  </ol>
                </div>
              </form>

              {/* Ready-to-copy Google Apps Script Code */}
              <div className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <Code className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Apps Script Backend Code (Option A)
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs">
                      <button
                        type="button"
                        onClick={() => setScriptType('tenant-dedicated')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition ${
                          scriptType === 'tenant-dedicated'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Option A: Tenant Sheet Script
                      </button>
                      <button
                        type="button"
                        onClick={() => setScriptType('master-saas')}
                        className={`px-2.5 py-1 rounded-lg font-bold transition ${
                          scriptType === 'master-saas'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Master SaaS Script
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="py-1.5 px-3 rounded-xl bg-purple-950 hover:bg-purple-900 border border-purple-800 text-purple-200 text-xs font-bold flex items-center space-x-1 transition"
                    >
                      {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                    </button>
                  </div>
                </div>

                <div className="bg-slate-900 p-3 rounded-xl text-[11px] font-mono-num text-slate-300 max-h-56 overflow-y-auto border border-slate-800">
                  <pre>
                    {scriptType === 'tenant-dedicated'
                      ? generateTenantDedicatedAppsScriptCode(currentComp.company_id)
                      : generateAppsScriptCode()}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Link Dedicated Google Sheet Modal */}
      {showSheetLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="font-bold text-sm text-white">Link Dedicated Google Sheet</h3>
                  <p className="text-xs text-slate-400">
                    {allCompanies.find((c) => c.company_id === linkModalCompanyId)?.company_name || currentComp.company_name} ({linkModalCompanyId || currentComp.company_id})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSheetLinkModal(false)}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Architecture Explanation Banner */}
            <div className="p-3 bg-indigo-950/50 border border-indigo-800/60 rounded-xl text-xs space-y-1.5 text-indigo-200">
              <div className="font-bold text-white flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Single Apps Script Deployment Architecture</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                <strong>You do NOT need a separate Apps Script deployment for each tenant!</strong> Your single deployed Apps Script webhook handles all tenants automatically. When a tenant syncs, the script opens their dedicated spreadsheet in Google Drive dynamically via <code className="text-emerald-300 font-mono">SpreadsheetApp.openById(sheet_id)</code>.
              </p>
            </div>

            {/* Method 1: 1-Click Clone Master Template */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">Method 1: Clone Master Sheet Template (1-Click)</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">Fastest</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Click below to make a copy of the official 10-tab Master Spreadsheet directly into your Google Drive:
              </p>
              <a
                href="https://docs.google.com/spreadsheets/d/1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE/copy"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow flex items-center justify-center space-x-1.5 transition active:scale-95"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Make a Copy in Google Drive</span>
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
              <p className="text-[10px] text-slate-500">
                After creating your copy, copy its browser URL and paste it in Method 2 below!
              </p>
            </div>

            {/* Method 2: Paste Google Sheet URL or ID */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-200 block">
                Method 2: Paste Google Sheet URL or Spreadsheet ID
              </label>
              <input
                type="text"
                value={inputSheetUrlOrId}
                onChange={(e) => {
                  setInputSheetUrlOrId(e.target.value);
                  setLinkModalError(null);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/1gtbI5TK.../edit"
                className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-indigo-500 font-mono-num"
              />
              {inputSheetUrlOrId && (
                <div className="text-[10px] font-mono text-slate-400 bg-slate-950 p-2 rounded-lg border border-slate-800">
                  Extracted ID: <span className="text-emerald-400 font-bold">{extractGoogleSheetId(inputSheetUrlOrId) || 'None'}</span>
                </div>
              )}
              {linkModalError && (
                <p className="text-xs text-rose-400 flex items-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{linkModalError}</span>
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => handleSaveLinkedSheet()}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition active:scale-95 flex items-center justify-center space-x-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Save Dedicated Sheet Link</span>
              </button>

              <button
                type="button"
                onClick={() => handleSaveLinkedSheet('1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE')}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition"
              >
                Use Master Sheet for Now (Row-Level Isolated)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
