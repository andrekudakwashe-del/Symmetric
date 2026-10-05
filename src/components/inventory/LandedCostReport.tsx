import React, { useState, useMemo } from 'react';
import {
  Truck,
  Calendar,
  Building2,
  Filter,
  Download,
  Search,
  Sparkles,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import { GoodsReceivedNote, Branch, LandedCostItem } from '../../types';
import { getAllGoodsReceivedNotes } from '../../db/goodsReceivedNotes';
import { getBranches } from '../../db/roomDatabase';

interface LandedCostReportProps {
  onViewVoucher?: (voucherIdOrInvoiceNo: string) => void;
  onGoToGRN?: () => void;
}

export const LandedCostReport: React.FC<LandedCostReportProps> = ({
  onViewVoucher,
  onGoToGRN,
}) => {
  const [branches] = useState<Branch[]>(() => getBranches());
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [period, setPeriod] = useState<'today' | '7days' | '30days' | 'all'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'by_margin' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedGrnId, setExpandedGrnId] = useState<string | null>(null);

  const allGrns = useMemo(() => {
    return getAllGoodsReceivedNotes();
  }, []);

  // Filter GRNs by date period, branch, and landed cost criteria
  const filteredGrnsWithLandedCosts = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const d7 = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    return allGrns.filter((grn) => {
      // Must have landed costs
      if (!grn.landedCosts || grn.landedCosts.length === 0) return false;
      const totalAmount = grn.landedCosts.reduce((s, lc) => s + (Number(lc.amount) || 0), 0);
      if (totalAmount <= 0) return false;

      // Branch filter
      if (selectedBranchId !== 'ALL') {
        const br = grn.branch_id || grn.branchId;
        if (br !== selectedBranchId) return false;
      }

      // Period filter
      const grnDate = grn.dateReceived || grn.createdAt.slice(0, 10);
      if (period === 'today' && grnDate !== today) return false;
      if (period === '7days' && grnDate < d7) return false;
      if (period === '30days' && grnDate < d30) return false;

      // Method filter
      const hasMargin = grn.landedCosts.some((lc) => lc.allocationMethod === 'by_margin');
      if (methodFilter === 'by_margin' && !hasMargin) return false;
      if (methodFilter === 'other' && hasMargin) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNo = grn.grnNumber.toLowerCase().includes(q) || grn.id.toLowerCase().includes(q);
        const matchesSupplier = grn.suppliers.some((s) => s.toLowerCase().includes(q));
        const matchesItem = grn.lineItems.some((li) => li.itemName.toLowerCase().includes(q) || li.itemId.toLowerCase().includes(q));
        const matchesReason = grn.landedCosts.some((lc) => (lc.allocationReason || '').toLowerCase().includes(q));
        if (!matchesNo && !matchesSupplier && !matchesItem && !matchesReason) return false;
      }

      return true;
    });
  }, [allGrns, selectedBranchId, period, methodFilter, searchQuery]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let countTotalGrns = 0;
    let countByMarginGrns = 0;
    let totalLandedCostAmount = 0;
    let totalByMarginAmount = 0;
    let totalShiftVariance = 0;

    for (const grn of filteredGrnsWithLandedCosts) {
      countTotalGrns++;
      const hasMargin = grn.landedCosts.some((lc) => lc.allocationMethod === 'by_margin');
      if (hasMargin) countByMarginGrns++;

      for (const lc of grn.landedCosts) {
        const amt = Number(lc.amount) || 0;
        totalLandedCostAmount += amt;
        if (lc.allocationMethod === 'by_margin') {
          totalByMarginAmount += amt;

          // Compute absolute shift difference
          if (lc.standardAllocation && lc.allocatedAmount) {
            for (const key of Object.keys(lc.standardAllocation)) {
              const std = lc.standardAllocation[key] || 0;
              const act = lc.allocatedAmount[key] || 0;
              totalShiftVariance += Math.abs(act - std);
            }
          }
        }
      }
    }

    return {
      countTotalGrns,
      countByMarginGrns,
      totalLandedCostAmount,
      totalByMarginAmount,
      // Divide by 2 because each dollar shifted from item A to item B gives +$1 and -$1 (sum of abs = 2)
      totalShiftVariance: totalShiftVariance / 2,
    };
  }, [filteredGrnsWithLandedCosts]);

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Date',
      'GRN Number',
      'Branch',
      'Supplier',
      'Landed Cost Description',
      'Amount ($)',
      'Allocation Method',
      'Margin Basis',
      'Reason',
      'Item Code',
      'Item Name',
      'Quantity',
      'Unit Cost ($)',
      'Selling Price ($)',
      'Standard Alloc ($)',
      'Actual Alloc ($)',
      'Difference ($)',
    ];

    const csvRows: (string | number)[][] = [];

    for (const grn of filteredGrnsWithLandedCosts) {
      for (const lc of grn.landedCosts) {
        for (const li of grn.lineItems) {
          const itemId = li.itemId;
          const std = lc.standardAllocation?.[itemId] ?? 0;
          const act = lc.allocatedAmount?.[itemId] ?? (li.landedCostAllocated ?? 0);
          const diff = Number((act - std).toFixed(2));

          csvRows.push([
            grn.dateReceived,
            `"${grn.grnNumber}"`,
            `"${grn.branchName || grn.branchId || 'Main'}"`,
            `"${grn.suppliers.join(', ')}"`,
            `"${lc.description}"`,
            Number(lc.amount).toFixed(2),
            lc.allocationMethod,
            lc.marginBasis || 'N/A',
            `"${(lc.allocationReason || '').replace(/"/g, '""')}"`,
            `"${li.itemId}"`,
            `"${li.itemName}"`,
            li.quantity,
            li.unitCost.toFixed(2),
            (li.sellingPrice || 0).toFixed(2),
            std.toFixed(2),
            act.toFixed(2),
            diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2),
          ]);
        }
      }
    }

    const csvContent = [headers.join(','), ...csvRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Landed_Cost_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Top Header Card */}
      <div className="p-5 rounded-2xl bg-slate-850 border border-slate-800 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Truck className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Landed Cost Allocation Report
                  <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800 font-semibold">
                    Freight, Duty & Margin Overrides
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Audit and analyze landed costs, standard vs management override allocations, and margin capacity impacts.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={filteredGrnsWithLandedCosts.length === 0}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-all shadow"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              Export CSV
            </button>
            {onGoToGRN && (
              <button
                onClick={onGoToGRN}
                className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow"
              >
                + Receive Delivery
              </button>
            )}
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center gap-3">
          {/* Period selector */}
          <div className="flex items-center bg-slate-900 rounded-xl p-1 border border-slate-750 text-xs">
            <button
              onClick={() => setPeriod('today')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                period === 'today' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setPeriod('7days')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                period === '7days' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Last 7 Days
            </button>
            <button
              onClick={() => setPeriod('30days')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                period === '30days' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setPeriod('all')}
              className={`px-3 py-1 rounded-lg font-medium transition-all ${
                period === 'all' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Time
            </button>
          </div>

          {/* Branch filter */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-750 rounded-xl px-2.5 py-1 text-xs">
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-transparent text-white focus:outline-none"
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b.branchId} value={b.branchId}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Method filter */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-750 rounded-xl px-2.5 py-1 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as any)}
              className="bg-transparent text-white focus:outline-none"
            >
              <option value="all">All Allocation Methods</option>
              <option value="by_margin">By Margin Capacity (Overrides Only)</option>
              <option value="other">Standard Methods (Value, Qty, Weight)</option>
            </select>
          </div>

          {/* Search bar */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search GRN, supplier, reason, item..."
              className="w-full bg-slate-900 border border-slate-750 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
            GRNs with Landed Cost
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-white">
              {metrics.countTotalGrns}
            </span>
            <span className="text-xs text-slate-500">deliveries</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30">
          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider block flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Using By Margin Capacity
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-amber-300">
              {metrics.countByMarginGrns}
            </span>
            <span className="text-xs text-amber-400/70">management overrides</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
            Total Landed Cost Allocated
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-emerald-400">
              ${metrics.totalLandedCostAmount.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
            Total Allocated via Margin Capacity
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-amber-400">
              ${metrics.totalByMarginAmount.toFixed(2)}
            </span>
            {metrics.totalShiftVariance > 0 && (
              <span className="text-[10px] text-amber-300 font-mono" title="Gross dollars redistributed from low-margin to high-margin goods">
                (${metrics.totalShiftVariance.toFixed(2)} shifted)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-850 overflow-hidden shadow-lg">
        {filteredGrnsWithLandedCosts.length === 0 ? (
          <div className="py-16 text-center">
            <Truck className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="font-semibold text-slate-300">No Landed Costs Found</p>
            <p className="text-xs text-slate-500 mt-1">
              Add freight or duty lines during delivery receiving to generate landed cost allocation records.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-300 font-bold border-b border-slate-800">
                  <th className="py-3 px-3 w-8"></th>
                  <th className="py-3 px-3">Date / Branch</th>
                  <th className="py-3 px-3">GRN / Invoice #</th>
                  <th className="py-3 px-3">Supplier</th>
                  <th className="py-3 px-3 text-right">Landed Cost ($)</th>
                  <th className="py-3 px-3">Allocation Method</th>
                  <th className="py-3 px-3">Reason / Override Basis</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredGrnsWithLandedCosts.map((grn) => {
                  const isExpanded = expandedGrnId === grn.id;
                  const totalLc = grn.landedCosts.reduce((s, lc) => s + (Number(lc.amount) || 0), 0);
                  const marginLc = grn.landedCosts.find((lc) => lc.allocationMethod === 'by_margin');

                  return (
                    <React.Fragment key={grn.id}>
                      <tr className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => setExpandedGrnId(isExpanded ? null : grn.id)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                            title={isExpanded ? 'Collapse breakdown' : 'Expand item-by-item breakdown'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-slate-200 block">{grn.dateReceived}</span>
                          <span className="text-[10px] text-slate-400 block">{grn.branchName || 'Main Branch'}</span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-white">
                          {grn.grnNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {grn.suppliers.join(', ')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                          ${totalLc.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3">
                          {marginLc ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500/40 flex items-center gap-1 w-fit">
                              <Sparkles className="w-2.5 h-2.5" />
                              By Margin Capacity
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700 w-fit block">
                              {grn.landedCosts.map((lc) => lc.allocationMethod.replace('_', ' ')).join(', ')}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 max-w-xs truncate">
                          {marginLc ? (
                            <span>
                              <span className="font-semibold text-amber-300">
                                {marginLc.marginBasis === 'margin_percent' ? 'Margin % Basis: ' : 'Profit Basis: '}
                              </span>
                              {marginLc.allocationReason || 'Manager override'}
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">Standard pro-rata</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setExpandedGrnId(isExpanded ? null : grn.id)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                            >
                              {isExpanded ? 'Hide' : 'Breakdown'}
                            </button>
                            {onViewVoucher && (
                              <button
                                type="button"
                                onClick={() => onViewVoucher(grn.grnNumber || grn.id)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-800 text-emerald-300 text-xs font-semibold border border-emerald-700/40"
                              >
                                Voucher
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Item-by-Item Breakdown Table */}
                      {isExpanded && (
                        <tr className="bg-slate-900/90 border-y border-slate-800">
                          <td colSpan={8} className="p-4 pl-12">
                            <div className="space-y-3">
                              {grn.landedCosts.map((lc, lcIdx) => (
                                <div key={lcIdx} className="bg-slate-950/80 rounded-xl p-3 border border-slate-800">
                                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-white text-xs">
                                        {lc.description} (${Number(lc.amount).toFixed(2)})
                                      </span>
                                      <span className="text-[10px] text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40 font-mono">
                                        Method: {lc.allocationMethod}
                                      </span>
                                    </div>
                                    {lc.allocationReason && (
                                      <div className="text-xs text-amber-300/90">
                                        <span className="font-semibold text-slate-400">Reason: </span>
                                        {lc.allocationReason}
                                      </div>
                                    )}
                                  </div>

                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className="text-slate-400 font-semibold border-b border-slate-800">
                                        <th className="py-1.5 px-2">Line Item</th>
                                        <th className="py-1.5 px-2 text-right">Unit Cost</th>
                                        <th className="py-1.5 px-2 text-right">Selling Price</th>
                                        <th className="py-1.5 px-2 text-right">Standard (By Value)</th>
                                        <th className="py-1.5 px-2 text-right">As Allocated</th>
                                        <th className="py-1.5 px-2 text-right">Difference</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-850 font-mono text-slate-300">
                                      {grn.lineItems.map((li, liIdx) => {
                                        const std = lc.standardAllocation?.[li.itemId] ?? 0;
                                        const act = lc.allocatedAmount?.[li.itemId] ?? (li.landedCostAllocated ?? 0);
                                        const diff = Number((act - std).toFixed(2));

                                        return (
                                          <tr key={liIdx} className="hover:bg-slate-900">
                                            <td className="py-1 px-2 font-sans font-medium text-slate-200">
                                              {li.itemName}{' '}
                                              <span className="text-[10px] text-slate-500 font-mono">
                                                ({li.itemId})
                                              </span>
                                            </td>
                                            <td className="py-1 px-2 text-right">${li.unitCost.toFixed(2)}</td>
                                            <td className="py-1 px-2 text-right">
                                              {li.sellingPrice ? `$${li.sellingPrice.toFixed(2)}` : '-'}
                                            </td>
                                            <td className="py-1 px-2 text-right font-medium text-slate-400">
                                              ${std.toFixed(2)}
                                            </td>
                                            <td className="py-1 px-2 text-right font-bold text-amber-300">
                                              ${act.toFixed(2)}
                                            </td>
                                            <td
                                              className={`py-1 px-2 text-right font-bold ${
                                                diff > 0
                                                  ? 'text-rose-400'
                                                  : diff < 0
                                                  ? 'text-emerald-400'
                                                  : 'text-slate-500'
                                              }`}
                                            >
                                              {diff > 0 ? `+$${diff.toFixed(2)}` : diff < 0 ? `-$${Math.abs(diff).toFixed(2)}` : '$0.00'}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
