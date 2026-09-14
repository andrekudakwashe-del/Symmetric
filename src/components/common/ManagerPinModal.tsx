import React, { useState, useEffect } from 'react';
import { Salesperson } from '../../types';
import { getSalespeople } from '../../db/roomDatabase';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  X,
  Check,
  Delete,
  AlertTriangle,
  FileText,
  UserCheck,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface ManagerPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actionType: 'REFUND' | 'VOID' | 'DISCOUNT';
  actionDescription: string;
  amount?: number;
  reasonRequired?: boolean;
  defaultReasons?: string[];
  currentStaff?: Salesperson | null;
  onAuthorize: (manager: Salesperson, reason: string) => void;
}

const DEFAULT_REASONS_MAP: Record<'REFUND' | 'VOID' | 'DISCOUNT', string[]> = {
  REFUND: [
    'Customer Return / Defective',
    'Customer Dissatisfied',
    'Wrong Item Scanned',
    'Overcharge Correction',
    'Order Cancelled After Tender',
  ],
  VOID: [
    'Customer Changed Mind',
    'Customer Left Counter',
    'Duplicate / Mistake Entry',
    'Payment Method Declined',
    'Pricing Dispute',
  ],
  DISCOUNT: [
    'VIP / Regular Customer',
    'Store Promotion Special',
    'Bulk Purchase Incentive',
    'Damaged Packaging / Minor Flaw',
    'Manager Goodwill Discretion',
  ],
};

export const ManagerPinModal: React.FC<ManagerPinModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  actionType,
  actionDescription,
  amount,
  reasonRequired = true,
  defaultReasons,
  currentStaff,
  onAuthorize,
}) => {
  const [pin, setPin] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const availableReasons = defaultReasons || DEFAULT_REASONS_MAP[actionType] || [
    'Customer Request',
    'Operational Correction',
    'Discretionary Approval',
  ];

  // Set default reason on open
  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(null);
      setSelectedReason(availableReasons[0] || 'Manager Authorization');
      setCustomReason('');
    }
  }, [isOpen]);

  // Keyboard shortcut listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in custom reason input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          onClose();
        }
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        if (pin.length === 4) {
          verifyPin(pin);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin, selectedReason, customReason]);

  if (!isOpen) return null;

  const handleDigit = (digit: string) => {
    setError(null);
    if (pin.length < 4) {
      const next = pin + digit;
      setPin(next);
      if (next.length === 4) {
        verifyPin(next);
      }
    }
  };

  const handleBackspace = () => {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError(null);
    setPin('');
  };

  const finalReason = (customReason.trim() || selectedReason || 'Manager Authorization').trim();

  const verifyPin = (pinToTest: string) => {
    if (reasonRequired && !finalReason) {
      setError('Please select or specify a reason.');
      return;
    }

    setIsVerifying(true);
    setTimeout(() => {
      const allStaff = getSalespeople().filter((s) => s.active === 'Y');
      const matched = allStaff.find((s) => s.pin === pinToTest);

      if (!matched) {
        setError('Invalid 4-digit PIN. Please try again.');
        setPin('');
        setIsVerifying(false);
        return;
      }

      const isManagerOrAdmin = matched.role === 'Manager' || matched.role === 'Admin';

      if (!isManagerOrAdmin) {
        setError(
          `Entered PIN belongs to ${matched.name} (Cashier). Authorization requires a Manager or Administrator PIN.`
        );
        setPin('');
        setIsVerifying(false);
        return;
      }

      // Success!
      try {
        confetti({
          particleCount: 25,
          spread: 45,
          origin: { y: 0.6 },
          colors: ['#3b82f6', '#10b981', '#6366f1'],
        });
      } catch {
        // no-op
      }

      setIsVerifying(false);
      onAuthorize(matched, finalReason);
      onClose();
    }, 180);
  };

  const allStaff = getSalespeople().filter((s) => s.active === 'Y');
  const authorizedManagers = allStaff.filter(
    (s) => s.role === 'Manager' || s.role === 'Admin'
  );

  return (
    <div
      id="manager-pin-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-fadeIn"
      onClick={onClose}
    >
      <div
        id="manager-pin-modal-container"
        className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 text-slate-100 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-600 flex items-center justify-center text-white shadow-lg shadow-orange-950/50 flex-shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {title}
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                {subtitle || 'Manager or Admin PIN required to approve this action'}
              </p>
            </div>
          </div>
          <button
            id="close-manager-pin-modal"
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Details Card */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="font-semibold uppercase tracking-wider text-[10px]">
              Target Operation
            </span>
            <span className="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
              {actionType}
            </span>
          </div>
          <p className="text-slate-200 font-medium leading-relaxed">
            {actionDescription}
          </p>
          {amount !== undefined && (
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 font-mono">
              <span className="text-slate-400">Transaction Value:</span>
              <span className="font-black text-amber-400 text-sm">
                ${amount.toFixed(2)}
              </span>
            </div>
          )}
          {currentStaff && (
            <div className="text-[11px] text-slate-400 pt-0.5">
              Requested by: <span className="text-slate-300 font-semibold">{currentStaff.name}</span> ({currentStaff.role})
            </div>
          )}
        </div>

        {/* Reason Selector */}
        {reasonRequired && (
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>Approval Reason (Recorded in Audit Log)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {availableReasons.map((r) => {
                const isSel = selectedReason === r && !customReason;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setSelectedReason(r);
                      setCustomReason('');
                    }}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition ${
                      isSel
                        ? 'bg-blue-600/30 border-blue-500 text-blue-200 font-bold'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              placeholder="Or type custom reason..."
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
        )}

        {/* PIN Entry Display */}
        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center space-x-1.5 text-xs font-semibold text-slate-300">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>Enter Manager / Admin 4-Digit PIN</span>
          </div>

          <div className="flex justify-center space-x-3 my-1">
            {[0, 1, 2, 3].map((index) => {
              const isEntered = pin.length > index;
              return (
                <div
                  key={index}
                  className={`w-11 h-12 rounded-2xl flex items-center justify-center border text-xl font-mono font-black transition-all ${
                    isEntered
                      ? 'border-blue-500 bg-blue-500/20 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.3)] scale-105'
                      : 'border-slate-700 bg-slate-950 text-slate-600'
                  }`}
                >
                  {isEntered ? '•' : ''}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="text-xs font-medium text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-xl p-2 flex items-center justify-center space-x-1.5 animate-fadeIn">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* On-Screen Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              id={`manager-pin-btn-${digit}`}
              type="button"
              onClick={() => handleDigit(digit)}
              disabled={isVerifying}
              className="py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-blue-600/50 text-white font-mono font-black text-lg transition shadow-sm"
            >
              {digit}
            </button>
          ))}
          <button
            id="manager-pin-btn-clear"
            type="button"
            onClick={handleClear}
            className="py-3 rounded-2xl bg-slate-800/70 hover:bg-slate-700 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider transition"
          >
            Clear
          </button>
          <button
            id="manager-pin-btn-0"
            type="button"
            onClick={() => handleDigit('0')}
            disabled={isVerifying}
            className="py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-blue-600/50 text-white font-mono font-black text-lg transition shadow-sm"
          >
            0
          </button>
          <button
            id="manager-pin-btn-backspace"
            type="button"
            onClick={handleBackspace}
            className="py-3 rounded-2xl bg-slate-800/70 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        {/* Authorized Roles Footer Notice */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center space-x-1">
            <UserCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>Eligible Authorizers:</span>
          </div>
          <div className="flex items-center space-x-1.5 font-medium">
            {authorizedManagers.map((m) => (
              <span
                key={m.id}
                className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px]"
                title={`PIN: ${m.pin}`}
              >
                {m.name.split(' ')[0]} ({m.role})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
