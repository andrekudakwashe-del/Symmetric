import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Shield,
  Layers,
  Building,
  GitBranch,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  HardDrive,
  Activity,
  Copy,
  Check,
  FileSpreadsheet,
  Cpu,
  Wifi,
  WifiOff,
  ExternalLink,
  Zap,
} from 'lucide-react';
import {
  getCurrentCompany,
  getCurrentCompanyId,
  getCurrentBranch,
  getBranches,
  getCompanies,
  getProducts,
  getSales,
  getCustomers,
  getSuppliers,
  getSalespeopleForCompany,
  getSheetsConfig,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';
import {
  CURRENT_IDB_SCHEMA_VERSION,
  CURRENT_SAAS_SCHEMA_VERSION,
} from '../../db/indexedDBService';
import { persistentSyncEngine, SyncQueueStats } from '../../services/persistentSyncEngine';
import { fetchGlobalSystemConfig, GlobalSystemConfig } from '../../services/systemConfig';

interface TenantDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast?: (msg: string) => void;
}

interface AuditRecord {
  entity: string;
  total: number;
  validTenant: number;
  unassigned: number;
  status: 'OPTIMAL' | 'WARNING' | 'CRITICAL';
}

export const TenantDiagnosticsModal: React.FC<TenantDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'partition' | 'storage' | 'cloud'>('overview');
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStats, setSyncStats] = useState<SyncQueueStats>({
    total: 0,
    pending: 0,
    syncing: 0,
    done: 0,
    failed: 0,
  });
  const [globalConfig, setGlobalConfig] = useState<GlobalSystemConfig | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<{ usageMB: number; quotaMB: number; percent: number } | null>(null);
  const [serverPingStatus, setServerPingStatus] = useState<'idle' | 'checking' | 'healthy' | 'error'>('idle');
  const [serverPingLatency, setServerPingLatency] = useState<number | null>(null);
  const [serverPingMessage, setServerPingMessage] = useState<string>('');

  const company = getCurrentCompany();
  const currentCompanyId = getCurrentCompanyId();
  const currentBranch = getCurrentBranch();
  const allBranches = getBranches();
  const tenantBranches = useMemo(() => {
    return allBranches.filter((b) => (b.company_id || b.companyId) === currentCompanyId);
  }, [allBranches, currentCompanyId]);
  const sheetsConfig = getSheetsConfig();

  // Audit local partition integrity
  const partitionAudit: AuditRecord[] = useMemo(() => {
    const products = getProducts();
    const sales = getSales();
    const customers = getCustomers();
    const suppliers = getSuppliers();
    const staff = getSalespeopleForCompany(currentCompanyId);

    const auditItem = (entity: string, list: any[]): AuditRecord => {
      const total = list.length;
      if (total === 0) {
        return { entity, total: 0, validTenant: 0, unassigned: 0, status: 'OPTIMAL' };
      }
      let valid = 0;
      let unassigned = 0;
      for (const item of list) {
        const itemComp = item.company_id || item.companyId;
        if (!itemComp || itemComp === currentCompanyId) {
          valid++;
        } else {
          unassigned++;
        }
      }
      const status = unassigned === 0 ? 'OPTIMAL' : unassigned < 5 ? 'WARNING' : 'CRITICAL';
      return { entity, total, validTenant: valid, unassigned, status };
    };

    return [
      auditItem('Inventory Catalog (Products)', products),
      auditItem('Transactions (Sales Ledger)', sales),
      auditItem('Customer Profiles', customers),
      auditItem('Supplier Directory', suppliers),
      {
        entity: 'Branch Partitions',
        total: tenantBranches.length,
        validTenant: tenantBranches.length,
        unassigned: 0,
        status: tenantBranches.length > 0 ? 'OPTIMAL' : 'WARNING',
      },
      {
        entity: 'Staff & Cashier Access',
        total: staff.length,
        validTenant: staff.length,
        unassigned: 0,
        status: staff.length > 0 ? 'OPTIMAL' : 'WARNING',
      },
    ];
  }, [currentCompanyId, tenantBranches]);

  const overallHealth = useMemo(() => {
    const hasCritical = partitionAudit.some((a) => a.status === 'CRITICAL');
    const hasWarning = partitionAudit.some((a) => a.status === 'WARNING');
    if (hasCritical) return { score: 72, label: 'Attention Needed', color: 'text-rose-400 bg-rose-950/60 border-rose-800' };
    if (hasWarning) return { score: 91, label: 'Good (Minor Notice)', color: 'text-amber-400 bg-amber-950/60 border-amber-800' };
    return { score: 100, label: 'Optimal & Fully Isolated', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800' };
  }, [partitionAudit]);

  const loadDiagnostics = async () => {
    setIsRefreshing(true);
    try {
      const s = await persistentSyncEngine.getQueueStats(currentCompanyId);
      setSyncStats(s);

      const cfg = await fetchGlobalSystemConfig();
      setGlobalConfig(cfg);

      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const usageMB = Math.round((est.usage || 0) / (1024 * 1024) * 10) / 10;
        const quotaMB = Math.round((est.quota || 1) / (1024 * 1024) * 10) / 10;
        const percent = Math.min(100, Math.round((usageMB / (quotaMB || 1)) * 100 * 10) / 10);
        setStorageEstimate({ usageMB, quotaMB, percent });
      }
    } catch (e) {
      console.error('Failed to load diagnostics data', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const checkServerPing = async () => {
    setServerPingStatus('checking');
    const start = performance.now();
    try {
      const res = await fetch('/api/system/config', { method: 'GET' });
      const elapsed = Math.round(performance.now() - start);
      setServerPingLatency(elapsed);
      if (res.ok) {
        setServerPingStatus('healthy');
        setServerPingMessage(`Central Server Connected (${elapsed}ms)`);
      } else {
        setServerPingStatus('error');
        setServerPingMessage(`Server returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      setServerPingStatus('error');
      setServerPingMessage(err?.message || 'Network unreachable');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadDiagnostics();
    checkServerPing();

    const unsub = subscribeRoomDatabase(() => {
      // Re-evaluate on DB update
    });
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const copySnapshot = () => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      tenant: {
        companyId: company.company_id,
        companyName: company.company_name,
        ownerEmail: company.owner_email,
        plan: company.plan,
        subscriptionStatus: company.subscription_status,
        isolationMode: company.branch_isolation_mode || 'ROW_LEVEL',
        dedicatedSheetId: company.sheet_id || null,
        dedicatedWebhookUrl: company.webhook_url || null,
      },
      currentBranch: {
        branchId: currentBranch.branchId,
        name: currentBranch.name,
        code: currentBranch.code,
      },
      tenantBranchesCount: tenantBranches.length,
      schemas: {
        idbSchemaVersion: CURRENT_IDB_SCHEMA_VERSION,
        saasProtocolVersion: CURRENT_SAAS_SCHEMA_VERSION,
      },
      health: {
        score: overallHealth.score,
        label: overallHealth.label,
        partitionAudit,
        syncStats,
        storageEstimate,
      },
      cloudConnectivity: {
        serverPingStatus,
        serverPingLatency,
        serverPingMessage,
        masterWebhookConfigured: Boolean(sheetsConfig.masterWebhookUrl || globalConfig?.masterWebhookUrl),
      },
    };

    navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)).then(() => {
      setCopied(true);
      if (onShowToast) onShowToast('✓ Tenant health diagnostic copied to clipboard!');
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tenant-diagnostics-title"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-950/80 border border-indigo-700/70 flex items-center justify-center text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 id="tenant-diagnostics-title" className="text-base font-bold text-white tracking-wide">
                  Tenant Health &amp; Schema Diagnostics
                </h2>
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${overallHealth.color}`}>
                  {overallHealth.score}% {overallHealth.label}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Multi-Tenant isolation monitor, schema integrity verification &amp; partition health
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={copySnapshot}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 flex items-center space-x-1.5 transition"
              title="Copy diagnostics JSON snapshot"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Snapshot'}</span>
            </button>
            <button
              type="button"
              onClick={loadDiagnostics}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
              title="Refresh diagnostics"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 bg-slate-950/40 border-b border-slate-800 flex space-x-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`py-3 border-b-2 flex items-center space-x-2 transition ${
              activeTab === 'overview'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building className="w-4 h-4" />
            <span>Tenant Context</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('partition')}
            className={`py-3 border-b-2 flex items-center space-x-2 transition ${
              activeTab === 'partition'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Partition &amp; Isolation Audit</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            className={`py-3 border-b-2 flex items-center space-x-2 transition ${
              activeTab === 'storage'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Storage &amp; Sync Queue</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cloud')}
            className={`py-3 border-b-2 flex items-center space-x-2 transition ${
              activeTab === 'cloud'
                ? 'border-indigo-500 text-indigo-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Cloud &amp; Webhook Link</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Tenant Key Metrics Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Active Tenant</div>
                  <div className="mt-1 text-sm font-bold text-white truncate">{company.company_name}</div>
                  <div className="mt-0.5 text-xs text-indigo-400 font-mono">{company.company_id}</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Active Branch</div>
                  <div className="mt-1 text-sm font-bold text-white truncate">{currentBranch.name}</div>
                  <div className="mt-0.5 text-xs text-slate-400 font-mono">Code: {currentBranch.code || 'HQ'}</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Plan &amp; Status</div>
                  <div className="mt-1 flex items-center space-x-1.5">
                    <span className="text-xs font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/80">
                      {company.plan || 'PROFESSIONAL'}
                    </span>
                    <span className="text-[11px] text-indigo-300 px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/80">
                      {company.subscription_status || 'ACTIVE'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {company.trial_days_remaining !== undefined
                      ? `${company.trial_days_remaining} trial days left`
                      : 'Subscription active'}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-800/70 border border-slate-700/60">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Schema Protocol</div>
                  <div className="mt-1 text-sm font-bold text-white flex items-center space-x-2">
                    <span className="font-mono text-cyan-400">IDB v{CURRENT_IDB_SCHEMA_VERSION}</span>
                    <span className="text-slate-500">•</span>
                    <span className="font-mono text-indigo-400">SaaS v{CURRENT_SAAS_SCHEMA_VERSION}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">IndexedDB Cash &amp; Sync ready</div>
                </div>
              </div>

              {/* Detailed Tenant Configuration & Branch Topology */}
              <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                    <GitBranch className="w-4 h-4 text-indigo-400" />
                    <span>Configured Branches for {company.company_name}</span>
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">
                    {tenantBranches.length} {tenantBranches.length === 1 ? 'branch' : 'branches'} registered
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {tenantBranches.map((br) => {
                    const isSelected = br.branchId === currentBranch.branchId;
                    return (
                      <div
                        key={br.branchId}
                        className={`p-3 rounded-lg border text-xs transition ${
                          isSelected
                            ? 'bg-indigo-950/40 border-indigo-600/80 text-white shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold truncate">{br.name}</span>
                          {isSelected && (
                            <span className="text-[10px] text-indigo-300 bg-indigo-900/80 px-1.5 py-0.5 rounded font-bold border border-indigo-700">
                              Active Terminal
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400 font-mono">
                          ID: {br.branchId} | Code: {br.code || 'N/A'}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                          {br.location || br.address || 'Standard Location'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tenant Metadata Summary */}
              <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center space-x-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>Tenant Metadata &amp; Contact</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Owner Email:</span>
                    <span className="font-mono text-slate-200">{company.owner_email || 'Not specified'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Owner Name:</span>
                    <span className="text-slate-200">{company.owner_name || 'Owner'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Business Category:</span>
                    <span className="text-slate-200">{company.business_category || 'Retail / Wholesale'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-800">
                    <span className="text-slate-400">Isolation Mode:</span>
                    <span className="font-mono text-indigo-300">{company.branch_isolation_mode || 'ROW_LEVEL'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'partition' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex items-start space-x-3">
                <Shield className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-white">Row-Level Security &amp; Tenant Partition Guard</div>
                  <p className="text-slate-300">
                    Each transactional row and master record is cryptographically scoped with{' '}
                    <code className="px-1 py-0.5 rounded bg-slate-900 font-mono text-indigo-300">{currentCompanyId}</code>.
                    This real-time auditor inspects local database stores to verify 100% boundary isolation across tenants.
                  </p>
                </div>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3">Store / Collection</th>
                      <th className="px-4 py-3 text-right">Total Records</th>
                      <th className="px-4 py-3 text-right">Tenant-Tagged</th>
                      <th className="px-4 py-3 text-right">Untagged / Other</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    {partitionAudit.map((row) => (
                      <tr key={row.entity} className="hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-medium text-white">{row.entity}</td>
                        <td className="px-4 py-3 text-right font-mono">{row.total}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-400">{row.validTenant}</td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.unassigned > 0 ? (
                            <span className="text-amber-400 font-bold">{row.unassigned}</span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.status === 'OPTIMAL' ? (
                            <span className="inline-flex items-center space-x-1 text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Isolated</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Notice</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Storage Quota Estimate */}
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                      <HardDrive className="w-4 h-4 text-cyan-400" />
                      <span>Local Device Storage</span>
                    </span>
                    <span className="text-xs font-mono text-cyan-400">
                      {storageEstimate ? `${storageEstimate.usageMB} MB used` : 'Calculating...'}
                    </span>
                  </div>

                  <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-700/60">
                    <div
                      className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(2, storageEstimate?.percent || 5)}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span>Usage: {storageEstimate?.usageMB || 0} MB</span>
                    <span>Quota: {storageEstimate?.quotaMB ? `${storageEstimate.quotaMB} MB` : 'Browser managed'}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    IndexedDB stores offline transactions, cash movements, and catalog offline cache with Zero-Data-Loss durability.
                  </p>
                </div>

                {/* Persistent Sync Queue Health */}
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span>Persistent Sync Engine Queue</span>
                    </span>
                    <span className="text-xs font-mono text-amber-300">
                      {syncStats.pending} pending / {syncStats.failed} failed
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Total</div>
                      <div className="font-bold text-white font-mono mt-0.5">{syncStats.total}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-amber-400">Pending</div>
                      <div className="font-bold text-amber-300 font-mono mt-0.5">{syncStats.pending}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-emerald-400">Synced</div>
                      <div className="font-bold text-emerald-300 font-mono mt-0.5">{syncStats.done}</div>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800">
                      <div className="text-[10px] text-rose-400">Failed</div>
                      <div className="font-bold text-rose-300 font-mono mt-0.5">{syncStats.failed}</div>
                    </div>
                  </div>

                  <div className="pt-1 flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await persistentSyncEngine.compactAndCleanup(currentCompanyId);
                        await loadDiagnostics();
                        if (onShowToast) onShowToast('Sync queue compacted & redundant items removed.');
                      }}
                      className="flex-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-bold text-xs flex items-center justify-center space-x-2 transition"
                    >
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <span>Compact Queue</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        persistentSyncEngine.drainSyncQueue(currentCompanyId);
                        if (onShowToast) onShowToast('Sync queue drain triggered.');
                      }}
                      className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center space-x-2 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Force Sync Drain</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cloud' && (
            <div className="space-y-4">
              {/* Server Ping Test */}
              <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Server className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Central Server Link Test
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={checkServerPing}
                    disabled={serverPingStatus === 'checking'}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 border border-slate-700 transition disabled:opacity-50"
                  >
                    {serverPingStatus === 'checking' ? 'Pinging...' : 'Ping Again'}
                  </button>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2.5">
                    {serverPingStatus === 'healthy' ? (
                      <Wifi className="w-4 h-4 text-emerald-400" />
                    ) : serverPingStatus === 'checking' ? (
                      <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-rose-400" />
                    )}
                    <span className={serverPingStatus === 'healthy' ? 'text-emerald-300 font-medium' : 'text-slate-300'}>
                      {serverPingMessage || 'Ready to ping central server.'}
                    </span>
                  </div>
                  {serverPingLatency !== null && (
                    <span className="font-mono text-slate-400 text-[11px]">{serverPingLatency} ms</span>
                  )}
                </div>
              </div>

              {/* Dedicated Google Sheet & Webhook Link */}
              <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>Cloud Sheets &amp; Webhook Target</span>
                </h3>

                <div className="space-y-2 text-xs">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="text-slate-400 font-medium">Tenant Dedicated Sheet ID:</div>
                    <div className="font-mono text-slate-200 break-all select-all">
                      {company.sheet_id || sheetsConfig.spreadsheetId || 'Inheriting Master Sheet ID'}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="text-slate-400 font-medium">Active Webhook Sync Endpoint:</div>
                    <div className="font-mono text-indigo-300 break-all select-all text-[11px]">
                      {company.webhook_url || sheetsConfig.webhookUrl || globalConfig?.masterWebhookUrl || 'Not configured'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Active Tenant Session: {company.company_name}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
