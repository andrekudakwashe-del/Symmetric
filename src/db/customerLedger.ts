import { CustomerLedgerEntry, CustomerLedgerType } from '../types';

export const CUSTOMER_LEDGER_STORAGE_KEY = 'saimetric_room_customer_ledger';

let memoryCustomerLedger: CustomerLedgerEntry[] = [];

/**
 * Read all entries from customer ledger
 */
export const getAllCustomerLedgerEntries = (): CustomerLedgerEntry[] => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryCustomerLedger;
  }
  try {
    const raw = window.localStorage.getItem(CUSTOMER_LEDGER_STORAGE_KEY);
    if (!raw) return memoryCustomerLedger;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading customerLedger:', err);
    return memoryCustomerLedger;
  }
};

/**
 * Save all entries to localStorage
 */
const saveAllCustomerLedgerEntries = (entries: CustomerLedgerEntry[]) => {
  memoryCustomerLedger = entries;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CUSTOMER_LEDGER_STORAGE_KEY, JSON.stringify(entries));
      window.dispatchEvent(
        new CustomEvent('saimetric_customer_ledger_updated', {
          detail: { count: entries.length },
        })
      );
      try {
        window.dispatchEvent(new Event('storage'));
      } catch {
        // Safe fallback
      }
    } catch (err) {
      console.error('Error saving customerLedger:', err);
    }
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
  const fullEntry: CustomerLedgerEntry = {
    ...entry,
    id,
    amount: Number(entry.amount) || 0,
    createdAt: now,
    updatedAt: now,
  };

  const current = getAllCustomerLedgerEntries();
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
  const current = getAllCustomerLedgerEntries();
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
  const current = getAllCustomerLedgerEntries();
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
