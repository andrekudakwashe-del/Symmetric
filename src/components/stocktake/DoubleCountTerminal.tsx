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
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  InventoryItem,
  Salesperson,
} from '../../types';
import { getInventoryItems } from '../../db/roomDatabase';

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
  const [counterStaffName, setCounterStaffName] = useState<string>(
    currentUser?.name || (counterSlot === 'A' ? 'Counter A' : 'Counter B')
  );
  const [counterStaffId, setCounterStaffId] = useState<string>(
    currentUser?.id || (counterSlot === 'A' ? '002' : '003')
  );

  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [lines, setLines] = useState<StocktakeLineCount[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Load catalog products
  useEffect(() => {
    const items = getInventoryItems();
    setInventoryList(items);

    // Initialize lines from existing counts if any
    const existing = counterSlot === 'A' ? segment.count1 : segment.count2;
    if (existing && existing.length > 0) {
      setLines(JSON.parse(JSON.stringify(existing)));
    } else {
      // Pre-seed catalog items with 0 counts for easy floor counting
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

  // Update line quantity
  const updateQuantity = (
    itemId: string,
    casesDelta: number,
    singlesDelta: number,
    exactCases?: number,
    exactSingles?: number
  ) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.itemId.toUpperCase() === itemId.toUpperCase()) {
          const upc = Math.max(1, l.unitsPerCase || 1);
          let newCases = exactCases !== undefined ? exactCases : Math.max(0, l.cases + casesDelta);
          let newSingles = exactSingles !== undefined ? exactSingles : Math.max(0, l.singles + singlesDelta);
          const totalUnits = (newCases * upc) + newSingles;
          return {
            ...l,
            cases: newCases,
            singles: newSingles,
            totalUnits,
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
      return matchesSearch && matchesCategory;
    });
  }, [lines, searchQuery, selectedCategory]);

  // Summary KPIs for this counter
  const countedItemsCount = lines.filter((l) => l.totalUnits > 0).length;
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
              </div>
              <p className="text-xs text-slate-400">
                Session: {session.title} ({session.sessionId})
              </p>
            </div>
          </div>

          {/* Counter Switcher & Blind Mode Indicator */}
          <div className="flex items-center gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-700/80">
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
              Counter A (1st Count)
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
              Counter B (2nd Count)
            </button>
          </div>
        </div>
      </header>

      {/* Counter Info & Blind Mode Disclaimer */}
      <div className="bg-slate-800/40 border-b border-slate-800 px-4 py-2 text-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-slate-300">
          <div className="flex items-center gap-4">
            <span>
              Logging as: <strong className="text-white">{counterStaffName}</strong> (
              {counterSlot === 'A' ? 'First Blind Count' : 'Second Blind Count'})
            </span>
            <span className="inline-flex items-center gap-1 text-amber-400 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded text-[11px]">
              <HelpCircle className="w-3 h-3" />
              Double-Blind Active: Counter A and B cannot see each other's inputs.
            </span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>
              Counted SKUs: <strong className="text-white">{countedItemsCount}</strong>
            </span>
            <span>
              Total Units: <strong className="text-emerald-400">{totalCountedUnits}</strong> (
              {totalCountedCases} Cases + {totalCountedSingles} Singles)
            </span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 sticky top-[57px] z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Scan barcode or search by item name, SKU..."
                className="w-full pl-9 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                >
                  Clear
                </button>
              )}
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === 'ALL' ? 'All Categories' : c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
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
              Save & Submit Count {counterSlot}
            </button>
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
          {filteredLines.map((line) => {
            const hasCount = line.totalUnits > 0;
            const upc = line.unitsPerCase || 1;

            return (
              <div
                key={line.itemId}
                className={`p-3.5 rounded-xl border transition ${
                  hasCount
                    ? 'bg-slate-800/90 border-blue-500/40 ring-1 ring-blue-500/20'
                    : 'bg-slate-800/50 border-slate-700/60 hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Item Description */}
                  <div className="min-w-[240px]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-medium text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700/60">
                        {line.sku}
                      </span>
                      <span className="text-[11px] text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded">
                        {line.category}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-white mt-1">{line.itemName}</h3>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
                      <span>Packaging: <strong className="text-slate-300">{upc} units/case</strong></span>
                      {line.barcode && <span>Barcode: <span className="font-mono">{line.barcode}</span></span>}
                    </div>
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
            </div>
          )}
        </div>
      </main>

      {/* Floating Bottom Sticky Bar */}
      <footer className="bg-slate-800/95 border-t border-slate-700/80 px-4 py-3 sticky bottom-0 z-30 backdrop-blur">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-xs text-slate-300">
            <span>
              Counter Slot: <strong className="text-white">Counter {counterSlot}</strong>
            </span>
            <span>
              Progress: <strong className="text-emerald-400">{countedItemsCount}</strong> of{' '}
              <span className="text-slate-400">{lines.length} items counted</span>
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
    </div>
  );
};
