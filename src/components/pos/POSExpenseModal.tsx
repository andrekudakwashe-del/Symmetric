import React, { useState } from 'react';
import { Salesperson, ExpenseEntry } from '../../types';
import { addExpense } from '../../db/roomDatabase';
import { X, Check, DollarSign, Tag, FileText, User } from 'lucide-react';

interface POSExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson | null;
  onExpenseAdded?: (expense: ExpenseEntry) => void;
}

const EXPENSE_CATEGORIES = [
  'Transport & Fuel',
  'Food & Refreshments',
  'Airtime & Data',
  'Packaging & Bags',
  'Store Utilities',
  'Staff Allowance',
  'Repairs & Maintenance',
  'Miscellaneous',
];

export const POSExpenseModal: React.FC<POSExpenseModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onExpenseAdded,
}) => {
  const [category, setCategory] = useState<string>('Transport & Fuel');
  const [amount, setAmount] = useState<string>('');
  const [vendorOrCustomer, setVendorOrCustomer] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'EcoCash/Mobile' | 'Card' | 'Bank Transfer'>('Cash');
  const [recordCashLog, setRecordCashLog] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Please enter a valid expense amount.');
      return;
    }
    if (!description.trim()) {
      setError('Please enter a brief description for this expense.');
      return;
    }

    try {
      const now = new Date();
      const newExp = addExpense({
        date: now.toISOString().split('T')[0],
        timestamp: now.toISOString(),
        category,
        vendorOrCustomer: vendorOrCustomer.trim() || 'General Expense',
        amount: numAmount,
        paymentMethod,
        staffId: currentUser?.id || '001',
        staffName: currentUser?.name || 'Staff Cashier',
        description: description.trim(),
        recordCashLog: paymentMethod === 'Cash' && recordCashLog,
      });

      if (onExpenseAdded) onExpenseAdded(newExp);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setAmount('');
        setDescription('');
        setVendorOrCustomer('');
        setError('');
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save expense');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold">
              🍃
            </div>
            <div>
              <h3 className="text-base font-black">Add New Expense</h3>
              <p className="text-[11px] text-emerald-100">Directly logs to Form 2 Cash Log register</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full bg-white/10 hover:bg-white/20 transition"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center space-x-2">
              <Check className="w-4 h-4" />
              <span>Expense recorded successfully!</span>
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Expense Amount ($) <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                autoFocus
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError('');
                }}
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-8 pr-4 py-3 text-white text-xl font-mono-num font-black focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Expense Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs font-bold focus:outline-none focus:border-emerald-500"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat} className="bg-slate-900 text-white">
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Description / Reason <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Van diesel, staff lunch, bulk receipt rolls"
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          {/* Vendor / Payee */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Vendor / Paid To (Optional)</label>
            <input
              type="text"
              value={vendorOrCustomer}
              onChange={(e) => setVendorOrCustomer(e.target.value)}
              placeholder="e.g. Total Energies, Local Bakery"
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Payment Method</label>
            <div className="grid grid-cols-2 gap-2">
              {(['Cash', 'EcoCash/Mobile', 'Card', 'Bank Transfer'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition border ${
                    paymentMethod === m
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Cash Log sync checkbox if Cash */}
          {paymentMethod === 'Cash' && (
            <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={recordCashLog}
                onChange={(e) => setRecordCashLog(e.target.checked)}
                className="rounded text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-slate-950 border-slate-700"
              />
              <span>Deduct from Cash Drawer (Form 2 Cash Out)</span>
            </label>
          )}

          {/* Modal Actions */}
          <div className="flex items-center space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white font-bold text-xs shadow-lg flex items-center justify-center space-x-1.5 transition active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>Save Expense</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
