import React, { useState, useMemo, useEffect } from 'react';
import { SaleInvoice, ActiveTab, PaymentMethod, Salesperson } from '../../types';
import { getSales, getAllSales, getAllBranchesSales, refundSaleInvoice, voidSaleInvoice, editSaleInvoice, isSupervisorOrAbove, subscribeToDatabase, getTodayDateString, getCurrentBranch } from '../../db/roomDatabase';
import { toDateStringSafe, isSameDaySafe } from '../../utils/dateUtils';
import {
  Receipt,
  Search,
  Calendar,
  CreditCard,
  Banknote,
  Smartphone,
  Landmark,
  Printer,
  ChevronRight,
  Filter,
  CheckCircle2,
  ExternalLink,
  Plus,
  RotateCcw,
  ArrowLeftRight,
  Ban,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  Clock,
  ArrowDown,
  X,
  Pencil,
  Building2,
  Layers,
} from 'lucide-react';
import { ReceiptModal } from '../common/ReceiptModal';
import { ManagerPinModal } from '../common/ManagerPinModal';
import { ItemExchangeModal } from './ItemExchangeModal';
import { SyncStatusDot } from '../common/SyncStatusDot';
import { retrySyncInvoice } from '../../services/googleSheetsSync';

interface POSOrdersHistoryProps {
  currentUser?: Salesperson | null;
  onNavigate?: (tab: ActiveTab, contextCustomer?: string) => void;
  isModal?: boolean;
  onCloseModal?: () => void;
}

export const POSOrdersHistory: React.FC<POSOrdersHistoryProps> = ({
  currentUser,
  onNavigate,
  isModal = false,
  onCloseModal,
}) => {
  const [sales, setSales] = useState<SaleInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentFilter, setPaymentFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selectedInvoice, setSelectedInvoice] = useState<SaleInvoice | null>(null);
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<SaleInvoice | null>(null);
  const [authorizedEditor, setAuthorizedEditor] = useState<Salesperson | null>(null);

  // Pagination: number of receipts visible on page
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  // Older Receipts Period State
  // Default industry-standard period: Yesterday and 2 more days going backwards (3 days prior)
  const [showOlderReceiptsModal, setShowOlderReceiptsModal] = useState<boolean>(false);
  const [activePeriodType, setActivePeriodType] = useState<'today' | 'past3days' | 'last7days' | 'last30days' | 'custom' | 'all'>('today');

  // Custom date range state
  const computePast3DaysRange = () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);

    return {
      start: threeDaysAgo.toISOString().split('T')[0],
      end: yesterday.toISOString().split('T')[0],
    };
  };

  const defaultOlder = computePast3DaysRange();
  const [startDateInput, setStartDateInput] = useState<string>(defaultOlder.start);
  const [endDateInput, setEndDateInput] = useState<string>(defaultOlder.end);

  // Security Manager PIN modal state for Refund / Void / Edit Approval
  const [managerModalConfig, setManagerModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    actionType: 'REFUND' | 'VOID' | 'APPROVAL';
    actionDescription: string;
    amount: number;
    invoice?: SaleInvoice;
    onAuthorize?: (manager: Salesperson, reason: string) => void;
  } | null>(null);

  const isPrivileged =
    currentUser?.role === 'Manager' ||
    currentUser?.role === 'Admin' ||
    currentUser?.role === 'OWNER' ||
    currentUser?.role === 'SUPER_ADMIN';

  // Branch Scope: Defaults strictly to current branch with zero cross-branch leakage
  const [scopeFilter, setScopeFilter] = useState<'branch' | 'all'>('branch');
  const activeBranch = useMemo(() => getCurrentBranch(), []);

  const loadData = () => {
    if (scopeFilter === 'all' && isPrivileged) {
      setSales(getAllBranchesSales());
    } else {
      setSales(getSales());
    }
  };

  useEffect(() => {
    loadData();
  }, [scopeFilter]);

  useEffect(() => {
    loadData();
    const handleUpdate = () => loadData();
    const unsub = subscribeToDatabase(handleUpdate);
    window.addEventListener('saimetric_sales_updated', handleUpdate);
    window.addEventListener('saimetric_cash_updated', handleUpdate);
    window.addEventListener('saimetric_cash_movements_updated', handleUpdate);
    window.addEventListener('mesh-catchup-completed', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      unsub();
      window.removeEventListener('saimetric_sales_updated', handleUpdate);
      window.removeEventListener('saimetric_cash_updated', handleUpdate);
      window.removeEventListener('saimetric_cash_movements_updated', handleUpdate);
      window.removeEventListener('mesh-catchup-completed', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const [exchangeInvoice, setExchangeInvoice] = useState<SaleInvoice | null>(null);

  const handleTriggerRefundVoid = (invoice: SaleInvoice) => {
    if (invoice.status === 'Refunded' || invoice.status === 'Voided') return;
    setManagerModalConfig({
      isOpen: true,
      title: 'Manager Authorization: Refund / Void Sale',
      subtitle: `Refund / Void #${invoice.id} (${invoice.total.toFixed(2)}) requires authorization`,
      actionType: 'REFUND',
      actionDescription: `Refund / Void transaction #${invoice.id}, restock items to inventory, and balance cashier drawer`,
      amount: invoice.total,
      invoice,
    });
  };

  const handleAuthorizeManagerAction = (manager: Salesperson, reason: string) => {
    if (!managerModalConfig) return;
    const { actionType, invoice } = managerModalConfig;

    const res = refundSaleInvoice({
      invoiceId: invoice.id,
      manager,
      cashier: currentUser || undefined,
      reason,
    });
    if (res.success) {
      setActionNotice({ text: `Invoice #${invoice.id} refunded / voided. Inventory restocked & cashier till adjusted. Authorized by ${manager.role} ${manager.name}.`, type: 'success' });
      loadData();
    } else {
      setActionNotice({ text: res.message, type: 'error' });
    }

    setManagerModalConfig(null);
  };

  // Date period filtering
  const periodFilteredSales = useMemo(() => {
    // When user types a search query (invoice #, customer, staff, product), search across all receipts so invoices are never hidden
    if (searchQuery && searchQuery.trim().length > 0) {
      return sales;
    }

    const todayUtc = new Date().toISOString().split('T')[0];
    const todayLocal = getTodayDateString();

    return sales.filter((sale) => {
      const saleDate = sale.date || toDateStringSafe(sale.timestamp);

      if (activePeriodType === 'today') {
        const isToday = isSameDaySafe(sale.date, sale.timestamp, todayLocal) || isSameDaySafe(sale.date, sale.timestamp, todayUtc);
        return isToday;
      }

      if (activePeriodType === 'past3days') {
        // Yesterday and 2 more days going backwards
        return saleDate >= defaultOlder.start && saleDate <= defaultOlder.end;
      }

      if (activePeriodType === 'last7days') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        const limitStr = d.toISOString().split('T')[0];
        return saleDate >= limitStr && (saleDate <= todayLocal || saleDate <= todayUtc);
      }

      if (activePeriodType === 'last30days') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        const limitStr = d.toISOString().split('T')[0];
        return saleDate >= limitStr && (saleDate <= todayLocal || saleDate <= todayUtc);
      }

      if (activePeriodType === 'custom') {
        const start = startDateInput || '1970-01-01';
        const end = endDateInput || '2099-12-31';
        return saleDate >= start && saleDate <= end;
      }

      return true; // 'all'
    });
  }, [sales, activePeriodType, startDateInput, endDateInput, defaultOlder.start, defaultOlder.end]);

  const filteredSales = useMemo(() => {
    return periodFilteredSales.filter((sale) => {
      const matchesPayment =
        paymentFilter === 'All' ||
        sale.paymentMethod === paymentFilter ||
        sale.currency === paymentFilter ||
        (paymentFilter === 'EcoCash' &&
          (sale.paymentMethod === 'EcoCash' ||
            sale.paymentMethod === 'EcoCash/Mobile' ||
            sale.currency === 'EcoCash' ||
            sale.currency === 'ECO')) ||
        (paymentFilter === 'ZiG' &&
          (sale.paymentMethod === 'ZiG' ||
            sale.currency === 'ZiG' ||
            sale.currency === 'ZIG'));
      const matchesStatus =
        statusFilter === 'All' ||
        (statusFilter === 'Paid' && sale.status !== 'Refunded' && sale.status !== 'Voided') ||
        sale.status === statusFilter;

      const q = (searchQuery || '').toLowerCase().trim();
      const matchesSearch =
        !q ||
        (sale.id && sale.id.toLowerCase().includes(q)) ||
        (sale.customerName && sale.customerName.toLowerCase().includes(q)) ||
        (sale.staffName && sale.staffName.toLowerCase().includes(q)) ||
        (sale.itemsSummary && sale.itemsSummary.toLowerCase().includes(q));
      return matchesPayment && matchesStatus && matchesSearch;
    });
  }, [periodFilteredSales, paymentFilter, statusFilter, searchQuery]);

  // Sliced for page visibility
  const displayedSales = useMemo(() => {
    return filteredSales.slice(0, visibleCount);
  }, [filteredSales, visibleCount]);

  const refundedCount = useMemo(() => {
    return filteredSales.filter((s) => s.status === 'Refunded').length;
  }, [filteredSales]);

  const voidedCount = useMemo(() => {
    return filteredSales.filter((s) => s.status === 'Voided').length;
  }, [filteredSales]);

  // Edit Receipt for Authorized Staff with Audit Trail Logging
  const handleTriggerEdit = (sale: SaleInvoice) => {
    if (isSupervisorOrAbove(currentUser?.role)) {
      setAuthorizedEditor(currentUser || null);
      setEditingInvoice(sale);
    } else {
      setManagerModalConfig({
        isOpen: true,
        title: 'Manager PIN Required: Edit Receipt',
        subtitle: `Modifying Receipt #${sale.id} requires Supervisor or Manager authorization`,
        actionType: 'APPROVAL',
        actionDescription: `Edit details for Receipt #${sale.id} ($${sale.total.toFixed(2)})`,
        amount: sale.total,
        invoice: sale,
        onAuthorize: (manager, _reason) => {
          setAuthorizedEditor(manager);
          setEditingInvoice(sale);
          setManagerModalConfig(null);
        },
      });
    }
  };

  const handleSaveReceiptEdit = (updates: any, reason: string) => {
    if (!editingInvoice) return;
    const staff = currentUser || authorizedEditor || { id: 'staff', name: 'Authorized Staff', role: 'Staff' };
    const result = editSaleInvoice({
      invoiceId: editingInvoice.id,
      staff,
      authorizedBy: authorizedEditor || undefined,
      reason,
      updates,
    });

    if (result.success) {
      setSales(getSales());
      setActionNotice({
        text: `Receipt #${editingInvoice.id} successfully updated and recorded in Audit Trail.`,
        type: 'success',
      });
      setEditingInvoice(null);
      setAuthorizedEditor(null);
    } else {
      setActionNotice({
        text: result.message || 'Failed to update receipt.',
        type: 'error',
      });
    }
  };

  const handleApplyOlderPeriod = (period: 'past3days' | 'last7days' | 'last30days' | 'custom' | 'all') => {
    setActivePeriodType(period);
    setVisibleCount(PAGE_SIZE);
    setShowOlderReceiptsModal(false);
  };

  const periodLabel = useMemo(() => {
    switch (activePeriodType) {
      case 'today':
        return "Today's Receipts";
      case 'past3days':
        return `Past 3 Days (${defaultOlder.start} to ${defaultOlder.end})`;
      case 'last7days':
        return 'Last 7 Days';
      case 'last30days':
        return 'Last 30 Days';
      case 'custom':
        return `Custom (${startDateInput} to ${endDateInput})`;
      case 'all':
        return 'All Historical Receipts';
      default:
        return 'Receipts';
    }
  }, [activePeriodType, defaultOlder.start, defaultOlder.end, startDateInput, endDateInput]);

  return (
    <div id="pos-receipts-screen" className={`max-w-6xl mx-auto space-y-4 ${isModal ? 'p-2' : 'pb-28'}`}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-lg backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-md shrink-0">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Receipts</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono font-bold border border-blue-500/30">
                {periodLabel}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Electronic customer receipts • View, reprint invoices &amp; transaction audit
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          {/* Explicit Branch vs All Branches Scope Toggle */}
          {isPrivileged && (
            <div className="flex items-center p-0.5 rounded-2xl bg-slate-950/80 border border-slate-700/80 shadow-inner">
              <button
                type="button"
                onClick={() => setScopeFilter('branch')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  scopeFilter === 'branch'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Strictly isolated to current branch: ${activeBranch.name} (${activeBranch.code || 'HQ-01'})`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span className="max-w-[120px] truncate">{activeBranch.name || 'This Branch'}</span>
              </button>
              <button
                type="button"
                onClick={() => setScopeFilter('all')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  scopeFilter === 'all'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Consolidated view: View all branches in active company"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>All Branches</span>
              </button>
            </div>
          )}

          {/* Get Older Receipts Button */}
          <button
            type="button"
            id="btn-get-older-receipts"
            onClick={() => setShowOlderReceiptsModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl text-xs font-bold shadow-sm transition active:scale-95"
            title="Select date or period for older receipts (default: yesterday and 2 more days going backwards)"
          >
            <Clock className="w-4 h-4 text-amber-400" />
            <span>Get Older Receipts</span>
          </button>

          {activePeriodType !== 'today' && (
            <button
              type="button"
              onClick={() => {
                setActivePeriodType('today');
                setVisibleCount(PAGE_SIZE);
              }}
              className="px-3 py-2 bg-slate-800/80 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-2xl transition border border-slate-700"
            >
              Back to Today
            </button>
          )}

          {onNavigate && !isModal && (
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white rounded-2xl text-xs font-bold shadow-md hover:brightness-110 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>New Sale</span>
            </button>
          )}

          {isModal && onCloseModal && (
            <button
              type="button"
              onClick={onCloseModal}
              className="p-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              title="Close Receipts Window"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Receipts Summary Badges */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3">
          <span className="text-[10px] text-slate-400 block font-semibold uppercase">Total Receipts</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-lg font-black font-mono text-white">{filteredSales.length}</span>
            <span className="text-[10px] text-slate-500">Invoices</span>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3">
          <span className="text-[10px] text-slate-400 block font-semibold uppercase">Voided / Refunded</span>
          <div className="flex items-baseline justify-between mt-0.5">
            <span className="text-lg font-black font-mono text-rose-400">{refundedCount + voidedCount}</span>
            <span className="text-[10px] text-rose-400/70">Reversed</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-3.5 space-y-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by receipt #, customer name, cashier, item name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-10 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#6A4DFF]"
            />
          </div>

          <div className="sm:col-span-3 flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <select
              value={paymentFilter}
              onChange={(e) => {
                setPaymentFilter(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#6A4DFF]"
            >
              <option value="All">All Payment Methods</option>
              <option value="Cash">Cash (USD)</option>
              <option value="ZiG">ZiG (Zimbabwe Gold)</option>
              <option value="EcoCash">EcoCash Mobile Money</option>
              <option value="Credit">Form 3 Credit</option>
              <option value="Card">Bank Card / POS</option>
              <option value="Bank Transfer">Bank Transfer</option>
            </select>
          </div>

          <div className="sm:col-span-3 flex items-center space-x-1.5">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#6A4DFF]"
            >
              <option value="All">All Statuses</option>
              <option value="Paid">Paid / Settled Only</option>
              <option value="Refunded">Refunded Only</option>
              <option value="Voided">Voided Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Action Notice Banner */}
      {actionNotice && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-2xl text-xs font-semibold ${
            actionNotice.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
              : 'bg-rose-950/80 border border-rose-800 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2">
            {actionNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span>{actionNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-white text-xs ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Receipts Table (Showing receipts that comfortably fit the page) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Receipt # &amp; Cloud Sync</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4">Date &amp; Time</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Items</th>
                <th className="py-3 px-3">Method</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-center">Receipt Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {displayedSales.map((sale, sIdx) => {
                const isCredit = sale.paymentMethod === 'Credit';
                const isCash = sale.paymentMethod === 'Cash';
                const isRefunded = sale.status === 'Refunded';
                const isVoided = sale.status === 'Voided';
                const isCompleted = !isRefunded && !isVoided;

                return (
                  <tr key={`${sale.id}-${sIdx}`} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-white flex items-center gap-1.5">
                        <span>{sale.id}</span>
                      </div>
                      <div className="mt-1">
                        <SyncStatusDot
                          isSynced={sale.synced}
                          syncStatus={(sale as any).syncStatus}
                          timestamp={sale.timestamp}
                          invoiceId={sale.id}
                          invoiceType="sale"
                          onRetry={async () => {
                            await retrySyncInvoice(sale.id, 'sale');
                            loadData();
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {isRefunded ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-950/80 text-amber-400 border border-amber-800/60" title={sale.refundReason}>
                          <RotateCcw className="w-2.5 h-2.5" />
                          <span>Refunded</span>
                        </span>
                      ) : isVoided ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-950/80 text-rose-400 border border-rose-800/60" title={sale.voidReason}>
                          <Ban className="w-2.5 h-2.5" />
                          <span>Voided</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          <span>Paid</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                      {sale.date}
                      <span className="text-[10px] text-slate-500 block">
                        by {sale.staffName}
                      </span>
                      {sale.lastEditedBy && (
                        <span className="text-[9px] text-amber-400 block font-semibold" title={`Edited: ${sale.editReason || 'Details modified'}`}>
                          ✏️ Edited by {sale.lastEditedBy}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-200">
                      <div>{sale.customerName}</div>
                      {isCredit && onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate('credit_report', sale.customerName)}
                          className="text-[10px] text-rose-400 hover:underline font-semibold"
                        >
                          View Ledger &gt;
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-300 max-w-[200px] truncate text-[11px]">
                      {sale.itemsSummary || '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isCredit
                            ? 'bg-rose-950 text-rose-300 border-rose-800/60'
                            : isCash
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800/60'
                            : 'bg-blue-950 text-blue-300 border-blue-800/60'
                        }`}
                      >
                        {isCredit && <CreditCard className="w-2.5 h-2.5" />}
                        {isCash && <Banknote className="w-2.5 h-2.5" />}
                        <span>{sale.paymentMethod}</span>
                      </span>
                    </td>
                    <td className={`py-3 px-4 text-right font-mono font-black text-sm ${isRefunded || isVoided ? 'text-slate-500 line-through' : 'text-white'}`}>
                      <div>${sale.total.toFixed(2)}</div>
                      {sale.cashWithdrawalAmount && sale.cashWithdrawalAmount > 0 && (
                        <div className="mt-0.5 space-y-0.5">
                          <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-bold border border-emerald-800/50">
                            +${sale.cashWithdrawalAmount.toFixed(2)} Cash-Out
                          </span>
                          <div className="text-[10px] font-mono font-bold text-amber-300">
                            Slip: ${(Number(sale.grossTenderUsd) || (sale.total + sale.cashWithdrawalAmount)).toFixed(2)} USD
                            {sale.totalChargedInCurrency ? ` (${sale.totalChargedInCurrency.toFixed(2)} ${sale.currency})` : ''}
                          </div>
                        </div>
                      )}
                      {(sale.proofOfPaymentRef || sale.paymentReference) && (
                        <div className="text-[9px] text-slate-400 font-mono mt-0.5">
                          Ref: {sale.proofOfPaymentRef || sale.paymentReference}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(sale)}
                          className="px-2.5 py-1 rounded-xl bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white text-xs font-bold border border-blue-500/40 transition-colors flex items-center space-x-1"
                          title="View & Print Receipt"
                        >
                          <Printer className="w-3 h-3" />
                          <span>Receipt</span>
                        </button>

                        {isCompleted && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExchangeInvoice(sale)}
                              className="px-2.5 py-1 rounded-xl bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs font-bold border border-indigo-500/40 transition-colors flex items-center space-x-1"
                              title="Exchange Item (Square/Lightspeed POS item replacement without voiding receipt)"
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              <span>Exchange</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleTriggerRefundVoid(sale)}
                              className="px-2 py-1 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white text-xs font-semibold border border-rose-800/60 flex items-center space-x-1 transition-colors"
                              title="Refund / Void Sale (Restocks inventory & reconciles cashier till)"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Refund / Void</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <Receipt className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-semibold">No receipts found for this period</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Click &ldquo;Get Older Receipts&rdquo; to query prior dates or switch filters
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Load More Pagination Bar */}
        {filteredSales.length > displayedSales.length && (
          <div className="p-3 border-t border-slate-800 bg-slate-950/50 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">
              Showing <strong className="text-white">{displayedSales.length}</strong> of{' '}
              <strong className="text-white">{filteredSales.length}</strong> receipts
            </span>

            <button
              type="button"
              id="btn-load-more-receipts"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="px-4 py-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow transition active:scale-95 flex items-center space-x-1.5"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>Load More Receipts (+{PAGE_SIZE})</span>
            </button>
          </div>
        )}
      </div>

      {/* GET OLDER RECEIPTS MODAL */}
      {showOlderReceiptsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Get Older Receipts</h3>
                  <p className="text-xs text-slate-400">Select date period to load historical receipts</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOlderReceiptsModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              {/* Preset 1 (Default): Past 3 Days (Yesterday + 2 more days going backwards) */}
              <button
                type="button"
                onClick={() => handleApplyOlderPeriod('past3days')}
                className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition ${
                  activePeriodType === 'past3days'
                    ? 'bg-amber-950/60 border-amber-500/80 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold text-xs text-amber-300 flex items-center gap-1.5">
                    <span>Past 3 Days (Default)</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                      RECOMMENDED
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Yesterday and 2 more days backwards ({defaultOlder.start} to {defaultOlder.end})
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

              {/* Preset 2: Last 7 Days */}
              <button
                type="button"
                onClick={() => handleApplyOlderPeriod('last7days')}
                className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition ${
                  activePeriodType === 'last7days'
                    ? 'bg-blue-950/60 border-blue-500/80 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold text-xs text-blue-300">Last 7 Days</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Prior one full week of receipts</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

              {/* Preset 3: Last 30 Days */}
              <button
                type="button"
                onClick={() => handleApplyOlderPeriod('last30days')}
                className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition ${
                  activePeriodType === 'last30days'
                    ? 'bg-indigo-950/60 border-indigo-500/80 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold text-xs text-indigo-300">Last 30 Days</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Full monthly receipt ledger</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>

              {/* Preset 4: All Time */}
              <button
                type="button"
                onClick={() => handleApplyOlderPeriod('all')}
                className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition ${
                  activePeriodType === 'all'
                    ? 'bg-purple-950/60 border-purple-500/80 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-bold text-xs text-purple-300">All Historical Receipts</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Entire offline Room DB invoice store</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {/* Custom Date Range Picker */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Or Select Custom Date Period:
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">From Date</label>
                  <input
                    type="date"
                    value={startDateInput}
                    onChange={(e) => setStartDateInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">To Date</label>
                  <input
                    type="date"
                    value={endDateInput}
                    onChange={(e) => setEndDateInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleApplyOlderPeriod('custom')}
                className="w-full py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:opacity-95 text-white font-bold text-xs rounded-xl transition"
              >
                Apply Custom Date Range
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT VIEW MODAL */}
      {selectedInvoice && (
        <ReceiptModal
          isOpen={!!selectedInvoice}
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onExchange={(inv) => setExchangeInvoice(inv)}
        />
      )}

      {/* ITEM EXCHANGE MODAL (Square / Lightspeed Standard Immutability) */}
      {exchangeInvoice && (
        <ItemExchangeModal
          isOpen={!!exchangeInvoice}
          invoice={exchangeInvoice}
          currentStaff={currentUser || ({ id: 'staff', name: 'Cashier', role: 'CASHIER' } as any)}
          onClose={() => setExchangeInvoice(null)}
          onExchangeSuccess={() => {
            loadData();
            setActionNotice({ text: 'Item exchange processed and recorded successfully.', type: 'success' });
          }}
        />
      )}

      {/* MANAGER PIN AUTHORIZATION MODAL FOR REFUND / VOID */}
      {managerModalConfig && (
        <ManagerPinModal
          isOpen={managerModalConfig.isOpen}
          onClose={() => setManagerModalConfig(null)}
          title={managerModalConfig.title}
          subtitle={managerModalConfig.subtitle}
          actionType={managerModalConfig.actionType}
          actionDescription={managerModalConfig.actionDescription}
          amount={managerModalConfig.amount}
          currentStaff={currentUser}
          reasonRequired={true}
          onAuthorize={(manager, reason) => {
            if (managerModalConfig.onAuthorize) {
              managerModalConfig.onAuthorize(manager, reason);
            } else {
              handleAuthorizeManagerAction(manager, reason);
            }
          }}
        />
      )}
    </div>
  );
};
