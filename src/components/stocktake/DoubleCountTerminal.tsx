import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useDeferredValue,
  useRef,
} from 'react';
import {
  Search,
  CheckCircle,
  Save,
  RotateCcw,
  ArrowLeft,
  Package,
  Boxes,
  Clock,
  Eye,
  EyeOff,
  Zap,
  KeyRound,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Lock,
  ShieldAlert,
  Pause,
  ArrowUpDown,
  Filter,
  Pencil,
  AlertTriangle,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  InventoryItem,
  Salesperson,
  TemporaryCasualAccount,
} from '../../types';
import {
  getInventoryItems,
  captureLiveInventoryFreeze,
  getFastMovingChecklist,
  authenticateCasualWorker,
  getTemporaryCasuals,
} from '../../db/roomDatabase';
import {
  resolveStocktakePersona,
  canClaimSegmentSlot,
  isCountingPhaseStatus,
  isDraftStocktakeStatus,
  isPausedStocktakeStatus,
} from '../../services/stocktakeAccessService';

const PAGE_SIZE = 50;
const DRAFT_DEBOUNCE_MS = 300;

interface DoubleCountTerminalProps {
  session: StocktakeSession;
  segment: StocktakeSegment;
  currentUser: Salesperson | null;
  initialCounterSlot?: 'A' | 'B';
  onSaveCount: (
    counterSlot: 'A' | 'B',
    lines: StocktakeLineCount[],
    counterStaffId: string,
    counterStaffName: string
  ) => void;
  onPaused?: (countedItems: number, segmentName: string, slot: 'A' | 'B') => void;
  onBack: () => void;
}

interface DoubleCountLineCardProps {
  line: StocktakeLineCount;
  isSlotFinalized: boolean;
  isSpotCheck: boolean;
  isDailyBlind: boolean;
  isBlindCounter: boolean;
  isFastMover: boolean;
  systemCases: number;
  systemSingles: number;
  systemTotalUnits: number;
  onUpdateQuantity: (
    itemId: string,
    casesDelta: number,
    singlesDelta: number,
    exactCases?: number,
    exactSingles?: number
  ) => void;
}

const DoubleCountLineCard: React.FC<DoubleCountLineCardProps> = React.memo(
  ({
    line,
    isSlotFinalized,
    isSpotCheck,
    isDailyBlind,
    isBlindCounter,
    isFastMover,
    systemCases,
    systemSingles,
    systemTotalUnits,
    onUpdateQuantity,
  }) => {
    const hasCount = line.totalUnits > 0 || Boolean(line.wasCounted);
    const upc = line.unitsPerCase || 1;

    return (
      <div
        className={`p-3.5 rounded-xl border transition ${
          hasCount
            ? 'bg-slate-800/90 border-blue-500/40 ring-1 ring-blue-500/20'
            : 'bg-slate-800/50 border-slate-700/60 hover:border-slate-600'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Item Description */}
          <div className="min-w-[260px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono font-medium text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700/60">
                {line.sku}
              </span>
              <span className="text-[11px] text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded">
                {line.category}
              </span>
              {hasCount && (
                <span className="text-[10px] text-emerald-300 bg-emerald-950/70 border border-emerald-700/60 px-1.5 py-0.5 rounded font-bold">
                  Counted
                </span>
              )}
              {isFastMover && (
                <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> Fast Mover
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-white mt-1">{line.itemName}</h3>
            <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-3">
              <span>
                Packaging: <strong className="text-slate-300">{upc} units/case</strong>
              </span>
              {line.barcode && (
                <span>
                  Barcode: <span className="font-mono">{line.barcode}</span>
                </span>
              )}
            </div>

            {/* Spot Check Visible System SOH */}
            {isSpotCheck && (
              <div className="mt-2 bg-slate-900/90 px-2.5 py-1.5 rounded-lg border border-slate-700/80 inline-flex items-center gap-3 text-xs">
                <span className="text-slate-400 flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  System SOH:
                </span>
                <span className="font-mono font-bold text-white">
                  {systemCases} cs / {systemSingles} ea ({systemTotalUnits} units)
                </span>
                {hasCount && (
                  <span
                    className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded ${
                      line.totalUnits - systemTotalUnits === 0
                        ? 'bg-slate-800 text-slate-300'
                        : line.totalUnits - systemTotalUnits < 0
                        ? 'bg-rose-950 text-rose-300'
                        : 'bg-emerald-950 text-emerald-300'
                    }`}
                  >
                    Var: {line.totalUnits - systemTotalUnits >= 0 ? '+' : ''}
                    {line.totalUnits - systemTotalUnits} u
                  </span>
                )}
              </div>
            )}

            {/* Daily Blind Active Freeze Timestamp & Variance (hidden from Blind Counters) */}
            {isDailyBlind && !isBlindCounter && line.frozenTimestamp && (
              <div className="mt-2 bg-amber-950/30 border border-amber-800/40 px-2.5 py-1.5 rounded-lg text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-amber-300 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-400" />
                    Frozen SOH at Count Time:
                  </span>
                  <span className="font-mono font-bold text-white">
                    {line.systemSOHAtCountTime ?? 0} units
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>Time: {new Date(line.frozenTimestamp).toLocaleTimeString()}</span>
                  <span
                    className={`font-mono font-bold ${
                      (line.varianceAtCountTime ?? 0) === 0
                        ? 'text-slate-300'
                        : (line.varianceAtCountTime ?? 0) < 0
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    Variance: {(line.varianceAtCountTime ?? 0) >= 0 ? '+' : ''}
                    {line.varianceAtCountTime ?? 0} units
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Quantity Controls: Cases & Singles */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Case Count Controller */}
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
                <span className="flex items-center gap-1">
                  <Boxes className="w-3 h-3 text-blue-400" />
                  Full Cases
                </span>
                <span className="text-slate-400">({upc} ea)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isSlotFinalized}
                  onClick={() => onUpdateQuantity(line.itemId, -1, 0)}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded flex items-center justify-center font-bold"
                >
                  -
                </button>
                <input
                  type="number"
                  min="0"
                  disabled={isSlotFinalized}
                  value={line.cases === 0 ? '' : line.cases}
                  onChange={(e) =>
                    onUpdateQuantity(
                      line.itemId,
                      0,
                      0,
                      Math.max(0, Number(e.target.value) || 0),
                      line.singles
                    )
                  }
                  placeholder="0"
                  className="w-14 text-center font-mono font-bold bg-slate-950 border border-slate-700 disabled:opacity-60 text-white rounded py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  disabled={isSlotFinalized}
                  onClick={() => onUpdateQuantity(line.itemId, 1, 0)}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded flex items-center justify-center font-bold"
                >
                  +
                </button>
                <button
                  type="button"
                  disabled={isSlotFinalized}
                  onClick={() => onUpdateQuantity(line.itemId, 5, 0)}
                  className="px-1.5 h-7 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-blue-300 rounded text-[11px] font-bold"
                >
                  +5
                </button>
              </div>
            </div>

            {/* Singles Count Controller */}
            <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3 text-emerald-400" />
                  Loose Singles
                </span>
                <span className="text-slate-400">(units)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isSlotFinalized}
                  onClick={() => onUpdateQuantity(line.itemId, 0, -1)}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded flex items-center justify-center font-bold"
                >
                  -
                </button>
                <input
                  type="number"
                  min="0"
                  disabled={isSlotFinalized}
                  value={line.singles === 0 ? '' : line.singles}
                  onChange={(e) =>
                    onUpdateQuantity(
                      line.itemId,
                      0,
                      0,
                      line.cases,
                      Math.max(0, Number(e.target.value) || 0)
                    )
                  }
                  placeholder="0"
                  className="w-14 text-center font-mono font-bold bg-slate-950 border border-slate-700 disabled:opacity-60 text-white rounded py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  disabled={isSlotFinalized}
                  onClick={() => onUpdateQuantity(line.itemId, 0, 1)}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded flex items-center justify-center font-bold"
                >
                  +
                </button>
                <button
                  type="button"
                  disabled={isSlotFinalized}
                  onClick={() => onUpdateQuantity(line.itemId, 0, 5)}
                  className="px-1.5 h-7 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-300 rounded text-[11px] font-bold"
                >
                  +5
                </button>
              </div>
            </div>

            {/* Total Calculated Units & Quick Reset */}
            <div className="flex items-center gap-3 bg-slate-950/90 px-3.5 py-2.5 rounded-lg border border-slate-700/60 min-w-[140px] justify-between">
              <div>
                <div className="text-[10px] uppercase font-semibold text-slate-400">
                  Total Base Units
                </div>
                <div className="text-base font-extrabold font-mono text-emerald-400">
                  {line.totalUnits}{' '}
                  <span className="text-xs font-normal text-slate-400">units</span>
                </div>
                {line.cases > 0 && (
                  <div className="text-[10px] font-mono text-slate-400">
                    {line.cases} cs × {upc} + {line.singles} ea
                  </div>
                )}
              </div>
              {line.totalUnits > 0 && !isSlotFinalized && (
                <button
                  type="button"
                  onClick={() => onUpdateQuantity(line.itemId, 0, 0, 0, 0)}
                  className="p-1 text-slate-500 hover:text-rose-400 transition"
                  title="Reset to 0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

DoubleCountLineCard.displayName = 'DoubleCountLineCard';

function buildZeroSeededCatalog(items: InventoryItem[]): StocktakeLineCount[] {
  return items.map((itm) => ({
    itemId: itm.itemId,
    itemName: itm.itemName,
    category: itm.category || 'General',
    sku: itm.sku || itm.itemId,
    barcode: itm.barcode,
    unitsPerCase: itm.unitsPerCase || 1,
    cases: 0,
    singles: 0,
    totalUnits: 0,
  }));
}

function mergeOverlayOntoCatalog(
  baseCatalog: StocktakeLineCount[],
  overlayLines: StocktakeLineCount[]
): StocktakeLineCount[] {
  if (!overlayLines || overlayLines.length === 0) return baseCatalog;
  const overlayMap = new Map<string, StocktakeLineCount>();
  overlayLines.forEach((l) => {
    if (l && l.itemId) {
      overlayMap.set(String(l.itemId).toUpperCase(), l);
    }
  });

  const seen = new Set<string>();
  const merged = baseCatalog.map((base) => {
    const key = String(base.itemId).toUpperCase();
    seen.add(key);
    const hit = overlayMap.get(key);
    if (!hit) return base;
    return {
      ...base,
      ...hit,
      unitsPerCase: hit.unitsPerCase || base.unitsPerCase || 1,
    };
  });

  // Preserve any items in overlay that are no longer in baseCatalog
  overlayLines.forEach((l) => {
    if (!l || !l.itemId) return;
    const key = String(l.itemId).toUpperCase();
    if (!seen.has(key)) {
      merged.push({ ...l });
      seen.add(key);
    }
  });

  return merged;
}

export const DoubleCountTerminal: React.FC<DoubleCountTerminalProps> = ({
  session,
  segment,
  currentUser,
  initialCounterSlot = 'A',
  onSaveCount,
  onPaused,
  onBack,
}) => {
  const [counterSlot, setCounterSlot] = useState<'A' | 'B'>(() => {
    if (currentUser?.assignedGroup === 'GROUP_1') return 'A';
    if (currentUser?.assignedGroup === 'GROUP_2') return 'B';
    return initialCounterSlot;
  });

  const isSlotFinalized = Boolean(
    segment.comparisonFinalized ||
      (counterSlot === 'A' ? segment.count1Finalized : segment.count2Finalized)
  );
  const isSessionCountable = isCountingPhaseStatus(session.status);
  const isReadOnlyLocked = isSlotFinalized || !isSessionCountable;

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [onlyFastMovers, setOnlyFastMovers] = useState<boolean>(
    session.countType === 'DAILY_BLIND'
  );
  // Counted-first auto-enabled when inspecting a finalized segment; toggleable anytime
  const [countedFirst, setCountedFirst] = useState<boolean>(() => isSlotFinalized);
  const [onlyCounted, setOnlyCounted] = useState<boolean>(false);

  // Progressive rendering window
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  // Counter identification
  const [counterStaffName, setCounterStaffName] = useState<string>(
    currentUser?.name || (counterSlot === 'A' ? 'Counter A' : 'Counter B')
  );
  const [counterStaffId, setCounterStaffId] = useState<string>(
    currentUser?.id || (counterSlot === 'A' ? '002' : '003')
  );
  const [counterPhone, setCounterPhone] = useState<string>(currentUser?.phone || '');
  const [activeCasual, setActiveCasual] = useState<TemporaryCasualAccount | null>(null);

  // Casual PIN login modal
  const [showCasualPinModal, setShowCasualPinModal] = useState<boolean>(false);
  const [selectedCasualId, setSelectedCasualId] = useState<string>('');
  const [casualPinInput, setCasualPinInput] = useState<string>('');
  const [casualPinError, setCasualPinError] = useState<string>('');

  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [lines, setLines] = useState<StocktakeLineCount[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Auto-save draft state
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<number | null>(null);
  const [draftRestoredMessage, setDraftRestoredMessage] = useState<string | null>(null);

  // Finalize confirmation modal + preview search
  const [confirmFinalizeOpen, setConfirmFinalizeOpen] = useState<boolean>(false);
  const [finalizeSearchQuery, setFinalizeSearchQuery] = useState<string>('');

  // Collapsible top header
  const [isHeaderExpanded, setIsHeaderExpanded] = useState<boolean>(true);

  // Refs for debounced sparse draft persistence & stable updateQuantity callback
  const draftTimerRef = useRef<number | null>(null);
  const latestLinesRef = useRef<StocktakeLineCount[]>([]);
  const latestSlotRef = useRef<'A' | 'B'>(counterSlot);
  const latestStaffRef = useRef({
    id: counterStaffId,
    name: counterStaffName,
    phone: counterPhone,
  });
  const isSlotFinalizedRef = useRef(isReadOnlyLocked);
  const submittedCleanlyRef = useRef(false);
  const dirtyDraftRef = useRef(false);

  latestLinesRef.current = lines;
  latestSlotRef.current = counterSlot;
  latestStaffRef.current = {
    id: counterStaffId,
    name: counterStaffName,
    phone: counterPhone,
  };
  isSlotFinalizedRef.current = isReadOnlyLocked;

  const persona = resolveStocktakePersona(currentUser, session);
  const isBlindCounter =
    persona === 'COUNTER' ||
    Boolean(currentUser?.isCasual || currentUser?.isVisitingCounter);
  const isGroupLocked = isBlindCounter && Boolean(currentUser?.assignedGroup);
  const isDailyBlind = session.countType === 'DAILY_BLIND';
  const isSpotCheck = session.countType === 'SPOT_CHECK' && !isBlindCounter;

  const actorStaffId = counterStaffId || currentUser?.id || '';
  const slotCheckA = canClaimSegmentSlot(segment, 'A', actorStaffId);
  const slotCheckB = canClaimSegmentSlot(segment, 'B', actorStaffId);

  const sessionCasuals = useMemo(
    () => getTemporaryCasuals(session.sessionId).filter((c) => c.active),
    [session.sessionId, showCasualPinModal]
  );

  // Keep Inspect mode defaulting to counted-first whenever entering a finalized slot
  useEffect(() => {
    if (isSlotFinalized) {
      setCountedFirst(true);
    }
  }, [isSlotFinalized, counterSlot]);

  // Helper to get local draft key
  const getDraftKey = useCallback(
    (slot: 'A' | 'B') =>
      `saimetric_stocktake_draft_${session.sessionId}_${segment.segmentId}_${slot}`,
    [session.sessionId, segment.segmentId]
  );

  // Sparse draft writer: stores ONLY counted lines (~2–15 KB instead of ~1 MB)
  const writeSparseDraftNow = useCallback(
    (linesToSave: StocktakeLineCount[], slot: 'A' | 'B') => {
      try {
        const countedOnly = linesToSave.filter(
          (l) => l.totalUnits > 0 || Boolean(l.wasCounted)
        );
        const key = getDraftKey(slot);
        if (countedOnly.length === 0) {
          localStorage.removeItem(key);
          setLastDraftSavedAt(null);
          dirtyDraftRef.current = false;
          return;
        }
        const now = Date.now();
        const payload = {
          format: 'sparse_v2',
          sessionId: session.sessionId,
          segmentId: segment.segmentId,
          slot,
          counterStaffId: latestStaffRef.current.id,
          counterStaffName: latestStaffRef.current.name,
          counterPhone: latestStaffRef.current.phone,
          lines: countedOnly,
          updatedAt: now,
        };
        localStorage.setItem(key, JSON.stringify(payload));
        setLastDraftSavedAt(now);
        dirtyDraftRef.current = false;
      } catch (e) {
        console.warn('[Stocktake Draft] Sparse auto-save failed:', e);
      }
    },
    [getDraftKey, session.sessionId, segment.segmentId]
  );

  // Debounced draft save during rapid button taps / typing
  const scheduleDraftSave = useCallback(
    (linesToSave: StocktakeLineCount[], slot: 'A' | 'B') => {
      dirtyDraftRef.current = true;
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
      }
      draftTimerRef.current = window.setTimeout(() => {
        draftTimerRef.current = null;
        writeSparseDraftNow(linesToSave, slot);
      }, DRAFT_DEBOUNCE_MS);
    },
    [writeSparseDraftNow]
  );

  // Immediate synchronous flush (used on Pause, slot switch, pagehide, unmount)
  const flushDraftImmediately = useCallback(
    (slotOverride?: 'A' | 'B') => {
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      if (isSlotFinalizedRef.current || submittedCleanlyRef.current) return;
      writeSparseDraftNow(latestLinesRef.current, slotOverride || latestSlotRef.current);
    },
    [writeSparseDraftNow]
  );

  // Helper to clear draft once officially submitted
  const clearDraftLocally = useCallback(
    (slot: 'A' | 'B') => {
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      dirtyDraftRef.current = false;
      try {
        localStorage.removeItem(getDraftKey(slot));
        setLastDraftSavedAt(null);
      } catch {}
    },
    [getDraftKey]
  );

  // Flush any pending debounced draft on tab hide / close / unmount
  useEffect(() => {
    const handlePageHide = () => {
      if (dirtyDraftRef.current) {
        flushDraftImmediately();
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      if (dirtyDraftRef.current && !submittedCleanlyRef.current && !isSlotFinalizedRef.current) {
        flushDraftImmediately();
      } else if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
      }
    };
  }, [flushDraftImmediately]);

  // Fast-moving checklist item IDs (merged with session-predefined Daily Blind SKUs)
  const fastMovingItemIds = useMemo(() => {
    const list = getFastMovingChecklist();
    const set = new Set(list.map((i) => i.itemId.toUpperCase()));
    if (Array.isArray(session.predefinedDailyItemIds)) {
      session.predefinedDailyItemIds.forEach((id) =>
        set.add(String(id).toUpperCase())
      );
    }
    return set;
  }, [session.predefinedDailyItemIds]);

  // Map of inventory item by ID for O(1) lookup (also kept in ref for stable updateQuantity)
  const inventoryItemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    inventoryList.forEach((i) => map.set(i.itemId.toUpperCase(), i));
    return map;
  }, [inventoryList]);
  const inventoryItemMapRef = useRef(inventoryItemMap);
  inventoryItemMapRef.current = inventoryItemMap;

  // Load catalog products & hydrate lines for active slot (supports sparse_v2 & legacy full-array drafts)
  useEffect(() => {
    submittedCleanlyRef.current = false;
    dirtyDraftRef.current = false;
    const items = getInventoryItems();
    setInventoryList(items);

    const baseCatalog = buildZeroSeededCatalog(items);
    const existing = counterSlot === 'A' ? segment.count1 : segment.count2;
    const slotFinalizedNow = Boolean(
      segment.comparisonFinalized ||
        (counterSlot === 'A' ? segment.count1Finalized : segment.count2Finalized)
    );

    let loadedFromDraft = false;
    if (!slotFinalizedNow) {
      try {
        const rawDraft = localStorage.getItem(getDraftKey(counterSlot));
        if (rawDraft) {
          const parsed = JSON.parse(rawDraft);
          if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
            const countedLines = parsed.lines.filter(
              (l: any) => (Number(l?.totalUnits) || 0) > 0 || Boolean(l?.wasCounted)
            );
            if (countedLines.length > 0) {
              // Merge saved segment lines first, then overlay local draft counted lines on top
              const withExisting =
                existing && existing.length > 0
                  ? mergeOverlayOntoCatalog(baseCatalog, existing)
                  : baseCatalog;
              const merged = mergeOverlayOntoCatalog(withExisting, countedLines);
              setLines(merged);
              if (parsed.counterStaffName) setCounterStaffName(parsed.counterStaffName);
              if (parsed.counterStaffId) setCounterStaffId(parsed.counterStaffId);
              if (parsed.counterPhone) setCounterPhone(parsed.counterPhone);
              setLastDraftSavedAt(parsed.updatedAt || Date.now());
              setDraftRestoredMessage(
                `Draft Restored: Recovered ${countedLines.length} in-progress count item(s) from auto-save (${new Date(
                  parsed.updatedAt || Date.now()
                ).toLocaleTimeString()}).`
              );
              setTimeout(() => setDraftRestoredMessage(null), 6000);
              loadedFromDraft = true;
            }
          }
        }
      } catch (e) {
        console.warn('[Draft] Failed to read draft:', e);
      }
    }

    if (!loadedFromDraft) {
      setLastDraftSavedAt(null);
      if (existing && existing.length > 0) {
        setLines(mergeOverlayOntoCatalog(baseCatalog, existing));
      } else {
        setLines(baseCatalog);
      }
    }
    setVisibleCount(PAGE_SIZE);
  }, [segment, counterSlot, session.sessionId, getDraftKey]);

  // Collapse upper header on scroll down to give counter maximum vertical screen space
  useEffect(() => {
    let lastScrollY = window.scrollY;
    const onScroll = () => {
      const currentY = window.scrollY;
      if (currentY > 80 && currentY > lastScrollY) {
        setIsHeaderExpanded(false);
      }
      lastScrollY = currentY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Handle counter slot change (flush current slot draft cleanly first)
  const handleSlotChange = (newSlot: 'A' | 'B') => {
    if (newSlot === counterSlot) return;
    if (!isSlotFinalized && dirtyDraftRef.current) {
      flushDraftImmediately(counterSlot);
    }
    setCounterSlot(newSlot);
  };

  // Categories for filter
  const categories = useMemo(() => {
    const set = new Set<string>();
    inventoryList.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return ['ALL', ...Array.from(set)];
  }, [inventoryList]);

  // Precomputed lowercase search index (built once per catalog load, not on every keystroke)
  const searchIndexMap = useMemo(() => {
    const map = new Map<string, string>();
    lines.forEach((l) => {
      const key = String(l.itemId).toUpperCase();
      if (!map.has(key)) {
        map.set(
          key,
          `${l.itemName || ''} ${l.sku || ''} ${l.barcode || ''} ${l.category || ''}`.toLowerCase()
        );
      }
    });
    return map;
  }, [lines.length, segment.segmentId, counterSlot]);

  // Casual PIN authentication handler
  const handleCasualPinLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setCasualPinError('');
    const found = authenticateCasualWorker(
      casualPinInput,
      selectedCasualId || undefined
    );
    if (found) {
      setActiveCasual(found);
      setCounterStaffName(found.name);
      setCounterStaffId(found.id);
      setCounterPhone(found.phone);
      if (found.assignedGroup === 'GROUP_1') handleSlotChange('A');
      if (found.assignedGroup === 'GROUP_2') handleSlotChange('B');
      setShowCasualPinModal(false);
      setCasualPinInput('');
    } else {
      setCasualPinError(
        'Invalid 4-digit Casual PIN. Select your name and verify with supervisor.'
      );
    }
  };

  // Stable quantity update callback (fast O(1) SOH lookup unless DAILY_BLIND active trading freeze)
  const updateQuantity = useCallback(
    (
      itemId: string,
      casesDelta: number,
      singlesDelta: number,
      exactCases?: number,
      exactSingles?: number
    ) => {
      if (isSlotFinalizedRef.current) return;
      const upperTarget = itemId.toUpperCase();
      const nowIso = new Date().toISOString();

      let frozenSystemUnits: number;
      let frozenTimestamp: string;
      if (isDailyBlind) {
        const freezeSnapshot = captureLiveInventoryFreeze(itemId, session.branchId);
        frozenSystemUnits = freezeSnapshot.frozenSystemUnits;
        frozenTimestamp = freezeSnapshot.frozenTimestamp;
      } else {
        const cached = inventoryItemMapRef.current.get(upperTarget);
        frozenSystemUnits = cached?.totalUnits ?? 0;
        frozenTimestamp = nowIso;
      }

      setLines((prev) => {
        const idx = prev.findIndex((l) => l.itemId.toUpperCase() === upperTarget);
        if (idx === -1) return prev;
        const l = prev[idx];
        const upc = Math.max(1, l.unitsPerCase || 1);
        const newCases =
          exactCases !== undefined ? Math.max(0, exactCases) : Math.max(0, l.cases + casesDelta);
        const newSingles =
          exactSingles !== undefined
            ? Math.max(0, exactSingles)
            : Math.max(0, l.singles + singlesDelta);
        const totalUnits = newCases * upc + newSingles;
        const isResetToZero = exactCases === 0 && exactSingles === 0 && totalUnits === 0;

        const nextLine: StocktakeLineCount = {
          ...l,
          cases: newCases,
          singles: newSingles,
          totalUnits,
          wasCounted: !isResetToZero,
          countedBy: latestStaffRef.current.id,
          countedByName: latestStaffRef.current.name,
          counterPhone: latestStaffRef.current.phone || undefined,
          timestamp: nowIso,
          systemSOHAtCountTime: frozenSystemUnits,
          frozenTimestamp,
          varianceAtCountTime: totalUnits - frozenSystemUnits,
        };

        const updated = prev.slice();
        updated[idx] = nextLine;

        // Debounced sparse draft auto-save (300ms) so UI remains 60fps
        scheduleDraftSave(updated, latestSlotRef.current);
        return updated;
      });
    },
    [isDailyBlind, session.branchId, scheduleDraftSave]
  );

  // Memoized KPI summary + counted lines list (single pass)
  const {
    countedLines,
    countedItemsCount,
    totalCountedCases,
    totalCountedSingles,
    totalCountedUnits,
  } = useMemo(() => {
    const counted: StocktakeLineCount[] = [];
    let casesSum = 0;
    let singlesSum = 0;
    let unitsSum = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.totalUnits > 0 || l.wasCounted) {
        counted.push(l);
      }
      casesSum += l.cases;
      singlesSum += l.singles;
      unitsSum += l.totalUnits;
    }
    // Sort preview list: highest base units first, then alphabetical
    counted.sort((a, b) => {
      if (b.totalUnits !== a.totalUnits) return b.totalUnits - a.totalUnits;
      return (a.itemName || '').localeCompare(b.itemName || '');
    });
    return {
      countedLines: counted,
      countedItemsCount: counted.length,
      totalCountedCases: casesSum,
      totalCountedSingles: singlesSum,
      totalCountedUnits: unitsSum,
    };
  }, [lines]);

  // Filtered & optionally Counted-First sorted list (uses deferred search query)
  const filteredLines = useMemo(() => {
    const q = (deferredSearchQuery || '').trim().toLowerCase();
    const cat = (selectedCategory || '').toLowerCase();

    const matched = lines.filter((l) => {
      if (onlyCounted && !(l.totalUnits > 0 || l.wasCounted)) return false;
      if (selectedCategory !== 'ALL' && (l.category || '').toLowerCase() !== cat) {
        return false;
      }
      if (onlyFastMovers && !fastMovingItemIds.has(l.itemId.toUpperCase())) {
        return false;
      }
      if (q !== '') {
        const indexed = searchIndexMap.get(l.itemId.toUpperCase());
        if (indexed) {
          if (!indexed.includes(q)) return false;
        } else {
          const fallback = `${l.itemName || ''} ${l.sku || ''} ${l.barcode || ''}`.toLowerCase();
          if (!fallback.includes(q)) return false;
        }
      }
      return true;
    });

    if (countedFirst) {
      matched.sort((a, b) => {
        const aCounted = a.totalUnits > 0 || Boolean(a.wasCounted) ? 1 : 0;
        const bCounted = b.totalUnits > 0 || Boolean(b.wasCounted) ? 1 : 0;
        if (bCounted !== aCounted) return bCounted - aCounted;
        if (aCounted === 1 && b.totalUnits !== a.totalUnits) {
          return b.totalUnits - a.totalUnits;
        }
        return (a.itemName || '').localeCompare(b.itemName || '');
      });
    }

    return matched;
  }, [
    lines,
    deferredSearchQuery,
    selectedCategory,
    onlyFastMovers,
    onlyCounted,
    countedFirst,
    fastMovingItemIds,
    searchIndexMap,
  ]);

  // Reset pagination window whenever filters or search change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [deferredSearchQuery, selectedCategory, onlyFastMovers, onlyCounted, countedFirst, counterSlot]);

  // IntersectionObserver for smooth progressive loading as user scrolls
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    if (visibleCount >= filteredLines.length) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((prev) => Math.min(filteredLines.length, prev + PAGE_SIZE));
        }
      },
      { rootMargin: '320px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filteredLines.length]);

  const visibleLines = useMemo(
    () => filteredLines.slice(0, visibleCount),
    [filteredLines, visibleCount]
  );

  // Filtered counted items inside the Finalize Confirmation preview modal
  const filteredPreviewLines = useMemo(() => {
    const q = finalizeSearchQuery.trim().toLowerCase();
    if (!q) return countedLines;
    return countedLines.filter(
      (l) =>
        (l.itemName || '').toLowerCase().includes(q) ||
        (l.sku || '').toLowerCase().includes(q) ||
        (l.barcode || '').toLowerCase().includes(q)
    );
  }, [countedLines, finalizeSearchQuery]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isReadOnlyLocked) return;
    submittedCleanlyRef.current = true;
    onSaveCount(counterSlot, lines, counterStaffId, counterStaffName);
    clearDraftLocally(counterSlot);
    setConfirmFinalizeOpen(false);
    setFinalizeSearchQuery('');
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handlePauseAndExit = () => {
    if (!isSlotFinalized) {
      flushDraftImmediately(counterSlot);
      if (onPaused) {
        onPaused(countedItemsCount, segment.name, counterSlot);
        return;
      }
    }
    onBack();
  };

  const handleEditFromFinalizePreview = (line: StocktakeLineCount) => {
    setConfirmFinalizeOpen(false);
    setFinalizeSearchQuery('');
    setSelectedCategory('ALL');
    setOnlyFastMovers(false);
    setOnlyCounted(false);
    setSearchQuery(line.sku || line.itemName);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="bg-slate-900 text-slate-100 min-h-screen flex flex-col">
      {/* RESTORED DRAFT BANNER NOTIFICATION */}
      {draftRestoredMessage && (
        <div className="bg-blue-900/90 text-blue-100 border-b border-blue-600 px-4 py-2.5 text-xs font-semibold flex items-center justify-between z-50 animate-fadeIn">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-300 animate-spin-slow" />
            <span>{draftRestoredMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setDraftRestoredMessage(null)}
            className="text-blue-300 hover:text-white text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* FROZEN STICKY TOP BAR: Pinned at top with Search & Primary Actions */}
      <div className="sticky top-0 z-40 bg-slate-900/95 border-b border-slate-700/90 backdrop-blur-md shadow-xl transition-all">
        {/* Row 1: Frozen Search + Core Actions (Always Visible on Screen) */}
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2">
          {/* Left: Back & Location Identifier */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePauseAndExit}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title={isSlotFinalized ? 'Back to Segments' : 'Pause & Exit (Draft is auto-saved)'}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono font-bold uppercase text-blue-400 bg-blue-950/90 border border-blue-800/80 px-2 py-0.5 rounded">
                {segment.locationCode || segment.segmentId}
              </span>
              <span className="text-xs font-bold text-white max-w-[140px] sm:max-w-[200px] truncate">
                {segment.name}
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  counterSlot === 'A'
                    ? 'bg-blue-900/80 text-blue-300 border border-blue-700'
                    : 'bg-purple-900/80 text-purple-300 border border-purple-700'
                }`}
              >
                Team {counterSlot}
              </span>
              {isSlotFinalized && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Finalized
                </span>
              )}
            </div>
          </div>

          {/* Center: Frozen Search Box (Sticky & Always Accessible) */}
          <div className="flex-1 min-w-[200px] max-w-xl relative">
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

          {/* Right: Auto-Save Status, Explicit Pause Button, Finalize Button, and Header Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Live Auto-Save Indicator */}
            {lastDraftSavedAt && !isSlotFinalized && (
              <div
                className="hidden lg:flex items-center gap-1.5 text-[11px] text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded"
                title="Every line count is auto-saved as a local draft continuously"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  Saved{' '}
                  {new Date(lastDraftSavedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}

            {/* Explicit Pause Button in Top Sticky Bar */}
            {!isReadOnlyLocked && (
              <button
                type="button"
                onClick={handlePauseAndExit}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-950/80 hover:bg-amber-900/90 text-amber-200 border border-amber-700/80 flex items-center gap-1.5 transition shadow-sm"
                title="Save your progress on this device and safely leave this segment to resume later"
              >
                <Pause className="w-3.5 h-3.5 text-amber-400" />
                <span>Pause</span>
              </button>
            )}

            {/* Finalize Count Submit Button */}
            <button
              type="button"
              disabled={isReadOnlyLocked}
              onClick={() => {
                setFinalizeSearchQuery('');
                setConfirmFinalizeOpen(true);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md transition disabled:opacity-45 disabled:cursor-not-allowed ${
                counterSlot === 'A'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
            >
              {isReadOnlyLocked ? <Lock className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              <span>
                {!isSessionCountable
                  ? isPausedStocktakeStatus(session.status)
                    ? 'Session Paused'
                    : isDraftStocktakeStatus(session.status)
                    ? 'Draft (Not Activated)'
                    : 'Session Closed'
                  : isSlotFinalized
                  ? `Count ${counterSlot} Finalized`
                  : `Finalize Count ${counterSlot}`}
              </span>
            </button>

            {/* Dropdown Toggle */}
            <button
              type="button"
              onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1"
              title={
                isHeaderExpanded
                  ? 'Hide top controls to maximize counting screen'
                  : 'Show top controls & category filters'
              }
            >
              {isHeaderExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              <span className="hidden sm:inline text-[10px] font-medium text-slate-400">
                {isHeaderExpanded ? 'Collapse' : 'Details'}
              </span>
            </button>
          </div>
        </div>

        {/* Collapsible Panel */}
        {isHeaderExpanded && (
          <div className="border-t border-slate-800/90 bg-slate-900/90 px-3 sm:px-4 py-2.5 space-y-2 animate-fadeIn">
            {/* Metadata & Controls Row */}
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {/* Casual PIN login */}
                <button
                  type="button"
                  onClick={() => setShowCasualPinModal(true)}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 flex items-center gap-1.5 transition"
                  title="Login with Casual Worker 4-Digit PIN"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  {activeCasual ? (
                    <span>
                      Casual: <strong>{activeCasual.name}</strong>
                    </span>
                  ) : (
                    <span>Casual PIN Login</span>
                  )}
                </button>

                {/* Counter Slot Switcher */}
                <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-700">
                  <button
                    type="button"
                    disabled={
                      (isGroupLocked && currentUser?.assignedGroup !== 'GROUP_1') ||
                      (counterSlot !== 'A' &&
                        !slotCheckA.allowed &&
                        Boolean(
                          segment.counterBId &&
                            String(segment.counterBId).toUpperCase() ===
                              actorStaffId.toUpperCase()
                        ))
                    }
                    title={
                      !slotCheckA.allowed &&
                      segment.counterBId &&
                      String(segment.counterBId).toUpperCase() === actorStaffId.toUpperCase()
                        ? slotCheckA.reason
                        : 'Switch to Count 1 (Team A)'
                    }
                    onClick={() => handleSlotChange('A')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      counterSlot === 'A'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Count 1 (Team A) {segment.count1Finalized ? '🔒' : ''}
                  </button>
                  <button
                    type="button"
                    disabled={
                      (isGroupLocked && currentUser?.assignedGroup !== 'GROUP_2') ||
                      (counterSlot !== 'B' &&
                        !slotCheckB.allowed &&
                        Boolean(
                          segment.counterAId &&
                            String(segment.counterAId).toUpperCase() ===
                              actorStaffId.toUpperCase()
                        ))
                    }
                    title={
                      !slotCheckB.allowed &&
                      segment.counterAId &&
                      String(segment.counterAId).toUpperCase() === actorStaffId.toUpperCase()
                        ? slotCheckB.reason
                        : 'Switch to Count 2 (Team B)'
                    }
                    onClick={() => handleSlotChange('B')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      counterSlot === 'B'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Count 2 (Team B) {segment.count2Finalized ? '🔒' : ''}
                  </button>
                </div>

                {/* Category Filter */}
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c === 'ALL' ? 'All Categories' : c}
                    </option>
                  ))}
                </select>

                {/* Fast Movers Filter */}
                <button
                  type="button"
                  onClick={() => setOnlyFastMovers(!onlyFastMovers)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition ${
                    onlyFastMovers
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Zap className="w-3 h-3" />
                  Fast Movers ({fastMovingItemIds.size})
                </button>

                {/* Counted Only Toggle */}
                <button
                  type="button"
                  onClick={() => setOnlyCounted(!onlyCounted)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition ${
                    onlyCounted
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Filter className="w-3 h-3" />
                  Counted Only ({countedItemsCount})
                </button>

                {/* Counted First Sort Toggle (Auto-ON in Inspect Mode) */}
                <button
                  type="button"
                  onClick={() => setCountedFirst(!countedFirst)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 transition ${
                    countedFirst
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="Pin items with recorded counts to the top of the list"
                >
                  <ArrowUpDown className="w-3 h-3" />
                  Counted First
                </button>
              </div>

              {/* Progress & Counter Info */}
              <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                <span>
                  Counter: <strong className="text-white">{counterStaffName}</strong>
                </span>
                <span>•</span>
                <span>
                  Counted:{' '}
                  <strong className="text-emerald-400 font-bold">
                    {countedItemsCount}/{lines.length}
                  </strong>{' '}
                  SKUs ({totalCountedUnits} units)
                </span>
              </div>
            </div>

            {/* Mode alerts if applicable (never leak live SOH to blind counters) */}
            {isDailyBlind && !isBlindCounter && (
              <div className="max-w-7xl mx-auto bg-amber-950/30 border border-amber-800/40 px-3 py-1.5 rounded-lg text-xs text-amber-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>
                    <strong>Active Trading Freeze Active:</strong> System logs live SOH and variance at count time as tills sell.
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-300">Armed</span>
              </div>
            )}
            {isBlindCounter && (
              <div className="max-w-7xl mx-auto bg-blue-950/40 border border-blue-800/50 px-3 py-1.5 rounded-lg text-xs text-blue-200 flex items-center gap-2">
                <EyeOff className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>
                  <strong>True Blind Count Mode:</strong> System Stock-On-Hand and financial values are hidden for independent physical accuracy.
                </span>
              </div>
            )}
            {isSpotCheck && (
              <div className="max-w-7xl mx-auto bg-emerald-950/30 border border-emerald-800/40 px-3 py-1.5 rounded-lg text-xs text-emerald-200 flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  <strong>Spot Check Mode:</strong> Live system stock is shown beside your physical count input for immediate verification.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {savedSuccess && (
        <div className="bg-emerald-900/90 text-emerald-100 border-b border-emerald-700 px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-300" />
          Counter {counterSlot} count finalized and locked in system!
        </div>
      )}

      {!isSessionCountable && (
        <div className="bg-rose-950/90 text-rose-100 border-b border-rose-700/80 px-4 py-2.5 text-xs font-semibold flex flex-wrap items-center justify-center gap-2">
          <Lock className="w-4 h-4 text-rose-400 shrink-0" />
          <span>
            {isDraftStocktakeStatus(session.status)
              ? 'Counting Locked: This stocktake is still in DRAFT. Wait for the Auditor or Manager to activate it.'
              : isPausedStocktakeStatus(session.status)
              ? `Counting Paused by ${session.pausedByName || 'Auditor'}${session.pauseReason ? ` — "${session.pauseReason}"` : ''}. Quantity edits are locked until resumed.`
              : 'Counting Locked: This stocktake session is closed/archived and read-only.'}
          </span>
        </div>
      )}

      {isSlotFinalized && isSessionCountable && (
        <div className="bg-amber-950/90 text-amber-100 border-b border-amber-700/80 px-4 py-2.5 text-xs font-semibold flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Inspecting Finalized Count {counterSlot} (Locked) — {countedItemsCount} counted item(s) pinned at the top.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOnlyCounted(!onlyCounted)}
            className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-900/80 hover:bg-amber-800 text-amber-100 border border-amber-600/80 transition"
          >
            {onlyCounted
              ? `Show Full Catalog (${lines.length})`
              : `Show Counted Only (${countedItemsCount})`}
          </button>
        </div>
      )}

      {/* Main Counting Matrix (Windowed / Progressive Rendering for Instant Load & Search) */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4">
        <div className="space-y-3">
          {visibleLines.map((line) => {
            const upperKey = line.itemId.toUpperCase();
            const masterItem = inventoryItemMap.get(upperKey);
            return (
              <DoubleCountLineCard
                key={line.itemId}
                line={line}
                isSlotFinalized={isReadOnlyLocked}
                isSpotCheck={isSpotCheck}
                isDailyBlind={isDailyBlind}
                isBlindCounter={isBlindCounter}
                isFastMover={fastMovingItemIds.has(upperKey)}
                systemCases={masterItem?.stockCases ?? 0}
                systemSingles={masterItem?.stockSingles ?? 0}
                systemTotalUnits={masterItem?.totalUnits ?? 0}
                onUpdateQuantity={updateQuantity}
              />
            );
          })}

          {/* Progressive Load Sentinel & Manual Controls */}
          {visibleCount < filteredLines.length && (
            <div
              ref={loadMoreSentinelRef}
              className="py-4 flex flex-col sm:flex-row items-center justify-center gap-3 bg-slate-800/40 rounded-xl border border-slate-800 text-xs text-slate-400"
            >
              <span>
                Showing <strong className="text-white font-mono">{visibleLines.length}</strong> of{' '}
                <strong className="text-white font-mono">{filteredLines.length}</strong> matching products
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((prev) => Math.min(filteredLines.length, prev + PAGE_SIZE))
                  }
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 transition"
                >
                  Load {Math.min(PAGE_SIZE, filteredLines.length - visibleCount)} More
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredLines.length)}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-blue-300 font-semibold border border-slate-700 transition"
                >
                  Show All ({filteredLines.length})
                </button>
              </div>
            </div>
          )}

          {filteredLines.length === 0 && (
            <div className="text-center py-12 bg-slate-800/40 rounded-xl border border-slate-800">
              <Package className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-50" />
              <p className="text-sm text-slate-400">
                No products match your search query or active filters.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {onlyCounted && (
                  <button
                    type="button"
                    onClick={() => setOnlyCounted(false)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  >
                    Show All Products
                  </button>
                )}
                {onlyFastMovers && (
                  <button
                    type="button"
                    onClick={() => setOnlyFastMovers(false)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold"
                  >
                    Clear Fast Movers Filter
                  </button>
                )}
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-semibold"
                  >
                    Clear Search
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Floating Bottom Sticky Bar */}
      <footer className="bg-slate-800/95 border-t border-slate-700/80 px-4 py-3 sticky bottom-0 z-30 backdrop-blur">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-slate-300">
            <span>
              Counter Slot: <strong className="text-white">Count {counterSlot}</strong>
            </span>
            <span>
              Progress:{' '}
              <strong className="text-emerald-400 font-mono">{countedItemsCount}</strong> of{' '}
              <span className="text-slate-400">{lines.length} products counted</span>
            </span>
            <span className="hidden sm:inline">
              Total Units:{' '}
              <strong className="text-blue-400 font-mono">{totalCountedUnits}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePauseAndExit}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-950/80 border border-amber-700/80 text-amber-200 hover:bg-amber-900/90 flex items-center gap-1.5 transition"
            >
              {isSlotFinalized ? (
                <>
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Segments</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5 text-amber-400" />
                  <span>Pause & Save Draft</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={isSlotFinalized}
              onClick={() => {
                setFinalizeSearchQuery('');
                setConfirmFinalizeOpen(true);
              }}
              className={`px-5 py-2 rounded-lg text-sm font-bold shadow-lg flex items-center gap-2 transition disabled:opacity-45 disabled:cursor-not-allowed ${
                counterSlot === 'A'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
            >
              {isSlotFinalized ? <Lock className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {isSlotFinalized
                ? `Count ${counterSlot} Finalized & Locked`
                : `Finalize Count ${counterSlot}`}
            </button>
          </div>
        </div>
      </footer>

      {/* Irreversible Finalize Confirmation Modal WITH Counted Items + Base Units Verification Preview */}
      {confirmFinalizeOpen && !isSlotFinalized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-amber-600/60 rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-800/90 border-b border-slate-700 flex items-start gap-3 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-white">
                  Review & Finalize Count {counterSlot} Permanently?
                </h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Verify every counted item and its <strong>Total Base Units</strong> below to make sure nothing was missed or mistyped. Once finalized, counts lock immediately.
                </p>
              </div>
            </div>

            {/* Summary KPI Strip */}
            <div className="px-6 py-3 bg-slate-950/80 border-b border-slate-800 grid grid-cols-3 gap-3 shrink-0">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2">
                <div className="text-[10px] uppercase font-semibold text-slate-400">Segment</div>
                <div className="text-xs font-bold text-white truncate mt-0.5">{segment.name}</div>
                <div className="text-[11px] font-mono text-emerald-400 mt-0.5">
                  {countedItemsCount} / {lines.length} SKUs counted
                </div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2">
                <div className="text-[10px] uppercase font-semibold text-slate-400">
                  Cases / Singles
                </div>
                <div className="text-sm font-bold font-mono text-white mt-0.5">
                  {totalCountedCases} cs + {totalCountedSingles} ea
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Count {counterSlot} physical tally</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2">
                <div className="text-[10px] uppercase font-semibold text-slate-400">
                  Total Base Units
                </div>
                <div className="text-base font-extrabold font-mono text-emerald-400 mt-0.5">
                  {totalCountedUnits} units
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Blind verification preview</div>
              </div>
            </div>

            {/* Counted Items Verification Preview Body */}
            <div className="flex-1 min-h-0 flex flex-col px-6 py-4 gap-3 overflow-hidden">
              {countedLines.length === 0 ? (
                <div className="bg-amber-950/50 border border-amber-700/70 rounded-xl p-4 text-xs text-amber-200 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-amber-100 block font-bold mb-0.5">
                      No Items Counted Yet (0 SKUs)
                    </strong>
                    You have not recorded any quantities in this segment. Go back to enter counts unless this segment is genuinely empty.
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                    <div className="text-xs font-semibold text-slate-200">
                      Counted Items Verification List ({countedLines.length})
                    </div>
                    {countedLines.length > 5 && (
                      <div className="relative flex-1 min-w-[180px] max-w-xs">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={finalizeSearchQuery}
                          onChange={(e) => setFinalizeSearchQuery(e.target.value)}
                          placeholder="Check if item was counted..."
                          className="w-full pl-8 pr-7 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        {finalizeSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setFinalizeSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/70 divide-y divide-slate-800/80">
                    {filteredPreviewLines.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No counted item matches &ldquo;{finalizeSearchQuery}&rdquo;. If you expected it here, click <strong>Go Back & Edit</strong> to count it.
                      </div>
                    ) : (
                      filteredPreviewLines.map((line) => {
                        const upc = Math.max(1, line.unitsPerCase || 1);
                        return (
                          <div
                            key={line.itemId}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-900/70 transition"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-white truncate">
                                {line.itemName}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono flex flex-wrap items-center gap-2 mt-0.5">
                                <span>{line.sku}</span>
                                <span>•</span>
                                <span>
                                  {line.cases} cs ({upc}/cs) + {line.singles} ea
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <div className="text-right">
                                <div className="text-sm font-extrabold font-mono text-emerald-400">
                                  {line.totalUnits}{' '}
                                  <span className="text-[10px] font-normal text-slate-400">
                                    units
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500">Base Units</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleEditFromFinalizePreview(line)}
                                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 transition"
                                title="Jump back to edit this item"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-800/90 border-t border-slate-700 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setConfirmFinalizeOpen(false);
                  setFinalizeSearchQuery('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-200 transition"
              >
                Go Back & Edit
              </button>
              <button
                type="button"
                onClick={() => handleSubmit()}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg flex items-center gap-1.5 transition"
              >
                <Lock className="w-3.5 h-3.5" />
                Yes, Finalize & Lock Count {counterSlot}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Casual Worker 4-Digit PIN Modal */}
      {showCasualPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Casual Worker PIN Login</h3>
                  <p className="text-[11px] text-slate-400">4-digit device authentication</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCasualPinModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCasualPinLogin} className="space-y-3.5">
              {sessionCasuals.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Select Casual Worker Profile *
                  </label>
                  <select
                    value={selectedCasualId}
                    onChange={(e) => setSelectedCasualId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">-- Any Matching PIN --</option>
                    {sessionCasuals.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.badgeNumber || c.id}) •{' '}
                        {c.assignedGroup === 'GROUP_1' ? 'Team A' : 'Team B'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Enter 4-Digit Security PIN *
                </label>
                <input
                  type="password"
                  maxLength={6}
                  autoFocus
                  required
                  value={casualPinInput}
                  onChange={(e) => setCasualPinInput(e.target.value)}
                  placeholder="e.g. 5521"
                  className="w-full text-center tracking-widest text-lg font-mono px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                {casualPinError && (
                  <p className="text-xs text-rose-400 mt-1 font-medium">{casualPinError}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Casual worker accounts are created by supervisors for stocktakes with name and phone number for accountability.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCasualPinModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg"
                >
                  Verify & Log In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
