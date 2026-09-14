import React, { useState } from 'react';
import {
  Settings,
  Sliders,
  Sparkles,
  Tag,
  Layers,
  Boxes,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Database,
  Download,
  Upload,
  Percent,
  TrendingUp,
} from 'lucide-react';
import { InventoryCategory } from '../../types';
import {
  getCategories,
  saveCategories,
  resetRoomDatabase,
  getInventoryItems,
} from '../../db/roomDatabase';

interface InventorySetupViewProps {
  onRefreshAll: () => void;
}

export const InventorySetupView: React.FC<InventorySetupViewProps> = ({ onRefreshAll }) => {
  const [categories, setCategoriesState] = useState<InventoryCategory[]>(getCategories());
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');

  // Policy configurations saved to localStorage
  const [autoBreakRuleA, setAutoBreakRuleA] = useState<boolean>(() => {
    return localStorage.getItem('cfg_rule_a') !== 'false';
  });
  const [autoBreakRuleB, setAutoBreakRuleB] = useState<boolean>(() => {
    return localStorage.getItem('cfg_rule_b') !== 'false';
  });
  const [defaultMarkupPercent, setDefaultMarkupPercent] = useState<number>(() => {
    return Number(localStorage.getItem('cfg_markup_pct')) || 25;
  });
  const [reorderBufferPercent, setReorderBufferPercent] = useState<number>(() => {
    return Number(localStorage.getItem('cfg_reorder_buf')) || 15;
  });

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const id = `CAT-${(categories.length + 1).toString().padStart(2, '0')}`;
    const updated = [
      ...categories,
      {
        categoryId: id,
        categoryName: newCatName.trim(),
        description: newCatDesc.trim(),
        itemCount: 0,
      },
    ];
    setCategoriesState(updated);
    saveCategories(updated);
    setNewCatName('');
    setNewCatDesc('');
    showToast('success', `Category "${newCatName}" created`);
    onRefreshAll();
  };

  const handleDeleteCategory = (catId: string, catName: string) => {
    if (confirm(`Are you sure you want to delete category "${catName}"?`)) {
      const updated = categories.filter((c) => c.categoryId !== catId);
      setCategoriesState(updated);
      saveCategories(updated);
      showToast('success', `Category removed`);
      onRefreshAll();
    }
  };

  const savePolicies = () => {
    localStorage.setItem('cfg_rule_a', String(autoBreakRuleA));
    localStorage.setItem('cfg_rule_b', String(autoBreakRuleB));
    localStorage.setItem('cfg_markup_pct', String(defaultMarkupPercent));
    localStorage.setItem('cfg_reorder_buf', String(reorderBufferPercent));
    showToast('success', 'Automation & pricing policies saved successfully');
  };

  const handleDatabaseReset = () => {
    if (
      confirm(
        'WARNING: This will reset all inventory, Goods Received logs, and stock movements to the official default master dataset. Proceed?'
      )
    ) {
      resetRoomDatabase();
      setCategoriesState(getCategories());
      showToast('success', 'Database reset to default master stock state');
      onRefreshAll();
    }
  };

  const exportFullInventoryJSON = () => {
    const data = {
      items: getInventoryItems(),
      categories: getCategories(),
      timestamp: new Date().toISOString(),
    };
    const jsonStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', jsonStr);
    link.setAttribute('download', `InventoryMaster_Backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="inventory-setup-view" className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          id="setup-toast"
          className={`p-4 rounded-2xl text-sm font-medium flex items-center gap-3 shadow-lg border transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
              : 'bg-rose-50 text-rose-950 border-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-200">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Inventory Setup & Rules Engine (Tab 4: Setup)</h2>
            <p className="text-xs text-slate-500">
              Configure product classifications, automated case-splitting policies, and global margin parameters
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportFullInventoryJSON}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-slate-200"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Backup Data</span>
          </button>
          <button
            onClick={handleDatabaseReset}
            className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-rose-200"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Master Data</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Policy Section: Automation Rules */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-900 text-base">Automatic Case-Breaking Policy Rules</h3>
          </div>

          <div className="space-y-4">
            {/* Rule A */}
            <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-950 text-sm flex items-center gap-2">
                  <span>Rule A: Auto-Break Case on Goods Receipt</span>
                </span>
                <input
                  type="checkbox"
                  checked={autoBreakRuleA}
                  onChange={(e) => setAutoBreakRuleA(e.target.checked)}
                  className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer"
                />
              </div>
              <p className="text-xs text-indigo-900/80 leading-relaxed">
                When new cases are received into storage via Goods Received Voucher (GRN) and current singles stock is zero (0), automatically crack open 1 case into loose units ready for immediate sale.
              </p>
            </div>

            {/* Rule B */}
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-950 text-sm flex items-center gap-2">
                  <span>Rule B: Auto-Break Case on POS Single Sale</span>
                </span>
                <input
                  type="checkbox"
                  checked={autoBreakRuleB}
                  onChange={(e) => setAutoBreakRuleB(e.target.checked)}
                  className="w-5 h-5 text-amber-600 rounded focus:ring-amber-500 cursor-pointer"
                />
              </div>
              <p className="text-xs text-amber-900/80 leading-relaxed">
                When a cashier sells loose singles at POS and singles stock is insufficient (but cases exist in stock), automatically deduct 1 case, unpack it into singles, and fulfill the requested sale seamlessly.
              </p>
            </div>

            {/* Pricing Markup */}
            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1 flex items-center justify-between">
                  <span>Default Single Unit Margin Target (%)</span>
                  <span className="text-indigo-600 font-bold font-mono">{defaultMarkupPercent}%</span>
                </label>
                <input
                  type="range"
                  min="5"
                  max="60"
                  value={defaultMarkupPercent}
                  onChange={(e) => setDefaultMarkupPercent(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <span className="text-[11px] text-slate-400">
                  Used by formula: Unit Sell Price = (Case Cost / Units Per Case) × (1 + Margin%)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1 flex items-center justify-between">
                  <span>Low-Stock Safety Reorder Threshold Buffer (%)</span>
                  <span className="text-indigo-600 font-bold font-mono">{reorderBufferPercent}%</span>
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={reorderBufferPercent}
                  onChange={(e) => setReorderBufferPercent(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            </div>

            <button
              onClick={savePolicies}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl transition shadow-md shadow-slate-300"
            >
              Save Automation & Margin Settings
            </button>
          </div>
        </div>

        {/* Category Management */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <Tag className="w-5 h-5 text-indigo-600" />
              <h3 className="font-bold text-slate-900 text-base">Product Categories & Groupings</h3>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {categories.length} Categories
            </span>
          </div>

          {/* New Category Form */}
          <form onSubmit={handleAddCategory} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
            <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Add New Product Category
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="Category Name (e.g. Frozen Foods)"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
              />
              <input
                type="text"
                placeholder="Short Description"
                value={newCatDesc}
                onChange={(e) => setNewCatDesc(e.target.value)}
                className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
            >
              Add Category
            </button>
          </form>

          {/* Categories List */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {categories.map((cat) => (
              <div
                key={cat.categoryId}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100 hover:border-slate-200 transition"
              >
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span>{cat.categoryName}</span>
                    <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      {cat.categoryId}
                    </span>
                  </div>
                  {cat.description && (
                    <div className="text-[11px] text-slate-500 mt-0.5">{cat.description}</div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-600 bg-white px-2 py-0.5 rounded-lg border border-slate-200">
                    {cat.itemCount || 0} items
                  </span>
                  <button
                    onClick={() => handleDeleteCategory(cat.categoryId, cat.categoryName)}
                    className="text-xs text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg transition"
                    title="Delete Category"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
