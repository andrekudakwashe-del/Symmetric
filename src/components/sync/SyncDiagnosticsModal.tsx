import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Server,
  Database,
  Building,
  GitBranch,
  Shield,
  Layers,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import {
  persistentSyncEngine,
  SyncQueueStats,
} from '../../services/persistentSyncEngine';
import {
  getSyncQueueItems,
  PersistentSyncItem,
  CURRENT_IDB_SCHEMA_VERSION,
  CURRENT_SAAS_SCHEMA_VERSION,
} from '../../db/indexedDBService';
import {
  getCurrentCompany,
  getCurrentBranch,
  getBranches,
} from '../../db/roomDatabase';

interface SyncDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: any;
}

export const SyncDiagnosticsModal: React.FC<SyncDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [stats, setStats] = useState<SyncQueueStats>({
    total: 0,
    pending: 0,
    syncing: 0,
    done: 0,
    failed: 0,
  });
  const [items, setItems] = useState<PersistentSyncItem[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'FAILED' | 'DONE'>('ALL');
  const [isDraining, setIsDraining] = useState(false);
  const [isRefreshingStaff, setIsRefreshingStaff] = useState(false);
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const [isRefreshingTenant, setIsRefreshingTenant] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const currentCompany = getCurrentCompany();
  const currentBranch = getCurrentBranch();
  const allBranches = getBranches();

  const loadData = async () => {
    const s = await persistentSyncEngine.getQueueStats(currentCompany.company_id);
    setStats(s);
    const allItems = await getSyncQueueItems(undefined, currentCompany.company_id);
    setItems(allItems.slice().reverse()); // newest first
  };

  useEffect(() => {
    if (!isOpen) return;
    loadData();
    const unsub = persistentSyncEngine.subscribeStats((newStats) => {
      setStats(newStats);
      getSyncQueueItems(undefined, currentCompany.company_id).then((its) => setItems(its.slice().reverse()));
    }, currentCompany.company_id);
    return () => unsub();
  }, [isOpen, currentCompany.company_id]);

  if (!isOpen) return null;

  const handleForceResync = async () => {
    setIsDraining(true);
    setActionMessage('Draining queue & pushing pending writes...');
    try {
      const res = await persistentSyncEngine.drainSyncQueue(currentCompany.company_id);
      setActionMessage(`Queue processed: ${res.succeeded} succeeded, ${res.failed} failed.`);
      await loadData();
    } catch (err: any) {
      setActionMessage(`Resync error: ${err.message || String(err)}`);
    } finally {
      setIsDraining(false);
    }
  };

  const handleCompactQueue = async () => {
    setActionMessage('Compacting queue and removing redundant updates...');
    try {
      const res = await persistentSyncEngine.compactAndCleanup(currentCompany.company_id);
      setActionMessage(`Queue optimized: Removed ${res.removedCount} redundant/stale updates. ${res.compactedCount} items remaining.`);
      await loadData();
    } catch (err: any) {
      setActionMessage(`Optimization error: ${err.message || String(err)}`);
    }
  };

  const handleRefreshStaff = async () => {
    setIsRefreshingStaff(true);
    setActionMessage('Performing delta fetch for staff from server...');
    try {
      const count = await persistentSyncEngine.forceRefreshStaff();
      setActionMessage(`Staff refreshed successfully: ${count} staff updated.`);
    } catch (err: any) {
      setActionMessage(`Staff refresh failed: ${err.message || String(err)}`);
    } finally {
      setIsRefreshingStaff(false);
    }
  };

  const handleRefreshBranches = async () => {
    setIsRefreshingBranches(true);
    setActionMessage('Performing delta fetch for branches from server...');
    try {
      const count = await persistentSyncEngine.forceRefreshBranches();
      setActionMessage(`Branches refreshed successfully: ${count} branches updated.`);
    } catch (err: any) {
      setActionMessage(`Branch refresh failed: ${err.message || String(err)}`);
    } finally {
      setIsRefreshingBranches(false);
    }
  };

  const handleRefreshTenant = async () => {
    setIsRefreshingTenant(true);
    setActionMessage('Querying latest tenant context & billing status from server...');
    try {
      const ctx = await persistentSyncEngine.refreshTenantContext(true);
      if (ctx) {
        setActionMessage(`Tenant refreshed: Plan=${ctx.plan}, Status=${ctx.subscription_status}, Schema=${ctx.schema_version}.`);
      } else {
        setActionMessage('Tenant context refreshed.');
      }
    } catch (err: any) {
      setActionMessage(`Tenant refresh failed: ${err.message || String(err)}`);
    } finally {
      setIsRefreshingTenant(false);
    }
  };

  const handleRetryItem = async (id: string) => {
    setActionMessage(`Retrying queue item ${id}...`);
    const success = await persistentSyncEngine.retryItem(id);
    setActionMessage(success ? `Item ${id} successfully pushed.` : `Item ${id} retry failed.`);
    await loadData();
  };

  const handleClearDone = async () => {
    const cleared = await persistentSyncEngine.clearDone();
    setActionMessage(`Cleared ${cleared} completed records from persistent queue.`);
    await loadData();
  };

  const filteredItems = items.filter((item) => {
    if (filter === 'PENDING') return item.status === 'pending' || item.status === 'syncing';
    if (filter === 'FAILED') return item.status === 'failed';
    if (filter === 'DONE') return item.status === 'done';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <span>Sync Engine Diagnostics</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                  Stage 2
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Persistent IndexedDB queue, delta replication & tenant context health
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action message banner */}
        {actionMessage && (
          <div className="px-5 py-2 bg-indigo-950/80 border-b border-indigo-800/60 text-indigo-200 text-xs flex items-center justify-between animate-fadeIn">
            <span>{actionMessage}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-indigo-400 hover:text-indigo-100 text-xs underline ml-3"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Tenant & Architecture Overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="flex items-center space-x-2 text-slate-400 text-xs mb-1">
                <Building className="w-3.5 h-3.5 text-indigo-400" />
                <span>Company ID</span>
              </div>
              <div className="font-bold text-sm text-slate-200 truncate" title={currentCompany.company_id}>
                {currentCompany.company_id || 'COMP-001'}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {currentCompany.company_name}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="flex items-center space-x-2 text-slate-400 text-xs mb-1">
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                <span>Branch ID(s)</span>
              </div>
              <div className="font-bold text-sm text-emerald-300 truncate">
                {currentBranch?.branchId || 'BR-MAIN'}
              </div>
              <div className="text-[10px] text-slate-400">
                {allBranches.length} branch(es) registered
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="flex items-center space-x-2 text-slate-400 text-xs mb-1">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>Isolation Strategy</span>
              </div>
              <div className="font-bold text-sm text-amber-300">
                {currentCompany.branch_isolation_mode || 'ROW_LEVEL'}
              </div>
              <div className="text-[10px] text-slate-400">
                Status: {currentCompany.subscription_status || 'ACTIVE'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="flex items-center space-x-2 text-slate-400 text-xs mb-1">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Schema Version</span>
              </div>
              <div className="font-bold text-sm text-cyan-300">
                v{CURRENT_SAAS_SCHEMA_VERSION} <span className="text-xs text-slate-400">(IDB v{CURRENT_IDB_SCHEMA_VERSION})</span>
              </div>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" /> Synchronized
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={handleForceResync}
              disabled={isDraining}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition disabled:opacity-50 shadow-md shadow-indigo-900/30"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isDraining ? 'animate-spin' : ''}`} />
              <span>Force Resync (Drain Queue)</span>
            </button>

            <button
              onClick={handleRefreshStaff}
              disabled={isRefreshingStaff}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingStaff ? 'animate-spin' : ''}`} />
              <span>Refresh Staff (Delta)</span>
            </button>

            <button
              onClick={handleRefreshBranches}
              disabled={isRefreshingBranches}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingBranches ? 'animate-spin' : ''}`} />
              <span>Refresh Branches (Delta)</span>
            </button>

            <button
              onClick={handleRefreshTenant}
              disabled={isRefreshingTenant}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition disabled:opacity-50"
            >
              <Database className={`w-3.5 h-3.5 ${isRefreshingTenant ? 'animate-spin' : ''}`} />
              <span>Refresh Tenant Context</span>
            </button>

            {stats.done > 0 && (
              <button
                onClick={handleClearDone}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700/80 font-medium text-xs transition ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Synced ({stats.done})</span>
              </button>
            )}
          </div>

          {/* Queue Statistics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              onClick={() => setFilter('ALL')}
              className={`p-3 rounded-xl border cursor-pointer transition ${
                filter === 'ALL'
                  ? 'bg-indigo-950/60 border-indigo-500/80'
                  : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
              }`}
            >
              <div className="text-xs text-slate-400">Total Writes</div>
              <div className="text-xl font-black text-slate-100">{stats.total}</div>
            </div>

            <div
              onClick={() => setFilter('PENDING')}
              className={`p-3 rounded-xl border cursor-pointer transition ${
                filter === 'PENDING'
                  ? 'bg-amber-950/60 border-amber-500/80'
                  : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
              }`}
            >
              <div className="text-xs text-amber-300 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Pending Queue
              </div>
              <div className="text-xl font-black text-amber-300">
                {stats.pending + stats.syncing}
              </div>
            </div>

            <div
              onClick={() => setFilter('FAILED')}
              className={`p-3 rounded-xl border cursor-pointer transition ${
                filter === 'FAILED'
                  ? 'bg-rose-950/60 border-rose-500/80'
                  : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
              }`}
            >
              <div className="text-xs text-rose-300 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Failed Writes
              </div>
              <div className="text-xl font-black text-rose-300">{stats.failed}</div>
            </div>

            <div
              onClick={() => setFilter('DONE')}
              className={`p-3 rounded-xl border cursor-pointer transition ${
                filter === 'DONE'
                  ? 'bg-emerald-950/60 border-emerald-500/80'
                  : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
              }`}
            >
              <div className="text-xs text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Synced & Verified
              </div>
              <div className="text-xl font-black text-emerald-300">{stats.done}</div>
            </div>
          </div>

          {/* Queue Items Table */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
            <div className="px-4 py-2.5 bg-slate-800/50 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300 font-semibold">
              <span>Persistent Sync Queue ({filteredItems.length} records)</span>
              <span className="text-[11px] text-slate-400">
                Showing filter: <strong className="text-indigo-300">{filter}</strong>
              </span>
            </div>

            {filteredItems.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                No sync items found for selected filter. All local changes are persistent in IndexedDB.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                {filteredItems.map((item) => {
                  const isPending = item.status === 'pending';
                  const isSyncing = item.status === 'syncing';
                  const isFailed = item.status === 'failed';
                  const isDone = item.status === 'done';

                  return (
                    <div
                      key={item.id}
                      className="p-3 hover:bg-slate-800/40 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              isDone
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : isFailed
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : isSyncing
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            {item.status}
                          </span>
                          <span className="font-semibold text-slate-200">
                            {item.action} ({item.sheetName})
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {item.clientRequestId.substring(0, 13)}...
                          </span>
                        </div>

                        {item.lastError && (
                          <div className="text-[11px] text-rose-300 font-mono bg-rose-950/40 p-1.5 rounded border border-rose-900/60">
                            Error: {item.lastError}
                          </div>
                        )}

                        <div className="text-[10px] text-slate-400 flex items-center space-x-3">
                          <span>Created: {new Date(item.createdAt).toLocaleTimeString()}</span>
                          <span>Retries: {item.retries} / 20</span>
                          {isPending && item.nextRetryAt > Date.now() && (
                            <span className="text-amber-400">
                              Retry in {Math.ceil((item.nextRetryAt - Date.now()) / 1000)}s
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 self-end sm:self-center">
                        {(isFailed || isPending) && (
                          <button
                            onClick={() => handleRetryItem(item.id)}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 text-[11px] font-semibold transition flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Background Worker: <span className="text-emerald-400 font-semibold">Active (30s queue / 60s delta & tenant)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
