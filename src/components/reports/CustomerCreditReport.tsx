import React, { useState, useMemo, useEffect } from 'react';
import { CustomerCreditReportItem, Salesperson } from '../../types';
import {
  getCustomerCreditReport,
  recordCustomerCreditPayment,
  subscribeToDatabase,
} from '../../db/roomDatabase';
import {
  CreditCard,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Calendar,
  Phone,
  MapPin,
  Download,
  Printer,
  X,
  CheckCircle2,
  AlertCircle,
  Filter,
  ArrowUpDown,
  History,
  Check,
  Package,
  AlertTriangle,
  Plus,
} from 'lucide-react';

interface CustomerCreditReportProps {
  currentUser?: Salesperson | null;
  onNavigateToForm3?: (customerName?: string) => void;
  onClose?: () => void;
}

export const CustomerCreditReport: React.FC<CustomerCreditReportProps> = ({
  currentUser,
  onNavigateToForm3,
  onClose,
}) => {
  const [reportData, setReportData] = useState(() => getCustomerCreditReport());
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'owing' | 'overdue' | '0-7' | '8-14' | '15+' | 'settled' | 'all'>('owing');
  const [sortBy, setSortBy] = useState<'daysDesc' | 'daysAsc' | 'amountDesc' | 'nameAsc'>('daysDesc');

  // Modal states
  const [selectedItemForHistory, setSelectedItemForHistory] = useState<CustomerCreditReportItem | null>(null);
  const [paymentModalItem, setPaymentModalItem] = useState<CustomerCreditReportItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Subscribe to real-time database updates
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setReportData(getCustomerCreditReport());
    });
    return () => unsub();
  }, []);

  const { items, summary } = reportData;

  // Filter items
  const filteredItems = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch =
        !q ||
        (item.customerName && item.customerName.toLowerCase().includes(q)) ||
        (item.customerId && item.customerId.toLowerCase().includes(q)) ||
        (item.phone && item.phone.toLowerCase().includes(q)) ||
        (Array.isArray(item.itemDescriptions) && item.itemDescriptions.some((desc) => (desc || '').toLowerCase().includes(q)));

      if (!matchesSearch) return false;

      if (filterType === 'owing') return item.status === 'Owing';
      if (filterType === 'overdue') return item.status === 'Owing' && item.isOverdue;
      if (filterType === '0-7') return item.status === 'Owing' && item.daysOwing <= 7;
      if (filterType === '8-14') return item.status === 'Owing' && item.daysOwing > 7 && item.daysOwing <= 14;
      if (filterType === '15+') return item.status === 'Owing' && item.daysOwing >= 15;
      if (filterType === 'settled') return item.status === 'Settled';
      return true;
    });
  }, [items, search, filterType]);

  // Sort items
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      if (sortBy === 'daysDesc') {
        if (a.status === 'Owing' && b.status !== 'Owing') return -1;
        if (b.status === 'Owing' && a.status !== 'Owing') return 1;
        return b.daysOwing - a.daysOwing;
      }
      if (sortBy === 'daysAsc') {
        return a.daysOwing - b.daysOwing;
      }
      if (sortBy === 'amountDesc') {
        return b.netDebtOwed - a.netDebtOwed;
      }
      if (sortBy === 'nameAsc') {
        return a.customerName.localeCompare(b.customerName);
      }
      return 0;
    });
  }, [filteredItems, sortBy]);

  // Handle recording a debt payment
  const handleConfirmPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalItem) return;

    const amountNum = parseFloat(paymentAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Please enter a valid repayment amount greater than $0.00');
      return;
    }

    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Cashier';

    recordCustomerCreditPayment(
      paymentModalItem.customerId,
      paymentModalItem.customerName,
      amountNum,
      staffId,
      staffName,
      paymentNotes || `Debt repayment from ${paymentModalItem.customerName}`
    );

    setSuccessToast(
      `Successfully recorded $${amountNum.toFixed(2)} repayment from ${paymentModalItem.customerName}`
    );
    setPaymentModalItem(null);
    setPaymentAmount('');
    setPaymentNotes('');
    setReportData(getCustomerCreditReport());
  };

  // Export CSV
  const handleExportCsv = () => {
    const headers = [
      'Customer ID',
      'Customer Name',
      'Phone',
      'Address',
      'Total Credit Taken ($ IN)',
      'Total Debt Repaid ($ OUT)',
      'Outstanding Debt ($)',
      'First Credit Collected Date',
      'Days Owing',
      'Latest Credit Date',
      'Due Date',
      'Is Overdue',
      'Items Taken',
      'Status',
    ];

    const rows = sortedItems.map((item) => [
      item.customerId,
      `"${item.customerName.replace(/"/g, '""')}"`,
      `"${item.phone || ''}"`,
      `"${item.address || ''}"`,
      item.totalCreditIn.toFixed(2),
      item.totalRepaidOut.toFixed(2),
      item.netDebtOwed.toFixed(2),
      item.firstCreditDate || '',
      item.daysOwing,
      item.latestCreditDate || '',
      item.dueDate || '',
      item.isOverdue ? 'YES' : 'NO',
      `"${item.itemDescriptions.join('; ').replace(/"/g, '""')}"`,
      item.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Customer_Credit_Debt_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 select-none pb-12 animate-fadeIn">
      {/* 1. Header Banner */}
      <div className="bg-slate-900/95 border border-[#FF8A00]/30 rounded-3xl p-4 sm:p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#FF8A00] to-amber-600 flex items-center justify-center text-white shadow-xl">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-black text-white tracking-tight">
                  Customer Credit Sales Report
                </h2>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#FF8A00]/20 text-[#FF8A00] font-bold border border-[#FF8A00]/30">
                  Form 3 Credit IN Audit
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Shows how much each customer owes the business and days owing since goods were collected on credit in Form 3.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            {onNavigateToForm3 && (
              <button
                type="button"
                onClick={() => onNavigateToForm3()}
                className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-[#FF8A00] to-amber-600 hover:brightness-110 text-slate-950 text-xs font-black shadow-md shadow-orange-950 flex items-center space-x-1.5 transition active:scale-95 border border-amber-400/40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add New Credit in Form 3</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              className="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800">
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-[#FF8A00]/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Total Outstanding Debt</span>
              <CreditCard className="w-4 h-4 text-[#FF8A00]" />
            </div>
            <div className="text-2xl font-black font-mono-num text-[#FF8A00] mt-1">
              ${summary.totalOutstandingDebt.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Owed by <strong className="text-slate-300 font-mono-num">{summary.totalDebtorsCount}</strong> customers
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-emerald-500/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>0 – 7 Days Owing</span>
              <Clock className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black font-mono-num text-emerald-300 mt-1">
              ${summary.aged0To7DaysTotal.toFixed(2)}
            </div>
            <div className="text-[11px] text-emerald-400/80 mt-0.5">
              Current credit taken this week
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-amber-500/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>8 – 14 Days Owing</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black font-mono-num text-amber-300 mt-1">
              ${summary.aged8To14DaysTotal.toFixed(2)}
            </div>
            <div className="text-[11px] text-amber-400/80 mt-0.5">
              Follow-up reminder stage
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-rose-500/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>15+ Days (Aged Debt)</span>
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-black font-mono-num text-rose-300 mt-1">
              ${summary.aged15PlusDaysTotal.toFixed(2)}
            </div>
            <div className="text-[11px] text-rose-400/80 mt-0.5">
              High priority collection
            </div>
          </div>
        </div>
      </div>

      {/* Success Toast */}
      {successToast && (
        <div className="p-4 bg-emerald-950/90 border border-emerald-500/50 rounded-2xl flex items-center justify-between text-emerald-200 text-xs shadow-xl animate-scaleUp">
          <div className="flex items-center space-x-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span className="font-semibold">{successToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessToast(null)}
            className="p-1 hover:bg-emerald-900/50 rounded-lg text-emerald-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Search, Filter Pills & Sort Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-lg">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, ID, goods taken..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 outline-none focus:border-[#FF8A00]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap w-full md:w-auto">
          <span className="text-xs text-slate-500 font-bold mr-1 flex items-center">
            <Filter className="w-3 h-3 mr-1" />
            Filter:
          </span>

          <button
            type="button"
            onClick={() => setFilterType('owing')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              filterType === 'owing'
                ? 'bg-[#FF8A00] text-slate-950 shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Active Debtors ({summary.totalDebtorsCount})
          </button>

          {summary.overdueCount > 0 && (
            <button
              type="button"
              onClick={() => setFilterType('overdue')}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition ${
                filterType === 'overdue'
                  ? 'bg-rose-600 text-white shadow-md'
                  : 'bg-rose-950/40 text-rose-300 hover:text-rose-200 border border-rose-800/60'
              }`}
            >
              Overdue ({summary.overdueCount})
            </button>
          )}

          <button
            type="button"
            onClick={() => setFilterType('0-7')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              filterType === '0-7'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            0–7 Days
          </button>

          <button
            type="button"
            onClick={() => setFilterType('8-14')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              filterType === '8-14'
                ? 'bg-amber-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            8–14 Days
          </button>

          <button
            type="button"
            onClick={() => setFilterType('15+')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              filterType === '15+'
                ? 'bg-rose-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            15+ Days
          </button>

          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              filterType === 'all'
                ? 'bg-slate-700 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            All History
          </button>
        </div>

        {/* Sort selector */}
        <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 text-xs text-slate-300 font-semibold rounded-xl px-2.5 py-1.5 outline-none cursor-pointer"
          >
            <option value="daysDesc">Days Owing (Oldest First)</option>
            <option value="daysAsc">Days Owing (Newest First)</option>
            <option value="amountDesc">Debt Amount ($ Highest)</option>
            <option value="nameAsc">Customer Name (A–Z)</option>
          </select>
        </div>
      </div>

      {/* 3. Main Credit Report Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <CreditCard className="w-4 h-4 text-[#FF8A00]" />
            <h3 className="font-bold text-white text-sm">Customer Debt Ledger & Days Owing</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono-num font-semibold">
            Showing {sortedItems.length} of {items.length} Customers
          </span>
        </div>

        {sortedItems.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            <CreditCard className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
            <p className="font-bold text-slate-300 text-sm">No Credit Debt Records Match Your Filter</p>
            <p className="text-slate-500 mt-1">Try selecting &ldquo;All History&rdquo; or clearing the search query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800 select-none">
                  <th className="py-3 px-3 min-w-[200px] text-left">
                    <span className="text-[#FF8A00] font-bold mr-1">1.</span> Customer ID & Name
                  </th>
                  <th className="py-3 px-3 text-right w-36">
                    <span className="text-[#FF8A00] font-bold mr-1">2.</span> Credit Owed
                  </th>
                  <th className="py-3 px-2 min-w-[190px] text-center">
                    <span className="text-[#FF8A00] font-bold mr-1">3.</span> Action
                  </th>
                  <th className="py-3 px-3 min-w-[180px]">
                    <span className="text-[#FF8A00] font-bold mr-1">4.</span> Date Taken & Days Owing
                  </th>
                  <th className="py-3 px-3 text-right w-32">Credit Given ($ OUT)</th>
                  <th className="py-3 px-3 text-right w-32">Total Repaid ($ IN)</th>
                  <th className="py-3 px-3 min-w-[150px]">Goods / Items Taken</th>
                  <th className="py-3 px-3 w-24 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sortedItems.map((item, idx) => {
                  const isOwing = item.status === 'Owing';
                  const days = item.daysOwing;

                  // Aging pill style
                  const agingBadgeClass =
                    !isOwing
                      ? 'bg-slate-800/80 text-slate-400 border-slate-700'
                      : days <= 7
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                      : days <= 14
                      ? 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                      : 'bg-rose-950/80 text-rose-300 border-rose-500/40';

                  return (
                    <tr
                      key={item.customerId}
                      className={`hover:bg-slate-900/70 transition-colors ${
                        isOwing ? 'bg-amber-950/5' : ''
                      }`}
                    >
                      {/* 1. Customer ID & Name */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono-num text-[11px] text-amber-300 bg-amber-950 border border-amber-800/60 px-2 py-0.5 rounded-lg font-bold shadow-sm shrink-0">
                            {item.customerId}
                          </span>
                          <span className="font-bold text-white text-xs">{item.customerName}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 flex items-center space-x-2 flex-wrap">
                          {item.phone && (
                            <span className="flex items-center space-x-1">
                              <Phone className="w-3 h-3 text-slate-500 shrink-0" />
                              <span>{item.phone}</span>
                            </span>
                          )}
                          <span className="text-slate-600">•</span>
                          <span>{item.transactionsCount} credit records</span>
                        </div>
                      </td>

                      {/* 2. Credit Owed */}
                      <td className="py-3 px-3 text-right">
                        {isOwing ? (
                          <div>
                            <span className="inline-block px-3 py-1 rounded-xl bg-rose-950/90 border border-rose-500/50 text-rose-200 font-black font-mono-num text-sm shadow-md">
                              ${item.netDebtOwed.toFixed(2)}
                            </span>
                            {item.isOverdue && (
                              <span className="block text-[10px] text-rose-400 font-bold mt-0.5">
                                Overdue (Due {item.dueDate})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500 font-mono-num font-medium text-xs">
                            $0.00 (Settled)
                          </span>
                        )}
                      </td>

                      {/* 3. Action */}
                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          {isOwing && (
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentModalItem(item);
                                setPaymentAmount(String(item.netDebtOwed));
                                setPaymentNotes(`Debt repayment from ${item.customerName}`);
                              }}
                              title="Record debt repayment from customer"
                              className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-[#FF8A00] to-amber-600 hover:brightness-110 text-slate-950 text-[11px] font-black shadow-md transition active:scale-95 flex items-center space-x-1"
                            >
                              <ArrowDownLeft className="w-3 h-3" />
                              <span>Repay</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onNavigateToForm3?.(item.customerName)}
                            title="Add new credit sale entry for this customer in Form 3"
                            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-orange-300 hover:text-white text-[11px] font-bold border border-orange-500/30 transition active:scale-95 flex items-center space-x-1"
                          >
                            <Plus className="w-3 h-3" />
                            <span>+ Credit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedItemForHistory(item)}
                            title="View customer debt transaction ledger"
                            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* 4. Date Taken & Days Owing */}
                      <td className="py-3 px-3">
                        {item.firstCreditDate ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center space-x-1.5">
                              <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold font-mono-num ${agingBadgeClass}`}>
                                {days === 0
                                  ? 'Today (0 days owing)'
                                  : days === 1
                                  ? '1 day owing'
                                  : `${days} days owing`}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono-num flex items-center space-x-1">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              <span>Taken on {item.firstCreditDate}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-xs">No credit collection date</span>
                        )}
                      </td>

                      {/* Total Credit Given (OUT) */}
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-rose-400">
                        ${item.totalCreditIn.toFixed(2)}
                      </td>

                      {/* Total Repaid (IN) */}
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-emerald-400">
                        ${item.totalRepaidOut.toFixed(2)}
                      </td>

                      {/* Goods / Items Taken */}
                      <td className="py-3 px-3">
                        {item.itemDescriptions.length > 0 ? (
                          <div className="space-y-1">
                            {item.itemDescriptions.slice(0, 2).map((desc, dIdx) => (
                              <div key={dIdx} className="text-slate-300 text-[11px] flex items-center space-x-1 truncate max-w-[200px]">
                                <Package className="w-3 h-3 text-[#FF8A00] shrink-0" />
                                <span className="truncate">{desc}</span>
                              </div>
                            ))}
                            {item.itemDescriptions.length > 2 && (
                              <span className="text-[10px] text-slate-500 font-semibold">
                                +{item.itemDescriptions.length - 2} more items
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-xs">General Credit</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isOwing
                              ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
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
        )}
      </div>

      {/* 4. Record Repayment Modal */}
      {paymentModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-[#FF8A00]/40 rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#FF8A00]/30 border border-[#FF8A00]/40 flex items-center justify-center text-[#FF8A00]">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Record Debt Repayment</h3>
                  <p className="text-xs text-slate-400">Records an OUT repayment in Form 3 Credit Sales</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPaymentModalItem(null)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmPayment} className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="text-xs text-slate-400 font-medium">Customer:</div>
                <div className="text-sm font-bold text-white flex items-center justify-between">
                  <span>{paymentModalItem.customerName}</span>
                  <span className="font-mono-num text-xs bg-amber-950 text-amber-300 px-2 py-0.5 rounded font-bold">
                    {paymentModalItem.customerId}
                  </span>
                </div>
                <div className="text-xs text-slate-400 pt-1 flex items-center justify-between">
                  <span>Outstanding Debt Owed:</span>
                  <strong className="text-rose-300 font-mono-num text-sm">
                    ${paymentModalItem.netDebtOwed.toFixed(2)}
                  </strong>
                </div>
                {paymentModalItem.daysOwing > 0 && (
                  <div className="text-[11px] text-amber-400 flex items-center space-x-1 pt-0.5">
                    <Clock className="w-3 h-3" />
                    <span>Credit collected {paymentModalItem.daysOwing} days ago (on {paymentModalItem.firstCreditDate})</span>
                  </div>
                )}
              </div>

              {/* Amount input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  Repayment Amount ($ USD) <span className="text-rose-400">*</span>
                </label>
                <div className="relative flex items-center">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none select-none text-slate-400 font-bold text-base">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={paymentModalItem.netDebtOwed * 2}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    required
                    className="w-full pl-8 pr-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 focus:border-[#FF8A00] text-base font-mono-num font-bold text-white placeholder-slate-600 outline-none"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  Notes / Receipt Reference (Optional)
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="e.g. Received $50 cash debt settlement"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 outline-none"
                />
              </div>

              <div className="flex items-center space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPaymentModalItem(null)}
                  className="w-1/2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 rounded-xl bg-gradient-to-r from-[#FF8A00] to-amber-600 hover:brightness-110 text-slate-950 font-black text-xs shadow-lg flex items-center justify-center space-x-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Confirm Repayment</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Detailed Customer Debt History Modal */}
      {selectedItemForHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-bold text-white text-base">
                    Credit Ledger: {selectedItemForHistory.customerName}
                  </h3>
                  <span className="font-mono-num text-xs bg-amber-950 text-amber-300 px-2 py-0.5 rounded font-bold">
                    {selectedItemForHistory.customerId}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Complete historical record of goods taken on credit (IN) and repayments (OUT) in Form 3
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItemForHistory(null)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Summary card */}
            <div className="grid grid-cols-3 gap-3 p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-center">
              <div>
                <span className="text-[10px] text-slate-400 block font-bold">Credit Given ($ OUT)</span>
                <span className="text-base font-bold font-mono-num text-rose-400">
                  ${selectedItemForHistory.totalCreditIn.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-bold">Total Repaid ($ IN)</span>
                <span className="text-base font-bold font-mono-num text-emerald-400">
                  ${selectedItemForHistory.totalRepaidOut.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#FF8A00] block font-bold">Outstanding Debt</span>
                <span className="text-base font-black font-mono-num text-[#FF8A00]">
                  ${selectedItemForHistory.netDebtOwed.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Transactions list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-300">Credit Transactions ({selectedItemForHistory.transactions.length})</h4>
                {onNavigateToForm3 && (
                  <button
                    type="button"
                    onClick={() => {
                      const name = selectedItemForHistory.customerName;
                      setSelectedItemForHistory(null);
                      onNavigateToForm3(name);
                    }}
                    className="text-[11px] font-bold text-orange-400 hover:text-orange-300 flex items-center space-x-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Add Credit Sale Entry</span>
                  </button>
                )}
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                      <th className="py-2.5 px-3">Date & Time</th>
                      <th className="py-2.5 px-3">Goods / Items</th>
                      <th className="py-2.5 px-3 text-right">Credit Given ($ OUT)</th>
                      <th className="py-2.5 px-3 text-right">Cash Repaid ($ IN)</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono-num">
                    {selectedItemForHistory.transactions.map((tr) => {
                      const isRepayment =
                        tr.itemDescription?.toLowerCase().includes('repayment') ||
                        tr.itemDescription?.toLowerCase().includes('settlement') ||
                        (tr.status === 'Paid' && !tr.out && !tr.amount);
                      
                      const goodsOutVal = isRepayment ? 0 : (Number(tr.out) || Number(tr.amount) || 0);
                      const cashInVal = isRepayment ? (Number(tr.in) || Number(tr.out) || Number(tr.amount) || 0) : (Number(tr.in) || 0);

                      return (
                        <tr key={tr.id} className="hover:bg-slate-900/50">
                          <td className="py-2 px-3 text-slate-300">
                            {tr.date} {tr.timestamp ? `(${new Date(tr.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-300 text-[11px] truncate max-w-[180px]">
                            {tr.itemDescription || '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-rose-400 font-bold">
                            {goodsOutVal > 0 ? `$${goodsOutVal.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-400 font-bold">
                            {cashInVal > 0 ? `$${cashInVal.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-400 text-[11px]">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              tr.status === 'Paid'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                                : 'bg-amber-950 text-amber-300 border border-amber-800/50'
                            }`}>
                              {tr.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedItemForHistory(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold"
              >
                Close Ledger
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
