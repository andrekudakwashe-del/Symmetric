import React, { useState, useMemo, useEffect } from 'react';
import { CustomerChangeReportItem, Salesperson, Customer } from '../../types';
import {
  getCustomerChangeReport,
  settleCustomerChangePayout,
  recordManualCustomerChange,
  getCustomers,
  subscribeToDatabase,
} from '../../db/roomDatabase';
import {
  Coins,
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
  Send,
  Plus,
  User,
  FileText,
  Tag,
  Banknote,
} from 'lucide-react';

interface CustomerChangeReportProps {
  currentUser?: Salesperson | null;
  onNavigateToForm3?: (customerName?: string) => void;
  onClose?: () => void;
}

export const CustomerChangeReport: React.FC<CustomerChangeReportProps> = ({
  currentUser,
  onNavigateToForm3,
  onClose,
}) => {
  const [reportData, setReportData] = useState(() => getCustomerChangeReport());
  const [search, setSearch] = useState('');
  const [agingFilter, setAgingFilter] = useState<'all' | 'owed' | '0-7' | '8-14' | '15+' | 'cleared'>('owed');
  const [sortBy, setSortBy] = useState<'daysDesc' | 'daysAsc' | 'amountDesc' | 'nameAsc'>('daysDesc');

  // Modal states
  const [selectedItemForHistory, setSelectedItemForHistory] = useState<CustomerChangeReportItem | null>(null);
  const [payoutModalItem, setPayoutModalItem] = useState<CustomerChangeReportItem | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<string>('');
  const [payoutNotes, setPayoutNotes] = useState<string>('');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Manual Change Booking Modal State (e.g. customer rejected note, no replacement note available)
  const [showManualModal, setShowManualModal] = useState<boolean>(false);
  const [manualCustomerType, setManualCustomerType] = useState<'existing' | 'new'>('existing');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [manualCustomerName, setManualCustomerName] = useState<string>('');
  const [manualCustomerPhone, setManualCustomerPhone] = useState<string>('');
  const [manualAmount, setManualAmount] = useState<string>('');
  const [manualReasonPreset, setManualReasonPreset] = useState<string>(
    'Customer rejected / complained about note after invoice processed (no replacement note)'
  );
  const [cashReceivedInDrawer, setCashReceivedInDrawer] = useState<boolean>(true);
  const [manualCustomNotes, setManualCustomNotes] = useState<string>('');
  const [manualInvoiceRef, setManualInvoiceRef] = useState<string>('');
  const [manualDate, setManualDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>(() => getCustomers());

  const handleOpenManualModal = (targetCustomer?: CustomerChangeReportItem | Customer | null) => {
    const list = getCustomers();
    setAllCustomers(list);
    if (targetCustomer) {
      setManualCustomerType('existing');
      const custId = (targetCustomer as any).customerId || (targetCustomer as any).id || '';
      setSelectedCustomerId(custId);
      setManualCustomerName((targetCustomer as any).customerName || (targetCustomer as any).name || '');
      setManualCustomerPhone(targetCustomer.phone || '');
    } else {
      setSelectedCustomerId('');
      setManualCustomerName('');
      setManualCustomerPhone('');
    }
    setManualAmount('');
    setManualCustomNotes('');
    setManualInvoiceRef('');
    setManualReasonPreset(
      'Customer rejected / complained about note after invoice processed (no replacement note)'
    );
    setCashReceivedInDrawer(true);
    setShowManualModal(true);
  };

  const handleConfirmManualChange = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(manualAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Please enter a valid change amount greater than $0.00');
      return;
    }

    let finalCustName = manualCustomerName.trim();
    let finalCustId = selectedCustomerId;

    if (manualCustomerType === 'existing') {
      const found = allCustomers.find((c) => c.customerId === selectedCustomerId || c.id === selectedCustomerId);
      if (found) {
        finalCustName = found.name;
        finalCustId = found.customerId || found.id;
        if (!manualCustomerPhone && found.phone) {
          setManualCustomerPhone(found.phone);
        }
      }
    }

    if (!finalCustName) {
      alert('Please select an existing customer or enter a customer name.');
      return;
    }

    const fullNotes = manualCustomNotes.trim()
      ? `${manualReasonPreset}: ${manualCustomNotes.trim()}`
      : manualReasonPreset;

    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Cashier';
    const staffRole = currentUser?.role || 'Staff';

    recordManualCustomerChange({
      customerName: finalCustName,
      customerId: finalCustId,
      phone: manualCustomerPhone.trim(),
      amount: amt,
      date: manualDate,
      notes: fullNotes,
      reference: manualInvoiceRef.trim() || undefined,
      cashReceivedInDrawer,
      staffId,
      staffName,
      staffRole,
    });

    setReportData(getCustomerChangeReport());
    setSuccessToast(`Change of $${amt.toFixed(2)} booked for "${finalCustName}". Customer ledger updated.`);
    setShowManualModal(false);

    // Reset fields
    setManualAmount('');
    setManualCustomerName('');
    setManualCustomerPhone('');
    setSelectedCustomerId('');
    setManualCustomNotes('');
    setManualInvoiceRef('');
  };

  // Subscribe to real-time database updates
  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      setReportData(getCustomerChangeReport());
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
        (item.address && item.address.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (agingFilter === 'owed') return item.status === 'Owed';
      if (agingFilter === '0-7') return item.status === 'Owed' && item.daysSinceFirstIn <= 7;
      if (agingFilter === '8-14') return item.status === 'Owed' && item.daysSinceFirstIn > 7 && item.daysSinceFirstIn <= 14;
      if (agingFilter === '15+') return item.status === 'Owed' && item.daysSinceFirstIn >= 15;
      if (agingFilter === 'cleared') return item.status === 'Cleared';
      return true;
    });
  }, [items, search, agingFilter]);

  // Sort items
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      if (sortBy === 'daysDesc') {
        if (a.status === 'Owed' && b.status !== 'Owed') return -1;
        if (b.status === 'Owed' && a.status !== 'Owed') return 1;
        return b.daysSinceFirstIn - a.daysSinceFirstIn;
      }
      if (sortBy === 'daysAsc') {
        return a.daysSinceFirstIn - b.daysSinceFirstIn;
      }
      if (sortBy === 'amountDesc') {
        return b.netChangeOwed - a.netChangeOwed;
      }
      if (sortBy === 'nameAsc') {
        return a.customerName.localeCompare(b.customerName);
      }
      return 0;
    });
  }, [filteredItems, sortBy]);

  // Handle recording a change payout
  const handleConfirmPayout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutModalItem) return;

    const amountNum = parseFloat(payoutAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('Please enter a valid payout amount greater than $0.00');
      return;
    }

    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Cashier';

    settleCustomerChangePayout(
      payoutModalItem.customerId,
      payoutModalItem.customerName,
      amountNum,
      staffId,
      staffName,
      payoutNotes || `Change refund payout to customer`
    );

    setSuccessToast(
      `Successfully paid out $${amountNum.toFixed(2)} change to ${payoutModalItem.customerName}`
    );
    setPayoutModalItem(null);
    setPayoutAmount('');
    setPayoutNotes('');
    setReportData(getCustomerChangeReport());
  };

  // Export CSV
  const handleExportCsv = () => {
    const headers = [
      'Customer ID',
      'Customer Name',
      'Phone',
      'Address',
      'Total Change Left ($ IN)',
      'Total Change Paid ($ OUT)',
      'Net Change We Owe ($)',
      'First Date Change Left',
      'Days Since First Left',
      'Latest Date Change Left',
      'Status',
    ];

    const rows = sortedItems.map((item) => [
      item.customerId,
      `"${item.customerName.replace(/"/g, '""')}"`,
      `"${item.phone || ''}"`,
      `"${item.address || ''}"`,
      item.totalIn.toFixed(2),
      item.totalOut.toFixed(2),
      item.netChangeOwed.toFixed(2),
      item.firstInDate || '',
      item.daysSinceFirstIn,
      item.latestInDate || '',
      item.status,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Customer_Change_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 select-none pb-12 animate-fadeIn">
      {/* 1. Header Banner */}
      <div className="bg-slate-900/95 border border-purple-500/30 rounded-3xl p-4 sm:p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-purple-600 flex items-center justify-center text-white shadow-xl">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-black text-white tracking-tight">
                  Customer Change Report
                </h2>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                  Form 3 IN Audit
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Shows exact change held by the business for each customer and days elapsed since the change was left in the IN column of Form 3.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            <button
              type="button"
              id="btn-book-cash-in-change"
              onClick={handleOpenManualModal}
              className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white text-xs font-black shadow-md shadow-purple-950 flex items-center space-x-1.5 transition active:scale-95 border border-purple-400/40 cursor-pointer"
              title="Book change owed to customer (e.g. customer rejected note / small change unavailable)"
            >
              <Coins className="w-3.5 h-3.5 text-amber-300" />
              <span>+ Book Cash in Change</span>
            </button>

            {onNavigateToForm3 && (
              <button
                type="button"
                onClick={() => onNavigateToForm3()}
                className="py-2 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Form 3 Full View</span>
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
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-purple-500/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Total Change We Owe</span>
              <Coins className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-black font-mono-num text-purple-300 mt-1">
              ${summary.totalChangeOwed.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Held across <strong className="text-slate-300 font-mono-num">{summary.totalCustomersOwingChange}</strong> customers
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-emerald-500/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>0 – 7 Days (Recent)</span>
              <Clock className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black font-mono-num text-emerald-300 mt-1">
              ${summary.aged0To7DaysTotal.toFixed(2)}
            </div>
            <div className="text-[11px] text-emerald-400/80 mt-0.5">
              Fresh change left this week
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-amber-500/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>8 – 14 Days (Pending)</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black font-mono-num text-amber-300 mt-1">
              ${summary.aged8To14DaysTotal.toFixed(2)}
            </div>
            <div className="text-[11px] text-amber-400/80 mt-0.5">
              Over 1 week unclaimed
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-rose-500/30">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>15+ Days (Aged / Overdue)</span>
              <AlertCircle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-black font-mono-num text-rose-300 mt-1">
              ${summary.aged15PlusDaysTotal.toFixed(2)}
            </div>
            <div className="text-[11px] text-rose-400/80 mt-0.5">
              Long-term unclaimed change
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

      {/* 2. Search, Aging Filters & Sort Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 shadow-lg">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, ID (C005), phone..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 outline-none focus:border-[#6A4DFF]"
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
            onClick={() => setAgingFilter('owed')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              agingFilter === 'owed'
                ? 'bg-purple-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            All Owed ({summary.totalCustomersOwingChange})
          </button>

          <button
            type="button"
            onClick={() => setAgingFilter('0-7')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              agingFilter === '0-7'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            0–7 Days
          </button>

          <button
            type="button"
            onClick={() => setAgingFilter('8-14')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              agingFilter === '8-14'
                ? 'bg-amber-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            8–14 Days
          </button>

          <button
            type="button"
            onClick={() => setAgingFilter('15+')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              agingFilter === '15+'
                ? 'bg-rose-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            15+ Days
          </button>

          <button
            type="button"
            onClick={() => setAgingFilter('all')}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition ${
              agingFilter === 'all'
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
            <option value="daysDesc">Days Since Left (Oldest First)</option>
            <option value="daysAsc">Days Since Left (Newest First)</option>
            <option value="amountDesc">Change Owed ($ Highest)</option>
            <option value="nameAsc">Customer Name (A–Z)</option>
          </select>
        </div>
      </div>

      {/* 3. Main Change Report Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Coins className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-white text-sm">Customer Change Ledger & Days Outstanding</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono-num font-semibold">
            Showing {sortedItems.length} of {items.length} Customers
          </span>
        </div>

        {sortedItems.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            <Coins className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
            <p className="font-bold text-slate-300 text-sm">No Customer Change Records Match Your Filter</p>
            <p className="text-slate-500 mt-1">Try selecting &ldquo;All History&rdquo; or clearing the search query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800 select-none">
                  <th className="py-3 px-3 min-w-[200px] text-left">
                    <span className="text-purple-400 font-bold mr-1">1.</span> Customer ID & Name
                  </th>
                  <th className="py-3 px-3 text-right w-36">
                    <span className="text-purple-400 font-bold mr-1">2.</span> Change We Owe
                  </th>
                  <th className="py-3 px-2 min-w-[190px] text-center">
                    <span className="text-purple-400 font-bold mr-1">3.</span> Action
                  </th>
                  <th className="py-3 px-3 min-w-[180px]">
                    <span className="text-purple-400 font-bold mr-1">4.</span> Date Left & Days Elapsed
                  </th>
                  <th className="py-3 px-3 text-right w-28">Total Left (IN)</th>
                  <th className="py-3 px-3 text-right w-28">Claimed (OUT)</th>
                  <th className="py-3 px-3 w-24 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sortedItems.map((item, idx) => {
                  const isOwed = item.status === 'Owed';
                  const days = item.daysSinceFirstIn;

                  // Aging pill style
                  const agingBadgeClass =
                    !isOwed
                      ? 'bg-slate-800/80 text-slate-400 border-slate-700'
                      : days <= 7
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                      : days <= 14
                      ? 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                      : 'bg-rose-950/80 text-rose-300 border-rose-500/40';

                  return (
                    <tr
                      key={`${item.customerId || 'cust'}-${idx}`}
                      className={`hover:bg-slate-900/70 transition-colors ${
                        isOwed ? 'bg-purple-950/5' : ''
                      }`}
                    >
                      {/* 1. Customer ID & Name */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono-num text-[11px] text-purple-300 bg-purple-950 border border-purple-800/60 px-2 py-0.5 rounded-lg font-bold shadow-sm shrink-0">
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
                          <span>{item.transactionsCount} entries in Form 3</span>
                        </div>
                      </td>

                      {/* 2. Change We Owe */}
                      <td className="py-3 px-3 text-right">
                        {isOwed ? (
                          <span className="inline-block px-3 py-1 rounded-xl bg-purple-950/90 border border-purple-500/50 text-purple-200 font-black font-mono-num text-sm shadow-md">
                            ${item.netChangeOwed.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-500 font-mono-num font-medium text-xs">
                            $0.00 (Cleared)
                          </span>
                        )}
                      </td>

                      {/* 3. Action */}
                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          {isOwed && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayoutModalItem(item);
                                setPayoutAmount(String(item.netChangeOwed));
                                setPayoutNotes(`Payout change balance to ${item.customerName}`);
                              }}
                              title="Pay out / Refund change to customer"
                              className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-purple-600 hover:brightness-110 text-white text-[11px] font-bold shadow-md transition active:scale-95 flex items-center space-x-1"
                            >
                              <ArrowUpRight className="w-3 h-3" />
                              <span>Pay Out</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleOpenManualModal(item)}
                            title="Book cash in change owed to this customer (e.g. note complained about / small change shortage)"
                            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 hover:text-white text-[11px] font-bold border border-purple-500/30 transition active:scale-95 flex items-center space-x-1 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>+ Change</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedItemForHistory(item)}
                            title="View customer change transaction ledger"
                            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* 4. Date Left & Days Elapsed */}
                      <td className="py-3 px-3">
                        {item.firstInDate ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center space-x-1.5">
                              <span className={`text-[10px] px-2.5 py-0.5 rounded-full border font-bold font-mono-num ${agingBadgeClass}`}>
                                {days === 0
                                  ? 'Today (0 days)'
                                  : days === 1
                                  ? 'Yesterday (1 day)'
                                  : `${days} days ago`}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono-num flex items-center space-x-1">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              <span>Left on {item.firstInDate}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-xs">No IN transactions</span>
                        )}
                      </td>

                      {/* Total Left (IN) */}
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-emerald-400">
                        ${item.totalIn.toFixed(2)}
                      </td>

                      {/* Claimed (OUT) */}
                      <td className="py-3 px-3 text-right font-mono-num font-semibold text-rose-400">
                        ${item.totalOut.toFixed(2)}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isOwed
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
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

      {/* 4. Settle / Pay Out Modal */}
      {payoutModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-5 sm:p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Pay Out Customer Change</h3>
                  <p className="text-xs text-slate-400">Records an OUT transaction in Form 3</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPayoutModalItem(null)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmPayout} className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                <div className="text-xs text-slate-400 font-medium">Customer:</div>
                <div className="text-sm font-bold text-white flex items-center justify-between">
                  <span>{payoutModalItem.customerName}</span>
                  <span className="font-mono-num text-xs bg-purple-950 text-purple-300 px-2 py-0.5 rounded font-bold">
                    {payoutModalItem.customerId}
                  </span>
                </div>
                <div className="text-xs text-slate-400 pt-1 flex items-center justify-between">
                  <span>Current Change Owed:</span>
                  <strong className="text-purple-300 font-mono-num text-sm">
                    ${payoutModalItem.netChangeOwed.toFixed(2)}
                  </strong>
                </div>
                {payoutModalItem.daysSinceFirstIn > 0 && (
                  <div className="text-[11px] text-amber-400 flex items-center space-x-1 pt-0.5">
                    <Clock className="w-3 h-3" />
                    <span>Change held for {payoutModalItem.daysSinceFirstIn} days (since {payoutModalItem.firstInDate})</span>
                  </div>
                )}
              </div>

              {/* Amount input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  Payout Amount ($ USD) <span className="text-rose-400">*</span>
                </label>
                <div className="relative flex items-center">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none select-none text-slate-400 font-bold text-base">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={payoutModalItem.netChangeOwed * 2}
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    required
                    className="w-full pl-8 pr-4 py-2.5 rounded-2xl bg-slate-950 border border-slate-700 focus:border-[#6A4DFF] text-base font-mono-num font-bold text-white placeholder-slate-600 outline-none"
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
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder="e.g. Handed $20 cash change to customer"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 outline-none"
                />
              </div>

              <div className="flex items-center space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPayoutModalItem(null)}
                  className="w-1/2 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-purple-600 hover:brightness-110 text-white font-bold text-xs shadow-lg flex items-center justify-center space-x-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Confirm Payout</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Detailed Customer History Ledger Modal */}
      {selectedItemForHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-bold text-white text-base">
                    Change Ledger: {selectedItemForHistory.customerName}
                  </h3>
                  <span className="font-mono-num text-xs bg-purple-950 text-purple-300 px-2 py-0.5 rounded font-bold">
                    {selectedItemForHistory.customerId}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Complete historical record of all IN and OUT change entries from Form 3
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
                <span className="text-[10px] text-slate-400 block font-bold">Total Left (IN)</span>
                <span className="text-base font-bold font-mono-num text-emerald-400">
                  ${selectedItemForHistory.totalIn.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-bold">Total Claimed (OUT)</span>
                <span className="text-base font-bold font-mono-num text-rose-400">
                  ${selectedItemForHistory.totalOut.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-purple-300 block font-bold">Net Change Owed</span>
                <span className="text-base font-black font-mono-num text-purple-300">
                  ${selectedItemForHistory.netChangeOwed.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Transactions list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-300">Transaction History ({selectedItemForHistory.transactions.length})</h4>
                {onNavigateToForm3 && (
                  <button
                    type="button"
                    onClick={() => {
                      const name = selectedItemForHistory.customerName;
                      setSelectedItemForHistory(null);
                      onNavigateToForm3(name);
                    }}
                    className="text-[11px] font-bold text-purple-400 hover:text-purple-300 flex items-center space-x-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Add Change Entry</span>
                  </button>
                )}
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/60">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                      <th className="py-2.5 px-3">Date & Time</th>
                      <th className="py-2.5 px-3">Staff</th>
                      <th className="py-2.5 px-3 text-right">Cash IN ($)</th>
                      <th className="py-2.5 px-3 text-right">Cash OUT ($)</th>
                      <th className="py-2.5 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono-num">
                    {selectedItemForHistory.transactions.map((tr, trIdx) => (
                      <tr key={`${tr.id || 'tr'}-${trIdx}`} className="hover:bg-slate-900/50">
                        <td className="py-2 px-3 text-slate-300">
                          {tr.date} {tr.timestamp ? `(${new Date(tr.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-400">{tr.staffName}</td>
                        <td className="py-2 px-3 text-right text-emerald-400 font-bold">
                          {tr.in > 0 ? `$${Number(tr.in).toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-rose-400 font-bold">
                          {tr.out > 0 ? `$${Number(tr.out).toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-400 text-[11px] truncate max-w-[200px]">
                          {tr.notes || '—'}
                        </td>
                      </tr>
                    ))}
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

      {/* MANUAL CHANGE BOOKING MODAL (Real-world note rejection / small change shortage) */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-purple-500/40 rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl text-white space-y-4 max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
                  <Coins className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Book Cash in Change</h3>
                  <p className="text-xs text-slate-400">
                    Record change owed when customer rejects note or small denominations are unavailable
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmManualChange} className="space-y-4">
              {/* Customer Selector Type */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                  <User className="w-3.5 h-3.5 text-purple-400" />
                  <span>Customer Selection *</span>
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setManualCustomerType('existing')}
                    className={`py-1.5 text-xs font-bold rounded-xl transition ${
                      manualCustomerType === 'existing'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Existing Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualCustomerType('new')}
                    className={`py-1.5 text-xs font-bold rounded-xl transition ${
                      manualCustomerType === 'new'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Walk-in / New Customer
                  </button>
                </div>

                {manualCustomerType === 'existing' ? (
                  <div>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => {
                        setSelectedCustomerId(e.target.value);
                        const found = allCustomers.find(
                          (c) => c.customerId === e.target.value || c.id === e.target.value
                        );
                        if (found) {
                          setManualCustomerName(found.name);
                          if (found.phone) setManualCustomerPhone(found.phone);
                        }
                      }}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="">-- Choose Existing Customer --</option>
                      {allCustomers.map((cust) => (
                        <option key={cust.id || cust.customerId} value={cust.customerId || cust.id}>
                          {cust.name} {cust.phone ? `(${cust.phone})` : ''} #{cust.customerId || cust.id}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <input
                        type="text"
                        placeholder="Customer Full Name *"
                        required
                        value={manualCustomerName}
                        onChange={(e) => setManualCustomerName(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Phone Number (Optional)"
                        value={manualCustomerPhone}
                        onChange={(e) => setManualCustomerPhone(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Amount Owed */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Change Amount We Owe ($ USD) *</span>
                  </span>
                  {parseFloat(manualAmount) > 0 && (
                    <span className="font-mono text-emerald-300 text-xs font-black">
                      ${parseFloat(manualAmount).toFixed(2)}
                    </span>
                  )}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-sm font-bold text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                {/* Quick preset chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[0.5, 1, 2, 5, 10, 20, 50].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setManualAmount(String(preset))}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold font-mono transition active:scale-95 border border-slate-700"
                    >
                      +${preset.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason Presets */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                  <Tag className="w-3.5 h-3.5 text-amber-400" />
                  <span>Reason for Booking Change *</span>
                </label>
                <select
                  value={manualReasonPreset}
                  onChange={(e) => setManualReasonPreset(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="Customer rejected / complained about note after invoice processed (no replacement note)">
                    Customer rejected / complained about note after invoice processed (no replacement note)
                  </option>
                  <option value="Customer returned change banknote; placed back into till drawer">
                    Customer returned change banknote; placed back into till drawer
                  </option>
                  <option value="Cashier short on small denomination notes / exact change">
                    Cashier short on small denomination notes / exact change
                  </option>
                  <option value="Customer left change balance to be stored for future visit">
                    Customer left change balance to be stored for future visit
                  </option>
                  <option value="Damaged / defaced / torn banknote returned by customer">
                    Damaged / defaced / torn banknote returned by customer
                  </option>
                  <option value="Special change credit arrangement">
                    Special change credit arrangement
                  </option>
                </select>
              </div>

              {/* Till Drawer Note Received Toggle */}
              <div className="p-3 rounded-2xl bg-purple-950/30 border border-purple-500/30 space-y-1">
                <label className="flex items-start space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cashReceivedInDrawer}
                    onChange={(e) => setCashReceivedInDrawer(e.target.checked)}
                    className="mt-0.5 rounded border-purple-500/50 text-purple-600 focus:ring-purple-500 shrink-0"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-purple-200">Returned Banknote Kept in Till Drawer (+ Cash IN)</span>
                    <p className="text-[11px] text-purple-300/70 mt-0.5">
                      Records the returned banknote into till drawer cash movements so physical drawer count matches Form 4 cash balancing.
                    </p>
                  </div>
                </label>
              </div>

              {/* Custom Details / Serial Number / Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Details / Note Description (Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Customer brought back $10 note with slight tear after invoice processed; kept note in till drawer and credited customer ledger with $10.00 change owed."
                  value={manualCustomNotes}
                  onChange={(e) => setManualCustomNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Invoice Reference & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">Receipt / Invoice Ref (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. INV-1042 / Morning Slip"
                    value={manualInvoiceRef}
                    onChange={(e) => setManualInvoiceRef(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">Booking Date</label>
                  <input
                    type="date"
                    required
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {/* Staff Stamp */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-[11px] text-slate-400 flex items-center justify-between">
                <span>Attributed Staff: <strong className="text-white">{currentUser?.name || 'Cashier'}</strong> (#{currentUser?.id || '001'})</span>
                <span className="text-purple-300 font-bold">● Live Room DB Log</span>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 hover:text-white transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-xs font-black text-white shadow-lg transition active:scale-95 flex items-center space-x-1.5 cursor-pointer"
                >
                  <Coins className="w-3.5 h-3.5 text-amber-300" />
                  <span>Book Change &amp; Update Ledger</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
