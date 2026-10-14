import React, { useState, useEffect } from 'react';
import { Salesperson, WalletId, OwnerDrawingCategory } from '../../types';
import { getWallets, recordOwnerDrawing } from '../../services/walletService';
import {
  Home,
  UserCheck,
  GraduationCap,
  Heart,
  DollarSign,
  AlertCircle,
  CheckCircle,
  X,
  ShieldAlert,
} from 'lucide-react';

interface OwnerDrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
}

export const OwnerDrawingModal: React.FC<OwnerDrawingModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [wallets, setWallets] = useState(() => getWallets());
  const [fromWallet, setFromWallet] = useState<WalletId>('wallet_cash');
  const [category, setCategory] = useState<OwnerDrawingCategory>('PERSONAL');
  const [amount, setAmount] = useState<string>('');
  const [recipient, setRecipient] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setWallets(getWallets());
      setAmount('');
      setRecipient('');
      setNotes('');
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isOwnerOrAdmin =
    currentUser.role === 'OWNER' ||
    currentUser.role === 'Admin' ||
    currentUser.role === 'SUPER_ADMIN';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isOwnerOrAdmin) {
      setError('Only the Store Owner or Admin can execute Owner Drawings or Home Safe cash transit.');
      return;
    }

    const numAmount = parseFloat(amount) || 0;
    if (numAmount <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    try {
      recordOwnerDrawing({
        amount: numAmount,
        fromWallet,
        category,
        recipientOrPurpose: recipient || `Owner Drawing (${category})`,
        notes,
        currentUser,
      });

      setSuccess(`Owner Drawing recorded! $${numAmount.toFixed(2)} deducted from ${fromWallet}.`);
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err?.message || 'Failed to record drawing.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl text-white">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">Owner Drawings &amp; Home Safe Transit</h3>
              <p className="text-[11px] text-slate-400">Track personal withdrawals, family expenses, school fees, and home safe storage</p>
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

          {/* Category Selector */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1.5">Drawing Purpose / Category</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCategory('HOME_SAFE_TRANSIT')}
                className={`p-2.5 rounded-2xl border text-left text-xs font-bold transition flex items-center gap-2 ${
                  category === 'HOME_SAFE_TRANSIT'
                    ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <Home className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="block">Home Safe Transit</span>
                  <span className="text-[10px] text-slate-500 font-normal">Cash taken home to safe</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCategory('PERSONAL')}
                className={`p-2.5 rounded-2xl border text-left text-xs font-bold transition flex items-center gap-2 ${
                  category === 'PERSONAL'
                    ? 'bg-purple-950/70 border-purple-500 text-purple-300 ring-1 ring-purple-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <UserCheck className="w-4 h-4 text-purple-400 shrink-0" />
                <div>
                  <span className="block">Personal Drawings</span>
                  <span className="text-[10px] text-slate-500 font-normal">Clothes, personal cash</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCategory('FAMILY')}
                className={`p-2.5 rounded-2xl border text-left text-xs font-bold transition flex items-center gap-2 ${
                  category === 'FAMILY'
                    ? 'bg-rose-950/70 border-rose-500 text-rose-300 ring-1 ring-rose-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <Heart className="w-4 h-4 text-rose-400 shrink-0" />
                <div>
                  <span className="block">Family / Household</span>
                  <span className="text-[10px] text-slate-500 font-normal">Groceries, family upkeep</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setCategory('SCHOOL_FEES')}
                className={`p-2.5 rounded-2xl border text-left text-xs font-bold transition flex items-center gap-2 ${
                  category === 'SCHOOL_FEES'
                    ? 'bg-blue-950/70 border-blue-500 text-blue-300 ring-1 ring-blue-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <GraduationCap className="w-4 h-4 text-blue-400 shrink-0" />
                <div>
                  <span className="block">School &amp; College Fees</span>
                  <span className="text-[10px] text-slate-500 font-normal">Tuition &amp; education</span>
                </div>
              </button>
            </div>
          </div>

          {/* Wallet Source & Amount */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">Deduct from Wallet</label>
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
              <label className="text-xs font-bold text-slate-300 block mb-1">Amount Withdrawn</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 100.00"
                  className="w-full pl-7 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono"
                />
              </div>
            </div>
          </div>

          {/* Recipient / Purpose detail */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Recipient / Specific Purpose</label>
            <input
              type="text"
              required
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="e.g. Andre Personal, Girlfriend ($100), St Georges Term 1 fees"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Additional Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Handed cash in sealed envelope"
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
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 text-white text-xs font-black shadow-lg"
            >
              Record Drawing
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
