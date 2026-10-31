import React, { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  CheckCircle,
  ShieldCheck,
  RotateCcw,
  Boxes,
  Package,
  UserCheck,
  Send,
  Sparkles,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  Salesperson,
  StocktakeVarianceItem,
} from '../../types';
import { applyJointRecountSignature } from '../../db/roomDatabase';
import { meshSyncService } from '../../services/meshSyncService';

interface JointRecountModalProps {
  session: StocktakeSession;
  segment: StocktakeSegment;
  currentUser: Salesperson | null;
  onClose: () => void;
  onResolved: () => void;
}

export const JointRecountModal: React.FC<JointRecountModalProps> = ({
  session,
  segment,
  currentUser,
  onClose,
  onResolved,
}) => {
  // Determine if this user is acting as Counter A or Counter B
  const [actingSlot, setActingSlot] = useState<'A' | 'B'>('A');

  // Mismatched items
  const [discrepancyLines, setDiscrepancyLines] = useState<
    Array<{
      itemId: string;
      itemName: string;
      category?: string;
      sku: string;
      unitsPerCase: number;
      teamACases: number;
      teamASingles: number;
      teamATotalUnits: number;
      teamBCases: number;
      teamBSingles: number;
      teamBTotalUnits: number;
      recountCases: number;
      recountSingles: number;
    }>
  >([]);

  const [proposedBy, setProposedBy] = useState<string | null>(null);
  const [signedByA, setSignedByA] = useState<boolean>(false);
  const [signedByB, setSignedByB] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Initialize discrepancy comparison lines
  useEffect(() => {
    const mapA = new Map<string, StocktakeLineCount>();
    const mapB = new Map<string, StocktakeLineCount>();
    (segment.count1 || []).forEach((l) => mapA.set((l.itemId || '').toUpperCase(), l));
    (segment.count2 || []).forEach((l) => mapB.set((l.itemId || '').toUpperCase(), l));

    const allKeys = Array.from(new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]));
    const diffs: any[] = [];

    allKeys.forEach((key) => {
      const a = mapA.get(key);
      const b = mapB.get(key);
      const aCases = Number(a ? a.cases : 0) || 0;
      const bCases = Number(b ? b.cases : 0) || 0;
      const aSingles = Number(a ? a.singles : 0) || 0;
      const bSingles = Number(b ? b.singles : 0) || 0;
      const aTot = Number(a ? a.totalUnits : 0) || 0;
      const bTot = Number(b ? b.totalUnits : 0) || 0;
      const base = a || b;

      if (!a || !b || aCases !== bCases || aSingles !== bSingles || aTot !== bTot) {
        diffs.push({
          itemId: base?.itemId || key,
          itemName: base?.itemName || key,
          category: base?.category,
          sku: base?.sku || key,
          unitsPerCase: base?.unitsPerCase || 1,
          teamACases: aCases,
          teamASingles: aSingles,
          teamATotalUnits: aTot,
          teamBCases: bCases,
          teamBSingles: bSingles,
          teamBTotalUnits: bTot,
          recountCases: aCases, // seeded
          recountSingles: aSingles,
        });
      }
    });

    setDiscrepancyLines(diffs);
  }, [segment]);

  // Listen for real-time peer proposal from WebSocket Hub
  useEffect(() => {
    const handleProposal = (e: any) => {
      const detail = e.detail;
      if (detail && detail.zoneId === segment.segmentId) {
        setProposedBy(detail.proposedByName || `Team ${detail.proposedBySlot}`);
        if (detail.proposedBySlot === 'A') setSignedByA(true);
        if (detail.proposedBySlot === 'B') setSignedByB(true);

        if (Array.isArray(detail.recountLines)) {
          setDiscrepancyLines((prev) =>
            prev.map((item) => {
              const match = detail.recountLines.find((l: any) => l.itemId === item.itemId);
              if (match) {
                return {
                  ...item,
                  recountCases: match.cases || 0,
                  recountSingles: match.singles || 0,
                };
              }
              return item;
            })
          );
        }
        setStatusMessage(`Team ${detail.proposedBySlot} submitted proposed numbers. Inspect shelf and tap Sign to confirm.`);
      }
    };

    window.addEventListener('saimetric_stocktake_joint_proposal', handleProposal);
    return () => {
      window.removeEventListener('saimetric_stocktake_joint_proposal', handleProposal);
    };
  }, [segment.segmentId]);

  const handleUpdateLine = (itemId: string, field: 'cases' | 'singles', delta: number) => {
    setDiscrepancyLines((prev) =>
      prev.map((item) => {
        if (item.itemId !== itemId) return item;
        const current = field === 'cases' ? item.recountCases : item.recountSingles;
        const updated = Math.max(0, current + delta);
        return {
          ...item,
          [field === 'cases' ? 'recountCases' : 'recountSingles']: updated,
        };
      })
    );
  };

  const handleProposeOrSign = () => {
    const staffName = currentUser?.name || `Counter ${actingSlot}`;
    const linesToSubmit: StocktakeLineCount[] = discrepancyLines.map((d) => ({
      itemId: d.itemId,
      itemName: d.itemName,
      category: d.category,
      sku: d.sku,
      unitsPerCase: d.unitsPerCase,
      cases: d.recountCases,
      singles: d.recountSingles,
      totalUnits: d.recountCases * d.unitsPerCase + d.recountSingles,
      countedBy: currentUser?.id || '001',
      countedByName: staffName,
      timestamp: new Date().toISOString(),
    }));

    if (actingSlot === 'A') setSignedByA(true);
    if (actingSlot === 'B') setSignedByB(true);

    // Apply local signature
    const { isComplete } = applyJointRecountSignature(
      session.sessionId,
      segment.segmentId,
      actingSlot,
      staffName,
      linesToSubmit
    );

    if (isComplete || (signedByA && actingSlot === 'B') || (signedByB && actingSlot === 'A')) {
      // Both signatures present: Finalize across Local Hub
      meshSyncService.finalizeJointRecount(session.sessionId, segment.segmentId, linesToSubmit, staffName);
      setStatusMessage('Dual-Signature Complete! Joint Recount Verified & Committed.');
      setTimeout(() => {
        onResolved();
        onClose();
      }, 1000);
    } else {
      // Send proposal to peer
      meshSyncService.proposeJointRecount(session.sessionId, segment.segmentId, actingSlot, staffName, linesToSubmit);
      setStatusMessage(`Signed by ${staffName} (Team ${actingSlot}). Waiting for Counter ${actingSlot === 'A' ? 'B' : 'A'} to confirm.`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-950 via-slate-900 to-slate-900 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <RotateCcw className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black text-white">Joint Shelf Recount & Dual-Signature</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {discrepancyLines.length} Discrepancies
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Zone: <strong className="text-white">{segment.name}</strong> • Walk to shelf together and re-verify
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Counter Slot Selector */}
        <div className="bg-slate-950 px-6 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-300 font-semibold flex items-center space-x-2">
            <span>Signing Device Role:</span>
            <div className="flex items-center bg-slate-800 rounded-xl p-0.5 border border-slate-700">
              <button
                type="button"
                onClick={() => setActingSlot('A')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  actingSlot === 'A' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Team A {signedByA && '✓'}
              </button>
              <button
                type="button"
                onClick={() => setActingSlot('B')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  actingSlot === 'B' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Team B {signedByB && '✓'}
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-[11px] font-mono">
            <span className={`px-2 py-0.5 rounded ${signedByA ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              Team A: {signedByA ? 'Signed' : 'Pending'}
            </span>
            <span className={`px-2 py-0.5 rounded ${signedByB ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              Team B: {signedByB ? 'Signed' : 'Pending'}
            </span>
          </div>
        </div>

        {/* Status Prompt */}
        {statusMessage && (
          <div className="bg-blue-950/70 border-b border-blue-800/60 px-6 py-2 text-xs text-blue-200 flex items-center justify-between animate-fadeIn">
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Recount Lines List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {discrepancyLines.map((item) => {
            const recountTot = item.recountCases * item.unitsPerCase + item.recountSingles;
            return (
              <div
                key={item.itemId}
                className="bg-slate-950 p-4 rounded-2xl border border-slate-800 hover:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                      {item.sku || item.itemId}
                    </span>
                    <h4 className="text-sm font-bold text-white">{item.itemName}</h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1.5 font-mono">
                    <span className="text-blue-400">Team A: {item.teamACases} cs, {item.teamASingles} ea ({item.teamATotalUnits} u)</span>
                    <span className="text-slate-600">vs</span>
                    <span className="text-purple-400">Team B: {item.teamBCases} cs, {item.teamBSingles} ea ({item.teamBTotalUnits} u)</span>
                  </div>
                </div>

                {/* Recount Input Steppers */}
                <div className="flex items-center space-x-3 bg-slate-900 p-2 rounded-xl border border-slate-800">
                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase mr-1">Cases</span>
                    <button
                      type="button"
                      onClick={() => handleUpdateLine(item.itemId, 'cases', -1)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-sm text-white">
                      {item.recountCases}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUpdateLine(item.itemId, 'cases', 1)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>

                  <div className="h-6 w-px bg-slate-800" />

                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase mr-1">Singles</span>
                    <button
                      type="button"
                      onClick={() => handleUpdateLine(item.itemId, 'singles', -1)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-mono font-bold text-sm text-white">
                      {item.recountSingles}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUpdateLine(item.itemId, 'singles', 1)}
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>

                  <div className="ml-2 font-mono text-xs font-black text-amber-300">
                    = {recountTot} u
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="bg-slate-950 p-5 border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {signedByA && signedByB ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Ready to finalize: both counters have signed
              </span>
            ) : (
              <span>Anti-Fraud Protocol: Requires Dual-Signature from both counters</span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleProposeOrSign}
              className={`px-5 py-2.5 rounded-xl text-xs font-black flex items-center space-x-2 shadow-lg transition active:scale-95 ${
                actingSlot === 'A'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
            >
              <Send className="w-4 h-4" />
              <span>
                {actingSlot === 'A'
                  ? signedByB ? 'Confirm & Finalize as Team A' : 'Sign & Submit as Team A'
                  : signedByA ? 'Confirm & Finalize as Team B' : 'Sign & Submit as Team B'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
