import React, { useState } from 'react';
import {
  X,
  Save,
  AlertTriangle,
  Receipt,
  User,
  CreditCard,
  Hash,
  FileText,
  DollarSign,
  Plus,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import { SaleInvoice, Salesperson, PaymentMethod } from '../../types';

interface EditReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: SaleInvoice;
  currentUser: Salesperson | null;
  authorizedBy?: Salesperson | null;
  onSave: (updates: any, reason: string) => void;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  'Cash',
  'EcoCash',
  'Swipe',
  'Card',
  'Credit',
  'Bank Transfer',
  'USD',
  'ZiG',
];

export const EditReceiptModal: React.FC<EditReceiptModalProps> = ({
  isOpen,
  onClose,
  invoice,
  currentUser,
  authorizedBy,
  onSave,
}) => {
  const [customerName, setCustomerName] = useState(invoice.customerName || invoice.customer?.name || '');
  const [customerPhone, setCustomerPhone] = useState(invoice.customer?.phone || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(invoice.paymentMethod || 'Cash');
  const [paymentReference, setPaymentReference] = useState(invoice.proofOfPaymentRef || invoice.paymentReference || '');
  const [discountInput, setDiscountInput] = useState(String(invoice.discount || 0));
  const [cashWithdrawalInput, setCashWithdrawalInput] = useState(String(invoice.cashWithdrawalAmount || 0));
  const [notes, setNotes] = useState(invoice.notes || '');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);

  // Editable items
  const [items, setItems] = useState<any[]>(() => {
    if (Array.isArray(invoice.items)) {
      return invoice.items.map((it: any) => ({
        id: it.id || it.productId || `item-${Math.random()}`,
        name: it.name || it.productName || 'Item',
        quantity: Number(it.quantity) || 1,
        price: Number(it.price || it.unitPrice) || 0,
        unit: it.unit || 'unit',
      }));
    }
    return [];
  });

  if (!isOpen) return null;

  // Calculate live totals
  const subtotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
  const discount = Math.max(0, parseFloat(discountInput) || 0);
  const cashWithdrawal = Math.max(0, parseFloat(cashWithdrawalInput) || 0);
  const total = Math.max(0, subtotal - discount);

  const handleItemQuantityChange = (idx: number, qtyStr: string) => {
    const qty = Math.max(0, parseFloat(qtyStr) || 0);
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, quantity: qty } : item)));
  };

  const handleItemPriceChange = (idx: number, priceStr: string) => {
    const p = Math.max(0, parseFloat(priceStr) || 0);
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, price: p } : item)));
  };

  const handleRemoveItem = (idx: number) => {
    if (items.length <= 1) {
      alert('A receipt must have at least one line item. If you want to cancel the entire sale, please use Void instead.');
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }

    const updates = {
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      paymentMethod,
      proofOfPaymentRef: paymentReference.trim() || undefined,
      paymentReference: paymentReference.trim() || undefined,
      items: items.map((it) => ({
        ...it,
        total: (Number(it.price) || 0) * (Number(it.quantity) || 0),
      })),
      subtotal,
      discount,
      total,
      cashWithdrawalAmount: cashWithdrawal,
      grossTenderUsd: total + cashWithdrawal,
      notes: notes.trim() || undefined,
    };

    onSave(updates, reason.trim());
  };

  const staffName = authorizedBy ? `${authorizedBy.role} ${authorizedBy.name}` : `${currentUser?.role || 'Staff'} ${currentUser?.name || ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl text-white max-h-[92vh] overflow-y-auto space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base sm:text-lg font-black text-white">
                  Edit Receipt #{invoice.id}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/30">
                  Audit Logged
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Authorized editor: <strong className="text-slate-200">{staffName}</strong> • Orig. Date: {invoice.date || invoice.timestamp}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security / Audit Alert Banner */}
        <div className="bg-amber-950/40 border border-amber-500/30 rounded-2xl p-3 flex items-start space-x-2.5 text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong>Security Notice:</strong> All modifications to receipt customer, payment method, quantities, or values are permanent and will be logged into the immutable audit trail with your name and timestamp.
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Section: Customer Info */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              <span>Customer Details</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">Customer Name</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. John Doe / Walk-in Customer"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">Phone / Account #</label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="e.g. +263 77 123 4567"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Section: Payment Method & Reference */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
              <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
              <span>Payment Details</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">
                  Payment Reference / EcoCash Txn #
                </label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="e.g. MP261007.1234.H54321"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Section: Line Items */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
                <Hash className="w-3.5 h-3.5 text-cyan-400" />
                <span>Line Items ({items.length})</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Edit Qty or Price per item</span>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {items.map((it, idx) => (
                <div
                  key={it.id || idx}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white truncate">{it.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      Sub: ${((Number(it.price) || 0) * (Number(it.quantity) || 0)).toFixed(2)}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <div className="w-16">
                      <label className="text-[9px] text-slate-500 block">Qty</label>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        value={it.quantity}
                        onChange={(e) => handleItemQuantityChange(idx, e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-amber-500 text-center"
                      />
                    </div>
                    <div className="w-20">
                      <label className="text-[9px] text-slate-500 block">Price ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={it.price}
                        onChange={(e) => handleItemPriceChange(idx, e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-amber-500 text-right"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      title="Remove item from receipt"
                      className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/80 text-rose-400 hover:text-white transition mt-3"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Financial Adjustments */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">Discount Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">Cash-out / Withdrawal ($)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={cashWithdrawalInput}
                  onChange={(e) => setCashWithdrawalInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Recalculated Total Card */}
            <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Recalculated Receipt Total</span>
                <span className="text-xs text-slate-500 font-mono">
                  Subtotal: ${subtotal.toFixed(2)} {discount > 0 ? `• Discount: -$${discount.toFixed(2)}` : ''}
                </span>
              </div>
              <div className="text-right">
                <span className="text-lg font-black font-mono text-emerald-400">${total.toFixed(2)}</span>
                {cashWithdrawal > 0 && (
                  <span className="text-[10px] text-cyan-300 font-mono block">
                    +${cashWithdrawal.toFixed(2)} Cash-out
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Section: Reason for Edit (Mandatory for Audit Trail) */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-bold text-amber-300 uppercase tracking-wider">
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Mandatory Reason for Modification *</span>
            </div>
            <textarea
              rows={2}
              required
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (e.target.value.trim()) setReasonError(false);
              }}
              placeholder="e.g. Corrected typo in customer name; updated payment method from Cash to EcoCash as verified with cashier slip"
              className={`w-full bg-slate-900 border rounded-xl px-3 py-2 text-xs text-white focus:outline-none ${
                reasonError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-700 focus:border-amber-500'
              }`}
            />
            {reasonError && (
              <span className="text-[11px] text-rose-400 block font-semibold">
                Please enter a reason for this edit to record in the audit trail.
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-black text-white flex items-center space-x-2 shadow-lg transition active:scale-95 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save &amp; Log to Audit Trail</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
