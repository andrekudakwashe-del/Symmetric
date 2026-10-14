import React, { useState, useEffect } from 'react';
import { Salesperson, WalletId } from '../../types';
import { getWallets, recordWalletTransfer, recordOwnerDrawing } from '../../services/walletService';
import {
  ArrowLeftRight,
  Landmark,
  Wallet,
  Receipt,
  AlertCircle,
  CheckCircle,
  X,
  Coins,
  ShieldCheck,
} from 'lucide-react';

interface WalletTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
}

export const WalletTransferModal: React.FC<WalletTransferModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [wallets, setWallets] = useState(() => getWallets());
  const [fromWallet, setFromWallet] = useState<WalletId>('wallet_ecocash');
  const [toWallet, setToWallet] = useState<WalletId>('wallet_cash');
  const [amountSent, setAmountSent] = useState<string>('');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setWallets(getWallets());
      setAmountSent('');
      setAmountReceived('');
      setNotes('');
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const parsedSent = parseFloat(amountSent) || 0;
  const parsedReceived = parseFloat(amountReceived) || 0;
  // Automatically calculate bank/cashout charge
  const calculatedCharge = Math.max(0, Math.round((parsedSent - parsedReceived) * 100) / 100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fromWallet === toWallet) {
      setError('Source and Destination wallets cannot be the same.');
      return;
    }

    if (parsedSent <= 0) {
      setError('Please enter a valid amount withdrawn / sent.');
      return;
    }

    if (parsedReceived <= 0 || parsedReceived > parsedSent) {
      setError('Amount received must be greater than $0 and cannot exceed amount sent.');
      return;
    }

    const sourceW = wallets.find((w) => w.id === fromWallet);
    if (!sourceW) {
      setError('Source wallet not found.');
      return;
    }

    try {
      const transfer = recordWalletTransfer({
        fromWallet,
        toWallet,
        amountSent: parsedSent,
        amountReceived: parsedReceived,
        bankCharge: calculatedCharge,
        notes: notes || `Transfer from ${sourceW.name} (Fee: $${calculatedCharge.toFixed(2)})`,
        currentUser,
      });

      setSuccess(
        `Transfer Complete! ${sourceW.name} -$${parsedSent.toFixed(2)}, Destination +$${parsedReceived.toFixed(2)}. Charge $${calculatedCharge.toFixed(2)} posted to expenses.`
      );

      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err?.message || 'Transfer failed.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl text-white">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">Electronic Withdrawal &amp; Wallet Transfer</h3>
              <p className="text-[11px] text-slate-400">Withdraw EcoCash/ZiG/Bank to Cash with auto bank charge split</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-2xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-2xl text-xs flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Wallets Selector */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">From (Sending / Source)</label>
              <select
                value={fromWallet}
                onChange={(e) => setFromWallet(e.target.value as WalletId)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} (${w.balance.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">To (Destination / Receiving)</label>
              <select
                value={toWallet}
                onChange={(e) => setToWallet(e.target.value as WalletId)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} (${w.balance.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Amounts: Sent vs Received */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Amount Sent / Withdrawn</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={amountSent}
                  onChange={(e) => setAmountSent(e.target.value)}
                  placeholder="e.g. 50.00"
                  className="w-full pl-7 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Physical Cash Received</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={amountReceived}
                  onChange={(e) => setAmountReceived(e.target.value)}
                  placeholder="e.g. 49.00"
                  className="w-full pl-7 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono"
                />
              </div>
            </div>
          </div>

          {/* Charge Auto Split Box */}
          <div className="bg-slate-950 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-amber-400" />
              <div>
                <span className="text-xs font-bold text-white block">Calculated Withdrawal / Bank Fee</span>
                <span className="text-[10px] text-slate-400">
                  Auto-posted to company expenses under Bank &amp; Transaction Fees
                </span>
              </div>
            </div>
            <span className="font-mono font-black text-sm text-amber-400">
              ${calculatedCharge.toFixed(2)}
            </span>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Notes / Transaction Reference (Optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. EcoCash Agent withdrawal Ref #789012"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
            />
          </div>

          {/* Footer */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 text-white text-xs font-black shadow-lg"
            >
              Execute Transfer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
