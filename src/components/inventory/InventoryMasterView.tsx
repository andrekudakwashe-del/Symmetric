import React, { useState, useMemo, useRef } from 'react';
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  ArrowDownRight,
  Boxes,
  Layers,
  Sparkles,
  Scissors,
  TrendingUp,
  Tag,
  CheckCircle2,
  DollarSign,
  Edit2,
  Trash2,
  RefreshCw,
  ShoppingBag,
  LayoutGrid,
  Table as TableIcon,
  ChevronRight,
  Check,
  FolderPlus,
  SlidersHorizontal,
  Info,
  Download,
  Upload,
  FileSpreadsheet,
  Lock,
} from 'lucide-react';
import { InventoryItem, Salesperson } from '../../types';
import { ProductAddEditModal } from './ProductAddEditModal';
import {
  downloadInventoryCsv,
  downloadInventoryTemplateCsv,
  parseInventoryCsv,
  importInventoryItems,
} from '../../services/dataExportImportService';
import {
  getInventoryItems,
  saveInventoryItem,
  deleteInventoryItem,
  breakCase,
  receiveStock,
  sellStock,
  getCategories,
  ensureCategoryExists,
} from '../../db/roomDatabase';

interface InventoryMasterViewProps {
  currentUser: Salesperson | null;
  onOpenGRN?: (itemId?: string) => void;
  onTriggerGRN?: (itemId?: string) => void;
}

export const InventoryMasterView: React.FC<InventoryMasterViewProps> = ({
  currentUser,
  onOpenGRN,
  onTriggerGRN,
}) => {
  const triggerGRN = (itemId?: string) => {
    if (onTriggerGRN) {
      onTriggerGRN(itemId);
    } else if (onOpenGRN) {
      onOpenGRN(itemId);
    }
  };

  const [items, setItems] = useState<InventoryItem[]>(getInventoryItems());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'simplistic' | 'table'>('simplistic');

  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    (currentUser?.role as string) === 'super_admin' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';
  const isOwner = currentUser?.role === 'OWNER';
  const isAdmin = currentUser?.role === 'ADMIN';
  const isManager = currentUser?.role === 'MANAGER';

  const canManageInventory = useMemo(() => {
    if (!currentUser) return false;
    if (isSuperAdmin || isOwner || isAdmin || isManager) {
      return currentUser.permissions?.canManageInventory !== false;
    }
    return Boolean(currentUser.permissions?.canManageInventory);
  }, [currentUser, isSuperAdmin, isOwner, isAdmin, isManager]);

  const canBreakCases = useMemo(() => {
    if (!currentUser) return false;
    if (isSuperAdmin || isOwner || isAdmin || isManager) {
      return currentUser.permissions?.canBreakCases !== false;
    }
    return Boolean(currentUser.permissions?.canBreakCases);
  }, [currentUser, isSuperAdmin, isOwner, isAdmin, isManager]);

  // Selected item / variant for Simplistic View Inspector
  const [selectedItemVariantId, setSelectedItemVariantId] = useState<string>('');
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [breakCaseItem, setBreakCaseItem] = useState<InventoryItem | null>(null);
  const [breakCasesCount, setBreakCasesCount] = useState(1);
  const [quickSellItem, setQuickSellItem] = useState<InventoryItem | null>(null);
  const [quickSellCases, setQuickSellCases] = useState(0);
  const [quickSellSingles, setQuickSellSingles] = useState(1);
  const [promptMessage, setPromptMessage] = useState<{
    type: 'BREAK_CASE' | 'BULK_DISCOUNT';
    message: string;
    casesNeeded?: number;
    unitsToGain?: number;
    suggestedCases?: number;
    remainderSingles?: number;
    potentialSavings?: number;
  } | null>(null);

  // Category dropdown searchable state in Add/Edit modal
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearchTerm, setCategorySearchTerm] = useState('');

  // Form state for Add/Edit
  const [formData, setFormData] = useState<Partial<InventoryItem>>({
    itemId: '',
    itemName: '',
    category: 'Dry Grocery & Staples',
    canSellAsCase: false, // Default: no selling as cases
    unitsPerCase: 24,
    costPerCase: 24.0,
    sellPriceCase: 30.0,
    sellPriceUnit: 1.5,
    stockCases: 0,
    stockSingles: 0,
    reorderLevelCases: 2,
    reorderLevelUnits: 10,
    sku: '',
    barcode: '',
    description: '',
  });

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 4500);
  };

  const refreshList = () => {
    setItems(getInventoryItems());
  };

  const inventoryFileInputRef = useRef<HTMLInputElement>(null);

  const handleQuickImportInventory = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        showToast('error', 'Uploaded file is empty.');
        return;
      }
      const res = parseInventoryCsv(text);
      if (res.items.length === 0) {
        showToast('error', 'No valid items found in CSV file.');
        return;
      }
      const importRes = importInventoryItems(res.items, 'merge');
      refreshList();
      showToast('success', `Imported ${importRes.added} new items and updated ${importRes.updated} existing items.`);
    };
    reader.readAsText(file);
  };

  // Categories list
  const storedCategories = getCategories();
  const allCategoryNames = useMemo(() => {
    const set = new Set<string>();
    storedCategories.forEach((c) => set.add(c.categoryName));
    items.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set);
  }, [storedCategories, items]);

  const categories = ['ALL', ...allCategoryNames];

  // Filtered categories for the category search in modal
  const filteredModalCategories = useMemo(() => {
    const term = (categorySearchTerm || '').toLowerCase().trim();
    if (!term) return allCategoryNames;
    return allCategoryNames.filter((c) => (c || '').toLowerCase().includes(term));
  }, [allCategoryNames, categorySearchTerm]);

  // Metrics
  const totalValuation = items.reduce(
    (sum, i) => sum + (i.stockCases * i.costPerCase) + (i.stockSingles * (i.costPerCase / (i.unitsPerCase || 1))),
    0
  );
  const totalCasesInStock = items.reduce((sum, i) => sum + (i.stockCases || 0), 0);
  const totalSinglesInStock = items.reduce((sum, i) => sum + (i.stockSingles || 0), 0);
  const lowStockItems = items.filter(
    (i) => i.stockCases <= i.reorderLevelCases || i.stockSingles <= i.reorderLevelUnits
  );

  // Filtered items
  const filteredItems = items.filter((item) => {
    const q = (searchQuery || '').trim().toLowerCase();
    const matchesSearch =
      !q ||
      (item.itemName && item.itemName.toLowerCase().includes(q)) ||
      (item.itemId && item.itemId.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q));

    const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
    const matchesLowStock = !filterLowStockOnly || item.stockCases <= item.reorderLevelCases;

    return matchesSearch && matchesCategory && matchesLowStock;
  });

  // Default active selected item for simplistic view
  const activeSelectedItem = useMemo(() => {
    if (filteredItems.length === 0) return null;
    if (selectedItemVariantId) {
      const found = filteredItems.find((i) => i.itemId === selectedItemVariantId);
      if (found) return found;
    }
    return filteredItems[0];
  }, [filteredItems, selectedItemVariantId]);

  // Handle Save
  const handleSaveItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemId || !formData.itemName) {
      showToast('error', 'Item ID and Item Name are required');
      return;
    }

    const unitsPerCase = Number(formData.unitsPerCase) || 1;
    const costPerCase = Number(formData.costPerCase) || 0;
    const costPerUnit = costPerCase / unitsPerCase;
    const stockCases = Number(formData.stockCases) || 0;
    const stockSingles = Number(formData.stockSingles) || 0;
    const totalUnits = (stockCases * unitsPerCase) + stockSingles;
    const chosenCategory = formData.category?.trim() || 'General';

    // Ensure custom typed category is saved in persistent category registry
    ensureCategoryExists(chosenCategory);

    const itemToSave: InventoryItem = {
      itemId: formData.itemId.trim().toUpperCase(),
      itemName: formData.itemName.trim(),
      category: chosenCategory,
      canSellAsCase: Boolean(formData.canSellAsCase),
      unitsPerCase,
      costPerCase,
      costPerUnit,
      sellPriceCase: Number(formData.sellPriceCase) || 0,
      sellPriceUnit: Number(formData.sellPriceUnit) || 0,
      stockCases,
      stockSingles,
      totalUnits,
      reorderLevelCases: Number(formData.reorderLevelCases) || 0,
      reorderLevelUnits: Number(formData.reorderLevelUnits) || 0,
      sku: formData.sku?.trim() || `SKU-${formData.itemId}`,
      barcode: formData.barcode?.trim() || '',
      description: formData.description?.trim() || '',
    };

    saveInventoryItem(itemToSave);
    refreshList();
    setShowAddModal(false);
    setEditingItem(null);
    setCategoryDropdownOpen(false);
    showToast('success', `Saved item ${itemToSave.itemName} (${itemToSave.itemId})`);
  };

  const handleItemCardClick = (item: InventoryItem) => {
    setSelectedItemVariantId(item.itemId);
    setShowDetailModal(true);
  };

  const handleEditClick = (item: InventoryItem) => {
    if (!canManageInventory) {
      showToast('error', 'Permission Denied: Cashiers are not permitted to edit inventory items.');
      return;
    }
    setShowDetailModal(false);
    setEditingItem(item);
    setFormData({
      ...item,
      canSellAsCase: item.canSellAsCase ?? false,
    });
    setCategorySearchTerm('');
    setCategoryDropdownOpen(false);
    setShowAddModal(true);
  };

  const handleDeleteClick = (itemId: string, name: string) => {
    if (!canManageInventory) {
      showToast('error', 'Permission Denied: Cashiers cannot delete inventory products.');
      return;
    }
    if (confirm(`Are you sure you want to delete "${name}" (${itemId}) from InventoryMaster?`)) {
      deleteInventoryItem(itemId);
      refreshList();
      showToast('success', `Deleted ${name}`);
    }
  };

  // Manual Break Case
  const handleConfirmBreakCase = () => {
    if (!breakCaseItem) return;
    if (!canBreakCases) {
      showToast('error', 'Permission Denied: Cashiers are not permitted to break cases to singles.');
      return;
    }
    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Administrator';
    const res = breakCase(breakCaseItem.itemId, breakCasesCount, staffId, staffName);

    if (res.success) {
      showToast('success', res.message);
      refreshList();
      setBreakCaseItem(null);
      setBreakCasesCount(1);
    } else {
      showToast('error', res.message);
    }
  };

  // Quick Sell with Rule B & C support
  const handleQuickSell = (autoBreak = false, bypassBulk = false) => {
    if (!quickSellItem) return;
    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Staff';

    const res = sellStock({
      itemId: quickSellItem.itemId,
      qtyCases: quickSellCases,
      qtySingles: quickSellSingles,
      staffId,
      staffName,
      referenceId: 'POS-QUICK',
      autoBreakConfirmed: autoBreak,
      bypassBulkPrompt: bypassBulk,
    });

    if (res.promptRequired) {
      if (res.promptType === 'BREAK_CASE') {
        setPromptMessage({
          type: 'BREAK_CASE',
          message: res.message,
          casesNeeded: res.casesNeeded,
          unitsToGain: res.unitsToGain,
        });
      } else if (res.promptType === 'BULK_DISCOUNT') {
        setPromptMessage({
          type: 'BULK_DISCOUNT',
          message: res.message,
          suggestedCases: res.suggestedCases,
          remainderSingles: res.remainderSingles,
          potentialSavings: res.potentialSavings,
        });
      }
      return;
    }

    if (res.success) {
      showToast('success', res.message);
      refreshList();
      setQuickSellItem(null);
      setPromptMessage(null);
      setQuickSellCases(0);
      setQuickSellSingles(1);
    } else {
      showToast('error', res.message);
    }
  };

  return (
    <div id="inventory-master-view" className="space-y-5">
      {/* Toast Notification */}
      {notification && (
        <div
          id="inventory-toast"
          className={`p-4 rounded-2xl text-sm font-bold flex items-center gap-3 shadow-lg border transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-950 border-emerald-300'
              : 'bg-rose-50 text-rose-950 border-rose-300'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          )}
          <span>{notification.text}</span>
        </div>
      )}

      {/* Top Metrics Banner */}
      <div id="inventory-metrics" className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900 text-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">Total Valuation</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-1.5 sm:mt-2">
            <div className="text-xl sm:text-2xl font-black font-mono tracking-tight">${totalValuation.toFixed(2)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{items.length} Tracked SKUs</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">Cases In Stock</span>
            <Boxes className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-1.5 sm:mt-2">
            <div className="text-xl sm:text-2xl font-black font-mono text-slate-900">{totalCasesInStock}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Bulk Storage Units</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">Singles In Stock</span>
            <Layers className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-1.5 sm:mt-2">
            <div className="text-xl sm:text-2xl font-black font-mono text-slate-900">{totalSinglesInStock}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Ready for Single Sale</div>
          </div>
        </div>

        <div
          onClick={() => setFilterLowStockOnly(!filterLowStockOnly)}
          className={`cursor-pointer rounded-2xl p-3.5 sm:p-4 shadow-sm border transition-all flex flex-col justify-between ${
            filterLowStockOnly
              ? 'bg-rose-600 text-white border-rose-700 ring-2 ring-rose-300'
              : lowStockItems.length > 0
              ? 'bg-rose-50 text-rose-950 border-rose-200 hover:bg-rose-100'
              : 'bg-white text-slate-900 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider">Reorder Alerts</span>
            <AlertTriangle className={`w-4 h-4 ${filterLowStockOnly ? 'text-white' : 'text-rose-600'}`} />
          </div>
          <div className="mt-1.5 sm:mt-2">
            <div className="text-xl sm:text-2xl font-black font-mono">{lowStockItems.length}</div>
            <div className="text-[11px] opacity-80 mt-0.5">
              {filterLowStockOnly ? 'Filtered: Low stock only' : 'Items needing restock'}
            </div>
          </div>
        </div>
      </div>

      {/* Control Bar: Search, Category, View Mode, Actions */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-200 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex flex-1 flex-wrap sm:flex-nowrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, ID (e.g. SUG001), category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 shadow-sm"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-sm"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'ALL' ? 'All Categories' : c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle: Simplistic Cards vs Data Table */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('simplistic')}
              title="Simplistic Mobile-First View (Screenshot Desired 1)"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                viewMode === 'simplistic'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Simplistic</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              title="Full Data Grid"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              id="btn-export-inventory-csv"
              onClick={() => {
                downloadInventoryCsv(filteredItems.length > 0 ? filteredItems : items);
                showToast('success', 'Inventory CSV export downloaded.');
              }}
              title="Export Inventory to CSV file"
              className="px-2.5 sm:px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>Export</span>
            </button>

            {canManageInventory && (
              <>
                <input
                  ref={inventoryFileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={(e) => e.target.files?.[0] && handleQuickImportInventory(e.target.files[0])}
                  className="hidden"
                />

                <button
                  type="button"
                  id="btn-import-inventory-csv"
                  onClick={() => inventoryFileInputRef.current?.click()}
                  title="Import products from CSV file"
                  className="px-2.5 sm:px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Import</span>
                </button>
              </>
            )}
          </div>

          <button
            id="btn-open-grn-header"
            onClick={() => triggerGRN()}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5"
          >
            <ArrowDownRight className="w-4 h-4 text-slate-700" />
            <span className="hidden sm:inline">Receive (GRN)</span>
          </button>

          {canManageInventory ? (
            <button
              id="btn-add-item-modal"
              onClick={() => {
                setEditingItem(null);
                setFormData({
                  itemId: `ITM${Math.floor(100 + Math.random() * 900)}`,
                  itemName: '',
                  category: 'Dry Grocery & Staples',
                  canSellAsCase: false, // Default false
                  unitsPerCase: 24,
                  costPerCase: 24.0,
                  sellPriceCase: 30.0,
                  sellPriceUnit: 1.5,
                  stockCases: 0,
                  stockSingles: 0,
                  reorderLevelCases: 2,
                  reorderLevelUnits: 10,
                  sku: '',
                  barcode: '',
                  description: '',
                });
                setCategorySearchTerm('');
                setCategoryDropdownOpen(false);
                setShowAddModal(true);
              }}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Item</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-semibold select-none border border-slate-200">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Catalog Locked</span>
            </div>
          )}
        </div>
      </div>

      {/* VIEW MODE 1: SIMPLISTIC VIEW (Matching Screenshot "desired 1") */}
      {viewMode === 'simplistic' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left: Simplistic Product / Variant List (7 Cols on desktop, full width on mobile) */}
            <div className="lg:col-span-7 space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Select Item or Variant to View Details ({filteredItems.length})
                </span>
                <button
                  onClick={refreshList}
                  className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>

              {filteredItems.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-200">
                  No inventory items match your search.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredItems.map((item) => {
                    const isSelected = activeSelectedItem?.itemId === item.itemId;
                    const canSellCase = Boolean(item.canSellAsCase);
                    const isLow = item.stockCases <= item.reorderLevelCases || item.stockSingles <= item.reorderLevelUnits;

                    return (
                      <div
                        key={item.itemId}
                        id={`item-card-${item.itemId}`}
                        onClick={() => handleItemCardClick(item)}
                        className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-slate-900/20'
                            : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          {/* Item Name & Details */}
                          <div className="flex-1 pr-2">
                            <div className="flex items-center gap-2">
                              <h3 className="font-black text-sm sm:text-base leading-tight">
                                {item.itemName}
                              </h3>
                              {canSellCase ? (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isSelected ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/30' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                }`}>
                                  Case & Single
                                </span>
                              ) : (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isSelected ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  Singles Only
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              <span className={`text-xs font-mono font-bold ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                                {item.itemId}
                              </span>
                              <span className={`text-xs font-medium ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
                                • {item.category}
                              </span>
                              <span className={`text-xs font-medium ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
                                • 1cs = {item.unitsPerCase} ea
                              </span>
                            </div>
                          </div>

                          {/* Price & Stock Overview on Card */}
                          <div className="text-right flex flex-col items-end">
                            <div className={`font-mono font-black text-base ${isSelected ? 'text-emerald-300' : 'text-emerald-700'}`}>
                              ${item.sellPriceUnit.toFixed(2)}
                              <span className={`text-[11px] font-normal ml-0.5 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>/ea</span>
                            </div>
                            {canSellCase && item.sellPriceCase > 0 && (
                              <div className={`text-xs font-mono font-bold ${isSelected ? 'text-slate-300' : 'text-slate-600'}`}>
                                ${item.sellPriceCase.toFixed(2)}/cs
                              </div>
                            )}
                            <div className="mt-1 flex items-center gap-1">
                              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${
                                isLow
                                  ? isSelected ? 'bg-rose-500/30 text-rose-200' : 'bg-rose-100 text-rose-800'
                                  : isSelected ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'
                              }`}>
                                {item.stockSingles} Singles {item.stockCases > 0 ? `+ ${item.stockCases} cs` : ''}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Quick action buttons row on card */}
                        <div className={`flex items-center gap-2 mt-2.5 pt-2.5 border-t ${
                          isSelected ? 'border-slate-800' : 'border-slate-100'
                        }`}>
                          {canManageInventory && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditClick(item);
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                                isSelected
                                  ? 'bg-slate-800 hover:bg-slate-700 text-white'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                              }`}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Edit Item</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerGRN(item.itemId);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition ${
                              isSelected
                                ? 'bg-blue-500/20 text-blue-200 hover:bg-blue-500/30'
                                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                            }`}
                          >
                            <ArrowDownRight className="w-3.5 h-3.5" />
                            <span>Receive</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleItemCardClick(item);
                            }}
                            className={`ml-auto px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition ${
                              isSelected ? 'text-slate-300 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                            }`}
                          >
                            <span>Open Details</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Simplistic Detail Inspector Panel (Desktop sticky preview) */}
            <div className="hidden lg:block lg:col-span-5 sticky top-4">
              {activeSelectedItem ? (
                <div className="bg-white rounded-3xl p-5 shadow-md border border-slate-200 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {activeSelectedItem.itemId}
                      </span>
                      <h2 className="text-lg font-black text-slate-950 mt-1">
                        {activeSelectedItem.itemName}
                      </h2>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">
                        Category: {activeSelectedItem.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {canManageInventory ? (
                        <>
                          <button
                            title="Edit Item"
                            onClick={() => handleEditClick(activeSelectedItem)}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            title="Delete Item"
                            onClick={() => handleDeleteClick(activeSelectedItem.itemId, activeSelectedItem.itemName)}
                            className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 transition cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-50 text-slate-400 text-[11px] font-semibold border border-slate-100 select-none">
                          <Lock className="w-3 h-3 text-slate-400" />
                          <span>View Only</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pricing & Stock Grid (Clean, high-contrast) */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {/* Singles Variant */}
                    <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <div className="text-[11px] font-bold text-slate-500 uppercase">Single / Each</div>
                      <div className="mt-1 font-mono font-black text-lg text-emerald-700">
                        ${activeSelectedItem.sellPriceUnit.toFixed(2)}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Stock: <span className="font-bold text-slate-900 font-mono">{activeSelectedItem.stockSingles} Units</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Cost: ${(activeSelectedItem.costPerCase / (activeSelectedItem.unitsPerCase || 1)).toFixed(2)}/ea
                      </div>
                    </div>

                    {/* Case Variant */}
                    <div className={`p-3 rounded-2xl border ${
                      activeSelectedItem.canSellAsCase
                        ? 'bg-indigo-50/50 border-indigo-200 text-slate-900'
                        : 'bg-slate-50 border-slate-200 text-slate-400 opacity-80'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase">Case Variant</span>
                        {activeSelectedItem.canSellAsCase ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Active</span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">Off</span>
                        )}
                      </div>
                      <div className="mt-1 font-mono font-black text-lg text-indigo-950">
                        {activeSelectedItem.canSellAsCase
                          ? `$${activeSelectedItem.sellPriceCase.toFixed(2)}`
                          : 'N/A (Singles only)'}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Stock: <span className="font-bold text-slate-900 font-mono">{activeSelectedItem.stockCases} Cases</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        1 Case = {activeSelectedItem.unitsPerCase} Units
                      </div>
                    </div>
                  </div>

                  {/* Summary Metric Strip */}
                  <div className="p-3 bg-slate-900 text-white rounded-2xl flex items-center justify-between text-xs">
                    <div>
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Total Available Units</div>
                      <div className="text-base font-black font-mono text-white mt-0.5">
                        {activeSelectedItem.totalUnits} Units
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-400 text-[10px] uppercase font-bold">Inventory Valuation</div>
                      <div className="text-base font-black font-mono text-emerald-400 mt-0.5">
                        ${((activeSelectedItem.stockCases * activeSelectedItem.costPerCase) + (activeSelectedItem.stockSingles * (activeSelectedItem.costPerCase / (activeSelectedItem.unitsPerCase || 1)))).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => triggerGRN(activeSelectedItem.itemId)}
                        className="py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm"
                      >
                        <ArrowDownRight className="w-4 h-4" />
                        <span>Receive Stock (GRN)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setQuickSellItem(activeSelectedItem);
                          setQuickSellCases(0);
                          setQuickSellSingles(1);
                          setPromptMessage(null);
                        }}
                        className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        <span>Sell Item</span>
                      </button>
                    </div>

                    {activeSelectedItem.stockCases > 0 && canBreakCases && (
                      <button
                        type="button"
                        onClick={() => {
                          setBreakCaseItem(activeSelectedItem);
                          setBreakCasesCount(1);
                        }}
                        className="w-full py-2.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                      >
                        <Scissors className="w-4 h-4 text-indigo-600" />
                        <span>Break Case ({activeSelectedItem.stockCases} Cases Available)</span>
                      </button>
                    )}

                    {canManageInventory ? (
                      <button
                        type="button"
                        onClick={() => handleEditClick(activeSelectedItem)}
                        className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                        <span>Edit Product Details</span>
                      </button>
                    ) : (
                      <div className="w-full py-2 px-3 bg-slate-50 text-slate-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 select-none">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Product Editing Restricted to Managers</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-3xl p-8 text-center text-slate-400 border border-slate-200">
                  Select an item from the list to inspect details.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* VIEW MODE 2: FULL DATA TABLE */
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-slate-700" />
              <h2 className="text-base font-bold text-slate-900">Inventory Master (Cases & Singles)</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {filteredItems.length} items
              </span>
            </div>
            <button
              onClick={refreshList}
              className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600 transition text-xs flex items-center gap-1 font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs uppercase tracking-wider font-bold border-b border-slate-200">
                  <th className="py-3 px-4">Item ID / SKU</th>
                  <th className="py-3 px-4">Product Name & Category</th>
                  <th className="py-3 px-3 text-center">Case Selling</th>
                  <th className="py-3 px-3 text-center">1cs = N ea</th>
                  <th className="py-3 px-4 text-center">Cases Stock</th>
                  <th className="py-3 px-4 text-center">Singles Stock</th>
                  <th className="py-3 px-4 text-center bg-slate-50 font-bold text-slate-900">Total Units</th>
                  <th className="py-3 px-3 text-right">Cost (Cs / Ea)</th>
                  <th className="py-3 px-3 text-right">Sell (Cs / Ea)</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400 font-medium">
                      No inventory items matched your criteria.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const isLowCases = item.stockCases <= item.reorderLevelCases;
                    const isZeroSingles = item.stockSingles === 0;
                    const costPerUnit = item.costPerCase / (item.unitsPerCase || 1);

                    return (
                      <tr
                        key={item.itemId}
                        onClick={() => handleItemCardClick(item)}
                        className="hover:bg-slate-50/75 transition-colors group cursor-pointer"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-black text-slate-950">{item.itemId}</div>
                          <div className="text-xs text-slate-500 font-mono">{item.sku || 'No SKU'}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-950">{item.itemName}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                              {item.category}
                            </span>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          {item.canSellAsCase ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                              Disabled
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-800 font-mono font-bold text-xs">
                            {item.unitsPerCase} / cs
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`font-mono font-bold text-sm px-2.5 py-1 rounded-lg ${
                              item.stockCases === 0
                                ? 'bg-slate-100 text-slate-500'
                                : isLowCases
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'text-slate-900'
                            }`}
                          >
                            {item.stockCases} Cases
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`font-mono font-bold text-sm px-2.5 py-1 rounded-lg ${
                              isZeroSingles
                                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                : 'text-slate-900'
                            }`}
                          >
                            {item.stockSingles} Singles
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-center bg-slate-50/50">
                          <div className="font-mono font-black text-slate-950 text-base">
                            {item.totalUnits}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 text-right font-mono">
                          <div className="text-slate-900 font-bold">${item.costPerCase.toFixed(2)}</div>
                          <div className="text-xs text-slate-500">${costPerUnit.toFixed(2)}</div>
                        </td>

                        <td className="py-3.5 px-3 text-right font-mono">
                          <div className="text-emerald-800 font-black">${item.sellPriceUnit.toFixed(2)}/ea</div>
                          {item.canSellAsCase && (
                            <div className="text-xs text-indigo-700 font-bold">${item.sellPriceCase.toFixed(2)}/cs</div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              title={`Receive Stock (GRN)`}
                              onClick={(e) => {
                                e.stopPropagation();
                                triggerGRN(item.itemId);
                              }}
                              className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition"
                            >
                              <ArrowDownRight className="w-3.5 h-3.5" />
                            </button>

                            {item.stockCases > 0 && canBreakCases && (
                              <button
                                title={`Break Case`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBreakCaseItem(item);
                                  setBreakCasesCount(1);
                                }}
                                className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition cursor-pointer"
                              >
                                <Scissors className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {canManageInventory ? (
                              <>
                                <button
                                  title="Edit"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditClick(item);
                                  }}
                                  className="p-1.5 hover:bg-slate-100 text-slate-700 rounded-lg transition cursor-pointer"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  title="Delete"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClick(item.itemId, item.itemName);
                                  }}
                                  className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="p-1 text-slate-300" title="Cashiers cannot edit inventory">
                                <Lock className="w-3.5 h-3.5" />
                              </span>
                            )}
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
      )}

      {/* Item Details & Edit Window Modal (Opens instantly when tapping any item on mobile or table) */}
      {showDetailModal && activeSelectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95 my-6">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                  {activeSelectedItem.itemId}
                </span>
                <h2 className="text-xl font-black text-slate-950 mt-1 leading-tight">
                  {activeSelectedItem.itemName}
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Category: {activeSelectedItem.category}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {canManageInventory && (
                  <>
                    <button
                      title="Edit Item"
                      onClick={() => handleEditClick(activeSelectedItem)}
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      title="Delete Item"
                      onClick={() => {
                        handleDeleteClick(activeSelectedItem.itemId, activeSelectedItem.itemName);
                        setShowDetailModal(false);
                      }}
                      className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  title="Close Window"
                  onClick={() => setShowDetailModal(false)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Pricing & Stock Cards (Exact layout from Screenshot 1) */}
            <div className="grid grid-cols-2 gap-3">
              {/* Singles Variant */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Single / Each</div>
                <div className="mt-1 font-mono font-black text-xl text-emerald-700">
                  ${activeSelectedItem.sellPriceUnit.toFixed(2)}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Stock: <span className="font-bold text-slate-900 font-mono">{activeSelectedItem.stockSingles} Units</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Cost: ${(activeSelectedItem.costPerCase / (activeSelectedItem.unitsPerCase || 1)).toFixed(2)}/ea
                </div>
              </div>

              {/* Case Variant */}
              <div className={`p-3.5 rounded-2xl border ${
                activeSelectedItem.canSellAsCase
                  ? 'bg-indigo-50/50 border-indigo-200 text-slate-900'
                  : 'bg-slate-50 border-slate-200 text-slate-400 opacity-80'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase">Case Variant</span>
                  {activeSelectedItem.canSellAsCase ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Active</span>
                  ) : (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">Off</span>
                  )}
                </div>
                <div className="mt-1 font-mono font-black text-xl text-indigo-950">
                  {activeSelectedItem.canSellAsCase
                    ? `$${activeSelectedItem.sellPriceCase.toFixed(2)}`
                    : 'N/A (Singles only)'}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Stock: <span className="font-bold text-slate-900 font-mono">{activeSelectedItem.stockCases} Cases</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  1 Case = {activeSelectedItem.unitsPerCase} Units
                </div>
              </div>
            </div>

            {/* Summary Metric Strip */}
            <div className="p-3.5 bg-slate-900 text-white rounded-2xl flex items-center justify-between text-xs">
              <div>
                <div className="text-slate-400 text-[10px] uppercase font-bold">Total Available Units</div>
                <div className="text-lg font-black font-mono text-white mt-0.5">
                  {activeSelectedItem.totalUnits} Units
                </div>
              </div>
              <div className="text-right">
                <div className="text-slate-400 text-[10px] uppercase font-bold">Inventory Valuation</div>
                <div className="text-lg font-black font-mono text-emerald-400 mt-0.5">
                  ${((activeSelectedItem.stockCases * activeSelectedItem.costPerCase) + (activeSelectedItem.stockSingles * (activeSelectedItem.costPerCase / (activeSelectedItem.unitsPerCase || 1)))).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDetailModal(false);
                    triggerGRN(activeSelectedItem.itemId);
                  }}
                  className="py-3 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm"
                >
                  <ArrowDownRight className="w-4 h-4" />
                  <span>Receive Stock (GRN)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowDetailModal(false);
                    setQuickSellItem(activeSelectedItem);
                    setQuickSellCases(0);
                    setQuickSellSingles(1);
                    setPromptMessage(null);
                  }}
                  className="py-3 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>Sell Item</span>
                </button>
              </div>

              {activeSelectedItem.stockCases > 0 && canBreakCases && (
                <button
                  type="button"
                  onClick={() => {
                    setShowDetailModal(false);
                    setBreakCaseItem(activeSelectedItem);
                    setBreakCasesCount(1);
                  }}
                  className="w-full py-2.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Scissors className="w-4 h-4 text-indigo-600" />
                  <span>Break Case ({activeSelectedItem.stockCases} Cases Available)</span>
                </button>
              )}

              {canManageInventory ? (
                <button
                  type="button"
                  onClick={() => handleEditClick(activeSelectedItem)}
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition shadow-md cursor-pointer"
                >
                  <Edit2 className="w-4 h-4 text-slate-300" />
                  <span>Edit Product Details & Pricing</span>
                </button>
              ) : (
                <div className="w-full py-2.5 px-4 bg-slate-50 text-slate-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-200 select-none">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Product Editing Restricted to Managers</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Break Case Modal */}
      {breakCaseItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-indigo-50 text-indigo-600">
                  <Scissors className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Break Case to Singles</h3>
                  <p className="text-xs text-slate-500">{breakCaseItem.itemName} ({breakCaseItem.itemId})</p>
                </div>
              </div>
              <button
                onClick={() => setBreakCaseItem(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4 space-y-2 text-sm text-indigo-900">
              <div className="flex justify-between font-medium">
                <span>Current Cases in Stock:</span>
                <span className="font-mono font-bold">{breakCaseItem.stockCases} Cases</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Current Singles in Stock:</span>
                <span className="font-mono font-bold">{breakCaseItem.stockSingles} Singles</span>
              </div>
              <div className="flex justify-between font-medium border-t border-indigo-200/50 pt-2">
                <span>Case Conversion Rate:</span>
                <span className="font-mono font-bold">1 Case = {breakCaseItem.unitsPerCase} Singles</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Number of Cases to Break
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setBreakCasesCount(Math.max(1, breakCasesCount - 1))}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center text-lg"
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  max={breakCaseItem.stockCases}
                  value={breakCasesCount}
                  onChange={(e) => setBreakCasesCount(Math.min(breakCaseItem.stockCases, Math.max(1, Number(e.target.value) || 1)))}
                  className="flex-1 py-2.5 text-center font-mono font-black text-xl bg-white border-2 border-slate-300 text-slate-950 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
                <button
                  type="button"
                  onClick={() => setBreakCasesCount(Math.min(breakCaseItem.stockCases, breakCasesCount + 1))}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center text-lg"
                >
                  +
                </button>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1 text-slate-600 border border-slate-200">
              <div className="font-semibold text-slate-800">Result of this operation:</div>
              <div className="flex justify-between">
                <span>Cases remaining:</span>
                <span className="font-mono font-bold">{breakCaseItem.stockCases - breakCasesCount}</span>
              </div>
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Singles after break:</span>
                <span className="font-mono font-bold">
                  {breakCaseItem.stockSingles + (breakCasesCount * breakCaseItem.unitsPerCase)} (+{breakCasesCount * breakCaseItem.unitsPerCase})
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBreakCaseItem(null)}
                className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBreakCase}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 transition"
              >
                Confirm Break
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Sell Modal */}
      {quickSellItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-50 text-emerald-600">
                  <ShoppingBag className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Process Quick Sale</h3>
                  <p className="text-xs text-slate-500">{quickSellItem.itemName} ({quickSellItem.itemId})</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setQuickSellItem(null);
                  setPromptMessage(null);
                }}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            {/* Current Stock Indicator */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div>
                <span className="text-slate-500">Stock Cases:</span>
                <div className="font-bold font-mono text-sm text-slate-900">{quickSellItem.stockCases} Cases</div>
              </div>
              <div>
                <span className="text-slate-500">Stock Singles:</span>
                <div className="font-bold font-mono text-sm text-slate-900">{quickSellItem.stockSingles} Singles</div>
              </div>
            </div>

            {/* Prompts for Rule B and C */}
            {promptMessage?.type === 'BREAK_CASE' ? (
              <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 space-y-3 animate-in fade-in">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-amber-950 text-sm">Rule B: Break Case Required</h4>
                    <p className="text-xs text-amber-800 mt-1">{promptMessage.message}</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleQuickSell(true, false)}
                    className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-200 transition"
                  >
                    Break Case & Sell
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptMessage(null)}
                    className="px-3 py-2.5 border border-amber-300 text-amber-800 hover:bg-amber-100 rounded-xl text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : promptMessage?.type === 'BULK_DISCOUNT' ? (
              <div className="bg-indigo-50 border-2 border-indigo-300 rounded-2xl p-4 space-y-3 animate-in fade-in">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-indigo-950 text-sm">Rule C: Cheaper as Case(s)!</h4>
                    <p className="text-xs text-indigo-800 mt-1">{promptMessage.message}</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickSellCases(promptMessage.suggestedCases || 0);
                      setQuickSellSingles(promptMessage.remainderSingles || 0);
                      setPromptMessage(null);
                    }}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-200 transition"
                  >
                    Switch to Case Price
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickSell(false, true)}
                    className="px-3 py-2.5 border border-indigo-300 text-indigo-800 hover:bg-indigo-100 rounded-xl text-xs font-semibold transition"
                  >
                    Keep as Singles
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Qty Cases (${quickSellItem.sellPriceCase.toFixed(2)}/cs)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={quickSellCases}
                      onChange={(e) => setQuickSellCases(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl font-mono text-center font-bold text-slate-950 text-base focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Qty Singles (${quickSellItem.sellPriceUnit.toFixed(2)}/ea)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={quickSellSingles}
                      onChange={(e) => setQuickSellSingles(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl font-mono text-center font-bold text-slate-950 text-base focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickSellItem(null);
                      setPromptMessage(null);
                    }}
                    className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickSell(false, false)}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-200 transition"
                  >
                    Process Sale
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unified Add / Edit Item Modal with packaging ratio variant / recalculation handling */}
      {showAddModal && (
        <ProductAddEditModal
          isOpen={showAddModal}
          initialItem={editingItem}
          currentUserId={currentUser?.id || "001"}
          currentUser={currentUser}
          onClose={() => {
            setShowAddModal(false);
            setEditingItem(null);
          }}
          onSaved={(savedItem) => {
            refreshList();
            setShowAddModal(false);
            setEditingItem(null);
            showToast("success", `Saved item "${savedItem.itemName}" (${savedItem.itemId})`);
          }}
        />
      )}
    </div>
  );
};
