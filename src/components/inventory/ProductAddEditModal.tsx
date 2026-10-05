import React, { useState, useEffect, useMemo } from 'react';
import {
  Package,
  X,
  Check,
  Search,
  FolderPlus,
  Boxes,
  AlertCircle,
  Sparkles,
  ChevronDown,
  Info,
  Plus,
  Trash2,
  Layers,
  Tag,
  Scale,
  Lock,
} from 'lucide-react';
import { InventoryItem, PackagingVariant, Salesperson } from '../../types';
import {
  getInventoryItems,
  getSessionUser,
  saveInventoryItem,
  createPackagingVariant,
  recalculateItemPackagingRatio,
  recordPriceCostChangeAudit,
} from '../../db/roomDatabase';
import { PackagingRatioModal } from './PackagingRatioModal';

export interface ProductAddEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
  initialItem?: InventoryItem | null;
  prefillName?: string;
  currentUserId?: string;
  currentUser?: Salesperson | null;
}

export const ProductAddEditModal: React.FC<ProductAddEditModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialItem = null,
  prefillName = '',
  currentUserId = '001',
  currentUser = null,
}) => {
  const isEditing = Boolean(initialItem);

  // Phone / Android Hardware Back Button: close modal on back press
  useEffect(() => {
    if (!isOpen) return;
    const handleHardwareBack = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    window.addEventListener('saimetric_hardware_back', handleHardwareBack);
    return () => {
      window.removeEventListener('saimetric_hardware_back', handleHardwareBack);
    };
  }, [isOpen, onClose]);

  const canManageInventory = useMemo(() => {
    const user = currentUser || getSessionUser();
    if (!user) return true;
    const role = (user.role || '').toUpperCase();
    if (
      role === 'SUPER_ADMIN' ||
      role === 'OWNER' ||
      role === 'ADMIN' ||
      role === 'MANAGER' ||
      role === 'BRANCH_MANAGER' ||
      role === 'SUPERVISOR' ||
      role === 'STOCK_CLERK' ||
      role === 'CLERK' ||
      user.email?.toLowerCase() === 'andrekudakwashe@gmail.com'
    ) {
      return user.permissions?.canManageInventory !== false;
    }
    if (role === 'CASHIER' && !user.permissions?.canManageInventory) {
      return false;
    }
    return user.permissions?.canManageInventory !== false;
  }, [currentUser]);

  // Form states (allow string so user can clear and type freely without sticky numbers)
  const [itemId, setItemId] = useState('');
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('Groceries');
  const [casePackageName, setCasePackageName] = useState('Case');
  const [unitsPerCase, setUnitsPerCase] = useState<string | number>(24);
  const [canSellAsCase, setCanSellAsCase] = useState(false);
  const [caseReserveThreshold, setCaseReserveThreshold] = useState<string | number>(0);
  const [costPerCase, setCostPerCase] = useState<string | number>('');
  const [sellPriceUnit, setSellPriceUnit] = useState<string | number>('');
  const [sellPriceCase, setSellPriceCase] = useState<string | number>('');
  const [stockCases, setStockCases] = useState<string | number>(0);
  const [stockSingles, setStockSingles] = useState<string | number>(0);
  const [reorderLevelCases, setReorderLevelCases] = useState<string | number>(2);
  const [barcode, setBarcode] = useState('');
  const [packagingVariants, setPackagingVariants] = useState<PackagingVariant[]>([]);
  const [sellByFraction, setSellByFraction] = useState(false);
  const [fractionUnit, setFractionUnit] = useState('kg');
  const [error, setError] = useState('');

  // Helper for case package name pluralization
  const getPackagePlural = (name: string) => {
    const n = (name || 'Case').trim();
    if (!n) return 'Cases';
    const lower = n.toLowerCase();
    if (lower.endsWith('box')) return `${n}es`;
    if (
      lower.endsWith('case') ||
      lower.endsWith('crate') ||
      lower.endsWith('bale') ||
      lower.endsWith('carton') ||
      lower.endsWith('tray') ||
      lower.endsWith('pack')
    ) {
      return `${n}s`;
    }
    if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('ch') || lower.endsWith('sh')) {
      return `${n}es`;
    }
    return `${n}s`;
  };

  // Variant inline addition state
  const [showAddVariantRow, setShowAddVariantRow] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarUnits, setNewVarUnits] = useState<string | number>(0.5);
  const [newVarPrice, setNewVarPrice] = useState<string | number>('');

  // Category dropdown & search
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearchTerm, setCategorySearchTerm] = useState('');

  // Packaging Ratio Modal trigger state
  const [showPackagingModal, setShowPackagingModal] = useState(false);
  const [pendingSaveItem, setPendingSaveItem] = useState<InventoryItem | null>(null);

  // Sync / populate form on open / initialItem change
  useEffect(() => {
    if (!isOpen) return;

    if (initialItem) {
      setItemId(initialItem.itemId);
      setItemName(initialItem.itemName);
      setCategory(initialItem.category || 'Groceries');
      setCasePackageName(initialItem.casePackageName || 'Case');
      setUnitsPerCase(initialItem.unitsPerCase ?? 24);
      setCanSellAsCase(Boolean(initialItem.canSellAsCase));
      setCaseReserveThreshold(initialItem.caseReserveThreshold !== undefined ? initialItem.caseReserveThreshold : 0);
      setCostPerCase(initialItem.costPerCase !== undefined ? initialItem.costPerCase : '');
      setSellPriceUnit(initialItem.sellPriceUnit !== undefined ? initialItem.sellPriceUnit : '');
      setSellPriceCase(initialItem.sellPriceCase !== undefined ? initialItem.sellPriceCase : '');
      setStockCases(initialItem.stockCases !== undefined ? initialItem.stockCases : 0);
      setStockSingles(initialItem.stockSingles !== undefined ? initialItem.stockSingles : 0);
      setReorderLevelCases(initialItem.reorderLevelCases !== undefined ? initialItem.reorderLevelCases : 2);
      setBarcode(initialItem.barcode || '');
      setPackagingVariants(initialItem.packagingVariants || []);
      setSellByFraction(Boolean(initialItem.sellByFraction));
      setFractionUnit(initialItem.fractionUnit || 'kg');
      setError('');
    } else {
      // Auto-generate a sequential item ID
      const allItems = getInventoryItems();
      const nextNum = allItems.length + 1;
      const genId = `PRD${String(nextNum).padStart(3, '0')}`;

      setItemId(genId);
      setItemName(prefillName || '');
      setCategory('Groceries');
      setCasePackageName('Case');
      setUnitsPerCase(24);
      setCanSellAsCase(false);
      setCostPerCase('');
      setSellPriceUnit('');
      setSellPriceCase('');
      setStockCases(0);
      setStockSingles(0);
      setReorderLevelCases(2);
      setBarcode('');
      setPackagingVariants([]);
      setSellByFraction(false);
      setFractionUnit('kg');
      setError('');
    }
  }, [isOpen, initialItem, prefillName]);

  // Derived available categories from inventory master
  const existingCategories = useMemo(() => {
    const defaultCats = [
      'Groceries',
      'Beverages',
      'Dairy & Eggs',
      'Bakery',
      'Meat & Poultry',
      'Snacks & Sweets',
      'Toiletries',
      'Household & Cleaning',
      'Packaging',
      'General Merchandise',
    ];
    try {
      const items = getInventoryItems();
      const fromItems = items.map((i) => i.category).filter(Boolean);
      return Array.from(new Set([...defaultCats, ...fromItems])).sort();
    } catch {
      return defaultCats;
    }
  }, [isOpen]);

  const filteredCategories = useMemo(() => {
    const term = (categorySearchTerm || '').trim().toLowerCase();
    if (!term) return existingCategories;
    return existingCategories.filter((c) =>
      (c || '').toLowerCase().includes(term)
    );
  }, [existingCategories, categorySearchTerm]);

  if (!isOpen) return null;

  // Safe numerical calculations allowing typing
  const safeUnitsPerCase = Math.max(1, Number(unitsPerCase) || 1);
  const safeCostPerCase = Math.max(0, Number(costPerCase) || 0);
  const calculatedCostPerUnit = safeUnitsPerCase > 0 ? safeCostPerCase / safeUnitsPerCase : 0;
  const safeSellPriceUnit = Math.max(0, Number(sellPriceUnit) || 0);
  const safeSellPriceCase = canSellAsCase
    ? Math.max(0, Number(sellPriceCase) || 0)
    : Number((safeSellPriceUnit * safeUnitsPerCase).toFixed(2));

  const singleMargin =
    safeSellPriceUnit > 0
      ? ((safeSellPriceUnit - calculatedCostPerUnit) / safeSellPriceUnit) * 100
      : 0;
  const caseMargin =
    safeSellPriceCase > 0 && safeCostPerCase > 0
      ? ((safeSellPriceCase - safeCostPerCase) / safeSellPriceCase) * 100
      : 0;

  // Variant Helpers
  const handleAddVariant = () => {
    if (!newVarName.trim()) {
      setError('Variant name is required (e.g. Half Loaf, Prepack 5s).');
      return;
    }
    const numUnits = Math.max(0.01, Number(newVarUnits) || 0.5);
    const numPrice = Math.max(0, Number(newVarPrice) || 0);
    const varId = `VAR-${Date.now().toString().slice(-4)}`;
    const newVar: PackagingVariant = {
      id: varId,
      name: newVarName.trim(),
      unitsPerPack: numUnits,
      sellPrice: numPrice,
      costPrice: Number((calculatedCostPerUnit * numUnits).toFixed(2)),
    };
    setPackagingVariants([...packagingVariants, newVar]);
    setNewVarName('');
    setNewVarUnits(0.5);
    setNewVarPrice('');
    setShowAddVariantRow(false);
    setError('');
  };

  const handleUpdateVariantPrice = (varId: string, newPrice: string | number) => {
    const num = Math.max(0, Number(newPrice) || 0);
    setPackagingVariants((prev) =>
      prev.map((v) => (v.id === varId ? { ...v, sellPrice: num } : v))
    );
  };

  const handleAddQuickPreset = (presetName: string, units: number, priceMultiplier = 0.95) => {
    const calculatedPrice = Number((safeSellPriceUnit * units * priceMultiplier).toFixed(2)) || units;
    const varId = `VAR-${Date.now().toString().slice(-4)}`;
    const newVar: PackagingVariant = {
      id: varId,
      name: presetName,
      unitsPerPack: units,
      sellPrice: calculatedPrice,
      costPrice: Number((calculatedCostPerUnit * units).toFixed(2)),
    };
    setPackagingVariants([...packagingVariants, newVar]);
  };

  const handleDeleteVariant = (varId: string) => {
    setPackagingVariants(packagingVariants.filter((v) => v.id !== varId));
  };

  // Form submit handler
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      setError('Product Name is required.');
      return;
    }
    if (!itemId.trim()) {
      setError('Item ID / SKU is required.');
      return;
    }
    if (safeUnitsPerCase <= 0) {
      setError('Units per case must be at least 1.');
      return;
    }

    const safeStockCases = Math.max(0, Number(stockCases) || 0);
    const safeStockSingles = Number(stockSingles) || 0;
    const currentTotalUnits = (safeStockCases * safeUnitsPerCase) + safeStockSingles;
    const safeReorder = Math.max(0, Number(reorderLevelCases) || 0);

    const candidateItem: InventoryItem = {
      ...(initialItem || {}),
      itemId: itemId.trim().toUpperCase(),
      itemName: itemName.trim(),
      category: category.trim() || 'General',
      casePackageName: casePackageName.trim() || 'Case',
      sellByFraction,
      fractionUnit: sellByFraction ? (fractionUnit.trim() || 'kg') : undefined,
      unitsPerCase: safeUnitsPerCase,
      canSellAsCase,
      caseReserveThreshold: Math.max(0, Number(caseReserveThreshold) || 0),
      costPerCase: safeCostPerCase,
      costPerUnit: calculatedCostPerUnit,
      sellPriceUnit: safeSellPriceUnit,
      sellPriceCase: safeSellPriceCase,
      stockCases: safeStockCases,
      stockSingles: safeStockSingles,
      totalUnits: currentTotalUnits,
      reorderLevelCases: safeReorder,
      reorderLevelUnits: safeReorder * safeUnitsPerCase,
      barcode: barcode.trim(),
      packagingVariants,
      lastUpdated: new Date().toISOString(),
    };

    // If editing and unitsPerCase has changed, show PackagingRatioModal!
    if (isEditing && initialItem && initialItem.unitsPerCase !== safeUnitsPerCase) {
      setPendingSaveItem(candidateItem);
      setShowPackagingModal(true);
      return;
    }

    if (!canManageInventory) {
      setError('Access Denied: Cashiers do not have permission to add or modify inventory products.');
      return;
    }

    // Direct save
    const saved = saveInventoryItem(candidateItem);

    // Audit price & cost changes
    if (isEditing && initialItem) {
      if (candidateItem.sellPriceUnit !== initialItem.sellPriceUnit) {
        recordPriceCostChangeAudit({
          itemId: candidateItem.itemId,
          itemName: candidateItem.itemName,
          fieldChanged: 'PRICE',
          oldValue: initialItem.sellPriceUnit || 0,
          newValue: candidateItem.sellPriceUnit || 0,
          reason: 'Selling price modified in Product Edit Modal',
          staffId: currentUser?.id || currentUserId,
          staffName: currentUser?.name || 'Administrator',
          userRole: currentUser?.role || 'ADMIN',
        });
      }
      if (candidateItem.costPerUnit !== initialItem.costPerUnit) {
        recordPriceCostChangeAudit({
          itemId: candidateItem.itemId,
          itemName: candidateItem.itemName,
          fieldChanged: 'COST',
          oldValue: initialItem.costPerUnit || 0,
          newValue: candidateItem.costPerUnit || 0,
          reason: 'Cost price modified in Product Edit Modal',
          staffId: currentUser?.id || currentUserId,
          staffName: currentUser?.name || 'Administrator',
          userRole: currentUser?.role || 'ADMIN',
        });
      }
    }

    onSaved(saved);
    onClose();
  };

  return (
    <>
      <div
        id="modal-product-add-edit"
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm overflow-hidden animate-in fade-in duration-150"
      >
        <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
          {/* Header - Fixed at Top */}
          <div className="shrink-0 p-5 bg-white border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-950">
                  {isEditing ? 'Edit Inventory Master Product' : 'Add New Product to Master'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {isEditing
                    ? `Editing ${initialItem?.itemName} (${initialItem?.itemId})`
                    : 'Configure singles, cases, and pack variants for inventory and GRN'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body - Scrollable */}
          <form id="product-modal-form" onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
            {!canManageInventory && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center gap-2.5">
                <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  <strong className="font-bold">Catalog View-Only Mode:</strong> Your cashier role does not have permission to add or modify inventory master items. Saving has been disabled.
                </span>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Top Row: Item ID and Product Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-900 mb-1">
                  Item ID / SKU <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  disabled={isEditing}
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  placeholder="e.g. NOD001, PAM002"
                  className="w-full py-2.5 px-3.5 bg-white border-2 border-slate-300 rounded-xl text-sm font-mono font-black text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 shadow-sm disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-900 mb-1">
                  Product Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={itemName}
                  onChange={(e) => {
                    setItemName(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="e.g. Indomie Instant Noodles 70g, Pampers Diapers"
                  className="w-full py-2.5 px-3.5 bg-white border-2 border-slate-300 rounded-xl text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 shadow-sm"
                />
              </div>
            </div>

            {/* Row 2: Category Dropdown & Units Per Case */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Category Dropdown */}
              <div className="relative">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-black text-slate-900 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Category</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const newCatName = window.prompt('Enter new category name:');
                      if (newCatName && newCatName.trim()) {
                        setCategory(newCatName.trim());
                      }
                    }}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ New Category</span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
                    className="w-full py-2.5 px-3.5 bg-white border-2 border-slate-300 rounded-xl text-sm font-bold text-slate-950 text-left flex items-center justify-between shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
                  >
                    <span className="truncate">{category || 'Select a Category'}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${
                        categoryDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {categoryDropdownOpen && (
                    <div className="absolute z-30 left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-2xl border-2 border-slate-200 p-2 space-y-2 animate-in fade-in">
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={categorySearchTerm}
                          onChange={(e) => setCategorySearchTerm(e.target.value)}
                          placeholder="Search or type new category..."
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {categorySearchTerm.trim() &&
                          !existingCategories.some(
                            (c) => c.toLowerCase() === categorySearchTerm.trim().toLowerCase()
                          ) && (
                            <button
                              type="button"
                              onClick={() => {
                                const newCat = categorySearchTerm.trim();
                                setCategory(newCat);
                                setCategoryDropdownOpen(false);
                                setCategorySearchTerm('');
                              }}
                              className="w-full text-left px-3 py-2 rounded-xl text-xs font-black bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1.5 transition border border-indigo-200 cursor-pointer shadow-sm"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>+ Create category: "{categorySearchTerm.trim()}"</span>
                            </button>
                          )}
                        {filteredCategories.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setCategory(c);
                              setCategoryDropdownOpen(false);
                              setCategorySearchTerm('');
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                              category === c
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span>{c}</span>
                            {category === c && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Master Outer Case Units & Packaging Type */}
              <div className="space-y-3">
                {/* Outer Package / Case Name Selection */}
                <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Outer Packaging / Case Name</span>
                    </label>
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                      Active: {casePackageName || 'Case'} ({getPackagePlural(casePackageName)})
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {['Case', 'Box', 'Crate', 'Bale', 'Carton', 'Tray', 'Pack'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCasePackageName(preset)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                          casePackageName.toLowerCase() === preset.toLowerCase()
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-[10px] font-bold text-slate-500">Custom:</span>
                      <input
                        type="text"
                        value={casePackageName}
                        onChange={(e) => setCasePackageName(e.target.value)}
                        placeholder="e.g. Crate, Box"
                        className="w-24 py-0.5 px-2 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-tight">
                    Custom naming: Eggs in <strong>Crates</strong>, Bread/Biscuits in <strong>Boxes</strong>, Flour/Sugar in <strong>Bales</strong>, Drinks in <strong>Trays</strong>.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-900 mb-1 flex items-center justify-between">
                    <span>Units per {casePackageName || 'Case'} (1 {casePackageName || 'Case'} = N singles)</span>
                    {isEditing && initialItem && initialItem.unitsPerCase !== unitsPerCase && (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        Ratio Changed ({initialItem.unitsPerCase} → {unitsPerCase})
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <Boxes className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="number"
                      min={1}
                      required
                      value={unitsPerCase}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setUnitsPerCase(e.target.value)}
                      placeholder="e.g. 40 (Noodles), 100 (Pampers), 24"
                      className="w-full py-2.5 pl-9 pr-3.5 bg-white border-2 border-slate-300 rounded-xl text-sm font-mono font-black text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 shadow-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* "Sell as Case" Wholesale Toggle */}
            <div className="p-4 rounded-2xl border-2 transition-all bg-slate-50 border-slate-200">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-950">
                      Sell Whole {casePackageName || 'Case'} (Wholesale & Full {casePackageName || 'Case'} Mode)
                    </span>
                    {canSellAsCase ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        Active (Full {casePackageName || 'Case'} + Singles)
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                        Singles / Prepacks Only
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {canSellAsCase
                      ? `Item can be sold as whole master ${casePackageName || 'case'}s (e.g. ${casePackageName || 'Box'} of ${safeUnitsPerCase}) in POS and GRN.`
                      : `Master ${casePackageName || 'case'} selling disabled. ${getPackagePlural(casePackageName)} received will auto-break into sellable prepacks & singles.`}
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={canSellAsCase}
                    onChange={(e) => setCanSellAsCase(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {canSellAsCase && (
                <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-slate-800">
                      Reserve Cases for Retail Singles (Case Limit)
                    </span>
                    <p className="text-[11px] text-slate-500">
                      When remaining cases reach this limit, wholesale case sales are restricted in POS to ensure retail walk-in customers can always buy singles.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min={0}
                      value={caseReserveThreshold}
                      onChange={(e) => setCaseReserveThreshold(e.target.value)}
                      placeholder="0"
                      className="w-20 py-1.5 px-2.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 text-center focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                    <span className="text-xs text-slate-500 font-medium">Cases</span>
                  </div>
                </div>
              )}
            </div>

            {/* Pricing Matrix */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Base Pricing & Cost
                </span>
                <span className="text-[11px] text-slate-500 font-medium">
                  1 Master {casePackageName || 'Case'} = {safeUnitsPerCase} Singles
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Cost per Case */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Cost / {casePackageName || 'Case'} ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={costPerCase}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setCostPerCase(e.target.value)}
                    placeholder="0.00"
                    className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                {/* Single Unit Cost (calculated) */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Single Cost ($)
                  </label>
                  <div className="w-full py-2 px-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-700">
                    ${calculatedCostPerUnit.toFixed(2)}
                  </div>
                </div>

                {/* Selling Price Singles */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Single Sell ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    value={sellPriceUnit}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setSellPriceUnit(e.target.value)}
                    placeholder="0.00"
                    className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                {/* Selling Price Case */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {casePackageName || 'Case'} Sell ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    disabled={!canSellAsCase}
                    value={canSellAsCase ? sellPriceCase : (safeSellPriceUnit * safeUnitsPerCase > 0 ? (safeSellPriceUnit * safeUnitsPerCase).toFixed(2) : '')}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setSellPriceCase(e.target.value)}
                    placeholder="0.00"
                    className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>

              {/* Live Margin Indicators */}
              <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between">
                  <span className="text-slate-600 font-medium">Single Margin:</span>
                  <span
                    className={`font-mono font-black ${
                      singleMargin >= 15
                        ? 'text-emerald-700'
                        : singleMargin > 0
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {singleMargin.toFixed(1)}%
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between">
                  <span className="text-slate-600 font-medium">{casePackageName || 'Case'} Margin:</span>
                  <span
                    className={`font-mono font-black ${
                      canSellAsCase
                        ? caseMargin >= 10
                          ? 'text-indigo-700'
                          : caseMargin > 0
                          ? 'text-amber-700'
                          : 'text-rose-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {canSellAsCase ? `${caseMargin.toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* ========================================================================= */}
            {/* MULTI-VARIANT / PREPACKS SECTION (Noodles 5s, Diapers 20s/10s/5s/2s) */}
            {/* ========================================================================= */}
            <div className="p-4 bg-indigo-50/50 rounded-2xl border-2 border-indigo-100 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-black text-indigo-950 uppercase tracking-wider">
                    Pack Variants & Pre-Packs
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full">
                    {packagingVariants.length} Configured
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddVariantRow(!showAddVariantRow)}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Pack Variant</span>
                </button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Define sub-packs or prepacks to sell and receive (e.g. Noodles Prepack 5s, or Diapers 20s, 10s, 5s, 2s). These will be available in the POS and GRN receiving voucher.
              </p>

              {/* Quick Presets Buttons */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[11px] font-bold text-slate-500 self-center mr-1">Quick Presets:</span>
                <button
                  type="button"
                  onClick={() => handleAddQuickPreset('Half (0.5)', 0.5, 0.5)}
                  className="text-[11px] font-bold px-2.5 py-1 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg hover:bg-amber-100 transition shadow-xs flex items-center gap-1"
                  title="Half Loaf Bread or Half Bar Soap (0.5 Units)"
                >
                  <Sparkles className="w-3 h-3 text-amber-600" />
                  <span>+ Half (0.5) Loaf / Bar</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddQuickPreset('Prepack (5s)', 5)}
                  className="text-[11px] font-bold px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition"
                >
                  + Prepack (5s)
                </button>
                <button
                  type="button"
                  onClick={() => handleAddQuickPreset('Prepack (20s)', 20)}
                  className="text-[11px] font-bold px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition"
                >
                  + Prepack (20s)
                </button>
                <button
                  type="button"
                  onClick={() => handleAddQuickPreset('Pack of 10s', 10)}
                  className="text-[11px] font-bold px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition"
                >
                  + Pack of 10s
                </button>
                <button
                  type="button"
                  onClick={() => handleAddQuickPreset('Pack of 2s', 2)}
                  className="text-[11px] font-bold px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition"
                >
                  + Pack of 2s
                </button>
              </div>

              {/* Inline Add Variant Form */}
              {showAddVariantRow && (
                <div className="p-3 bg-white rounded-xl border-2 border-indigo-300 space-y-3 shadow-md animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-slate-900">Configure New Pack Variant</span>
                    <button
                      type="button"
                      onClick={() => setShowAddVariantRow(false)}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Variant Name <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={newVarName}
                        onChange={(e) => setNewVarName(e.target.value)}
                        placeholder="e.g. Half Loaf, Prepack (5s)"
                        className="w-full py-1.5 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Units in Pack <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        min={0.01}
                        value={newVarUnits}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewVarUnits(e.target.value)}
                        placeholder="e.g. 0.5, 2, 5"
                        className="w-full py-1.5 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Selling Price ($) <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={newVarPrice}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewVarPrice(e.target.value)}
                        placeholder="e.g. 0.50, 1.00"
                        className="w-full py-1.5 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddVariantRow(false)}
                      className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAddVariant}
                      className="px-4 py-1.5 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
                    >
                      Add to Variants
                    </button>
                  </div>
                </div>
              )}

              {/* Active Variants List */}
              {packagingVariants.length > 0 ? (
                <div className="space-y-2 pt-1">
                  {packagingVariants.map((v) => {
                    const varUnitCost = calculatedCostPerUnit * v.unitsPerPack;
                    const varSell = Number(v.sellPrice) || 0;
                    const varMargin =
                      varSell > 0 ? ((varSell - varUnitCost) / varSell) * 100 : 0;
                    return (
                      <div
                        key={v.id}
                        className="p-3 bg-white rounded-xl border border-indigo-100 flex flex-wrap items-center justify-between gap-3 shadow-sm hover:border-indigo-300 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-black text-xs shrink-0">
                            {v.unitsPerPack}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-900">{v.name}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                                {v.unitsPerPack === 0.5 ? '0.5 units (Half)' : `${v.unitsPerPack} unit${v.unitsPerPack === 1 ? '' : 's'}`}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>Cost: ${varUnitCost.toFixed(2)}</span>
                              <span>•</span>
                              <span className="font-bold text-indigo-700">Margin: {varMargin.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>

                        {/* Interactive Prepack Selling Price Editor */}
                        <div className="flex items-center gap-2.5 ml-auto">
                          <div className="flex items-center gap-1.5 bg-emerald-50 border-2 border-emerald-300 rounded-xl px-2.5 py-1 shadow-sm">
                            <span className="text-[11px] font-black text-emerald-800">Sell $</span>
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              value={v.sellPrice !== undefined ? v.sellPrice : ''}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => handleUpdateVariantPrice(v.id, e.target.value)}
                              className="w-20 bg-transparent text-xs font-mono font-black text-emerald-950 outline-none"
                              placeholder="0.00"
                              title="Edit selling price for this prepack"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteVariant(v.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Remove variant"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-white/70 border border-dashed border-indigo-200 text-center text-xs text-slate-500">
                  No additional packaging variants configured. Item will be sold as standard singles (and whole cases if enabled).
                </div>
              )}
            </div>

            {/* ========================================================================= */}
            {/* FRACTIONAL / WEIGHT FACTOR SALES SECTION (Gas, Meat, Bulk) */}
            {/* ========================================================================= */}
            <div className="p-4 bg-emerald-50/60 rounded-2xl border-2 border-emerald-100 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                    Fractional / Weight Factor Sales
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    sellByFraction ? 'bg-emerald-200 text-emerald-900' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {sellByFraction ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sellByFraction}
                    onChange={(e) => setSellByFraction(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                For products sold by weight, volume, or fraction (e.g. Meat sold as 300g or $4, LP Gas refill sold by kg or dollar amount). In the POS, operators can type either the weight factor or the total dollar price and both will compute simultaneously.
              </p>

              {sellByFraction && (
                <div className="space-y-3 pt-2 border-t border-emerald-200/60">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        Fraction Unit of Measure <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={fractionUnit}
                        onChange={(e) => setFractionUnit(e.target.value)}
                        placeholder="e.g. kg, g, Litre, m"
                        className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        Base Rate Preview
                      </label>
                      <div className="py-2 px-3 bg-white border border-emerald-200 rounded-xl text-sm font-mono font-bold text-emerald-800 flex items-center justify-between">
                        <span>Price per {fractionUnit || 'kg'}:</span>
                        <span className="text-base">${safeSellPriceUnit.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Unit Presets */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] font-bold text-slate-500 mr-1">Quick Units:</span>
                    {['kg', 'g', 'Litre', 'm', 'lb'].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setFractionUnit(u)}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition ${
                          fractionUnit === u
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Reorder and Barcode Section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Reorder Level ({getPackagePlural(casePackageName)})
                </label>
                <input
                  type="number"
                  min={0}
                  value={reorderLevelCases}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setReorderLevelCases(e.target.value)}
                  placeholder="2"
                  className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Barcode / UPC (Optional)
                </label>
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="e.g. 600123456789"
                  className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
            </div>
          </form>

          {/* Footer - Fixed at Bottom */}
          <div className="shrink-0 p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-200 transition"
            >
              Cancel
            </button>
            {canManageInventory ? (
              <button
                type="submit"
                form="product-modal-form"
                className="px-6 py-2.5 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 flex items-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>{isEditing ? 'Save Product Changes' : 'Create Product in Master'}</span>
              </button>
            ) : (
              <div className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 bg-slate-100 border border-slate-200 flex items-center gap-1.5 select-none">
                <Lock className="w-3.5 h-3.5" />
                <span>Editing Disabled (Cashier)</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Packaging Ratio / Variant Handler (Option A vs Option B) */}
      {showPackagingModal && pendingSaveItem && initialItem && (
        <PackagingRatioModal
          isOpen={showPackagingModal}
          item={initialItem}
          currentUnitsPerCase={initialItem.unitsPerCase}
          newUnitsPerCase={pendingSaveItem.unitsPerCase}
          onClose={() => setShowPackagingModal(false)}
          onCreateVariant={(variantName, newRatio) => {
            setShowPackagingModal(false);
            const variantItem = createPackagingVariant(
              initialItem.itemId,
              newRatio,
              pendingSaveItem.costPerCase,
              pendingSaveItem.sellPriceUnit
            );
            if (variantItem) {
              onSaved(variantItem);
              onClose();
            }
          }}
          onRecalculateStock={(newRatio) => {
            setShowPackagingModal(false);
            // 1. Recalculate stock in database
            const recalcResult = recalculateItemPackagingRatio(initialItem.itemId, newRatio, pendingSaveItem.costPerCase, currentUserId);
            // 2. Save other updated product attributes with the recalculated stock counts
            const updated = saveInventoryItem({
              ...pendingSaveItem,
              unitsPerCase: newRatio,
              stockCases: recalcResult ? recalcResult.newCases : Math.floor(pendingSaveItem.totalUnits / newRatio),
              stockSingles: recalcResult ? recalcResult.newSingles : (pendingSaveItem.totalUnits % newRatio),
              totalUnits: recalcResult ? recalcResult.totalUnits : pendingSaveItem.totalUnits,
            });
            onSaved(updated);
            onClose();
          }}
        />
      )}
    </>
  );
};
