import React, { useState, useEffect } from 'react';
import { CashTransfer, Salesperson } from '../../types';
import { getCashTransfers } from '../../db/roomDatabase';
import { acceptTillFloat } from '../../services/cashCustodyService';
import { Banknote, KeyRound, Check, X, ShieldAlert, Sparkles } from 'lucide-react';

interface POSCashierFloatModalProps {
  currentUser: Salesperson;
  onFloatAccepted?: (amount: number) => void;
}

export const POSCashierFloatModal: React.FC<POSCashierFloatModalProps> = ({
  currentUser,
  onFloatAccepted,
}) => {
  const [pendingFloat, setPendingFloat] = useState<CashTransfer | null>(null);
  const [enteredPin, setEnteredPin] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const checkPendingFloats = () => {
      if (isDismissed) return;
      const all = getCashTransfers();
      // Find float issues awaiting cashier acceptance
      const float = all.find((t) => t.type === 'FLOAT_ISSUE' && t.status === 'PENDING_ACCEPTANCE');
      setPendingFloat(float || null);
    };

    checkPendingFloats();
    const interval = setInterval(checkPendingFloats, 4000);
    return () => clearInterval(interval);
  }, [isDismissed]);

  if (!pendingFloat || isDismissed) {
    return null;
  }

  const handleAccept = (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredPin) {
      setErrorMessage('Please enter your 6-digit cashier PIN.');
      return;
    }

    const res = acceptTillFloat(pendingFloat.transfer_id, currentUser, enteredPin);
    if (res.success) {
      if (onFloatAccepted) onFloatAccepted(pendingFloat.amount);
      setPendingFloat(null);
      setEnteredPin('');
      setErrorMessage('');
    } else {
      setErrorMessage(res.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-indigo-500/50 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 text-center">
        <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-indigo-600 to-emerald-500 mx-auto flex items-center justify-center text-white shadow-xl">
          <Banknote className="w-8 h-8" />
        </div>

        <div>
          <div className="text-xs uppercase font-mono tracking-wider text-indigo-400 font-bold">
            Cash Custody Verification
          </div>
          <h2 className="text-xl font-black text-white mt-1">
            Till Float Dispatched: ${pendingFloat.amount.toFixed(2)}
          </h2>
          <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
            Accounts Clerk <span className="text-white font-semibold">{pendingFloat.created_by_user_name}</span> has issued a cash float to your till. Enter your PIN to accept physical responsibility.
          </p>
        </div>

        {errorMessage && (
          <div className="p-2.5 bg-rose-950/80 border border-rose-500/50 rounded-xl text-xs text-rose-300 font-medium">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleAccept} className="space-y-4">
          <div>
            <input
              type="password"
              maxLength={6}
              autoFocus
              value={enteredPin}
              onChange={(e) => {
                setEnteredPin(e.target.value);
                setErrorMessage('');
              }}
              placeholder="Enter 6-digit PIN"
              className="w-full min-h-[52px] text-center tracking-widest text-xl font-mono font-bold bg-slate-950 border border-slate-800 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 shadow-inner"
            />
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              Later (Keep in Drawer)
            </button>
            <button
              type="submit"
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white text-xs font-bold shadow-lg transition-all flex items-center justify-center space-x-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Accept Cash</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
