import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Search,
  ClipboardList,
  CheckSquare,
  Square,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  PackageCheck,
} from 'lucide-react';
import { PurchaseOrder, PurchaseOrderLine } from '../../types';
import { formatPoLineRateLabel } from '../../utils/purchaseOrderMath';
import { getPurchaseOrders } from '../../db/roomDatabase';

export interface SelectedPoReceiveLine {
  poLineId: string;
  itemId: string;            // Original Inventory Master itemId
  code: string;              // Original Inventory Master code
  masterDescription: string; // Original immutable Inventory Master description
  poDescription: string;     // Flavour/variant shown as helper note only (never mutates Master)
  unitsPerCase: number;
  receiveCases: number;
  receiveSingles: number;
  caseCost: number;
  unitCost: number;
}

export interface PurchaseOrderSelectionPayload {
  po: PurchaseOrder;
  selectedLines: SelectedPoReceiveLine[];
}

interface PurchaseOrderPickerModalProps {
  isOpen: boolean;
  initialPoId?: string | null;
  branchId?: string;
  onClose: () => void;
  onSelectLines: (payload: PurchaseOrderSelectionPayload) => void;
}

export const PurchaseOrderPickerModal: React.FC<PurchaseOrderPickerModalProps> = ({
  isOpen,
  initialPoId,
  branchId,
  onClose,
  onSelectLines,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [checkedLineIds, setCheckedLineIds] = useState<Record<string, boolean>>({});
  const [receiveQtyMap, setReceiveQtyMap] = useState<Record<string, { cases: number; singles: number }>>({});

  const receivablePos = useMemo(() => {
    if (!isOpen) return [];
    const all = getPurchaseOrders(branchId);
    return all.filter((po) => po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED');
  }, [isOpen, branchId]);

  const hydrateLineSelection = (po: PurchaseOrder) => {
    const nextChecked: Record<string, boolean> = {};
    const nextQty: Record<string, { cases: number; singles: number }> = {};
    (po.lines || []).forEach((line) => {
      const upc = Math.max(1, Number(line.unitsPerCase || 1));
      const remUnits = Math.max(0, Number(line.totalUnits || 0) - Number(line.receivedUnits || 0));
      const remCases = Math.floor(remUnits / upc);
      const remSingles = remUnits % upc;
      nextChecked[line.lineId] = remUnits > 0;
      nextQty[line.lineId] = {
        cases: remCases,
        singles: remSingles,
      };
    });
    setSelectedPo(po);
    setCheckedLineIds(nextChecked);
    setReceiveQtyMap(nextQty);
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedPo(null);
      setSearchTerm('');
      return;
    }
    if (initialPoId) {
      const targetUpper = String(initialPoId || '').toUpperCase();
      const match = receivablePos.find(
        (p) =>
          String(p?.id || '').toUpperCase() === targetUpper ||
          String(p?.poNumber || '').toUpperCase() === targetUpper
      );
      if (match) {
        hydrateLineSelection(match);
        return;
      }
    }
    setSelectedPo(null);
  }, [isOpen, initialPoId, receivablePos]);

  const filteredPos = useMemo(() => {
    const q = String(searchTerm || '').trim().toLowerCase();
    if (!q) return receivablePos;
    return receivablePos.filter((po) => {
      if (!po) return false;
      if (String(po.poNumber || po.id || '').toLowerCase().includes(q)) return true;
      if (String(po.supplierName || '').toLowerCase().includes(q)) return true;
      return (po.lines || []).some(
        (l) =>
          String(l?.poDescription || '').toLowerCase().includes(q) ||
          String(l?.masterDescription || '').toLowerCase().includes(q) ||
          String(l?.code || '').toLowerCase().includes(q)
      );
    });
  }, [receivablePos, searchTerm]);

  const selectedCount = useMemo(() => {
    if (!selectedPo) return 0;
    return (selectedPo.lines || []).filter((l) => checkedLineIds[l.lineId]).length;
  }, [selectedPo, checkedLineIds]);

  const toggleAllLines = (selectAll: boolean) => {
    if (!selectedPo) return;
    const next: Record<string, boolean> = {};
    (selectedPo.lines || []).forEach((l) => {
      next[l.lineId] = selectAll;
    });
    setCheckedLineIds(next);
  };

  const handleConfirm = () => {
    if (!selectedPo) return;
    const chosen: SelectedPoReceiveLine[] = [];
    for (const line of selectedPo.lines || []) {
      if (!checkedLineIds[line.lineId]) continue;
      const qty = receiveQtyMap[line.lineId] || { cases: line.orderCases, singles: line.orderSingles || 0 };
      if ((Number(qty.cases) || 0) <= 0 && (Number(qty.singles) || 0) <= 0) continue;
      chosen.push({
        poLineId: line.lineId,
        itemId: line.itemId,
        code: line.code || line.itemId,
        masterDescription: line.masterDescription,
        poDescription: line.poDescription,
        unitsPerCase: Math.max(1, Number(line.unitsPerCase || 1)),
        receiveCases: Math.max(0, Number(qty.cases) || 0),
        receiveSingles: Math.max(0, Number(qty.singles) || 0),
        caseCost: Number(line.caseCost || 0),
        unitCost: Number(line.unitCost || 0),
      });
    }
    if (chosen.length === 0) return;
    onSelectLines({ po: selectedPo, selectedLines: chosen });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {selectedPo && (
              <button
                type="button"
                onClick={() => setSelectedPo(null)}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 cursor-pointer shrink-0"
                title="Back to Purchase Orders"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 truncate">
                {selectedPo ? `Receive Items from ${selectedPo.poNumber}` : 'Select Approved Purchase Order'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedPo
                  ? 'Pick the products to load. Receiving automatically maps to original Inventory Master code & name.'
                  : 'Only manager-approved Purchase Orders appear here for receiving.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {!selectedPo ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by PO number, supplier, SKU, or flavour..."
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-slate-500"
              />
            </div>

            {filteredPos.length === 0 ? (
              <div className="py-14 text-center border border-dashed border-slate-200 rounded-xl">
                <ClipboardList className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <div className="text-sm font-semibold text-slate-800">No Approved Purchase Orders Available</div>
                <div className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Create and get a Purchase Order approved by a Manager first, or close this dialog to receive stock without a PO.
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {filteredPos.map((po) => {
                  const openLines = (po.lines || []).filter(
                    (l) => Number(l.receivedUnits || 0) < Math.max(1, Number(l.totalUnits || 0))
                  ).length;
                  return (
                    <button
                      key={po.id}
                      type="button"
                      onClick={() => hydrateLineSelection(po)}
                      className="w-full text-left px-4 py-3.5 hover:bg-slate-50 flex items-center justify-between gap-4 transition cursor-pointer"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-slate-900">{po.poNumber}</span>
                          <span className="text-slate-300">&middot;</span>
                          <span className="text-sm font-semibold text-slate-800 truncate">{po.supplierName}</span>
                          <span className="text-slate-300">&middot;</span>
                          <span
                            className={`text-[11px] font-semibold uppercase tracking-wide ${
                              po.status === 'PARTIALLY_RECEIVED' ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            {po.status.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                          <span>Date: {po.orderDate}</span>
                          <span>&middot;</span>
                          <span>
                            {openLines} of {(po.lines || []).length} lines remaining
                          </span>
                          {po.approvedByName && (
                            <>
                              <span>&middot;</span>
                              <span>Approved by {po.approvedByName}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="text-sm font-mono tabular-nums font-bold text-slate-900">
                            ${Number(po.grandTotal || 0).toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {po.totalCases || 0} cs
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* PO Context Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-slate-900">{selectedPo.supplierName}</div>
                <div className="text-slate-500">
                  PO <span className="font-mono font-semibold text-slate-700">{selectedPo.poNumber}</span> &middot; Ordered{' '}
                  {selectedPo.orderDate} &middot; Approved by {selectedPo.approvedByName || 'Manager'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleAllLines(true)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => toggleAllLines(false)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Selectable Lines */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    <th className="py-2.5 px-3 w-10"></th>
                    <th className="py-2.5 px-3">PO Item / Master Mapping</th>
                    <th className="py-2.5 px-3 w-28 text-right">Ordered / Rec.</th>
                    <th className="py-2.5 px-3 w-24 text-right">Rec. Cases</th>
                    <th className="py-2.5 px-3 w-24 text-right">Rec. Singles</th>
                    <th className="py-2.5 px-3 w-28 text-right">Cost / Pack</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {(selectedPo.lines || []).map((line: PurchaseOrderLine) => {
                    const checked = Boolean(checkedLineIds[line.lineId]);
                    const qty = receiveQtyMap[line.lineId] || { cases: 0, singles: 0 };
                    const fullyReceived = Number(line.receivedUnits || 0) >= Math.max(1, Number(line.totalUnits || 0));
                    const isVariant =
                      String(line.poDescription || '').trim().toLowerCase() !==
                      String(line.masterDescription || '').trim().toLowerCase();

                    return (
                      <tr
                        key={line.lineId}
                        className={`${checked ? 'bg-indigo-50/40' : 'bg-white'} hover:bg-slate-50 transition`}
                      >
                        <td className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() =>
                              setCheckedLineIds((prev) => ({ ...prev, [line.lineId]: !prev[line.lineId] }))
                            }
                            className="text-slate-700 hover:text-indigo-700 cursor-pointer"
                          >
                            {checked ? (
                              <CheckSquare className="w-5 h-5 text-indigo-600" />
                            ) : (
                              <Square className="w-5 h-5 text-slate-300" />
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">{line.poDescription}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-slate-700 font-semibold">{line.code}</span>
                            <span>&rarr;</span>
                            <span>
                              Receives into Master:{' '}
                              <strong className="text-slate-800">{line.masterDescription}</strong>
                            </span>
                            {isVariant && <span className="text-indigo-700 font-medium">(PO variant)</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-xs">
                          <div className="text-slate-800 font-semibold">
                            {line.orderCases} cs {line.orderSingles ? `+ ${line.orderSingles} u` : ''}
                          </div>
                          <div className={fullyReceived ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
                            Rec: {line.receivedCases || 0} cs
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            disabled={!checked}
                            value={qty.cases}
                            onChange={(e) =>
                              setReceiveQtyMap((prev) => ({
                                ...prev,
                                [line.lineId]: { ...qty, cases: Math.max(0, Number(e.target.value) || 0) },
                              }))
                            }
                            className="w-full px-2 py-1.5 text-right text-sm font-mono tabular-nums bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            disabled={!checked}
                            value={qty.singles}
                            onChange={(e) =>
                              setReceiveQtyMap((prev) => ({
                                ...prev,
                                [line.lineId]: { ...qty, singles: Math.max(0, Number(e.target.value) || 0) },
                              }))
                            }
                            className="w-full px-2 py-1.5 text-right text-sm font-mono tabular-nums bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
                          />
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-xs font-semibold text-slate-700">
                          {formatPoLineRateLabel(line)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Inventory Master descriptions are preserved automatically during GRV receiving.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            {selectedPo && (
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={handleConfirm}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
              >
                <PackageCheck className="w-4 h-4" />
                <span>Load {selectedCount} Item{selectedCount === 1 ? '' : 's'} into GRV</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
