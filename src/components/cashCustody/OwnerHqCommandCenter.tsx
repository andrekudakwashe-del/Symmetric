import React, { useState, useEffect, useMemo } from 'react';
import {
  CashAccount,
  CashTransfer,
  CashTransferType,
  Salesperson,
} from '../../types';
import {
  getCashAccounts,
  getCashTransfers,
  getCurrentCompanyId,
  getBranches,
  getSalespeople,
  getCashGovernanceConfig,
} from '../../db/roomDatabase';
import {
  getCustodyBalancesSummary,
  getOwnerOverrideAlerts,
  approveCashTransfer,
  receiveHqSafeTransfer,
  getHqSafeAccount,
  getBranchSafeAccount,
  getClerkFloatAccount,
  getUnpaidGrvsForSafePayment,
  createCashTransferVoucher,
  DEFAULT_SUPPLIER_APPROVAL_THRESHOLD,
  UnpaidGrvRecord,
} from '../../services/cashCustodyService';
import {
  Building2,
  ShieldAlert,
  ShieldCheck,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  FileText,
  DollarSign,
  TrendingUp,
  RefreshCw,
  X,
  Lock,
  Layers,
  ArrowRight,
  Landmark,
  PlusCircle,
  Search,
  Coins,
  Truck,
  Zap,
  RotateCcw,
  Upload,
  Check,
  Banknote,
  ArrowRightLeft,
} from 'lucide-react';

interface OwnerHqCommandCenterProps {
  currentUser: Salesperson;
  onClose?: () => void;
  onNavigateClerk?: () => void;
}

export const OwnerHqCommandCenter: React.FC<OwnerHqCommandCenterProps> = ({
  currentUser,
  onClose,
  onNavigateClerk,
}) => {
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [transfers, setTransfers] = useState<CashTransfer[]>([]);
  const [overrideAlerts, setOverrideAlerts] = useState<CashTransfer[]>([]);
  const [summary, setSummary] = useState(getCustodyBalancesSummary());
  const [unpaidGrvs, setUnpaidGrvs] = useState<UnpaidGrvRecord[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);

  // Quick Action / PIN Dialog
  const [selectedTransfer, setSelectedTransfer] = useState<CashTransfer | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'receive_hq' | null>(null);
  const [enteredPin, setEnteredPin] = useState('');
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Commercial Bank Breakdown Modal
  const [isBankDetailsModalOpen, setIsBankDetailsModalOpen] = useState(false);

  // HQ Voucher Creation Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [modalType, setModalType] = useState<CashTransferType>('HQ_TO_BRANCH');
  const [amount, setAmount] = useState<string>('');
  const [fromAccountId, setFromAccountId] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string>('');
  const [linkedGrvId, setLinkedGrvId] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [selectedCashierId, setSelectedCashierId] = useState<string>('');
  const [bagSealNumber, setBagSealNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [bankName, setBankName] = useState<string>('CBZ Bank Zimbabwe');
  const [bankAccountNumber, setBankAccountNumber] = useState<string>('');
  const [grvSearchQuery, setGrvSearchQuery] = useState('');

  const govConfig = useMemo(() => getCashGovernanceConfig(), []);

  const reloadData = () => {
    setAccounts(getCashAccounts());
    setTransfers(getCashTransfers());
    setOverrideAlerts(getOwnerOverrideAlerts(7));
    setSummary(getCustodyBalancesSummary());
    setUnpaidGrvs(getUnpaidGrvsForSafePayment());
    setSalespeople(getSalespeople());
  };

  useEffect(() => {
    reloadData();
  }, []);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Pending Approvals (Supplier Payments > $50)
  const pendingApprovals = useMemo(() => {
    return transfers.filter((t) => t.status === 'PENDING_APPROVAL');
  }, [transfers]);

  // In-Transit Transfers destined for HQ Safe
  const inTransitToHq = useMemo(() => {
    return transfers.filter((t) => t.type === 'BRANCH_TO_HQ' && t.status === 'IN_TRANSIT');
  }, [transfers]);

  const bankAccounts = useMemo(() => accounts.filter((a) => a.account_type === 'BANK_ACCOUNT'), [accounts]);
  const tillAccounts = useMemo(() => accounts.filter((a) => a.account_type === 'TILL'), [accounts]);
  const hqSafe = useMemo(() => getHqSafeAccount(), [accounts]);
  const branchSafe = useMemo(() => getBranchSafeAccount(), [accounts]);
  const clerkFloat = useMemo(() => getClerkFloatAccount(), [accounts]);

  const getTillDisplayName = (tillAcc: CashAccount): string => {
    const matchCashier = salespeople.find(
      (s) =>
        s.active !== 'N' &&
        (tillAcc.account_name.toLowerCase().includes(s.name.toLowerCase()) ||
         tillAcc.account_id.endsWith(s.id))
    );
    if (matchCashier) {
      return `${tillAcc.account_name} — ${matchCashier.name} (${matchCashier.role})`;
    }

    const nameStr = tillAcc?.account_name || '';
    const idStr = tillAcc?.account_id || '';
    const tillNumMatch = nameStr.match(/(\d+)/) || idStr.match(/(\d+)/);
    const tillNum = tillNumMatch ? tillNumMatch[1] : '1';
    const tillIndex = parseInt(tillNum, 10) - 1;

    const activeCashiers = salespeople.filter(
      (s) => s.active !== 'N' && (s.role === 'Cashier' || s.role === 'Staff' || s.role === 'ADMIN' || s.role === 'OWNER')
    );
    const cashierCandidate = activeCashiers[tillIndex >= 0 && tillIndex < activeCashiers.length ? tillIndex : 0];
    if (cashierCandidate) {
      return `Till #${tillNum} — ${cashierCandidate.name} (${cashierCandidate.role || 'Cashier'})`;
    }
    return `Till #${tillNum} Register (Cashier Drawer)`;
  };

  const handleExecutePinAction = () => {
    if (!selectedTransfer || !enteredPin) return;

    if (actionType === 'approve') {
      const res = approveCashTransfer(selectedTransfer.transfer_id, currentUser, enteredPin);
      if (res.success) {
        showToast(res.message);
        setSelectedTransfer(null);
        setEnteredPin('');
        reloadData();
      } else {
        showToast(res.message, 'error');
      }
    } else if (actionType === 'receive_hq') {
      const res = receiveHqSafeTransfer(selectedTransfer.transfer_id, currentUser, enteredPin);
      if (res.success) {
        showToast(res.message);
        setSelectedTransfer(null);
        setEnteredPin('');
        reloadData();
      } else {
        showToast(res.message, 'error');
      }
    }
  };

  const openHqActionModal = (type: CashTransferType) => {
    setModalType(type);
    setAmount('');
    setLinkedGrvId('');
    setRecipientName('');
    setSelectedCashierId('');
    setBagSealNumber('');
    setNotes('');
    setGrvSearchQuery('');
    setBankName(govConfig.bankList[0] || 'CBZ Bank Zimbabwe');
    setBankAccountNumber('');

    if (type === 'HQ_TO_BRANCH') {
      setFromAccountId(hqSafe.account_id);
      setToAccountId(branchSafe.account_id);
      setNotes('HQ Central Vault transfer to Branch Safe for branch salaries / ops');
    } else if (type === 'BRANCH_TO_HQ') {
      setFromAccountId(branchSafe.account_id);
      setToAccountId(hqSafe.account_id);
      setNotes('Branch Safe cash transfer to HQ Central Vault');
    } else if (type === 'FLOAT_ISSUE') {
      setFromAccountId(branchSafe.account_id);
      const firstTill = accounts.find((a) => a.account_type === 'TILL');
      setToAccountId(firstTill?.account_id || '');
      const defaultCashier = salespeople.find((s) => s.active !== 'N' && (s.role === 'Cashier' || s.role === 'Staff')) || salespeople[0];
      if (defaultCashier) {
        setSelectedCashierId(defaultCashier.id);
        setRecipientName(defaultCashier.name);
      }
    } else if (type === 'SUPPLIER_PAYMENT') {
      setFromAccountId(hqSafe.account_id);
      setToAccountId('');
    } else if (type === 'BANK_DEPOSIT') {
      setFromAccountId(hqSafe.account_id);
      const firstBank = accounts.find((a) => a.account_type === 'BANK_ACCOUNT');
      setToAccountId(firstBank?.account_id || '');
    } else if (type === 'BANK_WITHDRAWAL') {
      const firstBank = accounts.find((a) => a.account_type === 'BANK_ACCOUNT');
      setFromAccountId(firstBank?.account_id || '');
      setToAccountId(hqSafe.account_id);
    } else if (type === 'TILL_COLLECTION') {
      const firstTill = accounts.find((a) => a.account_type === 'TILL');
      setFromAccountId(firstTill?.account_id || '');
      setToAccountId(hqSafe.account_id);
      setNotes('Till cash turnover into HQ Vault');
    } else if (type === 'CAPITAL_INFUSION') {
      setFromAccountId('');
      setToAccountId(hqSafe.account_id);
      setNotes('HQ Executive Capital Infusion');
    } else if (type === 'THIRD_PARTY_PAYOUT') {
      setFromAccountId(hqSafe.account_id);
      setToAccountId('');
    }

    setIsCreateModalOpen(true);
  };

  const handleCreateHqVoucher = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      showToast('Please enter a valid transfer amount.', 'error');
      return;
    }

    try {
      const isBankTxn = modalType === 'BANK_DEPOSIT' || modalType === 'BANK_WITHDRAWAL';
      const created = createCashTransferVoucher({
        type: modalType,
        from_account_id: fromAccountId || hqSafe.account_id,
        to_account_id: toAccountId || undefined,
        amount: numAmount,
        initiator: currentUser,
        linked_grv_id: linkedGrvId || undefined,
        recipient_name: recipientName || undefined,
        bag_seal_number: bagSealNumber || undefined,
        notes: notes || undefined,
        bank_name: isBankTxn ? bankName : undefined,
        bank_account_number: isBankTxn ? bankAccountNumber : undefined,
        is_owner_break_glass: true,
      });

      setIsCreateModalOpen(false);
      reloadData();

      if (modalType === 'BANK_DEPOSIT') {
        showToast(`Bank Deposit of $${created.amount.toFixed(2)} recorded into ${created.bank_name || 'Commercial Bank'}. Commercial Bank Balance updated.`);
      } else if (modalType === 'BANK_WITHDRAWAL') {
        showToast(`Bank Withdrawal of $${created.amount.toFixed(2)} from ${created.bank_name || 'Commercial Bank'} deposited into vault. Commercial Bank Balance updated.`);
      } else if (created.status === 'PENDING_ACCEPTANCE') {
        showToast(`Till Float of $${created.amount.toFixed(2)} issued to ${created.recipient_name || 'Cashier'}. Awaiting Cashier PIN confirmation.`);
      } else if (created.status === 'IN_TRANSIT') {
        showToast(`HQ Transfer ${created.transfer_id} dispatched into Transit. Deducted $${created.amount.toFixed(2)} from source vault.`);
      } else {
        showToast(`⚡ HQ Action processed: Voucher ${created.transfer_id} settled ($${created.amount.toFixed(2)}).`);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to create HQ voucher.', 'error');
    }
  };

  return (
    <div className="space-y-5 animate-fadeIn select-none">
      {/* Toast Alert */}
      {notification && (
        <div
          className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center justify-between border shadow-xl ${
            notification.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{notification.text}</span>
          </div>
          <button onClick={() => setNotification(null)} className="p-1 hover:bg-white/10 rounded-lg">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 rounded-3xl p-5 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-lg shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-1">
                <h1 className="text-xl font-black text-white tracking-tight">HQ Safe & Owner Command Center</h1>
                <span className="text-[10px] font-mono uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-md font-bold">
                  Owner Executive Tier
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Full-spectrum cash custody control, company vault balances, branch funding, bank deposits, and dual-control sign-offs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={reloadData}
              className="min-h-[44px] px-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 transition-colors border border-slate-700"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh Vaults</span>
            </button>
            {onNavigateClerk && (
              <button
                onClick={onNavigateClerk}
                className="min-h-[44px] px-3.5 rounded-2xl bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 text-xs font-semibold flex items-center space-x-1.5 transition-colors border border-indigo-500/40"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>Branch Clerk View</span>
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="min-h-[44px] px-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-medium transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* 5 Pillars of Cash Custody Breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5 pt-4 border-t border-indigo-500/20">
          <div className="bg-slate-950/80 border border-indigo-500/30 rounded-2xl p-4 shadow-inner">
            <div className="flex items-center justify-between text-indigo-400 text-xs font-semibold">
              <span>HQ Central Vault</span>
              <Building2 className="w-4 h-4" />
            </div>
            <div className="text-2xl font-black text-white font-mono tabular-nums mt-1.5">
              ${summary.totalHqSafe.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Physical Master Safe</div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 shadow-inner">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>Branch Safes</span>
              <Layers className="w-4 h-4" />
            </div>
            <div className="text-2xl font-black text-white font-mono tabular-nums mt-1.5">
              ${summary.totalBranchSafes.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Across branch locations</div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 shadow-inner">
            <div className="flex items-center justify-between text-emerald-400 text-xs font-semibold">
              <span>Clerk Floats</span>
              <DollarSign className="w-4 h-4" />
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono tabular-nums mt-1.5">
              ${summary.totalClerkFloats.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Petty cash in hand</div>
          </div>

          <div
            onClick={() => setIsBankDetailsModalOpen(true)}
            className="bg-slate-950/80 border border-cyan-500/30 hover:border-cyan-500/60 rounded-2xl p-4 shadow-inner cursor-pointer transition group"
            title="Click to view Commercial Bank balances & corporate accounts"
          >
            <div className="flex items-center justify-between text-cyan-400 text-xs font-semibold">
              <span>Commercial Bank</span>
              <Landmark className="w-4 h-4 group-hover:scale-110 transition" />
            </div>
            <div className="text-2xl font-black text-cyan-300 font-mono tabular-nums mt-1.5">
              ${summary.totalBankBalances.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>{summary.bankBreakdown.length} Corporate Accounts</span>
              <span className="text-cyan-400 underline text-[10px] font-semibold">View</span>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-purple-500/30 rounded-2xl p-4 shadow-inner">
            <div className="flex items-center justify-between text-purple-400 text-xs font-semibold">
              <span>Cash In Transit</span>
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="text-2xl font-black text-purple-400 font-mono tabular-nums mt-1.5">
              ${summary.totalCashInTransit.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Sealed transit / courier</div>
          </div>
        </div>
      </div>

      {/* 🚀 HQ Executive Voucher Action Grid (All Clerk Options at HQ Level) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Coins className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">HQ Executive Cash Operations</h2>
          </div>
          <span className="text-[11px] text-slate-400">Directly initiate funding, payouts, and bank transactions from HQ</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
          <button
            onClick={() => openHqActionModal('HQ_TO_BRANCH')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
            title="Dispatch cash from HQ Central Vault to Branch Safe for salaries / expenses"
          >
            <div className="flex items-center justify-between text-violet-400">
              <Building2 className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">HQ $\rightarrow$ Branch</div>
              <div className="text-[9px] text-slate-400">Salaries & Ops</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('BRANCH_TO_HQ')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
            title="Pull cash from Branch Safe into HQ Central Vault"
          >
            <div className="flex items-center justify-between text-amber-400">
              <Building2 className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Branch $\rightarrow$ HQ</div>
              <div className="text-[9px] text-slate-400">Recall Vault</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('FLOAT_ISSUE')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-indigo-400">
              <Banknote className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Issue Float</div>
              <div className="text-[9px] text-slate-400">Till + Cashier</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('TILL_COLLECTION')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
            title="Turn over or recall cash from Till register into Safe / HQ Vault"
          >
            <div className="flex items-center justify-between text-rose-400">
              <Banknote className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Till Turnover</div>
              <div className="text-[9px] text-slate-400">Till $\rightarrow$ Vault</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('SUPPLIER_PAYMENT')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-emerald-400">
              <FileText className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Pay Supplier</div>
              <div className="text-[9px] text-slate-400">GRV Search</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('BANK_DEPOSIT')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-cyan-400">
              <Landmark className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Bank Deposit</div>
              <div className="text-[9px] text-slate-400">Vault $\rightarrow$ Bank</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('BANK_WITHDRAWAL')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-teal-400">
              <Landmark className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Bank Withdraw</div>
              <div className="text-[9px] text-slate-400">Bank $\rightarrow$ Vault</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('CAPITAL_INFUSION')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-blue-400">
              <Coins className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Capital Injection</div>
              <div className="text-[9px] text-slate-400">Equity / Float</div>
            </div>
          </button>

          <button
            onClick={() => openHqActionModal('THIRD_PARTY_PAYOUT')}
            className="min-h-[52px] p-2.5 rounded-2xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-purple-400">
              <ArrowRightLeft className="w-4 h-4" />
              <PlusCircle className="w-3.5 h-3.5 opacity-70" />
            </div>
            <div>
              <div className="text-xs font-bold text-white mt-1">Third-Party</div>
              <div className="text-[9px] text-slate-400">Expense Out</div>
            </div>
          </button>
        </div>
      </div>

      {/* ⚠️ Owner Override Alerts Widget (Past 7 Days Forensic Feed) */}
      <div className="bg-amber-950/20 border border-amber-500/30 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">⚠️ Owner Override Alerts (Last 7 Days)</h2>
          </div>
          <span className="text-[11px] text-amber-400/80 font-mono">
            {overrideAlerts.length} Self-Approved Action{overrideAlerts.length !== 1 ? 's' : ''}
          </span>
        </div>

        {overrideAlerts.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-400 border border-dashed border-amber-500/20 rounded-2xl">
            No break-glass overrides recorded in the last 7 days. Dual-control governance fully preserved.
          </div>
        ) : (
          <div className="space-y-2">
            {overrideAlerts.map((t) => (
              <div
                key={t.transfer_id}
                className="bg-slate-950/80 border border-amber-500/30 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-amber-400">{t.transfer_id}</span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs font-semibold text-white uppercase">{t.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-amber-300 font-medium">Owner self-approved without clerk checker.</span> Reference: {t.notes || t.recipient_name || 'Direct Payout'}
                  </p>
                  <div className="text-[10px] text-slate-500">
                    {new Date(t.created_at).toLocaleString()} · Authorized by {t.created_by_user_name}
                  </div>
                </div>

                <div className="text-right sm:text-right">
                  <div className="text-base font-bold font-mono text-amber-400 tabular-nums">
                    ${t.amount.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase">{t.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two Column Grid: Pending Supplier Approvals & In-Transit Receipt */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Pending Supplier Payments (> $50 Approval Gate) */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-md flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Pending Supplier Payouts</h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {pendingApprovals.length} Awaiting PIN
            </span>
          </div>

          <p className="text-xs text-slate-400 mb-3">
            Payments exceeding the $50 threshold require Owner PIN authorization before cash leaves the vault.
          </p>

          <div className="space-y-2.5 flex-1">
            {pendingApprovals.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl flex-1 flex items-center justify-center">
                All supplier payments are up to date.
              </div>
            ) : (
              pendingApprovals.map((t) => (
                <div
                  key={t.transfer_id}
                  className="bg-slate-950/80 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-mono font-bold text-indigo-400">{t.transfer_id}</div>
                    <div className="text-xs text-white font-medium mt-0.5">
                      {t.recipient_name || (t.linked_grv_id ? `GRV: ${t.linked_grv_id}` : 'Supplier Payout')}
                    </div>
                    <div className="text-[10px] text-slate-500">Initiated by {t.created_by_user_name}</div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <div className="text-sm font-bold font-mono text-emerald-400">${t.amount.toFixed(2)}</div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedTransfer(t);
                        setActionType('approve');
                        setEnteredPin('');
                      }}
                      className="min-h-[40px] px-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Approve</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Card 2: Incoming In-Transit Branch Transits */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-md flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <ArrowDownLeft className="w-5 h-5 text-indigo-400" />
              <h3 className="text-sm font-bold text-white">Receive Branch Cash to HQ</h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {inTransitToHq.length} In Transit
            </span>
          </div>

          <p className="text-xs text-slate-400 mb-3">
            Physical cash envelopes sent by branch clerks. Verify tamper seal number before tapping receive.
          </p>

          <div className="space-y-2.5 flex-1">
            {inTransitToHq.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl flex-1 flex items-center justify-center">
                No branch cash envelopes currently in transit to HQ.
              </div>
            ) : (
              inTransitToHq.map((t) => (
                <div
                  key={t.transfer_id}
                  className="bg-slate-950/80 border border-indigo-500/30 rounded-2xl p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-mono font-bold text-indigo-400">{t.transfer_id}</div>
                    <div className="text-xs text-white font-medium mt-0.5">
                      Tamper Seal: <span className="font-mono text-amber-400">{t.bag_seal_number || 'N/A'}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">From Branch {t.branch_id} · Sent by {t.created_by_user_name}</div>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="text-right">
                      <div className="text-sm font-bold font-mono text-white">${t.amount.toFixed(2)}</div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedTransfer(t);
                        setActionType('receive_hq');
                        setEnteredPin('');
                      }}
                      className="min-h-[40px] px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                    >
                      <Lock className="w-4 h-4" />
                      <span>Deposit HQ</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* HQ Voucher Creation Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-indigo-500/40 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    HQ Action: {modalType.replace(/_/g, ' ')}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Authorized executive cash movement from HQ Command Center
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateHqVoucher} className="space-y-4">
              {/* Amount input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Transfer Amount ($ USD) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full min-h-[44px] px-3.5 text-base font-mono font-bold bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
                <div className="flex items-center gap-1.5 mt-2">
                  {[50, 100, 250, 500, 1000, 1500].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAmount(val.toString())}
                      className="px-2.5 py-1 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg"
                    >
                      ${val}
                    </button>
                  ))}
                </div>
              </div>

              {/* Source Account */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  From Account (Source Vault) *
                </label>
                <select
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="w-full min-h-[44px] px-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-500 font-medium"
                >
                  {accounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.account_name} (${(a.current_balance || 0).toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Destination Account */}
              {(modalType === 'HQ_TO_BRANCH' || modalType === 'BRANCH_TO_HQ' || modalType === 'FLOAT_ISSUE') && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      {modalType === 'FLOAT_ISSUE' ? 'To Register (Till & Cashier)' : 'To Account (Destination Vault)'} *
                    </label>
                    <select
                      value={toAccountId}
                      onChange={(e) => {
                        setToAccountId(e.target.value);
                        if (modalType === 'FLOAT_ISSUE') {
                          const selectedTill = tillAccounts.find((t) => t.account_id === e.target.value);
                          if (selectedTill) {
                            const tName = selectedTill.account_name || '';
                            const tId = selectedTill.account_id || '';
                            const tillNum = tName.match(/(\d+)/)?.[1] || tId.match(/(\d+)/)?.[1] || '1';
                            const tillIdx = parseInt(tillNum, 10) - 1;
                            const activeCashiers = salespeople.filter(
                              (s) => s.active !== 'N' && (s.role === 'Cashier' || s.role === 'Staff' || s.role === 'ADMIN' || s.role === 'OWNER')
                            );
                            const match = activeCashiers[tillIdx >= 0 && tillIdx < activeCashiers.length ? tillIdx : 0];
                            if (match) {
                              setSelectedCashierId(match.id);
                              setRecipientName(match.name);
                              setNotes(`Till float issued to Till #${tillNum} (${match.name}) from HQ`);
                            }
                          }
                        }
                      }}
                      className="w-full min-h-[44px] px-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-500 font-medium"
                    >
                      {modalType === 'FLOAT_ISSUE'
                        ? tillAccounts.map((t) => (
                            <option key={t.account_id} value={t.account_id}>
                              {getTillDisplayName(t)} (${(t.current_balance || 0).toFixed(2)})
                            </option>
                          ))
                        : accounts.map((a) => (
                            <option key={a.account_id} value={a.account_id}>
                              {a.account_name} (${(a.current_balance || 0).toFixed(2)})
                            </option>
                          ))}
                    </select>
                  </div>

                  {modalType === 'FLOAT_ISSUE' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Receiving Cashier / Operator *
                      </label>
                      <select
                        value={selectedCashierId}
                        onChange={(e) => {
                          const cId = e.target.value;
                          setSelectedCashierId(cId);
                          const cObj = salespeople.find((s) => s.id === cId);
                          if (cObj) {
                            setRecipientName(cObj.name);
                            setNotes(`Till float issued to ${cObj.name} (${cObj.role}) from HQ`);
                          }
                        }}
                        className="w-full min-h-[44px] px-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-500 font-medium"
                      >
                        <option value="">Select Cashier Name</option>
                        {salespeople
                          .filter((s) => s.active !== 'N')
                          .map((s, sIdx) => (
                            <option key={`${s.id}-${sIdx}`} value={s.id}>
                              {s.name} ({s.role}) · #{s.id}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Searchable GRVs for Supplier Payment */}
              {modalType === 'SUPPLIER_PAYMENT' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-300">
                      Linked Goods Received Voucher (GRV)
                    </label>
                    <span className="text-[10px] text-emerald-400 font-mono">
                      {unpaidGrvs.length} Pending
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={grvSearchQuery}
                      onChange={(e) => setGrvSearchQuery(e.target.value)}
                      placeholder="🔍 Search GRV #, supplier name, invoice..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-medium"
                    />
                  </div>

                  {linkedGrvId && (
                    <div className="p-2.5 bg-emerald-950/70 border border-emerald-500/50 rounded-xl flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono font-bold text-emerald-300">{linkedGrvId}</span>
                        <span className="text-white ml-2">{recipientName}</span>
                        <span className="text-emerald-400 font-mono font-bold ml-2">${amount}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLinkedGrvId('');
                          setAmount('');
                          setRecipientName('');
                        }}
                        className="text-xs text-rose-400 hover:text-rose-300 underline"
                      >
                        Change GRV
                      </button>
                    </div>
                  )}

                  <div className="max-h-56 overflow-y-auto space-y-1.5 p-1 bg-slate-950/60 rounded-xl border border-slate-800">
                    {(() => {
                      const filteredModalGrvs = unpaidGrvs.filter((g) => {
                        if (!grvSearchQuery.trim()) return true;
                        const q = grvSearchQuery.toLowerCase().trim();
                        return (
                          g.grvNumber.toLowerCase().includes(q) ||
                          (g.supplierName || '').toLowerCase().includes(q) ||
                          (g.invoiceNo || '').toLowerCase().includes(q) ||
                          (g.id || '').toLowerCase().includes(q) ||
                          g.totalCost.toFixed(2).includes(q) ||
                          g.totalCost.toString().includes(q)
                        );
                      });

                      if (unpaidGrvs.length === 0) {
                        return (
                          <div className="p-3 text-center text-xs text-slate-500">
                            No pending unpaid GRVs found (all deliveries settled).
                          </div>
                        );
                      }

                      if (filteredModalGrvs.length === 0) {
                        return (
                          <div className="p-3 text-center text-xs text-amber-300 bg-amber-950/30 rounded-lg border border-amber-800/40">
                            No pending GRVs match "{grvSearchQuery}". ({unpaidGrvs.length} other pending delivery voucher{unpaidGrvs.length !== 1 ? 's' : ''} available).
                          </div>
                        );
                      }

                      return filteredModalGrvs.map((g, idx) => (
                        <div
                          key={`${g.id || g.grvNumber}-${idx}`}
                          onClick={() => {
                            setLinkedGrvId(g.grvNumber);
                            setAmount(g.totalCost.toString());
                            if (g.supplierName) setRecipientName(g.supplierName);
                            setNotes(`HQ direct payment for GRV ${g.grvNumber} (Invoice: ${g.invoiceNo || 'Direct'}) - ${g.supplierName}`);
                          }}
                          className={`p-2 rounded-xl border text-left cursor-pointer transition flex items-center justify-between ${
                            linkedGrvId === g.grvNumber
                              ? 'bg-emerald-900/40 border-emerald-500 text-white'
                              : 'bg-slate-900/80 border-slate-800/80 hover:bg-slate-800/80 text-slate-300'
                          }`}
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-mono font-bold text-emerald-400 text-xs">{g.grvNumber}</span>
                              <span className="text-xs text-white font-semibold">{g.supplierName}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {g.invoiceNo ? `Inv: ${g.invoiceNo}` : 'Direct delivery'} · {g.date}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-bold text-white text-xs">${g.totalCost.toFixed(2)}</div>
                            <span className="text-[10px] text-emerald-400 font-medium underline">Select</span>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {/* Commercial Bank selection */}
              {(modalType === 'BANK_DEPOSIT' || modalType === 'BANK_WITHDRAWAL') && (
                <div className="space-y-3 p-3.5 rounded-2xl bg-slate-950 border border-cyan-800/60">
                  <div className="flex items-center justify-between text-cyan-300 font-bold text-xs">
                    <div className="flex items-center space-x-2">
                      <Landmark className="w-4 h-4" />
                      <span>Commercial Banking Details ({modalType === 'BANK_DEPOSIT' ? 'Deposit Into' : 'Withdrawal From'})</span>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400">
                      Total Bank Bal: ${summary.totalBankBalances.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Select Bank Account *
                    </label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full min-h-[44px] px-3 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500 font-bold"
                    >
                      {bankAccounts.length > 0
                        ? bankAccounts.map((b) => (
                            <option key={b.account_id} value={b.account_name}>
                              {b.account_name} — Balance: ${(b.current_balance || 0).toFixed(2)}
                            </option>
                          ))
                        : govConfig.bankList.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Bank Reference / Slip Number (Optional)
                    </label>
                    <input
                      type="text"
                      value={bankAccountNumber}
                      onChange={(e) => setBankAccountNumber(e.target.value)}
                      placeholder="e.g. SLIP-99812 / CBZ Ref #00129"
                      className="w-full min-h-[44px] px-3.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Purpose / Notes
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Branch operational cash funding / Payroll"
                  className="w-full min-h-[44px] px-3.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Submit Button */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-bold shadow-lg transition-all"
                >
                  ⚡ Authorize & Dispatch from HQ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🏦 Commercial Bank Accounts & Corporate Balances Modal */}
      {isBankDetailsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-2xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center border border-cyan-500/40">
                  <Landmark className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Commercial Bank Accounts & Live Balances</h3>
                  <p className="text-[11px] text-slate-400">HQ corporate banking balances & settlement tracking</p>
                </div>
              </div>
              <button
                onClick={() => setIsBankDetailsModalOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Total Corporate Bank Balance */}
            <div className="bg-slate-950/80 border border-cyan-500/30 rounded-2xl p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-cyan-400 font-bold font-mono">
                Total Live Commercial Bank Balance
              </div>
              <div className="text-3xl font-black text-white font-mono tabular-nums mt-1">
                ${summary.totalBankBalances.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Synchronized across all corporate bank accounts and USD Bank wallet
              </div>
            </div>

            {/* Accounts Breakdown List */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">Registered Commercial Accounts</div>
              {bankAccounts.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                  No bank accounts configured.
                </div>
              ) : (
                bankAccounts.map((b) => (
                  <div
                    key={b.account_id}
                    className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                        <Landmark className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{b.account_name}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Account ID: {b.account_id} · Currency: {b.currency}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold font-mono text-cyan-400">
                        ${(b.current_balance || 0).toFixed(2)}
                      </div>
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/40 font-mono">
                        Active Account
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Explanation of Cash Movements */}
            <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="font-semibold text-slate-300">💡 Where does the money go?</div>
              <div>• <strong>Bank Deposit:</strong> Physical cash moves from HQ Central Vault / Branch Safe $\rightarrow$ Commercial Bank. Safe decreases, Bank Balance increases.</div>
              <div>• <strong>Bank Withdrawal:</strong> Funds move from Commercial Bank $\rightarrow$ Vault to replenish physical cash on hand. Bank Balance decreases, Safe increases.</div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsBankDetailsModalOpen(false);
                  openHqActionModal('BANK_DEPOSIT');
                }}
                className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Deposit Cash to Bank</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsBankDetailsModalOpen(false);
                  openHqActionModal('BANK_WITHDRAWAL');
                }}
                className="flex-1 py-2.5 px-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md"
              >
                <Landmark className="w-3.5 h-3.5" />
                <span>Withdraw to HQ Vault</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Owner PIN Verification Modal */}
      {selectedTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">
                  {actionType === 'approve' ? 'Authorize Supplier Payment' : 'Confirm HQ Vault Deposit'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedTransfer(null)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              <div>Voucher ID: <span className="font-mono font-bold text-white">{selectedTransfer.transfer_id}</span></div>
              <div>Amount: <span className="font-mono font-bold text-emerald-400">${selectedTransfer.amount.toFixed(2)}</span></div>
              {selectedTransfer.bag_seal_number && (
                <div>Seal Number: <span className="font-mono text-amber-400">{selectedTransfer.bag_seal_number}</span></div>
              )}
              <p className="text-[11px] text-slate-400 mt-2">
                Enter your 6-digit Owner PIN to sign and commit this transaction to the physical custody chain and fiscal CashLog.
              </p>
            </div>

            <div>
              <input
                type="password"
                maxLength={6}
                autoFocus
                value={enteredPin}
                onChange={(e) => setEnteredPin(e.target.value)}
                placeholder="Owner 6-digit PIN"
                className="w-full min-h-[48px] text-center tracking-widest text-lg font-mono font-bold bg-slate-950 border border-slate-800 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedTransfer(null)}
                className="min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecutePinAction}
                disabled={!enteredPin}
                className="min-h-[44px] px-5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg transition-all"
              >
                Sign & Commit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
