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
} from '../../db/roomDatabase';
import { ManagerPinModal } from '../common/ManagerPinModal';
import { getAllMovements, getShiftId, matchesShift, CashMovement } from '../../db/cashLedger';
import { CustomerSearchModal } from '../common/CustomerSearchModal';
import { downloadCsvFile } from '../../services/googleSheetsSync';
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
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { FormStepNavigation } from '../common/FormStepNavigation';
import { DatabaseBackupModal } from '../common/DatabaseBackupModal';
import { DatabaseRestoreModal } from '../common/DatabaseRestoreModal';

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
  const [activeTab, setActiveTab] = useState<'balancing' | 'expenses' | 'history'>('balancing');
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

  // Subscribe to DB changes
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setSalespeople(getSalespeople());
      setExpenses(getExpenses());
      setSalesList(getSales());
    });
    return () => unsub();
  }, []);

  // Initialize or update sales overrides whenever date changes
  useEffect(() => {
    const adminSales = getAdminSales().filter((s) => s.date === date);
    const initialMap: Record<string, string> = {};
    adminSales.forEach((s) => {
      if (s.notes?.includes('Manual Override')) {
        initialMap[s.staffId] = s.salesAmount.toString();
      }
    });
    setSalesInputs(initialMap);
    setEditingStaffId(null);
    setSaveSuccessBanner(null);
  }, [date]);

  // Calculate balancing metrics for all active salespeople on selected date
  const balancingData = useMemo(() => {
    return salespeople.map((staff) => {
      const rawInput = salesInputs[staff.id];
      const parsedSales = rawInput !== undefined && rawInput.trim() !== '' ? parseFloat(rawInput) || 0 : undefined;
      return calculateSalespersonCashBalancing(staff.id, staff.name, date, parsedSales, currentUser?.branchId);
    });
  }, [salespeople, date, salesInputs, salesList, currentUser?.branchId]);

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

    const form2Logs = getCashLogs().filter((l) => l.staffId === auditStaffId && l.date === date);
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
          <div className="flex items-center space-x-2">
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
                    filteredRows.map((row) => {
                      const isBalanced = row.status === 'Balanced';
                      const isShortage = row.status === 'Shortage';
                      const isOver = row.status === 'Over';

                      return (
                        <tr
                          key={row.staffId}
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
                                <span className="font-bold text-white block leading-tight">
                                  {row.staffName}
                                </span>
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

                          {/* 6. Actions (Drill-down) */}
                          <td className="py-3 px-3 text-center">
                            <button
                              id={`btn-audit-staff-${row.staffId}`}
                              type="button"
                              onClick={() => setAuditStaffId(row.staffId)}
                              className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-[11px] font-bold inline-flex items-center space-x-1.5 transition border border-slate-700"
                              title={`Drill-down to see movements for ${row.staffName}`}
                            >
                              <Eye className="w-3.5 h-3.5 text-[#6A4DFF]" />
                              <span>View Movements</span>
                            </button>
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
                    {selectedAuditData.staffMovements.map((mov) => {
                      const isIn = mov.direction === 'in';
                      const isOut = mov.direction === 'out';
                      const timeStr = new Date(mov.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={mov.id}
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
                    {selectedAuditData.form2Logs.map((log) => (
                      <div
                        key={log.id}
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
                    {selectedAuditData.form3Changes.map((chg) => (
                      <div
                        key={chg.id}
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
                    {selectedAuditData.form3Credits.map((cr) => (
                      <div
                        key={cr.id}
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
                    {selectedAuditData.staffSales.map((sale) => (
                      <div
                        key={sale.id}
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
