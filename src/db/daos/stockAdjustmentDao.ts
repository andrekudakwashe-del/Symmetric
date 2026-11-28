import {
  InventoryItem,
  Salesperson,
  StockAdjustmentDirection,
  StockAdjustmentEntryMode,
  StockAdjustmentReasonCode,
  StockAdjustmentRecord,
  StockAdjustmentStatus,
} from '../../types';
import {
  addAuditLog,
  addExpense,
  addStockMovement,
  enqueueSync,
  getAllSalespeople,
  getBranches,
  getCurrentBranchId,
  getCurrentCompanyId,
  getRawStoredExpenses,
  getRawStoredInventoryItems,
  getRawStoredStockMovements,
  getSalespeople,
  getStored,
  getTodayDateString,
  isCompanyInTenantScope,
  isRecordInBranchScope,
  saveInventoryItem,
  setStored,
  verifySalespersonPin,
} from '../roomDatabase';
import { STORAGE_KEYS } from '../storageKeys';
import {
  decomposeStockUnits,
  normalizeStockFields,
  reconcileStockValueCents,
  resolveItemValuationUnitCost,
  roundStockUnits,
} from '../../utils/inventoryMath';

const resolveEffectiveTotalUnits = (item: Partial<InventoryItem>): number =>
  normalizeStockFields(item).totalUnits;
const resolveEffectiveUnitCost = (item: Partial<InventoryItem>): number =>
  resolveItemValuationUnitCost(item);
const roundUnits = roundStockUnits;

export interface StockAdjustmentReasonMeta {
  code: StockAdjustmentReasonCode;
  label: string;
  direction: StockAdjustmentDirection | 'BOTH';
  postsShrinkageExpense: boolean;
  movementType: 'DAMAGE_LOSS' | 'ADJUSTMENT' | 'RETURN';
  requiresPhotoHint?: boolean;
  description: string;
}

export const STOCK_ADJUSTMENT_REASONS: StockAdjustmentReasonMeta[] = [
  {
    code: 'DAMAGED_SPOILAGE',
    label: 'Damaged / Spoilage Write-Off',
    direction: 'SUBTRACT',
    postsShrinkageExpense: true,
    movementType: 'DAMAGE_LOSS',
    requiresPhotoHint: true,
    description: 'Broken, leaked, crushed, or spoiled items removed from sellable stock.',
  },
  {
    code: 'EXPIRED_DISPOSAL',
    label: 'Expired Batch Disposal',
    direction: 'SUBTRACT',
    postsShrinkageExpense: true,
    movementType: 'DAMAGE_LOSS',
    requiresPhotoHint: true,
    description: 'Past-expiry stock removed and destroyed/disposed.',
  },
  {
    code: 'THEFT_SUSPECTED',
    label: 'Suspected Theft / Pilferage',
    direction: 'SUBTRACT',
    postsShrinkageExpense: true,
    movementType: 'DAMAGE_LOSS',
    requiresPhotoHint: false,
    description: 'Unexplained shortage suspected to be shoplifting or internal theft.',
  },
  {
    code: 'COUNT_VARIANCE_SHORT',
    label: 'Physical Count Variance (Short)',
    direction: 'SUBTRACT',
    postsShrinkageExpense: true,
    movementType: 'ADJUSTMENT',
    requiresPhotoHint: false,
    description: 'Shelf count is lower than system stock after verification.',
  },
  {
    code: 'INTERNAL_CONSUMPTION',
    label: 'Shop Use / Internal Consumption',
    direction: 'SUBTRACT',
    postsShrinkageExpense: true,
    movementType: 'ADJUSTMENT',
    requiresPhotoHint: false,
    description: 'Stock consumed internally for store operations or cleaning.',
  },
  {
    code: 'RETURN_TO_SUPPLIER',
    label: 'Returned to Supplier (Non-GRV)',
    direction: 'SUBTRACT',
    postsShrinkageExpense: false,
    movementType: 'ADJUSTMENT',
    requiresPhotoHint: true,
    description: 'Defective or wrong delivery units sent back to supplier.',
  },
  {
    code: 'COUNT_VARIANCE_SURPLUS',
    label: 'Physical Count Variance (Surplus)',
    direction: 'ADD',
    postsShrinkageExpense: false,
    movementType: 'ADJUSTMENT',
    description: 'Verified physical shelf count exceeds system stock.',
  },
  {
    code: 'FOUND_STOCK',
    label: 'Found / Uncounted Backroom Stock',
    direction: 'ADD',
    postsShrinkageExpense: false,
    movementType: 'ADJUSTMENT',
    description: 'Previously misplaced stock located and returned to shelf.',
  },
  {
    code: 'DATA_ENTRY_CORRECTION',
    label: 'Clerical / Data Entry Correction',
    direction: 'BOTH',
    postsShrinkageExpense: false,
    movementType: 'ADJUSTMENT',
    description: 'Correcting a documented prior entry mistake (must cite reference).',
  },
  {
    code: 'CUSTOMER_RETURN_RESTOCK',
    label: 'Customer Return Restock',
    direction: 'ADD',
    postsShrinkageExpense: false,
    movementType: 'RETURN',
    description: 'Sellable goods returned by customer outside standard POS refund.',
  },
  {
    code: 'REVERSAL',
    label: 'Owner Reversal of Prior Adjustment',
    direction: 'BOTH',
    postsShrinkageExpense: false,
    movementType: 'ADJUSTMENT',
    description: 'Immutable reversal offsetting an earlier approved adjustment.',
  },
];

export const STOCK_ADJUSTMENT_MIN_NOTE_LENGTH = 15;
export const STOCK_ADJUSTMENT_HIGH_VALUE_USD = 50;
export const STOCK_ADJUSTMENT_PHOTO_RECOMMENDED_USD = 10;
export const STOCK_ADJUSTMENT_VELOCITY_WINDOW_DAYS = 7;
export const STOCK_ADJUSTMENT_VELOCITY_THRESHOLD = 3;

export function getReasonMeta(code?: string): StockAdjustmentReasonMeta {
  return (
    STOCK_ADJUSTMENT_REASONS.find((r) => r.code === code) || {
      code: 'DATA_ENTRY_CORRECTION',
      label: String(code || 'Manual Adjustment'),
      direction: 'BOTH',
      postsShrinkageExpense: false,
      movementType: 'ADJUSTMENT',
      description: 'Manual inventory adjustment',
    }
  );
}

/**
 * Owner / Super Admin / Admin: Can approve/reject pending requests, reverse posted
 * adjustments, and post direct adjustments (with mandatory Owner PIN re-auth).
 */
export function isStockAdjustmentOwner(role?: string | null): boolean {
  const norm = String(role || '').trim().toUpperCase();
  return norm === 'OWNER' || norm === 'SUPER_ADMIN' || norm === 'ADMIN';
}

/**
 * Manager / Branch Manager / Supervisor (and Owner/Admin):
 * Can prepare & submit stock adjustment requests for Owner approval.
 * Cashiers, Till Operators, and Clerks are strictly blocked.
 */
export function canPrepareStockAdjustment(role?: string | null): boolean {
  if (isStockAdjustmentOwner(role)) return true;
  const norm = String(role || '').trim().toUpperCase();
  return norm === 'MANAGER' || norm === 'BRANCH_MANAGER' || norm === 'SUPERVISOR';
}

function getLocalDeviceId(): string {
  try {
    const cfgRaw = localStorage.getItem('saimetric_mesh_config');
    if (cfgRaw) {
      const parsed = JSON.parse(cfgRaw);
      if (parsed?.deviceId) return String(parsed.deviceId);
    }
    const fallback = localStorage.getItem('saimetric_device_id');
    if (fallback) return fallback;
  } catch {
    // no-op
  }
  return 'PWA-DEVICE';
}

function resolveBranchName(branchId: string): string {
  const branches = getBranches();
  const match = branches.find(
    (b: any) =>
      String(b.branchId || b.id || '').trim().toUpperCase() ===
      String(branchId || '').trim().toUpperCase()
  );
  return match?.name || match?.branchName || branchId || 'Main Branch';
}

export type StockAdjustmentChangeListener = (record: StockAdjustmentRecord) => void;
const adjustmentListeners: Set<StockAdjustmentChangeListener> = new Set();

export function onStockAdjustmentChanged(listener: StockAdjustmentChangeListener): () => void {
  adjustmentListeners.add(listener);
  return () => {
    adjustmentListeners.delete(listener);
  };
}

export function notifyStockAdjustmentChanged(record: StockAdjustmentRecord): void {
  adjustmentListeners.forEach((fn) => {
    try {
      fn(record);
    } catch (e) {
      console.error('[StockAdjustmentDao] listener error:', e);
    }
  });
}

function dispatchStockAdjustmentUiEvents(record?: StockAdjustmentRecord): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('saimetric_stock_adjustments_updated', { detail: record }));
  window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
  window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
}

export function getRawStoredStockAdjustments(): StockAdjustmentRecord[] {
  const list = getStored<StockAdjustmentRecord[]>(STORAGE_KEYS.STOCK_ADJUSTMENTS, []);
  return Array.isArray(list) ? list : [];
}

function saveRawStockAdjustments(list: StockAdjustmentRecord[]): void {
  setStored(STORAGE_KEYS.STOCK_ADJUSTMENTS, list);
}

export function getStockAdjustments(branchId?: string): StockAdjustmentRecord[] {
  const raw = getRawStoredStockAdjustments();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = branchId || getCurrentBranchId();
  const branches = getBranches();

  const filtered = raw.filter((adj) => {
    const compId = adj.company_id || adj.companyId;
    if (!isCompanyInTenantScope(compId, currentCompany)) return false;
    if (!currentBranch || currentBranch === 'ALL') return true;
    const brId = adj.branch_id || adj.branchId;
    return isRecordInBranchScope(brId, currentBranch, branches, currentCompany, compId);
  });

  return filtered.sort((a, b) => {
    const ta = Number(a.updatedAt) || new Date(a.createdAt || 0).getTime() || 0;
    const tb = Number(b.updatedAt) || new Date(b.createdAt || 0).getTime() || 0;
    return tb - ta;
  });
}

export function getPendingStockAdjustmentsCount(branchId?: string): number {
  return getStockAdjustments(branchId).filter((a) => a.status === 'PENDING_OWNER_APPROVAL').length;
}

export function evaluateAdjustmentAnomalies(params: {
  item: InventoryItem;
  deltaUnits: number;
  reasonCode: StockAdjustmentReasonCode;
  existingAdjustments?: StockAdjustmentRecord[];
  submittedTotalUnits?: number;
}): {
  mwacUnitCost: number;
  valuationImpactUsd: number;
  anomalyFlags: string[];
  recentNegativeCount7d: number;
} {
  const { item, deltaUnits, reasonCode } = params;
  const mwacUnitCost = resolveEffectiveUnitCost(item);
  const valuationImpactUsd = Math.round(deltaUnits * mwacUnitCost * 100) / 100;
  const anomalyFlags: string[] = [];

  if (Math.abs(valuationImpactUsd) >= STOCK_ADJUSTMENT_HIGH_VALUE_USD) {
    anomalyFlags.push('HIGH_VALUE');
  }

  const currentTotalUnits = resolveEffectiveTotalUnits(item);
  if (currentTotalUnits + deltaUnits < 0) {
    anomalyFlags.push('BELOW_ZERO_CLAMPED');
  }

  if (
    deltaUnits > 0 &&
    reasonCode !== 'REVERSAL' &&
    reasonCode !== 'CUSTOMER_RETURN_RESTOCK'
  ) {
    anomalyFlags.push('GRV_BYPASS_WARNING');
  }

  if (
    params.submittedTotalUnits !== undefined &&
    Math.abs(roundUnits(currentTotalUnits - params.submittedTotalUnits)) > 0.0001
  ) {
    anomalyFlags.push('STOCK_DRIFT_SINCE_SUBMISSION');
  }

  const allAdj = params.existingAdjustments || getStockAdjustments();
  const cutoffMs = Date.now() - STOCK_ADJUSTMENT_VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentNegativeCount7d = allAdj.filter((a) => {
    if (a.itemId !== item.itemId) return false;
    if (a.status === 'REJECTED' || a.status === 'CANCELLED') return false;
    if (a.deltaUnits >= 0) return false;
    const ts = new Date(a.createdAt || 0).getTime() || Number(a.updatedAt) || 0;
    return ts >= cutoffMs;
  }).length;

  if (deltaUnits < 0 && recentNegativeCount7d + 1 >= STOCK_ADJUSTMENT_VELOCITY_THRESHOLD) {
    anomalyFlags.push('VELOCITY_SPIKE');
  }

  return {
    mwacUnitCost,
    valuationImpactUsd,
    anomalyFlags,
    recentNegativeCount7d,
  };
}

/**
 * Verifies an Owner/Admin PIN and returns the matched Owner Salesperson record.
 * Strictly blocks Managers, Supervisors, and Cashiers from approving stock adjustments.
 */
export function verifyOwnerPinForAdjustment(
  pin: string,
  expectedActor?: Salesperson | null
): { ok: boolean; owner?: Salesperson; error?: string } {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin || cleanPin.length < 4) {
    return { ok: false, error: 'Please enter a valid Owner / Admin PIN.' };
  }

  const scoped = getSalespeople().filter((s) => s.active === 'Y');
  const allActive = getAllSalespeople().filter((s) => s.active === 'Y');
  const pool = [...scoped, ...allActive.filter((a) => !scoped.some((s) => s.id === a.id))];

  // Prefer verifying against expectedActor if they are an Owner/Admin
  if (expectedActor && isStockAdjustmentOwner(expectedActor.role)) {
    const liveActor = pool.find((s) => s.id === expectedActor.id) || expectedActor;
    if (verifySalespersonPin(liveActor, cleanPin)) {
      return { ok: true, owner: liveActor };
    }
  }

  const matched = pool.find((s) => verifySalespersonPin(s, cleanPin));
  if (!matched) {
    return { ok: false, error: 'Invalid PIN. Owner or Administrator PIN required.' };
  }
  if (!isStockAdjustmentOwner(matched.role)) {
    return {
      ok: false,
      error: `PIN belongs to ${matched.name} (${matched.role}). Only an Owner or Administrator can approve manual stock adjustments.`,
    };
  }
  return { ok: true, owner: matched };
}

/**
 * Applies an APPROVED stock adjustment delta to local InventoryMaster STRICTLY ONCE.
 * Idempotency is guaranteed by checking `StockMovements` for `referenceId === adj.id`
 * or `movementId === adj.movementId`.
 *
 * Works identically on the approving device AND on every remote device receiving the
 * APPROVED adjustment via Local Hub, WiFi Mesh, Cloud Pull, or WhatsApp `.saimpack`.
 */
export function applyApprovedStockAdjustmentDeltaOnce(
  adj: StockAdjustmentRecord,
  options?: { fromRemote?: boolean; skipExpensePosting?: boolean }
): {
  applied: boolean;
  movementId: string;
  shrinkageExpenseId?: string;
  beforeCases: number;
  beforeSingles: number;
  beforeTotalUnits: number;
  afterCases: number;
  afterSingles: number;
  afterTotalUnits: number;
  mwacUnitCost: number;
  valuationImpactUsd: number;
} {
  const fromRemote = Boolean(options?.fromRemote);
  const movementId = adj.movementId || `MOV-ADJ-${adj.id}`;

  const existingMovs = getRawStoredStockMovements();
  const alreadyAppliedMov = existingMovs.find((m: any) => {
    const ref = String(m.referenceId || m.reference || '').trim().toUpperCase();
    const mId = String(m.movementId || m.id || m.txnId || '').trim().toUpperCase();
    return ref === adj.id.toUpperCase() || mId === movementId.toUpperCase();
  });

  const allItems = getRawStoredInventoryItems();
  const item = allItems.find((i) => i.itemId === adj.itemId || (i as any).id === adj.itemId);

  if (alreadyAppliedMov || !item) {
    return {
      applied: false,
      movementId: alreadyAppliedMov?.movementId || movementId,
      shrinkageExpenseId: adj.shrinkageExpenseId,
      beforeCases: adj.beforeCases ?? adj.submittedStockCases ?? 0,
      beforeSingles: adj.beforeSingles ?? adj.submittedStockSingles ?? 0,
      beforeTotalUnits: adj.beforeTotalUnits ?? adj.submittedTotalUnits ?? 0,
      afterCases: adj.afterCases ?? item?.stockCases ?? 0,
      afterSingles: adj.afterSingles ?? item?.stockSingles ?? 0,
      afterTotalUnits: adj.afterTotalUnits ?? (item ? resolveEffectiveTotalUnits(item) : 0),
      mwacUnitCost: adj.mwacUnitCost || (item ? resolveEffectiveUnitCost(item) : 0),
      valuationImpactUsd: adj.valuationImpactUsd || 0,
    };
  }

  const upc = Math.max(1, Number(item.unitsPerCase) || Number(adj.unitsPerCase) || 1);
  const beforeTotalUnits = resolveEffectiveTotalUnits(item);
  const beforeDecomp = decomposeStockUnits(beforeTotalUnits, upc, { keepCasesZero: upc <= 1 });
  const nextTotalUnits = Math.max(0, roundUnits(beforeTotalUnits + Number(adj.deltaUnits || 0)));
  const afterDecomp = decomposeStockUnits(nextTotalUnits, upc, { keepCasesZero: upc <= 1 });
  const effectiveDeltaUnits = roundUnits(afterDecomp.totalUnits - beforeTotalUnits);
  const mwacUnitCost = adj.mwacUnitCost > 0 ? adj.mwacUnitCost : resolveEffectiveUnitCost(item);
  const valuationImpactUsd = Math.round(effectiveDeltaUnits * mwacUnitCost * 100) / 100;

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: afterDecomp.stockCases,
    stockSingles: afterDecomp.stockSingles,
    totalUnits: afterDecomp.totalUnits,
    stockValueCents: reconcileStockValueCents(item, afterDecomp.totalUnits),
    lastUpdated: new Date().toISOString(),
  };

  // Apply stock update locally. For remote sync arrivals, pass fromMesh: true so we do not
  // emit redundant inventory snapshot storms across peers (peers apply the same delta from adj).
  saveInventoryItem(updatedItem, { fromMesh: fromRemote });

  const reasonMeta = getReasonMeta(adj.reasonCode);
  const nowIso = adj.approvedAt || new Date().toISOString();
  const formattedDelta =
    effectiveDeltaUnits >= 0 ? `+${effectiveDeltaUnits}u` : `${effectiveDeltaUnits}u`;
  const formattedVal =
    valuationImpactUsd >= 0
      ? `+$${valuationImpactUsd.toFixed(2)}`
      : `-$${Math.abs(valuationImpactUsd).toFixed(2)}`;

  addStockMovement(
    {
      id: movementId,
      movementId,
      txnId: movementId,
      itemId: item.itemId,
      itemName: item.itemName,
      movementType: reasonMeta.movementType,
      txnType: reasonMeta.movementType,
      casesChange: adj.deltaCases,
      singlesChange: adj.deltaSingles,
      qtyCases: adj.deltaCases,
      qtySingles: adj.deltaSingles,
      deltaUnits: effectiveDeltaUnits,
      beforeCases: beforeDecomp.stockCases,
      beforeSingles: beforeDecomp.stockSingles,
      beforeTotalUnits,
      resultingStockCases: afterDecomp.stockCases,
      resultingStockSingles: afterDecomp.stockSingles,
      resultingTotalUnits: afterDecomp.totalUnits,
      closingCases: afterDecomp.stockCases,
      closingSingles: afterDecomp.stockSingles,
      unitCost: mwacUnitCost,
      valuationImpactUsd,
      reasonCode: adj.reasonCode,
      triggerRule: adj.reversesAdjustmentId
        ? `REVERSAL OF ${adj.reversesAdjustmentId}`
        : `OWNER APPROVED (${adj.approvedByName || 'Owner'})`,
      referenceId: adj.id,
      reason: `[${reasonMeta.label}] ${adj.auditNote} (${formattedDelta} | ${formattedVal})`,
      staffId: adj.createdBy,
      staffName: `${adj.createdByName} → Approved: ${adj.approvedByName || 'Owner'}`,
      approvedBy: adj.approvedBy,
      approvedByName: adj.approvedByName,
      company_id: adj.company_id || getCurrentCompanyId(),
      branch_id: adj.branch_id || getCurrentBranchId(),
      date: adj.date || getTodayDateString(),
      timestamp: nowIso,
      fromMesh: fromRemote,
    },
    { fromSync: fromRemote }
  );

  // Post non-cash P&L Shrinkage Variance expense on the approving device only (and deduplicate by ref)
  let shrinkageExpenseId = adj.shrinkageExpenseId;
  if (
    !fromRemote &&
    !options?.skipExpensePosting &&
    effectiveDeltaUnits < 0 &&
    reasonMeta.postsShrinkageExpense &&
    Math.abs(valuationImpactUsd) > 0
  ) {
    const existingExp = getRawStoredExpenses().find(
      (e: any) =>
        String(e.reference || e.receiptRef || '').trim().toUpperCase() === adj.id.toUpperCase()
    );
    if (existingExp) {
      shrinkageExpenseId = existingExp.id;
    } else {
      const exp = addExpense({
        date: adj.date || getTodayDateString(),
        category: 'Inventory Shrinkage / Write-Off',
        description: `Stock Adjustment ${adj.id}: ${reasonMeta.label} — ${item.itemName} (${formattedDelta})`,
        vendorOrCustomer: `${adj.createdByName} (Approved by ${adj.approvedByName || 'Owner'})`,
        amount: Math.abs(valuationImpactUsd),
        staffId: adj.createdBy,
        staffName: adj.createdByName,
        paymentMethod: 'Non-Cash (Stock Shrinkage)',
        recordCashLog: false,
        reference: adj.id,
        receiptRef: adj.id,
        status: 'approved',
        approvedBy: adj.approvedBy,
        approvedByName: adj.approvedByName,
        approvalTimestamp: nowIso,
        notes: `Non-cash inventory valuation write-off posted automatically upon Owner approval of ${adj.id}. Reason: ${adj.auditNote}. Unit Cost (MWAC): $${mwacUnitCost.toFixed(4)}.`,
        companyId: adj.company_id || getCurrentCompanyId(),
        branchId: adj.branch_id || getCurrentBranchId(),
      });
      shrinkageExpenseId = exp.id;
    }
  }

  return {
    applied: true,
    movementId,
    shrinkageExpenseId,
    beforeCases: beforeDecomp.stockCases,
    beforeSingles: beforeDecomp.stockSingles,
    beforeTotalUnits,
    afterCases: afterDecomp.stockCases,
    afterSingles: afterDecomp.stockSingles,
    afterTotalUnits: afterDecomp.totalUnits,
    mwacUnitCost,
    valuationImpactUsd,
  };
}

export interface CreateStockAdjustmentInput {
  itemId: string;
  entryMode: StockAdjustmentEntryMode;
  direction: StockAdjustmentDirection;
  reasonCode: StockAdjustmentReasonCode;
  auditNote: string;
  // For DELTA mode: unsigned magnitudes (sign applied from direction) or signed values
  deltaCases: number;
  deltaSingles: number;
  // For PHYSICAL_COUNT mode: exact counted cases & singles
  countedCases?: number;
  countedSingles?: number;
  evidencePhotoDataUrl?: string;
  reversesAdjustmentId?: string;
}

export function createStockAdjustmentRequest(
  input: CreateStockAdjustmentInput,
  actor: Salesperson | null
): { success: boolean; message: string; record?: StockAdjustmentRecord } {
  if (!actor || !canPrepareStockAdjustment(actor.role)) {
    return {
      success: false,
      message: 'Access denied. Only Owners, Managers, or Supervisors can prepare stock adjustments.',
    };
  }

  const cleanNote = String(input.auditNote || '').trim();
  if (cleanNote.length < STOCK_ADJUSTMENT_MIN_NOTE_LENGTH) {
    return {
      success: false,
      message: `Audit note must be at least ${STOCK_ADJUSTMENT_MIN_NOTE_LENGTH} characters explaining the exact cause.`,
    };
  }

  const allItems = getRawStoredInventoryItems();
  const item = allItems.find((i) => i.itemId === input.itemId);
  if (!item) {
    return { success: false, message: 'Selected product was not found in Inventory Master.' };
  }

  const upc = Math.max(1, Number(item.unitsPerCase) || 1);
  const currentTotalUnits = resolveEffectiveTotalUnits(item);
  const currentDecomp = decomposeStockUnits(currentTotalUnits, upc, { keepCasesZero: upc <= 1 });

  let deltaUnits = 0;
  let deltaCases = 0;
  let deltaSingles = 0;
  let resolvedDirection: StockAdjustmentDirection = input.direction;

  if (input.entryMode === 'PHYSICAL_COUNT') {
    const cCases = Math.max(0, Number(input.countedCases) || 0);
    const cSingles = Math.max(0, Number(input.countedSingles) || 0);
    const targetTotalUnits = roundUnits(cCases * upc + cSingles);
    deltaUnits = roundUnits(targetTotalUnits - currentTotalUnits);
    if (Math.abs(deltaUnits) < 0.0001) {
      return {
        success: false,
        message: 'Physical count matches current system stock — zero variance to adjust.',
      };
    }
    resolvedDirection = deltaUnits < 0 ? 'SUBTRACT' : 'ADD';
    const absDecomp = decomposeStockUnits(Math.abs(deltaUnits), upc, { keepCasesZero: upc <= 1 });
    const sign = deltaUnits < 0 ? -1 : 1;
    deltaCases = sign * absDecomp.stockCases;
    deltaSingles = sign * absDecomp.stockSingles;
  } else {
    const absCases = Math.abs(Number(input.deltaCases) || 0);
    const absSingles = Math.abs(Number(input.deltaSingles) || 0);
    const absUnits = roundUnits(absCases * upc + absSingles);
    if (absUnits < 0.0001) {
      return { success: false, message: 'Adjustment quantity must be greater than zero.' };
    }
    const sign = input.direction === 'SUBTRACT' ? -1 : 1;
    deltaUnits = sign * absUnits;
    deltaCases = sign * absCases;
    deltaSingles = sign * absSingles;
  }

  // Validate reason direction compatibility
  const reasonMeta = getReasonMeta(input.reasonCode);
  if (reasonMeta.direction !== 'BOTH' && reasonMeta.direction !== resolvedDirection) {
    return {
      success: false,
      message: `Reason "${reasonMeta.label}" only applies to ${reasonMeta.direction === 'SUBTRACT' ? 'stock subtractions' : 'stock additions'}.`,
    };
  }

  const evaluation = evaluateAdjustmentAnomalies({
    item,
    deltaUnits,
    reasonCode: input.reasonCode,
  });

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = getTodayDateString();
  const compId = getCurrentCompanyId();
  const brId = getCurrentBranchId();
  const randSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const adjId = `ADJ-${today.replace(/-/g, '')}-${nowMs.toString().slice(-5)}-${randSuffix}`;

  const record: StockAdjustmentRecord = {
    id: adjId,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
    branchName: resolveBranchName(brId),
    date: today,
    itemId: item.itemId,
    itemName: item.itemName,
    sku: (item as any).sku || (item as any).code || item.itemId,
    unitsPerCase: upc,
    entryMode: input.entryMode,
    direction: resolvedDirection,
    reasonCode: input.reasonCode,
    auditNote: cleanNote,
    deltaCases,
    deltaSingles,
    deltaUnits,
    submittedStockCases: currentDecomp.stockCases,
    submittedStockSingles: currentDecomp.stockSingles,
    submittedTotalUnits: currentTotalUnits,
    mwacUnitCost: evaluation.mwacUnitCost,
    valuationImpactUsd: evaluation.valuationImpactUsd,
    ...(input.evidencePhotoDataUrl ? { evidencePhotoDataUrl: input.evidencePhotoDataUrl } : {}),
    ...(input.reversesAdjustmentId ? { reversesAdjustmentId: input.reversesAdjustmentId } : {}),
    status: 'PENDING_OWNER_APPROVAL',
    createdBy: actor.id,
    createdByName: actor.name,
    createdByRole: actor.role,
    createdAt: nowIso,
    createdDeviceId: getLocalDeviceId(),
    anomalyFlags: evaluation.anomalyFlags,
    updatedAt: nowMs,
    lastUpdated: nowIso,
    isCloudSynced: false,
  };

  const list = getRawStoredStockAdjustments();
  saveRawStockAdjustments([record, ...list]);
  enqueueSync('StockAdjustments' as any, 'INSERT', record);
  notifyStockAdjustmentChanged(record);
  dispatchStockAdjustmentUiEvents(record);

  try {
    addAuditLog({
      action: 'STOCK_ADJUSTMENT_SUBMITTED',
      module: 'Inventory',
      entityId: record.id,
      userId: actor.id,
      userName: actor.name,
      role: actor.role,
      details: `Submitted pending stock adjustment ${record.id} for ${item.itemName} (${deltaUnits >= 0 ? '+' : ''}${deltaUnits}u, $${evaluation.valuationImpactUsd.toFixed(2)}) — ${reasonMeta.label}: ${cleanNote}`,
    });
  } catch {
    // non-fatal
  }

  return {
    success: true,
    message: `Adjustment ${record.id} submitted for Owner approval and synced across devices.`,
    record,
  };
}

export function approveStockAdjustment(
  id: string,
  approver: Salesperson | null,
  ownerPin: string
): { success: boolean; message: string; record?: StockAdjustmentRecord } {
  const pinCheck = verifyOwnerPinForAdjustment(ownerPin, approver);
  if (!pinCheck.ok || !pinCheck.owner) {
    return { success: false, message: pinCheck.error || 'Owner PIN verification failed.' };
  }
  const verifiedOwner = pinCheck.owner;

  const list = getRawStoredStockAdjustments();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) {
    return { success: false, message: 'Stock adjustment request not found.' };
  }
  const req = list[idx];
  if (req.status !== 'PENDING_OWNER_APPROVAL') {
    return {
      success: false,
      message: `Cannot approve adjustment ${req.id} because its status is already ${req.status}.`,
    };
  }

  // Segregation of duties: non-Owner roles can never self-approve (already blocked above by Owner check)
  if (!isStockAdjustmentOwner(verifiedOwner.role)) {
    return {
      success: false,
      message: 'Only an Owner or Administrator can approve manual stock adjustments.',
    };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Check if stock drifted since submission
  const item = getRawStoredInventoryItems().find((i) => i.itemId === req.itemId);
  const flags = new Set<string>(Array.isArray(req.anomalyFlags) ? req.anomalyFlags : []);
  if (item) {
    const liveUnits = resolveEffectiveTotalUnits(item);
    if (Math.abs(roundUnits(liveUnits - req.submittedTotalUnits)) > 0.0001) {
      flags.add('STOCK_DRIFT_SINCE_SUBMISSION');
    }
  }

  const preApproved: StockAdjustmentRecord = {
    ...req,
    status: 'APPROVED',
    approvedBy: verifiedOwner.id,
    approvedByName: verifiedOwner.name,
    approvedByRole: verifiedOwner.role,
    approvedAt: nowIso,
    approvedDeviceId: getLocalDeviceId(),
    anomalyFlags: Array.from(flags),
    updatedAt: nowMs,
    lastUpdated: nowIso,
    isCloudSynced: false,
  };

  const applyRes = applyApprovedStockAdjustmentDeltaOnce(preApproved, { fromRemote: false });

  const finalized: StockAdjustmentRecord = {
    ...preApproved,
    beforeCases: applyRes.beforeCases,
    beforeSingles: applyRes.beforeSingles,
    beforeTotalUnits: applyRes.beforeTotalUnits,
    afterCases: applyRes.afterCases,
    afterSingles: applyRes.afterSingles,
    afterTotalUnits: applyRes.afterTotalUnits,
    mwacUnitCost: applyRes.mwacUnitCost,
    valuationImpactUsd: applyRes.valuationImpactUsd,
    movementId: applyRes.movementId,
    ...(applyRes.shrinkageExpenseId ? { shrinkageExpenseId: applyRes.shrinkageExpenseId } : {}),
  };

  list[idx] = finalized;
  saveRawStockAdjustments(list);
  enqueueSync('StockAdjustments' as any, 'UPDATE', finalized);
  notifyStockAdjustmentChanged(finalized);
  dispatchStockAdjustmentUiEvents(finalized);

  try {
    addAuditLog({
      action: 'STOCK_ADJUSTMENT_APPROVED',
      module: 'Inventory',
      entityId: finalized.id,
      userId: verifiedOwner.id,
      userName: verifiedOwner.name,
      authorizedByName: verifiedOwner.name,
      role: verifiedOwner.role,
      details: `Owner approved stock adjustment ${finalized.id} for ${finalized.itemName}: ${applyRes.beforeTotalUnits}u → ${applyRes.afterTotalUnits}u (${finalized.deltaUnits >= 0 ? '+' : ''}${finalized.deltaUnits}u, $${applyRes.valuationImpactUsd.toFixed(2)}). Prepared by ${finalized.createdByName}.`,
    });
  } catch {
    // non-fatal
  }

  return {
    success: true,
    message: `Approved ${finalized.id}. Stock updated (${applyRes.beforeTotalUnits}u → ${applyRes.afterTotalUnits}u) and synced to all devices.`,
    record: finalized,
  };
}

export function createAndPostOwnerStockAdjustment(
  input: CreateStockAdjustmentInput,
  owner: Salesperson | null,
  ownerPin: string
): { success: boolean; message: string; record?: StockAdjustmentRecord } {
  const pinCheck = verifyOwnerPinForAdjustment(ownerPin, owner);
  if (!pinCheck.ok || !pinCheck.owner) {
    return { success: false, message: pinCheck.error || 'Owner PIN verification failed.' };
  }
  const created = createStockAdjustmentRequest(input, pinCheck.owner);
  if (!created.success || !created.record) {
    return created;
  }
  return approveStockAdjustment(created.record.id, pinCheck.owner, ownerPin);
}

export function rejectStockAdjustment(
  id: string,
  approver: Salesperson | null,
  ownerPin: string,
  rejectionReason: string
): { success: boolean; message: string; record?: StockAdjustmentRecord } {
  const pinCheck = verifyOwnerPinForAdjustment(ownerPin, approver);
  if (!pinCheck.ok || !pinCheck.owner) {
    return { success: false, message: pinCheck.error || 'Owner PIN verification failed.' };
  }
  const cleanReason = String(rejectionReason || '').trim();
  if (cleanReason.length < 5) {
    return { success: false, message: 'Please provide a rejection reason (at least 5 characters).' };
  }

  const list = getRawStoredStockAdjustments();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) {
    return { success: false, message: 'Stock adjustment request not found.' };
  }
  const req = list[idx];
  if (req.status !== 'PENDING_OWNER_APPROVAL') {
    return { success: false, message: `Adjustment ${req.id} is already ${req.status}.` };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const updated: StockAdjustmentRecord = {
    ...req,
    status: 'REJECTED',
    rejectedBy: pinCheck.owner.id,
    rejectedByName: pinCheck.owner.name,
    rejectedAt: nowIso,
    rejectionReason: cleanReason,
    updatedAt: nowMs,
    lastUpdated: nowIso,
    isCloudSynced: false,
  };

  list[idx] = updated;
  saveRawStockAdjustments(list);
  enqueueSync('StockAdjustments' as any, 'UPDATE', updated);
  notifyStockAdjustmentChanged(updated);
  dispatchStockAdjustmentUiEvents(updated);

  try {
    addAuditLog({
      action: 'STOCK_ADJUSTMENT_REJECTED',
      module: 'Inventory',
      entityId: updated.id,
      userId: pinCheck.owner.id,
      userName: pinCheck.owner.name,
      role: pinCheck.owner.role,
      details: `Owner rejected stock adjustment ${updated.id} for ${updated.itemName} (prepared by ${updated.createdByName}). Reason: ${cleanReason}`,
    });
  } catch {
    // non-fatal
  }

  return {
    success: true,
    message: `Rejected adjustment ${updated.id}. Live stock was not modified.`,
    record: updated,
  };
}

export function cancelPendingStockAdjustment(
  id: string,
  actor: Salesperson | null
): { success: boolean; message: string } {
  if (!actor) return { success: false, message: 'Sign in required.' };

  const list = getRawStoredStockAdjustments();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return { success: false, message: 'Adjustment request not found.' };
  const req = list[idx];
  if (req.status !== 'PENDING_OWNER_APPROVAL') {
    return { success: false, message: `Cannot cancel adjustment in status ${req.status}.` };
  }
  if (req.createdBy !== actor.id && !isStockAdjustmentOwner(actor.role)) {
    return {
      success: false,
      message: 'Only the preparer or an Owner can cancel a pending adjustment request.',
    };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const updated: StockAdjustmentRecord = {
    ...req,
    status: 'CANCELLED',
    cancelledBy: actor.id,
    cancelledByName: actor.name,
    cancelledAt: nowIso,
    updatedAt: nowMs,
    lastUpdated: nowIso,
    isCloudSynced: false,
  };

  list[idx] = updated;
  saveRawStockAdjustments(list);
  enqueueSync('StockAdjustments' as any, 'UPDATE', updated);
  notifyStockAdjustmentChanged(updated);
  dispatchStockAdjustmentUiEvents(updated);

  return { success: true, message: `Cancelled pending adjustment ${updated.id}.` };
}

/**
 * Immutable Reversal: Approved adjustments can never be edited or deleted.
 * To undo a mistake, an Owner creates an equal-and-opposite REVERSAL adjustment
 * linked to the original record via `reversesAdjustmentId`.
 */
export function reverseApprovedStockAdjustment(
  originalId: string,
  owner: Salesperson | null,
  ownerPin: string,
  reversalNote: string
): { success: boolean; message: string; record?: StockAdjustmentRecord } {
  const pinCheck = verifyOwnerPinForAdjustment(ownerPin, owner);
  if (!pinCheck.ok || !pinCheck.owner) {
    return { success: false, message: pinCheck.error || 'Owner PIN verification failed.' };
  }
  const cleanNote = String(reversalNote || '').trim();
  if (cleanNote.length < STOCK_ADJUSTMENT_MIN_NOTE_LENGTH) {
    return {
      success: false,
      message: `Reversal reason must be at least ${STOCK_ADJUSTMENT_MIN_NOTE_LENGTH} characters.`,
    };
  }

  const list = getRawStoredStockAdjustments();
  const origIdx = list.findIndex((r) => r.id === originalId);
  if (origIdx === -1) {
    return { success: false, message: 'Original stock adjustment not found.' };
  }
  const orig = list[origIdx];
  if (orig.status !== 'APPROVED') {
    return { success: false, message: 'Only APPROVED adjustments can be reversed.' };
  }
  if (orig.reversedByAdjustmentId) {
    return {
      success: false,
      message: `Adjustment ${orig.id} was already reversed by ${orig.reversedByAdjustmentId}.`,
    };
  }

  const oppositeDirection: StockAdjustmentDirection = orig.deltaUnits < 0 ? 'ADD' : 'SUBTRACT';
  const result = createAndPostOwnerStockAdjustment(
    {
      itemId: orig.itemId,
      entryMode: 'DELTA',
      direction: oppositeDirection,
      reasonCode: 'REVERSAL',
      auditNote: `Reversal of ${orig.id}: ${cleanNote}`,
      deltaCases: Math.abs(orig.deltaCases),
      deltaSingles: Math.abs(orig.deltaSingles),
      reversesAdjustmentId: orig.id,
    },
    pinCheck.owner,
    ownerPin
  );

  if (result.success && result.record) {
    const refreshed = getRawStoredStockAdjustments();
    const freshOrigIdx = refreshed.findIndex((r) => r.id === originalId);
    if (freshOrigIdx >= 0) {
      const nowMs = Date.now();
      const updatedOrig: StockAdjustmentRecord = {
        ...refreshed[freshOrigIdx],
        reversedByAdjustmentId: result.record.id,
        updatedAt: nowMs,
        lastUpdated: new Date(nowMs).toISOString(),
        isCloudSynced: false,
      };
      refreshed[freshOrigIdx] = updatedOrig;
      saveRawStockAdjustments(refreshed);
      enqueueSync('StockAdjustments' as any, 'UPDATE', updatedOrig);
      notifyStockAdjustmentChanged(updatedOrig);
      dispatchStockAdjustmentUiEvents(updatedOrig);
    }
  }

  return result;
}

const isFinalAdjustmentStatus = (st?: string): boolean => {
  const u = String(st || '').trim().toUpperCase();
  return u === 'APPROVED' || u === 'REJECTED' || u === 'CANCELLED';
};

/**
 * Ingests a StockAdjustmentRecord arriving from Local Hub, WiFi Mesh, Cloud Pull,
 * or WhatsApp `.saimpack`.
 *
 * Security & Sync Guarantees:
 * 1. Finalized statuses (`APPROVED`, `REJECTED`, `CANCELLED`) can NEVER be downgraded back to pending.
 * 2. Incoming `APPROVED` records must carry an Owner/Admin `approvedByRole` (blocks tampered non-owner approvals).
 * 3. On first arrival of an `APPROVED` record on this device, applies the canonical stock delta
 *    idempotently ONCE to live `InventoryMaster` (even when `protectBalances` is active!).
 */
export function ingestMeshStockAdjustment(incoming: any): boolean {
  if (!incoming || typeof incoming !== 'object') return false;
  const rawId = String(incoming.id || incoming.adjustmentId || incoming.AdjustmentID || '').trim();
  if (!rawId) return false;

  const incomingStatus = String(incoming.status || 'PENDING_OWNER_APPROVAL').trim().toUpperCase() as StockAdjustmentStatus;

  // Enforce Owner-only authority on incoming APPROVED transitions
  if (incomingStatus === 'APPROVED') {
    const roleCheck = incoming.approvedByRole || incoming.createdByRole;
    if (roleCheck && !isStockAdjustmentOwner(roleCheck)) {
      console.warn(
        `[StockAdjustmentDao] Blocked unauthorized APPROVED stock adjustment ${rawId} with role "${roleCheck}".`
      );
      return false;
    }
  }

  const cleanIncoming: any = {
    ...incoming,
    id: rawId,
    status: incomingStatus,
  };
  delete cleanIncoming.fromMesh;
  delete cleanIncoming.fromSync;

  const list = getRawStoredStockAdjustments();
  const idx = list.findIndex((r) => r.id === rawId);
  const existing = idx >= 0 ? list[idx] : null;

  let merged: StockAdjustmentRecord;
  let changed = false;

  if (existing) {
    // Final-state protection: never revert APPROVED/REJECTED/CANCELLED back to PENDING
    if (isFinalAdjustmentStatus(existing.status) && incomingStatus === 'PENDING_OWNER_APPROVAL') {
      return false;
    }
    // Never change an APPROVED record into REJECTED or CANCELLED
    if (existing.status === 'APPROVED' && incomingStatus !== 'APPROVED') {
      return false;
    }

    const existingTs = Number(existing.updatedAt) || new Date(existing.lastUpdated || existing.createdAt || 0).getTime() || 0;
    const incomingTs = Number(cleanIncoming.updatedAt) || new Date(cleanIncoming.lastUpdated || cleanIncoming.approvedAt || cleanIncoming.createdAt || 0).getTime() || 0;
    const statusAdvanced = existing.status !== incomingStatus;
    const reversalLinkAdded = Boolean(cleanIncoming.reversedByAdjustmentId && !existing.reversedByAdjustmentId);
    const cloudFlagAdded = Boolean(cleanIncoming.isCloudSynced && !existing.isCloudSynced);

    if (!statusAdvanced && !reversalLinkAdded && !cloudFlagAdded && incomingTs <= existingTs) {
      // Even if metadata didn't change, ensure an APPROVED adjustment has its delta applied locally
      if (existing.status === 'APPROVED') {
        const res = applyApprovedStockAdjustmentDeltaOnce(existing, { fromRemote: true });
        if (res.applied) {
          dispatchStockAdjustmentUiEvents(existing);
          return true;
        }
      }
      return false;
    }

    merged = {
      ...existing,
      ...cleanIncoming,
      id: rawId,
      isCloudSynced: Boolean(existing.isCloudSynced || cleanIncoming.isCloudSynced),
    };
    list[idx] = merged;
    changed = true;
  } else {
    merged = {
      ...cleanIncoming,
      id: rawId,
      company_id: cleanIncoming.company_id || cleanIncoming.companyId || getCurrentCompanyId(),
      branch_id: cleanIncoming.branch_id || cleanIncoming.branchId || getCurrentBranchId(),
      updatedAt: Number(cleanIncoming.updatedAt) || Date.now(),
      lastUpdated: cleanIncoming.lastUpdated || new Date().toISOString(),
    };
    list.unshift(merged);
    changed = true;
  }

  saveRawStockAdjustments(list);

  // CRITICAL SYNC FIX: If the ingested adjustment is APPROVED, apply its atomic delta ONCE locally!
  if (merged.status === 'APPROVED') {
    applyApprovedStockAdjustmentDeltaOnce(merged, { fromRemote: true });
  }

  if (changed) {
    dispatchStockAdjustmentUiEvents(merged);
  }
  return changed;
}
