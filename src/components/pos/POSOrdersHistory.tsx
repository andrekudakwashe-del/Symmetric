import React, { useState, useMemo, useEffect } from 'react';
import { SaleInvoice, ActiveTab, PaymentMethod, Salesperson } from '../../types';
import { getSales, getSalespeople, refundSaleInvoice, voidSaleInvoice } from '../../db/roomDatabase';
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
  Ban,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
} from 'lucide-react';
import { ReceiptModal } from '../common/ReceiptModal';
import { ManagerPinModal } from '../common/ManagerPinModal';

interface POSOrdersHistoryProps {
  currentUser?: Salesperson | null;
  onNavigate: (tab: ActiveTab, contextCustomer?: string) => void;
}

export const POSOrdersHistory: React.FC<POSOrdersHistoryProps> = ({ currentUser, onNavigate }) => {
  const [sales, setSales] = useState<SaleInvoice[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentFilter, setPaymentFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selectedInvoice, setSelectedInvoice] = useState<SaleInvoice | null>(null);
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Security Manager PIN modal state for Refund / Void
  const [managerModalConfig, setManagerModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    actionType: 'REFUND' | 'VOID';
    actionDescription: string;
    amount: number;
    invoice: SaleInvoice;
  } | null>(null);

  const loadData = () => {
    setSales(getSales());
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleTriggerRefund = (invoice: SaleInvoice) => {
    if (invoice.status === 'Refunded' || invoice.status === 'Voided') return;
    const isManagerOrAdmin = currentUser?.role === 'Manager' || currentUser?.role === 'Admin';

    if (isManagerOrAdmin && currentUser) {
      const reason = window.prompt(`Enter reason for refunding Invoice #${invoice.id} ($${invoice.total.toFixed(2)}):`, 'Customer Return / Defective');
      if (reason && reason.trim()) {
        const res = refundSaleInvoice({
          invoiceId: invoice.id,
          manager: currentUser,
          cashier: currentUser,
          reason: reason.trim(),
        });
        if (res.success) {
          setActionNotice({ text: res.message, type: 'success' });
          loadData();
        } else {
          setActionNotice({ text: res.message, type: 'error' });
        }
      }
    } else {
      // Cashier requires Manager PIN
      setManagerModalConfig({
        isOpen: true,
        title: 'Manager PIN Required: Invoice Refund',
        subtitle: `Refunding #${invoice.id} ($${invoice.total.toFixed(2)}) requires Manager or Admin authorization`,
        actionType: 'REFUND',
        actionDescription: `Full refund for Invoice #${invoice.id} to ${invoice.customerName}`,
        amount: invoice.total,
        invoice,
      });
    }
  };

  const handleTriggerVoid = (invoice: SaleInvoice) => {
    if (invoice.status === 'Refunded' || invoice.status === 'Voided') return;
    const isManagerOrAdmin = currentUser?.role === 'Manager' || currentUser?.role === 'Admin';

    if (isManagerOrAdmin && currentUser) {
      const reason = window.prompt(`Enter reason for voiding Invoice #${invoice.id} ($${invoice.total.toFixed(2)}):`, 'Duplicate / Mistake Entry');
      if (reason && reason.trim()) {
        const res = voidSaleInvoice({
          invoiceId: invoice.id,
          manager: currentUser,
          cashier: currentUser,
          reason: reason.trim(),
        });
        if (res.success) {
          setActionNotice({ text: res.message, type: 'success' });
          loadData();
        } else {
          setActionNotice({ text: res.message, type: 'error' });
        }
      }
    } else {
      // Cashier requires Manager PIN
      setManagerModalConfig({
        isOpen: true,
        title: 'Manager PIN Required: Void Invoice',
        subtitle: `Voiding #${invoice.id} ($${invoice.total.toFixed(2)}) requires Manager or Admin authorization`,
        actionType: 'VOID',
        actionDescription: `Void transaction #${invoice.id} and reverse inventory & cash entries`,
        amount: invoice.total,
        invoice,
      });
    }
  };

  const handleAuthorizeManagerAction = (manager: Salesperson, reason: string) => {
    if (!managerModalConfig) return;
    const { actionType, invoice } = managerModalConfig;

    if (actionType === 'REFUND') {
      const res = refundSaleInvoice({
        invoiceId: invoice.id,
        manager,
        cashier: currentUser || undefined,
        reason,
      });
      if (res.success) {
        setActionNotice({ text: `Invoice #${invoice.id} refunded. Authorized by ${manager.role} ${manager.name}.`, type: 'success' });
        loadData();
      } else {
        setActionNotice({ text: res.message, type: 'error' });
      }
    } else {
      const res = voidSaleInvoice({
        invoiceId: invoice.id,
        manager,
        cashier: currentUser || undefined,
        reason,
      });
      if (res.success) {
        setActionNotice({ text: `Invoice #${invoice.id} voided. Authorized by ${manager.role} ${manager.name}.`, type: 'success' });
        loadData();
      } else {
        setActionNotice({ text: res.message, type: 'error' });
      }
    }

    setManagerModalConfig(null);
  };

  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const matchesPayment =
        paymentFilter === 'All' || sale.paymentMethod === paymentFilter;
      const q = (searchQuery || '').toLowerCase().trim();
      const matchesSearch =
        !q ||
        (sale.id && sale.id.toLowerCase().includes(q)) ||
        (sale.customerName && sale.customerName.toLowerCase().includes(q)) ||
        (sale.staffName && sale.staffName.toLowerCase().includes(q)) ||
        (sale.itemsSummary && sale.itemsSummary.toLowerCase().includes(q));
      return matchesPayment && matchesSearch;
    });
  }, [sales, paymentFilter, searchQuery]);

  const totalRevenue = useMemo(() => {
    return filteredSales.reduce((acc, s) => acc + (s.total || 0), 0);
  }, [filteredSales]);

  const creditSalesTotal = useMemo(() => {
    return filteredSales
      .filter((s) => s.paymentMethod === 'Credit')
      .reduce((acc, s) => acc + (s.total || 0), 0);
  }, [filteredSales]);

  const cashSalesTotal = useMemo(() => {
    return filteredSales
      .filter((s) => s.paymentMethod === 'Cash')
      .reduce((acc, s) => acc + (s.total || 0), 0);
  }, [filteredSales]);

  return (
    <div id="pos-orders-history-screen" className="max-w-6xl mx-auto space-y-4 pb-28">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-3xl p-4 shadow-lg backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-md">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Sales & Orders Ledger</h1>
            <p className="text-xs text-slate-400">
              Complete POS invoice transactions • Auto-synced with Form 2 & Form 3
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('pos')}
          className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white rounded-2xl text-xs font-bold shadow-md hover:brightness-110 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>New POS Register Sale</span>
        </button>
      </div>

      {/* Metric Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5">
          <span className="text-[11px] text-slate-400 block font-semibold">Total Filtered Sales</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold font-mono text-white">${totalRevenue.toFixed(2)}</span>
            <span className="text-xs font-bold text-slate-400">{filteredSales.length} Invoices</span>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5">
          <span className="text-[11px] text-emerald-400 block font-semibold flex items-center space-x-1">
            <Banknote className="w-3.5 h-3.5" />
            <span>Cash Sales (Form 2 Logged)</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold font-mono text-emerald-400">${cashSalesTotal.toFixed(2)}</span>
            <span className="text-[10px] text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-800/40">
              In Cash Register
            </span>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5">
          <span className="text-[11px] text-rose-400 block font-semibold flex items-center space-x-1">
            <CreditCard className="w-3.5 h-3.5" />
            <span>Credit Sales (Form 3 Logged)</span>
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold font-mono text-rose-400">${creditSalesTotal.toFixed(2)}</span>
            <button
              type="button"
              onClick={() => onNavigate('credit_report')}
              className="text-[10px] text-rose-300 hover:underline font-bold"
            >
              Debtors Ledger &gt;
            </button>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by invoice ID, customer name, salesperson, or items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#6A4DFF]"
            />
          </div>

          <div className="sm:col-span-4 flex items-center space-x-2">
            <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#6A4DFF]"
            >
              <option value="All">All Payment Methods</option>
              <option value="Cash">Cash Only</option>
              <option value="Credit">Credit (Pay Later) Only</option>
              <option value="Card">Bank Card</option>
              <option value="EcoCash/Mobile">EcoCash / Mobile Money</option>
              <option value="Bank Transfer">Bank Transfer</option>
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

      {/* Invoices List Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-3.5 px-4">Invoice #</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Date & Time</th>
                <th className="py-3.5 px-4">Customer</th>
                <th className="py-3.5 px-4">Items Summary</th>
                <th className="py-3.5 px-4">Payment Method</th>
                <th className="py-3.5 px-4 text-right">Total Amount</th>
                <th className="py-3.5 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredSales.map((sale) => {
                const isCredit = sale.paymentMethod === 'Credit';
                const isCash = sale.paymentMethod === 'Cash';
                const isRefunded = sale.status === 'Refunded';
                const isVoided = sale.status === 'Voided';
                const isCompleted = !isRefunded && !isVoided;

                return (
                  <tr key={sale.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-white">
                      {sale.id}
                    </td>
                    <td className="py-3 px-4">
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
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-200">
                      <div>{sale.customerName}</div>
                      {isCredit && (
                        <button
                          type="button"
                          onClick={() => onNavigate('credit_report', sale.customerName)}
                          className="text-[10px] text-rose-400 hover:underline font-semibold"
                        >
                          View in Credit Report &gt;
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-300 max-w-[200px] truncate text-[11px]">
                      {sale.itemsSummary || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                          isCredit
                            ? 'bg-rose-950 text-rose-300 border-rose-800/60'
                            : isCash
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800/60'
                            : 'bg-blue-950 text-blue-300 border-blue-800/60'
                        }`}
                      >
                        {isCredit && <CreditCard className="w-3 h-3" />}
                        {isCash && <Banknote className="w-3 h-3" />}
                        <span>{sale.paymentMethod}</span>
                      </span>
                    </td>
                    <td className={`py-3 px-4 text-right font-mono font-black text-sm ${isRefunded || isVoided ? 'text-slate-500 line-through' : 'text-white'}`}>
                      ${sale.total.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(sale)}
                          className="px-2 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
                          title="View & Print Receipt"
                        >
                          Receipt
                        </button>

                        {isCompleted && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleTriggerRefund(sale)}
                              className="px-2 py-1 rounded-xl bg-amber-950/60 hover:bg-amber-900 text-amber-300 hover:text-white text-xs font-semibold border border-amber-800/60 flex items-center space-x-1 transition-colors"
                              title="Refund Invoice (Requires Manager PIN for Cashiers)"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Refund</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleTriggerVoid(sale)}
                              className="px-2 py-1 rounded-xl bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white text-xs font-semibold border border-rose-800/60 flex items-center space-x-1 transition-colors"
                              title="Void Invoice (Requires Manager PIN for Cashiers)"
                            >
                              <Ban className="w-3 h-3" />
                              <span>Void</span>
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
                    <p className="text-sm font-semibold">No sales invoices found</p>
                    <p className="text-xs text-slate-600 mt-0.5">Use the POS Register to create your first sale</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RECEIPT VIEW MODAL */}
      {selectedInvoice && (
        <ReceiptModal
          isOpen={!!selectedInvoice}
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
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
          onAuthorize={handleAuthorizeManagerAction}
        />
      )}
    </div>
  );
};
