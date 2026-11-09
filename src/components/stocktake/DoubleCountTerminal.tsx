import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Barcode,
  Layers,
  Plus,
  Minus,
  CheckCircle,
  AlertCircle,
  Save,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  UserCheck,
  Package,
  Boxes,
  HelpCircle,
  Trash2,
  Clock,
  Eye,
  EyeOff,
  Zap,
  KeyRound,
  Shield,
  Phone,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  RefreshCw,
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
  onBack: () => void;
}

export const DoubleCountTerminal: React.FC<DoubleCountTerminalProps> = ({
  session,
  segment,
  currentUser,
  initialCounterSlot = 'A',
  onSaveCount,
  onBack,
}) => {
  const [counterSlot, setCounterSlot] = useState<'A' | 'B'>(initialCounterSlot);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [onlyFastMovers, setOnlyFastMovers] = useState<boolean>(
    session.countType === 'DAILY_BLIND'
  );

  // Counter identification
  const [counterStaffName, setCounterStaffName] = useState<string>(
    currentUser?.name || (counterSlot === 'A' ? 'Counter A' : 'Counter B')
  );
  const [counterStaffId, setCounterStaffId] = useState<string>(
    currentUser?.id || (counterSlot === 'A' ? '002' : '003')
  );
  const [counterPhone, setCounterPhone] = useState<string>('');
  const [activeCasual, setActiveCasual] = useState<TemporaryCasualAccount | null>(null);

  // Casual PIN login modal
  const [showCasualPinModal, setShowCasualPinModal] = useState<boolean>(false);
  const [casualPinInput, setCasualPinInput] = useState<string>('');
  const [casualPinError, setCasualPinError] = useState<string>('');

  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [lines, setLines] = useState<StocktakeLineCount[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Auto-save draft state
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<number | null>(null);
  const [draftRestoredMessage, setDraftRestoredMessage] = useState<string | null>(null);

  // Collapsible top header (sticky search stays frozen at top; extra header section collapses to maximize screen)
  const [isHeaderExpanded, setIsHeaderExpanded] = useState<boolean>(true);

  const isDailyBlind = session.countType === 'DAILY_BLIND';
  const isSpotCheck = session.countType === 'SPOT_CHECK';

  // Helper to get local draft key
  const getDraftKey = (slot: 'A' | 'B') =>
    `saimetric_stocktake_draft_${session.sessionId}_${segment.segmentId}_${slot}`;

  // Helper to persist draft continuously
  const saveDraftLocally = (linesToSave: StocktakeLineCount[], slot: 'A' | 'B') => {
    try {
      const payload = {
        sessionId: session.sessionId,
        segmentId: segment.segmentId,
        slot,
        counterStaffId,
        counterStaffName,
        counterPhone,
        lines: linesToSave,
        updatedAt: Date.now(),
      };
      localStorage.setItem(getDraftKey(slot), JSON.stringify(payload));
      setLastDraftSavedAt(Date.now());
    } catch (e) {
      console.warn('[Stocktake Draft] Auto-save failed:', e);
    }
  };

  // Helper to clear draft once officially submitted
  const clearDraftLocally = (slot: 'A' | 'B') => {
    try {
      localStorage.removeItem(getDraftKey(slot));
      setLastDraftSavedAt(null);
    } catch (e) {}
  };

  // Fast-moving checklist item IDs
  const fastMovingItemIds = useMemo(() => {
    const list = getFastMovingChecklist();
    return new Set(list.map((i) => i.itemId.toUpperCase()));
  }, []);

  // Map of inventory item by ID for fast lookup
  const inventoryItemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    inventoryList.forEach((i) => map.set(i.itemId.toUpperCase(), i));
    return map;
  }, [inventoryList]);

  // Load catalog products and initialize lines with Draft Protection
  useEffect(() => {
    const items = getInventoryItems();
    setInventoryList(items);

    // 1. Check if a local auto-saved draft exists first (prevents lost counts if user pressed back or browser closed)
    let loadedFromDraft = false;
    try {
      const rawDraft = localStorage.getItem(getDraftKey(counterSlot));
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          const hasCount = parsed.lines.some((l: any) => (l.totalUnits && l.totalUnits > 0) || l.wasCounted);
          if (hasCount) {
            setLines(parsed.lines);
            if (parsed.counterStaffName) setCounterStaffName(parsed.counterStaffName);
            if (parsed.counterStaffId) setCounterStaffId(parsed.counterStaffId);
            if (parsed.counterPhone) setCounterPhone(parsed.counterPhone);
            setLastDraftSavedAt(parsed.updatedAt || Date.now());
            const countedCount = parsed.lines.filter((l: any) => l.totalUnits > 0 || l.wasCounted).length;
            setDraftRestoredMessage(
              `Draft Restored: Recovered ${countedCount} in-progress count item(s) from auto-save (${new Date(
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

    if (!loadedFromDraft) {
      const existing = counterSlot === 'A' ? segment.count1 : segment.count2;
      if (existing && existing.length > 0) {
        setLines(JSON.parse(JSON.stringify(existing)));
      } else {
        // Pre-seed catalog items with 0 counts
        const initialLines: StocktakeLineCount[] = items.map((itm) => ({
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
        setLines(initialLines);
      }
    }
  }, [segment, counterSlot, session.sessionId]);

  // Collapse upper header on scroll down to give counter maximum vertical screen space
  useEffect(() => {
    let lastScrollY = window.scrollY;
    const onScroll = () => {
      const currentY = window.scrollY;
      if (currentY > 80 && currentY > lastScrollY) {
        // User is scrolling down: collapse top header so frozen search panel gets full focus
        setIsHeaderExpanded(false);
      }
      lastScrollY = currentY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Handle counter slot change
  const handleSlotChange = (newSlot: 'A' | 'B') => {
    setCounterSlot(newSlot);
    // Check if new slot has an existing draft
    try {
      const rawDraft = localStorage.getItem(getDraftKey(newSlot));
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          const hasCount = parsed.lines.some((l: any) => (l.totalUnits && l.totalUnits > 0) || l.wasCounted);
          if (hasCount) {
            setLines(parsed.lines);
            setLastDraftSavedAt(parsed.updatedAt || Date.now());
            setDraftRestoredMessage(
              `Loaded auto-saved draft for Count ${newSlot} (${new Date(
                parsed.updatedAt || Date.now()
              ).toLocaleTimeString()}).`
            );
            setTimeout(() => setDraftRestoredMessage(null), 5000);
            return;
          }
        }
      }
    } catch {}

    const existing = newSlot === 'A' ? segment.count1 : segment.count2;
    if (existing && existing.length > 0) {
      setLines(JSON.parse(JSON.stringify(existing)));
    } else {
      const items = getInventoryItems();
      setLines(
        items.map((itm) => ({
          itemId: itm.itemId,
          itemName: itm.itemName,
          category: itm.category || 'General',
          sku: itm.sku || itm.itemId,
          barcode: itm.barcode,
          unitsPerCase: itm.unitsPerCase || 1,
          cases: 0,
          singles: 0,
          totalUnits: 0,
        }))
      );
    }
  };

  // Categories for filter
  const categories = useMemo(() => {
    const set = new Set<string>();
    inventoryList.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return ['ALL', ...Array.from(set)];
  }, [inventoryList]);

  // Casual PIN authentication handler
  const handleCasualPinLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setCasualPinError('');
    const found = authenticateCasualWorker(casualPinInput);
    if (found) {
      setActiveCasual(found);
      setCounterStaffName(found.name);
      setCounterStaffId(found.id);
      setCounterPhone(found.phone);
      setShowCasualPinModal(false);
      setCasualPinInput('');
    } else {
      setCasualPinError('Invalid 4-digit Casual PIN. Please verify with supervisor.');
    }
  };

  // Update line quantity with Active Freeze snapshot AND AUTO-SAVE DRAFT IMMEDIATELY
  const updateQuantity = (
    itemId: string,
    casesDelta: number,
    singlesDelta: number,
    exactCases?: number,
    exactSingles?: number
  ) => {
    const freezeSnapshot = captureLiveInventoryFreeze(itemId, session.branchId);

    setLines((prev) => {
      const updated = prev.map((l) => {
        if (l.itemId.toUpperCase() === itemId.toUpperCase()) {
          const upc = Math.max(1, l.unitsPerCase || 1);
          let newCases = exactCases !== undefined ? exactCases : Math.max(0, l.cases + casesDelta);
          let newSingles = exactSingles !== undefined ? exactSingles : Math.max(0, l.singles + singlesDelta);
          const totalUnits = newCases * upc + newSingles;

          const frozenSystemUnits = freezeSnapshot.frozenSystemUnits;
          const frozenTimestamp = freezeSnapshot.frozenTimestamp;
          const varianceAtCountTime = totalUnits - frozenSystemUnits;

          return {
            ...l,
            cases: newCases,
            singles: newSingles,
            totalUnits,
            wasCounted: true,
            countedBy: counterStaffId,
            countedByName: counterStaffName,
            counterPhone: counterPhone || undefined,
            timestamp: new Date().toISOString(),
            systemSOHAtCountTime: frozenSystemUnits,
            frozenTimestamp,
            varianceAtCountTime,
          };
        }
        return l;
      });

      // Auto-save draft to local storage so count is NEVER lost on back press or refresh
      saveDraftLocally(updated, counterSlot);

      return updated;
    });
  };

  // Filtered list
  const filteredLines = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const cat = (selectedCategory || '').toLowerCase();
    return lines.filter((l) => {
      const matchesSearch =
        q === '' ||
        (l.itemName && l.itemName.toLowerCase().includes(q)) ||
        (l.sku && l.sku.toLowerCase().includes(q)) ||
        (l.barcode && l.barcode.includes(searchQuery));
      const matchesCategory =
        selectedCategory === 'ALL' || (l.category || '').toLowerCase() === cat;
      const matchesFastMovers =
        !onlyFastMovers || fastMovingItemIds.has(l.itemId.toUpperCase());

      return matchesSearch && matchesCategory && matchesFastMovers;
    });
  }, [lines, searchQuery, selectedCategory, onlyFastMovers, fastMovingItemIds]);

  // Summary KPIs for this counter
  const countedItemsCount = lines.filter((l) => l.totalUnits > 0 || l.wasCounted).length;
  const totalCountedCases = lines.reduce((acc, l) => acc + l.cases, 0);
  const totalCountedSingles = lines.reduce((acc, l) => acc + l.singles, 0);
  const totalCountedUnits = lines.reduce((acc, l) => acc + l.totalUnits, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveCount(counterSlot, lines, counterStaffId, counterStaffName);
    // Clear draft after successful broadcast submission
    clearDraftLocally(counterSlot);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
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
              onClick={onBack}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Return to Session Overview (Draft is auto-saved)"
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

          {/* Right: Auto-Save Status, Save Button, and Dropdown Header Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Live Auto-Save Indicator */}
            {lastDraftSavedAt && (
              <div
                className="hidden md:flex items-center gap-1.5 text-[11px] text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded"
                title="Every line count is auto-saved as a local draft continuously"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Draft Saved {new Date(lastDraftSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}

            {/* Save Count Submit Button */}
            <button
              type="button"
              onClick={handleSubmit}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md transition ${
                counterSlot === 'A'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Count {counterSlot}</span>
            </button>

            {/* Dropdown Toggle: Lets user collapse/expand the top section for more screen space */}
            <button
              type="button"
              onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1"
              title={isHeaderExpanded ? 'Hide top controls to maximize counting screen' : 'Show top controls & category filters'}
            >
              {isHeaderExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <span className="hidden sm:inline text-[10px] font-medium text-slate-400">
                {isHeaderExpanded ? 'Collapse' : 'Details'}
              </span>
            </button>
          </div>
        </div>

        {/* Collapsible Panel: Expands on request or at top; tucks away on scroll to maximize counting area */}
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
                    <span>Casual: <strong>{activeCasual.name}</strong></span>
                  ) : (
                    <span>Casual PIN Login</span>
                  )}
                </button>

                {/* Counter Slot Switcher */}
                <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-700">
                  <button
                    type="button"
                    onClick={() => handleSlotChange('A')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                      counterSlot === 'A'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Count 1 (Team A)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSlotChange('B')}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                      counterSlot === 'B'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Count 2 (Team B)
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

                {/* Fast Movers Button */}
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

            {/* Mode alerts if applicable */}
            {isDailyBlind && (
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
          Counter {counterSlot} count successfully saved to system!
        </div>
      )}


      {/* Main Counting Matrix */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4">
        <div className="space-y-3">
          {filteredLines.map((line, idx) => {
            const hasCount = line.totalUnits > 0 || line.wasCounted;
            const upc = line.unitsPerCase || 1;
            const masterItem = inventoryItemMap.get(line.itemId.toUpperCase());
            const systemTotalUnits = masterItem?.totalUnits ?? 0;
            const systemCases = masterItem?.stockCases ?? 0;
            const systemSingles = masterItem?.stockSingles ?? 0;

            const isFastMover = fastMovingItemIds.has(line.itemId.toUpperCase());

            return (
              <div
                key={`${line.itemId}-${idx}`}
                className={`p-3.5 rounded-xl border transition ${
                  hasCount
                    ? 'bg-slate-800/90 border-blue-500/40 ring-1 ring-blue-500/20'
                    : 'bg-slate-800/50 border-slate-700/60 hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Item Description */}
                  <div className="min-w-[260px]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-medium text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700/60">
                        {line.sku}
                      </span>
                      <span className="text-[11px] text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded">
                        {line.category}
                      </span>
                      {isFastMover && (
                        <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" /> Fast Mover
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-white mt-1">{line.itemName}</h3>
                    <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-3">
                      <span>Packaging: <strong className="text-slate-300">{upc} units/case</strong></span>
                      {line.barcode && <span>Barcode: <span className="font-mono">{line.barcode}</span></span>}
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

                    {/* Daily Blind Active Freeze Timestamp & Variance */}
                    {isDailyBlind && line.frozenTimestamp && (
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
                          onClick={() => updateQuantity(line.itemId, -1, 0)}
                          className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center justify-center font-bold"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={line.cases === 0 ? '' : line.cases}
                          onChange={(e) =>
                            updateQuantity(line.itemId, 0, 0, Number(e.target.value) || 0, line.singles)
                          }
                          placeholder="0"
                          className="w-14 text-center font-mono font-bold bg-slate-950 border border-slate-700 text-white rounded py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.itemId, 1, 0)}
                          className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center justify-center font-bold"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.itemId, 5, 0)}
                          className="px-1.5 h-7 bg-slate-800 hover:bg-slate-700 text-blue-300 rounded text-[11px] font-bold"
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
                          onClick={() => updateQuantity(line.itemId, 0, -1)}
                          className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center justify-center font-bold"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={line.singles === 0 ? '' : line.singles}
                          onChange={(e) =>
                            updateQuantity(line.itemId, 0, 0, line.cases, Number(e.target.value) || 0)
                          }
                          placeholder="0"
                          className="w-14 text-center font-mono font-bold bg-slate-950 border border-slate-700 text-white rounded py-1 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.itemId, 0, 1)}
                          className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center justify-center font-bold"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.itemId, 0, 5)}
                          className="px-1.5 h-7 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded text-[11px] font-bold"
                        >
                          +5
                        </button>
                      </div>
                    </div>

                    {/* Total Calculated Units & Quick Reset */}
                    <div className="flex items-center gap-3 bg-slate-950/90 px-3.5 py-2.5 rounded-lg border border-slate-700/60 min-w-[140px] justify-between">
                      <div>
                        <div className="text-[10px] uppercase font-semibold text-slate-400">Total Base Units</div>
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
                      {line.totalUnits > 0 && (
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.itemId, 0, 0, 0, 0)}
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
          })}

          {filteredLines.length === 0 && (
            <div className="text-center py-12 bg-slate-800/40 rounded-xl border border-slate-800">
              <Package className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-50" />
              <p className="text-sm text-slate-400">No products match your search query or filter.</p>
              {onlyFastMovers && (
                <button
                  type="button"
                  onClick={() => setOnlyFastMovers(false)}
                  className="mt-3 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold"
                >
                  Show All Products
                </button>
              )}
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
              Progress: <strong className="text-emerald-400 font-mono">{countedItemsCount}</strong> of{' '}
              <span className="text-slate-400">{lines.length} products counted</span>
            </span>
            <span className="hidden sm:inline">
              Total Units: <strong className="text-blue-400 font-mono">{totalCountedUnits}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-700 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className={`px-5 py-2 rounded-lg text-sm font-bold shadow-lg flex items-center gap-2 transition ${
                counterSlot === 'A'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
            >
              <Save className="w-4 h-4" />
              Submit Count {counterSlot}
            </button>
          </div>
        </div>
      </footer>

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
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Enter 4-Digit Security PIN *
                </label>
                <input
                  type="password"
                  maxLength={4}
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
