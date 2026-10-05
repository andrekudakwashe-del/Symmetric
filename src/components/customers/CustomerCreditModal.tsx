import React, { useState } from 'react';
import { Customer, Salesperson } from '../../types';
import {
  isSupervisorOrAbove,
  getCreditPolicy,
  getCustomerCreditSummary,
  updateCustomerCreditTerms,
} from '../../db/roomDatabase';
import { ManagerPinModal } from '../common/ManagerPinModal';
import {
  CreditCard,
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertTriangle,
  X,
  Coins,
  History,
  User,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface CustomerCreditModalProps {
  customer: Customer | null;
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
  onSuccess?: (updated: Customer) => void;
}

export const CustomerCreditModal: React.FC<CustomerCreditModalProps> = ({
  customer,
  isOpen,
  onClose,
  currentUser,
  onSuccess,
}) => {
  if (!isOpen || !customer) return null;

  const policy = getCreditPolicy();
  const maxCap = policy.maxCustomerCreditCap || 300.0;
  const isAuthorized = isSupervisorOrAbove(currentUser.role) || Boolean(currentUser.permissions?.canGrantCredit);

  const [creditAllowed, setCreditAllowed] = useState(customer.creditAllowed !== false);
  const [creditLimit, setCreditLimit] = useState(String(customer.creditLimit !== undefined ? customer.creditLimit : policy.defaultCreditLimit));
  const [maxReceipts, setMaxReceipts] = useState(String(customer.maxCreditReceiptCount !== undefined ? customer.maxCreditReceiptCount : policy.defaultMaxReceiptCount));
  const [showPinModal, setShowPinModal] = useState(false);
  const [authorizer, setAuthorizer] = useState<{ id: string; name: string; role: string } | null>(
    isAuthorized ? { id: currentUser.id, name: currentUser.name, role: currentUser.role } : null
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const summary = getCustomerCreditSummary(customer.customerId);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorizer) {
      setShowPinModal(true);
      return;
    }

    const numericLimit = Math.max(0, parseFloat(creditLimit) || 0);
    const numericReceipts = Math.max(1, parseInt(maxReceipts, 10) || 1);

    if (numericLimit > maxCap && authorizer.role !== 'OWNER' && authorizer.role !== 'SUPER_ADMIN') {
      setError(`Limit ($${numericLimit.toFixed(2)}) exceeds the Owner's maximum policy ceiling ($${maxCap.toFixed(2)}). Only the Business Owner can authorize an override.`);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const updated = updateCustomerCreditTerms(
        customer.customerId,
        {
          creditAllowed,
          creditLimit: numericLimit,
          maxCreditReceiptCount: numericReceipts,
        },
        authorizer
      );

      if (updated) {
        confetti({ particleCount: 40, spread: 50 });
        if (onSuccess) onSuccess(updated);
        onClose();
      } else {
        setError('Failed to update customer credit terms.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error updating credit terms.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-purple-500/40 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden text-left flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-purple-950/80 via-slate-900 to-indigo-950/80 border-b border-purple-800/40 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-white text-base sm:text-lg">
                  Customer Credit Terms &amp; Limit
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {customer.customerId}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Authorized credit account management &amp; exposure protection
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Customer Overview */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-white">{customer.name}</div>
              <div className="text-[11px] text-slate-400">{customer.phone || 'No phone'} • {customer.address || 'Harare'}</div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 uppercase block font-bold">Current Debt</span>
              <span className={`text-base font-black font-mono-num ${summary.totalOutstanding > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                ${summary.totalOutstanding.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Current Debt & Unpaid Receipts Badge */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Unpaid Receipts:</span>
              <span className="font-bold font-mono text-white text-xs">{summary.unpaidReceiptsCount} active invoices</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Owner Max Policy Ceiling:</span>
              <span className="font-bold font-mono text-amber-300 text-xs">${maxCap.toFixed(2)} per customer</span>
            </div>
          </div>

          {/* Credit Account Allowed Toggle */}
          <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-200 block">Credit Account Allowed</span>
              <span className="text-[10px] text-slate-400">Allow this customer to make credit purchases on account</span>
            </div>
            <input
              type="checkbox"
              checked={creditAllowed}
              onChange={(e) => setCreditAllowed(e.target.checked)}
              className="w-4 h-4 accent-purple-600 rounded cursor-pointer"
            />
          </div>

          {/* Credit Limit & Max Receipts */}
          {creditAllowed && (
            <div className="space-y-3 p-3.5 rounded-2xl bg-slate-950/50 border border-slate-800">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Credit Limit ($ USD)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-bold">$</span>
                  <input
                    type="number"
                    step="5"
                    min="0"
                    required
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    disabled={!authorizer}
                    className="w-full pl-7 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Maximum allowable outstanding debt balance for this customer across all branches.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Maximum Unpaid Receipts Allowed
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  required
                  value={maxReceipts}
                  onChange={(e) => setMaxReceipts(e.target.value)}
                  disabled={!authorizer}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Customer will be blocked if they have this many open unpaid receipts, even if under dollar limit.
                </p>
              </div>
            </div>
          )}

          {/* Authorization Status */}
          <div className="p-3 rounded-2xl bg-purple-950/30 border border-purple-800/40 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0" />
              <div className="text-[11px]">
                {authorizer ? (
                  <span className="text-purple-200">
                    Authorized by <strong className="text-white">{authorizer.name} ({authorizer.role})</strong>
                  </span>
                ) : (
                  <span className="text-amber-300 font-bold">
                    Supervisor PIN authorization required to save changes
                  </span>
                )}
              </div>
            </div>
            {!authorizer && (
              <button
                type="button"
                onClick={() => setShowPinModal(true)}
                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] transition shrink-0"
              >
                Enter PIN
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer Controls */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 text-white font-black text-xs shadow-md transition active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save Credit Terms'}
            </button>
          </div>
        </form>
      </div>

      {/* Supervisor PIN Verification Modal if needed */}
      {showPinModal && (
        <ManagerPinModal
          isOpen={showPinModal}
          onClose={() => setShowPinModal(false)}
          title="Supervisor Authorization: Set Customer Credit Limit"
          subtitle={`Authorizing credit terms adjustment for customer ${customer.name} (#${customer.customerId})`}
          actionType="APPROVAL"
          actionDescription="Customer Credit Limit Change"
          reasonRequired={false}
          onAuthorize={(manager) => {
            setAuthorizer({ id: manager.id, name: manager.name, role: manager.role });
            setShowPinModal(false);
          }}
        />
      )}
    </div>
  );
};
