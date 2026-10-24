import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  Clock,
  DollarSign,
  Package,
  Layers,
  Search,
  Filter,
  CheckCircle2,
  Calendar,
  Printer,
  Download,
  Truck,
  ArrowRight,
  Sparkles,
  Info,
  ChevronDown,
  RefreshCw,
  ShoppingBag,
  Sliders,
  ExternalLink,
  ShieldAlert,
  ArrowUpRight,
  TrendingDown,
  Tag,
  Building2,
  X,
  FileSpreadsheet,
  Plus,
  Minus,
  List,
  LayoutGrid,
  Trash2,
  Share2,
  Copy,
  Check,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  UserCheck,
  Edit3,
  Database,
} from 'lucide-react';
import {
  InventoryItem,
  Supplier,
  StockMovementEntry,
  StockBatch,
  Salesperson,
  Branch,
  GoodsReceivedEntry,
  SupplierInvoiceVoucher,
} from '../../types';
import { Company } from '../../data/saasData';
import {
  getInventoryItems,
  getSuppliers,
  addSupplier,
  saveInventoryItem,
  getStockMovements,
  getStockBatches,
  getCurrentCompany,
  getCurrentBranch,
  subscribeRoomDatabase,
  getStored,
  STORAGE_KEYS,
  getFastMovingChecklist,
} from '../../db/roomDatabase';
import { SupplierRegistrationModal } from '../suppliers/SupplierRegistrationModal';
import { INITIAL_GOODS_RECEIVED, INITIAL_SUPPLIER_INVOICES, INITIAL_INVENTORY_ITEMS } from '../../data/initialData';

export const STORAGE_KEY_PO_DRAFT = 'saimetric_draft_purchase_order';

export interface ProcurementReorderHubProps {
  currentUser?: Salesperson | null;
  onNavigateToDirectGrv?: (prefillItems?: any[], supplierId?: string) => void;
  onGoToMaster?: () => void;
}

export type ReorderHorizon = 3 | 7 | 14 | 30 | 'custom' | number;
export type PriorityTier = 'CRITICAL' | 'URGENT' | 'PLAN' | 'HEALTHY';
export type CalculationWindow = 7 | 14 | 30 | 60 | 90 | 'weighted';

/** Robust helper to always return the human-readable product name, never falling back to just code */
export const getItemName = (item: any): string => {
  if (!item) return '';
  const rawId = (item.itemId || item.id || item.sku || '').trim();

  // 1. If item.itemName is defined and is NOT equal to the raw ID/SKU code
  if (item.itemName && item.itemName.trim() && item.itemName.trim().toUpperCase() !== rawId.toUpperCase()) {
    return item.itemName.trim();
  }
  // 2. If item.name is defined and is NOT equal to the raw ID/SKU code
  if (item.name && item.name.trim() && item.name.trim().toUpperCase() !== rawId.toUpperCase()) {
    return item.name.trim();
  }
  // 3. If item.productName is defined
  if (item.productName && item.productName.trim() && item.productName.trim().toUpperCase() !== rawId.toUpperCase()) {
    return item.productName.trim();
  }
  // 4. Try catalog lookup in INITIAL_INVENTORY_ITEMS by itemId or sku
  if (rawId) {
    const matched = INITIAL_INVENTORY_ITEMS.find(
      (init) =>
        (init.itemId && init.itemId.toUpperCase() === rawId.toUpperCase()) ||
        (init.sku && init.sku.toUpperCase() === rawId.toUpperCase())
    );
    if (matched && matched.itemName) {
      return matched.itemName;
    }
  }
  // 5. If item has description and it's not the rawId
  if (item.description && item.description.trim() && item.description.trim().toUpperCase() !== rawId.toUpperCase()) {
    return item.description.trim();
  }
  return item.itemName || item.name || item.productName || item.description || item.itemId || 'Unnamed Product';
};

/** Helper to return the item's SKU / Code */
export const getItemCode = (item: any): string => {
  if (!item) return '';
  return item.sku || item.code || item.itemId || '';
};

export interface ItemSupplierLink {
  id: string;
  name: string;
  isPrimary: boolean;
  leadTimeDays: number;
  paymentTerms?: string;
  caseCost?: number;
}

export interface ReorderItemAnalysis {
  item: InventoryItem;
  currentStockUnits: number;
  currentStockCases: number;
  currentStockSingles: number;
  unitsPerCase: number;

  // Supplier & Multi-vendor linkage
  supplierId?: string;
  supplierName: string;
  allSuppliers?: ItemSupplierLink[];

  // Sales Rates
  sales7d: number;
  sales14d: number;
  sales30d: number;
  sales90d: number;
  avgDailySales: number;
  velocityTrend: 'RISING' | 'STEADY' | 'DECLINING';
  isNewProductOverride: boolean;
  isAnalogRateUsed: boolean;
  daysSinceFirstSale: number;

  // Stockout projection & ROP
  projectedStockoutDays: number;
  leadTimeDays: number;
  safetyStockUnits: number;
  reorderPointUnits: number;

  // Urgency & Priority Tier
  priorityTier: PriorityTier;
  urgencyReason: string;
  isLeadTimeBreached: boolean;

  // Financial & Shelf Life
  grossMarginPercent: number;
  unitCost: number;
  caseCost: number;
  unitSellingPrice: number;
  shelfLifeDays?: number;
  trackExpiry: boolean;

  // Suggested Order
  suggestedOrderUnits: number;
  suggestedOrderCases: number;
  suggestedCost: number;

  // Selected Order in Hub
  selected: boolean;
  customOrderCases: number;
  customOrderUnits: number;
  customTotalCost: number;

  // Budget status
  isFundedInBudget: boolean;

  // Dual-Criteria Velocity Classification
  isFastMover: boolean;
  isSlowMover: boolean;
}

export interface PoLineItem {
  itemId: string;
  name: string;
  code: string;
  barcode: string;
  category: string;
  orderCases: number;
  unitsPerCase: number;
  totalUnits: number;
  unitCost: number;
  caseCost: number;
  lineTotal: number;
  sellingPrice: number;
  originalCaseCost?: number;
  originalUnitCost?: number;
  isCostModified?: boolean;
}

export const ProcurementReorderHub: React.FC<ProcurementReorderHubProps> = ({
  currentUser,
  onNavigateToDirectGrv,
  onGoToMaster,
}) => {
  // Database data
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(() => getInventoryItems());
  const [stockMovements, setStockMovements] = useState<StockMovementEntry[]>(() => getStockMovements());
  const [stockBatches, setStockBatches] = useState<StockBatch[]>(() => getStockBatches());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getSuppliers());
  const [company, setCompany] = useState<Company>(() => getCurrentCompany());
  const [branch, setBranch] = useState<Branch>(() => getCurrentBranch());

  // Configuration Controls
  const [selectedHorizon, setSelectedHorizon] = useState<ReorderHorizon>(7); // Default 7-day reorder cycle
  const [customHorizonInput, setCustomHorizonInput] = useState<string>('');
  const [calcWindow, setCalcWindow] = useState<CalculationWindow>(30); // Default 30 days for agile stores
  const [cashBudget, setCashBudget] = useState<string>('500'); // Default $500 cash budget
  const [safetyBufferPercent, setSafetyBufferPercent] = useState<number>(20); // 20% safety stock
  const [defaultLeadTimeDays, setDefaultLeadTimeDays] = useState<number>(3); // 3 days default delivery lead time

  // Filtering & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedSupplierId, setSelectedSupplierId] = useState('ALL');
  const [tierFilter, setTierFilter] = useState<'ALL' | 'CRITICAL' | 'URGENT' | 'PLAN' | 'ALL_NEEDS'>('ALL_NEEDS');
  const [fastMoversOnly, setFastMoversOnly] = useState<boolean>(false);
  const [fastMovingList, setFastMovingList] = useState(() => getFastMovingChecklist());
  const [budgetFilter, setBudgetFilter] = useState<'ALL' | 'FUNDED' | 'UNFUNDED'>('ALL');
  const [sortBy, setSortBy] = useState<'URGENCY' | 'STOCKOUT_DAYS' | 'MARGIN' | 'COST' | 'VELOCITY'>('URGENCY');
  const [mobileViewMode, setMobileViewMode] = useState<'CARDS' | 'TABLE'>('CARDS');

  // User selections overrides: itemId -> custom cases count & custom quoted supplier cost
  const [orderCasesOverrides, setOrderCasesOverrides] = useState<Record<string, number>>({});
  const [orderCostOverrides, setOrderCostOverrides] = useState<Record<string, number>>({});
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Commercial Purchase Order Slip Modal State
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [generatedPoNumber, setGeneratedPoNumber] = useState('');
  const [poTargetSupplierId, setPoTargetSupplierId] = useState<string>('');
  const [poPaymentTerms, setPoPaymentTerms] = useState<string>('30-Day Account Credit');
  const [poDeliveryDate, setPoDeliveryDate] = useState<string>('');
  const [poDeliveryBay, setPoDeliveryBay] = useState<string>('');
  const [poTaxRatePercent, setPoTaxRatePercent] = useState<number>(15); // Standard 15% VAT
  const [poFreightFee, setPoFreightFee] = useState<string>('0');
  const [poPurchasingOfficer, setPoPurchasingOfficer] = useState<string>(() => currentUser?.name || 'Purchasing Director');
  const [poCustomLines, setPoCustomLines] = useState<PoLineItem[]>([]);
  const [adHocSearchQuery, setAdHocSearchQuery] = useState('');
  const [isAdHocDropdownOpen, setIsAdHocDropdownOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Purchase Order Auto-Save Draft State (for clerk exit / power outage recovery)
  const [lastPoDraftSavedAt, setLastPoDraftSavedAt] = useState<string | null>(null);
  const [hasRestoredPoDraft, setHasRestoredPoDraft] = useState<boolean>(false);

  // Supplier Search & Add Modal in Purchase Order
  const [poSupplierSearchQuery, setPoSupplierSearchQuery] = useState('');
  const [isPoSupplierDropdownOpen, setIsPoSupplierDropdownOpen] = useState(false);
  const [isSupplierRegModalOpen, setIsSupplierRegModalOpen] = useState(false);

  // Product-Supplier Switcher & Multi-vendor management
  const [itemSupplierOverrides, setItemSupplierOverrides] = useState<Record<string, string>>({});
  const [supplierSwitchTarget, setSupplierSwitchTarget] = useState<ReorderItemAnalysis | null>(null);
  const [toastNotification, setToastNotification] = useState<string | null>(null);

  // Auto-clear toast notifications
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => setToastNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

  // 1. Recover Purchase Order Draft on initial load
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(STORAGE_KEY_PO_DRAFT);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft);
        if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          if (parsed.poNumber) setGeneratedPoNumber(parsed.poNumber);
          if (parsed.targetSupplierId) setPoTargetSupplierId(parsed.targetSupplierId);
          if (parsed.paymentTerms) setPoPaymentTerms(parsed.paymentTerms);
          if (parsed.deliveryDate) setPoDeliveryDate(parsed.deliveryDate);
          if (parsed.deliveryBay) setPoDeliveryBay(parsed.deliveryBay);
          if (parsed.taxRatePercent !== undefined) setPoTaxRatePercent(parsed.taxRatePercent);
          if (parsed.freightFee !== undefined) setPoFreightFee(parsed.freightFee);
          setPoCustomLines(parsed.lines);
          setLastPoDraftSavedAt(parsed.savedAt || 'Saved');
          setHasRestoredPoDraft(true);
        }
      }
    } catch (e) {
      console.error('[ProcurementReorderHub] Failed to restore PO draft:', e);
    }
  }, []);

  // 2. Auto-save Purchase Order Draft whenever lines or fields change
  useEffect(() => {
    if (poCustomLines.length > 0) {
      try {
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const draftData = {
          poNumber: generatedPoNumber,
          targetSupplierId: poTargetSupplierId,
          paymentTerms: poPaymentTerms,
          deliveryDate: poDeliveryDate,
          deliveryBay: poDeliveryBay,
          taxRatePercent: poTaxRatePercent,
          freightFee: poFreightFee,
          lines: poCustomLines,
          savedAt: timeNow,
        };
        localStorage.setItem(STORAGE_KEY_PO_DRAFT, JSON.stringify(draftData));
        setLastPoDraftSavedAt(timeNow);
      } catch (e) {
        console.error('[ProcurementReorderHub] Failed to auto-save PO draft:', e);
      }
    }
  }, [
    poCustomLines,
    generatedPoNumber,
    poTargetSupplierId,
    poPaymentTerms,
    poDeliveryDate,
    poDeliveryBay,
    poTaxRatePercent,
    poFreightFee,
  ]);

  const handleDiscardPoDraft = () => {
    try {
      localStorage.removeItem(STORAGE_KEY_PO_DRAFT);
    } catch (e) {
      // ignore
    }
    setPoCustomLines([]);
    setHasRestoredPoDraft(false);
    setLastPoDraftSavedAt(null);
    setIsPoModalOpen(false);
    setToastNotification('Purchase order draft discarded.');
  };

  // Subscribe to DB changes
  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      setInventoryItems(getInventoryItems());
      setStockMovements(getStockMovements());
      setStockBatches(getStockBatches());
      setSuppliers(getSuppliers());
      setCompany(getCurrentCompany());
      setBranch(getCurrentBranch());
      setFastMovingList(getFastMovingChecklist());
    });
    return unsub;
  }, []);

  const fastMovingItemIds = useMemo(() => {
    const set = new Set<string>();
    fastMovingList.forEach((f) => {
      if (f.itemId) set.add(f.itemId.trim().toUpperCase());
    });
    return set;
  }, [fastMovingList]);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const todayTime = useMemo(() => new Date(todayStr).getTime(), [todayStr]);

  // Suppliers map for quick lookup
  const suppliersMap = useMemo(() => {
    const map = new Map<string, Supplier>();
    suppliers.forEach((s) => {
      const sId = s.supplierId || s.id;
      if (sId) map.set(sId, s);
      if (s.name) map.set(s.name.trim().toLowerCase(), s);
    });
    return map;
  }, [suppliers]);

  // Map each product to its Primary Supplier and all approved Multi-Vendor links
  const productSuppliersMap = useMemo(() => {
    const map = new Map<
      string,
      {
        primary: { id?: string; name: string; leadTimeDays: number; paymentTerms?: string };
        allSuppliers: ItemSupplierLink[];
      }
    >();

    // Discover historical suppliers from GRVs / Goods Received
    const historicalSuppliersByItem = new Map<string, Set<string>>();
    try {
      const grns = getStored<GoodsReceivedEntry[]>(STORAGE_KEYS.GOODS_RECEIVED, INITIAL_GOODS_RECEIVED);
      grns.forEach((g) => {
        if (g.itemId && g.supplier) {
          if (!historicalSuppliersByItem.has(g.itemId)) {
            historicalSuppliersByItem.set(g.itemId, new Set());
          }
          historicalSuppliersByItem.get(g.itemId)!.add(g.supplier.trim().toLowerCase());
        }
      });
      const invoices = getStored<SupplierInvoiceVoucher[]>(STORAGE_KEYS.SUPPLIER_INVOICES, INITIAL_SUPPLIER_INVOICES);
      invoices.forEach((inv) => {
        if (inv.supplier && Array.isArray(inv.items)) {
          inv.items.forEach((it) => {
            if (it.itemId) {
              if (!historicalSuppliersByItem.has(it.itemId)) {
                historicalSuppliersByItem.set(it.itemId, new Set());
              }
              historicalSuppliersByItem.get(it.itemId)!.add(inv.supplier.trim().toLowerCase());
            }
          });
        }
      });
    } catch (e) {
      // fallback
    }

    // Category default vendor resolution for items without an explicit vendor
    const resolveCategoryVendor = (category?: string): Supplier | undefined => {
      const cat = (category || '').toLowerCase();
      if (cat.includes('beverage') || cat.includes('drink') || cat.includes('juice') || cat.includes('water')) {
        return suppliers.find((s) => s.name.toLowerCase().includes('delta'));
      }
      if (cat.includes('bakery') || cat.includes('bread') || cat.includes('flour') || cat.includes('confectionery')) {
        return suppliers.find((s) => s.name.toLowerCase().includes('bakers inn'));
      }
      if (cat.includes('dairy') || cat.includes('milk') || cat.includes('cheese') || cat.includes('yoghurt')) {
        return suppliers.find((s) => s.name.toLowerCase().includes('dairibord'));
      }
      if (cat.includes('oil') || cat.includes('fat') || cat.includes('margarine')) {
        return (
          suppliers.find((s) => s.name.toLowerCase().includes('olivine')) ||
          suppliers.find((s) => s.name.toLowerCase().includes('mega market'))
        );
      }
      // General groceries & FMCG staples
      return (
        suppliers.find((s) => s.name.toLowerCase().includes('national foods')) ||
        suppliers.find((s) => s.name.toLowerCase().includes('mega market')) ||
        suppliers[0]
      );
    };

    inventoryItems.forEach((it) => {
      // 1. User runtime override
      const overrideSupId = itemSupplierOverrides[it.itemId];
      let primarySupplier: Supplier | undefined;

      if (overrideSupId) {
        primarySupplier = suppliersMap.get(overrideSupId);
      }

      // 2. Direct catalog assignment
      if (!primarySupplier) {
        const directId = (it as any).preferredSupplierId || it.supplierId || (it as any).supplier_id;
        const directName = it.supplierName || (it as any).supplier_name || (it as any).supplier;
        if (directId) {
          primarySupplier = suppliersMap.get(directId);
        } else if (directName) {
          primarySupplier = suppliersMap.get(directName.trim().toLowerCase());
        }
      }

      // 3. Category default if unassigned
      if (!primarySupplier) {
        primarySupplier = resolveCategoryVendor(it.category);
      }

      const primaryId = primarySupplier?.supplierId || primarySupplier?.id;
      const primaryName = primarySupplier?.name || 'Unassigned Vendor';
      const primaryLeadTime = primarySupplier?.leadTimeDays || defaultLeadTimeDays;
      const primaryTerms = primarySupplier?.paymentTerms || '30-Day Account Credit';

      // Assemble all approved suppliers for this item
      const allList: ItemSupplierLink[] = [];
      const addedIds = new Set<string>();

      if (primarySupplier && primaryId) {
        allList.push({
          id: primaryId,
          name: primaryName,
          isPrimary: true,
          leadTimeDays: primaryLeadTime,
          paymentTerms: primaryTerms,
        });
        addedIds.add(primaryId);
      }

      // Add historical suppliers from delivery receipts
      const hist = historicalSuppliersByItem.get(it.itemId);
      if (hist) {
        hist.forEach((hName) => {
          const matched = suppliersMap.get(hName);
          if (matched) {
            const mId = matched.supplierId || matched.id;
            if (mId && !addedIds.has(mId)) {
              allList.push({
                id: mId,
                name: matched.name,
                isPrimary: false,
                leadTimeDays: matched.leadTimeDays || defaultLeadTimeDays,
                paymentTerms: matched.paymentTerms || '30-Day Account Credit',
              });
              addedIds.add(mId);
            }
          }
        });
      }

      // Add prominent FMCG wholesale distributor (Mega Market Wholesale) as an alternative supplier if not primary
      const megaMarket = suppliers.find((s) => s.name.toLowerCase().includes('mega market'));
      if (megaMarket) {
        const mmId = megaMarket.supplierId || megaMarket.id;
        if (mmId && !addedIds.has(mmId)) {
          allList.push({
            id: mmId,
            name: megaMarket.name,
            isPrimary: false,
            leadTimeDays: megaMarket.leadTimeDays || 1, // Rapid 1-day delivery for urgent stockouts
            paymentTerms: megaMarket.paymentTerms || 'Cash on Delivery (COD)',
          });
          addedIds.add(mmId);
        }
      }

      // Add National Foods as an alternative supplier if not primary
      const natFoods = suppliers.find((s) => s.name.toLowerCase().includes('national foods'));
      if (natFoods) {
        const nfId = natFoods.supplierId || natFoods.id;
        if (nfId && !addedIds.has(nfId)) {
          allList.push({
            id: nfId,
            name: natFoods.name,
            isPrimary: false,
            leadTimeDays: natFoods.leadTimeDays || 3,
            paymentTerms: natFoods.paymentTerms || '30-Day Account Credit',
          });
          addedIds.add(nfId);
        }
      }

      map.set(it.itemId, {
        primary: {
          id: primaryId,
          name: primaryName,
          leadTimeDays: primaryLeadTime,
          paymentTerms: primaryTerms,
        },
        allSuppliers: allList,
      });
    });

    return map;
  }, [inventoryItems, suppliers, suppliersMap, itemSupplierOverrides, defaultLeadTimeDays]);

  // Distinct Categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    inventoryItems.forEach((it) => {
      if (it.category) set.add(it.category);
    });
    return Array.from(set).sort();
  }, [inventoryItems]);

  // Aggregate Sales Velocity per product over 7, 14, 30, and 90 day windows
  const productSalesMap = useMemo(() => {
    const map = new Map<
      string,
      {
        sales7d: number;
        sales14d: number;
        sales30d: number;
        sales90d: number;
        firstSaleDate: string;
        lastSaleDate: string;
      }
    >();

    const time7dAgo = todayTime - 7 * 24 * 60 * 60 * 1000;
    const time14dAgo = todayTime - 14 * 24 * 60 * 60 * 1000;
    const time30dAgo = todayTime - 30 * 24 * 60 * 60 * 1000;
    const time90dAgo = todayTime - 90 * 24 * 60 * 60 * 1000;

    const itemUnitsMap = new Map<string, number>();
    inventoryItems.forEach((it) => itemUnitsMap.set(it.itemId, it.unitsPerCase || 1));

    stockMovements.forEach((m) => {
      const isSale =
        m.txnType === 'SALE' ||
        m.movementType === 'SALE' ||
        (m.actionTaken && m.actionTaken.includes('SOLD')) ||
        (m.promptShown && m.promptShown.toLowerCase().includes('sale'));

      if (!isSale) return;

      const unitsPerCase = itemUnitsMap.get(m.itemId) || 1;
      const unitsOut =
        m.singlesChange && m.singlesChange < 0
          ? Math.abs(m.singlesChange) + Math.abs(m.casesChange || 0) * unitsPerCase
          : (m.qtyCases || 0) * unitsPerCase + (m.qtySingles || 0);

      if (unitsOut <= 0) return;

      const movementDate = m.date || m.timestamp?.split('T')[0] || '';
      const moveTime = movementDate ? new Date(movementDate).getTime() : 0;

      const curr = map.get(m.itemId) || {
        sales7d: 0,
        sales14d: 0,
        sales30d: 0,
        sales90d: 0,
        firstSaleDate: '',
        lastSaleDate: '',
      };

      if (moveTime >= time7dAgo) curr.sales7d += unitsOut;
      if (moveTime >= time14dAgo) curr.sales14d += unitsOut;
      if (moveTime >= time30dAgo) curr.sales30d += unitsOut;
      if (moveTime >= time90dAgo) curr.sales90d += unitsOut;

      if (movementDate) {
        if (!curr.firstSaleDate || movementDate < curr.firstSaleDate) curr.firstSaleDate = movementDate;
        if (!curr.lastSaleDate || movementDate > curr.lastSaleDate) curr.lastSaleDate = movementDate;
      }

      map.set(m.itemId, curr);
    });

    return map;
  }, [stockMovements, inventoryItems, todayTime]);

  // Category average sales rates for analog forecasting benchmark
  const categoryAnalogRates = useMemo(() => {
    const catMap = new Map<string, { totalUnits30d: number; itemCount: number }>();

    inventoryItems.forEach((it) => {
      const cat = it.category || 'General';
      const stats = productSalesMap.get(it.itemId);
      const units = stats ? stats.sales30d : 0;

      const prev = catMap.get(cat) || { totalUnits30d: 0, itemCount: 0 };
      catMap.set(cat, {
        totalUnits30d: prev.totalUnits30d + units,
        itemCount: prev.itemCount + 1,
      });
    });

    const rateMap = new Map<string, number>();
    catMap.forEach((val, cat) => {
      const avgRate = val.itemCount > 0 ? val.totalUnits30d / (val.itemCount * 30) : 0;
      rateMap.set(cat, avgRate);
    });

    return rateMap;
  }, [inventoryItems, productSalesMap]);

  // Active Horizon in Days
  const effectiveHorizon = useMemo(() => {
    if (selectedHorizon === 'custom') {
      const parsed = parseInt(customHorizonInput, 10);
      return !isNaN(parsed) && parsed > 0 ? parsed : 7;
    }
    return Number(selectedHorizon) || 7;
  }, [selectedHorizon, customHorizonInput]);

  // Compute Full Inventory Item Forecast & Prioritization
  const analyzedInventoryList: ReorderItemAnalysis[] = useMemo(() => {
    const budgetNum = Math.max(0, parseFloat(cashBudget) || 0);

    // Step 1: Analyze each product
    const list: Omit<ReorderItemAnalysis, 'isFundedInBudget' | 'selected'>[] = inventoryItems.map((item) => {
      const unitsPerCase = Math.max(1, item.unitsPerCase || 1);
      const casesStock = Math.max(0, item.stockCases !== undefined ? item.stockCases : ((item as any).stockQuantityCases || 0));
      const singlesStock = Math.max(0, item.stockSingles !== undefined ? item.stockSingles : ((item as any).singleUnits || 0));
      const currentStockUnits = casesStock * unitsPerCase + singlesStock;
      const currentStockCases = casesStock + singlesStock / unitsPerCase;

      const supRecord = productSuppliersMap.get(item.itemId);
      const supInfo = supRecord?.primary || { name: 'Unassigned Vendor', leadTimeDays: defaultLeadTimeDays, id: undefined };
      const allSups = supRecord?.allSuppliers || [];

      const salesStats = productSalesMap.get(item.itemId) || {
        sales7d: 0,
        sales14d: 0,
        sales30d: 0,
        sales90d: 0,
        firstSaleDate: '',
        lastSaleDate: '',
      };

      const daysSinceFirstSale = salesStats.firstSaleDate
        ? Math.max(1, Math.floor((todayTime - new Date(salesStats.firstSaleDate).getTime()) / (1000 * 60 * 60 * 24)))
        : 999;

      const catAnalogRate = categoryAnalogRates.get(item.category || 'General') || 0;

      // Rate calculation with velocity override and blend
      let avgDailySales = 0;
      let isNewProductOverride = false;
      let isAnalogRateUsed = false;

      const rate7d = salesStats.sales7d / 7;
      const rate14d = salesStats.sales14d / 14;
      const rate30d = salesStats.sales30d / 30;
      const rate90d = salesStats.sales90d / 90;

      // Rule: IF days_since_first_sale < 21 AND last_7d_avg_daily_sales > (category_avg * 1.5) -> override with 7d
      if (daysSinceFirstSale < 21 && rate7d > Math.max(0.2, catAnalogRate * 1.5)) {
        avgDailySales = rate7d;
        isNewProductOverride = true;
      } else if (calcWindow === 'weighted') {
        avgDailySales = 0.6 * rate7d + 0.3 * rate14d + 0.1 * rate30d;
      } else if (calcWindow === 7) {
        avgDailySales = rate7d;
      } else if (calcWindow === 14) {
        avgDailySales = rate14d;
      } else if (calcWindow === 90) {
        avgDailySales = rate90d;
      } else {
        avgDailySales = rate30d;
      }

      // Analog fallback for zero sales items listed recently
      if (avgDailySales <= 0 && daysSinceFirstSale < 21 && catAnalogRate > 0) {
        avgDailySales = catAnalogRate;
        isAnalogRateUsed = true;
      }

      // Velocity trend comparison (7d vs 30d)
      let velocityTrend: 'RISING' | 'STEADY' | 'DECLINING' = 'STEADY';
      if (rate7d > rate30d * 1.35 && rate7d >= 1) {
        velocityTrend = 'RISING';
      } else if (rate7d < rate30d * 0.65 && rate30d >= 1) {
        velocityTrend = 'DECLINING';
      }

      // Projected Stockout Days
      const projectedStockoutDays =
        avgDailySales <= 0
          ? currentStockUnits === 0
            ? 0
            : 999
          : currentStockUnits / avgDailySales;

      // Supplier Lead Time & Safety Stock
      const leadTimeDays = item.leadTimeDays && item.leadTimeDays > 0 ? item.leadTimeDays : (supInfo.leadTimeDays || defaultLeadTimeDays);
      const safetyStockUnits = Math.max(
        item.reorderLevelUnits || 0,
        Math.round(avgDailySales * leadTimeDays * (safetyBufferPercent / 100))
      );

      // Reorder Point (ROP) Model = (Daily Sales * Lead Time) + Safety Stock
      const reorderPointUnits = Math.round(avgDailySales * leadTimeDays + safetyStockUnits);

      // Costs and Margins (incorporating supplier price changes or clerk overrides)
      const baseUnitCost = item.costPerUnit !== undefined ? item.costPerUnit : ((item as any).lastCostPrice || (item as any).costPrice || 0);
      const baseCaseCost = item.costPerCase !== undefined ? item.costPerCase : (baseUnitCost * unitsPerCase);
      const caseCost = orderCostOverrides[item.itemId] !== undefined ? orderCostOverrides[item.itemId] : baseCaseCost;
      const unitCost = Number((caseCost / unitsPerCase).toFixed(4));
      const unitSellingPrice = item.sellPriceUnit !== undefined ? item.sellPriceUnit : ((item as any).price || 0);
      const grossMarginPercent =
        unitSellingPrice > 0 ? Math.max(0, ((unitSellingPrice - unitCost) / unitSellingPrice) * 100) : 0;

      // Dual-Criteria Velocity Classification
      const rawCode = (item.itemId || '').toUpperCase();
      const rawSku = (item.sku || '').toUpperCase();
      const rawBarcode = (item.barcode || '').toUpperCase();
      const isChecklistFastMover =
        fastMovingItemIds.has(rawCode) ||
        (rawSku ? fastMovingItemIds.has(rawSku) : false) ||
        (rawBarcode ? fastMovingItemIds.has(rawBarcode) : false);

      const isVelocityFastMover = avgDailySales >= 1.0 || salesStats.sales7d >= 7;
      const isFastMover = isChecklistFastMover || isVelocityFastMover;
      const isSlowMover = !isFastMover && (salesStats.sales30d === 0 || avgDailySales < 0.2);

      // Priority Tiers
      const isLeadTimeBreached = projectedStockoutDays <= leadTimeDays;
      let priorityTier: PriorityTier = 'HEALTHY';
      let urgencyReason = '';

      if (currentStockUnits === 0) {
        if (isSlowMover && avgDailySales <= 0 && salesStats.sales30d === 0) {
          priorityTier = 'PLAN';
          urgencyReason = 'OUT OF STOCK (Zero 30d Velocity / Slow Mover)';
        } else {
          priorityTier = 'CRITICAL';
          urgencyReason = 'OUT OF STOCK (Immediate Restock)';
        }
      } else if (isLeadTimeBreached) {
        priorityTier = 'CRITICAL';
        urgencyReason = `Order TODAY (Lead Time ${leadTimeDays}d > Stock Left ${projectedStockoutDays.toFixed(1)}d)`;
      } else if (projectedStockoutDays <= leadTimeDays + 2 || projectedStockoutDays <= 3) {
        priorityTier = 'URGENT';
        urgencyReason = `Runs out in ${projectedStockoutDays.toFixed(1)} days (Critical Buffer)`;
      } else if (projectedStockoutDays <= effectiveHorizon || currentStockUnits <= reorderPointUnits) {
        priorityTier = 'PLAN';
        urgencyReason = `Runs out in ${projectedStockoutDays.toFixed(1)} days (Horizon: ${effectiveHorizon}d)`;
      }

      // Suggested Order Quantity
      let suggestedOrderUnits = 0;
      let suggestedOrderCases = 0;

      if (priorityTier !== 'HEALTHY') {
        const targetCoverageDays = effectiveHorizon + leadTimeDays;
        const targetUnitsNeeded = Math.ceil(avgDailySales * targetCoverageDays + safetyStockUnits);
        suggestedOrderUnits = Math.max(0, targetUnitsNeeded - currentStockUnits);

        if (suggestedOrderUnits > 0) {
          suggestedOrderCases = Math.max(1, Math.ceil(suggestedOrderUnits / unitsPerCase));
          suggestedOrderUnits = suggestedOrderCases * unitsPerCase;
        } else if (currentStockUnits === 0) {
          suggestedOrderCases = 1;
          suggestedOrderUnits = unitsPerCase;
        }
      }

      const suggestedCost = suggestedOrderCases * caseCost;

      // Custom override if user edited quantity
      const customCases = orderCasesOverrides[item.itemId] !== undefined
        ? orderCasesOverrides[item.itemId]
        : suggestedOrderCases;
      const customUnits = customCases * unitsPerCase;
      const customTotalCost = customCases * caseCost;

      return {
        item,
        currentStockUnits,
        currentStockCases,
        currentStockSingles: singlesStock,
        unitsPerCase,
        supplierId: supInfo.id,
        supplierName: supInfo.name,
        allSuppliers: allSups,
        sales7d: salesStats.sales7d,
        sales14d: salesStats.sales14d,
        sales30d: salesStats.sales30d,
        sales90d: salesStats.sales90d,
        avgDailySales,
        velocityTrend,
        isNewProductOverride,
        isAnalogRateUsed,
        daysSinceFirstSale,
        projectedStockoutDays,
        leadTimeDays,
        safetyStockUnits,
        reorderPointUnits,
        priorityTier,
        urgencyReason,
        isLeadTimeBreached,
        grossMarginPercent,
        unitCost,
        caseCost,
        unitSellingPrice,
        shelfLifeDays: item.shelfLifeDays,
        trackExpiry: Boolean(item.trackExpiry),
        suggestedOrderUnits,
        suggestedOrderCases,
        suggestedCost,
        customOrderCases: customCases,
        customOrderUnits: customUnits,
        customTotalCost,
        isFastMover,
        isSlowMover,
      };
    });

    // Step 2: Sort list by default priority (Critical -> Urgent -> Plan -> Healthy)
    const sorted = [...list].sort((a, b) => {
      const tierRank: Record<PriorityTier, number> = {
        CRITICAL: 1,
        URGENT: 2,
        PLAN: 3,
        HEALTHY: 4,
      };

      if (tierRank[a.priorityTier] !== tierRank[b.priorityTier]) {
        return tierRank[a.priorityTier] - tierRank[b.priorityTier];
      }

      if (a.projectedStockoutDays !== b.projectedStockoutDays) {
        return a.projectedStockoutDays - b.projectedStockoutDays;
      }

      return b.grossMarginPercent - a.grossMarginPercent;
    });

    // Step 3: Cash Budget Greedy Allocation
    let remainingBudget = budgetNum;
    return sorted.map((entry) => {
      const cost = entry.customTotalCost;
      let isFunded = false;

      if (entry.priorityTier !== 'HEALTHY' && cost > 0) {
        if (cost <= remainingBudget) {
          isFunded = true;
          remainingBudget -= cost;
        }
      }

      const isSelected = selectedItemIds.has(entry.item.itemId);

      return {
        ...entry,
        isFundedInBudget: isFunded,
        selected: isSelected,
      };
    });
  }, [
    inventoryItems,
    productSalesMap,
    categoryAnalogRates,
    effectiveHorizon,
    calcWindow,
    cashBudget,
    safetyBufferPercent,
    defaultLeadTimeDays,
    orderCasesOverrides,
    orderCostOverrides,
    selectedItemIds,
    todayTime,
    productSuppliersMap,
    fastMovingItemIds,
  ]);

  // Auto-select critical & urgent items when list loads if no selection yet
  useEffect(() => {
    if (selectedItemIds.size === 0 && analyzedInventoryList.length > 0) {
      const defaultSelected = new Set<string>();
      analyzedInventoryList.forEach((a) => {
        if (a.priorityTier === 'CRITICAL' || a.priorityTier === 'URGENT') {
          defaultSelected.add(a.item.itemId);
        }
      });
      setSelectedItemIds(defaultSelected);
    }
  }, [analyzedInventoryList.length]);

  // Fast Movers Summary Statistics
  const fastMoversStats = useMemo(() => {
    let fastCount = 0;
    let slowHiddenCount = 0;
    analyzedInventoryList.forEach((e) => {
      if (e.isFastMover && !e.isSlowMover) {
        fastCount++;
      } else if (e.isSlowMover) {
        slowHiddenCount++;
      }
    });
    return { fastCount, slowHiddenCount };
  }, [analyzedInventoryList]);

  // Filtered & Sorted Display List with resilient multi-field search
  const displayedList = useMemo(() => {
    let result = analyzedInventoryList.filter((entry) => {
      // Fast Movers Only filter (hides slow movers and dead stock)
      if (fastMoversOnly) {
        if (!entry.isFastMover || entry.isSlowMover) return false;
      }

      // Category filter
      if (selectedCategory !== 'ALL' && entry.item.category !== selectedCategory) {
        return false;
      }

      // Supplier filter (supports both primary and secondary/alternative vendors)
      if (selectedSupplierId === 'UNASSIGNED') {
        if (entry.supplierId || entry.supplierName !== 'Unassigned Vendor') return false;
      } else if (selectedSupplierId !== 'ALL') {
        const targetSup = suppliersMap.get(selectedSupplierId);
        const targetName = targetSup?.name?.toLowerCase();
        const matchesId = entry.supplierId === selectedSupplierId;
        const matchesName = targetName && entry.supplierName.toLowerCase() === targetName;
        const matchesAlt = entry.allSuppliers
          ? entry.allSuppliers.some(
              (s) => s.id === selectedSupplierId || (targetName && s.name.toLowerCase() === targetName)
            )
          : false;
        if (!matchesId && !matchesName && !matchesAlt) return false;
      }

      // Tier filter
      if (tierFilter === 'ALL_NEEDS') {
        if (entry.priorityTier === 'HEALTHY') return false;
      } else if (tierFilter !== 'ALL') {
        if (entry.priorityTier !== tierFilter) return false;
      }

      // Budget filter
      if (budgetFilter === 'FUNDED' && !entry.isFundedInBudget) return false;
      if (budgetFilter === 'UNFUNDED' && (entry.isFundedInBudget || entry.priorityTier === 'HEALTHY')) return false;

      // Search query across Real Product Name, Code, Barcode, Category, and Primary/Alt Supplier Name
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const itemName = getItemName(entry.item);
        const itemCode = getItemCode(entry.item);
        const nameMatch = itemName.toLowerCase().includes(q);
        const codeMatch = itemCode.toLowerCase().includes(q);
        const idMatch = entry.item.itemId ? entry.item.itemId.toLowerCase().includes(q) : false;
        const barcodeMatch = entry.item.barcode ? entry.item.barcode.toLowerCase().includes(q) : false;
        const catMatch = entry.item.category ? entry.item.category.toLowerCase().includes(q) : false;
        const supMatch = entry.supplierName ? entry.supplierName.toLowerCase().includes(q) : false;
        const altSupMatch = entry.allSuppliers ? entry.allSuppliers.some((s) => s.name.toLowerCase().includes(q)) : false;

        if (!nameMatch && !codeMatch && !idMatch && !barcodeMatch && !catMatch && !supMatch && !altSupMatch) {
          return false;
        }
      }

      return true;
    });

    // Custom Sorting
    result.sort((a, b) => {
      if (sortBy === 'STOCKOUT_DAYS') {
        return a.projectedStockoutDays - b.projectedStockoutDays;
      }
      if (sortBy === 'MARGIN') {
        return b.grossMarginPercent - a.grossMarginPercent;
      }
      if (sortBy === 'COST') {
        return b.customTotalCost - a.customTotalCost;
      }
      if (sortBy === 'VELOCITY') {
        return b.avgDailySales - a.avgDailySales;
      }
      const tierRank: Record<PriorityTier, number> = {
        CRITICAL: 1,
        URGENT: 2,
        PLAN: 3,
        HEALTHY: 4,
      };
      if (tierRank[a.priorityTier] !== tierRank[b.priorityTier]) {
        return tierRank[a.priorityTier] - tierRank[b.priorityTier];
      }
      return a.projectedStockoutDays - b.projectedStockoutDays;
    });

    return result;
  }, [
    analyzedInventoryList,
    fastMoversOnly,
    selectedCategory,
    selectedSupplierId,
    tierFilter,
    budgetFilter,
    searchQuery,
    sortBy,
    suppliersMap,
  ]);

  // Aggregate KPI Metrics
  const metrics = useMemo(() => {
    let criticalCount = 0;
    let urgentCount = 0;
    let planCount = 0;
    let totalNeedCost = 0;
    let totalFundedCost = 0;
    let fundedCount = 0;

    analyzedInventoryList.forEach((e) => {
      if (e.priorityTier === 'CRITICAL') {
        criticalCount++;
        totalNeedCost += e.customTotalCost;
      } else if (e.priorityTier === 'URGENT') {
        urgentCount++;
        totalNeedCost += e.customTotalCost;
      } else if (e.priorityTier === 'PLAN') {
        planCount++;
        totalNeedCost += e.customTotalCost;
      }

      if (e.isFundedInBudget) {
        totalFundedCost += e.customTotalCost;
        fundedCount++;
      }
    });

    const budgetVal = parseFloat(cashBudget) || 0;
    const budgetRemaining = Math.max(0, budgetVal - totalFundedCost);
    const budgetDeficit = Math.max(0, totalNeedCost - budgetVal);

    return {
      criticalCount,
      urgentCount,
      planCount,
      totalNeedsCount: criticalCount + urgentCount + planCount,
      totalNeedCost,
      totalFundedCost,
      fundedCount,
      budgetVal,
      budgetRemaining,
      budgetDeficit,
    };
  }, [analyzedInventoryList, cashBudget]);

  // Selected Order Summary for Floating Dispatch Bar
  const selectedSummary = useMemo(() => {
    let itemsCount = 0;
    let totalCases = 0;
    let totalUnits = 0;
    let totalCost = 0;
    let totalEstimatedRevenue = 0;

    analyzedInventoryList.forEach((e) => {
      if (selectedItemIds.has(e.item.itemId) && e.customOrderCases > 0) {
        itemsCount++;
        totalCases += e.customOrderCases;
        totalUnits += e.customOrderUnits;
        totalCost += e.customTotalCost;
        totalEstimatedRevenue += e.customOrderUnits * e.unitSellingPrice;
      }
    });

    const estimatedProfit = Math.max(0, totalEstimatedRevenue - totalCost);
    const estimatedMargin = totalEstimatedRevenue > 0 ? (estimatedProfit / totalEstimatedRevenue) * 100 : 0;

    return {
      itemsCount,
      totalCases,
      totalUnits,
      totalCost,
      totalEstimatedRevenue,
      estimatedProfit,
      estimatedMargin,
    };
  }, [analyzedInventoryList, selectedItemIds]);

  // Supplier Breakdown summary for top tabs
  const supplierBreakdown = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; totalCost: number }>();

    analyzedInventoryList.forEach((e) => {
      if (e.priorityTier !== 'HEALTHY') {
        const supKey = e.supplierId || (e.supplierName !== 'Unassigned Vendor' ? e.supplierName : 'UNASSIGNED');
        const supName = e.supplierName;
        const prev = map.get(supKey) || { id: supKey, name: supName, count: 0, totalCost: 0 };
        map.set(supKey, {
          ...prev,
          count: prev.count + 1,
          totalCost: prev.totalCost + e.customTotalCost,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }, [analyzedInventoryList]);

  // Target Supplier Object for PO Modal
  const activePoSupplier = useMemo(() => {
    if (!poTargetSupplierId) {
      if (suppliers.length > 0) return suppliers[0];
      return null;
    }
    return suppliers.find((s) => (s.supplierId || s.id) === poTargetSupplierId) || null;
  }, [suppliers, poTargetSupplierId]);

  // Filtered suppliers for PO combobox search
  const filteredPoSuppliers = useMemo(() => {
    if (!poSupplierSearchQuery.trim()) return suppliers;
    const q = poSupplierSearchQuery.toLowerCase().trim();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
        (s.phone && s.phone.toLowerCase().includes(q)) ||
        (s.city && s.city.toLowerCase().includes(q)) ||
        (s.category && s.category.toLowerCase().includes(q)) ||
        (s.supplierId && s.supplierId.toLowerCase().includes(q))
    );
  }, [suppliers, poSupplierSearchQuery]);

  // Handle switching supplier for an item (temporary or permanent default)
  const handleSwitchItemSupplier = (itemId: string, newSupplierId: string, setAsPermanentDefault: boolean) => {
    setItemSupplierOverrides((prev) => ({
      ...prev,
      [itemId]: newSupplierId,
    }));

    const supObj = suppliers.find((s) => (s.supplierId || s.id) === newSupplierId);
    const supName = supObj?.name || 'Assigned Vendor';

    if (setAsPermanentDefault) {
      const inv = getInventoryItems();
      const existing = inv.find((i) => i.itemId === itemId);
      if (existing) {
        const updated: InventoryItem = {
          ...existing,
          supplierId: newSupplierId,
          supplierName: supName,
          preferredSupplierId: newSupplierId,
        };
        saveInventoryItem(updated);
      }
      setToastNotification(`Default supplier for this item updated to "${supName}"!`);
    } else {
      setToastNotification(`Switched supplier to "${supName}" for this reorder cycle.`);
    }

    setSupplierSwitchTarget(null);
  };

  // PO Totals Calculations (Subtotal, Tax, Freight, Grand Total)
  const poTotals = useMemo(() => {
    let subtotal = 0;
    let totalUnits = 0;
    let totalCases = 0;

    poCustomLines.forEach((l) => {
      subtotal += l.lineTotal;
      totalUnits += l.totalUnits;
      totalCases += l.orderCases;
    });

    const taxRate = Math.max(0, poTaxRatePercent) / 100;
    const taxAmount = subtotal * taxRate;
    const freight = Math.max(0, parseFloat(poFreightFee) || 0);
    const grandTotal = subtotal + taxAmount + freight;

    return {
      subtotal,
      totalUnits,
      totalCases,
      taxAmount,
      freight,
      grandTotal,
    };
  }, [poCustomLines, poTaxRatePercent, poFreightFee]);

  // Handlers for Multi-Selection
  const handleSelectAllCritical = () => {
    const next = new Set(selectedItemIds);
    analyzedInventoryList.forEach((e) => {
      if (e.priorityTier === 'CRITICAL') next.add(e.item.itemId);
    });
    setSelectedItemIds(next);
  };

  const handleSelectAllUrgent = () => {
    const next = new Set(selectedItemIds);
    analyzedInventoryList.forEach((e) => {
      if (e.priorityTier === 'CRITICAL' || e.priorityTier === 'URGENT') next.add(e.item.itemId);
    });
    setSelectedItemIds(next);
  };

  const handleSelectAllFunded = () => {
    const next = new Set<string>();
    analyzedInventoryList.forEach((e) => {
      if (e.isFundedInBudget) next.add(e.item.itemId);
    });
    setSelectedItemIds(next);
  };

  const handleClearSelection = () => {
    setSelectedItemIds(new Set());
  };

  const toggleItemSelection = (itemId: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    setSelectedItemIds(next);
  };

  const handleUpdateCases = (itemId: string, cases: number) => {
    setOrderCasesOverrides((prev) => ({
      ...prev,
      [itemId]: Math.max(0, cases),
    }));
  };

  // Open Full Commercial Purchase Order Modal
  const handleOpenPoModal = (param?: string | { overrideSupplierId?: string; blank?: boolean }) => {
    let initialSupplierId: string | undefined;
    let isBlank = false;

    if (typeof param === 'string') {
      initialSupplierId = param;
    } else if (param && typeof param === 'object') {
      initialSupplierId = param.overrideSupplierId;
      isBlank = Boolean(param.blank);
    }

    if (!initialSupplierId) {
      initialSupplierId = selectedSupplierId;
    }

    // If 'ALL' or 'UNASSIGNED', attempt to infer from selected items or fallback to first supplier
    if (initialSupplierId === 'ALL' || initialSupplierId === 'UNASSIGNED' || !initialSupplierId) {
      if (!isBlank) {
        const firstWithSup = analyzedInventoryList.find(
          (e) => selectedItemIds.has(e.item.itemId) && e.supplierId
        );
        if (firstWithSup && firstWithSup.supplierId) {
          initialSupplierId = firstWithSup.supplierId;
        }
      }
      if (!initialSupplierId || initialSupplierId === 'ALL' || initialSupplierId === 'UNASSIGNED') {
        if (suppliers.length > 0) {
          initialSupplierId = suppliers[0].supplierId || suppliers[0].id;
        }
      }
    }

    setPoTargetSupplierId(initialSupplierId || '');

    if (isBlank) {
      // Direct blank purchase order: start with 0 days-cover line items
      setPoCustomLines([]);
    } else {
      // Initial lines from selected items
      const lines: PoLineItem[] = analyzedInventoryList
        .filter((e) => {
          if (!selectedItemIds.has(e.item.itemId) || e.customOrderCases <= 0) return false;
          // If an explicit supplier was selected, filter only items matching this supplier (or approved alternate)
          if (initialSupplierId && initialSupplierId !== 'ALL' && initialSupplierId !== 'UNASSIGNED') {
            const matchesPrimary = e.supplierId === initialSupplierId;
            const matchesAlt = e.allSuppliers?.some((s) => s.id === initialSupplierId);
            return matchesPrimary || matchesAlt;
          }
          return true;
        })
        .map((e) => {
          const originalCaseCost = e.item.costPerCase !== undefined 
            ? e.item.costPerCase 
            : ((e.item.costPerUnit !== undefined ? e.item.costPerUnit : ((e.item as any).lastCostPrice || (e.item as any).costPrice || 0)) * e.unitsPerCase);
          const originalUnitCost = Number((originalCaseCost / e.unitsPerCase).toFixed(4));
          const isModified = Math.abs(e.caseCost - originalCaseCost) > 0.005;

          return {
            itemId: e.item.itemId,
            name: getItemName(e.item),
            code: getItemCode(e.item),
            barcode: e.item.barcode || '',
            category: e.item.category || 'General',
            orderCases: e.customOrderCases,
            unitsPerCase: e.unitsPerCase,
            totalUnits: e.customOrderUnits,
            unitCost: e.unitCost,
            caseCost: e.caseCost,
            lineTotal: e.customTotalCost,
            sellingPrice: e.unitSellingPrice,
            originalCaseCost,
            originalUnitCost,
            isCostModified: isModified,
          };
        });

      setPoCustomLines(lines);
    }

    // Default delivery date: today + leadTime
    const supObj = suppliers.find((s) => (s.supplierId || s.id) === initialSupplierId);
    const leadDays = supObj?.leadTimeDays || defaultLeadTimeDays;
    const expDate = new Date(todayTime + leadDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setPoDeliveryDate(expDate);

    // Payment terms from supplier
    if (supObj?.paymentTerms) {
      setPoPaymentTerms(supObj.paymentTerms);
    } else {
      setPoPaymentTerms('30-Day Account Credit');
    }

    // Default delivery bay
    setPoDeliveryBay(branch?.name ? `${branch.name} Loading Dock (${branch.address || branch.location || 'Central'})` : 'Main Store Receiving Dock');

    const poNum = `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    setGeneratedPoNumber(poNum);
    setIsPoModalOpen(true);
  };

  // Add Ad-Hoc Item into PO Modal
  const handleAddAdHocItemToPo = (item: InventoryItem) => {
    const existingIndex = poCustomLines.findIndex((l) => l.itemId === item.itemId);
    const unitsPerCase = Math.max(1, item.unitsPerCase || 1);
    const rawUnit = item.costPerUnit !== undefined ? item.costPerUnit : ((item as any).lastCostPrice || (item as any).costPrice || 0);
    const originalCaseCost = item.costPerCase !== undefined ? item.costPerCase : (rawUnit * unitsPerCase);
    const originalUnitCost = Number((originalCaseCost / unitsPerCase).toFixed(4));
    const caseCost = orderCostOverrides[item.itemId] !== undefined ? orderCostOverrides[item.itemId] : originalCaseCost;
    const unitCost = Number((caseCost / unitsPerCase).toFixed(4));
    const isModified = Math.abs(caseCost - originalCaseCost) > 0.005;
    const pName = getItemName(item);
    const pCode = getItemCode(item);

    if (existingIndex >= 0) {
      // Increment cases
      const updated = [...poCustomLines];
      const line = updated[existingIndex];
      const newCases = line.orderCases + 1;
      updated[existingIndex] = {
        ...line,
        orderCases: newCases,
        totalUnits: newCases * line.unitsPerCase,
        lineTotal: newCases * line.caseCost,
      };
      setPoCustomLines(updated);
    } else {
      // Add new line
      const newLine: PoLineItem = {
        itemId: item.itemId,
        name: pName,
        code: pCode,
        barcode: item.barcode || '',
        category: item.category || 'General',
        orderCases: 1,
        unitsPerCase,
        totalUnits: unitsPerCase,
        unitCost,
        caseCost,
        lineTotal: caseCost,
        sellingPrice: item.sellPriceUnit !== undefined ? item.sellPriceUnit : ((item as any).price || 0),
        originalCaseCost,
        originalUnitCost,
        isCostModified: isModified,
      };
      setPoCustomLines([...poCustomLines, newLine]);
    }

    setAdHocSearchQuery('');
    setIsAdHocDropdownOpen(false);
  };

  const handleUpdatePoLineCases = (itemId: string, cases: number) => {
    const validCases = Math.max(0, cases);
    const updated = poCustomLines
      .map((line) => {
        if (line.itemId === itemId) {
          return {
            ...line,
            orderCases: validCases,
            totalUnits: validCases * line.unitsPerCase,
            lineTotal: validCases * line.caseCost,
          };
        }
        return line;
      })
      .filter((l) => l.orderCases > 0);
    setPoCustomLines(updated);
  };

  // Editable Supplier Cost Handler: allows editing either Case Cost or Unit Cost, recalculating dynamically
  const handleUpdatePoLineCost = (
    itemId: string,
    newCost: number,
    costType: 'case' | 'unit' = 'case'
  ) => {
    const updated = poCustomLines.map((line) => {
      if (line.itemId === itemId) {
        const uPerCase = Math.max(1, line.unitsPerCase || 1);
        let updatedCaseCost = line.caseCost;
        let updatedUnitCost = line.unitCost;

        if (costType === 'case') {
          updatedCaseCost = Math.max(0, newCost);
          updatedUnitCost = Number((updatedCaseCost / uPerCase).toFixed(4));
        } else {
          updatedUnitCost = Math.max(0, newCost);
          updatedCaseCost = Number((updatedUnitCost * uPerCase).toFixed(2));
        }

        const baseOriginal = line.originalCaseCost !== undefined ? line.originalCaseCost : line.caseCost;
        const isModified = Math.abs(updatedCaseCost - baseOriginal) > 0.005;

        return {
          ...line,
          caseCost: updatedCaseCost,
          unitCost: updatedUnitCost,
          lineTotal: Number((line.orderCases * updatedCaseCost).toFixed(2)),
          isCostModified: isModified,
        };
      }
      return line;
    });
    setPoCustomLines(updated);
  };

  // Sync a single edited line cost to the permanent inventory master catalog
  const handleSyncLineCostToCatalog = (line: PoLineItem) => {
    const originalItem = inventoryItems.find((it) => it.itemId === line.itemId);
    if (!originalItem) return;

    const updatedItem: InventoryItem = {
      ...originalItem,
      costPerCase: line.caseCost,
      costPerUnit: line.unitCost,
      lastCostPrice: line.unitCost,
    };
    saveInventoryItem(updatedItem);
    setToastNotification(`Updated catalog master cost for "${line.name}" to $${line.caseCost.toFixed(2)}/case ($${line.unitCost.toFixed(2)}/unit).`);

    setPoCustomLines((prev) =>
      prev.map((l) =>
        l.itemId === line.itemId
          ? { ...l, originalCaseCost: line.caseCost, originalUnitCost: line.unitCost, isCostModified: false }
          : l
      )
    );
  };

  // Sync all modified line costs to the permanent inventory master catalog
  const handleSyncAllCostsToCatalog = () => {
    let count = 0;
    poCustomLines.forEach((line) => {
      if (line.isCostModified) {
        const originalItem = inventoryItems.find((it) => it.itemId === line.itemId);
        if (originalItem) {
          saveInventoryItem({
            ...originalItem,
            costPerCase: line.caseCost,
            costPerUnit: line.unitCost,
            lastCostPrice: line.unitCost,
          });
          count++;
        }
      }
    });
    setPoCustomLines((prev) =>
      prev.map((l) => ({
        ...l,
        originalCaseCost: l.caseCost,
        originalUnitCost: l.unitCost,
        isCostModified: false,
      }))
    );
    setToastNotification(`Saved new supplier prices for ${count} item(s) to catalog master.`);
  };

  const handleRemovePoLine = (itemId: string) => {
    setPoCustomLines(poCustomLines.filter((l) => l.itemId !== itemId));
  };

  // Export PO as CSV
  const handleExportPoCsv = () => {
    if (poCustomLines.length === 0) {
      alert('Please add at least one line item to export.');
      return;
    }

    const headers = [
      'PO Number',
      'PO Date',
      'Buyer Company',
      'Buyer Branch',
      'Supplier Name',
      'Payment Terms',
      'Item Code',
      'Barcode',
      'Product Name',
      'Order Cases',
      'Units Per Case',
      'Total Order Units',
      'Unit Cost',
      'Case Cost',
      'Line Total (Excl. Tax)',
    ];

    const rows = poCustomLines.map((line) => [
      `"${generatedPoNumber}"`,
      `"${todayStr}"`,
      `"${company?.company_name || 'Retailer'}"`,
      `"${branch?.name || 'Main Branch'}"`,
      `"${activePoSupplier?.name || 'Supplier'}"`,
      `"${poPaymentTerms}"`,
      `"${line.code}"`,
      `"${line.barcode}"`,
      `"${line.name.replace(/"/g, '""')}"`,
      line.orderCases,
      line.unitsPerCase,
      line.totalUnits,
      line.unitCost.toFixed(2),
      line.caseCost.toFixed(2),
      line.lineTotal.toFixed(2),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${generatedPoNumber}_${activePoSupplier?.name ? activePoSupplier.name.replace(/\s+/g, '_') : 'Order'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Generate WhatsApp Order Message
  const handleCopyWhatsAppOrder = () => {
    if (poCustomLines.length === 0) return;

    const supplierTitle = activePoSupplier?.name || 'Supplier Order Desk';
    const linesText = poCustomLines
      .map(
        (l, idx) =>
          `${idx + 1}. *${l.name}* (${l.code})\n   • Qty: *${l.orderCases} Cases* (${l.totalUnits} units @ $${l.caseCost.toFixed(2)}/cs)\n   • Line Total: $${l.lineTotal.toFixed(2)}`
      )
      .join('\n\n');

    const message = `📦 *OFFICIAL PURCHASE ORDER: ${generatedPoNumber}*
📅 *Date:* ${todayStr}
🏢 *Buyer:* ${company?.company_name || 'Store'} (${branch?.name || 'Main Branch'})
🚚 *Vendor:* ${supplierTitle}
💳 *Terms:* ${poPaymentTerms}
🎯 *Target Delivery Date:* ${poDeliveryDate}
📍 *Delivery Dock:* ${poDeliveryBay}

──────────────────────
*ORDERED ITEMS:*
──────────────────────
${linesText}

──────────────────────
*COMMERCIAL SUMMARY:*
• Subtotal: *$${poTotals.subtotal.toFixed(2)}*
• VAT/Tax (${poTaxRatePercent}%): *$${poTotals.taxAmount.toFixed(2)}*
${poTotals.freight > 0 ? `• Freight / Delivery: *$${poTotals.freight.toFixed(2)}*\n` : ''}• *GRAND TOTAL PAYABLE: $${poTotals.grandTotal.toFixed(2)}*
──────────────────────
*Authorized By:* ${poPurchasingOfficer}
*Note:* Please confirm delivery date and vehicle details.`;

    navigator.clipboard.writeText(message);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2500);
  };

  // Send items directly to Direct GRV
  const handleSendToDirectGrv = () => {
    if (poCustomLines.length === 0) {
      alert('Please add at least one line item to receive.');
      return;
    }

    const prefillRows = poCustomLines.map((l) => ({
      productId: l.itemId,
      productName: l.name,
      category: l.category,
      receiveAs: l.unitsPerCase > 1 ? 'Cases' : 'Singles',
      qtyPerCaseDefault: l.unitsPerCase,
      quantityCases: l.orderCases,
      quantitySingles: 0,
      pricePerCase: l.caseCost,
      lastCost: l.unitCost,
      sellingPrice: l.sellingPrice,
    }));

    try {
      localStorage.removeItem(STORAGE_KEY_PO_DRAFT);
      setHasRestoredPoDraft(false);
      setLastPoDraftSavedAt(null);
    } catch (e) {
      // ignore
    }

    if (onNavigateToDirectGrv) {
      onNavigateToDirectGrv(prefillRows, poTargetSupplierId);
    } else {
      alert('Items prepared for delivery. Switch to Direct GRV from the navigation menu.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-28">
      {/* TOP NOTCH HEADER HERO */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white border-b border-indigo-900/40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-7">
          {/* Company & Branch Identity Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="p-2 bg-indigo-500/20 border border-indigo-400/40 rounded-xl text-indigo-400">
                  <TrendingUp className="w-5 h-5" />
                </span>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                  Procurement &amp; Reorder Planning Hub
                  <span className="text-[11px] font-bold px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-full">
                    Enterprise Engine
                  </span>
                </h1>
              </div>

              {/* Dynamic Company & Branch Profile */}
              <div className="flex items-center gap-3 text-xs text-slate-300 pt-1 flex-wrap">
                <span className="flex items-center gap-1 font-bold text-white bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                  <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Company: {company?.company_name || 'Retail Enterprise'}</span>
                </span>
                <span className="flex items-center gap-1 font-bold text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
                  <MapPin className="w-3.5 h-3.5 text-amber-400" />
                  <span>Branch: {branch?.name || 'Main Store'} ({branch?.code || 'HQ'})</span>
                </span>
                <span className="text-slate-400 font-mono text-[11px] hidden sm:inline">
                  TIN: {company?.company_id || 'COMP-001'} &bull; Buyer: {currentUser?.name || 'Purchasing Director'}
                </span>
              </div>
            </div>

            {/* Top Hub Actions */}
            <div className="flex items-center flex-wrap gap-2.5">
              {onGoToMaster && (
                <button
                  type="button"
                  onClick={onGoToMaster}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Package className="w-3.5 h-3.5 text-slate-400" />
                  <span>Catalog Master</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleOpenPoModal({ blank: true })}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white border border-indigo-500/40 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                title="Create a blank or ad-hoc commercial purchase order independent of days-cover suggestions"
              >
                <Plus className="w-4 h-4 text-indigo-400" />
                <span>+ Blank Purchase Order</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenPoModal()}
                disabled={selectedSummary.itemsCount === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/30 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-indigo-200" />
                <span>Create Commercial PO ({selectedSummary.itemsCount})</span>
              </button>
            </div>
          </div>

          {/* CONTROLS STRIP: Horizon, Cash Budget, Baseline Window */}
          <div className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            {/* Horizon Selector */}
            <div className="md:col-span-6 space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Reorder Horizon Window</span>
                <span className="text-[11px] font-normal text-slate-400">
                  — Predicts SKUs running out within this period
                </span>
              </label>
              <div className="flex items-center gap-2">
                {([3, 7, 14, 30] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => {
                      setSelectedHorizon(days);
                      setCustomHorizonInput('');
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-extrabold transition-all border cursor-pointer ${
                      selectedHorizon === days
                        ? 'bg-indigo-600 text-white border-indigo-400 shadow-md ring-2 ring-indigo-400/30'
                        : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {days} Days
                  </button>
                ))}
                <div className="w-24 relative">
                  <input
                    type="number"
                    min={1}
                    max={180}
                    placeholder="Custom"
                    value={customHorizonInput}
                    onChange={(e) => {
                      setCustomHorizonInput(e.target.value);
                      setSelectedHorizon('custom');
                    }}
                    className={`w-full py-2 px-2.5 rounded-xl text-xs font-bold bg-slate-800 border text-center text-white placeholder:text-slate-500 focus:outline-none ${
                      selectedHorizon === 'custom'
                        ? 'border-indigo-400 ring-2 ring-indigo-400/30'
                        : 'border-slate-700'
                    }`}
                  />
                  <span className="absolute right-2 top-2.5 text-[10px] text-slate-400 pointer-events-none">d</span>
                </div>
              </div>
            </div>

            {/* Cash Budget Input */}
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span>Available Cash Budget ($)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm font-bold text-slate-400">$</span>
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={cashBudget}
                  onChange={(e) => setCashBudget(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full pl-7 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm font-mono font-bold text-white focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                />
              </div>
            </div>

            {/* Baseline Period Window Config */}
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>Sales Baseline Period</span>
              </label>
              <select
                value={calcWindow}
                onChange={(e) =>
                  setCalcWindow(
                    e.target.value === 'weighted' ? 'weighted' : (Number(e.target.value) as CalculationWindow)
                  )
                }
                className="w-full py-2 px-3 bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-indigo-400"
              >
                <option value={7}>Last 7 Days (Fast FMCG / High Agility)</option>
                <option value={14}>Last 14 Days (Bi-weekly standard)</option>
                <option value={30}>Last 30 Days (Standard default)</option>
                <option value={90}>Last 90 Days (Smoothed seasonal)</option>
                <option value="weighted">Dynamic Weighted Blend (60% 7d, 30% 14d, 10% 30d)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 -mt-3 sm:-mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Critical Items */}
          <div
            onClick={() => setTierFilter(tierFilter === 'CRITICAL' ? 'ALL_NEEDS' : 'CRITICAL')}
            className={`cursor-pointer rounded-2xl p-4 bg-white border shadow-sm transition-all flex flex-col justify-between ${
              tierFilter === 'CRITICAL'
                ? 'border-rose-500 ring-2 ring-rose-400/40 bg-rose-50/40'
                : 'border-slate-200 hover:border-rose-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-rose-700 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse" />
                Critical (Order Today)
              </span>
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black font-mono text-rose-700">
                {metrics.criticalCount}
                <span className="text-xs font-semibold text-slate-500 ml-1.5">SKUs</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Stockout imminent within supplier lead time
              </p>
            </div>
          </div>

          {/* Card 2: Urgent Items */}
          <div
            onClick={() => setTierFilter(tierFilter === 'URGENT' ? 'ALL_NEEDS' : 'URGENT')}
            className={`cursor-pointer rounded-2xl p-4 bg-white border shadow-sm transition-all flex flex-col justify-between ${
              tierFilter === 'URGENT'
                ? 'border-amber-500 ring-2 ring-amber-400/40 bg-amber-50/40'
                : 'border-slate-200 hover:border-amber-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                Urgent Restock
              </span>
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black font-mono text-amber-700">
                {metrics.urgentCount}
                <span className="text-xs font-semibold text-slate-500 ml-1.5">SKUs</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Runs out within 2–3 days buffer
              </p>
            </div>
          </div>

          {/* Card 3: Planned in Horizon */}
          <div
            onClick={() => setTierFilter(tierFilter === 'PLAN' ? 'ALL_NEEDS' : 'PLAN')}
            className={`cursor-pointer rounded-2xl p-4 bg-white border shadow-sm transition-all flex flex-col justify-between ${
              tierFilter === 'PLAN'
                ? 'border-blue-500 ring-2 ring-blue-400/40 bg-blue-50/40'
                : 'border-slate-200 hover:border-blue-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                Plan ({effectiveHorizon}d Horizon)
              </span>
              <Package className="w-4 h-4 text-blue-600" />
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black font-mono text-blue-700">
                {metrics.planCount}
                <span className="text-xs font-semibold text-slate-500 ml-1.5">SKUs</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Can order with standard supplier delivery
              </p>
            </div>
          </div>

          {/* Card 4: Cash Budget Allocation Status */}
          <div className="rounded-2xl p-4 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Budget Allocation
              </span>
              <span className="text-[11px] font-mono font-bold text-slate-500">
                Cap: ${metrics.budgetVal.toFixed(0)}
              </span>
            </div>
            <div className="mt-2">
              <div className="flex items-baseline justify-between">
                <div className="text-xl sm:text-2xl font-black font-mono text-emerald-700">
                  ${metrics.totalFundedCost.toFixed(0)}
                </div>
                <div className="text-xs font-bold text-slate-600">
                  {metrics.fundedCount} of {metrics.totalNeedsCount} SKUs Funded
                </div>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 mt-2 overflow-hidden border border-slate-200">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${metrics.budgetVal > 0 ? Math.min(100, (metrics.totalFundedCost / metrics.budgetVal) * 100) : 0}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                <span>Remaining: ${metrics.budgetRemaining.toFixed(0)}</span>
                {metrics.budgetDeficit > 0 && (
                  <span className="text-rose-600 font-bold">Deficit: -${metrics.budgetDeficit.toFixed(0)}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RECOVERED PURCHASE ORDER DRAFT BANNER (Clerk Crash / Power Outage Recovery) */}
      {hasRestoredPoDraft && poCustomLines.length > 0 && !isPoModalOpen && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4">
          <div className="bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent border-2 border-amber-500/40 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-md animate-in fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-xs shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="font-black text-xs text-amber-950 flex items-center gap-2">
                  <span>Auto-Saved Purchase Order Draft Recovered</span>
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold border border-amber-300">
                    {poCustomLines.length} items &bull; Last Saved: {lastPoDraftSavedAt || 'Recent'}
                  </span>
                </div>
                <p className="text-[11px] text-amber-900/80 mt-0.5">
                  Power outage, network drop, or clerk closed tab? Your purchase order draft was automatically preserved so you can continue where you left off.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsPoModalOpen(true)}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Resume Purchase Order</span>
              </button>
              <button
                type="button"
                onClick={handleDiscardPoDraft}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Discard Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUPPLIER TABS STRIP (Order by Vendor) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedSupplierId('ALL')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all border cursor-pointer ${
              selectedSupplierId === 'ALL'
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            All Vendors ({analyzedInventoryList.length})
          </button>

          {supplierBreakdown.map((sb, idx) => (
            <button
              key={`${sb.id}-${idx}`}
              type="button"
              onClick={() => setSelectedSupplierId(sb.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border flex items-center gap-2 cursor-pointer ${
                selectedSupplierId === sb.id
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span>{sb.name}</span>
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full ${
                  selectedSupplierId === sb.id
                    ? 'bg-indigo-800 text-indigo-100'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {sb.count} needs &bull; ${sb.totalCost.toFixed(0)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* FILTER AND QUICK-ACTION TOOLBAR */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            {/* Search Input across Name, Code, Barcode, Supplier */}
            <div className="relative flex-1 min-w-[260px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products by Name (e.g. Sugar, Milk), SKU code, Barcode, or Vendor..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Category Dropdown */}
            <div className="w-full lg:w-48">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Categories ({categories.length})</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Supplier Dropdown */}
            <div className="w-full lg:w-52">
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Vendors ({suppliers.length})</option>
                <option value="UNASSIGNED">Unassigned Vendor</option>
                {suppliers.map((s, idx) => (
                  <option key={`${s.supplierId || s.id || 'sup'}-${idx}`} value={s.supplierId || s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="w-full lg:w-48">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="URGENCY">Sort: Urgency Rank</option>
                <option value="STOCKOUT_DAYS">Sort: Stockout Days (Soonest)</option>
                <option value="MARGIN">Sort: Gross Margin % (Highest)</option>
                <option value="COST">Sort: Spend Cost (Highest)</option>
                <option value="VELOCITY">Sort: Daily Velocity (Fastest)</option>
              </select>
            </div>
          </div>

          {/* Quick Select Buttons & Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-500 mr-1">Filter View:</span>
              <button
                type="button"
                onClick={() => setTierFilter('ALL_NEEDS')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  tierFilter === 'ALL_NEEDS'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Restock Needs ({metrics.totalNeedsCount})
              </button>
              <button
                type="button"
                onClick={() => setTierFilter('CRITICAL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  tierFilter === 'CRITICAL'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                }`}
              >
                Critical ({metrics.criticalCount})
              </button>
              <button
                type="button"
                onClick={() => setTierFilter('URGENT')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  tierFilter === 'URGENT'
                    ? 'bg-amber-500 text-white'
                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                Urgent ({metrics.urgentCount})
              </button>
              <button
                type="button"
                onClick={() => setTierFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  tierFilter === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Full Catalog ({analyzedInventoryList.length})
              </button>
              <button
                type="button"
                onClick={() => setBudgetFilter(budgetFilter === 'FUNDED' ? 'ALL' : 'FUNDED')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                  budgetFilter === 'FUNDED'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                ✓ Budget Funded Only ({metrics.fundedCount})
              </button>

              {/* Fast Movers Toggle Pill */}
              <div className="flex items-center bg-amber-50 border border-amber-300 p-0.5 rounded-xl ml-1">
                <button
                  type="button"
                  onClick={() => setFastMoversOnly(true)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1 cursor-pointer ${
                    fastMoversOnly
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-amber-800 hover:text-amber-950'
                  }`}
                  title="Filter to high-velocity staples (daily sales >= 1 unit/day or in Fast-Moving Checklist) and hide slow movers"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-900" />
                  <span>⚡ Fast Movers Only</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFastMoversOnly(false)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    !fastMoversOnly
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>All Products</span>
                </button>
              </div>
            </div>

            {/* Fast Movers Summary Badge */}
            {fastMoversOnly && (
              <div className="w-full mt-2 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-r from-amber-50 via-amber-100/50 to-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 font-medium animate-fadeIn">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-lg bg-amber-500 text-slate-950 font-black text-[10px]">
                    ⚡ RAPID RESTOCK
                  </span>
                  <span>
                    Showing <strong className="font-black text-slate-900">{fastMoversStats.fastCount}</strong> high-velocity staples (
                    <strong className="font-bold text-amber-800">{fastMoversStats.slowHiddenCount}</strong> slow movers hidden for rapid ordering)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFastMoversOnly(false)}
                  className="text-[11px] font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer"
                >
                  Show all products
                </button>
              </div>
            )}

            {/* Quick Multi-Select */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500 mr-1">Select:</span>
              <button
                type="button"
                onClick={handleSelectAllCritical}
                className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold cursor-pointer"
              >
                All Critical
              </button>
              <button
                type="button"
                onClick={handleSelectAllUrgent}
                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold cursor-pointer"
              >
                All Critical &amp; Urgent
              </button>
              <button
                type="button"
                onClick={handleSelectAllFunded}
                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold cursor-pointer"
              >
                All Funded ({metrics.fundedCount})
              </button>
              {selectedItemIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2 py-1 text-slate-500 hover:text-slate-800 text-xs font-bold underline cursor-pointer"
                >
                  Clear ({selectedItemIds.size})
                </button>
              )}

              {/* DUAL VIEW MODE TOGGLE (Cards vs Compact Table for Mobile) */}
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 ml-auto">
                <button
                  type="button"
                  onClick={() => setMobileViewMode('CARDS')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    mobileViewMode === 'CARDS'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Card view: thumb-friendly touch cards with steppers"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Cards</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobileViewMode('TABLE')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    mobileViewMode === 'TABLE'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Table view: spreadsheet layout with sticky product column"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Table</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN RANKED REORDER DISPLAY (Cards Mode or Compact Table Mode) */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 mt-4 pb-36 sm:pb-28">
        {mobileViewMode === 'CARDS' ? (
          /* ========================================================================= */
          /* MOBILE CARDS VIEW: Ergonomic, touch-friendly, high-contrast              */
          /* ========================================================================= */
          <div className="space-y-3">
            {displayedList.length === 0 ? (
              <div className="py-12 px-4 text-center text-slate-500 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex flex-col items-center justify-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  <span className="font-bold text-sm text-slate-800">
                    No items match the selected filter or search!
                  </span>
                  <p className="text-xs text-slate-500 max-w-sm">
                    Try searching for another product name, changing the supplier tab, or clearing the filter.
                  </p>
                </div>
              </div>
            ) : (
              displayedList.map((entry) => {
                const isSelected = selectedItemIds.has(entry.item.itemId);
                return (
                  <div
                    key={entry.item.itemId}
                    className={`rounded-2xl border p-4 transition-all shadow-xs ${
                      isSelected
                        ? 'bg-indigo-50/40 border-indigo-300 ring-2 ring-indigo-400/20'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Top Row: Selection Checkbox, Product Name, and Urgency Badge */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItemSelection(entry.item.itemId)}
                          className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm sm:text-base font-black text-slate-900 leading-snug tracking-tight">
                            {getItemName(entry.item)}
                          </div>
                          {entry.item.description && entry.item.description !== getItemName(entry.item) && (
                            <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                              {entry.item.description}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap text-[10px]">
                            <span className="font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                              SKU: {getItemCode(entry.item)}
                            </span>
                            {entry.item.barcode && (
                              <span className="font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                {entry.item.barcode}
                              </span>
                            )}
                            {entry.item.category && (
                              <span className="bg-indigo-50 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                {entry.item.category}
                              </span>
                            )}
                            <span className="bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded">
                              {entry.unitsPerCase} / case
                            </span>
                            {entry.isFastMover && (
                              <span className="bg-amber-100 text-amber-900 border border-amber-300 font-black px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <span>⚡ Fast Mover</span>
                              </span>
                            )}
                            {entry.isSlowMover && (
                              <span className="bg-slate-100 text-slate-500 border border-slate-200 font-semibold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                <span>🐢 Slow Mover</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Urgency Badge */}
                      <div className="shrink-0 text-right">
                        {entry.priorityTier === 'CRITICAL' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                            Critical
                          </span>
                        ) : entry.priorityTier === 'URGENT' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Urgent
                          </span>
                        ) : entry.priorityTier === 'PLAN' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-800 border border-blue-200">
                            Plan
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600">
                            Healthy
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Velocity & Stock Strip */}
                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100 text-center font-mono">
                      <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                        <div className="text-[10px] text-slate-500 uppercase font-sans font-bold">Stock on Hand</div>
                        <div className={`text-xs font-black ${entry.currentStockUnits === 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                          {entry.currentStockUnits === 0 ? '0 Units' : `${entry.currentStockUnits} un`}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {entry.currentStockCases.toFixed(1)} cs
                        </div>
                      </div>
                      <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                        <div className="text-[10px] text-slate-500 uppercase font-sans font-bold">Daily Velocity</div>
                        <div className="text-xs font-black text-slate-900 flex items-center justify-center gap-1">
                          {entry.velocityTrend === 'RISING' && <TrendingUp className="w-3 h-3 text-emerald-600" />}
                          {entry.velocityTrend === 'DECLINING' && <TrendingDown className="w-3 h-3 text-slate-400" />}
                          <span>{entry.avgDailySales.toFixed(1)}/d</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {entry.sales30d} sold 30d
                        </div>
                      </div>
                      <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                        <div className="text-[10px] text-slate-500 uppercase font-sans font-bold">Cover Days</div>
                        <div
                          className={`text-xs font-black ${
                            entry.projectedStockoutDays <= entry.leadTimeDays
                              ? 'text-rose-600'
                              : entry.projectedStockoutDays <= 3
                              ? 'text-amber-600'
                              : 'text-slate-900'
                          }`}
                        >
                          {entry.projectedStockoutDays >= 999 ? '999+ d' : `${entry.projectedStockoutDays.toFixed(1)} d`}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Lead: {entry.leadTimeDays}d
                        </div>
                      </div>
                    </div>

                    {/* Stepper Controls & Line Cost */}
                    <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                      {/* Ergonomic Steppers with 44px Touch Targets */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-700">Reorder:</span>
                        <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200">
                          <button
                            type="button"
                            onClick={() => handleUpdateCases(entry.item.itemId, Math.max(0, entry.customOrderCases - 1))}
                            className="w-10 h-10 rounded-lg bg-white hover:bg-slate-50 text-slate-800 font-black text-base flex items-center justify-center shadow-xs cursor-pointer active:scale-95"
                            aria-label="Decrease cases"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input
                            type="number"
                            min={0}
                            value={entry.customOrderCases}
                            onChange={(e) => handleUpdateCases(entry.item.itemId, Number(e.target.value) || 0)}
                            className="w-14 py-1 text-center font-mono font-black text-slate-900 text-sm bg-transparent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateCases(entry.item.itemId, entry.customOrderCases + 1)}
                            className="w-10 h-10 rounded-lg bg-white hover:bg-slate-50 text-slate-800 font-black text-base flex items-center justify-center shadow-xs cursor-pointer active:scale-95"
                            aria-label="Increase cases"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-600">
                          cs ({entry.customOrderUnits} u)
                        </span>
                      </div>

                      {/* Line Cost and Budget Funding */}
                      <div className="text-right ml-auto flex items-center gap-2.5">
                        <div>
                          <div className="text-sm font-black font-mono text-slate-900">
                            ${entry.customTotalCost.toFixed(2)}
                          </div>
                          <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500 font-mono mt-0.5">
                            <span>@ $</span>
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              value={orderCostOverrides[entry.item.itemId] !== undefined ? orderCostOverrides[entry.item.itemId] : entry.caseCost}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val >= 0) {
                                  setOrderCostOverrides((prev) => ({ ...prev, [entry.item.itemId]: val }));
                                }
                              }}
                              title="Edit agreed supplier cost per case"
                              className="w-16 py-0.5 px-1 bg-white border border-slate-300 rounded text-right font-mono font-bold text-slate-800 text-[10px] focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                            />
                            <span>/cs</span>
                          </div>
                        </div>
                        {entry.isFundedInBudget ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                            Funded
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200">
                            Exceeds
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick suggestion button if altered */}
                    {entry.suggestedOrderCases !== entry.customOrderCases && (
                      <div className="mt-2 flex items-center justify-between bg-indigo-50/60 p-2 rounded-xl text-xs">
                        <span className="text-indigo-900 font-medium text-[11px]">
                          System suggestion is {entry.suggestedOrderCases} cases.
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateCases(entry.item.itemId, entry.suggestedOrderCases)}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          Apply {entry.suggestedOrderCases} cs
                        </button>
                      </div>
                    )}

                    {/* Supplier linkage & Multi-vendor switch button */}
                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-bold text-slate-800">{entry.supplierName}</span>
                      </span>
                      {entry.allSuppliers && entry.allSuppliers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setSupplierSwitchTarget(entry)}
                          className="text-indigo-600 font-bold hover:underline flex items-center gap-1 text-[11px]"
                        >
                          <Sparkles className="w-3 h-3 text-indigo-500" />
                          <span>{entry.allSuppliers.length} Vendors</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* ========================================================================= */
          /* COMPACT TABLE VIEW WITH STICKY PRODUCT NAME COLUMN (For Horizontal Audit) */
          /* ========================================================================= */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-800 select-none">
                    <th className="py-3.5 px-3 w-10 text-center sticky left-0 bg-slate-900 z-20">
                      <input
                        type="checkbox"
                        checked={
                          displayedList.length > 0 &&
                          displayedList.every((e) => selectedItemIds.has(e.item.itemId))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const next = new Set(selectedItemIds);
                            displayedList.forEach((it) => next.add(it.item.itemId));
                            setSelectedItemIds(next);
                          } else {
                            const next = new Set(selectedItemIds);
                            displayedList.forEach((it) => next.delete(it.item.itemId));
                            setSelectedItemIds(next);
                          }
                        }}
                        className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </th>
                    <th className="py-3.5 px-4 min-w-[240px] sticky left-10 bg-slate-900 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.2)]">
                      Product Description / Name (SKU / Code)
                    </th>
                    <th className="py-3.5 px-2 text-center min-w-[90px]">Priority</th>
                    <th className="py-3.5 px-3 text-right min-w-[100px]">Stock On Hand</th>
                    <th className="py-3.5 px-3 text-right min-w-[100px]">Daily Velocity</th>
                    <th className="py-3.5 px-3 text-right min-w-[90px]">Cover Days</th>
                    <th className="py-3.5 px-2 text-center min-w-[80px]">Lead Time</th>
                    <th className="py-3.5 px-2 text-right min-w-[90px]">Gross Margin</th>
                    <th className="py-3.5 px-3 text-center min-w-[160px]">Suggested Reorder</th>
                    <th className="py-3.5 px-3 text-right min-w-[100px]">Est. Spend</th>
                    <th className="py-3.5 px-2 text-center min-w-[90px]">Budget Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {displayedList.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                          <span className="font-bold text-sm text-slate-800">
                            No items match the selected filter or search!
                          </span>
                          <p className="text-xs text-slate-500 max-w-sm">
                            Try searching for another product name, changing the supplier tab, or clearing the filter.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    displayedList.map((entry) => {
                      const isSelected = selectedItemIds.has(entry.item.itemId);

                      let rowBg = 'hover:bg-slate-50/80';
                      if (entry.priorityTier === 'CRITICAL') {
                        rowBg = isSelected ? 'bg-rose-50/60 hover:bg-rose-50' : 'bg-rose-50/20 hover:bg-rose-50/40';
                      } else if (entry.priorityTier === 'URGENT') {
                        rowBg = isSelected ? 'bg-amber-50/60 hover:bg-amber-50' : 'bg-amber-50/20 hover:bg-amber-50/40';
                      }

                      return (
                        <tr
                          key={entry.item.itemId}
                          className={`transition-colors border-b border-slate-100 ${rowBg}`}
                        >
                          {/* Checkbox (Sticky Left) */}
                          <td className="py-3 px-3 text-center sticky left-0 bg-white z-10">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleItemSelection(entry.item.itemId)}
                              className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </td>

                          {/* PROMINENT PRODUCT NAME & IDENTIFICATION (Sticky Left) */}
                          <td className="py-3 px-4 sticky left-10 bg-white z-10 shadow-[2px_0_5px_rgba(0,0,0,0.06)] min-w-[240px]">
                            <div className="text-sm font-black text-slate-900 leading-snug tracking-tight">
                              {getItemName(entry.item)}
                            </div>
                            {entry.item.description && entry.item.description !== getItemName(entry.item) && (
                              <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                                {entry.item.description}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[10px]">
                              {/* SKU Code */}
                              <span className="font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                                SKU / Code: {getItemCode(entry.item)}
                              </span>
                              {/* Barcode */}
                              {entry.item.barcode && (
                                <span className="font-mono text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                  {entry.item.barcode}
                                </span>
                              )}
                              {/* Category */}
                              {entry.item.category && (
                                <span className="bg-indigo-50 text-indigo-700 font-bold px-1.5 py-0.5 rounded">
                                  {entry.item.category}
                                </span>
                              )}
                              {/* Pack size */}
                              <span className="bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded">
                                {entry.unitsPerCase} / case
                              </span>
                              {entry.isFastMover && (
                                <span className="bg-amber-100 text-amber-900 border border-amber-300 font-black px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <span>⚡ Fast Mover</span>
                                </span>
                              )}
                              {entry.isSlowMover && (
                                <span className="bg-slate-100 text-slate-500 border border-slate-200 font-semibold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <span>🐢 Slow Mover</span>
                                </span>
                              )}
                            </div>
                            {/* Supplier & Multi-vendor linkage */}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap text-[10px]">
                              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded flex items-center gap-1 font-medium border border-slate-200">
                                <Truck className="w-2.5 h-2.5 text-slate-500" />
                                <span className="font-bold">{entry.supplierName}</span>
                                {entry.allSuppliers && entry.allSuppliers.length > 1 && (
                                  <span className="text-[9px] text-amber-700 font-bold bg-amber-50 px-1 rounded">(Primary)</span>
                                )}
                              </span>
                              {entry.allSuppliers && entry.allSuppliers.length > 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSupplierSwitchTarget(entry);
                                  }}
                                  className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer transition border border-indigo-200/60"
                                  title="Compare vendors, review pricing & lead times, or switch supplier for this item"
                                >
                                  <Sparkles className="w-2.5 h-2.5 text-indigo-500" />
                                  <span>{entry.allSuppliers.length} Vendors</span>
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Priority Tier Badge */}
                          <td className="py-3 px-2 text-center">
                            {entry.priorityTier === 'CRITICAL' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                                Critical
                              </span>
                            ) : entry.priorityTier === 'URGENT' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Urgent
                              </span>
                            ) : entry.priorityTier === 'PLAN' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-800 border border-blue-200">
                                Plan
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600">
                                Healthy
                              </span>
                            )}
                            <div className="text-[10px] text-slate-500 mt-0.5 max-w-[140px] mx-auto truncate" title={entry.urgencyReason}>
                              {entry.urgencyReason}
                            </div>
                          </td>

                          {/* Stock On Hand */}
                          <td className="py-3 px-3 text-right font-mono">
                            <div className={`font-black text-xs ${entry.currentStockUnits === 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                              {entry.currentStockUnits === 0 ? '0 UNITS' : `${entry.currentStockUnits} units`}
                            </div>
                            {entry.unitsPerCase > 1 && (
                              <div className="text-[10px] text-slate-500">
                                {entry.currentStockCases.toFixed(1)} cs
                              </div>
                            )}
                          </td>

                          {/* Daily Velocity Rate */}
                          <td className="py-3 px-3 text-right font-mono">
                            <div className="font-bold text-slate-900 flex items-center justify-end gap-1">
                              {entry.velocityTrend === 'RISING' && (
                                <span title="Sales velocity surging (+35%)">
                                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                                </span>
                              )}
                              {entry.velocityTrend === 'DECLINING' && (
                                <span title="Sales velocity slowing">
                                  <TrendingDown className="w-3.5 h-3.5 text-slate-400" />
                                </span>
                              )}
                              <span>{entry.avgDailySales.toFixed(1)}/day</span>
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {entry.isNewProductOverride ? (
                                <span className="text-amber-700 font-bold">7d override (New)</span>
                              ) : entry.isAnalogRateUsed ? (
                                <span className="text-indigo-600 font-bold">Category analog</span>
                              ) : (
                                <span>{entry.sales30d} sold (30d)</span>
                              )}
                            </div>
                          </td>

                          {/* Days of Cover */}
                          <td className="py-3 px-3 text-right font-mono">
                            <div
                              className={`font-black text-sm ${
                                entry.projectedStockoutDays <= entry.leadTimeDays
                                  ? 'text-rose-600'
                                  : entry.projectedStockoutDays <= 3
                                  ? 'text-amber-600'
                                  : 'text-slate-900'
                              }`}
                            >
                              {entry.projectedStockoutDays >= 999
                                ? '999+ d'
                                : `${entry.projectedStockoutDays.toFixed(1)} d`}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {entry.projectedStockoutDays === 0
                                ? 'Out of stock'
                                : `Out in ~${Math.ceil(entry.projectedStockoutDays)}d`}
                            </div>
                          </td>

                          {/* Lead Time */}
                          <td className="py-3 px-2 text-center font-mono">
                            <div className="font-bold text-slate-800">
                              {entry.leadTimeDays}d
                            </div>
                            {entry.isLeadTimeBreached && (
                              <span className="text-[9px] font-black text-rose-600 bg-rose-100 px-1 py-0.2 rounded">
                                LAG BREACH
                              </span>
                            )}
                          </td>

                          {/* Gross Margin % */}
                          <td className="py-3 px-2 text-right font-mono">
                            <span
                              className={`font-black ${
                                entry.grossMarginPercent >= 30
                                  ? 'text-emerald-700'
                                  : entry.grossMarginPercent >= 15
                                  ? 'text-slate-800'
                                  : 'text-slate-500'
                              }`}
                            >
                              {entry.grossMarginPercent.toFixed(1)}%
                            </span>
                            <div className="text-[10px] text-slate-500">
                              Cost ${entry.unitCost.toFixed(2)}
                            </div>
                          </td>

                          {/* Suggested Reorder Cases Input with Stepper */}
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdateCases(entry.item.itemId, Math.max(0, entry.customOrderCases - 1))}
                                className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer"
                                aria-label="Decrease cases"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input
                                type="number"
                                min={0}
                                value={entry.customOrderCases}
                                onChange={(e) => handleUpdateCases(entry.item.itemId, Number(e.target.value) || 0)}
                                className="w-14 py-1 px-1 bg-white border border-slate-300 rounded-lg text-center font-mono font-black text-slate-900 text-xs focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                              />
                              <button
                                type="button"
                                onClick={() => handleUpdateCases(entry.item.itemId, entry.customOrderCases + 1)}
                                className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer"
                                aria-label="Increase cases"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {entry.customOrderUnits} units
                            </div>
                            {entry.suggestedOrderCases !== entry.customOrderCases && (
                              <div className="text-[10px] text-indigo-600 mt-0.5">
                                Sug: {entry.suggestedOrderCases} cs
                              </div>
                            )}
                          </td>

                          {/* Est. Cost with Inline Supplier Cost Editing */}
                          <td className="py-3 px-3 text-right font-mono">
                            <div className="font-black text-slate-900">
                              ${entry.customTotalCost.toFixed(2)}
                            </div>
                            <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px]">
                              <span className="text-slate-500">@ $</span>
                              <input
                                type="number"
                                step="0.01"
                                min={0}
                                value={orderCostOverrides[entry.item.itemId] !== undefined ? orderCostOverrides[entry.item.itemId] : entry.caseCost}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val >= 0) {
                                    setOrderCostOverrides((prev) => ({ ...prev, [entry.item.itemId]: val }));
                                  }
                                }}
                                title="Edit agreed supplier cost per case"
                                className="w-16 py-0.5 px-1 bg-white border border-slate-300 rounded text-right font-mono font-bold text-slate-800 text-[10px] focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                              />
                              <span className="text-slate-500">/cs</span>
                            </div>
                          </td>

                          {/* Budget Status Badge */}
                          <td className="py-3 px-2 text-center">
                            {entry.priorityTier === 'HEALTHY' ? (
                              <span className="text-[10px] text-slate-400 font-bold">—</span>
                            ) : entry.isFundedInBudget ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                                ✓ Funded
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200">
                                Exceeds Cap
                              </span>
                            )}
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
      </div>

      {/* FLOATING BOTTOM DISPATCH BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-300 shadow-2xl py-3 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Left summary */}
          <div className="flex items-center flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                <ShoppingBag className="w-4 h-4" />
              </span>
              <div>
                <div className="font-extrabold text-slate-900">
                  {selectedSummary.itemsCount} SKUs Selected
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedSummary.totalCases} Cases ({selectedSummary.totalUnits} Units)
                </div>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-200 hidden sm:block" />

            <div>
              <div className="font-black text-slate-900 font-mono text-sm">
                Total PO Value: ${selectedSummary.totalCost.toFixed(2)}
              </div>
              <div className="text-[11px] text-emerald-700 font-medium">
                Est. Retail Revenue: ${selectedSummary.totalEstimatedRevenue.toFixed(2)} ({selectedSummary.estimatedMargin.toFixed(1)}% margin)
              </div>
            </div>
          </div>

          {/* Right action buttons */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => handleOpenPoModal({ blank: true })}
              className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white border border-indigo-500/40 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              title="Create an ad-hoc purchase order independent of days-cover suggestions"
            >
              <Plus className="w-4 h-4 text-indigo-400" />
              <span>+ Blank PO</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenPoModal()}
              disabled={selectedSummary.itemsCount === 0}
              className="flex-1 sm:flex-initial px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/25 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Generate Commercial PO</span>
            </button>
            <button
              type="button"
              onClick={handleSendToDirectGrv}
              disabled={selectedSummary.itemsCount === 0}
              className="flex-1 sm:flex-initial px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              <Truck className="w-4 h-4" />
              <span>Receive in Direct GRV</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* BEST-IN-CLASS COMMERCIAL PURCHASE ORDER MODAL */}
      {/* ========================================================================= */}
      {isPoModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-0 sm:p-5 overflow-y-auto">
          <div className="bg-white rounded-none sm:rounded-3xl max-w-4xl w-full shadow-2xl border-0 sm:border sm:border-slate-300 overflow-hidden my-0 sm:my-6 flex flex-col h-full sm:h-auto sm:max-h-[92vh]">
            {/* Modal Header Bar */}
            <div className="bg-slate-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="p-2 bg-indigo-500/20 border border-indigo-400/30 rounded-xl text-indigo-400">
                  <FileSpreadsheet className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="font-black text-sm sm:text-base flex items-center gap-2">
                    Commercial Purchase Order Slip
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-400/30">
                      OFFICIAL VOUCHER
                    </span>
                    {lastPoDraftSavedAt && (
                      <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Auto-Saved ({lastPoDraftSavedAt})
                      </span>
                    )}
                  </h3>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Ref: {generatedPoNumber} &bull; Date: {todayStr}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyWhatsAppOrder}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {copyFeedback ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copyFeedback ? 'Copied!' : 'WhatsApp Text'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPoModalOpen(false)}
                  className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Printable PO Document Content */}
            <div className="p-5 sm:p-8 space-y-6 overflow-y-auto text-slate-900" id="printable-purchase-order">
              {/* TOP LETTERHEAD: Buyer Company & Vendor Profile */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-slate-200 pb-5">
                {/* 1. BUYER (Company & Branch Profile) */}
                <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5" />
                    Buyer / Retailer Organization
                  </div>
                  <div className="text-base font-black text-slate-900 leading-tight">
                    {company?.company_name || 'Retail Enterprise'}
                  </div>
                  <div className="text-xs font-bold text-slate-700">
                    Store Branch: {branch?.name || 'Main Branch'}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400" />
                    {branch?.address || branch?.location || 'Store Commercial Bay, Harare'}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono pt-1">
                    Tax / TIN: {company?.company_id || 'COMP-001'} &bull; Phone: {company?.phone || '+263 77 000 0000'}
                  </div>
                </div>

                {/* 2. VENDOR SELECTION & PROFILE */}
                <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700 flex items-center gap-1">
                      <Truck className="w-3.5 h-3.5" />
                      Delivering Supplier / Vendor
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPoSupplierDropdownOpen(false);
                        setIsSupplierRegModalOpen(true);
                      }}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg cursor-pointer transition shadow-xs"
                      title="Register a new vendor and automatically select it for this purchase order"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Add New Supplier</span>
                    </button>
                  </div>

                  {/* Searchable Supplier Combobox Selector */}
                  <div className="relative">
                    <div
                      onClick={() => setIsPoSupplierDropdownOpen(!isPoSupplierDropdownOpen)}
                      className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 cursor-pointer flex items-center justify-between shadow-xs hover:border-indigo-500 transition"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="truncate">
                          {activePoSupplier ? activePoSupplier.name : 'Choose a vendor...'}
                        </span>
                        {activePoSupplier?.category && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-normal shrink-0">
                            {activePoSupplier.category}
                          </span>
                        )}
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${
                          isPoSupplierDropdownOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </div>

                    {/* Search & Filter Dropdown Popover */}
                    {isPoSupplierDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-30"
                          onClick={() => setIsPoSupplierDropdownOpen(false)}
                        />
                        <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white rounded-2xl shadow-2xl border border-slate-200 p-2 space-y-2 max-h-72 flex flex-col animate-in fade-in zoom-in-95 duration-150">
                          {/* Search Input Field */}
                          <div className="relative shrink-0">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                            <input
                              type="text"
                              autoFocus
                              value={poSupplierSearchQuery}
                              onChange={(e) => setPoSupplierSearchQuery(e.target.value)}
                              placeholder="Search supplier name, rep, phone, city..."
                              className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:bg-white focus:border-indigo-600"
                            />
                            {poSupplierSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setPoSupplierSearchQuery('')}
                                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {/* Filtered Supplier List */}
                          <div className="overflow-y-auto divide-y divide-slate-100 flex-1 max-h-48">
                            {filteredPoSuppliers.length === 0 ? (
                              <div className="py-4 px-2 text-center text-xs text-slate-500 space-y-2">
                                <p>No supplier matches &quot;{poSupplierSearchQuery}&quot;</p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsPoSupplierDropdownOpen(false);
                                    setIsSupplierRegModalOpen(true);
                                  }}
                                  className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1 mx-auto"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Add &quot;{poSupplierSearchQuery}&quot; as New Supplier</span>
                                </button>
                              </div>
                            ) : (
                              filteredPoSuppliers.map((s, idx) => {
                                const isSelected = (s.supplierId || s.id) === poTargetSupplierId;
                                return (
                                  <div
                                    key={`${s.supplierId || s.id || 'po-sup'}-${idx}`}
                                    onClick={() => {
                                      const newSupId = s.supplierId || s.id;
                                      setPoTargetSupplierId(newSupId);
                                      if (s.paymentTerms) setPoPaymentTerms(s.paymentTerms);
                                      const leadDays = s.leadTimeDays || defaultLeadTimeDays;
                                      const expDate = new Date(todayTime + leadDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                                      setPoDeliveryDate(expDate);
                                      setIsPoSupplierDropdownOpen(false);
                                      setPoSupplierSearchQuery('');
                                    }}
                                    className={`p-2 rounded-xl cursor-pointer text-xs flex items-center justify-between transition ${
                                      isSelected
                                        ? 'bg-indigo-50 text-indigo-950 font-bold'
                                        : 'hover:bg-slate-50 text-slate-800'
                                    }`}
                                  >
                                    <div>
                                      <div className="font-bold flex items-center gap-1.5">
                                        <span>{s.name}</span>
                                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                                      </div>
                                      <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                                        <span>{s.contactPerson || 'Sales Rep'}</span>
                                        {s.phone && <span>&bull; {s.phone}</span>}
                                        {s.city && <span>&bull; {s.city}</span>}
                                      </div>
                                    </div>
                                    <div className="text-right text-[10px] text-slate-400 shrink-0">
                                      <div>{s.paymentTerms || '30-Day Credit'}</div>
                                      <div className="font-mono text-[9px] text-slate-400">{s.supplierId}</div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          {/* Action Button inside Dropdown */}
                          <div className="pt-1.5 border-t border-slate-100 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setIsPoSupplierDropdownOpen(false);
                                setIsSupplierRegModalOpen(true);
                              }}
                              className="w-full py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Register New Supplier Profile</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Vendor Details */}
                  {activePoSupplier && (
                    <div className="text-xs space-y-0.5 text-slate-600 pt-1">
                      <div className="font-bold text-slate-900">
                        Contact: {activePoSupplier.contactPerson || 'Sales Desk'}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        {activePoSupplier.phone && <span>Phone: {activePoSupplier.phone}</span>}
                        {activePoSupplier.email && <span>Email: {activePoSupplier.email}</span>}
                      </div>
                      {activePoSupplier.address && (
                        <div className="text-[11px] text-slate-500">
                          Address: {activePoSupplier.address}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* COMMERCIAL TERMS STRIP */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-indigo-50/50 p-3.5 rounded-2xl border border-indigo-100 text-xs">
                {/* 1. Payment Terms */}
                <div>
                  <label className="text-[10px] font-black uppercase text-indigo-950 flex items-center gap-1 mb-1">
                    <CreditCard className="w-3 h-3 text-indigo-700" />
                    Payment Terms
                  </label>
                  <select
                    value={poPaymentTerms}
                    onChange={(e) => setPoPaymentTerms(e.target.value)}
                    className="w-full py-1.5 px-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none"
                  >
                    <option value="Immediate Cash on Delivery (COD)">Immediate Cash on Delivery (COD)</option>
                    <option value="7-Day Account">7-Day Account</option>
                    <option value="14-Day Account">14-Day Account</option>
                    <option value="30-Day Account Credit">30-Day Account Credit</option>
                    <option value="60-Day Account Credit">60-Day Account Credit</option>
                    <option value="Prepaid / Advance Payment">Prepaid / Advance Payment</option>
                  </select>
                </div>

                {/* 2. Target Delivery Date */}
                <div>
                  <label className="text-[10px] font-black uppercase text-indigo-950 flex items-center gap-1 mb-1">
                    <Calendar className="w-3 h-3 text-indigo-700" />
                    Target Delivery Date
                  </label>
                  <input
                    type="date"
                    value={poDeliveryDate}
                    onChange={(e) => setPoDeliveryDate(e.target.value)}
                    className="w-full py-1 px-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-slate-900 font-mono focus:outline-none"
                  />
                </div>

                {/* 3. Delivery Bay / Address */}
                <div>
                  <label className="text-[10px] font-black uppercase text-indigo-950 flex items-center gap-1 mb-1">
                    <MapPin className="w-3 h-3 text-indigo-700" />
                    Receiving Bay
                  </label>
                  <input
                    type="text"
                    value={poDeliveryBay}
                    onChange={(e) => setPoDeliveryBay(e.target.value)}
                    placeholder="e.g. Loading Dock 1"
                    className="w-full py-1.5 px-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none"
                  />
                </div>

                {/* 4. Purchasing Officer */}
                <div>
                  <label className="text-[10px] font-black uppercase text-indigo-950 flex items-center gap-1 mb-1">
                    <UserCheck className="w-3 h-3 text-indigo-700" />
                    Authorized Officer
                  </label>
                  <input
                    type="text"
                    value={poPurchasingOfficer}
                    onChange={(e) => setPoPurchasingOfficer(e.target.value)}
                    className="w-full py-1.5 px-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* INLINE QUICK ADD ITEM TO PO */}
              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={adHocSearchQuery}
                      onChange={(e) => {
                        setAdHocSearchQuery(e.target.value);
                        setIsAdHocDropdownOpen(true);
                      }}
                      onFocus={() => setIsAdHocDropdownOpen(true)}
                      placeholder="+ Search & Add any product to this PO..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:bg-white focus:border-indigo-600"
                    />
                  </div>
                </div>

                {/* Dropdown for Ad-Hoc Items */}
                {isAdHocDropdownOpen && adHocSearchQuery.trim() && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setIsAdHocDropdownOpen(false)}
                    />
                    <div className="absolute left-0 right-0 top-10 z-20 bg-white rounded-2xl shadow-xl border border-slate-200 max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {inventoryItems
                        .filter((it) => {
                          const q = adHocSearchQuery.toLowerCase();
                          const itName = getItemName(it).toLowerCase();
                          const itCode = getItemCode(it).toLowerCase();
                          return (
                            itName.includes(q) ||
                            itCode.includes(q) ||
                            (it.barcode && it.barcode.toLowerCase().includes(q))
                          );
                        })
                        .slice(0, 8)
                        .map((item) => (
                          <div
                            key={item.itemId}
                            onClick={() => handleAddAdHocItemToPo(item)}
                            className="p-2.5 hover:bg-indigo-50 cursor-pointer flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-bold text-slate-900">{getItemName(item)}</div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                SKU: {getItemCode(item)} &bull; {item.unitsPerCase || 1}/case &bull; Last Cost: $
                                {((item.costPerUnit !== undefined ? item.costPerUnit : (item as any).costPrice) || 0).toFixed(2)}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="px-2 py-1 bg-indigo-600 text-white rounded-lg text-[10px] font-bold"
                            >
                              + Add
                            </button>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>

              {/* SUPPLIER PRICE ADJUSTMENT BANNER */}
              {poCustomLines.some((l) => l.isCostModified) && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-amber-900 font-medium">
                    <TrendingUp className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      <strong>Supplier Price Adjustments:</strong> {poCustomLines.filter((l) => l.isCostModified).length} item(s) have updated supplier prices differing from current catalog master costs.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSyncAllCostsToCatalog}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition"
                    title="Save these new supplier prices permanently to the product catalog master"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>Sync New Prices to Master Catalog</span>
                  </button>
                </div>
              )}

              {/* ITEM TABLE IN PO SLIP */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-8 text-center">#</th>
                      <th className="py-2.5 px-3">Product Description / Name (SKU)</th>
                      <th className="py-2.5 px-2 text-center">Order Cases</th>
                      <th className="py-2.5 px-2 text-center">Units / Cs</th>
                      <th className="py-2.5 px-2 text-right">Total Units</th>
                      <th className="py-2.5 px-3 text-right min-w-[160px]">
                        <div className="flex items-center justify-end gap-1">
                          <span>Supplier Cost</span>
                          <Edit3 className="w-3 h-3 text-indigo-600 print:hidden" />
                        </div>
                      </th>
                      <th className="py-2.5 px-3 text-right">Line Total</th>
                      <th className="py-2.5 px-2 w-8 text-center print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {poCustomLines.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400 font-medium">
                          No items in this purchase order. Add items using the search bar above.
                        </td>
                      </tr>
                    ) : (
                      poCustomLines.map((line, idx) => (
                        <tr key={line.itemId} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-black text-slate-900 text-xs sm:text-sm">{line.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                              Product Code: <span className="font-bold text-slate-700">{line.code}</span> {line.barcode && `| Barcode: ${line.barcode}`}
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdatePoLineCases(line.itemId, Math.max(1, line.orderCases - 1))}
                                className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer print:hidden"
                                aria-label="Decrease cases"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={line.orderCases}
                                onChange={(e) => handleUpdatePoLineCases(line.itemId, Number(e.target.value) || 0)}
                                className="w-14 py-1 px-1 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-indigo-600 print:border-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleUpdatePoLineCases(line.itemId, line.orderCases + 1)}
                                className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer print:hidden"
                                aria-label="Increase cases"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono text-slate-600">
                            {line.unitsPerCase}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-800">
                            {line.totalUnits}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            {/* On Screen: Interactive Editable Supplier Cost & Variance Diff */}
                            <div className="print:hidden space-y-1">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-[10px] text-slate-500 font-sans font-semibold">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  value={line.caseCost}
                                  onChange={(e) => handleUpdatePoLineCost(line.itemId, parseFloat(e.target.value) || 0, 'case')}
                                  title="Edit agreed supplier cost per case"
                                  className="w-20 py-1 px-1.5 bg-white border border-slate-300 hover:border-indigo-400 focus:border-indigo-600 rounded-lg text-right font-mono font-bold text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 transition shadow-2xs"
                                />
                                <span className="text-[10px] text-slate-500 font-sans font-medium">/cs</span>
                              </div>

                              {/* Unit cost breakdown & companion edit */}
                              <div className="flex items-center justify-end gap-1 text-[10px]">
                                <span className="text-slate-500 font-sans">Unit: $</span>
                                <input
                                  type="number"
                                  step="0.001"
                                  min={0}
                                  value={line.unitCost}
                                  onChange={(e) => handleUpdatePoLineCost(line.itemId, parseFloat(e.target.value) || 0, 'unit')}
                                  title="Edit agreed supplier cost per unit"
                                  className="w-16 py-0.5 px-1 bg-slate-50 hover:bg-white border border-slate-200 focus:border-indigo-500 rounded text-right font-mono text-[10px] text-slate-700 focus:outline-none"
                                />
                                <span className="text-slate-400 font-sans">/ea</span>
                              </div>

                              {/* Price Variance Badge & Sync Option */}
                              {(() => {
                                const orig = line.originalCaseCost !== undefined ? line.originalCaseCost : line.caseCost;
                                const diff = line.caseCost - orig;
                                const pct = orig > 0 ? (diff / orig) * 100 : 0;
                                if (Math.abs(diff) < 0.005) return null;

                                const isIncrease = diff > 0;
                                return (
                                  <div className="flex items-center justify-end gap-1 pt-0.5">
                                    <span
                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        isIncrease
                                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      }`}
                                      title={`Catalog master cost: $${orig.toFixed(2)}/cs`}
                                    >
                                      {isIncrease ? '▲ +' : '▼ -'}${Math.abs(diff).toFixed(2)} ({pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`})
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleSyncLineCostToCatalog(line)}
                                      className="text-[9px] text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
                                      title="Update permanent catalog master cost"
                                    >
                                      Save
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>

                            {/* On Print: Clean Typography */}
                            <div className="hidden print:block font-mono text-slate-900 font-medium">
                              ${line.caseCost.toFixed(2)}/cs
                              <div className="text-[9px] text-slate-500 font-sans font-normal">
                                (${line.unitCost.toFixed(2)}/ea)
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                            ${line.lineTotal.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-2 text-center print:hidden">
                            <button
                              type="button"
                              onClick={() => handleRemovePoLine(line.itemId)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                              title="Remove item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* FINANCIAL TOTALS, TAX, FREIGHT & AUTHORIZATION BLOCK */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-2">
                {/* Left: Notes & Receiving Terms */}
                <div className="md:col-span-7 space-y-4 text-xs">
                  <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <div className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                      Commercial Receiving Terms &amp; Conditions
                    </div>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      1. Deliveries must quote PO Reference <strong>{generatedPoNumber}</strong> on all packing slips and supplier invoices.<br />
                      2. Perishable goods must meet minimum shelf life requirements upon physical bay receipt.<br />
                      3. Discrepancies or over-deliveries will be quarantined at the loading bay pending supervisor sign-off.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                        Prepared &amp; Approved By
                      </div>
                      <div className="font-bold text-slate-900 text-xs mt-0.5">{poPurchasingOfficer}</div>
                      <div className="text-[10px] text-slate-400 font-mono">Date: {todayStr}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                        Authorized Signature
                      </div>
                      <div className="border-b border-slate-400 w-36 mt-4" />
                    </div>
                  </div>
                </div>

                {/* Right: Comprehensive Financial Totals */}
                <div className="md:col-span-5 bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2.5 text-xs font-mono">
                  {/* Subtotal */}
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Subtotal ({poTotals.totalCases} cs / {poTotals.totalUnits} u):</span>
                    <span className="font-bold text-slate-900">${poTotals.subtotal.toFixed(2)}</span>
                  </div>

                  {/* Tax / VAT Selector */}
                  <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200">
                    <div className="flex items-center gap-1.5 font-sans">
                      <span>Tax / VAT:</span>
                      <select
                        value={poTaxRatePercent}
                        onChange={(e) => setPoTaxRatePercent(Number(e.target.value))}
                        className="py-0.5 px-1 bg-white border border-slate-300 rounded text-[11px] font-bold text-slate-800"
                      >
                        <option value={15}>15% (Standard)</option>
                        <option value={0}>0% (Zero-Rated / Exempt)</option>
                        <option value={5}>5%</option>
                      </select>
                    </div>
                    <span className="font-bold text-slate-900">+${poTotals.taxAmount.toFixed(2)}</span>
                  </div>

                  {/* Freight / Delivery Charge */}
                  <div className="flex items-center justify-between text-slate-600 pt-1 border-t border-slate-200">
                    <div className="flex items-center gap-1.5 font-sans">
                      <span>Delivery / Freight:</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>$</span>
                      <input
                        type="number"
                        min={0}
                        step={5}
                        value={poFreightFee}
                        onChange={(e) => setPoFreightFee(e.target.value)}
                        className="w-16 py-0.5 px-1 bg-white border border-slate-300 rounded text-right text-xs font-bold font-mono text-slate-900"
                      />
                    </div>
                  </div>

                  {/* Grand Total Payable */}
                  <div className="flex items-center justify-between pt-2.5 border-t-2 border-slate-300">
                    <span className="font-sans font-black text-sm text-slate-900 uppercase">Grand Total:</span>
                    <span className="font-black text-lg text-indigo-700">
                      ${poTotals.grandTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer Buttons */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyWhatsAppOrder}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                >
                  {copyFeedback ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copyFeedback ? 'Copied to Clipboard!' : 'Copy WhatsApp Order'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPoCsv}
                  className="px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download CSV</span>
                </button>
              </div>

              <div className="flex items-center gap-2.5">
                {poCustomLines.length > 0 && (
                  <button
                    type="button"
                    onClick={handleDiscardPoDraft}
                    className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition cursor-pointer"
                    title="Clear all line items and discard the auto-saved purchase order draft"
                  >
                    Discard Draft
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsPoModalOpen(false)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleSendToDirectGrv}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20 cursor-pointer"
                >
                  <Truck className="w-4 h-4" />
                  <span>Dispatch to Direct GRV</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. MULTI-SUPPLIER MANAGEMENT & VENDOR SWITCHER MODAL */}
      {supplierSwitchTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                  Multi-Supplier Management
                </span>
                <h3 className="text-base font-black text-slate-900 mt-1.5">
                  {getItemName(supplierSwitchTarget.item)}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  SKU: {getItemCode(supplierSwitchTarget.item)} &bull; Current: {supplierSwitchTarget.supplierName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSupplierSwitchTarget(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-blue-50/70 border border-blue-200/60 rounded-xl text-xs text-blue-900 leading-relaxed">
              <strong>How Multi-Vendor Sourcing Works:</strong> Products can be sourced from multiple registered vendors. Select an alternative supplier below to re-route this replenishment cycle (e.g. for rapid 1-day delivery when stock is critical), or set a new permanent default vendor.
            </div>

            {/* List of Approved Vendors for this item */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {supplierSwitchTarget.allSuppliers && supplierSwitchTarget.allSuppliers.length > 0 ? (
                supplierSwitchTarget.allSuppliers.map((sup, idx) => {
                  const isCurrentActive = sup.id === supplierSwitchTarget.supplierId;
                  return (
                    <div
                      key={`${sup.id || 'sup'}-${idx}`}
                      className={`p-3 rounded-2xl border transition-all flex items-center justify-between ${
                        isCurrentActive
                          ? 'bg-indigo-50/70 border-indigo-300 ring-1 ring-indigo-200 shadow-xs'
                          : 'bg-white hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-xs text-slate-900">{sup.name}</span>
                          {sup.isPrimary && (
                            <span className="text-[9px] font-black uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">
                              Default Primary
                            </span>
                          )}
                          {isCurrentActive && (
                            <span className="text-[9px] font-black uppercase tracking-wide bg-indigo-600 text-white px-1.5 py-0.5 rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3">
                          <span>
                            Lead Time: <strong className="text-slate-800">{sup.leadTimeDays} days</strong>
                          </span>
                          <span>
                            Terms: <strong className="text-slate-800">{sup.paymentTerms || '30-Day Credit'}</strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isCurrentActive && (
                          <button
                            type="button"
                            onClick={() => handleSwitchItemSupplier(supplierSwitchTarget.item.itemId, sup.id, false)}
                            className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer shadow-xs transition"
                          >
                            Use for PO
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSwitchItemSupplier(supplierSwitchTarget.item.itemId, sup.id, true)}
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl cursor-pointer shadow-xs transition"
                          title="Set as permanent preferred supplier in the inventory database"
                        >
                          Set Default
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-4 text-center text-xs text-slate-500">
                  No suppliers linked yet. Register a new vendor to link it to this item.
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setSupplierSwitchTarget(null);
                  setIsSupplierRegModalOpen(true);
                }}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Register New Vendor</span>
              </button>
              <button
                type="button"
                onClick={() => setSupplierSwitchTarget(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. SUPPLIER REGISTRATION MODAL */}
      <SupplierRegistrationModal
        isOpen={isSupplierRegModalOpen}
        onClose={() => setIsSupplierRegModalOpen(false)}
        onSupplierCreated={(newSupplier) => {
          const fresh = getSuppliers();
          setSuppliers(fresh);
          const sId = newSupplier.supplierId || (newSupplier as any).id;
          setPoTargetSupplierId(sId);
          if (newSupplier.paymentTerms) setPoPaymentTerms(newSupplier.paymentTerms);
          const leadDays = newSupplier.leadTimeDays || defaultLeadTimeDays;
          const expDate = new Date(todayTime + leadDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          setPoDeliveryDate(expDate);
          setIsSupplierRegModalOpen(false);
          setToastNotification(`Vendor "${newSupplier.name}" registered & selected for Purchase Order!`);
        }}
        initialName={poSupplierSearchQuery.trim()}
      />

      {/* 4. CRISP TOAST NOTIFICATION */}
      {toastNotification && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 text-xs font-bold flex items-center gap-2.5 animate-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastNotification}</span>
        </div>
      )}
    </div>
  );
};
