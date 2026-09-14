import React, { useState, useMemo, useEffect } from 'react';
import {
  Salesperson,
  ExpenseEntry,
  Customer,
  AdminSalesEntry,
  ShiftReconciliation,
} from '../../types';
import {
  getSalespeople,
  getCashLogs,
  getCustomerChanges,
  getCreditSales,
  getCashCounts,
  getAdminSales,
  saveAllAdminSalesEntries,
  saveAdminSalesEntry,
  calculateSalespersonCashBalancing,
  getExpenses,
  addExpense,
  getTodayDateString,
  subscribeToDatabase,
} from '../../db/roomDatabase';
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
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { FormStepNavigation } from '../common/FormStepNavigation';

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
  // If user is not an administrator, block access
  if (currentUser.role !== 'Admin') {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-4 max-w-lg mx-auto my-8">
        <div className="w-14 h-14 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto text-2xl font-bold">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-white">Administrator Access Required</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Form 4 (Salesperson Cash Balancing & Reconciliation) is strictly restricted to Administrator accounts.
          Non-admin staff members cannot view or manage balancing records.
        </p>
      </div>
    );
  }

  // Active view tab
  const [activeTab, setActiveTab] = useState<'balancing' | 'expenses' | 'history'>('balancing');
  const [date, setDate] = useState<string>(() => getTodayDateString());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'BALANCED' | 'DISCREPANCY' | 'ACTIVE'>('ALL');

  // Local state for editable sales amounts per salesperson { staffId: salesAmountString }
  const [salesInputs, setSalesInputs] = useState<Record<string, string>>({});
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [saveSuccessBanner, setSaveSuccessBanner] = useState<string | null>(null);

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

  // Subscribe to DB changes
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setSalespeople(getSalespeople());
      setExpenses(getExpenses());
    });
    return () => unsub();
  }, []);

  // Initialize or update sales inputs whenever date or admin sales change
  useEffect(() => {
    const adminSales = getAdminSales().filter((s) => s.date === date);
    const initialMap: Record<string, string> = {};
    adminSales.forEach((s) => {
      initialMap[s.staffId] = s.salesAmount.toString();
    });
    setSalesInputs(initialMap);
    setSaveSuccessBanner(null);
  }, [date]);

  // Calculate balancing metrics for all active salespeople on selected date
  const balancingData = useMemo(() => {
    return salespeople.map((staff) => {
      const rawInput = salesInputs[staff.id];
      const parsedSales = rawInput !== undefined && rawInput.trim() !== '' ? parseFloat(rawInput) || 0 : undefined;
      return calculateSalespersonCashBalancing(staff.id, staff.name, date, parsedSales);
    });
  }, [salespeople, date, salesInputs]);

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
    let totalVariance = 0;
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
      totalVariance += r.variance;

      if (r.hasActivity) countActive++;
      if (r.status === 'Balanced') countBalanced++;
      if (r.status === 'Shortage') countShortage++;
      if (r.status === 'Over') countOver++;
    });

    return {
      totalForm2Net,
      totalForm3Net,
      totalSumForm2And3Net,
      totalSales,
      totalShouldHave,
      totalVariance,
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
        };
      });

      saveAllAdminSalesEntries(date, entriesToSave);

      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6A4DFF', '#FF8A00', '#10B981'],
      });

      setSaveSuccessBanner(`All sales figures and cash balancing records for ${date} have been saved successfully!`);
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
    const staff = salespeople.find((s) => s.id === auditStaffId);
    if (!staff) return null;

    const row = balancingData.find((b) => b.staffId === auditStaffId);
    const form2Logs = getCashLogs().filter((l) => l.staffId === auditStaffId && l.date === date);
    const form3Changes = getCustomerChanges().filter((c) => c.staffId === auditStaffId && c.date === date);
    const form3Credits = getCreditSales().filter((c) => c.staffId === auditStaffId && c.date === date);
    const form1Count = getCashCounts().find((c) => c.staffId === auditStaffId && c.date === date);

    return {
      staff,
      row,
      form2Logs,
      form3Changes,
      form3Credits,
      form1Count,
    };
  }, [auditStaffId, salespeople, balancingData, date]);

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
      'External_Sales',
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

      {/* Top Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white shadow-md">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-black text-white tracking-tight">Form 4: Salesperson Cash Balancing</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  ADMIN ONLY
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Reconciliation Sheet • Sum of Form 2 & 3 Net vs External System Sales & Variance Audit
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
              id="btn-export-csv-form4"
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold flex items-center space-x-1.5 transition"
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
          {/* Key Formula Explanation Banner */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-950/40 via-slate-900 to-orange-950/30 border border-purple-500/20 text-xs">
            <div className="flex items-center space-x-1.5 text-purple-300 font-bold uppercase tracking-wider text-[11px] mb-1">
              <Sparkles className="w-3.5 h-3.5 text-[#FF8A00]" />
              <span>Form 4 Core Balancing Formulas</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-slate-300">
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-purple-300 font-bold">1. Sum of Form 2 & 3 Net:</span>
                <p className="text-[11px] text-slate-400 font-mono-num mt-0.5">
                  (Form 2 Cash Log Net) + (Form 3 Change & Credit Net)
                </p>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-indigo-300 font-bold">2. Should Have Column:</span>
                <p className="text-[11px] text-slate-400 font-mono-num mt-0.5">
                  Net of Form 2 + Net of Form 3 + Sales
                </p>
              </div>
              <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-[#FF8A00] font-bold">3. Variance Column:</span>
                <p className="text-[11px] text-slate-400 font-mono-num mt-0.5">
                  0 - Should Have
                </p>
              </div>
            </div>
          </div>

          {/* Metric KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Total Sum of Form 2 & 3 Net */}
            <div className="bg-slate-900/80 border border-purple-500/30 rounded-2xl p-3.5 shadow-md space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Sum Form 2 & 3 Net</span>
                <Coins className="w-4 h-4 text-[#6A4DFF]" />
              </div>
              <div className="text-lg sm:text-xl font-black font-mono-num text-white">
                ${summaryTotals.totalSumForm2And3Net.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400 flex justify-between">
                <span>F2: ${summaryTotals.totalForm2Net.toFixed(2)}</span>
                <span>F3: ${summaryTotals.totalForm3Net.toFixed(2)}</span>
              </div>
            </div>

            {/* Card 2: Total External Sales Entered */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>External System Sales</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-lg sm:text-xl font-black font-mono-num text-emerald-400">
                ${summaryTotals.totalSales.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">
                Admin entered for {summaryTotals.totalStaffCount} salespeople
              </div>
            </div>

            {/* Card 3: Total Should Have */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 shadow-md space-y-1">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Total Should Have</span>
                <TrendingUp className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-lg sm:text-xl font-black font-mono-num text-white">
                ${summaryTotals.totalShouldHave.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">
                (Sum 2&3 Net) + Sales
              </div>
            </div>

            {/* Card 4: Total Variance & Balancing Status */}
            <div
              className={`border rounded-2xl p-3.5 shadow-md space-y-1 ${
                Math.abs(summaryTotals.totalVariance) < 0.01
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                  : summaryTotals.totalVariance < 0
                  ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                  : 'bg-purple-950/30 border-purple-500/40 text-purple-300'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">Total Variance</span>
                <Scale className="w-4 h-4" />
              </div>
              <div className="text-lg sm:text-xl font-black font-mono-num">
                {summaryTotals.totalVariance >= 0 ? `+$${summaryTotals.totalVariance.toFixed(2)}` : `-$${Math.abs(summaryTotals.totalVariance).toFixed(2)}`}
              </div>
              <div className="text-[10px] font-bold flex justify-between">
                <span>{summaryTotals.countBalanced} Balanced</span>
                {summaryTotals.countShortage > 0 && <span className="text-rose-400">{summaryTotals.countShortage} Short</span>}
                {summaryTotals.countOver > 0 && <span className="text-orange-400">{summaryTotals.countOver} Over</span>}
              </div>
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
                    <th className="py-3 px-3.5">Sales Person</th>
                    <th className="py-3 px-3 text-right">Form 2 Net</th>
                    <th className="py-3 px-3 text-right">Form 3 Net</th>
                    <th className="py-3 px-3.5 text-right bg-purple-950/40 text-purple-300 font-black border-x border-purple-900/40">
                      Sum of Form 2 & 3 Net
                    </th>
                    <th className="py-3 px-3.5 text-center bg-emerald-950/30 text-emerald-300 font-black">
                      Sales (External System) *
                    </th>
                    <th className="py-3 px-3.5 text-right text-indigo-300 font-black">
                      Should Have
                    </th>
                    <th className="py-3 px-3.5 text-center font-black">
                      Variance
                    </th>
                    <th className="py-3 px-3 text-center">Audit</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/80 font-medium text-slate-200">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        No salesperson matches the selected filter for {date}.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const inputVal = salesInputs[row.staffId] !== undefined ? salesInputs[row.staffId] : '';
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
                          {/* 1. Sales Person Name & ID */}
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

                          {/* 2. Form 2 Net */}
                          <td className="py-3 px-3 text-right">
                            <span className="font-mono-num font-bold text-white block">
                              ${row.form2Net.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono-num block">
                              +${row.form2In.toFixed(0)} / -${row.form2Out.toFixed(0)}
                            </span>
                          </td>

                          {/* 3. Form 3 Net */}
                          <td className="py-3 px-3 text-right">
                            <span className="font-mono-num font-bold text-white block">
                              ${row.form3Net.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono-num block">
                              +${row.form3In.toFixed(0)} / -${row.form3Out.toFixed(0)}
                            </span>
                          </td>

                          {/* 4. Sum of Form 2 & 3 Net */}
                          <td className="py-3 px-3.5 text-right bg-purple-950/20 border-x border-purple-900/30">
                            <span className="font-mono-num font-black text-sm text-[#FF8A00] block">
                              ${row.sumForm2And3Net.toFixed(2)}
                            </span>
                            <span className="text-[9px] text-purple-300 font-mono-num block">
                              (F2: {row.form2Net >= 0 ? '+' : ''}${row.form2Net.toFixed(0)} + F3: {row.form3Net >= 0 ? '+' : ''}${row.form3Net.toFixed(0)})
                            </span>
                          </td>

                          {/* 5. Sales (Editable Input) */}
                          <td className="py-2.5 px-3.5 bg-emerald-950/15 text-center">
                            <div className="relative max-w-[140px] mx-auto">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold font-mono-num">
                                $
                              </span>
                              <input
                                id={`input-sales-${row.staffId}`}
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={inputVal}
                                onChange={(e) => handleSalesInputChange(row.staffId, e.target.value)}
                                className="w-full pl-6 pr-2.5 py-1.5 bg-slate-950 border border-slate-700 focus:border-[#FF8A00] focus:ring-1 focus:ring-[#FF8A00] rounded-xl text-xs font-mono-num font-bold text-emerald-300 text-right outline-none transition"
                              />
                            </div>
                          </td>

                          {/* 6. Should Have Column = (Sum of Form 2 & 3 Net) + Sales */}
                          <td className="py-3 px-3.5 text-right">
                            <span className="font-mono-num font-black text-xs text-indigo-300 block">
                              ${row.shouldHave.toFixed(2)}
                            </span>
                            <span className="text-[9px] text-slate-500 font-mono-num block">
                              ({row.sumForm2And3Net.toFixed(0)} + {row.sales.toFixed(0)})
                            </span>
                          </td>

                          {/* 7. Variance Column = 0 - Should Have */}
                          <td className="py-3 px-3.5 text-center">
                            <div className="inline-flex flex-col items-center">
                              {row.status === 'No Activity' ? (
                                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-bold">
                                  No Activity
                                </span>
                              ) : isBalanced ? (
                                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-black flex items-center space-x-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>Exact Balanced ($0.00)</span>
                                </span>
                              ) : isShortage ? (
                                <span className="px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11px] font-black flex items-center space-x-1">
                                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                                  <span>Shortage (-${Math.abs(row.variance).toFixed(2)})</span>
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-300 text-[11px] font-black flex items-center space-x-1">
                                  <TrendingUp className="w-3 h-3 text-orange-400" />
                                  <span>Cash Over (+${row.variance.toFixed(2)})</span>
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 8. Audit Trail View Button */}
                          <td className="py-3 px-3 text-center">
                            <button
                              id={`btn-audit-staff-${row.staffId}`}
                              type="button"
                              onClick={() => setAuditStaffId(row.staffId)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                              title={`View Audit Trail for ${row.staffName}`}
                            >
                              <Eye className="w-4 h-4 text-[#6A4DFF]" />
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
                      <td className="py-3 px-3 text-right font-mono-num text-white">
                        ${summaryTotals.totalForm2Net.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-white">
                        ${summaryTotals.totalForm3Net.toFixed(2)}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono-num font-black text-sm text-[#FF8A00] bg-purple-950/30 border-x border-purple-900/40">
                        ${summaryTotals.totalSumForm2And3Net.toFixed(2)}
                      </td>
                      <td className="py-3 px-3.5 text-center font-mono-num font-black text-sm text-emerald-300 bg-emerald-950/20">
                        ${summaryTotals.totalSales.toFixed(2)}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono-num font-black text-xs text-indigo-300">
                        ${summaryTotals.totalShouldHave.toFixed(2)}
                      </td>
                      <td className="py-3 px-3.5 text-center font-mono-num font-black text-xs">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs ${
                            Math.abs(summaryTotals.totalVariance) < 0.01
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : summaryTotals.totalVariance < 0
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-orange-500/20 text-orange-300'
                          }`}
                        >
                          {Math.abs(summaryTotals.totalVariance) < 0.01
                            ? '$0.00 Balanced'
                            : summaryTotals.totalVariance < 0
                            ? `-$${Math.abs(summaryTotals.totalVariance).toFixed(2)}`
                            : `+$${summaryTotals.totalVariance.toFixed(2)}`}
                        </span>
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
                  Admin entered figures are automatically stored in the local Room Database and synced.
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleSaveAllSales}
                  disabled={isSavingAll}
                  className="py-2 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white font-black flex items-center space-x-1.5 shadow-md transition"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingAll ? 'Saving Entries...' : 'Save & Confirm All Sales'}</span>
                </button>
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
                Historical records of external sales, Form 2 & Form 3 nets, and variance outcomes
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
                    ${selectedAuditData.row?.form2Net.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Form 3 Net</span>
                  <span className="text-sm font-bold font-mono-num text-white">
                    ${selectedAuditData.row?.form3Net.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-purple-300 block font-bold">Sum 2 & 3 Net</span>
                  <span className="text-sm font-black font-mono-num text-[#FF8A00]">
                    ${selectedAuditData.row?.sumForm2And3Net.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-emerald-300 block font-bold">Sales</span>
                  <span className="text-sm font-bold font-mono-num text-emerald-400">
                    ${selectedAuditData.row?.sales.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-indigo-300 block font-bold">Should Have</span>
                  <span className="text-sm font-black font-mono-num text-indigo-300">
                    ${selectedAuditData.row?.shouldHave.toFixed(2)}
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

              {/* Form 1 Physical Count if available */}
              {selectedAuditData.form1Count && (
                <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <Coins className="w-4 h-4 text-emerald-400" />
                    <span>Form 1 (Physical Cash Count Counted):</span>
                  </div>
                  <span className="font-mono-num font-black text-emerald-300 text-sm">
                    ${selectedAuditData.form1Count.finalCashOutTotal.toFixed(2)}
                  </span>
                </div>
              )}

              {/* Section 1: Form 2 Cash Log Transactions */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
                  <span>Form 2: Cash Log Movements ({selectedAuditData.form2Logs.length})</span>
                  <span className="text-purple-300 font-mono-num font-bold">
                    Net: ${selectedAuditData.row?.form2Net.toFixed(2)}
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
                          {log.in > 0 && <span className="text-emerald-400">+${log.in.toFixed(2)}</span>}
                          {log.out > 0 && <span className="text-rose-400">-${log.out.toFixed(2)}</span>}
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
                    Net: ${(selectedAuditData.row?.changeIn! - selectedAuditData.row?.changeOut!).toFixed(2)}
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
                          ${cr.amount.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
    </div>
  );
};
