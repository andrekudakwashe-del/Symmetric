import React, { useState, useEffect, useMemo } from 'react';
import { Salesperson } from '../../types';
import {
  calculateWhereIsMyMoney,
  calculateSupervisorExpectedCash,
  getWallets,
  getWalletTransfers,
  getOwnerDrawings,
  getInternalConsumptions,
  updateWalletCountedBalance,
  WalletReconciliationItem,
} from '../../services/walletService';
import {
  getCustodyBalancesSummary,
  getUnpaidGrvsForSafePayment,
  getInTransitTotal,
} from '../../services/cashCustodyService';
import {
  getCashAccounts,
  getCashTransfers,
  getTodayDateString,
  getSalespeople,
  subscribeToDatabase,
} from '../../db/roomDatabase';
import { WalletTransferModal } from './WalletTransferModal';
import { OwnerDrawingModal } from './OwnerDrawingModal';
import {
  Wallet,
  ArrowLeftRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Landmark,
  Home,
  UserCheck,
  PlusCircle,
  FileText,
  Calendar,
  Layers,
  ShieldCheck,
  Scale,
  RefreshCw,
  Coins,
  Truck,
  Building2,
  ExternalLink,
} from 'lucide-react';

interface WhereIsMyMoneyViewProps {
  currentUser: Salesperson;
  onNavigateToCustody?: () => void;
}

export const WhereIsMyMoneyView: React.FC<WhereIsMyMoneyViewProps> = ({
  currentUser,
  onNavigateToCustody,
}) => {
  const [date, setDate] = useState<string>(() => getTodayDateString());
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>(currentUser.id);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDrawingModal, setShowDrawingModal] = useState(false);
  const [countingWallet, setCountingWallet] = useState<WalletReconciliationItem | null>(null);
  const [countedInputVal, setCountedInputVal] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);

  const salespeople = getSalespeople();
  const supervisors = salespeople.filter(
    (s) => s.role === 'Supervisor' || s.role === 'Admin' || s.role === 'OWNER' || s.role === 'SUPER_ADMIN'
  );

  const isOwnerOrAdmin =
    currentUser.role === 'OWNER' ||
    currentUser.role === 'Admin' ||
    currentUser.role === 'SUPER_ADMIN';

  // Calculate reconciliation for all 5 wallets (memoized to prevent UI freezing)
  const walletReconciliations: WalletReconciliationItem[] = useMemo(() => {
    return calculateWhereIsMyMoney(date);
  }, [date, refreshKey]);

  // Calculate selected supervisor handover expected cash
  const supervisorHandover = useMemo(() => {
    return calculateSupervisorExpectedCash(
      selectedSupervisorId || currentUser.id,
      date
    );
  }, [selectedSupervisorId, currentUser.id, date, refreshKey]);

  // Recent activity
  const transfers = useMemo(() => getWalletTransfers().filter((t) => t.date === date), [date, refreshKey]);
  const drawings = useMemo(() => getOwnerDrawings().filter((d) => d.date === date), [date, refreshKey]);
  const consumptions = useMemo(() => getInternalConsumptions().filter((c) => c.date === date), [date, refreshKey]);

  // Integrated Physical Cash Custody & Voucher Settlement
  const custodySummary = useMemo(() => {
    return getCustodyBalancesSummary();
  }, [refreshKey]);

  const custodyTransfers = useMemo(() => {
    return getCashTransfers().slice(0, 10);
  }, [refreshKey]);

  const inTransitVouchers = useMemo(() => {
    return custodyTransfers.filter((t) => t.status === 'IN_TRANSIT');
  }, [custodyTransfers]);

  const unpaidGrvs = useMemo(() => {
    return getUnpaidGrvsForSafePayment().slice(0, 5);
  }, [refreshKey]);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    const handleUpdate = () => {
      setRefreshKey((k) => k + 1);
    };
    const unsub = subscribeToDatabase(handleUpdate);
    window.addEventListener('saimetric_cash_updated', handleUpdate);
    window.addEventListener('saimetric_cash_movements_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      unsub();
      window.removeEventListener('saimetric_cash_updated', handleUpdate);
      window.removeEventListener('saimetric_cash_movements_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const formatWalletVal = (val: number, currency: string, prefix: '+' | '-' | '' = '') => {
    const formatted = Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sign = val < 0 ? '-' : prefix;
    if (currency === 'USD') return `${sign}$${formatted}`;
    if (currency === 'EcoCash') return `${sign}${formatted} EcoCash`;
    if (currency === 'ZiG') return `${sign}${formatted} ZiG`;
    return `${sign}${formatted} ${currency}`;
  };

  return (
    <div className="space-y-6 pb-24 animate-fadeIn">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-purple-950 to-slate-900 border border-indigo-700/50 rounded-3xl p-5 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-slate-950 shadow-md">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                <span>Where is My Money?</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30">
                  Audit Verified
                </span>
              </h1>
              <p className="text-xs text-indigo-200">
                Multi-wallet financial balance: Expected vs. Actual Counted across Cash, EcoCash, Bank &amp; Home Safe
              </p>
            </div>
          </div>
        </div>

        {/* Date Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-900/80 border border-slate-700 rounded-2xl px-3 py-1.5 shadow-sm">
            <Calendar className="w-4 h-4 text-slate-400 mr-2" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-white text-xs font-bold focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowTransferModal(true)}
            className="px-3.5 py-2 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition active:scale-95"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>Withdraw / Transfer</span>
          </button>

          {isOwnerOrAdmin && (
            <button
              type="button"
              onClick={() => setShowDrawingModal(true)}
              className="px-3.5 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition active:scale-95"
            >
              <DollarSign className="w-4 h-4" />
              <span>Owner Drawings / Home Safe</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleRefresh}
            className="p-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
            title="Refresh Ledger"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* SECTION 1: SUPERVISOR & OWNER EXPECTED CASH HANDOVER */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-amber-400" />
              <span>Supervisor Custody Cash Handover (Step 1)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Expected Cash = Opening + Own Sales + Till Lifts Collected - Expenses Paid - GRVs Paid from Cash - Owner Drawings
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Viewing Supervisor:</span>
            <select
              value={selectedSupervisorId}
              onChange={(e) => setSelectedSupervisorId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
            >
              {supervisors.map((s, sIdx) => (
                <option key={`${s.id}-${sIdx}`} value={s.id}>
                  {s.name} ({s.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Breakdown Metric Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Own Cash Sales</span>
            <span className="text-sm font-black text-emerald-400 font-mono">
              +${supervisorHandover.ownCashSales.toFixed(2)}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Till Lifts Collected</span>
            <span className="text-sm font-black text-blue-400 font-mono">
              +${supervisorHandover.tillLiftsCollected.toFixed(2)}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Expenses Paid from Cash</span>
            <span className="text-sm font-black text-rose-400 font-mono">
              -${supervisorHandover.expensesPaidFromCash.toFixed(2)}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">GRVs Paid from Cash</span>
            <span className="text-sm font-black text-rose-400 font-mono">
              -${supervisorHandover.grvPaymentsPaidFromCash.toFixed(2)}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800/80">
            <span className="text-[10px] text-slate-400 block font-medium">Owner Drawings / Safe</span>
            <span className="text-sm font-black text-purple-400 font-mono">
              -${supervisorHandover.ownerDrawingsTaken.toFixed(2)}
            </span>
          </div>

          <div className="bg-gradient-to-br from-amber-950/60 to-slate-950 p-3 rounded-2xl border border-amber-500/50 shadow">
            <span className="text-[10px] text-amber-300 block font-bold">Expected Handover Cash</span>
            <span className="text-base font-black text-amber-400 font-mono">
              ${supervisorHandover.expectedHandoverCash.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 2: 5 COMPANY WALLETS ("WHERE IS MY MONEY?") */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Landmark className="w-5 h-5 text-purple-400" />
              <span>Multi-Wallet Balances &amp; Variance Engine</span>
            </h2>
            <p className="text-xs text-slate-400">
              Live audit comparison of physical cash, EcoCash mobile, ZiG bank, and home safe
            </p>
          </div>
        </div>

        {/* Wallets Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 text-slate-400 font-bold border-b border-slate-800">
                <th className="p-3">Wallet</th>
                <th className="p-3">Currency</th>
                <th className="p-3">Sales Inflow</th>
                <th className="p-3">Transfers In</th>
                <th className="p-3">Transfers Out</th>
                <th className="p-3">GRVs / Expenses</th>
                <th className="p-3">Drawings / Charges</th>
                <th className="p-3">Expected Balance</th>
                <th className="p-3">Actual Counted</th>
                <th className="p-3">Variance</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {walletReconciliations.map((item) => {
                const isShort = item.status === 'Shortage';
                const isOver = item.status === 'Over';
                return (
                  <tr key={item.wallet.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3">
                      <div className="font-bold text-white flex items-center gap-2">
                        {item.wallet.type === 'CASH_DRAWER' && <Wallet className="w-4 h-4 text-emerald-400" />}
                        {item.wallet.type === 'ECOCASH' && <ArrowLeftRight className="w-4 h-4 text-amber-400" />}
                        {item.wallet.type === 'BANK_ZIG' && <Landmark className="w-4 h-4 text-blue-400" />}
                        {item.wallet.type === 'BANK_USD' && <Landmark className="w-4 h-4 text-indigo-400" />}
                        {item.wallet.type === 'HOME_SAFE' && <Home className="w-4 h-4 text-purple-400" />}
                        <span>{item.wallet.name}</span>
                      </div>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-300">{item.wallet.currency}</td>
                    <td className="p-3 font-mono text-emerald-400">
                      {formatWalletVal(item.salesInflow, item.wallet.currency, '+')}
                    </td>
                    <td className="p-3 font-mono text-blue-400">
                      {formatWalletVal(item.transfersIn, item.wallet.currency, '+')}
                    </td>
                    <td className="p-3 font-mono text-rose-400">
                      {formatWalletVal(item.transfersOut, item.wallet.currency, '-')}
                    </td>
                    <td className="p-3 font-mono text-rose-400">
                      {formatWalletVal(item.grvPayments, item.wallet.currency, '-')}
                    </td>
                    <td className="p-3 font-mono text-amber-400">
                      {formatWalletVal(item.ownerDrawings + item.bankCharges, item.wallet.currency, '-')}
                    </td>
                    <td className="p-3 font-mono font-black text-white">
                      {formatWalletVal(item.expectedBalance, item.wallet.currency)}
                    </td>
                    <td className="p-3 font-mono font-black text-cyan-300">
                      <div className="flex items-center gap-1.5">
                        <span>{formatWalletVal(item.actualCountedBalance, item.wallet.currency)}</span>
                        {isOwnerOrAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setCountingWallet(item);
                              setCountedInputVal(String(item.actualCountedBalance || ''));
                            }}
                            className="px-1.5 py-0.5 rounded bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/40 text-[10px] text-cyan-300 font-sans font-bold cursor-pointer transition"
                            title="Count / Update physical wallet balance"
                          >
                            Count
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={`p-3 font-mono font-black ${isShort ? 'text-rose-400' : isOver ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {formatWalletVal(item.variance, item.wallet.currency, item.variance > 0 ? '+' : '')}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          isShort
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : isOver
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2.5: PHYSICAL CASH CUSTODY & CHAIN VERIFICATION (MERGED VIEW) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              <span>Physical Cash Custody &amp; Location Breakdown</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                IAS 7 Cash &amp; Equivalents
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Where the physical cash is right now: active tills, branch vault safe, clerk float, and money in transit
            </p>
          </div>

          {onNavigateToCustody && (
            <button
              type="button"
              onClick={onNavigateToCustody}
              className="px-3.5 py-1.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition active:scale-95 self-start sm:self-auto"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Manage Safe &amp; Vouchers</span>
            </button>
          )}
        </div>

        {/* 5 Custody Location Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs font-semibold mb-1">
              <Coins className="w-3.5 h-3.5 text-purple-400" />
              <span>Cashier Tills</span>
            </div>
            <div className="text-lg font-black text-white font-mono">
              ${custodySummary.totalTills.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-500 block">Registers in operation</span>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs font-semibold mb-1">
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Branch Safe</span>
            </div>
            <div className="text-lg font-black text-emerald-400 font-mono">
              ${custodySummary.totalBranchSafes.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-500 block">Main store vault</span>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs font-semibold mb-1">
              <UserCheck className="w-3.5 h-3.5 text-blue-400" />
              <span>Clerk Petty Float</span>
            </div>
            <div className="text-lg font-black text-blue-400 font-mono">
              ${custodySummary.totalClerkFloats.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-500 block">Discretionary imprest</span>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs font-semibold mb-1">
              <Truck className="w-3.5 h-3.5 text-amber-400" />
              <span>Cash In Transit</span>
            </div>
            <div className="text-lg font-black text-amber-400 font-mono">
              ${custodySummary.totalCashInTransit.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-500 block">En route to Bank / HQ</span>
          </div>

          <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-slate-400 text-xs font-semibold mb-1">
              <Landmark className="w-3.5 h-3.5 text-indigo-400" />
              <span>HQ Central Vault</span>
            </div>
            <div className="text-lg font-black text-indigo-300 font-mono">
              ${custodySummary.totalHqSafe.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-500 block">Owner central reserve</span>
          </div>

          <div className="bg-gradient-to-br from-indigo-950 to-purple-950 p-3.5 rounded-2xl border border-indigo-700/60 shadow-inner">
            <div className="flex items-center space-x-1.5 text-indigo-200 text-xs font-semibold mb-1">
              <Scale className="w-3.5 h-3.5 text-cyan-400" />
              <span>Total Liquid Cash</span>
            </div>
            <div className="text-lg font-black text-cyan-300 font-mono">
              ${custodySummary.grandTotal.toFixed(2)}
            </div>
            <span className="text-[10px] text-indigo-300 block">All custody points</span>
          </div>
        </div>

        {/* In-Transit & Pending Settlement Alert Strip */}
        {inTransitVouchers.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-500/40 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-amber-300">
              <div className="flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Active Cash in Transit ({inTransitVouchers.length} dispatch vouchers)</span>
              </div>
              <span className="font-mono text-amber-200">
                Total: ${custodySummary.totalCashInTransit.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {inTransitVouchers.map((v) => (
                <div key={v.transfer_id} className="p-2.5 bg-slate-950/80 rounded-xl border border-amber-800/60 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <span>{v.transfer_id}</span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-300 uppercase">
                        {v.type}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {v.bank_name ? `Bank: ${v.bank_name}` : v.recipient_name ? `For: ${v.recipient_name}` : `Seal: ${v.bag_seal_number || 'Standard'}`}
                    </div>
                  </div>
                  <div className="text-right font-mono font-bold text-amber-400">
                    ${v.amount.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unpaid GRV Supplier Liabilities */}
        {unpaidGrvs.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-300 font-bold">
              <div className="flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-cyan-400" />
                <span>Pending Supplier Invoices (GRVs Awaiting Safe Payout)</span>
              </div>
              <span className="text-[10px] text-slate-500">
                {unpaidGrvs.length} invoices pending
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {unpaidGrvs.map((g) => (
                <div key={g.id} className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-white block">{g.supplierName}</span>
                    <span className="text-[10px] text-slate-400">{g.grvNumber} • {g.date}</span>
                  </div>
                  <span className="font-mono font-bold text-rose-400">${g.totalCost.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: RECENT TRANSFERS & OWNER DRAWINGS AUDIT LEDGER */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Transfers & Electronic Withdrawals */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-purple-400" />
            <span>Transfers &amp; Withdrawals with Bank Charges ({transfers.length})</span>
          </h3>
          {transfers.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No wallet transfers recorded on this date.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {transfers.map((t) => (
                <div key={t.id} className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">
                      {t.fromWallet} &rarr; {t.toWallet}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      By {t.performedByName} • Bank Charge: <span className="text-amber-400 font-bold">${t.bankCharge.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-emerald-400 block">+${t.amountReceived.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-500 font-mono">Sent: ${t.amountSent.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Owner Drawings */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Home className="w-4 h-4 text-emerald-400" />
            <span>Owner Drawings &amp; Home Safe ({drawings.length})</span>
          </h3>
          {drawings.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No owner drawings recorded on this date.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {drawings.map((d) => (
                <div key={d.id} className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">{d.recipientOrPurpose}</div>
                    <div className="text-[10px] text-slate-400">
                      Category: <span className="text-purple-300 font-semibold">{d.category}</span> • By {d.withdrawnByName}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-rose-400 block">-${d.amount.toFixed(2)}</span>
                    <span className="text-[10px] text-slate-500 font-mono">From: {d.fromWallet}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <WalletTransferModal
        isOpen={showTransferModal}
        onClose={() => {
          setShowTransferModal(false);
          handleRefresh();
        }}
        currentUser={currentUser}
      />

      <OwnerDrawingModal
        isOpen={showDrawingModal}
        onClose={() => {
          setShowDrawingModal(false);
          handleRefresh();
        }}
        currentUser={currentUser}
      />

      {/* Manual Count Dialog */}
      {countingWallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Scale className="w-4 h-4 text-cyan-400" />
                <span>Count {countingWallet.wallet.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setCountingWallet(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">
                Enter actual verified balance in {countingWallet.wallet.currency}:
              </label>
              <input
                type="number"
                step="0.01"
                value={countedInputVal}
                onChange={(e) => setCountedInputVal(e.target.value)}
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-base font-mono font-bold text-white focus:outline-none focus:border-cyan-500"
                autoFocus
              />
              <p className="text-[11px] text-slate-400">
                System expected balance: <strong className="text-white font-mono">{formatWalletVal(countingWallet.expectedBalance, countingWallet.wallet.currency)}</strong>
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCountingWallet(null)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = parseFloat(countedInputVal);
                  if (!isNaN(val)) {
                    updateWalletCountedBalance(countingWallet.wallet.id, val);
                    handleRefresh();
                  }
                  setCountingWallet(null);
                }}
                className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition shadow"
              >
                Save Count
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
