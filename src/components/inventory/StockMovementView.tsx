import React, { useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Sparkles,
  Scissors,
  ShoppingBag,
  RotateCcw,
  Sliders,
  Search,
  Filter,
  Download,
  Calendar,
  Layers,
  Boxes,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  User,
} from 'lucide-react';
import { InventoryItem, Salesperson, StockMovementEntry } from '../../types';
import {
  getInventoryItems,
  getStockMovements,
  recordMovement,
} from '../../db/roomDatabase';

interface StockMovementViewProps {
  currentUser: Salesperson | null;
}

export const StockMovementView: React.FC<StockMovementViewProps> = ({ currentUser }) => {
  const [movements, setMovements] = useState<StockMovementEntry[]>(getStockMovements());
  const [items, setItems] = useState<InventoryItem[]>(getInventoryItems());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedItemId, setSelectedItemId] = useState<string>('ALL');

  // Manual Adjustment Modal state
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjItemId, setAdjItemId] = useState(items[0]?.itemId || '');
  const [adjType, setAdjType] = useState<'ADJUSTMENT' | 'DAMAGE_LOSS' | 'RETURN'>('ADJUSTMENT');
  const [adjCases, setAdjCases] = useState<number>(0);
  const [adjSingles, setAdjSingles] = useState<number>(0);
  const [adjReason, setAdjReason] = useState<string>('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToastMsg = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const refresh = () => {
    setMovements(getStockMovements());
    setItems(getInventoryItems());
  };

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjItemId) {
      showToastMsg('error', 'Select an item to adjust');
      return;
    }
    if (adjCases === 0 && adjSingles === 0) {
      showToastMsg('error', 'Enter a non-zero case or singles adjustment');
      return;
    }
    if (!adjReason.trim()) {
      showToastMsg('error', 'Please provide a reason or audit note');
      return;
    }

    const item = items.find((i) => i.itemId === adjItemId);
    if (!item) return;

    const newCases = item.stockCases + adjCases;
    const newSingles = item.stockSingles + adjSingles;
    if (newCases < 0 || newSingles < 0) {
      showToastMsg('error', `Adjustment would cause negative inventory (${newCases} cs, ${newSingles} ea)`);
      return;
    }

    const res = recordMovement({
      itemId: adjItemId,
      movementType: adjType,
      casesChange: adjCases,
      singlesChange: adjSingles,
      resultingStockCases: newCases,
      resultingStockSingles: newSingles,
      referenceId: `ADJ-${Date.now().toString().slice(-6)}`,
      staffId: currentUser?.id || '001',
      staffName: currentUser?.name || 'Administrator',
      reason: adjReason.trim(),
    });

    if (res.success) {
      showToastMsg('success', res.message);
      refresh();
      setShowAdjustModal(false);
      setAdjCases(0);
      setAdjSingles(0);
      setAdjReason('');
    } else {
      showToastMsg('error', res.message);
    }
  };

  const filteredMovements = movements.filter((m) => {
    const q = (searchQuery || '').trim().toLowerCase();
    const matchesSearch =
      !q ||
      (m.movementId && m.movementId.toLowerCase().includes(q)) ||
      (m.itemName && m.itemName.toLowerCase().includes(q)) ||
      (m.itemId && m.itemId.toLowerCase().includes(q)) ||
      (m.referenceId && m.referenceId.toLowerCase().includes(q)) ||
      (m.reason && m.reason.toLowerCase().includes(q));

    const matchesType = selectedType === 'ALL' || m.movementType === selectedType;
    const matchesItem = selectedItemId === 'ALL' || m.itemId === selectedItemId;

    return matchesSearch && matchesType && matchesItem;
  });

  const getMovementBadge = (type: StockMovementEntry['movementType'], rule?: string) => {
    switch (type) {
      case 'GOODS_RECEIVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
            Goods Received
          </span>
        );
      case 'BREAK_CASE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <Scissors className="w-3.5 h-3.5 text-indigo-600" />
            Case Break {rule && `(${rule})`}
          </span>
        );
      case 'SALE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <ShoppingBag className="w-3.5 h-3.5 text-blue-600" />
            POS Sale
          </span>
        );
      case 'RETURN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
            <RotateCcw className="w-3.5 h-3.5 text-purple-600" />
            Customer Return
          </span>
        );
      case 'DAMAGE_LOSS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            Damage / Spoilage
          </span>
        );
      case 'ADJUSTMENT':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
            <Sliders className="w-3.5 h-3.5 text-slate-600" />
            Stock Adjustment
          </span>
        );
    }
  };

  const exportCSV = () => {
    const headers = [
      'Movement ID',
      'Date Time',
      'Item ID',
      'Item Name',
      'Type',
      'Delta Cases',
      'Delta Singles',
      'Resulting Cases',
      'Resulting Singles',
      'Reference ID',
      'Trigger Rule',
      'Staff',
      'Reason',
    ];
    const rows = filteredMovements.map((m) => [
      m.movementId,
      m.timestamp,
      m.itemId,
      `"${m.itemName}"`,
      m.movementType,
      m.casesChange,
      m.singlesChange,
      m.resultingStockCases,
      m.resultingStockSingles,
      m.referenceId || '',
      m.triggerRule || '',
      m.staffName || m.staffId || '',
      `"${m.reason || ''}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `StockMovement_Audit_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="stock-movement-view" className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          id="movement-toast"
          className={`p-4 rounded-2xl text-sm font-medium flex items-center gap-3 shadow-lg border transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
              : 'bg-rose-50 text-rose-950 border-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header Banner & Controls */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-200">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Stock Movement Audit (Tab 3: StockMovement)</h2>
              <p className="text-xs text-slate-500">
                Full immutable audit trail of goods receipts, automatic case splits (Rule A/B), sales dips, and reconciliations
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-200"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => setShowAdjustModal(true)}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-md shadow-slate-300 flex items-center gap-1.5"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Record Manual Adjustment</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Movement ID, Reference, Note..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
          />
        </div>

        <div>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
          >
            <option value="ALL">All Movement Types</option>
            <option value="GOODS_RECEIVED">Goods Received (GRN)</option>
            <option value="BREAK_CASE">Case Breaks (Rule A / Rule B)</option>
            <option value="SALE">POS Sales</option>
            <option value="RETURN">Customer Returns</option>
            <option value="DAMAGE_LOSS">Damage / Spoilage</option>
            <option value="ADJUSTMENT">Stocktaking Adjustments</option>
          </select>
        </div>

        <div>
          <select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
            className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
          >
            <option value="ALL">All Products / Items</option>
            {items.map((i) => (
              <option key={i.itemId} value={i.itemId}>
                {i.itemId} — {i.itemName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Movement Ledger Table */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-100/80 text-slate-600 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                <th className="py-3 px-4">Log ID & Time</th>
                <th className="py-3 px-4">Item (ID & Name)</th>
                <th className="py-3 px-3">Movement Type</th>
                <th className="py-3 px-3 text-center">Cases Δ</th>
                <th className="py-3 px-3 text-center">Singles Δ</th>
                <th className="py-3 px-3 text-center bg-slate-50/50">Resulting Balance</th>
                <th className="py-3 px-3">Reference / Rule</th>
                <th className="py-3 px-4">Reason & Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                    No matching stock movement logs found.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((mov) => {
                  return (
                    <tr key={mov.movementId} className="hover:bg-slate-50/75 transition-colors">
                      {/* ID & Timestamp */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="text-xs font-bold text-slate-900">{mov.movementId}</div>
                        <div className="text-[11px] text-slate-500">{mov.timestamp}</div>
                      </td>

                      {/* Item */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 text-xs">{mov.itemName}</div>
                        <div className="text-[11px] font-mono text-slate-400">{mov.itemId}</div>
                      </td>

                      {/* Movement Type */}
                      <td className="py-3.5 px-3">
                        {getMovementBadge(mov.movementType, mov.triggerRule)}
                      </td>

                      {/* Cases Delta */}
                      <td className="py-3.5 px-3 text-center font-mono font-bold">
                        {mov.casesChange > 0 ? (
                          <span className="text-emerald-600">+{mov.casesChange} cs</span>
                        ) : mov.casesChange < 0 ? (
                          <span className="text-rose-600">{mov.casesChange} cs</span>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>

                      {/* Singles Delta */}
                      <td className="py-3.5 px-3 text-center font-mono font-bold">
                        {mov.singlesChange > 0 ? (
                          <span className="text-emerald-600">+{mov.singlesChange} ea</span>
                        ) : mov.singlesChange < 0 ? (
                          <span className="text-rose-600">{mov.singlesChange} ea</span>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>

                      {/* Resulting Balance */}
                      <td className="py-3.5 px-3 text-center bg-slate-50/50 font-mono">
                        <div className="text-xs font-bold text-slate-900">
                          {mov.resultingStockCases} cs / {mov.resultingStockSingles} ea
                        </div>
                      </td>

                      {/* Reference & Trigger Rule */}
                      <td className="py-3.5 px-3 font-mono text-xs">
                        <div className="text-slate-700 font-semibold">{mov.referenceId || '—'}</div>
                        {mov.triggerRule && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-indigo-700 font-bold bg-indigo-50 px-1.5 py-0.5 rounded mt-0.5">
                            <Sparkles className="w-2.5 h-2.5" />
                            {mov.triggerRule}
                          </span>
                        )}
                      </td>

                      {/* Reason & Staff */}
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        <div className="max-w-[200px] truncate">{mov.reason || '—'}</div>
                        <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                          By {mov.staffName || mov.staffId || 'System'}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Stock Adjustment Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-lg">Record Manual Inventory Adjustment</h3>
              </div>
              <button
                onClick={() => setShowAdjustModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                  Select Product *
                </label>
                <select
                  value={adjItemId}
                  onChange={(e) => setAdjItemId(e.target.value)}
                  className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
                >
                  {items.map((i) => (
                    <option key={i.itemId} value={i.itemId}>
                      {i.itemId} — {i.itemName} ({i.stockCases} cs, {i.stockSingles} ea)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                  Adjustment Type *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjType('ADJUSTMENT')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
                      adjType === 'ADJUSTMENT'
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Stocktake Sync
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjType('DAMAGE_LOSS')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
                      adjType === 'DAMAGE_LOSS'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Damage / Spoil
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjType('RETURN')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
                      adjType === 'RETURN'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Customer Return
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                    Cases Change (+ or -)
                  </label>
                  <input
                    type="number"
                    value={adjCases}
                    onChange={(e) => setAdjCases(Number(e.target.value) || 0)}
                    className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-base font-mono font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
                    placeholder="e.g. -1 or +2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                    Singles Change (+ or -)
                  </label>
                  <input
                    type="number"
                    value={adjSingles}
                    onChange={(e) => setAdjSingles(Number(e.target.value) || 0)}
                    className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-base font-mono font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
                    placeholder="e.g. -5 or +10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                  Reason / Audit Notes *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Stock count audit variance / expired batch disposal"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-sm font-semibold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
                />
              </div>

              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-md shadow-slate-300"
                >
                  Apply & Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
