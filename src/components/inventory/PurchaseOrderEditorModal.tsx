import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Plus,
  Minus,
  Search,
  Trash2,
  CopyPlus,
  CheckCircle2,
  Send,
  Save,
  Building2,
  Package,
  Boxes,
  AlertCircle,
  ChevronDown,
  LayoutGrid,
  List,
} from 'lucide-react';
import {
  InventoryItem,
  PurchaseOrder,
  PurchaseOrderLine,
  Salesperson,
  Supplier,
} from '../../types';
import {
  generateNextPoNumber,
  getCurrentBranch,
  getCurrentCompanyId,
  getInventoryItems,
  getSuppliers,
  isPurchaseOrderApprover,
  savePurchaseOrder,
  approvePurchaseOrder,
} from '../../db/roomDatabase';
import { cleanNumberInput } from './GoodsReceivedView';
import {
  formatUnitCost,
  GrvCostEntryMode,
  roundCurrency,
  roundUnitCost,
} from '../../utils/inventoryMath';
import {
  computePurchaseOrderLine,
  PoPackType,
  resolveCatalogPoCosts,
} from '../../utils/purchaseOrderMath';

export interface PurchaseOrderEditorModalProps {
  isOpen: boolean;
  currentUser: Salesperson;
  editingPo?: PurchaseOrder | null;
  initialLines?: PurchaseOrderLine[];
  initialSupplierId?: string;
  initialSupplierName?: string;
  onClose: () => void;
  onSaved: (po: PurchaseOrder, action: 'DRAFT' | 'SUBMITTED' | 'APPROVED') => void;
}

interface PoEditorRow {
  lineId: string;
  itemId: string;
  code: string;
  barcode?: string;
  masterDescription: string;
  poDescription: string;
  category?: string;
  orderAs: PoPackType;
  unitsPerCase: number | string;
  quantityCases: number | string;
  quantitySingles: number | string;
  priceInput: number | string; // Cost per Case when orderAs='Cases', Cost per Unit when orderAs='Singles' (up to 4 decimals)
  lineTotalInput: number | string; // Exact Line Total ($) when anchored in LINE_TOTAL mode
  costEntryMode: GrvCostEntryMode;
  lastCaseCost: number;
  lastUnitCost: number;
  receivedCases?: number;
  receivedUnits?: number;
  notes?: string;
}

const makeLineId = () => `POL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const todayIso = () => new Date().toISOString().split('T')[0];

const addDaysIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

const getCatalogItemName = (it: any): string =>
  String(it?.itemName || it?.name || it?.productName || it?.description || it?.itemId || 'Unnamed Product').trim();

const getSupplierDisplayName = (s: any): string =>
  String(s?.name || s?.supplierName || s?.companyName || '').trim();

const createBlankPoRow = (mode: GrvCostEntryMode = 'UNIT_COST'): PoEditorRow => ({
  lineId: makeLineId(),
  itemId: '',
  code: '',
  masterDescription: '',
  poDescription: '',
  orderAs: 'Cases',
  unitsPerCase: 1,
  quantityCases: '',
  quantitySingles: '',
  priceInput: '',
  lineTotalInput: '',
  costEntryMode: mode,
  lastCaseCost: 0,
  lastUnitCost: 0,
  receivedCases: 0,
  receivedUnits: 0,
});

const poLineToEditorRow = (
  line: PurchaseOrderLine,
  defaultMode: GrvCostEntryMode
): PoEditorRow => {
  const cases = Number(line.orderCases || 0);
  const singles = Number(line.orderSingles || 0);
  const upc = Math.max(1, Math.round(Number(line.unitsPerCase || 1)));
  const inferredOrderAs: PoPackType =
    line.orderAs || (cases > 0 ? 'Cases' : singles > 0 ? 'Singles' : 'Cases');
  const activeCost =
    inferredOrderAs === 'Singles'
      ? roundUnitCost(Number(line.unitCost || (line.caseCost ? line.caseCost / upc : 0)))
      : roundUnitCost(Number(line.caseCost || (line.unitCost ? line.unitCost * upc : 0)));
  const activeQty = inferredOrderAs === 'Singles' ? singles : cases;
  const computedTotal =
    Number(line.lineTotal || 0) > 0
      ? Number(line.lineTotal)
      : activeQty > 0 && activeCost > 0
      ? roundCurrency(activeQty * activeCost)
      : 0;

  return {
    lineId: line.lineId || makeLineId(),
    itemId: line.itemId || '',
    code: line.code || line.itemId || '',
    barcode: line.barcode,
    masterDescription: line.masterDescription || line.poDescription || '',
    poDescription: line.poDescription || line.masterDescription || '',
    category: line.category,
    orderAs: inferredOrderAs,
    unitsPerCase: upc,
    quantityCases: inferredOrderAs === 'Cases' ? (cases > 0 ? String(cases) : '') : '',
    quantitySingles: inferredOrderAs === 'Singles' ? (singles > 0 ? String(singles) : '') : '',
    priceInput: activeCost > 0 ? formatUnitCost(activeCost) : '',
    lineTotalInput: computedTotal > 0 ? computedTotal.toFixed(2) : '',
    costEntryMode: defaultMode,
    lastCaseCost: roundUnitCost(Number(line.caseCost || 0)),
    lastUnitCost: roundUnitCost(Number(line.unitCost || 0)),
    receivedCases: line.receivedCases || 0,
    receivedUnits: line.receivedUnits || 0,
    notes: line.notes,
  };
};

export const PurchaseOrderEditorModal: React.FC<PurchaseOrderEditorModalProps> = ({
  isOpen,
  currentUser,
  editingPo,
  initialLines,
  initialSupplierId,
  initialSupplierName,
  onClose,
  onSaved,
}) => {
  const canApprove = isPurchaseOrderApprover(currentUser);
  const currentBranch = getCurrentBranch();
  const suppliers = useMemo<Supplier[]>(() => getSuppliers(), [isOpen]);
  const inventoryItems = useMemo<InventoryItem[]>(() => getInventoryItems(), [isOpen]);

  const [poNumber, setPoNumber] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierName, setSupplierName] = useState<string>('');
  const [supplierPhone, setSupplierPhone] = useState<string>('');
  const [supplierEmail, setSupplierEmail] = useState<string>('');
  const [supplierAddress, setSupplierAddress] = useState<string>('');
  const [supplierQuery, setSupplierQuery] = useState<string>('');
  const [showSupplierList, setShowSupplierList] = useState<boolean>(false);

  const [orderDate, setOrderDate] = useState<string>(todayIso());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>(addDaysIso(3));
  const [paymentTerms, setPaymentTerms] = useState<string>('Cash on Delivery / Account');
  const [taxPercent, setTaxPercent] = useState<string>('0');
  const [notes, setNotes] = useState<string>('');

  // GRV-aligned Cards / Table view toggle & Cost Entry Mode toggle
  const [viewMode, setViewMode] = useState<'CARDS' | 'TABLE'>('CARDS');
  const [defaultCostEntryMode, setDefaultCostEntryMode] = useState<GrvCostEntryMode>('UNIT_COST');
  const [rows, setRows] = useState<PoEditorRow[]>(() => [createBlankPoRow('UNIT_COST')]);

  // Per-row searchable product picker popover state (matching GRV)
  const [activeSearchRowId, setActiveSearchRowId] = useState<string | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const descInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setActiveSearchRowId(null);
    setProductSearchTerm('');
    setShowSupplierList(false);

    if (editingPo) {
      setPoNumber(editingPo.poNumber || editingPo.id);
      setSupplierId(editingPo.supplierId || '');
      setSupplierName(editingPo.supplierName || '');
      setSupplierPhone(editingPo.supplierPhone || '');
      setSupplierEmail(editingPo.supplierEmail || '');
      setSupplierAddress(editingPo.supplierAddress || '');
      setSupplierQuery(editingPo.supplierName || '');
      setOrderDate(editingPo.orderDate || todayIso());
      setExpectedDeliveryDate(editingPo.expectedDeliveryDate || addDaysIso(3));
      setPaymentTerms(editingPo.paymentTerms || 'Cash on Delivery / Account');
      setTaxPercent(String(editingPo.taxPercent ?? 0));
      setNotes(editingPo.notes || '');
      const hydrated = (editingPo.lines || []).map((l) => poLineToEditorRow(l, 'UNIT_COST'));
      setRows(hydrated.length > 0 ? hydrated : [createBlankPoRow('UNIT_COST')]);
    } else {
      setPoNumber(generateNextPoNumber(currentBranch?.code));
      const matchedSup =
        (initialSupplierId && suppliers.find((s) => (s.supplierId || s.id) === initialSupplierId)) ||
        (initialSupplierName &&
          suppliers.find(
            (s) =>
              getSupplierDisplayName(s).toLowerCase() ===
              String(initialSupplierName || '').toLowerCase()
          )) ||
        undefined;
      setSupplierId(matchedSup?.supplierId || matchedSup?.id || initialSupplierId || '');
      setSupplierName(getSupplierDisplayName(matchedSup) || initialSupplierName || '');
      setSupplierPhone(matchedSup?.phone || '');
      setSupplierEmail(matchedSup?.email || '');
      setSupplierAddress(matchedSup?.address || '');
      setSupplierQuery(getSupplierDisplayName(matchedSup) || initialSupplierName || '');
      setOrderDate(todayIso());
      setExpectedDeliveryDate(addDaysIso(3));
      setPaymentTerms('Cash on Delivery / Account');
      setTaxPercent('0');
      setNotes('');
      const seeded = (initialLines || []).map((l) => poLineToEditorRow(l, 'UNIT_COST'));
      setRows(seeded.length > 0 ? seeded : [createBlankPoRow('UNIT_COST')]);
    }
  }, [isOpen, editingPo, initialLines, initialSupplierId, initialSupplierName]);

  const filteredSuppliers = useMemo(() => {
    const q = String(supplierQuery || '').trim().toLowerCase();
    const list = Array.isArray(suppliers) ? suppliers : [];
    if (!q) return list.slice(0, 12);
    return list
      .filter(
        (s) =>
          getSupplierDisplayName(s).toLowerCase().includes(q) ||
          String(s?.phone || '').toLowerCase().includes(q) ||
          String(s?.category || '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [suppliers, supplierQuery]);

  const filteredAvailableProducts = useMemo(() => {
    const q = String(productSearchTerm || '').trim().toLowerCase();
    const list = Array.isArray(inventoryItems) ? inventoryItems : [];
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (it) =>
          getCatalogItemName(it).toLowerCase().includes(q) ||
          String(it?.itemId || it?.sku || '').toLowerCase().includes(q) ||
          String(it?.barcode || '').toLowerCase().includes(q) ||
          String(it?.category || '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [inventoryItems, productSearchTerm]);

  // Canonical GRV-aligned line calculation helper
  const getRowCalculations = (row: PoEditorRow) => {
    const upc = Math.max(1, Math.round(Number(row.unitsPerCase) || 1));
    const activeQty =
      row.orderAs === 'Singles'
        ? Math.max(0, Number(row.quantitySingles) || 0)
        : Math.max(0, Number(row.quantityCases) || 0);
    const hasLineTotalInput =
      row.lineTotalInput !== undefined &&
      row.lineTotalInput !== '' &&
      Number.isFinite(Number(row.lineTotalInput));
    const effectiveMode: GrvCostEntryMode =
      row.costEntryMode === 'LINE_TOTAL' && hasLineTotalInput ? 'LINE_TOTAL' : 'UNIT_COST';

    const computed = computePurchaseOrderLine({
      orderAs: row.orderAs,
      qty: activeQty,
      unitsPerCase: upc,
      costEntryMode: effectiveMode,
      enteredPackCost: Math.max(0, Number(row.priceInput) || 0),
      enteredLineTotal: hasLineTotalInput ? Math.max(0, Number(row.lineTotalInput) || 0) : 0,
    });

    return {
      ...computed,
      activeQty,
      costEntryMode: effectiveMode,
    };
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, createBlankPoRow(defaultCostEntryMode)]);
  };

  const handleRemoveRow = (lineId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.lineId !== lineId);
      return next.length > 0 ? next : [createBlankPoRow(defaultCostEntryMode)];
    });
    if (activeSearchRowId === lineId) {
      setActiveSearchRowId(null);
    }
  };

  const handleSelectProduct = (lineId: string, item: InventoryItem) => {
    const { unitsPerCase, unitCost, caseCost } = resolveCatalogPoCosts(item);
    const masterName = getCatalogItemName(item);
    const itemCode = String(item?.sku || (item as any)?.code || item?.itemId || '').trim();

    setRows((prev) => {
      const isLast = prev.length > 0 && prev[prev.length - 1].lineId === lineId;
      const updated = prev.map((r) => {
        if (r.lineId !== lineId) return r;
        const initialPackCost = r.orderAs === 'Singles' ? unitCost : caseCost;
        const existingQty =
          r.orderAs === 'Singles'
            ? Number(r.quantitySingles) || 0
            : Number(r.quantityCases) || 0;
        const nextQty = existingQty > 0 ? existingQty : 1;
        const initialLineTotal =
          nextQty > 0 && initialPackCost > 0
            ? roundCurrency(nextQty * initialPackCost).toFixed(2)
            : '';

        return {
          ...r,
          itemId: String(item?.itemId || itemCode),
          code: itemCode,
          barcode: item?.barcode || undefined,
          masterDescription: masterName,
          poDescription: masterName,
          category: item?.category,
          unitsPerCase,
          quantityCases: r.orderAs === 'Cases' ? String(nextQty) : '',
          quantitySingles: r.orderAs === 'Singles' ? String(nextQty) : '',
          priceInput: initialPackCost > 0 ? formatUnitCost(initialPackCost) : '',
          lineTotalInput: initialLineTotal,
          costEntryMode: r.costEntryMode || defaultCostEntryMode,
          lastCaseCost: caseCost,
          lastUnitCost: unitCost,
        };
      });

      if (isLast) {
        updated.push(createBlankPoRow(defaultCostEntryMode));
      }
      return updated;
    });

    setActiveSearchRowId(null);
    setProductSearchTerm('');
    setErrorMsg(null);
  };

  const duplicateRowForFlavour = (sourceRow: PoEditorRow, idx: number) => {
    const newLineId = makeLineId();
    const copy: PoEditorRow = {
      ...sourceRow,
      lineId: newLineId,
      poDescription: sourceRow.masterDescription || sourceRow.poDescription,
      receivedCases: 0,
      receivedUnits: 0,
    };
    setRows((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setTimeout(() => {
      const input = descInputRefs.current[newLineId];
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }, 40);
  };

  const handleToggleOrderAs = (lineId: string, nextOrderAs: PoPackType) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.lineId !== lineId || r.orderAs === nextOrderAs) return r;
        const calc = getRowCalculations(r);
        const upc = Math.max(1, Math.round(Number(r.unitsPerCase) || 1));

        // Carry over the operator's entered quantity smoothly when switching Cases <-> Singles
        const carriedQtyStr =
          nextOrderAs === 'Singles'
            ? r.quantitySingles !== ''
              ? String(r.quantitySingles)
              : String(r.quantityCases || '')
            : r.quantityCases !== ''
            ? String(r.quantityCases)
            : String(r.quantitySingles || '');
        const carriedQty = Math.max(0, Number(carriedQtyStr) || 0);

        // Convert pack cost cleanly using canonical unitCost/caseCost (never double-divide!)
        const convertedPackCost =
          nextOrderAs === 'Singles'
            ? calc.unitCost > 0
              ? roundUnitCost(calc.unitCost)
              : r.lastUnitCost > 0
              ? r.lastUnitCost
              : 0
            : calc.unitCost > 0
            ? roundUnitCost(calc.unitCost * upc)
            : r.lastCaseCost > 0
            ? r.lastCaseCost
            : 0;

        const hasLineTotal =
          r.costEntryMode === 'LINE_TOTAL' &&
          r.lineTotalInput !== '' &&
          Number(r.lineTotalInput) > 0;

        if (hasLineTotal) {
          const totalNum = Number(r.lineTotalInput) || 0;
          const derivedPackCost = carriedQty > 0 ? roundUnitCost(totalNum / carriedQty) : convertedPackCost;
          return {
            ...r,
            orderAs: nextOrderAs,
            quantityCases: nextOrderAs === 'Cases' ? carriedQtyStr : '',
            quantitySingles: nextOrderAs === 'Singles' ? carriedQtyStr : '',
            priceInput: derivedPackCost > 0 ? formatUnitCost(derivedPackCost) : '',
          };
        }

        const nextLineTotal =
          carriedQty > 0 && convertedPackCost > 0
            ? roundCurrency(carriedQty * convertedPackCost).toFixed(2)
            : '';

        return {
          ...r,
          orderAs: nextOrderAs,
          quantityCases: nextOrderAs === 'Cases' ? carriedQtyStr : '',
          quantitySingles: nextOrderAs === 'Singles' ? carriedQtyStr : '',
          priceInput: convertedPackCost > 0 ? formatUnitCost(convertedPackCost) : '',
          lineTotalInput: nextLineTotal,
        };
      })
    );
  };

  const handleRowQtyChange = (
    lineId: string,
    field: 'quantityCases' | 'quantitySingles',
    val: string | number
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.lineId !== lineId) return r;
        const nextRow: PoEditorRow = { ...r, [field]: val };
        const activeQty =
          nextRow.orderAs === 'Singles'
            ? Math.max(0, Number(nextRow.quantitySingles) || 0)
            : Math.max(0, Number(nextRow.quantityCases) || 0);
        const hasLineTotal =
          nextRow.lineTotalInput !== undefined &&
          nextRow.lineTotalInput !== '' &&
          Number(nextRow.lineTotalInput) > 0;

        if (nextRow.costEntryMode === 'LINE_TOTAL' && hasLineTotal) {
          const totalNum = Number(nextRow.lineTotalInput) || 0;
          return {
            ...nextRow,
            priceInput: activeQty > 0 ? formatUnitCost(roundUnitCost(totalNum / activeQty)) : nextRow.priceInput,
          };
        }

        const priceNum = Math.max(0, Number(nextRow.priceInput) || 0);
        return {
          ...nextRow,
          lineTotalInput:
            activeQty > 0 && priceNum > 0 ? roundCurrency(priceNum * activeQty).toFixed(2) : '',
        };
      })
    );
  };

  const handleRowPriceChange = (lineId: string, rawVal: string) => {
    const val = cleanNumberInput(rawVal, true, 4);
    setRows((prev) =>
      prev.map((r) => {
        if (r.lineId !== lineId) return r;
        const activeQty =
          r.orderAs === 'Singles'
            ? Math.max(0, Number(r.quantitySingles) || 0)
            : Math.max(0, Number(r.quantityCases) || 0);
        const priceNum = Math.max(0, Number(val) || 0);
        const derivedLineTotal =
          activeQty > 0 && priceNum > 0 ? roundCurrency(priceNum * activeQty).toFixed(2) : '';
        return {
          ...r,
          priceInput: val,
          costEntryMode: 'UNIT_COST',
          lineTotalInput: derivedLineTotal,
        };
      })
    );
  };

  const handleRowLineTotalChange = (lineId: string, rawVal: string) => {
    const val = cleanNumberInput(rawVal, true, 2);
    setRows((prev) =>
      prev.map((r) => {
        if (r.lineId !== lineId) return r;
        const activeQty =
          r.orderAs === 'Singles'
            ? Math.max(0, Number(r.quantitySingles) || 0)
            : Math.max(0, Number(r.quantityCases) || 0);
        const totalNum = Math.max(0, Number(val) || 0);
        const derivedPrice =
          activeQty > 0 && totalNum > 0 ? formatUnitCost(roundUnitCost(totalNum / activeQty)) : r.priceInput;
        return {
          ...r,
          lineTotalInput: val,
          costEntryMode: 'LINE_TOTAL',
          priceInput: val === '' ? '' : derivedPrice,
        };
      })
    );
  };

  const handleUpdateRowField = <K extends keyof PoEditorRow>(
    lineId: string,
    field: K,
    value: PoEditorRow[K]
  ) => {
    setRows((prev) => prev.map((r) => (r.lineId === lineId ? { ...r, [field]: value } : r)));
  };

  const handleSwitchGlobalCostEntryMode = (mode: GrvCostEntryMode) => {
    setDefaultCostEntryMode(mode);
    setRows((prev) =>
      prev.map((r) => {
        const calc = getRowCalculations(r);
        return {
          ...r,
          costEntryMode: mode,
          priceInput: calc.displayPackCost > 0 ? formatUnitCost(calc.displayPackCost) : r.priceInput,
          lineTotalInput: calc.lineTotal > 0 ? calc.lineTotal.toFixed(2) : r.lineTotalInput,
        };
      })
    );
  };

  // Non-empty rows contributing to totals and saved PO lines
  const activeRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          Boolean(r.itemId) ||
          Boolean(r.poDescription.trim()) ||
          Number(r.quantityCases || 0) > 0 ||
          Number(r.quantitySingles || 0) > 0
      ),
    [rows]
  );

  const totals = useMemo(() => {
    let subtotalCents = 0;
    let totalCases = 0;
    let totalUnits = 0;

    activeRows.forEach((row) => {
      const calc = getRowCalculations(row);
      subtotalCents += calc.lineTotalCents;
      totalCases += calc.orderCases;
      totalUnits += calc.totalUnits;
    });

    const subtotal = roundCurrency(subtotalCents / 100);
    const taxRate = Math.max(0, Number(taxPercent || 0));
    const taxAmount = roundCurrency((subtotal * taxRate) / 100);
    const grandTotal = roundCurrency(subtotal + taxAmount);

    return {
      lineCount: activeRows.length,
      subtotal,
      taxRate,
      taxAmount,
      grandTotal,
      totalCases: Number(totalCases.toFixed(2)),
      totalUnits: Math.round(totalUnits),
    };
  }, [activeRows, taxPercent]);

  const handleSave = (mode: 'DRAFT' | 'SUBMITTED' | 'APPROVED') => {
    const finalSupplierName = (supplierName || supplierQuery).trim();
    if (!finalSupplierName) {
      setErrorMsg('Please select or enter a Supplier name.');
      return;
    }
    if (activeRows.length === 0) {
      setErrorMsg('Add at least one product line before saving the Purchase Order.');
      return;
    }

    const builtLines: PurchaseOrderLine[] = [];
    for (const row of activeRows) {
      const desc = (row.poDescription || row.masterDescription).trim();
      if (!row.itemId && !desc) {
        setErrorMsg('Please select a product from Inventory Master for every active row.');
        return;
      }
      const calc = getRowCalculations(row);
      if (calc.orderCases <= 0 && calc.orderSingles <= 0) {
        setErrorMsg(`Enter a quantity greater than 0 for "${desc || row.code || 'product'}".`);
        return;
      }
      builtLines.push({
        lineId: row.lineId || makeLineId(),
        itemId: row.itemId || row.code || makeLineId(),
        code: row.code || row.itemId || '',
        barcode: row.barcode,
        masterDescription: row.masterDescription || desc,
        poDescription: desc || row.masterDescription,
        category: row.category,
        orderAs: row.orderAs,
        orderCases: calc.orderCases,
        orderSingles: calc.orderSingles,
        unitsPerCase: calc.unitsPerCase,
        totalUnits: calc.totalUnits,
        unitCost: calc.unitCost,
        caseCost: calc.caseCost,
        lineTotal: calc.lineTotal,
        receivedCases: row.receivedCases || 0,
        receivedUnits: row.receivedUnits || 0,
        notes: row.notes,
      });
    }

    if (mode === 'APPROVED' && !canApprove) {
      setErrorMsg('Only a Manager, Supervisor, Admin, or Owner can approve a Purchase Order.');
      return;
    }

    const companyId = editingPo?.company_id || getCurrentCompanyId() || 'COMP-001';
    const branchId = editingPo?.branch_id || currentBranch?.branchId || 'BR-MAIN';
    const cleanPoNo = poNumber.trim() || generateNextPoNumber(currentBranch?.code);
    const nowIso = new Date().toISOString();

    const poDraft: PurchaseOrder = {
      ...(editingPo || {}),
      id: editingPo?.id || cleanPoNo,
      poNumber: cleanPoNo,
      company_id: companyId,
      companyId,
      branch_id: branchId,
      branchId,
      branchName: editingPo?.branchName || currentBranch?.name || 'Main Store',
      supplierId: supplierId || undefined,
      supplierName: finalSupplierName,
      supplierPhone: supplierPhone.trim() || undefined,
      supplierEmail: supplierEmail.trim() || undefined,
      supplierAddress: supplierAddress.trim() || undefined,
      orderDate: orderDate || todayIso(),
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      paymentTerms: paymentTerms.trim() || undefined,
      taxPercent: totals.taxRate,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      grandTotal: totals.grandTotal,
      totalCases: totals.totalCases,
      totalUnits: totals.totalUnits,
      status: mode === 'DRAFT' ? 'DRAFT' : 'PENDING_APPROVAL',
      notes: notes.trim() || undefined,
      lines: builtLines,
      createdById: editingPo?.createdById || currentUser.id,
      createdByName: editingPo?.createdByName || currentUser.name,
      createdByRole: editingPo?.createdByRole || currentUser.role,
      createdAt: editingPo?.createdAt || nowIso,
      submittedAt: mode !== 'DRAFT' ? nowIso : editingPo?.submittedAt,
      rejectedAt: undefined,
      rejectedById: undefined,
      rejectedByName: undefined,
      rejectionReason: undefined,
    };

    const saved = savePurchaseOrder(poDraft, { fromSync: false });
    if (mode === 'APPROVED') {
      const approvedRes = approvePurchaseOrder(saved.id, currentUser);
      if (!approvedRes.success || !approvedRes.po) {
        setErrorMsg(approvedRes.message || 'Could not approve Purchase Order.');
        return;
      }
      onSaved(approvedRes.po, 'APPROVED');
      return;
    }
    onSaved(saved, mode);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 truncate">
              {editingPo ? `Edit Purchase Order ${editingPo.poNumber}` : 'New Commercial Purchase Order'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select products in Cards or Table view, toggle Cases or Singles, and edit flavour descriptions without altering Inventory Master.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {errorMsg && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Header Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 bg-slate-50/70 border border-slate-200 rounded-xl p-4">
            <div className="md:col-span-4 relative">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Supplier *
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={supplierQuery}
                  onFocus={() => setShowSupplierList(true)}
                  onChange={(e) => {
                    setSupplierQuery(e.target.value);
                    setSupplierName(e.target.value);
                    setSupplierId('');
                    setShowSupplierList(true);
                  }}
                  placeholder="Search or enter supplier name..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-500"
                />
              </div>
              {showSupplierList && filteredSuppliers.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto z-40">
                  {filteredSuppliers.map((sup) => (
                    <button
                      key={sup.supplierId || sup.id || getSupplierDisplayName(sup)}
                      type="button"
                      onClick={() => {
                        const sName = getSupplierDisplayName(sup);
                        setSupplierId(sup.supplierId || sup.id || '');
                        setSupplierName(sName);
                        setSupplierQuery(sName);
                        setSupplierPhone(sup.phone || '');
                        setSupplierEmail(sup.email || '');
                        setSupplierAddress(sup.address || '');
                        setShowSupplierList(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {getSupplierDisplayName(sup)}
                      </span>
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {sup.phone || sup.category || ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                PO Number
              </label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Order Date
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Expected Delivery
              </label>
              <input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Tax %
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Payment Terms
              </label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g. COD, 14-Day Account, USD Cash"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div className="md:col-span-8">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Delivery Instructions / Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional supplier instructions or delivery schedule..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-500"
              />
            </div>
          </div>

          {/* GRV-Style Line Items Toolbar: Cost Entry Mode + Cards/Table View Toggle + Add Line Item */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Order Line Items</h3>
              <p className="text-[11px] text-slate-500">
                Choose Full Cases or Singles per line. Enter either Price/Pack (up to 4 decimals) or exact Line Total ($).
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Cost Entry Mode Toggle (same pattern as GRV) */}
              <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => handleSwitchGlobalCostEntryMode('LINE_TOTAL')}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    defaultCostEntryMode === 'LINE_TOTAL'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Line Total First
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchGlobalCostEntryMode('UNIT_COST')}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    defaultCostEntryMode === 'UNIT_COST'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Unit / Case Cost
                </button>
              </div>

              {/* Cards vs Table View Toggle (adopted from GRV) */}
              <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setViewMode('CARDS')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'CARDS'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Card view: touch-friendly product cards with steppers"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Cards</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('TABLE')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                    viewMode === 'TABLE'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Table view: compact spreadsheet layout"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Table</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleAddRow}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Line Item</span>
              </button>
            </div>
          </div>

          {/* GRV-STYLE CARDS VIEW OR TABLE VIEW */}
          {viewMode === 'CARDS' ? (
            <div className="space-y-3.5">
              {rows.map((row, index) => {
                const calc = getRowCalculations(row);
                const isSearchOpen = activeSearchRowId === row.lineId;

                return (
                  <div
                    key={row.lineId}
                    className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 shadow-xs"
                  >
                    {/* Top Row: Index + Searchable Product Picker + Flavour/Delete */}
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <span className="w-7 h-7 rounded-lg bg-slate-900 text-white font-mono text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">
                          {index + 1}
                        </span>
                        <div className="flex-1 min-w-0 space-y-2">
                          {/* Searchable Product Selector Button + Popover (GRV pattern) */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                if (isSearchOpen) {
                                  setActiveSearchRowId(null);
                                } else {
                                  setActiveSearchRowId(row.lineId);
                                  setProductSearchTerm('');
                                }
                              }}
                              className="w-full text-left bg-white border border-slate-300 hover:border-indigo-500 rounded-xl px-3 py-2 text-xs text-slate-900 flex items-center justify-between gap-2 shadow-2xs cursor-pointer"
                            >
                              <div className="truncate">
                                <div className="font-bold text-slate-900 text-sm truncate">
                                  {row.masterDescription || 'Tap to Select Catalog Product...'}
                                </div>
                                {row.itemId ? (
                                  <div className="text-[11px] text-indigo-700 font-mono mt-0.5">
                                    {row.code || row.itemId} &bull; {calc.unitsPerCase} units/cs
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-slate-500 mt-0.5">
                                    Select from store Inventory Master
                                  </div>
                                )}
                              </div>
                              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                            </button>

                            {isSearchOpen && (
                              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-300 rounded-2xl shadow-2xl z-50 overflow-hidden max-h-72 flex flex-col">
                                <div className="p-2.5 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
                                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                                  <input
                                    type="text"
                                    autoFocus
                                    value={productSearchTerm}
                                    onChange={(e) => setProductSearchTerm(e.target.value)}
                                    placeholder="Search product name, SKU, barcode..."
                                    className="w-full bg-transparent text-xs text-slate-900 focus:outline-none placeholder-slate-400"
                                  />
                                  {productSearchTerm && (
                                    <button
                                      type="button"
                                      onClick={() => setProductSearchTerm('')}
                                      className="text-slate-400 hover:text-slate-700 text-xs px-1 cursor-pointer"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                                <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
                                  {filteredAvailableProducts.length === 0 ? (
                                    <div className="p-4 text-center text-xs text-slate-500">
                                      No matching products in Inventory Master.
                                    </div>
                                  ) : (
                                    filteredAvailableProducts.map((p, pIdx) => {
                                      const costs = resolveCatalogPoCosts(p);
                                      const stockCases = Number((p as any)?.stockCases ?? (p as any)?.currentStockCases ?? 0);
                                      const stockSingles = Number((p as any)?.stockSingles ?? (p as any)?.currentStockSingles ?? 0);
                                      return (
                                        <button
                                          key={`${p.itemId}-${pIdx}`}
                                          type="button"
                                          onClick={() => handleSelectProduct(row.lineId, p)}
                                          className={`w-full text-left p-2.5 hover:bg-indigo-50/70 transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                                            p.itemId === row.itemId ? 'bg-indigo-50 border-l-2 border-indigo-600' : ''
                                          }`}
                                        >
                                          <div className="min-w-0 pr-2">
                                            <p className="text-xs font-bold text-slate-900 truncate">
                                              {getCatalogItemName(p)}
                                            </p>
                                            <p className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">
                                              {p.category || 'General'} &bull; {p.sku || p.itemId} &bull; {costs.unitsPerCase}/cs &bull; Stock: {stockCases}cs {stockSingles}u
                                            </p>
                                          </div>
                                          <div className="text-right shrink-0 font-mono">
                                            <p className="text-xs font-bold text-slate-900">
                                              ${formatUnitCost(costs.caseCost)}/cs
                                            </p>
                                            <p className="text-[10px] text-emerald-700">
                                              ${formatUnitCost(costs.unitCost)}/u
                                            </p>
                                          </div>
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Editable PO Description (for flavours/variants) */}
                          {row.itemId && (
                            <div>
                              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                                PO Print Description (Editable for Flavour / Variant)
                              </label>
                              <input
                                ref={(el) => {
                                  descInputRefs.current[row.lineId] = el;
                                }}
                                type="text"
                                value={row.poDescription}
                                onChange={(e) =>
                                  handleUpdateRowField(row.lineId, 'poDescription', e.target.value)
                                }
                                placeholder="Type product or flavour description..."
                                className="w-full px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {row.itemId && (
                          <button
                            type="button"
                            onClick={() => duplicateRowForFlavour(row, index)}
                            title="Duplicate line for another flavour/variant"
                            className="px-2.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 text-xs font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                          >
                            <CopyPlus className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Flavour</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.lineId)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
                          title="Remove line"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Order Pack Type Toggle: Full Cases vs Singles + Units/Cs */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-9 space-y-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500">
                          Order Pack Type:
                        </span>
                        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-200/70 rounded-xl border border-slate-200">
                          <button
                            type="button"
                            onClick={() => handleToggleOrderAs(row.lineId, 'Cases')}
                            className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 min-h-[38px] cursor-pointer ${
                              row.orderAs === 'Cases'
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <Boxes className="w-3.5 h-3.5" />
                            <span>Full Cases</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleOrderAs(row.lineId, 'Singles')}
                            className={`py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 min-h-[38px] cursor-pointer ${
                              row.orderAs === 'Singles'
                                ? 'bg-amber-500 text-slate-950 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <Package className="w-3.5 h-3.5" />
                            <span>Singles</span>
                          </button>
                        </div>
                      </div>

                      <div className="sm:col-span-3">
                        <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                          Units / Case
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.unitsPerCase ?? ''}
                          placeholder="1"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const raw = cleanNumberInput(e.target.value, false);
                            handleUpdateRowField(row.lineId, 'unitsPerCase', raw);
                          }}
                          onBlur={() => {
                            const num = parseInt(String(row.unitsPerCase), 10);
                            handleUpdateRowField(row.lineId, 'unitsPerCase', !num || num < 1 ? 1 : num);
                          }}
                          className="w-full px-3 py-2 text-center text-sm font-mono font-bold bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Qty Stepper + Price / Pack + Editable Line Total */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2.5 border-t border-slate-200/90 items-start">
                      {/* Quantity Stepper */}
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                          Qty ({row.orderAs}):
                        </span>
                        <div className="flex items-center bg-white rounded-xl p-1 border border-slate-300">
                          <button
                            type="button"
                            onClick={() => {
                              if (row.orderAs === 'Cases') {
                                handleRowQtyChange(
                                  row.lineId,
                                  'quantityCases',
                                  Math.max(0, (Number(row.quantityCases) || 0) - 1)
                                );
                              } else {
                                handleRowQtyChange(
                                  row.lineId,
                                  'quantitySingles',
                                  Math.max(0, (Number(row.quantitySingles) || 0) - 1)
                                );
                              }
                            }}
                            className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center active:scale-95 cursor-pointer"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={
                              row.orderAs === 'Cases'
                                ? row.quantityCases ?? ''
                                : row.quantitySingles ?? ''
                            }
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const val = cleanNumberInput(e.target.value, false);
                              if (row.orderAs === 'Cases') {
                                handleRowQtyChange(row.lineId, 'quantityCases', val);
                              } else {
                                handleRowQtyChange(row.lineId, 'quantitySingles', val);
                              }
                            }}
                            placeholder="0"
                            className="w-full text-center font-mono font-black text-slate-900 text-base bg-transparent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (row.orderAs === 'Cases') {
                                handleRowQtyChange(
                                  row.lineId,
                                  'quantityCases',
                                  (Number(row.quantityCases) || 0) + 1
                                );
                              } else {
                                handleRowQtyChange(
                                  row.lineId,
                                  'quantitySingles',
                                  (Number(row.quantitySingles) || 0) + 1
                                );
                              }
                            }}
                            className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center active:scale-95 cursor-pointer"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 font-mono">
                          = {calc.totalUnits.toLocaleString()} total units
                        </div>
                      </div>

                      {/* Price / Case or Price / Unit (4 decimals) */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase text-slate-500">
                            Price / {row.orderAs === 'Singles' ? 'Unit' : 'Case'} ($):
                          </span>
                          {calc.costEntryMode === 'UNIT_COST' && (
                            <span className="text-[9px] font-bold text-indigo-600 uppercase">Anchored</span>
                          )}
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-mono">
                            $
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              calc.costEntryMode === 'LINE_TOTAL'
                                ? calc.displayPackCost > 0
                                  ? formatUnitCost(calc.displayPackCost)
                                  : ''
                                : row.priceInput ?? ''
                            }
                            placeholder="0.0000"
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => handleRowPriceChange(row.lineId, e.target.value)}
                            className={`w-full bg-white rounded-xl pl-7 pr-3 py-2 text-sm text-slate-900 font-mono font-bold focus:outline-none ${
                              calc.costEntryMode === 'UNIT_COST'
                                ? 'border border-indigo-400 focus:border-indigo-600'
                                : 'border border-slate-300 focus:border-indigo-500'
                            }`}
                          />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 font-mono">
                          Unit Cost: ${formatUnitCost(calc.unitCost)} &middot; Case: ${formatUnitCost(calc.caseCost)}
                        </div>
                      </div>

                      {/* Line Total ($) — Editable (Line-Total-First supported) */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase text-emerald-700">
                            Line Total ($):
                          </span>
                          {calc.costEntryMode === 'LINE_TOTAL' && (
                            <span className="text-[9px] font-bold text-emerald-700 uppercase">Anchored</span>
                          )}
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-emerald-600 font-mono">
                            $
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              calc.costEntryMode === 'LINE_TOTAL'
                                ? row.lineTotalInput ?? ''
                                : calc.lineTotal > 0
                                ? calc.lineTotal.toFixed(2)
                                : ''
                            }
                            placeholder="0.00"
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => handleRowLineTotalChange(row.lineId, e.target.value)}
                            className={`w-full bg-white rounded-xl pl-7 pr-3 py-2 text-sm font-black text-emerald-800 font-mono focus:outline-none ${
                              calc.costEntryMode === 'LINE_TOTAL'
                                ? 'border border-emerald-500 focus:border-emerald-600'
                                : 'border border-slate-300 focus:border-emerald-500'
                            }`}
                          />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 font-mono">
                          {row.orderAs === 'Singles'
                            ? `${calc.orderSingles} singles × $${formatUnitCost(calc.unitCost)}`
                            : `${calc.orderCases} cs × $${formatUnitCost(calc.caseCost)}`}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* GRV-STYLE SPREADSHEET TABLE VIEW */
            <div className="border border-slate-200 rounded-xl overflow-x-auto pb-24 -mb-24">
              <table className="w-full text-left border-collapse min-w-[920px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    <th className="py-2.5 px-2.5 w-9 text-center">#</th>
                    <th className="py-2.5 px-3 min-w-[230px]">Product &amp; PO Description</th>
                    <th className="py-2.5 px-2.5 w-36">Order As</th>
                    <th className="py-2.5 px-2 w-20 text-center">Units/Cs</th>
                    <th className="py-2.5 px-2.5 w-36 text-center">Quantity</th>
                    <th className="py-2.5 px-2.5 w-32 text-right text-indigo-700">Price / Pack</th>
                    <th className="py-2.5 px-2.5 w-32 text-right text-emerald-700">Line Total</th>
                    <th className="py-2.5 px-2.5 w-24 text-right">Unit Cost</th>
                    <th className="py-2.5 px-2.5 w-24 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs bg-white">
                  {rows.map((row, index) => {
                    const calc = getRowCalculations(row);
                    const isSearchOpen = activeSearchRowId === row.lineId;

                    return (
                      <tr key={row.lineId} className="hover:bg-slate-50/70 align-top">
                        <td className="py-3 px-2.5 text-center font-mono text-slate-500">
                          {index + 1}
                        </td>

                        {/* Searchable Product Picker + Editable PO Description */}
                        <td className="py-2.5 px-3 relative">
                          <div className="space-y-1.5">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isSearchOpen) {
                                    setActiveSearchRowId(null);
                                  } else {
                                    setActiveSearchRowId(row.lineId);
                                    setProductSearchTerm('');
                                  }
                                }}
                                className="w-full flex items-center justify-between gap-1.5 text-left bg-white border border-slate-300 hover:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 cursor-pointer"
                              >
                                <div className="truncate">
                                  <span className="font-semibold text-slate-900">
                                    {row.masterDescription || 'Select Product...'}
                                  </span>
                                  {row.code && (
                                    <span className="text-[10px] text-indigo-700 ml-1.5 font-mono">
                                      ({row.code})
                                    </span>
                                  )}
                                </div>
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              </button>

                              {isSearchOpen && (
                                <div className="absolute left-0 top-full mt-1 w-80 bg-white border border-slate-300 rounded-xl shadow-2xl z-50 overflow-hidden">
                                  <div className="p-2 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
                                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <input
                                      type="text"
                                      autoFocus
                                      value={productSearchTerm}
                                      onChange={(e) => setProductSearchTerm(e.target.value)}
                                      placeholder="Search product, SKU or barcode..."
                                      className="w-full bg-transparent text-xs text-slate-900 focus:outline-none placeholder-slate-400"
                                    />
                                    {productSearchTerm && (
                                      <button
                                        type="button"
                                        onClick={() => setProductSearchTerm('')}
                                        className="text-slate-400 hover:text-slate-700 text-xs px-1 cursor-pointer"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                                    {filteredAvailableProducts.length === 0 ? (
                                      <div className="p-3 text-center text-xs text-slate-500">
                                        No matching products found.
                                      </div>
                                    ) : (
                                      filteredAvailableProducts.map((p, pIdx) => {
                                        const costs = resolveCatalogPoCosts(p);
                                        return (
                                          <button
                                            key={`${p.itemId}-${pIdx}`}
                                            type="button"
                                            onClick={() => handleSelectProduct(row.lineId, p)}
                                            className={`w-full text-left p-2.5 hover:bg-indigo-50/70 transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                                              p.itemId === row.itemId
                                                ? 'bg-indigo-50 border-l-2 border-indigo-600'
                                                : ''
                                            }`}
                                          >
                                            <div className="min-w-0 pr-2">
                                              <p className="text-xs font-semibold text-slate-900 truncate">
                                                {getCatalogItemName(p)}
                                              </p>
                                              <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                                                {p.sku || p.itemId} &bull; {costs.unitsPerCase}/cs
                                              </p>
                                            </div>
                                            <div className="text-right shrink-0 font-mono">
                                              <p className="text-xs font-bold text-slate-900">
                                                ${formatUnitCost(costs.caseCost)}/cs
                                              </p>
                                              <p className="text-[10px] text-emerald-700">
                                                ${formatUnitCost(costs.unitCost)}/u
                                              </p>
                                            </div>
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {row.itemId && (
                              <input
                                ref={(el) => {
                                  descInputRefs.current[row.lineId] = el;
                                }}
                                type="text"
                                value={row.poDescription}
                                onChange={(e) =>
                                  handleUpdateRowField(row.lineId, 'poDescription', e.target.value)
                                }
                                placeholder="PO print description / flavour..."
                                className="w-full px-2.5 py-1 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-indigo-500"
                              />
                            )}
                          </div>
                        </td>

                        {/* Order As Toggle (Cases / Singles) */}
                        <td className="py-2.5 px-2.5">
                          <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200 gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleToggleOrderAs(row.lineId, 'Cases')}
                              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                row.orderAs === 'Cases'
                                  ? 'bg-indigo-600 text-white shadow-2xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Cases
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleOrderAs(row.lineId, 'Singles')}
                              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                row.orderAs === 'Singles'
                                  ? 'bg-amber-500 text-slate-950 shadow-2xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Singles
                            </button>
                          </div>
                        </td>

                        {/* Units / Case */}
                        <td className="py-2.5 px-2 text-center">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={row.unitsPerCase ?? ''}
                            placeholder="1"
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const raw = cleanNumberInput(e.target.value, false);
                              handleUpdateRowField(row.lineId, 'unitsPerCase', raw);
                            }}
                            onBlur={() => {
                              const num = parseInt(String(row.unitsPerCase), 10);
                              handleUpdateRowField(row.lineId, 'unitsPerCase', !num || num < 1 ? 1 : num);
                            }}
                            className="w-14 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-center text-xs text-slate-900 font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </td>

                        {/* Quantity with -/+ steppers */}
                        <td className="py-2.5 px-2.5 text-center">
                          <div className="space-y-1">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  if (row.orderAs === 'Cases') {
                                    handleRowQtyChange(
                                      row.lineId,
                                      'quantityCases',
                                      Math.max(0, (Number(row.quantityCases) || 0) - 1)
                                    );
                                  } else {
                                    handleRowQtyChange(
                                      row.lineId,
                                      'quantitySingles',
                                      Math.max(0, (Number(row.quantitySingles) || 0) - 1)
                                    );
                                  }
                                }}
                                className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs cursor-pointer"
                              >
                                -
                              </button>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={
                                  row.orderAs === 'Cases'
                                    ? row.quantityCases ?? ''
                                    : row.quantitySingles ?? ''
                                }
                                placeholder="0"
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = cleanNumberInput(e.target.value, false);
                                  if (row.orderAs === 'Cases') {
                                    handleRowQtyChange(row.lineId, 'quantityCases', val);
                                  } else {
                                    handleRowQtyChange(row.lineId, 'quantitySingles', val);
                                  }
                                }}
                                className="w-14 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-center text-xs text-slate-900 font-bold font-mono focus:outline-none focus:border-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (row.orderAs === 'Cases') {
                                    handleRowQtyChange(
                                      row.lineId,
                                      'quantityCases',
                                      (Number(row.quantityCases) || 0) + 1
                                    );
                                  } else {
                                    handleRowQtyChange(
                                      row.lineId,
                                      'quantitySingles',
                                      (Number(row.quantitySingles) || 0) + 1
                                    );
                                  }
                                }}
                                className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              = {calc.totalUnits.toLocaleString()} u
                            </span>
                          </div>
                        </td>

                        {/* Price / Case or Price / Unit */}
                        <td className="py-2.5 px-2.5 text-right">
                          <div className="space-y-0.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={
                                calc.costEntryMode === 'LINE_TOTAL'
                                  ? calc.displayPackCost > 0
                                    ? formatUnitCost(calc.displayPackCost)
                                    : ''
                                  : row.priceInput ?? ''
                              }
                              placeholder="0.0000"
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => handleRowPriceChange(row.lineId, e.target.value)}
                              className={`w-full px-2 py-1 text-right text-xs font-mono font-bold tabular-nums bg-white rounded-lg focus:outline-none ${
                                calc.costEntryMode === 'UNIT_COST'
                                  ? 'border border-indigo-400 text-slate-900'
                                  : 'border border-slate-300 text-slate-700'
                              }`}
                            />
                            <span className="text-[10px] text-slate-400 block">
                              per {row.orderAs === 'Singles' ? 'unit' : 'case'}
                            </span>
                          </div>
                        </td>

                        {/* Editable Line Total ($) */}
                        <td className="py-2.5 px-2.5 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              calc.costEntryMode === 'LINE_TOTAL'
                                ? row.lineTotalInput ?? ''
                                : calc.lineTotal > 0
                                ? calc.lineTotal.toFixed(2)
                                : ''
                            }
                            placeholder="0.00"
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => handleRowLineTotalChange(row.lineId, e.target.value)}
                            className={`w-full px-2 py-1 text-right text-xs font-mono font-black tabular-nums bg-white rounded-lg focus:outline-none ${
                              calc.costEntryMode === 'LINE_TOTAL'
                                ? 'border border-emerald-500 text-emerald-800'
                                : 'border border-slate-300 text-emerald-800'
                            }`}
                          />
                        </td>

                        {/* Derived Unit Cost */}
                        <td className="py-3 px-2.5 text-right font-mono tabular-nums text-xs text-slate-600">
                          ${formatUnitCost(calc.unitCost)}
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 px-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            {row.itemId && (
                              <button
                                type="button"
                                onClick={() => duplicateRowForFlavour(row, index)}
                                title="Duplicate row for another flavour/variant"
                                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 transition cursor-pointer"
                              >
                                <CopyPlus className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.lineId)}
                              title="Remove line"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals Summary Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
              <span>
                Lines: <strong className="text-slate-900 font-mono">{totals.lineCount}</strong>
              </span>
              <span>&middot;</span>
              <span>
                Total Cases: <strong className="text-slate-900 font-mono">{totals.totalCases}</strong>
              </span>
              <span>&middot;</span>
              <span>
                Total Units:{' '}
                <strong className="text-slate-900 font-mono">
                  {totals.totalUnits.toLocaleString()}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-5 text-sm">
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  Subtotal
                </div>
                <div className="font-mono tabular-nums font-semibold text-slate-800">
                  ${totals.subtotal.toFixed(2)}
                </div>
              </div>
              {totals.taxAmount > 0 && (
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    Tax ({totals.taxRate}%)
                  </div>
                  <div className="font-mono tabular-nums font-semibold text-slate-800">
                    ${totals.taxAmount.toFixed(2)}
                  </div>
                </div>
              )}
              <div className="text-right pl-4 border-l border-slate-300">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                  Grand Total
                </div>
                <div className="text-lg font-mono tabular-nums font-bold text-slate-900">
                  ${totals.grandTotal.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2.5">
          <div className="text-xs text-slate-500">
            {canApprove
              ? 'Manager privilege detected: you can save as Draft, submit, or approve immediately.'
              : 'Submitted Purchase Orders require Manager approval before becoming final.'}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave('DRAFT')}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Draft</span>
            </button>
            <button
              type="button"
              onClick={() => handleSave('SUBMITTED')}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit for Approval</span>
            </button>
            {canApprove && (
              <button
                type="button"
                onClick={() => handleSave('APPROVED')}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Save &amp; Approve</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
