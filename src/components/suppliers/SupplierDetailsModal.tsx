import React, { useState } from 'react';
import {
  Truck,
  X,
  Phone,
  Mail,
  MapPin,
  Calendar,
  DollarSign,
  FileText,
  Boxes,
  Plus,
  Printer,
  ChevronRight,
  ExternalLink,
  Edit3,
  Receipt,
  Sparkles,
} from 'lucide-react';
import { Supplier, SupplierInvoiceVoucher } from '../../types';
import { getSupplierInvoices, getSupplierStats } from '../../db/roomDatabase';

interface SupplierDetailsModalProps {
  supplier: Supplier | null;
  isOpen: boolean;
  onClose: () => void;
  onCreateGRNForSupplier: (supplierName: string) => void;
  onViewVoucher: (voucher: SupplierInvoiceVoucher) => void;
}

export const SupplierDetailsModal: React.FC<SupplierDetailsModalProps> = ({
  supplier,
  isOpen,
  onClose,
  onCreateGRNForSupplier,
  onViewVoucher,
}) => {
  const [activeTab, setActiveTab] = useState<'invoices' | 'profile'>('invoices');

  if (!isOpen || !supplier) return null;

  const invoices = getSupplierInvoices(supplier.supplierId);
  const stats = getSupplierStats(supplier.supplierId);

  return (
    <div
      id="modal-supplier-details"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
    >
      <div className="bg-slate-850 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
        {/* Header */}
        <div className="p-6 bg-slate-800 border-b border-slate-700 flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold shrink-0">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">{supplier.name}</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-900/60 text-blue-300 border border-blue-700/50">
                  {supplier.supplierId}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    supplier.status === 'Active'
                      ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {supplier.status || 'Active'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                <span>{supplier.category}</span>
                {supplier.city && <span>• {supplier.city}</span>}
                {supplier.paymentTerms && <span>• {supplier.paymentTerms}</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Stats Banner */}
        <div className="grid grid-cols-3 gap-px bg-slate-750 border-b border-slate-700 p-4">
          <div className="text-center px-4">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">
              Total Purchases
            </span>
            <span className="text-xl font-bold font-mono text-emerald-400 mt-0.5 block">
              ${stats.totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-center px-4 border-x border-slate-700">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">
              Invoices & GRNs
            </span>
            <span className="text-xl font-bold font-mono text-white mt-0.5 block">
              {stats.invoiceCount} vouchers
            </span>
          </div>
          <div className="text-center px-4">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">
              Total Units Received
            </span>
            <span className="text-xl font-bold font-mono text-blue-400 mt-0.5 block">
              {stats.totalUnits.toLocaleString()} units
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-700 bg-slate-800/60 px-6">
          <button
            onClick={() => setActiveTab('invoices')}
            className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'invoices'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Receipt className="w-4 h-4" />
            Supplier Invoices & Goods Received ({invoices.length})
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'profile'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            Supplier Details & Contact Info
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 max-h-[480px] overflow-y-auto">
          {activeTab === 'invoices' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  Past Goods Received Vouchers from {supplier.name}
                </span>
                <button
                  onClick={() => {
                    onClose();
                    onCreateGRNForSupplier(supplier.name);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                  + Receive New Delivery (GRN)
                </button>
              </div>

              {invoices.length === 0 ? (
                <div className="py-12 text-center bg-slate-900/50 rounded-2xl border border-slate-800">
                  <Receipt className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-300">No Invoices Recorded Yet</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                    Receive goods from {supplier.name} to generate Goods Received Vouchers and build purchase history.
                  </p>
                  <button
                    onClick={() => {
                      onClose();
                      onCreateGRNForSupplier(supplier.name);
                    }}
                    className="mt-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Create First Goods Received Voucher
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {invoices.map((inv) => (
                    <div
                      key={inv.voucherId}
                      className="p-4 rounded-xl bg-slate-900 border border-slate-700/70 hover:border-slate-600 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white text-sm">
                            {inv.invoiceNo}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                            {inv.voucherId}
                          </span>
                          {inv.ruleATriggeredCount !== undefined && inv.ruleATriggeredCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5" />
                              Rule A ({inv.ruleATriggeredCount})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            {inv.date}
                          </span>
                          {inv.purchaseOrderNo && (
                            <span className="font-mono">PO: {inv.purchaseOrderNo}</span>
                          )}
                          <span>{inv.items.length} line items</span>
                          <span>• {inv.totalCases} cases</span>
                          {inv.totalSingles > 0 && <span>• {inv.totalSingles} singles</span>}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                        <div className="text-right">
                          <span className="text-base font-bold font-mono text-emerald-400">
                            ${inv.totalInvoiceAmount.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Rec by: {inv.staffName}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            onClose();
                            onViewVoucher(inv);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          View Voucher
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <span className="text-slate-400 font-semibold block uppercase tracking-wider text-[10px]">
                  Contact & Communication
                </span>
                <div>
                  <span className="text-slate-500 block">Contact Person:</span>
                  <span className="text-white font-medium">{supplier.contactPerson || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Phone Number:</span>
                  <span className="text-white font-mono font-medium">{supplier.phone || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Email Address:</span>
                  <span className="text-white font-medium">{supplier.email || 'N/A'}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <span className="text-slate-400 font-semibold block uppercase tracking-wider text-[10px]">
                  Address & Location
                </span>
                <div>
                  <span className="text-slate-500 block">Physical Address:</span>
                  <span className="text-white font-medium">{supplier.address || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">City / Region:</span>
                  <span className="text-white font-medium">{supplier.city || 'N/A'}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <span className="text-slate-400 font-semibold block uppercase tracking-wider text-[10px]">
                  Financial & Accounting
                </span>
                <div>
                  <span className="text-slate-500 block">Payment Terms:</span>
                  <span className="text-white font-medium">{supplier.paymentTerms || 'Standard'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tax / VAT Number:</span>
                  <span className="text-white font-mono">{supplier.taxNumber || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Our Account Number:</span>
                  <span className="text-white font-mono">{supplier.accountNumber || 'N/A'}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <span className="text-slate-400 font-semibold block uppercase tracking-wider text-[10px]">
                  Additional Notes
                </span>
                <p className="text-slate-300 italic">
                  {supplier.notes || 'No special notes recorded for this supplier.'}
                </p>
                <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500">
                  Registered: {supplier.createdDate || 'N/A'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-800 border-t border-slate-700 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => {
              onClose();
              onCreateGRNForSupplier(supplier.name);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all shadow flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Receive Invoice for {supplier.name}
          </button>
        </div>
      </div>
    </div>
  );
};
