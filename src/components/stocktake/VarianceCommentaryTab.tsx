import React, { useState, useEffect } from 'react';
import {
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldCheck,
  MessageSquare,
  Send,
  XCircle,
  Lock,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeConsolidatedItem,
  StocktakeVarianceReasonCode,
  Salesperson,
} from '../../types';
import {
  submitPostCommitVarianceComments,
  acknowledgePostCommitVariance,
} from '../../db/roomDatabase';
import {
  isStocktakeLeader,
  isStocktakeAuditor,
  isAuditedManager,
  isVarianceItemMandatoryForComment,
} from '../../services/stocktakeAccessService';
import { meshSyncService } from '../../services/meshSyncService';

interface VarianceCommentaryTabProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onRefreshSession: (updated?: StocktakeSession) => void;
}

const REASON_CODE_LABELS: { value: StocktakeVarianceReasonCode; label: string }[] = [
  { value: 'THEFT_SHRINKAGE', label: 'Suspected Theft / Pilferage / Shrinkage' },
  { value: 'DAMAGED_EXPIRED', label: 'Damaged, Spoiled or Expired Stock' },
  { value: 'GRN_RECEIVING_ERROR', label: 'GRN / Invoice Receiving Discrepancy' },
  { value: 'CASHIER_SKU_SWAP', label: 'Cashier SKU Swap / Mis-Scan at Till' },
  { value: 'UNRECORDED_SHOP_USE', label: 'Unrecorded Internal Shop Use / Samples' },
  { value: 'PREVIOUS_COUNT_ERROR', label: 'Prior Stocktake Counting Error' },
  { value: 'SUPPLIER_SHORT_DELIVERY', label: 'Supplier Short Delivery Claim Pending' },
  { value: 'OTHER', label: 'Other Verified Explanation (Specify Below)' },
];

interface DraftEntry {
  reasonCode: StocktakeVarianceReasonCode;
  managerComment: string;
  actionTaken: string;
}

export const VarianceCommentaryTab: React.FC<VarianceCommentaryTabProps> = ({
  session,
  currentUser,
  onRefreshSession,
}) => {
  const isLeader = isStocktakeLeader(currentUser);
  const isAuditor = isStocktakeAuditor(currentUser, session);
  const isManager = isAuditedManager(currentUser, session);
  const canEditComments = (isManager || isAuditor || isLeader) && session.varianceReviewStatus !== 'CLOSED';
  const canOwnerSignOff = isLeader || (isAuditor && !isManager);

  const thresholdUsd = Number(session.varianceMaterialityThreshold || 10);
  const varianceItems = (session.consolidatedItems || []).filter(
    (item) =>
      Number(item.varianceTotalUnits || 0) !== 0 &&
      (session.countType === 'FULL_LOCKDOWN' || item.wasCountedInSession !== false)
  );

  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const [ackStatuses, setAckStatuses] = useState<Record<string, 'ACKNOWLEDGED' | 'DISPUTED'>>({});
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'MANDATORY' | 'UNCOMMENTED'>('ALL');

  useEffect(() => {
    const initialDrafts: Record<string, DraftEntry> = {};
    const initialAcks: Record<string, 'ACKNOWLEDGED' | 'DISPUTED'> = {};
    varianceItems.forEach((item) => {
      initialDrafts[item.itemId] = {
        reasonCode: (item.reasonCode as StocktakeVarianceReasonCode) || 'OTHER',
        managerComment: item.managerComment || '',
        actionTaken: item.actionTaken || '',
      };
      initialAcks[item.itemId] =
        item.ownerAckStatus === 'DISPUTED'
          ? 'DISPUTED'
          : item.ownerAckStatus === 'ACKNOWLEDGED'
          ? 'ACKNOWLEDGED'
          : 'ACKNOWLEDGED';
    });
    setDrafts(initialDrafts);
    setAckStatuses(initialAcks);
  }, [session.sessionId, session.updatedAt, session.varianceReviewStatus]);

  const mandatoryItems = varianceItems.filter((item) =>
    isVarianceItemMandatoryForComment(item, thresholdUsd)
  );
  const explainedMandatoryCount = mandatoryItems.filter(
    (item) => Boolean(item.managerComment && item.managerComment.trim().length > 0)
  ).length;

  const filteredItems = varianceItems.filter((item) => {
    if (filterMode === 'MANDATORY') {
      return isVarianceItemMandatoryForComment(item, thresholdUsd);
    }
    if (filterMode === 'UNCOMMENTED') {
      return !item.managerComment || !item.managerComment.trim();
    }
    return true;
  });

  const handleFieldChange = (
    itemId: string,
    field: keyof DraftEntry,
    value: string
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { reasonCode: 'OTHER', managerComment: '', actionTaken: '' }),
        [field]: value,
      },
    }));
  };

  const handleSubmitExplanations = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackBanner(null);

    const missingMandatory = mandatoryItems.filter((item) => {
      const entry = drafts[item.itemId];
      return !entry || !entry.managerComment || entry.managerComment.trim().length < 5;
    });

    if (missingMandatory.length > 0) {
      setFeedbackBanner({
        type: 'error',
        text: `Please enter a detailed explanation (min 5 characters) for all ${missingMandatory.length} mandatory high-variance SKU(s) highlighted in amber.`,
      });
      return;
    }

    const entries = varianceItems
      .map((item) => {
        const d = drafts[item.itemId];
        if (!d || !d.managerComment.trim()) return null;
        return {
          itemId: item.itemId,
          reasonCode: d.reasonCode || 'OTHER',
          managerComment: d.managerComment.trim(),
          actionTaken: d.actionTaken?.trim() || undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    if (entries.length === 0) {
      setFeedbackBanner({
        type: 'error',
        text: 'Enter at least one variance explanation before submitting.',
      });
      return;
    }

    const res = submitPostCommitVarianceComments(
      session.sessionId,
      entries,
      currentUser?.id || 'MGR-LOCAL',
      currentUser?.name || 'Branch Manager'
    );

    if (res.success && res.session) {
      meshSyncService.broadcastStocktakeSession(res.session);
      onRefreshSession(res.session);
      setFeedbackBanner({ type: 'success', text: res.message });
    } else {
      setFeedbackBanner({ type: 'error', text: res.message });
    }
  };

  const handleOwnerDecision = (decision: 'CLOSED' | 'DISPUTED') => {
    setFeedbackBanner(null);
    const res = acknowledgePostCommitVariance(
      session.sessionId,
      decision,
      currentUser?.id || 'OWNER-LOCAL',
      currentUser?.name || 'Store Owner',
      ackStatuses
    );

    if (res.success && res.session) {
      meshSyncService.broadcastStocktakeSession(res.session);
      onRefreshSession(res.session);
      setFeedbackBanner({ type: 'success', text: res.message });
    } else {
      setFeedbackBanner({ type: 'error', text: res.message });
    }
  };

  const reviewStatus = session.varianceReviewStatus || 'NOT_REQUIRED';
  const deadlineStr = session.varianceCommentDeadline
    ? new Date(session.varianceCommentDeadline).toLocaleString()
    : '48h post-commit';

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/50 to-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-white">
                Post-Commit Manager Variance Commentary & Sign-Off
              </h3>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  reviewStatus === 'CLOSED'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : reviewStatus === 'COMMENTS_SUBMITTED'
                    ? 'bg-blue-950 text-blue-300 border-blue-700'
                    : reviewStatus === 'PENDING_MANAGER_COMMENTS'
                    ? 'bg-amber-950 text-amber-300 border-amber-700 animate-pulse'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {reviewStatus.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              Every variance above <strong className="text-white">${thresholdUsd.toFixed(2)}</strong> or{' '}
              <strong className="text-white">5 units</strong> requires a formal root-cause code and corrective action from the Branch Manager / Supervisor before audit closure.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
          <div className="bg-slate-950/80 px-3.5 py-2 rounded-xl border border-slate-800">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Mandatory Covered</div>
            <div className="font-mono font-bold text-white text-sm">
              {explainedMandatoryCount} / {mandatoryItems.length} SKUs
            </div>
          </div>
          {reviewStatus === 'PENDING_MANAGER_COMMENTS' && (
            <div className="bg-amber-950/50 px-3.5 py-2 rounded-xl border border-amber-800/70">
              <div className="text-[10px] text-amber-300 uppercase font-bold flex items-center gap-1">
                <Clock className="w-3 h-3" /> Response Due
              </div>
              <div className="font-mono font-semibold text-amber-100 text-[11px]">{deadlineStr}</div>
            </div>
          )}
        </div>
      </div>

      {feedbackBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
              : 'bg-rose-950/60 border-rose-700 text-rose-200'
          }`}
        >
          {feedbackBanner.type === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedbackBanner.text}</span>
        </div>
      )}

      {session.varianceReviewedByName && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>
              Last Reviewed By: <strong className="text-white">{session.varianceReviewedByName}</strong> on{' '}
              {session.varianceReviewedAt ? new Date(session.varianceReviewedAt).toLocaleString() : 'N/A'}
            </span>
          </div>
          {reviewStatus === 'CLOSED' && (
            <span className="inline-flex items-center gap-1 text-emerald-300 font-bold">
              <Lock className="w-3.5 h-3.5" /> Audit Explanation Ledger Locked & Archived
            </span>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/70 p-3 rounded-xl border border-slate-800 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterMode('ALL')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              filterMode === 'ALL' ? 'bg-blue-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            All Variances ({varianceItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('MANDATORY')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              filterMode === 'MANDATORY' ? 'bg-amber-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            Mandatory ({mandatoryItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('UNCOMMENTED')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              filterMode === 'UNCOMMENTED' ? 'bg-rose-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            Awaiting Notes ({varianceItems.filter((i) => !i.managerComment?.trim()).length})
          </button>
        </div>

        <div className="text-[11px] text-slate-400">
          Committed Net Variance:{' '}
          <strong className={session.varianceCostValue < 0 ? 'text-rose-400 font-mono' : 'text-emerald-400 font-mono'}>
            {session.varianceUnits >= 0 ? `+${session.varianceUnits}` : session.varianceUnits} units ($
            {session.varianceCostValue.toFixed(2)})
          </strong>
        </div>
      </div>

      {/* Variance Explanations Form */}
      {varianceItems.length === 0 ? (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-10 text-center">
          <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
          <h4 className="text-sm font-bold text-white">Zero Stock Variances Recorded</h4>
          <p className="text-xs text-slate-400 mt-1">
            Physical floor counts matched system SOH across all audited SKUs. No manager explanations are required.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmitExplanations} className="space-y-4">
          <div className="space-y-3">
            {filteredItems.map((item: StocktakeConsolidatedItem, idx: number) => {
              const isMandatory = isVarianceItemMandatoryForComment(item, thresholdUsd);
              const draft = drafts[item.itemId] || {
                reasonCode: (item.reasonCode as StocktakeVarianceReasonCode) || 'OTHER',
                managerComment: item.managerComment || '',
                actionTaken: item.actionTaken || '',
              };
              const isDisputed = item.ownerAckStatus === 'DISPUTED' || ackStatuses[item.itemId] === 'DISPUTED';

              return (
                <div
                  key={`${item.itemId}-${idx}`}
                  className={`rounded-2xl border p-4 space-y-3 transition ${
                    isMandatory && !draft.managerComment.trim()
                      ? 'bg-amber-950/20 border-amber-600/60'
                      : isDisputed && item.ownerAckStatus === 'DISPUTED'
                      ? 'bg-rose-950/25 border-rose-600/60'
                      : 'bg-slate-900/90 border-slate-800'
                  }`}
                >
                  {/* Item Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-950 text-blue-400 border border-slate-800">
                          {item.sku || item.itemId}
                        </span>
                        <h4 className="text-sm font-bold text-white">{item.itemName}</h4>
                        {isMandatory && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-700">
                            MANDATORY COMMENTARY
                          </span>
                        )}
                        {item.ownerAckStatus === 'DISPUTED' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-700">
                            DISPUTED BY OWNER
                          </span>
                        )}
                        {item.ownerAckStatus === 'ACKNOWLEDGED' && reviewStatus === 'CLOSED' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700">
                            ACKNOWLEDGED
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-3 font-mono">
                        <span>System SOH: <strong className="text-slate-200">{item.systemTotalUnits} u</strong></span>
                        <span>Physical Count: <strong className="text-slate-200">{item.countedTotalUnits} u</strong></span>
                        <span>
                          Variance:{' '}
                          <strong className={item.varianceTotalUnits < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                            {item.varianceTotalUnits >= 0 ? `+${item.varianceTotalUnits}` : item.varianceTotalUnits} u ($
                            {item.varianceCostValue.toFixed(2)})
                          </strong>
                        </span>
                      </div>
                    </div>

                    {canOwnerSignOff && session.varianceReviewStatus !== 'CLOSED' && (
                      <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
                        <button
                          type="button"
                          onClick={() =>
                            setAckStatuses((prev) => ({ ...prev, [item.itemId]: 'ACKNOWLEDGED' }))
                          }
                          className={`px-2.5 py-1 rounded font-bold transition ${
                            (ackStatuses[item.itemId] || 'ACKNOWLEDGED') === 'ACKNOWLEDGED'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Accept Note
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAckStatuses((prev) => ({ ...prev, [item.itemId]: 'DISPUTED' }))
                          }
                          className={`px-2.5 py-1 rounded font-bold transition ${
                            ackStatuses[item.itemId] === 'DISPUTED'
                              ? 'bg-rose-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Dispute
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inputs */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Variance Reason Code {isMandatory ? '*' : ''}
                      </label>
                      <select
                        disabled={!canEditComments}
                        value={draft.reasonCode}
                        onChange={(e) => handleFieldChange(item.itemId, 'reasonCode', e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                      >
                        {REASON_CODE_LABELS.map((rc) => (
                          <option key={rc.value} value={rc.value}>
                            {rc.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Manager Root-Cause Explanation {isMandatory ? '*' : ''}
                      </label>
                      <input
                        type="text"
                        disabled={!canEditComments}
                        value={draft.managerComment}
                        onChange={(e) => handleFieldChange(item.itemId, 'managerComment', e.target.value)}
                        placeholder="Explain how variance occurred..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                        Corrective / Disciplinary Action Taken
                      </label>
                      <input
                        type="text"
                        disabled={!canEditComments}
                        value={draft.actionTaken}
                        onChange={(e) => handleFieldChange(item.itemId, 'actionTaken', e.target.value)}
                        placeholder="e.g. CCTV check, till deduction, GRN query"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {item.commentedByName && (
                    <div className="text-[10px] text-slate-500 font-mono flex items-center gap-2">
                      <FileText className="w-3 h-3 text-slate-400" />
                      <span>
                        Last note by {item.commentedByName} ({item.commentedAt ? new Date(item.commentedAt).toLocaleString() : ''})
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action Footer */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              Changes sync across POS terminals and Cloud Ledger automatically on save.
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {canEditComments && (
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg flex items-center gap-1.5 transition"
                >
                  <Send className="w-3.5 h-3.5" />
                  Submit Manager Variance Explanations
                </button>
              )}

              {canOwnerSignOff && reviewStatus !== 'CLOSED' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleOwnerDecision('DISPUTED')}
                    className="px-4 py-2 bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Return to Manager (Disputed)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOwnerDecision('CLOSED')}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg flex items-center gap-1.5 transition"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Sign Off & Close Review
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      )}
    </div>
  );
};
