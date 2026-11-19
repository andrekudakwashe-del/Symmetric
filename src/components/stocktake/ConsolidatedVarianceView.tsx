import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import {
  Search,
  Filter,
  AlertTriangle,
  CheckCircle,
  TrendingDown,
  TrendingUp,
  RotateCcw,
  Download,
  Printer,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Info,
  HelpCircle,
  Save,
  Boxes,
  Package,
  EyeOff,
  ClipboardCheck,
  ShieldAlert,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  X,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeConsolidatedItem,
  Salesperson,
} from '../../types';

interface ConsolidatedVarianceViewProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onRequestSkuRecount: (itemId: string, notes?: string) => void;
  onSubmitSkuRecount: (itemId: string, cases: number, singles: number) => void;
  onConsolidateAgain: () => void;
  onOpenBlindRecountSheet?: () => void;
  onBatchRequestRecount?: (itemIds: string[]) => void;
}

export const ConsolidatedVarianceView: React.FC<ConsolidatedVarianceViewProps> = ({
  session,
  currentUser,
  onRequestSkuRecount,
  onSubmitSkuRecount,
  onConsolidateAgain,
  onOpenBlindRecountSheet,
  onBatchRequestRecount,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [filterType, setFilterType] = useState<'ALL' | 'VARIANCES' | 'SHORTAGES' | 'OVERAGES' | 'MATCH' | 'FLAGGED'>('ALL');
  const [sortBy, setSortBy] = useState<
    'ABS_COST_DESC' | 'COST_ASC' | 'COST_DESC' | 'ABS_UNITS_DESC' | 'ABS_RETAIL_DESC' | 'NAME_ASC' | 'DEFAULT'
  >('ABS_COST_DESC');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [selectedForRecount, setSelectedForRecount] = useState<string[]>([]);

  // Active SKU being recounted inline
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
  const [recountCases, setRecountCases] = useState<number>(0);
  const [recountSingles, setRecountSingles] = useState<number>(0);

  const consolidated = session.consolidatedItems || [];
  const verifiedSegmentsCount = (session.segments || []).filter((s) => s.status === 'VERIFIED').length;
  const totalSegmentsCount = (session.segments || []).length;
  const queuedRecountCount = consolidated.filter(
    (i) => i.recountSheetStatus === 'REQUESTED' || Boolean(i.recountRequested)
  ).length;
  const reversalAlertsCount = consolidated.filter((i) => Boolean(i.recountReversalAlert)).length;

  // Auto-consolidate on mount if verified segments exist but consolidatedItems is empty
  useEffect(() => {
    if ((!session.consolidatedItems || session.consolidatedItems.length === 0) && verifiedSegmentsCount > 0) {
      onConsolidateAgain();
    }
  }, [session.sessionId, session.consolidatedItems?.length, verifiedSegmentsCount, onConsolidateAgain]);

  // Filter & Sort items (memoized for snappy typing & sorting)
  const filteredItems = useMemo(() => {
    const q = (deferredSearchQuery || '').trim().toLowerCase();
    const matched = consolidated.filter((item) => {
      const matchesSearch =
        q === '' ||
        (item.itemName && item.itemName.toLowerCase().includes(q)) ||
        (item.sku && item.sku.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        (item.barcode && String(item.barcode).toLowerCase().includes(q));

      let matchesFilter = true;
      if (filterType === 'VARIANCES') {
        matchesFilter = item.varianceTotalUnits !== 0;
      } else if (filterType === 'SHORTAGES') {
        matchesFilter = item.varianceTotalUnits < 0;
      } else if (filterType === 'OVERAGES') {
        matchesFilter = item.varianceTotalUnits > 0;
      } else if (filterType === 'MATCH') {
        matchesFilter = item.varianceTotalUnits === 0;
      } else if (filterType === 'FLAGGED') {
        matchesFilter = !!item.recountRequested;
      }

      return matchesSearch && matchesFilter;
    });

    if (sortBy === 'DEFAULT') return matched;

    return [...matched].sort((a, b) => {
      if (sortBy === 'ABS_COST_DESC') {
        const diff = Math.abs(Number(b.varianceCostValue || 0)) - Math.abs(Number(a.varianceCostValue || 0));
        if (Math.abs(diff) > 0.0001) return diff;
        return Math.abs(Number(b.varianceTotalUnits || 0)) - Math.abs(Number(a.varianceTotalUnits || 0));
      }
      if (sortBy === 'COST_ASC') {
        // Most negative shortage ($) at the top
        return Number(a.varianceCostValue || 0) - Number(b.varianceCostValue || 0);
      }
      if (sortBy === 'COST_DESC') {
        // Largest positive overage ($) at the top
        return Number(b.varianceCostValue || 0) - Number(a.varianceCostValue || 0);
      }
      if (sortBy === 'ABS_UNITS_DESC') {
        const diff = Math.abs(Number(b.varianceTotalUnits || 0)) - Math.abs(Number(a.varianceTotalUnits || 0));
        if (diff !== 0) return diff;
        return Math.abs(Number(b.varianceCostValue || 0)) - Math.abs(Number(a.varianceCostValue || 0));
      }
      if (sortBy === 'ABS_RETAIL_DESC') {
        return Math.abs(Number(b.varianceRetailValue || 0)) - Math.abs(Number(a.varianceRetailValue || 0));
      }
      if (sortBy === 'NAME_ASC') {
        return String(a.itemName || '').localeCompare(String(b.itemName || ''));
      }
      return 0;
    });
  }, [consolidated, deferredSearchQuery, filterType, sortBy]);

  const { totalSKUs, matchCount, shortageCount, overageCount, flaggedCount } = useMemo(() => {
    let matches = 0;
    let shortages = 0;
    let overages = 0;
    let flagged = 0;
    for (const i of consolidated) {
      if (i.varianceTotalUnits === 0) matches++;
      else if (i.varianceTotalUnits < 0) shortages++;
      else overages++;
      if (i.recountRequested) flagged++;
    }
    return {
      totalSKUs: consolidated.length,
      matchCount: matches,
      shortageCount: shortages,
      overageCount: overages,
      flaggedCount: flagged,
    };
  }, [consolidated]);

  const handleStartRecount = (item: StocktakeConsolidatedItem) => {
    setEditingSkuId(item.itemId);
    setRecountCases(item.countedCases);
    setRecountSingles(item.countedSingles);
  };

  const handleSaveRecount = (itemId: string) => {
    onSubmitSkuRecount(itemId, recountCases, recountSingles);
    setEditingSkuId(null);
  };

  // CSV Export for the consolidated variance report
  const handleExportCSV = () => {
    const headers = [
      'SKU',
      'Item Name',
      'Category',
      'Units/Case',
      'Cost/Unit ($)',
      'Sell/Unit ($)',
      'System SOH (Cases)',
      'System SOH (Singles)',
      'System Total Units',
      'System Cost Value ($)',
      'Original First-Pass Units',
      'Original Variance Units',
      'Recount Sheet Status',
      'Recount Total Units',
      'Recounted By',
      'Recount Witness',
      'Anti-Fraud Reversal Flag',
      'Counted (Cases)',
      'Counted (Singles)',
      'Counted Total Units',
      'Counted Cost Value ($)',
      'Variance Units',
      'Variance Cost Value ($)',
      'Variance Retail Value ($)',
      'Status',
    ];

    const rows = filteredItems.map((i) => [
      `"${i.sku}"`,
      `"${String(i.itemName || '').replace(/"/g, '""')}"`,
      `"${i.category}"`,
      i.unitsPerCase,
      i.costPerUnit.toFixed(2),
      i.sellPriceUnit.toFixed(2),
      i.systemCases,
      i.systemSingles,
      i.systemTotalUnits,
      i.systemCostValue.toFixed(2),
      i.originalCountedTotalUnits ?? i.countedTotalUnits,
      i.originalVarianceTotalUnits ?? i.varianceTotalUnits,
      `"${i.recountSheetStatus || 'NONE'}"`,
      i.recountTotalUnits ?? '',
      `"${(i.recountedBy || '').replace(/"/g, '""')}"`,
      `"${(i.recountWitnessName || '').replace(/"/g, '""')}"`,
      i.recountReversalAlert ? 'ALERT_REVERSAL' : 'OK',
      i.countedCases,
      i.countedSingles,
      i.countedTotalUnits,
      i.countedCostValue.toFixed(2),
      i.varianceTotalUnits,
      i.varianceCostValue.toFixed(2),
      i.varianceRetailValue.toFixed(2),
      `"${i.status}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Stocktake_Consolidated_Variance_${session.sessionId}_${session.date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSelectForRecount = (itemId: string) => {
    setSelectedForRecount((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const handleDispatchBlindRecount = () => {
    const targetIds =
      selectedForRecount.length > 0
        ? selectedForRecount
        : consolidated
            .filter((i) => i.varianceTotalUnits !== 0 && i.recountSheetStatus !== 'REQUESTED')
            .map((i) => i.itemId);
    if (targetIds.length === 0) return;
    if (onBatchRequestRecount) {
      onBatchRequestRecount(targetIds);
    } else {
      targetIds.forEach((id) => onRequestSkuRecount(id, 'Dispatched to Blind Recount Sheet'));
    }
    setSelectedForRecount([]);
  };

  const totalCustomerHeld = consolidated.reduce((acc, i) => acc + (i.customerHeldStockUnits || 0), 0);
  const isFullLockdown = session.countType === 'FULL_LOCKDOWN';
  const countTypeLabel =
    session.countType === 'DAILY_BLIND'
      ? 'Daily Blind Count (Fast Movers)'
      : session.countType === 'SPOT_CHECK'
      ? 'Supervisor Spot Check'
      : session.countType === 'WEEKLY_STRATEGIC'
      ? 'Weekly Strategic Count'
      : 'Full Storewide Lockdown Audit';

  return (
    <div className="space-y-4">
      {/* Segment Verification Progress Bar & Live Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-mono font-bold text-sm shrink-0">
            {verifiedSegmentsCount}/{totalSegmentsCount}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold">Consolidated Progress</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  verifiedSegmentsCount === totalSegmentsCount && totalSegmentsCount > 0
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {verifiedSegmentsCount === totalSegmentsCount && totalSegmentsCount > 0
                  ? 'All Zones Reconciled & Verified'
                  : `${totalSegmentsCount - verifiedSegmentsCount} Zone(s) Pending Verification`}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {verifiedSegmentsCount === totalSegmentsCount && totalSegmentsCount > 0
                ? 'All physical shelf segments are verified and aggregated. Ready for final supervisor review.'
                : 'Live partial consolidation aggregating all currently verified shelf segments against system book stock.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onConsolidateAgain}
          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-sm active:scale-95"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Sync & Consolidate Now</span>
        </button>
      </div>

      {/* Count Type Scope & Committal Banner */}
      <div
        className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs ${
          isFullLockdown
            ? 'bg-rose-950/30 border-rose-800/60 text-rose-200'
            : 'bg-blue-950/30 border-blue-800/60 text-blue-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <Info className="w-4 h-4 shrink-0 text-blue-400" />
          <div>
            <strong className="text-white block font-semibold">
              Audit Scope: {countTypeLabel}
            </strong>
            <p className="text-[11px] text-slate-300 mt-0.5">
              {isFullLockdown
                ? 'Storewide Full Lockdown: Approval will commit all lines; uncounted catalog items default to 0 units on hand.'
                : 'Targeted Count Mode: Approval will commit ONLY the lines counted in this session. Uncounted items in the catalog remain untouched.'}
            </p>
          </div>
        </div>

        {totalCustomerHeld > 0 && (
          <div className="bg-amber-950/60 border border-amber-800/80 px-3 py-1.5 rounded-lg text-amber-300 text-xs font-semibold shrink-0 flex items-center gap-1.5">
            <span>Customer Goods Held: <strong>-{totalCustomerHeld} units</strong> reconciled</span>
          </div>
        )}
      </div>

      {/* Anti-Fraud Zero-Out / Masking Alert Banner */}
      {reversalAlertsCount > 0 && (
        <div className="bg-rose-950/50 border border-rose-700/70 rounded-xl p-3.5 text-xs text-rose-100 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-white block">
              Anti-Fraud Alert: {reversalAlertsCount} SKU(s) showed &gt;=50% Shortage Shrinkage During Recount
            </strong>
            <p className="text-[11px] text-rose-200/90 mt-0.5">
              Original first-pass counts and original variances remain permanently preserved alongside Recount Sheet results for Owner/Auditor verification before committal.
            </p>
          </div>
        </div>
      )}

      {/* KPI Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
          <div className="text-xs text-slate-400 font-medium">System SOH Total</div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            {session.totalSystemUnits.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">units</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Book Inventory on System
          </div>
        </div>

        <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700">
          <div className="text-xs text-slate-400 font-medium">Physical Counted Total</div>
          <div className="text-xl font-bold font-mono text-blue-400 mt-1">
            {session.totalCountedUnits.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">units</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Floor Count Across Segments
          </div>
        </div>

        <div
          className={`p-3.5 rounded-xl border ${
            session.varianceUnits === 0
              ? 'bg-slate-800/80 border-slate-700'
              : session.varianceUnits < 0
              ? 'bg-rose-950/30 border-rose-800/50'
              : 'bg-emerald-950/30 border-emerald-800/50'
          }`}
        >
          <div className="text-xs text-slate-400 font-medium">Net Unit Variance</div>
          <div
            className={`text-xl font-bold font-mono mt-1 ${
              session.varianceUnits === 0
                ? 'text-slate-200'
                : session.varianceUnits < 0
                ? 'text-rose-400'
                : 'text-emerald-400'
            }`}
          >
            {session.varianceUnits > 0 ? `+${session.varianceUnits}` : session.varianceUnits}{' '}
            <span className="text-xs font-normal text-slate-400">units</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {shortageCount} Shortages, {overageCount} Overages
          </div>
        </div>

        <div
          className={`p-3.5 rounded-xl border ${
            session.varianceCostValue === 0
              ? 'bg-slate-800/80 border-slate-700'
              : session.varianceCostValue < 0
              ? 'bg-rose-950/30 border-rose-800/50'
              : 'bg-emerald-950/30 border-emerald-800/50'
          }`}
        >
          <div className="text-xs text-slate-400 font-medium">Financial Cost Variance</div>
          <div
            className={`text-xl font-bold font-mono mt-1 ${
              session.varianceCostValue === 0
                ? 'text-slate-200'
                : session.varianceCostValue < 0
                ? 'text-rose-400'
                : 'text-emerald-400'
            }`}
          >
            {session.varianceCostValue >= 0 ? `+$` : `-$`}
            {Math.abs(session.varianceCostValue).toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Retail Val: {session.varianceRetailValue >= 0 ? '+$' : '-$'}
            {Math.abs(session.varianceRetailValue).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Action Toolbar, Full-Width Search, Variance Sorting & Filters */}
      <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700 space-y-3">
        {/* Row 1: Prominent Full-Width Search Input + Sort by Variance Value */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search variance items by item name, SKU, category, or barcode..."
              aria-label="Search consolidated variance items"
              className="w-full pl-10 pr-24 py-2.5 bg-slate-950 border border-slate-600 focus:border-blue-500 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 shadow-inner"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-700/80 px-2 py-0.5 rounded-md pointer-events-none">
                {filteredItems.length}/{totalSKUs}
              </span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <label htmlFor="variance-sort-select" className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">
              Sort:
            </label>
            <select
              id="variance-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-1"
            >
              <option value="ABS_COST_DESC" className="bg-slate-900 text-white">
                Largest Variance Value ($ Abs)
              </option>
              <option value="COST_ASC" className="bg-slate-900 text-white">
                Biggest Shortages ($ First)
              </option>
              <option value="COST_DESC" className="bg-slate-900 text-white">
                Biggest Overages ($ First)
              </option>
              <option value="ABS_UNITS_DESC" className="bg-slate-900 text-white">
                Largest Unit Variance
              </option>
              <option value="ABS_RETAIL_DESC" className="bg-slate-900 text-white">
                Largest Retail Variance ($)
              </option>
              <option value="NAME_ASC" className="bg-slate-900 text-white">
                Item Name (A–Z)
              </option>
              <option value="DEFAULT" className="bg-slate-900 text-white">
                Default Catalog Order
              </option>
            </select>
          </div>
        </div>

        {/* Row 2: Filter Pills (Wrapped Cleanly) + Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700/80 text-xs">
            <button
              type="button"
              onClick={() => setFilterType('ALL')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({totalSKUs})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('VARIANCES')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'VARIANCES'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Variances ({shortageCount + overageCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('SHORTAGES')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'SHORTAGES' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Shortages ({shortageCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('OVERAGES')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'OVERAGES'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Overages ({overageCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('MATCH')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'MATCH'
                  ? 'bg-slate-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Matched ({matchCount})
            </button>
            {flaggedCount > 0 && (
              <button
                type="button"
                onClick={() => setFilterType('FLAGGED')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  filterType === 'FLAGGED'
                    ? 'bg-purple-600 text-white'
                    : 'text-purple-400 hover:text-purple-200'
                }`}
              >
                Flagged Recounts ({flaggedCount})
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {session.status !== 'APPROVED_POSTED' && queuedRecountCount > 0 && onOpenBlindRecountSheet && (
              <button
                type="button"
                onClick={onOpenBlindRecountSheet}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-sm animate-pulse"
              >
                <EyeOff className="w-3.5 h-3.5" />
                Open Blind Recount Sheet ({queuedRecountCount})
              </button>
            )}
            {session.status !== 'APPROVED_POSTED' && (shortageCount + overageCount > 0 || selectedForRecount.length > 0) && (
              <button
                type="button"
                onClick={handleDispatchBlindRecount}
                className="px-3 py-1.5 bg-amber-600/90 hover:bg-amber-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-sm"
                title="Send selected SKUs (or all variance SKUs) to strict Blind Recount Sheet"
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                {selectedForRecount.length > 0
                  ? `Dispatch Selected (${selectedForRecount.length}) to Blind Sheet`
                  : 'Dispatch Variances to Blind Recount Sheet'}
              </button>
            )}
            <button
              type="button"
              onClick={onConsolidateAgain}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
              title="Refresh consolidation calculations from segment counts"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Recalculate
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export Variance CSV
            </button>
          </div>
        </div>
      </div>

      {/* Master Variance Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-800 border-b border-slate-700 text-slate-400 uppercase tracking-wider text-[10px]">
                {session.status !== 'APPROVED_POSTED' && (
                  <th className="py-3 px-2.5 text-center">Sel</th>
                )}
                <th className="py-3 px-3">
                  <button
                    type="button"
                    onClick={() => setSortBy(sortBy === 'NAME_ASC' ? 'DEFAULT' : 'NAME_ASC')}
                    className={`inline-flex items-center gap-1 hover:text-white transition ${sortBy === 'NAME_ASC' ? 'text-blue-300' : ''}`}
                    title="Sort by Item Name"
                  >
                    <span>SKU & Item Name</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-3 text-center">Packaging</th>
                <th className="py-3 px-3 text-right">System SOH</th>
                <th className="py-3 px-3 text-right">Original Count / Var</th>
                <th className="py-3 px-3 text-left">Recount Sheet</th>
                <th className="py-3 px-3 text-right">Net Physical Count</th>
                <th className="py-3 px-3 text-center">
                  <button
                    type="button"
                    onClick={() => setSortBy('ABS_UNITS_DESC')}
                    className={`inline-flex items-center gap-1 hover:text-white transition ${sortBy === 'ABS_UNITS_DESC' ? 'text-amber-300' : ''}`}
                    title="Sort by Largest Unit Variance"
                  >
                    <span>Unit Variance</span>
                    {sortBy === 'ABS_UNITS_DESC' ? <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3 opacity-60" />}
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setSortBy(
                        sortBy === 'ABS_COST_DESC'
                          ? 'COST_ASC'
                          : sortBy === 'COST_ASC'
                          ? 'COST_DESC'
                          : 'ABS_COST_DESC'
                      )
                    }
                    className={`inline-flex items-center gap-1 hover:text-white transition ${
                      sortBy === 'ABS_COST_DESC' || sortBy === 'COST_ASC' || sortBy === 'COST_DESC'
                        ? 'text-amber-300'
                        : ''
                    }`}
                    title="Click to cycle: Largest Abs ($) → Biggest Shortages ($) → Biggest Overages ($)"
                  >
                    <span>Cost Variance ($)</span>
                    {sortBy === 'COST_ASC' ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : sortBy === 'ABS_COST_DESC' || sortBy === 'COST_DESC' ? (
                      <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => setSortBy('ABS_RETAIL_DESC')}
                    className={`inline-flex items-center gap-1 hover:text-white transition ${sortBy === 'ABS_RETAIL_DESC' ? 'text-amber-300' : ''}`}
                    title="Sort by Largest Retail Variance ($)"
                  >
                    <span>Retail Variance ($)</span>
                    {sortBy === 'ABS_RETAIL_DESC' ? <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3 opacity-60" />}
                  </button>
                </th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-center">Actions & Recount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredItems.map((item, idx) => {
                const isExpanded = expandedItemId === item.itemId;
                const isEditing = editingSkuId === item.itemId;
                const upc = item.unitsPerCase || 1;
                const origUnits = item.originalCountedTotalUnits ?? item.countedTotalUnits;
                const origVar = item.originalVarianceTotalUnits ?? item.varianceTotalUnits;
                const isSelected = selectedForRecount.includes(item.itemId);

                return (
                  <React.Fragment key={`${item.itemId}-${idx}`}>
                    <tr
                      className={`hover:bg-slate-800/50 transition ${
                        item.recountReversalAlert
                          ? 'bg-rose-950/20'
                          : item.recountRequested
                          ? 'bg-purple-950/20'
                          : ''
                      }`}
                    >
                      {session.status !== 'APPROVED_POSTED' && (
                        <td className="py-2.5 px-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectForRecount(item.itemId)}
                            className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-600 text-purple-600"
                            title="Select for Blind Recount Sheet"
                          />
                        </td>
                      )}

                      {/* SKU & Name */}
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-white text-xs">{item.itemName}</div>
                        <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 mt-0.5">
                          <span className="text-slate-300">{item.sku}</span>
                          <span>•</span>
                          <span>{item.category}</span>
                        </div>
                      </td>

                      {/* Packaging */}
                      <td className="py-2.5 px-3 text-center text-slate-300 font-mono">
                        {upc} ea/cs
                      </td>

                      {/* System SOH */}
                      <td className="py-2.5 px-3 text-right font-mono">
                        <div className="font-bold text-slate-200">{item.systemTotalUnits} u</div>
                        <div className="text-[10px] text-slate-400">
                          {item.systemCases} cs + {item.systemSingles} ea
                        </div>
                      </td>

                      {/* Original Baseline Count & Variance */}
                      <td className="py-2.5 px-3 text-right font-mono">
                        <div className="font-semibold text-slate-300">{origUnits} u</div>
                        <div
                          className={`text-[10px] ${
                            origVar === 0 ? 'text-slate-500' : origVar < 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          Orig Var: {origVar > 0 ? `+${origVar}` : origVar} u
                        </div>
                      </td>

                      {/* Recount Sheet Separate Audit Column */}
                      <td className="py-2.5 px-3 text-left">
                        {item.recountSheetStatus === 'REQUESTED' || item.recountRequested ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700 inline-block">
                            QUEUED BLIND SHEET
                          </span>
                        ) : item.recountSheetStatus === 'COMPLETED' ? (
                          <div className="text-[10px] space-y-0.5">
                            <div className="font-mono font-bold text-purple-300">
                              Recount: {item.recountTotalUnits} u
                            </div>
                            <div className="text-slate-400 truncate max-w-[140px]">
                              By {item.recountedBy || 'Counter'}
                              {item.recountWitnessName ? ` + ${item.recountWitnessName}` : ''}
                            </div>
                            {item.recountReason && (
                              <div className="text-slate-500 italic truncate max-w-[140px]">
                                {item.recountReason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-600 font-mono">—</span>
                        )}
                      </td>

                      {/* Physical Count */}
                      <td className="py-2.5 px-3 text-right font-mono">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              min="0"
                              value={recountCases}
                              onChange={(e) => setRecountCases(Math.max(0, Number(e.target.value) || 0))}
                              className="w-10 text-center bg-slate-950 border border-slate-600 rounded px-1 py-0.5 text-xs text-white"
                              title="Recount Cases"
                            />
                            <span className="text-[10px] text-slate-400">cs</span>
                            <input
                              type="number"
                              min="0"
                              value={recountSingles}
                              onChange={(e) => setRecountSingles(Math.max(0, Number(e.target.value) || 0))}
                              className="w-10 text-center bg-slate-950 border border-slate-600 rounded px-1 py-0.5 text-xs text-white"
                              title="Recount Singles"
                            />
                            <span className="text-[10px] text-slate-400">ea</span>
                            <button
                              onClick={() => handleSaveRecount(item.itemId)}
                              className="p-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded ml-1"
                              title="Save verified recount"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="font-bold text-blue-400">{item.countedTotalUnits} u</div>
                            <div className="text-[10px] text-slate-400">
                              {item.countedCases} cs + {item.countedSingles} ea
                            </div>
                            {item.customerHeldStockUnits && item.customerHeldStockUnits > 0 ? (
                              <div className="text-[10px] text-amber-300 font-sans font-semibold mt-0.5">
                                -{item.customerHeldStockUnits} u customer hold ({item.adjustedPhysicalUnits} u true)
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>

                      {/* Unit Variance + Anti-Fraud Alert */}
                      <td className="py-2.5 px-3 text-center font-mono">
                        <div className="flex flex-col items-center gap-1">
                          {item.varianceTotalUnits === 0 ? (
                            <span className="text-slate-400 font-bold">0</span>
                          ) : item.varianceTotalUnits < 0 ? (
                            <span className="text-rose-400 font-extrabold bg-rose-950/60 border border-rose-800/40 px-2 py-0.5 rounded text-xs">
                              {item.varianceTotalUnits} u
                            </span>
                          ) : (
                            <span className="text-emerald-400 font-extrabold bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded text-xs">
                              +{item.varianceTotalUnits} u
                            </span>
                          )}
                          {item.recountReversalAlert && (
                            <span
                              className="text-[9px] font-sans font-bold px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-600/70 flex items-center gap-1"
                              title="Material shortage shrank >=50% during recount — verify audit trail"
                            >
                              <ShieldAlert className="w-2.5 h-2.5 text-rose-400" /> Zero-Out Fraud Alert
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cost Variance */}
                      <td className="py-2.5 px-3 text-right font-mono">
                        <span
                          className={`font-semibold ${
                            item.varianceCostValue === 0
                              ? 'text-slate-400'
                              : item.varianceCostValue < 0
                              ? 'text-rose-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {item.varianceCostValue >= 0 ? `+$` : `-$`}
                          {Math.abs(item.varianceCostValue).toFixed(2)}
                        </span>
                      </td>

                      {/* Retail Variance */}
                      <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                        {item.varianceRetailValue >= 0 ? `+$` : `-$`}
                        {Math.abs(item.varianceRetailValue).toFixed(2)}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 text-center">
                        {item.recountRequested ? (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 animate-pulse">
                            Recount Flagged
                          </span>
                        ) : item.status === 'MATCH' ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            Matched
                          </span>
                        ) : item.status === 'SHORTAGE' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                            Shortage
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                            Overage
                          </span>
                        )}
                      </td>

                      {/* Actions & Recount Option */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Segment Breakdown toggle */}
                          {item.segmentBreakdown && item.segmentBreakdown.length > 0 && (
                            <button
                              onClick={() => setExpandedItemId(isExpanded ? null : item.itemId)}
                              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition text-[11px] flex items-center gap-0.5"
                              title="Show segment contributions"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          {/* Secondary Recount Action Button */}
                          {session.status !== 'APPROVED_POSTED' && (
                            <>
                              <button
                                onClick={() => handleStartRecount(item)}
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 text-[11px] font-medium flex items-center gap-1 transition"
                                title="Enter verified floor recount"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Recount
                              </button>
                              {!item.recountRequested && item.varianceTotalUnits !== 0 && (
                                <button
                                  onClick={() => onRequestSkuRecount(item.itemId, 'Floor recount requested.')}
                                  className="p-1 rounded text-slate-400 hover:text-purple-400 hover:bg-slate-800 transition"
                                  title="Flag for second recount"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Segment Breakdown Expandable Row */}
                    {isExpanded && item.segmentBreakdown && item.segmentBreakdown.length > 0 && (
                      <tr className="bg-slate-950/60">
                        <td colSpan={session.status !== 'APPROVED_POSTED' ? 12 : 11} className="py-2.5 px-6 border-b border-slate-800">
                          <div className="text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-blue-400" />
                            Segment Contributions for {item.itemName}:
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {item.segmentBreakdown.map((sb, sbIdx) => (
                              <div
                                key={`${sb.segmentId}-${sbIdx}`}
                                className="p-2 bg-slate-900 rounded border border-slate-800 text-[11px] flex items-center justify-between"
                              >
                                <span className="text-slate-300">{sb.segmentName}:</span>
                                <span className="font-mono font-bold text-white">
                                  {sb.totalUnits} units ({sb.cases} cs + {sb.singles} ea)
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={session.status !== 'APPROVED_POSTED' ? 12 : 11} className="py-12 text-center text-slate-400 text-xs">
                    {consolidated.length === 0 ? (
                      <div className="max-w-md mx-auto space-y-3">
                        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                        <div className="font-semibold text-white text-sm">No Consolidated Counts Yet</div>
                        <p className="text-slate-400 text-xs leading-relaxed">
                          {verifiedSegmentsCount > 0
                            ? `${verifiedSegmentsCount} of ${totalSegmentsCount} zone(s) have been verified. Tap below to consolidate their physical counts against book inventory.`
                            : 'No zones are verified yet. When two counters match or complete a Joint Shelf Recount, verified counts automatically appear here.'}
                        </p>
                        {verifiedSegmentsCount > 0 && (
                          <button
                            type="button"
                            onClick={onConsolidateAgain}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-lg transition active:scale-95"
                          >
                            <RotateCcw className="w-4 h-4" />
                            <span>Consolidate {verifiedSegmentsCount} Verified Zone(s)</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      'No items match the current search or filter.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
