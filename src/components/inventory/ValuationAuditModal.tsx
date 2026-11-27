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

  const handleReconcileAll = () => {
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
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black tracking-tight truncate">
                Inventory Valuation Audit & Breakdown
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Pinpoint high-value SKUs, legacy vs MWAC differences, and cost anomalies
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

        {/* Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-4 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="bg-slate-900 text-white rounded-2xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Current Valuation (MWAC)
            </div>
            <div className="text-xl font-black font-mono text-emerald-400 mt-0.5">
              ${totalMwac.toFixed(2)}
            </div>
            <div className="text-[11px] text-slate-400">
              {topValueList.length} positive-stock SKUs
            </div>
          </div>

          <div className="bg-white rounded-2xl p-3 border border-slate-200">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Legacy Case+Single Formula
            </div>
            <div className="text-xl font-black font-mono text-slate-900 mt-0.5">
              ${totalLegacy.toFixed(2)}
            </div>
            <div
              className={`text-[11px] font-bold font-mono ${
                Math.abs(totalDelta) < 0.05
                  ? 'text-emerald-600'
                  : totalDelta > 0
                  ? 'text-amber-700'
                  : 'text-indigo-700'
              }`}
            >
              {totalDelta >= 0 ? `+$${totalDelta.toFixed(2)}` : `-$${Math.abs(totalDelta).toFixed(2)}`} difference ({divergentList.length} SKUs)
            </div>
          </div>

          <div className="bg-white rounded-2xl p-3 border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Cost & Pool Checks
              </div>
              <div className="text-xl font-black font-mono mt-0.5 flex items-center gap-2">
                <span className={anomalyList.length > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                  {anomalyList.length}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {anomalyList.length === 1 ? 'SKU flagged' : 'SKUs flagged'}
                </span>
              </div>
            </div>
            {healableCount > 0 && canManageInventory ? (
              <button
                type="button"
                onClick={handleReconcileAll}
                disabled={reconciling}
                className="mt-1.5 w-full py-1.5 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reconciling ? 'animate-spin' : ''}`} />
                <span>Save {healableCount} Auto-Healed Cost{healableCount === 1 ? '' : 's'}</span>
              </button>
            ) : (
              <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 mt-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>All value pools aligned</span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs + Search */}
        <div className="px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 bg-white">
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('TOP_VALUE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'TOP_VALUE'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Top Value ({topValueList.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DIVERGENT')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'DIVERGENT'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Changed vs Old ({divergentList.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ANOMALIES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                activeTab === 'ANOMALIES'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Anomalies ({anomalyList.length})</span>
            </button>
          </div>

          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter SKU name or ID..."
              className="w-full pl-9 pr-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {visibleRows.length === 0 ? (
            <div className="py-12 px-4 text-center text-sm text-slate-500 font-medium">
              No SKUs match this filter.
            </div>
          ) : (
            visibleRows.slice(0, 200).map((row) => {
              const sourceItem = itemById.get(row.itemId);
              return (
                <div
                  key={row.itemId}
                  className="px-4 py-3 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
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
                        Unit Cost: <strong>${formatUnitCost(row.resolvedUnitCost)}</strong>
                      </span>
                      <span>
                        Case Cost: <strong>${formatUnitCost(row.rawCostPerCase)}</strong>
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

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div className="text-right font-mono">
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

                    {canManageInventory && sourceItem && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onEditItem(sourceItem);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
