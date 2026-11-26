import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Plus,
  Search,
  Trash2,
  CopyPlus,
  CheckCircle2,
  Send,
  Save,
  Building2,
  Package,
  AlertCircle,
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

const makeLineId = () => `POL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const todayIso = () => new Date().toISOString().split('T')[0];

const addDaysIso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

const getCatalogItemName = (it: any): string =>
  String(it?.itemName || it?.name || it?.productName || it?.description || it?.itemId || 'Unnamed Product').trim();

const getCatalogCaseCost = (it: any): number => {
  const upc = Math.max(1, Number(it?.unitsPerCase || 1));
  const rawCase = Number(it?.costPerCase ?? it?.costPriceCase ?? 0);
  if (rawCase > 0) return rawCase;
  const rawUnit = Number(it?.costPerUnit ?? it?.costPriceUnit ?? it?.lastCostPrice ?? it?.costPrice ?? 0);
  return Number((rawUnit * upc).toFixed(2));
};

const getCatalogUnitCost = (it: any): number => {
  const upc = Math.max(1, Number(it?.unitsPerCase || 1));
  const rawUnit = Number(it?.costPerUnit ?? it?.costPriceUnit ?? it?.lastCostPrice ?? it?.costPrice ?? 0);
  if (rawUnit > 0) return rawUnit;
  const rawCase = Number(it?.costPerCase ?? it?.costPriceCase ?? 0);
  return rawCase > 0 ? Number((rawCase / upc).toFixed(4)) : 0;
};

const getSupplierDisplayName = (s: any): string =>
  String(s?.name || s?.supplierName || s?.companyName || '').trim();

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
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);

  // Product picker search
  const [productQuery, setProductQuery] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const descInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setProductQuery('');
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
      setLines(
        (editingPo.lines || []).map((l) => ({
          ...l,
          lineId: l.lineId || makeLineId(),
        }))
      );
    } else {
      setPoNumber(generateNextPoNumber(currentBranch?.code));
      const matchedSup =
        (initialSupplierId && suppliers.find((s) => (s.supplierId || s.id) === initialSupplierId)) ||
        (initialSupplierName &&
          suppliers.find((s) => getSupplierDisplayName(s).toLowerCase() === String(initialSupplierName || '').toLowerCase())) ||
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
      setLines(
        (initialLines || []).map((l) => ({
          ...l,
          lineId: l.lineId || makeLineId(),
        }))
      );
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

  const filteredProducts = useMemo(() => {
    const q = String(productQuery || '').trim().toLowerCase();
    if (!q) return [];
    const list = Array.isArray(inventoryItems) ? inventoryItems : [];
    return list
      .filter(
        (it) =>
          getCatalogItemName(it).toLowerCase().includes(q) ||
          String(it?.itemId || it?.sku || '').toLowerCase().includes(q) ||
          String(it?.barcode || '').toLowerCase().includes(q) ||
          String(it?.category || '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [inventoryItems, productQuery]);

  const addProductLine = (item: InventoryItem) => {
    const upc = Math.max(1, Number(item?.unitsPerCase || 1));
    const caseCost = getCatalogCaseCost(item);
    const unitCost = getCatalogUnitCost(item);
    const masterName = getCatalogItemName(item);
    const itemCode = String(item?.sku || item?.code || item?.itemId || '').trim();
    const newLineId = makeLineId();
    const newLine: PurchaseOrderLine = {
      lineId: newLineId,
      itemId: String(item?.itemId || itemCode),
      code: itemCode,
      barcode: item?.barcode || undefined,
      masterDescription: masterName,
      poDescription: masterName,
      category: item?.category,
      orderCases: 1,
      orderSingles: 0,
      unitsPerCase: upc,
      totalUnits: upc,
      unitCost,
      caseCost,
      lineTotal: Number(caseCost.toFixed(2)),
      receivedCases: 0,
      receivedUnits: 0,
    };
    setLines((prev) => [...prev, newLine]);
    setProductQuery('');
    setErrorMsg(null);
    setTimeout(() => {
      descInputRefs.current[newLineId]?.focus();
    }, 40);
  };

  const duplicateLineForFlavour = (sourceLine: PurchaseOrderLine, idx: number) => {
    const newLineId = makeLineId();
    const copy: PurchaseOrderLine = {
      ...sourceLine,
      lineId: newLineId,
      // Reset poDescription to masterDescription so user can type the next flavour cleanly (e.g. Raspberry)
      poDescription: sourceLine.masterDescription,
      receivedCases: 0,
      receivedUnits: 0,
    };
    setLines((prev) => {
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

  const updateLine = (lineId: string, patch: Partial<PurchaseOrderLine>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.lineId !== lineId) return l;
        const next = { ...l, ...patch };
        const upc = Math.max(1, Number(next.unitsPerCase || 1));
        const cases = Math.max(0, Number(next.orderCases || 0));
        const singles = Math.max(0, Number(next.orderSingles || 0));
        const caseCost = Math.max(0, Number(next.caseCost || 0));
        const unitCost =
          patch.caseCost !== undefined
            ? Number((caseCost / upc).toFixed(4))
            : Math.max(0, Number(next.unitCost || 0));
        const totalUnits = Math.round(cases * upc + singles);
        const lineTotal = Number((cases * caseCost + singles * unitCost).toFixed(2));
        return {
          ...next,
          unitsPerCase: upc,
          orderCases: cases,
          orderSingles: singles,
          caseCost,
          unitCost,
          totalUnits,
          lineTotal,
        };
      })
    );
  };

  const removeLine = (lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  };

  const totals = useMemo(() => {
    const subtotal = Number(lines.reduce((acc, l) => acc + Number(l.lineTotal || 0), 0).toFixed(2));
    const taxRate = Math.max(0, Number(taxPercent || 0));
    const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));
    const grandTotal = Number((subtotal + taxAmount).toFixed(2));
    const totalCases = Number(lines.reduce((acc, l) => acc + Number(l.orderCases || 0), 0).toFixed(2));
    const totalUnits = Math.round(lines.reduce((acc, l) => acc + Number(l.totalUnits || 0), 0));
    return { subtotal, taxRate, taxAmount, grandTotal, totalCases, totalUnits };
  }, [lines, taxPercent]);

  const handleSave = (mode: 'DRAFT' | 'SUBMITTED' | 'APPROVED') => {
    const finalSupplierName = (supplierName || supplierQuery).trim();
    if (!finalSupplierName) {
      setErrorMsg('Please select or enter a Supplier name.');
      return;
    }
    if (lines.length === 0) {
      setErrorMsg('Add at least one product line before saving the Purchase Order.');
      return;
    }
    const invalidQty = lines.find((l) => Number(l.orderCases || 0) <= 0 && Number(l.orderSingles || 0) <= 0);
    if (invalidQty) {
      setErrorMsg(`Enter a quantity greater than 0 for "${invalidQty.poDescription || invalidQty.masterDescription}".`);
      return;
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
      lines,
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
              Edit line descriptions freely for flavours or variants — Inventory Master names remain unchanged.
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
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
                <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto z-30">
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
                      <span className="text-sm font-semibold text-slate-900 truncate">{getSupplierDisplayName(sup)}</span>
                      <span className="text-[11px] text-slate-500 shrink-0">{sup.phone || sup.category || ''}</span>
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

          {/* Product Search Bar */}
          <div className="relative">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Add Product from Inventory Master (select the same product again for another flavour)
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="Type product name, SKU code, or barcode (e.g. Bally House 2L)..."
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>
            {filteredProducts.length > 0 && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-64 overflow-y-auto z-30">
                {filteredProducts.map((it) => {
                  const upc = Math.max(1, Number(it?.unitsPerCase || 1));
                  const cCost = getCatalogCaseCost(it);
                  const displayName = getCatalogItemName(it);
                  const stockCases = Number(it?.stockCases ?? it?.currentStockCases ?? 0);
                  const stockSingles = Number(it?.stockSingles ?? it?.currentStockSingles ?? 0);
                  return (
                    <button
                      key={it.itemId || displayName}
                      type="button"
                      onClick={() => addProductLine(it)}
                      className="w-full text-left px-4 py-2.5 hover:bg-indigo-50/70 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">{displayName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {it.sku || it.itemId} &middot; {upc}/case &middot; Stock: {stockCases} cs {stockSingles} u
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-mono tabular-nums font-semibold text-slate-700">
                          ${cCost.toFixed(2)}/cs
                        </span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-semibold">
                          <Plus className="w-3.5 h-3.5" /> Add
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* PO Line Items Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[780px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    <th className="py-2.5 px-3 w-10">#</th>
                    <th className="py-2.5 px-3">PO Description (Editable Flavour / Variant)</th>
                    <th className="py-2.5 px-3 w-24 text-right">Cases</th>
                    <th className="py-2.5 px-3 w-24 text-right">Singles</th>
                    <th className="py-2.5 px-3 w-20 text-right">Units</th>
                    <th className="py-2.5 px-3 w-28 text-right">Case Cost</th>
                    <th className="py-2.5 px-3 w-28 text-right">Line Total</th>
                    <th className="py-2.5 px-3 w-28 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        <Package className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                        <div className="text-sm font-medium text-slate-700">No items on this Purchase Order yet</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Search Inventory Master above to add products. You can add the same product multiple times for different flavours.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => {
                      const isEdited =
                        String(line.poDescription || '').trim().toLowerCase() !==
                        String(line.masterDescription || '').trim().toLowerCase();
                      return (
                        <tr key={line.lineId} className="hover:bg-slate-50/70 align-top">
                          <td className="py-3 px-3 text-xs font-mono text-slate-500 pt-4">{idx + 1}</td>
                          <td className="py-2.5 px-3">
                            <input
                              ref={(el) => {
                                descInputRefs.current[line.lineId] = el;
                              }}
                              type="text"
                              value={line.poDescription}
                              onChange={(e) => updateLine(line.lineId, { poDescription: e.target.value })}
                              placeholder="Type product or flavour description..."
                              className="w-full px-2.5 py-1.5 text-sm font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            />
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                              <span className="font-mono">{line.code}</span>
                              <span>&middot;</span>
                              <span>
                                Master: <span className="text-slate-700 font-medium">{line.masterDescription}</span>
                              </span>
                              <span>&middot;</span>
                              <span>{line.unitsPerCase} u/cs</span>
                              {isEdited && (
                                <span className="text-indigo-700 font-semibold">Custom PO flavour</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={line.orderCases}
                              onChange={(e) => updateLine(line.lineId, { orderCases: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 text-right text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500"
                            />
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={line.orderSingles || 0}
                              onChange={(e) => updateLine(line.lineId, { orderSingles: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 text-right text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500"
                            />
                          </td>
                          <td className="py-3.5 px-3 text-right text-xs font-mono tabular-nums text-slate-700 font-semibold">
                            {line.totalUnits.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.caseCost}
                              onChange={(e) => updateLine(line.lineId, { caseCost: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 text-right text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500"
                            />
                          </td>
                          <td className="py-3.5 px-3 text-right text-sm font-mono tabular-nums font-bold text-slate-900">
                            ${line.lineTotal.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => duplicateLineForFlavour(line, idx)}
                                title="Duplicate row to add another flavour/variant of this product"
                                className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 text-xs font-semibold inline-flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                              >
                                <CopyPlus className="w-3.5 h-3.5" />
                                <span>Flavour</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeLine(line.lineId)}
                                title="Remove line"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
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

          {/* Totals Summary Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
              <span>
                Lines: <strong className="text-slate-900 font-mono">{lines.length}</strong>
              </span>
              <span>&middot;</span>
              <span>
                Total Cases: <strong className="text-slate-900 font-mono">{totals.totalCases}</strong>
              </span>
              <span>&middot;</span>
              <span>
                Total Units: <strong className="text-slate-900 font-mono">{totals.totalUnits.toLocaleString()}</strong>
              </span>
            </div>
            <div className="flex items-center gap-5 text-sm">
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Subtotal</div>
                <div className="font-mono tabular-nums font-semibold text-slate-800">${totals.subtotal.toFixed(2)}</div>
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
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Grand Total</div>
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
