import React, { useState } from 'react';
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
}

export const ConsolidatedVarianceView: React.FC<ConsolidatedVarianceViewProps> = ({
  session,
  currentUser,
  onRequestSkuRecount,
  onSubmitSkuRecount,
  onConsolidateAgain,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'VARIANCES' | 'SHORTAGES' | 'OVERAGES' | 'MATCH' | 'FLAGGED'>('ALL');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Active SKU being recounted inline
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
  const [recountCases, setRecountCases] = useState<number>(0);
  const [recountSingles, setRecountSingles] = useState<number>(0);

  const consolidated = session.consolidatedItems || [];

  // Filter items
  const q = (searchQuery || '').trim().toLowerCase();
  const filteredItems = consolidated.filter((item) => {
    const matchesSearch =
      q === '' ||
      (item.itemName && item.itemName.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.barcode && item.barcode.includes(searchQuery));

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

  const totalSKUs = consolidated.length;
  const matchCount = consolidated.filter((i) => i.varianceTotalUnits === 0).length;
  const shortageCount = consolidated.filter((i) => i.varianceTotalUnits < 0).length;
  const overageCount = consolidated.filter((i) => i.varianceTotalUnits > 0).length;
  const flaggedCount = consolidated.filter((i) => i.recountRequested).length;

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
      'Counted (Cases)',
      'Counted (Singles)',
      'Counted Total Units',
      'Counted Cost Value ($)',
      'Variance Units',
      'Variance Cost Value ($)',
      'Variance Retail Value ($)',
      'Status',
    ];

    const rows = consolidated.map((i) => [
      `"${i.sku}"`,
      `"${i.itemName.replace(/"/g, '""')}"`,
      `"${i.category}"`,
      i.unitsPerCase,
      i.costPerUnit.toFixed(2),
      i.sellPriceUnit.toFixed(2),
      i.systemCases,
      i.systemSingles,
      i.systemTotalUnits,
      i.systemCostValue.toFixed(2),
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

  return (
    <div className="space-y-4">
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

      {/* Action Toolbar & Filters */}
      <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search variance items by SKU, name, barcode..."
              className="w-full pl-9 pr-4 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700/80 text-xs">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'ALL' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({totalSKUs})
            </button>
            <button
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
              onClick={() => setFilterType('SHORTAGES')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'SHORTAGES' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Shortages ({shortageCount})
            </button>
            <button
              onClick={() => setFilterType('OVERAGES')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === 'OVERAGES'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Overages ({overageCount})
            </button>
            {flaggedCount > 0 && (
              <button
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
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onConsolidateAgain}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
            title="Refresh consolidation calculations from segment counts"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Recalculate
          </button>
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Export Variance CSV
          </button>
        </div>
      </div>

      {/* Master Variance Table */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-800 border-b border-slate-700 text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="py-3 px-3">SKU & Item Name</th>
                <th className="py-3 px-3 text-center">Packaging</th>
                <th className="py-3 px-3 text-right">System SOH</th>
                <th className="py-3 px-3 text-right">Physical Count</th>
                <th className="py-3 px-3 text-center">Unit Variance</th>
                <th className="py-3 px-3 text-right">Cost Variance ($)</th>
                <th className="py-3 px-3 text-right">Retail Variance ($)</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-center">Actions & Recount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredItems.map((item) => {
                const isExpanded = expandedItemId === item.itemId;
                const isEditing = editingSkuId === item.itemId;
                const upc = item.unitsPerCase || 1;

                return (
                  <React.Fragment key={item.itemId}>
                    <tr
                      className={`hover:bg-slate-800/50 transition ${
                        item.recountRequested ? 'bg-purple-950/20' : ''
                      }`}
                    >
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
                          </>
                        )}
                      </td>

                      {/* Unit Variance */}
                      <td className="py-2.5 px-3 text-center font-mono">
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
                        <td colSpan={9} className="py-2.5 px-6 border-b border-slate-800">
                          <div className="text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-blue-400" />
                            Segment Contributions for {item.itemName}:
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {item.segmentBreakdown.map((sb) => (
                              <div
                                key={sb.segmentId}
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
                  <td colSpan={9} className="py-8 text-center text-slate-400 text-xs">
                    No items match the current search or filter.
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
