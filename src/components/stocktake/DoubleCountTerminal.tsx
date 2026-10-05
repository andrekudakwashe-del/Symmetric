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

  const isDailyBlind = session.countType === 'DAILY_BLIND';
  const isSpotCheck = session.countType === 'SPOT_CHECK';

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

  // Load catalog products and initialize lines
  useEffect(() => {
    const items = getInventoryItems();
    setInventoryList(items);

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
  }, [segment, counterSlot]);

  // Handle counter slot change
  const handleSlotChange = (newSlot: 'A' | 'B') => {
    setCounterSlot(newSlot);
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
      // Also check temporary casuals for this session
      const sessCasuals = getTemporaryCasuals(session.sessionId);
      const matched = sessCasuals.find((c) => c.pin === casualPinInput.trim());
      if (matched) {
        setActiveCasual(matched);
        setCounterStaffName(matched.name);
        setCounterStaffId(matched.id);
        setCounterPhone(matched.phone);
        setShowCasualPinModal(false);
        setCasualPinInput('');
      } else {
        setCasualPinError('Invalid 4-digit Casual PIN. Please verify with supervisor.');
      }
    }
  };

  // Update line quantity with Active Freeze snapshot
  const updateQuantity = (
    itemId: string,
    casesDelta: number,
    singlesDelta: number,
    exactCases?: number,
    exactSingles?: number
  ) => {
    // If Daily Blind or Weekly Active Count: capture live freeze snapshot on line change
    const freezeSnapshot = captureLiveInventoryFreeze(itemId, session.branchId);

    setLines((prev) =>
      prev.map((l) => {
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
      })
    );
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
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="bg-slate-900 text-slate-100 min-h-screen flex flex-col">
      {/* Header Bar */}
      <header className="bg-slate-800/90 border-b border-slate-700/80 px-4 py-3 sticky top-0 z-30 backdrop-blur">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition"
              title="Return to Session Overview"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-400 bg-blue-950/80 border border-blue-800/60 px-2 py-0.5 rounded">
                  {segment.locationCode || segment.segmentId}
                </span>
                <h1 className="text-base font-bold text-white tracking-tight">{segment.name}</h1>
                {isDailyBlind && (
                  <span className="text-[10px] bg-amber-950/90 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Daily Active Trading Freeze
                  </span>
                )}
                {isSpotCheck && (
                  <span className="text-[10px] bg-emerald-950/90 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Non-Blind Spot Check
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Session: {session.title} ({session.sessionId})
              </p>
            </div>
          </div>

          {/* Counter Switcher & Casual Worker Badge */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Casual Switcher */}
            <button
              type="button"
              onClick={() => setShowCasualPinModal(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 flex items-center gap-1.5 transition"
              title="Login with Casual Worker 4-Digit PIN"
            >
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              {activeCasual ? (
                <span>
                  Casual: <strong>{activeCasual.name}</strong> ({activeCasual.pin})
                </span>
              ) : (
                <span>Casual PIN Login</span>
              )}
            </button>

            {/* Counter Slot Switcher */}
            <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-700/80">
              <button
                type="button"
                onClick={() => handleSlotChange('A')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  counterSlot === 'A'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                Count 1 (Group 1)
              </button>
              <button
                type="button"
                onClick={() => handleSlotChange('B')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  counterSlot === 'B'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                Count 2 (Group 2)
              </button>
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${
                counterSlot === 'A'
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-purple-600 hover:bg-purple-500 text-white'
              }`}
            >
              <Save className="w-4 h-4" />
              Save Count {counterSlot}
            </button>
          </div>
        </div>
      </header>

      {/* Mode Guidance Alert */}
      {isDailyBlind && (
        <div className="bg-amber-950/40 border-b border-amber-800/60 px-4 py-2 text-xs text-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Active Trading Line-by-Line Freeze:</strong> Tills are actively selling while you count. The system takes a live inventory snapshot the second you key in or change any line, freezing the on-hand stock and logging variance at count time!
            </span>
          </div>
          <span className="text-[11px] font-mono text-amber-300">Live Freeze Armed</span>
        </div>
      )}

      {isSpotCheck && (
        <div className="bg-emerald-950/40 border-b border-emerald-800/60 px-4 py-2 text-xs text-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Supervisor Non-Blind Spot Check:</strong> Live system stock-on-hand is visible beside your count input for quick on-the-spot verification and discrepancy resolution.
            </span>
          </div>
          <span className="text-[11px] font-mono text-emerald-300">Visible Mode</span>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-slate-800/60 border-b border-slate-700/60 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products by SKU, name, or barcode..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setOnlyFastMovers(!onlyFastMovers)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                onlyFastMovers
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Fast Movers ({fastMovingItemIds.size})
            </button>
          </div>

          {/* Quick Counter Info */}
          <div className="text-xs text-slate-400 flex items-center gap-3">
            <span>
              Counter:{' '}
              <strong className="text-slate-200">{counterStaffName}</strong>
              {counterPhone && <span className="text-[11px] text-slate-400"> ({counterPhone})</span>}
            </span>
            <span>•</span>
            <span>
              Counted:{' '}
              <strong className="text-emerald-400 font-mono">
                {countedItemsCount}/{lines.length}
              </strong>
            </span>
          </div>
        </div>
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
                        <div className="text-[10px] uppercase font-semibold text-slate-400">Total Count</div>
                        <div className="text-base font-extrabold font-mono text-emerald-400">
                          {line.totalUnits}{' '}
                          <span className="text-xs font-normal text-slate-400">units</span>
                        </div>
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
