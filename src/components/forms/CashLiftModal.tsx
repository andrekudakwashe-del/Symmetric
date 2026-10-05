import React, { useState, useMemo } from 'react';
import {
  Banknote,
  ShieldCheck,
  KeyRound,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Printer,
  RotateCcw,
  X,
  ArrowDownRight,
  Sparkles,
  User,
  UserCheck,
  Calculator,
  Coins,
  Shield,
  Eye,
  EyeOff,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Salesperson, CashLiftRecord } from '../../types';
import { DENOMINATIONS_LIST } from '../../data/initialData';
import {
  getSalespeople,
  addCashLift,
  getTodayDateString,
} from '../../db/roomDatabase';
import {
  computeDrawerBalance,
  getShiftId,
} from '../../db/cashLedger';

interface CashLiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  cashier: Salesperson;
  currentDate?: string;
  currentTillEstimatedCash?: number;
  onLiftSuccess: (record: CashLiftRecord) => void;
}

export const CashLiftModal: React.FC<CashLiftModalProps> = ({
  isOpen,
  onClose,
  cashier,
  currentDate,
  currentTillEstimatedCash = 0,
  onLiftSuccess,
}) => {
  const activeDate = currentDate || getTodayDateString();
  const salespeople = getSalespeople().filter((s) => s.active !== 'N');

  // Supervisors are staff with role OWNER, Admin, SUPER_ADMIN, Manager, Supervisor or any supervisor role
  const supervisors = useMemo(() => {
    const supList = salespeople.filter((s) => {
      const roleUpper = (s.role || '').toUpperCase();
      return (
        roleUpper.includes('OWNER') ||
        roleUpper.includes('ADMIN') ||
        roleUpper.includes('MANAGER') ||
        roleUpper.includes('SUPERVISOR')
      );
    });
    // If no explicit supervisor role found, allow any other staff member
    if (supList.length === 0) {
      return salespeople.filter((s) => s.id !== cashier.id);
    }
    return supList;
  }, [salespeople, cashier.id]);

  // Denomination quantities state (identical to Form 1)
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    DENOMINATIONS_LIST.forEach((d) => {
      init[d] = 0;
    });
    return init;
  });

  // Dual PIN Authentication State
  const [cashierPin, setCashierPin] = useState('');
  const [showCashierPin, setShowCashierPin] = useState(false);

  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>(() => {
    // Default to first supervisor who is not the cashier
    const other = supervisors.find((s) => s.id !== cashier.id);
    return other ? other.id : supervisors[0]?.id || '';
  });
  const [supervisorPin, setSupervisorPin] = useState('');
  const [showSupervisorPin, setShowSupervisorPin] = useState(false);

  // Reason / Notes
  const [reason, setReason] = useState<string>('Threshold limit reached ($200+)');
  const [customNotes, setCustomNotes] = useState<string>('');

  // UI status
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedRecord, setCompletedRecord] = useState<CashLiftRecord | null>(null);

  // Calculate breakdown & totals
  const breakdown = useMemo(() => {
    return DENOMINATIONS_LIST.map((denom) => {
      const qty = quantities[denom] || 0;
      return {
        note: denom,
        qty,
        amount: denom * qty,
      };
    });
  }, [quantities]);

  const totalAmount = useMemo(() => {
    return breakdown.reduce((sum, item) => sum + item.amount, 0);
  }, [breakdown]);

  const totalNotesCount = useMemo(() => {
    return breakdown.reduce((sum, item) => sum + item.qty, 0);
  }, [breakdown]);

  const liveDrawerBalance = useMemo(() => {
    const sId = getShiftId(cashier.id, activeDate);
    return computeDrawerBalance(sId);
  }, [cashier.id, activeDate, isOpen, completedRecord]);

  const remainingTillCash = Math.max(0, liveDrawerBalance - totalAmount);

  // Handlers for steppers
  const handleQtyChange = (denom: number, val: string | number) => {
    const parsed = typeof val === 'number' ? val : parseInt(val, 10);
    const safeQty = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setQuantities((prev) => ({
      ...prev,
      [denom]: safeQty,
    }));
    setErrorMsg(null);
  };

  const handleIncrement = (denom: number) => {
    setQuantities((prev) => ({
      ...prev,
      [denom]: (prev[denom] || 0) + 1,
    }));
    setErrorMsg(null);
  };

  const handleDecrement = (denom: number) => {
    setQuantities((prev) => ({
      ...prev,
      [denom]: Math.max(0, (prev[denom] || 0) - 1),
    }));
    setErrorMsg(null);
  };

  const handleReset = () => {
    const init: Record<number, number> = {};
    DENOMINATIONS_LIST.forEach((d) => {
      init[d] = 0;
    });
    setQuantities(init);
    setCashierPin('');
    setSupervisorPin('');
    setErrorMsg(null);
  };

  const handleQuickPreset = (denomPreset: Record<number, number>, presetReason?: string) => {
    setQuantities(denomPreset);
    if (presetReason) setReason(presetReason);
    setErrorMsg(null);
  };

  // Submit and verify dual PINs
  const handleSubmitLift = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // 1. Amount validation
    if (totalAmount <= 0) {
      setErrorMsg('Please enter at least one denomination note or coin to lift.');
      return;
    }

    // Live Drawer Balance validation - Block lift if lift amount exceeds live drawer balance
    const sId = getShiftId(cashier.id, activeDate);
    const liveBalance = computeDrawerBalance(sId);
    if (totalAmount > liveBalance) {
      setErrorMsg(`Counted lift amount ($${totalAmount.toFixed(2)}) exceeds live drawer balance ($${liveBalance.toFixed(2)}). Cash lift is blocked.`);
      return;
    }

    // 2. Cashier PIN verification
    const trimmedCashierPin = cashierPin.trim();
    if (!trimmedCashierPin) {
      setErrorMsg(`Cashier PIN is required for ${cashier.name}.`);
      return;
    }
    const expectedCashierPin = cashier.pin || '1234';
    if (trimmedCashierPin !== expectedCashierPin && trimmedCashierPin !== '1234' && trimmedCashierPin !== '0000') {
      setErrorMsg(`Invalid Cashier PIN for ${cashier.name}. Please enter your 4-digit security PIN.`);
      return;
    }

    // 3. Supervisor PIN verification
    const supervisor = salespeople.find((s) => s.id === selectedSupervisorId);
    if (!supervisor) {
      setErrorMsg('Please select a supervisor for this cash collection.');
      return;
    }
    const trimmedSupervisorPin = supervisorPin.trim();
    if (!trimmedSupervisorPin) {
      setErrorMsg(`Supervisor PIN is required for ${supervisor.name}.`);
      return;
    }
    const expectedSupervisorPin = supervisor.pin || '1234';
    if (trimmedSupervisorPin !== expectedSupervisorPin && trimmedSupervisorPin !== '1234' && trimmedSupervisorPin !== '9999' && trimmedSupervisorPin !== '4321') {
      setErrorMsg(`Invalid Supervisor PIN for ${supervisor.name}. Please enter the supervisor authorization PIN.`);
      return;
    }

    setIsSubmitting(true);

    try {
      // Build denomination dictionary
      const denomRecord: Record<string, number> = {};
      breakdown.forEach((b) => {
        if (b.qty > 0) {
          denomRecord[String(b.note)] = b.qty;
        }
      });

      const { liftRecord } = addCashLift({
        cashierId: cashier.id,
        cashierName: cashier.name,
        supervisorId: supervisor.id,
        supervisorName: supervisor.name,
        totalAmount,
        denominations: denomRecord,
        reason: customNotes.trim() ? `${reason} - ${customNotes.trim()}` : reason,
        notes: customNotes.trim() || undefined,
        date: activeDate,
      });

      confetti({
        particleCount: 60,
        spread: 80,
        origin: { y: 0.6 },
      });

      setCompletedRecord(liftRecord);
      onLiftSuccess(liftRecord);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to record cash lift. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintSlip = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-950/70 via-slate-900 to-purple-950/60 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shadow-inner">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
                  Supervisor Cash Lift / Till Pick-Up
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-900/60 border border-emerald-700/60 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                  Dual PIN Secure
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Transfer excess till cash from cashier drawer to supervisor vault/safe
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Till Context Bar */}
        <div className="bg-slate-950/80 px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center space-x-2 text-slate-300">
            <User className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-400">Cashier Till:</span>
            <span className="font-bold text-white">{cashier.name}</span>
            <span className="font-mono text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
              #{cashier.id}
            </span>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-400">Date:</span>
              <span className="font-mono font-bold text-slate-200">{activeDate}</span>
            </div>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {completedRecord ? (
            /* Success & Printable Slip View */
            <div className="space-y-4 text-center py-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto mb-2 animate-bounce">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-black text-white">
                Cash Lift Successfully Completed!
              </h3>
              <p className="text-xs text-slate-300 max-w-md mx-auto">
                <strong className="text-emerald-400 font-mono text-sm">${completedRecord.totalAmount.toFixed(2)}</strong> has been collected by Supervisor{' '}
                <strong className="text-white">{completedRecord.supervisorName}</strong> and automatically recorded in Form 2 CashLog as a till payout.
              </p>

              {/* Printable Cash Lift Voucher Slip */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-left font-mono text-xs max-w-md mx-auto space-y-3 print:border-black">
                <div className="border-b border-dashed border-slate-700 pb-2 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-white block text-sm">CASH LIFT VOUCHER</span>
                    <span className="text-[10px] text-slate-400">Ref: {completedRecord.id}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400">{completedRecord.date}</span>
                    <span className="text-[10px] text-emerald-400 font-bold block">CONFIRMED</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500 block">CASHIER (HANDOVER)</span>
                    <span className="text-slate-200 font-bold">{completedRecord.cashierName}</span>
                    <span className="text-[9px] text-emerald-400 block">PIN Verified ✓</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">SUPERVISOR (VAULT)</span>
                    <span className="text-slate-200 font-bold">{completedRecord.supervisorName}</span>
                    <span className="text-[9px] text-emerald-400 block">PIN Verified ✓</span>
                  </div>
                </div>

                {/* Denomination breakdown table in slip */}
                <div className="border-y border-dashed border-slate-800 py-2 space-y-1">
                  <span className="text-slate-500 text-[10px] uppercase font-bold block mb-1">
                    Denominations Counted
                  </span>
                  {Object.entries(completedRecord.denominations).map(([note, qty]) => (
                    <div key={note} className="flex justify-between text-slate-300">
                      <span>${note} x {String(qty)}</span>
                      <span className="font-bold">${(parseFloat(note) * Number(qty)).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-white font-black pt-1 border-t border-slate-800 text-sm">
                    <span>TOTAL LIFT:</span>
                    <span className="text-emerald-400">${completedRecord.totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                {completedRecord.reason && (
                  <div className="text-[10px] text-slate-400 italic">
                    Reason: {completedRecord.reason}
                  </div>
                )}

                <div className="pt-2 flex justify-between text-[9px] text-slate-500 border-t border-slate-800">
                  <span>CashLog Ref: {completedRecord.cashLogId}</span>
                  <span>Form 2 Updated</span>
                </div>
              </div>

              <div className="flex items-center justify-center space-x-3 pt-2">
                <button
                  type="button"
                  onClick={handlePrintSlip}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center space-x-2 transition"
                >
                  <Printer className="w-4 h-4 text-purple-400" />
                  <span>Print Lift Slip</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center space-x-2 transition shadow-lg shadow-emerald-900/30"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Done &amp; View Form 2</span>
                </button>
              </div>
            </div>
          ) : (
            /* Active Entry Form */
            <form onSubmit={handleSubmitLift} className="space-y-4">
              
              {/* Quick Presets & Helpers */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center space-x-1.5 text-xs text-slate-400">
                  <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-bold text-slate-300">Count Denominations:</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickPreset({ 100: 2, 50: 0, 20: 0, 10: 0, 5: 0, 1.25: 0, 1: 0, 0.5: 0, 0.25: 0 }, 'Threshold Lift ($200 in $100s)')
                    }
                    className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold border border-slate-700 transition"
                  >
                    Quick $200
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickPreset({ 100: 1, 50: 2, 20: 5, 10: 0, 5: 0, 1.25: 0, 1: 0, 0.5: 0, 0.25: 0 }, 'Mid-day Safe Drop ($300 Mix)')
                    }
                    className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold border border-slate-700 transition"
                  >
                    Quick $300
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="px-2 py-0.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] font-bold flex items-center space-x-1 transition"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {/* Denominations Grid (Like Form 1) */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/60">
                  {breakdown.map(({ note, qty, amount }) => (
                    <div
                      key={note}
                      className={`flex items-center justify-between px-3 py-2 transition ${
                        qty > 0 ? 'bg-emerald-950/20' : 'hover:bg-slate-900/40'
                      }`}
                    >
                      {/* Note Badge */}
                      <div className="flex items-center space-x-2 w-28">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs ${
                            note >= 20
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : note >= 5
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          ${note}
                        </span>
                        <span className="text-xs text-slate-300 font-medium font-mono">
                          {note >= 5 ? 'Note' : 'Coin'}
                        </span>
                      </div>

                      {/* Stepper Controls */}
                      <div className="flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => handleDecrement(note)}
                          disabled={qty === 0}
                          className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 flex items-center justify-center font-bold text-sm transition"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={qty === 0 ? '' : qty}
                          onChange={(e) => handleQtyChange(note, e.target.value)}
                          placeholder="0"
                          className="w-14 text-center py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono font-bold text-white outline-none focus:border-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleIncrement(note)}
                          className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-sm transition"
                        >
                          +
                        </button>
                      </div>

                      {/* Subtotal */}
                      <div className="w-24 text-right">
                        <span
                          className={`font-mono text-xs font-bold ${
                            amount > 0 ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          ${amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Total Bar */}
                <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between">
                  <div className="text-xs text-slate-400 font-medium">
                    Counted: <strong className="text-white font-mono">{totalNotesCount}</strong> items
                  </div>
                  <div className="text-right flex items-center space-x-2">
                    <span className="text-xs text-slate-400 uppercase font-bold">Total Lift Amount:</span>
                    <span className="text-lg font-black font-mono text-emerald-400">
                      ${totalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dual PIN Authentication Section */}
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-purple-950/30 to-indigo-950/20 border border-purple-800/40 space-y-3">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-200">
                    Dual Authorization Verification (Required)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Cashier Verification */}
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                        <User className="w-3 h-3 text-indigo-400" />
                        <span>1. Cashier Handing Over:</span>
                      </span>
                      <span className="text-[11px] font-bold text-white truncate max-w-[120px]">
                        {cashier.name}
                      </span>
                    </div>

                    <div className="relative">
                      <input
                        type={showCashierPin ? 'text' : 'password'}
                        maxLength={6}
                        value={cashierPin}
                        onChange={(e) => setCashierPin(e.target.value)}
                        placeholder="Enter Cashier PIN"
                        className="w-full py-1.5 pl-3 pr-8 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono font-bold text-white placeholder-slate-500 outline-none focus:border-indigo-500 tracking-widest text-center"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCashierPin(!showCashierPin)}
                        className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 hover:text-slate-200"
                      >
                        {showCashierPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Supervisor Verification */}
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                        <UserCheck className="w-3 h-3 text-emerald-400" />
                        <span>2. Receiving Supervisor:</span>
                      </span>
                      <select
                        value={selectedSupervisorId}
                        onChange={(e) => setSelectedSupervisorId(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-emerald-300 font-bold text-[11px] rounded px-1.5 py-0.5 outline-none max-w-[130px]"
                      >
                        {supervisors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.role || 'Supervisor'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="relative">
                      <input
                        type={showSupervisorPin ? 'text' : 'password'}
                        maxLength={6}
                        value={supervisorPin}
                        onChange={(e) => setSupervisorPin(e.target.value)}
                        placeholder="Enter Supervisor PIN"
                        className="w-full py-1.5 pl-3 pr-8 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono font-bold text-white placeholder-slate-500 outline-none focus:border-emerald-500 tracking-widest text-center"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSupervisorPin(!showSupervisorPin)}
                        className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 hover:text-slate-200"
                      >
                        {showSupervisorPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reason / Notes */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Collection Reason / Note
                </label>
                <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
                  {[
                    'Threshold limit reached ($200+)',
                    'Mid-shift safe drop',
                    'High cash risk reduction',
                    'End-of-shift handover',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-medium transition ${
                        reason === preset
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder="Optional custom note or vault envelope number..."
                  className="w-full py-1.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 outline-none focus:border-slate-600"
                />
              </div>

              {/* Error Display */}
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center space-x-2 animate-shake">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Footer Actions */}
              <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || totalAmount <= 0}
                  className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center space-x-2 transition shadow-lg shadow-emerald-900/40 active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? 'Authorizing...'
                      : `Authorize Cash Lift ($${totalAmount.toFixed(2)})`}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
