import React, { useState, useEffect, useRef } from 'react';
import {
  Boxes,
  Package,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Calendar,
  DollarSign,
  Search,
  Sparkles,
  ChevronDown,
  Layers,
  Printer,
  Truck,
  Building2,
  User,
  ArrowRight,
  ExternalLink,
  Info,
  Clock,
  Check,
  X,
  RotateCcw,
  Percent,
  TrendingUp,
  Tag,
  Home,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import {
  InventoryItem,
  PackagingVariant,
  GoodsReceivedEntry,
  SupplierInvoiceVoucher,
  SupplierInvoiceLineItem,
  Supplier,
  Branch,
  Salesperson,
} from '../../types';
import {
  getInventoryItems,
  getGoodsReceived,
  getSupplierInvoiceVouchers,
  getSuppliers,
  getBranches,
  receiveSupplierInvoice,
  saveInventoryItem,
  createPackagingVariant,
  recalculateItemPackagingRatio,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';
import { SupplierRegistrationModal } from '../suppliers/SupplierRegistrationModal';
import { PackagingRatioModal } from './PackagingRatioModal';
import { ProductAddEditModal } from './ProductAddEditModal';
import { DailyGoodsReceivedReport } from './DailyGoodsReceivedReport';

interface GoodsReceivedViewProps {
  currentUser: Salesperson | null;
  preselectedItemId?: string;
  preselectedSupplierName?: string;
  onGoToMaster: () => void;
  onGoToHome?: () => void;
}

// Row in the interactive Excel-based Goods Received Voucher
interface ExcelVoucherRow {
  id: string; // Unique row ID
  itemId: string; // e.g. "MAZ001" or empty if new row
  itemName: string;
  receiveAs: 'Cases' | 'Singles' | 'Variant'; // Exclusive choice: Cases, Singles, or Prepack Variant
  selectedVariantId?: string;
  selectedVariantName?: string;
  unitsPerPack?: number;
  qtyPerCaseDefault: number; // units per case
  originalUnitsPerCase?: number; // Catalog ratio for comparison
  quantityCases: number;
  quantitySingles: number;
  quantityPacks?: number;
  lastCost: number; // historical cost per case
  pricePerCase: number; // current invoice cost per case/pack/unit
  sellingPrice: number; // single unit selling price
  canSellAsCase: boolean;
  category: string;
  packagingVariants?: PackagingVariant[];
  expiryDate?: string;
  batchNumber?: string;
}

export const GoodsReceivedView: React.FC<GoodsReceivedViewProps> = ({
  currentUser,
  preselectedItemId,
  preselectedSupplierName,
  onGoToMaster,
  onGoToHome,
}) => {
  const [items, setItems] = useState<InventoryItem[]>(() => getInventoryItems());
  const [invoicesList, setInvoicesList] = useState<SupplierInvoiceVoucher[]>(() => getSupplierInvoiceVouchers());
  const [grnLogList, setGrnLogList] = useState<GoodsReceivedEntry[]>(() => getGoodsReceived());
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => getSuppliers());
  const [branches, setBranches] = useState<Branch[]>(() => getBranches());

  const [activeTab, setActiveTab] = useState<'create_invoice' | 'invoice_history' | 'daily_report' | 'audit_log'>('create_invoice');

  // Supplier Invoice Header State
  const [selectedBranchId, setSelectedBranchId] = useState<string>('BR001');
  const [supplierName, setSupplierName] = useState<string>(
    preselectedSupplierName || ''
  );
  const [isSupplierDropdownOpen, setIsSupplierDropdownOpen] = useState<boolean>(false);
  const [supplierFilterTerm, setSupplierFilterTerm] = useState<string>('');
  const [isRegisterSupplierModalOpen, setIsRegisterSupplierModalOpen] = useState<boolean>(false);

  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState<string>(
    () => `INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`
  );
  const [purchaseOrderNo, setPurchaseOrderNo] = useState<string>(
    () => `PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`
  );
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [paymentTerms, setPaymentTerms] = useState<string>('30-Day Account Credit');
  const [invoiceNotes, setInvoiceNotes] = useState<string>('');

  // Interactive Excel Spreadsheet Rows - Starts completely blank for a new receiving voucher
  const [rows, setRows] = useState<ExcelVoucherRow[]>(() => []);

  // Active search row state for item combobox
  const [activeSearchRowId, setActiveSearchRowId] = useState<string | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');

  // Add New Product to Inventory Master Modal State (Uses shared ProductAddEditModal)
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [targetRowForNewProduct, setTargetRowForNewProduct] = useState<string | null>(null);

  // Packaging Ratio Changed Modal State
  const [packagingModalData, setPackagingModalData] = useState<{
    isOpen: boolean;
    rowId: string;
    item: InventoryItem | null;
    currentUnitsPerCase: number;
    newUnitsPerCase: number;
  }>({
    isOpen: false,
    rowId: '',
    item: null,
    currentUnitsPerCase: 12,
    newUnitsPerCase: 12,
  });

  // Search & Filter History
  const [searchInvoiceQuery, setSearchInvoiceQuery] = useState('');
  const [searchLogQuery, setSearchLogQuery] = useState('');

  // Voucher Preview Modal
  const [viewingVoucher, setViewingVoucher] = useState<SupplierInvoiceVoucher | null>(null);

  // Notification Toast
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    text: string;
    ruleACount?: number;
  } | null>(null);

  const showToast = (type: 'success' | 'error', text: string, ruleACount?: number) => {
    setNotification({ type, text, ruleACount });
    setTimeout(() => setNotification(null), 6000);
  };

  const refreshData = () => {
    setItems(getInventoryItems());
    setInvoicesList(getSupplierInvoiceVouchers());
    setGrnLogList(getGoodsReceived());
    setSuppliers(getSuppliers());
    setBranches(getBranches());
  };

  useEffect(() => {
    const unsub = subscribeRoomDatabase(refreshData);
    return unsub;
  }, []);

  // Update supplier if passed via prop
  useEffect(() => {
    if (preselectedSupplierName) {
      setSupplierName(preselectedSupplierName);
    }
  }, [preselectedSupplierName]);

  // If preselectedItemId changes from props, prepend or select it
  useEffect(() => {
    if (preselectedItemId) {
      const matched = items.find((i) => i.itemId === preselectedItemId);
      if (matched) {
        setRows((prev) => {
          const exists = prev.some((r) => r.itemId === matched.itemId);
          if (exists) return prev;
          return [
            {
              id: `row-${Date.now()}`,
              itemId: matched.itemId,
              itemName: matched.itemName,
              receiveAs: 'Cases',
              qtyPerCaseDefault: matched.unitsPerCase || 12,
              originalUnitsPerCase: matched.unitsPerCase || 12,
              quantityCases: 1,
              quantitySingles: 0,
              lastCost: matched.costPerCase || 0,
              pricePerCase: matched.costPerCase || 0,
              sellingPrice: matched.sellPriceUnit || 0,
              canSellAsCase: Boolean(matched.canSellAsCase),
              category: matched.category || 'General',
            },
            ...prev,
          ];
        });
      }
    }
  }, [preselectedItemId, items]);

  // Row update handlers
  const updateRow = (rowId: string, updates: Partial<ExcelVoucherRow>) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id === rowId) {
          return { ...row, ...updates };
        }
        return row;
      })
    );
  };

  const handleRatioChangeAttempt = (rowId: string, newRatio: number) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row || !row.itemId) {
      updateRow(rowId, { qtyPerCaseDefault: newRatio });
      return;
    }

    const currentItem = items.find((i) => i.itemId === row.itemId);
    const originalRatio = row.originalUnitsPerCase || currentItem?.unitsPerCase || 12;

    if (currentItem && newRatio !== originalRatio && newRatio > 0) {
      // Trigger decision modal
      setPackagingModalData({
        isOpen: true,
        rowId,
        item: currentItem,
        currentUnitsPerCase: originalRatio,
        newUnitsPerCase: newRatio,
      });
    } else {
      updateRow(rowId, { qtyPerCaseDefault: newRatio });
    }
  };

  const selectProductForRow = (rowId: string, item: InventoryItem) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id === rowId) {
          const variants = item.packagingVariants || [];
          return {
            ...row,
            itemId: item.itemId,
            itemName: item.itemName,
            qtyPerCaseDefault: item.unitsPerCase || 1,
            originalUnitsPerCase: item.unitsPerCase || 1,
            lastCost: item.costPerCase || 0,
            pricePerCase: item.costPerCase || 0,
            sellingPrice: item.sellPriceUnit || 0,
            canSellAsCase: Boolean(item.canSellAsCase),
            category: item.category || 'General',
            packagingVariants: variants,
            selectedVariantId: variants.length > 0 ? variants[0].id : undefined,
            selectedVariantName: variants.length > 0 ? variants[0].name : undefined,
            unitsPerPack: variants.length > 0 ? variants[0].unitsPerPack : undefined,
          };
        }
        return row;
      })
    );
    setActiveSearchRowId(null);
    setProductSearchTerm('');
  };

  const addNewRow = () => {
    const newId = `row-${Date.now()}`;
    setRows((prev) => [
      ...prev,
      {
        id: newId,
        itemId: '',
        itemName: '',
        receiveAs: 'Cases',
        qtyPerCaseDefault: 12,
        originalUnitsPerCase: 12,
        quantityCases: 1,
        quantitySingles: 0,
        quantityPacks: 0,
        lastCost: 0,
        pricePerCase: 0,
        sellingPrice: 0,
        canSellAsCase: true,
        category: 'General',
        packagingVariants: [],
      },
    ]);
    setActiveSearchRowId(newId);
    setProductSearchTerm('');
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Open "Add New Product to Inventory Master" modal (uses shared ProductAddEditModal)
  const openNewProductModal = (rowId?: string, initialName = '') => {
    setTargetRowForNewProduct(rowId || null);
    setProductSearchTerm(initialName || '');
    setIsNewProductModalOpen(true);
  };

  // Called when ProductAddEditModal successfully saves a product
  const handleProductSaved = (savedItem: InventoryItem) => {
    refreshData();

    // Populate row in voucher
    if (targetRowForNewProduct) {
      setRows((prev) =>
        prev.map((r) => {
          if (r.id === targetRowForNewProduct) {
            const variants = savedItem.packagingVariants || [];
            return {
              ...r,
              itemId: savedItem.itemId,
              itemName: savedItem.itemName,
              receiveAs: 'Cases',
              qtyPerCaseDefault: savedItem.unitsPerCase,
              originalUnitsPerCase: savedItem.unitsPerCase,
              quantityCases: 1,
              quantitySingles: 0,
              quantityPacks: 0,
              lastCost: savedItem.costPerCase,
              pricePerCase: savedItem.costPerCase,
              sellingPrice: savedItem.sellPriceUnit,
              canSellAsCase: Boolean(savedItem.canSellAsCase),
              category: savedItem.category,
              packagingVariants: variants,
              selectedVariantId: variants.length > 0 ? variants[0].id : undefined,
              selectedVariantName: variants.length > 0 ? variants[0].name : undefined,
              unitsPerPack: variants.length > 0 ? variants[0].unitsPerPack : undefined,
            };
          }
          return r;
        })
      );
    } else {
      const variants = savedItem.packagingVariants || [];
      setRows((prev) => [
        ...prev,
        {
          id: `row-${Date.now()}`,
          itemId: savedItem.itemId,
          itemName: savedItem.itemName,
          receiveAs: 'Cases',
          qtyPerCaseDefault: savedItem.unitsPerCase,
          originalUnitsPerCase: savedItem.unitsPerCase,
          quantityCases: 1,
          quantitySingles: 0,
          quantityPacks: 0,
          lastCost: savedItem.costPerCase,
          pricePerCase: savedItem.costPerCase,
          sellingPrice: savedItem.sellPriceUnit,
          canSellAsCase: Boolean(savedItem.canSellAsCase),
          category: savedItem.category,
          packagingVariants: variants,
          selectedVariantId: variants.length > 0 ? variants[0].id : undefined,
          selectedVariantName: variants.length > 0 ? variants[0].name : undefined,
          unitsPerPack: variants.length > 0 ? variants[0].unitsPerPack : undefined,
        },
      ]);
    }

    setIsNewProductModalOpen(false);
    setActiveSearchRowId(null);
    setProductSearchTerm('');
    showToast('success', `Saved product "${savedItem.itemName}" (${savedItem.itemId}) to Inventory Master!`);
  };

  // Calculations for each row
  const getRowCalculations = (row: ExcelVoucherRow) => {
    const qtyCases = Math.max(0, Number(row.quantityCases) || 0);
    const qtySingles = Math.max(0, Number(row.quantitySingles) || 0);
    const qtyPacks = Math.max(0, Number(row.quantityPacks) || 0);
    const pricePerCase = Math.max(0, Number(row.pricePerCase) || 0);
    const qtyPerCase = Math.max(1, Number(row.qtyPerCaseDefault) || 1);
    const unitsPerPack = Math.max(1, Number(row.unitsPerPack) || 1);

    let unitCost = 0;
    let effectiveCaseCost = 0;
    let lineTotal = 0;

    if (row.receiveAs === 'Singles') {
      unitCost = pricePerCase;
      effectiveCaseCost = pricePerCase * qtyPerCase;
      lineTotal = unitCost * qtySingles;
    } else if (row.receiveAs === 'Variant') {
      unitCost = pricePerCase / unitsPerPack;
      effectiveCaseCost = unitCost * qtyPerCase;
      lineTotal = pricePerCase * qtyPacks;
    } else {
      // Cases
      unitCost = pricePerCase / qtyPerCase;
      effectiveCaseCost = pricePerCase;
      lineTotal = pricePerCase * qtyCases;
    }

    const sellingPrice = Math.max(0, Number(row.sellingPrice) || 0);
    const marginPercent =
      sellingPrice > 0 ? ((sellingPrice - unitCost) / sellingPrice) * 100 : 0;
    const marginDollar = sellingPrice - unitCost;

    // Check Rule A for this item
    const matchedItem = items.find((i) => i.itemId === row.itemId);
    const currentSingles = matchedItem ? matchedItem.stockSingles : 0;
    const willTriggerRuleA =
      row.receiveAs === 'Cases' &&
      qtyCases > 0 &&
      currentSingles === 0 &&
      row.canSellAsCase;
    const willConvertNoCaseSale =
      row.receiveAs === 'Cases' && qtyCases > 0 && !row.canSellAsCase;

    return {
      qtyCases,
      qtySingles,
      qtyPacks,
      pricePerCase,
      effectiveCaseCost,
      qtyPerCase,
      unitsPerPack,
      unitCost,
      lineTotal,
      sellingPrice,
      marginPercent,
      marginDollar,
      willTriggerRuleA,
      willConvertNoCaseSale,
    };
  };

  // Grand totals across all rows
  const voucherGrandTotal = rows.reduce((acc, row) => {
    const calc = getRowCalculations(row);
    return acc + calc.lineTotal;
  }, 0);

  const voucherTotalCases = rows.reduce((acc, row) => {
    return row.receiveAs === 'Cases' ? acc + (Number(row.quantityCases) || 0) : acc;
  }, 0);

  const voucherTotalSingles = rows.reduce((acc, row) => {
    return row.receiveAs === 'Singles' ? acc + (Number(row.quantitySingles) || 0) : acc;
  }, 0);

  const voucherTotalPacks = rows.reduce((acc, row) => {
    return row.receiveAs === 'Variant' ? acc + (Number(row.quantityPacks) || 0) : acc;
  }, 0);

  const voucherTotalUnits = rows.reduce((acc, row) => {
    const qtyCases = row.receiveAs === 'Cases' ? Number(row.quantityCases) || 0 : 0;
    const qtySingles = row.receiveAs === 'Singles' ? Number(row.quantitySingles) || 0 : 0;
    const qtyPacks = row.receiveAs === 'Variant' ? Number(row.quantityPacks) || 0 : 0;
    const ratio = Number(row.qtyPerCaseDefault) || 1;
    const packUnits = Number(row.unitsPerPack) || 1;
    return acc + qtyCases * ratio + qtySingles + qtyPacks * packUnits;
  }, 0);

  // Submit and Post Supplier Invoice
  const handlePostGoodsReceivedVoucher = () => {
    if (!supplierInvoiceNo.trim()) {
      showToast('error', 'Supplier Invoice Number is required.');
      return;
    }
    if (!supplierName.trim()) {
      showToast('error', 'Supplier Name is required.');
      return;
    }

    const selectedBranch = branches.find((b) => b.branchId === selectedBranchId);

    // Filter valid rows with quantity > 0
    const validItemsToReceive = rows
      .filter(
        (r) =>
          r.itemId &&
          ((r.receiveAs === 'Cases' && r.quantityCases > 0) ||
            (r.receiveAs === 'Singles' && r.quantitySingles > 0) ||
            (r.receiveAs === 'Variant' && (r.quantityPacks || 0) > 0))
      )
      .map((r) => {
        const calc = getRowCalculations(r);
        return {
          itemId: r.itemId,
          receiveAs: r.receiveAs,
          receiveVariantId: r.selectedVariantId,
          receiveVariantName: r.selectedVariantName,
          unitsPerReceivePack: r.unitsPerPack || 1,
          receivedPacks: r.receiveAs === 'Variant' ? r.quantityPacks || 0 : 0,
          costPerPack: r.receiveAs === 'Variant' ? r.pricePerCase : undefined,
          receivedCases: r.receiveAs === 'Cases' ? r.quantityCases : 0,
          receivedSingles: r.receiveAs === 'Singles' ? r.quantitySingles : 0,
          lastCost: r.lastCost,
          costPerCase: calc.effectiveCaseCost,
          costPerUnit: calc.unitCost,
          sellingPrice: r.sellingPrice,
          marginPercent: calc.marginPercent,
          expiryDate: r.expiryDate || undefined,
          batchNumber: r.batchNumber || undefined,
        };
      });

    if (rows.length === 0) {
      showToast('error', 'No products added to the voucher. Please click "+ Add Product Row" to add items to receive.');
      return;
    }

    if (validItemsToReceive.length === 0) {
      showToast('error', 'Please enter a received quantity (cases, singles, or prepacks) greater than 0 for your line items.');
      return;
    }

    const result = receiveSupplierInvoice({
      invoiceNo: supplierInvoiceNo,
      purchaseOrderNo,
      branchId: selectedBranchId,
      branchName: selectedBranch ? selectedBranch.name : 'Main Central Distribution & Warehouse',
      supplier: supplierName,
      date: invoiceDate,
      paymentTerms,
      staffId: currentUser?.id || '001',
      staffName: currentUser?.name || 'Administrator',
      notes: invoiceNotes,
      items: validItemsToReceive,
    });

    if (result.success && result.voucher) {
      refreshData();
      setViewingVoucher(result.voucher);
      showToast(
        'success',
        `Successfully posted Goods Received Voucher ${result.voucher.invoiceNo} (${result.itemsProcessed} products, $${result.voucher.totalInvoiceAmount.toFixed(2)})!`,
        result.ruleATriggeredCount
      );

      // Generate new invoice number and reset voucher completely to blank
      setSupplierInvoiceNo(`INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`);
      setPurchaseOrderNo(`PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
      setInvoiceNotes('');
      setSupplierName('');
      setRows([]); // New voucher is blank!
    } else {
      showToast('error', result.message || 'Failed to post voucher.');
    }
  };

  // Reset form to receive a brand new invoice (completely blank)
  const handleStartNewInvoice = () => {
    setViewingVoucher(null);
    setActiveTab('create_invoice');
    setSupplierName('');
    setSupplierInvoiceNo(`INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`);
    setPurchaseOrderNo(`PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
    setInvoiceNotes('');
    setRows([]); // Blank, ready for new products!
  };

  // Filtered suppliers for combobox
  const sTerm = (supplierFilterTerm || '').trim().toLowerCase();
  const filteredSuppliers = suppliers.filter(
    (s) =>
      !sTerm ||
      (s.name && s.name.toLowerCase().includes(sTerm)) ||
      (s.category && s.category.toLowerCase().includes(sTerm)) ||
      (s.supplierId && s.supplierId.toLowerCase().includes(sTerm))
  );

  // Filtered lists for history
  const invTerm = (searchInvoiceQuery || '').trim().toLowerCase();
  const filteredInvoices = invoicesList.filter(
    (inv) =>
      !invTerm ||
      (inv.invoiceNo && inv.invoiceNo.toLowerCase().includes(invTerm)) ||
      (inv.supplier && inv.supplier.toLowerCase().includes(invTerm)) ||
      (inv.purchaseOrderNo && inv.purchaseOrderNo.toLowerCase().includes(invTerm)) ||
      (inv.voucherId && inv.voucherId.toLowerCase().includes(invTerm))
  );

  const logTerm = (searchLogQuery || '').trim().toLowerCase();
  const filteredLogs = grnLogList.filter(
    (log) =>
      !logTerm ||
      (log.itemName && log.itemName.toLowerCase().includes(logTerm)) ||
      (log.supplier && log.supplier.toLowerCase().includes(logTerm)) ||
      (log.invoiceNo && log.invoiceNo.toLowerCase().includes(logTerm)) ||
      (log.purchaseOrderNo && log.purchaseOrderNo.toLowerCase().includes(logTerm)) ||
      (log.grnId && log.grnId.toLowerCase().includes(logTerm))
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-16">
      {/* Toast Notification */}
      {notification && (
        <div
          id="grn-toast-notification"
          className={`fixed bottom-6 right-6 z-50 flex items-start gap-3 p-4 rounded-xl shadow-2xl border backdrop-blur-md transition-all max-w-md ${
            notification.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100'
              : 'bg-rose-950/90 border-rose-500/50 text-rose-100'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" />
          )}
          <div className="flex-1 text-sm">
            <p className="font-semibold">{notification.text}</p>
            {notification.ruleACount !== undefined && notification.ruleACount > 0 && (
              <p className="text-xs text-amber-300 mt-1 flex items-center gap-1 font-medium bg-amber-950/60 p-1.5 rounded border border-amber-500/30">
                <Sparkles className="w-3.5 h-3.5" />
                Rule A triggered on {notification.ruleACount} product(s) (1 case auto-broken into loose singles on shelf).
              </p>
            )}
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-slate-200 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Banner & Tab Navigation */}
      <div className="bg-slate-800/80 border-b border-slate-700/70 sticky top-0 z-30 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3.5 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-bold">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-white tracking-tight">
                    Goods Received Voucher
                  </h1>
                  <span className="text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    Supplier Invoice Based
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  WPS Excel-style multi-product receiving with packaging ratio conversions & daily admin reports
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-700/60 overflow-x-auto">
              <button
                id="btn-tab-create-voucher"
                onClick={() => setActiveTab('create_invoice')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'create_invoice'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Voucher Grid
              </button>
              <button
                id="btn-tab-invoice-history"
                onClick={() => setActiveTab('invoice_history')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'invoice_history'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Boxes className="w-3.5 h-3.5" />
                Vouchers History ({invoicesList.length})
              </button>
              <button
                id="btn-tab-daily-report"
                onClick={() => setActiveTab('daily_report')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'daily_report'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-teal-300" />
                Daily Admin Report
              </button>
              <button
                id="btn-tab-audit-log"
                onClick={() => setActiveTab('audit_log')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap ${
                  activeTab === 'audit_log'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Item Logs ({grnLogList.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* ========================================================================= */}
        {/* TAB 1: SPREADSHEET VOUCHER ENTRY (MATCHING WPS OFFICE TEMPLATE) */}
        {/* ========================================================================= */}
        {activeTab === 'create_invoice' && (
          <div className="space-y-6">
            {/* Header Form Card */}
            <div className="bg-slate-850 border border-slate-700/80 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-700/70 gap-4">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Truck className="w-4 h-4 text-emerald-400" />
                    Supplier Delivery & Invoice Details
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Capture supplier invoice reference, receiving branch, and line items
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStartNewInvoice}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 transition-all flex items-center gap-1.5"
                    title="Clear current invoice and start a fresh blank voucher"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                    New / Clear Invoice
                  </button>
                  <button
                    onClick={() => openNewProductModal()}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600/20 text-teal-300 border border-teal-500/30 hover:bg-teal-600/30 transition-all flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    + New Product to Master
                  </button>
                  <button
                    onClick={onGoToMaster}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-750 text-slate-300 border border-slate-600 hover:bg-slate-700 transition-all flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Inventory Master
                  </button>
                </div>
              </div>

              {/* Header Inputs Grid matching Excel Template */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* 1. Receiving Branch */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
                    <span>Receiving Branch *</span>
                  </label>
                  <div className="relative">
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-medium"
                    >
                      {branches.map((b, bIdx) => (
                        <option key={`${b.branchId || bIdx}-${bIdx}`} value={b.branchId}>
                          {b.name} ({b.city})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2. Supplier invoice # */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
                    <span>Supplier invoice: *</span>
                    <span className="text-[10px] text-slate-500 font-mono">Invoice #</span>
                  </label>
                  <input
                    id="input-supplier-invoice-no"
                    type="text"
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                    placeholder="e.g. INV-2026-99024"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* 3. Purchase Order Number */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
                    <span>Purchase Order Number</span>
                    <span className="text-[10px] text-slate-500">Internal PO</span>
                  </label>
                  <input
                    id="input-po-number"
                    type="text"
                    value={purchaseOrderNo}
                    onChange={(e) => setPurchaseOrderNo(e.target.value)}
                    placeholder="e.g. PO-2026-004"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* 4. Searchable Supplier Selector */}
                <div className="relative">
                  <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
                    <span>Supplier Name *</span>
                    <button
                      type="button"
                      onClick={() => setIsRegisterSupplierModalOpen(true)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold"
                    >
                      + New
                    </button>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsSupplierDropdownOpen(!isSupplierDropdownOpen)}
                    className="w-full bg-slate-900 border border-slate-700 hover:border-emerald-500 rounded-xl px-3 py-2 text-xs text-white flex items-center justify-between truncate text-left"
                  >
                    <span className="truncate font-semibold">{supplierName || 'Select Supplier...'}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                  </button>

                  {/* Searchable Supplier Popover */}
                  {isSupplierDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                      <div className="p-2 border-b border-slate-800 flex items-center gap-1.5 bg-slate-850">
                        <Search className="w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="text"
                          autoFocus
                          value={supplierFilterTerm}
                          onChange={(e) => setSupplierFilterTerm(e.target.value)}
                          placeholder="Search registered suppliers..."
                          className="w-full bg-transparent text-xs text-white focus:outline-none placeholder-slate-500"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto divide-y divide-slate-800">
                        {filteredSuppliers.map((s) => (
                          <button
                            key={s.supplierId}
                            type="button"
                            onClick={() => {
                              setSupplierName(s.name);
                              setIsSupplierDropdownOpen(false);
                            }}
                            className={`w-full text-left p-2 hover:bg-slate-800 transition-colors text-xs ${
                              s.name === supplierName ? 'bg-emerald-950/40 text-emerald-300 font-bold' : 'text-slate-200'
                            }`}
                          >
                            <span className="block font-semibold">{s.name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {s.supplierId} • {s.category}
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setIsSupplierDropdownOpen(false);
                            setIsRegisterSupplierModalOpen(true);
                          }}
                          className="w-full text-left p-2.5 bg-blue-950/40 hover:bg-blue-900/50 text-blue-300 text-xs font-semibold flex items-center gap-2"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          + Register New Supplier Vendor
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 5. Delivery Date & Officer */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Delivery Date & Receiving Officer
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      id="input-delivery-date"
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                    <div className="bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-[11px] text-slate-300 flex items-center gap-1 truncate">
                      <User className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">{currentUser?.name || 'Administrator'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Excel Spreadsheet Grid */}
            <div className="bg-slate-850 border border-slate-700/80 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 bg-slate-800 border-b border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Voucher Line Items (Excel Grid)
                  </h3>
                  <span className="text-xs text-slate-400">
                    ({rows.length} product{rows.length === 1 ? '' : 's'} on voucher)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    id="btn-add-excel-row"
                    onClick={addNewRow}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    + Add Product Row
                  </button>
                  <button
                    onClick={() => openNewProductModal()}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600/30 text-teal-200 border border-teal-500/40 hover:bg-teal-600/40 transition-all flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-teal-300" />
                    + New Master Product
                  </button>
                </div>
              </div>

              {/* Table conforming to WPS Office Excel Template with Exclusive "Receive as" */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-slate-300 font-semibold border-b border-slate-700 divide-x divide-slate-700/50">
                      <th className="py-3 px-3 min-w-[220px]">Product *</th>
                      <th className="py-3 px-2 min-w-[110px] text-center">Batch #</th>
                      <th className="py-3 px-2 min-w-[125px] text-center">Expiry Date</th>
                      <th className="py-3 px-3 min-w-[160px] text-center bg-slate-850">
                        Receive as: Default <br />
                        <span className="text-[10px] font-normal text-slate-400">(Cases / Singles / Prepack)</span>
                      </th>
                      <th className="py-3 px-2 min-w-[100px] text-center">
                        qty per case default <br />
                        <span className="text-[10px] font-normal text-slate-400">(units/case)</span>
                      </th>
                      <th className="py-3 px-2 min-w-[125px] text-center">
                        Quantity Inward <br />
                        <span className="text-[10px] font-normal text-slate-400">(Cases / Singles / Prepacks)</span>
                      </th>
                      <th className="py-3 px-2 min-w-[85px] text-right">last cost</th>
                      <th className="py-3 px-2 min-w-[120px] text-right">
                        Price / Case or Unit <br />
                        <span className="text-[10px] font-normal text-slate-400">(Case / Unit / Pack)</span>
                      </th>
                      <th className="py-3 px-3 min-w-[105px] text-right bg-slate-900 font-extrabold text-emerald-400">
                        Line Total ($)
                      </th>
                      <th className="py-3 px-2 min-w-[80px] text-right text-slate-300">unit cost</th>
                      <th className="py-3 px-2 min-w-[90px] text-right">Selling price</th>
                      <th className="py-3 px-2 min-w-[80px] text-center">Margin</th>
                      <th className="py-3 px-2 w-[48px] text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-14 text-center text-slate-400">
                          <div className="max-w-md mx-auto space-y-3 px-4">
                            <div className="w-12 h-12 rounded-2xl bg-slate-800 text-emerald-400 mx-auto flex items-center justify-center border border-slate-700 shadow-inner">
                              <Package className="w-6 h-6" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-white">Voucher Line Items are Blank</p>
                              <p className="text-xs text-slate-400 mt-1">
                                Ready to receive new stock. Click below to add products from inventory or create a new master item.
                              </p>
                            </div>
                            <div className="flex items-center justify-center gap-3 pt-2">
                              <button
                                type="button"
                                onClick={addNewRow}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-950/40 flex items-center gap-1.5"
                              >
                                <Plus className="w-4 h-4" />
                                + Add Product Row
                              </button>
                              <button
                                type="button"
                                onClick={() => openNewProductModal()}
                                className="px-4 py-2 text-xs font-semibold rounded-xl bg-teal-600/20 text-teal-300 border border-teal-500/30 hover:bg-teal-600/30 transition-all flex items-center gap-1.5"
                              >
                                <Sparkles className="w-4 h-4 text-teal-400" />
                                + New Master Product
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, index) => {
                        const calc = getRowCalculations(row);
                        const isSearchOpen = activeSearchRowId === row.id;

                        // Filter products for dropdown
                        const pTerm = (productSearchTerm || '').trim().toLowerCase();
                        const filteredAvailableProducts = items.filter(
                          (i) =>
                            !pTerm ||
                            (i.itemName && i.itemName.toLowerCase().includes(pTerm)) ||
                            (i.itemId && i.itemId.toLowerCase().includes(pTerm)) ||
                            (i.sku && i.sku.toLowerCase().includes(pTerm)) ||
                            (i.category && i.category.toLowerCase().includes(pTerm))
                        );

                        return (
                          <tr
                            key={row.id}
                            className={`hover:bg-slate-750 transition-colors divide-x divide-slate-700/30 ${
                              index % 2 === 0 ? 'bg-slate-800/40' : 'bg-slate-800/80'
                            }`}
                          >
                            {/* 1. Product (Searchable / Dropdown / Add new) */}
                            <td className="py-2.5 px-3 relative">
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isSearchOpen) {
                                      setActiveSearchRowId(null);
                                    } else {
                                      setActiveSearchRowId(row.id);
                                      setProductSearchTerm('');
                                    }
                                  }}
                                  className="w-full flex items-center justify-between gap-1.5 text-left bg-slate-900 border border-slate-700 hover:border-emerald-500/70 rounded-lg px-2.5 py-1.5 text-xs text-white"
                                >
                                  <div className="truncate">
                                    <span className="font-semibold text-slate-100">
                                      {row.itemName || 'Select Product...'}
                                    </span>
                                    {row.itemId && (
                                      <span className="text-[10px] text-slate-400 ml-1.5 font-mono">
                                        ({row.itemId})
                                      </span>
                                    )}
                                  </div>
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                </button>

                                {/* Rule A / Conversion Warning Tag */}
                                {calc.willTriggerRuleA && (
                                  <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-300 font-medium bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30">
                                    <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                                    <span>Rule A: 1 Case will auto-break into {calc.qtyPerCase} singles</span>
                                  </div>
                                )}
                                {calc.willConvertNoCaseSale && (
                                  <div className="mt-1 flex items-center gap-1 text-[10px] text-sky-300 font-medium bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-500/30">
                                    <Info className="w-3 h-3 text-sky-400 shrink-0" />
                                    <span>No Case Sale: Converted all to singles</span>
                                  </div>
                                )}

                                {/* Searchable Product Popover */}
                                {isSearchOpen && (
                                  <div className="absolute left-0 top-full mt-1 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                                    <div className="p-2 border-b border-slate-800 flex items-center gap-1.5 bg-slate-850">
                                      <Search className="w-3.5 h-3.5 text-slate-400" />
                                      <input
                                        type="text"
                                        autoFocus
                                        value={productSearchTerm}
                                        onChange={(e) => setProductSearchTerm(e.target.value)}
                                        placeholder="Search product, SKU or ID..."
                                        className="w-full bg-transparent text-xs text-white focus:outline-none placeholder-slate-500"
                                      />
                                      {productSearchTerm && (
                                        <button
                                          onClick={() => setProductSearchTerm('')}
                                          className="text-slate-400 hover:text-slate-200 text-xs"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>

                                    {/* Product List */}
                                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-800">
                                      {filteredAvailableProducts.map((p) => (
                                        <button
                                          key={p.itemId}
                                          type="button"
                                          onClick={() => selectProductForRow(row.id, p)}
                                          className={`w-full text-left p-2.5 hover:bg-slate-800 transition-colors flex items-center justify-between ${
                                            p.itemId === row.itemId ? 'bg-emerald-950/30' : ''
                                          }`}
                                        >
                                          <div className="min-w-0 pr-2">
                                            <p className="text-xs font-semibold text-slate-200 truncate">
                                              {p.itemName}
                                            </p>
                                            <p className="text-[10px] text-slate-400 flex items-center gap-2">
                                              <span>{p.category}</span>
                                              <span>•</span>
                                              <span className="font-mono">{p.itemId}</span>
                                              <span>•</span>
                                              <span>1 cs = {p.unitsPerCase} un</span>
                                            </p>
                                          </div>
                                          <div className="text-right shrink-0">
                                            <p className="text-xs font-bold text-emerald-400">
                                              ${(p.costPerCase || 0).toFixed(2)}/cs
                                            </p>
                                            <p className="text-[10px] text-slate-400">
                                              ${(p.sellPriceUnit || 0).toFixed(2)}/ea
                                            </p>
                                          </div>
                                        </button>
                                      ))}

                                      {/* Option to create new product */}
                                      <button
                                        type="button"
                                        onClick={() => openNewProductModal(row.id, productSearchTerm)}
                                        className="w-full text-left p-2.5 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 transition-colors flex items-center gap-2 font-medium"
                                      >
                                        <Plus className="w-4 h-4 text-emerald-400" />
                                        <span>
                                          + Add {productSearchTerm ? `"${productSearchTerm}"` : 'New Product'} to Master
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Batch # Input */}
                            <td className="py-2.5 px-2 text-center">
                              <input
                                type="text"
                                value={row.batchNumber || ''}
                                onChange={(e) => updateRow(row.id, { batchNumber: e.target.value })}
                                placeholder="Auto (BAT-...)"
                                className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                              />
                            </td>

                            {/* Expiry Date Input */}
                            <td className="py-2.5 px-2 text-center">
                              <input
                                type="date"
                                value={row.expiryDate || ''}
                                onChange={(e) => updateRow(row.id, { expiryDate: e.target.value })}
                                className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center text-xs text-emerald-300 font-mono focus:outline-none focus:border-emerald-500"
                              />
                            </td>

                            {/* 2. Receive as: Exclusive Choice (Cases vs Singles vs Prepack/Variant) */}
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex flex-col items-center gap-1.5">
                                <div className="inline-flex p-1 rounded-xl bg-slate-900 border border-slate-700/80 gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (row.receiveAs !== 'Cases') {
                                        const ratio = Math.max(1, row.qtyPerCaseDefault || 1);
                                        const currentUnitCost = calc.unitCost;
                                        const converted = Number((currentUnitCost * ratio).toFixed(2));
                                        updateRow(row.id, {
                                          receiveAs: 'Cases',
                                          pricePerCase: converted || row.pricePerCase,
                                        });
                                      }
                                    }}
                                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                      row.receiveAs === 'Cases'
                                        ? 'bg-blue-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    <span>Cases</span>
                                    {row.receiveAs === 'Cases' && <span className="text-[9px] font-normal opacity-80">(Def)</span>}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (row.receiveAs !== 'Singles') {
                                        const currentUnitCost = calc.unitCost;
                                        updateRow(row.id, {
                                          receiveAs: 'Singles',
                                          pricePerCase: Number(currentUnitCost.toFixed(2)) || row.pricePerCase,
                                        });
                                      }
                                    }}
                                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                      row.receiveAs === 'Singles'
                                        ? 'bg-amber-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    <span>Singles</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const variants = row.packagingVariants || [];
                                      const defaultVariant = variants[0];
                                      const packUnits = defaultVariant ? defaultVariant.unitsPerPack : 5;
                                      const currentUnitCost = calc.unitCost;
                                      const packPrice = Number((currentUnitCost * packUnits).toFixed(2));
                                      updateRow(row.id, {
                                        receiveAs: 'Variant',
                                        selectedVariantId: defaultVariant ? defaultVariant.variantId : 'custom-variant',
                                        selectedVariantName: defaultVariant ? defaultVariant.variantName : `Pack of ${packUnits}`,
                                        unitsPerPack: packUnits,
                                        pricePerCase: packPrice || defaultVariant?.costPrice || row.pricePerCase,
                                        quantityPacks: row.quantityPacks || 1,
                                      });
                                    }}
                                    className={`px-2 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                                      row.receiveAs === 'Variant'
                                        ? 'bg-purple-600 text-white shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                                    title="Receive as Prepack or Packaging Variant (e.g. 5s, 10s, 20s)"
                                  >
                                    <Package className="w-3 h-3 shrink-0" />
                                    <span>Prepack</span>
                                  </button>
                                </div>

                                {/* Variant Selector Dropdown if ReceiveAs === Variant */}
                                {row.receiveAs === 'Variant' && (
                                  <div className="w-full max-w-[190px]">
                                    {row.packagingVariants && row.packagingVariants.length > 0 ? (
                                      <select
                                        value={row.selectedVariantId || ''}
                                        onChange={(e) => {
                                          const v = row.packagingVariants?.find((item) => item.id === e.target.value);
                                          if (v) {
                                            const currentUnitCost = calc.unitCost;
                                            const packPrice = v.costPrice || Number((currentUnitCost * v.unitsPerPack).toFixed(2));
                                            updateRow(row.id, {
                                              selectedVariantId: v.id,
                                              selectedVariantName: v.name,
                                              unitsPerPack: v.unitsPerPack,
                                              pricePerCase: packPrice,
                                            });
                                          }
                                        }}
                                        className="w-full bg-slate-900 border border-purple-500/50 rounded-lg px-2 py-1 text-[11px] text-purple-200 focus:outline-none focus:border-purple-400"
                                      >
                                        {row.packagingVariants.map((v) => (
                                          <option key={v.id} value={v.id}>
                                            {v.name} ({v.unitsPerPack} un)
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="number"
                                          min={1}
                                          value={row.unitsPerPack || 5}
                                          onChange={(e) => {
                                            const units = Math.max(1, parseInt(e.target.value, 10) || 1);
                                            updateRow(row.id, {
                                              unitsPerPack: units,
                                              selectedVariantName: `Pack of ${units}`,
                                            });
                                          }}
                                          placeholder="Units/pk"
                                          className="w-16 bg-slate-900 border border-purple-500/50 rounded-lg px-1.5 py-0.5 text-center text-[11px] text-purple-200"
                                        />
                                        <span className="text-[10px] text-purple-300 font-mono">un/pack</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* 3. qty per case default (packaging ratio) */}
                            <td className="py-2.5 px-2 text-center font-mono">
                              <input
                                type="number"
                                min={1}
                                value={row.qtyPerCaseDefault}
                                onChange={(e) => {
                                  const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                                  handleRatioChangeAttempt(row.id, val);
                                }}
                                title="Click to edit packaging units per case ratio"
                                className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center text-xs text-white font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
                              />
                            </td>

                            {/* 4. Quantity Inward (Cases, Singles, or Prepacks depending on mode) */}
                            <td className="py-2.5 px-2 text-center">
                              {row.receiveAs === 'Cases' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantityCases: Math.max(0, (row.quantityCases || 0) - 1),
                                        })
                                      }
                                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      value={row.quantityCases}
                                      onChange={(e) =>
                                        updateRow(row.id, {
                                          quantityCases: Math.max(0, parseInt(e.target.value, 10) || 0),
                                        })
                                      }
                                      className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center text-xs text-emerald-300 font-bold font-mono focus:outline-none focus:border-emerald-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantityCases: (row.quantityCases || 0) + 1,
                                        })
                                      }
                                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-mono block">
                                    = {(row.quantityCases || 0) * (row.qtyPerCaseDefault || 1)} units
                                  </span>
                                </div>
                              ) : row.receiveAs === 'Variant' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantityPacks: Math.max(0, (row.quantityPacks || 0) - 1),
                                        })
                                      }
                                      className="w-6 h-6 rounded bg-purple-900/60 hover:bg-purple-800 text-purple-200 font-bold flex items-center justify-center text-xs"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      value={row.quantityPacks || 0}
                                      onChange={(e) =>
                                        updateRow(row.id, {
                                          quantityPacks: Math.max(0, parseInt(e.target.value, 10) || 0),
                                        })
                                      }
                                      className="w-14 bg-slate-900 border border-purple-500/50 rounded-lg px-1.5 py-1 text-center text-xs text-purple-300 font-bold font-mono focus:outline-none focus:border-purple-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantityPacks: (row.quantityPacks || 0) + 1,
                                        })
                                      }
                                      className="w-6 h-6 rounded bg-purple-900/60 hover:bg-purple-800 text-purple-200 font-bold flex items-center justify-center text-xs"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-purple-400 font-mono block">
                                    = {(row.quantityPacks || 0) * (row.unitsPerPack || 1)} units
                                  </span>
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantitySingles: Math.max(0, (row.quantitySingles || 0) - 1),
                                        })
                                      }
                                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      value={row.quantitySingles}
                                      onChange={(e) =>
                                        updateRow(row.id, {
                                          quantitySingles: Math.max(0, parseInt(e.target.value, 10) || 0),
                                        })
                                      }
                                      className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-center text-xs text-amber-300 font-bold font-mono focus:outline-none focus:border-amber-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantitySingles: (row.quantitySingles || 0) + 1,
                                        })
                                      }
                                      className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold flex items-center justify-center text-xs"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-amber-400 font-mono block">
                                    Loose singles
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* 5. last cost */}
                            <td className="py-2.5 px-2 text-right font-mono text-slate-400">
                              ${(row.lastCost || 0).toFixed(2)}
                            </td>

                            {/* 6. Price per case / Price per unit / Price per pack */}
                            <td className="py-2.5 px-2 text-right">
                              <div className="flex flex-col items-end">
                                <span
                                  className={`text-[10px] font-bold block mb-0.5 tracking-tight ${
                                    row.receiveAs === 'Singles'
                                      ? 'text-amber-400'
                                      : row.receiveAs === 'Variant'
                                      ? 'text-purple-300'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {row.receiveAs === 'Singles'
                                    ? 'Price / Unit'
                                    : row.receiveAs === 'Variant'
                                    ? `Price / Pack (${row.unitsPerPack || 1} un)`
                                    : 'Price / Case'}
                                </span>
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                                    $
                                  </span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={row.pricePerCase}
                                    onChange={(e) =>
                                      updateRow(row.id, {
                                        pricePerCase: Math.max(0, parseFloat(e.target.value) || 0),
                                      })
                                    }
                                    placeholder={
                                      row.receiveAs === 'Singles'
                                        ? 'Unit cost'
                                        : row.receiveAs === 'Variant'
                                        ? 'Pack cost'
                                        : 'Case cost'
                                    }
                                    className={`w-24 bg-slate-900 border rounded-lg pl-5 pr-2 py-1 text-right text-xs text-white font-mono focus:outline-none ${
                                      row.receiveAs === 'Singles'
                                        ? 'border-amber-500/60 focus:border-amber-400 text-amber-300'
                                        : row.receiveAs === 'Variant'
                                        ? 'border-purple-500/60 focus:border-purple-400 text-purple-300'
                                        : 'border-slate-700 focus:border-emerald-500'
                                    }`}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* 7. Line Total */}
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400 bg-slate-900/50">
                              ${calc.lineTotal.toFixed(2)}
                            </td>

                            {/* 8. unit cost */}
                            <td className="py-2.5 px-2 text-right font-mono text-slate-300">
                              ${calc.unitCost.toFixed(2)}
                            </td>

                            {/* 9. Selling price (unit) */}
                            <td className="py-2.5 px-2 text-right">
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                                  $
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  value={row.sellingPrice}
                                  onChange={(e) =>
                                    updateRow(row.id, {
                                      sellingPrice: Math.max(0, parseFloat(e.target.value) || 0),
                                    })
                                  }
                                  className="w-18 bg-slate-900 border border-slate-700 rounded-lg pl-5 pr-2 py-1 text-right text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                                />
                              </div>
                            </td>

                            {/* 10. Margin % */}
                            <td className="py-2.5 px-2 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                                  calc.marginPercent >= 20
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                                    : calc.marginPercent > 0
                                    ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                                    : 'bg-rose-950 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {calc.marginPercent.toFixed(1)}%
                              </span>
                            </td>

                            {/* 11. Delete Row */}
                            <td className="py-2.5 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeRow(row.id)}
                                className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                                title="Remove row"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>

                  {/* Summary Footer Row matching WPS Excel */}
                  {rows.length > 0 && (
                    <tfoot>
                      <tr className="bg-slate-900 text-slate-200 font-bold border-t-2 border-slate-700 divide-x divide-slate-700/50">
                        <td className="py-3 px-3 text-right uppercase tracking-wider text-xs">
                          Voucher Summary:
                        </td>
                        <td className="py-3 px-3 text-center text-xs text-slate-400 font-mono">
                          {rows.length} Line Items
                        </td>
                        <td className="py-3 px-2 text-center text-xs text-slate-400 font-mono">
                          -
                        </td>
                        <td className="py-3 px-2 text-center text-xs text-white font-mono">
                          {voucherTotalCases} cs
                          {voucherTotalPacks > 0 && ` + ${voucherTotalPacks} pk`}
                          {voucherTotalSingles > 0 && ` + ${voucherTotalSingles} un`}
                        </td>
                        <td colSpan={2} className="py-3 px-2 text-right uppercase text-xs text-slate-400">
                          Total Invoice Value:
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-extrabold text-base text-emerald-400 bg-slate-950">
                          ${voucherGrandTotal.toFixed(2)}
                        </td>
                        <td colSpan={4} className="py-3 px-3 text-slate-400 text-xs font-normal">
                          Total Inward Units: <span className="font-mono font-bold text-white">{voucherTotalUnits} units</span>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Bottom Actions Bar */}
            <div className="p-4 rounded-2xl bg-slate-850 border border-slate-700/80 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <input
                  type="text"
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="Delivery notes, vehicle registration, batch remarks..."
                  className="w-full sm:w-96 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={addNewRow}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-750 hover:bg-slate-700 text-slate-200 border border-slate-600 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Line
                </button>
                <button
                  id="btn-post-goods-received"
                  type="button"
                  onClick={handlePostGoodsReceivedVoucher}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 transition-all shadow-lg shadow-emerald-950/40 flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Post Goods Received Voucher (${voucherGrandTotal.toFixed(2)})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: INVOICES HISTORY */}
        {/* ========================================================================= */}
        {activeTab === 'invoice_history' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchInvoiceQuery}
                  onChange={(e) => setSearchInvoiceQuery(e.target.value)}
                  placeholder="Search invoice #, supplier, PO..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                onClick={() => setActiveTab('create_invoice')}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow"
              >
                <Plus className="w-3.5 h-3.5" />
                + Receive New Delivery
              </button>
            </div>

            {filteredInvoices.length === 0 ? (
              <div className="py-16 text-center bg-slate-850 rounded-2xl border border-slate-800">
                <Receipt className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="font-semibold text-slate-300">No Invoices Found</p>
                <p className="text-xs text-slate-500 mt-1">Receive deliveries to generate vouchers.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredInvoices.map((inv) => (
                  <div
                    key={inv.voucherId}
                    className="p-5 rounded-2xl bg-slate-850 border border-slate-800 hover:border-slate-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base font-bold font-mono text-white">
                          {inv.invoiceNo}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                          {inv.voucherId}
                        </span>
                        {inv.branchName && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-blue-950 text-blue-300 border border-blue-800 font-medium">
                            {inv.branchName}
                          </span>
                        )}
                        {inv.ruleATriggeredCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" />
                            Rule A ({inv.ruleATriggeredCount})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-slate-200">{inv.supplier}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          {inv.date}
                        </span>
                        {inv.purchaseOrderNo && (
                          <>
                            <span>•</span>
                            <span className="font-mono">PO: {inv.purchaseOrderNo}</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{inv.items.length} line items</span>
                        <span>•</span>
                        <span>{inv.totalCases} cases ({inv.totalUnits} total units)</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-4 shrink-0">
                      <div className="text-right">
                        <span className="text-lg font-black font-mono text-emerald-400 block">
                          ${inv.totalInvoiceAmount.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          Received by: {inv.staffName}
                        </span>
                      </div>
                      <button
                        onClick={() => setViewingVoucher(inv)}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors shadow"
                      >
                        <Printer className="w-3.5 h-3.5 text-blue-400" />
                        View / Print Voucher
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: DAILY GOODS RECEIVED ADMIN REPORT */}
        {/* ========================================================================= */}
        {activeTab === 'daily_report' && (
          <DailyGoodsReceivedReport
            onViewVoucher={setViewingVoucher}
            onGoToGRN={() => setActiveTab('create_invoice')}
          />
        )}

        {/* ========================================================================= */}
        {/* TAB 4: AUDIT LOG */}
        {/* ========================================================================= */}
        {activeTab === 'audit_log' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-850 border border-slate-800 flex items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchLogQuery}
                  onChange={(e) => setSearchLogQuery(e.target.value)}
                  placeholder="Search item, GRN, supplier..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-850">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 font-bold border-b border-slate-800">
                    <th className="py-3 px-3">Date / Time</th>
                    <th className="py-3 px-3">GRN & Invoice</th>
                    <th className="py-3 px-3">Product</th>
                    <th className="py-3 px-2 text-center">Cases</th>
                    <th className="py-3 px-2 text-center">Singles</th>
                    <th className="py-3 px-2 text-right">Cost/Case</th>
                    <th className="py-3 px-2 text-center">Rule A Applied</th>
                    <th className="py-3 px-3">Supplier</th>
                    <th className="py-3 px-3">Officer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/50">
                      <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">
                        {log.timestamp.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-bold text-white block">{log.invoiceNo || log.grnId}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{log.grnId}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-semibold text-white block">{log.itemName}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{log.itemId}</span>
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono font-bold text-emerald-400">
                        +{log.receivedCases}
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-slate-300">
                        +{log.receivedSingles}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-slate-300">
                        ${(log.costPerCase || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {log.autoBreakCaseToSingles ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-500/40">
                            Auto-Break
                          </span>
                        ) : (
                          <span className="text-slate-600 text-[10px]">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{log.supplier}</td>
                      <td className="py-2.5 px-3 text-slate-400">{log.staffName || log.staffId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: ADD NEW PRODUCT TO INVENTORY MASTER (SHARED MODAL) */}
      {/* ========================================================================= */}
      {isNewProductModalOpen && (
        <ProductAddEditModal
          isOpen={isNewProductModalOpen}
          initialItem={null}
          prefillName={productSearchTerm}
          currentUserId={currentUser?.id || '001'}
          onClose={() => {
            setIsNewProductModalOpen(false);
            setActiveSearchRowId(null);
            setProductSearchTerm('');
          }}
          onSaved={(savedItem) => {
            handleProductSaved(savedItem);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: PACKAGING RATIO / VARIANT HANDLER */}
      {/* ========================================================================= */}
      <PackagingRatioModal
        isOpen={packagingModalData.isOpen}
        item={packagingModalData.item}
        currentUnitsPerCase={packagingModalData.currentUnitsPerCase}
        newUnitsPerCase={packagingModalData.newUnitsPerCase}
        onClose={() => setPackagingModalData({ ...packagingModalData, isOpen: false })}
        onCreateVariant={(variantName, newRatio) => {
          if (!packagingModalData.item) return;
          const variantItem = createPackagingVariant(packagingModalData.item.itemId, newRatio, variantName);
          if (variantItem) {
            refreshData();
            updateRow(packagingModalData.rowId, {
              itemId: variantItem.itemId,
              itemName: variantItem.itemName,
              qtyPerCaseDefault: variantItem.unitsPerCase,
              originalUnitsPerCase: variantItem.unitsPerCase,
              lastCost: variantItem.costPerCase,
              pricePerCase: variantItem.costPerCase,
            });
            showToast('success', `Created variant '${variantItem.itemName}' in inventory catalog!`);
          }
        }}
        onRecalculateStock={(newRatio) => {
          if (!packagingModalData.item) return;
          recalculateItemPackagingRatio(packagingModalData.item.itemId, newRatio, currentUser?.id || '001');
          refreshData();
          updateRow(packagingModalData.rowId, {
            qtyPerCaseDefault: newRatio,
            originalUnitsPerCase: newRatio,
          });
          showToast('success', `Recalculated existing stock to case of ${newRatio}s!`);
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL 3: SUPPLIER REGISTRATION MODAL */}
      {/* ========================================================================= */}
      <SupplierRegistrationModal
        isOpen={isRegisterSupplierModalOpen}
        onClose={() => setIsRegisterSupplierModalOpen(false)}
        onSupplierCreated={(newSupplier) => {
          refreshData();
          setSupplierName(newSupplier.name);
          showToast('success', `Supplier '${newSupplier.name}' registered & selected!`);
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL 4: PRINTABLE OFFICIAL GOODS RECEIVED VOUCHER WITH FULL NAVIGATION */}
      {/* ========================================================================= */}
      {viewingVoucher && (
        <div
          id="modal-view-voucher-printable"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
        >
          <div className="bg-white text-slate-900 rounded-2xl w-full max-w-5xl lg:max-w-6xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8 flex flex-col">
            {/* Top Action & Navigation Bar */}
            <div className="p-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 no-print border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-400" />
                <div>
                  <span className="font-bold text-sm block">Goods Received Voucher (GRN)</span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {viewingVoucher.voucherId} • {viewingVoucher.invoiceNo}
                  </span>
                </div>
              </div>

              {/* Top Quick Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow"
                >
                  <Printer className="w-4 h-4" />
                  Print Official Voucher
                </button>
                <button
                  type="button"
                  onClick={handleStartNewInvoice}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow"
                >
                  <Plus className="w-4 h-4" />
                  Receive New Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setViewingVoucher(null)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                  title="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Document Paper */}
            <div className="p-8 space-y-6 print:p-0 overflow-y-auto max-h-[65vh]">
              {/* Header */}
              <div className="border-b-2 border-slate-900 pb-4 flex items-start justify-between">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-slate-900">
                    GOODS RECEIVED VOUCHER
                  </h1>
                  <p className="text-xs font-semibold text-slate-600 tracking-wider uppercase mt-0.5">
                    Official Warehouse Stock Inward Voucher
                  </p>
                </div>
                <div className="text-right">
                  <span className="inline-block px-3 py-1 rounded bg-slate-900 text-white font-mono font-bold text-sm">
                    {viewingVoucher.voucherId}
                  </span>
                  <p className="text-xs text-slate-500 mt-1 font-mono">{viewingVoucher.date}</p>
                </div>
              </div>

              {/* Document References Grid (Matching Excel Header) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-100 border border-slate-300 text-xs">
                <div>
                  <span className="text-slate-500 block font-medium">Supplier Invoice:</span>
                  <span className="font-mono font-bold text-slate-900 text-sm">
                    {viewingVoucher.invoiceNo}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block font-medium">Purchase Order #:</span>
                  <span className="font-mono font-bold text-slate-900 text-sm">
                    {viewingVoucher.purchaseOrderNo || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block font-medium">Supplier Name:</span>
                  <span className="font-bold text-slate-900 text-sm">{viewingVoucher.supplier}</span>
                </div>
                <div>
                  <span className="text-slate-500 block font-medium">Receiving Branch:</span>
                  <span className="font-semibold text-slate-900">
                    {viewingVoucher.branchName || 'Main Central Distribution'}
                  </span>
                </div>
              </div>

              {/* Items Table matching WPS Template with full horizontal responsiveness */}
              <div className="border border-slate-300 rounded-lg overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-200 text-slate-800 font-bold border-b border-slate-300 divide-x divide-slate-300">
                      <th className="py-2.5 px-3 min-w-[200px]">Product</th>
                      <th className="py-2.5 px-2 text-center min-w-[90px]">Receive As</th>
                      <th className="py-2.5 px-2 text-center min-w-[70px]">qty/cs</th>
                      <th className="py-2.5 px-2 text-center min-w-[85px]">Qty Inward</th>
                      <th className="py-2.5 px-2 text-right min-w-[80px]">last cost</th>
                      <th className="py-2.5 px-2 text-right min-w-[100px]">Price / Case or Unit</th>
                      <th className="py-2.5 px-3 text-right bg-slate-300 font-extrabold min-w-[100px]">Line Total</th>
                      <th className="py-2.5 px-2 text-right min-w-[80px]">unit cost</th>
                      <th className="py-2.5 px-2 text-right min-w-[90px]">Selling Price</th>
                      <th className="py-2.5 px-2 text-center min-w-[70px]">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {viewingVoucher.items.map((it, idx) => (
                      <tr key={idx} className="divide-x divide-slate-200">
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          {it.itemName}
                          <span className="text-[10px] text-slate-500 font-mono ml-1">
                            ({it.itemId})
                          </span>
                          {it.autoBrokenRuleA && (
                            <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 py-0.5 rounded ml-1.5">
                              Rule A Break
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-center font-medium text-slate-700">
                          {it.receiveAs || 'Cases'}
                        </td>
                        <td className="py-2 px-2 text-center font-mono text-slate-700">
                          {it.unitsPerCase}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-slate-900">
                          {it.receivedCases}
                          {it.receivedSingles > 0 && (
                            <span className="text-[10px] text-slate-600 block">
                              +{it.receivedSingles} un
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-600">
                          ${(it.lastCost || it.costPerCase).toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono font-semibold text-slate-900">
                          ${it.costPerCase.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 bg-slate-50">
                          ${it.lineTotal.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-700">
                          ${it.costPerUnit.toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-slate-700">
                          ${(it.sellingPrice || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-bold text-slate-800">
                          {(it.marginPercent || 0).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {/* Invoice Total Row */}
                    <tr className="bg-slate-100 font-bold border-t-2 border-slate-400 divide-x divide-slate-300">
                      <td colSpan={3} className="py-2.5 px-3 text-slate-800 uppercase tracking-wider">
                        Voucher Summary
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-slate-900">
                        {viewingVoucher.totalCases} cs
                      </td>
                      <td colSpan={2} className="py-2.5 px-2 text-right uppercase text-slate-700">
                        Invoice Total:
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-extrabold text-sm text-slate-900 bg-slate-200">
                        ${viewingVoucher.totalInvoiceAmount.toFixed(2)}
                      </td>
                      <td colSpan={3} className="py-2.5 px-2 text-right text-slate-600 font-medium">
                        Total Units: {viewingVoucher.totalUnits}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Signatures & Notes Block */}
              <div className="grid grid-cols-2 gap-8 pt-4 border-t border-slate-300 text-xs">
                <div className="space-y-4">
                  <p className="text-slate-600">
                    <span className="font-semibold text-slate-800">Delivery Notes / Remarks:</span>{' '}
                    {viewingVoucher.notes || 'Goods physically verified and accepted in good order.'}
                  </p>
                  <div className="pt-8 border-b border-slate-400"></div>
                  <p className="text-slate-500 text-center">Supplier Delivery Driver Signature</p>
                </div>
                <div className="space-y-4">
                  <p className="text-slate-600">
                    <span className="font-semibold text-slate-800">Payment Terms:</span>{' '}
                    {viewingVoucher.paymentTerms || 'Standard Terms'}
                  </p>
                  <div className="pt-8 border-b border-slate-400"></div>
                  <p className="text-slate-500 text-center">
                    Authorized Receiving Officer ({viewingVoucher.staffName})
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Comprehensive Navigation Bar */}
            <div className="p-4 bg-slate-100 border-t border-slate-300 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-2">
                {onGoToHome && (
                  <button
                    type="button"
                    onClick={() => {
                      setViewingVoucher(null);
                      onGoToHome();
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Home className="w-3.5 h-3.5" />
                    Home Page
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setViewingVoucher(null);
                    setActiveTab('invoice_history');
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Boxes className="w-3.5 h-3.5" />
                  All Invoices History
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewingVoucher(null);
                    setActiveTab('daily_report');
                  }}
                  className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
                  Daily Receiving Report
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleStartNewInvoice}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow"
                >
                  <Plus className="w-4 h-4" />
                  + Receive New Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setViewingVoucher(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors"
                >
                  Exit Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
