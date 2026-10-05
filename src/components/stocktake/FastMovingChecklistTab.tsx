import React, { useState, useEffect } from 'react';
import {
  Zap,
  Plus,
  Trash2,
  Search,
  CheckCircle,
  Package,
  Layers,
  Sparkles,
  Smartphone,
  Flame,
} from 'lucide-react';
import {
  StocktakeSession,
  FastMovingChecklistItem,
  InventoryItem,
  Salesperson,
} from '../../types';
import {
  getFastMovingChecklist,
  addFastMovingChecklistItem,
  removeFastMovingChecklistItem,
  getInventoryItems,
} from '../../db/roomDatabase';

interface FastMovingChecklistTabProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onRefreshSession: () => void;
}

export const FastMovingChecklistTab: React.FC<FastMovingChecklistTabProps> = ({
  session,
  currentUser,
}) => {
  const [checklist, setChecklist] = useState<FastMovingChecklistItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [inventoryList, setInventoryList] = useState<InventoryItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [customNotes, setCustomNotes] = useState('');

  const loadData = () => {
    const list = getFastMovingChecklist();
    setChecklist(list);
    setInventoryList(getInventoryItems());
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;

    const matched = inventoryList.find((i) => i.itemId === selectedItemId);
    if (!matched) return;

    addFastMovingChecklistItem({
      itemId: matched.itemId,
      itemName: matched.itemName,
      category: matched.category || 'General',
      defaultFastMover: true,
      notes: customNotes.trim() || undefined,
      addedBy: currentUser?.name || 'Supervisor',
    });

    loadData();
    setShowAddModal(false);
    setSelectedItemId('');
    setCustomNotes('');
  };

  const handleRemoveItem = (itemId: string) => {
    removeFastMovingChecklistItem(itemId);
    loadData();
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredList = checklist.filter((item) => {
    return (
      q === '' ||
      item.itemName.toLowerCase().includes(q) ||
      item.itemId.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-amber-950/70 to-slate-900 border border-amber-800/60 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Predefined Fast-Moving Checklist (Daily Blind Counts)
            </h3>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              Airtime PINs, LP Gas refills, bread, and sugar move rapidly and are prone to leakage. Supervisors maintain this curated checklist. During daily counts, junior counters are presented with this exact list for blind counting while sales continue.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Item to Checklist
        </button>
      </div>

      {/* Checklist Grid */}
      <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search fast-movers checklist..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <div className="text-xs text-slate-400">
          Total items on checklist:{' '}
          <strong className="text-amber-400 font-mono">{checklist.length}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredList.map((item) => {
          const inv = inventoryList.find((i) => i.itemId === item.itemId);
          const isAirtime = item.category.toLowerCase().includes('airtime');
          const isGas = item.category.toLowerCase().includes('gas');

          return (
            <div
              key={item.itemId}
              className="bg-slate-900/90 border border-slate-800 hover:border-amber-500/40 rounded-xl p-4 shadow-lg flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-950 text-amber-400 border border-slate-800">
                    {item.itemId}
                  </span>
                  <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                    {isAirtime && <Smartphone className="w-3 h-3 text-emerald-400" />}
                    {isGas && <Flame className="w-3 h-3 text-orange-400" />}
                    {item.category}
                  </span>
                </div>

                <h4 className="text-sm font-bold text-white mt-2">{item.itemName}</h4>
                {item.notes && <p className="text-xs text-slate-400 mt-1 italic">{item.notes}</p>}

                <div className="mt-3 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Current Live SOH:</span>
                  <span className="font-mono font-bold text-slate-200">
                    {inv ? `${inv.totalUnits} units` : 'N/A'}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                <span>Added by: {item.addedBy}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.itemId)}
                  className="p-1 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                  title="Remove from checklist"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}

        {filteredList.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-500 bg-slate-900/40 rounded-2xl border border-slate-800">
            <Zap className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="font-semibold text-slate-400">No fast-moving items found</p>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Add Fast-Moving Product</h3>
                  <p className="text-xs text-slate-400">Predefined daily blind count item</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Select Catalog Product *</label>
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">-- Choose Item from Inventory Master --</option>
                  {inventoryList.map((item) => (
                    <option key={item.itemId} value={item.itemId}>
                      {item.itemName} ({item.itemId}) - {item.category}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Operational Notes (Optional)</label>
                <input
                  type="text"
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder="e.g. Daily shift verification for till PINs"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold shadow-lg"
                >
                  Add to Checklist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
