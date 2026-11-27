import React, { useMemo, useState } from 'react';
import {
  X,
  Search,
  AlertTriangle,
  DollarSign,
  Edit2,
  RefreshCw,
  CheckCircle2,
  TrendingUp,
  RotateCcw,
} from 'lucide-react';
import { InventoryItem } from '../../types';
import {
  analyzeItemValuation,
  formatUnitCost,
  ItemValuationAudit,
  reconcileStockValueCents,
  roundUnitCost,
} from '../../utils/inventoryMath';
import { saveInventoryItem } from '../../db/roomDatabase';
import { meshSyncService } from '../../services/meshSyncService';

interface ValuationAuditModalProps {
  isOpen: boolean;
  items: InventoryItem[];
  canManageInventory: boolean;
  onClose: () => void;
  onEditItem: (item: InventoryItem) => void;
  onReconciled: (updatedCount: number) => void;
}

type AuditTab = 'TOP_VALUE' | 'DIVERGENT' | 'ANOMALIES';

/**
 * Determines whether a flagged SKU has a stale MWAC (`averageCostPerUnit`)
 * that can be cleanly reset to its verified Latest Unit Cost (`costPerUnit` or `costPerCase / unitsPerCase`).
 */
const resolveCleanLatestUnitCost = (audit: ItemValuationAudit): number => {
  if (audit.rawCostPerUnit > 0) {
    // If multi-unit costPerUnit equals costPerCase above sellPrice, derive from case cost
    if (
      audit.unitsPerCase > 1 &&
      audit.rawCostPerCase > 0 &&
      Math.abs(audit.rawCostPerUnit - audit.rawCostPerCase) <= 0.02 &&
      audit.sellPriceUnit > 0 &&
      audit.rawCostPerUnit > audit.sellPriceUnit * 1.5
    ) {
      return roundUnitCost(audit.rawCostPerCase / audit.unitsPerCase);
    }
    return audit.rawCostPerUnit;
  }
  if (audit.rawCostPerCase > 0) {
    return roundUnitCost(audit.rawCostPerCase / audit.unitsPerCase);
  }
  return audit.resolvedUnitCost;
};

const isStaleMwacRow = (audit: ItemValuationAudit): boolean => {
  if (audit.totalUnits <= 0) return false;
  const latestUnit = resolveCleanLatestUnitCost(audit);
  if (latestUnit <= 0) return false;
  return Math.abs(audit.resolvedUnitCost - latestUnit) > 0.005;
};

export const ValuationAuditModal: React.FC<ValuationAuditModalProps> = ({
  isOpen,
  items,
  canManageInventory,
  onClose,
  onEditItem,
  onReconciled,
}) => {
  const [search, setSearch] = useState('');
  const [reconciling, setReconciling] = useState(false);

  const {
    audits,
    itemById,
    totalMwac,
    totalLegacy,
    totalDelta,
    topValueList,
    divergentList,
    anomalyList,
    healableCount,
    resettableMwacList,
  } = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    const list: ItemValuationAudit[] = [];
    let mwacSum = 0;
    let legacySum = 0;

    for (const item of items) {
      if (!item) continue;
      map.set(item.itemId, item);
      const audit = analyzeItemValuation(item);
      list.push(audit);
      if (audit.totalUnits > 0) {
        mwacSum += audit.mwacValuationDollars;
        legacySum += audit.legacyCaseSingleDollars;
      }
    }

    const topValue = [...list]
      .filter((a) => a.totalUnits > 0)
      .sort((a, b) => b.mwacValuationDollars - a.mwacValuationDollars);

    const divergent = [...list]
      .filter((a) => Math.abs(a.deltaFromLegacyDollars) >= 0.05)
      .sort((a, b) => Math.abs(b.deltaFromLegacyDollars) - Math.abs(a.deltaFromLegacyDollars));

    const anomalies = [...list]
      .filter((a) => a.anomalies.length > 0 && a.totalUnits > 0)
      .sort((a, b) => b.mwacValuationDollars - a.mwacValuationDollars);

    const healable = list.filter((a) => a.healed).length;
    const resettable = anomalies.filter((a) => isStaleMwacRow(a));

    return {
      audits: list,
      itemById: map,
      totalMwac: Math.round(mwacSum * 100) / 100,
      totalLegacy: Math.round(legacySum * 100) / 100,
      totalDelta: Math.round((mwacSum - legacySum) * 100) / 100,
      topValueList: topValue,
      divergentList: divergent,
      anomalyList: anomalies,
      healableCount: healable,
      resettableMwacList: resettable,
    };
  }, [items]);

  const [activeTab, setActiveTab] = useState<AuditTab>(() =>
    anomalyList.length > 0 ? 'ANOMALIES' : divergentList.length > 0 ? 'DIVERGENT' : 'TOP_VALUE'
  );

  const visibleRows = useMemo(() => {
    const base =
      activeTab === 'ANOMALIES'
        ? anomalyList
        : activeTab === 'DIVERGENT'
        ? divergentList
        : topValueList;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (a) =>
        a.itemName.toLowerCase().includes(q) ||
        a.itemId.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [activeTab, anomalyList, divergentList, topValueList, search]);

  if (!isOpen) return null;

  const persistResetMwacForAudit = (audit: ItemValuationAudit): boolean => {
    const item = itemById.get(audit.itemId);
    if (!item) return false;
    const targetUnit = resolveCleanLatestUnitCost(audit);
    if (targetUnit <= 0) return false;
    const targetCase = roundUnitCost(targetUnit * audit.unitsPerCase);
    const updatedItem: InventoryItem = {
      ...item,
      costPerUnit: targetUnit,
      costPerCase:
        audit.unitsPerCase > 1 && audit.rawCostPerCase > 0
          ? audit.rawCostPerCase
          : targetCase,
      averageCostPerUnit: targetUnit,
      averageCostPerCase: Number(targetCase.toFixed(2)),
      latestCostPerUnit: targetUnit,
      latestCostPerCase: Number(targetCase.toFixed(2)),
      stockValueCents: reconcileStockValueCents(
        { ...item, averageCostPerUnit: targetUnit, costPerUnit: targetUnit },
        audit.totalUnits,
        targetUnit
      ),
      lastUpdated: new Date().toISOString(),
    };
    const saved = saveInventoryItem(updatedItem);
    meshSyncService.broadcastInventoryItem(saved || updatedItem, Date.now());
    return true;
  };

  const handleResetSingleMwac = (audit: ItemValuationAudit) => {
    if (!canManageInventory || reconciling) return;
    setReconciling(true);
    try {
      if (persistResetMwacForAudit(audit)) {
        onReconciled(1);
      }
    } finally {
      setReconciling(false);
    }
  };

  const handleResetAllFlaggedMwac = () => {
    if (!canManageInventory || reconciling || resettableMwacList.length === 0) return;
    setReconciling(true);
    let updatedCount = 0;
    try {
      for (const audit of resettableMwacList) {
        if (persistResetMwacForAudit(audit)) {
          updatedCount++;
        }
      }
      onReconciled(updatedCount);
    } finally {
      setReconciling(false);
    }
  };

  const handleReconcileAllHealed = () => {
    if (!canManageInventory || reconciling) return;
    setReconciling(true);
    let updatedCount = 0;
    try {
      for (const audit of audits) {
        if (!audit.healed) continue;
        const item = itemById.get(audit.itemId);
        if (!item) continue;
        const nextUnit = audit.resolvedUnitCost;
        const nextCase = roundUnitCost(nextUnit * audit.unitsPerCase);
        const reconciledItem: InventoryItem = {
          ...item,
          averageCostPerUnit: nextUnit,
          averageCostPerCase: Number(nextCase.toFixed(2)),
          costPerUnit:
            audit.rawCostPerUnit > 0 &&
            audit.unitsPerCase > 1 &&
            Math.abs(audit.rawCostPerUnit - audit.rawCostPerCase) <= 0.02 &&
            audit.sellPriceUnit > 0 &&
            audit.rawCostPerUnit > audit.sellPriceUnit * 1.5
              ? nextUnit
              : item.costPerUnit,
          stockValueCents: reconcileStockValueCents(
            { ...item, averageCostPerUnit: nextUnit },
            audit.totalUnits,
            nextUnit
          ),
          lastUpdated: new Date().toISOString(),
        };
        const saved = saveInventoryItem(reconciledItem);
        meshSyncService.broadcastInventoryItem(saved || reconciledItem, Date.now());
        updatedCount++;
      }
      onReconciled(updatedCount);
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black tracking-tight truncate">
                Inventory Valuation Audit
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Inspect MWAC vs legacy formula & fix stale average costs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            aria-label="Close valuation audit"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body (keeps summary + list usable on small mobile viewports) */}
        <div className="flex-1 overflow-y-auto">
          {/* Compact Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 sm:p-4 bg-slate-50 border-b border-slate-200">
            <div className="bg-slate-900 text-white rounded-2xl p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Valuation (MWAC)
              </div>
              <div className="text-lg sm:text-xl font-black font-mono text-emerald-400 mt-0.5">
                ${totalMwac.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">
                {topValueList.length} positive SKUs
              </div>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-slate-200">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Legacy Formula
              </div>
              <div className="text-lg sm:text-xl font-black font-mono text-slate-900 mt-0.5">
                ${totalLegacy.toFixed(2)}
              </div>
              <div
                className={`text-[10px] font-bold font-mono ${
                  Math.abs(totalDelta) < 0.05
                    ? 'text-emerald-600'
                    : totalDelta > 0
                    ? 'text-amber-700'
                    : 'text-indigo-700'
                }`}
              >
                {totalDelta >= 0 ? `+$${totalDelta.toFixed(2)}` : `-$${Math.abs(totalDelta).toFixed(2)}`} ({divergentList.length})
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1 bg-white rounded-2xl p-3 border border-slate-200 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Cost & Pool Checks
                  </div>
                  <div className="text-lg font-black font-mono mt-0.5 flex items-center gap-1.5">
                    <span className={anomalyList.length > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                      {anomalyList.length}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {anomalyList.length === 1 ? 'SKU flagged' : 'SKUs flagged'}
                    </span>
                  </div>
                </div>
                {anomalyList.length === 0 && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                )}
              </div>

              {canManageInventory && resettableMwacList.length > 0 ? (
                <button
                  type="button"
                  onClick={handleResetAllFlaggedMwac}
                  disabled={reconciling}
                  className="w-full py-2 px-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-60"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${reconciling ? 'animate-spin' : ''}`} />
                  <span>Reset All {resettableMwacList.length} Flagged MWAC → Latest Cost</span>
                </button>
              ) : canManageInventory && healableCount > 0 ? (
                <button
                  type="button"
                  onClick={handleReconcileAllHealed}
                  disabled={reconciling}
                  className="w-full py-2 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reconciling ? 'animate-spin' : ''}`} />
                  <span>Save {healableCount} Auto-Healed Cost{healableCount === 1 ? '' : 's'}</span>
                </button>
              ) : (
                <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>All value pools aligned</span>
                </div>
              )}
            </div>
          </div>

          {/* Sticky Tabs + Search */}
          <div className="sticky top-0 z-10 px-3.5 sm:px-4 py-2.5 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-white/95 backdrop-blur-sm">
            <div className="grid grid-cols-3 sm:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('TOP_VALUE')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                  activeTab === 'TOP_VALUE'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                <span>Top ({topValueList.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('DIVERGENT')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer text-center ${
                  activeTab === 'DIVERGENT'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Changed ({divergentList.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ANOMALIES')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 ${
                  activeTab === 'ANOMALIES'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Flags ({anomalyList.length})</span>
              </button>
            </div>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter SKU name or ID..."
                className="w-full pl-9 pr-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {visibleRows.length === 0 ? (
              <div className="py-12 px-4 text-center text-sm text-slate-500 font-medium">
                No SKUs match this filter.
              </div>
            ) : (
              visibleRows.slice(0, 200).map((row) => {
                const sourceItem = itemById.get(row.itemId);
                const cleanLatest = resolveCleanLatestUnitCost(row);
                const canResetMwac = canManageInventory && isStaleMwacRow(row);

                return (
                  <div
                    key={row.itemId}
                    className="px-3.5 sm:px-4 py-3 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-sm text-slate-900 truncate">
                          {row.itemName}
                        </span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {row.itemId}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                          {row.unitsPerCase} u/cs
                        </span>
                      </div>

                      <div className="text-xs text-slate-600 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono">
                        <span>
                          Stock: <strong>{row.stockCases}cs</strong> + <strong>{row.stockSingles}ea</strong> ={' '}
                          <strong>{row.totalUnits}u</strong>
                        </span>
                        <span>
                          MWAC: <strong>${formatUnitCost(row.resolvedUnitCost)}</strong>
                        </span>
                        <span>
                          Latest: <strong>${formatUnitCost(cleanLatest)}/u</strong>
                        </span>
                        <span>
                          Case: <strong>${formatUnitCost(row.rawCostPerCase)}</strong>
                        </span>
                        {row.sellPriceUnit > 0 && (
                          <span>
                            Sell: <strong>${formatUnitCost(row.sellPriceUnit)}/u</strong>
                          </span>
                        )}
                      </div>

                      {row.anomalies.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {row.anomalies.map((msg, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200"
                            >
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>{msg}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 flex-wrap">
                      <div className="text-left sm:text-right font-mono">
                        <div className="text-sm font-black text-slate-950">
                          ${row.mwacValuationDollars.toFixed(2)}
                        </div>
                        {Math.abs(row.deltaFromLegacyDollars) >= 0.05 && (
                          <div
                            className={`text-[11px] font-bold ${
                              row.deltaFromLegacyDollars > 0 ? 'text-amber-700' : 'text-indigo-700'
                            }`}
                          >
                            Old: ${row.legacyCaseSingleDollars.toFixed(2)} (
                            {row.deltaFromLegacyDollars > 0 ? '+' : '-'}$
                            {Math.abs(row.deltaFromLegacyDollars).toFixed(2)})
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {canResetMwac && (
                          <button
                            type="button"
                            onClick={() => handleResetSingleMwac(row)}
                            disabled={reconciling}
                            className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black flex items-center gap-1 transition cursor-pointer shadow-sm disabled:opacity-60"
                            title={`Reset MWAC from $${formatUnitCost(row.resolvedUnitCost)} to Latest Cost $${formatUnitCost(cleanLatest)}/u`}
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Fix → ${formatUnitCost(cleanLatest)}</span>
                          </button>
                        )}

                        {canManageInventory && sourceItem && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onEditItem(sourceItem);
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
