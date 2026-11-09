import React, { useState, useEffect, useMemo } from 'react';
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
  Search,
  Check,
  RefreshCw,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  Salesperson,
} from '../../types';
import { applyJointRecountSignature, getZoneAssignments } from '../../db/roomDatabase';
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
  // Determine if this user is acting as Counter A, Counter B, or BOTH (single shared device)
  const [actingSlot, setActingSlot] = useState<'A' | 'B' | 'BOTH'>('A');
  const [searchQuery, setSearchQuery] = useState('');

  // Draft auto-save state
  const draftKey = `saimetric_stocktake_joint_draft_${session.sessionId}_${segment.segmentId}`;
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<number | null>(null);

  // Mismatched items
  const [discrepancyLines, setDiscrepancyLines] = useState<
    Array<{
      itemId: string;
      itemName: string;
      category?: string;
      sku: string;
      barcode?: string;
      unitsPerCase: number;
      teamACases: number;
      teamASingles: number;
      teamATotalUnits: number;
      teamBCases: number;
      teamBSingles: number;
      teamBTotalUnits: number;
      differenceUnits: number;
      recountCases: number;
      recountSingles: number;
      isResolved?: boolean;
    }>
  >([]);

  const [proposedBy, setProposedBy] = useState<string | null>(null);
  const [signedByA, setSignedByA] = useState<boolean>(false);
  const [signedByB, setSignedByB] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Initialize discrepancy comparison lines strictly comparing Count 1 vs Count 2
  // Normalize cases and singles: 5 cases of 10 equals 50 units (BALANCED! Not a discrepancy).
  useEffect(() => {
    const mapA = new Map<string, StocktakeLineCount>();
    const mapB = new Map<string, StocktakeLineCount>();
    (segment.count1 || []).forEach((l: any) => mapA.set((l.itemId || l.id || '').toUpperCase(), l));
    (segment.count2 || []).forEach((l: any) => mapB.set((l.itemId || l.id || '').toUpperCase(), l));

    const hubDiscrepanciesMap = new Map<string, any>();
    (segment.discrepancies || []).forEach((d: any) => {
      hubDiscrepanciesMap.set((d.itemId || d.sku || '').toUpperCase(), d);
    });

    const allKeys = Array.from(
      new Set([
        ...Array.from(mapA.keys()),
        ...Array.from(mapB.keys()),
        ...Array.from(hubDiscrepanciesMap.keys()),
      ])
    );
    const diffs: any[] = [];

    allKeys.forEach((key) => {
      const a = mapA.get(key);
      const b = mapB.get(key);
      const hubDisc = hubDiscrepanciesMap.get(key);
      const base = a || b || hubDisc;
      if (!base) return;

      const upc = Math.max(1, Number(base.unitsPerCase || hubDisc?.unitsPerCase || 1));
      const aCases = Number(a ? a.cases : (hubDisc ? hubDisc.teamACases : 0)) || 0;
      const bCases = Number(b ? b.cases : (hubDisc ? hubDisc.teamBCases : 0)) || 0;
      const aSingles = Number(a ? a.singles : (hubDisc ? hubDisc.teamASingles : 0)) || 0;
      const bSingles = Number(b ? b.singles : (hubDisc ? hubDisc.teamBSingles : 0)) || 0;

      const aTot = a && a.totalUnits !== undefined && a.totalUnits !== null
        ? Number(a.totalUnits)
        : (aCases * upc + aSingles);
      const bTot = b && b.totalUnits !== undefined && b.totalUnits !== null
        ? Number(b.totalUnits)
        : (bCases * upc + bSingles);

      // Skip if both 0 (not counted / 0 units)
      if (aTot === 0 && bTot === 0) return;

      // Normalization: e.g. 5 cases of 10 vs 50 singles -> 50 === 50 -> BALANCES! Skip!
      if (aTot === bTot) return;

      diffs.push({
        itemId: base.itemId || key,
        itemName: base.itemName || key,
        category: base.category,
        sku: base.sku || key,
        barcode: base.barcode,
        unitsPerCase: upc,
        teamACases: aCases,
        teamASingles: aSingles,
        teamATotalUnits: aTot,
        teamBCases: bCases,
        teamBSingles: bSingles,
        teamBTotalUnits: bTot,
        differenceUnits: Math.abs(aTot - bTot),
        recountCases: aCases, // seeded
        recountSingles: aSingles,
        isResolved: false,
      });
    });

    // Check roomDatabase zone assignments & segment joint recount for peer signature
    try {
      const zones = getZoneAssignments(session.sessionId);
      const zone = zones.find((z) => (!session.sessionId || z.sessionId === session.sessionId) && z.zoneId === segment.segmentId);
      const jr = zone?.jointRecount || segment.jointRecount;
      if (jr) {
        if (jr.signedByA) setSignedByA(true);
        if (jr.signedByB) setSignedByB(true);
        if (jr.proposedByName) setProposedBy(jr.proposedByName);
        if (jr.signedByA && !jr.signedByB) {
          setActingSlot('B');
          setStatusMessage(`Team A (${jr.proposedByName || 'Counter A'}) signed. Review shelf and tap 'Confirm & Finalize as Team B'.`);
        } else if (jr.signedByB && !jr.signedByA) {
          setActingSlot('A');
          setStatusMessage(`Team B (${jr.proposedByName || 'Counter B'}) signed. Review shelf and tap 'Confirm & Finalize as Team A'.`);
        }
        if (Array.isArray(jr.lines) && jr.lines.length > 0) {
          const merged = diffs.map((d) => {
            const match = jr.lines.find((l: any) => l.itemId === d.itemId);
            if (match) {
              return {
                ...d,
                recountCases: match.cases !== undefined ? match.cases : d.recountCases,
                recountSingles: match.singles !== undefined ? match.singles : d.recountSingles,
                isResolved: true,
              };
            }
            return d;
          });
          setDiscrepancyLines(merged);
          return;
        }
      }
    } catch (e) {
      console.warn('[JointRecount] Error reading zone joint recount:', e);
    }

    // Check for local auto-saved draft
    try {
      const rawDraft = localStorage.getItem(draftKey);
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          const merged = diffs.map((d) => {
            const found = parsed.lines.find((p: any) => p.itemId === d.itemId);
            if (found) {
              return {
                ...d,
                recountCases: found.recountCases !== undefined ? found.recountCases : d.recountCases,
                recountSingles: found.recountSingles !== undefined ? found.recountSingles : d.recountSingles,
                isResolved: Boolean(found.isResolved),
              };
            }
            return d;
          });
          setDiscrepancyLines(merged);
          setLastDraftSavedAt(parsed.updatedAt || Date.now());
          return;
        }
      }
    } catch {}

    setDiscrepancyLines(diffs);
  }, [segment, draftKey, session.sessionId]);

  // Auto-save draft on any recount update
  const persistDraft = (lines: typeof discrepancyLines) => {
    try {
      const payload = {
        sessionId: session.sessionId,
        segmentId: segment.segmentId,
        lines,
        updatedAt: Date.now(),
      };
      localStorage.setItem(draftKey, JSON.stringify(payload));
      setLastDraftSavedAt(Date.now());
    } catch {}
  };

  // Listen for real-time peer proposal and status updates from WebSocket Hub
  useEffect(() => {
    const handleProposal = (e: any) => {
      const detail = e.detail;
      if (detail && detail.zoneId === segment.segmentId) {
        setProposedBy(detail.proposedByName || `Team ${detail.proposedBySlot}`);
        if (detail.proposedBySlot === 'A') {
          setSignedByA(true);
          setActingSlot('B');
          setStatusMessage(`Team A (${detail.proposedByName || 'Counter A'}) signed. Review shelf and tap Confirm to finalize as Team B.`);
        }
        if (detail.proposedBySlot === 'B') {
          setSignedByB(true);
          setActingSlot('A');
          setStatusMessage(`Team B (${detail.proposedByName || 'Counter B'}) signed. Review shelf and tap Confirm to finalize as Team A.`);
        }

        if (Array.isArray(detail.recountLines)) {
          setDiscrepancyLines((prev) => {
            const updated = prev.map((item) => {
              const match = detail.recountLines.find((l: any) => l.itemId === item.itemId);
              if (match) {
                return {
                  ...item,
                  recountCases: match.cases !== undefined ? match.cases : item.recountCases,
                  recountSingles: match.singles !== undefined ? match.singles : item.recountSingles,
                  isResolved: true,
                };
              }
              return item;
            });
            persistDraft(updated);
            return updated;
          });
        }
      }
    };

    const handleZoneUpdated = (e: any) => {
      const detail = e.detail;
      if (detail && detail.zoneId === segment.segmentId) {
        if (detail.status === 'VERIFIED') {
          setStatusMessage('Dual-Signature Complete! Zone verified and committed.');
          setTimeout(() => {
            onResolved();
            onClose();
          }, 600);
        }
      }
    };

    window.addEventListener('saimetric_stocktake_joint_proposal', handleProposal);
    window.addEventListener('saimetric_stocktake_zone_updated', handleZoneUpdated);
    window.addEventListener('saimetric_stocktake_match_verified', handleZoneUpdated);
    return () => {
      window.removeEventListener('saimetric_stocktake_joint_proposal', handleProposal);
      window.removeEventListener('saimetric_stocktake_zone_updated', handleZoneUpdated);
      window.removeEventListener('saimetric_stocktake_match_verified', handleZoneUpdated);
    };
  }, [segment.segmentId, session.sessionId, onClose, onResolved]);

  const handleUpdateLine = (itemId: string, field: 'cases' | 'singles', delta: number) => {
    setDiscrepancyLines((prev) => {
      const updated = prev.map((item) => {
        if (item.itemId !== itemId) return item;
        const current = field === 'cases' ? item.recountCases : item.recountSingles;
        const nextVal = Math.max(0, current + delta);
        return {
          ...item,
          [field === 'cases' ? 'recountCases' : 'recountSingles']: nextVal,
          isResolved: true, // Mark verified on edit
        };
      });
      persistDraft(updated);
      return updated;
    });
  };

  const handleSetExactLine = (itemId: string, cases: number, singles: number) => {
    setDiscrepancyLines((prev) => {
      const updated = prev.map((item) => {
        if (item.itemId !== itemId) return item;
        return {
          ...item,
          recountCases: cases,
          recountSingles: singles,
          isResolved: true,
        };
      });
      persistDraft(updated);
      return updated;
    });
  };

  const toggleLineResolved = (itemId: string) => {
    setDiscrepancyLines((prev) => {
      const updated = prev.map((item) => {
        if (item.itemId !== itemId) return item;
        return {
          ...item,
          isResolved: !item.isResolved,
        };
      });
      persistDraft(updated);
      return updated;
    });
  };

  // Sort and filter:
  // - Unresolved (!isResolved) RED and sorted to TOP (0)
  // - Recounted / resolved (isResolved) GREEN and sent to BOTTOM (1)
  const sortedAndFilteredLines = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const filtered = discrepancyLines.filter((d) => {
      if (!q) return true;
      return (
        d.itemName.toLowerCase().includes(q) ||
        d.sku.toLowerCase().includes(q) ||
        (d.barcode && d.barcode.includes(q))
      );
    });

    return filtered.sort((a, b) => {
      const isResolvedA = Boolean(a.isResolved);
      const isResolvedB = Boolean(b.isResolved);

      // Unresolved items sort to the TOP
      if (!isResolvedA && isResolvedB) return -1;
      if (isResolvedA && !isResolvedB) return 1;

      return b.differenceUnits - a.differenceUnits;
    });
  }, [discrepancyLines, searchQuery]);

  const resolvedCount = discrepancyLines.filter((l) => l.isResolved).length;
  const pendingCount = discrepancyLines.length - resolvedCount;

  const handleDualSignBoth = () => {
    const staffName = currentUser?.name || 'Dual Counters (A & B)';
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

    setSignedByA(true);
    setSignedByB(true);

    try {
      localStorage.removeItem(draftKey);
    } catch {}

    // Apply local signature for BOTH
    applyJointRecountSignature(
      session.sessionId,
      segment.segmentId,
      'BOTH',
      staffName,
      linesToSubmit
    );

    // Finalize across Local Hub & peers
    meshSyncService.finalizeJointRecount(session.sessionId, segment.segmentId, linesToSubmit, staffName);
    setStatusMessage('Dual-Signature Complete! Both Counters agreed on 1 Device. Zone Verified.');
    setTimeout(() => {
      onResolved();
      onClose();
    }, 600);
  };

  const handleProposeOrSign = () => {
    if (actingSlot === 'BOTH') {
      handleDualSignBoth();
      return;
    }

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

    const otherTeamAlreadySigned = (actingSlot === 'A' && signedByB) || (actingSlot === 'B' && signedByA);

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

    if (isComplete || otherTeamAlreadySigned) {
      // Clear draft upon successful completion
      try {
        localStorage.removeItem(draftKey);
      } catch {}

      // Both signatures present: Finalize across Local Hub
      meshSyncService.finalizeJointRecount(session.sessionId, segment.segmentId, linesToSubmit, staffName);
      setStatusMessage('Dual-Signature Complete! Joint Recount Verified & Committed.');
      setTimeout(() => {
        onResolved();
        onClose();
      }, 600);
    } else {
      // Send proposal to peer
      meshSyncService.proposeJointRecount(session.sessionId, segment.segmentId, actingSlot, staffName, linesToSubmit);
      setStatusMessage(`Signed by ${staffName} (Team ${actingSlot}). Waiting for Counter ${actingSlot === 'A' ? 'B' : 'A'} to confirm.`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-950 via-slate-900 to-slate-900 p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <RotateCcw className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black text-white">Joint Shelf Recount & Dual-Signature</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
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

        {/* Counter Slot Selector & Draft Status */}
        <div className="bg-slate-950 px-4 sm:px-6 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
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
              <button
                type="button"
                onClick={() => setActingSlot('BOTH')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  actingSlot === 'BOTH' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
                title="Single device used by both teams together at the shelf"
              >
                Both Teams (1-Device) {signedByA && signedByB && '✓'}
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-[11px] font-mono">
            {lastDraftSavedAt && (
              <span className="text-emerald-400 bg-emerald-950/70 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Draft Saved {new Date(lastDraftSavedAt).toLocaleTimeString()}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded ${signedByA ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              Team A: {signedByA ? 'Signed' : 'Pending'}
            </span>
            <span className={`px-2 py-0.5 rounded ${signedByB ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              Team B: {signedByB ? 'Signed' : 'Pending'}
            </span>
          </div>
        </div>

        {/* Search Bar & Red/Green Legend */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products by SKU, name, or barcode..."
              className="w-full pl-9 pr-8 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-inner"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          <div className="text-[11px] text-slate-400 font-mono">
            <span className="text-rose-400 font-bold">Unresolved: {pendingCount} (Top)</span> •{' '}
            <span className="text-emerald-400 font-bold">Recounted: {resolvedCount} (Bottom)</span>
          </div>
        </div>

        {/* Status Prompt */}
        {statusMessage && (
          <div className="bg-blue-950/70 border-b border-blue-800/60 px-6 py-2 text-xs text-blue-200 flex items-center justify-between animate-fadeIn">
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Recount Lines List (Red Unresolved Top, Green Recounted Bottom) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {sortedAndFilteredLines.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="font-semibold text-white">No Discrepancies</p>
              <p className="text-xs text-slate-400 mt-1">
                {searchQuery
                  ? `No items matched "${searchQuery}".`
                  : 'Counts between Counter A and B are in perfect balance.'}
              </p>
            </div>
          ) : (
            sortedAndFilteredLines.map((item) => {
              const isResolved = Boolean(item.isResolved);
              const upc = item.unitsPerCase || 1;
              const recountTot = item.recountCases * upc + item.recountSingles;

              return (
                <div
                  key={item.itemId}
                  className={`p-4 rounded-2xl border transition-all ${
                    isResolved
                      ? 'bg-emerald-950/20 border-emerald-500/60 ring-1 ring-emerald-500/20'
                      : 'bg-rose-950/25 border-rose-500/60 ring-1 ring-rose-500/20 shadow-md'
                  } flex flex-col md:flex-row md:items-center justify-between gap-4`}
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                        {item.sku || item.itemId}
                      </span>
                      <h4 className="text-sm font-bold text-white">{item.itemName}</h4>
                      {isResolved ? (
                        <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-400" /> Agreed ({recountTot} u)
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-rose-300 bg-rose-950/80 border border-rose-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-400" /> Diff: {item.differenceUnits} u
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1.5 font-mono">
                      <span className="text-blue-400">Team A: {item.teamACases} cs, {item.teamASingles} ea ({item.teamATotalUnits} u)</span>
                      <span className="text-slate-600">vs</span>
                      <span className="text-purple-400">Team B: {item.teamBCases} cs, {item.teamBSingles} ea ({item.teamBTotalUnits} u)</span>
                      <button
                        type="button"
                        onClick={() => handleSetExactLine(item.itemId, item.teamACases, item.teamASingles)}
                        className="text-[10px] text-blue-300 hover:text-white underline font-sans ml-2"
                      >
                        Use A
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetExactLine(item.itemId, item.teamBCases, item.teamBSingles)}
                        className="text-[10px] text-purple-300 hover:text-white underline font-sans"
                      >
                        Use B
                      </button>
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

                    <button
                      type="button"
                      onClick={() => toggleLineResolved(item.itemId)}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                        isResolved
                          ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-700'
                          : 'bg-rose-900/80 text-rose-200 border border-rose-700 hover:bg-emerald-900'
                      }`}
                      title={isResolved ? 'Click to reopen' : 'Click to confirm agreed recount'}
                    >
                      {isResolved ? 'Agreed ✓' : 'Confirm'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-950 p-4 sm:p-5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {signedByA && signedByB ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Ready to finalize: both counters have signed
              </span>
            ) : (
              <span>Anti-Fraud Protocol: Requires Dual-Signature from both counters</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>

            {actingSlot !== 'BOTH' && (
              <button
                type="button"
                onClick={handleDualSignBoth}
                className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 flex items-center space-x-1.5 transition active:scale-95"
                title="Both teams standing together with this one device agree on these numbers"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Dual-Sign (Both Agree Here)</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleProposeOrSign}
              className={`px-5 py-2.5 rounded-xl text-xs font-black flex items-center space-x-2 shadow-lg transition active:scale-95 ${
                actingSlot === 'BOTH'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                  : actingSlot === 'A'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
            >
              {actingSlot === 'BOTH' ? (
                <ShieldCheck className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>
                {actingSlot === 'BOTH'
                  ? 'Dual-Sign & Finalize (Both Agree)'
                  : actingSlot === 'A'
                  ? signedByB
                    ? 'Confirm & Finalize as Team A'
                    : 'Sign & Submit as Team A'
                  : signedByA
                  ? 'Confirm & Finalize as Team B'
                  : 'Sign & Submit as Team B'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
