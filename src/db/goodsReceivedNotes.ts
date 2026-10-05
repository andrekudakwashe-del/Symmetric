import {
  GoodsReceivedNote,
  GrnLineItem,
  GrnTotals,
  DirectGrv,
  SupplierInvoiceVoucher,
} from '../types';
import {
  initIndexedDB,
  getAllFromIDBStore,
  putToIDBStore,
  executeTx,
} from './indexedDBService';

export const GRN_STORAGE_KEY = 'saimetric_room_goods_received_notes';
export const IDB_GRN_STORE = 'goodsReceivedNotes';
export const IDB_DIRECT_STORE = 'directDeliveries';
export const IDB_GENERAL_STORE = 'generalGRVs';

let memoryGrns: GoodsReceivedNote[] = [];

/**
 * Read all unified Goods Received Notes from storage (in-memory / localStorage)
 */
export const getAllGoodsReceivedNotes = (): GoodsReceivedNote[] => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryGrns;
  }
  try {
    const raw = window.localStorage.getItem(GRN_STORAGE_KEY);
    if (!raw) return memoryGrns;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memoryGrns = parsed;
      return parsed;
    }
    return memoryGrns;
  } catch (err) {
    console.error('[GRN Store] Error reading goodsReceivedNotes:', err);
    return memoryGrns;
  }
};

/**
 * Save unified Goods Received Notes to localStorage and asynchronously to IndexedDB
 */
export const saveAllGoodsReceivedNotes = (grns: GoodsReceivedNote[]) => {
  memoryGrns = grns;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(GRN_STORAGE_KEY, JSON.stringify(grns));
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(
          new CustomEvent('saimetric_grn_updated', {
            detail: { count: grns.length },
          })
        );
      }
    } catch (err) {
      console.error('[GRN Store] Error saving goodsReceivedNotes to localStorage:', err);
    }
  }

  // Asynchronously persist to IndexedDB
  if (typeof window !== 'undefined' && window.indexedDB) {
    initIndexedDB().then((db) => {
      if (!db) return;
      try {
        executeTx(IDB_GRN_STORE, 'readwrite', (store) => {
          grns.forEach((g) => store.put(g));
        }).catch((err) => {
          console.warn('[GRN Store] Async IDB sync error:', err);
        });
      } catch (e) {
        // Safe fallback
      }
    });
  }
};

/**
 * Save or update a single Goods Received Note
 */
export const saveGoodsReceivedNote = (grn: GoodsReceivedNote): GoodsReceivedNote => {
  const all = getAllGoodsReceivedNotes();
  const idx = all.findIndex((g) => g.id === grn.id || g.grnNumber === grn.grnNumber);
  let updated: GoodsReceivedNote[];
  if (idx >= 0) {
    updated = [...all];
    updated[idx] = grn;
  } else {
    updated = [grn, ...all];
  }
  saveAllGoodsReceivedNotes(updated);
  return grn;
};

// ==================== TYPE CONVERTERS ====================

/**
 * Convert legacy DirectGrv to unified GoodsReceivedNote
 */
export const directGrvToGrn = (grv: DirectGrv): GoodsReceivedNote => {
  const dateReceived = grv.date || (grv.createdAt ? grv.createdAt.slice(0, 10) : new Date().toISOString().split('T')[0]);
  const paymentRef = grv.tillPayoutId || (grv.payments && grv.payments[0] ? `till_${grv.payments[0].userId}` : undefined);
  const cashMovementId = grv.tillPayoutId || (grv.payments && grv.payments[0] ? `till_${grv.payments[0].userId}` : undefined) || grv.id;
  
  const lineItems: GrnLineItem[] = (grv.items || []).map((item) => ({
    supplierId: grv.supplierId || grv.supplierName,
    itemId: item.productId,
    itemName: item.productName,
    quantity: item.quantity,
    unitCost: item.costPrice,
    subtotal: item.lineTotal || (item.quantity * item.costPrice),
    weight: 0,
    landedCostAllocated: 0,
    totalUnitCost: item.costPrice,
    sellingPrice: item.sellingPrice,
    sku: item.sku,
    batchNumber: item.batchNumber,
    expiryDate: item.expiryDate,
    receiveAs: item.receiveAs,
    quantityCases: item.quantityCases,
    quantitySingles: item.quantitySingles,
    unitsPerCase: item.unitsPerCase,
  }));

  const totalQuantity = (grv.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
  const totalCost = grv.totalCost || (grv.items || []).reduce((sum, it) => sum + (it.lineTotal || (it.quantity * it.costPrice)), 0);

  const totals: GrnTotals = {
    subtotal: totalCost,
    totalLandedCosts: 0,
    totalInventoryValue: totalCost,
    totalQuantity,
  };

  return {
    id: grv.id,
    grnNumber: grv.grvNumber || grv.id,
    dateReceived,
    sourceTemplate: 'direct_delivery',
    receivedBy: grv.receivedByStaffId || grv.receivedByStaffName || 'Staff',
    approvedBy: grv.approvedByStaffId || grv.approvedByStaffName || undefined,
    suppliers: [grv.supplierId || grv.supplierName || 'Direct Supplier'],
    lineItems,
    landedCosts: [],
    paymentMode: 'cash_immediate',
    paymentRef,
    dueDate: undefined,
    requiresApproval: true,
    status: grv.status,
    cashMovementId,
    payableId: undefined,
    totals,
    createdAt: grv.createdAt || new Date().toISOString(),
    updatedAt: grv.approvedAt || grv.createdAt || new Date().toISOString(),
    company_id: grv.company_id || grv.companyId,
    companyId: grv.company_id || grv.companyId,
    branch_id: grv.branch_id || grv.branchId,
    branchId: grv.branch_id || grv.branchId,
    branchName: grv.branchName,
    notes: grv.notes,
    _rawDirectGrv: grv,
  };
};

/**
 * Convert unified GoodsReceivedNote back to DirectGrv for legacy consumers
 */
export const grnToDirectGrv = (grn: GoodsReceivedNote): DirectGrv => {
  if (grn._rawDirectGrv) {
    return {
      ...grn._rawDirectGrv,
      status: grn.status as any,
      approvedByStaffId: grn.approvedBy || grn._rawDirectGrv.approvedByStaffId,
      approvedByStaffName: grn.approvedBy || grn._rawDirectGrv.approvedByStaffName,
    };
  }

  // Synthesize DirectGrv from GRN
  return {
    id: grn.id,
    grvNumber: grn.grnNumber,
    type: 'DIRECT',
    status: (grn.status || 'PENDING_APPROVAL') as any,
    companyId: grn.company_id || grn.companyId,
    company_id: grn.company_id || grn.companyId,
    branchId: grn.branch_id || grn.branchId || 'BR-MAIN',
    branch_id: grn.branch_id || grn.branchId || 'BR-MAIN',
    branchName: grn.branchName || 'Main Branch',
    supplierId: grn.suppliers[0] || 'Direct Supplier',
    supplierName: grn.suppliers[0] || 'Direct Supplier',
    date: grn.dateReceived,
    items: (grn.lineItems || []).map((li) => ({
      productId: li.itemId,
      productName: li.itemName,
      receiveAs: li.receiveAs || 'Singles',
      quantity: li.quantity,
      quantityCases: li.quantityCases,
      quantitySingles: li.quantitySingles,
      costPrice: li.unitCost,
      sellingPrice: li.sellingPrice,
      lineTotal: li.subtotal,
      unitsPerCase: li.unitsPerCase,
      sku: li.sku,
      batchNumber: li.batchNumber,
      expiryDate: li.expiryDate,
    })),
    totalCost: grn.totals.subtotal,
    totalSellingPrice: undefined,
    payFromTill: grn.paymentMode === 'cash_immediate',
    payments: grn.paymentRef
      ? [
          {
            userId: grn.receivedBy,
            userName: grn.receivedBy,
            amount: grn.totals.subtotal,
            pinConfirmed: true,
          },
        ]
      : [],
    notes: grn.notes,
    receivedByStaffId: grn.receivedBy,
    receivedByStaffName: grn.receivedBy,
    approvedByStaffId: grn.approvedBy,
    approvedByStaffName: grn.approvedBy,
    tillPayoutId: grn.paymentRef,
    createdAt: grn.createdAt,
    synced: false,
  };
};

/**
 * Convert legacy SupplierInvoiceVoucher to unified GoodsReceivedNote
 */
export const supplierInvoiceToGrn = (voucher: SupplierInvoiceVoucher): GoodsReceivedNote => {
  const dateReceived = voucher.date || (voucher.timestamp ? voucher.timestamp.slice(0, 10) : new Date().toISOString().split('T')[0]);
  const isPaid = (voucher.paymentTerms || '').toLowerCase().includes('paid');
  const paymentMode = isPaid ? 'already_paid' : 'credit_account';

  const lineItems: GrnLineItem[] = (voucher.items || []).map((it) => {
    const unitsPerCase = it.unitsPerCase || 1;
    const qty = (it as any).receivedUnits !== undefined
      ? (it as any).receivedUnits
      : ((it.receivedCases || 0) * unitsPerCase) + (it.receivedSingles || 0);
    const unitCost = it.costPerUnit || (it.costPerCase && unitsPerCase ? it.costPerCase / unitsPerCase : 0);
    return {
      supplierId: voucher.supplier,
      itemId: it.itemId,
      itemName: it.itemName,
      quantity: qty,
      unitCost: unitCost,
      subtotal: it.lineTotal !== undefined ? it.lineTotal : qty * unitCost,
      weight: 0,
      landedCostAllocated: 0,
      totalUnitCost: unitCost,
      sellingPrice: it.sellingPrice,
      receiveAs: it.receiveAs || 'Cases',
      quantityCases: it.receivedCases,
      quantitySingles: it.receivedSingles,
      unitsPerCase,
      batchNumber: (it as any).batchNumber,
      expiryDate: (it as any).expiryDate,
    };
  });

  const totals: GrnTotals = {
    subtotal: voucher.totalInvoiceAmount || 0,
    totalLandedCosts: 0,
    totalInventoryValue: voucher.totalInvoiceAmount || 0,
    totalQuantity: voucher.totalUnits || lineItems.reduce((s, it) => s + it.quantity, 0),
  };

  return {
    id: voucher.voucherId || voucher.invoiceNo,
    grnNumber: voucher.invoiceNo || voucher.voucherId,
    dateReceived,
    sourceTemplate: 'general_grv',
    receivedBy: voucher.staffId || voucher.staffName || 'Supervisor',
    approvedBy: voucher.staffId || voucher.staffName || 'Supervisor',
    suppliers: [voucher.supplier || 'General Supplier'],
    lineItems,
    landedCosts: [],
    paymentMode,
    paymentRef: voucher.purchaseOrderNo || voucher.paymentTerms,
    dueDate: voucher.date,
    requiresApproval: false,
    status: 'APPROVED',
    cashMovementId: undefined,
    payableId: voucher.invoiceNo,
    totals,
    createdAt: voucher.timestamp || new Date().toISOString(),
    updatedAt: voucher.timestamp || new Date().toISOString(),
    company_id: voucher.company_id || voucher.companyId,
    companyId: voucher.company_id || voucher.companyId,
    branch_id: voucher.branch_id || voucher.branchId,
    branchId: voucher.branch_id || voucher.branchId,
    branchName: voucher.branchName,
    notes: voucher.notes,
    _rawSupplierInvoice: voucher,
  };
};

/**
 * Convert unified GoodsReceivedNote back to SupplierInvoiceVoucher for legacy consumers
 */
export const grnToSupplierInvoice = (grn: GoodsReceivedNote): SupplierInvoiceVoucher => {
  if (grn._rawSupplierInvoice) {
    return { ...grn._rawSupplierInvoice };
  }

  // Synthesize SupplierInvoiceVoucher from GRN
  return {
    voucherId: grn.id,
    invoiceNo: grn.grnNumber,
    purchaseOrderNo: grn.paymentRef,
    companyId: grn.company_id || grn.companyId,
    company_id: grn.company_id || grn.companyId,
    branchId: grn.branch_id || grn.branchId,
    branch_id: grn.branch_id || grn.branchId,
    branchName: grn.branchName,
    supplier: grn.suppliers[0] || 'Supplier',
    date: grn.dateReceived,
    paymentTerms: grn.paymentRef || (grn.paymentMode === 'already_paid' ? 'Paid in Full' : '30-Day Account Credit'),
    staffId: grn.receivedBy,
    staffName: grn.receivedBy,
    notes: grn.notes,
    items: (grn.lineItems || []).map((li) => {
      const unitsPerCase = li.unitsPerCase || 1;
      const receivedCases = li.quantityCases !== undefined ? li.quantityCases : Math.floor(li.quantity / unitsPerCase);
      const receivedSingles = li.quantitySingles !== undefined ? li.quantitySingles : (li.quantity % unitsPerCase);
      const costPerUnit = li.unitCost;
      const costPerCase = costPerUnit * unitsPerCase;
      const lineTotal = li.subtotal;
      return {
        itemId: li.itemId,
        itemName: li.itemName,
        unitsPerCase,
        receiveAs: li.receiveAs || 'Cases',
        receivedCases,
        receivedSingles,
        receivedPacks: 0,
        lastCost: costPerUnit,
        costPerCase,
        costPerUnit,
        sellingPrice: li.sellingPrice || 0,
        marginPercent: 0,
        lineTotal,
        autoBrokenRuleA: false,
        prevStockCases: 0,
        prevStockSingles: 0,
        expiryDate: li.expiryDate,
        batchNumber: li.batchNumber,
      } as any;
    }),
    totalCases: (grn.lineItems || []).reduce((s, it) => s + (it.quantityCases || 0), 0),
    totalSingles: (grn.lineItems || []).reduce((s, it) => s + (it.quantitySingles || 0), 0),
    totalUnits: grn.totals.totalQuantity,
    totalInvoiceAmount: grn.totals.subtotal,
    ruleATriggeredCount: 0,
    timestamp: grn.createdAt,
    synced: false,
  };
};

// ==================== DUAL-READ RECONCILIATION ====================

/**
 * Dual-read reconciliation for Direct Deliveries:
 * Checks unified `goodsReceivedNotes` first, falls back to legacy store,
 * deduplicates by id and grvNumber so records never appear twice.
 */
export const getDualReadDirectGrvs = (legacyDirectGrvs: DirectGrv[]): DirectGrv[] => {
  const allGrns = getAllGoodsReceivedNotes();
  const directGrns = allGrns.filter((g) => g.sourceTemplate === 'direct_delivery');

  const seenIds = new Set<string>();
  const reconciled: DirectGrv[] = [];

  // 1. First add records from unified goodsReceivedNotes
  for (const grn of directGrns) {
    const grv = grnToDirectGrv(grn);
    const primaryId = grv.id;
    const numId = grv.grvNumber;

    if (!seenIds.has(primaryId) && (!numId || !seenIds.has(numId))) {
      seenIds.add(primaryId);
      if (numId) seenIds.add(numId);
      reconciled.push(grv);
    }
  }

  // 2. Fall back to legacy stores for any record not yet migrated
  for (const legacy of legacyDirectGrvs) {
    const primaryId = legacy.id;
    const numId = legacy.grvNumber;

    if (!seenIds.has(primaryId) && (!numId || !seenIds.has(numId))) {
      seenIds.add(primaryId);
      if (numId) seenIds.add(numId);
      reconciled.push(legacy);
    }
  }

  return reconciled;
};

/**
 * Dual-read reconciliation for General GRVs / Supplier Invoices:
 * Checks unified `goodsReceivedNotes` first, falls back to legacy store,
 * deduplicates by voucherId and invoiceNo so records never appear twice.
 */
export const getDualReadSupplierInvoices = (legacyVouchers: SupplierInvoiceVoucher[]): SupplierInvoiceVoucher[] => {
  const allGrns = getAllGoodsReceivedNotes();
  const generalGrns = allGrns.filter((g) => g.sourceTemplate === 'general_grv');

  const seenIds = new Set<string>();
  const reconciled: SupplierInvoiceVoucher[] = [];

  // 1. First add records from unified goodsReceivedNotes
  for (const grn of generalGrns) {
    const voucher = grnToSupplierInvoice(grn);
    const vId = voucher.voucherId;
    const invNo = voucher.invoiceNo;

    if (!seenIds.has(vId) && (!invNo || !seenIds.has(invNo))) {
      seenIds.add(vId);
      if (invNo) seenIds.add(invNo);
      reconciled.push(voucher);
    }
  }

  // 2. Fall back to legacy stores for any record not yet migrated
  for (const legacy of legacyVouchers) {
    const vId = legacy.voucherId;
    const invNo = legacy.invoiceNo;

    if (!seenIds.has(vId) && (!invNo || !seenIds.has(invNo))) {
      seenIds.add(vId);
      if (invNo) seenIds.add(invNo);
      reconciled.push(legacy);
    }
  }

  return reconciled;
};

// ==================== IDEMPOTENT MIGRATION ====================

export interface GrnMigrationReport {
  created: number;
  skipped: number;
  errored: number;
  totalBefore: number;
  totalAfter: number;
  directCreated: number;
  generalCreated: number;
}

/**
 * Idempotent migration from directDeliveries and generalGRVs into unified goodsReceivedNotes.
 * Can be run repeatedly without duplicating records.
 */
export async function runGrnMigration(): Promise<GrnMigrationReport> {
  const existingGrns = getAllGoodsReceivedNotes();
  const existingMap = new Map<string, GoodsReceivedNote>();

  for (const g of existingGrns) {
    existingMap.set(g.id, g);
    if (g.grnNumber) existingMap.set(g.grnNumber, g);
  }

  // Also check IDB store for any existing GRNs
  try {
    const idbGrns = await getAllFromIDBStore<GoodsReceivedNote>(IDB_GRN_STORE);
    for (const g of idbGrns) {
      if (!existingMap.has(g.id)) {
        existingMap.set(g.id, g);
      }
      if (g.grnNumber && !existingMap.has(g.grnNumber)) {
        existingMap.set(g.grnNumber, g);
      }
    }
  } catch (err) {
    // IDB not available or error, continue with localStorage
  }

  const totalBefore = new Set(Array.from(existingMap.values()).map((g) => g.id)).size;
  let created = 0;
  let skipped = 0;
  let errored = 0;
  let directCreated = 0;
  let generalCreated = 0;

  // 1. Gather all direct delivery records (IDB + localStorage)
  const directRecords: DirectGrv[] = [];
  try {
    const idbDirect = await getAllFromIDBStore<DirectGrv>(IDB_DIRECT_STORE);
    directRecords.push(...idbDirect);
  } catch (e) {}

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem('saimetric_room_direct_grvs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          directRecords.push(...parsed);
        }
      }
    } catch (e) {}
  }

  // Deduplicate direct records by id / grvNumber
  const directSeen = new Set<string>();
  const uniqueDirect: DirectGrv[] = [];
  for (const d of directRecords) {
    const id = d.id || d.grvNumber;
    if (id && !directSeen.has(id)) {
      directSeen.add(id);
      if (d.grvNumber) directSeen.add(d.grvNumber);
      uniqueDirect.push(d);
    }
  }

  // Migrate direct deliveries
  for (const direct of uniqueDirect) {
    const id = direct.id || direct.grvNumber;
    if (existingMap.has(id) || (direct.grvNumber && existingMap.has(direct.grvNumber))) {
      skipped++;
      continue;
    }

    try {
      const grn = directGrvToGrn(direct);
      existingMap.set(grn.id, grn);
      if (grn.grnNumber) existingMap.set(grn.grnNumber, grn);
      created++;
      directCreated++;
    } catch (err) {
      console.error('[GRN Migration] Error converting direct delivery record:', direct, err);
      errored++;
    }
  }

  // 2. Gather all general GRV records (IDB + localStorage)
  const generalRecords: SupplierInvoiceVoucher[] = [];
  try {
    const idbGeneral = await getAllFromIDBStore<SupplierInvoiceVoucher>(IDB_GENERAL_STORE);
    generalRecords.push(...idbGeneral);
  } catch (e) {}

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem('saimetric_room_supplier_invoices');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          generalRecords.push(...parsed);
        }
      }
    } catch (e) {}
  }

  // Deduplicate general records by voucherId / invoiceNo
  const generalSeen = new Set<string>();
  const uniqueGeneral: SupplierInvoiceVoucher[] = [];
  for (const g of generalRecords) {
    const id = g.voucherId || g.invoiceNo;
    if (id && !generalSeen.has(id)) {
      generalSeen.add(id);
      if (g.invoiceNo) generalSeen.add(g.invoiceNo);
      uniqueGeneral.push(g);
    }
  }

  // Migrate general GRVs
  for (const general of uniqueGeneral) {
    const id = general.voucherId || general.invoiceNo;
    if (existingMap.has(id) || (general.invoiceNo && existingMap.has(general.invoiceNo))) {
      skipped++;
      continue;
    }

    try {
      const grn = supplierInvoiceToGrn(general);
      existingMap.set(grn.id, grn);
      if (grn.grnNumber) existingMap.set(grn.grnNumber, grn);
      created++;
      generalCreated++;
    } catch (err) {
      console.error('[GRN Migration] Error converting general GRV record:', general, err);
      errored++;
    }
  }

  // Deduplicate final list of GRNs by primary ID
  const finalGrnMap = new Map<string, GoodsReceivedNote>();
  for (const grn of existingMap.values()) {
    if (!finalGrnMap.has(grn.id)) {
      finalGrnMap.set(grn.id, grn);
    }
  }
  const finalGrns = Array.from(finalGrnMap.values());

  // Save unified GRN list
  saveAllGoodsReceivedNotes(finalGrns);

  const report: GrnMigrationReport = {
    created,
    skipped,
    errored,
    totalBefore,
    totalAfter: finalGrns.length,
    directCreated,
    generalCreated,
  };

  console.info('[GRN Migration] Completed:', report);
  return report;
}

// Auto-run migration in browser environments on startup
if (typeof window !== 'undefined') {
  setTimeout(() => {
    runGrnMigration().catch((err) => {
      console.warn('[GRN Migration] Initial startup migration error:', err);
    });
  }, 100);
}
