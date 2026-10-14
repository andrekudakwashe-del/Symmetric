import React, { useState } from 'react';
import { Salesperson, ExpenseEntry } from '../../types';
import { addExpense, isSupervisorOrAbove } from '../../db/roomDatabase';
import { addMovement, getShiftId } from '../../db/cashLedger';
import { X, Check, DollarSign, Tag, FileText, User, Receipt, Clock, ShieldCheck, AlertCircle } from 'lucide-react';

interface Form2ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
  selectedStaff: Salesperson;
  sheetDate: string;
  onExpenseAdded?: (expense: ExpenseEntry) => void;
}

export const FORM2_EXPENSE_CATEGORIES = [
  'Transport & Fuel',
  'Food & Refreshments / Staff Meals (Cash)',
  'Packaging & Bags',
  'Store Utilities & Electricity',
  'Airtime & Data Vouchers',
  'Cleaning & Sanitation',
  'Repairs & Maintenance',
  'Staff Welfare & Allowances',
  'Miscellaneous Store Supplies',
];

const QUICK_AMOUNTS = [2, 5, 10, 20, 50, 100];

export const Form2ExpenseModal: React.FC<Form2ExpenseModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  selectedStaff,
  sheetDate,
  onExpenseAdded,
}) => {
  const [category, setCategory] = useState<string>(FORM2_EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState<string>('');
  const [vendorOrCustomer, setVendorOrCustomer] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [receiptRef, setReceiptRef] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const isSupervisor = isSupervisorOrAbove(currentUser.role);

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
        date: sheetDate,
        timestamp: now.toISOString(),
        category,
        vendorOrCustomer: vendorOrCustomer.trim() || 'General Expense',
        amount: numAmount,
        paymentMethod: 'Cash',
        staffId: selectedStaff.id,
        staffName: selectedStaff.name,
        description: description.trim(),
        receiptRef: receiptRef.trim() || undefined,
        recordCashLog: true,
        status: isSupervisor ? 'approved' : 'pending_supervisor',
        approvedBy: isSupervisor ? currentUser.id : undefined,
        approvedByName: isSupervisor ? currentUser.name : undefined,
        approvalTimestamp: isSupervisor ? now.toISOString() : undefined,
      });

      // Also record petty cash movement in shift cash ledger
      addMovement({
        shiftId: getShiftId(selectedStaff.id, sheetDate),
        staffId: selectedStaff.id,
        date: sheetDate,
        timestamp: now.toISOString(),
        type: 'petty_cash',
        amount: numAmount,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: isSupervisor ? 'approved' : 'pending',
        sourceModule: 'form2',
        notes: `Petty Cash: ${category} - ${description.trim()}${vendorOrCustomer ? ` (${vendorOrCustomer.trim()})` : ''}`,
        approvedBy: isSupervisor ? currentUser.id : undefined,
        approvedByName: isSupervisor ? currentUser.name : undefined,
        approvedAt: isSupervisor ? now.toISOString() : undefined,
      });

      if (onExpenseAdded) {
        onExpenseAdded(newExp);
      }

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setAmount('');
        setDescription('');
        setVendorOrCustomer('');
        setReceiptRef('');
        setError('');
        onClose();
      }, 700);
    } catch (err: any) {
      setError(err?.message || 'Failed to save expense');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-scaleUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-700 to-slate-900 p-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-2xl bg-white/10 flex items-center justify-center font-bold text-white shadow-inner">
              <Receipt className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight">Add Petty Cash Expense</h3>
              <p className="text-[11px] text-emerald-100">
                Form 2 Cash Drawer • Paid Out Immediately • Supervisor Approval on Day End
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full bg-white/10 hover:bg-white/20 transition text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center space-x-2">
              <Check className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>Petty cash expense recorded and processed out from till!</span>
            </div>
          )}

          {/* Cashier & Date summary */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs flex items-center justify-between text-slate-300">
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#6A4DFF]" />
              <span>Till Cashier: <strong className="text-white">{selectedStaff.name}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#FF8A00]" />
              <span>Date: <strong className="text-white">{sheetDate}</strong></span>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-300 mb-1">
              Expense Amount ($ USD) <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-rose-400 font-black text-2xl font-mono-num">
                $
              </span>
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
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-10 pr-4 py-3 text-rose-300 text-2xl font-mono-num font-black focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                required
              />
            </div>
            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2">
              <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">Quick Presets:</span>
              {QUICK_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(val.toFixed(2))}
                  className="py-1 px-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-[11px] font-bold font-mono-num text-slate-200 transition active:scale-95"
                >
                  ${val}
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-emerald-400" />
              <span>Expense Category</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs font-bold focus:outline-none focus:border-emerald-500"
            >
              {FORM2_EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat} className="bg-slate-900 text-white">
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span>Description / Reason <span className="text-rose-400">*</span></span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Van diesel for stock collection, polythene receipt rolls..."
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3.5 py-2.5 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          {/* Vendor / Payee and Receipt # */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">
                Vendor / Paid To (Optional)
              </label>
              <input
                type="text"
                value={vendorOrCustomer}
                onChange={(e) => setVendorOrCustomer(e.target.value)}
                placeholder="e.g. TotalEnergies, Stationers"
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1">
                Receipt / Voucher Ref (Optional)
              </label>
              <input
                type="text"
                value={receiptRef}
                onChange={(e) => setReceiptRef(e.target.value)}
                placeholder="e.g. REC-891, SLIP-44"
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-3 py-2 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Notice Policy Banner */}
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Cashier Petty Cash Policy:</strong> This cash is paid out immediately from your till drawer and deducts from your expected drawer balance. It is marked as <strong>{isSupervisor ? 'Approved' : 'Pending Supervisor Approval'}</strong> and must be authorized by your supervisor on day end.
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-[#FF8A00] hover:from-rose-500 hover:to-orange-500 text-white text-xs font-black shadow-lg shadow-rose-900/30 transition flex items-center space-x-1.5 active:scale-95"
            >
              <DollarSign className="w-4 h-4" />
              <span>Record Expense (-${amount || '0.00'})</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
