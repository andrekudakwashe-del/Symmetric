import React, { useState, useMemo, useEffect } from 'react';
import { Salesperson, CashCountRecord } from '../../types';
import { DENOMINATIONS_LIST } from '../../data/initialData';
import {
  saveFinalCashCount,
  getCashCounts,
  getCashCountForStaffAndDate,
  getTodayDateString,
  subscribeToDatabase,
} from '../../db/roomDatabase';
import { FormStepNavigation } from '../common/FormStepNavigation';
import {
  Coins,
  Calculator,
  Save,
  RotateCcw,
  CheckCircle2,
  Calendar,
  User,
  History,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  TrendingDown,
  Lock,
  Edit3,
  Sparkles,
  AlertCircle,
  Home,
  LogOut,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface Form1CashCountProps {
  currentUser: Salesperson;
  onNavigateToReconcile?: () => void;
  onNavigateToCashLog?: () => void;
  onNavigateToHome?: () => void;
}

export const Form1CashCount: React.FC<Form1CashCountProps> = ({
  currentUser,
  onNavigateToReconcile,
  onNavigateToCashLog,
  onNavigateToHome,
}) => {
  const today = getTodayDateString();
  const [date, setDate] = useState<string>(today);

  // Quantities state for each denomination
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    DENOMINATIONS_LIST.forEach((d) => {
      initial[d] = 0;
    });
    return initial;
  });

  const [notes, setNotes] = useState<string>('');
  const [savedSuccess, setSavedSuccess] = useState<CashCountRecord | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [existingRecordId, setExistingRecordId] = useState<string | null>(null);

  const isToday = date === today;
  const isAdmin = currentUser.role === 'Admin';
  const isEditable = isAdmin || isToday; // Staff can only edit today; Admins can edit any day

  // Load saved cash count for selected staff & date whenever date or staff changes
  const loadSavedCountForDate = (targetDate: string, targetStaffId: string) => {
    const saved = getCashCountForStaffAndDate(targetStaffId, targetDate);
    if (saved) {
      const loadedQty: Record<number, number> = {};
      DENOMINATIONS_LIST.forEach((d) => {
        const val = saved.denominations[String(d)] || saved.denominations[d as unknown as string] || 0;
        loadedQty[d] = val;
      });
      setQuantities(loadedQty);
      setNotes(saved.notes || '');
      setExistingRecordId(saved.id);
    } else {
      const resetQty: Record<number, number> = {};
      DENOMINATIONS_LIST.forEach((d) => {
        resetQty[d] = 0;
      });
      setQuantities(resetQty);
      setNotes('');
      setExistingRecordId(null);
    }
    setSavedSuccess(null);
  };

  useEffect(() => {
    loadSavedCountForDate(date, currentUser.id);
  }, [date, currentUser.id]);

  useEffect(() => {
    const unsub = subscribeToDatabase(() => {
      // If active record in DB changed, sync if needed
    });
    return () => unsub();
  }, []);

  const pastCounts = getCashCounts();

  // Denominations breakdown & calculations
  const breakdown = useMemo(() => {
    return DENOMINATIONS_LIST.map((note) => {
      const qty = quantities[note] || 0;
      const amount = note * qty;
      return { note, qty, amount };
    });
  }, [quantities]);

  const totalAmount = useMemo(() => {
    return breakdown.reduce((acc, row) => acc + row.amount, 0);
  }, [breakdown]);

  const totalNotesCount = useMemo(() => {
    return breakdown.reduce((acc, row) => acc + row.qty, 0);
  }, [breakdown]);

  const handleQtyChange = (note: number, val: string) => {
    if (!isEditable) return;
    const parsed = parseInt(val, 10);
    setQuantities((prev) => ({
      ...prev,
      [note]: isNaN(parsed) || parsed < 0 ? 0 : parsed,
    }));
    setSavedSuccess(null);
  };

  const handleStep = (note: number, delta: number) => {
    if (!isEditable) return;
    setQuantities((prev) => {
      const current = prev[note] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [note]: next };
    });
    setSavedSuccess(null);
  };

  const handleReset = () => {
    if (!isEditable) return;
    const reset: Record<number, number> = {};
    DENOMINATIONS_LIST.forEach((d) => {
      reset[d] = 0;
    });
    setQuantities(reset);
    setNotes('');
    setSavedSuccess(null);
  };

  const handleSave = (targetAction: 'stay' | 'next' | 'home' = 'stay') => {
    if (!isEditable) {
      alert('Only today’s cash count can be edited.');
      return;
    }

    if (totalAmount <= 0) {
      if (!window.confirm('The calculated Cash Count Total is $0.00. Are you sure you want to save a zero final cash count?')) {
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const denominationsMap: Record<string, number> = {};
      DENOMINATIONS_LIST.forEach((d) => {
        denominationsMap[String(d)] = quantities[d] || 0;
      });

      const { countRecord } = saveFinalCashCount({
        staffId: currentUser.id,
        staffName: currentUser.name,
        denominations: denominationsMap,
        finalCashOutTotal: Number(totalAmount.toFixed(2)),
        notes,
        date,
      });

      setExistingRecordId(countRecord.id);
      setSavedSuccess(countRecord);
      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6A4DFF', '#FF8A00', '#10B981'],
      });

      if (targetAction === 'next' && onNavigateToCashLog) {
        setTimeout(() => {
          onNavigateToCashLog();
        }, 400);
      } else if (targetAction === 'home' && onNavigateToHome) {
        setTimeout(() => {
          onNavigateToHome();
        }, 400);
      }
    } catch (err) {
      console.error('Failed to save cash count:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-20 select-none">
      {/* 1. Sequential Form Navigation Bar */}
      <FormStepNavigation
        currentStep={1}
        onPrevious={onNavigateToHome}
        previousLabel="Home"
        onNext={onNavigateToCashLog}
        nextLabel="Next: Form 2 (Cash Log)"
        onHome={onNavigateToHome}
        isAdmin={currentUser.role === 'Admin'}
      />

      {/* Header Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center text-white shadow-md">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-tight">Final Cash Count</h2>
              <p className="text-xs text-slate-400">
                FORM 1 • Saves <span className="font-mono-num font-semibold text-orange-300">finalCashOutTotal</span> to Sheet "CashLog"
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-2">
            <button
              id="btn-toggle-cash-count-history"
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="py-2 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition"
            >
              <History className="w-3.5 h-3.5 text-[#FF8A00]" />
              <span>{showHistory ? 'Active Form' : `History (${pastCounts.length})`}</span>
            </button>

            <button
              id="btn-reset-cash-count"
              type="button"
              onClick={handleReset}
              className="py-2 px-3 rounded-2xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-bold border border-slate-700/60 flex items-center space-x-1.5 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Auto-filled Staff & Date metadata + Status Banner */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-xs">
          <div className="flex items-center space-x-2 text-slate-300">
            <User className="w-4 h-4 text-[#6A4DFF]" />
            <span className="text-slate-400">Staff:</span>
            <span className="font-bold text-white">{currentUser.name}</span>
            <span className="font-mono-num text-[10px] bg-purple-950 text-purple-300 px-1.5 py-0.5 rounded border border-purple-800">
              #{currentUser.id}
            </span>
          </div>

          <div className="flex items-center justify-between sm:justify-end space-x-2 text-slate-300">
            <div className="flex items-center space-x-1.5">
              <Calendar className="w-4 h-4 text-[#FF8A00]" />
              <span className="text-slate-400">Date:</span>
              <input
                id="input-cash-count-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-xl px-2 py-1 text-white font-mono-num outline-none text-xs"
              />
            </div>
            {!isToday && (
              <button
                type="button"
                onClick={() => setDate(today)}
                className="px-2 py-1 bg-[#6A4DFF]/20 hover:bg-[#6A4DFF]/40 text-[#6A4DFF] border border-[#6A4DFF]/40 rounded-lg text-[11px] font-bold transition"
              >
                Go to Today
              </button>
            )}
          </div>
        </div>

        {/* Daily report status badge */}
        <div className="mt-2.5">
          {!isEditable ? (
            <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs">
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Historical Record (Read-Only):</strong> Viewing cash count for {date}. Non-admin staff cannot edit forms of previous days.
              </span>
            </div>
          ) : !isToday && isAdmin ? (
            <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-purple-950/40 border border-purple-500/40 text-purple-200 text-xs">
              <Sparkles className="w-4 h-4 text-[#FF8A00] shrink-0" />
              <span>
                <strong>Historical Record (Admin Edit Mode):</strong> Administrator override active for {date}. Any modifications will update this record upon saving.
              </span>
            </div>
          ) : existingRecordId ? (
            <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs">
              <Edit3 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Saved Form Loaded ({date}):</strong> Showing your saved cash count for today. Any modifications will update this record upon saving.
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-slate-950/40 border border-slate-800 text-slate-400 text-xs">
              <Sparkles className="w-4 h-4 text-[#FF8A00] shrink-0" />
              <span>
                <strong>New Cash Count ({date}):</strong> Enter your denominations count for today and click save.
              </span>
            </div>
          )}
        </div>
      </div>

      {showHistory ? (
        /* History View */
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <History className="w-4 h-4 text-[#FF8A00]" />
            <span>Past Final Cash Counts</span>
          </h3>

          {pastCounts.length === 0 ? (
            <p className="text-center py-8 text-sm text-slate-500">No cash counts recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {pastCounts.map((count) => (
                <div
                  key={count.id}
                  className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono-num font-bold text-xs text-purple-300">{count.date}</span>
                      <span className="text-xs text-slate-400">by {count.staffName} (#{count.staffId})</span>
                    </div>
                    {count.notes && <p className="text-xs text-slate-500 mt-1 italic">"{count.notes}"</p>}
                  </div>
                  <div className="text-right">
                    <span className="text-base font-black font-mono-num text-emerald-400">
                      ${count.finalCashOutTotal.toFixed(2)}
                    </span>
                    <span className="text-[10px] block text-slate-500">Sheet "CashLog" Synced</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Main Cash Count Form */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Denominations Table (8 cols on lg) */}
          <div className="lg:col-span-8 bg-slate-900/80 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <Calculator className="w-4 h-4 text-[#6A4DFF]" />
                <span>Denominations Breakdown</span>
              </h3>
              <span className="text-xs text-slate-400 font-mono-num font-semibold">
                {totalNotesCount} notes/coins counted
              </span>
            </div>

            {/* Table: Note | Qty | Amount */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold text-[11px]">
                    <th className="py-2.5 px-3">Note / Coin</th>
                    <th className="py-2.5 px-3 text-center">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Amount ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono-num">
                  {breakdown.map(({ note, qty, amount }) => (
                    <tr
                      key={note}
                      id={`row-denom-${note}`}
                      className={`hover:bg-slate-800/40 transition ${
                        qty > 0 ? 'bg-purple-950/20 text-white font-semibold' : 'text-slate-300'
                      }`}
                    >
                      {/* Note column */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                              note >= 20
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : note >= 5
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                            }`}
                          >
                            ${note}
                          </span>
                          <span className="font-bold text-slate-200">
                            {note >= 1 ? `$${note}` : `${(note * 100).toFixed(0)}¢`}
                          </span>
                        </div>
                      </td>

                      {/* Quantity column with interactive steppers */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            id={`btn-denom-minus-${note}`}
                            type="button"
                            onClick={() => handleStep(note, -1)}
                            disabled={!isEditable || qty <= 0}
                            className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 font-bold flex items-center justify-center transition active:scale-95"
                          >
                            -
                          </button>

                          <input
                            id={`input-qty-${note}`}
                            type="number"
                            min="0"
                            value={qty === 0 ? '' : qty}
                            placeholder="0"
                            disabled={!isEditable}
                            onChange={(e) => handleQtyChange(note, e.target.value)}
                            className="w-16 py-1 px-2 text-center bg-slate-950 border border-slate-700/80 focus:border-[#6A4DFF] focus:ring-1 focus:ring-[#6A4DFF] rounded-xl text-sm font-bold text-white outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                          />

                          <button
                            id={`btn-denom-plus-${note}`}
                            type="button"
                            onClick={() => handleStep(note, 1)}
                            disabled={!isEditable}
                            className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 font-bold flex items-center justify-center transition active:scale-95"
                          >
                            +
                          </button>

                          <button
                            id={`btn-denom-plus5-${note}`}
                            type="button"
                            onClick={() => handleStep(note, 5)}
                            disabled={!isEditable}
                            className="hidden sm:inline-flex px-1.5 py-1 text-[10px] rounded-lg bg-slate-800/60 hover:bg-slate-800 disabled:opacity-30 text-slate-400 hover:text-white transition"
                            title="Add 5"
                          >
                            +5
                          </button>
                        </div>
                      </td>

                      {/* Amount column */}
                      <td className="py-2.5 px-3 text-right">
                        <span className={`text-sm font-bold ${amount > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                          ${amount.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Optional Notes */}
            <div className="mt-4 pt-3 border-t border-slate-800">
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Shift Close Notes / Cashier Memo (Optional)
              </label>
              <input
                id="input-cash-count-notes"
                type="text"
                value={notes}
                disabled={!isEditable}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Verified by Sarah, safe deposit box sealed..."
                className="w-full py-2 px-3 bg-slate-950/80 border border-slate-800 focus:border-[#6A4DFF] rounded-2xl text-xs text-white placeholder-slate-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Right: Summary Card & Submission (4 cols on lg) */}
          <div className="lg:col-span-4 space-y-4">
            {/* Grand Total Card */}
            <div className="bg-gradient-to-br from-slate-900 via-purple-950/60 to-slate-900 border border-purple-500/30 rounded-3xl p-5 shadow-xl text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-28 h-28 bg-[#FF8A00]/10 rounded-full blur-2xl pointer-events-none" />

              <span className="text-xs font-bold uppercase tracking-widest text-purple-300 block mb-1">
                Calculated Grand Total
              </span>
              <div className="text-3xl sm:text-4xl font-black text-white font-mono-num tracking-tight my-2">
                ${totalAmount.toFixed(2)}
              </div>
              <span className="text-xs text-slate-400 block font-medium">
                finalCashOutTotal for <strong className="text-slate-200">{currentUser.name}</strong>
              </span>

              <div className="mt-4 pt-4 border-t border-slate-800/80 text-left space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Total Notes/Coins:</span>
                  <span className="font-mono-num font-bold text-white">{totalNotesCount}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Target Sheet:</span>
                  <span className="font-mono-num font-bold text-orange-400">Sheet "CashLog"</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Sheet Row Out Value:</span>
                  <span className="font-mono-num font-bold text-rose-400">${totalAmount.toFixed(2)}</span>
                </div>
              </div>

              {/* Save & Navigation Action Buttons */}
              {isEditable ? (
                <div className="mt-5 space-y-2.5">
                  {/* Option 1: Save & Go to Next Sheet (Form 2) */}
                  <button
                    id="btn-save-and-next-cash-count"
                    type="button"
                    onClick={() => handleSave('next')}
                    disabled={isSubmitting}
                    className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 active:scale-98 text-white font-black text-sm transition shadow-[0_4px_20px_rgba(106,77,255,0.4)] flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save & Go to Form 2 (Cash Log) &rarr;</span>
                  </button>

                  {/* Option 2: Save & Close Session / Go to Home Screen */}
                  <button
                    id="btn-save-and-home-cash-count"
                    type="button"
                    onClick={() => handleSave('home')}
                    disabled={isSubmitting}
                    className="w-full py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-98 text-slate-200 hover:text-white font-bold text-xs transition border border-slate-700 flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    <Home className="w-3.5 h-3.5 text-slate-400" />
                    <span>Save & Close Session (Return Home)</span>
                  </button>

                  {/* Option 3: Save Record in Place */}
                  <button
                    id="btn-save-final-cash-count"
                    type="button"
                    onClick={() => handleSave('stay')}
                    disabled={isSubmitting}
                    className="w-full py-2 px-3 rounded-xl text-slate-400 hover:text-slate-200 text-[11px] font-semibold transition hover:underline"
                  >
                    Save Cash Count Only (Stay on this page)
                  </button>
                </div>
              ) : (
                <div className="mt-5 py-3 px-4 rounded-2xl bg-slate-800/80 border border-slate-700 text-slate-400 font-bold text-xs flex items-center justify-center space-x-2">
                  <Lock className="w-4 h-4 text-amber-400" />
                  <span>Report Locked (Past Date: {date})</span>
                </div>
              )}
            </div>

            {/* Success Card if just saved */}
            {savedSuccess && (
              <div className="bg-emerald-950/50 border border-emerald-500/40 rounded-3xl p-4 text-emerald-200 animate-fadeIn space-y-2.5">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <span className="text-sm font-bold text-white">Cash Count Saved & Queued!</span>
                </div>
                <p className="text-xs text-emerald-300/90 leading-relaxed">
                  Saved <strong>${savedSuccess.finalCashOutTotal.toFixed(2)}</strong> as <span className="font-mono-num">finalCashOutTotal</span> for {savedSuccess.staffName} on {savedSuccess.date}.
                  Logged to Sheet <strong>"CashLog"</strong> (In=0, Out=${savedSuccess.finalCashOutTotal.toFixed(2)}).
                </p>

                <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                  {onNavigateToCashLog && (
                    <button
                      id="btn-view-in-cash-log"
                      type="button"
                      onClick={onNavigateToCashLog}
                      className="w-full sm:flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white text-xs font-black flex items-center justify-center space-x-1.5 transition shadow-sm"
                    >
                      <span>Proceed to Form 2 (Cash Log) &rarr;</span>
                    </button>
                  )}
                  {onNavigateToHome && (
                    <button
                      id="btn-go-home-after-save"
                      type="button"
                      onClick={onNavigateToHome}
                      className="w-full sm:flex-1 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center space-x-1.5 transition"
                    >
                      <Home className="w-3.5 h-3.5 text-slate-400" />
                      <span>Close Session & Go Home</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
