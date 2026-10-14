import React, { useState, useMemo, useEffect } from 'react';
import { Salesperson, FixedMonthlyCost } from '../types';
import {
  getAllSales,
  getExpenses,
  getBranches,
  getCurrentBranchId,
  getCurrentCompanyId,
  getCompanies,
  getTodayDateString,
  getInventoryItems,
  getProducts,
  subscribeToDatabase,
} from '../db/roomDatabase';
import { resolveItemCost } from '../utils/costResolver';
import {
  getInternalConsumptions,
  getWalletTransfers,
  getOwnerDrawings,
  getWallets,
} from '../services/walletService';
import { getFixedCosts } from '../services/fixedCostsService';
import { calculateProratedFixedCosts } from '../utils/prorateFixedCosts';
import {
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  Layers,
  ArrowRight,
  Printer,
  Download,
  Building,
  CheckCircle2,
  AlertTriangle,
  Scale,
  Wallet,
  Landmark,
  ArrowLeftRight,
  Home,
  Info,
  Sliders,
  Percent,
} from 'lucide-react';

interface IncomeStatementProps {
  currentUser: Salesperson;
  onNavigateToFixedCosts?: () => void;
  onNavigateToWhereIsMyMoney?: () => void;
}

export const IncomeStatement: React.FC<IncomeStatementProps> = ({
  currentUser,
  onNavigateToFixedCosts,
  onNavigateToWhereIsMyMoney,
}) => {
  const today = getTodayDateString();

  // Filter Presets & Dates
  const [datePreset, setDatePreset] = useState<'today' | 'this_week' | 'this_month' | 'last_month' | 'custom'>('this_month');
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [customEndDate, setCustomEndDate] = useState<string>(today);

  // Shop / Branch selection
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [selectedCurrency, setSelectedCurrency] = useState<'USD' | 'ZiG'>('USD');
  const [accountingBasis, setAccountingBasis] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL');
  const [fixedCostsVersion, setFixedCostsVersion] = useState(0);

  useEffect(() => {
    const handleUpdate = () => setFixedCostsVersion((v) => v + 1);
    window.addEventListener('saimetric_fixed_costs_updated', handleUpdate);
    window.addEventListener('saimetric_fixed_cost_categories_updated', handleUpdate);
    window.addEventListener('saimetric_sales_updated', handleUpdate);
    window.addEventListener('saimetric_cash_updated', handleUpdate);
    const unsub = subscribeToDatabase(handleUpdate);
    return () => {
      window.removeEventListener('saimetric_fixed_costs_updated', handleUpdate);
      window.removeEventListener('saimetric_fixed_cost_categories_updated', handleUpdate);
      window.removeEventListener('saimetric_sales_updated', handleUpdate);
      window.removeEventListener('saimetric_cash_updated', handleUpdate);
      unsub();
    };
  }, []);

  const branches = getBranches();
  const currentCompany = getCurrentCompanyId();

  // Compute active date range from preset
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    if (datePreset === 'today') {
      return { startDate: today, endDate: today };
    }
    if (datePreset === 'this_week') {
      const dayOfWeek = now.getDay(); // 0 is Sunday
      const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      const startStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      return { startDate: startStr, endDate: today };
    }
    if (datePreset === 'this_month') {
      const startStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      return { startDate: startStr, endDate: today };
    }
    if (datePreset === 'last_month') {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayOfPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      const startStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;
      const endStr = `${lastDayOfPrev.getFullYear()}-${String(lastDayOfPrev.getMonth() + 1).padStart(2, '0')}-${String(lastDayOfPrev.getDate()).padStart(2, '0')}`;
      return { startDate: startStr, endDate: endStr };
    }
    // Custom
    return {
      startDate: customStartDate || '1970-01-01',
      endDate: customEndDate || '2099-12-31',
    };
  }, [datePreset, customStartDate, customEndDate, today]);

  // Helper date checker
  const isDateInRange = (dateStr?: string, timestamp?: string) => {
    const checkDate = dateStr || (timestamp ? timestamp.slice(0, 10) : '');
    if (!checkDate) return false;
    return checkDate >= startDate && checkDate <= endDate;
  };

  // 1. SALES & COGS CALCULATION
  const {
    revenue,
    cogs,
    grossProfit,
    grossMarginPercent,
    salesCount,
  } = useMemo(() => {
    const allSales = getAllSales();
    const filteredSales = allSales.filter((s) => {
      if (s.status === 'Refunded' || s.status === 'Voided') return false;
      if (!isDateInRange(s.date, s.timestamp)) return false;

      // Currency check
      if (selectedCurrency === 'ZiG') {
        const isZig = (s.currency || '').toUpperCase() === 'ZIG' || (s.paymentMethod || '').toLowerCase().includes('zig');
        if (!isZig) return false;
      }

      // Branch filter
      if (selectedBranchId !== 'ALL') {
        const b = s.branch_id || s.branchId;
        if (b && b !== selectedBranchId) return false;
      }
      return true;
    });

    let rev = 0;
    let costSum = 0;
    const invItems = getInventoryItems();
    const prods = getProducts();

    filteredSales.forEach((sale) => {
      rev += Number(sale.total) || 0;
      if (Array.isArray(sale.items)) {
        sale.items.forEach((item) => {
          const qty = Number(item.quantity) || 1;
          const resolved = resolveItemCost(item, invItems, prods);
          costSum += qty * resolved.avgCost;
        });
      }
    });

    rev = Math.round(rev * 100) / 100;
    costSum = Math.round(costSum * 100) / 100;
    const gp = Math.round((rev - costSum) * 100) / 100;
    const margin = rev > 0 ? Math.round((gp / rev) * 1000) / 10 : 0;

    return {
      revenue: rev,
      cogs: costSum,
      grossProfit: gp,
      grossMarginPercent: margin,
      salesCount: filteredSales.length,
    };
  }, [startDate, endDate, selectedBranchId, selectedCurrency]);

  // 2. VARIABLE EXPENSES CALCULATION
  const {
    expensesByCategory,
    totalExpensesTable,
    internalConsumptionTotal,
    internalConsumptionCostTotal,
    internalConsumptionItems,
    walletChargesTotal,
    totalVariableExpenses,
  } = useMemo(() => {
    // 2a. Expenses table
    const allExpenses = getExpenses().filter((e) => {
      if (e.isDeleted) return false;
      if (e.paymentMethod === 'Non-Cash (Shop Use)' || (e.description && e.description.startsWith('Shop Use /'))) return false;
      if (!isDateInRange(e.date, e.timestamp)) return false;
      if (selectedBranchId !== 'ALL') {
        const b = (e as any).branch_id || (e as any).branchId;
        if (b && b !== selectedBranchId) return false;
      }
      return true;
    });

    const expMap: Record<string, number> = {};
    let expSum = 0;
    allExpenses.forEach((e) => {
      const cat = e.category || 'General Operating';
      const amt = Number(e.amount) || 0;
      expMap[cat] = (expMap[cat] || 0) + amt;
      expSum += amt;
    });

    // 2b. Internal Consumption (Shop Use, Staff Welfare, Owner Groceries)
    const allConsumptions = getInternalConsumptions().filter((c) => {
      if (c.status === 'REJECTED') return false;
      if (!isDateInRange(c.date, c.requestedAt)) return false;
      if (selectedBranchId !== 'ALL') {
        const b = c.branch_id;
        if (b && b !== selectedBranchId) return false;
      }
      return true;
    });

    let icRetail = 0;
    let icCost = 0;
    allConsumptions.forEach((c) => {
      icRetail += Number(c.totalRetail) || 0;
      icCost += Number(c.totalCost) || 0;
    });

    // 2c. Wallet Charges (Bank charge, EcoCash charge, Shop use fee)
    const allTransfers = getWalletTransfers().filter((t) => {
      if (!isDateInRange(t.date, t.timestamp)) return false;
      if (selectedBranchId !== 'ALL') {
        const b = t.branch_id;
        if (b && b !== selectedBranchId) return false;
      }
      return true;
    });

    const chargesSum = allTransfers.reduce((sum, t) => sum + (Number(t.bankCharge) || 0), 0);

    const totalVar = Math.round((expSum + icCost + chargesSum) * 100) / 100;

    return {
      expensesByCategory: expMap,
      totalExpensesTable: Math.round(expSum * 100) / 100,
      internalConsumptionTotal: Math.round(icRetail * 100) / 100,
      internalConsumptionCostTotal: Math.round(icCost * 100) / 100,
      internalConsumptionItems: allConsumptions,
      walletChargesTotal: Math.round(chargesSum * 100) / 100,
      totalVariableExpenses: totalVar,
    };
  }, [startDate, endDate, selectedBranchId]);

  // 3. FIXED COSTS CALCULATION (Accrual Proration vs Cash Basis)
  const {
    fixedCostsBreakdown,
    totalFixedCosts,
  } = useMemo(() => {
    const allFixed = getFixedCosts(currentCompany, selectedBranchId);

    if (accountingBasis === 'CASH') {
      // Cash basis: only show fixed costs where actual payment was recorded in expenses table
      const expList = getExpenses().filter((e) => isDateInRange(e.date, e.timestamp) && !e.isDeleted);
      const matchedItems = allFixed.map((fc) => {
        const paid = expList
          .filter((e) => (e.category && e.category.toLowerCase().includes(fc.category.toLowerCase())) || e.description?.toLowerCase().includes(fc.name.toLowerCase()))
          .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        return {
          cost: fc,
          monthlyAmount: fc.monthly_amount,
          dailyRate: 0,
          overlapDays: 0,
          daysInMonth: 0,
          proratedAmount: paid,
          formulaDisplay: `${fc.name} (Actual Cash Paid: $${paid.toFixed(2)})`,
        };
      });
      const totalPaid = matchedItems.reduce((sum, i) => sum + i.proratedAmount, 0);
      return {
        fixedCostsBreakdown: matchedItems,
        totalFixedCosts: Math.round(totalPaid * 100) / 100,
      };
    }

    // Accrual basis: Prorate using daily calendar rate like QuickBooks
    const result = calculateProratedFixedCosts(allFixed, startDate, endDate, selectedCurrency);
    return {
      fixedCostsBreakdown: result.items,
      totalFixedCosts: result.totalProratedAmount,
    };
  }, [startDate, endDate, selectedBranchId, selectedCurrency, accountingBasis, currentCompany, fixedCostsVersion]);

  // 4. TOTAL EXPENSES, NET PROFIT & OWNER DRAWINGS
  const {
    totalAllExpenses,
    netProfitBeforeDrawings,
    netMarginPercent,
    ownerDrawingsTotal,
    ownerGroceriesCost,
    totalOwnerDrawingsAndSupport,
    finalTrueNetProfit,
  } = useMemo(() => {
    const totalExp = Math.round((totalVariableExpenses + totalFixedCosts) * 100) / 100;
    const netBefore = Math.round((grossProfit - totalExp) * 100) / 100;
    const netMargin = revenue > 0 ? Math.round((netBefore / revenue) * 1000) / 10 : 0;

    // Owner Drawings from Wallet drawings
    const drawingsList = getOwnerDrawings().filter((d) => {
      if (!isDateInRange(d.date, d.timestamp)) return false;
      if (selectedBranchId !== 'ALL') {
        const b = d.branch_id;
        if (b && b !== selectedBranchId) return false;
      }
      return true;
    });
    const cashDrawings = drawingsList.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

    // Owner Groceries taken from internal consumption
    const ownerConsumptions = internalConsumptionItems.filter(
      (c) => c.type === 'OWNER_DRAWING_GROCERIES'
    );
    const groceriesCost = ownerConsumptions.reduce((sum, c) => sum + (Number(c.totalCost) || 0), 0);

    const totalDrawings = Math.round((cashDrawings + groceriesCost) * 100) / 100;
    const finalNet = Math.round((netBefore - totalDrawings) * 100) / 100;

    return {
      totalAllExpenses: totalExp,
      netProfitBeforeDrawings: netBefore,
      netMarginPercent: netMargin,
      ownerDrawingsTotal: Math.round(cashDrawings * 100) / 100,
      ownerGroceriesCost: Math.round(groceriesCost * 100) / 100,
      totalOwnerDrawingsAndSupport: totalDrawings,
      finalTrueNetProfit: finalNet,
    };
  }, [grossProfit, totalVariableExpenses, totalFixedCosts, revenue, startDate, endDate, selectedBranchId, internalConsumptionItems]);

  // 5. MULTI-WALLET RECONCILIATION SUMMARY
  const wallets = getWallets();

  // Print report
  const handlePrint = () => {
    window.print();
  };

  // CSV Export
  const handleExportCSV = () => {
    const lines = [
      `SAIMETRIC P&L STATEMENT / TRUE PROFIT REPORT`,
      `Period,${startDate} to ${endDate} (${accountingBasis} Basis)`,
      `Currency,${selectedCurrency}`,
      `Branch,${selectedBranchId}`,
      ``,
      `FINANCIAL SUMMARY`,
      `Gross Revenue,$${revenue.toFixed(2)}`,
      `Cost of Goods Sold (COGS),-$${cogs.toFixed(2)}`,
      `Gross Profit,$${grossProfit.toFixed(2)} (${grossMarginPercent}% margin)`,
      ``,
      `VARIABLE OPERATING EXPENSES`,
      `Store Operating Expenses,$${totalExpensesTable.toFixed(2)}`,
      `Staff Welfare / Shop Use Cost,$${internalConsumptionCostTotal.toFixed(2)}`,
      `Bank & Electronic Charges,$${walletChargesTotal.toFixed(2)}`,
      `Total Variable Expenses,$${totalVariableExpenses.toFixed(2)}`,
      ``,
      `MONTHLY FIXED OVERHEADS (${accountingBasis})`,
      ...fixedCostsBreakdown.map((f) => `"${f.formulaDisplay}",$${f.proratedAmount.toFixed(2)}`),
      `Total Fixed Overheads,$${totalFixedCosts.toFixed(2)}`,
      ``,
      `NET PROFIT BEFORE OWNER DRAWINGS,$${netProfitBeforeDrawings.toFixed(2)} (${netMarginPercent}% net margin)`,
      `Less Owner Cash Drawings,-$${ownerDrawingsTotal.toFixed(2)}`,
      `Less Owner Groceries (at cost),-$${ownerGroceriesCost.toFixed(2)}`,
      `FINAL TRUE NET PROFIT,$${finalTrueNetProfit.toFixed(2)}`,
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PL_Statement_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Bar Chart Heights (Relative percentage of revenue or highest value)
  const maxBarVal = Math.max(revenue, cogs, totalVariableExpenses, totalFixedCosts, Math.abs(netProfitBeforeDrawings), 1);
  const getBarHeight = (val: number) => {
    return Math.max(8, Math.min(100, Math.round((Math.abs(val) / maxBarVal) * 100)));
  };

  return (
    <div className="space-y-6 pb-28 animate-fadeIn text-white">
      {/* Top Banner & Control Bar */}
      <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 border border-emerald-600/40 rounded-3xl p-5 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-md">
              <DollarSign className="w-6 h-6 font-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-white tracking-tight">Income Statement &amp; True Profit</h1>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/30">
                  {accountingBasis === 'ACCRUAL' ? 'Accrual (Prorated)' : 'Cash Basis'}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                True net profit report accounting for COGS, operating costs, and monthly fixed overheads prorated to period.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onNavigateToFixedCosts && (
            <button
              type="button"
              onClick={onNavigateToFixedCosts}
              className="py-2 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold border border-slate-700 shadow flex items-center gap-1.5 transition cursor-pointer"
            >
              <Building className="w-3.5 h-3.5" />
              <span>Configure Fixed Costs</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCSV}
            className="py-2 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 shadow flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV Export</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="py-2 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 shadow flex items-center gap-1.5 transition cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Filter Matrix Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>Period:</span>
            </span>
            {(['today', 'this_week', 'this_month', 'last_month', 'custom'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDatePreset(preset)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  datePreset === preset
                    ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {preset === 'today'
                  ? 'Today'
                  : preset === 'this_week'
                  ? 'This Week'
                  : preset === 'this_month'
                  ? 'This Month'
                  : preset === 'last_month'
                  ? 'Last Month'
                  : 'Custom Range'}
              </button>
            ))}
          </div>

          {/* Basis Toggle: Cash vs Accrual */}
          <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <span className="text-[10px] text-slate-400 font-bold px-2">Basis:</span>
            <button
              type="button"
              onClick={() => setAccountingBasis('ACCRUAL')}
              className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                accountingBasis === 'ACCRUAL'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Accrual (Prorated)
            </button>
            <button
              type="button"
              onClick={() => setAccountingBasis('CASH')}
              className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                accountingBasis === 'CASH'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Cash Basis
            </button>
          </div>
        </div>

        {/* Secondary Filters row */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800/80 text-xs">
          {/* Custom Date Pickers if active */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400">From:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1 text-white text-xs"
              />
              <span className="text-slate-400">To:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1 text-white text-xs"
              />
            </div>
          )}

          {/* Branch / Shop Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold">Branch:</span>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1 text-white text-xs font-bold"
            >
              <option value="ALL">All Branches Combined</option>
              {branches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>

          {/* Currency */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-bold">Currency:</span>
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value as any)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1 text-white text-xs font-bold"
            >
              <option value="USD">USD ($)</option>
              <option value="ZiG">ZiG (Zimbabwe Gold)</option>
            </select>
          </div>

          <div className="ml-auto text-[11px] text-slate-400 font-mono">
            Active Span: <strong className="text-emerald-400">{startDate}</strong> to <strong className="text-emerald-400">{endDate}</strong>
          </div>
        </div>
      </div>

      {/* Visual Analytics Bar Chart: Revenue vs COGS vs Variable vs Fixed vs Net */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
              Income &amp; Expense Velocity Chart
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            Scale: Max ${maxBarVal.toFixed(2)}
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2 sm:gap-4 pt-4 pb-2 items-end h-40 border-b border-slate-800">
          {/* Bar 1: Revenue */}
          <div className="flex flex-col items-center h-full justify-end group">
            <span className="text-[10px] font-mono font-bold text-emerald-300 mb-1 group-hover:scale-105 transition">
              ${revenue.toFixed(0)}
            </span>
            <div
              style={{ height: `${getBarHeight(revenue)}%` }}
              className="w-full max-w-[48px] bg-gradient-to-t from-emerald-600 to-teal-400 rounded-t-xl transition-all shadow"
            />
            <span className="text-[10px] font-bold text-slate-400 mt-2 truncate max-w-full">
              Revenue
            </span>
          </div>

          {/* Bar 2: COGS */}
          <div className="flex flex-col items-center h-full justify-end group">
            <span className="text-[10px] font-mono font-bold text-amber-300 mb-1 group-hover:scale-105 transition">
              ${cogs.toFixed(0)}
            </span>
            <div
              style={{ height: `${getBarHeight(cogs)}%` }}
              className="w-full max-w-[48px] bg-gradient-to-t from-amber-600 to-yellow-400 rounded-t-xl transition-all shadow"
            />
            <span className="text-[10px] font-bold text-slate-400 mt-2 truncate max-w-full">
              COGS
            </span>
          </div>

          {/* Bar 3: Variable */}
          <div className="flex flex-col items-center h-full justify-end group">
            <span className="text-[10px] font-mono font-bold text-rose-300 mb-1 group-hover:scale-105 transition">
              ${totalVariableExpenses.toFixed(0)}
            </span>
            <div
              style={{ height: `${getBarHeight(totalVariableExpenses)}%` }}
              className="w-full max-w-[48px] bg-gradient-to-t from-rose-600 to-pink-500 rounded-t-xl transition-all shadow"
            />
            <span className="text-[10px] font-bold text-slate-400 mt-2 truncate max-w-full">
              Variable
            </span>
          </div>

          {/* Bar 4: Fixed Prorated */}
          <div className="flex flex-col items-center h-full justify-end group">
            <span className="text-[10px] font-mono font-bold text-indigo-300 mb-1 group-hover:scale-105 transition">
              ${totalFixedCosts.toFixed(0)}
            </span>
            <div
              style={{ height: `${getBarHeight(totalFixedCosts)}%` }}
              className="w-full max-w-[48px] bg-gradient-to-t from-indigo-600 to-purple-500 rounded-t-xl transition-all shadow"
            />
            <span className="text-[10px] font-bold text-slate-400 mt-2 truncate max-w-full">
              Fixed (Pro)
            </span>
          </div>

          {/* Bar 5: True Net Profit */}
          <div className="flex flex-col items-center h-full justify-end group">
            <span
              className={`text-[10px] font-mono font-bold mb-1 group-hover:scale-105 transition ${
                finalTrueNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              ${finalTrueNetProfit.toFixed(0)}
            </span>
            <div
              style={{ height: `${getBarHeight(finalTrueNetProfit)}%` }}
              className={`w-full max-w-[48px] rounded-t-xl transition-all shadow ${
                finalTrueNetProfit >= 0
                  ? 'bg-gradient-to-t from-emerald-500 to-green-400'
                  : 'bg-gradient-to-t from-rose-700 to-red-500'
              }`}
            />
            <span className="text-[10px] font-bold text-slate-400 mt-2 truncate max-w-full">
              True Net
            </span>
          </div>
        </div>
      </div>

      {/* CORE 6 CARDS STRUCTURE MATCHING SPECIFICATION */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* CARD 1: REVENUE, COGS & GROSS PROFIT */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                1
              </span>
              <div>
                <h3 className="text-sm font-black text-white">Trading Revenue &amp; COGS</h3>
                <p className="text-[10px] text-slate-400">{salesCount} completed customer sales</p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {grossMarginPercent}% GM
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Total Sales Revenue:</span>
              <span className="font-mono font-black text-emerald-400 text-sm">
                +${revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Cost of Goods Sold (COGS):</span>
              <span className="font-mono font-bold text-rose-400 text-xs">
                -${cogs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800/80 flex justify-between items-center mt-2">
              <div>
                <span className="text-xs font-black text-white block">Gross Profit:</span>
                <span className="text-[10px] text-slate-400">Revenue minus stock cost at sale</span>
              </div>
              <span className="text-base font-black text-emerald-400 font-mono">
                ${grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* CARD 2: VARIABLE EXPENSES LIST + TOTAL */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold">
                2
              </span>
              <div>
                <h3 className="text-sm font-black text-white">Variable Expenses</h3>
                <p className="text-[10px] text-slate-400">Actual expenses paid in range</p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
              -${totalVariableExpenses.toFixed(2)}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            {/* Category breakdown */}
            <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
              {Object.keys(expensesByCategory).length === 0 && internalConsumptionCostTotal === 0 && walletChargesTotal === 0 ? (
                <p className="text-[11px] text-slate-500 py-2">No variable expenses recorded in range.</p>
              ) : (
                <>
                  {Object.entries(expensesByCategory).map(([cat, amt]) => (
                    <div key={cat} className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-300 truncate max-w-[180px]">{cat}:</span>
                      <span className="font-mono text-rose-300 font-bold">-${amt.toFixed(2)}</span>
                    </div>
                  ))}
                  {internalConsumptionCostTotal > 0 && (
                    <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-800/60">
                      <div>
                        <span className="text-slate-300 block">Staff Welfare / Shop Use:</span>
                        <span className="text-[9px] text-slate-500">Retail waived: ${internalConsumptionTotal.toFixed(2)}</span>
                      </div>
                      <span className="font-mono text-amber-300 font-bold">-${internalConsumptionCostTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {walletChargesTotal > 0 && (
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-300">Bank &amp; Electronic Charges:</span>
                      <span className="font-mono text-rose-300 font-bold">-${walletChargesTotal.toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800/80 flex justify-between items-center mt-2">
              <span className="text-xs font-black text-white">Total Variable Expenses:</span>
              <span className="text-sm font-black text-rose-400 font-mono">
                -${totalVariableExpenses.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* CARD 3: FIXED MONTHLY COSTS (PRORATED) */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                3
              </span>
              <div>
                <h3 className="text-sm font-black text-white">Fixed Monthly Overheads</h3>
                <p className="text-[10px] text-slate-400">
                  {accountingBasis === 'ACCRUAL' ? 'QuickBooks calendar daily rate' : 'Actual cash paid in period'}
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              -${totalFixedCosts.toFixed(2)}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
              {fixedCostsBreakdown.length === 0 ? (
                <p className="text-[11px] text-slate-500 py-2">No active fixed costs configured.</p>
              ) : (
                fixedCostsBreakdown.map((item, idx) => (
                  <div key={idx} className="p-1.5 bg-slate-950/70 rounded-xl border border-slate-800/60 flex justify-between items-center text-[11px]">
                    <div className="truncate mr-2">
                      <span className="font-bold text-slate-200 block truncate">{item.cost.name}</span>
                      <span className="text-[9px] text-indigo-300 font-mono">{item.formulaDisplay}</span>
                    </div>
                    <span className="font-mono text-indigo-300 font-bold shrink-0">
                      -${item.proratedAmount.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800/80 flex justify-between items-center mt-2">
              <span className="text-xs font-black text-white">Total Prorated Fixed Overheads:</span>
              <span className="text-sm font-black text-indigo-400 font-mono">
                -${totalFixedCosts.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* CARD 4: TOTAL EXPENSES */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center font-bold">
                4
              </span>
              <div>
                <h3 className="text-sm font-black text-white">Total All Overheads &amp; Expenses</h3>
                <p className="text-[10px] text-slate-400">Variable + Prorated Fixed</p>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Variable Expenses Total:</span>
              <span className="font-mono text-rose-400 font-bold">${totalVariableExpenses.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Prorated Fixed Costs Total:</span>
              <span className="font-mono text-indigo-400 font-bold">${totalFixedCosts.toFixed(2)}</span>
            </div>
            <div className="p-3 bg-gradient-to-br from-orange-950/40 to-slate-950 rounded-2xl border border-orange-500/30 flex justify-between items-center mt-2">
              <div>
                <span className="text-xs font-black text-orange-200 block">Total All Expenses:</span>
                <span className="text-[10px] text-slate-400">Operational cash + prorated overheads</span>
              </div>
              <span className="text-base font-black text-orange-400 font-mono">
                ${totalAllExpenses.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* CARD 5: NET PROFIT BEFORE DRAWINGS */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
                5
              </span>
              <div>
                <h3 className="text-sm font-black text-white">Net Profit Before Drawings</h3>
                <p className="text-[10px] text-slate-400">Gross Profit minus Total All Expenses</p>
              </div>
            </div>
            <span
              className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                netProfitBeforeDrawings >= 0
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
              }`}
            >
              {netMarginPercent}% Net
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Gross Profit:</span>
              <span className="font-mono text-emerald-400 font-bold">+${grossProfit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Less All Expenses:</span>
              <span className="font-mono text-rose-400 font-bold">-${totalAllExpenses.toFixed(2)}</span>
            </div>
            <div
              className={`p-3 rounded-2xl border flex justify-between items-center mt-2 ${
                netProfitBeforeDrawings >= 0
                  ? 'bg-emerald-950/40 border-emerald-500/40'
                  : 'bg-rose-950/40 border-rose-500/40'
              }`}
            >
              <div>
                <span className="text-xs font-black text-white block">Operating Net Profit:</span>
                <span className="text-[10px] text-slate-400">Pre-owner withdrawal</span>
              </div>
              <span
                className={`text-base font-black font-mono ${
                  netProfitBeforeDrawings >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                ${netProfitBeforeDrawings.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* CARD 6: FINAL TRUE NET PROFIT AFTER OWNER DRAWINGS */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold">
                6
              </span>
              <div>
                <h3 className="text-sm font-black text-white">Final True Profit</h3>
                <p className="text-[10px] text-slate-400">After owner cash &amp; grocery drawings</p>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Net Profit Before Drawings:</span>
              <span className="font-mono font-bold">${netProfitBeforeDrawings.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Less Owner Cash Drawings:</span>
              <span className="font-mono text-purple-400 font-bold">-${ownerDrawingsTotal.toFixed(2)}</span>
            </div>
            {ownerGroceriesCost > 0 && (
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400">Less Owner Groceries (at Cost):</span>
                <span className="font-mono text-purple-400 font-bold">-${ownerGroceriesCost.toFixed(2)}</span>
              </div>
            )}
            <div
              className={`p-3 rounded-2xl border flex justify-between items-center mt-2 ${
                finalTrueNetProfit >= 0
                  ? 'bg-gradient-to-br from-emerald-950/60 to-slate-950 border-emerald-500/60 shadow-lg'
                  : 'bg-gradient-to-br from-rose-950/60 to-slate-950 border-rose-500/60 shadow-lg'
              }`}
            >
              <div>
                <span className="text-xs font-black text-white block">FINAL TRUE NET PROFIT:</span>
                <span className="text-[10px] text-slate-400">Retained in business</span>
              </div>
              <span
                className={`text-xl font-black font-mono ${
                  finalTrueNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                ${finalTrueNetProfit.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* CARD 7: MULTI-WALLET RECONCILIATION AUDIT CHECK */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">Card 7: Multi-Wallet Reconciliation Check</h3>
              <p className="text-[11px] text-slate-400">
                Audits actual counted money vs expected balances across Cash, EcoCash, Bank ZiG, Bank USD, and Home Safe
              </p>
            </div>
          </div>

          {onNavigateToWhereIsMyMoney && (
            <button
              type="button"
              onClick={onNavigateToWhereIsMyMoney}
              className="py-1.5 px-3 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-xs font-bold border border-indigo-500/40 transition cursor-pointer"
            >
              Open "Where is My Money?"
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {wallets.map((w) => {
            const isCash = w.type === 'CASH_DRAWER';
            const isEco = w.type === 'ECOCASH';
            const isZig = w.type === 'BANK_ZIG';
            const isBankUsd = w.type === 'BANK_USD';
            const isSafe = w.type === 'HOME_SAFE';

            const currSymbol = isZig ? 'ZiG ' : isEco ? 'EcoCash ' : '$';

            return (
              <div
                key={w.id}
                className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 space-y-2 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-slate-300">
                    {isCash && <Wallet className="w-3.5 h-3.5 text-emerald-400" />}
                    {isEco && <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400" />}
                    {isZig && <Landmark className="w-3.5 h-3.5 text-blue-400" />}
                    {isBankUsd && <Landmark className="w-3.5 h-3.5 text-indigo-400" />}
                    {isSafe && <Home className="w-3.5 h-3.5 text-purple-400" />}
                    <span className="truncate">{w.name}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 block">Actual Counted Balance:</span>
                  <span className="text-base font-black font-mono text-cyan-300">
                    {currSymbol}{w.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Currency:</span>
                  <span className="font-mono font-bold text-slate-300">{w.currency}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
