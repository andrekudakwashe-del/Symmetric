import React, { useState, useMemo } from 'react';
import {
  CashAccount,
  CashTransferType,
} from '../../types';
import {
  getAccountTransactionLedger,
  AccountLedgerEntry,
} from '../../services/cashCustodyService';
import { toTimeStringSafe } from '../../utils/dateUtils';
import { formatUnitCost } from '../../utils/inventoryMath';
import {
  X,
  Download,
  Search,
  Landmark,
  ShieldCheck,
  Building2,
  Coins,
  Smartphone,
  CreditCard,
  ChevronDown,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  Package,
  Users,
  Receipt,
  Tag,
  Banknote,
} from 'lucide-react';

interface AccountStatementModalProps {
  accountId: string | null;
  accounts: CashAccount[];
  branchId?: string;
  onSelectAccount: (accountId: string) => void;
  onClose: () => void;
}

type MovementFilterCategory =
  | 'ALL'
  | 'LIFTS_EOD'
  | 'FLOATS'
  | 'SUPPLIERS'
  | 'ELECTRONIC'
  | 'HQ_BRANCH'
  | 'BANK'
  | 'EXPENSES';

const TYPE_META: Record<
  CashTransferType,
  { label: string; badgeClass: string; category: MovementFilterCategory }
> = {
  TILL_COLLECTION: {
    label: 'Cash Lift / EOD Handover',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    category: 'LIFTS_EOD',
  },
  FLOAT_ISSUE: {
    label: 'Till Float Issue',
    badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    category: 'FLOATS',
  },
  SUPPLIER_PAYMENT: {
    label: 'Supplier GRV Payment',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    category: 'SUPPLIERS',
  },
  ELECTRONIC_SETTLEMENT: {
    label: 'Form 4 Electronic Settlement',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    category: 'ELECTRONIC',
  },
  BRANCH_TO_HQ: {
    label: 'Branch ➔ HQ Remittance',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    category: 'HQ_BRANCH',
  },
  HQ_TO_BRANCH: {
    label: 'HQ ➔ Branch Funding',
    badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    category: 'HQ_BRANCH',
  },
  BANK_DEPOSIT: {
    label: 'Bank Deposit',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    category: 'BANK',
  },
  BANK_WITHDRAWAL: {
    label: 'Bank Withdrawal',
    badgeClass: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    category: 'BANK',
  },
  THIRD_PARTY_PAYOUT: {
    label: 'Custodial Expense / Payout',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    category: 'EXPENSES',
  },
  CAPITAL_INFUSION: {
    label: 'Capital Infusion',
    badgeClass: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
    category: 'HQ_BRANCH',
  },
};

export const formatNativeAmount = (amount: number, currency?: string): string => {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
};

export const AccountStatementModal: React.FC<AccountStatementModalProps> = ({
  accountId,
  accounts,
  branchId,
  onSelectAccount,
  onClose,
}) => {
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [categoryFilter, setCategoryFilter] = useState<MovementFilterCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Order switchable accounts cleanly: HQ Safe -> Branch Safes -> Clerk Floats -> EcoCash -> ZiG -> Other Banks
  const switchableAccounts = useMemo(() => {
    const orderRank = (a: CashAccount): number => {
      if (a.account_type === 'HQ_SAFE') return 1;
      if (a.account_type === 'SAFE') return 2;
      if (a.account_type === 'CLERK_FLOAT') return 3;
      if (a.account_type === 'BANK_ACCOUNT') {
        if (a.account_subtype === 'ECOCASH' || a.account_id.includes('ECOCASH')) return 4;
        if (a.account_subtype === 'ZIG' || a.account_id.includes('ZIG')) return 5;
        return 6;
      }
      return 7;
    };
    return accounts
      .filter((a) => a.account_type !== 'TILL')
      .sort((a, b) => orderRank(a) - orderRank(b));
  }, [accounts]);

  const ledgerData = useMemo(() => {
    if (!accountId) return null;
    const raw = getAccountTransactionLedger(accountId, branchId);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const ms7Days = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const ms30Days = now.getTime() - 30 * 24 * 60 * 60 * 1000;

    const filteredEntries = raw.entries.filter((e) => {
      if (dateFilter === 'today' && e.date !== todayStr) return false;
      if (dateFilter === '7days' && new Date(e.timestamp).getTime() < ms7Days) return false;
      if (dateFilter === '30days' && new Date(e.timestamp).getTime() < ms30Days) return false;

      if (categoryFilter !== 'ALL') {
        const meta = TYPE_META[e.type];
        if (!meta || meta.category !== categoryFilter) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const itemMatch = (e.linkedGrvItems || []).some((it) =>
          it.productName.toLowerCase().includes(q)
        );
        return (
          e.description.toLowerCase().includes(q) ||
          e.reference.toLowerCase().includes(q) ||
          e.recipientOrSource.toLowerCase().includes(q) ||
          e.authorizedBy.toLowerCase().includes(q) ||
          e.initiatedBy.toLowerCase().includes(q) ||
          (e.branchName || '').toLowerCase().includes(q) ||
          (e.batchRef || '').toLowerCase().includes(q) ||
          (e.linkedGrvId || '').toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          itemMatch
        );
      }
      return true;
    });

    const filteredIn = Math.round(filteredEntries.reduce((s, e) => s + e.inAmount, 0) * 100) / 100;
    const filteredOut = Math.round(filteredEntries.reduce((s, e) => s + e.outAmount, 0) * 100) / 100;
    const filteredNativeIn = Math.round(filteredEntries.reduce((s, e) => s + (e.nativeInAmount || 0), 0) * 100) / 100;
    const filteredNativeOut = Math.round(filteredEntries.reduce((s, e) => s + (e.nativeOutAmount || 0), 0) * 100) / 100;

    return {
      ...raw,
      filteredEntries,
      filteredIn,
      filteredOut,
      filteredNet: Math.round((filteredIn - filteredOut) * 100) / 100,
      filteredNativeIn,
      filteredNativeOut,
      filteredNativeNet: Math.round((filteredNativeIn - filteredNativeOut) * 100) / 100,
    };
  }, [accountId, branchId, dateFilter, categoryFilter, searchQuery, accounts]);

  if (!accountId || !ledgerData) return null;

  const acc = ledgerData.account;
  const isEcocash = acc?.account_subtype === 'ECOCASH' || acc?.account_id.includes('ECOCASH');
  const isZig = acc?.account_subtype === 'ZIG' || acc?.account_id.includes('ZIG');
  const isBank = acc?.account_type === 'BANK_ACCOUNT';
  const isHq = acc?.account_type === 'HQ_SAFE';
  const isClerk = acc?.account_type === 'CLERK_FLOAT';
  const hasNative = Boolean(acc?.native_currency);

  const balanceSubtitle = isEcocash
    ? 'EcoCash mobile money settlement balance'
    : isZig
    ? 'ZiG electronic / POS swipe balance'
    : isBank
    ? 'Commercial bank settlement balance'
    : isHq
    ? 'HQ central vault physical cash'
    : isClerk
    ? 'Petty cash float on hand'
    : 'Branch safe physical cash on hand';

  const handleExportCsv = () => {
    const accName = (acc?.account_name || 'Account').replace(/\s+/g, '_');
    const headers = [
      'Date',
      'Time',
      'Voucher ID',
      'Type',
      'Branch',
      'Counterparty',
      'Reference / Batch',
      'Initiated By',
      'Approved By',
      'Received By',
      'Status',
      'In (USD)',
      'Out (USD)',
      'Running Bal (USD)',
      ...(hasNative ? [`Native Currency`, `Native In`, `Native Out`, `FX Rate`] : []),
      'Notes',
    ];
    const rows = ledgerData.filteredEntries.map((e) => [
      e.date,
      toTimeStringSafe(e.timestamp),
      e.transferId,
      e.type,
      `"${(e.branchName || '').replace(/"/g, '""')}"`,
      `"${(e.recipientOrSource || '').replace(/"/g, '""')}"`,
      `"${(e.reference || '').replace(/"/g, '""')}"`,
      `"${(e.initiatedBy || '').replace(/"/g, '""')}"`,
      `"${(e.approvedBy || '').replace(/"/g, '""')}"`,
      `"${(e.receivedBy || '').replace(/"/g, '""')}"`,
      e.status,
      e.inAmount.toFixed(2),
      e.outAmount.toFixed(2),
      e.runningBalance.toFixed(2),
      ...(hasNative
        ? [
            e.nativeCurrency || acc?.native_currency || '',
            (e.nativeInAmount || 0).toFixed(2),
            (e.nativeOutAmount || 0).toFixed(2),
            e.exchangeRate ? String(e.exchangeRate) : '',
          ]
        : []),
      `"${(e.description || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${accName}_Statement_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderHeaderIcon = () => {
    if (isEcocash) return <Smartphone className="w-5 h-5" />;
    if (isZig) return <CreditCard className="w-5 h-5" />;
    if (isBank) return <Landmark className="w-5 h-5" />;
    if (isHq) return <Building2 className="w-5 h-5" />;
    if (isClerk) return <Coins className="w-5 h-5" />;
    return <ShieldCheck className="w-5 h-5" />;
  };

  const headerIconClass = isEcocash
    ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
    : isZig
    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
    : isBank
    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
    : isHq
    ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
    : isClerk
    ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40'
    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';

  const shortAccCode = acc?.account_id
    ? acc.account_id.length > 22
      ? `${acc.account_id.slice(0, 18)}…`
      : acc.account_id
    : '';

  const filterChips: { id: MovementFilterCategory; label: string }[] = [
    { id: 'ALL', label: 'All' },
    { id: 'LIFTS_EOD', label: 'Lifts & EOD' },
    { id: 'FLOATS', label: 'Floats' },
    { id: 'SUPPLIERS', label: 'Suppliers' },
    { id: 'ELECTRONIC', label: 'EcoCash / ZiG' },
    { id: 'HQ_BRANCH', label: 'HQ ↔ Branch' },
    { id: 'BANK', label: 'Bank' },
    { id: 'EXPENSES', label: 'Expenses' },
  ];

  const getEntryDisplayTitle = (e: AccountLedgerEntry): string => {
    if (e.type === 'TILL_COLLECTION') {
      return e.transferId.startsWith('TRF-LIFT-') ? 'Supervisor Cash Lift' : 'EOD Till Handover';
    }
    if (e.type === 'ELECTRONIC_SETTLEMENT') {
      return `Form 4 ${e.nativeCurrency || 'Electronic'} Settlement`;
    }
    return TYPE_META[e.type]?.label || e.type.replace(/_/g, ' ');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Responsive Header (fixed mobile wrapping!) */}
        <div className="p-3.5 sm:p-5 bg-slate-950 border-b border-slate-800 flex items-start justify-between gap-2.5 shrink-0">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center border shrink-0 ${headerIconClass}`}>
              {renderHeaderIcon()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-1.5">
                <h3 className="text-sm sm:text-base font-bold text-white leading-tight truncate">
                  {acc?.account_name || 'Account Statement'}
                </h3>
                {shortAccCode && (
                  <span
                    title={acc?.account_id}
                    className="px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 font-mono text-[10px] border border-slate-700 whitespace-nowrap shrink-0"
                  >
                    {shortAccCode}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                {balanceSubtitle} · Double-entry custodial ledger
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
              title="Download CSV statement"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition"
              aria-label="Close statement"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Unified Scrollable Statement Body (keeps Header & Footer pinned so mobile/desktop never sticks) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {/* Account Switcher Bar */}
          <div className="px-3.5 sm:px-5 py-2.5 bg-slate-900/95 border-b border-slate-800 flex items-center gap-2 overflow-x-auto">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
              Switch:
            </span>
            {switchableAccounts.map((item) => {
              const active = item.account_id === accountId;
              const itemNative = item.native_currency
                ? ` · ${formatNativeAmount(item.native_balance || 0, item.native_currency)}`
                : '';
              return (
                <button
                  key={item.account_id}
                  type="button"
                  onClick={() => {
                    onSelectAccount(item.account_id);
                    setExpandedRowId(null);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition whitespace-nowrap shrink-0 border flex items-center gap-1.5 ${
                    active
                      ? 'bg-cyan-600/25 border-cyan-400 text-cyan-200 shadow-sm'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  <span>{item.account_name}</span>
                  <span className="font-mono text-[11px] opacity-90">
                    (${(item.current_balance || 0).toFixed(2)}{itemNative})
                  </span>
                </button>
              );
            })}
          </div>

          {/* KPI Summary Cards (Supports Dual Currency for EcoCash & ZiG) */}
          <div className="p-3 sm:px-5 sm:py-3.5 bg-slate-950/50 border-b border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Current Balance
              </div>
              <div className="text-base sm:text-xl font-black text-cyan-300 font-mono tabular-nums mt-0.5">
                ${ledgerData.currentBalance.toFixed(2)}
              </div>
              {hasNative ? (
                <div className="text-[11px] font-mono font-bold text-amber-300 mt-0.5">
                  {formatNativeAmount(ledgerData.currentNativeBalance, acc?.native_currency)}
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{balanceSubtitle}</div>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Period Inflows
              </div>
              <div className="text-base sm:text-xl font-black text-emerald-400 font-mono tabular-nums mt-0.5">
                +${ledgerData.filteredIn.toFixed(2)}
              </div>
              {hasNative ? (
                <div className="text-[11px] font-mono text-emerald-300/90 mt-0.5">
                  +{formatNativeAmount(ledgerData.filteredNativeIn, acc?.native_currency)}
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 mt-0.5">Collections & deposits</div>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Period Outflows
              </div>
              <div className="text-base sm:text-xl font-black text-rose-400 font-mono tabular-nums mt-0.5">
                -${ledgerData.filteredOut.toFixed(2)}
              </div>
              {hasNative ? (
                <div className="text-[11px] font-mono text-rose-300/90 mt-0.5">
                  -{formatNativeAmount(ledgerData.filteredNativeOut, acc?.native_currency)}
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 mt-0.5">Disbursements & floats</div>
              )}
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 sm:p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Net Movement
              </div>
              <div
                className={`text-base sm:text-xl font-black font-mono tabular-nums mt-0.5 ${
                  ledgerData.filteredNet >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {ledgerData.filteredNet >= 0 ? '+' : '-'}${Math.abs(ledgerData.filteredNet).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {ledgerData.filteredEntries.length} movement{ledgerData.filteredEntries.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Date Filter, Search & Category Chips */}
          <div className="px-3.5 sm:px-5 py-2.5 bg-slate-900/70 border-b border-slate-800 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 w-fit max-w-full overflow-x-auto">
                {(['all', 'today', '7days', '30days'] as const).map((df) => (
                  <button
                    key={df}
                    type="button"
                    onClick={() => setDateFilter(df)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition whitespace-nowrap ${
                      dateFilter === df
                        ? 'bg-slate-800 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {df === 'all' ? 'All Time' : df === 'today' ? 'Today' : df === '7days' ? '7 Days' : '30 Days'}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ref, staff, supplier, branch, batch..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {filterChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setCategoryFilter(chip.id)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap shrink-0 transition border ${
                    categoryFilter === chip.id
                      ? 'bg-indigo-600/30 border-indigo-400/60 text-indigo-200'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Detailed Movement List (Tap any movement for forensic breakdown) */}
          <div className="p-3 sm:p-4 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Transaction Ledger ({ledgerData.filteredEntries.length})
              </span>
              {ledgerData.filteredEntries.length > 0 && (
                <span className="text-[10px] text-cyan-400/90">
                  Tap any movement for full audit trail
                </span>
              )}
            </div>
            {ledgerData.filteredEntries.length === 0 ? (
              <div className="p-8 text-center space-y-2 border border-dashed border-slate-800 rounded-2xl">
                <Landmark className="w-8 h-8 text-slate-600 mx-auto" />
                <div className="text-sm font-semibold text-slate-300">No cash movements recorded yet</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {isEcocash || isZig
                    ? 'Confirm EcoCash or ZiG settlements in Form 4 Reconciliation, or post a bank transfer, and every movement will appear here with both USD and mobile money amounts.'
                    : 'Transfers, cash lifts, EOD handovers, floats, and supplier payments for this account will appear here in real time.'}
                </p>
              </div>
            ) : (
              ledgerData.filteredEntries.map((entry) => {
              const isIn = entry.inAmount > 0;
              const isExpanded = expandedRowId === entry.id;
              const meta = TYPE_META[entry.type];
              const nativeValue = isIn ? entry.nativeInAmount : entry.nativeOutAmount;

              return (
                <div
                  key={entry.id}
                  className={`rounded-2xl border transition overflow-hidden ${
                    isExpanded
                      ? 'bg-slate-950 border-cyan-500/50 shadow-lg'
                      : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  {/* Summary Row */}
                  <div
                    onClick={() => setExpandedRowId(isExpanded ? null : entry.id)}
                    className="p-3 sm:p-3.5 cursor-pointer flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border ${
                          isIn
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                        }`}
                      >
                        {isIn ? (
                          <ArrowDownLeft className="w-4 h-4" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center flex-wrap gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                              meta?.badgeClass || 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {getEntryDisplayTitle(entry)}
                          </span>
                          {entry.branchName && (
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-800/90 text-slate-300 text-[10px] font-medium border border-slate-700/70">
                              {entry.branchName}
                            </span>
                          )}
                          {entry.status === 'IN_TRANSIT' && (
                            <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-bold border border-purple-500/40">
                              IN TRANSIT
                            </span>
                          )}
                        </div>

                        <div className="text-xs font-semibold text-white leading-snug">
                          {entry.recipientOrSource}
                        </div>

                        <div className="text-[11px] text-slate-400 line-clamp-1">
                          {entry.description}
                        </div>

                        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 font-mono">
                          <span>
                            {entry.date} · {toTimeStringSafe(entry.timestamp)}
                          </span>
                          <span className="text-slate-400">Ref: {entry.reference}</span>
                          <span>By: {entry.initiatedBy}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right Side Amounts + Expand Chevron */}
                    <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                      <div
                        className={`text-sm sm:text-base font-black font-mono tabular-nums ${
                          isIn ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isIn ? '+' : '-'}${(isIn ? entry.inAmount : entry.outAmount).toFixed(2)}
                      </div>
                      {entry.nativeCurrency && nativeValue !== undefined && nativeValue > 0 && (
                        <div className="text-[11px] font-mono font-bold text-amber-300">
                          {isIn ? '+' : '-'}
                          {formatNativeAmount(nativeValue, entry.nativeCurrency)}
                        </div>
                      )}
                      <div className="text-[10px] font-mono text-slate-500">
                        Bal: <span className="text-slate-300">${entry.runningBalance.toFixed(2)}</span>
                      </div>
                      <div className="text-[10px] text-cyan-400 flex items-center gap-0.5 mt-0.5">
                        <span>{isExpanded ? 'Hide' : 'Details'}</span>
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Forensic Audit Drawer */}
                  {isExpanded && (
                    <div className="px-3.5 py-3 bg-slate-900/90 border-t border-slate-800 space-y-2.5 text-xs animate-fadeIn">
                      {/* Custody Chain */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/80">
                          <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
                            <Users className="w-3 h-3" /> Initiated By
                          </div>
                          <div className="text-xs font-semibold text-white mt-0.5">{entry.initiatedBy}</div>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/80">
                          <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                            Approved / Verified By
                          </div>
                          <div className="text-xs font-semibold text-emerald-300 mt-0.5">
                            {entry.approvedBy || entry.authorizedBy}
                          </div>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/80">
                          <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                            Received By / Custodian
                          </div>
                          <div className="text-xs font-semibold text-cyan-300 mt-0.5">
                            {entry.receivedBy || entry.recipientOrSource}
                          </div>
                        </div>
                      </div>

                      {/* Route & Voucher Metadata */}
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 font-mono text-slate-300">
                          Voucher: <strong className="text-white">{entry.transferId}</strong>
                        </span>
                        {entry.fromAccountName && (
                          <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                            From: <strong className="text-white">{entry.fromAccountName}</strong>
                          </span>
                        )}
                        {entry.toAccountName && (
                          <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                            To: <strong className="text-white">{entry.toAccountName}</strong>
                          </span>
                        )}
                        {entry.batchRef && (
                          <span className="px-2 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/30 font-mono text-cyan-200 inline-flex items-center gap-1">
                            <Receipt className="w-3 h-3" /> Batch: {entry.batchRef}
                          </span>
                        )}
                        {entry.exchangeRate && entry.nativeCurrency && (
                          <span className="px-2 py-1 rounded-lg bg-amber-950/50 border border-amber-500/30 font-mono text-amber-200">
                            Rate: 1 USD = {entry.exchangeRate} {entry.nativeCurrency}
                          </span>
                        )}
                        {entry.bagSealNumber && (
                          <span className="px-2 py-1 rounded-lg bg-purple-950/60 border border-purple-500/30 font-mono text-purple-200 inline-flex items-center gap-1">
                            <Tag className="w-3 h-3" /> Seal: {entry.bagSealNumber}
                          </span>
                        )}
                      </div>

                      {/* Denomination Breakdown (for Supervisor Cash Lifts) */}
                      {entry.denominations && Object.keys(entry.denominations).length > 0 && (
                        <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                          <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1">
                            <Banknote className="w-3.5 h-3.5" /> Physical Note Denominations
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(entry.denominations)
                              .filter(([, count]) => Number(count) > 0)
                              .map(([denom, count]) => (
                                <span
                                  key={denom}
                                  className="px-2 py-0.5 rounded-lg bg-emerald-950/70 border border-emerald-500/30 text-[11px] font-mono text-emerald-200"
                                >
                                  ${denom} × {count}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}

                      {/* Linked GRV Purchased Items (for Supplier Payments) */}
                      {entry.linkedGrvId && (
                        <div className="p-2.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1">
                              <Package className="w-3.5 h-3.5" /> Linked GRV: {entry.linkedGrvId}
                            </span>
                          </div>
                          {entry.linkedGrvItems && entry.linkedGrvItems.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-slate-800">
                              {entry.linkedGrvItems.map((it, idx) => (
                                <div key={idx} className="flex items-center justify-between text-[11px] gap-2">
                                  <span className="text-slate-200 truncate">
                                    {it.productName}{' '}
                                    <span className="text-slate-400 font-mono text-[10px]">
                                      ({it.qty} {it.unit || 'u'} × ${formatUnitCost(it.unitCost)})
                                    </span>
                                  </span>
                                  <span className="font-mono font-bold text-emerald-400 shrink-0">
                                    ${it.lineTotal.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Full Notes */}
                      <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[11px] text-slate-300 leading-relaxed">
                        <span className="text-slate-500 font-semibold mr-1.5">Audit Note:</span>
                        {entry.description}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2 text-xs text-slate-400 shrink-0">
          <div className="truncate">
            Showing <strong className="text-white">{ledgerData.filteredEntries.length}</strong> movements · Double-entry custody ledger
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition shrink-0"
          >
            Close Statement
          </button>
        </div>
      </div>
    </div>
  );
};
