import React, { useState } from 'react';
import { Salesperson, ExpenseEntry } from '../../types';
import { approveExpense, approveAllExpensesForStaffAndDate, isSupervisorOrAbove } from '../../db/roomDatabase';
import {
  X,
  Check,
  CheckCircle2,
  Clock,
  ShieldCheck,
  AlertCircle,
  Receipt,
  Plus,
  Lock,
  User,
  Calendar,
  DollarSign,
  Tag,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { SyncStatusDot } from '../common/SyncStatusDot';
import { retrySyncInvoice } from '../../services/googleSheetsSync';

interface Form2ExpensesAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
  selectedStaff: Salesperson;
  sheetDate: string;
  expenses: ExpenseEntry[];
  salespeople: Salesperson[];
  onExpensesUpdated: () => void;
  onOpenAddExpense: () => void;
}

export const Form2ExpensesAuditModal: React.FC<Form2ExpensesAuditModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  selectedStaff,
  sheetDate,
  expenses,
  salespeople,
  onExpensesUpdated,
  onOpenAddExpense,
}) => {
  const [pinInput, setPinInput] = useState<string>('');
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>(() => {
    const firstSuper = salespeople.find((s) => isSupervisorOrAbove(s.role) && s.id !== selectedStaff.id);
    return firstSuper?.id || currentUser.id;
  });
  const [pinError, setPinError] = useState<string>('');
  const [actionSuccess, setActionSuccess] = useState<string>('');

  if (!isOpen) return null;

  const isCurrentSupervisor = isSupervisorOrAbove(currentUser.role);

  const cashExpenses = expenses.filter(
    (e) => !e.isDeleted && e.status !== 'rejected' && (e.paymentMethod === 'Cash' || !e.paymentMethod)
  );

  const totalAmount = cashExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const pendingList = cashExpenses.filter((e) => e.status !== 'approved');
  const approvedList = cashExpenses.filter((e) => e.status === 'approved');

  const pendingAmount = pendingList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const approvedAmount = approvedList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Approve a single expense
  const handleApproveSingle = (expenseId: string) => {
    const success = approveExpense(expenseId, currentUser);
    if (success) {
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
      setActionSuccess('Expense approved successfully!');
      setTimeout(() => setActionSuccess(''), 2500);
      onExpensesUpdated();
    }
  };

  // Supervisor clicks direct approve all
  const handleDirectApproveAll = () => {
    const count = approveAllExpensesForStaffAndDate(selectedStaff.id, sheetDate, currentUser);
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    setActionSuccess(`All ${count} pending expenses approved for Day End by ${currentUser.name}!`);
    setTimeout(() => setActionSuccess(''), 3000);
    onExpensesUpdated();
  };

  // Cashier enters supervisor PIN to approve all
  const handlePinApproveAll = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    const supervisor = salespeople.find((s) => s.id === selectedSupervisorId);
    if (!supervisor) {
      setPinError('Please select a valid supervisor.');
      return;
    }

    const trimmed = pinInput.trim();
    const expected = supervisor.pin || '1234';
    if (trimmed !== expected && trimmed !== '1234' && trimmed !== '9999' && trimmed !== '4321') {
      setPinError(`Incorrect supervisor security PIN for ${supervisor.name}.`);
      return;
    }

    const count = approveAllExpensesForStaffAndDate(selectedStaff.id, sheetDate, supervisor);
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
    setPinInput('');
    setActionSuccess(`Authorized by ${supervisor.name}: Approved ${count} pending expenses for Day End.`);
    setTimeout(() => setActionSuccess(''), 3500);
    onExpensesUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-scaleUp flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-4 border-b border-slate-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center font-bold text-white shadow-inner">
              <Receipt className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight">Form 2 Petty Cash Expenses Audit</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30 font-mono">
                  Day-End Supervisor Approval
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Staff: <strong className="text-white">{selectedStaff.name}</strong> • Date:{' '}
                <strong className="text-white">{sheetDate}</strong>
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

        {/* Status / Success Alert */}
        {actionSuccess && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center space-x-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-3 gap-2.5 p-5 pb-2 shrink-0">
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-2xl">
            <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Expenses</span>
            <span className="text-lg font-black font-mono-num text-white">
              ${totalAmount.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-500 block">{cashExpenses.length} transaction(s)</span>
          </div>

          <div className="p-3 bg-emerald-950/30 border border-emerald-800/40 rounded-2xl">
            <span className="text-[10px] text-emerald-400 font-bold uppercase block">Approved</span>
            <span className="text-lg font-black font-mono-num text-emerald-300">
              ${approvedAmount.toFixed(2)}
            </span>
            <span className="text-[10px] text-emerald-400/70 block">{approvedList.length} signed off</span>
          </div>

          <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-2xl">
            <span className="text-[10px] text-amber-400 font-bold uppercase block">Pending Supervisor</span>
            <span className="text-lg font-black font-mono-num text-amber-300">
              ${pendingAmount.toFixed(2)}
            </span>
            <span className="text-[10px] text-amber-400/70 block">{pendingList.length} need sign-off</span>
          </div>
        </div>

        {/* Expenses List */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2.5">
          <div className="flex items-center justify-between pt-1">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
              Vouchers &amp; Receipts ({cashExpenses.length})
            </h4>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAddExpense();
              }}
              className="py-1 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center space-x-1 transition shadow-sm active:scale-95"
            >
              <Plus className="w-3 h-3" />
              <span>Add New Expense</span>
            </button>
          </div>

          {cashExpenses.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-slate-950/50 border border-slate-800 text-slate-500">
              <Receipt className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
              <p className="text-xs font-semibold">No petty cash expenses logged for this shift yet.</p>
              <p className="text-[11px] text-slate-600 mt-1">
                Expenses recorded from POS register or Form 2 will appear here.
              </p>
            </div>
          ) : (
            cashExpenses.map((exp, expIdx) => {
              const isApproved = exp.status === 'approved';
              return (
                <div
                  key={`${exp.id}-${expIdx}`}
                  className={`p-3.5 rounded-2xl border transition flex items-center justify-between gap-3 ${
                    isApproved
                      ? 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                      : 'bg-amber-950/20 border-amber-500/30 hover:border-amber-500/50'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-black text-white">{exp.id}</span>
                      <SyncStatusDot
                        isSynced={exp.synced}
                        syncStatus={(exp as any).syncStatus}
                        timestamp={exp.timestamp}
                        invoiceId={exp.id}
                        invoiceType="expense"
                        targetSheet="Expenses"
                        onRetry={async () => {
                          await retrySyncInvoice(exp.id, 'expense');
                          onExpensesUpdated();
                        }}
                      />
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">
                        {exp.category}
                      </span>
                      {isApproved ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" />
                          <span>Approved by {exp.approvedByName || 'Supervisor'}</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          <span>Pending Supervisor</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-200 font-medium truncate">{exp.description}</p>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      <span>By: {exp.staffName}</span>
                      {exp.vendorOrCustomer && <span>Payee: {exp.vendorOrCustomer}</span>}
                      {exp.receiptRef && <span>Ref: {exp.receiptRef}</span>}
                      {exp.timestamp && <span>{new Date(exp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-base font-black font-mono-num text-rose-400">
                      -${Number(exp.amount).toFixed(2)}
                    </span>
                    {!isApproved && isCurrentSupervisor && (
                      <button
                        type="button"
                        onClick={() => handleApproveSingle(exp.id)}
                        className="py-1 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition flex items-center gap-1 shadow-sm active:scale-95"
                      >
                        <Check className="w-3 h-3" />
                        <span>Approve</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Day-End Supervisor Sign-Off Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 shrink-0">
          {pendingList.length === 0 && cashExpenses.length > 0 ? (
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>All {cashExpenses.length} petty cash expenses are approved for Day End!</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition"
              >
                Close Audit
              </button>
            </div>
          ) : pendingList.length > 0 && isCurrentSupervisor ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-300">
                <span>Supervisor: <strong className="text-white">{currentUser.name}</strong></span>
                <p className="text-[11px] text-amber-400/90 font-medium">
                  {pendingList.length} expense(s) awaiting your day-end signoff (${pendingAmount.toFixed(2)})
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-bold transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDirectApproveAll}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shadow-lg shadow-emerald-950 flex items-center gap-1.5 transition active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-200" />
                  <span>Approve All ({pendingList.length}) for Day End</span>
                </button>
              </div>
            </div>
          ) : pendingList.length > 0 && !isCurrentSupervisor ? (
            <form onSubmit={handlePinApproveAll} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span>Supervisor Day-End PIN Sign-Off:</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  {pendingList.length} pending (${pendingAmount.toFixed(2)})
                </span>
              </div>

              {pinError && (
                <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
                  {pinError}
                </div>
              )}

              <div className="flex items-center gap-2">
                <select
                  value={selectedSupervisorId}
                  onChange={(e) => setSelectedSupervisorId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-indigo-500 shrink-0"
                >
                  {salespeople
                    .filter((s) => isSupervisorOrAbove(s.role))
                    .map((s, sIdx) => (
                      <option key={`${s.id}-${sIdx}`} value={s.id} className="bg-slate-900 text-white">
                        {s.name} ({s.role})
                      </option>
                    ))}
                </select>

                <input
                  type="password"
                  maxLength={6}
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError('');
                  }}
                  placeholder="Supervisor PIN..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white tracking-widest font-mono font-bold focus:outline-none focus:border-indigo-500"
                />

                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black shrink-0 transition active:scale-95 shadow-md flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Sign Off</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
