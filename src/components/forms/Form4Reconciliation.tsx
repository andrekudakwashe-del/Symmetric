import React, { useState, useMemo, useEffect } from 'react';
import {
  Salesperson,
  ExpenseEntry,
  Customer,
  AdminSalesEntry,
  ShiftReconciliation,
  SaleInvoice,
} from '../../types';
import {
  getSalespeople,
  getCashLogs,
  getCashLogsForStaffAndDate,
  getCustomerChanges,
  getCreditSales,
  getCashCounts,
  getAdminSales,
  getAdminSaleForStaffAndDate,
  saveAllAdminSalesEntries,
  saveAdminSalesEntry,
  calculateSalespersonCashBalancing,
  getSales,
  getSalesForStaffAndDate,
  getTotalSalesForStaffAndDate,
  getExpenses,
  addExpense,
  getTodayDateString,
  subscribeToDatabase,
  isSupervisorOrAbove,
  getCompanyBranchSettings,
  saveCompanyBranchSettings,
  logForm4AuditUnlock,
  getActiveCurrencies,
  getCashGovernanceConfig,
  getCashTransfers,
  getPendingSupervisorApprovals,
  approveDirectGrv,
  rejectDirectGrv,
  approveExpense,
  rejectExpense,
  getBusinessDayClosureByDate,
  isBusinessDayClosed,
  saveBusinessDayClosure,
  BusinessDayClosure,
  getElectronicSettlementForDate,
  saveElectronicSettlement,
  ElectronicSettlementRecord,
  verifySalespersonPin,
} from '../../db/roomDatabase';
import {
  handoverTillToSafe,
  getCashierRetainedFloat,
  saveCashierRetainedFloat,
} from '../../services/cashCustodyService';
import { ManagerPinModal } from '../common/ManagerPinModal';
import { getAllMovements, getShiftId, matchesShift, CashMovement } from '../../db/cashLedger';
import { CustomerSearchModal } from '../common/CustomerSearchModal';
import { downloadCsvFile } from '../../services/googleSheetsSync';
import { isSameDaySafe } from '../../utils/dateUtils';
import {
  Scale,
  DollarSign,
  Calendar,
  Save,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Download,
  Printer,
  Search,
  Eye,
  X,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Coins,
  Receipt,
  User,
  ShieldAlert,
  HelpCircle,
  PlusCircle,
  Sparkles,
  Home,
  ArrowLeft,
  Pencil,
  RotateCcw,
  Check,
  ShoppingBag,
  Calculator,
  Smartphone,
  History,
  Lock,
  KeyRound,
  Database,
  FileCheck,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Building2,
  CheckCheck,
  AlertOctagon,
  LockKeyhole,
  ArrowUpRight,
  ShieldCheck,
  Truck,
  Package,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { FormStepNavigation } from '../common/FormStepNavigation';
import { DatabaseBackupModal } from '../common/DatabaseBackupModal';
import { DatabaseRestoreModal } from '../common/DatabaseRestoreModal';
import {
  calculateSupervisorExpectedCash,
  approveInternalConsumption,
  rejectInternalConsumption,
} from '../../services/walletService';
import { databaseBackupService } from '../../services/databaseBackupService';

interface Form4ReconciliationProps {
  currentUser: Salesperson;
  onNavigateToCashCount?: () => void;
  onNavigateToCustomerChange?: () => void;
  onNavigateToHome?: () => void;
}

const EXPENSE_CATEGORIES = [
  'Office & Store Supplies',
  'Fuel & Vehicle Transport',
  'Staff Meals & Refreshment',
  'Shop Utilities & Electricity',
  'Contractor / Technician Labor',
  'Packaging & Delivery',
  'Equipment Maintenance',
  'Bank & Merchant Charges',
  'Miscellaneous Petty Cash',
];

export const Form4Reconciliation: React.FC<Form4ReconciliationProps> = ({
  currentUser,
  onNavigateToCashCount,
  onNavigateToCustomerChange,
  onNavigateToHome,
}) => {
  // Company Owners, Super Admins, Managers, and Admins can access Form 4
  const canAccessForm4 =
    isSupervisorOrAbove(currentUser.role) ||
    Boolean(currentUser.permissions?.canPerformShiftEnd);

  if (!canAccessForm4) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-4 max-w-lg mx-auto my-8">
        <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto text-2xl font-bold">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-white">Supervisor or Manager Access Required</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Form 4 (End-of-Day Shift Balancing & Reconciliation) is restricted to Managers, Supervisors, and Administrator accounts.
          Cashiers cannot view or access balancing records.
        </p>
      </div>
    );
  }

  // Dedicated Form 4 Audit Password Security Gate
  const branchSettings = getCompanyBranchSettings();
  const configuredPassword = branchSettings.form4AuditPassword?.trim() || '';
  const [isForm4Unlocked, setIsForm4Unlocked] = useState<boolean>(() => !configuredPassword);
  const [form4PasswordInput, setForm4PasswordInput] = useState('');
  const [form4PasswordError, setForm4PasswordError] = useState<string | null>(null);
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [showPasswordSetupModal, setShowPasswordSetupModal] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState(configuredPassword);

  // Active view tab
  const [activeTab, setActiveTab] = useState<'balancing' | 'supervisor_handover' | 'expenses' | 'history'>('balancing');
  const [date, setDate] = useState<string>(() => getTodayDateString());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'BALANCED' | 'DISCREPANCY' | 'ACTIVE'>('ALL');

  // Handle password unlock
  const handlePasswordUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuredPassword) {
      setIsForm4Unlocked(true);
      return;
    }
    if (form4PasswordInput.trim() === configuredPassword) {
      logForm4AuditUnlock(currentUser, date, 'PASSWORD');
      setIsForm4Unlocked(true);
      setForm4PasswordError(null);
    } else {
      setForm4PasswordError('Incorrect Form 4 Audit Password. Please try again.');
    }
  };

  // Local state for optional manual override of sales amounts per salesperson { staffId: overrideAmountString }
  const [salesInputs, setSalesInputs] = useState<Record<string, string>>({});
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [saveSuccessBanner, setSaveSuccessBanner] = useState<string | null>(null);
  const [showEodBackupModal, setShowEodBackupModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  // Selected salesperson for detailed transaction audit drawer/modal
  const [auditStaffId, setAuditStaffId] = useState<string | null>(null);

  // Expense modal state
  const [expenseCategory, setExpenseCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseVendor, setExpenseVendor] = useState('');
  const [expensePayMethod, setExpensePayMethod] = useState<'Cash' | 'Card' | 'Bank Transfer' | 'EcoCash/Mobile'>('Cash');
  const [expenseRef, setExpenseRef] = useState('');
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);

  // DB Data
  const [salespeople, setSalespeople] = useState<Salesperson[]>(() => getSalespeople());
  const [expenses, setExpenses] = useState<ExpenseEntry[]>(() => getExpenses());
  const [salesList, setSalesList] = useState<SaleInvoice[]>(() => getSales());
  const [refreshKey, setRefreshKey] = useState(0);
  const [customRetainedFloats, setCustomRetainedFloats] = useState<Record<string, string>>({});

  // Gatekeeper: Supervisor Pending Approvals
  const pendingApprovals = useMemo(() => {
    return getPendingSupervisorApprovals(date, currentUser?.branchId);
  }, [date, currentUser?.branchId, refreshKey]);

  // Closed Business Day Status
  const closedDay = useMemo(() => {
    return getBusinessDayClosureByDate(date, currentUser?.branchId);
  }, [date, currentUser?.branchId, refreshKey]);
  const isDayClosed = !!closedDay && closedDay.status === 'CLOSED';

  // Gatekeeper Drawer
  const [showApprovalsDrawer, setShowApprovalsDrawer] = useState(false);
  const [approvalActionNotice, setApprovalActionNotice] = useState<string | null>(null);

  // Electronic Settlements & Sweep State
  const [showElectronicModal, setShowElectronicModal] = useState(false);
  const [ecocashBatchInput, setEcocashBatchInput] = useState('');
  const [ecocashSettledAmount, setEcocashSettledAmount] = useState('');
  const [zigBatchInput, setZigBatchInput] = useState('');
  const [zigSettledAmount, setZigSettledAmount] = useState('');
  const [targetBankInput, setTargetBankInput] = useState('CABS');
  const [isElectronicSettled, setIsElectronicSettled] = useState(false);

  // EOD Wizard State
  const [showEodWizardModal, setShowEodWizardModal] = useState(false);
  const [eodStep, setEodStep] = useState<1 | 2 | 3>(1);
  const [eodSupervisorPin, setEodSupervisorPin] = useState('');
  const [eodManagerPin, setEodManagerPin] = useState('');
  const [eodManagerName, setEodManagerName] = useState('Store Manager');
  const [eodNotes, setEodNotes] = useState('');
  const [isClosingEod, setIsClosingEod] = useState(false);
  const [eodErrorMessage, setEodErrorMessage] = useState<string | null>(null);
  const [completedEodRecord, setCompletedEodRecord] = useState<BusinessDayClosure | null>(null);
  const [eodVerificationMode, setEodVerificationMode] = useState<'SINGLE' | 'DUAL'>(
    () => branchSettings.eodVerificationMode || 'SINGLE'
  );

  // Auto-load electronic settlement record if already saved
  useEffect(() => {
    const existing = getElectronicSettlementForDate(date, currentUser?.branchId);
    if (existing) {
      setEcocashBatchInput(existing.ecocashBatchRef || '');
      setEcocashSettledAmount(existing.ecocashAmountSettled ? String(existing.ecocashAmountSettled) : '');
      setZigBatchInput(existing.zigBatchRef || '');
      setZigSettledAmount(existing.zigAmountSettled ? String(existing.zigAmountSettled) : '');
      setTargetBankInput(existing.targetBankAccountName || 'CABS');
      setIsElectronicSettled(existing.ecocashVerified && existing.zigVerified);
    } else {
      setEcocashBatchInput('');
      setEcocashSettledAmount('');
      setZigBatchInput('');
      setZigSettledAmount('');
      setTargetBankInput('CABS');
      setIsElectronicSettled(false);
    }
  }, [date, currentUser?.branchId, refreshKey]);

  // Subscribe to DB changes and window events
  useEffect(() => {
    const handleUpdate = () => {
      setSalespeople(getSalespeople());
      setExpenses(getExpenses());
      setSalesList(getSales());
      setRefreshKey((k) => k + 1);
    };

    const unsub = subscribeToDatabase(handleUpdate);
    window.addEventListener('saimetric_sales_updated', handleUpdate);
    window.addEventListener('saimetric_cash_updated', handleUpdate);
    window.addEventListener('saimetric_cash_movements_updated', handleUpdate);
    window.addEventListener('saimetric_direct_grvs_updated', handleUpdate);
    window.addEventListener('saimetric_expenses_updated', handleUpdate);
    window.addEventListener('saimetric_internal_consumption_updated', handleUpdate);
    window.addEventListener('saimetric_eod_completed', handleUpdate);
    window.addEventListener('mesh-catchup-completed', handleUpdate);

    return () => {
      unsub();
      window.removeEventListener('saimetric_sales_updated', handleUpdate);
      window.removeEventListener('saimetric_cash_updated', handleUpdate);
      window.removeEventListener('saimetric_cash_movements_updated', handleUpdate);
      window.removeEventListener('saimetric_direct_grvs_updated', handleUpdate);
      window.removeEventListener('saimetric_expenses_updated', handleUpdate);
      window.removeEventListener('saimetric_internal_consumption_updated', handleUpdate);
      window.removeEventListener('saimetric_eod_completed', handleUpdate);
      window.removeEventListener('mesh-catchup-completed', handleUpdate);
    };
  }, []);

  // Initialize or update sales overrides & retained floats whenever date changes
  useEffect(() => {
    const adminSales = getAdminSales().filter((s) => s.date === date);
    const initialMap: Record<string, string> = {};
    adminSales.forEach((s) => {
      if (s.notes?.includes('Manual Override')) {
        initialMap[s.staffId] = s.salesAmount.toString();
      }
    });
    setSalesInputs(initialMap);

    // Initialize custom retained floats from saved cashbox entries if present
    const initialFloatMap: Record<string, string> = {};
    salespeople.forEach((staff) => {
      const savedFloat = getCashierRetainedFloat(staff.id, date);
      if (savedFloat !== null && savedFloat > 0) {
        initialFloatMap[staff.id] = savedFloat.toString();
      }
    });
    setCustomRetainedFloats(initialFloatMap);

    setEditingStaffId(null);
    setSaveSuccessBanner(null);
  }, [date, salespeople]);

  // Calculate balancing metrics for all active salespeople on selected date
  const balancingData = useMemo(() => {
    return salespeople.map((staff) => {
      const rawInput = salesInputs[staff.id];
      const parsedSales = rawInput !== undefined && rawInput.trim() !== '' ? parseFloat(rawInput) || 0 : undefined;
      return calculateSalespersonCashBalancing(staff.id, staff.name, date, parsedSales, currentUser?.branchId);
    });
  }, [salespeople, date, salesInputs, salesList, currentUser?.branchId, refreshKey]);

  // Filtered salespeople rows
  const filteredRows = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    return balancingData.filter((row) => {
      const matchesSearch =
        !q ||
        (row.staffName && row.staffName.toLowerCase().includes(q)) ||
        (row.staffId && row.staffId.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (filterStatus === 'BALANCED') return row.status === 'Balanced';
      if (filterStatus === 'DISCREPANCY') return row.status === 'Shortage' || row.status === 'Over';
      if (filterStatus === 'ACTIVE') return row.hasActivity;

      return true;
    });
  }, [balancingData, searchQuery, filterStatus]);

  // Summary aggregated totals across all salespeople
  const summaryTotals = useMemo(() => {
    let totalForm2Net = 0;
    let totalForm3Net = 0;
    let totalSumForm2And3Net = 0;
    let totalSales = 0;
    let totalShouldHave = 0;
    let totalExpectedCash = 0;
    let totalPhysicalCount = 0;
    let hasAnyCount = false;
    let totalVariance = 0;
    let totalCashIn = 0;
    let totalCashOut = 0;

    let totalFloat = 0;
    let totalCashSales = 0;
    let totalCreditPayments = 0;
    let totalChangeIn = 0;
    let totalExpenses = 0;
    let totalDirectProcurements = 0;
    let totalCashLift = 0;
    let totalChangeOut = 0;
    let totalEcocashCashOut = 0;
    let totalZigCashOut = 0;
    let totalPettyCash = 0;

    let totalEcocashSales = 0;
    let totalZigSales = 0;
    let totalCreditExtended = 0;

    const activeCurrenciesList = getActiveCurrencies();
    const currencyWithdrawalTotals: Record<string, number> = {};
    const currencySalesTotals: Record<string, number> = {};
    activeCurrenciesList.forEach((c) => {
      currencyWithdrawalTotals[c.currency] = 0;
      currencySalesTotals[c.currency] = 0;
    });
    let totalMultiCurrencyWithdrawalsAll = 0;
    let totalMultiCurrencySalesAll = 0;

    let countBalanced = 0;
    let countShortage = 0;
    let countOver = 0;
    let countActive = 0;

    balancingData.forEach((r) => {
      totalForm2Net += r.form2Net;
      totalForm3Net += r.form3Net;
      totalSumForm2And3Net += r.sumForm2And3Net;
      totalSales += r.sales;
      totalShouldHave += r.shouldHave;
      totalExpectedCash += r.expectedCash || 0;
      if (r.actualCashCount !== null) {
        totalPhysicalCount += r.actualCashCount;
        hasAnyCount = true;
      }
      totalVariance += r.variance;
      totalCashIn += r.cashInTotal || 0;
      totalCashOut += r.cashOutTotal || 0;

      totalFloat += r.float || 0;
      totalCashSales += r.cashSales || 0;
      totalCreditPayments += r.creditPayments || 0;
      totalChangeIn += (r.changeReceived ?? r.changeIn) || 0;
      totalExpenses += r.expenses || 0;
      totalDirectProcurements += r.directProcurements || 0;
      totalCashLift += r.cashLift || 0;
      totalChangeOut += (r.changePaid ?? r.customerChange) || 0;
      totalEcocashCashOut += r.ecocashWithdrawal || 0;
      totalZigCashOut += r.zigWithdrawal || 0;
      totalPettyCash += r.deductions || 0;

      totalEcocashSales += r.ecocashSales || 0;
      totalZigSales += r.zigSales || 0;
      totalCreditExtended += r.creditExtended || 0;

      activeCurrenciesList.forEach((c) => {
        const wVal =
          (r.currencyWithdrawals && r.currencyWithdrawals[c.currency]) ??
          (c.currency === 'EcoCash' ? r.ecocashWithdrawal : c.currency === 'ZiG' ? r.zigWithdrawal : 0) ??
          0;
        const sVal =
          (r.currencySales && r.currencySales[c.currency]) ??
          (c.currency === 'EcoCash' ? r.ecocashSales : c.currency === 'ZiG' ? r.zigSales : 0) ??
          0;
        currencyWithdrawalTotals[c.currency] = (currencyWithdrawalTotals[c.currency] || 0) + wVal;
        currencySalesTotals[c.currency] = (currencySalesTotals[c.currency] || 0) + sVal;
        totalMultiCurrencyWithdrawalsAll += wVal;
        totalMultiCurrencySalesAll += sVal;
      });

      if (r.hasActivity) countActive++;
      if (r.status === 'Balanced') countBalanced++;
      if (r.status === 'Shortage') countShortage++;
      if (r.status === 'Over') countOver++;
    });

    const netDrawerImpact = Math.round((totalCashIn - totalCashOut) * 100) / 100;
    const totalNonCash = Math.round((totalMultiCurrencySalesAll + totalCreditExtended) * 100) / 100;

    return {
      totalForm2Net,
      totalForm3Net,
      totalSumForm2And3Net,
      totalSales,
      totalShouldHave,
      totalExpectedCash: Math.round(totalExpectedCash * 100) / 100,
      totalPhysicalCount: hasAnyCount ? Math.round(totalPhysicalCount * 100) / 100 : null,
      totalVariance: Math.round(totalVariance * 100) / 100,
      totalCashIn: Math.round(totalCashIn * 100) / 100,
      totalCashOut: Math.round(totalCashOut * 100) / 100,
      netDrawerImpact,
      totalFloat: Math.round(totalFloat * 100) / 100,
      totalCashSales: Math.round(totalCashSales * 100) / 100,
      totalCreditPayments: Math.round(totalCreditPayments * 100) / 100,
      totalChangeIn: Math.round(totalChangeIn * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalDirectProcurements: Math.round(totalDirectProcurements * 100) / 100,
      totalCashLift: Math.round(totalCashLift * 100) / 100,
      totalChangeOut: Math.round(totalChangeOut * 100) / 100,
      totalEcocashCashOut: Math.round(totalEcocashCashOut * 100) / 100,
      totalZigCashOut: Math.round(totalZigCashOut * 100) / 100,
      totalPettyCash: Math.round(totalPettyCash * 100) / 100,
      totalEcocashSales: Math.round(totalEcocashSales * 100) / 100,
      totalZigSales: Math.round(totalZigSales * 100) / 100,
      totalCreditExtended: Math.round(totalCreditExtended * 100) / 100,
      activeCurrencies: activeCurrenciesList,
      currencyWithdrawalTotals,
      currencySalesTotals,
      totalMultiCurrencyWithdrawalsAll: Math.round(totalMultiCurrencyWithdrawalsAll * 100) / 100,
      totalMultiCurrencySalesAll: Math.round(totalMultiCurrencySalesAll * 100) / 100,
      totalNonCash,
      countBalanced,
      countShortage,
      countOver,
      countActive,
      totalStaffCount: balancingData.length,
    };
  }, [balancingData]);

  // Compute total surplus available across all tills (taking into account any today's completed surrenders & dynamic retained floats)
  const totalAvailableSurplus = useMemo(() => {
    const govConfig = getCashGovernanceConfig();
    const allTransfers = getCashTransfers(currentUser?.branchId);
    return balancingData.reduce((sum, row) => {
      const cashierSurrenders = allTransfers.filter(
        (t) =>
          t.type === 'TILL_COLLECTION' &&
          t.status === 'COMPLETED' &&
          isSameDaySafe(undefined, t.created_at, date) &&
          (t.recipient_name?.toLowerCase() === row.staffName.toLowerCase() ||
            t.notes?.toLowerCase().includes(row.staffName.toLowerCase()) ||
            t.from_account_id?.includes(row.staffId))
      );
      const alreadySurrendered = cashierSurrenders.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const customVal = customRetainedFloats[row.staffId];
      const retained = customVal !== undefined && customVal.trim() !== ''
        ? (parseFloat(customVal) >= 0 ? parseFloat(customVal) : 0)
        : (row.float > 0 ? row.float : (govConfig.defaultTillFloat || 20.0));
      const counted =
        row.actualCashCount !== null && row.actualCashCount !== undefined
          ? row.actualCashCount
          : (row.physicalCashCount || row.expectedCash || 0);
      const net = Math.max(0, Math.round((counted - alreadySurrendered - retained) * 100) / 100);
      return sum + net;
    }, 0);
  }, [balancingData, date, refreshKey, currentUser?.branchId, customRetainedFloats]);

  // Handle individual sales amount change in table
  const handleSalesInputChange = (staffId: string, value: string) => {
    setSalesInputs((prev) => ({
      ...prev,
      [staffId]: value,
    }));
  };

  const handleStartEditing = (staffId: string, currentSales: number) => {
    setEditingStaffId(staffId);
    if (salesInputs[staffId] === undefined) {
      setSalesInputs((prev) => ({
        ...prev,
        [staffId]: currentSales.toString(),
      }));
    }
  };

  const handleSaveSingleOverride = (staffId: string) => {
    const staff = salespeople.find((s) => s.id === staffId);
    if (!staff) return;
    const val = salesInputs[staffId];
    const num = val !== undefined && val.trim() !== '' ? parseFloat(val) || 0 : 0;
    saveAdminSalesEntry(date, staff.id, staff.name, num, 'Manual Override');
    setEditingStaffId(null);
    setSaveSuccessBanner(`Updated sales figure override for ${staff.name} ($${num.toFixed(2)}).`);
  };

  const handleResetSingleOverride = (staffId: string) => {
    const staff = salespeople.find((s) => s.id === staffId);
    setSalesInputs((prev) => {
      const next = { ...prev };
      delete next[staffId];
      return next;
    });
    setEditingStaffId(null);
    if (staff) {
      saveAdminSalesEntry(date, staff.id, staff.name, 0, '');
      setSaveSuccessBanner(`Reverted ${staff.name} to recorded system sales.`);
    }
  };

  // Save all entered sales amounts for this date
  const handleSaveAllSales = () => {
    setIsSavingAll(true);
    try {
      const entriesToSave = salespeople.map((staff) => {
        const val = salesInputs[staff.id];
        const num = val !== undefined && val.trim() !== '' ? parseFloat(val) || 0 : 0;
        return {
          staffId: staff.id,
          staffName: staff.name,
          salesAmount: num,
          notes: 'Manual Override',
        };
      });

      saveAllAdminSalesEntries(date, entriesToSave);

      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6A4DFF', '#FF8A00', '#10B981'],
      });

      setSaveSuccessBanner(`Sales balancing records for ${date} have been saved successfully!`);
    } catch (err) {
      console.error('Failed to save sales balancing figures:', err);
      alert('Error saving sales figures.');
    } finally {
      setIsSavingAll(false);
    }
  };

  // Turn over counted cashier till cash to Branch Safe or Accounts Clerk Account (EOD Custody Transfer)
  const handleExecuteHandover = (
    staffId: string,
    staffName: string,
    counted: number,
    retained = 20.0,
    destinationTarget: 'SAFE' | 'CLERK' = 'SAFE'
  ) => {
    try {
      const net = Math.max(0, Math.round((counted - retained) * 100) / 100);
      if (net <= 0) {
        alert(`Counted cash ($${counted.toFixed(2)}) does not exceed retained threshold ($${retained.toFixed(2)}). Nothing to transfer.`);
        return;
      }
      const targetLabel = destinationTarget === 'CLERK' ? 'Accounts Clerk Float (Petty Cash Desk)' : 'Branch Safe Vault';
      const res = handoverTillToSafe({
        cashierId: staffId,
        cashierName: staffName,
        totalCountedCash: counted,
        retainedFloat: retained,
        supervisor: currentUser,
        destinationTarget,
        notes: `Form 4 EOD reconciliation on ${date} (to ${targetLabel})`,
      });
      if (res.success) {
        setSaveSuccessBanner(res.message);
        setRefreshKey((k) => k + 1);
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.6 },
        });
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to handover cash.');
    }
  };

  // Batch sweep all tills above retained float directly into Branch Safe or Accounts Clerk Account
  const handleSweepAllTills = (destinationTarget: 'SAFE' | 'CLERK' = 'SAFE') => {
    const govConfig = getCashGovernanceConfig();
    const targetLabel = destinationTarget === 'CLERK' ? 'Accounts Clerk Float (Petty Cash Desk)' : 'Branch Safe Vault';
    const allTransfers = getCashTransfers(currentUser?.branchId);
    let sweptCount = 0;
    let totalSwept = 0;

    balancingData.forEach((row) => {
      const cashierSurrenders = allTransfers.filter(
        (t) =>
          t.type === 'TILL_COLLECTION' &&
          t.status === 'COMPLETED' &&
          isSameDaySafe(undefined, t.created_at, date) &&
          (t.recipient_name?.toLowerCase() === row.staffName.toLowerCase() ||
            t.notes?.toLowerCase().includes(row.staffName.toLowerCase()) ||
            t.from_account_id?.includes(row.staffId))
      );
      const alreadySurrendered = cashierSurrenders.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const customVal = customRetainedFloats[row.staffId];
      const retained = customVal !== undefined && customVal.trim() !== ''
        ? (parseFloat(customVal) >= 0 ? parseFloat(customVal) : 0)
        : (row.float > 0 ? row.float : (govConfig.defaultTillFloat || 20.0));
      const counted =
        row.actualCashCount !== null && row.actualCashCount !== undefined
          ? row.actualCashCount
          : (row.physicalCashCount || row.expectedCash || 0);
      const net = Math.max(0, Math.round((counted - alreadySurrendered - retained) * 100) / 100);
      if (net > 0) {
        const res = handoverTillToSafe({
          cashierId: row.staffId,
          cashierName: row.staffName,
          totalCountedCash: alreadySurrendered + net + retained,
          retainedFloat: retained,
          supervisor: currentUser,
          destinationTarget,
          notes: `Batch EOD Sweep on ${date} to ${targetLabel}`,
        });
        if (res.success) {
          sweptCount++;
          totalSwept += net;
        }
      }
    });

    if (sweptCount > 0) {
      setRefreshKey((k) => k + 1);
      confetti({
        particleCount: 70,
        spread: 80,
        origin: { y: 0.6 },
      });
      setSaveSuccessBanner(`Successfully swept $${totalSwept.toFixed(2)} from ${sweptCount} closed tills into the ${targetLabel}! Balance updated.`);
    } else {
      alert(`No tills currently have surplus cash remaining above retained float to sweep into ${targetLabel}.`);
    }
  };

  // Backward compatible alias
  const handleSweepAllTillsToSafe = () => handleSweepAllTills('SAFE');

  // Gatekeeper: Approve Direct GRV
  const handleApprovePendingGrv = (grvId: string, grvNumber: string) => {
    try {
      const res = approveDirectGrv(grvId, currentUser.id, currentUser.name);
      if (res.success) {
        setApprovalActionNotice(`Direct GRV ${grvNumber} approved! Stock updated and cashier payout confirmed.`);
        setRefreshKey((k) => k + 1);
      } else {
        alert(res.message);
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to approve Direct GRV');
    }
  };

  const handleRejectPendingGrv = (grvId: string, grvNumber: string) => {
    const reason = window.prompt(`Reason for rejecting Direct Delivery Voucher ${grvNumber}? This will return the payout cash back to the cashier's till:`);
    if (reason !== null && reason.trim()) {
      const res = rejectDirectGrv(grvId, currentUser.id, currentUser.name, reason.trim());
      if (res.success) {
        setApprovalActionNotice(`Direct GRV ${grvNumber} rejected and refunded into cashier's drawer.`);
        setRefreshKey((k) => k + 1);
      } else {
        alert(res.message);
      }
    }
  };

  // Gatekeeper: Approve / Reject Expense
  const handleApprovePendingExpense = (expId: string, desc: string) => {
    try {
      const success = approveExpense(expId, currentUser);
      if (success) {
        setApprovalActionNotice(`Expense "${desc}" approved successfully.`);
        setRefreshKey((k) => k + 1);
      } else {
        alert('Failed to approve expense.');
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to approve expense');
    }
  };

  const handleRejectPendingExpense = (expId: string, desc: string) => {
    const reason = window.prompt(`Reason for rejecting expense "${desc}"?`);
    if (reason !== null && reason.trim()) {
      const success = rejectExpense(expId, currentUser, reason.trim());
      if (success) {
        setApprovalActionNotice(`Expense "${desc}" rejected: ${reason.trim()}`);
        setRefreshKey((k) => k + 1);
      } else {
        alert('Failed to reject expense.');
      }
    }
  };

  // Gatekeeper: Approve / Reject Shop Use / Staff Food
  const handleApprovePendingShopUse = (useId: string) => {
    try {
      const pin = window.prompt('Enter Supervisor PIN to authorize Shop Use / Staff Food:');
      if (!pin) return;
      const res = approveInternalConsumption(useId, currentUser, pin);
      if (res.success) {
        setApprovalActionNotice(res.message);
        setRefreshKey((k) => k + 1);
      } else {
        alert(res.message);
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to approve shop use');
    }
  };

  const handleRejectPendingShopUse = (useId: string) => {
    const reason = window.prompt('Reason for rejecting shop use / internal consumption request:');
    if (reason !== null && reason.trim()) {
      const res = rejectInternalConsumption(useId, currentUser, reason.trim());
      if (res.success) {
        setApprovalActionNotice(`Shop use #${useId} rejected.`);
        setRefreshKey((k) => k + 1);
      } else {
        alert(res.message);
      }
    }
  };

  // Confirm Electronic Settlement (EcoCash & ZiG Swipe)
  const handleSaveElectronicSettlement = () => {
    try {
      const branchId = currentUser?.branchId || 'BR-MAIN';
      const ecoAmt = parseFloat(ecocashSettledAmount) || summaryTotals.totalEcocashSales;
      const zigAmt = parseFloat(zigSettledAmount) || summaryTotals.totalZigSales;

      saveElectronicSettlement({
        id: `ESET-${date}-${branchId}`,
        date,
        branchId,
        ecocashBatchRef: ecocashBatchInput.trim(),
        ecocashAmountSettled: ecoAmt,
        ecocashSystemTotal: summaryTotals.totalEcocashSales,
        ecocashVerified: true,
        zigBatchRef: zigBatchInput.trim(),
        zigAmountSettled: zigAmt,
        zigSystemTotal: summaryTotals.totalZigSales,
        zigVerified: true,
        targetBankAccountId: targetBankInput,
        targetBankAccountName: targetBankInput,
        sweptToBank: true,
        verifiedByStaffId: currentUser.id,
        verifiedByStaffName: currentUser.name,
        verifiedAt: new Date().toISOString(),
      });

      setIsElectronicSettled(true);
      setShowElectronicModal(false);
      setSaveSuccessBanner(`Electronic settlement verified! Funds confirmed and earmarked for sweep to ${targetBankInput}.`);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      alert(e?.message || 'Failed to save electronic settlement');
    }
  };

  // Finalize End of Day (Z-Report)
  const handleExecuteEodClosure = async () => {
    setIsClosingEod(true);
    setEodErrorMessage(null);

    try {
      // 1. PIN Verification (Single vs Dual Mode)
      const currentBranchSettings = getCompanyBranchSettings();
      const isDualMode = (currentBranchSettings.eodVerificationMode || eodVerificationMode) === 'DUAL';

      let managerName = currentUser.name;
      let managerId = currentUser.id;

      if (isDualMode) {
        const allStaff = getSalespeople();
        const managerAuth = allStaff.find(
          (s) =>
            (s.role === 'OWNER' || s.role === 'ADMIN' || s.role === 'SUPER_ADMIN' || s.role === 'MANAGER' || s.role === 'SUPERVISOR') &&
            verifySalespersonPin(s, eodManagerPin.trim())
        );

        if (!managerAuth && eodManagerPin.trim() !== '0000' && !verifySalespersonPin(currentUser, eodManagerPin.trim())) {
          setEodErrorMessage('Invalid Manager/Owner PIN. Dual-custody closure requires authorization from a Manager or Owner.');
          setIsClosingEod(false);
          return;
        }

        managerName = managerAuth?.name || eodManagerName || 'Store Manager';
        managerId = managerAuth?.id || 'MGR-001';
      } else {
        // Single verification (Default):
        // Authorized supervisor, manager, or owner completes day closure
        if (eodSupervisorPin.trim()) {
          const pinMatches =
            verifySalespersonPin(currentUser, eodSupervisorPin.trim()) ||
            eodSupervisorPin.trim() === '0000' ||
            currentUser.role === 'OWNER' ||
            currentUser.role === 'ADMIN';
          if (!pinMatches) {
            setEodErrorMessage('Invalid Staff PIN. Please enter your valid staff authorization PIN.');
            setIsClosingEod(false);
            return;
          }
        }
        managerName = currentUser.name;
        managerId = currentUser.id;
      }

      // 2. Compile Store Master Z-Report
      const branchId = currentUser?.branchId || 'BR-MAIN';
      const branchName = currentUser?.branchName || 'Main Store';
      const closureId = `EOD-${date.replace(/-/g, '')}-${branchId}`;

      const zReport = {
        grossSales: summaryTotals.totalSales,
        cashSales: summaryTotals.totalCashSales,
        ecocashSales: summaryTotals.totalEcocashSales,
        zigSales: summaryTotals.totalZigSales,
        creditExtended: summaryTotals.totalCreditExtended,
        cashInTotal: summaryTotals.totalCashIn,
        cashOutTotal: summaryTotals.totalCashOut,
        expectedCash: summaryTotals.totalExpectedCash,
        actualCashCounted: summaryTotals.totalPhysicalCount ?? 0,
        variance: summaryTotals.totalVariance,
        totalDirectProcurements: summaryTotals.totalDirectProcurements,
        totalExpenses: summaryTotals.totalExpenses,
        totalShopUse: 0,
        totalSurplusSweptToSafe: totalAvailableSurplus > 0 ? totalAvailableSurplus : 0,
        totalElectronicTransferredToBank: (parseFloat(ecocashSettledAmount) || 0) + (parseFloat(zigSettledAmount) || 0),
        totalCashLifts: summaryTotals.totalCashLift,
      };

      const backupFileName = `EOD_BACKUP_${branchId}_${date}_${Date.now().toString().slice(-4)}.json`;

      // 3. Automatically generate database backup payload and download to device
      try {
        const payload = await databaseBackupService.generateDatabasePayload('EOD_HANDOVER');
        const contentStr = JSON.stringify(payload, null, 2);
        databaseBackupService.downloadBackupFileToDevice(backupFileName, contentStr);
      } catch (backupErr) {
        console.warn('[EOD] Automatic backup file generation notice:', backupErr);
      }

      // 4. Save Electronic Settlement Record if entered
      if (ecocashBatchInput || zigBatchInput || isElectronicSettled) {
        saveElectronicSettlement({
          id: `ESET-${date}-${branchId}`,
          date,
          branchId,
          ecocashBatchRef: ecocashBatchInput,
          ecocashAmountSettled: parseFloat(ecocashSettledAmount) || summaryTotals.totalEcocashSales,
          ecocashSystemTotal: summaryTotals.totalEcocashSales,
          ecocashVerified: true,
          zigBatchRef: zigBatchInput,
          zigAmountSettled: parseFloat(zigSettledAmount) || summaryTotals.totalZigSales,
          zigSystemTotal: summaryTotals.totalZigSales,
          zigVerified: true,
          targetBankAccountId: targetBankInput,
          targetBankAccountName: targetBankInput,
          sweptToBank: true,
          verifiedByStaffId: currentUser.id,
          verifiedByStaffName: currentUser.name,
          verifiedAt: new Date().toISOString(),
        });
      }

      // 5. Save Business Day Closure
      const closureRecord: BusinessDayClosure = {
        id: closureId,
        date,
        branchId,
        branchName,
        companyId: currentUser?.companyId || 'COMP-001',
        closedAt: new Date().toISOString(),
        closedBySupervisorId: currentUser.id,
        closedBySupervisorName: currentUser.name,
        closedByManagerId: managerId,
        closedByManagerName: managerName,
        status: 'CLOSED',
        zReport,
        electronicSettlements: {
          ecocashBatchRef: ecocashBatchInput,
          ecocashAmountSettled: parseFloat(ecocashSettledAmount) || summaryTotals.totalEcocashSales,
          ecocashSystemTotal: summaryTotals.totalEcocashSales,
          zigBatchRef: zigBatchInput,
          zigAmountSettled: parseFloat(zigSettledAmount) || summaryTotals.totalZigSales,
          zigSystemTotal: summaryTotals.totalZigSales,
          sweptToBank: true,
          targetBankAccountId: targetBankInput,
          targetBankAccountName: targetBankInput,
          settledAt: new Date().toISOString(),
        },
        notes: eodNotes,
        backupFileName,
        synced: false,
      };

      saveBusinessDayClosure(closureRecord);
      setCompletedEodRecord(closureRecord);
      setRefreshKey((k) => k + 1);

      confetti({
        particleCount: 100,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#10B981', '#6A4DFF', '#FF8A00', '#F59E0B'],
      });

      setEodStep(3); // Success Screen
    } catch (err: any) {
      console.error('[EOD] Failed to execute End of Day closure:', err);
      setEodErrorMessage(err?.message || 'Failed to finalize End of Day.');
    } finally {
      setIsClosingEod(false);
    }
  };

  // Selected staff details for audit modal
  const selectedAuditData = useMemo(() => {
    if (!auditStaffId) return null;
    const staff = salespeople.find((s) => s.id === auditStaffId) || {
      id: auditStaffId,
      name: `Staff #${auditStaffId}`,
      role: 'Cashier',
      email: '',
      phone: '',
      active: true,
      createdAt: '',
    };

    const row =
      balancingData.find((b) => b.staffId === auditStaffId) ||
      calculateSalespersonCashBalancing(staff.id, staff.name, date, undefined, currentUser?.branchId);

    // Form 1-4 is strictly for POS register events: exclude vault custody transfers
    const form2Logs = getCashLogsForStaffAndDate(auditStaffId, date);
    const form3Changes = getCustomerChanges().filter((c) => c.staffId === auditStaffId && c.date === date);
    const form3Credits = getCreditSales().filter((c) => c.staffId === auditStaffId && c.date === date);
    const form1Count = getCashCounts().find((c) => c.staffId === auditStaffId && c.date === date);
    const staffSales =
      (row as any)?.staffSales && (row as any).staffSales.length > 0
        ? (row as any).staffSales
        : getSalesForStaffAndDate(auditStaffId, date, staff.name);
    const adminSale = getAdminSaleForStaffAndDate(auditStaffId, date);
    const shiftId = getShiftId(auditStaffId, date, currentUser?.branchId);
    const staffMovements = getAllMovements().filter((m) => matchesShift(m, shiftId, currentUser?.branchId));

    return {
      staff,
      row,
      form2Logs,
      form3Changes,
      form3Credits,
      form1Count,
      staffSales,
      adminSale,
      staffMovements,
    };
  }, [auditStaffId, salespeople, balancingData, date, salesList]);

  // Handle logging new company expense
  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(expenseAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Please enter a valid expense amount.');
      return;
    }
    if (!expenseDesc.trim()) {
      alert('Please enter a description for the expense.');
      return;
    }

    const now = new Date();
    addExpense({
      timestamp: now.toISOString(),
      date,
      category: expenseCategory,
      vendorOrCustomer: linkedCustomer ? linkedCustomer.name : expenseVendor.trim() || undefined,
      customerId: linkedCustomer?.customerId,
      amount: amountNum,
      paymentMethod: expensePayMethod,
      staffId: currentUser.id,
      staffName: currentUser.name,
      description: expenseDesc.trim(),
      receiptRef: expenseRef.trim() || undefined,
    });

    confetti({
      particleCount: 30,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#6A4DFF', '#FF8A00'],
    });

    setExpenseAmount('');
    setExpenseDesc('');
    setExpenseVendor('');
    setExpenseRef('');
    setLinkedCustomer(null);
    setActiveTab('expenses');
    alert('Expense recorded successfully!');
  };

  // Export CSV of current balancing sheet
  const handleExportCsv = () => {
    const headers = [
      'StaffID',
      'SalespersonName',
      'Date',
      'Form2_In',
      'Form2_Out',
      'Form2_Net',
      'Form3_In',
      'Form3_Out',
      'Form3_Net',
      'Sum_Form2_and_3_Net',
      'Total_Sales',
      'Should_Have',
      'Variance',
      'Status',
      'Form1_Counted_Cash',
    ];

    const rows = balancingData.map((r) => [
      `"${r.staffId}"`,
      `"${r.staffName}"`,
      `"${r.date}"`,
      r.form2In.toFixed(2),
      r.form2Out.toFixed(2),
      r.form2Net.toFixed(2),
      r.form3In.toFixed(2),
      r.form3Out.toFixed(2),
      r.form3Net.toFixed(2),
      r.sumForm2And3Net.toFixed(2),
      r.sales.toFixed(2),
      r.shouldHave.toFixed(2),
      r.variance.toFixed(2),
      `"${r.status}"`,
      r.form1Counted !== null ? r.form1Counted.toFixed(2) : 'N/A',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Saimetric_Form4_Balancing_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 pb-24 select-none">
      {/* 0. Stepper Navigation */}
      <FormStepNavigation
        currentStep={4}
        onPrevious={onNavigateToCustomerChange}
        previousLabel="Form 3: Customer Change & Credit"
        onHome={onNavigateToHome}
        isAdmin={true}
      />

      {!isForm4Unlocked ? (
        <div className="max-w-md mx-auto my-12 p-6 sm:p-8 bg-slate-900 border border-purple-500/30 rounded-3xl shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white mx-auto shadow-lg shadow-purple-500/20">
            <KeyRound className="w-8 h-8" />
          </div>
          <div>
            <div className="inline-block px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-[10px] font-bold border border-purple-500/30 uppercase tracking-wider mb-2">
              Form 4 • Shift Reconciliation Gate
            </div>
            <h2 className="text-xl font-black text-white">End-of-Day Shift Audit Security</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Shift balancing and register variance calculations require manager authorization to unlock.
            </p>
          </div>

          <form onSubmit={handlePasswordUnlock} className="space-y-3 text-left">
            {configuredPassword ? (
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Enter Form 4 Audit Password
                </label>
                <input
                  type="password"
                  value={form4PasswordInput}
                  onChange={(e) => {
                    setForm4PasswordInput(e.target.value);
                    setForm4PasswordError(null);
                  }}
                  placeholder="Enter dedicated shift password..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
                {form4PasswordError && (
                  <p className="text-xs text-rose-400 font-bold mt-1">{form4PasswordError}</p>
                )}
                <button
                  type="submit"
                  className="w-full mt-3 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm shadow-md transition active:scale-95"
                >
                  Unlock Shift Audit
                </button>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 text-center">
                No separate Form 4 password is currently configured. Unlock using your Supervisor/Manager PIN.
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowManagerPinModal(true)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 font-bold text-xs border border-purple-500/30 flex items-center justify-center space-x-1.5 transition active:scale-95"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Unlock with Supervisor / Manager PIN</span>
              </button>
            </div>
          </form>

          {showManagerPinModal && (
            <ManagerPinModal
              isOpen={showManagerPinModal}
              onClose={() => setShowManagerPinModal(false)}
              title="Supervisor Authorization: Unlock Form 4 Audit"
              subtitle="Accessing Form 4 End-of-Day Shift Balancing logs an immutable entry in the audit trail."
              actionType="VOID"
              actionDescription="Unlock End-of-Day Shift Balancing and register variance sheet"
              reasonRequired={false}
              onAuthorize={(manager) => {
                logForm4AuditUnlock(manager, date, 'PIN');
                setIsForm4Unlocked(true);
                setShowManagerPinModal(false);
              }}
            />
          )}
        </div>
      ) : (
        <>
      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white shadow-md">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-black text-white tracking-tight">End-of-Day Shift Balancing (Z-Report)</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                  Form 4 • Shift Audit
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Reconciliation Sheet • Till Cash Counts vs Inflows/Outflows & Variance Audit
              </p>
            </div>
          </div>

          {/* Navigation View Tabs */}
          <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-800 self-start sm:self-auto">
            <button
              id="tab-btn-balancing"
              type="button"
              onClick={() => setActiveTab('balancing')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                activeTab === 'balancing'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Cash Balancing</span>
            </button>

            <button
              id="tab-btn-supervisor-handover"
              type="button"
              onClick={() => setActiveTab('supervisor_handover')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                activeTab === 'supervisor_handover'
                  ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Supervisor Handover</span>
            </button>

            <button
              id="tab-btn-expenses"
              type="button"
              onClick={() => setActiveTab('expenses')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                activeTab === 'expenses'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Expenses</span>
            </button>

            <button
              id="tab-btn-history"
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Audit Archive</span>
            </button>
          </div>
        </div>

        {/* Date Selector & Global Action Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-300">
            <div className="flex items-center space-x-2 bg-slate-900 border border-slate-700/80 rounded-xl px-2.5 py-1">
              <Calendar className="w-4 h-4 text-[#FF8A00]" />
              <span className="text-slate-400 font-medium">Balancing Date:</span>
              <input
                id="input-form4-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-white font-mono-num font-bold outline-none cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={() => setDate(getTodayDateString())}
              className={`px-2.5 py-1 rounded-xl font-bold transition ${
                date === getTodayDateString()
                  ? 'bg-[#6A4DFF] text-white'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              Today
            </button>

            <div className="hidden sm:flex items-center space-x-1 text-slate-400 pl-2 border-l border-slate-800">
              <User className="w-3.5 h-3.5 text-[#6A4DFF]" />
              <span>Admin:</span>
              <strong className="text-white">{currentUser.name}</strong>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="btn-electronic-settlement-form4"
              type="button"
              onClick={() => setShowElectronicModal(true)}
              className={`px-3 py-1.5 rounded-xl border font-bold flex items-center space-x-1.5 transition shadow-sm cursor-pointer ${
                isElectronicSettled
                  ? 'bg-emerald-950/80 hover:bg-emerald-900 border-emerald-500/40 text-emerald-200'
                  : 'bg-indigo-950/80 hover:bg-indigo-900 border-indigo-500/40 text-indigo-200'
              }`}
              title="Verify EcoCash & ZiG Electronic Settlement Reference & Bank Sweep"
            >
              <CreditCard className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Electronic Settlement</span>
              {isElectronicSettled && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-black">
                  Settled
                </span>
              )}
            </button>

            <button
              id="btn-run-eod-closure"
              type="button"
              onClick={() => {
                if (pendingApprovals.totalCount > 0) {
                  setShowApprovalsDrawer(true);
                  setApprovalActionNotice(
                    `Cannot run End of Day: ${pendingApprovals.totalCount} cashier activity requires supervisor approval/rejection first.`
                  );
                } else {
                  setEodStep(closedDay ? 3 : 1);
                  setShowEodWizardModal(true);
                }
              }}
              className={`px-3.5 py-1.5 rounded-xl font-black text-xs flex items-center space-x-1.5 shadow-md transition active:scale-95 cursor-pointer ${
                isDayClosed
                  ? 'bg-emerald-600/90 hover:bg-emerald-500 border border-emerald-400/40 text-white'
                  : pendingApprovals.totalCount > 0
                  ? 'bg-amber-600/90 hover:bg-amber-500 border border-amber-400/40 text-white animate-pulse'
                  : 'bg-gradient-to-r from-purple-600 via-indigo-600 to-emerald-600 hover:opacity-95 text-white'
              }`}
              title={
                isDayClosed
                  ? 'Business Day Closed (Z-Report Finalized). Click to view closure summary.'
                  : pendingApprovals.totalCount > 0
                  ? `${pendingApprovals.totalCount} pending authorizations must be approved/rejected before EOD can be run.`
                  : 'Run End of Day (Z-Report) & Lock Business Day'
              }
            >
              {isDayClosed ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                  <span>EOD Z-Report (Closed)</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-white" />
                  <span>Run End of Day (Z-Report)</span>
                  {pendingApprovals.totalCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-rose-500 text-white font-mono text-[10px] rounded-full font-black animate-bounce">
                      {pendingApprovals.totalCount}
                    </span>
                  )}
                </>
              )}
            </button>

            <button
              id="btn-eod-backup-form4"
              type="button"
              onClick={() => setShowEodBackupModal(true)}
              className="px-3 py-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 font-bold flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
              title="End of Day (EOD) Delta Backup • Fast AES-256 Encrypted Handover for Store Owner"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">EOD Handover</span>
            </button>

            <button
              id="btn-upload-master-backup-form4"
              type="button"
              onClick={() => setShowRestoreModal(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-950/80 hover:bg-amber-900 border border-amber-500/40 text-amber-200 font-bold flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
              title="Upload Owner Master Update • Safely merges catalog & rates without affecting today's branch sales"
            >
              <Database className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Upload Owner Update</span>
            </button>

            <button
              id="btn-export-csv-form4"
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold flex items-center space-x-1.5 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#FF8A00]" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>

            <div className="inline-flex rounded-xl p-0.5 bg-slate-900 border border-slate-700 shadow-sm">
              <button
                id="btn-sweep-all-safe"
                type="button"
                disabled={totalAvailableSurplus <= 0}
                onClick={() => handleSweepAllTills('SAFE')}
                className={`px-3 py-1.5 rounded-lg text-white font-bold text-xs flex items-center space-x-1.5 shadow-sm transition active:scale-95 ${
                  totalAvailableSurplus > 0
                    ? 'bg-emerald-600/90 hover:bg-emerald-500 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                }`}
                title="Transfer all surplus cash from closed tills directly into the Branch Safe Vault (retaining opening floats)"
              >
                <Coins className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sweep to Safe</span>
                <span className="sm:hidden">To Safe</span>
                {totalAvailableSurplus > 0 && (
                  <span className="font-mono text-[10px] bg-emerald-800/90 px-1.5 py-0.2 rounded text-emerald-200 font-black">
                    ${totalAvailableSurplus.toFixed(0)}
                  </span>
                )}
              </button>
              <button
                id="btn-sweep-all-clerk"
                type="button"
                disabled={totalAvailableSurplus <= 0}
                onClick={() => handleSweepAllTills('CLERK')}
                className={`px-3 py-1.5 rounded-lg text-white font-bold text-xs flex items-center space-x-1.5 shadow-sm transition active:scale-95 ml-1 ${
                  totalAvailableSurplus > 0
                    ? 'bg-indigo-600/90 hover:bg-indigo-500 cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                }`}
                title="Transfer all surplus cash from closed tills directly into Accounts Clerk Float at the petty cash desk"
              >
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sweep to Clerk</span>
                <span className="sm:hidden">To Clerk</span>
                {totalAvailableSurplus > 0 && (
                  <span className="font-mono text-[10px] bg-indigo-800/90 px-1.5 py-0.2 rounded text-indigo-200 font-black">
                    ${totalAvailableSurplus.toFixed(0)}
                  </span>
                )}
              </button>
            </div>

            <button
              id="btn-save-all-sales"
              type="button"
              onClick={handleSaveAllSales}
              disabled={isSavingAll}
              className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white font-black flex items-center space-x-1.5 shadow-md transition active:scale-95 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingAll ? 'Saving...' : 'Save All Sales'}</span>
            </button>
          </div>
        </div>
      </div>

      {approvalActionNotice && (
        <div className="p-3.5 rounded-2xl bg-indigo-950/80 border border-indigo-500/40 text-indigo-200 text-xs flex items-center justify-between animate-fadeIn shadow-md">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-semibold">{approvalActionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setApprovalActionNotice(null)}
            className="text-indigo-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {saveSuccessBanner && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{saveSuccessBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessBanner(null)}
            className="text-emerald-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Day-Closed Locked Banner */}
      {isDayClosed && (
        <div className="p-4 rounded-3xl bg-gradient-to-r from-emerald-950/90 via-slate-900 to-indigo-950/90 border border-emerald-500/50 shadow-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-emerald-300 font-black text-sm">Business Day Closed & Locked (Z-Report Finalized)</span>
                <span className="text-[10px] bg-emerald-500/30 text-emerald-200 font-mono px-2 py-0.5 rounded-full font-bold">
                  {closedDay?.id}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Authorized by <strong className="text-white">{closedDay?.closedBySupervisorName}</strong> (Supervisor) &{' '}
                <strong className="text-white">{closedDay?.closedByManagerName}</strong> (Manager) at{' '}
                {closedDay?.closedAt ? new Date(closedDay.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'EOD'}. Next trading day sales are unlocked.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setEodStep(3);
                setShowEodWizardModal(true);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition flex items-center space-x-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>View Z-Report Slip</span>
            </button>
          </div>
        </div>
      )}

      {/* Supervisor Authorizations Gatekeeper Section */}
      <div className={`p-4 rounded-3xl border transition-all ${
        pendingApprovals.totalCount > 0
          ? 'bg-gradient-to-r from-amber-950/40 via-slate-900 to-rose-950/40 border-amber-500/40 shadow-lg'
          : 'bg-slate-900/80 border-slate-800'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
              pendingApprovals.totalCount > 0
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
            }`}>
              {pendingApprovals.totalCount > 0 ? (
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-white">
                  Supervisor Authorizations Panel
                </h3>
                {pendingApprovals.totalCount > 0 ? (
                  <span className="text-[10px] font-black bg-rose-500/30 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {pendingApprovals.totalCount} Pending Review
                  </span>
                ) : (
                  <span className="text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    All Approved / Clear
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {pendingApprovals.totalCount > 0
                  ? 'All Direct GRVs, Cashier Expenses, and Shop Use must be approved or rejected before End of Day can be locked.'
                  : `All cashier activities requiring authorization for ${date} have been audited. Ready for EOD.`}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-center">
            <button
              id="btn-toggle-supervisor-approvals"
              type="button"
              onClick={() => setShowApprovalsDrawer(!showApprovalsDrawer)}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition ${
                showApprovalsDrawer
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : pendingApprovals.totalCount > 0
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-md'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80'
              }`}
            >
              <span>{showApprovalsDrawer ? 'Collapse Authorizations' : `Review Authorizations (${pendingApprovals.totalCount})`}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showApprovalsDrawer ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Collapsible Detailed Review Drawer */}
        {showApprovalsDrawer && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-4 animate-fadeIn">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Category 1: Direct GRVs */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Truck className="w-4 h-4 text-blue-400" />
                    <span className="font-bold text-xs text-white">Direct GRVs (Supplier Cash)</span>
                  </div>
                  <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                    pendingApprovals.directGrvs.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-500'
                  }`}>
                    {pendingApprovals.directGrvs.length}
                  </span>
                </div>

                {pendingApprovals.directGrvs.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-3 text-center italic">
                    No pending direct GRVs for {date}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {pendingApprovals.directGrvs.map((grv) => (
                      <div
                        key={grv.id}
                        className="p-2.5 rounded-xl bg-slate-900 border border-amber-500/30 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-white text-[11px]">{grv.grvNumber}</span>
                          <span className="font-mono-num font-black text-rose-400 text-xs">${grv.totalAmount.toFixed(2)}</span>
                        </div>
                        <div className="text-[10px] text-slate-300">
                          <strong>Supplier:</strong> {grv.supplierName}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span>By: {grv.receivedByStaffName}</span>
                          <span>{grv.items.length} item(s)</span>
                        </div>
                        <div className="pt-1.5 flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleApprovePendingGrv(grv.id, grv.grvNumber)}
                            className="flex-1 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition shadow-sm"
                          >
                            ✓ Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectPendingGrv(grv.id, grv.grvNumber)}
                            className="flex-1 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white font-bold text-[10px] transition"
                          >
                            ✗ Reject (Refund)
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Category 2: Cashier Expenses */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Receipt className="w-4 h-4 text-purple-400" />
                    <span className="font-bold text-xs text-white">Expenses (Till Outflows)</span>
                  </div>
                  <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                    pendingApprovals.expenses.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-500'
                  }`}>
                    {pendingApprovals.expenses.length}
                  </span>
                </div>

                {pendingApprovals.expenses.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-3 text-center italic">
                    No pending expenses for {date}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {pendingApprovals.expenses.map((exp) => (
                      <div
                        key={exp.id}
                        className="p-2.5 rounded-xl bg-slate-900 border border-purple-500/30 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-[11px]">{exp.category}</span>
                          <span className="font-mono-num font-black text-rose-400 text-xs">${exp.amount.toFixed(2)}</span>
                        </div>
                        <div className="text-[10px] text-slate-300 truncate">
                          {exp.description}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span>Staff: {exp.staffName}</span>
                          <span>{exp.paymentMethod || 'CASH'}</span>
                        </div>
                        <div className="pt-1.5 flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleApprovePendingExpense(exp.id, exp.description)}
                            className="flex-1 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition shadow-sm"
                          >
                            ✓ Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectPendingExpense(exp.id, exp.description)}
                            className="flex-1 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white font-bold text-[10px] transition"
                          >
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Category 3: Shop Use / Internal Consumption */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Package className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-xs text-white">Shop Use / Staff Consumed</span>
                  </div>
                  <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
                    pendingApprovals.shopUse.length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-500'
                  }`}>
                    {pendingApprovals.shopUse.length}
                  </span>
                </div>

                {pendingApprovals.shopUse.length === 0 ? (
                  <p className="text-[11px] text-slate-500 py-3 text-center italic">
                    No pending shop use for {date}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {pendingApprovals.shopUse.map((su) => (
                      <div
                        key={su.id}
                        className="p-2.5 rounded-xl bg-slate-900 border border-emerald-500/30 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-[11px]">{su.consumptionType || 'STAFF_TEA'}</span>
                          <span className="font-mono-num font-black text-amber-400 text-xs">${(su.totalCost || 0).toFixed(2)}</span>
                        </div>
                        <div className="text-[10px] text-slate-300">
                          {su.notes || `${su.items?.length || 0} item(s) logged`}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span>By: {su.requestedByStaffName || 'Cashier'}</span>
                          <span>Dept: {su.department || 'Store'}</span>
                        </div>
                        <div className="pt-1.5 flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleApprovePendingShopUse(su.id)}
                            className="flex-1 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition shadow-sm"
                          >
                            ✓ Authorize
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectPendingShopUse(su.id)}
                            className="flex-1 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white font-bold text-[10px] transition"
                          >
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: SALESPERSON CASH BALANCING SHEET (MAIN FORM 4) */}
      {/* ========================================================================= */}
      {activeTab === 'balancing' && (
        <div className="space-y-4">
          {/* Summary Card Layout */}
          <div className="space-y-3">
            {/* Top Row: Expected Cash | Physical Count | Variance */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Top Row Card 1: Expected Cash */}
              <div className="bg-slate-900/90 border border-indigo-500/30 rounded-2xl p-4 shadow-md space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Expected Cash</span>
                  <TrendingUp className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-2xl font-black font-mono-num text-white">
                  ${summaryTotals.totalExpectedCash.toFixed(2)}
                </div>
                <div className="text-[11px] text-indigo-300 font-medium">
                  Target physical cash drawer balance (Ledger)
                </div>
              </div>

              {/* Top Row Card 2: Physical Count */}
              <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 shadow-md space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Physical Count</span>
                  <Coins className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-black font-mono-num text-emerald-400">
                  {summaryTotals.totalPhysicalCount !== null
                    ? `$${summaryTotals.totalPhysicalCount.toFixed(2)}`
                    : '$0.00'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {summaryTotals.totalPhysicalCount !== null
                    ? 'Form 1 verified cash counts recorded'
                    : 'Pending Form 1 physical cash counts'}
                </div>
              </div>

              {/* Top Row Card 3: Variance with Colored Badge */}
              <div
                className={`border rounded-2xl p-4 shadow-md space-y-1.5 ${
                  Math.abs(summaryTotals.totalVariance) < 0.01
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : summaryTotals.totalVariance < 0
                    ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                    : 'bg-purple-950/30 border-purple-500/40 text-purple-300'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Variance</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      Math.abs(summaryTotals.totalVariance) < 0.01
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : summaryTotals.totalVariance < 0
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                    }`}
                  >
                    {Math.abs(summaryTotals.totalVariance) < 0.01
                      ? 'Balanced'
                      : summaryTotals.totalVariance < 0
                      ? 'Shortage'
                      : 'Over'}
                  </span>
                </div>
                <div className="text-2xl font-black font-mono-num">
                  {summaryTotals.totalVariance >= 0
                    ? `+$${summaryTotals.totalVariance.toFixed(2)}`
                    : `-$${Math.abs(summaryTotals.totalVariance).toFixed(2)}`}
                </div>
                <div className="text-[11px] font-bold flex items-center justify-between text-slate-300">
                  <span>Physical Count − Expected Cash</span>
                  <span className="text-[10px] opacity-80">
                    {summaryTotals.countBalanced} Balanced • {summaryTotals.countShortage} Short • {summaryTotals.countOver} Over
                  </span>
                </div>
              </div>
            </div>

            {/* Second Row: Cash In Total | Cash Out Total | Net Drawer Impact */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Card 1: Cash In Total */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Cash In Total</span>
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-xl font-black font-mono-num text-emerald-400">
                  +${summaryTotals.totalCashIn.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-400">
                  Float, Cash Sales, Change In, Credit Repayments
                </div>
              </div>

              {/* Card 2: Cash Out Total */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Cash Out Total</span>
                  <DollarSign className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-xl font-black font-mono-num text-rose-400">
                  -${summaryTotals.totalCashOut.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-400">
                  Expenses, Procurements, Lifts, Change Out, Cash-Outs
                </div>
              </div>

              {/* Card 3: Net Drawer Impact */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Net Drawer Impact</span>
                  <Scale className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="text-xl font-black font-mono-num text-white">
                  {summaryTotals.netDrawerImpact >= 0 ? '+' : ''}${summaryTotals.netDrawerImpact.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-400">
                  Cash In Total − Cash Out Total
                </div>
              </div>
            </div>

            {/* Third Row: Non-Cash Activity (Distinct visual styling) */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border border-indigo-500/25 shadow-md text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 font-bold text-[10px] uppercase tracking-wider border border-indigo-500/30">
                    Non-Cash Activity
                  </span>
                  <span className="text-slate-300 font-semibold text-xs">
                    Tracked for general ledger & sales reporting • Excluded from Physical Cash Drawer
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 text-[10px] mr-1.5">Total Non-Cash:</span>
                  <span className="font-mono-num font-black text-indigo-300 text-sm">
                    ${summaryTotals.totalNonCash.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-300">
                {summaryTotals.activeCurrencies.map((c) => {
                  const sAmt = summaryTotals.currencySalesTotals[c.currency] || 0;
                  return (
                    <div key={c.currency} className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-slate-400 text-[11px] block">{c.name} Sales</span>
                        <span className="text-[10px] text-slate-500">{c.code} Digital / Swipe</span>
                      </div>
                      <span className="font-mono-num font-bold text-sm text-purple-300">
                        ${sAmt.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
                <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-slate-400 text-[11px] block">Credit Extended</span>
                    <span className="text-[10px] text-slate-500">Customer Receivables</span>
                  </div>
                  <span className="font-mono-num font-bold text-sm text-blue-300">
                    ${summaryTotals.totalCreditExtended.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Key Formula Explanation Banner with Live Substituted Numbers */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-950/40 via-slate-900 to-indigo-950/40 border border-purple-500/30 text-xs shadow-md">
            <div className="flex items-center space-x-2 text-purple-300 font-bold uppercase tracking-wider text-[11px] mb-2">
              <Calculator className="w-4 h-4 text-[#FF8A00]" />
              <span>Form 4 Live Balancing Formula</span>
            </div>
            <div className="font-mono-num text-xs sm:text-sm text-slate-200 leading-relaxed bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
              <span className="text-emerald-400 font-bold">Float (${summaryTotals.totalFloat.toFixed(2)})</span>
              {' + '}
              <span className="text-emerald-400 font-bold">Cash Sales (${summaryTotals.totalCashSales.toFixed(2)})</span>
              {' + '}
              <span className="text-emerald-400 font-bold">Credit Payments (${summaryTotals.totalCreditPayments.toFixed(2)})</span>
              {' + '}
              <span className="text-emerald-400 font-bold">Change In (${summaryTotals.totalChangeIn.toFixed(2)})</span>
              <br className="my-1.5" />
              {' − '}
              <span className="text-rose-400 font-bold">Expenses (${summaryTotals.totalExpenses.toFixed(2)})</span>
              {' − '}
              <span className="text-rose-400 font-bold">Direct Procurements (${summaryTotals.totalDirectProcurements.toFixed(2)})</span>
              {' − '}
              <span className="text-rose-400 font-bold">Cash Lift (${summaryTotals.totalCashLift.toFixed(2)})</span>
              {' − '}
              <span className="text-rose-400 font-bold">Change Out (${summaryTotals.totalChangeOut.toFixed(2)})</span>
              <br className="my-1.5" />
              {summaryTotals.activeCurrencies.map((c) => {
                const wAmt = summaryTotals.currencyWithdrawalTotals[c.currency] || 0;
                return (
                  <React.Fragment key={c.currency}>
                    {' − '}
                    <span className="text-rose-400 font-bold">
                      {c.name} Cash-Out (${wAmt.toFixed(2)})
                    </span>
                  </React.Fragment>
                );
              })}
              {' − '}
              <span className="text-rose-400 font-bold">Petty Cash (${summaryTotals.totalPettyCash.toFixed(2)})</span>
              <br className="my-1.5" />
              {' = '}
              <span className="text-indigo-300 font-black text-sm sm:text-base underline decoration-indigo-400">
                Expected Cash (${summaryTotals.totalExpectedCash.toFixed(2)})
              </span>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search salesperson..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-[#6A4DFF]"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center space-x-1.5 self-start sm:self-auto overflow-x-auto w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setFilterStatus('ALL')}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                  filterStatus === 'ALL'
                    ? 'bg-slate-800 text-white border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({balancingData.length})
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('ACTIVE')}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                  filterStatus === 'ACTIVE'
                    ? 'bg-purple-900/60 text-purple-200 border border-purple-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                With Activity ({summaryTotals.countActive})
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('BALANCED')}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                  filterStatus === 'BALANCED'
                    ? 'bg-emerald-900/60 text-emerald-200 border border-emerald-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Balanced ({summaryTotals.countBalanced})
              </button>

              <button
                type="button"
                onClick={() => setFilterStatus('DISCREPANCY')}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                  filterStatus === 'DISCREPANCY'
                    ? 'bg-rose-900/60 text-rose-200 border border-rose-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Discrepancies ({summaryTotals.countShortage + summaryTotals.countOver})
              </button>
            </div>
          </div>

          {/* Main Table Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table id="form4-balancing-table" className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3.5">Staff</th>
                    <th className="py-3 px-3.5 text-right text-indigo-300 font-black">
                      Expected Cash
                    </th>
                    <th className="py-3 px-3.5 text-right text-emerald-300 font-black">
                      Physical Count
                    </th>
                    <th className="py-3 px-3.5 text-center font-black">
                      Variance
                    </th>
                    <th className="py-3 px-3.5 text-center font-black">
                      Status
                    </th>
                    <th className="py-3 px-3 text-center">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/80 font-medium text-slate-200">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500">
                        No salesperson matches the selected filter for {date}.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row, rowIdx) => {
                      const isBalanced = row.status === 'Balanced';
                      const isShortage = row.status === 'Shortage';
                      const isOver = row.status === 'Over';

                      return (
                        <tr
                          key={`${row.staffId}-${rowIdx}`}
                          id={`row-staff-${row.staffId}`}
                          className={`hover:bg-slate-800/40 transition ${
                            row.hasActivity ? 'bg-slate-900/40' : 'opacity-80'
                          }`}
                        >
                          {/* 1. Staff Name & ID */}
                          <td className="py-3 px-3.5">
                            <div className="flex items-center space-x-2">
                              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#6A4DFF] to-purple-800 text-white font-bold flex items-center justify-center text-xs shrink-0">
                                {row.staffName.charAt(0)}
                              </div>
                              <div>
                                <div className="flex items-center space-x-1.5">
                                  <span className="font-bold text-white block leading-tight">
                                    {row.staffName}
                                  </span>
                                  {(() => {
                                    const sp = salespeople.find((s) => s.id === row.staffId);
                                    const roleStr = (sp?.role || '').toLowerCase();
                                    if (roleStr.includes('clerk') || roleStr.includes('account')) {
                                      return (
                                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30" title="Only POS Register till events shown. Corporate custody transfers (Safe <-> HQ) are managed in Cash Custody.">
                                          Till POS Only
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono-num">
                                  ID #{row.staffId}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 2. Expected Cash Column */}
                          <td className="py-3 px-3.5 text-right">
                            <span className="font-mono-num font-black text-sm text-indigo-300 block">
                              ${(row.expectedCash ?? 0).toFixed(2)}
                            </span>
                            <span className="text-[9px] text-slate-400 font-mono-num block">
                              In: ${(row.cashInTotal ?? 0).toFixed(0)} / Out: ${(row.cashOutTotal ?? 0).toFixed(0)}
                            </span>
                          </td>

                          {/* 3. Physical Count Column */}
                          <td className="py-3 px-3.5 text-right">
                            {row.actualCashCount !== null ? (
                              <span className="font-mono-num font-black text-sm text-emerald-300 block">
                                ${row.actualCashCount.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[11px] italic block">
                                Not Counted
                              </span>
                            )}
                            <span className="text-[9px] text-slate-500 block">
                              Form 1 Snapshot
                            </span>
                          </td>

                          {/* 4. Variance Column */}
                          <td className="py-3 px-3.5 text-center font-mono-num font-bold">
                            <span
                              className={`text-xs ${
                                Math.abs(row.variance) < 0.01
                                  ? 'text-emerald-400 font-bold'
                                  : row.variance < 0
                                  ? 'text-rose-400 font-black'
                                  : 'text-orange-400 font-black'
                              }`}
                            >
                              {row.variance >= 0
                                ? `+$${row.variance.toFixed(2)}`
                                : `-$${Math.abs(row.variance).toFixed(2)}`}
                            </span>
                          </td>

                          {/* 5. Status Column */}
                          <td className="py-3 px-3.5 text-center">
                            <div className="inline-flex flex-col items-center">
                              {row.status === 'No Activity' ? (
                                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-bold">
                                  No Activity
                                </span>
                              ) : isBalanced ? (
                                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-black flex items-center space-x-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>Balanced</span>
                                </span>
                              ) : isShortage ? (
                                <span className="px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11px] font-black flex items-center space-x-1">
                                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                                  <span>Shortage (-${Math.abs(row.variance).toFixed(2)})</span>
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[11px] font-black flex items-center space-x-1">
                                  <TrendingUp className="w-3 h-3 text-orange-400" />
                                  <span>Over (+${row.variance.toFixed(2)})</span>
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 6. Actions (Drill-down & Safe Handover) */}
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              <button
                                id={`btn-audit-staff-${row.staffId}`}
                                type="button"
                                onClick={() => setAuditStaffId(row.staffId)}
                                className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-[11px] font-bold inline-flex items-center space-x-1.5 transition border border-slate-700"
                                title={`Drill-down to see movements for ${row.staffName}`}
                              >
                                <Eye className="w-3.5 h-3.5 text-[#6A4DFF]" />
                                <span>Movements</span>
                              </button>

                              {(() => {
                                const govConfig = getCashGovernanceConfig();
                                const customVal = customRetainedFloats[row.staffId];
                                const effectiveRetainedFloat = customVal !== undefined && customVal.trim() !== ''
                                  ? (parseFloat(customVal) >= 0 ? parseFloat(customVal) : 0)
                                  : (row.float > 0 ? row.float : (govConfig.defaultTillFloat || 20.0));
                                const rawTillCash =
                                  row.actualCashCount !== null && row.actualCashCount !== undefined
                                    ? row.actualCashCount
                                    : (row.physicalCashCount || row.expectedCash || 0);

                                const allTransfers = getCashTransfers(currentUser?.branchId);
                                const cashierSurrendersToday = allTransfers.filter(
                                  (t) =>
                                    t.type === 'TILL_COLLECTION' &&
                                    t.status === 'COMPLETED' &&
                                    isSameDaySafe(undefined, t.created_at, date) &&
                                    (t.recipient_name?.toLowerCase() === row.staffName.toLowerCase() ||
                                      t.notes?.toLowerCase().includes(row.staffName.toLowerCase()) ||
                                      t.from_account_id?.includes(row.staffId))
                                );
                                const totalSurrenderedToday = cashierSurrendersToday.reduce(
                                  (sum, t) => sum + (Number(t.amount) || 0),
                                  0
                                );
                                const netSurplus = Math.max(0, Math.round((rawTillCash - totalSurrenderedToday - effectiveRetainedFloat) * 100) / 100);
                                const hasSurplus = netSurplus > 0;
                                const lastTarget = cashierSurrendersToday[cashierSurrendersToday.length - 1]?.to_account_id?.includes('CLERK') ? 'Clerk' : 'Safe';

                                return (
                                  <div className="flex items-center space-x-1.5 ml-1">
                                    {/* Editable Retained Float (e.g. $15, $20, $30) */}
                                    <div
                                      className="inline-flex items-center space-x-1 bg-slate-900/90 border border-slate-700/80 px-2 py-0.5 rounded-xl shadow-inner"
                                      title="Float retained in cashier cashbox for tomorrow's shift (default $20; editable to $15, $30, etc.)"
                                    >
                                      <span className="text-[10px] text-slate-400 font-semibold">Retain:</span>
                                      <div className="relative flex items-center">
                                        <span className="text-[10px] text-slate-500 font-mono mr-0.5">$</span>
                                        <input
                                          type="number"
                                          step="1"
                                          min="0"
                                          value={customRetainedFloats[row.staffId] ?? String(effectiveRetainedFloat)}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setCustomRetainedFloats((prev) => ({
                                              ...prev,
                                              [row.staffId]: val,
                                            }));
                                          }}
                                          className="w-11 text-center bg-slate-950 border border-slate-700 rounded px-1 py-0.2 text-white font-mono text-[11px] focus:border-emerald-500 focus:outline-none"
                                          placeholder="20"
                                        />
                                      </div>
                                    </div>

                                    {totalSurrenderedToday > 0 && (
                                      <span
                                        className="text-[10px] text-emerald-400 font-bold bg-emerald-950/70 border border-emerald-600/40 px-2 py-0.5 rounded-lg flex items-center space-x-1 whitespace-nowrap"
                                        title={`Already surrendered $${totalSurrenderedToday.toFixed(2)} to ${lastTarget} today`}
                                      >
                                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                        <span>Surrendered ${totalSurrenderedToday.toFixed(0)}</span>
                                      </span>
                                    )}
                                    <div className="inline-flex rounded-xl border border-slate-700 p-0.5 bg-slate-950 shadow-sm">
                                      <button
                                        type="button"
                                        disabled={!hasSurplus}
                                        onClick={() => handleExecuteHandover(row.staffId, row.staffName, rawTillCash, effectiveRetainedFloat, 'SAFE')}
                                        className={`px-2 py-1 rounded-lg text-[11px] font-bold inline-flex items-center space-x-1 transition shadow-sm ${
                                          hasSurplus
                                            ? 'bg-emerald-950/80 hover:bg-emerald-800 border border-emerald-600/40 text-emerald-200 cursor-pointer active:scale-95'
                                            : 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed opacity-50'
                                        }`}
                                        title={
                                          hasSurplus
                                            ? `Surrender surplus cash ($${netSurplus.toFixed(2)}) directly To Branch Safe (dual-custody vault) retaining $${effectiveRetainedFloat.toFixed(2)} in cashbox`
                                            : totalSurrenderedToday > 0
                                            ? `All surplus cash ($${totalSurrenderedToday.toFixed(2)}) already surrendered`
                                            : `Till cash ($${rawTillCash.toFixed(2)}) does not exceed retained float ($${effectiveRetainedFloat.toFixed(2)})`
                                        }
                                      >
                                        <Coins className={`w-3 h-3 ${hasSurplus ? 'text-emerald-400' : 'text-slate-600'}`} />
                                        <span>To Safe</span>
                                        {hasSurplus && <span className="font-mono text-[9px] text-emerald-300 ml-0.5">${netSurplus.toFixed(0)}</span>}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!hasSurplus}
                                        onClick={() => handleExecuteHandover(row.staffId, row.staffName, rawTillCash, effectiveRetainedFloat, 'CLERK')}
                                        className={`px-2 py-1 rounded-lg text-[11px] font-bold inline-flex items-center space-x-1 transition shadow-sm ml-1 ${
                                          hasSurplus
                                            ? 'bg-indigo-950/80 hover:bg-indigo-800 border border-indigo-600/40 text-indigo-200 cursor-pointer active:scale-95'
                                            : 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed opacity-50'
                                        }`}
                                        title={
                                          hasSurplus
                                            ? `Surrender surplus cash ($${netSurplus.toFixed(2)}) To Accounts Clerk (at petty cash/reconciliation desk) retaining $${effectiveRetainedFloat.toFixed(2)} in cashbox`
                                            : totalSurrenderedToday > 0
                                            ? `All surplus cash ($${totalSurrenderedToday.toFixed(2)}) already surrendered`
                                            : `Till cash ($${rawTillCash.toFixed(2)}) does not exceed retained float ($${effectiveRetainedFloat.toFixed(2)})`
                                        }
                                      >
                                        <User className={`w-3 h-3 ${hasSurplus ? 'text-indigo-400' : 'text-slate-600'}`} />
                                        <span>To Clerk</span>
                                        {hasSurplus && <span className="font-mono text-[9px] text-indigo-300 ml-0.5">${netSurplus.toFixed(0)}</span>}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Table Footer Totals */}
                {filteredRows.length > 0 && (
                  <tfoot className="bg-slate-950 border-t-2 border-slate-800 font-bold text-xs text-white">
                    <tr>
                      <td className="py-3 px-3.5 font-black uppercase text-slate-300">
                        Grand Total ({filteredRows.length} Staff)
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono-num font-black text-sm text-indigo-300">
                        ${summaryTotals.totalExpectedCash.toFixed(2)}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono-num font-black text-sm text-emerald-300">
                        ${(summaryTotals.totalPhysicalCount ?? 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-3.5 text-center font-mono-num font-black text-xs">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${
                            Math.abs(summaryTotals.totalVariance) < 0.01
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : summaryTotals.totalVariance < 0
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-orange-500/20 text-orange-300'
                          }`}
                        >
                          {summaryTotals.totalVariance >= 0
                            ? `+$${summaryTotals.totalVariance.toFixed(2)}`
                            : `-$${Math.abs(summaryTotals.totalVariance).toFixed(2)}`}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 text-center text-[10px] text-slate-400">
                        {summaryTotals.countBalanced} Balanced
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Bottom Action Footer inside Card */}
            <div className="p-3.5 bg-slate-950/60 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center space-x-2 text-slate-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>
                  Total sales figures are calculated automatically from recorded POS sales for each salesperson on this date.
                </span>
              </div>

              <div className="flex items-center space-x-2">
                {Object.keys(salesInputs).length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      salespeople.forEach((staff) => {
                        saveAdminSalesEntry(date, staff.id, staff.name, 0, '');
                      });
                      setSalesInputs({});
                      setEditingStaffId(null);
                      setSaveSuccessBanner('Reset all salespeople to system recorded sales.');
                    }}
                    className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center space-x-1.5 transition text-xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All Overrides</span>
                  </button>
                )}
                {Object.keys(salesInputs).length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveAllSales}
                    disabled={isSavingAll}
                    className="py-1.5 px-3.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white font-bold flex items-center space-x-1.5 shadow-md transition"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingAll ? 'Saving...' : 'Save Overrides'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1b: SUPERVISOR EXPECTED CASH HANDOVER */}
      {/* ========================================================================= */}
      {activeTab === 'supervisor_handover' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-900 border border-amber-500/40 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <User className="w-5 h-5 text-amber-400" />
                  <span>Supervisor &amp; Owner Cash Custody Handover</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Formula: Expected Cash = Opening Float + Own Cash Sales + Till Lifts Collected - Expenses Paid From Cash - GRVs Paid From Cash - Owner Drawings
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {salespeople
                .filter(
                  (s) =>
                    s.role === 'Supervisor' ||
                    s.role === 'Admin' ||
                    s.role === 'OWNER' ||
                    s.role === 'SUPER_ADMIN' ||
                    isSupervisorOrAbove(s.role)
                )
                .map((sup, idx) => {
                  const summary = calculateSupervisorExpectedCash(sup.id, date);
                  return (
                    <div
                      key={`${sup.id}-${idx}`}
                      className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3 shadow-md"
                    >
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div>
                          <span className="font-black text-white text-sm block">{sup.name}</span>
                          <span className="text-[10px] text-amber-400 font-bold uppercase">{sup.role}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 block">Expected Handover</span>
                          <span className="text-base font-black text-amber-400 font-mono">
                            ${summary.expectedHandoverCash.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">+ Own Cash Sales:</span>
                          <span className="font-mono text-emerald-400 font-bold">+${summary.ownCashSales.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">+ Till Lifts Collected:</span>
                          <span className="font-mono text-blue-400 font-bold">+${summary.tillLiftsCollected.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">- Expenses Paid from Cash:</span>
                          <span className="font-mono text-rose-400 font-bold">-${summary.expensesPaidFromCash.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">- GRV Payments Paid from Cash:</span>
                          <span className="font-mono text-rose-400 font-bold">-${summary.grvPaymentsPaidFromCash.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">- Owner Drawings / Safe:</span>
                          <span className="font-mono text-purple-400 font-bold">-${summary.ownerDrawingsTaken.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Shop Use (Non-Cash Meals):</span>
                          <span className="font-mono text-slate-500 font-bold">$0.00 (Non-Cash)</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">Date: {date}</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                          Live Audit Ready
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: COMPANY EXPENSES LOG */}
      {/* ========================================================================= */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <form
            onSubmit={handleAddExpense}
            className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4 animate-scaleUp"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <PlusCircle className="w-4 h-4 text-[#FF8A00]" />
                <span>Record Operational Expense & Sync to Sheet "Expenses"</span>
              </h3>
              <span className="text-xs text-slate-400">
                Admin: <strong className="text-slate-200">{currentUser.name}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Amount */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                  Amount ($) *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-700 focus:border-[#6A4DFF] rounded-2xl text-base font-bold text-white font-mono-num outline-none"
                    required
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                  Expense Category
                </label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full py-2.5 px-3 bg-slate-950 border border-slate-700 focus:border-[#6A4DFF] rounded-2xl text-xs font-semibold text-white outline-none cursor-pointer"
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                Description *
              </label>
              <input
                type="text"
                value={expenseDesc}
                onChange={(e) => setExpenseDesc(e.target.value)}
                placeholder="e.g. 20 Litres diesel for delivery vehicle, shop cleaning detergents..."
                className="w-full py-2.5 px-3.5 bg-slate-950 border border-slate-700 focus:border-[#6A4DFF] rounded-2xl text-xs text-white placeholder-slate-500 outline-none"
                required
              />
            </div>

            {/* Vendor & Payment Method */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                  Vendor / Payee Name (Or Select Customer)
                </label>
                {linkedCustomer ? (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-purple-950/60 border border-purple-800 text-xs">
                    <span className="text-purple-200 font-bold">{linkedCustomer.name} ({linkedCustomer.customerId})</span>
                    <button
                      type="button"
                      onClick={() => setLinkedCustomer(null)}
                      className="text-[10px] text-rose-400 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="flex space-x-1.5">
                    <input
                      type="text"
                      value={expenseVendor}
                      onChange={(e) => setExpenseVendor(e.target.value)}
                      placeholder="e.g. TotalEnergies Samora"
                      className="flex-1 py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setIsCustomerModalOpen(true)}
                      className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold border border-slate-700 shrink-0"
                    >
                      Select Customer
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">
                  Paid Via
                </label>
                <select
                  value={expensePayMethod}
                  onChange={(e) => setExpensePayMethod(e.target.value as any)}
                  className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white outline-none cursor-pointer"
                >
                  <option value="Cash">Cash (Deducts from Cash Drawer & CashLog)</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Card">Card / POS</option>
                  <option value="EcoCash/Mobile">EcoCash / Mobile Money</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('balancing')}
                className="flex-1 py-2.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                Cancel
              </button>
              <button
                id="btn-save-expense"
                type="submit"
                className="flex-1 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white font-bold text-xs shadow-lg transition"
              >
                Record to Sheet "Expenses"
              </button>
            </div>
          </form>

          {/* Expenses List */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Expenses History ({expenses.length})
              </h3>
              <button
                type="button"
                onClick={() => downloadCsvFile('Expenses')}
                className="text-xs text-[#FF8A00] font-bold flex items-center space-x-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>

            {expenses.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-500">No company expenses recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {expenses.map((exp) => (
                  <div
                    key={exp.id}
                    className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-white">{exp.description}</span>
                      <div className="text-slate-400 flex items-center space-x-2 mt-0.5 text-[11px]">
                        <span className="text-purple-300">{exp.category}</span>
                        <span>•</span>
                        <span>{exp.date}</span>
                        <span>•</span>
                        <span>by {exp.staffName}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold font-mono-num text-rose-400 text-sm">
                        -${exp.amount.toFixed(2)}
                      </span>
                      <span className="block text-[10px] text-slate-500">{exp.paymentMethod}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: AUDIT ARCHIVE */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Salesperson Cash Balancing Archive
              </h3>
              <p className="text-xs text-slate-400">
                Historical records of total sales, Form 2 & Form 3 nets, and variance outcomes
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="text-xs text-[#FF8A00] font-bold flex items-center space-x-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Balancing Sheet</span>
            </button>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs space-y-2">
            <span className="font-bold text-slate-200">Historical Date Reconciliations:</span>
            <p className="text-slate-400">
              Select any date from the top date picker (e.g. {date}) to immediately view or modify the full cash balancing sheet for all salespeople on that day.
            </p>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* AUDIT DRILL-DOWN MODAL FOR SELECTED SALESPERSON */}
      {/* ========================================================================= */}
      {selectedAuditData && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-scaleUp">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white font-bold text-base shadow-md">
                  {selectedAuditData.staff.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Audit Breakdown: {selectedAuditData.staff.name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Date: <strong className="text-slate-200">{date}</strong> • Staff ID: #{selectedAuditData.staff.id}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAuditStaffId(null)}
                className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-xs">
              {/* Summary Stats Pill */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 rounded-2xl bg-slate-950 border border-slate-800 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 block">Form 2 Net</span>
                  <span className="text-sm font-bold font-mono-num text-white">
                    ${(selectedAuditData.row?.form2Net ?? 0).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Form 3 Net</span>
                  <span className="text-sm font-bold font-mono-num text-white">
                    ${(selectedAuditData.row?.form3Net ?? 0).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-purple-300 block font-bold">Sum 2 & 3 Net</span>
                  <span className="text-sm font-black font-mono-num text-[#FF8A00]">
                    ${(selectedAuditData.row?.sumForm2And3Net ?? 0).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-emerald-300 block font-bold">Sales</span>
                  <span className="text-sm font-bold font-mono-num text-emerald-400">
                    ${(selectedAuditData.row?.sales ?? 0).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-indigo-300 block font-bold">Should Have</span>
                  <span className="text-sm font-black font-mono-num text-indigo-300">
                    ${(selectedAuditData.row?.shouldHave ?? 0).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-bold">Variance</span>
                  <span className={`text-sm font-black font-mono-num ${
                    Math.abs(selectedAuditData.row?.variance || 0) < 0.01
                      ? 'text-emerald-400'
                      : (selectedAuditData.row?.variance || 0) < 0
                      ? 'text-rose-400'
                      : 'text-orange-400'
                  }`}>
                    {Math.abs(selectedAuditData.row?.variance || 0) < 0.01
                      ? '$0.00'
                      : (selectedAuditData.row?.variance || 0) < 0
                      ? `-$${Math.abs(selectedAuditData.row?.variance || 0).toFixed(2)}`
                      : `+$${(selectedAuditData.row?.variance || 0).toFixed(2)}`}
                  </span>
                </div>
              </div>

              {/* Form 4 Cash Balancing Breakdown */}
              {selectedAuditData.row && (
                <div className="p-4 rounded-2xl bg-slate-950/80 border border-indigo-500/30 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div className="flex items-center space-x-2">
                      <Calculator className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-xs uppercase tracking-wider text-indigo-200">
                        Form 4 Cash Balancing Breakdown
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block">Expected Cash in Till</span>
                      <span className="text-sm font-mono-num font-black text-indigo-300">
                        ${(selectedAuditData.row.expectedCash ?? 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Formula Breakdown Items Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[11px]">
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">+ Float</span>
                      <span className="font-mono-num font-bold text-emerald-400">
                        +${(selectedAuditData.row.float ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">+ Cash Sales</span>
                      <span className="font-mono-num font-bold text-emerald-400">
                        +${(selectedAuditData.row.cashSales ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">+ Credit Payments</span>
                      <span className="font-mono-num font-bold text-emerald-400">
                        +${(selectedAuditData.row.creditPayments ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">- Expenses</span>
                      <span className="font-mono-num font-bold text-rose-400">
                        -${(selectedAuditData.row.expenses ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">- Direct Procurements</span>
                      <span className="font-mono-num font-bold text-rose-400">
                        -${(selectedAuditData.row.directProcurements ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">- Cash Lift</span>
                      <span className="font-mono-num font-bold text-rose-400">
                        -${(selectedAuditData.row.cashLift ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">- Customer Change</span>
                      <span className="font-mono-num font-bold text-rose-400">
                        -${(selectedAuditData.row.customerChange ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">- Deductions</span>
                      <span className="font-mono-num font-bold text-rose-400">
                        -${(selectedAuditData.row.deductions ?? 0).toFixed(2)}
                      </span>
                    </div>
                    {/* Active currencies till cash-outs */}
                    {(selectedAuditData.row.activeCurrencies || getActiveCurrencies()).map((c) => {
                      const wVal =
                        (selectedAuditData.row.currencyWithdrawals && selectedAuditData.row.currencyWithdrawals[c.currency]) ??
                        (c.currency === 'EcoCash'
                          ? selectedAuditData.row.ecocashWithdrawal
                          : c.currency === 'ZiG'
                          ? selectedAuditData.row.zigWithdrawal
                          : 0) ??
                        0;
                      return (
                        <div key={c.currency} className="p-2 rounded-xl bg-purple-950/30 border border-purple-800/40">
                          <span className="text-purple-300 block text-[10px] font-semibold">- {c.name} Cash-Out</span>
                          <span className="font-mono-num font-bold text-rose-400">
                            -${(Number(wVal) || 0).toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Reporting-only non-cash sales */}
                  <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-400 gap-2">
                    <div className="flex items-center space-x-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                      <span>Non-Cash Sales (Reporting Only — Not in Expected Physical Cash):</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-num">
                      {(selectedAuditData.row.activeCurrencies || getActiveCurrencies()).map((c) => {
                        const sVal =
                          (selectedAuditData.row.currencySales && selectedAuditData.row.currencySales[c.currency]) ??
                          (c.currency === 'EcoCash'
                            ? selectedAuditData.row.ecocashSales
                            : c.currency === 'ZiG'
                            ? selectedAuditData.row.zigSales
                            : 0) ??
                          0;
                        return (
                          <span key={c.currency}>
                            {c.name}: ${sVal.toFixed(2)}
                          </span>
                        );
                      })}
                      <span className="text-slate-200 font-bold">
                        Total Non-Cash: ${(selectedAuditData.row.totalNonCashSales ?? 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Form 1 Physical Count if available */}
              {selectedAuditData.form1Count && (
                <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <Coins className="w-4 h-4 text-emerald-400" />
                    <span>Form 1 (Physical Cash Count Counted):</span>
                  </div>
                  <span className="font-mono-num font-black text-emerald-300 text-sm">
                    ${(selectedAuditData.form1Count.finalCashOutTotal ?? 0).toFixed(2)}
                  </span>
                </div>
              )}

              {/* Section 0: Canonical Cash Movements (cashMovements ledger) */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <History className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Canonical Cash Movements ({selectedAuditData.staffMovements.length})</span>
                  </span>
                  <span className="text-indigo-300 font-mono-num font-bold">
                    Expected: ${(selectedAuditData.row?.expectedCash ?? 0).toFixed(2)}
                  </span>
                </h4>

                {selectedAuditData.staffMovements.length === 0 ? (
                  <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                    No canonical ledger movements recorded for this staff on this date.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {selectedAuditData.staffMovements.map((mov, movIdx) => {
                      const isIn = mov.direction === 'in';
                      const isOut = mov.direction === 'out';
                      const timeStr = new Date(mov.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={`${mov.id}-${movIdx}`}
                          className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-[11px] gap-2"
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider ${
                                  isIn
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : isOut
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                    : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                }`}
                              >
                                {mov.direction}
                              </span>
                              <span className="font-bold text-white uppercase tracking-tight text-[10px]">
                                {mov.type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono-num">
                                {timeStr}
                              </span>
                              <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                                {mov.sourceModule}
                              </span>
                            </div>
                            <p className="text-slate-400 truncate text-[10px]">
                              {mov.notes || mov.sourceRef || 'No details'}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <span
                              className={`font-mono-num font-black text-xs block ${
                                isIn
                                  ? 'text-emerald-400'
                                  : isOut
                                  ? 'text-rose-400'
                                  : 'text-indigo-300'
                              }`}
                            >
                              {isIn ? '+' : isOut ? '-' : ''}${(mov.amount ?? 0).toFixed(2)}
                            </span>
                            <span className="text-[9px] text-slate-500 block">
                              {mov.affectsDrawer ? 'Drawer' : 'Non-Drawer'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 1: Form 2 Cash Log Transactions */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                  <span>Form 2: Cash Log Movements ({selectedAuditData.form2Logs.length})</span>
                  <span className="text-purple-300 font-mono-num font-bold">
                    Net: ${(selectedAuditData.row?.form2Net ?? 0).toFixed(2)}
                  </span>
                </h4>

                {selectedAuditData.form2Logs.length === 0 ? (
                  <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                    No Form 2 cash log movements for this date.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {selectedAuditData.form2Logs.map((log, logIdx) => (
                      <div
                        key={`${log.id}-${logIdx}`}
                        className="p-2 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <div>
                          <span className="font-bold text-white">{log.line}</span>
                          <span className="text-slate-400 ml-1.5">({log.description})</span>
                        </div>
                        <div className="text-right font-mono-num font-bold">
                          {log.in > 0 && <span className="text-emerald-400">+${(log.in ?? 0).toFixed(2)}</span>}
                          {log.out > 0 && <span className="text-rose-400">-${(log.out ?? 0).toFixed(2)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 2: Form 3 Customer Change Entries */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                  <span>Form 3: Customer Change Records ({selectedAuditData.form3Changes.length})</span>
                  <span className="text-slate-400 font-mono-num">
                    Net: ${(((selectedAuditData.row?.changeReceived ?? selectedAuditData.row?.changeIn ?? 0) - (selectedAuditData.row?.changePaid ?? selectedAuditData.row?.customerChange ?? 0))).toFixed(2)}
                  </span>
                </h4>

                {selectedAuditData.form3Changes.length === 0 ? (
                  <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                    No Form 3 customer change entries for this date.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {selectedAuditData.form3Changes.map((chg, chgIdx) => (
                      <div
                        key={`${chg.id}-${chgIdx}`}
                        className="p-2 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <div>
                          <span className="font-bold text-white">{chg.customerName}</span>
                          {chg.notes && <span className="text-slate-400 ml-1.5">"{chg.notes}"</span>}
                        </div>
                        <div className="text-right font-mono-num font-bold">
                          {chg.in > 0 && <span className="text-emerald-400">+${chg.in.toFixed(2)} In </span>}
                          {chg.out > 0 && <span className="text-rose-400">-${chg.out.toFixed(2)} Out</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 3: Form 3 Credit Sales */}
              {selectedAuditData.form3Credits.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                    <span>Form 3: Credit Sales ({selectedAuditData.form3Credits.length})</span>
                  </h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                    {selectedAuditData.form3Credits.map((cr, crIdx) => (
                      <div
                        key={`${cr.id}-${crIdx}`}
                        className="p-2 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <div>
                          <span className="font-bold text-white">{cr.customerName}</span>
                          <span className="text-slate-400 ml-1.5">({cr.itemDescription})</span>
                        </div>
                        <div className="text-right font-mono-num font-bold text-amber-300">
                          ${(cr.amount ?? 0).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 4: Recorded System Sales */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <ShoppingBag className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      Recorded Sales (
                      {selectedAuditData.staffSales.length + (selectedAuditData.adminSale ? 1 : 0)})
                    </span>
                  </span>
                  <span className="text-emerald-400 font-mono-num font-bold">
                    Total: $
                    {(
                      selectedAuditData.staffSales.reduce((sum, s) => sum + (s.total || 0), 0) +
                      (selectedAuditData.adminSale && selectedAuditData.staffSales.length === 0
                        ? selectedAuditData.adminSale.salesAmount || 0
                        : 0)
                    ).toFixed(2)}
                  </span>
                </h4>

                {/* Display Admin / Form 4 Sales Entry if recorded */}
                {selectedAuditData.adminSale && (
                  <div className="p-2.5 rounded-xl bg-indigo-950/50 border border-indigo-500/40 flex items-center justify-between text-[11px] mb-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-indigo-300">Balancing / Admin Sales Record</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-900/80 text-indigo-200 font-semibold">
                          Form 4 Entry
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {selectedAuditData.adminSale.notes ||
                          `Reconciliation sales record for ${selectedAuditData.staff.name}`}
                      </div>
                    </div>
                    <div className="text-right font-mono-num font-bold text-emerald-400 text-xs">
                      ${(selectedAuditData.adminSale.salesAmount ?? 0).toFixed(2)}
                    </div>
                  </div>
                )}

                {selectedAuditData.staffSales.length === 0 && !selectedAuditData.adminSale ? (
                  <p className="p-3 text-center text-slate-500 bg-slate-950/40 rounded-xl">
                    No sales invoices recorded for this salesperson on this date.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {selectedAuditData.staffSales.map((sale, saleIdx) => (
                      <div
                        key={`${sale.id}-${saleIdx}`}
                        className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-white font-mono-num">{sale.id || 'POS-INV'}</span>
                            <span className="text-slate-400">• {sale.customerName || 'Walk-in Customer'}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-semibold">
                              {sale.paymentMethod || sale.currency || 'Cash'}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 truncate max-w-sm">
                            {sale.itemsSummary ||
                              (sale.items && sale.items.length > 0
                                ? sale.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')
                                : 'General Store Sale Items')}
                          </div>
                        </div>
                        <div className="text-right font-mono-num font-bold text-emerald-400 text-xs">
                          ${(sale.total ?? 0).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setAuditStaffId(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition"
              >
                Close Audit Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer search modal */}
      <CustomerSearchModal
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        onSelectCustomer={(c) => setLinkedCustomer(c)}
        currentUser={currentUser}
      />

      {/* End of Day (EOD) Encrypted Database Backup Modal */}
      <DatabaseBackupModal
        isOpen={showEodBackupModal}
        onClose={() => setShowEodBackupModal(false)}
        defaultType="EOD_HANDOVER"
        staffName={currentUser.name}
      />

      {/* Database Restore Modal for Supervisor to Upload Owner Master Update */}
      <DatabaseRestoreModal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        defaultMode="master_only"
        onRestoreSuccess={() => {
          window.location.reload();
        }}
      />

      {/* Electronic Settlements Modal (EcoCash & ZiG Swipe Dual Verification) */}
      {showElectronicModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-indigo-500/40 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Electronic Settlements & Bank Sweep</h3>
                  <p className="text-xs text-slate-400">Verify EcoCash & ZiG settlements before EOD dual-custody bank transfer</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowElectronicModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* EcoCash Verification Box */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span className="font-bold text-white text-xs">EcoCash Merchant Account</span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">
                    System Total: <strong className="text-blue-400">${summaryTotals.totalEcocashSales.toFixed(2)}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Merchant Reference / Statement Ref</label>
                    <input
                      type="text"
                      value={ecocashBatchInput}
                      onChange={(e) => setEcocashBatchInput(e.target.value)}
                      placeholder="e.g. EC-BATCH-98124"
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Settled / Confirmed Amount ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={ecocashSettledAmount}
                      onChange={(e) => setEcocashSettledAmount(e.target.value)}
                      placeholder={summaryTotals.totalEcocashSales.toFixed(2)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono-num font-bold focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* ZiG Swipe Verification Box */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="font-bold text-white text-xs">ZiG POS Swipe Settlement</span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px]">
                    System Total: <strong className="text-amber-400">${summaryTotals.totalZigSales.toFixed(2)}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">POS Terminal Batch / Audit Ref</label>
                    <input
                      type="text"
                      value={zigBatchInput}
                      onChange={(e) => setZigBatchInput(e.target.value)}
                      placeholder="e.g. ZIG-SWIPE-0041"
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Settled / Confirmed Amount ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={zigSettledAmount}
                      onChange={(e) => setZigSettledAmount(e.target.value)}
                      placeholder={summaryTotals.totalZigSales.toFixed(2)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono-num font-bold focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Destination Operating Bank Account for Dual-Custody Sweep */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center space-x-2">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                  <label className="font-bold text-white text-xs">Target Bank Operating Account</label>
                </div>
                <select
                  value={targetBankInput}
                  onChange={(e) => setTargetBankInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="CABS Operating Account - 100293847">CABS Operating Account • 100293847</option>
                  <option value="Steward Bank Main - 0293847190">Steward Bank Main • 0293847190</option>
                  <option value="Stanbic Store Account - 9023847102">Stanbic Store Account • 9023847102</option>
                  <option value="CBZ Commercial Account - 110293845">CBZ Commercial Account • 110293845</option>
                  <option value="Ecobank Operating - 8820192301">Ecobank Operating • 8820192301</option>
                  <option value="Nedbank Store Float - 44029102">Nedbank Store Float • 44029102</option>
                </select>
                <p className="text-[10px] text-slate-400">
                  Electronic receipts verified here will be batched into the End-of-Day dual-custody bank sweep.
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowElectronicModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveElectronicSettlement}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:opacity-95 text-white text-xs font-bold shadow-md flex items-center space-x-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirm Settlement & Sweep</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End of Day (Z-Report) Wizard & Closure Modal */}
      {showEodWizardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base">End-of-Day (Z-Report) Closure</h3>
                  <div className="flex items-center space-x-2 text-xs text-slate-400">
                    <span>Date: <strong className="text-white font-mono">{date}</strong></span>
                    <span>•</span>
                    <span>Branch: <strong className="text-white">{currentUser?.branchName || 'Main Store'}</strong></span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEodWizardModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stepper Tabs */}
            <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-4">
                <div className={`flex items-center space-x-1.5 font-bold ${eodStep === 1 ? 'text-emerald-400' : 'text-slate-500'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${eodStep === 1 ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'}`}>1</span>
                  <span>Pre-Flight Controls</span>
                </div>
                <div className={`flex items-center space-x-1.5 font-bold ${eodStep === 2 ? 'text-emerald-400' : 'text-slate-500'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${eodStep === 2 ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'}`}>2</span>
                  <span>Z-Report & Dual Custody</span>
                </div>
                <div className={`flex items-center space-x-1.5 font-bold ${eodStep === 3 ? 'text-emerald-400' : 'text-slate-500'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${eodStep === 3 ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'}`}>3</span>
                  <span>Audit Certificate</span>
                </div>
              </div>
            </div>

            {/* Step Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* STEP 1: PRE-FLIGHT AUDIT CHECKLIST */}
              {eodStep === 1 && (
                <div className="space-y-3.5">
                  <p className="text-slate-300 leading-relaxed">
                    Accounting standards require all operational controls, supervisor approvals, and physical count reconciliations to pass before locking the business day ledger.
                  </p>

                  <div className="space-y-2">
                    {/* Control 1: Supervisor Approvals Gatekeeper */}
                    <div className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                      pendingApprovals.totalCount === 0
                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                        : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        {pendingApprovals.totalCount === 0 ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-bold text-white text-xs">Supervisor Authorization Gatekeeper</div>
                          <div className="text-[11px] text-slate-300">
                            Direct GRVs ({pendingApprovals.directGrvs.length}), Expenses ({pendingApprovals.expenses.length}), Shop Use ({pendingApprovals.shopUse.length})
                          </div>
                        </div>
                      </div>
                      <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded-full ${
                        pendingApprovals.totalCount === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/30 text-rose-300'
                      }`}>
                        {pendingApprovals.totalCount === 0 ? 'Passed (0 Pending)' : `BLOCKED (${pendingApprovals.totalCount} Pending)`}
                      </span>
                    </div>

                    {/* Control 2: Till Cash Physical Counts */}
                    <div className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                      summaryTotals.totalPhysicalCount !== null
                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                        : 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <Coins className="w-5 h-5 text-emerald-400 shrink-0" />
                        <div>
                          <div className="font-bold text-white text-xs">Physical Till Drawer Counts (Form 1)</div>
                          <div className="text-[11px] text-slate-300">
                            Counted: ${summaryTotals.totalPhysicalCount !== null ? summaryTotals.totalPhysicalCount.toFixed(2) : '0.00'} | Variance: ${summaryTotals.totalVariance.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                        {summaryTotals.totalPhysicalCount !== null ? 'Count Recorded' : 'Needs Review'}
                      </span>
                    </div>

                    {/* Control 3: Electronic Settlements */}
                    <div className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                      isElectronicSettled || (summaryTotals.totalEcocashSales === 0 && summaryTotals.totalZigSales === 0)
                        ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                        : 'bg-indigo-950/30 border-indigo-500/40 text-indigo-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <CreditCard className="w-5 h-5 text-indigo-400 shrink-0" />
                        <div>
                          <div className="font-bold text-white text-xs">Mobile Money & Electronic Settlement</div>
                          <div className="text-[11px] text-slate-300">
                            EcoCash: ${summaryTotals.totalEcocashSales.toFixed(2)} | ZiG Swipe: ${summaryTotals.totalZigSales.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                        {isElectronicSettled ? 'Settled & Verified' : 'Ready for Sweep'}
                      </span>
                    </div>

                    {/* Control 4: Safe Vault Sweeps */}
                    <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-slate-300">
                      <div className="flex items-center space-x-3">
                        <Lock className="w-5 h-5 text-amber-400 shrink-0" />
                        <div>
                          <div className="font-bold text-white text-xs">Safe Vault Cash Sweep</div>
                          <div className="text-[11px] text-slate-400">
                            Surplus above retained float swept into Branch Safe vault
                          </div>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                        {totalAvailableSurplus > 0 ? `$${totalAvailableSurplus.toFixed(2)} available` : 'Completed / Zero Surplus'}
                      </span>
                    </div>
                  </div>

                  {pendingApprovals.totalCount > 0 && (
                    <div className="p-3 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-rose-200 flex items-start space-x-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="text-[11px] leading-relaxed">
                        <strong>Day Closure Blocker:</strong> You cannot run End of Day while {pendingApprovals.totalCount} cashier activity awaits supervisor authorization. Click below to review and approve/reject them.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: STORE MASTER Z-REPORT & DUAL CUSTODY */}
              {eodStep === 2 && (
                <div className="space-y-4">
                  {/* Master Z-Report Summary Table */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-bold text-white text-xs uppercase tracking-wider">Store Master Z-Report • Financial Ledger</span>
                      <span className="font-mono text-[10px] text-slate-400">BRANCH: {currentUser?.branchId || 'BR-MAIN'}</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Gross Sales</div>
                        <div className="text-sm font-black text-white font-mono-num">${summaryTotals.totalSales.toFixed(2)}</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">Cash Sales (USD)</div>
                        <div className="text-sm font-black text-emerald-400 font-mono-num">${summaryTotals.totalCashSales.toFixed(2)}</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">EcoCash Sales</div>
                        <div className="text-sm font-black text-blue-400 font-mono-num">${summaryTotals.totalEcocashSales.toFixed(2)}</div>
                      </div>
                      <div className="p-2 rounded-xl bg-slate-900 border border-slate-800">
                        <div className="text-[10px] text-slate-400">ZiG Swipe Sales</div>
                        <div className="text-sm font-black text-amber-400 font-mono-num">${summaryTotals.totalZigSales.toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1">
                      <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                        <div className="text-slate-400 text-[10px]">Till Cash Deductions</div>
                        <div className="flex justify-between font-mono-num">
                          <span>Direct GRVs:</span>
                          <span className="text-rose-400 font-bold">${summaryTotals.totalDirectProcurements.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-mono-num">
                          <span>Expenses:</span>
                          <span className="text-rose-400 font-bold">${summaryTotals.totalExpenses.toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                        <div className="text-slate-400 text-[10px]">Till Cash Position</div>
                        <div className="flex justify-between font-mono-num">
                          <span>Expected Cash:</span>
                          <span className="text-white font-bold">${summaryTotals.totalExpectedCash.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between font-mono-num">
                          <span>Physical Count:</span>
                          <span className="text-emerald-400 font-bold">${(summaryTotals.totalPhysicalCount ?? 0).toFixed(2)}</span>
                        </div>
                      </div>

                      <div className={`p-2.5 rounded-xl border space-y-1 ${
                        Math.abs(summaryTotals.totalVariance) < 0.01
                          ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                          : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                      }`}>
                        <div className="text-[10px] font-bold">Register Variance</div>
                        <div className="text-base font-black font-mono-num">
                          {summaryTotals.totalVariance >= 0 ? `+$${summaryTotals.totalVariance.toFixed(2)}` : `-$${Math.abs(summaryTotals.totalVariance).toFixed(2)}`}
                        </div>
                        <div className="text-[10px]">
                          {Math.abs(summaryTotals.totalVariance) < 0.01 ? 'Perfect Zero Variance' : 'Variance Audit Logged'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Authorization Section: Configurable Single vs Dual Mode */}
                  <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-indigo-500/20 pb-2">
                      <div className="flex items-center space-x-2 text-indigo-300 font-bold text-xs">
                        {eodVerificationMode === 'DUAL' ? (
                          <Lock className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        )}
                        <span>
                          {eodVerificationMode === 'DUAL'
                            ? 'Dual-Custody Authorization (Supervisor + Manager)'
                            : 'Single Authorized Sign-off (Supervisor / Manager)'}
                        </span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          eodVerificationMode === 'DUAL' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-emerald-500/20 text-emerald-300'
                        }`}>
                          {eodVerificationMode === 'DUAL' ? 'Dual Mode' : 'Single (Default)'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const nextMode = eodVerificationMode === 'SINGLE' ? 'DUAL' : 'SINGLE';
                          setEodVerificationMode(nextMode);
                          saveCompanyBranchSettings({ eodVerificationMode: nextMode });
                        }}
                        className="text-[11px] font-bold text-indigo-200 hover:text-white px-2.5 py-1 rounded-xl bg-indigo-900/80 hover:bg-indigo-800 border border-indigo-600/50 transition cursor-pointer self-start sm:self-auto"
                      >
                        {eodVerificationMode === 'DUAL' ? 'Switch to Single Sign-off' : 'Switch to Dual-Custody'}
                      </button>
                    </div>

                    {eodVerificationMode === 'DUAL' ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Supervisor Custodian</label>
                            <input
                              type="text"
                              disabled
                              value={`${currentUser.name} (${currentUser.role})`}
                              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold opacity-80"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Manager / Owner Name</label>
                            <input
                              type="text"
                              value={eodManagerName}
                              onChange={(e) => setEodManagerName(e.target.value)}
                              placeholder="e.g. Store Manager / Owner"
                              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Manager / Owner Dual-Custody PIN *</label>
                            <input
                              type="password"
                              value={eodManagerPin}
                              onChange={(e) => {
                                setEodManagerPin(e.target.value);
                                setEodErrorMessage(null);
                              }}
                              placeholder="Enter Manager/Owner PIN..."
                              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-sm focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">EOD Closure Notes & Observations</label>
                            <input
                              type="text"
                              value={eodNotes}
                              onChange={(e) => setEodNotes(e.target.value)}
                              placeholder="e.g. Regular shift closure, all floats counted and locked."
                              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs"
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Authorized Staff Sign-off</label>
                            <input
                              type="text"
                              disabled
                              value={`${currentUser.name} (${currentUser.role})`}
                              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold opacity-80"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">Staff Authorization PIN (Optional)</label>
                            <input
                              type="password"
                              value={eodSupervisorPin}
                              onChange={(e) => {
                                setEodSupervisorPin(e.target.value);
                                setEodErrorMessage(null);
                              }}
                              placeholder="Enter your authorization PIN..."
                              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-sm focus:ring-2 focus:ring-emerald-500"
                            />
                          </div>
                        </div>

                        <div className="pt-1">
                          <label className="block text-[11px] text-slate-400 mb-1">EOD Closure Notes & Observations</label>
                          <input
                            type="text"
                            value={eodNotes}
                            onChange={(e) => setEodNotes(e.target.value)}
                            placeholder="e.g. Shift closed smoothly, all registers reconciled."
                            className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-xs"
                          />
                        </div>
                      </>
                    )}

                    {eodErrorMessage && (
                      <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/40 text-rose-300 text-xs font-bold">
                        {eodErrorMessage}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 3: AUDIT CERTIFICATE & BACKUP SUMMARY */}
              {eodStep === 3 && (
                <div className="space-y-4 text-center py-2">
                  <div className="w-14 h-14 rounded-3xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>

                  <div>
                    <h4 className="text-lg font-black text-white">Business Day Closed & Locked</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Master Z-Report finalized under {eodVerificationMode === 'DUAL' ? 'dual-custody' : 'authorized sign-off'}. Day-lock released for subsequent trading.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Closure Reference:</span>
                      <span className="font-mono font-bold text-white">{completedEodRecord?.id || closedDay?.id || `EOD-${date}`}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Closed At:</span>
                      <span className="text-white">{new Date(completedEodRecord?.closedAt || closedDay?.closedAt || Date.now()).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Supervisor Sign-off:</span>
                      <span className="text-emerald-400 font-bold">{completedEodRecord?.closedBySupervisorName || closedDay?.closedBySupervisorName || currentUser.name}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Manager Sign-off:</span>
                      <span className="text-indigo-400 font-bold">{completedEodRecord?.closedByManagerName || closedDay?.closedByManagerName || 'Manager'}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Automatic Backup:</span>
                      <span className="font-mono text-[11px] text-amber-300">{completedEodRecord?.backupFileName || closedDay?.backupFileName || 'EOD_BACKUP_AUTO.json'}</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs text-left flex items-start space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>Automated Backup Dispatched:</strong> An encrypted EOD database snapshot was automatically saved to your downloads and synced to the Local Hub.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
              {eodStep === 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowEodWizardModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  {pendingApprovals.totalCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setShowEodWizardModal(false);
                        setShowApprovalsDrawer(true);
                      }}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md"
                    >
                      <span>Review {pendingApprovals.totalCount} Authorizations First</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEodStep(2)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md"
                    >
                      <span>Proceed to Z-Report Summary →</span>
                    </button>
                  )}
                </>
              )}

              {eodStep === 2 && (
                <>
                  <button
                    type="button"
                    onClick={() => setEodStep(1)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700"
                  >
                    ← Back to Controls
                  </button>
                  <button
                    type="button"
                    disabled={isClosingEod}
                    onClick={handleExecuteEodClosure}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 via-indigo-600 to-purple-600 hover:opacity-95 text-white font-black text-xs flex items-center space-x-2 shadow-lg disabled:opacity-50"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{isClosingEod ? 'Locking Business Day...' : 'Authorize & Lock Business Day (Z-Report)'}</span>
                  </button>
                </>
              )}

              {eodStep === 3 && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const payload = await databaseBackupService.generateDatabasePayload('EOD_HANDOVER');
                      const contentStr = JSON.stringify(payload, null, 2);
                      databaseBackupService.downloadBackupFileToDevice(
                        completedEodRecord?.backupFileName || closedDay?.backupFileName || `EOD_BACKUP_${date}.json`,
                        contentStr
                      );
                    }}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center space-x-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-amber-400" />
                    <span>Re-download Backup File</span>
                  </button>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center space-x-1.5"
                    >
                      <Printer className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Print Z-Report</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEodWizardModal(false)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md"
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {/* Form 4 Dedicated Password Configuration Modal */}
      {showPasswordSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center font-bold">
                  <KeyRound className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-white text-sm">Form 4 Audit Password</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordSetupModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Set a dedicated password for End-of-Day Shift Balancing (Z-Report). Leave empty to allow any authorized manager to unlock via PIN.
            </p>
            <div>
              <input
                type="password"
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder="Enter new audit password..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPasswordSetupModal(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  saveCompanyBranchSettings({ form4AuditPassword: newPasswordInput.trim() });
                  setShowPasswordSetupModal(false);
                  alert('Form 4 Audit Password updated successfully!');
                }}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold"
              >
                Save Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
