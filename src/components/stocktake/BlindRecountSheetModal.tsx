import React, { useState, useEffect, useMemo } from 'react';
import {
  EyeOff,
  Search,
  ClipboardCheck,
  X,
  UserCheck,
  Boxes,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { StocktakeSession, StocktakeConsolidatedItem, Salesperson } from '../../types';
import { submitBlindRecountSheet } from '../../db/roomDatabase';
import { meshSyncService } from '../../services/meshSyncService';

interface BlindRecountSheetModalProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onClose: () => void;
  onSubmitted: (updated: StocktakeSession) => void;
}

const RECOUNT_REASONS = [
  'Missed Top / Back Shelf Stock',
  'Case Pack vs Loose Unit Miscount',
  'Customer Hold / Layby Bay Separated',
  'Damaged / Storeroom Carton Located',
  'Verified Physical Zero on Shelf',
  'Dual-Team Shelf Check Complete',
];

export const BlindRecountSheetModal: React.FC<BlindRecountSheetModalProps> = ({
  session,
  currentUser,
  onClose,
  onSubmitted,
}) => {
  const queuedItems = useMemo(
    () =>
      (session.consolidatedItems || []).filter(
        (item: StocktakeConsolidatedItem) =>
          item.recountSheetStatus === 'REQUESTED' || Boolean(item.recountRequested)
      ),
    [session.consolidatedItems]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [witnessName, setWitnessName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [inputs, setInputs] = useState<
    Record<string, { cases: number; singles: number; reason: string }>
  >({});

  useEffect(() => {
    const initial: Record<string, { cases: number; singles: number; reason: string }> = {};
    queuedItems.forEach((item) => {
      initial[item.itemId] = {
        cases: Number(item.recountCases ?? 0),
        singles: Number(item.recountSingles ?? 0),
        reason: item.recountReason || RECOUNT_REASONS[0],
      };
    });
    setInputs(initial);
  }, [queuedItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return queuedItems;
    return queuedItems.filter(
      (i) =>
        (i.itemName && i.itemName.toLowerCase().includes(q)) ||
        (i.sku && i.sku.toLowerCase().includes(q)) ||
        (i.barcode && i.barcode.includes(searchQuery))
    );
  }, [queuedItems, searchQuery]);

  const handleFieldChange = (
    itemId: string,
    field: 'cases' | 'singles' | 'reason',
    value: number | string
  ) => {
    setInputs((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { cases: 0, singles: 0, reason: RECOUNT_REASONS[0] }),
        [field]:
          field === 'reason'
            ? String(value)
            : Math.max(0, Number(value) || 0),
      },
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (queuedItems.length === 0) return;

    const entries = queuedItems.map((item) => {
      const val = inputs[item.itemId] || { cases: 0, singles: 0, reason: RECOUNT_REASONS[0] };
      return {
        itemId: item.itemId,
        cases: val.cases,
        singles: val.singles,
        reason: val.reason,
      };
    });

    const updated = submitBlindRecountSheet(
      session.sessionId,
      entries,
      currentUser?.id || 'COUNTER',
      currentUser?.name || 'Blind Recounter',
      witnessName.trim() || undefined
    );

    if (!updated) {
      setErrorMsg('Unable to apply blind recount sheet entries. Refresh session and retry.');
      return;
    }

    meshSyncService.broadcastStocktakeSession(updated);
    onSubmitted(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-purple-700/70 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-gradient-to-r from-purple-950/70 via-slate-900 to-slate-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0">
              <EyeOff className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Blind Physical Recount Sheet</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-700 font-mono">
                  {queuedItems.length} SKU(s) Queued
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Strict Blind Verification: Book stock (SOH), unit cost, and variance figures are hidden to prevent stock balancing.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Secondary Witness Bar */}
        <div className="px-5 py-3 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter recount sheet by SKU, item name, or barcode..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <div className="flex items-center gap-2 min-w-[240px]">
            <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <input
              type="text"
              value={witnessName}
              onChange={(e) => setWitnessName(e.target.value)}
              placeholder="Dual-Witness Name (Optional)"
              className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {errorMsg && (
          <div className="px-5 py-2.5 bg-rose-950/60 border-b border-rose-800 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Recount Form Rows */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {filteredItems.map((item) => {
              const upc = Math.max(1, Number(item.unitsPerCase) || 1);
              const val = inputs[item.itemId] || { cases: 0, singles: 0, reason: RECOUNT_REASONS[0] };
              const totUnits = val.cases * upc + val.singles;

              return (
                <div
                  key={item.itemId}
                  className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="min-w-[240px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 text-purple-300 border border-slate-700">
                        {item.sku || item.itemId}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950/50 text-blue-300">
                        {item.category || 'General'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        Pack: {upc} units/case
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-white mt-1">{item.itemName}</h4>
                    {item.recountNotes && (
                      <p className="text-[11px] text-amber-300/90 mt-1">
                        Auditor Note: {item.recountNotes}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 mb-1">
                        <Boxes className="w-3 h-3 text-blue-400" /> Full Cases
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={val.cases}
                        onChange={(e) => handleFieldChange(item.itemId, 'cases', e.target.value)}
                        className="w-20 text-center font-mono font-bold bg-slate-950 border border-slate-700 text-white rounded py-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>

                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 mb-1">
                        <Package className="w-3 h-3 text-emerald-400" /> Loose Singles
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={val.singles}
                        onChange={(e) => handleFieldChange(item.itemId, 'singles', e.target.value)}
                        className="w-20 text-center font-mono font-bold bg-slate-950 border border-slate-700 text-white rounded py-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>

                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 min-w-[180px]">
                      <div className="text-[10px] text-slate-400 mb-1">Recount Finding Reason</div>
                      <select
                        value={val.reason}
                        onChange={(e) => handleFieldChange(item.itemId, 'reason', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-950 border border-slate-700 text-white rounded text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      >
                        {RECOUNT_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 text-right min-w-[90px]">
                      <div className="text-[10px] uppercase text-slate-400 font-semibold">Recount Total</div>
                      <div className="font-mono font-extrabold text-purple-300 text-sm">{totUnits} u</div>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredItems.length === 0 && (
              <div className="py-12 text-center bg-slate-950/60 rounded-xl border border-slate-800 text-slate-400 text-xs">
                No SKUs are currently flagged on the Blind Recount Sheet.
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] text-slate-400">
              Recounter: <strong className="text-white">{currentUser?.name || 'Counter'}</strong> • Original first-pass count remains preserved in audit ledger.
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Pause & Close
              </button>
              <button
                type="submit"
                disabled={queuedItems.length === 0}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white shadow-lg shadow-purple-900/30 flex items-center gap-2 transition"
              >
                <ClipboardCheck className="w-4 h-4" />
                Submit Blind Recount Sheet ({queuedItems.length})
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
