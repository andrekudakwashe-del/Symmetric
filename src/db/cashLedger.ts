import {
  CashMovement,
  CashMovementType,
  CashMovementDirection,
  CashMovementStatus,
  CashMovementSource,
} from '../types';
import { extractInvoiceRef } from '../utils/idFormatters';
import { isSameDaySafe } from '../utils/dateUtils';
import { initIndexedDB, getAllFromIDBStore } from './indexedDBService';
import { getStored, setStored } from './roomStorageEngine';

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
        if (u?.branchId || u?.branch_id) return (u.branchId || u.branch_id).trim();
      }
      const cur = window.localStorage.getItem('saimetric_room_current_branch_id');
      if (cur && cur.trim() && cur !== 'ALL') return cur.trim();
      const regBranch = window.localStorage.getItem('saimetric_device_reg_branch_id');
      if (regBranch && regBranch.trim() && regBranch !== 'ALL') return regBranch.trim();
      const hubBranch = window.localStorage.getItem('saimetric_local_hub_branch_id');
      if (hubBranch && hubBranch.trim() && hubBranch !== 'UNASSIGNED') return hubBranch.trim();
      return cur || 'BR-MAIN';
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
  const n = new Date();
  const localToday = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  const cleanDate = (date || localToday).trim();
  const cleanBranch = (branchId || getActiveBranchId() || 'BR-MAIN').trim();
  return `${cleanStaff}_${cleanDate}_${cleanBranch}`;
};

const normLedgerTenant = (compId?: string | null): string => {
  const c = String(compId || '').trim().toUpperCase();
  if (!c || c === 'COMP-001' || c === 'COMP-MASTER' || c === 'DEFAULT') return 'COMP-001';
  return c;
};

const isCashCompanyInScope = (recordCompanyId?: string | null, targetCompanyId?: string | null): boolean => {
  if (!targetCompanyId) return true;
  return normLedgerTenant(recordCompanyId) === normLedgerTenant(targetCompanyId);
};

const MAIN_BRANCH_ALIASES = new Set(['1', 'br-main', 'br001', 'hq-01', 'sai-01']);

const getBranchAliasesForTarget = (targetBranch: string): Set<string> => {
  const cleanTarget = String(targetBranch || '').trim().toLowerCase();
  const aliases = new Set<string>([cleanTarget]);
  if (MAIN_BRANCH_ALIASES.has(cleanTarget)) {
    MAIN_BRANCH_ALIASES.forEach((a) => aliases.add(a));
  }
  try {
    const branches = getStored<any[]>('saimetric_room_branches', []);
    if (Array.isArray(branches) && branches.length > 0) {
      const matched = branches.find((b: any) =>
        [b?.branchId, b?.id, b?.code, b?.branch_id].some(
          (v) => v && String(v).trim().toLowerCase() === cleanTarget
        )
      );
      if (matched) {
        [matched.branchId, matched.id, matched.code, matched.branch_id].forEach((v) => {
          if (v) aliases.add(String(v).trim().toLowerCase());
        });
        if (matched.isMain) {
          MAIN_BRANCH_ALIASES.forEach((a) => aliases.add(a));
        }
      }
    }
  } catch {
    // ignore storage parse fallback
  }
  return aliases;
};

const isCashBranchInScope = (recordBranchId?: string | null, targetBranchId?: string | null): boolean => {
  const cleanTarget = String(targetBranchId || '').trim().toLowerCase();
  if (!cleanTarget || cleanTarget === 'all') return true;
  const cleanRecord = String(recordBranchId || '').trim().toLowerCase();
  if (!cleanRecord || cleanRecord === 'all') return true;
  if (cleanRecord === cleanTarget) return true;
  return getBranchAliasesForTarget(cleanTarget).has(cleanRecord);
};

export const initCashLedgerIndexedDB = (): Promise<IDBDatabase | null> => {
  return initIndexedDB();
};

// In-memory fallback
let memoryMovements: CashMovement[] = [];

/**
 * Read all movements from storage safely via roomStorageEngine (handles IndexedDB overflow sentinels)
 */
export const getAllMovements = (): CashMovement[] => {
  try {
    const stored = getStored<CashMovement[]>(CASH_MOVEMENTS_STORAGE_KEY, []);
    if (Array.isArray(stored)) {
      if (stored.length > 0 || memoryMovements.length === 0) {
        memoryMovements = stored;
      }
      return stored.length > 0 ? stored : memoryMovements;
    }
    return Array.isArray(memoryMovements) ? memoryMovements : [];
  } catch (err) {
    console.error('Error reading cashMovements:', err);
    return Array.isArray(memoryMovements) ? memoryMovements : [];
  }
};

// Fire initial IDB setup and hydrate cash movements if localStorage overflowed
if (typeof window !== 'undefined') {
  setTimeout(() => {
    initCashLedgerIndexedDB()
      .then(async () => {
        if (getAllMovements().length === 0) {
          const idbRows = await getAllFromIDBStore<CashMovement>(IDB_STORE_NAME).catch(() => []);
          if (Array.isArray(idbRows) && idbRows.length > 0) {
            memoryMovements = idbRows;
            setStored(CASH_MOVEMENTS_STORAGE_KEY, idbRows, { skipIdbOverwriteIfExisting: true });
            if (typeof window.dispatchEvent === 'function') {
              window.dispatchEvent(
                new CustomEvent('saimetric_cash_movements_updated', {
                  detail: { count: idbRows.length },
                })
              );
            }
          }
        }
      })
      .catch(() => {});
  }, 50);
}

/**
 * Save movements via roomStorageEngine (safe localStorage + IndexedDB overflow) and sync to cashMovements IDB store
 */
const saveAllMovements = (movements: CashMovement[]) => {
  const safeMovements = Array.isArray(movements) ? movements : [];
  memoryMovements = safeMovements;
  try {
    setStored(CASH_MOVEMENTS_STORAGE_KEY, safeMovements);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('saimetric_cash_movements_updated', {
          detail: { count: safeMovements.length },
        })
      );
    }
  } catch (err) {
    console.error('Error saving cashMovements:', err);
  }

  // Also sync asynchronously to dedicated cashMovements IndexedDB store if available
  if (typeof window !== 'undefined' && window.indexedDB) {
    initCashLedgerIndexedDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.clear();
        safeMovements.forEach((m) => store.put(m));
      } catch {
        // Silent IDB fallback
      }
    });
  }
};

export type CashMovementListener = (movement: CashMovement) => void;
const cashMovementListeners: Set<CashMovementListener> = new Set();
export const onCashMovementCreated = (listener: CashMovementListener) => {
  cashMovementListeners.add(listener);
  return () => {
    cashMovementListeners.delete(listener);
  };
};
export const notifyCashMovementCreated = (movement: CashMovement) => {
  cashMovementListeners.forEach((fn) => {
    try {
      fn(movement);
    } catch (e) {
      console.error('cashMovementListener error:', e);
    }
  });
};

/**
 * Add a movement to the ledger
 */
export const addMovement = (
  m: Omit<CashMovement, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; fromMesh?: boolean },
  options?: { allowNegativeBalance?: boolean }
): CashMovement => {
  const currentBranch = m.branch_id || getActiveBranchId();
  const currentCompany = m.company_id || getActiveCompanyId();
  const shiftId = m.shiftId || getShiftId(m.staffId, m.date, currentBranch);

  // Supervisor cash lifts are strictly blind: never block or reveal expected book drawer balance.
  // Any physical overage/shortage is reconciled cleanly at Form 4 EOD cash balancing.

  const current = getAllMovements();

  // Idempotency guard: prevent duplicate POS/Form2/Custody movements with same (type, sourceRef, shiftId, branch)
  const idempotentRefTypes: CashMovementType[] = [
    'ecocash_cash_out',
    'zig_cash_out',
    'ecocash_sale',
    'zig_sale',
    'cash_sale',
    'opening_float',
    'float_adjustment',
    'supervisor_lift',
  ];
  if (m.id) {
    const existingById = current.find((item) => item.id === m.id);
    if (existingById) return existingById;
  }
  if (m.sourceRef && idempotentRefTypes.includes(m.type) && m.status !== 'rejected') {
    const normRef = String(m.sourceRef).trim().toUpperCase();
    const existingByRef = current.find(
      (item) =>
        item.status !== 'rejected' &&
        item.type === m.type &&
        (item.branch_id || 'BR-MAIN') === currentBranch &&
        item.shiftId === shiftId &&
        item.sourceRef &&
        String(item.sourceRef).trim().toUpperCase() === normRef
    );
    if (existingByRef) return existingByRef;
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

  const updated = [fullMovement, ...current];
  saveAllMovements(updated);

  if (!m.fromMesh) {
    notifyCashMovementCreated(fullMovement);
  }

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
 * Reassign all cash movements referencing oldStaffId (either directly on staffId or as shiftId prefix)
 * to canonical newStaffId when merging duplicate staff profiles.
 */
export const reassignMovementsStaffId = (oldStaffId: string, newStaffId: string): number => {
  const cleanOld = String(oldStaffId || '').trim();
  const cleanNew = String(newStaffId || '').trim();
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return 0;

  const current = getAllMovements();
  let updatedCount = 0;
  const oldPrefix = `${cleanOld}_`;
  const next = current.map((m) => {
    const mStaff = String(m.staffId || '').trim();
    const mShift = String(m.shiftId || '');
    const hasStaffMatch = mStaff === cleanOld;
    const hasShiftMatch = mShift.startsWith(oldPrefix);
    if (!hasStaffMatch && !hasShiftMatch) return m;
    updatedCount++;
    return {
      ...m,
      staffId: hasStaffMatch ? cleanNew : m.staffId,
      shiftId: hasShiftMatch ? `${cleanNew}_${mShift.slice(oldPrefix.length)}` : m.shiftId,
      updatedAt: new Date().toISOString(),
    };
  });

  if (updatedCount > 0) {
    saveAllMovements(next);
  }
  return updatedCount;
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
  const targetCompany = getActiveCompanyId();

  // Tenant & alias-aware branch isolation
  const branchFiltered = all.filter((m) => {
    const movComp = m.company_id || (m as any).companyId;
    if (!isCashCompanyInScope(movComp, targetCompany)) return false;
    if (branchId === 'ALL') return true;
    const movBranch = m.branch_id || (m as any).branchId || 'BR-MAIN';
    return isCashBranchInScope(movBranch, targetBranch);
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
 * Supports exact match, or matching by staffId_date and branchId (with canonical branch aliases).
 */
export const matchesShift = (m: CashMovement, shiftId: string, branchId?: string): boolean => {
  const parts = shiftId.split('_');
  const targetStaff = parts[0] || '';
  const targetDate = parts[1] || '';
  const targetBranch = parts[2] || branchId || getActiveBranchId();
  const targetCompany = getActiveCompanyId();

  const movComp = m.company_id || (m as any).companyId;
  if (!isCashCompanyInScope(movComp, targetCompany)) {
    return false;
  }

  // Alias-aware branch isolation: movement branch must match targetBranch
  const movBranch = m.branch_id || (m as any).branchId || 'BR-MAIN';
  if (targetBranch && !isCashBranchInScope(movBranch, targetBranch)) {
    return false;
  }

  // Exact shiftId match
  if (m.shiftId === shiftId) return true;
  if (m.shiftId === `${targetStaff}_${targetDate}_${targetBranch}`) return true;
  if (m.shiftId === `${targetStaff}_${targetDate}`) {
    // Legacy movement without branch in shiftId
    if (isCashBranchInScope(movBranch, targetBranch)) return true;
  }

  // Normalized ID match (e.g. '001_2026-09-22' vs '1_2026-09-22')
  if (targetStaff && targetDate && m.date === targetDate) {
    const normM = String(m.staffId || '').replace(/^usr-|^staff-|^0+/, '').toLowerCase();
    const normT = String(targetStaff).replace(/^usr-|^staff-|^0+/, '').toLowerCase();
    if (normM && normT && normM === normT) {
      if (isCashBranchInScope(movBranch, targetBranch)) return true;
    }
  }
  return false;
};

const normalizeStaffKey = (staffId?: string): string =>
  String(staffId || '').replace(/^usr-|^staff-|^0+/i, '').trim().toLowerCase();

const recordCountedSupplierGrvRefs = (
  m: CashMovement,
  seenGrvRefs: Set<string>
) => {
  const normStaff = normalizeStaffKey(m.staffId);
  const addRef = (raw?: string) => {
    const clean = String(raw || '').trim().toUpperCase();
    if (!clean) return;
    seenGrvRefs.add(`${normStaff}_${clean}`);
    seenGrvRefs.add(`_${clean}`);
  };

  if (m.sourceRef) {
    addRef(m.sourceRef);
    if (m.staffId) {
      const escapedStaff = m.staffId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      addRef(m.sourceRef.replace(new RegExp(`-${escapedStaff}$`, 'i'), ''));
    }
    const refMatches = m.sourceRef.match(/D?GRV-\d+(?:-\d+)?/gi);
    if (refMatches) refMatches.forEach(addRef);
  }
  if (m.notes) {
    const noteMatches = m.notes.match(/D?GRV-[A-Za-z0-9-]+/gi);
    if (noteMatches) noteMatches.forEach(addRef);
  }
};

const computeMissingDirectGrvPayouts = (
  shiftId: string,
  targetBranch: string | undefined,
  seenGrvRefs: Set<string>,
  currency: string = 'USD'
): number => {
  if (currency && currency.toUpperCase() !== 'USD') return 0;
  let extraTotal = 0;
  try {
    const legacyGrvs = getStored<any[]>('saimetric_room_direct_grvs', []);
    const unifiedGrns = getStored<any[]>('saimetric_room_goods_received_notes', []);
    const combinedMap = new Map<string, any>();
    if (Array.isArray(unifiedGrns)) {
      unifiedGrns.forEach((u: any) => {
        if (!u || u.sourceTemplate !== 'direct_delivery') return;
        const raw = u._rawDirectGrv ? { ...u._rawDirectGrv, status: u.status || u._rawDirectGrv.status } : null;
        if (!raw) return;
        const key = String(raw.id || raw.grvNumber || '').trim().toUpperCase();
        if (key) combinedMap.set(key, raw);
      });
    }
    if (Array.isArray(legacyGrvs)) {
      legacyGrvs.forEach((g: any) => {
        if (!g) return;
        const key = String(g.id || g.grvNumber || '').trim().toUpperCase();
        if (key) combinedMap.set(key, g);
      });
    }
    const grvs = Array.from(combinedMap.values());
    if (grvs.length === 0) return 0;

    const parts = shiftId.split('_');
    const targetStaff = parts[0] || '';
    const targetDate = parts[1] || '';
    const shiftBranch = targetBranch || parts[2] || getActiveBranchId();
    const tStaff = normalizeStaffKey(targetStaff);

    // Build known staff ID set & resolve target staff name for orphan attribution fallback
    const allStaff = getStored<any[]>('saimetric_room_salespeople', []);
    const knownStaffExact = new Set<string>();
    const knownStaffNorm = new Set<string>();
    let targetStaffNameLower = '';
    const activeComp = getActiveCompanyId();
    if (Array.isArray(allStaff)) {
      allStaff.forEach((s: any) => {
        if (!s || !s.id) return;
        if (!isCashCompanyInScope(s.companyId || s.company_id, activeComp)) return;
        const cid = String(s.id).trim().toLowerCase();
        knownStaffExact.add(cid);
        const nid = normalizeStaffKey(cid);
        if (nid) knownStaffNorm.add(nid);
        if (
          cid === String(targetStaff).trim().toLowerCase() ||
          (nid && tStaff && nid === tStaff)
        ) {
          targetStaffNameLower = String(s.name || '').trim().toLowerCase();
        }
      });
    }

    const isTargetStaffMatch = (opId?: string, opName?: string): boolean => {
      if (!targetStaff) return true;
      const cleanOpId = String(opId || '').trim().toLowerCase();
      const cleanTarget = String(targetStaff).trim().toLowerCase();
      if (cleanOpId && cleanOpId === cleanTarget) return true;
      const normOp = normalizeStaffKey(opId);
      if (normOp && tStaff && normOp === tStaff) return true;
      if (cleanOpId && (knownStaffExact.has(cleanOpId) || (normOp && knownStaffNorm.has(normOp)))) {
        return false;
      }
      const cleanName = String(opName || '').trim().toLowerCase();
      return Boolean(targetStaffNameLower && cleanName && cleanName === targetStaffNameLower);
    };

    grvs.forEach((g: any) => {
      if (!g || g.status === 'REJECTED') return;
      if (
        g.payFromTill === false ||
        g.paymentMethod === 'INVOICE_ON_ACCOUNT' ||
        g.paymentMethod === 'CREDIT' ||
        g.paymentMethod === 'BANK' ||
        g.paymentStatus === 'AWAITING_SAFE_PAYMENT'
      ) {
        return;
      }

      const gComp = g.companyId || g.company_id;
      if (!isCashCompanyInScope(gComp, activeComp)) return;

      const gBranch = g.branchId || g.branch_id;
      if (shiftBranch && gBranch && !isCashBranchInScope(gBranch, shiftBranch)) return;

      if (targetDate && !isSameDaySafe(g.date, g.createdAt || g.timestamp, targetDate)) return;

      const grvNumUpper = String(g.grvNumber || '').trim().toUpperCase();
      const grvIdUpper = String(g.id || '').trim().toUpperCase();
      const alreadyCountedForStaff =
        (grvNumUpper && seenGrvRefs.has(`${tStaff}_${grvNumUpper}`)) ||
        (grvIdUpper && seenGrvRefs.has(`${tStaff}_${grvIdUpper}`));
      if (alreadyCountedForStaff) return;

      const hasPositivePayments =
        Array.isArray(g.payments) && g.payments.some((p: any) => (Number(p.amount) || 0) > 0);

      if (hasPositivePayments) {
        g.payments.forEach((p: any) => {
          const amt = Number(p.amount) || 0;
          if (amt <= 0) return;
          const pIdLower = String(p.userId || '').trim().toLowerCase();
          const pNorm = normalizeStaffKey(p.userId);
          const isOrphanedOperator =
            !pIdLower || (!knownStaffExact.has(pIdLower) && (!pNorm || !knownStaffNorm.has(pNorm)));
          const staffMatch =
            isTargetStaffMatch(p.userId, p.userName) ||
            (isOrphanedOperator && isTargetStaffMatch(g.receivedByStaffId, g.receivedByStaffName));
          const compositeKey = grvNumUpper ? `${tStaff}_${grvNumUpper}-${String(p.userId || '').trim().toUpperCase()}` : '';
          if (staffMatch && !(compositeKey && seenGrvRefs.has(compositeKey))) {
            if (grvNumUpper) seenGrvRefs.add(`${tStaff}_${grvNumUpper}`);
            if (grvIdUpper) seenGrvRefs.add(`${tStaff}_${grvIdUpper}`);
            extraTotal += amt;
          }
        });
      } else if (g.payFromTill !== false && (Number(g.totalCost) || 0) > 0) {
        if (isTargetStaffMatch(g.receivedByStaffId, g.receivedByStaffName)) {
          if (grvNumUpper) seenGrvRefs.add(`${tStaff}_${grvNumUpper}`);
          if (grvIdUpper) seenGrvRefs.add(`${tStaff}_${grvIdUpper}`);
          extraTotal += Number(g.totalCost) || 0;
        }
      }
    });
  } catch {}
  return extraTotal;
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
const sortMovementsChronologicallyAsc = (movs: CashMovement[]): CashMovement[] => {
  if (!Array.isArray(movs) || movs.length <= 1) return Array.isArray(movs) ? [...movs] : [];
  return [...movs].sort((a, b) => {
    const ta = Date.parse(String(a?.timestamp || a?.date || '')) || 0;
    const tb = Date.parse(String(b?.timestamp || b?.date || '')) || 0;
    if (ta !== tb) return ta - tb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
};

export const computeDrawerBalance = (shiftId: string, currency: string = 'USD', branchId?: string): number => {
  const targetBranch = branchId || shiftId.split('_')[2] || getActiveBranchId();
  const targetCompany = getActiveCompanyId();
  const all = sortMovementsChronologicallyAsc(
    getAllMovements().filter((m) => {
      const movComp = m.company_id || (m as any).companyId;
      if (!isCashCompanyInScope(movComp, targetCompany)) return false;
      const movBranch = m.branch_id || (m as any).branchId || 'BR-MAIN';
      return isCashBranchInScope(movBranch, targetBranch);
    })
  );
  const validStatuses: CashMovementStatus[] = ['approved', 'pending-POS-auto'];

  let balance = 0;
  const seenSupplierPayments = new Set<string>();
  const seenGrvRefs = new Set<string>();
  const seenChangeReceivedInvoices = new Set<string>();
  const seenCreditDepositInvoices = new Set<string>();
  const seenMultiCurrCashOuts = new Set<string>();

  all.forEach((m) => {
    if (m.type === 'credit_upfront_deposit' && matchesShift(m, shiftId, targetBranch)) {
      const invMatch = extractInvoiceRef(m.sourceRef, m.notes);
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
      const refKey = `${m.staffId || ''}_${m.sourceRef || m.notes || m.id}`;
      if (seenSupplierPayments.has(refKey)) return;
      seenSupplierPayments.add(refKey);
      recordCountedSupplierGrvRefs(m, seenGrvRefs);
    }

    // Prevent double-counting customer change received if logged in both POS and Form 3 sheet
    // Note: Do NOT suppress manual change bookings (e.g. rejected note on an existing invoice)
    if (m.type === 'change_received') {
      const isManualRef = Boolean(m.notes?.includes('[Manual Change]') || m.sourceRef?.startsWith('MAN-CHG-'));
      if (!isManualRef && (m.sourceModule === 'POS' || m.notes?.includes('POS Invoice #'))) {
        const invMatch = extractInvoiceRef(m.sourceRef, m.notes);
        if (invMatch) {
          if (seenChangeReceivedInvoices.has(invMatch)) return;
          seenChangeReceivedInvoices.add(invMatch);
        }
      }
    }

    // Prevent double-counting credit upfront deposit if logged in both POS and Form 3
    if (m.type === 'credit_cash_payment') {
      const invMatch = extractInvoiceRef(m.sourceRef, m.notes);
      const isPosDepositPayment = m.notes?.includes('deposit paid') || m.notes?.includes('POS Credit Sale Invoice');
      if (invMatch && isPosDepositPayment && seenCreditDepositInvoices.has(invMatch)) {
        return;
      }
    }

    // Prevent double-counting EcoCash & ZiG cash-outs with same sale/log reference
    if (m.type === 'ecocash_cash_out' || m.type === 'zig_cash_out') {
      const outKey = `${m.type}_${m.staffId || ''}_${(m.sourceRef || m.id || '').trim().toUpperCase()}`;
      if (seenMultiCurrCashOuts.has(outKey)) return;
      seenMultiCurrCashOuts.add(outKey);
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
      case 'expense':
      case 'supplier_payment':
      case 'ecocash_cash_out':
      case 'zig_cash_out':
        balance -= amt;
        break;

      case 'credit_extended':
        if (m.direction === 'out') {
          balance -= amt;
        }
        break;

      case 'supervisor_lift':
        if (m.direction === 'in') {
          balance += amt;
        } else {
          balance -= amt;
        }
        break;

      case 'supplier_refund':
        // Supplier refund audit entry: handled via rejection of supplier_payment
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
  balance -= computeMissingDirectGrvPayouts(shiftId, targetBranch, seenGrvRefs, currency);

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
  creditCashOut: number;
  ecocashCashOut: number;
  zigCashOut: number;
  ecocashSales?: number;
  zigSales?: number;
  pettyCash: number;
  refunds: number;
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
  const all = sortMovementsChronologicallyAsc(getAllMovements());
  const validStatuses: CashMovementStatus[] = ['approved', 'pending-POS-auto'];

  let openingFloat = 0;
  let cashSales = 0;
  let creditPayments = 0;
  let changeReceived = 0;
  let expenses = 0;
  let directProcurements = 0;
  let cashLift = 0;
  let changePaid = 0;
  let creditCashOut = 0;
  let ecocashCashOut = 0;
  let zigCashOut = 0;
  let ecocashSales = 0;
  let zigSales = 0;
  let pettyCash = 0;
  let refunds = 0;

  let physicalCount: number | null = null;
  let movementsCount = 0;
  const seenSupplierPayments = new Set<string>();
  const seenGrvRefs = new Set<string>();
  const seenChangeReceivedInvoices = new Set<string>();
  const seenCreditDepositInvoices = new Set<string>();
  const seenMultiCurrSales = new Set<string>();
  const seenMultiCurrCashOuts = new Set<string>();

  all.forEach((m) => {
    if (m.type === 'credit_upfront_deposit' && matchesShift(m, shiftId)) {
      const invMatch = extractInvoiceRef(m.sourceRef, m.notes);
      if (invMatch) seenCreditDepositInvoices.add(invMatch);
    }
  });

  all.forEach((m) => {
    if (!matchesShift(m, shiftId)) return;

    if (m.type === 'ecocash_sale') {
      if (!validStatuses.includes(m.status)) return;
      const sKey = `ecocash_sale_${m.staffId || ''}_${(m.sourceRef || m.id || '').trim().toUpperCase()}`;
      if (seenMultiCurrSales.has(sKey)) return;
      seenMultiCurrSales.add(sKey);
      ecocashSales += Number(m.amount) || 0;
      movementsCount++;
      return;
    }
    if (m.type === 'zig_sale') {
      if (!validStatuses.includes(m.status)) return;
      const sKey = `zig_sale_${m.staffId || ''}_${(m.sourceRef || m.id || '').trim().toUpperCase()}`;
      if (seenMultiCurrSales.has(sKey)) return;
      seenMultiCurrSales.add(sKey);
      zigSales += Number(m.amount) || 0;
      movementsCount++;
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
      const refKey = `${m.staffId || ''}_${m.sourceRef || m.notes || m.id}`;
      if (seenSupplierPayments.has(refKey)) return;
      seenSupplierPayments.add(refKey);
      recordCountedSupplierGrvRefs(m, seenGrvRefs);
    }

    // Prevent double-counting customer change received if logged in both POS and Form 3 sheet
    // Note: Do NOT suppress manual change bookings (e.g. rejected note on an existing invoice)
    if (m.type === 'change_received') {
      const isManualRef = Boolean(m.notes?.includes('[Manual Change]') || m.sourceRef?.startsWith('MAN-CHG-'));
      if (!isManualRef && (m.sourceModule === 'POS' || m.notes?.includes('POS Invoice #'))) {
        const invMatch = extractInvoiceRef(m.sourceRef, m.notes);
        if (invMatch) {
          if (seenChangeReceivedInvoices.has(invMatch)) return;
          seenChangeReceivedInvoices.add(invMatch);
        }
      }
    }

    // Prevent double-counting credit upfront deposit if logged in both POS and Form 3
    if (m.type === 'credit_cash_payment') {
      const invMatch = extractInvoiceRef(m.sourceRef, m.notes);
      const isPosDepositPayment = m.notes?.includes('deposit paid') || m.notes?.includes('POS Credit Sale Invoice');
      if (invMatch && isPosDepositPayment && seenCreditDepositInvoices.has(invMatch)) {
        return;
      }
    }

    // Prevent double-counting EcoCash & ZiG cash-outs with same sale/log reference
    if (m.type === 'ecocash_cash_out' || m.type === 'zig_cash_out') {
      const outKey = `${m.type}_${m.staffId || ''}_${(m.sourceRef || m.id || '').trim().toUpperCase()}`;
      if (seenMultiCurrCashOuts.has(outKey)) return;
      seenMultiCurrCashOuts.add(outKey);
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
      case 'credit_extended':
        if (m.direction === 'out') creditCashOut += amt;
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
      case 'refund':
      case 'exchange_refund':
        refunds += amt;
        break;
      case 'exchange_payment':
        if (m.direction === 'in') cashSales += amt;
        else if (m.direction === 'out') refunds += amt;
        break;
      case 'supplier_refund':
        // Explicitly handled: audit trail reversal, does not count as cash sales or double-credit
        break;
      default:
        if (m.direction === 'in') cashSales += amt;
        else if (m.direction === 'out') expenses += amt;
        break;
    }
  });

  // Direct GRVs safety sync: ensure any Direct GRVs with till payments for this shift are accounted for
  const targetBranch = shiftId.split('_')[2] || getActiveBranchId();
  directProcurements += computeMissingDirectGrvPayouts(shiftId, targetBranch, seenGrvRefs, currency);

  const cashInTotal = Math.round((openingFloat + cashSales + creditPayments + changeReceived) * 100) / 100;
  const cashOutTotal =
    Math.round(
      (changePaid + creditCashOut + pettyCash + directProcurements + cashLift + ecocashCashOut + zigCashOut + expenses + refunds) * 100
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
    creditCashOut: Math.round(creditCashOut * 100) / 100,
    ecocashCashOut: Math.round(ecocashCashOut * 100) / 100,
    zigCashOut: Math.round(zigCashOut * 100) / 100,
    ecocashSales: Math.round(ecocashSales * 100) / 100,
    zigSales: Math.round(zigSales * 100) / 100,
    pettyCash: Math.round(pettyCash * 100) / 100,
    refunds: Math.round(refunds * 100) / 100,
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

