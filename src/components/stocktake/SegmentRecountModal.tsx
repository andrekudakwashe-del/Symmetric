import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  Boxes,
  Package,
  UserCheck,
  HelpCircle,
  Save,
  Search,
  Check,
  RefreshCw,
  Eye,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  Salesperson,
} from '../../types';

interface SegmentRecountModalProps {
  session: StocktakeSession;
  segment: StocktakeSegment;
  currentUser: Salesperson | null;
  onResolveRecount: (
    segmentId: string,
    resolvedRecountLines: StocktakeLineCount[],
    staffId: string,
    staffName: string
  ) => void;
  onClose: () => void;
}

interface DiscrepancyItem {
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
  defaultCases: number;
  defaultSingles: number;
  defaultTotalUnits: number;
}

export const SegmentRecountModal: React.FC<SegmentRecountModalProps> = ({
  session,
  segment,
  currentUser,
  onResolveRecount,
  onClose,
}) => {
  const [recounterName, setRecounterName] = useState(currentUser?.name || 'Sarah Chidyamakono');
  const [recounterId, setRecounterId] = useState(currentUser?.id || '001');
  const [searchQuery, setSearchQuery] = useState('');

  // Draft auto-save state
  const draftKey = `saimetric_stocktake_recount_${session.sessionId}_${segment.segmentId}`;
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<number | null>(null);
  const [draftRestored, setDraftRestored] = useState<boolean>(false);

  // 1. Build authoritative discrepancy list strictly comparing Count A vs Count B
  // Normalize cases and singles: 5 cases of 10 equals 50 units (Balances! Not a discrepancy).
  const discrepancies: DiscrepancyItem[] = useMemo(() => {
    const mapA = new Map<string, StocktakeLineCount>();
    const mapB = new Map<string, StocktakeLineCount>();
    (segment.count1 || []).forEach((l: any) => mapA.set((l.itemId || l.id || '').toUpperCase(), l));
    (segment.count2 || []).forEach((l: any) => mapB.set((l.itemId || l.id || '').toUpperCase(), l));

    // Also inspect segment.discrepancies if populated from Hub
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

    const diffList: DiscrepancyItem[] = [];

    allKeys.forEach((key) => {
      const itemA = mapA.get(key);
      const itemB = mapB.get(key);
      const hubDisc = hubDiscrepanciesMap.get(key);
      const base = itemA || itemB || hubDisc;
      if (!base) return;

      const upc = Math.max(1, Number(base.unitsPerCase || hubDisc?.unitsPerCase || 1));
      const aCases = Number(itemA ? itemA.cases : (hubDisc ? hubDisc.teamACases : 0)) || 0;
      const bCases = Number(itemB ? itemB.cases : (hubDisc ? hubDisc.teamBCases : 0)) || 0;
      const aSingles = Number(itemA ? itemA.singles : (hubDisc ? hubDisc.teamASingles : 0)) || 0;
      const bSingles = Number(itemB ? itemB.singles : (hubDisc ? hubDisc.teamBSingles : 0)) || 0;

      // Normalized total units calculation
      const aTot = itemA && itemA.totalUnits !== undefined && itemA.totalUnits !== null
        ? Number(itemA.totalUnits)
        : (aCases * upc + aSingles);
      const bTot = itemB && itemB.totalUnits !== undefined && itemB.totalUnits !== null
        ? Number(itemB.totalUnits)
        : (bCases * upc + bSingles);

      // Skip if both counted 0 units (not a discrepancy)
      if (aTot === 0 && bTot === 0) return;

      // Normalization: e.g. 5 cases of 10 vs 50 singles -> 50 === 50 -> BALANCES! Skip!
      if (aTot === bTot) return;

      diffList.push({
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
        defaultCases: aCases,
        defaultSingles: aSingles,
        defaultTotalUnits: aTot,
      });
    });

    return diffList;
  }, [segment]);

  // Recount values per item: { cases, singles, totalUnits }
  const [recountValues, setRecountValues] = useState<
    Record<string, { cases: number; singles: number; totalUnits: number }>
  >({});

  // Resolved items tracking: true = reconciled/verified (green, sent to bottom); false = needs resolution (red, top)
  const [resolvedMap, setResolvedMap] = useState<Record<string, boolean>>({});

  // Initialize and load auto-saved draft
  useEffect(() => {
    let loadedFromDraft = false;
    try {
      const rawDraft = localStorage.getItem(draftKey);
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed && parsed.recountValues && Object.keys(parsed.recountValues).length > 0) {
          setRecountValues(parsed.recountValues);
          if (parsed.resolvedMap) setResolvedMap(parsed.resolvedMap);
          if (parsed.recounterName) setRecounterName(parsed.recounterName);
          setLastDraftSavedAt(parsed.updatedAt || Date.now());
          setDraftRestored(true);
          loadedFromDraft = true;
        }
      }
    } catch (e) {
      console.warn('[Recount Draft] Error loading draft:', e);
    }

    if (!loadedFromDraft) {
      const initialMap: Record<string, { cases: number; singles: number; totalUnits: number }> = {};
      const initialResolved: Record<string, boolean> = {};

      discrepancies.forEach((d) => {
        initialMap[d.itemId] = {
          cases: d.defaultCases,
          singles: d.defaultSingles,
          totalUnits: d.defaultTotalUnits,
        };
        // Unresolved initially
        initialResolved[d.itemId] = false;
      });

      setRecountValues(initialMap);
      setResolvedMap(initialResolved);
    }
  }, [draftKey, discrepancies]);

  // Auto-save draft on any recount adjustment
  const persistDraft = (
    nextValues: Record<string, { cases: number; singles: number; totalUnits: number }>,
    nextResolved: Record<string, boolean>
  ) => {
    try {
      const payload = {
        sessionId: session.sessionId,
        segmentId: segment.segmentId,
        recountValues: nextValues,
        resolvedMap: nextResolved,
        recounterName,
        recounterId,
        updatedAt: Date.now(),
      };
      localStorage.setItem(draftKey, JSON.stringify(payload));
      setLastDraftSavedAt(Date.now());
    } catch (e) {
      console.warn('[Recount Draft] Auto-save error:', e);
    }
  };

  // Update recount values and mark item resolved (sends to bottom with green highlight)
  const handleUpdate = (itemId: string, upc: number, cases: number, singles: number) => {
    const totalUnits = cases * upc + singles;
    const nextValues = {
      ...recountValues,
      [itemId]: { cases, singles, totalUnits },
    };
    const nextResolved = {
      ...resolvedMap,
      [itemId]: true, // Mark verified on edit
    };
    setRecountValues(nextValues);
    setResolvedMap(nextResolved);
    persistDraft(nextValues, nextResolved);
  };

  // Quick accept actions (Accept Count 1 or Count 2)
  const handleQuickAccept = (itemId: string, upc: number, cases: number, singles: number, total: number) => {
    const nextValues = {
      ...recountValues,
      [itemId]: { cases, singles, totalUnits: total },
    };
    const nextResolved = {
      ...resolvedMap,
      [itemId]: true,
    };
    setRecountValues(nextValues);
    setResolvedMap(nextResolved);
    persistDraft(nextValues, nextResolved);
  };

  // Toggle resolved / recount status manually
  const toggleResolved = (itemId: string) => {
    const nextResolved = {
      ...resolvedMap,
      [itemId]: !resolvedMap[itemId],
    };
    setResolvedMap(nextResolved);
    persistDraft(recountValues, nextResolved);
  };

  // Filter and sort items:
  // - Unresolved (needs resolution) highlighted RED and sorted to the TOP (0)
  // - Recounted / resolved highlighted GREEN and sent to the BOTTOM (1)
  const sortedAndFilteredItems = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const filtered = discrepancies.filter((d) => {
      if (!q) return true;
      return (
        d.itemName.toLowerCase().includes(q) ||
        d.sku.toLowerCase().includes(q) ||
        (d.barcode && d.barcode.includes(q))
      );
    });

    return filtered.sort((a, b) => {
      const isResolvedA = Boolean(resolvedMap[a.itemId]);
      const isResolvedB = Boolean(resolvedMap[b.itemId]);

      // Unresolved items sort to the TOP
      if (!isResolvedA && isResolvedB) return -1;
      if (isResolvedA && !isResolvedB) return 1;

      // Then sort by largest discrepancy difference first
      return b.differenceUnits - a.differenceUnits;
    });
  }, [discrepancies, searchQuery, resolvedMap]);

  // Overall counts
  const resolvedCount = Object.values(resolvedMap).filter(Boolean).length;
  const pendingCount = discrepancies.length - resolvedCount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const resolvedLines: StocktakeLineCount[] = discrepancies.map((d) => {
      const current = recountValues[d.itemId] || {
        cases: d.defaultCases,
        singles: d.defaultSingles,
        totalUnits: d.defaultTotalUnits,
      };
      const upc = d.unitsPerCase || 1;
      return {
        itemId: d.itemId,
        itemName: d.itemName,
        category: d.category,
        sku: d.sku,
        barcode: d.barcode,
        unitsPerCase: upc,
        cases: current.cases,
        singles: current.singles,
        totalUnits: current.cases * upc + current.singles,
        wasCounted: true,
        countedBy: recounterId,
        countedByName: recounterName,
        timestamp: new Date().toISOString(),
      };
    });

    // Clear draft upon official resolution
    try {
      localStorage.removeItem(draftKey);
    } catch {}

    onResolveRecount(segment.segmentId, resolvedLines, recounterId, recounterName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-800/95 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <RotateCcw className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Segment Recount & Discrepancy Resolution
                </h2>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-800/80 font-mono font-bold">
                  {discrepancies.length} Mismatched Item(s)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Segment: <strong className="text-slate-200">{segment.name}</strong> ({segment.locationCode || segment.segmentId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Guidance and Live Auto-Save Banner */}
        <div className="bg-slate-950/90 border-b border-slate-800 px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Items with differences between <strong>Count 1</strong> and <strong>Count 2</strong>.
              Packaging is normalized (e.g. 5 cases of 10 balances with 50 units).
            </span>
          </div>

          <div className="flex items-center gap-3">
            {lastDraftSavedAt && (
              <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Draft Auto-Saved ({new Date(lastDraftSavedAt).toLocaleTimeString()})
              </span>
            )}
            <div className="text-[11px] font-mono text-slate-300 flex items-center gap-2">
              <span className="text-rose-400 font-bold">Unresolved: {pendingCount}</span>
              <span>•</span>
              <span className="text-emerald-400 font-bold">Recounted: {resolvedCount}</span>
            </div>
          </div>
        </div>

        {/* Sticky Search Bar */}
        <div className="px-5 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search discrepancy items by SKU, name, or barcode..."
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

          <div className="text-[11px] text-slate-400">
            <span className="text-rose-300 font-bold">Red (Top)</span> = Pending Recount •{' '}
            <span className="text-emerald-300 font-bold">Green (Bottom)</span> = Recounted & Resolved
          </div>
        </div>

        {/* Discrepancy Comparison Cards / Table */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {sortedAndFilteredItems.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="font-semibold text-white">No Discrepancy Found</p>
              <p className="text-xs text-slate-400 mt-1">
                {searchQuery
                  ? `No discrepancy products matched "${searchQuery}".`
                  : 'All counts between Team A and Team B have balanced perfectly in normalized base units.'}
              </p>
            </div>
          ) : (
            sortedAndFilteredItems.map((item, idx) => {
              const isResolved = Boolean(resolvedMap[item.itemId]);
              const upc = item.unitsPerCase || 1;
              const currentRecount = recountValues[item.itemId] || {
                cases: item.defaultCases,
                singles: item.defaultSingles,
                totalUnits: item.defaultTotalUnits,
              };

              return (
                <div
                  key={`${item.itemId}-${idx}`}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isResolved
                      ? 'bg-emerald-950/20 border-emerald-500/60 ring-1 ring-emerald-500/20'
                      : 'bg-rose-950/25 border-rose-500/60 ring-1 ring-rose-500/20 shadow-md'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Item Details & Diff Flag */}
                    <div className="min-w-[240px]">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-medium text-slate-300 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-700">
                          {item.sku}
                        </span>
                        <span className="text-[10px] text-blue-400 bg-blue-950/60 px-1.5 py-0.5 rounded">
                          {upc} units/case
                        </span>
                        {isResolved ? (
                          <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-700/80 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-400" /> Recount Verified ({currentRecount.totalUnits} u)
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-rose-300 bg-rose-950/80 border border-rose-700/80 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-rose-400" /> Discrepancy ({item.differenceUnits} u mismatch)
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-bold text-white mt-1">{item.itemName}</h4>
                      {item.barcode && (
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Barcode: {item.barcode}
                        </div>
                      )}
                    </div>

                    {/* Dual Count Comparison Pill */}
                    <div className="flex items-center gap-2 bg-slate-950/90 p-2 rounded-lg border border-slate-800 text-xs font-mono">
                      {/* Count 1 */}
                      <div className="px-2 py-1 rounded bg-blue-950/50 border border-blue-900/60 text-center">
                        <div className="text-[9px] uppercase text-blue-400 font-bold">Count 1 (Team A)</div>
                        <div className="font-bold text-blue-200 text-sm">{item.teamATotalUnits} u</div>
                        <div className="text-[10px] text-slate-400">
                          {item.teamACases} cs + {item.teamASingles} ea
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickAccept(
                              item.itemId,
                              upc,
                              item.teamACases,
                              item.teamASingles,
                              item.teamATotalUnits
                            )
                          }
                          className="mt-1 text-[10px] text-blue-300 hover:text-white underline font-sans"
                        >
                          Use A
                        </button>
                      </div>

                      <div className="text-slate-600 font-sans font-bold">vs</div>

                      {/* Count 2 */}
                      <div className="px-2 py-1 rounded bg-purple-950/50 border border-purple-900/60 text-center">
                        <div className="text-[9px] uppercase text-purple-400 font-bold">Count 2 (Team B)</div>
                        <div className="font-bold text-purple-200 text-sm">{item.teamBTotalUnits} u</div>
                        <div className="text-[10px] text-slate-400">
                          {item.teamBCases} cs + {item.teamBSingles} ea
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickAccept(
                              item.itemId,
                              upc,
                              item.teamBCases,
                              item.teamBSingles,
                              item.teamBTotalUnits
                            )
                          }
                          className="mt-1 text-[10px] text-purple-300 hover:text-white underline font-sans"
                        >
                          Use B
                        </button>
                      </div>
                    </div>

                    {/* Verified Recount Input Steppers */}
                    <div className="flex items-center gap-3 bg-slate-950/90 p-2 rounded-xl border border-slate-700/80">
                      {/* Cases */}
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] text-slate-400 uppercase font-semibold">Cases ({upc} ea)</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                Math.max(0, currentRecount.cases - 1),
                                currentRecount.singles
                              )
                            }
                            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={currentRecount.cases}
                            onChange={(e) =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                Math.max(0, Number(e.target.value) || 0),
                                currentRecount.singles
                              )
                            }
                            className="w-12 text-center font-mono font-bold bg-slate-900 border border-slate-700 text-white rounded py-0.5 text-xs focus:ring-1 focus:ring-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                currentRecount.cases + 1,
                                currentRecount.singles
                              )
                            }
                            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Singles */}
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] text-slate-400 uppercase font-semibold">Singles</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                currentRecount.cases,
                                Math.max(0, currentRecount.singles - 1)
                              )
                            }
                            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={currentRecount.singles}
                            onChange={(e) =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                currentRecount.cases,
                                Math.max(0, Number(e.target.value) || 0)
                              )
                            }
                            className="w-12 text-center font-mono font-bold bg-slate-900 border border-slate-700 text-white rounded py-0.5 text-xs focus:ring-1 focus:ring-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdate(
                                item.itemId,
                                upc,
                                currentRecount.cases,
                                currentRecount.singles + 1
                              )
                            }
                            className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Total Recount & Resolution Button */}
                      <div className="flex flex-col items-center pl-2 border-l border-slate-800">
                        <span className="text-[9px] text-emerald-400 uppercase font-bold">Agreed Total</span>
                        <div className="font-mono font-extrabold text-emerald-400 text-sm">
                          {currentRecount.totalUnits} <span className="text-[10px] text-slate-400">u</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleResolved(item.itemId)}
                          className={`mt-1 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition ${
                            isResolved
                              ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-700'
                              : 'bg-rose-900/80 text-rose-200 border border-rose-700 hover:bg-emerald-900 hover:text-emerald-200'
                          }`}
                          title={isResolved ? 'Click to reopen discrepancy' : 'Click to confirm physical recount count'}
                        >
                          <Check className="w-2.5 h-2.5" />
                          {isResolved ? 'Resolved' : 'Verify'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-800/95 border-t border-slate-700/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <UserCheck className="w-4 h-4 text-slate-400" />
            <span>Recount Supervisor: <strong className="text-white">{recounterName}</strong></span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg flex items-center gap-2 transition"
            >
              <CheckCircle className="w-4 h-4" />
              Save Recount & Verify Segment ({resolvedCount}/{discrepancies.length} Resolved)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
