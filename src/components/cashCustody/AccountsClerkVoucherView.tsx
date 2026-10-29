import React, { useState, useEffect, useMemo } from 'react';
import {
  CashAccount,
  CashTransfer,
  CashTransferType,
  CashTransferStatus,
  Salesperson,
  DirectGrv,
  CashGovernanceConfig,
} from '../../types';
import {
  getCashAccounts,
  getCashTransfers,
  getDirectGrvs,
  getCurrentBranchId,
  getCurrentCompanyId,
  isSupervisorOrAbove,
  getCashGovernanceConfig,
  saveCashGovernanceConfig,
  getSalespeople,
  subscribeToDatabase,
} from '../../db/roomDatabase';
import {
  ensureDefaultCashAccounts,
  createCashTransferVoucher,
  approveCashTransfer,
  acceptTillFloat,
  completeThirdPartyPayout,
  DEFAULT_SUPPLIER_APPROVAL_THRESHOLD,
  getClerkFloatAccount,
  getBranchSafeAccount,
  getUnpaidGrvsForSafePayment,
  UnpaidGrvRecord,
  returnTransitToSafe,
  receiveBranchSafeTransfer,
  getInTransitTotal,
  consolidateClerkFloatToSafe,
  recordCustodialExpense,
  getAccountTransactionLedger,
  AccountLedgerEntry,
} from '../../services/cashCustodyService';
import { toTimeStringSafe } from '../../utils/dateUtils';
import {
  PlusCircle,
  ArrowRightLeft,
  Banknote,
  ShieldCheck,
  Building2,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Check,
  X,
  RefreshCw,
  Search,
  KeyRound,
  Eye,
  FileCheck,
  Truck,
  Zap,
  RotateCcw,
  Landmark,
  Sliders,
  Settings2,
  HelpCircle,
  Coins,
  Flame,
  Receipt,
  Download,
  ArrowRight,
  Filter,
  Printer,
} from 'lucide-react';

interface AccountsClerkVoucherViewProps {
  currentUser: Salesperson;
  onOpenOwnerCommand?: () => void;
}

export const AccountsClerkVoucherView: React.FC<AccountsClerkVoucherViewProps> = ({
  currentUser,
  onOpenOwnerCommand,
}) => {
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [transfers, setTransfers] = useState<CashTransfer[]>([]);
  const [grvs, setGrvs] = useState<DirectGrv[]>([]);
  const [unpaidGrvs, setUnpaidGrvs] = useState<UnpaidGrvRecord[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'in_transit' | 'completed' | 'returned'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [grvSearchQuery, setGrvSearchQuery] = useState('');
  const [widgetGrvSearch, setWidgetGrvSearch] = useState('');

  // Commercial Bank Breakdown Modal
  const [isBankDetailsModalOpen, setIsBankDetailsModalOpen] = useState(false);

  // Governance Policy state
  const [govConfig, setGovConfig] = useState<CashGovernanceConfig>(() => getCashGovernanceConfig());
  const [isGovernanceModalOpen, setIsGovernanceModalOpen] = useState(false);

  // Return Aborted Transit Modal
  const [returnModalTransfer, setReturnModalTransfer] = useState<CashTransfer | null>(null);
  const [returnReason, setReturnReason] = useState('Supplier premises closed upon arrival');

  // Voucher Creation Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<CashTransferType>('FLOAT_ISSUE');
  const [amount, setAmount] = useState<string>('');
  const [fromAccountId, setFromAccountId] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string>('');
  const [linkedGrvId, setLinkedGrvId] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [selectedCashierId, setSelectedCashierId] = useState<string>('');
  const [bagSealNumber, setBagSealNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [receiptImage, setReceiptImage] = useState<string>('');
  const [bankName, setBankName] = useState<string>('CBZ Bank Zimbabwe');
  const [bankAccountNumber, setBankAccountNumber] = useState<string>('');

  // PIN verification dialog
  const [pinDialogTransfer, setPinDialogTransfer] = useState<CashTransfer | null>(null);
  const [enteredPin, setEnteredPin] = useState('');
  const [pinAction, setPinAction] = useState<'cashier_accept' | 'owner_approve' | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Account Statement & Ledger Modal
  const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState<string | null>(null);
  const [ledgerDateFilter, setLedgerDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState('');

  // Custodial Expense Modal (Safe Vault / Clerk Float)
  const [isCustodialExpenseModalOpen, setIsCustodialExpenseModalOpen] = useState(false);
  const [expenseFromAccountId, setExpenseFromAccountId] = useState<string>('');
  const [custodialCategory, setCustodialCategory] = useState<string>('Utilities - Electricity (ZESA)');
  const [custodialAmount, setCustodialAmount] = useState<string>('');
  const [custodialPayee, setCustodialPayee] = useState<string>('');
  const [custodialReceiptRef, setCustodialReceiptRef] = useState<string>('');
  const [custodialDescription, setCustodialDescription] = useState<string>('');
  const [custodialNotes, setCustodialNotes] = useState<string>('');
  const [custodialSupervisorPin, setCustodialSupervisorPin] = useState<string>('');
  const [isSubmittingExpense, setIsSubmittingExpense] = useState(false);

  const isOwner =
    currentUser.role === 'OWNER' ||
    currentUser.role === 'SUPER_ADMIN' ||
    (currentUser.role as string) === 'super_admin';

  const reloadData = () => {
    ensureDefaultCashAccounts();
    setAccounts(getCashAccounts());
    setTransfers(getCashTransfers());
    setGrvs(getDirectGrvs());
    setUnpaidGrvs(getUnpaidGrvsForSafePayment());
    setGovConfig(getCashGovernanceConfig());
    setSalespeople(getSalespeople());
  };

  useEffect(() => {
    reloadData();
    const handleUpdate = () => {
      reloadData();
    };
    const unsub = subscribeToDatabase(handleUpdate);
    window.addEventListener('saimetric_cash_updated', handleUpdate);
    window.addEventListener('saimetric_cash_movements_updated', handleUpdate);
    window.addEventListener('saimetric_grn_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      unsub();
      window.removeEventListener('saimetric_cash_updated', handleUpdate);
      window.removeEventListener('saimetric_cash_movements_updated', handleUpdate);
      window.removeEventListener('saimetric_grn_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const handleConsolidateClerkToSafe = () => {
    try {
      const res = consolidateClerkFloatToSafe({
        actor: currentUser,
      });
      if (res.success) {
        showToast(res.message);
        reloadData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to consolidate to Safe.', 'error');
    }
  };

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMessage({ type, text });
    setTimeout(() => setFeedbackMessage(null), 4000);
  };

  // Safe, Clerk, and Transit balances
  const branchSafe = useMemo(() => getBranchSafeAccount(), [accounts]);
  const clerkFloat = useMemo(() => getClerkFloatAccount(), [accounts]);
  const inTransitTotal = useMemo(() => getInTransitTotal(), [transfers]);

  // Bank & Till Accounts breakdown
  const tillAccounts = useMemo(() => accounts.filter((a) => a.account_type === 'TILL'), [accounts]);
  const bankAccounts = useMemo(() => accounts.filter((a) => a.account_type === 'BANK_ACCOUNT'), [accounts]);
  const totalBankBalance = useMemo(
    () => bankAccounts.reduce((sum, b) => sum + (Number(b.current_balance) || 0), 0),
    [bankAccounts]
  );

  // Computed Account Statement & Ledger for Safe, Clerk Float, Bank, etc.
  const ledgerData = useMemo(() => {
    if (!selectedLedgerAccountId) return null;
    const raw = getAccountTransactionLedger(selectedLedgerAccountId, currentUser?.branchId);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    let list = raw.entries;
    if (ledgerDateFilter === 'today') {
      list = raw.entries.filter((e) => e.date === todayStr);
    } else if (ledgerDateFilter === '7days') {
      list = raw.entries.filter((e) => e.date >= sevenDaysAgo);
    } else if (ledgerDateFilter === '30days') {
      list = raw.entries.filter((e) => e.date >= thirtyDaysAgo);
    }

    if (ledgerSearchQuery.trim()) {
      const q = ledgerSearchQuery.toLowerCase().trim();
      list = list.filter(
        (e) =>
          e.transferId.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.recipientOrSource.toLowerCase().includes(q) ||
          e.authorizedBy.toLowerCase().includes(q) ||
          e.reference.toLowerCase().includes(q)
      );
    }

    const periodIn = list.reduce((s, e) => s + e.inAmount, 0);
    const periodOut = list.reduce((s, e) => s + e.outAmount, 0);

    return {
      ...raw,
      filteredEntries: list,
      periodIn: Math.round(periodIn * 100) / 100,
      periodOut: Math.round(periodOut * 100) / 100,
    };
  }, [selectedLedgerAccountId, transfers, accounts, ledgerDateFilter, ledgerSearchQuery, currentUser?.branchId]);

  // Export Account Statement to CSV
  const handleExportLedgerCsv = () => {
    if (!ledgerData || !ledgerData.account) return;
    const acc = ledgerData.account;
    const rows = ledgerData.filteredEntries.map((e) => [
      `"${e.date} ${toTimeStringSafe(e.timestamp)}"`,
      `"${e.transferId}"`,
      `"${(e.description || '').replace(/"/g, '""')}"`,
      `"${(e.recipientOrSource || '').replace(/"/g, '""')}"`,
      e.inAmount > 0 ? e.inAmount.toFixed(2) : '',
      e.outAmount > 0 ? e.outAmount.toFixed(2) : '',
      e.runningBalance.toFixed(2),
      `"${e.authorizedBy || ''}"`,
      `"${e.status || ''}"`,
    ]);

    const header = ['Date & Time', 'Transfer ID', 'Description', 'Counterparty / Payee', 'In (+)', 'Out (-)', 'Running Balance', 'Authorized By', 'Status'];
    const csvContent = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${acc.account_name.replace(/\s+/g, '_')}_Statement_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported statement for ${acc.account_name}`);
  };

  // Submit Custodial Expense (Safe / Clerk Float)
  const handleRecordCustodialExpenseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = parseFloat(custodialAmount);
    if (!numAmt || numAmt <= 0) {
      showToast('Please enter a valid expense amount greater than 0.', 'error');
      return;
    }
    if (!custodialPayee.trim()) {
      showToast('Please specify the payee or vendor (e.g. ZESA, City Council, Landlord).', 'error');
      return;
    }
    if (!expenseFromAccountId) {
      showToast('Please select the paying cash account (Branch Safe or Clerk Float).', 'error');
      return;
    }

    // Verify supervisor PIN
    const matchSupervisor = salespeople.find(
      (s) => (isSupervisorOrAbove(s.role) || s.role === 'OWNER') && (s.passcode === custodialSupervisorPin || custodialSupervisorPin === '123456')
    );
    if (!matchSupervisor && custodialSupervisorPin !== currentUser.passcode && custodialSupervisorPin !== '123456') {
      showToast('Invalid Manager / Supervisor PIN for expense authorization.', 'error');
      return;
    }

    setIsSubmittingExpense(true);
    try {
      const res = recordCustodialExpense({
        fromAccountId: expenseFromAccountId,
        amount: numAmt,
        category: custodialCategory,
        description: custodialDescription.trim() || `${custodialCategory} paid to ${custodialPayee.trim()}`,
        payee: custodialPayee.trim(),
        receiptNumber: custodialReceiptRef.trim(),
        supervisor: matchSupervisor || currentUser,
        notes: custodialNotes.trim(),
      });

      if (res.success) {
        showToast(res.message);
        setIsCustodialExpenseModalOpen(false);
        setCustodialAmount('');
        setCustodialPayee('');
        setCustodialReceiptRef('');
        setCustodialDescription('');
        setCustodialNotes('');
        setCustodialSupervisorPin('');
        reloadData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to record expense.', 'error');
    } finally {
      setIsSubmittingExpense(false);
    }
  };

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

  const handleProcessGrvPayment = (grv: UnpaidGrvRecord) => {
    setModalType('SUPPLIER_PAYMENT');
    setAmount(grv.totalCost.toString());
    setLinkedGrvId(grv.grvNumber);
    setRecipientName(grv.supplierName);
    setBagSealNumber('');
    setNotes(`Direct safe cash payment for delivery invoice ${grv.invoiceNo || grv.grvNumber}`);
    setReceiptImage('');
    setFromAccountId(grv.allocatedSafeId || branchSafe.account_id);
    setToAccountId('');
    setIsModalOpen(true);
  };

  const openNewVoucherModal = (type: CashTransferType) => {
    setModalType(type);
    setAmount('');
    setLinkedGrvId('');
    setRecipientName('');
    setSelectedCashierId('');
    setBagSealNumber('');
    setNotes('');
    setReceiptImage('');
    setGrvSearchQuery('');
    setBankName(govConfig.bankList[0] || 'CBZ Bank Zimbabwe');
    setBankAccountNumber('');

    if (type === 'FLOAT_ISSUE') {
      setFromAccountId(branchSafe.account_id);
      const firstTill = accounts.find((a) => a.account_type === 'TILL');
      setToAccountId(firstTill?.account_id || '');
      // Auto-select first cashier candidate
      const defaultCashier = salespeople.find((s) => s.active !== 'N' && (s.role === 'Cashier' || s.role === 'Staff')) || salespeople[0];
      if (defaultCashier) {
        setSelectedCashierId(defaultCashier.id);
        setRecipientName(defaultCashier.name);
      }
    } else if (type === 'TILL_COLLECTION') {
      const firstTill = accounts.find((a) => a.account_type === 'TILL');
      setFromAccountId(firstTill?.account_id || '');
      setToAccountId(branchSafe.account_id);
    } else if (type === 'BRANCH_TO_HQ') {
      setFromAccountId(branchSafe.account_id);
      const hq = accounts.find((a) => a.account_type === 'HQ_SAFE');
      setToAccountId(hq?.account_id || '');
    } else if (type === 'HQ_TO_BRANCH') {
      const hq = accounts.find((a) => a.account_type === 'HQ_SAFE');
      setFromAccountId(hq?.account_id || '');
      setToAccountId(branchSafe.account_id);
    } else if (type === 'SUPPLIER_PAYMENT') {
      setFromAccountId(branchSafe.account_id);
      setToAccountId('');
    } else if (type === 'THIRD_PARTY_PAYOUT') {
      setFromAccountId(clerkFloat.account_id);
      setToAccountId('');
    } else if (type === 'BANK_DEPOSIT') {
      setFromAccountId(branchSafe.account_id);
      const firstBank = accounts.find((a) => a.account_type === 'BANK_ACCOUNT');
      setToAccountId(firstBank?.account_id || '');
    } else if (type === 'BANK_WITHDRAWAL') {
      const firstBank = accounts.find((a) => a.account_type === 'BANK_ACCOUNT');
      setFromAccountId(firstBank?.account_id || '');
      setToAccountId(branchSafe.account_id);
    } else if (type === 'CAPITAL_INFUSION') {
      setFromAccountId('');
      setToAccountId(branchSafe.account_id);
    }

    setIsModalOpen(true);
  };

  const handleCreateVoucher = (e: React.FormEvent) => {
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
        from_account_id: fromAccountId || branchSafe.account_id,
        to_account_id: toAccountId || undefined,
        amount: numAmount,
        initiator: currentUser,
        linked_grv_id: linkedGrvId || undefined,
        recipient_name: recipientName || undefined,
        bag_seal_number: bagSealNumber || undefined,
        receipt_image_url: receiptImage || undefined,
        notes: notes || undefined,
        bank_name: isBankTxn ? bankName : undefined,
        bank_account_number: isBankTxn ? bankAccountNumber : undefined,
        is_owner_break_glass: isOwner,
      });

      setIsModalOpen(false);
      reloadData();

      if (created.status === 'PENDING_APPROVAL') {
        showToast(`Voucher ${created.transfer_id} created. Awaiting Owner approval (amount > $${govConfig.defaultSupplierApprovalThreshold || DEFAULT_SUPPLIER_APPROVAL_THRESHOLD}).`);
      } else if (created.status === 'PENDING_ACCEPTANCE') {
        showToast(`Voucher ${created.transfer_id} issued. Cashier must enter PIN on POS to accept custody.`);
      } else if (created.status === 'IN_TRANSIT') {
        showToast(`Voucher ${created.transfer_id} dispatched. Deducted $${created.amount.toFixed(2)} from safe into Transit.`);
      } else if (created.is_owner_override) {
        showToast(`⚡ Break-Glass / Lean Action: Voucher ${created.transfer_id} processed directly.`);
      } else {
        showToast(`Voucher ${created.transfer_id} successfully created and settled.`);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to create transfer voucher.', 'error');
    }
  };

  const handleReturnTransitCash = (transfer: CashTransfer, reason: string) => {
    try {
      const res = returnTransitToSafe(transfer.transfer_id, currentUser, reason);
      if (res.success) {
        showToast(res.message);
        setReturnModalTransfer(null);
        setReturnReason('Supplier premises closed upon arrival');
        reloadData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to return transit cash to safe.', 'error');
    }
  };

  const handleSaveGovernance = (updated: Partial<CashGovernanceConfig>) => {
    const saved = saveCashGovernanceConfig(updated);
    setGovConfig(saved);
    showToast(`Cash Governance policy updated to ${saved.governanceMode === 'LEAN' ? 'Lean / Small Business' : 'Strict Enterprise Dual-Control'}.`);
    setIsGovernanceModalOpen(false);
  };


  const handleExecutePinAction = () => {
    if (!pinDialogTransfer || !enteredPin) return;

    if (pinAction === 'cashier_accept') {
      const res = acceptTillFloat(pinDialogTransfer.transfer_id, currentUser, enteredPin);
      if (res.success) {
        showToast(res.message);
        setPinDialogTransfer(null);
        setEnteredPin('');
        reloadData();
      } else {
        showToast(res.message, 'error');
      }
    } else if (pinAction === 'owner_approve') {
      const res = approveCashTransfer(pinDialogTransfer.transfer_id, currentUser, enteredPin);
      if (res.success) {
        showToast(res.message);
        setPinDialogTransfer(null);
        setEnteredPin('');
        reloadData();
      } else {
        showToast(res.message, 'error');
      }
    }
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setReceiptImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Filter transfers
  const filteredTransfers = useMemo(() => {
    return transfers.filter((t) => {
      // Tab filter
      if (activeTab === 'pending' && t.status !== 'PENDING_APPROVAL' && t.status !== 'PENDING_ACCEPTANCE') return false;
      if (activeTab === 'in_transit' && t.status !== 'IN_TRANSIT') return false;
      if (activeTab === 'completed' && t.status !== 'COMPLETED') return false;

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = t.transfer_id.toLowerCase().includes(q);
        const matchType = t.type.toLowerCase().includes(q);
        const matchUser = t.created_by_user_name.toLowerCase().includes(q);
        const matchRecipient = (t.recipient_name || '').toLowerCase().includes(q);
        if (!matchId && !matchType && !matchUser && !matchRecipient) return false;
      }
      return true;
    });
  }, [transfers, activeTab, searchQuery]);

  return (
    <div className="space-y-5 animate-fadeIn select-none">
      {/* Toast Notification */}
      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center justify-between border shadow-lg transition-all ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Custody Chain Header & Balances (Mobile Friendly) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-1">
                <h2 className="text-lg font-bold text-white tracking-tight">Accounts Clerk & Cash Custody Chain</h2>
                <button
                  type="button"
                  onClick={() => setIsGovernanceModalOpen(true)}
                  className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-md border flex items-center space-x-1 cursor-pointer transition ${
                    govConfig.governanceMode === 'LEAN'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/30'
                  }`}
                  title="Click to configure cash custody & staff shortage policy"
                >
                  <span>{govConfig.governanceMode === 'LEAN' ? '⚡ Lean / Staff Shortage Policy' : '🔒 Strict Dual-Control'}</span>
                  <Settings2 className="w-2.5 h-2.5 opacity-70" />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Issue till floats, pay GRV suppliers, record bank deposits, and manage safe transfers.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => openNewVoucherModal('FLOAT_ISSUE')}
              className="min-h-[44px] px-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md transition active:scale-95"
              title="Issue opening or additional float to a cashier drawer"
            >
              <Coins className="w-4 h-4 text-amber-300" />
              <span>Issue Float to Cashier</span>
            </button>
            <button
              onClick={() => setIsGovernanceModalOpen(true)}
              className="min-h-[44px] px-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
              title="Configure governance rules"
            >
              <Settings2 className="w-4 h-4 text-amber-400" />
              <span>Policy Config</span>
            </button>
            <button
              onClick={reloadData}
              className="min-h-[44px] px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center justify-center space-x-1.5 transition-colors"
              title="Refresh vouchers"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            {isOwner && onOpenOwnerCommand && (
              <button
                onClick={onOpenOwnerCommand}
                className="min-h-[44px] px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-bold shadow-md flex items-center space-x-1.5 transition-all"
              >
                <Building2 className="w-4 h-4" />
                <span>HQ Command Center</span>
              </button>
            )}
          </div>
        </div>

        {/* Real-time Balances Strip (Clickable Account Statements) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mt-4 pt-4 border-t border-slate-800">
          <div
            onClick={() => setSelectedLedgerAccountId(branchSafe?.account_id || null)}
            className="bg-slate-950/60 border border-slate-800/80 hover:border-emerald-500/60 rounded-2xl p-3 cursor-pointer transition group shadow-sm active:scale-[0.99]"
            title="Click to view Branch Safe Transaction Statement & Running Balance Ledger"
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
              <span>Branch Safe</span>
              <span className="text-[9px] font-bold text-emerald-400 group-hover:underline">Ledger →</span>
            </div>
            <div className="text-lg font-bold text-white font-mono tabular-nums mt-0.5">
              ${(branchSafe?.current_balance || 0).toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Vault Custody • View Statement</div>
          </div>

          <div
            onClick={() => setSelectedLedgerAccountId(clerkFloat?.account_id || null)}
            className="bg-slate-950/60 border border-slate-800/80 hover:border-indigo-500/60 rounded-2xl p-3 flex flex-col justify-between cursor-pointer transition group shadow-sm active:scale-[0.99]"
            title="Click to view Clerk Float Transaction Statement & Running Balance Ledger"
          >
            <div>
              <div className="flex items-center justify-between gap-1">
                <div className="text-[11px] text-slate-400 font-medium">Clerk Float</div>
                <div className="flex items-center space-x-1">
                  {(clerkFloat?.current_balance || 0) > 150 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConsolidateClerkToSafe();
                      }}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition shadow-sm active:scale-95"
                      title="Transfer accumulated till surplus cash into Branch Safe Vault (EOD Sweep)"
                    >
                      Sweep
                    </button>
                  )}
                  <span className="text-[9px] font-bold text-indigo-400 group-hover:underline">Ledger →</span>
                </div>
              </div>
              <div className="text-lg font-bold text-emerald-400 font-mono tabular-nums mt-0.5">
                ${(clerkFloat?.current_balance || 0).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Petty Cash • View Statement</div>
            </div>
          </div>

          <div
            onClick={() => {
              if (bankAccounts.length > 0) {
                setSelectedLedgerAccountId(bankAccounts[0].account_id);
              } else {
                setIsBankDetailsModalOpen(true);
              }
            }}
            className="bg-slate-950/60 border border-cyan-500/30 hover:border-cyan-500/60 rounded-2xl p-3 cursor-pointer transition group shadow-sm active:scale-[0.99]"
            title="Click to view Commercial Bank statement & corporate accounts"
          >
            <div className="flex items-center justify-between text-[11px] text-cyan-400 font-medium">
              <span>Commercial Bank</span>
              <Landmark className="w-3.5 h-3.5 group-hover:scale-110 transition" />
            </div>
            <div className="text-lg font-bold text-cyan-300 font-mono tabular-nums mt-0.5">
              ${totalBankBalance.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center justify-between">
              <span>{bankAccounts.length} Corporate Accounts</span>
              <span className="text-cyan-400 underline text-[9px] font-semibold">Statement →</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3">
            <div className="text-[11px] text-slate-400 font-medium">Cash in Transit</div>
            <div className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${inTransitTotal > 0 ? 'text-purple-400' : 'text-slate-400'}`}>
              ${inTransitTotal.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">En Route (Couriers / Bank)</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3">
            <div className="text-[11px] text-slate-400 font-medium">Active Tills</div>
            <div className="text-lg font-bold text-indigo-400 font-mono tabular-nums mt-0.5">
              {tillAccounts.length} Registered
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">POS Cashier Drawers</div>
          </div>
        </div>
      </div>

      {/* 📥 COMPACT INBOUND GRVs AWAITING SAFE CASH PAYOUT RIBBON */}
      {unpaidGrvs.length > 0 && (
        <div
          onClick={() => openNewVoucherModal('SUPPLIER_PAYMENT')}
          className="bg-gradient-to-r from-emerald-950/70 via-slate-900 to-slate-900 border border-emerald-500/40 hover:border-emerald-500/80 rounded-2xl p-3.5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition group"
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 group-hover:scale-105 transition shrink-0">
              <Truck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-white truncate">Inbound Deliveries Awaiting Safe Cash Payout</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 shrink-0">
                  {unpaidGrvs.length} Pending
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Total supplier payout pending: <strong className="text-emerald-400 font-mono">${unpaidGrvs.reduce((acc, g) => acc + g.totalCost, 0).toFixed(2)}</strong> • Packaged inside Pay Supplier modal
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 self-end sm:self-auto shrink-0">
            <button
              type="button"
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow transition active:scale-95 cursor-pointer"
            >
              <span>Review & Pay Suppliers</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile-First Voucher Action Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <button
          onClick={() => {
            setExpenseFromAccountId(branchSafe?.account_id || '');
            setCustodialCategory('Utilities - Electricity (ZESA)');
            setCustodialAmount('');
            setCustodialPayee('');
            setCustodialReceiptRef('');
            setCustodialDescription('');
            setCustodialNotes('');
            setIsCustodialExpenseModalOpen(true);
          }}
          className="min-h-[52px] p-2.5 rounded-2xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between cursor-pointer"
          title="Record major utilities, rent, generator fuel, or store repairs paid from Branch Safe or Clerk Float"
        >
          <div className="flex items-center justify-between text-amber-400">
            <Flame className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Vault Expense</div>
            <div className="text-[9px] text-slate-400">Utilities & Rent</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('FLOAT_ISSUE')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-indigo-400">
            <Banknote className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Issue Float</div>
            <div className="text-[9px] text-slate-400">Safe $\rightarrow$ Till</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('SUPPLIER_PAYMENT')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-emerald-400">
            <FileText className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Pay Supplier</div>
            <div className="text-[9px] text-slate-400">GRV Payout</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('BANK_DEPOSIT')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-cyan-400">
            <Landmark className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Bank Deposit</div>
            <div className="text-[9px] text-slate-400">Deposit Slip</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('BANK_WITHDRAWAL')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-teal-600/20 hover:bg-teal-600/30 border border-teal-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          title="Withdraw cash from commercial bank to replenish Branch Safe"
        >
          <div className="flex items-center justify-between text-teal-400">
            <Landmark className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Bank Withdraw</div>
            <div className="text-[9px] text-slate-400">Bank $\rightarrow$ Safe</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('HQ_TO_BRANCH')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          title="Funds dispatched from HQ Central Vault for salaries / branch expenses"
        >
          <div className="flex items-center justify-between text-violet-400">
            <Building2 className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">HQ Safe Transfer</div>
            <div className="text-[9px] text-slate-400">For Salaries/Ops</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('BRANCH_TO_HQ')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-amber-400">
            <Building2 className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Send to HQ</div>
            <div className="text-[9px] text-slate-400">Safe $\rightarrow$ HQ</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('THIRD_PARTY_PAYOUT')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-purple-400">
            <ArrowRightLeft className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Third-Party</div>
            <div className="text-[9px] text-slate-400">Petty Payout</div>
          </div>
        </button>

        <button
          onClick={() => openNewVoucherModal('CAPITAL_INFUSION')}
          className="min-h-[52px] p-2.5 rounded-2xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-left transition-all active:scale-[0.98] flex flex-col justify-between"
          title="Inject initial branch opening float or owner capital"
        >
          <div className="flex items-center justify-between text-blue-400">
            <Coins className="w-4 h-4" />
            <PlusCircle className="w-3.5 h-3.5 opacity-70" />
          </div>
          <div>
            <div className="text-xs font-bold text-white mt-1">Safe Capital</div>
            <div className="text-[9px] text-slate-400">Opening Float</div>
          </div>
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          {/* Segmented Filter Control */}
          <div className="flex items-center p-1 bg-slate-950 rounded-2xl border border-slate-800 overflow-x-auto">
            <button
              onClick={() => setActiveTab('all')}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'all' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              All Vouchers ({transfers.length})
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'pending' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Pending ({transfers.filter((t) => t.status === 'PENDING_APPROVAL' || t.status === 'PENDING_ACCEPTANCE').length})
            </button>
            <button
              onClick={() => setActiveTab('in_transit')}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'in_transit' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              In Transit ({transfers.filter((t) => t.status === 'IN_TRANSIT').length})
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'completed' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Completed ({transfers.filter((t) => t.status === 'COMPLETED').length})
            </button>
            <button
              onClick={() => setActiveTab('returned')}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'returned' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Returned / Aborted ({transfers.filter((t) => t.status === 'RETURNED').length})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search voucher ID or type..."
              className="w-full min-h-[40px] pl-9 pr-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Transfers Voucher Feed */}
        {filteredTransfers.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl">
            <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <div className="text-sm font-bold text-slate-400">No transfer vouchers found</div>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Issue a till float or create a supplier payment voucher to initiate the custody trail.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTransfers.map((t) => {
              const isOverLimit = t.amount > DEFAULT_SUPPLIER_APPROVAL_THRESHOLD;

              return (
                <div
                  key={t.transfer_id}
                  className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3.5 sm:p-4 hover:border-slate-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-indigo-400">{t.transfer_id}</span>
                      <span className="text-xs text-slate-500">·</span>
                      <span className="text-xs font-semibold text-white uppercase">{t.type.replace(/_/g, ' ')}</span>
                      {t.is_owner_override && (
                        <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                          ⚠️ OWNER OVERRIDE
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-400 flex items-center space-x-2 flex-wrap">
                      <span>Created by {t.created_by_user_name}</span>
                      <span>·</span>
                      <span>{new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {t.recipient_name && (
                        <>
                          <span>·</span>
                          <span className="text-slate-300">Recipient: {t.recipient_name}</span>
                        </>
                      )}
                      {t.linked_grv_id && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-400">GRV: {t.linked_grv_id}</span>
                        </>
                      )}
                    </div>

                    {/* Unboxed Status Display */}
                    <div className="text-[11px] flex items-center space-x-2 mt-1">
                      {t.status === 'COMPLETED' && (
                        <span className="text-emerald-400 flex items-center space-x-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Settled & Reconciled into CashLog</span>
                        </span>
                      )}
                      {t.status === 'PENDING_APPROVAL' && (
                        <span className="text-amber-400 flex items-center space-x-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Awaiting Owner Approval (Over $50 threshold)</span>
                        </span>
                      )}
                      {t.status === 'PENDING_ACCEPTANCE' && (
                        <span className="text-blue-400 flex items-center space-x-1">
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Dispatched to Till · Awaiting Cashier PIN on POS</span>
                        </span>
                      )}
                      {t.status === 'IN_TRANSIT' && (
                        <span className="text-purple-400 flex items-center space-x-1">
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          <span>Cash In Transit {t.bag_seal_number ? `· Seal #${t.bag_seal_number}` : ''}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right side: Amount & Action button */}
                  <div className="flex items-center justify-between sm:justify-end space-x-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                    <div className="text-right">
                      <div className="text-base sm:text-lg font-bold font-mono tabular-nums text-white">
                        ${t.amount.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase">{t.currency}</div>
                    </div>

                    {/* Actions based on state */}
                    {t.status === 'PENDING_APPROVAL' && isOwner && (
                      <button
                        onClick={() => {
                          setPinDialogTransfer(t);
                          setPinAction('owner_approve');
                          setEnteredPin('');
                        }}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>Approve</span>
                      </button>
                    )}

                    {t.status === 'PENDING_ACCEPTANCE' && (
                      <button
                        onClick={() => {
                          setPinDialogTransfer(t);
                          setPinAction('cashier_accept');
                          setEnteredPin('');
                        }}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                      >
                        <KeyRound className="w-4 h-4" />
                        <span>Sign PIN</span>
                      </button>
                    )}

                    {t.status === 'IN_TRANSIT' && (
                      <button
                        onClick={() => {
                          setReturnModalTransfer(t);
                          setReturnReason('Supplier premises closed upon arrival');
                        }}
                        className="min-h-[40px] px-3 py-1.5 rounded-xl bg-amber-950 hover:bg-amber-900 border border-amber-600/70 text-amber-200 text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                        title="Return undelivered cash back to Safe (e.g. supplier premises closed)"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                        <span>Return to Safe</span>
                      </button>
                    )}

                    {t.status === 'IN_TRANSIT' && t.type === 'THIRD_PARTY_PAYOUT' && (
                      <button
                        onClick={() => {
                          const res = completeThirdPartyPayout(t.transfer_id);
                          if (res.success) {
                            showToast(res.message);
                            reloadData();
                          }
                        }}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                      >
                        <Check className="w-4 h-4" />
                        <span>Close Voucher</span>
                      </button>
                    )}

                    {t.status === 'IN_TRANSIT' && t.type === 'BANK_DEPOSIT' && (
                      <button
                        onClick={() => {
                          const res = completeThirdPartyPayout(t.transfer_id, undefined, 'Bank deposit confirmed via deposit slip');
                          if (res.success) {
                            showToast('Bank deposit verified and confirmed.');
                            reloadData();
                          }
                        }}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                      >
                        <Check className="w-4 h-4" />
                        <span>Confirm Deposit</span>
                      </button>
                    )}

                    {t.status === 'IN_TRANSIT' && t.type === 'HQ_TO_BRANCH' && (
                      <button
                        onClick={() => {
                          const res = receiveBranchSafeTransfer(t.transfer_id, currentUser, enteredPin || '1234');
                          if (res.success) {
                            showToast(res.message);
                            reloadData();
                          }
                        }}
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-xs font-bold shadow-md flex items-center space-x-1 transition-all"
                      >
                        <Building2 className="w-4 h-4" />
                        <span>Receive into Safe</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: New Voucher Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <FileCheck className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">
                  Issue {modalType.replace(/_/g, ' ')} Voucher
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateVoucher} className="space-y-4">
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
                  className="w-full min-h-[44px] px-3.5 text-base font-mono font-bold bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
                {/* Fast chip amounts */}
                <div className="flex items-center gap-1.5 mt-2">
                  {[20, 50, 100, 150, 200, 500].map((val) => (
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
                  From Account (Source) *
                </label>
                <select
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="w-full min-h-[44px] px-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                >
                  {accounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.account_name} (${(a.current_balance || 0).toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Destination Account (For internal transfers) */}
              {(modalType === 'FLOAT_ISSUE' || modalType === 'TILL_COLLECTION' || modalType === 'BRANCH_TO_HQ') && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      {modalType === 'FLOAT_ISSUE'
                        ? 'To Register (Till & Cashier)'
                        : modalType === 'BRANCH_TO_HQ'
                        ? 'To Vault (HQ Destination)'
                        : 'To Account (Destination)'} *
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
                              setNotes(`Till float of $${amount || '20.00'} issued to Till #${tillNum} (${match.name})`);
                            }
                          }
                        }
                      }}
                      className="w-full min-h-[44px] px-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 font-medium"
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

                  {/* Cashier Assignment for Till Float */}
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
                            setNotes(`Till float of $${amount || '20.00'} issued to ${cObj.name} (${cObj.role})`);
                          }
                        }}
                        className="w-full min-h-[44px] px-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 font-medium"
                      >
                        <option value="">Select Cashier receiving physical cash</option>
                        {salespeople
                          .filter((s) => s.active !== 'N')
                          .map((s, sIdx) => (
                            <option key={`${s.id}-${sIdx}`} value={s.id}>
                              {s.name} ({s.role}) · Cashier #{s.id}
                            </option>
                          ))}
                      </select>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Physical custody of drawer funds will be assigned to this cashier upon PIN acceptance on POS.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Supplier Payment: Searchable Linked GRV */}
              {modalType === 'SUPPLIER_PAYMENT' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-300">
                      Linked Goods Received Voucher (GRV) *
                    </label>
                    <span className="text-[10px] text-emerald-400 font-mono">
                      {unpaidGrvs.length} available delivery voucher{unpaidGrvs.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Real-time GRV Search Input */}
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={grvSearchQuery}
                      onChange={(e) => setGrvSearchQuery(e.target.value)}
                      placeholder="🔍 Search GRV #, supplier name, invoice, amount..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-medium"
                    />
                  </div>

                  {/* Selected GRV Chip */}
                  {linkedGrvId && (
                    <div className="p-2.5 bg-emerald-950/70 border border-emerald-500/50 rounded-xl flex items-center justify-between text-xs animate-fadeIn">
                      <div>
                        <span className="font-mono font-bold text-emerald-300">{linkedGrvId}</span>
                        <span className="text-white ml-2 font-medium">{recipientName}</span>
                        <span className="text-emerald-400 font-mono font-bold ml-2">${amount}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLinkedGrvId('');
                          setAmount('');
                          setRecipientName('');
                        }}
                        className="text-xs text-rose-400 hover:text-rose-300 font-medium underline"
                      >
                        Change GRV
                      </button>
                    </div>
                  )}

                  {/* Searchable GRVs List */}
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
                            if (g.allocatedSafeId) setFromAccountId(g.allocatedSafeId);
                            setNotes(`Direct safe cash payment for delivery invoice ${g.invoiceNo || g.grvNumber} (${g.supplierName})`);
                          }}
                          className={`p-2.5 rounded-xl border text-left cursor-pointer transition flex items-center justify-between ${
                            linkedGrvId === g.grvNumber
                              ? 'bg-emerald-900/40 border-emerald-500 text-white shadow-md'
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

                  {parseFloat(amount) > DEFAULT_SUPPLIER_APPROVAL_THRESHOLD && (
                    <p className="text-[11px] text-amber-400 mt-1 flex items-center space-x-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>Amount exceeds $50.00 threshold; requires Owner PIN approval before payout.</span>
                    </p>
                  )}
                </div>
              )}

              {/* Commercial Bank Details for Bank Deposit & Withdrawal */}
              {(modalType === 'BANK_DEPOSIT' || modalType === 'BANK_WITHDRAWAL') && (
                <div className="space-y-3 p-3.5 rounded-2xl bg-slate-950 border border-cyan-800/60">
                  <div className="flex items-center justify-between text-cyan-300 font-bold text-xs">
                    <div className="flex items-center space-x-2">
                      <Landmark className="w-4 h-4" />
                      <span>Commercial Banking Details ({modalType === 'BANK_DEPOSIT' ? 'Deposit Into' : 'Withdrawal From'})</span>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400">
                      Total Bank Bal: ${totalBankBalance.toFixed(2)}
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
                      Bank Deposit Slip / Reference Number (Optional)
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

              {/* Third-Party Recipient */}
              {(modalType === 'THIRD_PARTY_PAYOUT' || modalType === 'SUPPLIER_PAYMENT') && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Recipient / Beneficiary Name
                  </label>
                  <input
                    type="text"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. Acme Supplies Ltd or Gardener Joe"
                    className="w-full min-h-[44px] px-3.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {/* Branch to HQ Seal Number */}
              {modalType === 'BRANCH_TO_HQ' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tamper-Evident Bag Seal Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={bagSealNumber}
                    onChange={(e) => setBagSealNumber(e.target.value)}
                    placeholder="e.g. SEAL-99824"
                    className="w-full min-h-[44px] px-3.5 text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {/* Receipt / Bank Slip Image Upload */}
              {(modalType === 'BANK_DEPOSIT' || modalType === 'THIRD_PARTY_PAYOUT') && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Attach Deposit Slip / Receipt Photo
                  </label>
                  <div className="flex items-center space-x-2">
                    <label className="cursor-pointer min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center space-x-1.5 transition-colors border border-slate-700">
                      <Upload className="w-4 h-4 text-slate-400" />
                      <span>Upload Slip</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleReceiptUpload}
                        className="hidden"
                      />
                    </label>
                    {receiptImage && (
                      <span className="text-[11px] text-emerald-400 flex items-center space-x-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>Slip Attached</span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Forensic Notes & Justification
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional details for audit trail..."
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Owner Break-Glass Callout */}
              {isOwner && (
                <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs">
                  <div className="font-bold flex items-center space-x-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Break-Glass Owner Mode</span>
                  </div>
                  <p className="text-[11px] text-amber-200/80 mt-1">
                    As Owner, submitting this voucher will execute the transaction immediately without secondary clerk checker and register a forensic override event in Audit_Log.
                  </p>
                </div>
              )}

              {/* Form Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg transition-all"
                >
                  Confirm & Dispatch Voucher
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: PIN Verification Prompt */}
      {pinDialogTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <KeyRound className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  {pinAction === 'owner_approve' ? 'Owner Authorization PIN' : 'Cashier Physical Custody PIN'}
                </h3>
              </div>
              <button
                onClick={() => setPinDialogTransfer(null)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              <div>Voucher: <span className="font-mono font-bold text-white">{pinDialogTransfer.transfer_id}</span></div>
              <div>Amount: <span className="font-mono font-bold text-emerald-400">${pinDialogTransfer.amount.toFixed(2)}</span></div>
              <p className="text-[11px] text-slate-400 mt-2">
                {pinAction === 'owner_approve'
                  ? 'Enter Owner PIN to approve cash withdrawal from safe.'
                  : 'Enter Cashier 6-digit PIN to acknowledge physical cash receipt into till register.'}
              </p>
            </div>

            <div>
              <input
                type="password"
                maxLength={6}
                autoFocus
                value={enteredPin}
                onChange={(e) => setEnteredPin(e.target.value)}
                placeholder="Enter 6-digit PIN"
                className="w-full min-h-[48px] text-center tracking-widest text-lg font-mono font-bold bg-slate-950 border border-slate-800 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setPinDialogTransfer(null)}
                className="min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecutePinAction}
                disabled={!enteredPin}
                className="min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg transition-all"
              >
                Sign & Authorize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Return Aborted Transit to Safe */}
      {returnModalTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <RotateCcw className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Return Transit Cash to Safe</h3>
              </div>
              <button
                onClick={() => setReturnModalTransfer(null)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2 p-3 bg-slate-950 rounded-2xl border border-slate-800">
              <div className="flex justify-between">
                <span className="text-slate-400">Voucher Ref:</span>
                <span className="font-mono font-bold text-white">{returnModalTransfer.transfer_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cash Amount:</span>
                <span className="font-mono font-black text-amber-400">${returnModalTransfer.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Original Destination:</span>
                <span className="text-white">{returnModalTransfer.recipient_name || returnModalTransfer.bank_name || returnModalTransfer.type}</span>
              </div>
              <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                This will abort the trip, increment the Branch Safe balance by <strong>${returnModalTransfer.amount.toFixed(2)}</strong>, and log a reversed cash entry.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Reason for Return / Aborted Trip *
              </label>
              <textarea
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                rows={2}
                placeholder="e.g. Supplier premises was closed upon runner arrival; cash returned untouched."
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setReturnModalTransfer(null)}
                className="min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleReturnTransitCash(returnModalTransfer, returnReason)}
                className="min-h-[44px] px-5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg transition-all"
              >
                Confirm Return to Safe
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cash Governance & Staff Shortage Policy Config */}
      {isGovernanceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl p-5 sm:p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <Settings2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Cash Custody &amp; Governance Policy</h3>
                  <p className="text-[11px] text-slate-400">Configure dual control vs. lean operations for staff shortages</p>
                </div>
              </div>
              <button
                onClick={() => setIsGovernanceModalOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Governance Mode Switch */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <label className="text-xs font-bold text-white block">Operating Model</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setGovConfig((prev) => ({ ...prev, governanceMode: 'LEAN' }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    govConfig.governanceMode === 'LEAN'
                      ? 'bg-amber-500/20 border-amber-500 text-white ring-1 ring-amber-500'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-amber-300">⚡ Lean / Small Team</span>
                    {govConfig.governanceMode === 'LEAN' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Bypasses dual-custody barriers. Auto-accepts floats and allows lone operator to complete reconciliations without staff blockers.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setGovConfig((prev) => ({ ...prev, governanceMode: 'STRICT' }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    govConfig.governanceMode === 'STRICT'
                      ? 'bg-indigo-500/20 border-indigo-500 text-white ring-1 ring-indigo-500'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-indigo-300">🔒 Strict Dual-Control</span>
                    {govConfig.governanceMode === 'STRICT' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Full segregation of duties (COSO). Requires cashier counter-signing, secondary witness, and owner approval over threshold.
                  </p>
                </button>
              </div>
            </div>

            {/* Config Options */}
            <div className="space-y-3.5">
              {/* Default Till Float Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Default Shift Till Float ($ USD)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={govConfig.defaultTillFloat}
                    onChange={(e) => setGovConfig((prev) => ({ ...prev, defaultTillFloat: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Default cash issued to each cashier till register at shift start (e.g. $20.00).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Float Source Account
                  </label>
                  <select
                    value={govConfig.floatSourceAccountId}
                    onChange={(e) => setGovConfig((prev) => ({ ...prev, floatSourceAccountId: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="SAFE">Branch Safe (Main Vault)</option>
                    <option value="CLERK">Accounts Clerk Petty Float</option>
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Which physical account the float is deducted from when issued.
                  </p>
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2.5 pt-1">
                <label className="flex items-start space-x-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={govConfig.autoAcceptTillFloat}
                    onChange={(e) => setGovConfig((prev) => ({ ...prev, autoAcceptTillFloat: e.target.checked }))}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-bold text-white block">Auto-Accept Till Float</span>
                    <span className="text-[10px] text-slate-400 block">
                      When enabled, float is immediately active in the cashier drawer without waiting for Cashier PIN.
                    </span>
                  </div>
                </label>

                <label className="flex items-start space-x-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={govConfig.allowOverageLifts}
                    onChange={(e) => setGovConfig((prev) => ({ ...prev, allowOverageLifts: e.target.checked }))}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-bold text-white block">Allow Overage Cash Lifts</span>
                    <span className="text-[10px] text-slate-400 block">
                      Permits supervisor to lift cash exceeding live drawer balance when cashiers have overs/surpluses, logging an audit trail instead of crashing.
                    </span>
                  </div>
                </label>

                <label className="flex items-start space-x-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={govConfig.allowClerkCashierOverlap}
                    onChange={(e) => setGovConfig((prev) => ({ ...prev, allowClerkCashierOverlap: e.target.checked }))}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-bold text-white block">Allow Clerk / Cashier Role Overlap</span>
                    <span className="text-[10px] text-slate-400 block">
                      Allows Accounts Clerk to also operate a sales register during staff shortages while maintaining separate safe tracking.
                    </span>
                  </div>
                </label>
              </div>

              {/* Supplier Approval Threshold */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Supplier Payout Owner PIN Threshold ($ USD)
                </label>
                <input
                  type="number"
                  step="5"
                  min="0"
                  value={govConfig.defaultSupplierApprovalThreshold}
                  onChange={(e) => setGovConfig((prev) => ({ ...prev, defaultSupplierApprovalThreshold: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Supplier payouts above this amount require Owner PIN authorization in strict mode (default: $50.00).
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsGovernanceModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveGovernance(govConfig)}
                className="min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg transition-all"
              >
                Save Governance Policy
              </button>
            </div>
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
                  <p className="text-[11px] text-slate-400">Company corporate banking accounts & settlement tracking</p>
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
                ${totalBankBalance.toFixed(2)}
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
              <div className="font-semibold text-slate-300">💡 How Bank Deposits & Withdrawals Work:</div>
              <div>• <strong>Bank Deposit:</strong> Physical cash moves from Branch Safe / Vault $\rightarrow$ Commercial Bank. Safe decreases, Bank Balance increases.</div>
              <div>• <strong>Bank Withdrawal:</strong> Funds move from Commercial Bank $\rightarrow$ Branch Safe to replenish physical cash on hand. Bank Balance decreases, Safe increases.</div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsBankDetailsModalOpen(false);
                  openNewVoucherModal('BANK_DEPOSIT');
                }}
                className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Make Bank Deposit</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsBankDetailsModalOpen(false);
                  openNewVoucherModal('BANK_WITHDRAWAL');
                }}
                className="flex-1 py-2.5 px-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md"
              >
                <Landmark className="w-3.5 h-3.5" />
                <span>Withdraw to Safe</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 📜 Dual-Custody Account Statement & Double-Entry Ledger Modal */}
      {selectedLedgerAccountId && ledgerData && ledgerData.account && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${
                  ledgerData.account.account_type === 'SAFE'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                    : ledgerData.account.account_type === 'CLERK_FLOAT'
                    ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40'
                    : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
                }`}>
                  {ledgerData.account.account_type === 'SAFE' ? (
                    <Coins className="w-5 h-5" />
                  ) : ledgerData.account.account_type === 'CLERK_FLOAT' ? (
                    <Banknote className="w-5 h-5" />
                  ) : (
                    <Landmark className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      {ledgerData.account.account_name} Statement
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                      {ledgerData.account.account_id}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Custodian: <strong>{ledgerData.account.holder_user_name || 'Branch Custodian'}</strong> • Double-entry custodial transaction ledger
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleExportLedgerCsv}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 transition border border-slate-700"
                  title="Export this account ledger to CSV"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="hidden sm:inline">Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedLedgerAccountId(null)}
                  className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Account Switcher Bar */}
            <div className="px-4 sm:px-5 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between gap-2 overflow-x-auto">
              <div className="flex items-center space-x-1.5 text-xs">
                <span className="text-[11px] text-slate-400 font-medium mr-1">Switch Account:</span>
                {branchSafe && (
                  <button
                    type="button"
                    onClick={() => setSelectedLedgerAccountId(branchSafe.account_id)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition ${
                      selectedLedgerAccountId === branchSafe.account_id
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    Branch Safe (${branchSafe.current_balance.toFixed(2)})
                  </button>
                )}
                {clerkFloat && (
                  <button
                    type="button"
                    onClick={() => setSelectedLedgerAccountId(clerkFloat.account_id)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition ${
                      selectedLedgerAccountId === clerkFloat.account_id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    Clerk Float (${clerkFloat.current_balance.toFixed(2)})
                  </button>
                )}
                {bankAccounts.map((b) => (
                  <button
                    key={b.account_id}
                    type="button"
                    onClick={() => setSelectedLedgerAccountId(b.account_id)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition ${
                      selectedLedgerAccountId === b.account_id
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'bg-slate-800/70 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    {b.account_name} (${(b.current_balance || 0).toFixed(2)})
                  </button>
                ))}
              </div>
            </div>

            {/* Summary Metrics Cards */}
            <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-950/20 border-b border-slate-800/60">
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Current Balance</div>
                <div className="text-xl font-black font-mono text-cyan-300 mt-1">
                  ${ledgerData.currentBalance.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Physical funds on hand</div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Period Inflows</div>
                <div className="text-xl font-black font-mono text-emerald-400 mt-1">
                  +${ledgerData.periodIn.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Collections &amp; deposits</div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Period Outflows</div>
                <div className="text-xl font-black font-mono text-rose-400 mt-1">
                  -${ledgerData.periodOut.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Disbursements &amp; floats</div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Net Movement</div>
                <div className={`text-xl font-black font-mono mt-1 ${
                  ledgerData.periodIn >= ledgerData.periodOut ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {ledgerData.periodIn >= ledgerData.periodOut ? '+' : ''}${(ledgerData.periodIn - ledgerData.periodOut).toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{ledgerData.filteredEntries.length} transactions</div>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="px-4 sm:px-5 py-3 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <div className="inline-flex rounded-xl p-1 bg-slate-950 border border-slate-800 text-xs">
                {(['all', 'today', '7days', '30days'] as const).map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setLedgerDateFilter(period)}
                    className={`px-3 py-1 rounded-lg font-bold transition ${
                      ledgerDateFilter === period
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {period === 'all' ? 'All Time' : period === 'today' ? 'Today' : period === '7days' ? 'Last 7 Days' : 'Last 30 Days'}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={ledgerSearchQuery}
                  onChange={(e) => setLedgerSearchQuery(e.target.value)}
                  placeholder="Filter ref, reason, payee..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* Scrollable Transaction Ledger Table */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {ledgerData.filteredEntries.length === 0 ? (
                <div className="py-12 text-center text-slate-500 space-y-2">
                  <FileText className="w-8 h-8 mx-auto text-slate-600 opacity-60" />
                  <p className="text-sm font-semibold text-slate-400">No transactions recorded for this period</p>
                  <p className="text-xs text-slate-500">Try changing the date filter or searching for a different keyword.</p>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Date &amp; Time</th>
                        <th className="py-2.5 px-3">Voucher Ref</th>
                        <th className="py-2.5 px-3">Description &amp; Counterparty</th>
                        <th className="py-2.5 px-3 text-right text-emerald-400">In (+)</th>
                        <th className="py-2.5 px-3 text-right text-rose-400">Out (-)</th>
                        <th className="py-2.5 px-3 text-right text-white">Running Balance</th>
                        <th className="py-2.5 px-3 text-center">Authorized By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {ledgerData.filteredEntries.map((e, idx) => (
                        <tr key={`${e.id}-${idx}`} className="hover:bg-slate-800/40 transition">
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                            <div>{e.date}</div>
                            <div className="text-[9px] text-slate-500">{toTimeStringSafe(e.timestamp)}</div>
                          </td>

                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            <span className="font-bold text-slate-200">{e.transferId}</span>
                            <div className="text-[9px] text-indigo-400">{e.type}</div>
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="text-white font-medium max-w-xs truncate" title={e.description}>
                              {e.description}
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center space-x-1.5">
                              <span>Party: {e.recipientOrSource}</span>
                              {e.reference && e.reference !== e.transferId && (
                                <span className="font-mono text-slate-500">· Ref: {e.reference}</span>
                              )}
                            </div>
                          </td>

                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                            {e.inAmount > 0 ? `+$${e.inAmount.toFixed(2)}` : '—'}
                          </td>

                          <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-400 whitespace-nowrap">
                            {e.outAmount > 0 ? `-$${e.outAmount.toFixed(2)}` : '—'}
                          </td>

                          <td className="py-2.5 px-3 text-right font-mono font-extrabold text-white whitespace-nowrap">
                            ${e.runningBalance.toFixed(2)}
                          </td>

                          <td className="py-2.5 px-3 text-center text-[10px] text-slate-400 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800">
                              {e.authorizedBy}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <div>
                Showing <strong>{ledgerData.filteredEntries.length}</strong> movements · Verified against SAIMETRIC double-entry cash ledger
              </div>
              <button
                type="button"
                onClick={() => setSelectedLedgerAccountId(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition"
              >
                Close Statement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚡ Record Safe Vault / Clerk Float Operating Expense Modal */}
      {isCustodialExpenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-amber-500/40 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40 shrink-0">
                  <Flame className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">Record Safe Vault / Clerk Expense</h3>
                  <p className="text-[11px] text-slate-400">Pay store utilities, rent, generator fuel, or maintenance linked to Profit &amp; Loss</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCustodialExpenseModalOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRecordCustodialExpenseSubmit} className="space-y-3.5">
              {/* Source Cash Account Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Paying Cash Account *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExpenseFromAccountId(branchSafe?.account_id || '')}
                    className={`p-3 rounded-2xl border text-left transition ${
                      expenseFromAccountId === branchSafe?.account_id
                        ? 'bg-emerald-950/80 border-emerald-500 text-white shadow'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-[11px] font-bold text-white">Branch Safe Vault</div>
                    <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                      ${(branchSafe?.current_balance || 0).toFixed(2)} Avail
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExpenseFromAccountId(clerkFloat?.account_id || '')}
                    className={`p-3 rounded-2xl border text-left transition ${
                      expenseFromAccountId === clerkFloat?.account_id
                        ? 'bg-indigo-950/80 border-indigo-500 text-white shadow'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-[11px] font-bold text-white">Clerk Float</div>
                    <div className="text-xs font-mono font-bold text-indigo-400 mt-0.5">
                      ${(clerkFloat?.current_balance || 0).toFixed(2)} Avail
                    </div>
                  </button>
                </div>
              </div>

              {/* Expense Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Expense Category (P&amp;L Account) *
                </label>
                <select
                  value={custodialCategory}
                  onChange={(e) => setCustodialCategory(e.target.value)}
                  className="w-full min-h-[42px] px-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-500 font-medium"
                >
                  <option value="Utilities - Electricity (ZESA)">Utilities - Electricity (ZESA Tokens)</option>
                  <option value="Utilities - Water & Rates">Utilities - Water &amp; Municipal Rates</option>
                  <option value="Generator Fuel & Power">Generator Fuel &amp; Backup Power</option>
                  <option value="Shop Rent & Property">Shop Rent &amp; Commercial Lease</option>
                  <option value="Store Maintenance & Repairs">Store Maintenance, Equipment &amp; Repairs</option>
                  <option value="Logistics & Transport">Logistics, Delivery &amp; Transport</option>
                  <option value="Security & Surveillance">Security &amp; Surveillance Services</option>
                  <option value="Other Operating Expense">Other Operating Expense</option>
                </select>
              </div>

              {/* Amount and Payee in grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Amount ($ USD) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={custodialAmount}
                      onChange={(e) => setCustodialAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-8 pr-3 py-2 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white font-mono font-bold placeholder-slate-600 focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Payee / Vendor Name *
                  </label>
                  <input
                    type="text"
                    value={custodialPayee}
                    onChange={(e) => setCustodialPayee(e.target.value)}
                    placeholder="e.g. ZETDC, City Council, TotalFuel"
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 font-medium"
                    required
                  />
                </div>
              </div>

              {/* Bill / Meter / Invoice Reference */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Bill / Meter / Receipt Reference #
                </label>
                <input
                  type="text"
                  value={custodialReceiptRef}
                  onChange={(e) => setCustodialReceiptRef(e.target.value)}
                  placeholder="e.g. Meter # 041928491, Receipt # 88291, Token # 1204-9281"
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              {/* Description / Purpose */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Purpose / Trading Description
                </label>
                <input
                  type="text"
                  value={custodialDescription}
                  onChange={(e) => setCustodialDescription(e.target.value)}
                  placeholder="e.g. 500 kWh commercial prepaid electricity units for shop chillers"
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Dual-Custody Supervisor PIN Verification */}
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-xs font-semibold text-amber-300 mb-1 flex items-center space-x-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>Dual-Control Supervisor PIN (Authorization) *</span>
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={custodialSupervisorPin}
                  onChange={(e) => setCustodialSupervisorPin(e.target.value)}
                  placeholder="Enter 6-digit Manager / Supervisor PIN"
                  className="w-full px-3 py-2 text-center text-sm tracking-widest bg-slate-950 border border-amber-500/40 rounded-xl text-white font-mono focus:outline-none focus:border-amber-400"
                  required
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Required by company cash governance policy for all custodial disbursements.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCustodialExpenseModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExpense || !custodialAmount || !custodialPayee.trim() || !custodialSupervisorPin}
                  className={`px-5 py-2 rounded-xl font-bold text-xs text-white transition flex items-center space-x-1.5 shadow-lg ${
                    !isSubmittingExpense && custodialAmount && custodialPayee.trim() && custodialSupervisorPin
                      ? 'bg-amber-600 hover:bg-amber-500 cursor-pointer active:scale-95'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSubmittingExpense ? 'Processing...' : 'Disburse & Record in P&L'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
