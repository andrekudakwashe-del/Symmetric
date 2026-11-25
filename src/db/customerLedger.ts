import { CustomerLedgerEntry, CustomerLedgerType } from '../types';
import { getStored, setStored } from './roomStorageEngine';

export const CUSTOMER_LEDGER_STORAGE_KEY = 'saimetric_room_customer_ledger';

let memoryCustomerLedger: CustomerLedgerEntry[] = [];

const normCustomerLedgerTenant = (comp?: string | null): string => {
  const clean = String(comp || '').trim().toUpperCase();
  if (!clean || clean === 'COMP-001' || clean === 'COMP-MASTER' || clean === 'DEFAULT') {
    return 'COMP-001';
  }
  return clean;
};

const getActiveCustomerLedgerCompanyId = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const sessionRaw = window.localStorage.getItem('saimetric_room_session_user');
      if (sessionRaw) {
        const u = JSON.parse(sessionRaw);
        if (u?.companyId || u?.company_id) return String(u.companyId || u.company_id).trim();
      }
      const storedComp = window.localStorage.getItem('saimetric_room_current_company_id');
      if (storedComp && storedComp.trim()) return storedComp.trim();
    } catch {
      // Fallback below
    }
  }
  return 'COMP-001';
};

/**
 * Read ALL raw entries across all companies safely via roomStorageEngine
 */
export const getRawStoredCustomerLedgerEntries = (): CustomerLedgerEntry[] => {
  try {
    const stored = getStored<CustomerLedgerEntry[]>(CUSTOMER_LEDGER_STORAGE_KEY, []);
    if (Array.isArray(stored)) {
      if (stored.length > 0 || memoryCustomerLedger.length === 0) {
        memoryCustomerLedger = stored;
      }
      return stored.length > 0 ? stored : memoryCustomerLedger;
    }
    return Array.isArray(memoryCustomerLedger) ? memoryCustomerLedger : [];
  } catch (err) {
    console.error('Error reading customerLedger:', err);
    return Array.isArray(memoryCustomerLedger) ? memoryCustomerLedger : [];
  }
};

/**
 * Read tenant-scoped entries from customer ledger for the active company
 */
export const getAllCustomerLedgerEntries = (): CustomerLedgerEntry[] => {
  const activeComp = normCustomerLedgerTenant(getActiveCustomerLedgerCompanyId());
  return getRawStoredCustomerLedgerEntries().filter((e: any) =>
    normCustomerLedgerTenant(e.company_id || e.companyId) === activeComp
  );
};

/**
 * Save all entries via roomStorageEngine (handles IndexedDB overflow safely)
 */
const saveAllCustomerLedgerEntries = (entries: CustomerLedgerEntry[]) => {
  const safeEntries = Array.isArray(entries) ? entries : [];
  memoryCustomerLedger = safeEntries;
  try {
    setStored(CUSTOMER_LEDGER_STORAGE_KEY, safeEntries);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('saimetric_customer_ledger_updated', {
          detail: { count: safeEntries.length },
        })
      );
    }
  } catch (err) {
    console.error('Error saving customerLedger:', err);
  }
};

/**
 * Add an entry to the customer ledger
 */
export const addCustomerLedgerEntry = (
  entry: Omit<CustomerLedgerEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): CustomerLedgerEntry => {
  const now = new Date().toISOString();
  const id = entry.id || `CLED-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const activeComp = (entry as any).company_id || (entry as any).companyId || getActiveCustomerLedgerCompanyId();
  const fullEntry: CustomerLedgerEntry = {
    ...entry,
    companyId: activeComp,
    company_id: activeComp,
    id,
    amount: Number(entry.amount) || 0,
    createdAt: now,
    updatedAt: now,
  } as CustomerLedgerEntry;

  const current = getRawStoredCustomerLedgerEntries();
  const updated = [fullEntry, ...current];
  saveAllCustomerLedgerEntries(updated);
  return fullEntry;
};

/**
 * Update an existing customer ledger entry
 */
export const updateCustomerLedgerEntry = (
  id: string,
  patch: Partial<CustomerLedgerEntry>
): CustomerLedgerEntry | null => {
  const current = getRawStoredCustomerLedgerEntries();
  const index = current.findIndex((e) => e.id === id);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const updatedItem: CustomerLedgerEntry = {
    ...current[index],
    ...patch,
    updatedAt: now,
  };

  const next = [...current];
  next[index] = updatedItem;
  saveAllCustomerLedgerEntries(next);
  return updatedItem;
};

/**
 * Delete a customer ledger entry
 */
export const deleteCustomerLedgerEntry = (id: string): boolean => {
  const current = getRawStoredCustomerLedgerEntries();
  const filtered = current.filter((e) => e.id !== id);
  if (filtered.length === current.length) return false;
  saveAllCustomerLedgerEntries(filtered);
  return true;
};

/**
 * Query customer ledger entries with a filter
 */
export const getCustomerLedgerEntries = (
  filter?: Partial<CustomerLedgerEntry> | ((e: CustomerLedgerEntry) => boolean)
): CustomerLedgerEntry[] => {
  const all = getAllCustomerLedgerEntries();
  if (!filter) return all;

  if (typeof filter === 'function') {
    return all.filter(filter as any);
  }

  return all.filter((entry) => {
    return Object.entries(filter).every(([key, value]) => {
      return (entry as any)[key] === value;
    });
  });
};

/**
 * Calculate receivables delta (credit extended - credit paid) for date and optional staff
 */
export const getDailyReceivablesDelta = (date: string, staffId?: string): number => {
  const entries = getAllCustomerLedgerEntries().filter(
    (e) => e.date === date && (!staffId || e.staffId === staffId)
  );

  const creditExtended = entries
    .filter((e) => e.type === 'credit_extended')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const creditPaid = entries
    .filter((e) => e.type === 'credit_payment')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return Math.round((creditExtended - creditPaid) * 100) / 100;
};

/**
 * Calculate total customer ledger summary for date and optional staff
 */
export const getDailyCustomerLedgerSummary = (
  date: string,
  staffId?: string
): {
  creditExtended: number;
  creditPaid: number;
  receivablesDelta: number;
  changeLeftBehind: number;
  changeCollected: number;
} => {
  const entries = getAllCustomerLedgerEntries().filter(
    (e) => e.date === date && (!staffId || e.staffId === staffId)
  );

  let creditExtended = 0;
  let creditPaid = 0;
  let changeLeftBehind = 0;
  let changeCollected = 0;

  entries.forEach((e) => {
    const amt = Number(e.amount) || 0;
    if (e.type === 'credit_extended') creditExtended += amt;
    else if (e.type === 'credit_payment') creditPaid += amt;
    else if (e.type === 'change_liability') changeLeftBehind += amt;
    else if (e.type === 'change_collected') changeCollected += amt;
  });

  return {
    creditExtended: Math.round(creditExtended * 100) / 100,
    creditPaid: Math.round(creditPaid * 100) / 100,
    receivablesDelta: Math.round((creditExtended - creditPaid) * 100) / 100,
    changeLeftBehind: Math.round(changeLeftBehind * 100) / 100,
    changeCollected: Math.round(changeCollected * 100) / 100,
  };
};
