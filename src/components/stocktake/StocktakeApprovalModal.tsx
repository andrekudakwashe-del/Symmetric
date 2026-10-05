import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  FileText,
  Lock,
  Download,
  Printer,
  TrendingDown,
  TrendingUp,
  UserX,
  Info,
  Unlock,
} from 'lucide-react';
import { StocktakeSession, Salesperson } from '../../types';

interface StocktakeApprovalModalProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onApprove: (adminId: string, adminName: string, notes?: string) => void;
  onClose: () => void;
}

export const StocktakeApprovalModal: React.FC<StocktakeApprovalModalProps> = ({
  session,
  currentUser,
  onApprove,
  onClose,
}) => {
  const [adminPin, setAdminPin] = useState('');
  const [notes, setNotes] = useState('');
  const [pinError, setPinError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const consolidated = session.consolidatedItems || [];
  const varianceItems = consolidated.filter((i) => i.varianceTotalUnits !== 0);
  const shortageItems = consolidated.filter((i) => i.varianceTotalUnits < 0);
  const overageItems = consolidated.filter((i) => i.varianceTotalUnits > 0);

  const adminName = currentUser?.name || 'Sarah Chidyamakono';
  const adminId = currentUser?.id || '001';

  // Role validation: Store Owner (SUPER_ADMIN / ADMIN / 001) OR assigned Stocktake Auditor
  const isOwner =
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.role === 'ADMIN' ||
    currentUser?.id === '001';
  const isAssignedAuditor = Boolean(
    session.stocktakeAuditorId &&
    (currentUser?.id === session.stocktakeAuditorId || adminId === session.stocktakeAuditorId)
  );

  const isAuthorized = isOwner || isAssignedAuditor;
  const isFullLockdown = session.countType === 'FULL_LOCKDOWN';
  const countedItemsOnly = consolidated.filter((i) => i.wasCountedInSession !== false);

  const handleConfirmApproval = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    if (!isAuthorized) {
      setPinError('Access Denied: Only Store Owner or Assigned Stocktake Auditor can commit to inventory.');
      return;
    }

    // PIN check - accepts admin default PIN '1234' or any 4-digit PIN in prototype
    if (adminPin && adminPin.trim() !== '1234' && currentUser?.pin && adminPin.trim() !== currentUser.pin) {
      setPinError('Invalid Admin / Auditor Authorization PIN. Default PIN is 1234.');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      onApprove(adminId, adminName, notes);
      setIsSubmitting(false);
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Stocktake Master Committal & Signoff</h2>
              <p className="text-xs text-slate-400">
                Session: {session.title} ({session.sessionId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleConfirmApproval} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Authorization Check Alert */}
          {!isAuthorized ? (
            <div className="bg-rose-950/50 border border-rose-800/80 rounded-xl p-4 text-xs text-rose-200 flex items-start gap-3">
              <UserX className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-rose-100 font-semibold block mb-0.5">
                  Authority Restricted: Store Owner or Assigned Stocktake Auditor Required
                </strong>
                During stocktakes, even regular branch managers are being audited. Only the Store Owner or the expressly designated <strong>Stocktake Auditor ({session.stocktakeAuditorName || 'Assigned Auditor'})</strong> has permission to commit inventory adjustments.
              </div>
            </div>
          ) : (
            <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3 text-xs text-emerald-200 flex items-center gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Authorized Approver: <strong>{adminName}</strong> ({isOwner ? 'Store Owner' : 'Assigned Stocktake Auditor'})
              </span>
            </div>
          )}

          {/* Scope Banner */}
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3.5 text-xs text-slate-300 flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block font-semibold">
                Committal Scope: {isFullLockdown ? 'Full Storewide Lockdown Overwrite' : `Targeted Count (${session.countType})`}
              </strong>
              <p className="mt-0.5 text-slate-300">
                {isFullLockdown
                  ? 'All lines will be committed to the Inventory Master database. Any uncounted catalog items default to 0 units.'
                  : `Only the ${countedItemsOnly.length} items counted in this session will be updated in the Inventory Master. The rest of the product catalog will remain completely untouched.`}
              </p>
              {session.isLockdownActive && (
                <div className="mt-2 text-emerald-400 flex items-center gap-1 font-semibold">
                  <Unlock className="w-3.5 h-3.5" /> Store Lockdown will be automatically released upon approval.
                </div>
              )}
            </div>
          </div>

          {/* Variance Impact Matrix */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700">
              <div className="text-[11px] text-slate-400">SKUs Changing Stock</div>
              <div className="text-lg font-bold font-mono text-white mt-0.5">
                {varianceItems.length} <span className="text-xs text-slate-400 font-normal">items</span>
              </div>
              <div className="text-[10px] text-slate-400">
                {shortageItems.length} Short / {overageItems.length} Over
              </div>
            </div>

            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700">
              <div className="text-[11px] text-slate-400">Net Unit Variance</div>
              <div
                className={`text-lg font-bold font-mono mt-0.5 ${
                  session.varianceUnits === 0
                    ? 'text-slate-200'
                    : session.varianceUnits < 0
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}
              >
                {session.varianceUnits >= 0 ? `+${session.varianceUnits}` : session.varianceUnits} u
              </div>
              <div className="text-[10px] text-slate-400">Total Count Variance</div>
            </div>

            <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700">
              <div className="text-[11px] text-slate-400">Cost Impact</div>
              <div
                className={`text-lg font-bold font-mono mt-0.5 ${
                  session.varianceCostValue === 0
                    ? 'text-slate-200'
                    : session.varianceCostValue < 0
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}
              >
                {session.varianceCostValue >= 0 ? '+$' : '-$'}
                {Math.abs(session.varianceCostValue).toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">
                Retail: {session.varianceRetailValue >= 0 ? '+$' : '-$'}
                {Math.abs(session.varianceRetailValue).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Admin PIN & Notes */}
          <div className="space-y-3 bg-slate-800/40 p-4 rounded-xl border border-slate-700/80">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-blue-400" />
                Store Owner / Stocktake Auditor Security PIN *
              </label>
              <input
                type="password"
                maxLength={6}
                required
                disabled={!isAuthorized}
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="Enter PIN (Default: 1234)"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono disabled:opacity-50"
              />
              {pinError && <p className="text-xs text-rose-400 mt-1 font-medium">{pinError}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Audit Approval Remarks / Notes (Optional)
              </label>
              <textarea
                rows={2}
                disabled={!isAuthorized}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Physical counts verified across all floor locations. Customer goods left behind reconciled."
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-800/90 border-t border-slate-700 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-700 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmApproval}
            disabled={isSubmitting || !isAuthorized}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg flex items-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ShieldCheck className="w-4 h-4" />
            {isSubmitting ? 'Posting Stock Updates...' : 'Authorize & Commit to Inventory Master'}
          </button>
        </div>
      </div>
    </div>
  );
};
