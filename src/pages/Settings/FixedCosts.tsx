import React, { useState, useEffect, useMemo } from 'react';
import { Salesperson, FixedMonthlyCost, FixedCostCategory } from '../../types';
import {
  getFixedCosts,
  getCompanyFixedCosts,
  saveFixedCost,
  deleteFixedCost,
  toggleFixedCostActive,
  getFixedCostCategories,
  saveFixedCostCategory,
  deleteFixedCostCategory,
  FixedCostCategoryDefinition,
} from '../../services/fixedCostsService';
import { getBranches, getCurrentBranchId, getCurrentCompanyId } from '../../db/roomDatabase';
import {
  Building,
  Plus,
  Edit2,
  Trash2,
  Power,
  Calendar,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  X,
  Search,
  ArrowLeft,
  Briefcase,
  Wifi,
  ShieldCheck,
  FileText,
  Layers,
  Sparkles,
  Tag,
  Settings,
} from 'lucide-react';

interface FixedCostsProps {
  currentUser: Salesperson;
  onBack?: () => void;
  onNavigateToIncomeStatement?: () => void;
}

export const FixedCosts: React.FC<FixedCostsProps> = ({
  currentUser,
  onBack,
  onNavigateToIncomeStatement,
}) => {
  const [fixedCosts, setFixedCosts] = useState<FixedMonthlyCost[]>([]);
  const [categories, setCategories] = useState<FixedCostCategoryDefinition[]>(() => getFixedCostCategories());
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [currencyFilter, setCurrencyFilter] = useState<'ALL' | 'USD' | 'ZiG'>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');

  // Modal State for Add / Edit Cost Item
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<FixedMonthlyCost | null>(null);

  // Modal State for Manage Categories
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('🏷️');
  const [editingCatKey, setEditingCatKey] = useState<string | null>(null);

  // Inline Category quick creation state in Add/Edit modal
  const [isAddingInlineCategory, setIsAddingInlineCategory] = useState(false);
  const [inlineCategoryName, setInlineCategoryName] = useState('');

  // Form Fields
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('RENT');
  const [branchId, setBranchId] = useState<string>('ALL');
  const [monthlyAmount, setMonthlyAmount] = useState<string>('');
  const [currency, setCurrency] = useState<'USD' | 'ZiG'>('USD');
  const [effectiveFrom, setEffectiveFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [effectiveTo, setEffectiveTo] = useState<string>('');
  const [isActive, setIsActive] = useState(true);

  // Available Branches
  const availableBranches = useMemo(() => {
    return getBranches();
  }, []);

  // Status Notification
  const [statusNotice, setStatusNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Days in current month for daily rate calculation
  const now = new Date();
  const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const loadData = () => {
    setFixedCosts(getCompanyFixedCosts());
    setCategories(getFixedCostCategories());
  };

  useEffect(() => {
    loadData();
    const handleUpdate = () => loadData();
    window.addEventListener('saimetric_fixed_costs_updated', handleUpdate);
    window.addEventListener('saimetric_fixed_cost_categories_updated', handleUpdate);
    return () => {
      window.removeEventListener('saimetric_fixed_costs_updated', handleUpdate);
      window.removeEventListener('saimetric_fixed_cost_categories_updated', handleUpdate);
    };
  }, []);

  // Filtered List
  const filteredCosts = useMemo(() => {
    return fixedCosts.filter((c) => {
      const matchCat = categoryFilter === 'All' || c.category === categoryFilter;
      const matchCurr = currencyFilter === 'ALL' || c.currency === currencyFilter;
      const matchBranch = branchFilter === 'ALL' || !c.branch_id || c.branch_id === 'ALL' || c.branch_id === branchFilter;
      const matchSearch =
        !searchQuery.trim() ||
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.category.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchCurr && matchBranch && matchSearch;
    });
  }, [fixedCosts, categoryFilter, currencyFilter, branchFilter, searchQuery]);

  // Aggregate Totals
  const activeUsdCosts = fixedCosts.filter((c) => c.is_active && (!c.currency || c.currency === 'USD'));
  const activeZigCosts = fixedCosts.filter((c) => c.is_active && c.currency === 'ZiG');

  const totalMonthlyUsd = activeUsdCosts.reduce((sum, c) => sum + (c.monthly_amount || 0), 0);
  const dailyRateUsd = totalMonthlyUsd / daysInCurrentMonth;

  const totalMonthlyZig = activeZigCosts.reduce((sum, c) => sum + (c.monthly_amount || 0), 0);
  const dailyRateZig = totalMonthlyZig / daysInCurrentMonth;

  const handleOpenAddModal = () => {
    setEditingCost(null);
    setName('');
    setCategory(categories[0]?.key || 'RENT');
    setBranchId('ALL');
    setMonthlyAmount('');
    setCurrency('USD');
    const d = new Date();
    setEffectiveFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    setEffectiveTo('');
    setIsActive(true);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (cost: FixedMonthlyCost) => {
    setEditingCost(cost);
    setName(cost.name);
    setCategory(cost.category);
    setBranchId(cost.branch_id || 'ALL');
    setMonthlyAmount(String(cost.monthly_amount));
    setCurrency(cost.currency || 'USD');
    setEffectiveFrom(cost.effective_from_date);
    setEffectiveTo(cost.effective_to_date || '');
    setIsActive(cost.is_active);
    setIsModalOpen(true);
  };

  const handleSaveCost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setStatusNotice({ text: 'Please enter a name for the fixed cost item.', type: 'error' });
      return;
    }
    const parsedAmount = parseFloat(monthlyAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setStatusNotice({ text: 'Please enter a valid monthly amount greater than zero.', type: 'error' });
      return;
    }

    try {
      saveFixedCost({
        uuid: editingCost?.uuid,
        name: name.trim(),
        category,
        branch_id: branchId,
        monthly_amount: parsedAmount,
        currency,
        effective_from_date: effectiveFrom || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
        effective_to_date: effectiveTo.trim() ? effectiveTo.trim() : null,
        is_active: isActive,
      });

      setStatusNotice({
        text: `Successfully ${editingCost ? 'updated' : 'added'} "${name}" ($${parsedAmount.toFixed(2)}/mo).`,
        type: 'success',
      });
      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      setStatusNotice({ text: err.message || 'Failed to save fixed cost.', type: 'error' });
    }
  };

  // Category CRUD Handlers
  const handleOpenCategoryManager = () => {
    setEditingCatKey(null);
    setNewCatLabel('');
    setNewCatIcon('🏷️');
    setIsCategoryModalOpen(true);
  };

  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatLabel.trim()) {
      setStatusNotice({ text: 'Please provide a category name.', type: 'error' });
      return;
    }
    const key = editingCatKey || newCatLabel.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const saved = saveFixedCostCategory({
      key,
      oldKey: editingCatKey || undefined,
      label: newCatLabel.trim(),
      icon: newCatIcon || '🏷️',
    });
    setStatusNotice({
      text: `Category "${newCatLabel.trim()}" saved successfully.`,
      type: 'success',
    });
    setCategory(saved.key);
    setEditingCatKey(null);
    setNewCatLabel('');
    setNewCatIcon('🏷️');
    loadData();
  };

  const handleQuickAddInlineCategory = () => {
    if (!inlineCategoryName.trim()) return;
    const cleanKey = inlineCategoryName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const saved = saveFixedCostCategory({
      key: cleanKey,
      label: inlineCategoryName.trim(),
      icon: '🏷️',
    });
    setCategory(saved.key);
    setInlineCategoryName('');
    setIsAddingInlineCategory(false);
    loadData();
    setStatusNotice({ text: `Created and selected category "${saved.label}".`, type: 'success' });
  };

  const handleStartEditCategory = (cat: FixedCostCategoryDefinition) => {
    setEditingCatKey(cat.key);
    setNewCatLabel(cat.label);
    setNewCatIcon(cat.icon);
  };

  const handleDeleteCategory = (catKey: string, catLabel: string) => {
    deleteFixedCostCategory(catKey);
    setStatusNotice({ text: `Removed category "${catLabel}".`, type: 'success' });
    loadData();
  };

  const handleDelete = (uuid: string, itemName: string) => {
    deleteFixedCost(uuid);
    setStatusNotice({ text: `Removed "${itemName}" from monthly fixed costs.`, type: 'success' });
    loadData();
  };

  const handleToggle = (uuid: string, currentActive: boolean) => {
    toggleFixedCostActive(uuid, !currentActive);
    setStatusNotice({
      text: `Item ${!currentActive ? 'activated' : 'deactivated'} for P&L proration.`,
      type: 'success',
    });
    loadData();
  };

  return (
    <div className="space-y-6 pb-24 animate-fadeIn">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-700/50 rounded-3xl p-5 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="w-9 h-9 rounded-2xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-slate-950 shadow-md">
              <Building className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-white tracking-tight">Monthly Fixed Costs</h1>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30">
                  QuickBooks Prorated
                </span>
              </div>
              <p className="text-xs text-indigo-200">
                Define monthly recurring overheads (Rent, Salaries, Internet). Prorated automatically into weekly &amp; daily P&amp;L true profit reports.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onNavigateToIncomeStatement && (
            <button
              type="button"
              onClick={onNavigateToIncomeStatement}
              className="py-2.5 px-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white text-xs font-bold border border-slate-700 shadow flex items-center gap-2 transition cursor-pointer"
            >
              <TrendingUp className="w-4 h-4" />
              <span>View P&amp;L Statement</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenCategoryManager}
            className="py-2.5 px-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold border border-slate-700 shadow flex items-center gap-2 transition cursor-pointer"
            title="Manage and create custom fixed expense categories"
          >
            <Tag className="w-4 h-4 text-amber-400" />
            <span>Manage Categories ({categories.length})</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-lg flex items-center gap-2 transition transform active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Monthly Fixed Cost</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
            Total Monthly Fixed (USD)
          </span>
          <div className="text-2xl font-black text-emerald-400 font-mono">
            ${totalMonthlyUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-slate-500 block">
            {activeUsdCosts.length} active recurring items
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
            Daily Proration Rate (USD)
          </span>
          <div className="text-2xl font-black text-amber-400 font-mono">
            ${dailyRateUsd.toFixed(2)} / day
          </div>
          <span className="text-[10px] text-slate-500 block">
            Monthly amount / {daysInCurrentMonth} days in current month
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
            Total Monthly Fixed (ZiG)
          </span>
          <div className="text-2xl font-black text-blue-400 font-mono">
            {totalMonthlyZig.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ZiG
          </div>
          <span className="text-[10px] text-slate-500 block">
            Daily rate: {dailyRateZig.toFixed(2)} ZiG/day
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
            Sync &amp; Offline Persistence
          </span>
          <div className="text-sm font-black text-white flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>IndexedDB Verified</span>
          </div>
          <span className="text-[10px] text-slate-500 block">
            100% offline-ready, auto-enqueued to sync
          </span>
        </div>
      </div>

      {/* Notification Banner */}
      {statusNotice && (
        <div
          className={`p-3 text-xs flex items-center justify-between gap-2 rounded-2xl border font-medium animate-fadeIn ${
            statusNotice.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/70 border-rose-800 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{statusNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Controls & Search */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search fixed cost name or category..."
            className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
          >
            <option value="All">All Categories ({categories.length})</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>

          {/* Currency Filter */}
          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
          >
            <option value="ALL">All Currencies</option>
            <option value="USD">USD</option>
            <option value="ZiG">ZiG</option>
          </select>

          {/* Branch Filter */}
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
          >
            <option value="ALL">All Branches &amp; Overhead</option>
            {availableBranches.map((b) => (
              <option key={b.branchId || b.id} value={b.branchId || b.id}>
                {b.name} ({b.code || b.branchId})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Fixed Costs CRUD Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                <th className="p-3.5">Cost Name &amp; Branch</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5">Monthly Amount</th>
                <th className="p-3.5">Daily Rate (est)</th>
                <th className="p-3.5">Currency</th>
                <th className="p-3.5">Effective Period</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredCosts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    <Building className="w-8 h-8 mx-auto mb-2 opacity-30 text-amber-400" />
                    <p className="font-bold text-slate-400">No fixed cost items found</p>
                    <p className="text-[11px]">Click "Add Monthly Fixed Cost" to define recurring overheads.</p>
                  </td>
                </tr>
              ) : (
                filteredCosts.map((item) => {
                  const dailyRate = item.monthly_amount / daysInCurrentMonth;
                  const catObj = categories.find((c) => c.key === item.category);
                  const branchName =
                    !item.branch_id || item.branch_id === 'ALL'
                      ? 'All Branches'
                      : availableBranches.find((b) => b.branchId === item.branch_id)?.name || item.branch_id;
                  return (
                    <tr key={item.uuid} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5">
                        <div className="font-bold text-white text-sm">{item.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                            {branchName}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{item.uuid}</span>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-indigo-300 border border-slate-700 inline-flex items-center gap-1">
                          <span>{catObj?.icon || '🏷️'}</span>
                          <span>{catObj ? catObj.label : item.category}</span>
                        </span>
                      </td>
                      <td className="p-3.5 font-mono font-black text-amber-400 text-sm">
                        {item.currency === 'ZiG' ? `${item.monthly_amount.toFixed(2)} ZiG` : `$${item.monthly_amount.toFixed(2)}`}
                      </td>
                      <td className="p-3.5 font-mono text-slate-300">
                        {item.currency === 'ZiG' ? `${dailyRate.toFixed(2)} ZiG/d` : `$${dailyRate.toFixed(2)}/d`}
                      </td>
                      <td className="p-3.5 font-mono font-bold text-slate-300">{item.currency}</td>
                      <td className="p-3.5 text-slate-400 text-[11px]">
                        <div>From: <strong className="text-white">{item.effective_from_date}</strong></div>
                        {item.effective_to_date ? (
                          <div>To: <strong className="text-white">{item.effective_to_date}</strong></div>
                        ) : (
                          <div className="text-emerald-400 text-[10px]">Ongoing (Active)</div>
                        )}
                      </td>
                      <td className="p-3.5">
                        <button
                          type="button"
                          onClick={() => handleToggle(item.uuid, item.is_active)}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 transition cursor-pointer ${
                            item.is_active
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          <span>{item.is_active ? 'Active' : 'Paused'}</span>
                        </button>
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(item)}
                            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                            title="Edit Item"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(item.uuid, item.name)}
                            className="p-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 hover:text-rose-200 transition cursor-pointer"
                            title="Delete Item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl text-white">
            <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Building className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">
                    {editingCost ? 'Edit Monthly Fixed Cost' : 'Add Monthly Fixed Cost'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Recurring overhead prorated in daily and weekly P&amp;L reports
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCost} className="p-5 space-y-4 text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-bold">Cost Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Shop Premises Rent, TelOne Fibre, Store Salaries..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-slate-400 font-bold">Category *</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCategoryModalOpen(true);
                      }}
                      className="text-[10px] text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New Category</span>
                    </button>
                  </div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold"
                  >
                    {categories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.icon} {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1 font-bold">Branch Assignment</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold"
                  >
                    <option value="ALL">All Branches (Universal Overheads)</option>
                    {availableBranches.map((b) => (
                      <option key={b.branchId || b.id} value={b.branchId || b.id}>
                        {b.name} ({b.code || b.branchId})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1 font-bold">Monthly Amount *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold font-mono">
                      {currency === 'ZiG' ? 'ZiG' : '$'}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={monthlyAmount}
                      onChange={(e) => setMonthlyAmount(e.target.value)}
                      placeholder="900.00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm font-mono font-bold text-amber-400 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1 font-bold">Currency *</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as 'USD' | 'ZiG')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="ZiG">ZiG (Zimbabwe Gold)</option>
                  </select>
                </div>
              </div>

              {monthlyAmount && (
                <span className="text-[10px] text-slate-400 block">
                  Daily rate = ${(parseFloat(monthlyAmount) / daysInCurrentMonth).toFixed(2)}/day (based on {daysInCurrentMonth} days this month)
                </span>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1 font-bold">Effective From *</label>
                  <input
                    type="date"
                    required
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1 font-bold">Effective To (Optional)</label>
                  <input
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    placeholder="Leave empty for ongoing"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 bg-slate-950 border-slate-700"
                  />
                  <span className="text-slate-300 font-bold">Include in current P&amp;L reports</span>
                </label>
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-800 justify-end">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-black shadow-lg cursor-pointer"
                >
                  {editingCost ? 'Update Cost' : 'Save Fixed Cost'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Manager Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl text-white">
            <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Tag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">Monthly Expense Categories</h3>
                  <p className="text-[11px] text-slate-400">
                    Add custom overhead categories or edit existing labels
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Add / Edit Category Form */}
              <form onSubmit={handleSaveCategory} className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-3">
                <div className="font-bold text-amber-400 text-xs flex items-center justify-between">
                  <span>{editingCatKey ? 'Edit Category' : '➕ Add New Category'}</span>
                  {editingCatKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatKey(null);
                        setNewCatLabel('');
                        setNewCatIcon('🏷️');
                      }}
                      className="text-[10px] text-slate-400 hover:text-white"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <div className="col-span-1">
                    <label className="text-slate-400 block mb-1 font-bold">Icon</label>
                    <select
                      value={newCatIcon}
                      onChange={(e) => setNewCatIcon(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-2 text-white text-base text-center"
                    >
                      <option value="🏷️">🏷️ Tag</option>
                      <option value="🏢">🏢 Premises</option>
                      <option value="👥">👥 Staff</option>
                      <option value="🌐">🌐 Internet</option>
                      <option value="📜">📜 License</option>
                      <option value="🛡️">🛡️ Security</option>
                      <option value="⚙️">⚙️ Overhead</option>
                      <option value="⛽">⛽ Fuel</option>
                      <option value="⚡">⚡ Power</option>
                      <option value="💧">💧 Water</option>
                      <option value="🧹">🧹 Cleaning</option>
                      <option value="🚗">🚗 Vehicle</option>
                      <option value="📦">📦 Logistics</option>
                      <option value="💻">💻 Software</option>
                      <option value="📑">📑 Accounting</option>
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="text-slate-400 block mb-1 font-bold">Category Name *</label>
                    <input
                      type="text"
                      required
                      value={newCatLabel}
                      onChange={(e) => setNewCatLabel(e.target.value)}
                      placeholder="e.g. Generator Fuel & Servicing, Security Guard..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs cursor-pointer shadow"
                  >
                    {editingCatKey ? 'Update Category' : 'Save Category'}
                  </button>
                </div>
              </form>

              {/* Categories List */}
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Available Categories ({categories.length})
                </span>
                <div className="divide-y divide-slate-800 rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden">
                  {categories.map((cat) => (
                    <div
                      key={cat.key}
                      className="p-2.5 flex items-center justify-between hover:bg-slate-900/50 transition"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-base">{cat.icon}</span>
                        <div>
                          <div className="font-bold text-white">{cat.label}</div>
                          <span className="text-[10px] text-slate-500 font-mono">{cat.key}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEditCategory(cat)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                          title="Edit Category"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        {cat.isCustom && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat.key, cat.label)}
                            className="p-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 hover:text-rose-200 transition cursor-pointer"
                            title="Delete Custom Category"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
