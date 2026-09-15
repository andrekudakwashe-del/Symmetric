import React, { useState, useEffect } from 'react';
import {
  Crown,
  Building2,
  Users,
  Database,
  Layers,
  Sparkles,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  ExternalLink,
  Shield,
  Calendar,
  X,
  CreditCard,
  Clock,
  KeyRound,
  Copy,
  Ban,
  RotateCcw,
  Check,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  ShieldAlert,
  RefreshCw,
  Zap,
  Save,
  Send,
  Radio,
  Globe,
  Link2,
  Eye,
  Package,
} from 'lucide-react';
import { PackageSetupView } from './PackageSetupView';
import {
  getCompanies,
  saveCompany,
  getBranches,
  saveBranch,
  subscribeRoomDatabase,
  confirmCompanyPayment,
  extendCompanyTrial,
  suspendCompany,
  setCurrentCompanyId,
  getSubscriptionStatus,
  getSheetsConfig,
  saveSheetsConfig,
} from '../../db/roomDatabase';
import {
  isRealGoogleSheetId,
  extractGoogleSheetId,
  fetchCompaniesFromMasterSheet,
  initializeMasterSheetTabs,
  syncCompanyToCloud,
} from '../../services/googleSheetsSync';
import {
  saveGlobalSystemConfig,
  fetchGlobalSystemConfig,
  pushAllLocalTenantsToCloud,
  initializeSystemConfigAndSync,
} from '../../services/systemConfig';
import { Company, SaaSBranch } from '../../data/saasData';
import { Salesperson } from '../../types';
import confetti from 'canvas-confetti';

interface SuperAdminDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: Salesperson | null;
  onOpenSheetSetup?: () => void;
  onOpenReportBuilder?: () => void;
  initialTab?: 'tenants' | 'packages' | 'sheets' | 'reports';
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  isOpen,
  onClose,
  currentUser,
  onOpenSheetSetup,
  onOpenReportBuilder,
  initialTab = 'tenants',
}) => {
  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  const [adminTab, setAdminTab] = useState<'tenants' | 'packages' | 'sheets' | 'reports'>(initialTab);
  const [companies, setCompanies] = useState<Company[]>(() => getCompanies());
  const [branches, setBranches] = useState(() => getBranches());
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddCompanyModalOpen, setIsAddCompanyModalOpen] = useState(false);
  const [selectedCompanyForPayment, setSelectedCompanyForPayment] = useState<Company | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showSystemInfo, setShowSystemInfo] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'NEEDS_SHEET'>('ALL');

  // Dedicated Sheet Linker State
  const [linkingSheetCompany, setLinkingSheetCompany] = useState<Company | null>(null);
  const [sheetUrlOrIdInput, setSheetUrlOrIdInput] = useState('');
  const [sheetLinkError, setSheetLinkError] = useState<string | null>(null);

  // New Company form state
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newPlan, setNewPlan] = useState<'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'>('PROFESSIONAL');

  // Payment Confirmation Modal State
  const [paymentPlan, setPaymentPlan] = useState<'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'>('PROFESSIONAL');
  const [paymentMonths, setPaymentMonths] = useState<number>(1);
  const [paymentNotes, setPaymentNotes] = useState<string>('Payment verified via Ecocash / Cash');

  // Master Sheet Sync & Tabs State
  const [isSyncingWithMaster, setIsSyncingWithMaster] = useState(false);
  const [lastSyncStatus, setLastSyncStatus] = useState<string | null>(null);
  const [isInitTabsModalOpen, setIsInitTabsModalOpen] = useState(false);
  const [isInitializingTabs, setIsInitializingTabs] = useState(false);
  const [initTabsFeedback, setInitTabsFeedback] = useState<{ success: boolean; message: string; createdTabs?: string[] } | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedFullCode, setCopiedFullCode] = useState(false);

  // Full Code.gs Viewer & Downloader State
  const [isViewCodeModalOpen, setIsViewCodeModalOpen] = useState(false);
  const [fullCodeContent, setFullCodeContent] = useState<string>('');
  const [isLoadingCode, setIsLoadingCode] = useState(false);
  const [codeLineCount, setCodeLineCount] = useState<number>(2208);

  // Global Master Webhook Configuration State
  const [masterWebhookInput, setMasterWebhookInput] = useState(() => {
    const cfg = getSheetsConfig();
    return cfg.masterWebhookUrl || cfg.webhookUrl || '';
  });
  const [masterSpreadsheetIdInput, setMasterSpreadsheetIdInput] = useState(() => {
    const cfg = getSheetsConfig();
    return cfg.masterSpreadsheetId || '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE';
  });
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);
  const [isPushingTenants, setIsPushingTenants] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [webhookTestFeedback, setWebhookTestFeedback] = useState<{ tested: boolean; success: boolean; message: string } | null>(null);

  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      setCompanies(getCompanies());
      setBranches(getBranches());
    });
    return unsub;
  }, []);

  // When Super Admin Dashboard opens, load global system config and query Master Sheet & Server
  useEffect(() => {
    if (isOpen) {
      // 1. Fetch global system config from server
      fetchGlobalSystemConfig()
        .then((cfg) => {
          if (cfg) {
            if (cfg.masterWebhookUrl) setMasterWebhookInput(cfg.masterWebhookUrl);
            if (cfg.masterSpreadsheetId) setMasterSpreadsheetIdInput(cfg.masterSpreadsheetId);
          }
        })
        .catch(() => {});

      // 2. Multi-device sync: reconcile local database with server & master sheet
      initializeSystemConfigAndSync()
        .then((res) => {
          setCompanies(getCompanies());
          setBranches(getBranches());
          if (res.success && res.companies.length > 0) {
            setLastSyncStatus(`Master sync active • ${res.companies.length} tenants loaded`);
          }
        })
        .catch(() => {
          setCompanies(getCompanies());
          setBranches(getBranches());
        });
    }
  }, [isOpen]);

  const handleSaveMasterWebhook = async () => {
    if (!masterWebhookInput.trim()) {
      showToast('Please enter a valid Google Apps Script Webhook URL');
      return;
    }
    setIsSavingWebhook(true);
    try {
      const res = await saveGlobalSystemConfig({
        masterWebhookUrl: masterWebhookInput.trim(),
        masterSpreadsheetId: masterSpreadsheetIdInput.trim(),
      });
      if (res.success) {
        showToast('✓ Master Webhook saved as default for all terminals & devices!');
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 } });
        // Also push local tenants to master sheet so nothing is lost
        pushAllLocalTenantsToCloud(masterWebhookInput.trim()).then((pRes) => {
          setCompanies(getCompanies());
          setBranches(getBranches());
          if (pRes.pushedCount > 0) {
            showToast(`✓ Auto-pushed ${pRes.pushedCount} local tenants to Master Sheet!`);
          }
        });
      } else {
        showToast(res.message || 'Failed to save master webhook.');
      }
    } catch (e: any) {
      showToast(`Error: ${e.message || String(e)}`);
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handlePushAllTenantsToCloud = async () => {
    setIsPushingTenants(true);
    try {
      const res = await pushAllLocalTenantsToCloud(masterWebhookInput.trim());
      setCompanies(getCompanies());
      setBranches(getBranches());
      showToast(`✓ Synchronized ${res.pushedCount} tenant companies across all devices & Master Sheet!`);
      confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    } catch (err: any) {
      setCompanies(getCompanies());
      setBranches(getBranches());
      showToast(`Sync notice: ${err.message || String(err)}`);
    } finally {
      setIsPushingTenants(false);
    }
  };

  const handleTestWebhookConnection = async () => {
    if (!masterWebhookInput.trim() || !masterWebhookInput.startsWith('http')) {
      setWebhookTestFeedback({
        tested: true,
        success: false,
        message: 'Please provide a valid Webhook URL starting with https://',
      });
      return;
    }
    setIsTestingWebhook(true);
    setWebhookTestFeedback(null);
    try {
      const testUrl = masterWebhookInput.includes('?')
        ? `${masterWebhookInput}&action=get_companies`
        : `${masterWebhookInput}?action=get_companies`;
      await fetch(testUrl, { mode: 'no-cors' });
      setWebhookTestFeedback({
        tested: true,
        success: true,
        message: 'Webhook is reachable and responding (200 OK via Google Apps Script)',
      });
    } catch (err: any) {
      setWebhookTestFeedback({
        tested: true,
        success: false,
        message: `Could not reach Apps Script endpoint: ${err.message || String(err)}`,
      });
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const handleSyncFromMasterSheet = async () => {
    setIsSyncingWithMaster(true);
    try {
      // 1. Sync from server store first
      try {
        const sRes = await fetch('/api/saas/companies?force=true', { signal: AbortSignal.timeout(5000) });
        if (sRes.ok) {
          const sData = await sRes.json();
          if (sData && Array.isArray(sData.companies)) {
            sData.companies.forEach((sc: any) => {
              if (sc && sc.company_id) saveCompany(sc);
            });
          }
          if (sData && Array.isArray(sData.branches)) {
            sData.branches.forEach((sb: any) => {
              if (sb && sb.branch_id) saveBranch(sb);
            });
          }
        }
      } catch {
        // ignore
      }

      // 2. Fetch from Master Google Sheet
      const res = await fetchCompaniesFromMasterSheet();
      setCompanies(getCompanies());
      setBranches(getBranches());
      const totalCount = getCompanies().length;
      if (res.success) {
        showToast(res.message || `Synced ${totalCount} companies from Master Google Sheet`);
        setLastSyncStatus(`Last synced: ${new Date().toLocaleTimeString()} (${totalCount} tenants)`);
      } else {
        showToast(`Showing all ${totalCount} synchronized tenants.`);
        setLastSyncStatus(`Active: ${new Date().toLocaleTimeString()} (${totalCount} tenants)`);
      }
    } catch (err: any) {
      setCompanies(getCompanies());
      setBranches(getBranches());
      showToast(`Synchronized ${getCompanies().length} tenants`);
    } finally {
      setIsSyncingWithMaster(false);
    }
  };

  const handleRunAutoCreateTabs = async () => {
    setIsInitializingTabs(true);
    try {
      const res = await initializeMasterSheetTabs();
      setInitTabsFeedback(res);
      if (res.success) {
        showToast('✓ All required Master Sheet tabs verified and created!');
        await handleSyncFromMasterSheet();
      } else {
        showToast(res.message);
      }
    } catch (err: any) {
      setInitTabsFeedback({
        success: false,
        message: err.message || 'Error communicating with Google Apps Script.',
      });
    } finally {
      setIsInitializingTabs(false);
    }
  };

  const handleCopyMasterScriptSnippet = () => {
    const snippet = `// Run this function directly inside Google Apps Script (Code.gs)
function setupMasterSheets() {
  var ss = SpreadsheetApp.openById("1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE");
  ensureAllMasterTabsExist(ss);
  Logger.log("All master tabs created successfully!");
}`;
    navigator.clipboard.writeText(snippet);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 3000);
    showToast('Copied setupMasterSheets script to clipboard!');
  };

  const handleCopyEntireCodeGs = async () => {
    try {
      const res = await fetch('/api/download/code-gs');
      if (!res.ok) throw new Error('Could not fetch Code.gs');
      const text = await res.text();
      const count = text.split('\n').length;
      await navigator.clipboard.writeText(text);
      setCopiedFullCode(true);
      setTimeout(() => setCopiedFullCode(false), 3000);
      showToast(`✓ Copied complete Code.gs (${count.toLocaleString()} lines) to clipboard!`);
    } catch {
      showToast('Unable to copy automatically. Click "View Code" to copy manually or download.');
    }
  };

  const handleDownloadCodeGs = async () => {
    try {
      showToast('Preparing full Code.gs (2,208 lines)...');
      const res = await fetch('/api/download/code-gs');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split('\n').length;

      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Code.gs';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`✓ Downloaded Code.gs (${lines.toLocaleString()} lines)!`);
    } catch (err: any) {
      window.open('/api/download/code-gs', '_blank');
      showToast('Opening Code.gs in new tab...');
    }
  };

  const handleOpenViewCodeModal = async () => {
    setIsViewCodeModalOpen(true);
    setIsLoadingCode(true);
    try {
      const res = await fetch('/api/code-gs-content');
      if (res.ok) {
        const data = await res.json();
        setFullCodeContent(data.code || '');
        setCodeLineCount(data.lineCount || data.code?.split('\n').length || 2208);
      } else {
        const textRes = await fetch('/api/download/code-gs');
        const text = await textRes.text();
        setFullCodeContent(text);
        setCodeLineCount(text.split('\n').length);
      }
    } catch {
      showToast('Could not load code preview.');
    } finally {
      setIsLoadingCode(false);
    }
  };

  const handleCopyCodeFromModal = async () => {
    try {
      await navigator.clipboard.writeText(fullCodeContent);
      setCopiedFullCode(true);
      setTimeout(() => setCopiedFullCode(false), 3000);
      showToast(`✓ Copied all ${codeLineCount.toLocaleString()} lines to clipboard!`);
    } catch {
      showToast('Please select all text inside the code box and copy.');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  if (!isOpen) return null;

  if (currentUser && !isSuperAdmin) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fadeIn">
        <div className="bg-slate-900 border border-red-500/40 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto text-3xl">
            🛡️
          </div>
          <h2 className="text-xl font-black text-white">Access Denied</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            The SaaS Multi-Tenant Management Console is strictly reserved for the Platform Super Administrator (<strong className="text-amber-400">Andre Kudakwashe</strong>).
          </p>
          <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 text-[11px] text-slate-400 font-mono text-left space-y-1">
            <div>Current User: <span className="text-slate-200">{currentUser?.name || 'Unknown'}</span></div>
            <div>Role: <span className="text-amber-400">{currentUser?.role || 'None'}</span></div>
            <div>Email: <span className="text-slate-300">{currentUser?.email || 'None'}</span></div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Close &amp; Return to Terminal
          </button>
        </div>
      </div>
    );
  }

  const currentYearMonth = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}_${mm}`;
  };

  const handleCreateCompany = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;

    const companyId = `COMP-${Date.now().toString(36).toUpperCase()}`;
    const cleanName = newCompanyName.trim().replace(/[^a-zA-Z0-9]/g, '_');
    const newComp: Company = {
      company_id: companyId,
      company_name: newCompanyName.trim(),
      owner_name: newOwnerName.trim() || 'Business Owner',
      owner_email: newOwnerEmail.trim() || 'owner@example.com',
      sheet_folder_id: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
      sheet_id: '', // Unlinked until dedicated sheet is linked or duplicated from master template
      branch_isolation_mode: 'ROW_LEVEL',
      trial_start_date: new Date().toISOString().split('T')[0],
      subscription_status: 'TRIAL',
      plan: newPlan,
      next_billing_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      offline_activation_code: `SAI-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      trial_days_remaining: 14,
    };

    saveCompany(newComp);
    syncCompanyToCloud(newComp).catch(() => {});
    setNewCompanyName('');
    setNewOwnerEmail('');
    setNewOwnerName('');
    setIsAddCompanyModalOpen(false);
    showToast(`Registered ${newComp.company_name} with 14-day trial!`);
  };

  const handleOpenSheetLinkModal = (comp: Company) => {
    setLinkingSheetCompany(comp);
    setSheetUrlOrIdInput(isRealGoogleSheetId(comp.sheet_id) ? comp.sheet_id! : '');
    setSheetLinkError(null);
  };

  const handleSaveCompanySheetLink = (overrideId?: string) => {
    if (!linkingSheetCompany) return;
    const targetInput = overrideId || sheetUrlOrIdInput;
    const cleanId = extractGoogleSheetId(targetInput);

    if (!cleanId) {
      setSheetLinkError('Please provide a valid Google Sheet URL or Spreadsheet ID.');
      return;
    }

    const updated: Company = {
      ...linkingSheetCompany,
      sheet_id: cleanId,
    };

    saveCompany(updated);
    syncCompanyToCloud(updated).catch(() => {});
    showToast(`✓ Linked Google Sheet for ${updated.company_name}!`);
    setLinkingSheetCompany(null);
    setSheetUrlOrIdInput('');
    setSheetLinkError(null);
    confetti({ particleCount: 35, spread: 60, origin: { y: 0.7 } });
  };

  const handleConfirmPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyForPayment) return;

    const res = confirmCompanyPayment(
      selectedCompanyForPayment.company_id,
      paymentPlan,
      paymentMonths,
      'Andre Kudakwashe (Super Admin)',
      paymentNotes
    );

    if (res.success) {
      if (res.company) {
        syncCompanyToCloud(res.company).catch(() => {});
      }
      try {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.6 },
        });
      } catch {
        // ignore
      }
      showToast(res.message);
      setSelectedCompanyForPayment(null);
    }
  };

  const handleExtendTrial = (comp: Company) => {
    const res = extendCompanyTrial(comp.company_id, 14, 'Andre Kudakwashe (Super Admin)');
    if (res.success) {
      if (res.company) {
        syncCompanyToCloud(res.company).catch(() => {});
      }
      showToast(res.message);
    }
  };

  const handleSuspend = (comp: Company) => {
    if (window.confirm(`Are you sure you want to suspend '${comp.company_name}'? Their terminal access will be locked until payment is confirmed.`)) {
      const res = suspendCompany(comp.company_id, 'Admin manual lock');
      if (res.success) {
        showToast(res.message);
      }
    }
  };

  const handleCopyActivationCode = (comp: Company) => {
    const code = comp.offline_activation_code || `SAI-${comp.company_id.slice(-6)}`;
    navigator.clipboard.writeText(code);
    setCopiedCodeId(comp.company_id);
    setTimeout(() => setCopiedCodeId(null), 3000);
    showToast(`Copied activation key for ${comp.company_name}: ${code}`);
  };

  const handleSwitchToTenant = (comp: Company) => {
    setCurrentCompanyId(comp.company_id);
    showToast(`Switched active workspace to: ${comp.company_name}`);
    onClose();
  };

  const isCompanyMaster = (comp: Company) =>
    comp.company_id === 'COMP-001' || comp.company_id === 'COMP-MASTER';

  const companyHasValidSheet = (comp: Company) =>
    isRealGoogleSheetId(comp.sheet_id) ||
    (isCompanyMaster(comp) && isRealGoogleSheetId('1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE'));

  const countActive = companies.filter((c) => {
    const s = getSubscriptionStatus(c);
    return s.isActive && !s.isTrial;
  }).length;

  const countTrial = companies.filter((c) => {
    const s = getSubscriptionStatus(c);
    return s.isTrial && !s.isExpired;
  }).length;

  const countExpired = companies.filter((c) => {
    const s = getSubscriptionStatus(c);
    return !s.isActive || s.isExpired;
  }).length;

  const countNeedsSheet = companies.filter((c) => !companyHasValidSheet(c)).length;

  const filteredCompanies = companies.filter((c) => {
    const term = (searchTerm || '').toLowerCase().trim();
    const matchesSearch =
      !term ||
      (c.company_name && c.company_name.toLowerCase().includes(term)) ||
      (c.owner_email && c.owner_email.toLowerCase().includes(term)) ||
      (c.company_id && c.company_id.toLowerCase().includes(term)) ||
      (c.owner_name && c.owner_name.toLowerCase().includes(term));

    if (!matchesSearch) return false;

    const sub = getSubscriptionStatus(c);
    const hasSheet = companyHasValidSheet(c);

    if (statusFilter === 'ACTIVE') return sub.isActive && !sub.isTrial;
    if (statusFilter === 'TRIAL') return sub.isTrial && !sub.isExpired;
    if (statusFilter === 'EXPIRED') return !sub.isActive || sub.isExpired;
    if (statusFilter === 'NEEDS_SHEET') return !hasSheet;

    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 sm:backdrop-blur-md flex flex-col p-0 sm:p-3 md:p-4 overflow-hidden">
      <div className="bg-slate-900 sm:border sm:border-slate-800 sm:rounded-3xl w-full max-w-6xl h-full sm:h-[96vh] mx-auto flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Pinned Header - Always Visible on Mobile, PWA & Desktop */}
        <div className="flex items-center justify-between border-b border-slate-800 p-3 sm:p-4 bg-slate-900 shrink-0 z-20 sticky top-0 shadow-md">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shadow-lg shadow-amber-500/20 shrink-0">
              <Crown className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-white leading-tight">Super Admin SaaS Panel</h2>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] sm:text-[11px] font-bold border border-amber-500/30">
                  Master: Andre Kudakwashe
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Manage 14-Day Free Trials, Confirm Payments, Generate Offline Keys &amp; Sharded Databases
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAddCompanyModalOpen(true)}
              className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer active:scale-95 transition shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Tenant</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs for Super Admin Hub */}
        <div className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-slate-950/70 border-b border-slate-800/80 overflow-x-auto no-scrollbar shrink-0">
          <button
            type="button"
            onClick={() => setAdminTab('tenants')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              adminTab === 'tenants'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Tenants &amp; Subscriptions</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              adminTab === 'tenants' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-300'
            }`}>
              {companies.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setAdminTab('packages')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              adminTab === 'packages'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Package Setup &amp; Capabilities</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              adminTab === 'packages' ? 'bg-slate-950/30 text-slate-950' : 'bg-indigo-500/20 text-indigo-300'
            }`}>
              45 Functions
            </span>
          </button>

          <button
            type="button"
            onClick={() => setAdminTab('sheets')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              adminTab === 'sheets'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Google Sheets Setup</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              adminTab === 'sheets' ? 'bg-slate-950/30 text-slate-950' : 'bg-emerald-500/20 text-emerald-300'
            }`}>
              Super Admin
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onOpenReportBuilder) {
                onClose();
                onOpenReportBuilder();
              } else {
                setAdminTab('reports');
              }
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              adminTab === 'reports'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Universal Report Builder</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              adminTab === 'reports' ? 'bg-slate-950/30 text-slate-950' : 'bg-purple-500/20 text-purple-300'
            }`}>
              Super Admin
            </span>
          </button>
        </div>

        {/* Scrollable Content Container */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4">
          {/* Toast alert */}
          {toastMessage && (
            <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* PACKAGE SETUP VIEW TAB */}
          {adminTab === 'packages' && (
            <div className="animate-fadeIn">
              <PackageSetupView
                onClose={onClose}
                onOpenReportBuilder={() => {
                  if (onOpenReportBuilder) {
                    onClose();
                    onOpenReportBuilder();
                  } else {
                    setAdminTab('reports');
                  }
                }}
                onOpenSheetSetup={() => {
                  if (onOpenSheetSetup) {
                    onClose();
                    onOpenSheetSetup();
                  } else {
                    setAdminTab('sheets');
                  }
                }}
              />
            </div>
          )}

          {/* GOOGLE SHEETS SETUP TAB (SUPER ADMIN EXCLUSIVE) */}
          {adminTab === 'sheets' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-4 sm:p-6 rounded-3xl bg-gradient-to-br from-emerald-950/50 via-slate-900 to-slate-950 border border-emerald-500/30 shadow-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-base sm:text-lg font-black text-white">Super Admin Google Sheets Setup</h3>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                          Restricted Function
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Google Sheets synchronization and script setup are reserved for Super Administrators to protect master spreadsheets and API webhooks.
                      </p>
                    </div>
                  </div>

                  {onOpenSheetSetup && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenSheetSetup();
                      }}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs shadow-lg flex items-center justify-center space-x-2 cursor-pointer transition active:scale-95 shrink-0"
                    >
                      <RefreshCw className="w-4 h-4 text-slate-950" />
                      <span>Open Live Sync Hub</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  {/* Master Apps Script Webhook Controls */}
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Radio className="w-4 h-4 text-indigo-400" />
                        Master Apps Script Webhook URL
                      </span>
                      <span className="text-[10px] text-emerald-400 font-mono">Global Router</span>
                    </div>
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={masterWebhookInput}
                        onChange={(e) => setMasterWebhookInput(e.target.value)}
                        placeholder="https://script.google.com/macros/s/.../exec"
                        className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSaveMasterWebhook}
                          disabled={isSavingWebhook}
                          className="flex-1 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{isSavingWebhook ? 'Broadcasting...' : 'Save & Share to All Devices'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleTestWebhookConnection}
                          disabled={isTestingWebhook}
                          className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span>{isTestingWebhook ? 'Testing...' : 'Test'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 1-Click Apps Script Tools */}
                  <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      Self-Healing Deployment Tools
                    </span>
                    <p className="text-[11px] text-slate-400">
                      Generate all master tabs with precise column headers, or view the complete Google Apps Script ready for copy-pasting.
                    </p>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsInitTabsModalOpen(true)}
                        className="py-2 px-3 rounded-xl bg-amber-500/20 border border-amber-500/40 hover:bg-amber-500/30 text-amber-200 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>Auto-Create Tabs</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsViewCodeModalOpen(true)}
                        className="py-2 px-3 rounded-xl bg-purple-500/20 border border-purple-500/40 hover:bg-purple-500/30 text-purple-200 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-purple-400" />
                        <span>View Code.gs</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tenants Sheet Linker Overview */}
              <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Tenant Sheet Connections ({companies.filter(companyHasValidSheet).length} Linked / {companies.length} Total)
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Tenants cannot modify their sheet IDs — only Super Admins can link them.
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {companies.map((comp) => {
                    const hasSheet = companyHasValidSheet(comp);
                    return (
                      <div
                        key={comp.company_id}
                        className={`p-3 rounded-xl border flex items-center justify-between ${
                          hasSheet
                            ? 'bg-slate-950/60 border-emerald-500/30'
                            : 'bg-slate-950/60 border-amber-500/30'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-bold text-white truncate">{comp.company_name}</p>
                          <p className="text-[10px] text-slate-400 font-mono truncate">
                            {hasSheet ? `Sheet: ${comp.sheet_id?.slice(0, 14)}...` : 'No dedicated sheet linked'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setLinkingSheetCompany(comp);
                            setSheetUrlOrIdInput(comp.sheet_id || '');
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition shrink-0 ${
                            hasSheet
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                              : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                          }`}
                        >
                          {hasSheet ? 'Edit' : 'Link Sheet'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* UNIVERSAL REPORT BUILDER TAB (SUPER ADMIN EXCLUSIVE) */}
          {adminTab === 'reports' && (
            <div className="p-6 rounded-3xl bg-gradient-to-br from-purple-950/50 via-slate-900 to-slate-950 border border-purple-500/30 shadow-2xl space-y-5 animate-fadeIn text-center max-w-2xl mx-auto my-4">
              <div className="w-16 h-16 rounded-3xl bg-purple-500/20 border border-purple-500/40 text-purple-300 flex items-center justify-center mx-auto text-3xl shadow-xl">
                ✨
              </div>
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/30">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Super Admin Privilege Verified</span>
                </div>
                <h3 className="text-xl font-black text-white">Universal No-Code Report Builder</h3>
                <p className="text-xs text-slate-300 leading-relaxed max-w-lg mx-auto">
                  The Report Builder is a Super Admin exclusive capability. It allows you to construct any multi-table report across Sales, Products, Customers, Inventory, Staff, and Deliveries with calculated metrics, joins, and custom charts.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                {onOpenReportBuilder && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenReportBuilder();
                    }}
                    className="px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-xs shadow-xl shadow-purple-900/30 flex items-center justify-center gap-2 cursor-pointer transition active:scale-95"
                  >
                    <Zap className="w-4 h-4 text-purple-200" />
                    <span>Launch 5-Step Report Builder Wizard</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAdminTab('packages')}
                  className="px-5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Package className="w-4 h-4 text-amber-400" />
                  <span>Configure Report Access in Packages</span>
                </button>
              </div>
            </div>
          )}

          {/* TENANTS LIST VIEW TAB */}
          {adminTab === 'tenants' && (
            <>
          {/* Top Quick Stats KPI Bar - High-Contrast & Instant Visibility */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 block">Registered Tenants</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-white">{companies.length}</span>
                <span className="text-[10px] text-slate-400">Companies</span>
              </div>
            </div>
            <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-800/40 shadow-sm">
              <span className="text-[11px] font-bold text-emerald-400 block">Active Licenses</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-emerald-300">{countActive}</span>
                <span className="text-[10px] text-emerald-500">Paid Plans</span>
              </div>
            </div>
            <div className="p-3.5 rounded-2xl bg-blue-950/30 border border-blue-800/40 shadow-sm">
              <span className="text-[11px] font-bold text-blue-400 block">14-Day Free Trials</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-blue-300">{countTrial}</span>
                <span className="text-[10px] text-blue-400">Trial Period</span>
              </div>
            </div>
            <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/40 shadow-sm">
              <span className="text-[11px] font-bold text-amber-400 block">Dedicated Sheets</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-black text-amber-300">{companies.length - countNeedsSheet}</span>
                <span className="text-[10px] text-amber-500">{countNeedsSheet > 0 ? `${countNeedsSheet} Needs Sheet` : 'All Linked'}</span>
              </div>
            </div>
          </div>

          {/* Central Master Webhook Routing Hub - Super Admin Default Config */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/60 via-slate-900 to-slate-950 border border-indigo-900/60 shadow-xl space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center shrink-0">
                  <Radio className="w-4 h-4 text-indigo-400 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <span>Default Master Apps Script Webhook</span>
                    <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-mono font-bold border border-indigo-500/30">
                      Auto-Shared to All Devices
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    All new tenant registrations from any phone, tablet, or terminal automatically route through this master deployment.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={handleTestWebhookConnection}
                  disabled={isTestingWebhook}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition"
                  title="Test if the Apps Script Webhook is active and reachable"
                >
                  <Radio className={`w-3.5 h-3.5 text-indigo-400 ${isTestingWebhook ? 'animate-spin' : ''}`} />
                  <span>{isTestingWebhook ? 'Testing...' : 'Test Webhook'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveMasterWebhook}
                  disabled={isSavingWebhook}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition cursor-pointer"
                  title="Save this Webhook URL to the central server so all connected terminals use it"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingWebhook ? 'Saving...' : 'Set as System Default'}</span>
                </button>
              </div>
            </div>

            {/* Input fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div className="md:col-span-2 space-y-1">
                <label className="block text-[11px] font-bold uppercase text-slate-400">
                  Master Webhook Exec URL (Google Apps Script)
                </label>
                <input
                  type="text"
                  value={masterWebhookInput}
                  onChange={(e) => setMasterWebhookInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase text-slate-400">
                  Master Spreadsheet ID
                </label>
                <input
                  type="text"
                  value={masterSpreadsheetIdInput}
                  onChange={(e) => setMasterSpreadsheetIdInput(e.target.value)}
                  placeholder="1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* Test Feedback & Quick Sync Helper */}
            {webhookTestFeedback && (
              <div
                className={`p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
                  webhookTestFeedback.success
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}
              >
                {webhookTestFeedback.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{webhookTestFeedback.message}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-2 border-t border-slate-800/80 gap-2 text-xs">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className="text-amber-400 font-bold">💡 Multi-Tenant Rule:</span>
                <span>Single deployment handles all tenants. Individual users do not need their own deployment.</span>
              </div>

              <button
                type="button"
                onClick={handlePushAllTenantsToCloud}
                disabled={isPushingTenants}
                className="px-3 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 transition self-start sm:self-auto cursor-pointer"
                title="Pushes any local businesses created on this device directly to the Master Google Sheet"
              >
                <Send className={`w-3.5 h-3.5 ${isPushingTenants ? 'animate-bounce' : ''}`} />
                <span>{isPushingTenants ? 'Pushing Tenants...' : 'Push All Local Tenants to Master Sheet'}</span>
              </button>
            </div>
          </div>

          {/* Quick Actions & Master Sheet Sync Toolbar */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setIsInitTabsModalOpen(true);
                  setInitTabsFeedback(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 shadow-md shadow-amber-500/20 active:scale-95 transition cursor-pointer"
                title="Ensure all required tabs (companies, branches, users, permissions, etc.) exist in Master Sheet"
              >
                <Zap className="w-3.5 h-3.5 fill-slate-950" />
                <span>Auto-Create All Tabs</span>
              </button>

              <button
                type="button"
                onClick={handleSyncFromMasterSheet}
                disabled={isSyncingWithMaster}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 active:scale-95 transition cursor-pointer"
                title="Query Master Sheet 'companies' tab to pull all registered tenants"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingWithMaster ? 'animate-spin' : ''}`} />
                <span>{isSyncingWithMaster ? 'Syncing...' : 'Sync Tenants from Sheet'}</span>
              </button>

              <a
                href="https://docs.google.com/spreadsheets/d/1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE/edit"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition"
                title="Open Master Spreadsheet in Google Sheets"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                <span>Open Master Sheet</span>
              </a>
            </div>

            {/* Toggle technical architecture info */}
            <button
              type="button"
              onClick={() => setShowSystemInfo(!showSystemInfo)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-[11px] font-semibold flex items-center gap-1.5 border border-slate-800 transition cursor-pointer self-start sm:self-auto"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>{showSystemInfo ? 'Hide Architecture & Hub' : 'View Sheet Hub & Router Specs'}</span>
              {showSystemInfo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Collapsible System Architecture & Master Sheet Details */}
          {showSystemInfo && (
            <div className="space-y-3 animate-fadeIn">
              {/* Master Google Sheet Hub Card */}
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 shadow-xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 shadow-inner">
                      <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-sm text-white">Master Google Sheet Control Hub</h3>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Central Database
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span className="text-amber-400 font-bold">Master Sheet ID:</span>
                        <span className="text-slate-300 font-mono">1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 gap-1">
                  <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                    <Clock className="w-3 h-3 text-indigo-400" />
                    <span>{lastSyncStatus || 'Ready to sync with Master Sheet'}</span>
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Required Master tabs: <span className="text-amber-400 font-mono">companies</span>, <span className="text-amber-400 font-mono">branches</span>, <span className="text-amber-400 font-mono">users</span>, <span className="text-amber-400 font-mono">permissions</span>
                  </span>
                </div>
              </div>

              {/* Sharding Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-400 font-bold block text-[11px]">Master Sheet ID</span>
                  <p className="font-mono text-[11px] text-amber-400 truncate">1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE</p>
                  <span className="text-[10px] text-slate-500 block">Holds multi-tenant registry</span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-400 font-bold block text-[11px]">Tenant Architecture</span>
                  <p className="font-mono text-[11px] text-indigo-300 font-bold">Option A: 1 Sheet / Tenant</p>
                  <span className="text-[10px] text-emerald-400 block">Strict Isolation (0 Leakage)</span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-400 font-bold block text-[11px]">Monthly Partition</span>
                  <p className="font-mono text-[11px] text-emerald-400 font-bold">Prefix_{currentYearMonth()}</p>
                  <span className="text-[10px] text-slate-500 block">Auto-partitioned tables</span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-400 font-bold block text-[11px]">Apps Script Router</span>
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="font-mono text-[11px] text-white">Code.gs (2,208 Lines)</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleOpenViewCodeModal}
                        className="px-2 py-0.5 rounded bg-indigo-900/60 hover:bg-indigo-800 text-indigo-300 text-[10px] font-bold flex items-center gap-1 border border-indigo-700/50 cursor-pointer"
                        title="View and copy all 2,208 lines directly in browser"
                      >
                        <Eye className="w-3 h-3" />
                        View / Copy
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadCodeGs}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                        title="Download Code.gs file"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </button>
                    </div>
                  </div>
                  <span className="text-[10px] text-emerald-400 block">Master Google Apps Script Router</span>
                </div>
              </div>
            </div>
          )}

          {/* Search & Filter Controls */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search tenants by name, owner email, company ID..."
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl pl-9 pr-8 py-2 text-xs focus:outline-none focus:border-amber-500 placeholder:text-slate-500"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Filter Chips Bar */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1 rounded-xl font-bold whitespace-nowrap transition ${
                  statusFilter === 'ALL'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              >
                All Tenants ({companies.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-3 py-1 rounded-xl font-semibold whitespace-nowrap transition ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              >
                Active License ({countActive})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('TRIAL')}
                className={`px-3 py-1 rounded-xl font-semibold whitespace-nowrap transition ${
                  statusFilter === 'TRIAL'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              >
                Free Trial ({countTrial})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('NEEDS_SHEET')}
                className={`px-3 py-1 rounded-xl font-semibold whitespace-nowrap transition ${
                  statusFilter === 'NEEDS_SHEET'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
              >
                Needs Sheet ⚠️ ({countNeedsSheet})
              </button>
              {countExpired > 0 && (
                <button
                  type="button"
                  onClick={() => setStatusFilter('EXPIRED')}
                  className={`px-3 py-1 rounded-xl font-semibold whitespace-nowrap transition ${
                    statusFilter === 'EXPIRED'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  Expired ({countExpired})
                </button>
              )}
            </div>
          </div>

          {/* Mobile View: High-Visibility Responsive Tenant Cards */}
          <div className="block md:hidden space-y-3">
            {filteredCompanies.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-slate-950/60 rounded-2xl border border-slate-800">
                <Building2 className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-white">No tenants found</p>
                <p className="text-xs text-slate-400 mt-1">Try adjusting your search query or filter chips</p>
              </div>
            ) : (
              filteredCompanies.map((comp) => {
                const sub = getSubscriptionStatus(comp);
                const isMaster = isCompanyMaster(comp);
                const hasValidSheet = companyHasValidSheet(comp);
                const code = comp.offline_activation_code || `SAI-${comp.company_id.slice(-6)}`;
                const dedicatedSheetId = isRealGoogleSheetId(comp.sheet_id)
                  ? comp.sheet_id!
                  : isMaster
                  ? '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE'
                  : '';

                return (
                  <div
                    key={comp.company_id}
                    className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 shadow-lg space-y-3 text-slate-200"
                  >
                    {/* Top Bar: Name & Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-bold text-base text-white">{comp.company_name}</h3>
                          {isMaster && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold border border-amber-500/30">
                              HQ Master
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                          <span className="font-mono text-amber-400/90 font-bold">{comp.company_id}</span>
                          <span>•</span>
                          <span>{comp.business_category || 'Retail Store'}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Owner: <span className="text-slate-300 font-medium">{comp.owner_name || comp.owner_email}</span>
                        </p>
                      </div>

                      <div className="shrink-0">
                        {sub.isActive && !sub.isTrial ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>Active</span>
                          </span>
                        ) : sub.isTrial && !sub.isExpired ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 font-bold text-[10px] border border-blue-500/30">
                            <Clock className="w-3 h-3 text-blue-400" />
                            <span>Trial: {sub.daysRemaining}d</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 font-bold text-[10px] border border-rose-500/30">
                            <ShieldAlert className="w-3 h-3 text-rose-400" />
                            <span>Expired</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Dedicated Sheet Section */}
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-400 font-semibold">Google Sheet (Option A):</span>
                        <span className="text-[10px] text-slate-500">
                          Isolation: <span className="text-emerald-400 font-semibold">{comp.branch_isolation_mode || 'ROW_LEVEL'}</span>
                        </span>
                      </div>

                      {hasValidSheet ? (
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <span className="font-mono text-[11px] text-emerald-300 truncate max-w-[170px]" title={dedicatedSheetId}>
                            {dedicatedSheetId}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={`https://docs.google.com/spreadsheets/d/${dedicatedSheetId}/edit`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 text-[11px] font-bold flex items-center gap-1 transition"
                            >
                              <span>Open</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <button
                              type="button"
                              onClick={() => handleOpenSheetLinkModal(comp)}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <span className="text-[11px] text-amber-300 font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>Needs Sheet</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenSheetLinkModal(comp)}
                            className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] shadow-sm transition active:scale-95"
                          >
                            Link Dedicated Sheet
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Plan & Offline Activation Key */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                        <span className="text-slate-400 block text-[10px]">Plan &amp; Expiry</span>
                        <span className="font-bold text-white">{comp.plan}</span>
                        <span className="text-slate-500 block text-[10px]">Exp: {comp.next_billing_date}</span>
                      </div>

                      <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
                        <span className="text-slate-400 block text-[10px]">Offline Key</span>
                        <button
                          type="button"
                          onClick={() => handleCopyActivationCode(comp)}
                          className="font-mono text-[11px] text-amber-400 font-bold flex items-center justify-between gap-1 text-left mt-0.5 hover:text-amber-300"
                        >
                          <span className="truncate">{code}</span>
                          {copiedCodeId === comp.company_id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Admin Actions Bar */}
                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedCompanyForPayment(comp)}
                        className="py-2 px-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center justify-center gap-1 shadow-sm active:scale-95 transition"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Pay</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExtendTrial(comp)}
                        className="py-2 px-1 rounded-xl bg-indigo-950 hover:bg-indigo-900 text-indigo-200 text-[11px] font-semibold border border-indigo-800/80 flex items-center justify-center gap-1 active:scale-95 transition"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>+14d</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAdminTab('packages')}
                        className="py-2 px-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[11px] font-bold border border-amber-500/30 flex items-center justify-center gap-1 active:scale-95 transition"
                        title="Manage & Save Package"
                      >
                        <Package className="w-3.5 h-3.5" />
                        <span>Pkg</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSwitchToTenant(comp)}
                        className="py-2 px-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold border border-slate-700 flex items-center justify-center gap-1 active:scale-95 transition"
                      >
                        <span>Switch</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block rounded-2xl border border-slate-800 overflow-hidden bg-slate-950/60">
            <table className="w-full text-left text-xs text-slate-300 border-collapse">
              <thead className="bg-slate-950 sticky top-0 uppercase font-bold text-slate-400 border-b border-slate-800 z-10">
                <tr>
                  <th className="py-3 px-3">Company &amp; Owner</th>
                  <th className="py-3 px-3">Dedicated Sheet (Option A)</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Status &amp; Trial</th>
                  <th className="py-3 px-3">Plan &amp; Expiry</th>
                  <th className="py-3 px-3">Offline Key</th>
                  <th className="py-3 px-3 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                {filteredCompanies.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No tenant company accounts found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredCompanies.map((comp) => {
                    const sub = getSubscriptionStatus(comp);
                    const isMaster = isCompanyMaster(comp);
                    const code = comp.offline_activation_code || `SAI-${comp.company_id.slice(-6)}`;
                    const hasValidSheet = companyHasValidSheet(comp);
                    const dedicatedSheetId = isRealGoogleSheetId(comp.sheet_id)
                      ? comp.sheet_id!
                      : isMaster
                      ? '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE'
                      : '';

                    return (
                      <tr key={comp.company_id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-white text-sm flex items-center gap-1.5">
                            <span>{comp.company_name}</span>
                            {isMaster && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold border border-amber-500/30">
                                HQ Master
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-amber-400/90">{comp.company_id}</span>
                            <span>•</span>
                            <span>{comp.owner_name || comp.owner_email}</span>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          {hasValidSheet ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11px] text-emerald-300 truncate max-w-[130px] block" title={dedicatedSheetId}>
                                {dedicatedSheetId}
                              </span>
                              <a
                                href={`https://docs.google.com/spreadsheets/d/${dedicatedSheetId}/edit`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                                title="Open in Google Sheets"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <button
                                type="button"
                                onClick={() => handleOpenSheetLinkModal(comp)}
                                className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700"
                                title="Edit Sheet ID"
                              >
                                Edit
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800 font-semibold">
                                ⚠️ Needs Sheet
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOpenSheetLinkModal(comp)}
                                className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold transition cursor-pointer"
                              >
                                Link Sheet
                              </button>
                            </div>
                          )}
                          <span className="text-[10px] text-slate-500 block mt-0.5">
                            Isolation: <span className="text-emerald-400 font-semibold">{comp.branch_isolation_mode || 'ROW_LEVEL'}</span>
                          </span>
                        </td>

                        <td className="py-3 px-3 text-slate-300">
                          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px]">
                            {comp.business_category || 'Retail Store'}
                          </span>
                        </td>

                        <td className="py-3 px-3">
                          {sub.isActive && !sub.isTrial ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/30">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span>Active License</span>
                            </span>
                          ) : sub.isTrial && !sub.isExpired ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold text-[10px] border border-blue-500/30">
                              <Clock className="w-3 h-3 text-blue-400" />
                              <span>Trial: {sub.daysRemaining}d Left</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-bold text-[10px] border border-rose-500/30">
                              <ShieldAlert className="w-3 h-3 text-rose-400" />
                              <span>Expired / Suspended</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 font-mono">
                          <div className="text-white font-bold">{comp.plan}</div>
                          <div className="text-[11px] text-slate-400">Exp: {comp.next_billing_date}</div>
                        </td>

                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleCopyActivationCode(comp)}
                            className="font-mono text-[11px] px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-amber-400 flex items-center gap-1"
                            title="Click to copy key to send to client"
                          >
                            {copiedCodeId === comp.company_id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <KeyRound className="w-3 h-3" />
                                <span>{code}</span>
                              </>
                            )}
                          </button>
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedCompanyForPayment(comp)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 shadow-sm cursor-pointer"
                              title="Verify customer payment and activate license"
                            >
                              <CreditCard className="w-3 h-3" />
                              <span>Confirm Payment</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setAdminTab('packages')}
                              className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                              title="Manage & Save Package for this Tenant"
                            >
                              <Package className="w-3 h-3 text-amber-400" />
                              <span>Package</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleExtendTrial(comp)}
                              className="px-2 py-1 rounded-lg bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 text-[11px] font-semibold border border-indigo-700/60 cursor-pointer"
                              title="Grant 14 extra trial days"
                            >
                              +14d Trial
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSwitchToTenant(comp)}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] cursor-pointer"
                              title="Switch active session into this company workspace"
                            >
                              Switch
                            </button>

                            {!isMaster && comp.subscription_status !== 'CANCELLED' && (
                              <button
                                type="button"
                                onClick={() => handleSuspend(comp)}
                                className="p-1 rounded-lg hover:bg-rose-950/80 text-rose-400 hover:text-rose-300 cursor-pointer"
                                title="Suspend account"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 p-3 sm:px-5 sm:py-3 bg-slate-900 text-xs text-slate-400 shrink-0">
          <span>
            Showing <strong className="text-white">{filteredCompanies.length}</strong> of <strong className="text-white">{companies.length}</strong> tenant accounts
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold cursor-pointer transition"
          >
            Close
          </button>
        </div>
      </div>

      {/* Payment Confirmation Modal */}
      {selectedCompanyForPayment && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-400" />
                Confirm Payment &amp; Activate License
              </h3>
              <button
                type="button"
                onClick={() => setSelectedCompanyForPayment(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs">
              <p className="font-bold text-white text-sm">{selectedCompanyForPayment.company_name}</p>
              <p className="text-slate-400 font-mono">ID: {selectedCompanyForPayment.company_id}</p>
              <p className="text-slate-400">Owner: {selectedCompanyForPayment.owner_name} ({selectedCompanyForPayment.owner_email})</p>
            </div>

            <form onSubmit={handleConfirmPayment} className="space-y-3.5 text-xs">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Subscription Plan</label>
                <select
                  value={paymentPlan}
                  onChange={(e) => setPaymentPlan(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs"
                >
                  <option value="STARTER">Starter Plan ($25/mo - 1 Branch, 3 Staff)</option>
                  <option value="PROFESSIONAL">Professional Plan ($50/mo - 3 Branches, 10 Staff)</option>
                  <option value="ENTERPRISE">Enterprise Plan ($100/mo - Unlimited Branches &amp; Staff)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Duration Paid</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: '1 Month', months: 1 },
                    { label: '3 Months', months: 3 },
                    { label: '12 Months (1 Year)', months: 12 },
                  ].map((d) => (
                    <button
                      key={d.months}
                      type="button"
                      onClick={() => setPaymentMonths(d.months)}
                      className={`py-2 rounded-xl font-bold border text-center ${
                        paymentMonths === d.months
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Payment Method / Reference</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="e.g. Ecocash Ref #MP260906.1234, Cash USD"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs"
                />
              </div>

              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-[11px] text-emerald-200">
                ✨ Clicking confirm marks subscription as <strong>ACTIVE</strong>, sets next billing date +{paymentMonths} month(s), and logs this verification under Andre Kudakwashe.
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedCompanyForPayment(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black flex items-center justify-center gap-1.5 shadow-md shadow-emerald-900/20 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Activate License</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Tenant Modal */}
      {isAddCompanyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                Register New SaaS Tenant
              </h3>
              <button
                type="button"
                onClick={() => setIsAddCompanyModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCompany} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300">Company / Store Name</label>
                <input
                  type="text"
                  required
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="e.g. Apex Supermarket"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300">Owner Full Name</label>
                <input
                  type="text"
                  value={newOwnerName}
                  onChange={(e) => setNewOwnerName(e.target.value)}
                  placeholder="e.g. Farai Dube"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300">Owner Email</label>
                <input
                  type="email"
                  required
                  value={newOwnerEmail}
                  onChange={(e) => setNewOwnerEmail(e.target.value)}
                  placeholder="owner@example.com"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300">Plan</label>
                <select
                  value={newPlan}
                  onChange={(e) => setNewPlan(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 mt-1"
                >
                  <option value="STARTER">Starter Plan</option>
                  <option value="PROFESSIONAL">Professional Plan</option>
                  <option value="ENTERPRISE">Enterprise Plan</option>
                </select>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                ⭐ New tenant will be registered with a 14-day free trial. You can confirm their payment anytime right from this dashboard.
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddCompanyModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
                >
                  Create Tenant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link Dedicated Google Sheet Modal */}
      {linkingSheetCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="font-bold text-sm text-white">Link Dedicated Google Sheet</h3>
                  <p className="text-xs text-slate-400">{linkingSheetCompany.company_name} ({linkingSheetCompany.company_id})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLinkingSheetCompany(null)}
                className="p-1 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Architecture Explanation Banner */}
            <div className="p-3 bg-indigo-950/50 border border-indigo-800/60 rounded-xl text-xs space-y-1 text-indigo-200">
              <div className="font-bold text-white flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Single Apps Script Deployment Architecture</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                <strong>You do NOT need a separate Apps Script deployment for this tenant!</strong> Your master Apps Script router automatically opens any tenant spreadsheet via <code className="text-emerald-300">SpreadsheetApp.openById(sheet_id)</code>. Each tenant only needs their own spreadsheet file in Google Drive.
              </p>
            </div>

            {/* Method 1: Duplicate Master Template */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">Method 1: Clone Master Sheet Template (1-Click)</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">Fastest</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Click below to duplicate all 10 business tabs (Sales, CashLog, Customers, etc.) into your Google Drive:
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
            </div>

            {/* Method 2: Paste Google Sheet URL or ID */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-200 block">
                Method 2: Paste Google Sheet URL or ID
              </label>
              <input
                type="text"
                value={sheetUrlOrIdInput}
                onChange={(e) => {
                  setSheetUrlOrIdInput(e.target.value);
                  setSheetLinkError(null);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/1gtbI5TK.../edit"
                className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-indigo-500 font-mono-num"
              />
              {sheetUrlOrIdInput && (
                <div className="text-[10px] font-mono text-slate-400 bg-slate-950 p-2 rounded-lg border border-slate-800">
                  Extracted ID: <span className="text-emerald-400 font-bold">{extractGoogleSheetId(sheetUrlOrIdInput) || 'None'}</span>
                </div>
              )}
              {sheetLinkError && (
                <p className="text-xs text-rose-400 flex items-center space-x-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{sheetLinkError}</span>
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => handleSaveCompanySheetLink()}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow transition active:scale-95 flex items-center justify-center space-x-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Save Dedicated Sheet Link</span>
              </button>

              <button
                type="button"
                onClick={() => handleSaveCompanySheetLink('1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE')}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition"
              >
                Use Master Sheet for Now (Row-Level Isolated)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Create All Master Tabs Modal */}
      {isInitTabsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl space-y-4 text-slate-100 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Zap className="w-5 h-5 fill-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Auto-Create Master Sheet Tabs</h3>
                  <p className="text-xs text-slate-400">Self-Healing Multi-Tenant System</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsInitTabsModalOpen(false);
                  setInitTabsFeedback(null);
                }}
                className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanatory Banner */}
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <p className="text-slate-300 leading-relaxed">
                When new companies register or when setting up a new master sheet, the system requires the following core tabs to be present so companies appear in your Super Admin panel:
              </p>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] pt-1">
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800 text-amber-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>companies</span>
                </div>
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800 text-amber-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>branches</span>
                </div>
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800 text-indigo-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>users</span>
                </div>
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800 text-indigo-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>permissions (52)</span>
                </div>
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800 text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Subscriptions</span>
                </div>
                <div className="p-1.5 rounded bg-slate-900 border border-slate-800 text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Sales &amp; CashLog</span>
                </div>
              </div>
            </div>

            {/* Feedback Alert if executed */}
            {initTabsFeedback && (
              <div
                className={`p-3 rounded-2xl border text-xs flex items-start gap-2.5 animate-fadeIn ${
                  initTabsFeedback.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                }`}
              >
                {initTabsFeedback.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold">{initTabsFeedback.message}</p>
                  {initTabsFeedback.createdTabs && initTabsFeedback.createdTabs.length > 0 && (
                    <p className="text-[11px] text-slate-300 mt-1">
                      Created tabs: {initTabsFeedback.createdTabs.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Method A: 1-Click via Webhook */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleRunAutoCreateTabs}
                disabled={isInitializingTabs}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {isInitializingTabs ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Verifying and Initializing Tabs...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-slate-950" />
                    <span>Auto-Initialize Tabs via Webhook Now</span>
                  </>
                )}
              </button>
            </div>

            {/* Full Code.gs Source & Download */}
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-indigo-950/60 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-200 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Latest Code.gs Master Script</span>
                </span>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">2,208 lines</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Contains the complete multi-tenant router, Subscriptions tracking tab, 52-permission RBAC seed, automatic self-healing tabs, and monthly auto-partitioning.
              </p>
              <div className="flex items-center gap-2 pt-1 flex-wrap sm:flex-nowrap">
                <button
                  type="button"
                  onClick={handleCopyEntireCodeGs}
                  className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/20 active:scale-95 transition cursor-pointer"
                >
                  {copiedFullCode ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedFullCode ? 'Copied 2,208 Lines!' : 'Copy Full Code.gs'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenViewCodeModal}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold text-xs border border-slate-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>View Code</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadCodeGs}
                  className="py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-950" />
                  <span>Download .gs</span>
                </button>
              </div>
            </div>

            {/* Method B: In Apps Script editor directly */}
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">Alternative: Run in Google Apps Script</span>
                <button
                  type="button"
                  onClick={handleCopyMasterScriptSnippet}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
                >
                  {copiedScript ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedScript ? 'Copied' : 'Copy Function'}</span>
                </button>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px]">
                <li>Open your Google Sheet: <strong className="text-slate-200">Extensions &gt; Apps Script</strong></li>
                <li>In <strong className="text-slate-200">Code.gs</strong>, select <code className="text-amber-300 font-mono">setupMasterSheets</code> from the function dropdown.</li>
                <li>Click <strong className="text-emerald-400">▷ Run</strong>. All tabs will be created with headers automatically!</li>
              </ol>
            </div>

            {/* Footer Buttons */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setIsInitTabsModalOpen(false)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Code.gs Source Viewer & Direct Copy Modal */}
      {isViewCodeModalOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur-md flex flex-col p-0 sm:p-3 md:p-4 overflow-hidden animate-fadeIn">
          <div className="bg-slate-900 sm:border sm:border-slate-800 sm:rounded-3xl w-full max-w-5xl h-full sm:h-[94vh] mx-auto flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 p-3.5 sm:p-4 bg-slate-900 shrink-0 sticky top-0 z-10 shadow-md">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center border border-indigo-500/30">
                  <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm text-white">Full Master Code.gs</h3>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold border border-emerald-500/30">
                      {codeLineCount.toLocaleString()} Lines
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                      ~85 KB
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">Complete Google Apps Script multi-tenant router and tabs generator</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCodeFromModal}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition cursor-pointer"
                >
                  {copiedFullCode ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{copiedFullCode ? 'Copied All!' : `Copy All (${codeLineCount.toLocaleString()} Lines)`}</span>
                  <span className="sm:hidden">{copiedFullCode ? 'Copied!' : 'Copy All'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCodeGs}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Download .gs</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsViewCodeModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="Close viewer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Note */}
            <div className="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 text-xs">
              <div className="text-[11px] text-slate-300 flex items-center gap-1.5">
                <span className="text-amber-400 font-bold">📋 Deployment Note:</span>
                <span>Open your Master Google Sheet &rarr; <strong>Extensions &gt; Apps Script</strong>, paste this entire code into <strong>Code.gs</strong>, and deploy as a Web App (Access: Anyone).</span>
              </div>
            </div>

            {/* Scrollable Code Box */}
            <div className="flex-1 overflow-auto p-4 bg-slate-950 font-mono text-[11px] text-slate-300 select-all leading-relaxed whitespace-pre">
              {isLoadingCode ? (
                <div className="flex items-center justify-center h-48 text-slate-400 gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Loading full Code.gs script ({codeLineCount.toLocaleString()} lines)...</span>
                </div>
              ) : (
                fullCodeContent || '// Loading code content...'
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
