import React, { useState, useMemo, useEffect } from 'react';
import { AuditLogEntry, AuditAction, AuditSeverity } from '../../types';
import { getAuditLogs, subscribeToDatabase } from '../../db/roomDatabase';
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  Clock,
  FileSpreadsheet,
  AlertOctagon,
  Percent,
  RotateCcw,
  Ban,
  Lock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface AuditLogViewProps {
  onBack?: () => void;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ onBack }) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>(() => getAuditLogs());
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [selectedStaff, setSelectedStaff] = useState<string>('ALL');

  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setLogs(getAuditLogs());
    });
    return unsub;
  }, []);

  const refreshLogs = () => {
    setLogs(getAuditLogs());
  };

  // Unique staff members present in logs
  const staffList = useMemo(() => {
    const map = new Map<string, string>();
    logs.forEach((l) => {
      map.set(l.staffId, l.staffName);
      if (l.authorizedById && l.authorizedByName) {
        map.set(l.authorizedById, l.authorizedByName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [logs]);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Search term
      if (searchTerm.trim()) {
        const term = (searchTerm || '').toLowerCase();
        const matchesText =
          (log.details || '').toLowerCase().includes(term) ||
          (log.staffName || '').toLowerCase().includes(term) ||
          (log.action || '').toLowerCase().includes(term) ||
          (log.referenceId && log.referenceId.toLowerCase().includes(term)) ||
          (log.authorizedByName && log.authorizedByName.toLowerCase().includes(term));
        if (!matchesText) return false;
      }

      // Action
      if (selectedAction !== 'ALL' && log.action !== selectedAction) {
        return false;
      }

      // Severity
      if (selectedSeverity !== 'ALL' && log.severity !== selectedSeverity) {
        return false;
      }

      // Staff
      if (
        selectedStaff !== 'ALL' &&
        log.staffId !== selectedStaff &&
        log.authorizedById !== selectedStaff
      ) {
        return false;
      }

      return true;
    });
  }, [logs, searchTerm, selectedAction, selectedSeverity, selectedStaff]);

  // Metrics
  const metrics = useMemo(() => {
    const total = logs.length;
    const managerOverrides = logs.filter(
      (l) =>
        l.action === 'REFUND_INVOICE' ||
        l.action === 'VOID_INVOICE' ||
        l.action === 'VOID_CART' ||
        l.action === 'DISCOUNT_OVERRIDE'
    ).length;
    const refunds = logs.filter((l) => l.action === 'REFUND_INVOICE').length;
    const voids = logs.filter((l) => l.action === 'VOID_INVOICE' || l.action === 'VOID_CART').length;
    const timeouts = logs.filter((l) => l.action === 'SESSION_TIMEOUT').length;

    return { total, managerOverrides, refunds, voids, timeouts };
  }, [logs]);

  // Export CSV
  const handleExportCSV = () => {
    if (logs.length === 0) return;

    const headers = [
      'Log ID',
      'Timestamp',
      'Date',
      'Time',
      'Action',
      'Severity',
      'Staff Name',
      'Staff Role',
      'Authorized By',
      'Authorizer Role',
      'Reference ID',
      'Amount',
      'Details',
    ];

    const rows = filteredLogs.map((l) => [
      l.id,
      l.timestamp,
      l.date,
      l.time,
      l.action,
      l.severity,
      `"${l.staffName}"`,
      l.staffRole,
      l.authorizedByName ? `"${l.authorizedByName}"` : '',
      l.authorizedByRole || '',
      l.referenceId || '',
      l.amount !== undefined ? l.amount.toFixed(2) : '',
      `"${(l.details || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Audit_Log_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getSeverityBadge = (severity: AuditSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40">
            <AlertOctagon className="w-3 h-3 mr-1" />
            Critical
          </span>
        );
      case 'SECURITY':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40">
            <ShieldAlert className="w-3 h-3 mr-1" />
            Security
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Warning
          </span>
        );
      case 'INFO':
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-500/20 text-blue-400 border border-blue-500/40">
            <Info className="w-3 h-3 mr-1" />
            Info
          </span>
        );
    }
  };

  const getActionBadge = (action: AuditAction) => {
    switch (action) {
      case 'REFUND_INVOICE':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-rose-950 text-rose-300 border border-rose-800">
            <RotateCcw className="w-3 h-3 mr-1.5 text-rose-400" />
            Refund Processed
          </span>
        );
      case 'VOID_CART':
      case 'VOID_ITEM':
      case 'VOID_INVOICE':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-orange-950 text-orange-300 border border-orange-800">
            <Ban className="w-3 h-3 mr-1.5 text-orange-400" />
            Void Approved
          </span>
        );
      case 'DISCOUNT_OVERRIDE':
      case 'DISCOUNT_APPLIED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-purple-950 text-purple-300 border border-purple-800">
            <Percent className="w-3 h-3 mr-1.5 text-purple-400" />
            Discount &gt;5% Override
          </span>
        );
      case 'LOGIN':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-3 h-3 mr-1.5 text-emerald-400" />
            PIN Login
          </span>
        );
      case 'LOGOUT':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
            User Logout
          </span>
        );
      case 'SESSION_TIMEOUT':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-amber-950 text-amber-300 border border-amber-800">
            <Lock className="w-3 h-3 mr-1.5 text-amber-400" />
            5-Min Auto-Lock
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
            {action.replace(/_/g, ' ')}
          </span>
        );
    }
  };

  return (
    <div id="audit-log-view" className="space-y-6 animate-fadeIn">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-950/50">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-3">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                System Audit Log
              </h2>
              {/* Requirement: Audit Log: ON badge */}
              <div
                id="audit-log-status-badge"
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-black uppercase tracking-wider"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block mr-0.5" />
                <span>Audit Log: ON</span>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Immutable ledger tracking logins, 5-minute inactivity timeouts, and Manager PIN overrides
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            id="audit-log-refresh-btn"
            type="button"
            onClick={refreshLogs}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold flex items-center space-x-1.5 transition border border-slate-700/60"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </button>
          <button
            id="audit-log-export-btn"
            type="button"
            onClick={handleExportCSV}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-blue-950/50 transition"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Total Events</span>
            <ShieldCheck className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono">{metrics.total}</div>
          <p className="text-[11px] text-slate-400 mt-1">Total recorded system events</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Manager Overrides</span>
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400 font-mono">
            {metrics.managerOverrides}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Refunds, voids &gt;5% discounts</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Refunds & Voids</span>
            <RotateCcw className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-black text-rose-400 font-mono">
            {metrics.refunds + metrics.voids}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{metrics.refunds} refunds, {metrics.voids} voids</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-xs font-bold uppercase tracking-wider">Auto-Timeouts</span>
            <Lock className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-400 font-mono">{metrics.timeouts}</div>
          <p className="text-[11px] text-slate-400 mt-1">5-min inactivity terminal locks</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="audit-log-search-input"
            type="text"
            placeholder="Search by staff, reason, invoice ID, action..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
          />
        </div>

        {/* Action Filter */}
        <select
          id="audit-log-action-filter"
          value={selectedAction}
          onChange={(e) => setSelectedAction(e.target.value)}
          className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition"
        >
          <option value="ALL">All Actions</option>
          <option value="LOGIN">Logins</option>
          <option value="LOGOUT">Logouts</option>
          <option value="SESSION_TIMEOUT">5-Min Timeouts</option>
          <option value="DISCOUNT_OVERRIDE">Discounts &gt; 5%</option>
          <option value="VOID_CART">Void Cart</option>
          <option value="REFUND_INVOICE">Refunds</option>
          <option value="VOID_INVOICE">Void Invoices</option>
        </select>

        {/* Severity Filter */}
        <select
          id="audit-log-severity-filter"
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition"
        >
          <option value="ALL">All Severities</option>
          <option value="INFO">Info</option>
          <option value="WARNING">Warning</option>
          <option value="SECURITY">Security</option>
          <option value="CRITICAL">Critical</option>
        </select>

        {/* Staff Filter */}
        <select
          id="audit-log-staff-filter"
          value={selectedStaff}
          onChange={(e) => setSelectedStaff(e.target.value)}
          className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition"
        >
          <option value="ALL">All Staff</option>
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Audit Log Table / Feed */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="text-xs sm:text-sm font-bold text-white flex items-center space-x-2">
            <span>Audit Trail Entries</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-mono font-bold">
              {filteredLogs.length}
            </span>
          </div>
          <span className="text-xs text-slate-400">
            Ordered newest first • Immutable Room DB
          </span>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-slate-400 font-medium text-sm">
              No audit log entries found matching the current filters.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80 overflow-x-auto">
            {filteredLogs.map((entry) => (
              <div
                key={entry.id}
                id={`audit-log-entry-${entry.id}`}
                className="p-4 sm:p-5 hover:bg-slate-800/40 transition flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs"
              >
                {/* Left Side: Time, Badges, Details */}
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {getActionBadge(entry.action)}
                    {getSeverityBadge(entry.severity)}
                    <span className="font-mono text-slate-400 text-[11px]">
                      {entry.date} {entry.time}
                    </span>
                    <span className="text-slate-500 font-mono text-[10px]">
                      #{entry.id}
                    </span>
                  </div>

                  {/* Details */}
                  <p className="text-slate-200 text-xs sm:text-sm font-medium leading-relaxed">
                    {entry.details}
                  </p>

                  {/* Operational Tags */}
                  <div className="flex flex-wrap items-center gap-3 text-slate-400 text-[11px] pt-1">
                    <div className="flex items-center space-x-1">
                      <User className="w-3.5 h-3.5 text-slate-500" />
                      <span>Operator:</span>
                      <strong className="text-slate-300">{entry.staffName}</strong>
                      <span className="text-slate-500">({entry.staffRole})</span>
                    </div>

                    {entry.authorizedByName && (
                      <div className="flex items-center space-x-1 text-amber-300">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                        <span>Manager Approval:</span>
                        <strong className="text-amber-200">{entry.authorizedByName}</strong>
                        <span className="text-amber-400/80">({entry.authorizedByRole})</span>
                      </div>
                    )}

                    {entry.referenceId && (
                      <div className="flex items-center space-x-1 font-mono text-blue-300">
                        <span>Ref:</span>
                        <span className="font-bold">{entry.referenceId}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side: Amount & Meta */}
                {entry.amount !== undefined && (
                  <div className="text-right md:min-w-[120px] font-mono">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Value
                    </span>
                    <span className="text-base font-black text-amber-400">
                      ${entry.amount.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
