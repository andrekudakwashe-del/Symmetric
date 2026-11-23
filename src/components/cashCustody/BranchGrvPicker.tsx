import React, { useState, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Building2,
  Package,
  CheckCircle2,
  FileText,
  Calendar,
  User,
} from 'lucide-react';
import { UnpaidGrvRecord } from '../../services/cashCustodyService';

interface BranchGrvPickerProps {
  unpaidGrvs: UnpaidGrvRecord[];
  selectedGrvId: string;
  selectedSupplierName?: string;
  selectedAmount?: string;
  defaultBranchId?: string;
  defaultShowAllBranches?: boolean;
  accentColor?: 'emerald' | 'amber';
  onSelectGrv: (grv: UnpaidGrvRecord) => void;
  onClearSelection: () => void;
}

export const BranchGrvPicker: React.FC<BranchGrvPickerProps> = ({
  unpaidGrvs,
  selectedGrvId,
  selectedSupplierName,
  selectedAmount,
  defaultBranchId,
  defaultShowAllBranches = false,
  accentColor = 'emerald',
  onSelectGrv,
  onClearSelection,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>(() => {
    if (defaultShowAllBranches) return 'ALL';
    if (defaultBranchId && unpaidGrvs.some((g) => g.branchId === defaultBranchId)) {
      return defaultBranchId;
    }
    return 'ALL';
  });
  const [collapsedBranches, setCollapsedBranches] = useState<Record<string, boolean>>({});
  const [expandedGrvIds, setExpandedGrvIds] = useState<Record<string, boolean>>({});

  // Unique branches across unpaid GRVs
  const branchOptions = useMemo(() => {
    const map = new Map<string, { branchId: string; branchName: string; count: number; total: number }>();
    unpaidGrvs.forEach((g) => {
      const bId = g.branchId || 'BR-MAIN';
      const bName = g.branchName || 'Main Branch';
      const existing = map.get(bId);
      if (existing) {
        existing.count += 1;
        existing.total = Math.round((existing.total + g.totalCost) * 100) / 100;
      } else {
        map.set(bId, { branchId: bId, branchName: bName, count: 1, total: g.totalCost });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (defaultBranchId && a.branchId === defaultBranchId) return -1;
      if (defaultBranchId && b.branchId === defaultBranchId) return 1;
      return a.branchName.localeCompare(b.branchName);
    });
  }, [unpaidGrvs, defaultBranchId]);

  const filteredGrvs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return unpaidGrvs.filter((g) => {
      if (selectedBranchFilter !== 'ALL' && g.branchId !== selectedBranchFilter) {
        return false;
      }
      if (!q) return true;
      const itemMatch = (g.items || []).some((it) =>
        (it.productName || '').toLowerCase().includes(q)
      );
      return (
        g.grvNumber.toLowerCase().includes(q) ||
        (g.supplierName || '').toLowerCase().includes(q) ||
        (g.invoiceNo || '').toLowerCase().includes(q) ||
        (g.branchName || '').toLowerCase().includes(q) ||
        (g.id || '').toLowerCase().includes(q) ||
        g.totalCost.toFixed(2).includes(q) ||
        g.totalCost.toString().includes(q) ||
        itemMatch
      );
    });
  }, [unpaidGrvs, selectedBranchFilter, searchQuery]);

  // Group filtered GRVs by Branch
  const groupedByBranch = useMemo(() => {
    const groups = new Map<string, { branchId: string; branchName: string; grvs: UnpaidGrvRecord[]; subtotal: number }>();
    filteredGrvs.forEach((g) => {
      const bId = g.branchId || 'BR-MAIN';
      const bName = g.branchName || 'Main Branch';
      if (!groups.has(bId)) {
        groups.set(bId, { branchId: bId, branchName: bName, grvs: [], subtotal: 0 });
      }
      const grp = groups.get(bId)!;
      grp.grvs.push(g);
      grp.subtotal = Math.round((grp.subtotal + g.totalCost) * 100) / 100;
    });
    return Array.from(groups.values()).sort((a, b) => {
      if (defaultBranchId && a.branchId === defaultBranchId) return -1;
      if (defaultBranchId && b.branchId === defaultBranchId) return 1;
      return a.branchName.localeCompare(b.branchName);
    });
  }, [filteredGrvs, defaultBranchId]);

  const selectedGrvObj = useMemo(
    () => unpaidGrvs.find((g) => g.grvNumber === selectedGrvId || g.id === selectedGrvId),
    [unpaidGrvs, selectedGrvId]
  );

  const toggleBranchCollapse = (branchId: string) => {
    setCollapsedBranches((prev) => ({ ...prev, [branchId]: !prev[branchId] }));
  };

  const toggleGrvItems = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedGrvIds((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const focusBorder = accentColor === 'amber' ? 'focus:border-amber-500' : 'focus:border-emerald-500';

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-xs font-semibold text-slate-300">
          Linked Goods Received Voucher (GRV) *
        </label>
        <span className="text-[10px] text-emerald-400 font-mono shrink-0">
          {filteredGrvs.length} of {unpaidGrvs.length} voucher{unpaidGrvs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Branch Filter Pills */}
      {branchOptions.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          <button
            type="button"
            onClick={() => setSelectedBranchFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 transition border ${
              selectedBranchFilter === 'ALL'
                ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            All Branches ({unpaidGrvs.length})
          </button>
          {branchOptions.map((b) => (
            <button
              key={b.branchId}
              type="button"
              onClick={() => setSelectedBranchFilter(b.branchId)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 transition border flex items-center gap-1.5 ${
                selectedBranchFilter === b.branchId
                  ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3 h-3 opacity-80" />
              <span>{b.branchName}</span>
              <span className="text-[10px] font-mono opacity-80">({b.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Clean Search Input (no duplicate icon/emoji) */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search GRV #, supplier, product, branch, amount..."
          className={`w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none ${focusBorder} font-medium`}
        />
      </div>

      {/* Selected GRV Banner */}
      {selectedGrvId && (
        <div className="p-2.5 bg-emerald-950/70 border border-emerald-500/50 rounded-xl space-y-2 animate-fadeIn">
          <div className="flex items-start justify-between gap-2 text-xs">
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-mono font-bold text-emerald-300">{selectedGrvId}</span>
                {selectedGrvObj?.branchName && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-900/80 border border-emerald-500/30 text-[10px] text-emerald-200 font-medium">
                    {selectedGrvObj.branchName}
                  </span>
                )}
              </div>
              <div className="flex items-center flex-wrap gap-2 mt-1">
                <span className="text-white font-semibold truncate">
                  {selectedGrvObj?.supplierName || selectedSupplierName}
                </span>
                <span className="text-emerald-400 font-mono font-bold">
                  ${parseFloat(selectedAmount || String(selectedGrvObj?.totalCost || 0)).toFixed(2)}
                  {selectedGrvObj?.originalTotalCost && selectedGrvObj.originalTotalCost > selectedGrvObj.totalCost && (
                    <span className="ml-1.5 text-[10px] font-medium text-amber-300">
                      (Balance of ${selectedGrvObj.originalTotalCost.toFixed(2)}
                      {selectedGrvObj.tillPaidAmount ? ` · $${selectedGrvObj.tillPaidAmount.toFixed(2)} paid at Till` : ''})
                    </span>
                  )}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold underline shrink-0"
            >
              Change
            </button>
          </div>
          {selectedGrvObj && selectedGrvObj.items && selectedGrvObj.items.length > 0 && (
            <div className="pt-1.5 border-t border-emerald-500/20">
              <div className="text-[10px] text-emerald-300/80 font-semibold mb-1">
                Purchased Items ({selectedGrvObj.items.length}):
              </div>
              <div className="space-y-0.5 max-h-24 overflow-y-auto pr-1">
                {selectedGrvObj.items.map((it, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[10px] text-slate-200 gap-2">
                    <span className="truncate">
                      {it.productName}{' '}
                      <span className="text-slate-400 font-mono">
                        ({it.qty} {it.unit || 'u'} × ${it.unitCost.toFixed(2)})
                      </span>
                    </span>
                    <span className="font-mono font-semibold text-emerald-300 shrink-0">
                      ${it.lineTotal.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Branch-Grouped GRV Accordion List */}
      <div className="max-h-72 overflow-y-auto space-y-2 p-1.5 bg-slate-950/70 rounded-xl border border-slate-800">
        {unpaidGrvs.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">
            No pending unpaid GRVs found (all deliveries settled).
          </div>
        ) : groupedByBranch.length === 0 ? (
          <div className="p-3 text-center text-xs text-amber-300 bg-amber-950/30 rounded-lg border border-amber-800/40">
            No pending GRVs match "{searchQuery}".
          </div>
        ) : (
          groupedByBranch.map((group) => {
            const isCollapsed = Boolean(collapsedBranches[group.branchId]);
            return (
              <div key={group.branchId} className="rounded-xl border border-slate-800/90 bg-slate-900/50 overflow-hidden">
                {/* Branch Group Header */}
                <button
                  type="button"
                  onClick={() => toggleBranchCollapse(group.branchId)}
                  className="w-full px-3 py-2 bg-slate-900/95 hover:bg-slate-800/80 flex items-center justify-between gap-2 text-left transition border-b border-slate-800/80"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="text-xs font-bold text-white truncate">{group.branchName}</span>
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-[10px] font-mono text-slate-300 shrink-0">
                      {group.grvs.length} GRV{group.grvs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 shrink-0">
                    ${group.subtotal.toFixed(2)}
                  </span>
                </button>

                {/* Branch GRV Items */}
                {!isCollapsed && (
                  <div className="p-1.5 space-y-1.5">
                    {group.grvs.map((g, idx) => {
                      const grvKey = `${g.id || g.grvNumber}-${idx}`;
                      const isSelected = selectedGrvId === g.grvNumber || selectedGrvId === g.id;
                      const isExpanded = Boolean(expandedGrvIds[grvKey]);
                      const itemsList = g.items || [];

                      return (
                        <div
                          key={grvKey}
                          className={`rounded-xl border transition overflow-hidden ${
                            isSelected
                              ? 'bg-emerald-900/35 border-emerald-500 shadow-md'
                              : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          {/* Main Card Row */}
                          <div
                            onClick={() => onSelectGrv(g)}
                            className="p-2.5 cursor-pointer flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center flex-wrap gap-1.5">
                                <span className="font-mono font-bold text-emerald-400 text-xs">
                                  {g.grvNumber}
                                </span>
                                <span className="text-xs text-white font-semibold truncate">
                                  {g.supplierName}
                                </span>
                              </div>
                              <div className="flex items-center flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                  <FileText className="w-2.5 h-2.5 opacity-70" />
                                  {g.invoiceNo ? `Inv: ${g.invoiceNo}` : 'Direct delivery'}
                                </span>
                                {g.date && (
                                  <span className="inline-flex items-center gap-1 font-mono">
                                    <Calendar className="w-2.5 h-2.5 opacity-70" />
                                    {g.date}
                                  </span>
                                )}
                                {g.receivedByStaffName && (
                                  <span className="inline-flex items-center gap-1 truncate max-w-[140px]">
                                    <User className="w-2.5 h-2.5 opacity-70" />
                                    {g.receivedByStaffName}
                                  </span>
                                )}
                              </div>
                              {g.originalTotalCost && g.originalTotalCost > g.totalCost && (
                                <div className="inline-flex items-center flex-wrap gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-200 font-medium">
                                  {g.tillPaidAmount && g.tillPaidAmount > 0 ? (
                                    <span>Paid ${g.tillPaidAmount.toFixed(2)} at Till</span>
                                  ) : null}
                                  {g.custodyPaidAmount && g.custodyPaidAmount > 0 ? (
                                    <span>
                                      {g.tillPaidAmount && g.tillPaidAmount > 0 ? '· ' : ''}
                                      Paid ${g.custodyPaidAmount.toFixed(2)} from Safe
                                    </span>
                                  ) : null}
                                  <span className="text-slate-400 font-mono">
                                    · Balance of ${g.originalTotalCost.toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="text-right shrink-0 flex flex-col items-end gap-1">
                              <div className="font-mono font-bold text-white text-xs">
                                ${g.totalCost.toFixed(2)}
                              </div>
                              {g.originalTotalCost && g.originalTotalCost > g.totalCost && (
                                <div className="text-[9px] font-mono text-amber-300 uppercase tracking-wide">
                                  Balance Due
                                </div>
                              )}
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                  isSelected
                                    ? 'bg-emerald-500 text-slate-950 font-bold'
                                    : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                }`}
                              >
                                {isSelected ? 'Selected' : 'Select'}
                              </span>
                            </div>
                          </div>

                          {/* Expandable "View Purchased Items" Footer */}
                          <div className="px-2.5 py-1.5 bg-slate-900/60 border-t border-slate-800/70 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={(e) => toggleGrvItems(grvKey, e)}
                              className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 transition"
                            >
                              <Package className="w-3 h-3" />
                              <span>
                                {isExpanded ? 'Hide' : 'View'} Purchased Items ({itemsList.length || g.itemsCount})
                              </span>
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {g.sourceType === 'DIRECT_GRV'
                                ? 'Direct Procurement'
                                : g.sourceType === 'SUPPLIER_VOUCHER'
                                ? 'Supplier Invoice'
                                : 'GRN'}
                            </span>
                          </div>

                          {/* Expanded Purchased Items Dropdown Table */}
                          {isExpanded && (
                            <div className="px-2.5 py-2 bg-slate-950 border-t border-slate-800 space-y-1 animate-fadeIn">
                              {itemsList.length === 0 ? (
                                <div className="text-[10px] text-slate-500 italic py-1">
                                  No itemized product breakdown stored on this legacy GRV.
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <div className="grid grid-cols-12 text-[9px] uppercase tracking-wider text-slate-500 font-bold pb-1 border-b border-slate-800/80">
                                    <span className="col-span-6">Product</span>
                                    <span className="col-span-2 text-right">Qty</span>
                                    <span className="col-span-2 text-right">Unit</span>
                                    <span className="col-span-2 text-right">Total</span>
                                  </div>
                                  {itemsList.map((item, iIdx) => (
                                    <div
                                      key={iIdx}
                                      className="grid grid-cols-12 items-center text-[11px] py-0.5 border-b border-slate-900 last:border-b-0"
                                    >
                                      <span className="col-span-6 text-slate-200 font-medium truncate pr-1">
                                        {item.productName}
                                      </span>
                                      <span className="col-span-2 text-right font-mono text-slate-300 text-[10px]">
                                        {item.qty}
                                      </span>
                                      <span className="col-span-2 text-right font-mono text-slate-400 text-[10px]">
                                        ${item.unitCost.toFixed(2)}
                                      </span>
                                      <span className="col-span-2 text-right font-mono font-bold text-emerald-400 text-[10px]">
                                        ${item.lineTotal.toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
