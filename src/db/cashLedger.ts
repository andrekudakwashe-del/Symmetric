import {
  CashMovement,
  CashMovementType,
  CashMovementDirection,
  CashMovementStatus,
  CashMovementSource,
} from '../types';

export type { CashMovement };

export const CASH_MOVEMENTS_STORAGE_KEY = 'saimetric_room_cash_movements';
export const IDB_STORE_NAME = 'cashMovements';

/**
 * Helper to get currently active branch ID from storage or session
 */
export const getActiveBranchId = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const sessionUserRaw = window.localStorage.getItem('saimetric_room_session_user');
      if (sessionUserRaw) {
        const u = JSON.parse(sessionUserRaw);
        if (u?.branchId || u?.branch_id) return u.branchId || u.branch_id;
      }
      return window.localStorage.getItem('saimetric_room_current_branch_id') || 'BR-MAIN';
    } catch {
      return 'BR-MAIN';
    }
  }
  return 'BR-MAIN';
};

/**
 * Helper to get currently active company ID from storage or session
 */
export const getActiveCompanyId = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const sessionUserRaw = window.localStorage.getItem('saimetric_room_session_user');
      if (sessionUserRaw) {
        const u = JSON.parse(sessionUserRaw);
        if (u?.companyId || u?.company_id) return u.companyId || u.company_id;
      }
      return window.localStorage.getItem('saimetric_room_current_company_id') || 'COMP-001';
    } catch {
      return 'COMP-001';
    }
  }
  return 'COMP-001';
};

/**
 * Helper to build standard shiftId from staffId, date, and branchId
 */
export const getShiftId = (staffId: string, date: string, branchId?: string): string => {
  const cleanStaff = (staffId || 'staff').trim();
  const cleanDate = (date || new Date().toISOString().split('T')[0]).trim();
  const cleanBranch = (branchId || getActiveBranchId() || 'BR-MAIN').trim();
  return `${cleanStaff}_${cleanDate}_${cleanBranch}`;
};

/**
 * Initialize IndexedDB with required object store and indexes
 */
import { initIndexedDB } from './indexedDBService';

export const initCashLedgerIndexedDB = (): Promise<IDBDatabase | null> => {
  return initIndexedDB();
};

// Fire initial IDB setup in browser
if (typeof window !== 'undefined') {
  setTimeout(() => {
    initCashLedgerIndexedDB().catch(() => {});
  }, 50);
}

// In-memory fallback
let memoryMovements: CashMovement[] = [];

/**
 * Read all movements from storage
 */
export const getAllMovements = (): CashMovement[] => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryMovements;
  }
  try {
    const raw = window.localStorage.getItem(CASH_MOVEMENTS_STORAGE_KEY);
    if (!raw) return memoryMovements;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading cashMovements:', err);
    return memoryMovements;
  }
};

/**
 * Save movements to localStorage and sync to IndexedDB
 */
const saveAllMovements = (movements: CashMovement[]) => {
  memoryMovements = movements;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CASH_MOVEMENTS_STORAGE_KEY, JSON.stringify(movements));
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(
          new CustomEvent('saimetric_cash_movements_updated', {
            detail: { count: movements.length },
          })
        );
        try {
          window.dispatchEvent(new Event('storage'));
        } catch {
          // Safe fallback
        }
      }
    } catch (err) {
      console.error('Error saving cashMovements to localStorage:', err);
    }
  }

  // Also sync asynchronously to IndexedDB if available
  if (typeof window !== 'undefined' && window.indexedDB) {
    initCashLedgerIndexedDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.clear();
        movements.forEach((m) => store.put(m));
      } catch {
        // Silent IDB fallback
      }
    });
  }
};

/**
 * Add a movement to the ledger
 */
export const addMovement = (
  m: Omit<CashMovement, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  options?: { allowNegativeBalance?: boolean }
): CashMovement => {
  const currentBranch = m.branch_id || getActiveBranchId();
  const currentCompany = m.company_id || getActiveCompanyId();
  const shiftId = m.shiftId || getShiftId(m.staffId, m.date, currentBranch);

  // Validate supervisor lift against available drawer balance
  if (
    m.type === 'supervisor_lift' &&
    m.affectsDrawer &&
    (m.status === 'approved' || m.status === 'pending-POS-auto') &&
    !options?.allowNegativeBalance
  ) {
    const currency = m.currency || 'USD';
    const currentBal = computeDrawerBalance(shiftId, currency, currentBranch);
    if (m.amount > currentBal) {
      throw new Error(
        `Supervisor lift of $${m.amount.toFixed(2)} exceeds available drawer balance of $${currentBal.toFixed(2)}.`
      );
    }
  }

  const now = new Date().toISOString();
  const id = m.id || `MOV-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const fullMovement: CashMovement = {
    ...m,
    id,
    shiftId,
    branch_id: currentBranch,
    company_id: currentCompany,
    createdAt: now,
    updatedAt: now,
  };

  const current = getAllMovements();
  const updated = [fullMovement, ...current];
  saveAllMovements(updated);
  return fullMovement;
};

/**
 * Update an existing movement
 */
export const updateMovement = (id: string, patch: Partial<CashMovement>): CashMovement | null => {
  const current = getAllMovements();
  const index = current.findIndex((m) => m.id === id);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const updatedItem: CashMovement = {
    ...current[index],
    ...patch,
    updatedAt: now,
  };

  const next = [...current];
  next[index] = updatedItem;
  saveAllMovements(next);
  return updatedItem;
};

/**
 * Delete a movement
 */
export const deleteMovement = (id: string): boolean => {
  const current = getAllMovements();
  const filtered = current.filter((m) => m.id !== id);
  if (filtered.length === current.length) return false;
  saveAllMovements(filtered);
  return true;
};

/**
 * Query movements with a filter object or predicate function
 * Strictly isolated to current active branch unless explicitly requested for ALL
 */
export const getMovements = (
  filter?: Partial<CashMovement> | ((m: CashMovement) => boolean),
  branchId?: string
): CashMovement[] => {
  const all = getAllMovements();
  const targetBranch = branchId || getActiveBranchId();

  // Strict branch isolation
  const branchFiltered = all.filter((m) => {
    if (branchId === 'ALL') return true;
    const movBranch = m.branch_id || (m as any).branchId || 'BR-MAIN';
    return movBranch === targetBranch;
  });

  if (!filter) return branchFiltered;

  if (typeof filter === 'function') {
    return branchFiltered.filter(filter as any);
  }

  return branchFiltered.filter((m) => {
    return Object.entries(filter).every(([key, value]) => {
      return (m as any)[key] === value;
    });
  });
};

/**
 * Helper to test if a movement belongs to a given shiftId.
 * Supports exact match, or matching by staffId_date and branchId.
 */
export const matchesShift = (m: CashMovement, shiftId: string, branchId?: string): boolean => {
  const parts = shiftId.split('_');
  const targetStaff = parts[0] || '';
  const targetDate = parts[1] || '';
  const targetBranch = parts[2] || branchId || getActiveBranchId();

  // Strict branch isolation: movement branch must match targetBranch
  const movBranch = m.branch_id || (m as any).branchId || 'BR-MAIN';
  if (targetBranch && movBranch !== targetBranch) {
    return false;
  }

  // Exact shiftId match
  if (m.shiftId === shiftId) return true;
  if (m.shiftId === `${targetStaff}_${targetDate}_${targetBranch}`) return true;
  if (m.shiftId === `${targetStaff}_${targetDate}`) {
    // Legacy movement without branch in shiftId
    if (movBranch === targetBranch) return true;
  }

  // Normalized ID match (e.g. '001_2026-09-22' vs '1_2026-09-22')
  if (targetStaff && targetDate && m.date === targetDate) {
    const normM = String(m.staffId || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
    const normT = String(targetStaff).replace(/^usr-|^staff-|^0+/, '').toLowerCase();
    if (normM && normT && normM === normT) {
      if (movBranch === targetBranch) return true;
    }
  }
  return false;
};

/**
 * Compute the live drawer balance for a shift.
 *
 * Formula:
 * computeDrawerBalance(shiftId) =
 *     sum(opening_float)
 *   + sum(float_adjustment)
 *   + sum(cash_sale)
 *   + sum(credit_cash_payment)
 *   + sum(credit_upfront_deposit)
 *   + sum(change_received)
 *   − sum(change_paid)
 *   − sum(petty_cash)
 *   − sum(supplier_payment)
 *   − sum(ecocash_cash_out)
 *   − sum(zig_cash_out)
 *   − sum(supervisor_lift)
 *
 * Only includes: shiftId matches, status in ['approved', 'pending-POS-auto'], affectsDrawer === true.
 * Excludes: physical_count (snapshot, not a movement).
 */
export const computeDrawerBalance = (shiftId: string, currency: string = 'USD', branchId?: string): number => {
  const targetBranch = branchId || shiftId.split('_')[2] || getActiveBranchId();
  const all = getAllMovements().filter((m) => {
    const movBranch = m.branch_id || (m as any).branchId || 'BR-MAIN';
    return movBranch === targetBranch;
  });
  const validStatuses: CashMovementStatus[] = ['approved', 'pending-POS-auto'];

  let balance = 0;
  const seenSupplierPayments = new Set<string>();
  const seenChangeReceivedInvoices = new Set<string>();
  const seenCreditDepositInvoices = new Set<string>();

  all.forEach((m) => {
    if (m.type === 'credit_upfront_deposit' && matchesShift(m, shiftId, targetBranch)) {
      const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
      if (invMatch) seenCreditDepositInvoices.add(invMatch);
    }
  });

  all.forEach((m) => {
    if (!matchesShift(m, shiftId, targetBranch)) return;
    if (m.type === 'physical_count') return;
    if (!m.affectsDrawer) return;
    if (!validStatuses.includes(m.status)) return;
    // Multi-currency isolation: movements in different currencies do not mix in sums
    // Note: ecocash_cash_out and zig_cash_out represent physical USD cash leaving the drawer
    const movCurrency = (m.currency || 'USD').toUpperCase();
    const isPhysicalUsdCashOut = m.type === 'ecocash_cash_out' || m.type === 'zig_cash_out';
    if (currency && movCurrency !== currency.toUpperCase() && !(currency.toUpperCase() === 'USD' && isPhysicalUsdCashOut)) {
      return;
    }

    // Prevent double-counting supplier payments / direct procurements if logged in both GRV and Form 2
    if (m.type === 'supplier_payment') {
      const refKey = m.sourceRef || m.notes || m.id;
      if (seenSupplierPayments.has(refKey)) return;
      seenSupplierPayments.add(refKey);
    }

    // Prevent double-counting customer change received if logged in both POS and Form 3
    if (m.type === 'change_received') {
      const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
      if (invMatch) {
        if (seenChangeReceivedInvoices.has(invMatch)) return;
        seenChangeReceivedInvoices.add(invMatch);
      }
    }

    // Prevent double-counting credit upfront deposit if logged in both POS and Form 3
    if (m.type === 'credit_cash_payment') {
      const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
      const isPosDepositPayment = m.notes?.includes('deposit paid') || m.notes?.includes('POS Credit Sale Invoice');
      if (invMatch && isPosDepositPayment && seenCreditDepositInvoices.has(invMatch)) {
        return;
      }
    }

    const amt = Number(m.amount) || 0;

    switch (m.type) {
      case 'opening_float':
      case 'cash_sale':
      case 'credit_cash_payment':
      case 'credit_upfront_deposit':
      case 'change_received':
        balance += amt;
        break;

      case 'float_adjustment':
        // If direction is 'in', adds; if 'out', subtracts
        if (m.direction === 'out') {
          balance -= amt;
        } else {
          balance += amt;
        }
        break;

      case 'change_paid':
      case 'petty_cash':
      case 'supplier_payment':
      case 'ecocash_cash_out':
      case 'zig_cash_out':
      case 'supervisor_lift':
        balance -= amt;
        break;

      case 'ecocash_sale':
      case 'zig_sale':
        // Explicitly ignored for drawer balance (electronic non-cash)
        break;

      default:
        // Generic fallback by direction
        if (m.direction === 'in') balance += amt;
        else if (m.direction === 'out') balance -= amt;
        break;
    }
  });

  // Direct GRVs safety sync: ensure any Direct GRVs with till payments for this shift are accounted for
  try {
    const rawGrvs = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem('saimetric_direct_grvs')
      : null;
    if (rawGrvs) {
      const grvs = JSON.parse(rawGrvs);
      if (Array.isArray(grvs)) {
        const [targetStaff, targetDate] = shiftId.split('_');
        grvs.forEach((g: any) => {
          if (g.status === 'REJECTED') return;
          if (targetDate && g.date !== targetDate) return;
          const refKey = g.grvNumber || g.id;
          if (seenSupplierPayments.has(refKey)) return;

          if (g.payments && Array.isArray(g.payments)) {
            g.payments.forEach((p: any) => {
              const pStaff = String(p.userId || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
              const tStaff = String(targetStaff || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
              const staffMatch = !targetStaff || p.userId === targetStaff || (pStaff && tStaff && pStaff === tStaff);
              if (staffMatch && (Number(p.amount) || 0) > 0) {
                if (!seenSupplierPayments.has(refKey)) {
                  seenSupplierPayments.add(refKey);
                  balance -= Number(p.amount) || 0;
                }
              }
            });
          } else if (g.payFromTill && (Number(g.totalCost) || 0) > 0) {
            const gStaff = String(g.receivedByStaffId || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
            const tStaff = String(targetStaff || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
            const staffMatch = !targetStaff || g.receivedByStaffId === targetStaff || (gStaff && tStaff && gStaff === tStaff);
            if (staffMatch) {
              seenSupplierPayments.add(refKey);
              balance -= Number(g.totalCost) || 0;
            }
          }
        });
      }
    }
  } catch {}

  return Math.round(balance * 100) / 100;
};

/**
 * Compute the expected cash for a shift.
 * Same canonical formula as computeDrawerBalance; never subtracts physical_count.
 */
export const computeExpectedCash = (shiftId: string): number => {
  return computeDrawerBalance(shiftId);
};

/**
 * Compute variance between latest physical count and expected cash.
 *
 * counted  = latest physical_count for shift
 * expected = computeExpectedCash(shiftId)
 * variance = counted − expected
 * status   = |variance| < 0.01 ? "balanced" : variance > 0 ? "over" : "short"
 */
export const computeVariance = (
  shiftId: string
): {
  counted: number;
  expected: number;
  variance: number;
  status: 'balanced' | 'over' | 'short';
  lastCountTimestamp?: string;
} => {
  const all = getAllMovements();
  const counts = all
    .filter((m) => matchesShift(m, shiftId) && m.type === 'physical_count')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const latestCount = counts[0];
  const counted = latestCount ? Number(latestCount.amount) || 0 : 0;
  const expected = computeExpectedCash(shiftId);
  const variance = Math.round((counted - expected) * 100) / 100;

  let status: 'balanced' | 'over' | 'short' = 'balanced';
  if (Math.abs(variance) < 0.01) {
    status = 'balanced';
  } else if (variance > 0) {
    status = 'over';
  } else {
    status = 'short';
  }

  return {
    counted,
    expected,
    variance,
    status,
    lastCountTimestamp: latestCount?.timestamp,
  };
};

/**
 * Approve a pending movement (e.g. supervisor approving petty cash)
 */
export const approveMovement = (
  id: string,
  approverStaffId: string,
  approverStaffName?: string
): CashMovement | null => {
  return updateMovement(id, {
    status: 'approved',
    approvedBy: approverStaffId,
    approvedByName: approverStaffName,
    approvedAt: new Date().toISOString(),
  });
};

/**
 * Reject a pending movement
 */
export const rejectMovement = (id: string, approverStaffId: string): CashMovement | null => {
  return updateMovement(id, {
    status: 'rejected',
    approvedBy: approverStaffId,
    approvedAt: new Date().toISOString(),
  });
};

export interface ShiftLedgerBreakdown {
  shiftId: string;
  openingFloat: number;
  cashSales: number;
  creditPayments: number;
  changeReceived: number;
  expenses: number;
  directProcurements: number;
  cashLift: number;
  changePaid: number;
  ecocashCashOut: number;
  zigCashOut: number;
  ecocashSales?: number;
  zigSales?: number;
  pettyCash: number;
  cashInTotal: number;
  cashOutTotal: number;
  expectedCash: number;
  physicalCount: number | null;
  hasCounted: boolean;
  variance: number;
  status: 'balanced' | 'over' | 'short' | 'pending';
  movementsCount: number;
}

/**
 * Get detailed live reconciliation breakdown for a shift from cashMovements ledger.
 */
export const getShiftLedgerBreakdown = (shiftId: string, currency: string = 'USD'): ShiftLedgerBreakdown => {
  const all = getAllMovements();
  const validStatuses: CashMovementStatus[] = ['approved', 'pending-POS-auto'];

  let openingFloat = 0;
  let cashSales = 0;
  let creditPayments = 0;
  let changeReceived = 0;
  let expenses = 0;
  let directProcurements = 0;
  let cashLift = 0;
  let changePaid = 0;
  let ecocashCashOut = 0;
  let zigCashOut = 0;
  let ecocashSales = 0;
  let zigSales = 0;
  let pettyCash = 0;

  let physicalCount: number | null = null;
  let movementsCount = 0;
  const seenSupplierPayments = new Set<string>();
  const seenChangeReceivedInvoices = new Set<string>();
  const seenCreditDepositInvoices = new Set<string>();

  all.forEach((m) => {
    if (m.type === 'credit_upfront_deposit' && matchesShift(m, shiftId)) {
      const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
      if (invMatch) seenCreditDepositInvoices.add(invMatch);
    }
  });

  all.forEach((m) => {
    if (!matchesShift(m, shiftId)) return;

    if (m.type === 'ecocash_sale') {
      ecocashSales += Number(m.amount) || 0;
      return;
    }
    if (m.type === 'zig_sale') {
      zigSales += Number(m.amount) || 0;
      return;
    }
    // Multi-currency isolation:
    // Note: ecocash_cash_out and zig_cash_out represent physical USD cash leaving the drawer
    const movCurrency = (m.currency || 'USD').toUpperCase();
    const isPhysicalUsdCashOut = m.type === 'ecocash_cash_out' || m.type === 'zig_cash_out';
    if (currency && movCurrency !== currency.toUpperCase() && !(currency.toUpperCase() === 'USD' && isPhysicalUsdCashOut)) {
      return;
    }

    movementsCount++;

    if (m.type === 'physical_count') {
      physicalCount = Number(m.amount) || 0;
      return;
    }

    if (!m.affectsDrawer) return;
    if (!validStatuses.includes(m.status)) return;
    // Petty cash must be approved to affect drawer
    if (m.type === 'petty_cash' && m.status !== 'approved') return;

    // Prevent double-counting supplier payments / direct procurements if logged in both GRV and Form 2
    if (m.type === 'supplier_payment') {
      const refKey = m.sourceRef || m.notes || m.id;
      if (seenSupplierPayments.has(refKey)) return;
      seenSupplierPayments.add(refKey);
    }

    // Prevent double-counting customer change received if logged in both POS and Form 3
    if (m.type === 'change_received') {
      const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
      if (invMatch) {
        if (seenChangeReceivedInvoices.has(invMatch)) return;
        seenChangeReceivedInvoices.add(invMatch);
      }
    }

    // Prevent double-counting credit upfront deposit if logged in both POS and Form 3
    if (m.type === 'credit_cash_payment') {
      const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
      const isPosDepositPayment = m.notes?.includes('deposit paid') || m.notes?.includes('POS Credit Sale Invoice');
      if (invMatch && isPosDepositPayment && seenCreditDepositInvoices.has(invMatch)) {
        return;
      }
    }

    const amt = Number(m.amount) || 0;

    switch (m.type) {
      case 'opening_float':
        openingFloat += amt;
        break;
      case 'float_adjustment':
        if (m.direction === 'out') openingFloat -= amt;
        else openingFloat += amt;
        break;
      case 'cash_sale':
        if (m.direction === 'in') cashSales += amt;
        break;
      case 'credit_cash_payment':
      case 'credit_upfront_deposit':
        creditPayments += amt;
        break;
      case 'change_received':
        changeReceived += amt;
        break;
      case 'change_paid':
        changePaid += amt;
        break;
      case 'petty_cash':
        pettyCash += amt;
        break;
      case 'supplier_payment':
        directProcurements += amt;
        break;
      case 'supervisor_lift':
        cashLift += amt;
        break;
      case 'ecocash_cash_out':
        ecocashCashOut += amt;
        break;
      case 'zig_cash_out':
        zigCashOut += amt;
        break;
      case 'expense':
        expenses += amt;
        break;
      default:
        if (m.direction === 'in') cashSales += amt;
        else if (m.direction === 'out') expenses += amt;
        break;
    }
  });

  // Direct GRVs safety sync: ensure any Direct GRVs with till payments for this shift are accounted for
  try {
    const rawGrvs = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem('saimetric_direct_grvs')
      : null;
    if (rawGrvs) {
      const grvs = JSON.parse(rawGrvs);
      if (Array.isArray(grvs)) {
        const [targetStaff, targetDate] = shiftId.split('_');
        grvs.forEach((g: any) => {
          if (g.status === 'REJECTED') return;
          if (targetDate && g.date !== targetDate) return;
          const refKey = g.grvNumber || g.id;
          if (seenSupplierPayments.has(refKey)) return;

          if (g.payments && Array.isArray(g.payments)) {
            g.payments.forEach((p: any) => {
              const pStaff = String(p.userId || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
              const tStaff = String(targetStaff || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
              const staffMatch = !targetStaff || p.userId === targetStaff || (pStaff && tStaff && pStaff === tStaff);
              if (staffMatch && (Number(p.amount) || 0) > 0) {
                if (!seenSupplierPayments.has(refKey)) {
                  seenSupplierPayments.add(refKey);
                  directProcurements += Number(p.amount) || 0;
                }
              }
            });
          } else if (g.payFromTill && (Number(g.totalCost) || 0) > 0) {
            const gStaff = String(g.receivedByStaffId || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
            const tStaff = String(targetStaff || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
            const staffMatch = !targetStaff || g.receivedByStaffId === targetStaff || (gStaff && tStaff && gStaff === tStaff);
            if (staffMatch) {
              seenSupplierPayments.add(refKey);
              directProcurements += Number(g.totalCost) || 0;
            }
          }
        });
      }
    }
  } catch {}

  const cashInTotal = Math.round((openingFloat + cashSales + creditPayments + changeReceived) * 100) / 100;
  const cashOutTotal =
    Math.round(
      (changePaid + pettyCash + directProcurements + cashLift + ecocashCashOut + zigCashOut + expenses) * 100
    ) / 100;
  const expectedCash = Math.round((cashInTotal - cashOutTotal) * 100) / 100;

  let variance = 0;
  let status: 'balanced' | 'over' | 'short' | 'pending' = 'pending';

  if (physicalCount !== null) {
    variance = Math.round((physicalCount - expectedCash) * 100) / 100;
    if (Math.abs(variance) < 0.01) {
      status = 'balanced';
    } else if (variance > 0) {
      status = 'over';
    } else {
      status = 'short';
    }
  } else {
    variance = Math.round((0 - expectedCash) * 100) / 100;
    status = 'pending';
  }

  return {
    shiftId,
    openingFloat: Math.round(openingFloat * 100) / 100,
    cashSales: Math.round(cashSales * 100) / 100,
    creditPayments: Math.round(creditPayments * 100) / 100,
    changeReceived: Math.round(changeReceived * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    directProcurements: Math.round(directProcurements * 100) / 100,
    cashLift: Math.round(cashLift * 100) / 100,
    changePaid: Math.round(changePaid * 100) / 100,
    ecocashCashOut: Math.round(ecocashCashOut * 100) / 100,
    zigCashOut: Math.round(zigCashOut * 100) / 100,
    ecocashSales: Math.round(ecocashSales * 100) / 100,
    zigSales: Math.round(zigSales * 100) / 100,
    pettyCash: Math.round(pettyCash * 100) / 100,
    cashInTotal,
    cashOutTotal,
    expectedCash,
    physicalCount,
    hasCounted: physicalCount !== null,
    variance,
    status,
    movementsCount,
  };
};

