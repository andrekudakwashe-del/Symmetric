import { CartItem } from '../types';
import { getStored, setStored } from '../db/roomDatabase';

export interface POSCartDraft {
  cart: CartItem[];
  selectedCustomerId?: string;
  discountInput?: string;
  discountType?: 'fixed' | 'percent';
  taxAmount?: number;
  otherCharges?: number;
  saleNotes?: string;
  selectedCurrency?: string;
  lastView?: 'items' | 'counter';
  timestamp: number;
}

const STORAGE_KEY = 'pos_cart_drafts';
const BACKUP_KEY = 'pos_cart_drafts_backup';
const DB_KEY = 'pos_active_cart_draft';

/**
 * Loads the active till cart draft from persistent storage.
 * Checked in order: localStorage -> sessionStorage -> roomDatabase persistent store.
 */
export const loadPOSCartDraft = (): POSCartDraft | null => {
  if (typeof window === 'undefined') return null;

  // 1. Try Primary localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed)
        ? parsed
        : parsed?.cart || parsed?.items;
      if (Array.isArray(items) && items.length > 0) {
        return {
          cart: items,
          selectedCustomerId: parsed.selectedCustomerId || '',
          discountInput: parsed.discountInput || '0',
          discountType: parsed.discountType || 'fixed',
          taxAmount: Number(parsed.taxAmount) || 0,
          otherCharges: Number(parsed.otherCharges) || 0,
          saleNotes: parsed.saleNotes || '',
          selectedCurrency: parsed.selectedCurrency || 'USD',
          lastView: parsed.lastView === 'items' ? 'items' : 'counter',
          timestamp: parsed.timestamp || Date.now(),
        };
      }
    }
  } catch (_) {}

  // 2. Try sessionStorage Backup
  try {
    const rawBackup = sessionStorage.getItem(BACKUP_KEY);
    if (rawBackup) {
      const parsed = JSON.parse(rawBackup);
      const items = Array.isArray(parsed)
        ? parsed
        : parsed?.cart || parsed?.items;
      if (Array.isArray(items) && items.length > 0) {
        return {
          cart: items,
          selectedCustomerId: parsed.selectedCustomerId || '',
          discountInput: parsed.discountInput || '0',
          discountType: parsed.discountType || 'fixed',
          taxAmount: Number(parsed.taxAmount) || 0,
          otherCharges: Number(parsed.otherCharges) || 0,
          saleNotes: parsed.saleNotes || '',
          selectedCurrency: parsed.selectedCurrency || 'USD',
          lastView: parsed.lastView === 'items' ? 'items' : 'counter',
          timestamp: parsed.timestamp || Date.now(),
        };
      }
    }
  } catch (_) {}

  // 3. Try RoomDatabase Storage
  try {
    const dbStored = getStored<any>(DB_KEY, null);
    if (dbStored) {
      const items = Array.isArray(dbStored)
        ? dbStored
        : dbStored?.cart || dbStored?.items;
      if (Array.isArray(items) && items.length > 0) {
        return {
          cart: items,
          selectedCustomerId: dbStored.selectedCustomerId || '',
          discountInput: dbStored.discountInput || '0',
          discountType: dbStored.discountType || 'fixed',
          taxAmount: Number(dbStored.taxAmount) || 0,
          otherCharges: Number(dbStored.otherCharges) || 0,
          saleNotes: dbStored.saleNotes || '',
          selectedCurrency: dbStored.selectedCurrency || 'USD',
          lastView: dbStored.lastView === 'items' ? 'items' : 'counter',
          timestamp: dbStored.timestamp || Date.now(),
        };
      }
    }
  } catch (_) {}

  return null;
};

/**
 * Synchronously writes active till cart draft across all persistent storage layers.
 * Also emits an event to notify the application (navigation badges, counter badges).
 */
export const savePOSCartDraft = (draft: Partial<POSCartDraft> & { cart: CartItem[] }): void => {
  if (typeof window === 'undefined') return;

  const payload: POSCartDraft = {
    cart: draft.cart || [],
    selectedCustomerId: draft.selectedCustomerId || '',
    discountInput: draft.discountInput ?? '0',
    discountType: draft.discountType ?? 'fixed',
    taxAmount: draft.taxAmount ?? 0,
    otherCharges: draft.otherCharges ?? 0,
    saleNotes: draft.saleNotes ?? '',
    selectedCurrency: draft.selectedCurrency ?? 'USD',
    lastView: draft.lastView ?? 'counter',
    timestamp: Date.now(),
  };

  const serialized = JSON.stringify(payload);

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (_) {}

  try {
    sessionStorage.setItem(BACKUP_KEY, serialized);
  } catch (_) {}

  try {
    setStored(DB_KEY, payload);
  } catch (_) {}

  // Broadcast to all components in the app
  try {
    const totalCount = payload.cart.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
    window.dispatchEvent(
      new CustomEvent('pos_cart_updated', {
        detail: {
          count: totalCount,
          itemsCount: payload.cart.length,
          timestamp: payload.timestamp,
        },
      })
    );
  } catch (_) {}
};

/**
 * Clears the active till cart draft ONLY when cashier explicitly clears or completes sale.
 */
export const clearPOSCartDraft = (): void => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}

  try {
    sessionStorage.removeItem(BACKUP_KEY);
  } catch (_) {}

  try {
    setStored(DB_KEY, null);
  } catch (_) {}

  try {
    window.dispatchEvent(
      new CustomEvent('pos_cart_updated', {
        detail: { count: 0, itemsCount: 0, timestamp: Date.now() },
      })
    );
  } catch (_) {}
};

/**
 * Returns the current count of items in the persistent cart draft.
 */
export const getActiveCartItemCount = (): number => {
  const draft = loadPOSCartDraft();
  if (!draft || !Array.isArray(draft.cart)) return 0;
  return draft.cart.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
};

/**
 * Subscribes to real-time till cart updates across windows, tabs, and component unmounts.
 */
export const subscribeToPOSCart = (callback: (count: number) => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};

  const handleUpdate = () => {
    callback(getActiveCartItemCount());
  };

  const handleCustom = (e: any) => {
    if (e?.detail?.count !== undefined) {
      callback(e.detail.count);
    } else {
      callback(getActiveCartItemCount());
    }
  };

  window.addEventListener('storage', handleUpdate);
  window.addEventListener('pos_cart_updated', handleCustom as EventListener);

  return () => {
    window.removeEventListener('storage', handleUpdate);
    window.removeEventListener('pos_cart_updated', handleCustom as EventListener);
  };
};
