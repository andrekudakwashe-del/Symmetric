import React, { useState } from 'react';
import { CashAccount } from '../../types';
import { createCommercialBankAccount } from '../../services/cashCustodyService';
import { formatNativeAmount } from './AccountStatementModal';
import {
  X,
  Landmark,
  Smartphone,
  CreditCard,
  PlusCircle,
  ArrowRight,
  Plus,
} from 'lucide-react';

interface CommercialBanksModalProps {
  isOpen: boolean;
  bankAccounts: CashAccount[];
  totalBankBalance: number;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onOpenStatement: (accountId: string) => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  onBankCreated: () => void;
}

export const CommercialBanksModal: React.FC<CommercialBanksModalProps> = ({
  isOpen,
  bankAccounts,
  totalBankBalance,
  title = 'Commercial Banks & Electronic Settlement Accounts',
  subtitle = 'Live USD base balances with original EcoCash & ZiG mobile money totals',
  onClose,
  onOpenStatement,
  onDeposit,
  onWithdraw,
  onBankCreated,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newBankAccountNo, setNewBankAccountNo] = useState('');
  const [newNativeCurrency, setNewNativeCurrency] = useState('');
  const [newOpeningBalance, setNewOpeningBalance] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  if (!isOpen) return null;

  const mobileMoneyAccounts = bankAccounts.filter((b) => Boolean(b.native_currency));

  const handleAddBank = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBankName.trim()) {
      setAddError('Enter a bank or account name (e.g. CBZ Bank USD, Stanbic Bank).');
      return;
    }
    try {
      createCommercialBankAccount({
        accountName: newBankName.trim(),
        bankAccountNumber: newBankAccountNo.trim() || undefined,
        currency: 'USD',
        nativeCurrency: newNativeCurrency.trim() || undefined,
        initialBalance: parseFloat(newOpeningBalance) || 0,
        subtype: 'COMMERCIAL_BANK',
      });
      setNewBankName('');
      setNewBankAccountNo('');
      setNewNativeCurrency('');
      setNewOpeningBalance('');
      setAddError(null);
      setShowAddForm(false);
      onBankCreated();
    } catch (err: any) {
      setAddError(err?.message || 'Failed to create bank account.');
    }
  };

  const renderIcon = (b: CashAccount) => {
    const isEco = b.account_subtype === 'ECOCASH' || b.account_id.includes('ECOCASH');
    const isZig = b.account_subtype === 'ZIG' || b.account_id.includes('ZIG');
    if (isEco) return <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />;
    if (isZig) return <CreditCard className="w-4 h-4 text-amber-400 shrink-0" />;
    return <Landmark className="w-4 h-4 text-cyan-400 shrink-0" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-cyan-500/40 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center border border-cyan-500/40 shrink-0">
              <Landmark className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{title}</h3>
              <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Combined Base USD Total + Mobile Money Native Breakdown */}
          <div className="bg-slate-950/90 border border-cyan-500/30 rounded-2xl p-4 text-center space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold font-mono">
              Combined Commercial Bank &amp; Electronic Balance (Base USD)
            </div>
            <div className="text-3xl font-black text-white font-mono tabular-nums">
              ${totalBankBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {mobileMoneyAccounts.length > 0 && (
              <div className="flex items-center justify-center flex-wrap gap-2 pt-1">
                {mobileMoneyAccounts.map((m) => {
                  const isEco = m.account_subtype === 'ECOCASH' || m.account_id.includes('ECOCASH');
                  return (
                    <span
                      key={m.account_id}
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-mono font-bold border ${
                        isEco
                          ? 'bg-blue-950/70 border-blue-500/40 text-blue-300'
                          : 'bg-amber-950/70 border-amber-500/40 text-amber-300'
                      }`}
                    >
                      {formatNativeAmount(m.native_balance || 0, m.native_currency)}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="text-[10px] text-slate-400">
              EcoCash &amp; ZiG auto-feed from Form 4 settlement confirmations
            </div>
          </div>

          {/* Registered Accounts List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                Registered Accounts ({bankAccounts.length})
              </span>
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showAddForm ? 'Cancel' : 'Add Bank Account'}</span>
              </button>
            </div>

            {/* Inline Add Commercial Bank Account Form */}
            {showAddForm && (
              <form
                onSubmit={handleAddBank}
                className="p-3.5 rounded-2xl bg-slate-950 border border-cyan-500/40 space-y-2.5 animate-fadeIn"
              >
                <div className="text-xs font-bold text-cyan-300">Register New Commercial Bank Account</div>
                {addError && (
                  <div className="text-[11px] text-rose-400 bg-rose-950/40 border border-rose-500/30 px-2.5 py-1.5 rounded-lg">
                    {addError}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Bank / Account Name *</label>
                    <input
                      type="text"
                      value={newBankName}
                      onChange={(e) => setNewBankName(e.target.value)}
                      placeholder="e.g. CBZ Bank USD"
                      className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Account Number (Optional)</label>
                    <input
                      type="text"
                      value={newBankAccountNo}
                      onChange={(e) => setNewBankAccountNo(e.target.value)}
                      placeholder="e.g. 0112345678001"
                      className="w-full px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Opening Balance ($ USD)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newOpeningBalance}
                      onChange={(e) => setNewOpeningBalance(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Native Currency (Optional)</label>
                    <input
                      type="text"
                      value={newNativeCurrency}
                      onChange={(e) => setNewNativeCurrency(e.target.value)}
                      placeholder="Leave blank for USD only"
                      className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition"
                  >
                    Save Bank Account
                  </button>
                </div>
              </form>
            )}

            {bankAccounts.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                No bank or settlement accounts configured.
              </div>
            ) : (
              bankAccounts.map((b) => {
                const isEco = b.account_subtype === 'ECOCASH' || b.account_id.includes('ECOCASH');
                const isZig = b.account_subtype === 'ZIG' || b.account_id.includes('ZIG');
                return (
                  <div
                    key={b.account_id}
                    onClick={() => {
                      onClose();
                      onOpenStatement(b.account_id);
                    }}
                    className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        {renderIcon(b)}
                        <span className="truncate">{b.account_name}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                        {b.bank_account_number ? `Acct: ${b.bank_account_number} · ` : ''}
                        {isEco ? 'Auto-fed from Form 4 EcoCash' : isZig ? 'Auto-fed from Form 4 ZiG' : 'Commercial Bank'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm sm:text-base font-bold font-mono text-cyan-300">
                        ${(b.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      {b.native_currency && (
                        <div
                          className={`text-[11px] font-mono font-bold ${
                            isEco ? 'text-blue-400' : 'text-amber-400'
                          }`}
                        >
                          {formatNativeAmount(b.native_balance || 0, b.native_currency)}
                        </div>
                      )}
                      <div className="text-[10px] text-cyan-400 group-hover:underline inline-flex items-center gap-0.5 mt-0.5">
                        <span>Statement</span>
                        <ArrowRight className="w-2.5 h-2.5" />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              onDeposit();
            }}
            className="flex-1 py-2.5 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Deposit Cash</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onWithdraw();
            }}
            className="flex-1 py-2.5 px-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition flex items-center justify-center space-x-1.5 shadow-md"
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>Withdraw Cash</span>
          </button>
        </div>
      </div>
    </div>
  );
};
