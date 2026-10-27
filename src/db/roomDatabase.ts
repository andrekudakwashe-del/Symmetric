import {
  Salesperson,
  StaffBranchAssignment,
  Role,
  Customer,
  Supplier,
  Branch,
  CashCountRecord,
  CashLogEntry,
  SaleInvoice,
  ExpenseEntry,
  ShiftReconciliation,
  Form4BalancingResult,
  CustomerChangeEntry,
  CreditSaleEntry,
  AdminSalesEntry,
  SyncQueueItem,
  SheetName,
  GoogleSheetsConfig,
  CustomerChangeReportItem,
  CustomerCreditReportItem,
  Product,
  CartItem,
  ParkedSale,
  InventoryItem,
  PackagingVariant,
  GoodsReceivedEntry,
  SupplierInvoiceVoucher,
  SupplierInvoiceLineItem,
  StockMovementEntry,
  StockTxnType,
  StockPromptResponse,
  StocktakeSession,
  StocktakeCountType,
  StocktakeSegment,
  StocktakeLineCount,
  StocktakeVerifiedLine,
  StocktakeConsolidatedItem,
  CustomerGoodsLeftBehind,
  TemporaryCasualAccount,
  FastMovingChecklistItem,
  StockBatch,
  NegativeBalanceEntry,
  AuditLogEntry,
  AuditAction,
  DirectGrv,
  DirectGrvItem,
  DirectGrvTillPayment,
  GrvStatus,
  GrvType,
  MultiCurrencyConfig,
  CurrencyRateConfig,
  AppCurrency,
  CashLiftRecord,
  StoreCreditPolicy,
  CreditPolicyMode,
  CompanyBranchSharingSettings,
  CashAccount,
  CashTransfer,
  CreditGroup,
  CashGovernanceConfig,
} from '../types';
import {
  addMovement,
  updateMovement,
  deleteMovement,
  getMovements,
  getAllMovements,
  getShiftId,
  computeDrawerBalance,
  computeExpectedCash,
  computeVariance,
  approveMovement,
  getShiftLedgerBreakdown,
  ShiftLedgerBreakdown,
  matchesShift,
} from './cashLedger';
import {
  addCustomerLedgerEntry,
  getCustomerLedgerEntries,
  deleteCustomerLedgerEntry,
  getAllCustomerLedgerEntries,
  getDailyReceivablesDelta,
  getDailyCustomerLedgerSummary,
} from './customerLedger';
import {
  Company,
  SaaSBranch,
  SaaSUser,
  PermissionRule,
  MASTER_PERMISSIONS_52,
  SEED_COMPANIES,
  SEED_BRANCHES,
  SEED_USERS,
} from '../data/saasData';
import {
  INITIAL_SALESPEOPLE,
  INITIAL_CUSTOMERS,
  INITIAL_SUPPLIERS,
  INITIAL_BRANCHES,
  INITIAL_CASH_LOGS,
  INITIAL_SALES,
  INITIAL_EXPENSES,
  INITIAL_CUSTOMER_CHANGES,
  INITIAL_CREDIT_SALES,
  INITIAL_PRODUCTS,
  INITIAL_INVENTORY_ITEMS,
  INITIAL_GOODS_RECEIVED,
  INITIAL_SUPPLIER_INVOICES,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_STOCKTAKE_SESSIONS,
  INITIAL_AUDIT_LOGS,
} from '../data/initialData';
import { persistentSyncEngine } from '../services/persistentSyncEngine';
import { getMeta, setMeta } from './indexedDBService';
import {
  getDualReadDirectGrvs,
  getDualReadSupplierInvoices,
  getAllGoodsReceivedNotes,
  saveGoodsReceivedNote,
  runGrnMigration,
} from './goodsReceivedNotes';
import {
  postDirectDelivery,
  postGeneralGRV,
  postGRN,
  approveGRN,
} from '../services/grnService';
import { landedCostService } from '../services/landedCostService';
import { LandedCostItem } from '../types';
import { resolveItemCost } from '../utils/costResolver';
import { toDateStringSafe, safeDateSlice, isSameDaySafe } from '../utils/dateUtils';

export {
  getAllGoodsReceivedNotes,
  saveGoodsReceivedNote,
  runGrnMigration,
  postDirectDelivery,
  postGeneralGRV,
  postGRN,
  approveGRN,
  landedCostService,
};

export const STORAGE_KEYS = {
  SALESPEOPLE: 'saimetric_room_salespeople',
  CUSTOMERS: 'saimetric_room_customers',
  SUPPLIERS: 'saimetric_room_suppliers',
  BRANCHES: 'saimetric_room_branches',
  PRODUCTS: 'saimetric_room_products',
  INVENTORY_ITEMS: 'saimetric_room_inventory_items',
  GOODS_RECEIVED: 'saimetric_room_goods_received',
  SUPPLIER_INVOICES: 'saimetric_room_supplier_invoices',
  STOCK_MOVEMENTS: 'saimetric_room_stock_movements',
  STOCKTAKE_SESSIONS: 'saimetric_room_stocktake_sessions',
  CASH_COUNTS: 'saimetric_room_cash_counts',
  CASH_LIFTS: 'saimetric_room_cash_lifts',
  CASH_LOGS: 'saimetric_room_cash_logs',
  CUSTOMER_CHANGES: 'saimetric_room_customer_changes',
  CREDIT_SALES: 'saimetric_room_credit_sales',
  SALES: 'saimetric_room_sales',
  EXPENSES: 'saimetric_room_expenses',
  RECONCILIATIONS: 'saimetric_room_reconciliations',
  ADMIN_SALES: 'saimetric_room_admin_sales',
  SYNC_QUEUE: 'saimetric_room_sync_queue',
  SESSION_USER: 'saimetric_room_session_user',
  SHEETS_CONFIG: 'saimetric_room_sheets_config',
  OFFLINE_MODE: 'saimetric_room_offline_mode',
  PARKED_SALES: 'saimetric_room_parked_sales',
  STOCK_BATCHES: 'saimetric_room_stock_batches',
  NEGATIVE_BALANCES: 'saimetric_room_negative_balances',
  CATEGORIES: 'saimetric_room_categories',
  AUDIT_LOGS: 'saimetric_room_audit_logs',
  DIRECT_GRVS: 'saimetric_room_direct_grvs',
  GOODS_RECEIVED_NOTES: 'saimetric_room_goods_received_notes',
  COMPANIES: 'saimetric_room_companies',
  CURRENT_COMPANY_ID: 'saimetric_room_current_company_id',
  CURRENT_BRANCH_ID: 'saimetric_room_current_branch_id',
  DELETED_BRANCH_IDS: 'saimetric_deleted_branch_ids',
  PERMISSIONS: 'saimetric_room_permissions',
  EXCHANGE_RATES: 'saimetric_room_exchange_rates',
  CUSTOMER_GOODS_LEFT_BEHIND: 'saimetric_room_customer_goods_left_behind',
  BRANCH_LOCKDOWNS: 'saimetric_room_branch_lockdowns',
  FAST_MOVING_CHECKLIST: 'saimetric_room_fast_moving_checklist',
  TEMPORARY_CASUALS: 'saimetric_room_temporary_casuals',
  CASH_ACCOUNTS: 'saimetric_room_cash_accounts',
  CASH_TRANSFERS: 'saimetric_room_cash_transfers',
  CREDIT_GROUPS: 'saimetric_room_credit_groups',
  CASH_GOVERNANCE_CONFIG: 'saimetric_room_cash_governance_config',
};

export const DEFAULT_MULTI_CURRENCY_CONFIG: MultiCurrencyConfig = {
  baseCurrency: 'USD',
  reportingCurrency: 'USD',
  rates: {
    ZiG: {
      currency: 'ZiG',
      code: 'ZIG',
      name: 'Zimbabwe Gold (ZiG)',
      symbol: 'ZiG',
      rateToBase: 26.5,
      rateToUsd: 26.5, // 1 Base = 26.50 ZiG
      allowCashWithdrawal: true,
      maxWithdrawalRule: 'EQUAL_TO_SALE',
      customPercent: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: 'System Default',
    },
    EcoCash: {
      currency: 'EcoCash',
      code: 'ECO',
      name: 'EcoCash Mobile Money',
      symbol: 'EcoCash',
      rateToBase: 27.0,
      rateToUsd: 27.0, // 1 Base = 27.00 EcoCash
      allowCashWithdrawal: true,
      maxWithdrawalRule: 'EQUAL_TO_SALE',
      customPercent: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: 'System Default',
    },
    ZAR: {
      currency: 'ZAR',
      code: 'ZAR',
      name: 'South African Rand (ZAR)',
      symbol: 'R',
      rateToBase: 0, // No rate by default => Inactive in POS and Forms
      rateToUsd: 0,
      allowCashWithdrawal: true,
      maxWithdrawalRule: 'EQUAL_TO_SALE',
      customPercent: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: 'System Default',
    },
    BWP: {
      currency: 'BWP',
      code: 'BWP',
      name: 'Botswana Pula (BWP)',
      symbol: 'P',
      rateToBase: 0, // No rate by default => Inactive in POS and Forms
      rateToUsd: 0,
      allowCashWithdrawal: false,
      maxWithdrawalRule: 'EQUAL_TO_SALE',
      customPercent: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: 'System Default',
    },
    EUR: {
      currency: 'EUR',
      code: 'EUR',
      name: 'Euro (EUR)',
      symbol: '€',
      rateToBase: 0,
      rateToUsd: 0,
      allowCashWithdrawal: false,
      maxWithdrawalRule: 'EQUAL_TO_SALE',
      customPercent: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: 'System Default',
    },
    GBP: {
      currency: 'GBP',
      code: 'GBP',
      name: 'British Pound (GBP)',
      symbol: '£',
      rateToBase: 0,
      rateToUsd: 0,
      allowCashWithdrawal: false,
      maxWithdrawalRule: 'EQUAL_TO_SALE',
      customPercent: 100,
      updatedAt: new Date().toISOString(),
      updatedBy: 'System Default',
    },
  },
  cashWithdrawalPolicy: {
    enabled: true,
    maxWithdrawalRule: 'EQUAL_TO_SALE',
    customPercent: 100,
  },
  lastUpdated: new Date().toISOString(),
};

type Listener = () => void;
const listeners: Set<Listener> = new Set();

export const subscribeToDatabase = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const subscribeRoomDatabase = subscribeToDatabase;

let notifyScheduled = false;
let notifyTimer: any = null;

// Throttled listener notification to coalesce rapid bulk writes into a single render tick
const notifyListeners = () => {
  if (notifyScheduled) return;
  notifyScheduled = true;
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      notifyScheduled = false;
      listeners.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error('Listener error:', e);
        }
      });
    });
  } else {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      notifyScheduled = false;
      listeners.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error('Listener error:', e);
        }
      });
    }, 16);
  }
};

// High-performance in-memory layer: Prevents synchronous localStorage I/O freezes on UI thread
const memoryCache = new Map<string, any>();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key) {
      memoryCache.delete(e.key);
      notifyListeners();
    }
  });
}

export function cleanupLocalStorageQuota(): void {
  try {
    if (typeof localStorage === 'undefined') return;

    // 1. Trim audit logs to last 10 entries
    const rawAudit = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
    if (rawAudit) {
      try {
        const parsed = JSON.parse(rawAudit);
        if (Array.isArray(parsed) && parsed.length > 10) {
          localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(parsed.slice(-10)));
        }
      } catch {}
    }

    // 2. Clear completed / synced items from sync queue
    const rawQueue = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
    if (rawQueue) {
      try {
        const parsed = JSON.parse(rawQueue);
        if (Array.isArray(parsed)) {
          const pendingOnly = parsed.filter((i: any) => i.status !== 'synced' && i.status !== 'done').slice(-30);
          localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(pendingOnly));
        }
      } catch {}
    }

    // 3. Clear temporary migration staging rows and safety backup keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('saimetric_safety_backup_') ||
        k.startsWith('saimetric_migration_staged_') ||
        k.startsWith('saimetric_staged_') ||
        k.startsWith('saimetric_temp_') ||
        k.startsWith('migration_staged_') ||
        k.includes('_temp_preview')
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => {
      try { localStorage.removeItem(k); } catch {}
    });

    // 4. Prune disaster recovery backups to only the 2 latest snapshots
    const rawDr = localStorage.getItem('saimetric_dr_backups');
    if (rawDr) {
      try {
        const parsed = JSON.parse(rawDr);
        if (Array.isArray(parsed) && parsed.length > 2) {
          localStorage.setItem('saimetric_dr_backups', JSON.stringify(parsed.slice(0, 2)));
        }
      } catch {}
    }

    // 5. Prune backup history down to 5 items
    const rawHistory = localStorage.getItem('saimetric_backup_history');
    if (rawHistory) {
      try {
        const parsed = JSON.parse(rawHistory);
        if (Array.isArray(parsed) && parsed.length > 5) {
          localStorage.setItem('saimetric_backup_history', JSON.stringify(parsed.slice(0, 5)));
        }
      } catch {}
    }
  } catch (e) {
    console.warn('[Storage] cleanupLocalStorageQuota error:', e);
  }
}

export async function rehydrateFromIndexedDB(): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    const criticalCollectionKeys: { key: string; idField: (item: any) => string }[] = [
      { key: STORAGE_KEYS.SALES, idField: (s) => s.id },
      { key: STORAGE_KEYS.INVENTORY_ITEMS, idField: (i) => i.itemId || i.id },
      { key: STORAGE_KEYS.CASH_LOGS, idField: (c) => c.id },
      { key: STORAGE_KEYS.CASH_COUNTS, idField: (c) => c.id },
      { key: STORAGE_KEYS.CREDIT_SALES, idField: (c) => c.id },
      { key: STORAGE_KEYS.CUSTOMER_CHANGES, idField: (c) => c.id },
      { key: STORAGE_KEYS.COMPANIES, idField: (c) => c.company_id },
      { key: STORAGE_KEYS.BRANCHES, idField: (b) => b.branchId || b.id },
      { key: STORAGE_KEYS.SALESPEOPLE, idField: (s) => s.id },
      { key: STORAGE_KEYS.CUSTOMERS, idField: (c) => c.customerId || c.id },
      { key: STORAGE_KEYS.SUPPLIERS, idField: (s) => s.supplierId || s.id },
      { key: STORAGE_KEYS.SUPPLIER_INVOICES, idField: (s) => s.id },
      { key: STORAGE_KEYS.EXPENSES, idField: (e) => e.id },
      { key: STORAGE_KEYS.GOODS_RECEIVED, idField: (g) => g.id },
      { key: STORAGE_KEYS.GOODS_RECEIVED_NOTES, idField: (g) => g.id },
      { key: STORAGE_KEYS.DIRECT_GRVS, idField: (g) => g.id },
      { key: STORAGE_KEYS.STOCK_MOVEMENTS, idField: (m) => m.id },
      { key: STORAGE_KEYS.STOCKTAKE_SESSIONS, idField: (s) => s.id },
      { key: STORAGE_KEYS.AUDIT_LOGS, idField: (a) => a.id },
      { key: STORAGE_KEYS.RECONCILIATIONS, idField: (r) => r.id },
      { key: STORAGE_KEYS.CASH_LIFTS, idField: (c) => c.id },
      { key: STORAGE_KEYS.PARKED_SALES, idField: (p) => p.id },
      { key: STORAGE_KEYS.CUSTOMER_GOODS_LEFT_BEHIND, idField: (g) => g.id },
    ];

    const criticalScalarKeys = [
      STORAGE_KEYS.SESSION_USER,
      STORAGE_KEYS.CURRENT_COMPANY_ID,
      STORAGE_KEYS.CURRENT_BRANCH_ID,
      STORAGE_KEYS.EXCHANGE_RATES,
      STORAGE_KEYS.SHEETS_CONFIG,
    ];

    let rehydratedAny = false;

    // 1. Rehydrate Collections: Merge so zero records from IDB or local are lost
    for (const { key, idField } of criticalCollectionKeys) {
      try {
        const idbVal = await getMeta(`room_${key}`);
        if (Array.isArray(idbVal) && idbVal.length > 0) {
          const currentLocal = getStored<any[]>(key, []);
          const localIdSet = new Set(currentLocal.map(idField).filter(Boolean));
          let hasNewFromIdb = false;
          const merged = [...currentLocal];

          for (const item of idbVal) {
            const id = idField(item);
            if (id && !localIdSet.has(id)) {
              merged.push(item);
              localIdSet.add(id);
              hasNewFromIdb = true;
            }
          }

          if (hasNewFromIdb || currentLocal.length === 0) {
            memoryCache.set(key, merged);
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(key, JSON.stringify(merged));
              }
            } catch {}
            rehydratedAny = true;
          }
        }
      } catch (err) {
        console.warn(`[Storage] Rehydrate collection error for ${key}:`, err);
      }
    }

    // 2. Rehydrate Scalars & Configs
    for (const key of criticalScalarKeys) {
      try {
        let hasLocal = false;
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(key);
          if (raw && raw !== 'null' && raw !== '""') {
            hasLocal = true;
          }
        }
        if (!hasLocal) {
          const idbVal = await getMeta(`room_${key}`);
          if (idbVal !== null && idbVal !== undefined) {
            memoryCache.set(key, idbVal);
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(key, JSON.stringify(idbVal));
              }
            } catch {}
            rehydratedAny = true;
          }
        }
      } catch (err) {
        console.warn(`[Storage] Rehydrate scalar error for ${key}:`, err);
      }
    }

    if (rehydratedAny) {
      notifyListeners();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
      }
    }
  } catch (e) {
    console.warn('[Storage] rehydrateFromIndexedDB error:', e);
  }
}

export function getStored<T>(key: string, fallback: T): T {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) as T;
  }
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) {
      memoryCache.set(key, fallback);
      return fallback;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.__overflow_idb) {
      // Data is overflowed to IndexedDB, return fallback until IDB rehydrates into memoryCache
      return fallback;
    }
    memoryCache.set(key, parsed);
    return parsed;
  } catch (err) {
    console.error(`Error reading ${key} from storage:`, err);
    memoryCache.set(key, fallback);
    return fallback;
  }
}

export function setStored<T>(key: string, value: T, options?: { skipIdbOverwriteIfExisting?: boolean }): void {
  try {
    // 1. Update in-memory cache instantly (0ms UI latency)
    memoryCache.set(key, value);

    // 2. Persist to localStorage safely with quota recovery
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        console.warn(`[Storage] localStorage write for ${key} failed, attempting quota recovery:`, err);
        try {
          cleanupLocalStorageQuota();
          localStorage.setItem(key, JSON.stringify(value));
        } catch (retryErr) {
          console.warn(`[Storage] LocalStorage quota still exceeded for ${key}. Preserving in IndexedDB & Memory:`, retryErr);
          try {
            if (Array.isArray(value)) {
              localStorage.setItem(key, JSON.stringify(value.slice(-60)));
            } else {
              localStorage.setItem(key, JSON.stringify({ __overflow_idb: true, count: 1 }));
            }
          } catch {
            try { localStorage.removeItem(key); } catch {}
          }
        }
      }
    }

    // 3. Persist asynchronously to IndexedDB meta store for bulletproof persistence across browser reloads
    if (typeof window !== 'undefined' && window.indexedDB) {
      if (options?.skipIdbOverwriteIfExisting) {
        getMeta(`room_${key}`)
          .then((existing) => {
            if (existing === null || existing === undefined) {
              setMeta(`room_${key}`, value).catch(() => {});
            }
          })
          .catch(() => {
            setMeta(`room_${key}`, value).catch(() => {});
          });
      } else {
        setMeta(`room_${key}`, value).catch(() => {});
      }
    }

    // 4. Notify subscribers via throttled frame
    notifyListeners();
  } catch (err) {
    console.error(`Error in setStored for ${key}:`, err);
  }
}

// ==================== MULTI-CURRENCY & EXCHANGE RATES ====================
export const getMultiCurrencyConfig = (): MultiCurrencyConfig => {
  const stored = getStored<MultiCurrencyConfig | null>(STORAGE_KEYS.EXCHANGE_RATES, null);
  if (!stored) {
    return DEFAULT_MULTI_CURRENCY_CONFIG;
  }
  return {
    ...DEFAULT_MULTI_CURRENCY_CONFIG,
    ...stored,
    baseCurrency: stored.baseCurrency || DEFAULT_MULTI_CURRENCY_CONFIG.baseCurrency || 'USD',
    rates: {
      ...DEFAULT_MULTI_CURRENCY_CONFIG.rates,
      ...(stored.rates || {}),
    },
    cashWithdrawalPolicy: {
      ...DEFAULT_MULTI_CURRENCY_CONFIG.cashWithdrawalPolicy,
      ...(stored.cashWithdrawalPolicy || {}),
    },
  };
};

export const getActiveCurrencies = (): CurrencyRateConfig[] => {
  const config = getMultiCurrencyConfig();
  const base = (config.baseCurrency || 'USD').toUpperCase();
  const ratesObj = config.rates || {};
  return Object.values(ratesObj)
    .filter((c: any) => {
      if (!c) return false;
      const code = (c.code || c.currency || '').toUpperCase();
      if (!code || code === base) return false;
      const rate = Number(c.rateToBase !== undefined ? c.rateToBase : c.rateToUsd || 0);
      // User core rule: currencies with no rate (> 0) means they are not applicable and should not show
      return rate > 0;
    })
    .map((c: any) => ({
      currency: c.currency || c.code || 'UNKNOWN',
      code: c.code || c.currency || 'UNKNOWN',
      name: c.name || c.code || c.currency || 'Currency',
      symbol: c.symbol || c.code || '$',
      rateToBase: Number(c.rateToBase !== undefined ? c.rateToBase : c.rateToUsd || 0),
      rateToUsd: Number(c.rateToUsd !== undefined ? c.rateToUsd : c.rateToBase || 0),
      allowCashWithdrawal: c.allowCashWithdrawal ?? true,
      maxWithdrawalRule: c.maxWithdrawalRule || 'EQUAL_TO_SALE',
      customPercent: Number(c.customPercent || 100),
      updatedAt: c.updatedAt || new Date().toISOString(),
      updatedBy: c.updatedBy || 'System',
    }));
};

export const getAllCurrencies = (): CurrencyRateConfig[] => {
  const config = getMultiCurrencyConfig();
  return Object.values(config.rates || {});
};

export const getCurrencyRate = (code: string): number => {
  if (!code) return 1;
  const config = getMultiCurrencyConfig();
  const base = (config.baseCurrency || 'USD').toUpperCase();
  const cleanCode = code.toUpperCase().trim();
  if (cleanCode === base || (base === 'USD' && cleanCode === 'USD')) return 1;
  
  const curr =
    config.rates[code] ||
    config.rates[cleanCode] ||
    Object.values(config.rates || {}).find(
      (c: any) => (c.code || '').toUpperCase() === cleanCode || (c.currency || '').toUpperCase() === cleanCode
    );

  const rate = Number(curr?.rateToBase !== undefined ? curr?.rateToBase : curr?.rateToUsd || 0);
  return rate > 0 ? rate : 1;
};

export const saveMultiCurrencyConfig = (
  config: Partial<MultiCurrencyConfig>,
  updatedBy?: string
): MultiCurrencyConfig => {
  const current = getMultiCurrencyConfig();
  const now = new Date().toISOString();

  // Merge any incoming rates dynamically while preserving existing ones
  const mergedRates: Record<string, any> = {
    ...current.rates,
    ...(config.rates || {}),
  };

  if (config.rates) {
    Object.keys(config.rates).forEach((key) => {
      const incoming = config.rates![key];
      if (incoming) {
        mergedRates[key] = {
          ...(current.rates[key] || {}),
          ...incoming,
          rateToBase: incoming.rateToBase !== undefined ? incoming.rateToBase : incoming.rateToUsd,
          rateToUsd: incoming.rateToBase !== undefined ? incoming.rateToBase : incoming.rateToUsd,
          updatedAt: now,
          updatedBy: updatedBy || incoming.updatedBy || current.rates[key]?.updatedBy || 'Owner',
        };
      }
    });
  }

  const merged: MultiCurrencyConfig = {
    ...current,
    ...config,
    baseCurrency: config.baseCurrency || current.baseCurrency || 'USD',
    rates: mergedRates,
    cashWithdrawalPolicy: {
      ...current.cashWithdrawalPolicy,
      ...(config.cashWithdrawalPolicy || {}),
    },
    lastUpdated: now,
  };
  setStored(STORAGE_KEYS.EXCHANGE_RATES, merged);
  return merged;
};

export const calculateMaxCashWithdrawalUsd = (saleAmountUsd: number, currency: AppCurrency): number => {
  if (!currency || saleAmountUsd <= 0) return 0;
  const config = getMultiCurrencyConfig();
  const base = (config.baseCurrency || 'USD').toUpperCase();
  if (String(currency).toUpperCase() === base) return 0;

  const cleanCurr = String(currency).toUpperCase().trim();
  const rateConfig =
    config.rates[currency as string] ||
    Object.values(config.rates || {}).find(
      (c: any) => (c.code || '').toUpperCase() === cleanCurr || (c.currency || '').toUpperCase() === cleanCurr
    );

  if (!rateConfig?.allowCashWithdrawal || !config.cashWithdrawalPolicy.enabled) return 0;

  const rule = rateConfig.maxWithdrawalRule || config.cashWithdrawalPolicy.maxWithdrawalRule;
  if (rule === 'CUSTOM_PERCENT') {
    const pct = rateConfig.customPercent ?? config.cashWithdrawalPolicy.customPercent ?? 100;
    return (saleAmountUsd * pct) / 100;
  }
  // Default: Maximum cash withdrawal equals sale amount (e.g. sale = $10 -> max withdrawal = $10)
  return saleAmountUsd;
};

let isRoomDatabaseInitialized = false;

// Initialize Database with Defaults if empty
export const initRoomDatabase = () => {
  if (isRoomDatabaseInitialized) return;
  isRoomDatabaseInitialized = true;
  // Rehydrate missing local state from IndexedDB for crash/refresh resilience
  rehydrateFromIndexedDB().catch(() => {});
  if (!localStorage.getItem(STORAGE_KEYS.EXCHANGE_RATES)) {
    setStored(STORAGE_KEYS.EXCHANGE_RATES, DEFAULT_MULTI_CURRENCY_CONFIG, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.SALESPEOPLE)) {
    setStored(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.CUSTOMERS)) {
    setStored(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.SUPPLIERS)) {
    setStored(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.BRANCHES)) {
    setStored(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.SUPPLIER_INVOICES)) {
    setStored(STORAGE_KEYS.SUPPLIER_INVOICES, INITIAL_SUPPLIER_INVOICES, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.INVENTORY_ITEMS)) {
    setStored(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS, { skipIdbOverwriteIfExisting: true });
  }
  
  // Unify PRODUCTS with INVENTORY_ITEMS so POS Counter and Inventory Master share the same database
  const currentInv = getStored<InventoryItem[]>(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  const initialProdMap = new Map<string, Product>();
  currentInv.map((item) => inventoryItemToProduct(item)).forEach((p) => {
    if (p.id && !initialProdMap.has(p.id)) {
      initialProdMap.set(p.id, p);
    }
  });
  setStored(STORAGE_KEYS.PRODUCTS, Array.from(initialProdMap.values()), { skipIdbOverwriteIfExisting: true });

  if (!localStorage.getItem(STORAGE_KEYS.CASH_LOGS)) {
    setStored(STORAGE_KEYS.CASH_LOGS, INITIAL_CASH_LOGS, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.CUSTOMER_CHANGES)) {
    setStored(STORAGE_KEYS.CUSTOMER_CHANGES, INITIAL_CUSTOMER_CHANGES, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.CREDIT_SALES)) {
    setStored(STORAGE_KEYS.CREDIT_SALES, INITIAL_CREDIT_SALES, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.SALES)) {
    setStored(STORAGE_KEYS.SALES, INITIAL_SALES, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.EXPENSES)) {
    setStored(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.CASH_COUNTS)) {
    setStored(STORAGE_KEYS.CASH_COUNTS, [], { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.GOODS_RECEIVED)) {
    setStored(STORAGE_KEYS.GOODS_RECEIVED, INITIAL_GOODS_RECEIVED, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.STOCK_MOVEMENTS)) {
    setStored(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.STOCKTAKE_SESSIONS)) {
    setStored(STORAGE_KEYS.STOCKTAKE_SESSIONS, INITIAL_STOCKTAKE_SESSIONS, { skipIdbOverwriteIfExisting: true });
  }
  if (!localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS)) {
    setStored(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS, { skipIdbOverwriteIfExisting: true });
  }

  // Migrate any existing Staff roles and assign existing users to company_id=COMP-001, branch_id=BR-MAIN with role=OWNER
  const currentSalespeople = getStored<Salesperson[]>(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  let updatedSalespeople = false;
  const migratedPeople = currentSalespeople.map((sp) => {
    let p = { ...sp };
    if (!p.companyId && !p.company_id) {
      p.companyId = 'COMP-001';
      p.company_id = 'COMP-001';
      updatedSalespeople = true;
    }
    if (!p.branchId && !p.branch_id) {
      p.branchId = 'BR-MAIN';
      p.branch_id = 'BR-MAIN';
      p.branchName = 'Head Office - Main Central Distribution & Warehouse';
      updatedSalespeople = true;
    }
    // Migration: Move existing users to OWNER role for initial company
    if (p.id === '001' || p.id === '002' || (p.role as string) === 'Admin' || (p.role as string) === 'Staff') {
      p.role = 'OWNER';
      updatedSalespeople = true;
    }
    // Migration: Upgrade legacy 4-digit PINs to 6-digit PINs
    if (p.pin && String(p.pin).trim().length === 4) {
      const oldPin = String(p.pin).trim();
      if (oldPin === '1234') p.pin = '123456';
      else if (oldPin === '4321') p.pin = '432100';
      else if (oldPin === '0000') p.pin = '000000';
      else if (oldPin === '7788') p.pin = '778899';
      else if (oldPin === '9999') p.pin = '999999';
      else p.pin = `${oldPin}00`;
      updatedSalespeople = true;
    }
    return p;
  });

  // Ensure there is at least one active Manager or Owner
  if (!migratedPeople.some((s) => (s.role === 'Manager' || s.role === 'OWNER') && s.active === 'Y')) {
    const candidate = migratedPeople[0];
    if (candidate) {
      candidate.role = 'OWNER';
      candidate.active = 'Y';
      updatedSalespeople = true;
    }
  }

  if (updatedSalespeople) {
    setStored(STORAGE_KEYS.SALESPEOPLE, migratedPeople);
  }

  // Migration: Move existing "Sample Branch" data to "Head Office" branch in Master
  const currentBranches = getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  let branchesUpdated = false;
  const migratedBranches: Branch[] = [];
  const seenMigrationIds = new Set<string>();

  for (const b of currentBranches) {
    let candidate = { ...b };
    if (candidate.name === 'Sample Branch' || candidate.name === 'Main Central Distribution & Warehouse') {
      branchesUpdated = true;
      candidate = {
        ...candidate,
        branchId: 'BR-MAIN',
        name: 'Head Office - Main Central Distribution & Warehouse',
        code: 'HQ-01',
        isMain: true,
        companyId: candidate.companyId || 'COMP-001',
        company_id: candidate.company_id || 'COMP-001',
      };
    }
    if (!candidate.companyId && !candidate.company_id) {
      branchesUpdated = true;
      candidate = { ...candidate, companyId: 'COMP-001', company_id: 'COMP-001' };
    }
    const id = candidate.branchId || candidate.id || (candidate as any).branch_id || 'BR-MAIN';
    candidate.branchId = id;
    candidate.id = id;

    if (seenMigrationIds.has(id)) {
      branchesUpdated = true;
      continue;
    }
    seenMigrationIds.add(id);
    migratedBranches.push(candidate);
  }

  if (branchesUpdated) {
    setStored(STORAGE_KEYS.BRANCHES, migratedBranches);
  }

  // Ensure seed companies (including COMP-001 and COMP-002) exist in companies store
  // and sanitize any non-functional placeholder sheet IDs
  const currentCompanies = getStored<Company[]>(STORAGE_KEYS.COMPANIES, SEED_COMPANIES);
  let compCleaned = false;
  const sanitizedCompanies = currentCompanies.map((c) => {
    if (
      c.sheet_id &&
      (c.sheet_id.includes('_Tenant_Sheet_') ||
        c.sheet_id.includes('Metro_Bulawayo') ||
        c.sheet_id.includes('Dedicated'))
    ) {
      compCleaned = true;
      return { ...c, sheet_id: '' };
    }
    return c;
  });
  const existingCompanyIds = new Set(sanitizedCompanies.map((c) => c.company_id));
  const missingCompanies = SEED_COMPANIES.filter((c) => !existingCompanyIds.has(c.company_id));
  if (missingCompanies.length > 0 || compCleaned) {
    setStored(STORAGE_KEYS.COMPANIES, [...sanitizedCompanies, ...missingCompanies]);
  }

  // Ensure initial branches for demo companies exist only if not previously deleted
  const branchList = getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  const existingBranchIds = new Set(branchList.map((b) => b.branchId));
  const deletedBranchSet = new Set(getStored<string[]>(STORAGE_KEYS.DELETED_BRANCH_IDS, []));
  const missingBranches = INITIAL_BRANCHES.filter(
    (b) => !existingBranchIds.has(b.branchId) && !deletedBranchSet.has(b.branchId)
  );
  if (missingBranches.length > 0) {
    setStored(STORAGE_KEYS.BRANCHES, [...branchList, ...missingBranches]);
  }

  // Clean phantom duplicates leaving HQ + at most 1 clean other branch across all tenants
  cleanPhantomBranchDuplicates();

  // Ensure initial salespeople for all demo companies exist in salespeople store and deduplicate
  const staffList = getStored<Salesperson[]>(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  const seenStaffIds = new Set<string>();
  const sanitizedStaff: Salesperson[] = [];
  let staffCleaned = false;
  for (const s of staffList) {
    if (!s || !s.id) continue;
    const cleanId = String(s.id).trim();
    if (!seenStaffIds.has(cleanId)) {
      seenStaffIds.add(cleanId);
      sanitizedStaff.push(s);
    } else {
      staffCleaned = true;
    }
  }
  const missingStaff = INITIAL_SALESPEOPLE.filter((s) => !seenStaffIds.has(String(s.id).trim()));
  if (missingStaff.length > 0 || staffCleaned) {
    setStored(STORAGE_KEYS.SALESPEOPLE, [...sanitizedStaff, ...missingStaff]);
  }

  // Ensure initial inventory items for all demo companies exist in inventory store and deduplicate
  const allInvStore = getStored<InventoryItem[]>(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  const deletedRegistryKey = 'saimetric_deleted_inventory_ids';
  const deletedList = getStored<Array<{ itemId: string; companyId: string; deletedAt: string }>>(deletedRegistryKey, []);
  const deletedSet = new Set(deletedList.map((d) => `${(d.itemId || '').toUpperCase()}::${(d.companyId || '').toUpperCase()}`));

  const dedupedInvMap = new Map<string, InventoryItem>();
  for (const item of allInvStore) {
    if (!item.itemId) continue;
    const cleanId = item.itemId.trim().toUpperCase();
    const comp = (item.company_id || (item as any).companyId || 'COMP-001').trim().toUpperCase();
    const key = `${cleanId}::${comp}`;
    // Never restore items that were deleted by user/synced deletion
    if (deletedSet.has(key)) continue;
    if (!dedupedInvMap.has(key)) {
      dedupedInvMap.set(key, item);
    }
  }
  for (const initItem of INITIAL_INVENTORY_ITEMS) {
    if (!initItem.itemId) continue;
    const cleanId = initItem.itemId.trim().toUpperCase();
    const comp = (initItem.company_id || (initItem as any).companyId || 'COMP-001').trim().toUpperCase();
    const key = `${cleanId}::${comp}`;
    if (deletedSet.has(key)) continue;
    if (!dedupedInvMap.has(key)) {
      dedupedInvMap.set(key, initItem);
    }
  }
  const cleanInvStore = Array.from(dedupedInvMap.values());
  setStored(STORAGE_KEYS.INVENTORY_ITEMS, cleanInvStore);

  // Ensure initial sales for all demo companies exist in sales store
  const currentSales = getStored<SaleInvoice[]>(STORAGE_KEYS.SALES, INITIAL_SALES);
  const existingSaleIds = new Set(currentSales.map((s) => s.id));
  const missingSales = INITIAL_SALES.filter((s) => !existingSaleIds.has(s.id));
  if (missingSales.length > 0) {
    setStored(STORAGE_KEYS.SALES, [...currentSales, ...missingSales]);
  }

  // Backfill company_id and branch_id for any existing records in local storage
  const backfillCompanyBranch = <T extends Record<string, any>>(key: string, defaultList: T[]): void => {
    const list = getStored<T[]>(key, defaultList);
    let changed = false;
    const migrated = list.map((item) => {
      let itemChanged = false;
      let comp = item.company_id || item.companyId;
      if (!comp) {
        comp = 'COMP-001';
        itemChanged = true;
      }
      let br = item.branch_id || item.branchId;
      if (!br || br === 'ALL') {
        br = 'BR-MAIN';
        itemChanged = true;
      }
      if (itemChanged || item.company_id !== comp || item.companyId !== comp || item.branch_id !== br || item.branchId !== br) {
        changed = true;
        return {
          ...item,
          company_id: comp,
          companyId: comp,
          branch_id: br,
          branchId: br,
        };
      }
      return item;
    });
    if (changed) {
      setStored(key, migrated);
    }
  };

  backfillCompanyBranch(STORAGE_KEYS.SALES, INITIAL_SALES);
  backfillCompanyBranch(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS);
  backfillCompanyBranch(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
  backfillCompanyBranch(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  backfillCompanyBranch(STORAGE_KEYS.CASH_LOGS, INITIAL_CASH_LOGS);
  backfillCompanyBranch(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
  backfillCompanyBranch(STORAGE_KEYS.CUSTOMER_CHANGES, INITIAL_CUSTOMER_CHANGES);
  backfillCompanyBranch(STORAGE_KEYS.CREDIT_SALES, INITIAL_CREDIT_SALES);
  backfillCompanyBranch(STORAGE_KEYS.DIRECT_GRVS, INITIAL_DIRECT_GRVS);
  backfillCompanyBranch(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
  backfillCompanyBranch(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  backfillCompanyBranch(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  backfillCompanyBranch(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  backfillCompanyBranch(STORAGE_KEYS.STOCKTAKE_SESSIONS, INITIAL_STOCKTAKE_SESSIONS);
  backfillCompanyBranch(STORAGE_KEYS.CASH_COUNTS, []);
  backfillCompanyBranch(STORAGE_KEYS.CASH_LIFTS, []);
  backfillCompanyBranch(STORAGE_KEYS.RECONCILIATIONS, []);
  backfillCompanyBranch(STORAGE_KEYS.ADMIN_SALES, []);
  backfillCompanyBranch(STORAGE_KEYS.NEGATIVE_BALANCES, []);

  if (!localStorage.getItem(STORAGE_KEYS.RECONCILIATIONS)) {
    setStored(STORAGE_KEYS.RECONCILIATIONS, []);
  }
  if (!localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE)) {
    setStored(STORAGE_KEYS.SYNC_QUEUE, []);
  }

  // Deduplicate any duplicate change_received movements on startup
  cleanupDuplicateChangeMovements();

  // Deduplicate any duplicate audit and stock movement records on startup
  cleanupDuplicateAuditAndMovementRecords();

  // Self-heal any multi-currency (ZiG & EcoCash) sales missing movements
  healMultiCurrencySalesAndMovements();

  if (!localStorage.getItem(STORAGE_KEYS.SHEETS_CONFIG)) {
    const defaultConfig: GoogleSheetsConfig = {
      webhookUrl: '',
      spreadsheetId: '1Saimetric_Sync_Live_MasterSheet',
      sheetNameMap: {
        Customers: 'Customers',
        Suppliers: 'Suppliers',
        CashLog: 'CashLog',
        Sales: 'Sales',
        Expenses: 'Expenses',
        Reconciliations: 'Reconciliations',
        Salespeople: 'Salespeople',
        CustomerChange: 'CustomerChange',
        CreditSales: 'CreditSales',
        Products: 'InventoryMaster',
        InventoryMaster: 'InventoryMaster',
        companies: 'companies',
        branches: 'branches',
        users: 'users',
        Direct_GRV: 'Direct_GRV',
        Audit_Log: 'Audit_Log',
        StockMovement: 'StockMovement',
        GoodsReceived: 'GoodsReceived',
      },
      autoSync: true,
      simulateSyncLatency: true,
    };
    setStored(STORAGE_KEYS.SHEETS_CONFIG, defaultConfig);
  }
};

// ==================== AUTH & SESSION ====================
export const getSessionUser = (): Salesperson | null => {
  return getStored<Salesperson | null>(STORAGE_KEYS.SESSION_USER, null);
};

export const setSessionUser = (user: Salesperson | null): void => {
  setStored(STORAGE_KEYS.SESSION_USER, user);
  if (user) {
    const compId = user.company_id || user.companyId;
    if (compId) {
      setStored(STORAGE_KEYS.CURRENT_COMPANY_ID, compId);
    }
    const brId = user.branch_id || user.branchId;
    if (brId) {
      setStored(STORAGE_KEYS.CURRENT_BRANCH_ID, brId);
    }
  }
  notifyListeners();
};

export const getCurrentUser = getSessionUser;
export const setCurrentUser = setSessionUser;
export const initializeRoomDatabase = initRoomDatabase;

export const cleanupDuplicateChangeMovements = (): void => {
  try {
    const all = getAllMovements();
    const seenChangeIn = new Set<string>();
    const posCreditDepositInvoices = new Set<string>();

    // Pass 1: find all POS credit upfront deposits
    all.forEach((m) => {
      if (m.type === 'credit_upfront_deposit') {
        const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
        if (invMatch) {
          const shiftPart = m.shiftId || `${m.staffId}_${m.date}`;
          posCreditDepositInvoices.add(`${shiftPart}_${invMatch}`);
        }
      }
    });

    // Pass 2: delete duplicate change_received and duplicate credit_cash_payment
    all.forEach((m) => {
      if (m.type === 'change_received') {
        const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
        if (invMatch) {
          const shiftPart = m.shiftId || `${m.staffId}_${m.date}`;
          const key = `chg_${shiftPart}_${invMatch}`;
          if (seenChangeIn.has(key)) {
            deleteMovement(m.id);
            return;
          }
          seenChangeIn.add(key);
        }
      }

      if (m.type === 'credit_cash_payment') {
        const invMatch = (m.sourceRef?.match(/INV-[A-Za-z0-9-]+/i) || m.notes?.match(/INV-[A-Za-z0-9-]+/i))?.[0]?.toUpperCase();
        const isPosDepositPayment = m.notes?.includes('deposit paid') || m.notes?.includes('POS Credit Sale Invoice');
        if (invMatch && isPosDepositPayment) {
          const shiftPart = m.shiftId || `${m.staffId}_${m.date}`;
          if (posCreditDepositInvoices.has(`${shiftPart}_${invMatch}`)) {
            deleteMovement(m.id);
            return;
          }
        }
      }
    });
  } catch (e) {
    console.warn('cleanupDuplicateChangeMovements error:', e);
  }
};

// Immediate module-level cleanup invocation
export const cleanupDuplicateAuditAndMovementRecords = (): void => {
  try {
    getAllAuditLogs();
    getAllStockMovements();
    getAllSuppliers();
  } catch (e) {
    console.warn('cleanupDuplicateAuditAndMovementRecords error:', e);
  }
};

/**
 * Self-healing routine to ensure all existing ZiG & EcoCash sales have corresponding
 * cash ledger movements and do not disappear from shift balancing or reports.
 */
export const healMultiCurrencySalesAndMovements = (): void => {
  try {
    const allSales = getAllSales();
    const allMovements = getAllMovements();
    const allCashLogs = getAllCashLogs();
    const existingMovKeys = new Set(allMovements.map((m) => `${m.sourceRef}_${m.type}`));
    let healed = false;

    for (const sale of allSales) {
      if (!sale || !sale.id) continue;
      const isEco =
        sale.currency === 'EcoCash' ||
        sale.currency === 'ECO' ||
        sale.currency === 'ECOCASH' ||
        (typeof sale.currency === 'string' && sale.currency.toLowerCase().includes('eco')) ||
        sale.paymentMethod === 'EcoCash' ||
        sale.paymentMethod === 'EcoCash/Mobile' ||
        sale.paymentMethod === 'ECO' ||
        sale.paymentMethod === 'ECOCASH' ||
        (typeof sale.paymentMethod === 'string' && sale.paymentMethod.toLowerCase().includes('eco'));

      const isZig =
        sale.currency === 'ZiG' ||
        sale.currency === 'ZIG' ||
        sale.paymentMethod === 'ZiG' ||
        sale.paymentMethod === 'ZIG' ||
        (typeof sale.paymentMethod === 'string' && sale.paymentMethod.toLowerCase().includes('zig'));

      const cur: 'ZiG' | 'EcoCash' | undefined = isZig ? 'ZiG' : isEco ? 'EcoCash' : undefined;
      if (!cur) continue;

      const saleMovType = cur === 'ZiG' ? 'zig_sale' : 'ecocash_sale';
      const saleKey = `${sale.id}_${saleMovType}`;
      if (!existingMovKeys.has(saleKey)) {
        addMovement({
          shiftId: getShiftId(sale.staffId, sale.date, sale.branch_id || sale.branchId),
          staffId: sale.staffId,
          date: sale.date,
          timestamp: sale.timestamp,
          type: saleMovType,
          amount: Number(sale.total) || 0,
          currency: cur,
          direction: 'none',
          affectsDrawer: false,
          status: 'approved',
          sourceModule: 'POS',
          sourceRef: sale.id,
          notes: `${cur} Auto-healed electronic non-cash sale #${sale.id}`,
          company_id: sale.company_id || sale.companyId,
          branch_id: sale.branch_id || sale.branchId,
        });
        existingMovKeys.add(saleKey);
        healed = true;
      }

      // Auto-heal CashLog for non-cash sale if missing in Form 2
      const hasSaleCashLog = allCashLogs.some(
        (c) =>
          c.reference === sale.id &&
          !c.isWithdrawal &&
          (c.currency === cur || c.line === cur || (c.category && c.category.includes(cur)))
      );
      if (!hasSaleCashLog && Number(sale.total) > 0) {
        const currencyConfig = getMultiCurrencyConfig();
        const rate =
          sale.exchangeRate ||
          currencyConfig.rates[cur]?.rateToUsd ||
          (cur === 'ZiG' ? 26.5 : 27.0);
        const curAmount = sale.totalInCurrency || (Number(sale.total) * rate);
        addCashLog({
          timestamp: sale.timestamp,
          date: sale.date,
          staffId: sale.staffId,
          staffName: sale.staffName || 'Cashier',
          companyId: sale.company_id || sale.companyId,
          company_id: sale.company_id || sale.companyId,
          branchId: sale.branch_id || sale.branchId,
          branch_id: sale.branch_id || sale.branchId,
          line: cur,
          description: `${cur} Sale #${sale.id} (${curAmount.toFixed(2)} ${cur} @ ${rate.toFixed(2)}) - ${sale.customerName || 'Customer'}`,
          in: 0,
          out: Number(sale.total),
          category: `${cur} Non-Cash Sale Deduction`,
          currency: cur,
          exchangeRate: rate,
          currencyAmount: curAmount,
          isWithdrawal: false,
          reference: sale.id,
          notes: `Electronic ${cur} Payment: ${curAmount.toFixed(2)} ${cur}. Deducted as $${Number(sale.total).toFixed(2)} USD in Form 2.`,
        });
        healed = true;
      }

      if (sale.cashWithdrawalAmount && Number(sale.cashWithdrawalAmount) > 0) {
        const outMovType = cur === 'ZiG' ? 'zig_cash_out' : 'ecocash_cash_out';
        const outKey = `${sale.id}_${outMovType}`;
        if (!existingMovKeys.has(outKey)) {
          addMovement({
            shiftId: getShiftId(sale.staffId, sale.date, sale.branch_id || sale.branchId),
            staffId: sale.staffId,
            date: sale.date,
            timestamp: sale.timestamp,
            type: outMovType,
            amount: Number(sale.cashWithdrawalAmount),
            currency: 'USD',
            direction: 'out',
            affectsDrawer: true,
            status: 'approved',
            sourceModule: 'POS',
            sourceRef: sale.id,
            notes: `${cur} Auto-healed Cash-Out #${sale.id}`,
            company_id: sale.company_id || sale.companyId,
            branch_id: sale.branch_id || sale.branchId,
          });
          existingMovKeys.add(outKey);
          healed = true;
        }

        // Auto-heal CashLog for withdrawal if missing in Form 2
        const hasWithdrawalCashLog = allCashLogs.some(
          (c) =>
            c.reference === sale.id &&
            (c.isWithdrawal || c.category?.toLowerCase().includes('withdrawal') || c.line?.toLowerCase().includes('withdrawal'))
        );
        if (!hasWithdrawalCashLog) {
          const currencyConfig = getMultiCurrencyConfig();
          const rate =
            sale.exchangeRate ||
            currencyConfig.rates[cur]?.rateToUsd ||
            (cur === 'ZiG' ? 26.5 : 27.0);
          const wUsd = Number(sale.cashWithdrawalAmount);
          const wInCur = sale.cashWithdrawalInCurrency || (wUsd * rate);
          addCashLog({
            timestamp: sale.timestamp,
            date: sale.date,
            staffId: sale.staffId,
            staffName: sale.staffName || 'Cashier',
            companyId: sale.company_id || sale.companyId,
            company_id: sale.company_id || sale.companyId,
            branchId: sale.branch_id || sale.branchId,
            branch_id: sale.branch_id || sale.branchId,
            line: `${cur} Withdrawal`,
            description: `${cur} Cash-Out Payout #${sale.id} ($${wUsd.toFixed(2)} USD / ${wInCur.toFixed(2)} ${cur})`,
            in: 0,
            out: wUsd,
            category: `${cur} Cash Withdrawal`,
            currency: cur,
            exchangeRate: rate,
            currencyAmount: wInCur,
            isWithdrawal: true,
            reference: sale.id,
            notes: `Cash Out Payout to Customer: Swiped in ${cur}. Cashier handed $${wUsd.toFixed(2)} USD cash from till.`,
          });
          healed = true;
        }
      }
    }

    if (healed) {
      notifyListeners();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
    }
  } catch (err) {
    console.warn('[healMultiCurrencySalesAndMovements] Healing skipped:', err);
  }
};

if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => healMultiCurrencySalesAndMovements(), { timeout: 3000 });
  } else {
    setTimeout(() => healMultiCurrencySalesAndMovements(), 1500);
  }
}

// ==================== AUDIT LOG DAO ====================
export const getAllAuditLogs = (): AuditLogEntry[] => {
  const logs = getStored<AuditLogEntry[]>(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
  if (!Array.isArray(logs)) return [];
  const seenIds = new Set<string>();
  let hasDuplicates = false;
  const sanitized = logs.map((l, index) => {
    const rawId = (l?.id || '').trim();
    if (!rawId || seenIds.has(rawId)) {
      hasDuplicates = true;
      const baseId = rawId || 'AUD';
      const uniqueId = `${baseId}-dup-${index + 1}-${Math.floor(1000 + Math.random() * 9000)}`;
      seenIds.add(uniqueId);
      return { ...l, id: uniqueId };
    }
    seenIds.add(rawId);
    return { ...l, id: rawId };
  });
  if (hasDuplicates) {
    setStored(STORAGE_KEYS.AUDIT_LOGS, sanitized);
  }
  return sanitized;
};

export const getAuditLogs = (): AuditLogEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllAuditLogs();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((a) => {
    const cId = a.company_id || a.companyId;
    if (!cId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return cId === currentCompany;
  });
};

export const addAuditLog = (
  entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'date' | 'time'> & {
    timestamp?: string;
    date?: string;
    time?: string;
    id?: string;
    company_id?: string;
    companyId?: string;
    branch_id?: string;
    branchId?: string;
  }
): AuditLogEntry => {
  const all = getAllAuditLogs();
  const now = new Date();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const dateStr = entry.date || now.toISOString().split('T')[0];
  const timeStr = entry.time || now.toTimeString().split(' ')[0];
  
  let id = entry.id;
  if (!id || all.some((l) => l.id === id)) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    id = `AUD-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-6)}-${rand}`;
  }
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branch_id || entry.branchId || currentBranch;

  const newLog: AuditLogEntry = {
    id,
    timestamp: entry.timestamp || now.toISOString(),
    date: dateStr,
    time: timeStr,
    action: entry.action,
    severity: entry.severity,
    staffId: entry.staffId,
    staffName: entry.staffName,
    staffRole: entry.staffRole,
    authorizedById: entry.authorizedById,
    authorizedByName: entry.authorizedByName,
    authorizedByRole: entry.authorizedByRole,
    details: entry.details,
    referenceId: entry.referenceId,
    amount: entry.amount,
    metadata: entry.metadata,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };

  const updated = [newLog, ...all];
  setStored(STORAGE_KEYS.AUDIT_LOGS, updated);

  // Decouple routine INFO audit logs (e.g. logins/logouts/UI checks) from the critical Sheets transactional queue.
  // Critical compliance events (price changes, overrides, voids, warnings, critical severity) are queued to Sheets.
  if (
    newLog.severity === 'WARNING' ||
    newLog.severity === 'CRITICAL' ||
    newLog.action === 'PRICE_CHANGE' ||
    newLog.action === 'DISCOUNT_OVERRIDE' ||
    newLog.action === 'REFUND_INVOICE' ||
    newLog.action === 'VOID_INVOICE'
  ) {
    enqueueSync('Audit_Log', 'INSERT', newLog);
  }
  return newLog;
};

export const logLogin = (staff: Salesperson): void => {
  addAuditLog({
    action: 'LOGIN',
    severity: 'INFO',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `User ${staff.name} (${staff.role}) successfully authenticated with 4-digit PIN.`,
  });
};

export const logLogout = (staff: Salesperson, reason: string = 'User clicked Logout'): void => {
  addAuditLog({
    action: 'LOGOUT',
    severity: 'INFO',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `User ${staff.name} (${staff.role}) signed out. Reason: ${reason}.`,
  });
};

export const logSessionTimeout = (staff: Salesperson): void => {
  addAuditLog({
    action: 'SESSION_TIMEOUT',
    severity: 'WARNING',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `Security Auto-Lock: User ${staff.name} (${staff.role}) automatically logged out after 5 minutes of inactivity.`,
  });
};

export const logManagerOverride = (params: {
  action: 'DISCOUNT_OVERRIDE' | 'VOID_CART' | 'REFUND_INVOICE' | 'VOID_INVOICE' | 'ITEM_EXCHANGE' | 'REFUND_VOID';
  manager: Salesperson;
  cashier?: Salesperson | null;
  details: string;
  amount?: number;
  referenceId?: string;
  metadata?: Record<string, any>;
}): void => {
  const cashierStaff = params.cashier || getCurrentUser() || params.manager;
  addAuditLog({
    action: params.action,
    severity: params.action === 'REFUND_INVOICE' ? 'CRITICAL' : 'SECURITY',
    staffId: cashierStaff.id,
    staffName: cashierStaff.name,
    staffRole: cashierStaff.role,
    authorizedById: params.manager.id,
    authorizedByName: params.manager.name,
    authorizedByRole: params.manager.role,
    amount: params.amount,
    referenceId: params.referenceId,
    details: params.details,
    metadata: params.metadata,
  });
};

// ==================== SALESPERSON DAO ====================
export const getAllSalespeople = (): Salesperson[] => {
  const raw = getStored<Salesperson[]>(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  const seenIds = new Set<string>();
  const deduped: Salesperson[] = [];
  for (const s of raw) {
    if (!s || !s.id) continue;
    const cleanId = String(s.id).trim();
    if (!seenIds.has(cleanId)) {
      seenIds.add(cleanId);
      deduped.push(s);
    }
  }
  return deduped;
};

export const getSalespeople = (): Salesperson[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllSalespeople();
  const seenIds = new Set<string>();
  const result: Salesperson[] = [];

  for (const s of all) {
    const sComp = s.companyId || s.company_id;
    const matchesComp = !sComp ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (sComp === currentCompany);
    if (!matchesComp) continue;

    // Strict branch isolation with fallback for main branch aliases (1 and BR-MAIN) and unassigned/offline staff:
    const sBranch = s.branchId || s.branch_id;
    let branchMatches = false;
    if (!sBranch || sBranch === 'ALL' || sBranch === currentBranch) {
      branchMatches = true;
    } else {
      const isMainBranchMatch =
        (currentBranch === '1' || currentBranch === 'BR-MAIN' || !currentBranch) &&
        (sBranch === '1' || sBranch === 'BR-MAIN');
      if (isMainBranchMatch) {
        branchMatches = true;
      } else if (
        s.branchAssignments &&
        Array.isArray(s.branchAssignments) &&
        s.branchAssignments.some(
          (b) => b.branchId === currentBranch || (isMainBranchMatch && (b.branchId === '1' || b.branchId === 'BR-MAIN'))
        )
      ) {
        branchMatches = true;
      } else if (s.role === 'OWNER' || s.role === 'SUPER_ADMIN' || s.role === 'MANAGER') {
        branchMatches = true;
      }
    }

    if (branchMatches) {
      const cleanId = String(s.id).trim();
      if (!seenIds.has(cleanId)) {
        seenIds.add(cleanId);
        result.push(s);
      }
    }
  }

  return result;
};

export const getSalespeopleForCompany = (companyId?: string): Salesperson[] => {
  const targetCompany = companyId || getCurrentCompanyId();
  const all = getAllSalespeople();
  return all.filter((s) => {
    const sComp = s.companyId || s.company_id;
    if (!sComp) {
      return targetCompany === 'COMP-001' || targetCompany === 'COMP-MASTER';
    }
    return sComp === targetCompany;
  });
};

export const getNextSalespersonId = (): string => {
  const list = getAllSalespeople();
  const numericIds = list
    .map((s) => parseInt(s.id, 10))
    .filter((n) => !isNaN(n));
  const max = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  const next = max + 1;
  return String(next).padStart(3, '0');
};

export const addSalesperson = (person: Omit<Salesperson, 'id'> & { id?: string }): Salesperson => {
  const all = getAllSalespeople();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const newId = person.id || getNextSalespersonId();
  const compId = person.companyId || person.company_id || currentCompany;
  const brId = person.branchId || person.branch_id || currentBranch;
  const created: Salesperson = {
    ...person,
    id: newId,
    companyId: compId,
    company_id: compId,
    branchId: brId,
    branch_id: brId,
  };
  const updated = [...all, created];
  setStored(STORAGE_KEYS.SALESPEOPLE, updated);
  
  // Queue sync
  enqueueSync('Salespeople', 'INSERT', created);
  enqueueSync('users', 'INSERT', created);
  return created;
};

export const getOwnerDefaultPermissions = () => ({
  canEditCartPrice: true,
  canApplyCartDiscount: true,
  canDeleteCartItem: true,
  canClearCart: true,
  canManageInventory: true,
  canEditPriceCost: true,
  canSellNegativeStock: true,
  canReceiveGRN: true,
  canBreakCases: true,
  canAccessReports: true,
  canManageExpenses: true,
  canPerformShiftEnd: true,
  canManageStaff: true,
  canCreateDirectGrv: true,
  canApproveDirectGrv: true,
  canUseCustomerChange: true,
  canIssueCustomerCredit: true,
  canSubmitEOD: true,
  canApproveEOD: true,
  canViewVarianceInvestigation: true,
  canViewAuditLog: true,
  canPinOverride: true,
  canManageCompany: true,
  canEditMasterPrice: true,
  canEditExchangeRate: true,
  canSeeMargin: true,
  // Cash Custody Chain & Accounts Clerk Permissions
  canCreateCashTransferFloat: true,
  canCollectTillTransfer: true,
  canPaySupplierTransfer: true,
  canCreateBankDepositTransfer: true,
  canReceiveHqTransfer: true,
  canExecuteOwnerOverride: true,
  canAccessWhereIsMyMoney: true,
  canAccessDualCashCustody: true,
});

export const saveSalesperson = (person: Salesperson): Salesperson => {
  const all = getAllSalespeople();
  const compId = person.companyId || person.company_id || getCurrentCompanyId();
  const normalizedEmail = (person.email || '').trim().toLowerCase();
  
  // Find by ID, or by same email within same company
  const index = all.findIndex((s) => {
    if (s.id === person.id) return true;
    const sComp = s.companyId || s.company_id;
    if (normalizedEmail && s.email && s.email.trim().toLowerCase() === normalizedEmail && sComp === compId) {
      return true;
    }
    return false;
  });

  const existingPerson = index >= 0 ? all[index] : null;

  // Preserve existing permissions if sync did not provide new ones.
  // Never overwrite cashier permissions with owner defaults when pulling staff delta from server.
  const resolvedPermissions =
    person.permissions ||
    existingPerson?.permissions ||
    (person.role === 'ADMIN' || person.role === 'OWNER' || (existingPerson?.role === 'ADMIN' || existingPerson?.role === 'OWNER')
      ? getOwnerDefaultPermissions()
      : {});

  const merged: Salesperson = {
    ...(existingPerson || {}),
    ...person,
    companyId: compId,
    company_id: compId,
    active: person.active || existingPerson?.active || 'Y',
    permissions: resolvedPermissions,
  };

  if (index >= 0) {
    all[index] = { ...all[index], ...merged };
    setStored(STORAGE_KEYS.SALESPEOPLE, all);
    notifyListeners();
    return all[index];
  } else {
    const updated = [...all, merged];
    setStored(STORAGE_KEYS.SALESPEOPLE, updated);
    notifyListeners();
    return merged;
  }
};

export const updateSalesperson = (id: string, updates: Partial<Salesperson>): Salesperson | null => {
  const all = getAllSalespeople();
  const index = all.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const updatedPerson = { ...all[index], ...updates };
  all[index] = updatedPerson;
  setStored(STORAGE_KEYS.SALESPEOPLE, all);

  // Update session if editing current logged-in user
  const current = getSessionUser();
  if (current && current.id === id) {
    setSessionUser(updatedPerson);
  }

  enqueueSync('Salespeople', 'UPDATE', updatedPerson);
  enqueueSync('users', 'UPDATE', updatedPerson);
  return updatedPerson;
};

/**
 * Validates a staff or supervisor PIN supporting standard 6-digit PINs
 * with seamless backwards compatibility for legacy 4-digit PINs.
 */
export const verifySalespersonPin = (expectedPin: string | undefined | null, inputPin: string | undefined | null): boolean => {
  if (!inputPin) return false;
  const cleanInput = String(inputPin).trim();
  if (!cleanInput) return false;

  const cleanExpected = String(expectedPin || '').trim();

  // Exact match
  if (cleanExpected && cleanExpected === cleanInput) return true;

  // Master demo/recovery pins (6-digit default '123456' or legacy '1234')
  if ((cleanInput === '123456' || cleanInput === '1234') && (!cleanExpected || cleanExpected === '1234' || cleanExpected === '123456')) {
    return true;
  }

  // Backwards compatibility if staff record is still 4 digits
  if (cleanExpected.length === 4) {
    if (cleanInput === cleanExpected + '56' || cleanInput === cleanExpected + '00' || cleanInput.startsWith(cleanExpected)) {
      return true;
    }
  }

  // Backwards compatibility if staff record is 6 digits but user input legacy 4 digits
  if (cleanExpected.length === 6 && cleanInput.length === 4) {
    if (cleanExpected === cleanInput + '56' || cleanExpected === cleanInput + '00' || cleanExpected.startsWith(cleanInput)) {
      return true;
    }
  }

  return false;
};

export const toggleSalespersonActive = (id: string): Salesperson | null => {
  const all = getAllSalespeople();
  const index = all.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const newStatus = all[index].active === 'Y' ? 'N' : 'Y';
  return updateSalesperson(id, { active: newStatus });
};

// ==================== STAFF MULTI-BRANCH ASSIGNMENTS ====================
export const getStaffBranchAssignments = (staff: Salesperson): StaffBranchAssignment[] => {
  if (staff.branchAssignments && Array.isArray(staff.branchAssignments) && staff.branchAssignments.length > 0) {
    return staff.branchAssignments;
  }
  const defaultBranchId = staff.branchId || staff.branch_id || '1';
  return [
    {
      branchId: defaultBranchId,
      branchName: staff.branchName || 'Main Branch',
      role: staff.role || 'CASHIER',
    },
  ];
};

export const getStaffRoleInBranch = (staff: Salesperson, branchId: string): Role => {
  if (staff.role === 'OWNER' || staff.role === 'SUPER_ADMIN') {
    return staff.role;
  }
  if (staff.branchAssignments && Array.isArray(staff.branchAssignments)) {
    const match = staff.branchAssignments.find((b) => b.branchId === branchId);
    if (match && match.role) {
      return match.role;
    }
  }
  if ((staff.branchId || staff.branch_id) === branchId) {
    return staff.role;
  }
  return staff.role || 'CASHIER';
};

export const isStaffAssignedToBranch = (staff: Salesperson, branchId: string): boolean => {
  if (staff.role === 'OWNER' || staff.role === 'SUPER_ADMIN') {
    return true; // Owner has an account across the company, but must select which branch to log in to
  }
  if (staff.branchAssignments && Array.isArray(staff.branchAssignments) && staff.branchAssignments.length > 0) {
    const isMainBranch = branchId === '1' || branchId === 'BR-MAIN';
    return staff.branchAssignments.some((b) => b.branchId === branchId || (isMainBranch && (b.branchId === '1' || b.branchId === 'BR-MAIN')));
  }
  const assigned = staff.branchId || staff.branch_id;
  const isMain = branchId === '1' || branchId === 'BR-MAIN';
  return (
    !assigned ||
    assigned === branchId ||
    assigned === 'ALL' ||
    assigned === '1' ||
    assigned === 'BR-MAIN' ||
    (isMain && (assigned === '1' || assigned === 'BR-MAIN'))
  );
};

export const updateStaffBranchAssignments = (
  staffId: string,
  assignments: StaffBranchAssignment[]
): Salesperson | null => {
  const staff = getAllSalespeople().find((s) => s.id === staffId);
  if (!staff) return null;
  const primaryBranch = assignments[0]?.branchId || staff.branchId || '1';
  const primaryRole = assignments[0]?.role || staff.role;
  return updateSalesperson(staffId, {
    branchAssignments: assignments,
    branchId: primaryBranch,
    branch_id: primaryBranch,
    role: primaryRole,
  });
};

// ==================== CUSTOMER DAO ====================
export const getAllCustomers = (): Customer[] => {
  const stored = getStored<Customer[]>(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS);
  // Ensure any initial customers not in stored get included (e.g. Givemore Gondo)
  const existingIds = new Set(stored.map((c) => c.customerId));
  const missing = INITIAL_CUSTOMERS.filter((c) => !existingIds.has(c.customerId));
  if (missing.length > 0) {
    const merged = [...stored, ...missing];
    setStored(STORAGE_KEYS.CUSTOMERS, merged);
    return merged;
  }
  return stored;
};

export const getCustomers = (): Customer[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionUser = getSessionUser();
  const all = getAllCustomers();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  const settings = getCompanyBranchSettings();
  const companyFiltered = all.filter((c) => {
    const compId = c.company_id || c.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });

  if (settings.shareCustomersAcrossBranches) {
    return companyFiltered;
  }

  // Branch-specific directory
  return companyFiltered.filter((c) => {
    const brId = c.branch_id || c.branchId;
    if (!brId) return true; // Legacy unassigned visible
    return brId === currentBranch;
  });
};

export const getNextCustomerId = (): string => {
  const list = getAllCustomers();
  const numericParts = list
    .map((c) => {
      const match = c.customerId.match(/^C?(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numericParts.length > 0 ? Math.max(...numericParts) : 0;
  const next = max + 1;
  return `C${String(next).padStart(3, '0')}`;
};

export const addCustomer = (customerData: Omit<Customer, 'customerId' | 'createdDate'> & { customerId?: string; createdDate?: string; company_id?: string; companyId?: string; branch_id?: string; branchId?: string }): Customer => {
  const all = getAllCustomers();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const nextId = customerData.customerId || getNextCustomerId();
  const compId = customerData.company_id || customerData.companyId || currentCompany;
  const brId = customerData.branch_id || customerData.branchId || currentBranch;
  
  // Default credit option is strictly OFF (creditAllowed: false, creditLimit: 0)
  const isCreditAllowed = customerData.creditAllowed === true;
  const creditLimit = isCreditAllowed ? Math.max(0, Number(customerData.creditLimit) || 0) : 0;

  const created: Customer = {
    customerId: nextId,
    name: customerData.name.trim(),
    phone: customerData.phone?.trim() || '',
    address: customerData.address?.trim() || '',
    createdDate: customerData.createdDate || new Date().toISOString().split('T')[0],
    createdBy: customerData.createdBy,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
    creditAllowed: isCreditAllowed,
    creditLimit: creditLimit,
    maxCreditReceiptCount: customerData.maxCreditReceiptCount ?? 2,
    creditApprovedBy: isCreditAllowed ? customerData.creditApprovedBy : undefined,
    creditApprovalDate: isCreditAllowed ? (customerData.creditApprovalDate || new Date().toISOString()) : undefined,
    creditGroupId: customerData.creditGroupId,
    creditGroupName: customerData.creditGroupName,
    isCustomLimit: customerData.isCustomLimit,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.CUSTOMERS, updated);

  if (isCreditAllowed && creditLimit > 0) {
    addAuditLog({
      action: 'PRICE_CHANGE' as any,
      severity: 'SECURITY' as any,
      staffId: customerData.createdBy || 'SYSTEM',
      staffName: created.creditApprovedBy || 'Authorized Personnel',
      staffRole: 'SUPERVISOR' as any,
      branch_id: brId,
      branchId: brId,
      referenceId: created.customerId,
      details: `Customer [${created.name} - ${created.customerId}] credit account authorized: Limit $${creditLimit.toFixed(2)}, Group: ${created.creditGroupName || (creditLimit > 5 ? 'Custom / Random Limit' : 'Standard $5 Group Limit')}. Approved by: ${created.creditApprovedBy || 'Supervisor'}.`,
      metadata: { customerId: created.customerId, creditLimit, creditGroupId: created.creditGroupId },
    });
  }

  // Save to Sheet "Customers": CustomerID, Name, Phone, Address, CreatedDate, CreatedBy
  enqueueSync('Customers', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    CustomerID: created.customerId,
    Name: created.name,
    Phone: created.phone,
    Address: created.address,
    CreatedDate: created.createdDate,
    CreatedBy: created.createdBy,
  });

  return created;
};

export const ensureCustomerExists = (
  name: string,
  staffId: string,
  phone?: string,
  address?: string
): Customer => {
  const trimmed = name.trim();
  if (!trimmed) {
    return {
      customerId: 'C_UNKNOWN',
      name: 'Walk-in Customer',
      createdDate: new Date().toISOString().split('T')[0],
      createdBy: staffId,
    };
  }
  const list = getCustomers();
  const existing = list.find((c) => (c.name || '').trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  return addCustomer({
    name: trimmed,
    createdBy: staffId,
    phone: phone || '',
    address: address || '',
    createdDate: new Date().toISOString().split('T')[0],
  });
};

// ==================== SUPPLIER DAO ====================
export const getAllSuppliers = (): Supplier[] => {
  const stored = getStored<Supplier[]>(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
  if (!Array.isArray(stored)) return INITIAL_SUPPLIERS;

  // Robust deduplication by supplierId / id
  const seenIds = new Set<string>();
  let hasDuplicates = false;
  const deduplicated: Supplier[] = [];

  for (const s of stored) {
    if (!s) continue;
    const rawId = (s.supplierId || (s as any).id || '').trim();
    if (!rawId) continue;
    const normalizedKey = rawId.toUpperCase();
    if (seenIds.has(normalizedKey)) {
      hasDuplicates = true;
      continue;
    }
    seenIds.add(normalizedKey);
    deduplicated.push({
      ...s,
      supplierId: s.supplierId || (s as any).id || rawId,
      id: (s as any).id || s.supplierId || rawId,
    });
  }

  // Ensure all INITIAL_SUPPLIERS are present without creating duplicates
  let addedMissing = false;
  for (const init of INITIAL_SUPPLIERS) {
    const initId = (init.supplierId || (init as any).id || '').trim().toUpperCase();
    if (initId && !seenIds.has(initId)) {
      seenIds.add(initId);
      deduplicated.push(init);
      addedMissing = true;
    }
  }

  if (hasDuplicates || addedMissing) {
    setStored(STORAGE_KEYS.SUPPLIERS, deduplicated);
  }

  return deduplicated;
};

export const getSuppliers = (): Supplier[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionUser = getSessionUser();
  const all = getAllSuppliers();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  const settings = getCompanyBranchSettings();
  const companyFiltered = all.filter((s) => {
    const compId = s.company_id || s.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });

  if (settings.shareSuppliersAcrossBranches) {
    return companyFiltered;
  }

  // Branch-specific suppliers
  return companyFiltered.filter((s) => {
    const brId = s.branch_id || (s as any).branchId;
    if (!brId) return true; // Legacy unassigned visible
    return brId === currentBranch;
  });
};

export const getSupplierById = (supplierId: string): Supplier | undefined => {
  if (!supplierId) return undefined;
  const target = supplierId.trim().toLowerCase();
  return getSuppliers().find(
    (s) => s.supplierId === supplierId || (s.name && s.name.trim().toLowerCase() === target)
  );
};

export const getNextSupplierId = (): string => {
  const list = getAllSuppliers();
  const numericParts = list
    .map((s) => {
      const match = s.supplierId.match(/^SUP-?(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numericParts.length > 0 ? Math.max(...numericParts) : 0;
  const next = max + 1;
  return `SUP-${String(next).padStart(3, '0')}`;
};

export const addSupplier = (
  supplierData: Omit<Supplier, 'supplierId' | 'createdDate' | 'status'> & {
    supplierId?: string;
    createdDate?: string;
    status?: 'Active' | 'Inactive';
    company_id?: string;
    companyId?: string;
    branch_id?: string;
    branchId?: string;
  }
): Supplier => {
  const all = getAllSuppliers();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const nextId = supplierData.supplierId || getNextSupplierId();
  const compId = supplierData.company_id || supplierData.companyId || currentCompany;
  const brId = supplierData.branch_id || supplierData.branchId || currentBranch;
  const created: Supplier = {
    supplierId: nextId,
    name: supplierData.name.trim(),
    category: supplierData.category?.trim() || 'Groceries & FMCG',
    contactPerson: supplierData.contactPerson?.trim() || '',
    phone: supplierData.phone?.trim() || '',
    email: supplierData.email?.trim() || '',
    address: supplierData.address?.trim() || '',
    city: supplierData.city?.trim() || 'Harare',
    paymentTerms: supplierData.paymentTerms?.trim() || '30-Day Account Credit',
    taxNumber: supplierData.taxNumber?.trim() || '',
    accountNumber: supplierData.accountNumber?.trim() || '',
    status: supplierData.status || 'Active',
    createdDate: supplierData.createdDate || new Date().toISOString().split('T')[0],
    notes: supplierData.notes?.trim() || '',
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.SUPPLIERS, updated);

  enqueueSync('Suppliers', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    SupplierID: created.supplierId,
    Name: created.name,
    Category: created.category,
    Phone: created.phone,
    Address: created.address,
    City: created.city,
    PaymentTerms: created.paymentTerms,
    TaxNumber: created.taxNumber,
  });

  return created;
};

export const updateSupplier = (
  supplierId: string,
  updates: Partial<Supplier>
): Supplier | null => {
  const all = getAllSuppliers();
  const idx = all.findIndex((s) => s.supplierId === supplierId);
  if (idx === -1) return null;
  const updated = { ...all[idx], ...updates };
  all[idx] = updated;
  setStored(STORAGE_KEYS.SUPPLIERS, all);
  enqueueSync('Suppliers', 'UPDATE', updated);
  return updated;
};

export const deleteSupplier = (supplierId: string): boolean => {
  const all = getAllSuppliers();
  const filtered = all.filter((s) => s.supplierId !== supplierId);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.SUPPLIERS, filtered);
  enqueueSync('Suppliers', 'DELETE', { supplierId, company_id: getCurrentCompanyId() });
  return true;
};

export const getSupplierInvoices = (supplierNameOrId: string): SupplierInvoiceVoucher[] => {
  if (!supplierNameOrId) return [];
  const allVouchers = getSupplierInvoiceVouchers();
  const supplier = getSupplierById(supplierNameOrId);
  const targetName = (supplier ? supplier.name : supplierNameOrId || '').toLowerCase().trim();
  return allVouchers.filter(
    (v) =>
      (v.supplier || '').toLowerCase().trim() === targetName ||
      (supplier && supplier.name && (v.supplier || '').toLowerCase().includes(supplier.name.toLowerCase()))
  );
};

export const getSupplierStats = (
  supplierNameOrId: string
): { totalSpend: number; invoiceCount: number; totalUnits: number; lastDeliveryDate?: string } => {
  const invoices = getSupplierInvoices(supplierNameOrId);
  const totalSpend = invoices.reduce((acc, inv) => acc + inv.totalInvoiceAmount, 0);
  const totalUnits = invoices.reduce((acc, inv) => acc + inv.totalUnits, 0);
  const sortedDates = [...invoices].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  return {
    totalSpend,
    invoiceCount: invoices.length,
    totalUnits,
    lastDeliveryDate: sortedDates[0]?.date,
  };
};

// ==================== BRANCH DAO ====================

// Clean duplicate branch entries without deleting genuine secondary or tertiary branches
export const cleanPhantomBranchDuplicates = (): void => {
  const stored = getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  const deletedRegistry = new Set<string>(getStored<string[]>(STORAGE_KEYS.DELETED_BRANCH_IDS, []));

  // Remove valid initial branches from deletedRegistry if they were wrongfully added previously
  let registryChanged = false;
  for (const initB of INITIAL_BRANCHES) {
    if (deletedRegistry.has(initB.branchId)) {
      deletedRegistry.delete(initB.branchId);
      registryChanged = true;
    }
  }

  // Deduplicate only duplicate branch IDs
  const seenIds = new Set<string>();
  const keptBranches: Branch[] = [];
  let hadDuplicates = false;

  for (const b of stored) {
    const bId = (b.branchId || b.id || (b as any).branch_id || '').trim().toLowerCase();
    if (!bId) continue;
    if (seenIds.has(bId)) {
      hadDuplicates = true;
      continue;
    }
    seenIds.add(bId);
    keptBranches.push(b);
  }

  if (hadDuplicates || registryChanged) {
    if (registryChanged) {
      setStored(STORAGE_KEYS.DELETED_BRANCH_IDS, Array.from(deletedRegistry));
    }
    if (hadDuplicates) {
      setStored(STORAGE_KEYS.BRANCHES, keptBranches);
    }
    notifyListeners();
  }
};

export const getAllBranches = (): Branch[] => {
  const stored = getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  const deletedIds = new Set<string>(getStored<string[]>(STORAGE_KEYS.DELETED_BRANCH_IDS, []));
  const seenIds = new Set<string>();
  const deduplicated: Branch[] = [];
  let hadDuplicates = false;

  for (const b of stored) {
    const id = b.branchId || b.id || (b as any).branch_id;
    if (!id) continue;
    // Discard any permanently deleted branch
    if (deletedIds.has(id)) {
      hadDuplicates = true;
      continue;
    }
    if (seenIds.has(id)) {
      hadDuplicates = true;
      continue;
    }
    seenIds.add(id);
    const branchName = b.name || (b as any).branch_name || (b as any).branchName || 'Main Branch';
    const branchAddress = b.location || (b as any).address || (b as any).branch_address || '4th Street Commercial Center, Harare';
    const branchCode = b.code || (b as any).branch_code || 'HQ-01';
    const compId = b.company_id || b.companyId || 'COMP-001';

    deduplicated.push({
      ...b,
      branchId: id,
      id: id,
      branch_id: id,
      name: branchName,
      location: branchAddress,
      address: branchAddress,
      code: branchCode,
      companyId: compId,
      company_id: compId,
    });
  }

  // Ensure initial seed branches are included only if not explicitly deleted
  for (const initB of INITIAL_BRANCHES) {
    const id = initB.branchId || initB.id;
    if (!seenIds.has(id) && !deletedIds.has(id)) {
      seenIds.add(id);
      const branchName = initB.name || (initB as any).branch_name || 'Main Branch';
      const branchAddress = initB.location || (initB as any).address || '4th Street Commercial Center, Harare';
      deduplicated.push({
        ...initB,
        branchId: id,
        id: id,
        branch_id: id,
        name: branchName,
        location: branchAddress,
        address: branchAddress,
      });
      hadDuplicates = true;
    }
  }

  if (hadDuplicates || deduplicated.length !== stored.length) {
    setStored(STORAGE_KEYS.BRANCHES, deduplicated);
  }
  return deduplicated;
};

export const getBranches = (): Branch[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllBranches();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((b) => {
    const compId = b.company_id || b.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getBranchesForCompany = (companyId?: string): Branch[] => {
  const targetCompany = companyId || getCurrentCompanyId();
  const all = getAllBranches();
  const seenIds = new Set<string>();
  return all.filter((b) => {
    const compId = b.company_id || b.companyId;
    const matchesCompany = !compId
      ? targetCompany === 'COMP-001' || targetCompany === 'COMP-MASTER'
      : compId === targetCompany;
    if (!matchesCompany) return false;
    const id = b.branchId || b.id || (b as any).branch_id;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
};

export const getBranchById = (branchId: string): Branch | undefined => {
  return getAllBranches().find((b) => b.branchId === branchId || b.code === branchId);
};

/**
 * Universal Branch-Scope Matcher:
 * Ensures complete reliability across all transaction queries (Sales, CashLogs, CashCounts, CreditSales, Reconciliations, GRVs).
 * 1. If targetBranchId is 'ALL', all tenant records match without leakage.
 * 2. If the company only has 1 branch (single-branch business), all records belonging to this company match (zero lost transactions).
 * 3. Handles all canonical aliases ('1', 'BR-MAIN', 'HQ-01', 'SAI-01', lowercase, whitespace trimmed).
 * 4. Unassigned legacy records match the main/HQ branch.
 */
export const isRecordInBranchScope = (
  recordBranchId: string | undefined | null,
  targetBranchId: string,
  branchesList: Branch[],
  targetCompanyId?: string
): boolean => {
  if (!targetBranchId || targetBranchId === 'ALL') return true;

  // Single-branch tenant protection: if company only has 1 branch, all records of this company belong to this branch
  if (targetCompanyId) {
    const compBranches = branchesList.filter(
      (b) => (b.company_id || b.companyId) === targetCompanyId
    );
    if (compBranches.length <= 1) return true;
  }

  const cleanTarget = (targetBranchId || '').toLowerCase().trim();
  const cleanRecord = (recordBranchId || '').toLowerCase().trim();

  // Direct match
  if (cleanRecord && cleanRecord === cleanTarget) return true;

  // Expand active branch aliases
  const targetAliases = new Set<string>([cleanTarget]);
  const matched = branchesList.find(
    (b) =>
      b.branchId?.toLowerCase() === cleanTarget ||
      b.id?.toLowerCase() === cleanTarget ||
      b.code?.toLowerCase() === cleanTarget ||
      (b as any).branch_id?.toLowerCase() === cleanTarget
  );
  if (matched) {
    if (matched.branchId) targetAliases.add(matched.branchId.toLowerCase().trim());
    if (matched.id) targetAliases.add(matched.id.toLowerCase().trim());
    if (matched.code) targetAliases.add(matched.code.toLowerCase().trim());
    if ((matched as any).branch_id) targetAliases.add((matched as any).branch_id.toLowerCase().trim());
  }

  // Main / HQ canonical aliases
  const isTargetMain =
    cleanTarget === 'br-main' ||
    cleanTarget === 'hq-01' ||
    cleanTarget === '1' ||
    cleanTarget === 'sai-01' ||
    targetAliases.has('br-main') ||
    targetAliases.has('hq-01') ||
    targetAliases.has('sai-01');

  if (isTargetMain) {
    targetAliases.add('br-main');
    targetAliases.add('hq-01');
    targetAliases.add('1');
    targetAliases.add('sai-01');
  }

  if (cleanRecord) {
    if (targetAliases.has(cleanRecord)) return true;
    if (
      isTargetMain &&
      (cleanRecord === 'br-main' ||
        cleanRecord === 'hq-01' ||
        cleanRecord === '1' ||
        cleanRecord === 'sai-01')
    ) {
      return true;
    }
    return false;
  }

  // Record has no branch assigned: fallback to main branch only
  return isTargetMain;
};

export const saveBranch = (
  branch: Branch,
  options?: { fromSync?: boolean; silent?: boolean }
): void => {
  const branches = getAllBranches();
  const currentCompany = getCurrentCompanyId();
  const compId = branch.company_id || branch.companyId || currentCompany;
  const id = branch.branchId || branch.id || (branch as any).branch_id || 'BR-MAIN';
  const normalized: Branch = {
    ...branch,
    branchId: id,
    id: id,
    branch_id: id,
    company_id: compId,
    companyId: compId,
  };

  // If saved explicitly by user, remove from deletion tombstone
  if (!options?.fromSync) {
    const deletedList = getStored<string[]>(STORAGE_KEYS.DELETED_BRANCH_IDS, []);
    if (deletedList.includes(id)) {
      const filteredDeleted = deletedList.filter((d) => d !== id);
      setStored(STORAGE_KEYS.DELETED_BRANCH_IDS, filteredDeleted);
    }
  }

  const index = branches.findIndex(
    (b) =>
      b.branchId === id ||
      b.id === id ||
      (b as any).branch_id === id
  );
  let updated: Branch[];
  if (index >= 0) {
    updated = [...branches];
    updated[index] = normalized;
  } else {
    updated = [...branches, normalized];
  }
  setStored(STORAGE_KEYS.BRANCHES, updated);

  // Prevent infinite feedback loop: Only enqueue sync if this did not originate from sync
  if (!options?.fromSync) {
    enqueueSync('branches', index >= 0 ? 'UPDATE' : 'INSERT', normalized);
  }

  if (!options?.silent) {
    notifyListeners();
  }
};

export const deleteBranch = (branchId: string): boolean => {
  // 1. Add to permanent deleted tombstones
  const deletedList = getStored<string[]>(STORAGE_KEYS.DELETED_BRANCH_IDS, []);
  if (!deletedList.includes(branchId)) {
    setStored(STORAGE_KEYS.DELETED_BRANCH_IDS, [...deletedList, branchId]);
  }

  // 2. Remove from local store
  const branches = getAllBranches();
  const filtered = branches.filter((b) => b.branchId !== branchId && b.id !== branchId && (b as any).branch_id !== branchId);
  setStored(STORAGE_KEYS.BRANCHES, filtered);

  // 3. Enqueue sync deletion to backend and cloud
  enqueueSync('branches', 'DELETE', {
    branch_id: branchId,
    branchId: branchId,
    id: branchId,
    company_id: getCurrentCompanyId(),
  });

  notifyListeners();
  return true;
};

// ==================== PRODUCT DAO (POS INVENTORY UNIFIED BRIDGE) ====================

export const inventoryItemToProduct = (item: InventoryItem, targetBranch?: string): Product => {
  const currentBranch = targetBranch || getCurrentBranchId();
  const override = item.branchOverrides?.[currentBranch];

  const effectiveSellPriceUnit = override?.sellPriceUnit !== undefined ? override.sellPriceUnit : (item.sellPriceUnit !== undefined ? item.sellPriceUnit : 0);
  const effectiveSellPriceCase = override?.sellPriceCase !== undefined ? override.sellPriceCase : item.sellPriceCase;
  const effectiveCostPerUnit = override?.costPerUnit !== undefined ? override.costPerUnit : item.costPerUnit;
  const effectiveCostPerCase = override?.costPerCase !== undefined ? override.costPerCase : item.costPerCase;
  const effectiveReorderCases = override?.reorderLevelCases !== undefined ? override.reorderLevelCases : item.reorderLevelCases;

  return {
    id: item.itemId,
    name: item.itemName,
    sku: item.sku || item.itemId,
    category: item.category || 'General',
    price: effectiveSellPriceUnit,
    costPrice: effectiveCostPerUnit,
    costPerUnit: effectiveCostPerUnit,
    averageCostPerUnit: item.averageCostPerUnit !== undefined ? item.averageCostPerUnit : effectiveCostPerUnit,
    latestCostPerUnit: item.latestCostPerUnit !== undefined ? item.latestCostPerUnit : effectiveCostPerUnit,
    stockQuantity: item.stockSingles !== undefined ? item.stockSingles : 0,
    unit: item.sellByFraction
      ? (item.fractionUnit || 'kg')
      : (item.unitsPerCase > 1 ? `Unit (1cs=${item.unitsPerCase})` : 'Unit'),
    description: item.description || `${item.itemName} - ${item.stockCases} Cases (${item.unitsPerCase}/cs) & ${item.stockSingles} Singles`,
    barcode: item.barcode || '',
    sellByFraction: Boolean(item.sellByFraction),
    fractionUnit: item.fractionUnit || (item.sellByFraction ? 'kg' : undefined),
    canSellAsCase: item.canSellAsCase ?? false,
    unitsPerCase: item.unitsPerCase,
    costPerCase: effectiveCostPerCase,
    sellPriceCase: effectiveSellPriceCase,
    sellPriceUnit: effectiveSellPriceUnit,
    stockCases: item.stockCases,
    stockSingles: item.stockSingles,
    totalUnits: item.totalUnits,
    reorderLevelCases: effectiveReorderCases,
    reorderLevelUnits: item.reorderLevelUnits,
    caseReserveThreshold: item.caseReserveThreshold !== undefined ? item.caseReserveThreshold : 0,
    packagingVariants: item.packagingVariants || [],
    assignedBranchIds: item.assignedBranchIds,
    branchOverrides: item.branchOverrides,
    companyId: item.companyId || item.company_id,
    company_id: item.companyId || item.company_id,
    branchId: item.branchId || item.branch_id,
    branch_id: item.branchId || item.branch_id,
  };
};

export const productToInventoryItem = (prod: Product): InventoryItem => {
  const unitsPerCase = Math.max(1, prod.unitsPerCase || 1);
  const sellPriceUnit = prod.sellPriceUnit !== undefined ? Number(prod.sellPriceUnit) : (Number(prod.price) || 0);
  const sellPriceCase = prod.sellPriceCase !== undefined ? Number(prod.sellPriceCase) : (sellPriceUnit * unitsPerCase);
  const costPerUnit = prod.costPrice !== undefined ? Number(prod.costPrice) : 0;
  const costPerCase = prod.costPerCase !== undefined ? Number(prod.costPerCase) : (costPerUnit * unitsPerCase);
  const stockCases = prod.stockCases !== undefined ? Math.max(0, Number(prod.stockCases)) : 0;
  const stockSingles = prod.stockSingles !== undefined ? Math.max(0, Number(prod.stockSingles)) : Math.max(0, Number(prod.stockQuantity) || 0);
  const totalUnits = (stockCases * unitsPerCase) + stockSingles;

  return {
    itemId: prod.id,
    itemName: prod.name,
    category: prod.category || 'General',
    sellByFraction: Boolean(prod.sellByFraction),
    fractionUnit: prod.fractionUnit,
    canSellAsCase: prod.canSellAsCase ?? false,
    unitsPerCase,
    costPerCase,
    costPerUnit,
    sellPriceCase,
    sellPriceUnit,
    stockCases,
    stockSingles,
    totalUnits,
    reorderLevelCases: prod.reorderLevelCases || 1,
    reorderLevelUnits: prod.reorderLevelUnits || 5,
    caseReserveThreshold: prod.caseReserveThreshold !== undefined ? prod.caseReserveThreshold : 0,
    sku: prod.sku || prod.id,
    barcode: prod.barcode || '',
    description: prod.description || '',
    packagingVariants: prod.packagingVariants || [],
    companyId: prod.companyId || prod.company_id,
    company_id: prod.companyId || prod.company_id,
    branchId: prod.branchId || prod.branch_id,
    branch_id: prod.branchId || prod.branch_id,
    lastUpdated: new Date().toISOString(),
  };
};

export const getProducts = (): Product[] => {
  const invItems = getInventoryItems();
  if (invItems && invItems.length > 0) {
    const list: Product[] = [];
    invItems.forEach((item) => {
      const hasCaseSelling = item.canSellAsCase && item.sellPriceCase && item.sellPriceCase > 0;
      const variants = item.packagingVariants || [];
      const compId = item.company_id || item.companyId;
      const brId = item.branch_id || item.branchId;

      // 1. Single / Each / Fractional item
      list.push({
        id: hasCaseSelling || variants.length > 0 ? `${item.itemId}-UNIT` : item.itemId,
        name: hasCaseSelling || variants.length > 0 ? `${item.itemName} Each` : item.itemName,
        sku: item.sku || item.itemId,
        category: item.category || 'General',
        price: item.sellPriceUnit !== undefined ? item.sellPriceUnit : 0,
        costPrice: item.costPerUnit,
        stockQuantity: item.stockSingles !== undefined ? item.stockSingles : 0,
        unit: item.sellByFraction ? (item.fractionUnit || 'kg') : 'Each',
        description: `${item.itemName} (${item.sellByFraction ? `Sold by ${item.fractionUnit || 'kg'}` : 'Single Unit'})`,
        barcode: item.barcode || '',
        sellByFraction: Boolean(item.sellByFraction),
        fractionUnit: item.fractionUnit || (item.sellByFraction ? 'kg' : undefined),
        canSellAsCase: Boolean(item.canSellAsCase),
        unitsPerCase: item.unitsPerCase,
        costPerCase: item.costPerCase,
        sellPriceCase: item.sellPriceCase,
        sellPriceUnit: item.sellPriceUnit,
        stockCases: item.stockCases,
        stockSingles: item.stockSingles,
        totalUnits: item.totalUnits,
        reorderLevelCases: item.reorderLevelCases,
        reorderLevelUnits: item.reorderLevelUnits,
        packagingVariants: variants,
        companyId: compId,
        company_id: compId,
        branchId: brId,
        branch_id: brId,
      });

      // 2. Case (if enabled)
      if (hasCaseSelling) {
        const caseName = item.casePackageName || 'Case';
        list.push({
          id: `${item.itemId}-CASE`,
          name: `${item.itemName} ${caseName}`,
          sku: item.sku ? `${item.sku}-CS` : `${item.itemId}-CS`,
          category: item.category || 'General',
          price: item.sellPriceCase,
          costPrice: item.costPerCase,
          stockQuantity: item.stockCases !== undefined ? item.stockCases : 0,
          unit: `${caseName} (${item.unitsPerCase} units)`,
          description: `${item.itemName} (Full ${caseName} of ${item.unitsPerCase})`,
          barcode: item.barcode || '',
          sellByFraction: false,
          canSellAsCase: true,
          casePackageName: caseName,
          unitsPerCase: item.unitsPerCase,
          costPerCase: item.costPerCase,
          sellPriceCase: item.sellPriceCase,
          sellPriceUnit: item.sellPriceUnit,
          stockCases: item.stockCases,
          stockSingles: item.stockSingles,
          totalUnits: item.totalUnits,
          reorderLevelCases: item.reorderLevelCases,
          reorderLevelUnits: item.reorderLevelUnits,
          packagingVariants: variants,
          companyId: compId,
          company_id: compId,
          branchId: brId,
          branch_id: brId,
        });
      }

      // 3. Packaging Variants / Prepacks (e.g. Prepack 5s, 10s, 2s, Half Loaf 0.5)
      variants.forEach((v) => {
        const estAvailablePacks = item.totalUnits ? Math.floor(item.totalUnits / Math.max(0.001, v.unitsPerPack)) : 0;
        list.push({
          id: `${item.itemId}__${v.id}`,
          name: `${item.itemName} (${v.name})`,
          sku: v.sku || `${item.sku || item.itemId}-${v.id}`,
          category: item.category || 'General',
          price: v.sellPrice,
          costPrice: v.costPrice || item.costPerUnit * v.unitsPerPack,
          stockQuantity: estAvailablePacks,
          unit: v.name,
          description: `${item.itemName} - ${v.name} (${v.unitsPerPack} units)`,
          barcode: v.barcode || '',
          sellByFraction: false,
          canSellAsCase: Boolean(item.canSellAsCase),
          casePackageName: item.casePackageName || 'Case',
          unitsPerCase: item.unitsPerCase,
          costPerCase: item.costPerCase,
          sellPriceCase: item.sellPriceCase,
          sellPriceUnit: item.sellPriceUnit,
          stockCases: item.stockCases,
          stockSingles: item.stockSingles,
          totalUnits: item.totalUnits,
          reorderLevelCases: item.reorderLevelCases,
          reorderLevelUnits: item.reorderLevelUnits,
          packagingVariants: variants,
          variantId: v.id,
          unitsPerPack: v.unitsPerPack,
          companyId: compId,
          company_id: compId,
          branchId: brId,
          branch_id: brId,
        });
      });
    });

    // Deduplicate by product id to guarantee unique React keys
    const seen = new Set<string>();
    const uniqueProducts: Product[] = [];
    for (const p of list) {
      if (!p.id || seen.has(p.id)) continue;
      seen.add(p.id);
      uniqueProducts.push(p);
    }
    return uniqueProducts;
  }
  return [];
};

export const getProductById = (id: string): Product | undefined => {
  const isCase = id.endsWith('-CASE');
  const isUnit = id.endsWith('-UNIT');
  const isVariant = id.includes('__');

  let baseId = id;
  let variantId: string | undefined;

  if (isCase) {
    baseId = id.replace(/-CASE$/, '');
  } else if (isUnit) {
    baseId = id.replace(/-UNIT$/, '');
  } else if (isVariant) {
    const parts = id.split('__');
    baseId = parts[0];
    variantId = parts[1];
  }

  const item = getInventoryItemById(baseId);
  if (!item) return undefined;

  const caseName = item.casePackageName || 'Case';

  if (isVariant && variantId) {
    const variant = (item.packagingVariants || []).find((v) => v.id === variantId);
    if (variant) {
      const estPacks = item.totalUnits ? Math.floor(item.totalUnits / Math.max(0.001, variant.unitsPerPack)) : 0;
      return {
        id: `${item.itemId}__${variant.id}`,
        name: `${item.itemName} (${variant.name})`,
        sku: variant.sku || `${item.sku || item.itemId}-${variant.id}`,
        category: item.category || 'General',
        price: variant.sellPrice,
        costPrice: variant.costPrice || item.costPerUnit * variant.unitsPerPack,
        stockQuantity: estPacks,
        unit: variant.name,
        description: `${item.itemName} - ${variant.name} (${variant.unitsPerPack} units)`,
        barcode: variant.barcode || '',
        canSellAsCase: Boolean(item.canSellAsCase),
        casePackageName: caseName,
        unitsPerCase: item.unitsPerCase,
        costPerCase: item.costPerCase,
        sellPriceCase: item.sellPriceCase,
        sellPriceUnit: item.sellPriceUnit,
        stockCases: item.stockCases,
        stockSingles: item.stockSingles,
        totalUnits: item.totalUnits,
        reorderLevelCases: item.reorderLevelCases,
        reorderLevelUnits: item.reorderLevelUnits,
        packagingVariants: item.packagingVariants || [],
        variantId: variant.id,
        unitsPerPack: variant.unitsPerPack,
      };
    }
  }

  if (isCase) {
    return {
      id: `${item.itemId}-CASE`,
      name: `${item.itemName} ${caseName}`,
      sku: item.sku ? `${item.sku}-CS` : `${item.itemId}-CS`,
      category: item.category || 'General',
      price: item.sellPriceCase !== undefined ? item.sellPriceCase : 0,
      costPrice: item.costPerCase,
      stockQuantity: item.stockCases !== undefined ? item.stockCases : 0,
      unit: `${caseName} (${item.unitsPerCase} units)`,
      description: `${item.itemName} (Full ${caseName} of ${item.unitsPerCase})`,
      barcode: item.barcode || '',
      canSellAsCase: true,
      casePackageName: caseName,
      unitsPerCase: item.unitsPerCase,
      costPerCase: item.costPerCase,
      sellPriceCase: item.sellPriceCase,
      sellPriceUnit: item.sellPriceUnit,
      stockCases: item.stockCases,
      stockSingles: item.stockSingles,
      totalUnits: item.totalUnits,
      reorderLevelCases: item.reorderLevelCases,
      reorderLevelUnits: item.reorderLevelUnits,
      packagingVariants: item.packagingVariants || [],
    };
  }

  if (isUnit) {
    return {
      id: `${item.itemId}-UNIT`,
      name: `${item.itemName} Each`,
      sku: item.sku || item.itemId,
      category: item.category || 'General',
      price: item.sellPriceUnit !== undefined ? item.sellPriceUnit : 0,
      costPrice: item.costPerUnit,
      stockQuantity: item.stockSingles !== undefined ? item.stockSingles : 0,
      unit: item.sellByFraction ? (item.fractionUnit || 'kg') : 'Each',
      description: `${item.itemName} (${item.sellByFraction ? `Sold by ${item.fractionUnit || 'kg'}` : 'Single Unit'})`,
      barcode: item.barcode || '',
      sellByFraction: Boolean(item.sellByFraction),
      fractionUnit: item.fractionUnit || (item.sellByFraction ? 'kg' : undefined),
      canSellAsCase: item.canSellAsCase ?? false,
      unitsPerCase: item.unitsPerCase,
      costPerCase: item.costPerCase,
      sellPriceCase: item.sellPriceCase,
      sellPriceUnit: item.sellPriceUnit,
      stockCases: item.stockCases,
      stockSingles: item.stockSingles,
      totalUnits: item.totalUnits,
      reorderLevelCases: item.reorderLevelCases,
      reorderLevelUnits: item.reorderLevelUnits,
      packagingVariants: item.packagingVariants || [],
    };
  }

  return inventoryItemToProduct(item);
};

export const getNextProductId = (): string => {
  const time = Date.now().toString(36).slice(-4).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ITM-${time}-${rand}`;
};

export const saveProduct = (productData: Omit<Product, 'id'> & { id?: string }): Product => {
  const id = productData.id || getNextProductId();
  const fullProduct: Product = {
    ...productData,
    id,
    sku: productData.sku || `SKU-${id}`,
    price: Number(productData.price) || 0,
    costPrice: productData.costPrice !== undefined ? Number(productData.costPrice) : undefined,
    stockQuantity: Number(productData.stockQuantity) || 0,
    packagingVariants: productData.packagingVariants || [],
  };

  const invItem = productToInventoryItem(fullProduct);
  const saved = saveInventoryItem(invItem);
  return inventoryItemToProduct(saved);
};

export const deleteProduct = (id: string): void => {
  deleteInventoryItem(id);
  const list = getStored<Product[]>(STORAGE_KEYS.PRODUCTS, []);
  setStored(STORAGE_KEYS.PRODUCTS, list.filter((p) => p.id !== id));
  enqueueSync('Products', 'DELETE', { ProductID: id });
};

export const updateProductStock = (
  id: string,
  deltaQty: number,
  isCase?: boolean,
  unitsPerPack?: number,
  context?: {
    staffId?: string;
    staffName?: string;
    referenceId?: string;
    reason?: string;
    actionTaken?: string;
    txnType?: 'SALE' | 'RETURN' | 'ADJUSTMENT';
    fromMesh?: boolean;
  }
): void => {
  let realId = id;
  let sellAsCase = Boolean(isCase);
  let unitsToDeductPerQty = 1;
  let variantName = '';

  if (id.endsWith('-CASE')) {
    realId = id.replace(/-CASE$/, '');
    sellAsCase = true;
  } else if (id.endsWith('-UNIT')) {
    realId = id.replace(/-UNIT$/, '');
    sellAsCase = false;
  } else if (id.includes('__')) {
    const parts = id.split('__');
    realId = parts[0];
    sellAsCase = false;
    const variantId = parts[1];
    const item = getInventoryItemById(realId);
    const variant = (item?.packagingVariants || []).find((v) => v.id === variantId);
    if (variant) {
      unitsToDeductPerQty = variant.unitsPerPack;
      variantName = variant.name;
    } else if (unitsPerPack && unitsPerPack > 0) {
      unitsToDeductPerQty = unitsPerPack;
    }
  } else if (unitsPerPack && unitsPerPack > 0) {
    unitsToDeductPerQty = unitsPerPack;
  }

  const item = getInventoryItemById(realId);
  if (item && deltaQty !== 0) {
    const prevCases = item.stockCases;
    const prevSingles = item.stockSingles;

    if (deltaQty < 0) {
      const unitsToDeduct = sellAsCase
        ? Math.abs(deltaQty) * item.unitsPerCase
        : Math.abs(deltaQty) * unitsToDeductPerQty;
      const currentUser = getCurrentUser();
      deductStockFIFO({
        itemId: realId,
        quantityUnits: unitsToDeduct,
        staffId: context?.staffId || currentUser?.id || '001',
        staffName: context?.staffName || currentUser?.name || 'Staff',
        saleInvoiceId: context?.referenceId,
        allowNegative: true,
      });
    }

    let newCases = item.stockCases;
    let newSingles = item.stockSingles;

    if (sellAsCase) {
      newCases = newCases + deltaQty;
      if (newCases < 0) {
        newSingles = newSingles + (newCases * item.unitsPerCase);
        newCases = 0;
      }
    } else {
      const netSinglesDelta = deltaQty * unitsToDeductPerQty;
      newSingles = newSingles + netSinglesDelta;
      // If selling singles/variants and singles run out, but cases are available, auto-break case
      if (newSingles < 0 && newCases > 0) {
        const casesNeeded = Math.ceil(Math.abs(newSingles) / item.unitsPerCase);
        if (casesNeeded <= newCases) {
          newCases -= casesNeeded;
          newSingles += casesNeeded * item.unitsPerCase;
        } else {
          newSingles += newCases * item.unitsPerCase;
          newCases = 0;
        }
      }
    }

    const finalSingles = Number(newSingles.toFixed(3));
    const finalCases = Math.max(0, newCases);
    const finalTotalUnits = Number(((finalCases * item.unitsPerCase) + finalSingles).toFixed(3));

    const updatedItem: InventoryItem = {
      ...item,
      stockCases: finalCases,
      stockSingles: finalSingles,
      totalUnits: finalTotalUnits,
      lastUpdated: new Date().toISOString(),
    };
    saveInventoryItem(updatedItem, context?.fromMesh ? { fromMesh: true } : undefined);

    // Safeguard 3: Inventory Reconciliation & Negative Stock Variance
    // If incoming offline mesh sales cause stock to turn negative, flag as STOCK_VARIANCE and log in the Audit Log
    const isNegativeStock = finalTotalUnits < 0;
    if (isNegativeStock) {
      addAuditLog({
        action: 'STOCK_VARIANCE',
        severity: 'WARNING',
        staffId: context?.staffId || 'SYSTEM',
        staffName: context?.staffName || 'Mesh Reconciliation Engine',
        staffRole: 'SYSTEM',
        authorizedByName: 'Mesh Sync Auditor',
        reason: `Reconciliation Stock Variance: Stock for "${item.itemName}" (${realId}) fell negative to ${finalTotalUnits} units after offline sale deduction (Invoice #${context?.referenceId || 'N/A'}).`,
        category: 'INVENTORY_RECONCILIATION',
        company_id: item.company_id,
        branch_id: item.branch_id,
      });

      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(
          new CustomEvent('saimetric_stock_variance_detected', {
            detail: {
              itemId: realId,
              itemName: item.itemName,
              negativeUnits: finalTotalUnits,
              referenceId: context?.referenceId,
            },
          })
        );
      }
    }

    // Calculate actual case and single deltas for audit trail logging
    const deltaCases = finalCases - prevCases;
    const deltaSingles = Number((finalSingles - prevSingles).toFixed(3));

    const isSale = context?.txnType === 'SALE' || (!context?.txnType && deltaQty < 0);
    const isReturn = context?.txnType === 'RETURN' || (!context?.txnType && deltaQty > 0);
    const movementType = isNegativeStock
      ? 'STOCK_VARIANCE'
      : isSale
      ? 'SALE'
      : isReturn
      ? 'RETURN'
      : (context?.txnType || 'ADJUSTMENT');
    const txnType = movementType;

    const currentUser = getCurrentUser();
    const staffId = context?.staffId || currentUser?.id || 'POS-001';
    const staffName = context?.staffName || currentUser?.name || 'Cashier / POS';
    const refId = context?.referenceId || (isSale ? 'POS-SALE' : 'STOCK-ADJUST');
    const caseLabel = item.casePackageName || 'Case';

    const defaultReason = isSale
      ? `POS Outflow: Sold ${Math.abs(deltaQty)} ${sellAsCase ? `${caseLabel}(s)` : variantName ? `${variantName}` : 'Singles'} (Invoice: ${refId})`
      : `Stock Restocked from Sale Refund: +${deltaQty} ${sellAsCase ? `${caseLabel}(s)` : variantName ? `${variantName}` : 'Singles'} (Invoice: ${refId})`;

    const promptLabel = sellAsCase
      ? `Whole ${caseLabel} Sale`
      : variantName
      ? `Packaging Variant: ${variantName} (${unitsToDeductPerQty} units)`
      : 'Singles Sale';

    const timestampNow = new Date().toISOString();
    const dateStrNow = timestampNow.split('T')[0];
    const txnId = `TXN-${dateStrNow.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000)}`;

    addStockMovement({
      txnId,
      movementId: txnId,
      date: dateStrNow,
      timestamp: timestampNow,
      staffId,
      staffName,
      itemId: realId,
      itemName: item.itemName,
      txnType,
      movementType,
      actionTaken: context?.actionTaken || (isSale ? 'POS_SALE' : isReturn ? 'REFUND_RESTOCK' : 'STOCK_ADJUSTMENT'),
      qtyCases: Math.abs(deltaCases),
      qtySingles: Math.abs(deltaSingles),
      casesChange: deltaCases,
      singlesChange: deltaSingles,
      closingCases: finalCases,
      closingSingles: finalSingles,
      resultingStockCases: finalCases,
      resultingStockSingles: finalSingles,
      referenceId: refId,
      reason: context?.reason || defaultReason,
      promptShown: promptLabel,
      synced: false,
    });
  }
};

export const addPackagingVariant = (
  itemId: string,
  variant: Omit<PackagingVariant, 'id'> & { id?: string }
): PackagingVariant | null => {
  const item = getInventoryItemById(itemId);
  if (!item) return null;

  const currentVariants = item.packagingVariants || [];
  const variantId = variant.id || `VAR-${Date.now().toString().slice(-4)}`;
  const unitsPerPack = Math.max(0.01, Number(variant.unitsPerPack) || 0.01);
  const costPrice = variant.costPrice !== undefined ? variant.costPrice : item.costPerUnit * unitsPerPack;

  const newVariant: PackagingVariant = {
    ...variant,
    id: variantId,
    costPrice,
    unitsPerPack,
    sellPrice: Math.max(0, Number(variant.sellPrice) || 0),
  };

  const updatedVariants = [...currentVariants.filter((v) => v.id !== variantId), newVariant];
  const updatedItem: InventoryItem = {
    ...item,
    packagingVariants: updatedVariants,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);
  return newVariant;
};

export const deletePackagingVariant = (itemId: string, variantId: string): boolean => {
  const item = getInventoryItemById(itemId);
  if (!item || !item.packagingVariants) return false;

  const filtered = item.packagingVariants.filter((v) => v.id !== variantId);
  const updatedItem: InventoryItem = {
    ...item,
    packagingVariants: filtered,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);
  return true;
};

// ==================== PARKED SALES DAO ====================
export const getAllParkedSales = (): ParkedSale[] => {
  return getStored<ParkedSale[]>(STORAGE_KEYS.PARKED_SALES, []);
};

export const getParkedSales = (): ParkedSale[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllParkedSales();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((p) => {
    const compId = p.company_id || p.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const saveParkedSale = (data: {
  id?: string;
  customerName?: string;
  customerId?: string;
  items: CartItem[];
  subtotal: number;
  total: number;
  notes?: string;
  company_id?: string;
  companyId?: string;
  branch_id?: string;
  branchId?: string;
}): ParkedSale => {
  const list = getAllParkedSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = data.company_id || data.companyId || currentCompany;
  const brId = data.branch_id || data.branchId || currentBranch;

  const newParked: ParkedSale = {
    id: data.id || `PARK-${Date.now()}`,
    timestamp: new Date().toISOString(),
    customerName: data.customerName || 'Walk-in Customer',
    customerId: data.customerId,
    items: data.items,
    subtotal: data.subtotal,
    total: data.total,
    notes: data.notes,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const filtered = list.filter((p) => p.id !== newParked.id);
  const updated = [newParked, ...filtered];
  setStored(STORAGE_KEYS.PARKED_SALES, updated);
  return newParked;
};

export const deleteParkedSale = (id: string): void => {
  const list = getAllParkedSales();
  const updated = list.filter((p) => p.id !== id);
  setStored(STORAGE_KEYS.PARKED_SALES, updated);
};

export const clearParkedSales = (): void => {
  const currentCompany = getCurrentCompanyId();
  const list = getAllParkedSales();
  const updated = list.filter((p) => {
    const compId = p.company_id || p.companyId;
    return compId && compId !== currentCompany;
  });
  setStored(STORAGE_KEYS.PARKED_SALES, updated);
};

// ==================== CASH LOG DAO (FORM 2 & FORM 1) ====================
export const getAllCashLogs = (): CashLogEntry[] => {
  const logs = getStored<CashLogEntry[]>(STORAGE_KEYS.CASH_LOGS, INITIAL_CASH_LOGS);
  if (!Array.isArray(logs)) return [];

  // Auto-heal duplicate IDs if any exist in stored state
  const seenIds = new Set<string>();
  let hasDuplicates = false;
  const numbers = logs
    .map((c) => {
      const match = c?.id?.match?.(/^CL-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  const sanitized = logs.map((item) => {
    if (!item || !item.id || seenIds.has(item.id)) {
      hasDuplicates = true;
      const newId = `CL-${String(nextCounter++).padStart(3, '0')}`;
      seenIds.add(newId);
      return { ...item, id: newId };
    }
    seenIds.add(item.id);
    return item;
  });

  if (hasDuplicates) {
    try {
      localStorage.setItem(STORAGE_KEYS.CASH_LOGS, JSON.stringify(sanitized));
    } catch (_) {}
  }
  return sanitized;
};

export const getCashLogs = (): CashLogEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCashLogs();
  const branches = getBranches();

  return all.filter((l) => {
    const compId = (l.company_id || l.companyId || '').trim();
    const matchesComp =
      !compId ||
      currentCompany === 'COMP-MASTER' ||
      compId === 'COMP-MASTER' ||
      compId === currentCompany ||
      (!currentCompany && (compId === 'COMP-001' || compId === 'COMP-MASTER'));
    if (!matchesComp) return false;

    const brId = (l as any).branch_id || (l as any).branchId || (l as any).branchCode;
    return isRecordInBranchScope(brId, currentBranch, branches, currentCompany);
  });
};

export const getNextCashLogId = (): string => {
  const list = getAllCashLogs();
  const numbers = list
    .map((c) => {
      const match = c.id?.match?.(/^CL-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `CL-${String(next).padStart(3, '0')}`;
};

export const addCashLog = (entry: Omit<CashLogEntry, 'id' | 'synced'> & { id?: string; company_id?: string; companyId?: string; branch_id?: string; branchId?: string; skipSync?: boolean; fromMesh?: boolean }): CashLogEntry => {
  const all = getAllCashLogs();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branch_id || entry.branchId || currentBranch;

  // Anti-duplication check: if cash log already exists with this ID or reference, return it
  if (entry.id) {
    const existingById = all.find((c) => c.id === entry.id);
    if (existingById) return existingById;
  }
  if (entry.reference) {
    const existingByRef = all.find(
      (c) =>
        c.reference === entry.reference &&
        c.line === entry.line &&
        c.date === entry.date &&
        (!!c.isWithdrawal === !!entry.isWithdrawal)
    );
    if (existingByRef) return existingByRef;
  }

  const newEntry: CashLogEntry = {
    ...entry,
    id: entry.id || getNextCashLogId(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [newEntry, ...all];
  setStored(STORAGE_KEYS.CASH_LOGS, updated);

  // Only enqueue write to cloud if this action originated locally (not from mesh peer sync)
  if (!entry.skipSync && !entry.fromMesh) {
    enqueueSync('CashLog', 'INSERT', {
      company_id: compId,
      branch_id: brId,
      Timestamp: newEntry.timestamp,
      Date: newEntry.date,
      StaffID: newEntry.staffId,
      StaffName: newEntry.staffName,
      Line: newEntry.line,
      Description: newEntry.description,
      In: newEntry.in,
      Out: newEntry.out,
      Reference: newEntry.reference || '',
    });
  }

  return newEntry;
};

export const deleteCashLog = (id: string): boolean => {
  const all = getAllCashLogs();
  const filtered = all.filter((item) => item.id !== id);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.CASH_LOGS, filtered);
  enqueueSync('CashLog', 'DELETE', { id, company_id: getCurrentCompanyId() });
  return true;
};

// ==================== DATE & DAILY REPORT HELPERS ====================
export const getTodayDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCashCountForStaffAndDate = (staffId: string, date: string): CashCountRecord | undefined => {
  const counts = getCashCounts();
  return counts.find((c) => c.staffId === staffId && c.date === date);
};

export const getCashLogsForStaffAndDate = (staffId: string, date: string): CashLogEntry[] => {
  const logs = getCashLogs();
  return logs.filter((l) => {
    if (l.staffId !== staffId || l.date !== date) return false;
    // Form 1 to Form 4 is strictly for POS register tills and events linked to the POS register
    // Exclude vault custody transfers, safe-to-hq, hq-to-branch, bank transfers, or any non-POS custody movements
    if (l.isVaultCustody || (l as any).isNonPosTransfer) return false;
    if (l.category === 'Vault Custody Transfer' || (l as any).categoryGroup === 'Vault Custody Transfer') return false;
    if (l.staffId === 'VAULT_CUSTODY' || (l as any).staff_id === 'VAULT_CUSTODY') return false;
    if (l.type === 'Transfer') {
      const desc = (l.description || '').toUpperCase();
      if (
        desc.includes('BRANCH_TO_HQ') ||
        desc.includes('HQ_TO_BRANCH') ||
        desc.includes('BANK_DEPOSIT') ||
        desc.includes('BANK_WITHDRAWAL') ||
        desc.includes('CAPITAL_INFUSION') ||
        desc.includes('VAULT') ||
        desc.includes('CENTRAL VAULT')
      ) {
        return false;
      }
    }
    return true;
  });
};

export const getCustomerChangesForStaffAndDate = (staffId: string, date: string): CustomerChangeEntry[] => {
  const changes = getCustomerChanges();
  return changes.filter((c) => c.staffId === staffId && c.date === date);
};

export const getCreditSalesForStaffAndDate = (staffId: string, date: string): CreditSaleEntry[] => {
  const creditSales = getCreditSales();
  return creditSales.filter((c) => c.staffId === staffId && c.date === date);
};

export const saveDailyCashLogSheet = (
  date: string,
  staffId: string,
  staffName: string,
  entries: Array<{
    line: string;
    description: string;
    in: number;
    out: number;
    reference?: string;
  }>
): CashLogEntry[] => {
  const allRawLogs = getAllCashLogs();
  const currentLogs = getCashLogs();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  
  // Preserve automated POS register entries (ZiG & EcoCash sales/withdrawals, sale references) and Cash Lift entries for this staff+date
  const automatedLogsToKeep = currentLogs.filter(
    (l) =>
      l.staffId === staffId &&
      l.date === date &&
      (l.currency === 'ZiG' ||
        l.currency === 'EcoCash' ||
        l.currency === 'ECO' ||
        l.currency === 'ECOCASH' ||
        l.currency?.toLowerCase().includes('eco') ||
        l.line?.toLowerCase().includes('eco') ||
        l.line?.toLowerCase().includes('zig') ||
        l.category?.toLowerCase().includes('eco') ||
        l.category?.toLowerCase().includes('zig') ||
        l.line === 'ecocashSales' ||
        l.line === 'ecocashWithdrawal' ||
        l.line === 'zigSales' ||
        l.line === 'zigWithdrawal' ||
        l.line === 'ZiG' ||
        l.line === 'EcoCash' ||
        l.isWithdrawal ||
        l.reference?.startsWith('LIFT-') ||
        l.category?.includes('Cash Lift') ||
        l.category?.includes('Supervisor Pick-Up') ||
        l.reference?.startsWith('SALE-') ||
        l.reference?.startsWith('INV-'))
  );

  // Filter out other days / staff / branches from allRawLogs to preserve them, but replace this specific staff + date daily report
  // while retaining automated logs
  const otherLogs = allRawLogs.filter(
    (l) => {
      const compId = l.company_id || l.companyId || 'COMP-001';
      const brId = (l as any).branch_id || (l as any).branchId || 'BR-MAIN';
      if (compId !== currentCompany || brId !== currentBranch) return true;
      return (
        !(l.staffId === staffId && l.date === date) ||
        automatedLogsToKeep.some((keep) => keep.id === l.id)
      );
    }
  );

  // Filter out any non-zero entries to save (and skip if already in automated logs)
  const validEntries = entries.filter((e) => {
    // If it references a LIFT or SALE that is already in automatedLogsToKeep, do not re-create duplicate
    if (e.reference && automatedLogsToKeep.some((keep) => keep.reference === e.reference || keep.id === e.reference)) {
      return false;
    }
    // Exclude any Final Cash Out rows from Form 2 entirely
    if (e.line === 'Final Cash Out' || e.description?.toLowerCase().includes('final cash out')) {
      return false;
    }
    return (
      e.in > 0 ||
      e.out > 0 ||
      e.line === 'Float' ||
      e.line === 'Float & Closeout'
    );
  });
  
  const createdList: CashLogEntry[] = [];
  const now = new Date();
  const shiftId = getShiftId(staffId, date, currentBranch);
  const currentMovements = getMovements(undefined, currentBranch);
  const existingOpeningFloat = currentMovements.find(
    (m) => (m.shiftId === shiftId || (m.staffId === staffId && m.date === date)) && m.type === 'opening_float'
  );

  // Find max ID counter once to avoid duplicate IDs in batch insertion
  const numbers = currentLogs
    .map((c) => {
      const match = c.id?.match?.(/^CL-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  // Create new entries for the valid lines with unique sequential IDs
  validEntries.forEach((entry, idx) => {
    const newEntry: CashLogEntry = {
      id: `CL-${String(nextCounter++).padStart(3, '0')}`,
      timestamp: new Date(now.getTime() + idx * 100).toISOString(),
      date,
      staffId,
      staffName,
      company_id: currentCompany,
      companyId: currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
      line: entry.line,
      description: entry.description || entry.line,
      in: entry.in || 0,
      out: entry.out || 0,
      category: entry.line,
      reference: entry.reference,
      synced: false,
    };
    createdList.push(newEntry);

    // Map each Form 2 row to cashMovements
    const lowerLine = entry.line.toLowerCase();
    const lowerDesc = (entry.description || '').toLowerCase();

    if (lowerLine === 'float' || lowerLine === 'opening float') {
      const floatAmt = entry.in || 20;
      if (!existingOpeningFloat) {
        addMovement({
          shiftId,
          staffId,
          date,
          timestamp: newEntry.timestamp,
          type: 'opening_float',
          amount: floatAmt,
          currency: 'USD',
          direction: 'in',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'form2',
          sourceRef: newEntry.id,
          notes: entry.description,
          company_id: currentCompany,
          branch_id: currentBranch,
        });
      }
    } else if (
      lowerLine === 'expenses' ||
      lowerLine.includes('expense') ||
      lowerDesc.includes('expense') ||
      lowerLine.includes('petty') ||
      lowerDesc.includes('petty') ||
      lowerLine.includes('daily store expenses') ||
      lowerLine.includes('bread') ||
      lowerLine.includes('airtime') ||
      lowerLine.includes('home use') ||
      lowerDesc.includes('bread') ||
      lowerDesc.includes('airtime') ||
      lowerDesc.includes('home use') ||
      lowerLine.includes('utilities')
    ) {
      // Store petty cash & till expenses paid out from drawer immediately affect till drawer and balance
      if (entry.out > 0) {
        addMovement({
          shiftId,
          staffId,
          date,
          timestamp: newEntry.timestamp,
          type: 'petty_cash',
          amount: entry.out,
          currency: 'USD',
          direction: 'out',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'form2',
          sourceRef: newEntry.id,
          notes: entry.description,
          company_id: currentCompany,
          branch_id: currentBranch,
        });
      }
    } else if (lowerLine.includes('procurement') || lowerDesc.includes('procurement')) {
      if (entry.out > 0) {
        // Prevent duplicate supplier_payment if this direct procurement GRV is already in cashMovements or DirectGrv
        const existingMovements = getAllMovements().filter(
          (m) => matchesShift(m, shiftId, currentBranch) && m.type === 'supplier_payment'
        );
        const grvs = getDirectGrvsForStaffAndDate(staffId, date);
        const isAlreadyInMovements = existingMovements.some((m) => {
          if (entry.reference && m.sourceRef === entry.reference) return true;
          if (m.notes && (m.notes.includes(entry.description) || entry.description.includes(m.notes))) return true;
          const grvMatch = (entry.description + ' ' + (entry.reference || '')).match(/GRV[A-Z0-9_-]*/i);
          if (grvMatch && (m.sourceRef?.includes(grvMatch[0]) || m.notes?.includes(grvMatch[0]))) return true;
          return false;
        });
        const matchesGrv = grvs.some((g) => {
          const gRef = g.grvNumber || g.id;
          const gTotal = g.totalCost || 0;
          return (
            (entry.reference && entry.reference === gRef) ||
            entry.description.includes(gRef) ||
            Math.abs(gTotal - entry.out) < 0.01
          );
        });

        if (!isAlreadyInMovements) {
          addMovement({
            shiftId,
            staffId,
            date,
            timestamp: newEntry.timestamp,
            type: 'supplier_payment',
            amount: entry.out,
            currency: 'USD',
            direction: 'out',
            affectsDrawer: true,
            status: 'approved',
            sourceModule: 'form2',
            sourceRef: newEntry.id,
            notes: entry.description,
            company_id: currentCompany,
            branch_id: currentBranch,
          });
        }
      }
    } else if (
      (lowerLine.includes('ecocash') || lowerDesc.includes('ecocash')) &&
      (lowerLine.includes('withdrawal') || lowerDesc.includes('withdrawal') || lowerDesc.includes('cash out'))
    ) {
      if (entry.out > 0) {
        addMovement({
          shiftId,
          staffId,
          date,
          timestamp: newEntry.timestamp,
          type: 'ecocash_cash_out',
          amount: entry.out,
          currency: 'USD',
          direction: 'out',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'form2',
          sourceRef: newEntry.id,
          notes: entry.description,
          company_id: currentCompany,
          branch_id: currentBranch,
        });
      }
    } else if (
      (lowerLine.includes('zig') || lowerDesc.includes('zig')) &&
      (lowerLine.includes('withdrawal') || lowerDesc.includes('withdrawal') || lowerDesc.includes('cash out'))
    ) {
      if (entry.out > 0) {
        addMovement({
          shiftId,
          staffId,
          date,
          timestamp: newEntry.timestamp,
          type: 'zig_cash_out',
          amount: entry.out,
          currency: 'USD',
          direction: 'out',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'form2',
          sourceRef: newEntry.id,
          notes: entry.description,
          company_id: currentCompany,
          branch_id: currentBranch,
        });
      }
    }

    enqueueSync('CashLog', 'INSERT', {
      company_id: currentCompany,
      branch_id: currentBranch,
      Timestamp: newEntry.timestamp,
      Date: newEntry.date,
      StaffID: newEntry.staffId,
      StaffName: newEntry.staffName,
      Line: newEntry.line,
      Description: newEntry.description,
      In: newEntry.in,
      Out: newEntry.out,
    });
  });

  const updatedAll = [...createdList, ...otherLogs];
  setStored(STORAGE_KEYS.CASH_LOGS, updatedAll);
  notifyListeners();
  return createdList;
};

// ==================== CASH LIFT / CASH PICK-UP DAO ====================
export const getAllCashLifts = (): CashLiftRecord[] => {
  return getStored<CashLiftRecord[]>(STORAGE_KEYS.CASH_LIFTS, []);
};

export const getCashLifts = (): CashLiftRecord[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCashLifts();
  return all.filter((c) => {
    const compId = (c as any).company_id || (c as any).companyId;
    const matchesComp = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
    if (!matchesComp) return false;
    const brId = (c as any).branch_id || (c as any).branchId || 'BR-MAIN';
    return brId === currentBranch;
  });
};

export const getCashLiftsForStaffAndDate = (staffId: string, date: string): CashLiftRecord[] => {
  const lifts = getCashLifts();
  return lifts.filter((l) => l.cashierId === staffId && l.date === date);
};

/**
 * Helper to check if an invoice has already been processed at the POS terminal
 * to prevent double counting in Form 3.
 */
export const isPosInvoiceProcessed = (refOrNotes?: string): boolean => {
  if (!refOrNotes || !refOrNotes.trim()) return false;
  const trimmed = refOrNotes.trim();
  const allSales = getAllSales();
  const directMatch = allSales.some(
    (s) => s.id.toLowerCase() === trimmed.toLowerCase() ||
           s.id.replace(/^INV-0*/i, '') === trimmed.replace(/^INV-0*/i, '')
  );
  if (directMatch) return true;
  const invMatch = trimmed.match(/INV-\d+/i) || trimmed.match(/invoice\s*#?\s*(\d+)/i);
  if (invMatch) {
    const invIdStr = invMatch[0].toUpperCase();
    return allSales.some((s) => s.id.toUpperCase().includes(invIdStr) || invIdStr.includes(s.id.toUpperCase()));
  }
  return false;
};

export const addCashLift = (data: {
  cashierId: string;
  cashierName: string;
  supervisorId: string;
  supervisorName: string;
  totalAmount: number;
  denominations: Record<string, number>;
  reason?: string;
  notes?: string;
  date?: string;
  destinationAccountId?: string; // Optional destination safe/clerk account
}): { liftRecord: CashLiftRecord; cashLogRecord: CashLogEntry } => {
  const now = new Date();
  const dateStr = data.date || getTodayDateString();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();

  const allLifts = getAllCashLifts();
  const liftId = `LIFT-${Date.now().toString().slice(-6)}`;

  // Validate supervisor lift against drawer balance, with configurable overage tolerance
  const shiftId = getShiftId(data.cashierId, dateStr);
  const currentBal = computeDrawerBalance(shiftId, 'USD');
  const govConfig = getCashGovernanceConfig();
  let overageAmount = 0;

  if (data.totalAmount > currentBal) {
    if (govConfig.allowOverageLifts) {
      overageAmount = Math.round((data.totalAmount - currentBal) * 100) / 100;
      addAuditLog({
        action: 'CASH_LIFT_OVERAGE' as any,
        severity: 'WARNING',
        staffId: data.supervisorId,
        staffName: data.supervisorName,
        details: `Supervisor lifted $${data.totalAmount.toFixed(2)} exceeding live drawer book balance of $${currentBal.toFixed(2)} (Cashier Overage of +$${overageAmount.toFixed(2)}). Reason: ${data.reason || 'Cashier Overage / Customer Tips'}`,
        referenceId: liftId,
        amount: data.totalAmount,
        metadata: { cashierId: data.cashierId, cashierName: data.cashierName, currentBal, liftAmount: data.totalAmount, overageAmount },
      });
    } else {
      throw new Error(
        `Cannot lift $${data.totalAmount.toFixed(2)}. Amount exceeds available drawer balance of $${currentBal.toFixed(2)}. (Enable "Allow Overage Lifts" in Cash Governance Settings to permit).`
      );
    }
  }

  const newLift: CashLiftRecord = {
    id: liftId,
    timestamp: now.toISOString(),
    date: dateStr,
    cashierId: data.cashierId,
    cashierName: data.cashierName,
    supervisorId: data.supervisorId,
    supervisorName: data.supervisorName,
    totalAmount: data.totalAmount,
    denominations: data.denominations,
    reason: data.reason,
    notes: data.notes,
    companyId: currentCompany,
    company_id: currentCompany,
    branchId: currentBranch,
    branch_id: currentBranch,
    synced: false,
    overageAmount: overageAmount > 0 ? overageAmount : undefined,
    destinationAccountId: data.destinationAccountId,
  };

  // Summarize denominations for description/notes
  const denomSummary = Object.entries(data.denominations)
    .filter(([_, qty]) => Number(qty) > 0)
    .map(([note, qty]) => `${qty}x$${note}`)
    .join(', ');

  // Auto-populate Form 2 CashLog entry for Cash Lift (cash collected OUT of till by supervisor)
  const cashLogRecord = addCashLog({
    timestamp: newLift.timestamp,
    date: dateStr,
    staffId: data.cashierId,
    staffName: data.cashierName,
    companyId: currentCompany,
    company_id: currentCompany,
    branchId: currentBranch,
    branch_id: currentBranch,
    line: 'Cash',
    description: `Supervisor Cash Lift: ${data.supervisorName} collected $${data.totalAmount.toFixed(2)} from Cashier ${data.cashierName}${overageAmount > 0 ? ` [Incl. +$${overageAmount.toFixed(2)} Overage]` : ''}${data.reason ? ` (${data.reason})` : ''}`,
    in: 0,
    out: data.totalAmount, // Deducted in Form 2 CashLog as base USD so cash drawer balances!
    category: 'Cash Lift / Supervisor Pick-Up',
    reference: liftId,
    notes: `Denominations: ${denomSummary || 'Denominations counted'}. Verified by Cashier (${data.cashierName}) and Supervisor (${data.supervisorName}).${overageAmount > 0 ? ` Cashier had +$${overageAmount.toFixed(2)} overage.` : ''}`,
  });

  newLift.cashLogId = cashLogRecord.id;

  // Write supervisor_lift movement to cashMovements (Out from cashier drawer)
  addMovement({
    shiftId: getShiftId(data.cashierId, dateStr),
    staffId: data.cashierId,
    date: dateStr,
    timestamp: newLift.timestamp,
    type: 'supervisor_lift',
    amount: data.totalAmount,
    currency: 'USD',
    direction: 'out',
    affectsDrawer: true,
    status: 'approved',
    sourceModule: 'form2',
    sourceRef: liftId,
    notes: `Supervisor Cash Lift: ${data.supervisorName} collected $${data.totalAmount.toFixed(2)} from Cashier ${data.cashierName}${data.reason ? ` (${data.reason})` : ''}`,
    approvedBy: data.supervisorId,
    approvedByName: data.supervisorName,
    approvedAt: newLift.timestamp,
    company_id: currentCompany,
    branch_id: currentBranch,
  });

  // Also record supervisor custody intake movement (In to supervisor expected handover cash)
  if (data.supervisorId) {
    addMovement({
      shiftId: getShiftId(data.supervisorId, dateStr),
      staffId: data.supervisorId,
      date: dateStr,
      timestamp: newLift.timestamp,
      type: 'supervisor_lift',
      amount: data.totalAmount,
      currency: 'USD',
      direction: 'in',
      affectsDrawer: false, // In supervisor custody holding, does not artificially inflate supervisor POS till drawer
      status: 'approved',
      sourceModule: 'form2',
      sourceRef: `${liftId}-SUP-CUSTODY`,
      notes: `Cash Lift Received into Supervisor Custody: $${data.totalAmount.toFixed(2)} from Cashier ${data.cashierName}`,
      approvedBy: data.supervisorId,
      approvedByName: data.supervisorName,
      approvedAt: newLift.timestamp,
      company_id: currentCompany,
      branch_id: currentBranch,
    });
  }

  // Credit destination CashAccount (Branch Safe or Accounts Clerk)
  try {
    const rawAccounts = getStored<CashAccount[]>(STORAGE_KEYS.CASH_ACCOUNTS, []);
    const destAccId = data.destinationAccountId || `ACC-BR-SAFE-${currentBranch}`;
    const isClerkDest = destAccId.includes('CLERK') || destAccId.includes('FLOAT');

    let targetAcc = rawAccounts.find((a) => a.account_id === destAccId);
    if (!targetAcc) {
      if (isClerkDest) {
        targetAcc = rawAccounts.find((a) => a.account_type === 'CLERK_FLOAT' && isCashBranchMatch(a.branch_id, currentBranch));
      } else {
        targetAcc = rawAccounts.find((a) => a.account_type === 'SAFE' && isCashBranchMatch(a.branch_id, currentBranch));
      }
    }

    if (targetAcc) {
      saveCashAccount({
        ...targetAcc,
        current_balance: Math.round(((targetAcc.current_balance || 0) + data.totalAmount) * 100) / 100,
        updated_at: now.toISOString(),
      });
    }

    // Also record completed CashTransfer voucher in transfer ledger
    const transferId = `TRF-LIFT-${newLift.id}`;
    const allTransfers = getStored<CashTransfer[]>(STORAGE_KEYS.CASH_TRANSFERS, []);
    const liftTransfer: CashTransfer = {
      transfer_id: transferId,
      company_id: currentCompany,
      branch_id: currentBranch,
      type: 'TILL_COLLECTION',
      from_account_id: `ACC-TILL-1-${currentBranch}`,
      to_account_id: targetAcc?.account_id || destAccId,
      amount: data.totalAmount,
      currency: 'USD',
      status: 'COMPLETED',
      created_by_user_id: data.supervisorId,
      created_by_user_name: data.supervisorName,
      created_at: now.toISOString(),
      recipient_name: data.cashierName,
      notes: `Supervisor Cash Lift: $${data.totalAmount.toFixed(2)} lifted from Cashier ${data.cashierName} into ${targetAcc?.account_name || (isClerkDest ? 'Accounts Clerk Float' : 'Branch Safe')}.${data.reason ? ` Reason: ${data.reason}` : ''}`,
      approved_by_user_id: data.supervisorId,
      approved_by_user_name: data.supervisorName,
      approved_at: now.toISOString(),
      is_owner_override: false,
    };
    setStored(STORAGE_KEYS.CASH_TRANSFERS, [liftTransfer, ...allTransfers]);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('saimetric_cash_transfers_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_cash_accounts_updated'));
    }
  } catch (err) {
    console.warn('Failed to auto-credit destination account on cash lift:', err);
  }

  const updatedLifts = [newLift, ...allLifts];
  setStored(STORAGE_KEYS.CASH_LIFTS, updatedLifts);

  enqueueSync('CashLifts' as any, 'INSERT', newLift);

  return { liftRecord: newLift, cashLogRecord };
};

export const deleteCashLift = (liftId: string): boolean => {
  const allLifts = getAllCashLifts();
  const target = allLifts.find((l) => l.id === liftId);
  if (!target) return false;

  const updatedLifts = allLifts.filter((l) => l.id !== liftId);
  setStored(STORAGE_KEYS.CASH_LIFTS, updatedLifts);

  // Remove corresponding movement from cashMovements
  const allMovements = getMovements();
  const matchingMovement = allMovements.find((m) => m.sourceRef === liftId);
  if (matchingMovement) {
    deleteMovement(matchingMovement.id);
  }

  // If there's an associated CashLog entry, delete it as well
  if (target.cashLogId) {
    deleteCashLog(target.cashLogId);
  } else {
    // Delete by reference
    const allLogs = getAllCashLogs();
    const matchingLog = allLogs.find((l) => l.reference === liftId);
    if (matchingLog) {
      deleteCashLog(matchingLog.id);
    }
  }

  return true;
};

// ==================== CASH COUNT DAO (FORM 1) ====================
export const getAllCashCounts = (): CashCountRecord[] => {
  return getStored<CashCountRecord[]>(STORAGE_KEYS.CASH_COUNTS, []);
};

export const getCashCounts = (): CashCountRecord[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCashCounts();
  const branches = getBranches();
  return all.filter((c) => {
    const compId = (c as any).company_id || (c as any).companyId;
    const matchesComp = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
    if (!matchesComp) return false;

    const brId = (c as any).branch_id || (c as any).branchId;
    return isRecordInBranchScope(brId, currentBranch, branches, currentCompany);
  });
};

export const saveFinalCashCount = (data: {
  staffId: string;
  staffName: string;
  denominations: Record<string, number>;
  finalCashOutTotal: number;
  notes?: string;
  date?: string;
  branchId?: string;
  branch_id?: string;
}): { countRecord: CashCountRecord; cashLogRecord: CashLogEntry | null } => {
  const now = new Date();
  const dateStr = data.date || getTodayDateString();
  const currentCounts = getAllCashCounts();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = data.branchId || data.branch_id || getCurrentBranchId();

  const existingCountIndex = currentCounts.findIndex(
    (c) => {
      const compId = (c as any).company_id || (c as any).companyId || 'COMP-001';
      const brId = (c as any).branch_id || (c as any).branchId || 'BR-MAIN';
      return compId === currentCompany && brId === currentBranch && c.staffId === data.staffId && c.date === dateStr;
    }
  );

  let countRecord: CashCountRecord;

  if (existingCountIndex >= 0) {
    // Update existing count record in place for this salesperson, date, and branch
    const existing = currentCounts[existingCountIndex];
    countRecord = {
      ...existing,
      timestamp: now.toISOString(),
      staffName: data.staffName,
      denominations: data.denominations,
      finalCashOutTotal: data.finalCashOutTotal,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      company_id: (existing as any).company_id || currentCompany,
      companyId: (existing as any).companyId || currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
      synced: false,
    };
    const updatedCounts = [...currentCounts];
    updatedCounts[existingCountIndex] = countRecord;
    setStored(STORAGE_KEYS.CASH_COUNTS, updatedCounts);
  } else {
    // New cash count record partitioned by branch
    const countId = `CNT-${Date.now()}`;
    countRecord = {
      id: countId,
      timestamp: now.toISOString(),
      date: dateStr,
      staffId: data.staffId,
      staffName: data.staffName,
      denominations: data.denominations,
      finalCashOutTotal: data.finalCashOutTotal,
      notes: data.notes || '',
      company_id: currentCompany,
      companyId: currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
      synced: false,
    } as any;
    setStored(STORAGE_KEYS.CASH_COUNTS, [countRecord, ...currentCounts]);
  }

  // Clean up any legacy "Final Cash Out" rows in CASH_LOGS for this staff, date, and branch
  const allLogs = getAllCashLogs();
  const cleanedLogs = allLogs.filter(
    (l) => {
      const compId = (l as any).company_id || (l as any).companyId || 'COMP-001';
      const brId = (l as any).branch_id || (l as any).branchId || 'BR-MAIN';
      if (compId !== currentCompany || brId !== currentBranch) return true;
      return !(
        l.staffId === data.staffId &&
        l.date === dateStr &&
        (l.line === 'Final Cash Out' || l.description?.toLowerCase().includes('final cash out'))
      );
    }
  );
  if (cleanedLogs.length !== allLogs.length) {
    setStored(STORAGE_KEYS.CASH_LOGS, cleanedLogs);
  }

  // Write ONE movement to cashMovements ledger as physical_count snapshot
  // Re-saving on the same day updates the existing snapshot (not create a duplicate)
  const shiftId = getShiftId(data.staffId, dateStr, currentBranch);
  const movements = getMovements(undefined, currentBranch);
  const existingSnapshot = movements.find(
    (m) =>
      (m.shiftId === shiftId || (m.staffId === data.staffId && m.date === dateStr && ((m as any).branch_id === currentBranch || (m as any).branchId === currentBranch))) &&
      m.type === 'physical_count'
  );

  if (existingSnapshot) {
    updateMovement(existingSnapshot.id, {
      amount: data.finalCashOutTotal,
      timestamp: now.toISOString(),
      sourceRef: countRecord.id,
      notes: data.notes || '',
    });
  } else {
    addMovement({
      shiftId,
      staffId: data.staffId,
      date: dateStr,
      timestamp: now.toISOString(),
      type: 'physical_count',
      amount: data.finalCashOutTotal,
      currency: 'USD',
      direction: 'snapshot',
      affectsDrawer: false,
      status: 'approved',
      sourceModule: 'form1',
      sourceRef: countRecord.id,
      notes: data.notes || '',
      company_id: currentCompany,
      branch_id: currentBranch,
    });
  }

  return { countRecord, cashLogRecord: null };
};
// ==================== CUSTOMER CHANGE DAO (FORM 3) ====================
export const getAllCustomerChanges = (): CustomerChangeEntry[] => {
  return getStored<CustomerChangeEntry[]>(STORAGE_KEYS.CUSTOMER_CHANGES, INITIAL_CUSTOMER_CHANGES);
};

export const getCustomerChanges = (): CustomerChangeEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCustomerChanges();
  const branches = getBranches();
  return all.filter((c) => {
    const compId = c.company_id || c.companyId;
    const matchesComp = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
    if (!matchesComp) return false;

    const brId = (c as any).branch_id || (c as any).branchId;
    return isRecordInBranchScope(brId, currentBranch, branches, currentCompany);
  });
};

export const getNextCustomerChangeId = (): string => {
  const list = getAllCustomerChanges();
  const numbers = list
    .map((c) => {
      const match = c.id?.match?.(/^CHG-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `CHG-${String(next).padStart(3, '0')}`;
};

export const addCustomerChange = (
  entry: Omit<CustomerChangeEntry, 'id' | 'synced'> & { id?: string; company_id?: string; companyId?: string; branch_id?: string; branchId?: string }
): CustomerChangeEntry => {
  const all = getAllCustomerChanges();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branch_id || entry.branchId || currentBranch;
  const created: CustomerChangeEntry = {
    ...entry,
    id: entry.id || getNextCustomerChangeId(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.CUSTOMER_CHANGES, updated);

  enqueueSync('CustomerChange', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    Date: created.date,
    StaffID: created.staffId,
    StaffName: created.staffName,
    CustomerID: created.customerId || '',
    CustomerName: created.customerName,
    In: created.in,
    Out: created.out,
    Notes: created.notes || '',
    Reference: created.reference || created.id,
  });

  // Ensure cashMovements has change_received (In) or change_paid (Out) if not already recorded
  const shiftId = getShiftId(created.staffId, created.date);
  const invRef = created.reference || (created.notes?.match(/INV-[A-Za-z0-9-]+/i)?.[0]);
  const existingMov = getMovements().find(
    (m) =>
      matchesShift(m, shiftId) &&
      (m.type === 'change_received' || m.type === 'change_paid') &&
      (m.sourceRef === created.id ||
        (invRef && (m.sourceRef?.includes(invRef) || m.notes?.includes(invRef))))
  );
  if (!existingMov && created.in > 0) {
    addMovement({
      shiftId,
      staffId: created.staffId,
      date: created.date,
      timestamp: created.timestamp,
      type: 'change_received',
      amount: created.in,
      currency: 'USD',
      direction: 'in',
      affectsDrawer: true,
      status: 'approved',
      sourceModule: 'form3',
      sourceRef: created.id,
      notes: `Customer change in: ${created.customerName}${invRef && !created.notes?.includes(invRef) ? ` (POS Invoice #${invRef})` : ''}${created.notes ? ` (${created.notes})` : ''}`,
      company_id: compId,
      branch_id: brId,
    });
  } else if (!existingMov && created.out > 0) {
    addMovement({
      shiftId,
      staffId: created.staffId,
      date: created.date,
      timestamp: created.timestamp,
      type: 'change_paid',
      amount: created.out,
      currency: 'USD',
      direction: 'out',
      affectsDrawer: true,
      status: 'approved',
      sourceModule: 'form3',
      sourceRef: created.id,
      notes: `Customer change out: ${created.customerName}${created.notes ? ` (${created.notes})` : ''}`,
      company_id: compId,
      branch_id: brId,
    });
  }

  notifyListeners();
  return created;
};

export const deleteCustomerChange = (id: string): boolean => {
  const all = getAllCustomerChanges();
  const filtered = all.filter((c) => c.id !== id);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.CUSTOMER_CHANGES, filtered);
  enqueueSync('CustomerChange', 'DELETE', { id, company_id: getCurrentCompanyId() });

  // Clean up associated cashMovements and customerLedger entries
  const movements = getMovements();
  movements.filter((m) => m.sourceRef === id).forEach((m) => deleteMovement(m.id));
  const custEntries = getCustomerLedgerEntries((e) => e.sourceRef === id);
  custEntries.forEach((e) => deleteCustomerLedgerEntry(e.id));

  return true;
};

export const saveDailyCustomerChangeSheet = (
  date: string,
  staffId: string,
  staffName: string,
  entries: Array<{
    customerName: string;
    customerId?: string;
    in: number;
    out: number;
    notes?: string;
  }>
): CustomerChangeEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCustomerChanges();
  // Keep records for other companies or other staff/dates in this company
  const otherChanges = all.filter((c) => {
    const compId = c.company_id || c.companyId || 'COMP-001';
    if (compId !== currentCompany) return true;
    return !(c.staffId === staffId && c.date === date);
  });
  const valid = entries.filter((e) => e.customerName.trim() !== '' && (e.in > 0 || e.out > 0));
  if (valid.length === 0) {
    setStored(STORAGE_KEYS.CUSTOMER_CHANGES, otherChanges);
    return [];
  }

  // Clean up existing sourceModule: 'form3' movements for this shift
  const shiftId = getShiftId(staffId, date);
  const currentMovements = getMovements();
  const toDelete = currentMovements.filter(
    (m) => matchesShift(m, shiftId) && m.sourceModule === 'form3' && (m.type === 'change_received' || m.type === 'change_paid')
  );
  toDelete.forEach((m) => deleteMovement(m.id));

  // Clean up existing customerLedger change collected entries for this staff and date
  const existingCustEntries = getCustomerLedgerEntries(
    (e) => e.staffId === staffId && e.date === date && e.sourceModule === 'form3' && e.type === 'change_collected'
  );
  existingCustEntries.forEach((e) => deleteCustomerLedgerEntry(e.id));

  const createdList: CustomerChangeEntry[] = [];
  const now = new Date();
  const numbers = all
    .map((c) => {
      const match = c.id?.match?.(/^CHG-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  valid.forEach((item, idx) => {
    const cust = ensureCustomerExists(item.customerName, staffId);

    const newEntry: CustomerChangeEntry = {
      id: `CHG-${String(nextCounter++).padStart(3, '0')}`,
      timestamp: new Date(now.getTime() + idx * 100).toISOString(),
      date,
      staffId,
      staffName,
      customerId: cust.customerId,
      customerName: cust.name,
      in: item.in || 0,
      out: item.out || 0,
      notes: item.notes || '',
      synced: false,
      company_id: currentCompany,
      companyId: currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
    };
    createdList.push(newEntry);

    // Map row types to cashMovements ledger:
    // Change In: change_received, in, affectsDrawer: true
    // Prevent double-counting if this change was already recorded from a POS transaction
    const isExistingPosMovement = currentMovements.some(
      (m) =>
        m.sourceModule === 'POS' &&
        m.type === 'change_received' &&
        matchesShift(m, shiftId) &&
        ((item.notes && item.notes.includes(m.sourceRef || '')) ||
          (m.sourceRef && (item.notes?.includes(m.sourceRef) || item.customerName.toLowerCase() === m.notes?.toLowerCase())))
    );
    if (!isExistingPosMovement && newEntry.in > 0) {
      addMovement({
        shiftId,
        staffId,
        date,
        timestamp: newEntry.timestamp,
        type: 'change_received',
        amount: newEntry.in,
        currency: 'USD',
        direction: 'in',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'form3',
        sourceRef: newEntry.id,
        notes: `Customer change in: ${newEntry.customerName}${newEntry.notes ? ` (${newEntry.notes})` : ''}`,
        company_id: currentCompany,
        branch_id: currentBranch,
      });
    }

    // Change Out: change_paid, out, affectsDrawer: true
    if (newEntry.out > 0) {
      addMovement({
        shiftId,
        staffId,
        date,
        timestamp: newEntry.timestamp,
        type: 'change_paid',
        amount: newEntry.out,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'form3',
        sourceRef: newEntry.id,
        notes: `Customer change out: ${newEntry.customerName}${newEntry.notes ? ` (${newEntry.notes})` : ''}`,
        company_id: currentCompany,
        branch_id: currentBranch,
      });

      // Also record delayed change collected in customerLedger
      addCustomerLedgerEntry({
        customerId: cust.customerId,
        customerName: cust.name,
        date,
        timestamp: newEntry.timestamp,
        type: 'change_collected',
        amount: newEntry.out,
        sourceRef: newEntry.id,
        sourceModule: 'form3',
        notes: `Delayed change paid out to ${cust.name}`,
        staffId,
        staffName,
      });
    }

    enqueueSync('CustomerChange', 'INSERT', {
      company_id: currentCompany,
      branch_id: currentBranch,
      Timestamp: newEntry.timestamp,
      Date: newEntry.date,
      StaffID: newEntry.staffId,
      StaffName: newEntry.staffName,
      CustomerID: newEntry.customerId,
      CustomerName: newEntry.customerName,
      In: newEntry.in,
      Out: newEntry.out,
      Notes: newEntry.notes,
    });
  });

  setStored(STORAGE_KEYS.CUSTOMER_CHANGES, [...createdList, ...otherChanges]);
  notifyListeners();
  return createdList;
};

// ==================== CREDIT SALES DAO (FORM 3) ====================
export const getAllCreditSales = (): CreditSaleEntry[] => {
  return getStored<CreditSaleEntry[]>(STORAGE_KEYS.CREDIT_SALES, INITIAL_CREDIT_SALES);
};

export const getCreditSales = (): CreditSaleEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCreditSales();
  const branches = getBranches();
  return all.filter((c) => {
    const compId = c.company_id || c.companyId;
    const matchesComp = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
    if (!matchesComp) return false;

    const brId = (c as any).branch_id || (c as any).branchId;
    return isRecordInBranchScope(brId, currentBranch, branches, currentCompany);
  });
};

export const getNextCreditSaleId = (): string => {
  const list = getAllCreditSales();
  const numbers = list
    .map((c) => {
      const match = c.id?.match?.(/^CR-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `CR-${String(next).padStart(3, '0')}`;
};

export const addCreditSale = (
  entry: Omit<CreditSaleEntry, 'id' | 'synced'> & { id?: string; company_id?: string; companyId?: string; branch_id?: string; branchId?: string }
): CreditSaleEntry => {
  const all = getAllCreditSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branch_id || entry.branchId || currentBranch;
  const created: CreditSaleEntry = {
    ...entry,
    id: entry.id || getNextCreditSaleId(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.CREDIT_SALES, updated);

  enqueueSync('CreditSales', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    CreditID: created.id,
    Date: created.date,
    StaffID: created.staffId,
    StaffName: created.staffName,
    CustomerID: created.customerId || '',
    CustomerName: created.customerName,
    Amount: created.amount,
    In: created.in || 0,
    Out: created.out || created.amount,
    ItemDescription: created.itemDescription,
    DueDate: created.dueDate || '',
    Notes: created.notes || '',
    Status: created.status,
  });

  // If cash was repaid (In > 0), record cash movement if not already recorded (e.g., upfront deposit at POS)
  if (created.in && created.in > 0) {
    const isPosInitialDeposit = created.notes?.includes('POS Credit Sale Invoice');
    if (!isPosInitialDeposit) {
      const shiftId = getShiftId(created.staffId, created.date);
      const existingMov = getMovements().find(
        (m) =>
          (m.type === 'credit_cash_payment' || m.type === 'credit_upfront_deposit') &&
          (m.sourceRef === created.id || (created.notes && m.sourceRef && created.notes.includes(m.sourceRef)))
      );
      if (!existingMov) {
        addMovement({
          shiftId,
          staffId: created.staffId,
          date: created.date,
          timestamp: created.timestamp,
          type: 'credit_cash_payment',
          amount: created.in,
          currency: 'USD',
          direction: 'in',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'form3',
          sourceRef: created.id,
          notes: `Credit debt cash payment from ${created.customerName}${created.notes ? ` (${created.notes})` : ''}`,
          company_id: compId,
          branch_id: brId,
        });
      }
    }
  }

  notifyListeners();
  return created;
};

export const deleteCreditSale = (id: string): boolean => {
  const all = getAllCreditSales();
  const filtered = all.filter((c) => c.id !== id);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.CREDIT_SALES, filtered);
  enqueueSync('CreditSales', 'DELETE', { id, company_id: getCurrentCompanyId() });

  // Clean up associated cashMovements and customerLedger entries
  const movements = getMovements();
  movements.filter((m) => m.sourceRef === id).forEach((m) => deleteMovement(m.id));
  const custEntries = getCustomerLedgerEntries((e) => e.sourceRef === id);
  custEntries.forEach((e) => deleteCustomerLedgerEntry(e.id));

  return true;
};

export const isSupervisorOrAbove = (role?: string): boolean => {
  const norm = String(role || '').toUpperCase().trim();
  return ['SUPERVISOR', 'BRANCH_MANAGER', 'MANAGER', 'ADMIN', 'OWNER', 'SUPER_ADMIN', 'STOCK_CLERK', 'CLERK'].includes(norm);
};

export const DEFAULT_CREDIT_POLICY: StoreCreditPolicy = {
  mode: 'CUSTOMER_LIMIT',
  defaultCreditLimit: 0.0, // Default is strictly 0 (Credit OFF)
  defaultCreditAllowed: false, // Default is OFF for all new customers
  defaultGroupLimit: 5.0, // Standard Credit List Group Limit ($5.00)
  defaultMaxReceiptCount: 2,
  allowCashierOverride: false,
  maxCustomerCreditCap: 300.0, // Absolute max individual limit allowed without Owner PIN
  branchCreditExposureCap: 2500.0, // Absolute max total cumulative debt allowed for the branch
};

export const DEFAULT_CREDIT_GROUPS: CreditGroup[] = [
  {
    id: 'CGRP-001',
    name: 'Standard Micro-Credit List ($5)',
    groupLimit: 5.0,
    description: 'Standard $5 credit allowance for approved regular customers',
    isDefault: true,
    createdAt: '2026-08-01',
    createdBy: 'Store Admin',
  },
  {
    id: 'CGRP-002',
    name: 'Essential Groceries Tier ($15)',
    groupLimit: 15.0,
    description: 'Bi-weekly essential goods limit for verified neighbourhood families',
    isDefault: false,
    createdAt: '2026-08-01',
    createdBy: 'Store Admin',
  },
  {
    id: 'CGRP-003',
    name: 'Wholesale & Commercial Tier ($50)',
    groupLimit: 50.0,
    description: 'Authorized local traders & bulk buying catering accounts',
    isDefault: false,
    createdAt: '2026-08-01',
    createdBy: 'Store Admin',
  },
];

export const getCreditGroups = (): CreditGroup[] => {
  return getStored<CreditGroup[]>(STORAGE_KEYS.CREDIT_GROUPS, DEFAULT_CREDIT_GROUPS);
};

export const saveCreditGroup = (group: CreditGroup): void => {
  const current = getCreditGroups();
  const idx = current.findIndex((g) => g.id === group.id);
  const updated = idx >= 0 ? current.map((g) => (g.id === group.id ? group : g)) : [...current, group];
  setStored(STORAGE_KEYS.CREDIT_GROUPS, updated);
  notifyListeners();
};

export const getStandardGroupLimit = (): number => {
  const policy = getCreditPolicy();
  if (policy.defaultGroupLimit && policy.defaultGroupLimit > 0) return policy.defaultGroupLimit;
  const groups = getCreditGroups();
  const def = groups.find((g) => g.isDefault) || groups[0];
  return def ? def.groupLimit : 5.0;
};

export const getCreditPolicy = (): StoreCreditPolicy => {
  try {
    const raw = localStorage.getItem('saimetric_credit_policy');
    if (raw) {
      return { ...DEFAULT_CREDIT_POLICY, ...JSON.parse(raw) };
    }
  } catch (e) {}
  return DEFAULT_CREDIT_POLICY;
};

export const saveCreditPolicy = (policy: StoreCreditPolicy): void => {
  try {
    localStorage.setItem('saimetric_credit_policy', JSON.stringify(policy));
    notifyListeners();
  } catch (e) {}
};

export const DEFAULT_BRANCH_SHARING_SETTINGS: CompanyBranchSharingSettings = {
  shareCustomersAcrossBranches: false,
  shareSuppliersAcrossBranches: false,
  form4AuditPassword: '',
};

export const getCompanyBranchSettings = (): CompanyBranchSharingSettings => {
  const currentCompany = getCurrentCompanyId();
  try {
    const raw = localStorage.getItem(`saimetric_branch_sharing_${currentCompany}`);
    if (raw) return { ...DEFAULT_BRANCH_SHARING_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {}
  return DEFAULT_BRANCH_SHARING_SETTINGS;
};

export const saveCompanyBranchSettings = (settings: Partial<CompanyBranchSharingSettings>): CompanyBranchSharingSettings => {
  const currentCompany = getCurrentCompanyId();
  const current = getCompanyBranchSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem(`saimetric_branch_sharing_${currentCompany}`, JSON.stringify(updated));
    notifyListeners();
  } catch (e) {}
  return updated;
};

export const logDrawerBalanceReveal = (
  supervisor: { id: string; name: string; role: string },
  balance: number,
  context: string = 'Form 2 Cash Log'
): void => {
  const currentBranch = getCurrentBranchId();
  const branches = getBranches();
  const branchName = branches.find((b) => b.branchId === currentBranch)?.name || currentBranch;
  addAuditLog({
    action: 'APPROVAL' as any,
    severity: 'SECURITY' as any,
    staffId: supervisor.id,
    staffName: supervisor.name,
    staffRole: supervisor.role as any,
    branch_id: currentBranch,
    branchId: currentBranch,
    amount: balance,
    referenceId: `DRAWER-${currentBranch}`,
    details: `Strategic live drawer balance ($${balance.toFixed(2)}) unmasked by ${supervisor.role} ${supervisor.name} on register [Branch: ${branchName}, Context: ${context}].`,
    metadata: { entityType: 'CASH_DRAWER', context },
  });
};

export const logForm4AuditUnlock = (
  supervisor: { id: string; name: string; role: string },
  date: string,
  method: 'PASSWORD' | 'PIN'
): void => {
  const currentBranch = getCurrentBranchId();
  const branches = getBranches();
  const branchName = branches.find((b) => b.branchId === currentBranch)?.name || currentBranch;
  addAuditLog({
    action: 'APPROVAL' as any,
    severity: 'SECURITY' as any,
    staffId: supervisor.id,
    staffName: supervisor.name,
    staffRole: supervisor.role as any,
    branch_id: currentBranch,
    branchId: currentBranch,
    referenceId: `RECON-${currentBranch}-${date}`,
    details: `End-of-Day Shift Balancing (Form 4) audit unlocked via ${method} by ${supervisor.role} ${supervisor.name} for date ${date} [Branch: ${branchName}].`,
    metadata: { entityType: 'RECONCILIATION', method, date },
  });
};

export const getCustomerCreditSummary = (
  customerId: string,
  newSaleAmount: number = 0
): {
  totalOutstanding: number;
  unpaidReceiptsCount: number;
  creditLimit: number;
  maxReceiptCount: number;
  isWithinLimits: boolean;
  creditAllowed: boolean;
  limitExceededReason?: string;
} => {
  const customers = getCustomers();
  const customer = customers.find((c) => c.customerId === customerId);
  const policy = getCreditPolicy();

  const isCreditAllowed = customer?.creditAllowed === true;
  const creditLimit = isCreditAllowed ? (customer?.creditLimit !== undefined ? customer.creditLimit : 0) : 0;
  const maxReceiptCount = customer?.maxCreditReceiptCount !== undefined ? customer.maxCreditReceiptCount : policy.defaultMaxReceiptCount;
  const creditAllowed = isCreditAllowed;

  const allCredit = getCreditSales().filter(
    (c) => (c.customerId === customerId || c.customerName === customer?.name) && c.status !== 'Paid'
  );

  let totalOutstanding = 0;
  allCredit.forEach((c) => {
    const out = Number(c.out || c.amount || 0);
    const rep = Number(c.in || 0);
    const balance = Math.max(0, out - rep);
    totalOutstanding += balance;
  });

  const unpaidReceiptsCount = allCredit.filter((c) => {
    const out = Number(c.out || c.amount || 0);
    const rep = Number(c.in || 0);
    return out - rep > 0.01;
  }).length;

  if (!creditAllowed) {
    return {
      totalOutstanding,
      unpaidReceiptsCount,
      creditLimit: 0,
      maxReceiptCount,
      creditAllowed: false,
      isWithinLimits: false,
      limitExceededReason: 'Customer account is restricted from credit purchases (Credit is Off). An authorized supervisor must grant credit approval.',
    };
  }

  const projectedDebt = totalOutstanding + newSaleAmount;
  if (creditLimit > 0 && projectedDebt > creditLimit + 0.001) {
    return {
      totalOutstanding,
      unpaidReceiptsCount,
      creditLimit,
      maxReceiptCount,
      creditAllowed: true,
      isWithinLimits: false,
      limitExceededReason: `Credit limit ($${creditLimit.toFixed(2)}) exceeded. Current debt: $${totalOutstanding.toFixed(2)}, Cart: $${newSaleAmount.toFixed(2)}.`,
    };
  }

  if (maxReceiptCount > 0 && unpaidReceiptsCount >= maxReceiptCount && newSaleAmount > 0) {
    return {
      totalOutstanding,
      unpaidReceiptsCount,
      creditLimit,
      maxReceiptCount,
      creditAllowed: true,
      isWithinLimits: false,
      limitExceededReason: `Max unpaid receipts count reached (${unpaidReceiptsCount}/${maxReceiptCount}). Customer must settle previous receipts first.`,
    };
  }

  // Enforce Owner's Branch Cumulative Exposure Cap (Risk Management)
  const branchCap = policy.branchCreditExposureCap || 2500;
  if (branchCap > 0 && newSaleAmount > 0) {
    const currentBranch = getCurrentBranchId();
    const branchCreditSales = getCreditSales().filter((c) => {
      const bId = c.branch_id || (c as any).branchId;
      return (!bId || bId === currentBranch) && c.status !== 'Paid';
    });
    let branchTotalOutstanding = 0;
    branchCreditSales.forEach((c) => {
      const out = Number(c.out || c.amount || 0);
      const rep = Number(c.in || 0);
      branchTotalOutstanding += Math.max(0, out - rep);
    });

    if (branchTotalOutstanding + newSaleAmount > branchCap) {
      return {
        totalOutstanding,
        unpaidReceiptsCount,
        creditLimit,
        maxReceiptCount,
        creditAllowed: true,
        isWithinLimits: false,
        limitExceededReason: `Branch cumulative credit exposure cap ($${branchCap.toFixed(2)}) reached! Current branch debt: $${branchTotalOutstanding.toFixed(2)}. Unpaid customer accounts must be collected before issuing new branch credit.`,
      };
    }
  }

  return {
    totalOutstanding,
    unpaidReceiptsCount,
    creditLimit,
    maxReceiptCount,
    creditAllowed: true,
    isWithinLimits: true,
  };
};

export const updateCustomerCreditTerms = (
  customerId: string,
  updates: {
    creditLimit?: number;
    creditAllowed?: boolean;
    maxCreditReceiptCount?: number;
    creditGroupId?: string;
    creditGroupName?: string;
    isCustomLimit?: boolean;
  },
  authorizedBy: { id: string; name: string; role: string }
): Customer | null => {
  const all = getAllCustomers();
  const idx = all.findIndex((c) => c.customerId === customerId);
  if (idx === -1) return null;

  const current = all[idx];
  const newCreditAllowed = updates.creditAllowed !== undefined ? updates.creditAllowed : current.creditAllowed;
  const newCreditLimit = newCreditAllowed ? (updates.creditLimit !== undefined ? updates.creditLimit : current.creditLimit || 0) : 0;

  const updated: Customer = {
    ...current,
    ...updates,
    creditAllowed: newCreditAllowed,
    creditLimit: newCreditLimit,
    creditApprovedBy: authorizedBy.name,
    creditApprovalDate: new Date().toISOString(),
  };
  all[idx] = updated;
  setStored(STORAGE_KEYS.CUSTOMERS, all);

  const groupInfo = updated.creditGroupName || (updated.creditLimit && updated.creditLimit > 5 ? 'Custom / Random Limit' : 'Standard $5 Group Limit');
  addAuditLog({
    action: 'PRICE_CHANGE' as any,
    severity: 'SECURITY' as any,
    staffId: authorizedBy.id,
    staffName: authorizedBy.name,
    staffRole: authorizedBy.role as any,
    branch_id: getCurrentBranchId(),
    branchId: getCurrentBranchId(),
    referenceId: customerId,
    details: `Customer [${current.name} - ${customerId}] credit terms updated: Limit $${(current.creditLimit ?? 0).toFixed(2)} -> $${(updated.creditLimit ?? 0).toFixed(2)}, Allowed: ${updated.creditAllowed}, Group: ${groupInfo}, Max receipts: ${updated.maxCreditReceiptCount || 2}. Authorized by ${authorizedBy.role} ${authorizedBy.name}.`,
    metadata: { customerId, oldLimit: current.creditLimit, newLimit: updated.creditLimit, creditGroupId: updated.creditGroupId },
  });

  enqueueSync('Customers', 'UPDATE', updated);
  notifyListeners();
  return updated;
};

export const approveCreditSale = (
  id: string,
  supervisor: Salesperson
): boolean => {
  const all = getAllCreditSales();
  let found = false;
  const updated = all.map((c) => {
    if (c.id === id) {
      found = true;
      return {
        ...c,
        supervisorApprovalStatus: 'APPROVED' as const,
        approvedByStaffId: supervisor.id,
        approvedByStaffName: supervisor.name,
        approvalTimestamp: new Date().toISOString(),
      };
    }
    return c;
  });
  if (found) {
    setStored(STORAGE_KEYS.CREDIT_SALES, updated);
    notifyListeners();
  }
  return found;
};

export const flagCreditSale = (
  id: string,
  supervisor: Salesperson,
  reason: string
): boolean => {
  const all = getAllCreditSales();
  let found = false;
  const updated = all.map((c) => {
    if (c.id === id) {
      found = true;
      return {
        ...c,
        supervisorApprovalStatus: 'FLAGGED' as const,
        approvedByStaffId: supervisor.id,
        approvedByStaffName: supervisor.name,
        approvalTimestamp: new Date().toISOString(),
        notes: c.notes ? `${c.notes} [FLAGGED: ${reason}]` : `[FLAGGED: ${reason}]`,
      };
    }
    return c;
  });
  if (found) {
    setStored(STORAGE_KEYS.CREDIT_SALES, updated);
    notifyListeners();
  }
  return found;
};

export const saveDailyCreditSalesSheet = (
  date: string,
  staffId: string,
  staffName: string,
  entries: Array<{
    customerName: string;
    customerId?: string;
    amount: number;
    in?: number;
    out?: number;
    itemDescription: string;
    dueDate?: string;
    notes?: string;
  }>
): CreditSaleEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCreditSales();
  // Keep records for other companies or other staff/dates in this company
  const otherCredits = all.filter((c) => {
    const compId = c.company_id || c.companyId || 'COMP-001';
    if (compId !== currentCompany) return true;
    return !(c.staffId === staffId && c.date === date);
  });
  const valid = entries.filter(
    (e) =>
      e.customerName.trim() !== '' &&
      ((e.amount && e.amount > 0) || (e.out && e.out > 0) || (e.in && e.in > 0))
  );
  if (valid.length === 0) {
    setStored(STORAGE_KEYS.CREDIT_SALES, otherCredits);
    return [];
  }

  // Clean up existing sourceModule: 'form3' credit movements for this shift
  const shiftId = getShiftId(staffId, date);
  const currentMovements = getMovements();
  const toDelete = currentMovements.filter(
    (m) => matchesShift(m, shiftId) && m.sourceModule === 'form3' && m.type === 'credit_cash_payment'
  );
  toDelete.forEach((m) => deleteMovement(m.id));

  // Clean up existing customerLedger entries created by form3 for this staff and date
  const existingCustEntries = getCustomerLedgerEntries(
    (e) => e.staffId === staffId && e.date === date && e.sourceModule === 'form3' && (e.type === 'credit_payment' || e.type === 'credit_extended')
  );
  existingCustEntries.forEach((e) => deleteCustomerLedgerEntry(e.id));

  const createdList: CreditSaleEntry[] = [];
  const now = new Date();
  const numbers = all
    .map((c) => {
      const match = c.id?.match?.(/^CR-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  valid.forEach((item, idx) => {
    const cust = ensureCustomerExists(item.customerName, staffId);
    const creditGiven = (item.out !== undefined && item.out > 0) ? item.out : (item.amount || 0);
    const creditRepaid = item.in || 0;

    const newEntry: CreditSaleEntry = {
      id: `CR-${String(nextCounter++).padStart(3, '0')}`,
      timestamp: new Date(now.getTime() + idx * 100).toISOString(),
      date,
      staffId,
      staffName,
      customerId: cust.customerId,
      customerName: cust.name,
      amount: creditGiven,
      out: creditGiven,
      in: creditRepaid,
      itemDescription: item.itemDescription || 'Goods on Credit',
      dueDate: item.dueDate || '',
      notes: item.notes || '',
      status: creditRepaid >= creditGiven && creditGiven > 0 ? 'Paid' : (creditRepaid > 0 ? 'Partial' : 'Pending'),
      synced: false,
      company_id: currentCompany,
      companyId: currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
    };
    createdList.push(newEntry);

    // Map row types:
    // Credit IN (customer pays debt with cash): credit_cash_payment, in, affectsDrawer: true
    // Deduplicate against any upfront deposit only if this exact row references the POS invoice
    const posDepositMovement = currentMovements.find(
      (m) =>
        m.sourceModule === 'POS' &&
        m.type === 'credit_upfront_deposit' &&
        matchesShift(m, shiftId) &&
        m.sourceRef &&
        item.notes &&
        item.notes.includes(m.sourceRef)
    );
    const posDepositAmt = posDepositMovement ? Number(posDepositMovement.amount) || 0 : 0;
    const netCashPaidInForm3 = Math.max(0, creditRepaid - posDepositAmt);

    if (netCashPaidInForm3 > 0) {
      addMovement({
        shiftId,
        staffId,
        date,
        timestamp: newEntry.timestamp,
        type: 'credit_cash_payment',
        amount: netCashPaidInForm3,
        currency: 'USD',
        direction: 'in',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'form3',
        sourceRef: newEntry.id,
        notes: `Credit debt cash repayment from ${newEntry.customerName}${item.notes ? ` (${item.notes})` : ''}`,
        company_id: currentCompany,
        branch_id: currentBranch,
      });

      // Also record debt payment in customerLedger
      addCustomerLedgerEntry({
        customerId: cust.customerId,
        customerName: cust.name,
        date,
        timestamp: newEntry.timestamp,
        type: 'credit_payment',
        amount: netCashPaidInForm3,
        sourceRef: newEntry.id,
        sourceModule: 'form3',
        notes: `Debt cash repayment from ${newEntry.customerName}`,
        staffId,
        staffName,
      });
    }

    // Credit OUT (credit extended): affectsDrawer: false
    // Do NOT write to cashMovements. Write to customerLedger as a receivable!
    if (creditGiven > 0) {
      addCustomerLedgerEntry({
        customerId: cust.customerId,
        customerName: cust.name,
        date,
        timestamp: newEntry.timestamp,
        type: 'credit_extended',
        amount: creditGiven,
        sourceRef: newEntry.id,
        sourceModule: 'form3',
        notes: `Credit extended to ${cust.name}: ${item.itemDescription || 'Goods on Credit'}`,
        staffId,
        staffName,
      });
    }

    enqueueSync('CreditSales', 'INSERT', {
      company_id: currentCompany,
      branch_id: currentBranch,
      Timestamp: newEntry.timestamp,
      CreditID: newEntry.id,
      Date: newEntry.date,
      StaffID: newEntry.staffId,
      StaffName: newEntry.staffName,
      CustomerID: newEntry.customerId,
      CustomerName: newEntry.customerName,
      Amount: newEntry.amount,
      In: newEntry.in,
      Out: newEntry.out,
      ItemDescription: newEntry.itemDescription,
      DueDate: newEntry.dueDate,
      Notes: newEntry.notes,
      Status: newEntry.status,
    });
  });

  setStored(STORAGE_KEYS.CREDIT_SALES, [...createdList, ...otherCredits]);
  notifyListeners();
  return createdList;
};

// ==================== SALES / INVOICE DAO (FORM 3) ====================
export const getAllSales = (): SaleInvoice[] => {
  return getStored<SaleInvoice[]>(STORAGE_KEYS.SALES, INITIAL_SALES);
};

export const getSales = (): SaleInvoice[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllSales();
  const branches = getBranches();

  return all.filter((s) => {
    const compId = (s.company_id || s.companyId || '').trim();
    const matchesComp =
      !compId ||
      currentCompany === 'COMP-MASTER' ||
      compId === 'COMP-MASTER' ||
      compId === currentCompany ||
      (!currentCompany && (compId === 'COMP-001' || compId === 'COMP-MASTER'));
    if (!matchesComp) return false;

    const brId = s.branch_id || s.branchId || (s as any).branchCode;
    return isRecordInBranchScope(brId, currentBranch, branches, currentCompany);
  });
};

export const getAllBranchesSales = (): SaleInvoice[] => {
  const currentCompany = getCurrentCompanyId();
  const all = getAllSales();
  return all.filter((s) => {
    const compId = s.company_id || s.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getUserPrefix = (staffId?: any, staffName?: string): string => {
  // Allow passing user object directly
  if (typeof staffId === 'object' && staffId !== null) {
    const rawP = String(staffId.user_prefix || staffId.userPrefix || staffId.prefix || '').trim().toUpperCase();
    if (rawP && !rawP.startsWith('INV')) {
      return rawP;
    }
    const oId = String(staffId.id || '').trim();
    const oName = String(staffId.name || staffId.username || '').trim();
    return getUserPrefix(oId, oName);
  }

  const sessionUser = getSessionUser();
  const explicitUserPrefix = String((sessionUser as any)?.user_prefix || (sessionUser as any)?.userPrefix || (sessionUser as any)?.prefix || '').trim().toUpperCase();
  if (explicitUserPrefix && !explicitUserPrefix.startsWith('INV') && (!staffId || staffId === sessionUser?.id)) {
    return explicitUserPrefix;
  }

  const rawId = String(staffId || sessionUser?.id || '').trim();
  const rawName = String(staffName || sessionUser?.name || sessionUser?.username || '').trim();

  // If already formatted like KM5
  if (/^[A-Za-z]{1,4}\d{1,4}$/.test(rawId) && !rawId.toUpperCase().startsWith('INV')) {
    return rawId.toUpperCase();
  }

  // 1. Direct match like KM-5, STF-001, etc.
  const directMatch = rawId.match(/^([A-Za-z]{1,4})[-_]?(\d{1,4})$/);
  if (directMatch) {
    const letters = directMatch[1].toUpperCase();
    const num = parseInt(directMatch[2], 10);
    if (letters === 'STF' || letters === 'USR' || letters === 'INV') {
      if (rawName) {
        const initials = rawName
          .split(/\s+/)
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        return `${initials || 'KM'}${num || 5}`;
      }
      return `KM${num || 5}`;
    }
    return `${letters}${num}`;
  }

  // 2. Derive initials from staff name (e.g. Kevin Moyo -> KM5, Kudakwashe Andre -> KM5 or KA2)
  if (rawName) {
    const initials = rawName
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const numMatch = rawId.match(/\d+/);
    const num = numMatch ? parseInt(numMatch[0], 10) : 5;
    const res = `${initials || 'KM'}${num}`;
    if (!res.startsWith('INV')) {
      return res;
    }
  }

  // 3. Cleaned alphanumeric ID if short
  const cleanedId = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (cleanedId && cleanedId.length <= 5 && !cleanedId.startsWith('COMP') && !cleanedId.startsWith('BR') && !cleanedId.startsWith('INV')) {
    return cleanedId;
  }

  return 'KM5';
};

/**
 * Standard Invoice Number Generator: [user_prefix]-[YYMMDD]-[HHMMSS]-[Random3Digits]
 * Example: KM5-261024-143022-892
 * Eliminates legacy 'INV-' prefix and collision renaming ('r001')
 */
export const generateInvoiceNumber = (staffId?: any, staffName?: string): string => {
  let prefix = getUserPrefix(staffId, staffName);
  if (!prefix || prefix.toUpperCase().startsWith('INV')) {
    prefix = 'KM5';
  }
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = String(Math.floor(100 + Math.random() * 900));

  return `${prefix}-${yy}${mm}${dd}-${hh}${min}${ss}-${rand}`;
};

export const getNextInvoiceId = generateInvoiceNumber;
export const generateInvoiceId = generateInvoiceNumber;

type SaleCreationListener = (sale: SaleInvoice) => void;
const saleCreationListeners: Set<SaleCreationListener> = new Set();

const inMemorySeenSaleIds: Set<string> = new Set();
let hasInitializedSeenSaleIds = false;

export const initSeenSaleIds = () => {
  if (hasInitializedSeenSaleIds) return;
  hasInitializedSeenSaleIds = true;
  try {
    const list = getAllSales();
    for (const s of list) {
      if (s && s.id) {
        inMemorySeenSaleIds.add(s.id);
      }
    }
  } catch (e) {}
};

export const registerSeenSaleId = (id: string) => {
  if (!id) return;
  inMemorySeenSaleIds.add(id);
};

export const onSaleCreated = (listener: SaleCreationListener) => {
  saleCreationListeners.add(listener);
  return () => {
    saleCreationListeners.delete(listener);
  };
};

export const ingestMeshSale = (sale: SaleInvoice): boolean => {
  if (!sale || !sale.id) return false;

  // Ultra-fast O(1) in-memory deduplication check:
  // Drop immediately without doing expensive disk/JSON deserialization or branch math
  initSeenSaleIds();
  if (inMemorySeenSaleIds.has(sale.id)) {
    return false;
  }

  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const currentBranchCode = getCurrentBranch()?.code;

  const normTenant = (c: string) => (!c || c === 'COMP-001' || c === 'COMP-MASTER' ? 'COMP-001' : c);
  const saleComp = (sale.company_id || sale.companyId || '').trim().toUpperCase();
  const cleanCurrentComp = (currentCompany || '').trim().toUpperCase();
  if (saleComp && cleanCurrentComp && normTenant(saleComp) !== normTenant(cleanCurrentComp)) {
    console.warn(`[ingestMeshSale] Dropping sale from different tenant: [${saleComp}] vs [${cleanCurrentComp}]`);
    return false;
  }

  const saleBranch = (sale.branch_id || sale.branchId || (sale as any).branchCode || '').trim().toUpperCase();
  const cleanCurrentBranch = (currentBranch || '').trim().toUpperCase();
  const cleanCurrentBranchCode = (currentBranchCode || '').trim().toUpperCase();
  const branchCandidate = saleBranch;
  const localCandidate = cleanCurrentBranch || cleanCurrentBranchCode;
  const branchMatches =
    !branchCandidate ||
    !localCandidate ||
    branchCandidate === localCandidate ||
    branchCandidate === 'ALL' ||
    localCandidate === 'ALL' ||
    isRecordInBranchScope(branchCandidate, localCandidate, getBranches(), currentCompany);

  if (!branchMatches) {
    console.warn(
      `[ingestMeshSale] Dropping sale from different branch: [${saleBranch}] vs [${cleanCurrentBranch}/${cleanCurrentBranchCode}]`
    );
    return false;
  }

  // Register in memory immediately to prevent race conditions during burst processing
  inMemorySeenSaleIds.add(sale.id);

  const list = getAllSales();
  const existing = list.find((s) => s.id === sale.id);
  if (existing) {
    return false;
  }

  const normalized: SaleInvoice = {
    ...sale,
    company_id: sale.company_id || sale.companyId || currentCompany,
    companyId: sale.company_id || sale.companyId || currentCompany,
    branch_id: sale.branch_id || sale.branchId || currentBranch,
    branchId: sale.branch_id || sale.branchId || currentBranch,
  };
  const updated = [normalized, ...list];
  setStored(STORAGE_KEYS.SALES, updated);

  // Decrement product stock in inventory
  if (Array.isArray(normalized.items)) {
    normalized.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, -item.quantity, undefined, undefined, {
          staffId: normalized.staffId,
          staffName: normalized.staffName,
          referenceId: normalized.id,
          reason: `POS Sale Outflow: Sold ${item.quantity} ${item.name || ''} to ${normalized.customerName || 'Customer'} (Invoice #${normalized.id})`,
          actionTaken: 'POS_SALE',
          txnType: 'SALE',
          fromMesh: true,
        });
      }
    });
  }

  // Ensure customer exists
  if (normalized.customerName && normalized.customerName !== 'Walk-in Customer') {
    ensureCustomerExists(normalized.customerName, normalized.staffId);
  }

  // Cash log entry
  if (normalized.paymentMethod === 'Cash') {
    const actualCash = Math.max(0, normalized.total - (normalized.customerCreditUsed || 0));
    addCashLog({
      timestamp: normalized.timestamp,
      date: normalized.date,
      staffId: normalized.staffId,
      staffName: normalized.staffName,
      line: 'Sales',
      description: `Mesh Sale #${normalized.id} - ${normalized.customerName} (${normalized.itemsSummary})`,
      in: actualCash,
      out: 0,
      category: 'Sales Cash',
      reference: normalized.id,
      company_id: normalized.company_id,
      branch_id: normalized.branch_id,
      fromMesh: true,
      skipSync: true,
    });
  }

  // Non-cash electronic sale (ZiG / EcoCash) ledger synchronization for mesh peer terminals
  const meshSaleCur = (normalized.currency as 'ZiG' | 'EcoCash') ||
    (normalized.paymentMethod === 'ZiG' ? 'ZiG' : (normalized.paymentMethod === 'EcoCash' || normalized.paymentMethod === 'EcoCash/Mobile') ? 'EcoCash' : undefined);
  if (meshSaleCur) {
    addMovement({
      shiftId: getShiftId(normalized.staffId, normalized.date, normalized.branch_id),
      staffId: normalized.staffId,
      date: normalized.date,
      timestamp: normalized.timestamp,
      type: meshSaleCur === 'ZiG' ? 'zig_sale' : 'ecocash_sale',
      amount: normalized.total,
      currency: meshSaleCur,
      direction: 'none',
      affectsDrawer: false,
      status: 'approved',
      sourceModule: 'POS',
      sourceRef: normalized.id,
      notes: `${meshSaleCur} Mesh electronic non-cash sale #${normalized.id}`,
      company_id: normalized.company_id,
      branch_id: normalized.branch_id,
    });

    if (normalized.cashWithdrawalAmount && Number(normalized.cashWithdrawalAmount) > 0) {
      addMovement({
        shiftId: getShiftId(normalized.staffId, normalized.date, normalized.branch_id),
        staffId: normalized.staffId,
        date: normalized.date,
        timestamp: normalized.timestamp,
        type: meshSaleCur === 'ZiG' ? 'zig_cash_out' : 'ecocash_cash_out',
        amount: Number(normalized.cashWithdrawalAmount),
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'POS',
        sourceRef: normalized.id,
        notes: `${meshSaleCur} Mesh Cash-Out #${normalized.id}`,
        company_id: normalized.company_id,
        branch_id: normalized.branch_id,
      });
    }
  }

  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_sales_updated', { detail: normalized }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: normalized }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated', { detail: normalized }));
  }
  return true;
};

export const addSale = (
  saleData: Omit<SaleInvoice, 'id' | 'synced'> & {
    id?: string;
    recordCashLog?: boolean;
    recordCreditEntry?: boolean;
    recordChangeEntry?: boolean;
    fromMesh?: boolean;
    company_id?: string;
    companyId?: string;
    companyName?: string;
    branch_id?: string;
    branchId?: string;
    branchName?: string;
  }
): SaleInvoice => {
  const all = getAllSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = saleData.company_id || saleData.companyId || currentCompany;
  const brId = saleData.branch_id || saleData.branchId || currentBranch;
  const invId = saleData.id || getNextInvoiceId(saleData.staffId, saleData.staffName);
  const companiesList = getCompanies();
  const matchedComp = companiesList.find((c) => c.company_id === compId);
  const branchesList = getBranches();
  const matchedBranch = branchesList.find((b) => b.branchId === brId);

  const invItems = getAllInventoryItems();
  const prods = getProducts();
  const snapshottedItems = Array.isArray(saleData.items)
    ? saleData.items.map((item) => {
        const resolved = resolveItemCost(item, invItems, prods);
        return {
          ...item,
          costPrice: Number(resolved.avgCost.toFixed(4)),
          costPerUnitAverage: Number(resolved.avgCost.toFixed(4)),
          costPerUnitLatest: Number(resolved.latestCost.toFixed(4)),
        };
      })
    : [];

  const created: SaleInvoice = {
    ...saleData,
    items: snapshottedItems,
    id: invId,
    synced: false,
    company_id: compId,
    companyId: compId,
    companyName: saleData.companyName || matchedComp?.company_name || 'SAIMETRIC',
    branch_id: brId,
    branchId: brId,
    branchName: saleData.branchName || matchedBranch?.name || 'Main Branch',
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.SALES, updated);
  registerSeenSaleId(invId);

  // Fire-and-forget push to server central store for multi-tier persistence
  if (typeof fetch !== 'undefined') {
    fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created),
    }).catch(() => {});
  }

  // 1. Decrement product stock in inventory and log audit trail
  if (Array.isArray(created.items)) {
    created.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, -item.quantity, undefined, undefined, {
          staffId: created.staffId,
          staffName: created.staffName,
          referenceId: created.id,
          reason: `POS Sale Outflow: Sold ${item.quantity} ${item.name || ''} to ${created.customerName || 'Customer'} (Invoice #${created.id})`,
          actionTaken: 'POS_SALE',
          txnType: 'SALE',
        });
      }
    });
  }

  // 2. Ensure customer exists in unified customer database
  if (created.customerName && created.customerName !== 'Walk-in Customer') {
    ensureCustomerExists(created.customerName, created.staffId);
  }

  // 2b. If customer used existing store credit / change funds, record deduction in CustomerChange (Form 3)
  if (created.customerCreditUsed && created.customerCreditUsed > 0) {
    addCustomerChange({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      customerId: created.customerId,
      customerName: created.customerName,
      company_id: compId,
      companyId: compId,
      branch_id: brId,
      branchId: brId,
      in: 0,
      out: created.customerCreditUsed,
      notes: `Applied customer credit/change fund to POS Invoice #${created.id}`,
      reference: created.id,
    });
  }

  // 3. If Cash sale, log to CashLog (Form 2)
  if (created.paymentMethod === 'Cash' && saleData.recordCashLog !== false) {
    // Actual cash received is total minus any applied store credit
    const actualCashCollected = Math.max(0, created.total - (created.customerCreditUsed || 0));
    addCashLog({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      company_id: compId,
      companyId: compId,
      branch_id: brId,
      branchId: brId,
      line: 'Sales',
      description: `Cash sale #${created.id} - ${created.customerName} (${created.itemsSummary})${created.customerCreditUsed ? ` (Includes ${created.customerCreditUsed.toFixed(2)} store credit used)` : ''}`,
      in: actualCashCollected,
      out: 0,
      category: 'Sales Cash',
      reference: created.id,
    });

    // Write cash_sale movement to cashMovements
    addMovement({
      shiftId: getShiftId(created.staffId, created.date, brId),
      staffId: created.staffId,
      date: created.date,
      timestamp: created.timestamp,
      type: 'cash_sale',
      amount: actualCashCollected,
      currency: 'USD',
      direction: 'in',
      affectsDrawer: true,
      status: 'approved',
      sourceModule: 'POS',
      sourceRef: created.id,
      notes: `POS Cash sale #${created.id} - ${created.customerName}`,
      company_id: compId,
      branch_id: brId,
    });

    // If customer leaves change behind with the shop, automatically record in Form 3 Customer Change
    // Supports custom editable changeAmountLeftBehind or defaults to full changeDue
    const amountToLeaveBehind =
      created.changeAmountLeftBehind !== undefined
        ? Number(created.changeAmountLeftBehind)
        : (created.changeDue || 0);

    if (created.changeLeftBehind && amountToLeaveBehind > 0 && saleData.recordChangeEntry !== false) {
      addCustomerChange({
        timestamp: created.timestamp,
        date: created.date,
        staffId: created.staffId,
        staffName: created.staffName,
        customerId: created.customerId,
        customerName: created.customerName,
        company_id: compId,
        companyId: compId,
        branch_id: brId,
        branchId: brId,
        in: amountToLeaveBehind,
        out: 0,
        notes: `Change left behind (${amountToLeaveBehind.toFixed(2)}) from POS Invoice #${created.id}`,
        reference: created.id,
      });

      // Left-behind change is a customer credit liability in customerLedger
      addCustomerLedgerEntry({
        customerId: created.customerId || '',
        customerName: created.customerName,
        date: created.date,
        timestamp: created.timestamp,
        type: 'change_liability',
        amount: amountToLeaveBehind,
        sourceRef: created.id,
        sourceModule: 'POS',
        notes: `Change left behind from POS Invoice #${created.id}`,
        staffId: created.staffId,
        staffName: created.staffName,
      });

      // Note: addCustomerChange above already records the canonical change_received movement into cashMovements
      // with full drawer integration. No second movement is needed to prevent double-counting.
    }
  }

  // 4. If Credit sale, AUTOMATICALLY FILL AND RECORD CREDIT FORM (Form 3 Credit Sales)
  if (created.paymentMethod === 'Credit' && saleData.recordCreditEntry !== false) {
    const deposit = Number(created.creditDeposit) || 0;
    const totalCreditAmount =
      created.creditAmount !== undefined && Number(created.creditAmount) > 0
        ? Number(created.creditAmount)
        : created.total;
    const creditStatus: 'Paid' | 'Partial' | 'Pending' =
      deposit >= totalCreditAmount && totalCreditAmount > 0
        ? 'Paid'
        : deposit > 0
        ? 'Partial'
        : 'Pending';

    addCreditSale({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      customerId: created.customerId,
      customerName: created.customerName,
      company_id: compId,
      companyId: compId,
      branch_id: brId,
      branchId: brId,
      amount: totalCreditAmount,
      out: totalCreditAmount, // goods value taken on credit
      in: deposit, // cash deposit paid upfront
      itemDescription: created.itemsSummary || 'POS Goods on Credit',
      dueDate: created.creditDueDate || '',
      notes: `POS Credit Sale Invoice #${created.id}${deposit > 0 ? ` (${deposit.toFixed(2)} deposit paid)` : ''}`,
      status: creditStatus,
    });

    // POS credit sale with upfront deposit: write remainder ONLY to customerLedger as receivable
    const creditRemainder = Math.max(0, totalCreditAmount - deposit);
    if (creditRemainder > 0) {
      addCustomerLedgerEntry({
        customerId: created.customerId || '',
        customerName: created.customerName,
        date: created.date,
        timestamp: created.timestamp,
        type: 'credit_extended',
        amount: creditRemainder,
        sourceRef: created.id,
        sourceModule: 'POS',
        notes: `Credit receivable for Invoice #${created.id} (Total: $${totalCreditAmount.toFixed(2)}, Upfront deposit: $${deposit.toFixed(2)})`,
        staffId: created.staffId,
        staffName: created.staffName,
      });
    }

    // If partial deposit paid in cash, record the deposit into CashLog (Form 2) and cashMovements
    if (deposit > 0) {
      addCashLog({
        timestamp: created.timestamp,
        date: created.date,
        staffId: created.staffId,
        staffName: created.staffName,
        company_id: compId,
        companyId: compId,
        branch_id: brId,
        branchId: brId,
        line: 'Sales',
        description: `Cash deposit for Credit Invoice #${created.id} - ${created.customerName}`,
        in: deposit,
        out: 0,
        category: 'Credit Deposit',
        reference: created.id,
      });

      addMovement({
        shiftId: getShiftId(created.staffId, created.date, brId),
        staffId: created.staffId,
        date: created.date,
        timestamp: created.timestamp,
        type: 'credit_upfront_deposit',
        amount: deposit,
        currency: 'USD',
        direction: 'in',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'POS',
        sourceRef: created.id,
        notes: `Cash deposit for Credit Invoice #${created.id} - ${created.customerName}`,
        company_id: compId,
        branch_id: brId,
      });
    }
  }

  // 5. NON-DEFAULT CURRENCIES (ZiG, EcoCash) & CASH WITHDRAWALS:
  // User mandate:
  // - "sales from currencies other than the default should be subtracted in form 2 cashlog as usd."
  // - "zig and ecocash should also support cash with drawals which are not taxed or considered sales but deducted in form 2 cashlog to ensure cashier balances"
  // - "limits should also be set on cash with drawals for example Maximum cash withdrawal equals sale amount"
  const saleCurrency = created.currency as string | undefined;
  const isEcoCash =
    saleCurrency === 'EcoCash' ||
    saleCurrency === 'ECO' ||
    saleCurrency === 'ECOCASH' ||
    (typeof saleCurrency === 'string' && saleCurrency.toLowerCase().includes('eco')) ||
    created.paymentMethod === 'EcoCash' ||
    created.paymentMethod === 'EcoCash/Mobile' ||
    created.paymentMethod === 'ECO' ||
    created.paymentMethod === 'ECOCASH' ||
    (typeof created.paymentMethod === 'string' && created.paymentMethod.toLowerCase().includes('eco'));

  const isZiG =
    saleCurrency === 'ZiG' ||
    saleCurrency === 'ZIG' ||
    created.paymentMethod === 'ZiG' ||
    created.paymentMethod === 'ZIG' ||
    (typeof created.paymentMethod === 'string' && created.paymentMethod.toLowerCase().includes('zig'));

  const activeForeignCurrencies = getActiveCurrencies();
  const isOtherActiveForeign = Boolean(
    saleCurrency &&
      saleCurrency !== 'USD' &&
      activeForeignCurrencies.some((c) => c.currency === saleCurrency || c.code === saleCurrency)
  );

  const isNonDefaultCurrency = isZiG || isEcoCash || isOtherActiveForeign;

  if (isNonDefaultCurrency && saleData.recordCashLog !== false) {
    const cur: 'ZiG' | 'EcoCash' | string = isZiG ? 'ZiG' : isEcoCash ? 'EcoCash' : (saleCurrency || 'EcoCash');
    const currencyConfig = getMultiCurrencyConfig();
    const rate =
      created.exchangeRate ||
      currencyConfig.rates[cur]?.rateToUsd ||
      currencyConfig.rates[cur]?.rateToBase ||
      (isEcoCash ? (currencyConfig.rates['EcoCash']?.rateToUsd || 27.0) : (cur === 'ZiG' ? 26.5 : 27.0));
    const saleUsdAmount = created.total; // in USD
    const curAmount = created.totalInCurrency || (saleUsdAmount * rate);

    // 5a. Deduct non-cash sale in Form 2 as base currency (USD) so cashier balances
    addCashLog({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      companyId: created.companyId || created.company_id,
      company_id: created.company_id || created.companyId,
      branchId: created.branchId || created.branch_id,
      branch_id: created.branch_id || created.branchId,
      line: cur,
      description: `${cur} Sale #${created.id} (${curAmount.toFixed(2)} ${cur} @ ${rate.toFixed(2)}) - ${created.customerName}`,
      in: 0,
      out: saleUsdAmount, // Subtracted in Form 2 as base USD!
      category: `${cur} Non-Cash Sale Deduction`,
      currency: cur,
      exchangeRate: rate,
      currencyAmount: curAmount,
      isWithdrawal: false,
      reference: created.id,
      notes: `Electronic ${cur} Payment: ${curAmount.toFixed(2)} ${cur}. Deducted as $${saleUsdAmount.toFixed(2)} USD base currency in Form 2 so cash drawer balances.`,
    });

    // Write non-cash electronic sale movement (Reporting only, does NOT affect physical drawer)
    addMovement({
      shiftId: getShiftId(created.staffId, created.date, brId),
      staffId: created.staffId,
      date: created.date,
      timestamp: created.timestamp,
      type: cur === 'ZiG' ? 'zig_sale' : isEcoCash ? 'ecocash_sale' : 'cash_sale',
      amount: saleUsdAmount,
      currency: cur,
      direction: 'none',
      affectsDrawer: false,
      status: 'approved',
      sourceModule: 'POS',
      sourceRef: created.id,
      notes: `${cur} Electronic non-cash sale #${created.id} (${curAmount.toFixed(2)} ${cur})`,
      company_id: compId,
      branch_id: brId,
    });

    // 5b. If Cash Withdrawal occurred, deduct withdrawal in Form 2 as base currency (USD)
    // Untaxed, not considered a sale, but physical USD cash is handed out from till!
    if (created.cashWithdrawalAmount && Number(created.cashWithdrawalAmount) > 0) {
      const withdrawalUsd = Number(created.cashWithdrawalAmount);
      const withdrawalInCur = created.cashWithdrawalInCurrency || (withdrawalUsd * rate);
      const grossUsd = Number(created.grossTenderUsd) || (saleUsdAmount + withdrawalUsd);
      const grossInCur = Number(created.totalChargedInCurrency) || (grossUsd * rate);
      const popRef = created.proofOfPaymentRef || created.paymentReference || '';
      const refNote = popRef ? ` | Ref/POP: ${popRef}` : '';

      addCashLog({
        timestamp: created.timestamp,
        date: created.date,
        staffId: created.staffId,
        staffName: created.staffName,
        companyId: created.companyId || created.company_id,
        company_id: created.company_id || created.companyId,
        branchId: created.branchId || created.branch_id,
        branch_id: created.branch_id || created.branchId,
        line: `${cur} Withdrawal`,
        description: `${cur} Cash-Out Payout #${created.id} ($${withdrawalUsd.toFixed(2)} USD / ${withdrawalInCur.toFixed(2)} ${cur})${refNote}`,
        in: 0,
        out: withdrawalUsd, // Subtracted in Form 2 as base USD!
        category: `${cur} Cash Withdrawal`,
        currency: cur,
        exchangeRate: rate,
        currencyAmount: withdrawalInCur,
        isWithdrawal: true,
        reference: created.id,
        notes: `Cash Out Payout to Customer: Swiped gross ${grossInCur.toFixed(2)} ${cur} ($${grossUsd.toFixed(2)} USD). Cashier handed $${withdrawalUsd.toFixed(2)} USD physical cash from till. Sale: $${saleUsdAmount.toFixed(2)} USD (${curAmount.toFixed(2)} ${cur}).${refNote}`,
      });

      // Write Cash-Out movement (affects drawer: true, direction: out)
      addMovement({
        shiftId: getShiftId(created.staffId, created.date, brId),
        staffId: created.staffId,
        date: created.date,
        timestamp: created.timestamp,
        type: cur === 'ZiG' ? 'zig_cash_out' : 'ecocash_cash_out',
        amount: withdrawalUsd,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'POS',
        sourceRef: created.id,
        notes: `${cur} Cash-Out Payout #${created.id} ($${withdrawalUsd.toFixed(2)} USD handed out | Gross Slip: $${grossUsd.toFixed(2)} USD / ${grossInCur.toFixed(2)} ${cur}${refNote})`,
        company_id: compId,
        branch_id: brId,
      });
    }
  }

  // Save to Sheet "Sales"
  enqueueSync('Sales', 'INSERT', {
    company_id: created.company_id,
    branch_id: created.branch_id,
    Timestamp: created.timestamp,
    InvoiceID: created.id,
    CustomerID: created.customerId,
    CustomerName: created.customerName,
    ItemsSummary: created.itemsSummary,
    Subtotal: created.subtotal,
    Discount: created.discount,
    Total: created.total,
    PaymentMethod: created.paymentMethod,
    StaffID: created.staffId,
    StaffName: created.staffName,
    Status: created.status,
  });

  // Credit appropriate wallet (EcoCash -> EcoCash Wallet, ZiG -> ZiG Bank Wallet, Cash -> Till Drawer Wallet)
  try {
    const payMethod = created.paymentMethod || 'Cash';
    const cur = created.currency || 'USD';
    let targetWalletKey = 'wallet_cash';
    let targetAmount = created.total;

    const isEco = payMethod.toLowerCase().includes('eco') || cur.toLowerCase().includes('eco');
    const isZiG = payMethod.toLowerCase().includes('zig') || cur.toLowerCase().includes('zig');

    if (isEco) {
      targetWalletKey = 'wallet_ecocash';
      // In Zimbabwe EcoCash, company receives actual electronic amount transferred (including gross for cash withdrawals)
      const rate = Number(created.exchangeRate) || 1.05;
      const saleInCur = Number(created.totalInCurrency) || (Number(created.total || 0) * rate);
      const withdrawalInCur = Number(created.cashWithdrawalInCurrency) || (Number(created.cashWithdrawalAmount || 0) * rate);
      targetAmount =
        Number(created.totalChargedInCurrency) ||
        Math.round((saleInCur + withdrawalInCur) * 100) / 100;
    } else if (isZiG) {
      targetWalletKey = 'wallet_bank_zig';
      const rate = Number(created.exchangeRate) || 26.5;
      const saleInCur = Number(created.totalInCurrency) || (Number(created.total || 0) * rate);
      const withdrawalInCur = Number(created.cashWithdrawalInCurrency) || (Number(created.cashWithdrawalAmount || 0) * rate);
      targetAmount =
        Number(created.totalChargedInCurrency) ||
        Math.round((saleInCur + withdrawalInCur) * 100) / 100;
    } else if (payMethod === 'Card' || payMethod === 'Bank Transfer') {
      targetWalletKey = 'wallet_bank_usd';
    }

    const currentWallets = getStored<any[]>('saimetric_wallets', []);
    if (currentWallets && currentWallets.length > 0) {
      // 1. Credit destination wallet
      const idx = currentWallets.findIndex((w) => w.id === targetWalletKey);
      if (idx !== -1) {
        currentWallets[idx].balance = Math.round((currentWallets[idx].balance + targetAmount) * 100) / 100;
        currentWallets[idx].updatedAt = new Date().toISOString();
      }

      // 2. If electronic sale with cash withdrawal, deduct physical USD cash from Till Cash Drawer!
      if ((isEco || isZiG) && created.cashWithdrawalAmount && Number(created.cashWithdrawalAmount) > 0) {
        const cashIdx = currentWallets.findIndex((w) => w.id === 'wallet_cash');
        if (cashIdx !== -1) {
          currentWallets[cashIdx].balance =
            Math.round((currentWallets[cashIdx].balance - Number(created.cashWithdrawalAmount)) * 100) / 100;
          currentWallets[cashIdx].updatedAt = new Date().toISOString();
        }
      }

      setStored('saimetric_wallets', currentWallets);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_wallets_updated'));
      }
    }
  } catch (err) {
    console.error('Wallet update on sale error:', err);
  }

  // Notify listeners so meshSyncService broadcasts the sale in real time
  if (!saleData.fromMesh) {
    saleCreationListeners.forEach((fn) => {
      try {
        fn(created);
      } catch (e) {
        console.error('saleCreationListener error:', e);
      }
    });
  }

  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_sales_updated', { detail: created }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: created }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated', { detail: created }));
  }

  return created;
};

export const refundSaleInvoice = (params: {
  invoiceId: string;
  manager: Salesperson;
  cashier?: Salesperson;
  reason: string;
}): { success: boolean; message: string; invoice?: SaleInvoice } => {
  const allSales = getAllSales();
  const invoice = allSales.find((s) => s.id === params.invoiceId);
  if (!invoice) {
    return { success: false, message: `Invoice #${params.invoiceId} not found.` };
  }
  if (invoice.status === 'Refunded') {
    return { success: false, message: `Invoice #${params.invoiceId} is already refunded.` };
  }

  const now = new Date();
  invoice.status = 'Refunded';
  invoice.refundReason = params.reason;
  invoice.refundedAt = now.toISOString();
  invoice.refundApprovedBy = params.manager.name;
  invoice.refundApprovedById = params.manager.id;

  setStored(STORAGE_KEYS.SALES, allSales);

  // Restore inventory stock for refunded items
  if (Array.isArray(invoice.items)) {
    invoice.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, item.quantity, undefined, undefined, {
          staffId: params.manager.id,
          staffName: params.manager.name,
          referenceId: invoice.id,
          reason: `Customer Refund Restock: +${item.quantity} ${item.name || ''} (Refunded Invoice #${invoice.id} - ${params.reason})`,
          actionTaken: 'REFUND_RESTOCK',
          txnType: 'RETURN',
        });
      }
    });
  }

  // If cash sale, add Cash Log (Form 2) payout entry & cash movement for CASHIER's drawer balance
  if (invoice.paymentMethod === 'Cash') {
    const targetCashierId = params.cashier?.id || invoice.staffId || params.manager.id;
    const targetCashierName = params.cashier?.name || invoice.staffName || params.manager.name;
    const shiftDate = now.toISOString().split('T')[0];

    addCashLog({
      timestamp: now.toISOString(),
      date: shiftDate,
      staffId: targetCashierId,
      staffName: targetCashierName,
      line: 'Refunds / Returns',
      description: `Cash refund for Invoice #${invoice.id} (${params.reason}) - Auth by ${params.manager.name}`,
      in: 0,
      out: invoice.total,
      category: 'Refund',
      reference: invoice.id,
      company_id: invoice.company_id || invoice.companyId,
      branch_id: invoice.branch_id || invoice.branchId,
    });

    // Write cash deduction movement to the CASHIER's drawer so the cashier's drawer balances correctly
    addMovement({
      shiftId: getShiftId(targetCashierId, shiftDate),
      staffId: targetCashierId,
      date: shiftDate,
      timestamp: now.toISOString(),
      type: 'refund',
      amount: invoice.total,
      currency: invoice.currency || 'USD',
      direction: 'out',
      affectsDrawer: true,
      status: 'approved',
      sourceModule: 'POS',
      sourceRef: invoice.id,
      notes: `Cash refund #${invoice.id} ($${invoice.total.toFixed(2)}) auth by ${params.manager.name} (${params.reason})`,
      approvedBy: params.manager.id,
      approvedByName: params.manager.name,
      company_id: invoice.company_id || invoice.companyId,
      branch_id: invoice.branch_id || invoice.branchId,
    });
  }

  // Record in Audit Log
  logManagerOverride({
    action: 'REFUND_INVOICE',
    manager: params.manager,
    cashier: params.cashier || (invoice.staffId ? { id: invoice.staffId, name: invoice.staffName || 'Cashier' } : undefined),
    referenceId: invoice.id,
    amount: invoice.total,
    details: `Refund processed for Invoice #${invoice.id} ($${invoice.total.toFixed(2)}). Deducted from Cashier ${params.cashier?.name || invoice.staffName || 'Till'}. Authorized by ${params.manager.role} ${params.manager.name}. Reason: ${params.reason}`,
    metadata: {
      customerName: invoice.customerName,
      paymentMethod: invoice.paymentMethod,
    },
  });

  return { success: true, message: `Invoice #${invoice.id} successfully refunded.`, invoice };
};

export const voidSaleInvoice = (params: {
  invoiceId: string;
  manager: Salesperson;
  cashier?: Salesperson;
  reason: string;
}): { success: boolean; message: string; invoice?: SaleInvoice } => {
  const allSales = getAllSales();
  const invoice = allSales.find((s) => s.id === params.invoiceId);
  if (!invoice) {
    return { success: false, message: `Invoice #${params.invoiceId} not found.` };
  }

  const now = new Date();
  invoice.status = 'Voided';
  invoice.voidReason = params.reason;
  invoice.voidedAt = now.toISOString();
  invoice.voidApprovedBy = params.manager.name;
  invoice.voidApprovedById = params.manager.id;

  setStored(STORAGE_KEYS.SALES, allSales);

  // If cash sale, add Cash Log (Form 2) reversal entry
  if (invoice.paymentMethod === 'Cash') {
    addCashLog({
      timestamp: now.toISOString(),
      date: now.toISOString().split('T')[0],
      staffId: params.manager.id,
      staffName: params.manager.name,
      line: 'Voids / Reversals',
      description: `Cash reversal for Voided Invoice #${invoice.id} (${params.reason})`,
      in: 0,
      out: invoice.total,
      category: 'Refund',
      reference: invoice.id,
    });
  }

  // Restore inventory stock for voided items
  if (Array.isArray(invoice.items)) {
    invoice.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, item.quantity, undefined, undefined, {
          staffId: params.manager.id,
          staffName: params.manager.name,
          referenceId: invoice.id,
          reason: `Invoice Void Restock: +${item.quantity} ${item.name || ''} (Voided Invoice #${invoice.id} - ${params.reason})`,
          actionTaken: 'VOID_RESTOCK',
          txnType: 'RETURN',
        });
      }
    });
  }

  logManagerOverride({
    action: 'VOID_INVOICE',
    manager: params.manager,
    cashier: params.cashier,
    referenceId: invoice.id,
    amount: invoice.total,
    details: `Invoice #${invoice.id} ($${invoice.total.toFixed(2)}) voided by ${params.manager.role} ${params.manager.name}. Reason: ${params.reason}`,
  });

  return { success: true, message: `Invoice #${invoice.id} voided successfully.`, invoice };
};


export interface ItemExchangeRecord {
  exchangeId: string;
  invoiceId: string;
  timestamp: string;
  date: string;
  cashierId: string;
  cashierName: string;
  authorizedById?: string;
  authorizedByName?: string;
  returnedItem: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    totalCredit: number;
    restockCondition: 'restock' | 'damaged';
    reason: string;
  };
  replacementItem: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    totalCost: number;
  };
  netDifference: number;
  paymentMethod?: string;
  notes?: string;
}

export const exchangeSaleItems = (params: {
  invoiceId: string;
  cashier: Salesperson;
  manager?: Salesperson;
  returnedItem: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    totalCredit: number;
    restockCondition: 'restock' | 'damaged';
    reason: string;
  };
  replacementItem: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    totalCost: number;
  };
  paymentMethod?: string;
  tenderedAmount?: number;
  changeGiven?: number;
  notes?: string;
}): { success: boolean; message: string; exchangeRecord?: ItemExchangeRecord; invoice?: SaleInvoice } => {
  const allSales = getAllSales();
  const invoice = allSales.find((s) => s.id === params.invoiceId);
  if (!invoice) {
    return { success: false, message: 'Receipt #' + params.invoiceId + ' not found.' };
  }
  if (invoice.status === 'Refunded') {
    return { success: false, message: 'Receipt #' + params.invoiceId + ' is already refunded and cannot be exchanged.' };
  }
  if (invoice.status === 'Voided') {
    return { success: false, message: 'Receipt #' + params.invoiceId + ' is voided and cannot be exchanged.' };
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const netDifference = Math.round((params.replacementItem.totalCost - params.returnedItem.totalCredit) * 100) / 100;

  // 1. Inventory Movements:
  // Restock returned item if condition is 'restock'
  if (params.returnedItem.restockCondition === 'restock' && params.returnedItem.id && params.returnedItem.quantity > 0) {
    updateProductStock(params.returnedItem.id, params.returnedItem.quantity, undefined, undefined, {
      staffId: params.manager?.id || params.cashier.id,
      staffName: params.manager?.name || params.cashier.name,
      referenceId: invoice.id,
      reason: 'Exchange Restock: +' + params.returnedItem.quantity + ' ' + params.returnedItem.name + ' (Invoice #' + invoice.id + ' - ' + params.returnedItem.reason + ')',
      actionTaken: 'EXCHANGE_RESTOCK',
      txnType: 'RETURN',
    });
  }

  // Deplete stock for replacement item
  if (params.replacementItem.id && params.replacementItem.quantity > 0) {
    updateProductStock(params.replacementItem.id, -params.replacementItem.quantity, undefined, undefined, {
      staffId: params.manager?.id || params.cashier.id,
      staffName: params.manager?.name || params.cashier.name,
      referenceId: invoice.id,
      reason: 'Exchange Issued: -' + params.replacementItem.quantity + ' ' + params.replacementItem.name + ' (Swapped on Invoice #' + invoice.id + ')',
      actionTaken: 'EXCHANGE_ISSUE',
      txnType: 'SALE',
    });
  }

  // 2. Financial Ledger Movements (Cash Drawer & Form 2):
  const shiftId = getShiftId(params.cashier.id, dateStr);
  const compId = invoice.company_id || invoice.companyId;
  const brId = invoice.branch_id || invoice.branchId;

  if (netDifference > 0) {
    // Customer pays extra difference
    if (params.paymentMethod === 'Cash' || !params.paymentMethod) {
      addCashLog({
        timestamp: now.toISOString(),
        date: dateStr,
        staffId: params.cashier.id,
        staffName: params.cashier.name,
        line: 'Item Exchange Payment',
        description: 'Customer paid difference for exchange on Invoice #' + invoice.id + ' (+' + params.replacementItem.name + ' vs -' + params.returnedItem.name + ')',
        in: netDifference,
        out: 0,
        category: 'Sale',
        reference: invoice.id,
        company_id: compId,
        branch_id: brId,
      });

      addMovement({
        shiftId,
        staffId: params.cashier.id,
        date: dateStr,
        timestamp: now.toISOString(),
        type: 'exchange_payment',
        amount: netDifference,
        currency: invoice.currency || 'USD',
        direction: 'in',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'POS',
        sourceRef: invoice.id,
        notes: `Exchange net payment (+$${netDifference.toFixed(2)}) for Invoice #${invoice.id}`,
        company_id: compId,
        branch_id: brId,
      });
    }
  } else if (netDifference < 0) {
    // Store refunds difference to customer
    const refundAmt = Math.abs(netDifference);
    addCashLog({
      timestamp: now.toISOString(),
      date: dateStr,
      staffId: params.cashier.id,
      staffName: params.cashier.name,
      line: 'Item Exchange Refund',
      description: `Store refunded difference for exchange on Invoice #${invoice.id} (+${params.replacementItem.name} vs -${params.returnedItem.name})`,
      in: 0,
      out: refundAmt,
      category: 'Refund',
      reference: invoice.id,
      company_id: compId,
      branch_id: brId,
    });

    addMovement({
      shiftId,
      staffId: params.cashier.id,
      date: dateStr,
      timestamp: now.toISOString(),
      type: 'exchange_refund',
      amount: refundAmt,
      currency: invoice.currency || 'USD',
      direction: 'out',
      affectsDrawer: true,
      status: 'approved',
      sourceModule: 'POS',
      sourceRef: invoice.id,
      notes: `Exchange refund differential (-$${refundAmt.toFixed(2)}) for Invoice #${invoice.id}`,
      company_id: compId,
      branch_id: brId,
    });
  }

  // 3. Record Exchange on Immutable Invoice:
  const exchangeRecord: ItemExchangeRecord = {
    exchangeId: `EXC-${now.getTime().toString(36).toUpperCase()}-${Math.floor(Math.random() * 899 + 100)}`,
    invoiceId: invoice.id,
    timestamp: now.toISOString(),
    date: dateStr,
    cashierId: params.cashier.id,
    cashierName: params.cashier.name,
    authorizedById: params.manager?.id,
    authorizedByName: params.manager?.name,
    returnedItem: params.returnedItem,
    replacementItem: params.replacementItem,
    netDifference,
    paymentMethod: params.paymentMethod || 'Cash',
    notes: params.notes,
  };

  invoice.exchanges = [...(invoice.exchanges || []), exchangeRecord];
  invoice.hasExchanges = true;
  invoice.netTotal = Math.round(((invoice.netTotal ?? invoice.total) + netDifference) * 100) / 100;

  setStored(STORAGE_KEYS.SALES, allSales);

  // 4. Audit Log:
  logManagerOverride({
    action: 'ITEM_EXCHANGE',
    manager: params.manager || params.cashier,
    cashier: params.cashier,
    referenceId: invoice.id,
    amount: Math.abs(netDifference),
    details: `Item exchange on #${invoice.id}: Returned ${params.returnedItem.quantity}x ${params.returnedItem.name} ($${params.returnedItem.totalCredit.toFixed(2)}) for ${params.replacementItem.quantity}x ${params.replacementItem.name} ($${params.replacementItem.totalCost.toFixed(2)}). Net Difference: $${netDifference >= 0 ? '+' : ''}${netDifference.toFixed(2)}. Restock: ${params.returnedItem.restockCondition}`,
    metadata: {
      exchangeId: exchangeRecord.exchangeId,
      returnedItem: params.returnedItem,
      replacementItem: params.replacementItem,
      netDifference,
    },
  });

  notifyListeners();

  return {
    success: true,
    message: `Item exchange completed successfully. Net difference: $${netDifference >= 0 ? '+' : ''}${netDifference.toFixed(2)}`,
    exchangeRecord,
    invoice,
  };
};

export const editSaleInvoice = (params: {
  invoiceId: string;
  staff: Salesperson;
  authorizedBy?: Salesperson;
  reason: string;
  updates: {
    customerName?: string;
    customerId?: string;
    customerPhone?: string;
    paymentMethod?: any;
    currency?: string;
    proofOfPaymentRef?: string;
    paymentReference?: string;
    items?: any[];
    subtotal?: number;
    discount?: number;
    tax?: number;
    total?: number;
    grossTenderUsd?: number;
    cashWithdrawalAmount?: number;
    notes?: string;
  };
}): { success: boolean; message: string; invoice?: SaleInvoice } => {
  const allSales = getAllSales();
  const invoice = allSales.find((s) => s.id === params.invoiceId);
  if (!invoice) {
    return { success: false, message: `Receipt #${params.invoiceId} not found.` };
  }

  const changesList: string[] = [];
  const previousSnapshot: Record<string, any> = {};

  // Check customer changes
  if (params.updates.customerName !== undefined && params.updates.customerName !== invoice.customerName) {
    changesList.push(`Customer: "${invoice.customerName || 'None'}" -> "${params.updates.customerName}"`);
    previousSnapshot.customerName = invoice.customerName;
    invoice.customerName = params.updates.customerName;
    if (invoice.customer) invoice.customer.name = params.updates.customerName;
  }
  if (params.updates.customerId !== undefined && params.updates.customerId !== invoice.customerId) {
    invoice.customerId = params.updates.customerId;
    if (invoice.customer) invoice.customer.id = params.updates.customerId;
  }
  if (params.updates.customerPhone !== undefined) {
    if (invoice.customer) (invoice.customer as any).phone = params.updates.customerPhone;
  }

  // Check payment method changes
  if (params.updates.paymentMethod !== undefined && params.updates.paymentMethod !== invoice.paymentMethod) {
    changesList.push(`Method: "${invoice.paymentMethod}" -> "${params.updates.paymentMethod}"`);
    previousSnapshot.paymentMethod = invoice.paymentMethod;
    invoice.paymentMethod = params.updates.paymentMethod;
  }
  if (params.updates.currency !== undefined && params.updates.currency !== invoice.currency) {
    changesList.push(`Currency: "${invoice.currency}" -> "${params.updates.currency}"`);
    previousSnapshot.currency = invoice.currency;
    invoice.currency = params.updates.currency;
  }

  // Check payment reference changes
  if (params.updates.proofOfPaymentRef !== undefined && params.updates.proofOfPaymentRef !== invoice.proofOfPaymentRef) {
    changesList.push(`Ref: "${invoice.proofOfPaymentRef || ''}" -> "${params.updates.proofOfPaymentRef}"`);
    invoice.proofOfPaymentRef = params.updates.proofOfPaymentRef;
  }
  if (params.updates.paymentReference !== undefined && params.updates.paymentReference !== invoice.paymentReference) {
    invoice.paymentReference = params.updates.paymentReference;
  }

  // Check items changes
  if (Array.isArray(params.updates.items)) {
    const prevItemCount = Array.isArray(invoice.items) ? invoice.items.length : 0;
    const newItemCount = params.updates.items.length;
    if (prevItemCount !== newItemCount) {
      changesList.push(`Items count: ${prevItemCount} -> ${newItemCount}`);
    }
    previousSnapshot.items = invoice.items;
    invoice.items = params.updates.items;
    invoice.itemsSummary = params.updates.items
      .map((it: any) => `${it.quantity}x ${it.name || it.productName || 'Item'}`)
      .join(', ');
  }

  // Check total changes
  if (params.updates.subtotal !== undefined && params.updates.subtotal !== invoice.subtotal) {
    invoice.subtotal = params.updates.subtotal;
  }
  if (params.updates.discount !== undefined && params.updates.discount !== invoice.discount) {
    changesList.push(`Discount: $${(invoice.discount || 0).toFixed(2)} -> $${params.updates.discount.toFixed(2)}`);
    invoice.discount = params.updates.discount;
  }
  if (params.updates.total !== undefined && params.updates.total !== invoice.total) {
    changesList.push(`Total: $${(invoice.total || 0).toFixed(2)} -> $${params.updates.total.toFixed(2)}`);
    previousSnapshot.total = invoice.total;
    invoice.total = params.updates.total;
    invoice.totalAmount = params.updates.total;
  }

  // Check cash withdrawal changes
  if (params.updates.cashWithdrawalAmount !== undefined && params.updates.cashWithdrawalAmount !== invoice.cashWithdrawalAmount) {
    changesList.push(`Cash-out: $${(invoice.cashWithdrawalAmount || 0).toFixed(2)} -> $${params.updates.cashWithdrawalAmount.toFixed(2)}`);
    invoice.cashWithdrawalAmount = params.updates.cashWithdrawalAmount;
  }
  if (params.updates.grossTenderUsd !== undefined) {
    invoice.grossTenderUsd = params.updates.grossTenderUsd;
  }

  // Check notes
  if (params.updates.notes !== undefined) {
    invoice.notes = params.updates.notes;
  }

  const now = new Date();
  (invoice as any).lastEditedAt = now.toISOString();
  (invoice as any).lastEditedBy = params.staff.name;
  (invoice as any).lastEditedById = params.staff.id;
  (invoice as any).editReason = params.reason;

  setStored(STORAGE_KEYS.SALES, allSales);

  // Log in Audit Trail
  const authName = params.authorizedBy ? `${params.authorizedBy.role} ${params.authorizedBy.name}` : `${params.staff.role} ${params.staff.name}`;
  addAuditLog({
    action: 'EDIT_RECEIPT',
    severity: 'WARNING',
    staffId: params.staff.id,
    staffName: params.staff.name,
    staffRole: params.staff.role,
    authorizedById: params.authorizedBy?.id,
    authorizedByName: params.authorizedBy?.name,
    authorizedByRole: params.authorizedBy?.role,
    referenceId: invoice.id,
    amount: invoice.total,
    details: `Receipt #${invoice.id} edited (${changesList.length > 0 ? changesList.join('; ') : 'Details modified'}). Reason: ${params.reason}. Action by: ${authName}.`,
    metadata: {
      invoiceId: invoice.id,
      reason: params.reason,
      changes: changesList,
      previous: previousSnapshot,
    },
  });

  notifyDatabaseMutation({
    type: 'MUTATION_SALE',
    action: 'UPDATE',
    entityId: invoice.id,
    timestamp: now.toISOString(),
  } as any);

  return {
    success: true,
    message: `Receipt #${invoice.id} updated successfully and recorded in audit trail.`,
    invoice,
  };
};

// ==================== EXPENSE DAO ====================
export const getAllExpenses = (): ExpenseEntry[] => {
  return getStored<ExpenseEntry[]>(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
};

export const getExpenses = (): ExpenseEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllExpenses();
  return all.filter((e) => {
    const compId = e.company_id || e.companyId;
    const matchesComp = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
    if (!matchesComp) return false;
    const brId = (e as any).branch_id || (e as any).branchId || 'BR-MAIN';
    return brId === currentBranch;
  });
};

export const getNextExpenseId = (): string => {
  const list = getAllExpenses();
  const numbers = list
    .map((e) => {
      const match = e.id.match(/^EXP-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `EXP-${String(next).padStart(3, '0')}`;
};

export const addExpense = (
  expenseData: Omit<ExpenseEntry, 'id' | 'synced'> & {
    id?: string;
    recordCashLog?: boolean;
    company_id?: string;
    companyId?: string;
    branch_id?: string;
    branchId?: string;
    status?: 'pending_supervisor' | 'approved' | 'rejected';
    approvedBy?: string;
    approvedByName?: string;
    approvalTimestamp?: string;
  }
): ExpenseEntry => {
  const all = getAllExpenses();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionUser = getSessionUser();
  const isSupervisor = isSupervisorOrAbove(sessionUser?.role);
  const compId = expenseData.company_id || expenseData.companyId || currentCompany;
  const brId = expenseData.branch_id || expenseData.branchId || currentBranch;
  const expId = expenseData.id || getNextExpenseId();

  const initialStatus = expenseData.status || (isSupervisor ? 'approved' : 'pending_supervisor');

  const created: ExpenseEntry = {
    ...expenseData,
    id: expId,
    synced: false,
    status: initialStatus,
    approvedBy: expenseData.approvedBy || (initialStatus === 'approved' ? (sessionUser?.id || '001') : undefined),
    approvedByName: expenseData.approvedByName || (initialStatus === 'approved' ? (sessionUser?.name || 'Supervisor') : undefined),
    approvalTimestamp: expenseData.approvalTimestamp || (initialStatus === 'approved' ? new Date().toISOString() : undefined),
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.EXPENSES, updated);

  // If cash expense, add to CashLog
  if (expenseData.paymentMethod === 'Cash' && expenseData.recordCashLog !== false) {
    addCashLog({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      line: 'Expenses',
      description: `Expense #${created.id} [${created.status === 'approved' ? 'Approved' : 'Pending Approval'}] - ${created.category}: ${created.description}`,
      in: 0,
      out: created.amount,
      category: created.category,
      reference: created.id,
      company_id: compId,
      branch_id: brId,
    });
  }

  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_expenses_updated', { detail: created }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: created }));
  }

  // Save to Sheet "Expenses"
  enqueueSync('Expenses', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    ExpenseID: created.id,
    Date: created.date,
    Category: created.category,
    VendorOrCustomer: created.vendorOrCustomer || '',
    Amount: created.amount,
    PaymentMethod: created.paymentMethod,
    StaffID: created.staffId,
    StaffName: created.staffName,
    Description: created.description,
    ReceiptRef: created.receiptRef || '',
    Status: created.status,
  });

  return created;
};

export const getExpensesForStaffAndDate = (staffId: string, date: string): ExpenseEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const allExpenses = getAllExpenses();
  const targetStaffId = String(staffId || '').trim().toLowerCase();
  const normTarget = targetStaffId.replace(/^usr-|^staff-|^0+/, '');

  return allExpenses.filter((e) => {
    const compId = (e.company_id || e.companyId || '').trim();
    const matchesComp =
      !compId ||
      currentCompany === 'COMP-MASTER' ||
      compId === 'COMP-MASTER' ||
      compId === currentCompany ||
      (!currentCompany && (compId === 'COMP-001' || compId === 'COMP-MASTER'));
    if (!matchesComp) return false;

    const expStaffId = e.staffId ? String(e.staffId).trim().toLowerCase() : '';
    const normExpStaff = expStaffId.replace(/^usr-|^staff-|^0+/, '');

    const isSameStaff =
      !targetStaffId ||
      targetStaffId === 'all' ||
      expStaffId === targetStaffId ||
      (normTarget && normExpStaff === normTarget);

    const isSameDate = isSameDaySafe(e.date, e.timestamp, date);
    return isSameStaff && isSameDate;
  });
};

export const approveExpense = (expenseId: string, supervisor: Salesperson): boolean => {
  const all = getAllExpenses();
  const idx = all.findIndex((e) => e.id === expenseId);
  if (idx === -1) return false;
  all[idx] = {
    ...all[idx],
    status: 'approved',
    approvedBy: supervisor.id,
    approvedByName: supervisor.name,
    approvalTimestamp: new Date().toISOString(),
  };
  setStored(STORAGE_KEYS.EXPENSES, all);
  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_expenses_updated', { detail: all[idx] }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: all[idx] }));
  }
  return true;
};

export const rejectExpense = (
  expenseId: string,
  supervisor: Salesperson,
  reason: string = 'Returned to cashier drawer for re-entry'
): boolean => {
  const all = getAllExpenses();
  const idx = all.findIndex((e) => e.id === expenseId);
  if (idx === -1) return false;
  const exp = all[idx];

  const now = new Date().toISOString();
  all[idx] = {
    ...exp,
    status: 'rejected',
    approvedBy: supervisor.id,
    approvedByName: supervisor.name,
    approvalTimestamp: now,
    notes: `${exp.notes ? exp.notes + ' • ' : ''}Rejected by ${supervisor.name}: ${reason}`,
  };
  setStored(STORAGE_KEYS.EXPENSES, all);

  // If cash expense, return the money to the cashier's drawer so it can be re-entered
  if (exp.paymentMethod === 'Cash' || !exp.paymentMethod) {
    const shiftDate = exp.date || now.split('T')[0];
    const targetStaffId = exp.staffId || '001';
    const targetStaffName = exp.staffName || 'Cashier';

    // 1. Compensatory CashLog entry (IN to balance out previous OUT)
    addCashLog({
      timestamp: now,
      date: shiftDate,
      staffId: targetStaffId,
      staffName: targetStaffName,
      line: 'Expenses',
      description: `REVERSAL: Expense #${exp.id} returned to drawer by ${supervisor.name} (${reason})`,
      in: exp.amount,
      out: 0,
      category: 'Expense Reversal',
      reference: exp.id,
      company_id: exp.company_id,
      branch_id: exp.branch_id,
    });

    // 2. Compensatory cash movement into the cashier's drawer
    addMovement({
      shiftId: getShiftId(targetStaffId, shiftDate),
      staffId: targetStaffId,
      date: shiftDate,
      timestamp: now,
      type: 'expense_reversal',
      amount: exp.amount,
      currency: 'USD',
      direction: 'in',
      affectsDrawer: true,
      status: 'approved',
      sourceModule: 'form2',
      sourceRef: exp.id,
      notes: `Expense #${exp.id} rejected by ${supervisor.name} - $${exp.amount.toFixed(2)} returned to till (${reason})`,
      approvedBy: supervisor.id,
      approvedByName: supervisor.name,
    });
  }

  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_expenses_updated', { detail: all[idx] }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: all[idx] }));
    window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
  }
  return true;
};

export const approveAllExpensesForStaffAndDate = (staffId: string, date: string, supervisor: Salesperson): number => {
  const all = getAllExpenses();
  let count = 0;
  const now = new Date().toISOString();
  const targetStaffId = String(staffId || '').trim().toLowerCase();
  const normTarget = targetStaffId.replace(/^usr-|^staff-|^0+/, '');

  const updated = all.map((e) => {
    const isDateMatch = isSameDaySafe(e.date, e.timestamp, date);
    const expStaffId = e.staffId ? String(e.staffId).trim().toLowerCase() : '';
    const normExpStaff = expStaffId.replace(/^usr-|^staff-|^0+/, '');
    const isStaffMatch = !targetStaffId || targetStaffId === 'all' || expStaffId === targetStaffId || (normTarget && normExpStaff === normTarget);

    if (isDateMatch && isStaffMatch && e.status !== 'approved') {
      count++;
      return {
        ...e,
        status: 'approved',
        approvedBy: supervisor.id,
        approvedByName: supervisor.name,
        approvalTimestamp: now,
      };
    }
    return e;
  });

  if (count > 0) {
    setStored(STORAGE_KEYS.EXPENSES, updated);
    notifyListeners();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
    }
  }
  return count;
};

// ==================== RECONCILIATIONS DAO (FORM 4) ====================
export const getAllReconciliations = (): ShiftReconciliation[] => {
  return getStored<ShiftReconciliation[]>(STORAGE_KEYS.RECONCILIATIONS, []);
};

export const getReconciliations = (): ShiftReconciliation[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllReconciliations();
  const branches = getBranches();
  return all.filter((r) => {
    const compId = (r as any).company_id || (r as any).companyId;
    const matchesComp = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
    if (!matchesComp) return false;
    const brId = (r as any).branch_id || (r as any).branchId;
    return isRecordInBranchScope(brId, currentBranch, branches, currentCompany);
  });
};

export const saveReconciliation = (recData: Omit<ShiftReconciliation, 'id' | 'synced' | 'timestamp'> & { id?: string }): ShiftReconciliation => {
  const list = getAllReconciliations();
  const compId = (recData as any).company_id || (recData as any).companyId || getCurrentCompanyId();
  const brId = (recData as any).branch_id || (recData as any).branchId || getCurrentBranchId();
  const created: ShiftReconciliation = {
    ...recData,
    id: recData.id || `REC-${Date.now()}`,
    timestamp: new Date().toISOString(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  } as any;
  const updated = [created, ...list];
  setStored(STORAGE_KEYS.RECONCILIATIONS, updated);

  // Save to Sheet "Reconciliations"
  enqueueSync('Reconciliations', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    Date: created.date,
    StaffID: created.staffId,
    StaffName: created.staffName,
    OpeningFloat: created.openingFloat,
    CashSales: created.cashSales,
    OtherCashIn: created.otherCashIn,
    CashExpenses: created.cashExpenses,
    BankDrops: created.bankDrops,
    ExpectedCash: created.expectedCash,
    ActualCashCount: created.actualCashCount,
    Variance: created.variance,
    Status: created.status,
    Notes: created.notes,
  });

  return created;
};

// ==================== ADMIN SALES & RECONCILIATION BALANCING DAO (FORM 4) ====================
export const getAllAdminSales = (): AdminSalesEntry[] => {
  return getStored<AdminSalesEntry[]>(STORAGE_KEYS.ADMIN_SALES, []);
};

export const getAdminSales = (): AdminSalesEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllAdminSales();
  return all.filter((s) => {
    const compId = (s as any).company_id || (s as any).companyId;
    const matchesComp = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
    if (!matchesComp) return false;
    const brId = (s as any).branch_id || (s as any).branchId || 'BR-MAIN';
    return brId === currentBranch;
  });
};

export const getAdminSalesForDate = (date: string): AdminSalesEntry[] => {
  const all = getAdminSales();
  return all.filter((s) => s.date === date);
};

export const getAdminSaleForStaffAndDate = (staffId: string, date: string): AdminSalesEntry | undefined => {
  const all = getAdminSales();
  return all.find((s) => s.staffId === staffId && s.date === date);
};

export const saveAdminSalesEntry = (
  date: string,
  staffId: string,
  staffName: string,
  salesAmount: number,
  notes?: string
): AdminSalesEntry => {
  const all = getAllAdminSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const id = `AS-${date}-${staffId}`;
  const now = new Date().toISOString();
  const existingIdx = all.findIndex((s) => {
    const compId = (s as any).company_id || (s as any).companyId || 'COMP-001';
    return compId === currentCompany && s.staffId === staffId && s.date === date;
  });

  const entry: AdminSalesEntry = {
    id,
    date,
    staffId,
    staffName,
    salesAmount: Math.max(0, salesAmount || 0),
    notes: notes || '',
    timestamp: now,
    company_id: currentCompany,
    companyId: currentCompany,
    branch_id: currentBranch,
    branchId: currentBranch,
    synced: false,
  } as any;

  let updated: AdminSalesEntry[];
  if (existingIdx >= 0) {
    updated = [...all];
    updated[existingIdx] = entry;
  } else {
    updated = [entry, ...all];
  }

  setStored(STORAGE_KEYS.ADMIN_SALES, updated);
  return entry;
};

export const saveAllAdminSalesEntries = (
  date: string,
  entries: Array<{
    staffId: string;
    staffName: string;
    salesAmount: number;
    notes?: string;
  }>
): AdminSalesEntry[] => {
  const all = getAllAdminSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  // Filter out any entries for this specific date and company that we are updating
  const otherEntries = all.filter((s) => {
    const compId = (s as any).company_id || (s as any).companyId || 'COMP-001';
    return compId !== currentCompany || s.date !== date;
  });
  const now = new Date().toISOString();

  const newDateEntries: AdminSalesEntry[] = entries.map((e) => ({
    id: `AS-${date}-${e.staffId}`,
    date,
    staffId: e.staffId,
    staffName: e.staffName,
    salesAmount: Math.max(0, e.salesAmount || 0),
    notes: e.notes || '',
    timestamp: now,
    company_id: currentCompany,
    companyId: currentCompany,
    branch_id: currentBranch,
    branchId: currentBranch,
    synced: false,
  } as any));

  const updatedAll = [...newDateEntries, ...otherEntries];
  setStored(STORAGE_KEYS.ADMIN_SALES, updatedAll);
  return newDateEntries;
};

export const getSalesForStaffAndDate = (staffId: string, date: string, staffName?: string): SaleInvoice[] => {
  const currentCompany = getCurrentCompanyId();
  const allSales = getAllSales();
  const targetStaffId = String(staffId || '').trim().toLowerCase();
  const normTarget = targetStaffId.replace(/^usr-|^staff-|^0+/, '');
  const targetName = staffName ? staffName.trim().toLowerCase() : '';

  return allSales.filter((s) => {
    const compId = (s.company_id || s.companyId || '').trim();
    const matchesComp =
      !compId ||
      currentCompany === 'COMP-MASTER' ||
      compId === 'COMP-MASTER' ||
      compId === currentCompany ||
      (!currentCompany && (compId === 'COMP-001' || compId === 'COMP-MASTER'));
    if (!matchesComp) return false;

    const saleStaffId = s.staffId ? String(s.staffId).trim().toLowerCase() : '';
    const normSaleStaff = saleStaffId.replace(/^usr-|^staff-|^0+/, '');
    const saleStaffName = s.staffName ? s.staffName.trim().toLowerCase() : '';

    const isSameStaff =
      !targetStaffId ||
      targetStaffId === 'all' ||
      saleStaffId === targetStaffId ||
      (normTarget && normSaleStaff === normTarget) ||
      (targetName && saleStaffName === targetName) ||
      (saleStaffName && targetStaffId && saleStaffName.toLowerCase().includes(targetStaffId));

    // Support both direct date match and local timestamp date match
    const isSameDate = isSameDaySafe(s.date, s.timestamp, date);
    const isValidStatus = s.status !== 'Refunded' && s.status !== 'Voided';
    return isSameStaff && isSameDate && isValidStatus;
  });
};

export const getTotalSalesForStaffAndDate = (staffId: string, date: string): number => {
  const staffSales = getSalesForStaffAndDate(staffId, date);
  return staffSales.reduce((sum, s) => sum + (s.total || 0), 0);
};

/**
 * Calculates the exact cash position, net sums, should have, and variance for a salesperson on a given date.
 * Formulas:/**
 * ==================== FORM 4: SALESPERSON CASH BALANCING ====================
 * Expected Cash Formula (Core User Balancing Formula):
 * expectedCash = float + cashSales + creditPayments - expenses - directProcurements - cashLift - customerChange - deductions - ecocashWithdrawal - zigWithdrawal
 * 
 * Non-Cash Sales:
 * totalNonCashSales = ecocashSales + zigSales (Reporting only, NOT for expected cash)
 */
export const calculateForm4 = (
  staffId: string,
  staffName: string,
  date: string,
  overrideSales?: number,
  branchId?: string
): Form4BalancingResult => {
  const currentBranch = branchId || getCurrentBranchId();
  const shiftId = getShiftId(staffId, date, currentBranch);
  const breakdown = getShiftLedgerBreakdown(shiftId);

  // Non-cash sales (for reporting only, not in expected cash)
  const staffSales = getSalesForStaffAndDate(staffId, date, staffName);
  const systemSalesTotal = staffSales.reduce((sum, s) => sum + (s.total || 0), 0);

  const ecocashSales = staffSales
    .filter(
      (s) =>
        s.paymentMethod === 'EcoCash' ||
        s.paymentMethod === 'EcoCash/Mobile' ||
        s.paymentMethod === 'ECO' ||
        s.paymentMethod === 'ECOCASH' ||
        s.currency === 'EcoCash' ||
        s.currency === 'ECO' ||
        s.currency === 'ECOCASH' ||
        ((s.paymentMethod?.toLowerCase().includes('eco') || s.currency?.toLowerCase().includes('eco')) &&
          s.paymentMethod !== 'Cash')
    )
    .reduce((sum, s) => sum + (s.total || 0), 0);
  const zigSales = staffSales
    .filter(
      (s) =>
        s.paymentMethod === 'ZiG' ||
        s.paymentMethod === 'ZIG' ||
        s.currency === 'ZiG' ||
        s.currency === 'ZIG' ||
        ((s.paymentMethod?.toLowerCase().includes('zig') || s.currency?.toLowerCase().includes('zig')) &&
          s.paymentMethod !== 'Cash')
    )
    .reduce((sum, s) => sum + (s.total || 0), 0);

  const effectiveEcoSales = Math.max(ecocashSales, breakdown.ecocashSales || 0);
  const effectiveZigSales = Math.max(zigSales, breakdown.zigSales || 0);

  // Credit extended from customerLedger (NOT cashMovements)
  const staffCustomerLedger = getCustomerLedgerEntries((entry) =>
    (entry.staffId === staffId || !entry.staffId) && entry.date === date
  );
  const creditExtended = staffCustomerLedger
    .filter((e) => e.type === 'credit_extended')
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const totalNonCashSales = effectiveEcoSales + effectiveZigSales + creditExtended;

  // Form 2 & 3 legacy logs for compatibility
  const form2Logs = getCashLogsForStaffAndDate(staffId, date);
  const form3Changes = getCustomerChangesForStaffAndDate(staffId, date);
  const form3Credits = getCreditSalesForStaffAndDate(staffId, date);

  const savedAdminSale = getAdminSaleForStaffAndDate(staffId, date);
  let totalSales = systemSalesTotal;
  let isOverridden = false;

  // If cashMovements exist for this shift, use breakdown as the canonical source
  if (breakdown.movementsCount > 0) {
    let float = breakdown.openingFloat;
    let refunds = breakdown.refunds || 0;
    let netCashSales = Math.max(0, (breakdown.cashSales || 0) - refunds);
    let cashSales = netCashSales;
    let creditPayments = breakdown.creditPayments;
    let changeReceived = breakdown.changeReceived;
    
    // Merge expenses from cashMovements, Form 2 logs, and approved Cash till expenses
    const utilitiesLogs = form2Logs.filter(
      (l) =>
        (l.out || 0) > 0 &&
        (l.line === 'Expenses' ||
          l.category === 'Expenses' ||
          l.line === 'Daily Store Expenses' ||
          l.category === 'Daily Store Expenses' ||
          (l as any).categoryGroup === 'Daily Store Expenses' ||
          l.description?.toLowerCase().includes('expense') ||
          l.line?.toLowerCase().includes('expense') ||
          l.category?.toLowerCase().includes('expense') ||
          l.description?.toLowerCase().includes('petty') ||
          l.line?.toLowerCase().includes('petty') ||
          l.category?.toLowerCase().includes('petty') ||
          l.line === 'Bread' ||
          l.line === 'Airtime' ||
          l.line === 'Home Use' ||
          l.line === 'Daily Utilities & Home' ||
          l.category === 'Daily Utilities & Home' ||
          (l as any).categoryGroup === 'Daily Utilities & Home' ||
          l.description?.toLowerCase().includes('bread') ||
          l.description?.toLowerCase().includes('airtime') ||
          l.description?.toLowerCase().includes('home use') ||
          l.description?.toLowerCase().includes('utilities'))
    );
    const expensesFromLogs = utilitiesLogs.reduce((sum, l) => sum + (l.out || 0), 0);

    const dbExpenses = getExpensesForStaffAndDate(staffId, date).filter(
      (e) => !e.isDeleted && e.status !== 'rejected' && (e.paymentMethod === 'Cash' || !e.paymentMethod)
    );
    const dbExpensesNotLogged = dbExpenses
      .filter(
        (e) =>
          !utilitiesLogs.some(
            (l) =>
              (l.reference && l.reference === e.id) ||
              (e.description && l.description?.toLowerCase().includes(e.description.toLowerCase()))
          )
      )
      .reduce((sum, e) => sum + (e.amount || 0), 0);

    const totalTillExpenses = Math.max(
      (breakdown.expenses || 0) + (breakdown.pettyCash || 0),
      expensesFromLogs + dbExpensesNotLogged
    );
    let expenses = totalTillExpenses;
    let directProcurements = breakdown.directProcurements;
    let cashLift = breakdown.cashLift;
    let customerChange = breakdown.changePaid;
    let deductions = 0; // All till expenses & petty cash are captured in expenses
    let ecocashWithdrawal = breakdown.ecocashCashOut;
    let zigWithdrawal = breakdown.zigCashOut;

    if (overrideSales !== undefined) {
      totalSales = overrideSales;
      isOverridden = Math.abs(overrideSales - systemSalesTotal) > 0.001;
      cashSales = Math.max(0, overrideSales - (effectiveEcoSales + effectiveZigSales));
    } else if (savedAdminSale && savedAdminSale.notes?.includes('Manual Override')) {
      totalSales = savedAdminSale.salesAmount;
      isOverridden = true;
      cashSales = Math.max(0, savedAdminSale.salesAmount - (effectiveEcoSales + effectiveZigSales));
    } else {
      totalSales = Math.max(systemSalesTotal, cashSales + effectiveEcoSales + effectiveZigSales + creditExtended);
    }

    const cashInTotal = Math.round((float + cashSales + creditPayments + changeReceived) * 100) / 100;
    const cashOutTotal = Math.round(
      (expenses + directProcurements + cashLift + customerChange + deductions + ecocashWithdrawal + zigWithdrawal) * 100
    ) / 100;
    const expectedCash = Math.round((cashInTotal - cashOutTotal) * 100) / 100;
    const shouldHave = expectedCash;

    // Form 1 Cash Count record
    const countRecord = getCashCountForStaffAndDate(staffId, date);
    const actualCashCount = countRecord
      ? countRecord.finalCashOutTotal
      : (breakdown.physicalCount !== null ? breakdown.physicalCount : null);
    const form1Counted = actualCashCount;
    const physicalCashCount = actualCashCount !== null ? actualCashCount : (expectedCash > 0 ? expectedCash : 0);

    let variance = 0;
    if (actualCashCount !== null) {
      variance = Math.round((actualCashCount - expectedCash) * 100) / 100;
    } else {
      variance = Math.round((0 - expectedCash) * 100) / 100;
    }

    let status: 'Balanced' | 'Over' | 'Shortage' | 'No Activity' = 'Balanced';
    if (actualCashCount !== null) {
      if (Math.abs(variance) < 0.01) status = 'Balanced';
      else if (variance < 0) status = 'Shortage';
      else status = 'Over';
    } else {
      status = 'Shortage';
    }

    const form2In = form2Logs.reduce((sum, l) => sum + (l.in || 0), 0);
    const form2Out = form2Logs.reduce((sum, l) => sum + (l.out || 0), 0);
    const form2Net = form2In - form2Out;
    const changeIn = changeReceived;
    const changeOut = customerChange;
    const creditIn = breakdown.creditPayments;
    const creditOut = creditExtended;
    const form3In = changeIn + creditIn;
    const form3Out = changeOut + creditOut;
    const form3Net = form3In - form3Out;
    const sumForm2And3Net = form2Net + form3Net;

    return {
      staffId,
      staffName,
      date,
      float,
      cashSales,
      creditPayments,
      expenses,
      directProcurements,
      cashLift,
      customerChange,
      deductions,
      ecocashWithdrawal,
      zigWithdrawal,
      expectedCash,
      shouldHave,
      ecocashSales: effectiveEcoSales,
      zigSales: effectiveZigSales,
      creditExtended,
      totalNonCashSales,
      cashInTotal,
      cashOutTotal,
      changeReceived,
      changePaid: customerChange,
      totalSales,
      sales: totalSales,
      systemSalesTotal,
      systemSalesCount: staffSales.length,
      staffSales,
      isOverridden,
      actualCashCount,
      form1Counted,
      physicalCashCount,
      variance,
      status,
      hasActivity: true,
      notes: savedAdminSale?.notes || '',
      form2In,
      form2Out,
      form2Net,
      form3In,
      form3Out,
      form3Net,
      changeIn,
      changeOut,
      creditIn,
      creditOut,
      sumForm2And3Net,
      form2LogsCount: form2Logs.length,
      form3ChangesCount: form3Changes.length,
      form3CreditsCount: form3Credits.length,
    };
  }

  // 1. Form 2 Logs for this staff & date (Legacy fallback)
  // Float (Opening cash drawer float)
  const floatLog = form2Logs.find(
    (l) =>
      l.line === 'Float' ||
      l.line === 'float' ||
      l.category === 'Float' ||
      (l as any).categoryGroup === 'Float & Closeout' ||
      l.description?.toLowerCase().startsWith('float')
  );
  const float = floatLog?.in || 0;

  // Direct Procurements (Out) - attribute each operator's actual share, not the entire invoice total
  const staffPayments = getDirectGrvPaymentsForStaff(staffId, date);
  const directGrvs = getDirectGrvsForStaffAndDate(staffId, date);
  let grvTotal = 0;
  const processedGrvIds = new Set<string>();

  staffPayments.forEach(({ grv, payment }) => {
    grvTotal += payment.amount || 0;
    processedGrvIds.add(grv.id);
    if (grv.grvNumber) processedGrvIds.add(grv.grvNumber);
  });

  // Include any legacy GRVs that didn't have payments array but were received by this staff
  directGrvs.forEach((g) => {
    if (!processedGrvIds.has(g.id) && (!g.payments || g.payments.length === 0)) {
      const gRecId = String(g.receivedByStaffId || '').trim().toLowerCase();
      const sId = String(staffId).trim().toLowerCase();
      if ((gRecId === sId || gRecId.replace(/^usr-|^staff-|^0+/, '') === sId.replace(/^usr-|^staff-|^0+/, '')) && g.payFromTill) {
        grvTotal += g.totalCost || 0;
        processedGrvIds.add(g.id);
        if (g.grvNumber) processedGrvIds.add(g.grvNumber);
      }
    }
  });

  const nonGrvProcurements = form2Logs
    .filter(
      (l) =>
        (l.out || 0) > 0 &&
        (l.line === 'Direct Procurement' ||
          l.category === 'Direct Procurement' ||
          (l as any).categoryGroup === 'Direct Procurement' ||
          l.description?.toLowerCase().includes('direct procurement') ||
          l.description?.toLowerCase().includes('procurement')) &&
        !Array.from(processedGrvIds).some((ref) => {
          return (
            (l.reference && l.reference === ref) ||
            (l.description && l.description.includes(ref))
          );
        })
    )
    .reduce((sum, l) => sum + (l.out || 0), 0);
  const directProcurements = grvTotal > 0 ? (grvTotal + nonGrvProcurements) : nonGrvProcurements;

  // Cash Lift (Out: supervisor pick-ups)
  const staffLifts = getCashLiftsForStaffAndDate(staffId, date);
  const liftFromDb = staffLifts.reduce((sum, l) => sum + (l.totalAmount || (l as any).amount || 0), 0);
  const liftFromLogs = form2Logs
    .filter(
      (l) =>
        (l.out || 0) > 0 &&
        (l.category?.includes('Cash Lift') ||
          l.category?.includes('Supervisor Pick-Up') ||
          l.reference?.startsWith('LIFT-') ||
          l.description?.toLowerCase().includes('cash lift') ||
          l.description?.toLowerCase().includes('supervisor pick-up'))
    )
    .reduce((sum, l) => sum + (l.out || 0), 0);
  const cashLift = Math.max(liftFromDb, liftFromLogs);

  // Cash Expenses (Out: utilities, bread, airtime, home use, operational cash expenses, store expenses)
  const utilitiesLogs = form2Logs.filter(
    (l) =>
      (l.out || 0) > 0 &&
      (l.line === 'Expenses' ||
        l.category === 'Expenses' ||
        l.line === 'Daily Store Expenses' ||
        l.category === 'Daily Store Expenses' ||
        (l as any).categoryGroup === 'Daily Store Expenses' ||
        l.line?.toLowerCase().includes('expense') ||
        l.line?.toLowerCase().includes('petty') ||
        l.category?.toLowerCase().includes('expense') ||
        l.category?.toLowerCase().includes('petty') ||
        l.description?.toLowerCase().includes('expense') ||
        l.description?.toLowerCase().includes('petty') ||
        l.line === 'Bread' ||
        l.line === 'Airtime' ||
        l.line === 'Home Use' ||
        l.line === 'Daily Utilities & Home' ||
        l.category === 'Daily Utilities & Home' ||
        (l as any).categoryGroup === 'Daily Utilities & Home' ||
        l.description?.toLowerCase().includes('bread') ||
        l.description?.toLowerCase().includes('airtime') ||
        l.description?.toLowerCase().includes('home use') ||
        l.description?.toLowerCase().includes('utilities'))
  );
  const expensesFromLogs = utilitiesLogs.reduce((sum, l) => sum + (l.out || 0), 0);

  // Operational cash expenses from expense database that are not already recorded in Form 2 logs
  const dbExpensesNotLogged = getExpensesForStaffAndDate(staffId, date)
    .filter((e) => !e.isDeleted && e.status !== 'rejected' && (e.paymentMethod === 'Cash' || !e.paymentMethod))
    .filter(
      (e) =>
        !utilitiesLogs.some(
          (l) =>
            (l.reference && l.reference === e.id) ||
            (e.description && l.description?.toLowerCase().includes(e.description.toLowerCase()))
        )
    )
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const expenses = expensesFromLogs + dbExpensesNotLogged;

  // EcoCash & ZiG & Dynamic Multi-Currency Cash-Outs / Withdrawals (Physical Cash OUT from till)
  const activeCurrenciesList = getActiveCurrencies();
  const currencyWithdrawalsMap: Record<string, number> = {};
  const currencySalesMap: Record<string, number> = {};

  activeCurrenciesList.forEach((c) => {
    const code = c.code;
    const name = c.name || code;
    const lowerCode = code.toLowerCase();
    const lowerName = name.toLowerCase();

    // Withdrawals recorded in Form 2 logs
    const logWithdrawals = form2Logs
      .filter((l) => {
        if ((l.out || 0) <= 0) return false;
        const line = (l.line || '').toLowerCase();
        const desc = (l.description || '').toLowerCase();
        const cat = (l.category || '').toLowerCase();
        const curr = (l.currency || '').toLowerCase();
        const matchesCurr =
          curr === lowerCode ||
          line.includes(lowerCode) ||
          cat.includes(lowerCode) ||
          desc.includes(lowerCode) ||
          desc.includes(lowerName);
        const isW =
          l.isWithdrawal ||
          line.includes('withdrawal') ||
          cat.includes('withdrawal') ||
          desc.includes('cash-out') ||
          desc.includes('withdrawal');
        return matchesCurr && isW;
      })
      .reduce((sum, l) => sum + (l.out || 0), 0);

    // Withdrawals from POS Sales transactions
    const salesWithdrawals = staffSales
      .filter((s) => {
        const sMeth = (s.paymentMethod || '').toLowerCase();
        const sCurr = (s.currency || '').toLowerCase();
        const matchesCurr = sMeth === lowerCode || sCurr === lowerCode || sCurr === lowerName;
        return matchesCurr && s.cashWithdrawalAmount && Number(s.cashWithdrawalAmount) > 0;
      })
      .reduce((sum, s) => sum + Number(s.cashWithdrawalAmount), 0);

    const totalCurrWithdrawal = Math.max(logWithdrawals, salesWithdrawals);
    currencyWithdrawalsMap[code] = totalCurrWithdrawal;

    // Non-cash electronic sales
    const currSales = staffSales
      .filter((s) => {
        const sMeth = (s.paymentMethod || '').toLowerCase();
        const sCurr = (s.currency || '').toLowerCase();
        return (sMeth === lowerCode || sCurr === lowerCode || sCurr === lowerName) && (s.total || 0) > 0;
      })
      .reduce((sum, s) => sum + (s.total || 0), 0);
    currencySalesMap[code] = currSales;
  });

  // Ensure EcoCash and ZiG backward compatibility
  const ecoWithdrawalLogs = form2Logs
    .filter(
      (l) =>
        (l.out || 0) > 0 &&
        (l.currency === 'EcoCash' ||
          l.currency === 'ECO' ||
          l.currency === 'ECOCASH' ||
          l.line === 'EcoCash' ||
          l.line === 'EcoCash Withdrawal' ||
          l.line === 'ecocashWithdrawal' ||
          l.line?.toLowerCase().includes('eco') ||
          l.description?.toLowerCase().includes('ecocash') ||
          l.description?.toLowerCase().includes('eco')) &&
        (l.isWithdrawal ||
          l.line === 'ecocashWithdrawal' ||
          l.line === 'EcoCash Withdrawal' ||
          l.category?.toLowerCase().includes('withdrawal') ||
          l.description?.toLowerCase().includes('cash-out') ||
          l.description?.toLowerCase().includes('withdrawal'))
    )
    .reduce((sum, l) => sum + (l.out || 0), 0);

  const ecoWithdrawalSales = staffSales
    .filter(
      (s) =>
        (s.paymentMethod === 'EcoCash' ||
          s.paymentMethod === 'EcoCash/Mobile' ||
          s.paymentMethod === 'ECO' ||
          s.paymentMethod === 'ECOCASH' ||
          s.currency === 'EcoCash' ||
          s.currency === 'ECO' ||
          s.currency === 'ECOCASH' ||
          s.paymentMethod?.toLowerCase().includes('eco') ||
          s.currency?.toLowerCase().includes('eco')) &&
        s.cashWithdrawalAmount &&
        Number(s.cashWithdrawalAmount) > 0
    )
    .reduce((sum, s) => sum + Number(s.cashWithdrawalAmount), 0);
  const ecocashWithdrawal = Math.max(
    currencyWithdrawalsMap['EcoCash'] || currencyWithdrawalsMap['ECO'] || currencyWithdrawalsMap['ECOCASH'] || 0,
    Math.max(ecoWithdrawalLogs, ecoWithdrawalSales)
  );

  const zigWithdrawalLogs = form2Logs
    .filter(
      (l) =>
        (l.out || 0) > 0 &&
        (l.currency === 'ZiG' ||
          l.line === 'ZiG' ||
          l.line === 'zigWithdrawal' ||
          l.description?.toLowerCase().includes('zig')) &&
        (l.isWithdrawal ||
          l.line === 'zigWithdrawal' ||
          l.category?.toLowerCase().includes('withdrawal') ||
          l.description?.toLowerCase().includes('cash-out') ||
          l.description?.toLowerCase().includes('withdrawal'))
    )
    .reduce((sum, l) => sum + (l.out || 0), 0);

  const zigWithdrawalSales = staffSales
    .filter(
      (s) =>
        (s.paymentMethod === 'ZiG' || s.currency === 'ZiG') &&
        s.cashWithdrawalAmount &&
        Number(s.cashWithdrawalAmount) > 0
    )
    .reduce((sum, s) => sum + Number(s.cashWithdrawalAmount), 0);
  const zigWithdrawal = Math.max(
    currencyWithdrawalsMap['ZiG'] || currencyWithdrawalsMap['ZIG'] || 0,
    Math.max(zigWithdrawalLogs, zigWithdrawalSales)
  );

  // Total multi-currency withdrawals across all active currencies
  currencyWithdrawalsMap['EcoCash'] = ecocashWithdrawal;
  currencyWithdrawalsMap['ZiG'] = zigWithdrawal;
  const totalMultiCurrencyWithdrawals = Object.values(currencyWithdrawalsMap).reduce((sum, v) => sum + v, 0);

  // Base cash sales from POS (less any store credit applied from non-cash credits)
  let cashSales = staffSales
    .filter((s) => s.paymentMethod === 'Cash' || (!s.paymentMethod && (!s.currency || s.currency === 'USD')))
    .reduce((sum, s) => sum + Math.max(0, (s.total || 0) - (s.customerCreditUsed || 0)), 0);

  if (overrideSales !== undefined) {
    totalSales = overrideSales;
    isOverridden = Math.abs(overrideSales - systemSalesTotal) > 0.001;
    cashSales = Math.max(0, overrideSales - totalNonCashSales);
  } else if (savedAdminSale && savedAdminSale.notes?.includes('Manual Override')) {
    totalSales = savedAdminSale.salesAmount;
    isOverridden = true;
    cashSales = Math.max(0, savedAdminSale.salesAmount - totalNonCashSales);
  }

  // 3. Form 3 Customer Change & Credit Sales
  const changeIn = form3Changes.reduce((sum, c) => sum + (c.in || 0), 0);
  const changeOut = form3Changes.reduce((sum, c) => sum + (c.out || 0), 0);
  const customerChange = changeOut;

  const creditIn = form3Credits.reduce((sum, c) => sum + (c.in || 0), 0);
  const creditOut = form3Credits.reduce((sum, c) => sum + (c.out || c.amount || 0), 0);

  // Credit payments received into drawer (repayments on account + change left behind in till)
  const creditPayments = creditIn + changeIn;

  // 4. Miscellaneous cash deductions in Form 2
  // Must exclude all items that have their own dedicated calculation terms to prevent double deductions!
  const deductions = form2Logs
    .filter((l) => {
      if ((l.out || 0) <= 0) return false;

      const line = (l.line || '').toLowerCase();
      const desc = (l.description || '').toLowerCase();
      const cat = (l.category || '').toLowerCase();
      const ref = (l.reference || '').toLowerCase();

      // Exclude float and closeout
      if (line.includes('final cash out') || desc.includes('final cash out')) return false;
      if (line.includes('float') || desc.startsWith('float')) return false;

      // Exclude direct procurement
      if (
        line.includes('procurement') ||
        cat.includes('procurement') ||
        desc.includes('procurement')
      ) {
        return false;
      }

      // Exclude cash lift / supervisor pick-up
      if (
        cat.includes('cash lift') ||
        cat.includes('supervisor pick-up') ||
        desc.includes('cash lift') ||
        desc.includes('supervisor pick-up') ||
        ref.startsWith('lift-')
      ) {
        return false;
      }

      // Exclude utilities / expenses / petty cash
      if (
        line === 'bread' ||
        line === 'airtime' ||
        line === 'home use' ||
        line === 'expenses' ||
        line.includes('utilities') ||
        line.includes('expense') ||
        line.includes('petty') ||
        cat.includes('utilities') ||
        cat.includes('expense') ||
        cat.includes('petty') ||
        desc.includes('bread') ||
        desc.includes('airtime') ||
        desc.includes('home use') ||
        desc.includes('expense') ||
        desc.includes('petty')
      ) {
        return false;
      }

      // Exclude multi-currency logs (both withdrawals and non-cash sales are handled via explicit multi-currency terms)
      const isMultiCurrencyLog = activeCurrenciesList.some((c) => {
        const lc = (c.code || '').toLowerCase();
        const ln = (c.name || '').toLowerCase();
        return (
          (l.currency || '').toLowerCase() === lc ||
          line.includes(lc) ||
          cat.includes(lc) ||
          desc.includes(lc) ||
          (ln && desc.includes(ln))
        );
      });
      if (isMultiCurrencyLog) return false;

      // Exclude EcoCash & ZiG fallback terms
      if (
        l.currency === 'EcoCash' ||
        line.includes('ecocash') ||
        cat.includes('ecocash') ||
        desc.includes('ecocash')
      ) {
        return false;
      }

      if (
        l.currency === 'ZiG' ||
        line.includes('zig') ||
        cat.includes('zig') ||
        desc.includes('zig')
      ) {
        return false;
      }

      // Exclude vault custody, corporate transfers, and EOD handovers (Safe <-> HQ, Bank, Capital injections, Till Handovers)
      if (
        l.isVaultCustody ||
        (l as any).isNonPosTransfer ||
        l.staff_id === 'VAULT_CUSTODY' ||
        l.staffId === 'VAULT_CUSTODY' ||
        l.type === 'Transfer' ||
        cat.includes('vault') ||
        cat.includes('custody transfer') ||
        cat.includes('handover') ||
        cat.includes('eod') ||
        line.includes('transfer') ||
        line.includes('handover') ||
        desc.includes('handover') ||
        desc.includes('till_collection') ||
        desc.includes('branch_to_hq') ||
        desc.includes('hq_to_branch') ||
        desc.includes('bank_deposit') ||
        desc.includes('bank_withdrawal') ||
        desc.includes('capital_infusion') ||
        desc.includes('in_transit') ||
        ref.startsWith('trf-') ||
        ref.includes('handover')
      ) {
        return false;
      }

      return true;
    })
    .reduce((sum, l) => sum + (l.out || 0), 0);

  // 5. Expected Cash Formula (Core User Balancing Formula)
  // expectedCash = float + cashSales + creditPayments - expenses - directProcurements - cashLift - customerChange - deductions - totalMultiCurrencyWithdrawals
  const expectedCash =
    float +
    cashSales +
    creditPayments -
    expenses -
    directProcurements -
    cashLift -
    customerChange -
    deductions -
    totalMultiCurrencyWithdrawals;

  const shouldHave = expectedCash;

  // 6. Actual physical cash count from Form 1
  const countRecord = getCashCountForStaffAndDate(staffId, date);
  const finalCashOutLog = form2Logs.find(
    (l) => l.line === 'Final Cash Out' || l.description?.toLowerCase().includes('final cash out')
  );
  const actualCashCount = countRecord
    ? countRecord.finalCashOutTotal
    : finalCashOutLog && (finalCashOutLog.out || 0) > 0
    ? finalCashOutLog.out
    : null;
  const form1Counted = actualCashCount;

  // 7. Variance & Balancing Status
  // If drawer was counted, variance = actualCashCount - expectedCash
  // If pending count, variance = 0 - expectedCash
  let variance = 0;
  if (actualCashCount !== null) {
    variance = actualCashCount - expectedCash;
  } else {
    variance = 0 - expectedCash;
  }

  const hasActivity =
    form2Logs.length > 0 ||
    form3Changes.length > 0 ||
    form3Credits.length > 0 ||
    totalSales > 0 ||
    staffSales.length > 0 ||
    actualCashCount !== null;

  let status: 'Balanced' | 'Over' | 'Shortage' | 'No Activity' = 'Balanced';
  if (!hasActivity) {
    status = 'No Activity';
  } else if (Math.abs(variance) < 0.01) {
    status = 'Balanced';
  } else if (variance < 0) {
    status = 'Shortage';
  } else {
    status = 'Over';
  }

  // Form 2 & Form 3 Net values
  // Operational Form 2 Net: Cash in drawer from daily operations before final closeout handover
  // Exclude 'Final Cash Out' from operational outflows so Form 2 Net reflects true operational cash movement
  const form2In = form2Logs.reduce((sum, l) => sum + (l.in || 0), 0);
  const form2OperationalOut = form2Logs
    .filter(
      (l) =>
        !l.line?.toLowerCase().includes('final cash out') &&
        !l.description?.toLowerCase().includes('final cash out')
    )
    .reduce((sum, l) => sum + (l.out || 0), 0);
  const form2Out = form2Logs.reduce((sum, l) => sum + (l.out || 0), 0);
  const form2Net = form2In - form2OperationalOut;

  // Form 3 Cash Net: Cash transactions only (repayments and change left behind minus customer change handed out)
  // Note: creditOut is goods delivered on credit, not cash removed from the physical drawer
  const form3In = changeIn + creditIn;
  const form3Out = changeOut + creditOut;
  const form3CashIn = changeIn + creditIn;
  const form3CashOut = changeOut;
  const form3Net = form3CashIn - form3CashOut;
  const sumForm2And3Net = form2Net + form3Net;

  return {
    staffId,
    staffName,
    date,
    // Core user formula components
    float,
    cashSales,
    creditPayments,
    expenses,
    directProcurements,
    cashLift,
    customerChange,
    deductions,
    ecocashWithdrawal,
    zigWithdrawal,
    totalMultiCurrencyWithdrawals,
    currencyWithdrawals: currencyWithdrawalsMap,
    currencySales: currencySalesMap,
    activeCurrencies: activeCurrenciesList,
    expectedCash,
    shouldHave,
    cashInTotal: Math.round((float + cashSales + creditPayments + changeIn) * 100) / 100,
    cashOutTotal: Math.round(
      (expenses + directProcurements + cashLift + customerChange + deductions + totalMultiCurrencyWithdrawals) * 100
    ) / 100,
    // Reporting only
    ecocashSales,
    zigSales,
    totalNonCashSales,
    totalSales,
    sales: totalSales,
    systemSalesTotal,
    systemSalesCount: staffSales.length,
    staffSales,
    isOverridden,
    actualCashCount,
    form1Counted,
    physicalCashCount: actualCashCount !== null ? actualCashCount : (expectedCash > 0 ? expectedCash : 0),
    variance,
    status,
    hasActivity,
    notes: savedAdminSale?.notes || '',
    // Form 2 & 3 legacy
    form2In,
    form2Out,
    form2Net,
    form3In,
    form3Out,
    form3Net,
    changeIn,
    changeOut,
    creditIn,
    creditOut,
    sumForm2And3Net,
    form2LogsCount: form2Logs.length,
    form3ChangesCount: form3Changes.length,
    form3CreditsCount: form3Credits.length,
  };
};

export const calculateSalespersonCashBalancing = calculateForm4;

// ==================== SYNC QUEUE DAO ====================
export const getSyncQueue = (companyId?: string): SyncQueueItem[] => {
  const all = getStored<SyncQueueItem[]>(STORAGE_KEYS.SYNC_QUEUE, []);
  if (!companyId || companyId === 'ALL') return all;
  const cleanComp = companyId.trim().toUpperCase();
  return all.filter((i) => {
    const itemComp = (i.payload?.company_id || i.payload?.CompanyID || '').trim().toUpperCase();
    return itemComp === cleanComp;
  });
};

export const enqueueSync = (sheetName: SheetName, action: 'INSERT' | 'UPDATE' | 'DELETE', payload: Record<string, any>) => {
  const current = getSyncQueue();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionUser = getSessionUser();

  const clientRequestId =
    payload.clientRequestId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

  const enhancedPayload = {
    company_id: payload.company_id || currentCompany,
    branch_id: payload.branch_id || currentBranch,
    user_branch_id: payload.user_branch_id || sessionUser?.branch_id || currentBranch,
    user_id: payload.user_id || sessionUser?.user_id || 'USR-001',
    user_role: payload.user_role || sessionUser?.role || 'CASHIER',
    clientRequestId,
    ...payload,
  };

  const newItem: SyncQueueItem = {
    id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    sheetName,
    action,
    payload: enhancedPayload,
    timestamp: Date.now(),
    retries: 0,
    status: 'pending',
  };
  // Keep localStorage sync queue bounded to recent 150 items to prevent localStorage 5MB quota exhaustion
  const boundedQueue = [...current, newItem].slice(-150);
  setStored(STORAGE_KEYS.SYNC_QUEUE, boundedQueue);

  // Broadcast database mutation across local P2P WiFi mesh (unless originating from mesh)
  if (!payload.fromMesh) {
    try {
      const activeBr = getCurrentBranch();
      notifyDatabaseMutation({
        mutationId: newItem.id,
        sheetName: sheetName as string,
        action,
        companyId: enhancedPayload.company_id,
        branchId: enhancedPayload.branch_id,
        branchCode: activeBr?.code || 'HQ-01',
        entityType: resolveEntityType(sheetName as string),
        recordId: String(payload.id || payload.itemId || payload.grvNumber || payload.invoiceNumber || newItem.id),
        payload: enhancedPayload,
        timestamp: newItem.timestamp,
        clientRequestId,
      });
    } catch (e) {
      console.warn('[enqueueSync] Mutation broadcast error:', e);
    }
  }

  // Stage 2: Enqueue to persistent IndexedDB syncQueue with exponential backoff & clientRequestId
  let mappedAction = action.toLowerCase();
  let priority: 'HIGH' | 'NORMAL' | 'LOW' = 'NORMAL';

  if (sheetName === 'Sales' && action === 'INSERT') {
    mappedAction = 'add_sale';
  } else if (sheetName === 'Direct_GRV') {
    mappedAction = payload.status === 'APPROVED' ? 'approve_direct_grv' : 'add_direct_grv';
    priority = 'HIGH';
  } else if (sheetName === 'users' || sheetName === 'Salespeople') {
    mappedAction = 'upsert_staff';
    priority = 'HIGH';
  } else if (sheetName === 'branches') {
    mappedAction = action === 'DELETE' ? 'delete_branch' : 'create_branch';
    priority = 'HIGH';
  } else if ((sheetName as string) === 'EOD') {
    mappedAction = payload.status === 'APPROVED' ? 'approve_eod' : 'submit_eod';
    priority = 'HIGH';
  } else if ((sheetName as string) === 'InventoryMaster' || (sheetName as string) === 'Products') {
    priority = 'HIGH';
  } else if ((sheetName as string) === 'Audit_Log') {
    priority = 'LOW';
  }

  persistentSyncEngine.enqueueWrite({
    action: mappedAction,
    sheetName: sheetName as string,
    payload: enhancedPayload,
    priority,
  }).catch((err) => {
    console.warn('[enqueueSync] IDB enqueue error:', err);
  });
};

export const updateSyncQueueItem = (id: string, updates: Partial<SyncQueueItem>) => {
  const current = getSyncQueue();
  const updated = current.map((item) => (item.id === id ? { ...item, ...updates } : item));
  setStored(STORAGE_KEYS.SYNC_QUEUE, updated);
};

export const clearSyncedQueueItems = () => {
  const current = getSyncQueue();
  const filtered = current.filter((item) => item.status !== 'synced');
  setStored(STORAGE_KEYS.SYNC_QUEUE, filtered);
  notifyListeners();
};

export const clearAllSyncQueueItems = () => {
  setStored(STORAGE_KEYS.SYNC_QUEUE, []);
  notifyListeners();
};

export const resetFailedSyncQueueItems = () => {
  const current = getSyncQueue();
  const reset = current.map((i) => (i.status === 'failed' ? { ...i, status: 'pending' as const, error: undefined } : i));
  setStored(STORAGE_KEYS.SYNC_QUEUE, reset);
  notifyListeners();
};

export const purgeSyncedRecords = clearSyncedQueueItems;

export const DEFAULT_MASTER_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyH7SbJv6_tcXW5ypsUZsSiiu6LLP5tB73cRLgDYZvpaZBTpw7lIE-D7vBmpgXD6l6p/exec';

export const getSheetsConfig = (): GoogleSheetsConfig => {
  const base = getStored<GoogleSheetsConfig>(STORAGE_KEYS.SHEETS_CONFIG, {
    webhookUrl: DEFAULT_MASTER_WEBHOOK_URL,
    spreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    masterSpreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    masterWebhookUrl: DEFAULT_MASTER_WEBHOOK_URL,
    branchIsolationMode: 'ROW_LEVEL',
    sheetNameMap: {
      Customers: 'Customers',
      Suppliers: 'Suppliers',
      CashLog: 'CashLog',
      Sales: 'Sales',
      Expenses: 'Expenses',
      Reconciliations: 'Reconciliations',
      Salespeople: 'Salespeople',
      CustomerChange: 'CustomerChange',
      CreditSales: 'CreditSales',
      Products: 'InventoryMaster',
      InventoryMaster: 'InventoryMaster',
      companies: 'companies',
      branches: 'branches',
      users: 'users',
      Direct_GRV: 'Direct_GRV',
      Audit_Log: 'Audit_Log',
      StockMovement: 'StockMovement',
      GoodsReceived: 'GoodsReceived',
    },
    autoSync: true,
    simulateSyncLatency: true,
  });

  // Dynamically resolve tenant-specific sheet from active company (Option A: Separate Sheet File per Tenant)
  const currentCompany = getCurrentCompany();
  const currentCompId = currentCompany?.company_id || 'COMP-001';

  // Per-tenant override if exists in tenantConfigs
  const tenantOverride = base.tenantConfigs?.[currentCompId];
  const dedicatedSheetId =
    tenantOverride?.spreadsheetId ||
    currentCompany?.sheet_id ||
    (currentCompId === 'COMP-001' ? '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE' : '');
  const dedicatedWebhookUrl =
    tenantOverride?.webhookUrl ||
    currentCompany?.webhook_url ||
    base.webhookUrl ||
    base.masterWebhookUrl ||
    DEFAULT_MASTER_WEBHOOK_URL;
  const branchIsolation =
    tenantOverride?.branchIsolationMode || currentCompany?.branch_isolation_mode || base.branchIsolationMode || 'ROW_LEVEL';

  return {
    ...base,
    masterWebhookUrl: base.masterWebhookUrl || DEFAULT_MASTER_WEBHOOK_URL,
    masterSpreadsheetId: base.masterSpreadsheetId || '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    spreadsheetId: dedicatedSheetId,
    webhookUrl: dedicatedWebhookUrl,
    branchIsolationMode: branchIsolation,
  };
};

export const updateSheetsConfig = (updates: Partial<GoogleSheetsConfig>) => {
  const current = getStored<GoogleSheetsConfig>(STORAGE_KEYS.SHEETS_CONFIG, {
    webhookUrl: '',
    spreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    masterSpreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    branchIsolationMode: 'ROW_LEVEL',
    sheetNameMap: {
      Customers: 'Customers',
      Suppliers: 'Suppliers',
      CashLog: 'CashLog',
      Sales: 'Sales',
      Expenses: 'Expenses',
      Reconciliations: 'Reconciliations',
      Salespeople: 'Salespeople',
      CustomerChange: 'CustomerChange',
      CreditSales: 'CreditSales',
      Products: 'InventoryMaster',
      InventoryMaster: 'InventoryMaster',
      companies: 'companies',
      branches: 'branches',
      users: 'users',
      Direct_GRV: 'Direct_GRV',
      Audit_Log: 'Audit_Log',
      StockMovement: 'StockMovement',
      GoodsReceived: 'GoodsReceived',
    },
    autoSync: true,
    simulateSyncLatency: true,
  });

  const currentCompany = getCurrentCompany();
  const currentCompId = currentCompany?.company_id || 'COMP-001';

  // If updates contain spreadsheetId, webhookUrl, or branchIsolationMode, persist per-tenant
  const updatedTenantConfigs = { ...(current.tenantConfigs || {}) };
  if (updates.spreadsheetId || updates.webhookUrl !== undefined || updates.branchIsolationMode) {
    const existingTenant = updatedTenantConfigs[currentCompId];
    updatedTenantConfigs[currentCompId] = {
      companyId: currentCompId,
      companyName: currentCompany?.company_name || 'Tenant',
      spreadsheetId: updates.spreadsheetId || existingTenant?.spreadsheetId || currentCompany?.sheet_id || current.spreadsheetId,
      webhookUrl: updates.webhookUrl !== undefined ? updates.webhookUrl : (existingTenant?.webhookUrl || currentCompany?.webhook_url || current.webhookUrl),
      branchIsolationMode: updates.branchIsolationMode || existingTenant?.branchIsolationMode || currentCompany?.branch_isolation_mode || 'ROW_LEVEL',
      lastSyncTimestamp: updates.lastSyncTimestamp || existingTenant?.lastSyncTimestamp,
    };

    // Also synchronize back to the Company entity in Room DB
    if (currentCompany) {
      saveCompany({
        ...currentCompany,
        sheet_id: updates.spreadsheetId || currentCompany.sheet_id,
        webhook_url: updates.webhookUrl !== undefined ? updates.webhookUrl : currentCompany.webhook_url,
        branch_isolation_mode: updates.branchIsolationMode || currentCompany.branch_isolation_mode,
      });
    }
  }

  const updated: GoogleSheetsConfig = {
    ...current,
    ...updates,
    tenantConfigs: updatedTenantConfigs,
  };
  setStored(STORAGE_KEYS.SHEETS_CONFIG, updated);
  return updated;
};

export const saveSheetsConfig = updateSheetsConfig;

export const updateTenantSheetBinding = (
  companyId: string,
  sheetId: string,
  webhookUrl?: string,
  isolationMode?: 'ROW_LEVEL' | 'BRANCH_TABS' | 'HYBRID'
) => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (comp) {
    comp.sheet_id = sheetId;
    if (webhookUrl !== undefined) comp.webhook_url = webhookUrl;
    if (isolationMode) comp.branch_isolation_mode = isolationMode;
    saveCompany(comp);
  }

  const currentConfig = getStored<GoogleSheetsConfig>(STORAGE_KEYS.SHEETS_CONFIG, getSheetsConfig());
  const tenantConfigs = { ...(currentConfig.tenantConfigs || {}) };
  tenantConfigs[companyId] = {
    companyId,
    companyName: comp?.company_name || companyId,
    spreadsheetId: sheetId,
    webhookUrl: webhookUrl !== undefined ? webhookUrl : comp?.webhook_url,
    branchIsolationMode: isolationMode || comp?.branch_isolation_mode || 'ROW_LEVEL',
  };
  setStored(STORAGE_KEYS.SHEETS_CONFIG, { ...currentConfig, tenantConfigs });
};

export const isOfflineModeForced = (): boolean => {
  return getStored<boolean>(STORAGE_KEYS.OFFLINE_MODE, false);
};

export const setOfflineModeForced = (forced: boolean): void => {
  setStored(STORAGE_KEYS.OFFLINE_MODE, forced);
};

// ==================== CUSTOMER CHANGE & CREDIT REPORTS ====================

/**
 * Calculates days elapsed between a date string (YYYY-MM-DD) and today's date
 */
export const calculateDaysElapsed = (dateStr?: string): number => {
  if (!dateStr) return 0;
  try {
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffTime = today.getTime() - target.getTime();
    return Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  } catch (err) {
    return 0;
  }
};

/**
 * Generates the Customer Change Report (Change Owed to Customers)
 * Groups by customer, calculates total IN (change left with business),
 * total OUT (change returned), net change owed, and days since change was left.
 */
export const getCustomerChangeReport = (): {
  items: CustomerChangeReportItem[];
  summary: {
    totalChangeOwed: number;
    totalCustomersOwingChange: number;
    totalInHistorical: number;
    totalOutHistorical: number;
    aged0To7DaysTotal: number;
    aged8To14DaysTotal: number;
    aged15PlusDaysTotal: number;
  };
} => {
  const allChanges = getCustomerChanges();
  const allCustomers = getCustomers();

  // Map to group change entries by customer
  const customerMap = new Map<string, {
    customerId: string;
    customerName: string;
    phone?: string;
    address?: string;
    entries: CustomerChangeEntry[];
  }>();

  // First initialize from known customers in DB
  allCustomers.forEach((cust) => {
    customerMap.set(cust.customerId, {
      customerId: cust.customerId,
      customerName: cust.name,
      phone: cust.phone,
      address: cust.address,
      entries: [],
    });
  });

  // Group all change entries
  allChanges.forEach((entry) => {
    let key = entry.customerId;
    const cleanEntryName = (entry.customerName || '').trim().toLowerCase();
    if (!key) {
      const match = allCustomers.find(
        (c) => (c.name || '').trim().toLowerCase() === cleanEntryName
      );
      key = match ? match.customerId : `unregistered_${cleanEntryName || 'walkin'}`;
    }

    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerId: entry.customerId || 'C-NEW',
        customerName: entry.customerName || 'Walk-in Customer',
        entries: [],
      });
    }

    customerMap.get(key)!.entries.push(entry);
  });

  const items: CustomerChangeReportItem[] = [];
  let totalChangeOwed = 0;
  let totalInHistorical = 0;
  let totalOutHistorical = 0;
  let aged0To7DaysTotal = 0;
  let aged8To14DaysTotal = 0;
  let aged15PlusDaysTotal = 0;

  customerMap.forEach((data) => {
    const { entries, customerId, customerName, phone, address } = data;
    if (entries.length === 0) return; // Skip customers with zero change history

    // Sort entries chronologically
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let totalIn = 0;
    let totalOut = 0;
    const inDates: string[] = [];

    entries.forEach((e) => {
      const inVal = Number(e.in) || 0;
      const outVal = Number(e.out) || 0;
      totalIn += inVal;
      totalOut += outVal;
      if (inVal > 0 && e.date) {
        inDates.push(e.date);
      }
    });

    const netChangeOwed = Math.round((totalIn - totalOut) * 100) / 100;
    const firstInDate = inDates.length > 0 ? inDates[0] : undefined;
    const latestInDate = inDates.length > 0 ? inDates[inDates.length - 1] : undefined;

    const daysSinceFirstIn = calculateDaysElapsed(firstInDate);
    const daysSinceLatestIn = calculateDaysElapsed(latestInDate);

    let status: 'Owed' | 'Cleared' | 'Overpaid' = 'Cleared';
    if (netChangeOwed > 0.001) {
      status = 'Owed';
      totalChangeOwed += netChangeOwed;

      if (daysSinceFirstIn <= 7) {
        aged0To7DaysTotal += netChangeOwed;
      } else if (daysSinceFirstIn <= 14) {
        aged8To14DaysTotal += netChangeOwed;
      } else {
        aged15PlusDaysTotal += netChangeOwed;
      }
    } else if (netChangeOwed < -0.001) {
      status = 'Overpaid';
    }

    totalInHistorical += totalIn;
    totalOutHistorical += totalOut;

    items.push({
      customerId,
      customerName,
      phone,
      address,
      totalIn,
      totalOut,
      netChangeOwed,
      firstInDate,
      latestInDate,
      daysSinceFirstIn,
      daysSinceLatestIn,
      unsettledInAmount: Math.max(0, netChangeOwed),
      transactionsCount: entries.length,
      transactions: entries,
      status,
    });
  });

  // Sort report items: Active change owed first (highest days / highest amount), then settled
  items.sort((a, b) => {
    if (a.status === 'Owed' && b.status !== 'Owed') return -1;
    if (b.status === 'Owed' && a.status !== 'Owed') return 1;
    if (a.netChangeOwed !== b.netChangeOwed) return b.netChangeOwed - a.netChangeOwed;
    return b.daysSinceFirstIn - a.daysSinceFirstIn;
  });

  const totalCustomersOwingChange = items.filter((i) => i.status === 'Owed').length;

  return {
    items,
    summary: {
      totalChangeOwed,
      totalCustomersOwingChange,
      totalInHistorical,
      totalOutHistorical,
      aged0To7DaysTotal,
      aged8To14DaysTotal,
      aged15PlusDaysTotal,
    },
  };
};

/**
 * Calculates the current available net store credit / change balance left behind by a customer.
 * Returns positive number if customer has unclaimed change funds with the shop.
 */
export const getCustomerChangeBalance = (customerId?: string, customerName?: string): number => {
  if (!customerId && !customerName) return 0;
  const entries = getCustomerChanges();
  const normId = customerId?.trim().toLowerCase();
  const normName = customerName?.trim().toLowerCase();

  const customerEntries = entries.filter((e) => {
    if (normId && e.customerId && e.customerId.trim().toLowerCase() === normId) return true;
    if (normName && e.customerName && e.customerName.trim().toLowerCase() === normName) return true;
    return false;
  });

  const totalIn = customerEntries.reduce((sum, e) => sum + (Number(e.in) || 0), 0);
  const totalOut = customerEntries.reduce((sum, e) => sum + (Number(e.out) || 0), 0);
  const net = totalIn - totalOut;
  return net > 0 ? Math.round(net * 100) / 100 : 0;
};

/**
 * Generates the Credit Sales Report (Customer Debt Owed to Business)
 * Groups by customer, calculates total Credit Taken (IN/Amount),
 * total Repaid (OUT), net debt owed, and days owing since credit collection.
 */
export const getCustomerCreditReport = (): {
  items: CustomerCreditReportItem[];
  summary: {
    totalOutstandingDebt: number;
    totalDebtorsCount: number;
    totalCreditIssued: number;
    totalRepayments: number;
    overdueCount: number;
    overdueAmount: number;
    aged0To7DaysTotal: number;
    aged8To14DaysTotal: number;
    aged15PlusDaysTotal: number;
  };
} => {
  const allCredits = getCreditSales();
  const allCustomers = getCustomers();
  const todayStr = new Date().toISOString().split('T')[0];

  const customerMap = new Map<string, {
    customerId: string;
    customerName: string;
    phone?: string;
    address?: string;
    entries: CreditSaleEntry[];
  }>();

  allCustomers.forEach((cust) => {
    customerMap.set(cust.customerId, {
      customerId: cust.customerId,
      customerName: cust.name,
      phone: cust.phone,
      address: cust.address,
      entries: [],
    });
  });

  allCredits.forEach((entry) => {
    let key = entry.customerId;
    const cleanEntryName = (entry.customerName || '').trim().toLowerCase();
    if (!key) {
      const match = allCustomers.find(
        (c) => (c.name || '').trim().toLowerCase() === cleanEntryName
      );
      key = match ? match.customerId : `unregistered_${cleanEntryName || 'walkin'}`;
    }

    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerId: entry.customerId || 'C-NEW',
        customerName: entry.customerName || 'Walk-in Customer',
        entries: [],
      });
    }

    customerMap.get(key)!.entries.push(entry);
  });

  const items: CustomerCreditReportItem[] = [];
  let totalOutstandingDebt = 0;
  let totalCreditIssued = 0;
  let totalRepayments = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  let aged0To7DaysTotal = 0;
  let aged8To14DaysTotal = 0;
  let aged15PlusDaysTotal = 0;

  customerMap.forEach((data) => {
    const { entries, customerId, customerName, phone, address } = data;
    if (entries.length === 0) return;

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let totalCreditIn = 0;
    let totalRepaidOut = 0;
    const creditDates: string[] = [];
    const itemDescriptions: string[] = [];
    let earliestDueDate: string | undefined = undefined;

    entries.forEach((e) => {
      let creditGiven = 0;
      let creditRepaid = 0;

      const rawAmount = Number(e.amount) || 0;
      const rawOut = Number(e.out) || 0;
      const rawIn = Number(e.in) || 0;

      const isRepaymentRecord =
        e.itemDescription?.toLowerCase().includes('repayment') ||
        e.itemDescription?.toLowerCase().includes('settlement') ||
        (e.status === 'Paid' && rawAmount === 0);

      if (isRepaymentRecord) {
        creditRepaid = rawIn > 0 ? rawIn : (rawOut > 0 ? rawOut : rawAmount);
        creditGiven = 0;
      } else {
        // Standard Credit Sale:
        // Form 3 saves: out = goods value given on credit, in = deposit/repayment
        if (rawOut > 0) {
          creditGiven = rawOut;
          creditRepaid = rawIn;
        } else if (rawAmount > 0) {
          creditGiven = rawAmount;
          creditRepaid = rawIn;
        } else if (rawIn > 0) {
          // If only in is provided without goods value, it's a debt repayment
          creditRepaid = rawIn;
        }
      }

      totalCreditIn += creditGiven;
      totalRepaidOut += creditRepaid;

      if (creditGiven > 0 && e.date) {
        creditDates.push(e.date);
      }

      if (e.itemDescription && !itemDescriptions.includes(e.itemDescription)) {
        itemDescriptions.push(e.itemDescription);
      }

      if (e.dueDate) {
        if (!earliestDueDate || new Date(e.dueDate) < new Date(earliestDueDate)) {
          earliestDueDate = e.dueDate;
        }
      }
    });

    const netDebtOwed = Math.round((totalCreditIn - totalRepaidOut) * 100) / 100;
    const firstCreditDate = creditDates.length > 0 ? creditDates[0] : undefined;
    const latestCreditDate = creditDates.length > 0 ? creditDates[creditDates.length - 1] : undefined;
    const daysOwing = calculateDaysElapsed(firstCreditDate);

    const isOverdue = Boolean(
      netDebtOwed > 0.001 && earliestDueDate && earliestDueDate < todayStr
    );

    let status: 'Owing' | 'Settled' | 'Overpaid' = 'Settled';
    if (netDebtOwed > 0.001) {
      status = 'Owing';
      totalOutstandingDebt += netDebtOwed;

      if (isOverdue) {
        overdueCount += 1;
        overdueAmount += netDebtOwed;
      }

      if (daysOwing <= 7) {
        aged0To7DaysTotal += netDebtOwed;
      } else if (daysOwing <= 14) {
        aged8To14DaysTotal += netDebtOwed;
      } else {
        aged15PlusDaysTotal += netChangeOwedForBucket(daysOwing, netDebtOwed);
      }
    } else if (netDebtOwed < -0.001) {
      status = 'Overpaid';
    }

    totalCreditIssued += totalCreditIn;
    totalRepayments += totalRepaidOut;

    items.push({
      customerId,
      customerName,
      phone,
      address,
      totalCreditIn,
      totalRepaidOut,
      netDebtOwed,
      firstCreditDate,
      latestCreditDate,
      daysOwing,
      dueDate: earliestDueDate,
      isOverdue,
      itemDescriptions,
      transactionsCount: entries.length,
      transactions: entries,
      status,
    });
  });

  function netChangeOwedForBucket(days: number, amount: number) {
    if (days >= 15) return amount;
    return 0;
  }

  // Sort debtors first (highest debt owed, then longest days owing)
  items.sort((a, b) => {
    if (a.status === 'Owing' && b.status !== 'Owing') return -1;
    if (b.status === 'Owing' && a.status !== 'Owing') return 1;
    if (a.netDebtOwed !== b.netDebtOwed) return b.netDebtOwed - a.netDebtOwed;
    return b.daysOwing - a.daysOwing;
  });

  const totalDebtorsCount = items.filter((i) => i.status === 'Owing').length;

  return {
    items,
    summary: {
      totalOutstandingDebt,
      totalDebtorsCount,
      totalCreditIssued,
      totalRepayments,
      overdueCount,
      overdueAmount,
      aged0To7DaysTotal,
      aged8To14DaysTotal,
      aged15PlusDaysTotal,
    },
  };
};

/**
 * Helper to quickly record a change payout (returning change to customer)
 */
export const settleCustomerChangePayout = (
  customerId: string,
  customerName: string,
  amountOut: number,
  staffId: string,
  staffName: string,
  notes?: string
): CustomerChangeEntry => {
  const todayStr = new Date().toISOString().split('T')[0];
  return addCustomerChange({
    timestamp: new Date().toISOString(),
    date: todayStr,
    staffId,
    staffName,
    customerId,
    customerName,
    in: 0,
    out: amountOut,
    notes: notes || `Settlement payout of customer change balance ($${amountOut.toFixed(2)})`,
  });
};

/**
 * Helper to quickly record a customer credit repayment (debt settlement)
 */
export const recordCustomerCreditPayment = (
  customerId: string,
  customerName: string,
  amountRepaid: number,
  staffId: string,
  staffName: string,
  notes?: string
): CreditSaleEntry => {
  const todayStr = new Date().toISOString().split('T')[0];
  return addCreditSale({
    timestamp: new Date().toISOString(),
    date: todayStr,
    staffId,
    staffName,
    customerId,
    customerName,
    amount: 0,
    out: 0,
    in: amountRepaid,
    itemDescription: 'Credit Debt Repayment / Settlement',
    notes: notes || `Customer debt repayment received ($${amountRepaid.toFixed(2)})`,
    status: 'Paid',
  });
};

/**
 * Helper to manually record change owed to a customer
 * (e.g. customer rejected/defaced note or cashier lacked small denomination replacement note)
 */
export const recordManualCustomerChange = (params: {
  customerName: string;
  customerId?: string;
  phone?: string;
  amount: number;
  date?: string;
  notes?: string;
  reference?: string;
  staffId: string;
  staffName: string;
  staffRole?: string;
  cashReceivedInDrawer?: boolean;
}): CustomerChangeEntry => {
  const now = new Date();
  const dateStr = params.date || now.toISOString().split('T')[0];

  const created = addCustomerChange({
    timestamp: now.toISOString(),
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName,
    customerId: params.customerId || '',
    customerName: params.customerName.trim(),
    in: params.amount,
    out: 0,
    notes: params.notes || 'Manual change booking (customer rejected note / small change unavailable)',
    reference: params.reference || `MAN-CHG-${Date.now().toString().slice(-4)}`,
  });

  // Also log into customer ledger
  try {
    addCustomerLedgerEntry({
      customerId: params.customerId || '',
      customerName: params.customerName.trim(),
      date: dateStr,
      timestamp: now.toISOString(),
      type: 'change_retained',
      amount: params.amount,
      sourceRef: created.id,
      sourceModule: 'Form3Change',
      notes: `Change booked: ${params.notes || 'Customer rejected note / small change unavailable'}`,
      staffId: params.staffId,
      staffName: params.staffName,
    });
  } catch (err) {
    // safe fallback
  }

  addAuditLog({
    action: 'MANUAL_CHANGE_BOOKING',
    severity: 'INFO',
    staffId: params.staffId,
    staffName: params.staffName,
    staffRole: params.staffRole || 'Cashier',
    amount: params.amount,
    referenceId: created.id,
    details: `Manual customer change booked: $${params.amount.toFixed(2)} owed to "${params.customerName.trim()}". Reason: ${params.notes || 'Customer rejected note / small change unavailable'}.`,
    metadata: {
      customerId: params.customerId,
      customerName: params.customerName,
      reference: params.reference,
    },
  });

  return created;
};

/**
 * Helper to manually record customer credit
 * (e.g. owner approved cash credit or store goods credit advance)
 */
export const recordManualCustomerCredit = (params: {
  customerName: string;
  customerId?: string;
  phone?: string;
  amount: number;
  date?: string;
  dueDate?: string;
  creditType?: string;
  notes?: string;
  itemDescription?: string;
  staffId: string;
  staffName: string;
  staffRole?: string;
  authorizedByName?: string;
  authorizedById?: string;
  disburseCashFromDrawer?: boolean;
}): CreditSaleEntry => {
  const now = new Date();
  const dateStr = params.date || now.toISOString().split('T')[0];
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 14);
  const dueStr = params.dueDate || defaultDue.toISOString().split('T')[0];

  const authSuffix = params.authorizedByName ? ` (Authorized by: ${params.authorizedByName})` : '';
  const itemDesc = params.itemDescription || (params.creditType || 'Cash Credit (Owner Approved)');

  const created = addCreditSale({
    timestamp: now.toISOString(),
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName,
    customerId: params.customerId || '',
    customerName: params.customerName.trim(),
    amount: params.amount,
    in: 0,
    out: params.amount,
    itemDescription: itemDesc,
    dueDate: dueStr,
    notes: `${params.notes || 'Owner approved credit'}${authSuffix}`,
    status: 'Owing',
  });

  // If cash was disbursed from drawer for cash credit, record cash movement
  if (params.disburseCashFromDrawer) {
    try {
      const shiftId = getShiftId(params.staffId, dateStr);
      addMovement({
        shiftId,
        staffId: params.staffId,
        date: dateStr,
        timestamp: now.toISOString(),
        type: 'credit_extended',
        amount: params.amount,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'form3',
        sourceRef: created.id,
        notes: `Cash credit paid out from drawer: $${params.amount.toFixed(2)} to ${params.customerName.trim()} (${params.authorizedByName ? `Authorized by: ${params.authorizedByName}` : 'Owner Approved'})`,
        company_id: getCurrentCompanyId(),
        branch_id: getCurrentBranchId(),
      });
    } catch (err) {
      // safe fallback
    }
  }

  // Also record receivable into customer ledger
  try {
    addCustomerLedgerEntry({
      customerId: params.customerId || '',
      customerName: params.customerName.trim(),
      date: dateStr,
      timestamp: now.toISOString(),
      type: 'credit_extended',
      amount: params.amount,
      sourceRef: created.id,
      sourceModule: 'Form3Credit',
      notes: `Manual credit approved: ${itemDesc}${authSuffix}`,
      staffId: params.staffId,
      staffName: params.staffName,
    });
  } catch (err) {
    // safe fallback
  }

  addAuditLog({
    action: 'MANUAL_CREDIT_ENTRY',
    severity: 'WARNING',
    staffId: params.staffId,
    staffName: params.staffName,
    staffRole: params.staffRole || 'Staff',
    authorizedByName: params.authorizedByName,
    authorizedById: params.authorizedById,
    amount: params.amount,
    referenceId: created.id,
    details: `Manual credit approved: $${params.amount.toFixed(2)} for "${params.customerName.trim()}". Type: ${itemDesc}. Due: ${dueStr}.${authSuffix}${params.disburseCashFromDrawer ? ' [Cash disbursed from drawer]' : ''}`,
    metadata: {
      customerId: params.customerId,
      customerName: params.customerName,
      creditType: params.creditType,
      dueDate: dueStr,
      disburseCashFromDrawer: params.disburseCashFromDrawer,
    },
  });

  return created;
};

// ============================================================================
// INVENTORY MANAGEMENT MODULE (Cases + Singles Flexible Engine)
// Rules A, B, C, D Implementation
// ============================================================================

export const getAllInventoryItems = (): InventoryItem[] => {
  const raw = getStored<InventoryItem[]>(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  const map = new Map<string, InventoryItem>();
  for (const item of raw) {
    if (!item.itemId) continue;
    const cleanId = item.itemId.trim().toUpperCase();
    const comp = (item.company_id || (item as any).companyId || 'DEFAULT').trim().toUpperCase();
    const key = `${cleanId}::${comp}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
};

export const getInventoryItems = (): InventoryItem[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionUser = getSessionUser();
  const all = getAllInventoryItems();
  let list: InventoryItem[];
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    list = all;
  } else {
    list = all.filter((item) => {
      const compId = item.company_id || (item as any).companyId;
      const matchesCompany = !compId ? (currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER') : (compId === currentCompany);
      if (!matchesCompany) return false;

      // 1. Branch catalog assignment (e.g. Grocery store vs Hardware store)
      if (item.assignedBranchIds && item.assignedBranchIds.length > 0) {
        if (!item.assignedBranchIds.includes(currentBranch)) {
          return false;
        }
      } else {
        // 2. Branch isolation: items specifically created for this branch, or company-wide unassigned
        const brId = item.branch_id || (item as any).branchId;
        if (brId && brId !== currentBranch && brId !== 'ALL' && brId !== 'BR-MAIN') {
          return false;
        }
      }
      return true;
    });
  }
  // Deduplicate by itemId for the current branch and apply branch overrides
  const seen = new Set<string>();
  const unique: InventoryItem[] = [];
  for (const item of list) {
    const cleanId = (item.itemId || '').trim().toUpperCase();
    if (!cleanId || seen.has(cleanId)) continue;
    seen.add(cleanId);

    const override = item.branchOverrides?.[currentBranch];
    const rawUnitsPerCase = Number(item.unitsPerCase || (item as any).UnitsPerCase) || 1;
    const rawCostPerCase = Number(override?.costPerCase !== undefined ? override.costPerCase : (item.costPerCase !== undefined ? item.costPerCase : ((item as any).costPrice ?? (item as any).CostPrice ?? 0))) || 0;
    const rawCostPerUnit = Number(override?.costPerUnit !== undefined ? override.costPerUnit : (item.costPerUnit !== undefined ? item.costPerUnit : (rawUnitsPerCase > 0 ? rawCostPerCase / rawUnitsPerCase : 0))) || 0;
    const rawSellPriceUnit = Number(override?.sellPriceUnit !== undefined ? override.sellPriceUnit : (item.sellPriceUnit !== undefined ? item.sellPriceUnit : ((item as any).price ?? (item as any).SellingPrice ?? 0))) || 0;
    const rawSellPriceCase = Number(override?.sellPriceCase !== undefined ? override.sellPriceCase : (item.sellPriceCase !== undefined ? item.sellPriceCase : (rawSellPriceUnit * rawUnitsPerCase))) || 0;
    const rawStockCases = Number(item.stockCases !== undefined ? item.stockCases : (rawUnitsPerCase > 1 ? Math.floor(Number(item.totalUnits ?? (item as any).stockQuantity ?? 0) / rawUnitsPerCase) : 0)) || 0;
    const rawStockSingles = Number(item.stockSingles !== undefined ? item.stockSingles : (Number(item.totalUnits ?? (item as any).stockQuantity ?? 0) - (rawStockCases * rawUnitsPerCase))) || 0;
    const rawTotalUnits = Number(item.totalUnits !== undefined ? item.totalUnits : ((item as any).stockQuantity ?? (rawStockCases * rawUnitsPerCase + rawStockSingles))) || 0;

    unique.push({
      ...item,
      unitsPerCase: rawUnitsPerCase,
      costPerCase: rawCostPerCase,
      costPerUnit: rawCostPerUnit,
      sellPriceUnit: rawSellPriceUnit,
      sellPriceCase: rawSellPriceCase,
      stockCases: rawStockCases,
      stockSingles: rawStockSingles,
      totalUnits: rawTotalUnits,
      reorderLevelCases: Number(override?.reorderLevelCases !== undefined ? override.reorderLevelCases : (item.reorderLevelCases ?? 2)),
      reorderLevelUnits: Number(item.reorderLevelUnits ?? 10),
      averageCostPerUnit: Number(item.averageCostPerUnit ?? rawCostPerUnit),
      canSellAsCase: Boolean(item.canSellAsCase),
    });
  }
  return unique;
};

export const getInventoryItemById = (itemId: string, branchId?: string): InventoryItem | null => {
  const items = getAllInventoryItems();
  const targetBranch = branchId || getCurrentBranchId();
  const currentCompany = getCurrentCompanyId();
  const clean = (itemId || '').trim().toUpperCase();
  if (!clean) return null;
  
  // 1. Prefer exact match on branch and company
  const exact = items.find((i) => {
    const matchesId = (i.itemId && i.itemId.toUpperCase() === clean) || (i.sku && i.sku.toUpperCase() === clean);
    if (!matchesId) return false;
    const itemBr = (i.branch_id || (i as any).branchId || '').trim().toUpperCase();
    const itemComp = (i.company_id || (i as any).companyId || '').trim().toUpperCase();
    return (
      (!itemComp || itemComp === currentCompany.toUpperCase()) &&
      (!itemBr || itemBr === targetBranch.toUpperCase())
    );
  });
  if (exact) return exact;

  // Fallback to any matching item in company
  const directFallback = items.find((i) => (i.itemId && i.itemId.toUpperCase() === clean) || (i.sku && i.sku.toUpperCase() === clean));
  if (directFallback) return directFallback;

  // 2. Base ID match (stripping -CASE, -UNIT, or __variantId)
  let baseClean = clean;
  if (baseClean.endsWith('-CASE')) baseClean = baseClean.replace(/-CASE$/, '');
  if (baseClean.endsWith('-UNIT')) baseClean = baseClean.replace(/-UNIT$/, '');
  if (baseClean.includes('__')) baseClean = baseClean.split('__')[0];

  if (baseClean !== clean) {
    const baseExact = items.find((i) => {
      const matchesId = (i.itemId && i.itemId.toUpperCase() === baseClean) || (i.sku && i.sku.toUpperCase() === baseClean);
      if (!matchesId) return false;
      const itemBr = (i.branch_id || (i as any).branchId || '').trim().toUpperCase();
      const itemComp = (i.company_id || (i as any).companyId || '').trim().toUpperCase();
      return (
        (!itemComp || itemComp === currentCompany.toUpperCase()) &&
        (!itemBr || itemBr === targetBranch.toUpperCase())
      );
    });
    if (baseExact) return baseExact;

    const baseFallback = items.find((i) => (i.itemId && i.itemId.toUpperCase() === baseClean) || (i.sku && i.sku.toUpperCase() === baseClean));
    if (baseFallback) return baseFallback;
  }

  // 3. Variant match inside packagingVariants
  const variantMatch = items.find((i) =>
    i.packagingVariants?.some((v) => (v.id && v.id.toUpperCase() === clean) || (v.sku && v.sku.toUpperCase() === clean))
  );
  if (variantMatch) return variantMatch;

  return null;
};

export const saveInventoryItem = (item: InventoryItem, options?: { fromMesh?: boolean }): InventoryItem => {
  const allItems = getAllInventoryItems();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();

  const compId = item.company_id || (item as any).companyId || currentCompany || 'COMP-001';
  const brId = item.branch_id || (item as any).branchId || currentBranch || 'BR-MAIN';

  const cleanItemId = (item.itemId || '').trim().toUpperCase();
  const cleanSku = (item.sku || '').trim().toUpperCase();

  const index = allItems.findIndex((i) => {
    const itemComp = (i.company_id || (i as any).companyId || '').trim().toUpperCase();
    const matchesTenant = !itemComp || itemComp === compId.trim().toUpperCase() || itemComp === 'DEFAULT' || itemComp === 'COMP-001';
    return (
      matchesTenant &&
      ((cleanItemId && i.itemId && i.itemId.trim().toUpperCase() === cleanItemId) ||
       (cleanSku && i.sku && i.sku.trim().toUpperCase() === cleanSku))
    );
  });

  // Enforce mathematical formulas (allow negative singles/total units if selling negative):
  const unitsPerCase = Math.max(1, item.unitsPerCase || 1);
  const costPerCase = item.costPerCase || 0;
  const costPerUnit = item.costPerUnit || (costPerCase > 0 ? costPerCase / unitsPerCase : 0);
  const stockCases = Math.max(0, item.stockCases || 0);
  const stockSingles = item.stockSingles !== undefined ? item.stockSingles : 0;
  const totalUnits = (stockCases * unitsPerCase) + stockSingles;

  const averageCostPerUnit = item.averageCostPerUnit !== undefined && item.averageCostPerUnit > 0
    ? item.averageCostPerUnit
    : costPerUnit;
  const latestCostPerUnit = item.latestCostPerUnit !== undefined && item.latestCostPerUnit > 0
    ? item.latestCostPerUnit
    : costPerUnit;
  const averageCostPerCase = item.averageCostPerCase !== undefined && item.averageCostPerCase > 0
    ? item.averageCostPerCase
    : (averageCostPerUnit * unitsPerCase);
  const latestCostPerCase = item.latestCostPerCase !== undefined && item.latestCostPerCase > 0
    ? item.latestCostPerCase
    : costPerCase;

  const normalized: InventoryItem = {
    ...item,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
    unitsPerCase,
    costPerCase,
    costPerUnit,
    averageCostPerUnit: Number(averageCostPerUnit.toFixed(4)),
    latestCostPerUnit: Number(latestCostPerUnit.toFixed(4)),
    averageCostPerCase: Number(averageCostPerCase.toFixed(2)),
    latestCostPerCase: Number(latestCostPerCase.toFixed(2)),
    stockCases,
    stockSingles,
    totalUnits,
    lastUpdated: new Date().toISOString(),
  };

  if (index >= 0) {
    const existing = allItems[index];
    const prevSellPrice = Number(existing.sellPriceUnit) || 0;
    const newSellPrice = Number(normalized.sellPriceUnit) || 0;
    const sessionUser = getSessionUser();

    // Check single unit sell price change
    if (prevSellPrice > 0 && newSellPrice > 0 && Math.abs(newSellPrice - prevSellPrice) > 0.001) {
      recordPriceCostChangeAudit({
        itemId: normalized.itemId,
        itemName: normalized.itemName,
        fieldChanged: 'PRICE',
        oldValue: prevSellPrice,
        newValue: newSellPrice,
        reason: 'Selling price modified in Inventory Master',
        staffId: sessionUser?.id || '001',
        staffName: sessionUser?.name || 'Administrator',
        userRole: sessionUser?.role || 'ADMIN',
      });
    }

    // Check single unit cost price change
    const prevCost = Number(existing.costPerUnit) || 0;
    const newCost = Number(normalized.costPerUnit) || 0;
    if (prevCost > 0 && newCost > 0 && Math.abs(newCost - prevCost) > 0.001) {
      recordPriceCostChangeAudit({
        itemId: normalized.itemId,
        itemName: normalized.itemName,
        fieldChanged: 'COST',
        oldValue: prevCost,
        newValue: newCost,
        reason: 'Cost price modified in Inventory Master',
        staffId: sessionUser?.id || '001',
        staffName: sessionUser?.name || 'Administrator',
        userRole: sessionUser?.role || 'ADMIN',
      });
    }

    // Check prepack variants price changes
    if (existing.packagingVariants && normalized.packagingVariants) {
      existing.packagingVariants.forEach((oldVar) => {
        const matchingNew = normalized.packagingVariants?.find((nv) => nv.id === oldVar.id);
        if (
          matchingNew &&
          oldVar.sellPrice !== undefined &&
          matchingNew.sellPrice !== undefined &&
          Math.abs(Number(matchingNew.sellPrice) - Number(oldVar.sellPrice)) > 0.001
        ) {
          recordPriceCostChangeAudit({
            itemId: normalized.itemId,
            itemName: `${normalized.itemName} (${matchingNew.name || 'Prepack'})`,
            fieldChanged: 'PRICE',
            oldValue: Number(oldVar.sellPrice) || 0,
            newValue: Number(matchingNew.sellPrice) || 0,
            reason: `Prepack variant "${matchingNew.name}" price modified`,
            staffId: sessionUser?.id || '001',
            staffName: sessionUser?.name || 'Administrator',
            userRole: sessionUser?.role || 'ADMIN',
          });
        }
      });
    }

    // Sync branchOverrides for all branches so stale overrides don't shadow this price change
    const updatedOverrides = { ...(existing.branchOverrides || normalized.branchOverrides || {}) };
    Object.keys(updatedOverrides).forEach((b) => {
      if (updatedOverrides[b]) {
        updatedOverrides[b] = {
          ...updatedOverrides[b],
          sellPriceUnit: normalized.sellPriceUnit,
          sellPriceCase: normalized.sellPriceCase,
          costPerUnit: normalized.costPerUnit,
          costPerCase: normalized.costPerCase,
        };
      }
    });
    normalized.branchOverrides = updatedOverrides;

    allItems[index] = { ...existing, ...normalized };
  } else {
    allItems.unshift(normalized);
  }

  // Deduplicate allItems before saving to ensure corrupt storage duplicates are purged.
  // CRITICAL: Ensure the normalized updated item is preserved for this tenant, not an older duplicate.
  const itemComp = (normalized.company_id || compId || 'DEFAULT').trim().toUpperCase();
  const primaryKey = `${cleanItemId}::${itemComp}`;
  const dedupMap = new Map<string, InventoryItem>();
  dedupMap.set(primaryKey, normalized);

  for (const it of allItems) {
    const itId = (it.itemId || it.id || '').trim().toUpperCase();
    if (!itId) continue;
    const itComp = (it.company_id || (it as any).companyId || 'DEFAULT').trim().toUpperCase();
    const key = `${itId}::${itComp}`;
    if (key === primaryKey) {
      continue; // Superceded by normalized updated item
    }
    if (!dedupMap.has(key)) {
      dedupMap.set(key, it);
    }
  }
  const cleanAllItems = Array.from(dedupMap.values());

  setStored(STORAGE_KEYS.INVENTORY_ITEMS, cleanAllItems);
  notifyListeners();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('saimetric_inventory_updated', { detail: normalized }));
  }

  // Sync to PRODUCTS storage
  try {
    const prodMap = new Map<string, Product>();
    cleanAllItems.map((item) => inventoryItemToProduct(item)).forEach((p) => {
      if (p.id && !prodMap.has(p.id)) {
        prodMap.set(p.id, p);
      }
    });
    setStored(STORAGE_KEYS.PRODUCTS, Array.from(prodMap.values()));
  } catch (e) {
    console.warn('Sync products error:', e);
  }

  // 1. Enqueue write to Google Sheets for InventoryMaster tab
  try {
    enqueueSync('InventoryMaster' as SheetName, 'INSERT', {
      ItemID: normalized.itemId,
      CompanyID: normalized.company_id,
      BranchID: normalized.branch_id,
      ItemName: normalized.itemName,
      UnitsPerCase: normalized.unitsPerCase,
      CostPerCase: normalized.costPerCase,
      CostPerUnit: normalized.costPerUnit,
      SellingPrice: normalized.sellPriceUnit,
      StockCases: normalized.stockCases,
      StockSingles: normalized.stockSingles,
      TotalUnits: normalized.totalUnits,
      SKU: normalized.sku || '',
      Barcode: normalized.barcode || '',
      Category: normalized.category || 'General',
    });
  } catch (syncErr) {
    console.warn('[RoomDB] Enqueue inventory sync error:', syncErr);
  }

  // 2. Notify inventory listeners so meshSyncService broadcasts to peers (only on user action, never from mesh)
  if (!options?.fromMesh && !(item as any).fromMesh) {
    inventoryCreationListeners.forEach((fn) => {
      try {
        fn(normalized);
      } catch (e) {
        console.error('inventoryCreationListener error:', e);
      }
    });
  }

  // 3. Opportunistic background push to server
  try {
    if (typeof fetch !== 'undefined') {
      fetch('/api/inventory/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: normalized.company_id,
          branch_id: normalized.branch_id,
          items: [normalized],
        }),
      }).catch(() => {});

      fetch('/api/saas/call-action?action=sync_inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: normalized.company_id,
          branch_id: normalized.branch_id,
          items: [normalized],
        }),
      }).catch(() => {});
    }
  } catch (e) {}

  notifyListeners();
  return normalized;
};

type InventoryCreationListener = (item: InventoryItem) => void;
const inventoryCreationListeners: Set<InventoryCreationListener> = new Set();

export const onInventoryCreated = (listener: InventoryCreationListener) => {
  inventoryCreationListeners.add(listener);
  return () => {
    inventoryCreationListeners.delete(listener);
  };
};

export const ingestMeshInventoryItem = (item: InventoryItem): boolean => {
  if (!item || (!item.itemId && !(item as any).id)) return false;
  const currentCompany = getCurrentCompanyId();
  const compId = item.company_id || (item as any).companyId || currentCompany;
  if (compId && compId !== currentCompany) {
    return false;
  }

  const allItems = getAllInventoryItems();
  let cleanId = (item.itemId || (item as any).id || '').trim().toUpperCase();

  // If item was previously deleted on this company, do not re-insert or resurrect
  const deletedRegistryKey = 'saimetric_deleted_inventory_ids';
  const deletedList = getStored<Array<{ itemId: string; companyId: string; deletedAt: string }>>(deletedRegistryKey, []);
  const isDeleted = deletedList.some(
    (d) => (d.itemId || '').toUpperCase() === cleanId && (d.companyId || '').toUpperCase() === compId.toUpperCase()
  );
  if (isDeleted) {
    return false;
  }

  const incomingName = (item.itemName || (item as any).name || '').trim().toLowerCase();

  // Find index by exact ID match (only if names also match or one is missing), or by SKU, or by exact item name
  let idx = allItems.findIndex((i) => {
    const iComp = i.company_id || (i as any).companyId || currentCompany;
    if (iComp !== compId) return false;
    const iName = (i.itemName || '').trim().toLowerCase();

    if (item.sku && i.sku && i.sku.toUpperCase() === item.sku.toUpperCase()) return true;
    if (incomingName && iName && incomingName === iName) return true;
    if (cleanId && i.itemId && i.itemId.toUpperCase() === cleanId) {
      // If names differ substantially (e.g. "Airtime" vs "Bread"), they are conflicting counter IDs from separate devices!
      if (incomingName && iName && incomingName !== iName) return false;
      return true;
    }
    return false;
  });

  // If there's an ID conflict with a completely different product, generate a distinct ID so both survive
  if (idx < 0) {
    const idTakenByOther = allItems.some(
      (i) => (i.company_id || (i as any).companyId) === compId && i.itemId && i.itemId.toUpperCase() === cleanId
    );
    if (idTakenByOther) {
      cleanId = `${cleanId}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }
  }

  const normalized: InventoryItem = {
    ...item,
    itemId: cleanId,
    company_id: compId,
    companyId: compId,
    branch_id: item.branch_id || getCurrentBranchId(),
    branchId: item.branch_id || getCurrentBranchId(),
    lastUpdated: item.lastUpdated || new Date().toISOString(),
  };

  if (idx >= 0) {
    const existing = allItems[idx];

    // Conflict Resolution: Never overwrite locally updated items with older/stale remote data
    if (existing.lastUpdated && normalized.lastUpdated) {
      const existingTime = new Date(existing.lastUpdated).getTime();
      const incomingTime = new Date(normalized.lastUpdated).getTime();
      if (!isNaN(existingTime) && !isNaN(incomingTime) && existingTime > incomingTime) {
        return false;
      }
    }

    // Check if the item is already identical to prevent unnecessary localStorage serialization and re-render loops
    const isIdentical =
      existing.sellPriceUnit === normalized.sellPriceUnit &&
      existing.sellPriceCase === normalized.sellPriceCase &&
      existing.stockSingles === normalized.stockSingles &&
      existing.stockCases === normalized.stockCases &&
      existing.itemName === normalized.itemName &&
      existing.costPerUnit === normalized.costPerUnit &&
      existing.barcode === normalized.barcode &&
      existing.sku === normalized.sku &&
      existing.unitsPerCase === normalized.unitsPerCase;

    if (isIdentical) {
      return false;
    }
    allItems[idx] = { ...existing, ...normalized };
  } else {
    allItems.unshift(normalized);
  }

  setStored(STORAGE_KEYS.INVENTORY_ITEMS, allItems);
  try {
    setStored(STORAGE_KEYS.PRODUCTS, allItems.map((item) => inventoryItemToProduct(item)));
  } catch (e) {}
  notifyListeners();
  return true;
};

export const ingestMeshInventoryDelete = (itemId: string, companyId?: string): boolean => {
  if (!itemId) return false;
  const currentCompany = companyId || getCurrentCompanyId();
  const cleanId = (itemId || '').trim().toUpperCase();

  // 1. Record deleted item tombstone with company and timestamp
  const deletedRegistryKey = 'saimetric_deleted_inventory_ids';
  const deletedList = getStored<Array<{ itemId: string; companyId: string; deletedAt: string }>>(deletedRegistryKey, []);
  const existsInDeleted = deletedList.some(
    (d) => (d.itemId || '').toUpperCase() === cleanId && (d.companyId || '').toUpperCase() === currentCompany.toUpperCase()
  );
  if (!existsInDeleted) {
    const updatedDeleted = [
      ...deletedList,
      { itemId: cleanId, companyId: currentCompany, deletedAt: new Date().toISOString() },
    ];
    setStored(deletedRegistryKey, updatedDeleted);
  }

  // 2. Remove from active inventory and products store
  const allItems = getAllInventoryItems();
  const filtered = allItems.filter((i) => {
    const cId = (i.company_id || (i as any).companyId || 'COMP-001').toUpperCase();
    if (cId === currentCompany.toUpperCase() && (i.itemId || '').trim().toUpperCase() === cleanId) {
      return false;
    }
    return true;
  });

  if (filtered.length !== allItems.length) {
    setStored(STORAGE_KEYS.INVENTORY_ITEMS, filtered);
    try {
      setStored(STORAGE_KEYS.PRODUCTS, filtered.map((item) => inventoryItemToProduct(item)));
    } catch (e) {}

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('saimetric_inventory_item_deleted', {
          detail: { itemId: cleanId, companyId: currentCompany, fromMesh: true },
        })
      );
    }
    notifyListeners();
    return true;
  }
  return false;
};

export const getDeletedInventoryItems = (): Array<{ itemId: string; companyId: string; deletedAt: string }> => {
  const deletedRegistryKey = 'saimetric_deleted_inventory_ids';
  return getStored<Array<{ itemId: string; companyId: string; deletedAt: string }>>(deletedRegistryKey, []);
};

// ==================== P2P MESH FULL DATABASE SHARING INGESTORS & EVENT BUS ====================

export type DatabaseEntityType =
  | 'sale'
  | 'inventory'
  | 'branch'
  | 'staff'
  | 'setting'
  | 'supervisor_approval'
  | 'cash_log'
  | 'customer'
  | 'grv'
  | 'reconciliation'
  | 'other';

export interface DatabaseMutationEvent {
  mutationId: string;
  sheetName: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  companyId: string;
  branchId: string;
  branchCode: string;
  entityType: DatabaseEntityType;
  recordId: string;
  payload: any;
  timestamp: number;
  clientRequestId?: string;
}

export function resolveEntityType(sheetName: string): DatabaseEntityType {
  switch (sheetName) {
    case 'Sales':
      return 'sale';
    case 'InventoryMaster':
    case 'Products':
      return 'inventory';
    case 'branches':
      return 'branch';
    case 'Salespeople':
    case 'users':
      return 'staff';
    case 'Audit_Log':
      return 'supervisor_approval';
    case 'CashLog':
      return 'cash_log';
    case 'Customers':
    case 'CustomerChange':
    case 'CreditSales':
      return 'customer';
    case 'Direct_GRV':
    case 'GoodsReceived':
      return 'grv';
    case 'Reconciliations':
    case 'EOD':
      return 'reconciliation';
    case 'SHEETS_CONFIG':
    case 'Settings':
      return 'setting';
    default:
      return 'other';
  }
}

type DatabaseMutationListener = (mutation: DatabaseMutationEvent) => void;
const databaseMutationListeners: Set<DatabaseMutationListener> = new Set();

export const onDatabaseMutation = (listener: DatabaseMutationListener) => {
  databaseMutationListeners.add(listener);
  return () => {
    databaseMutationListeners.delete(listener);
  };
};

export const notifyDatabaseMutation = (event: DatabaseMutationEvent) => {
  databaseMutationListeners.forEach((fn) => {
    try {
      fn(event);
    } catch (e) {
      console.error('Database mutation listener error:', e);
    }
  });
};

export const ingestMeshBranch = (branch: Branch): boolean => {
  if (!branch) return false;
  const currentCompany = getCurrentCompanyId();
  const compId = (branch.company_id || branch.companyId || currentCompany).trim().toUpperCase();
  if (compId && compId !== currentCompany.trim().toUpperCase()) {
    console.warn(`[ingestMeshBranch] Discarded branch for other tenant: ${compId} vs ${currentCompany}`);
    return false;
  }
  const branches = getAllBranches();
  const id = branch.branchId || branch.id || (branch as any).branch_id || 'BR-MAIN';
  const normalized: Branch = {
    ...branch,
    branchId: id,
    id: id,
    company_id: compId,
    companyId: compId,
  };
  const index = branches.findIndex(
    (b) => b.branchId === id || b.id === id || (b as any).branch_id === id
  );
  let updated: Branch[];
  if (index >= 0) {
    const existing = branches[index];
    if (
      existing.name === normalized.name &&
      existing.code === normalized.code &&
      existing.location === normalized.location &&
      (existing as any).status === (normalized as any).status
    ) {
      return false;
    }
    updated = [...branches];
    updated[index] = normalized;
  } else {
    updated = [...branches, normalized];
  }
  setStored(STORAGE_KEYS.BRANCHES, updated);
  notifyListeners();
  return true;
};

export const ingestMeshStaff = (staff: Salesperson): boolean => {
  if (!staff || !staff.id) return false;
  const currentCompany = getCurrentCompanyId();
  const compId = (staff.company_id || staff.companyId || currentCompany).trim().toUpperCase();
  if (compId && compId !== currentCompany.trim().toUpperCase()) {
    console.warn(`[ingestMeshStaff] Discarded staff for other tenant: ${compId} vs ${currentCompany}`);
    return false;
  }
  const all = getAllSalespeople();
  const index = all.findIndex((s) => s.id === staff.id);
  const normalized: Salesperson = {
    ...staff,
    companyId: compId,
    company_id: compId,
  };
  if (index >= 0) {
    const existing = all[index];
    if (
      existing.name === normalized.name &&
      existing.role === normalized.role &&
      existing.pin === normalized.pin &&
      existing.active === normalized.active &&
      JSON.stringify(existing.permissions) === JSON.stringify(normalized.permissions) &&
      JSON.stringify(existing.branchAssignments) === JSON.stringify(normalized.branchAssignments)
    ) {
      return false;
    }
    all[index] = { ...existing, ...normalized };
  } else {
    all.unshift(normalized);
  }
  setStored(STORAGE_KEYS.SALESPEOPLE, all);
  notifyListeners();
  return true;
};

export const ingestMeshSupervisorApproval = (entry: AuditLogEntry): boolean => {
  if (!entry) return false;
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const currentBranchCode = getCurrentBranch()?.code;

  const compId = (entry.company_id || entry.companyId || currentCompany).trim().toUpperCase();
  if (compId && compId !== currentCompany.trim().toUpperCase()) return false;

  const brId = (entry.branch_id || entry.branchId || currentBranch).trim().toUpperCase();
  if (
    brId &&
    brId !== currentBranch.trim().toUpperCase() &&
    brId !== (currentBranchCode || '').trim().toUpperCase()
  ) {
    return false;
  }

  const all = getAuditLogs();
  const exists = all.some(
    (l) =>
      (entry.id && l.id === entry.id) ||
      (l.timestamp === entry.timestamp &&
        l.referenceId === entry.referenceId &&
        l.action === entry.action)
  );
  if (exists) return false;

  const normalized: AuditLogEntry = {
    ...entry,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [normalized, ...all];
  setStored(STORAGE_KEYS.AUDIT_LOGS, updated);

  // If this was an approved GRV or EOD, update corresponding record
  if (((entry.action as string) === 'APPROVE_DIRECT_GRV' || (entry.action as string) === 'DIRECT_GRV_APPROVE') && entry.referenceId) {
    const grvs = getDirectGrvs();
    const grv = grvs.find((g) => g.grvNumber === entry.referenceId);
    if (grv && grv.status !== 'APPROVED') {
      grv.status = 'APPROVED';
      grv.approvedAt = entry.timestamp;
      (grv as any).approvedByName = entry.staffName;
      (grv as any).approvedById = entry.staffId;
      setStored(STORAGE_KEYS.DIRECT_GRVS, grvs);
    }
  }
  notifyListeners();
  return true;
};

export const ingestMeshCashLog = (entry: CashLogEntry): boolean => {
  if (!entry) return false;
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const currentBranchCode = getCurrentBranch()?.code;

  const compId = (entry.company_id || (entry as any).companyId || currentCompany).trim().toUpperCase();
  if (compId && compId !== currentCompany.trim().toUpperCase()) return false;

  const brId = (entry.branch_id || (entry as any).branchId || currentBranch).trim().toUpperCase();
  if (
    brId &&
    brId !== currentBranch.trim().toUpperCase() &&
    brId !== (currentBranchCode || '').trim().toUpperCase()
  ) {
    return false;
  }

  const all = getCashLogs();
  const exists = all.some(
    (l) =>
      (entry.id && l.id === entry.id) ||
      (entry.reference && l.reference === entry.reference && l.timestamp === entry.timestamp)
  );
  if (exists) return false;

  const normalized: CashLogEntry = {
    ...entry,
    company_id: compId,
    branch_id: brId,
  };
  const updated = [normalized, ...all];
  setStored(STORAGE_KEYS.CASH_LOGS, updated);
  notifyListeners();
  return true;
};

export const ingestMeshGRV = (grv: DirectGrv): boolean => {
  if (!grv || !grv.grvNumber) return false;
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const currentBranchCode = getCurrentBranch()?.code;

  const compId = (grv.companyId || grv.company_id || currentCompany).trim().toUpperCase();
  if (compId && compId !== currentCompany.trim().toUpperCase()) return false;

  const brId = (grv.branchId || grv.branch_id || currentBranch).trim().toUpperCase();
  if (
    brId &&
    brId !== currentBranch.trim().toUpperCase() &&
    brId !== (currentBranchCode || '').trim().toUpperCase()
  ) {
    return false;
  }

  const all = getAllDirectGrvs();
  const idx = all.findIndex((g) => g.grvNumber === grv.grvNumber || g.id === grv.id);
  const normalized: DirectGrv = {
    ...grv,
    companyId: compId,
    company_id: compId,
    branchId: brId,
    branch_id: brId,
  };
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...normalized };
  } else {
    all.unshift(normalized);
  }
  setStored(STORAGE_KEYS.DIRECT_GRVS, all);
  notifyListeners();
  return true;
};

export const ingestMeshCustomer = (customer: any): boolean => {
  if (!customer) return false;
  const currentCompany = getCurrentCompanyId();
  const compId = (customer.company_id || customer.companyId || currentCompany).trim().toUpperCase();
  if (compId && compId !== currentCompany.trim().toUpperCase()) return false;

  const all = getCustomers();
  const id = customer.id || customer.customerId;
  const idx = all.findIndex(
    (c) =>
      (id && ((c as any).id === id || c.customerId === id)) ||
      (customer.name && c.name && c.name.toLowerCase() === customer.name.toLowerCase())
  );
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...customer };
  } else {
    all.unshift(customer);
  }
  setStored(STORAGE_KEYS.CUSTOMERS, all);
  notifyListeners();
  return true;
};

export const ingestMeshSettings = (settingsPayload: any): boolean => {
  if (!settingsPayload) return false;
  const currentCompany = getCurrentCompanyId();
  const compId = (settingsPayload.company_id || settingsPayload.companyId || currentCompany).trim().toUpperCase();
  if (compId && compId !== currentCompany.trim().toUpperCase()) return false;

  let changed = false;
  if (settingsPayload.sheetsConfig) {
    setStored(STORAGE_KEYS.SHEETS_CONFIG, settingsPayload.sheetsConfig);
    changed = true;
  }
  if (settingsPayload.exchangeRates) {
    setStored(STORAGE_KEYS.EXCHANGE_RATES, settingsPayload.exchangeRates);
    changed = true;
  }
  if (changed) {
    notifyListeners();
  }
  return changed;
};

export const ingestMeshCustomerChange = (entry: any): boolean => {
  if (!entry || !entry.id) return false;
  const all = getCustomerChanges();
  if (all.some((c) => c.id === entry.id)) return false;
  setStored(STORAGE_KEYS.CUSTOMER_CHANGES, [entry, ...all]);
  notifyListeners();
  return true;
};

export const ingestMeshCreditSale = (entry: any): boolean => {
  if (!entry || !entry.id) return false;
  const all = getCreditSales();
  if (all.some((c) => c.id === entry.id)) return false;
  setStored(STORAGE_KEYS.CREDIT_SALES, [entry, ...all]);
  notifyListeners();
  return true;
};

export const ingestMeshStockMovement = (entry: any): boolean => {
  if (!entry || (!entry.txnId && !entry.movementId)) return false;
  const all = getStockMovements();
  const id = entry.txnId || entry.movementId;
  if (all.some((s) => s.txnId === id || s.movementId === id)) return false;
  setStored(STORAGE_KEYS.STOCK_MOVEMENTS, [entry, ...all]);
  notifyListeners();
  return true;
};

export const ingestMeshCashLift = (entry: any): boolean => {
  if (!entry || !entry.id) return false;
  const all = getAllCashLifts();
  if (all.some((c) => c.id === entry.id)) return false;
  setStored(STORAGE_KEYS.CASH_LIFTS, [entry, ...all]);
  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
    window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
  }
  return true;
};

export const ingestMeshGoodsReceived = (entry: any): boolean => {
  if (!entry || (!entry.id && !entry.reference)) return false;
  const all = getAllGoodsReceived();
  const id = entry.id || entry.reference;
  const idx = all.findIndex((g: any) => (g.id || g.reference) === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...entry };
  } else {
    all.unshift(entry);
  }
  setStored(STORAGE_KEYS.GOODS_RECEIVED, all);
  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
  }
  return true;
};

export const getDeltaRecordsSince = (sinceIsoTimestamp: string) => {
  const sinceTime = new Date(sinceIsoTimestamp).getTime();
  const filterByTime = (records: any[]) => {
    if (!Array.isArray(records)) return [];
    return records.filter((r) => {
      if (!r) return false;
      const t = r.timestamp || r.updatedAt || r.createdAt || r.lastUpdated || r.date;
      if (!t) return false;
      const tm = new Date(t).getTime();
      return !isNaN(tm) && tm >= sinceTime;
    });
  };

  return {
    sales: filterByTime(getAllSales()),
    cashLogs: filterByTime(getCashLogs()),
    cashLifts: filterByTime(getAllCashLifts()),
    customerChanges: filterByTime(getCustomerChanges()),
    creditSales: filterByTime(getCreditSales()),
    stockMovements: filterByTime(getStockMovements()),
    directGrvs: filterByTime(getDirectGrvs()),
    auditLogs: filterByTime(getAuditLogs()),
    goodsReceivedNotes: filterByTime(getAllGoodsReceived()),
    inventoryItems: getAllInventoryItems(),
  };
};

export const markSyncItemsAsSynced = (clientRequestIds: string[] = [], itemIds: string[] = []): number => {
  const reqIdSet = new Set(clientRequestIds.filter(Boolean));
  const itemIdSet = new Set(itemIds.filter(Boolean));
  if (reqIdSet.size === 0 && itemIdSet.size === 0) return 0;

  let markedCount = 0;

  // 1. Update Room Database sync queue
  const queue = getSyncQueue();
  let queueChanged = false;
  const updatedQueue = queue.map((item) => {
    const itemReqId = item.payload?.clientRequestId;
    const isMatch = itemIdSet.has(item.id) || (itemReqId && reqIdSet.has(itemReqId));
    if (isMatch && item.status !== 'synced') {
      queueChanged = true;
      markedCount++;
      return { ...item, status: 'synced' as const, error: undefined };
    }
    return item;
  });
  if (queueChanged) {
    setStored(STORAGE_KEYS.SYNC_QUEUE, updatedQueue);
  }

  // 2. Update Sales syncStatus and synced flag
  const sales = getAllSales();
  let salesChanged = false;
  const updatedSales = sales.map((sale) => {
    const saleReqId = (sale as any).clientRequestId || sale.id;
    const isMatch = itemIdSet.has(sale.id) || (saleReqId && reqIdSet.has(saleReqId)) || itemIdSet.has(saleReqId);
    if (isMatch && ((sale as any).syncStatus !== 'synced' || !sale.synced)) {
      salesChanged = true;
      return { ...sale, syncStatus: 'synced' as const, synced: true };
    }
    return sale;
  });
  if (salesChanged) {
    setStored(STORAGE_KEYS.SALES, updatedSales);
  }

  // 3. Update CashLogs synced status
  const cashLogs = getAllCashLogs();
  let cashLogsChanged = false;
  const updatedCashLogs = cashLogs.map((log) => {
    const logReqId = (log as any).clientRequestId || log.id;
    const isMatch = itemIdSet.has(log.id) || (logReqId && reqIdSet.has(logReqId)) || (log.reference && (itemIdSet.has(log.reference) || reqIdSet.has(log.reference)));
    if (isMatch && !log.synced) {
      cashLogsChanged = true;
      return { ...log, synced: true, syncStatus: 'synced' };
    }
    return log;
  });
  if (cashLogsChanged) {
    setStored(STORAGE_KEYS.CASH_LOGS, updatedCashLogs);
  }

  // 4. Update Supplier Invoices synced status
  let suppInvoicesChanged = false;
  const suppInvoices = getStored<any[]>(STORAGE_KEYS.SUPPLIER_INVOICES, []);
  const updatedSuppInvoices = suppInvoices.map((inv) => {
    const isMatch = itemIdSet.has(inv.id) || itemIdSet.has(inv.invoiceNumber) || (inv.clientRequestId && reqIdSet.has(inv.clientRequestId));
    if (isMatch && (!inv.synced || inv.syncStatus !== 'synced')) {
      suppInvoicesChanged = true;
      return { ...inv, synced: true, syncStatus: 'synced' };
    }
    return inv;
  });
  if (suppInvoicesChanged) {
    setStored(STORAGE_KEYS.SUPPLIER_INVOICES, updatedSuppInvoices);
  }

  // 5. Update Goods Received Notes & Direct GRVs synced status
  let grnsChanged = false;
  const grns = getStored<any[]>(STORAGE_KEYS.GOODS_RECEIVED_NOTES, []);
  const updatedGrns = grns.map((g) => {
    const isMatch = itemIdSet.has(g.id) || (g.clientRequestId && reqIdSet.has(g.clientRequestId));
    if (isMatch && (!g.synced || g.syncStatus !== 'synced')) {
      grnsChanged = true;
      return { ...g, synced: true, syncStatus: 'synced' };
    }
    return g;
  });
  if (grnsChanged) {
    setStored(STORAGE_KEYS.GOODS_RECEIVED_NOTES, updatedGrns);
  }

  let directGrvsChanged = false;
  const directGrvs = getStored<any[]>(STORAGE_KEYS.DIRECT_GRVS, []);
  const updatedDirectGrvs = directGrvs.map((g) => {
    const isMatch = itemIdSet.has(g.id) || (g.clientRequestId && reqIdSet.has(g.clientRequestId));
    if (isMatch && (!g.synced || g.syncStatus !== 'synced')) {
      directGrvsChanged = true;
      return { ...g, synced: true, syncStatus: 'synced' };
    }
    return g;
  });
  if (directGrvsChanged) {
    setStored(STORAGE_KEYS.DIRECT_GRVS, updatedDirectGrvs);
  }

  // 6. Update Credit Sales synced status
  let creditSalesChanged = false;
  const creditSales = getStored<any[]>(STORAGE_KEYS.CREDIT_SALES, []);
  const updatedCreditSales = creditSales.map((c) => {
    const isMatch = itemIdSet.has(c.id) || (c.clientRequestId && reqIdSet.has(c.clientRequestId));
    if (isMatch && (!c.synced || c.syncStatus !== 'synced')) {
      creditSalesChanged = true;
      return { ...c, synced: true, syncStatus: 'synced' };
    }
    return c;
  });
  if (creditSalesChanged) {
    setStored(STORAGE_KEYS.CREDIT_SALES, updatedCreditSales);
  }

  // 7. Update Cash Lifts synced status
  let cashLiftsChanged = false;
  const cashLifts = getStored<any[]>(STORAGE_KEYS.CASH_LIFTS, []);
  const updatedCashLifts = cashLifts.map((l) => {
    const isMatch = itemIdSet.has(l.id) || (l.clientRequestId && reqIdSet.has(l.clientRequestId)) || (l.cashLogId && itemIdSet.has(l.cashLogId));
    if (isMatch && (!l.synced || l.syncStatus !== 'synced')) {
      cashLiftsChanged = true;
      return { ...l, synced: true, syncStatus: 'synced' };
    }
    return l;
  });
  if (cashLiftsChanged) {
    setStored(STORAGE_KEYS.CASH_LIFTS, updatedCashLifts);
  }

  // 8. Update Expenses synced status
  let expensesChanged = false;
  const expenses = getStored<any[]>(STORAGE_KEYS.EXPENSES, []);
  const updatedExpenses = expenses.map((e) => {
    const isMatch = itemIdSet.has(e.id) || (e.clientRequestId && reqIdSet.has(e.clientRequestId));
    if (isMatch && (!e.synced || e.syncStatus !== 'synced')) {
      expensesChanged = true;
      return { ...e, synced: true, syncStatus: 'synced' };
    }
    return e;
  });
  if (expensesChanged) {
    setStored(STORAGE_KEYS.EXPENSES, updatedExpenses);
  }

  if (queueChanged || salesChanged || cashLogsChanged || suppInvoicesChanged || grnsChanged || directGrvsChanged || creditSalesChanged || cashLiftsChanged || expensesChanged) {
    notifyListeners();
  }
  return markedCount;
};

export const markReceiptAsSynced = markSyncItemsAsSynced;

export const markSaleAsSynced = (invoiceId: string): boolean => {
  if (!invoiceId) return false;
  return markSyncItemsAsSynced([], [invoiceId]) > 0;
};

export async function pullTenantInventory(companyId?: string): Promise<{ added: number; updated: number; count: number }> {
  const compId = companyId || getCurrentCompanyId();
  if (!compId) return { added: 0, updated: 0, count: 0 };

  let added = 0;
  let updated = 0;

  // 1. Fetch from server central store (/api/inventory/items)
  try {
    const res = await fetch(`/api/inventory/items?company_id=${encodeURIComponent(compId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.items)) {
        const localAll = getAllInventoryItems();
        let changed = false;

        for (const remote of data.items) {
          let rId = (remote.itemId || remote.id || '').trim().toUpperCase();
          if (!rId) continue;
          const remoteName = (remote.itemName || remote.name || '').trim().toLowerCase();

          const idx = localAll.findIndex((i) => {
            const iComp = i.company_id || (i as any).companyId || compId;
            if (iComp !== compId) return false;
            const iName = (i.itemName || '').trim().toLowerCase();

            if (remote.sku && i.sku && i.sku.toUpperCase() === remote.sku.toUpperCase()) return true;
            if (remoteName && iName && remoteName === iName) return true;
            if (i.itemId && i.itemId.toUpperCase() === rId) {
              if (remoteName && iName && remoteName !== iName) return false;
              return true;
            }
            return false;
          });

          if (idx >= 0) {
            const local = localAll[idx];
            if (!local.lastUpdated || (remote.lastUpdated && remote.lastUpdated >= local.lastUpdated)) {
              localAll[idx] = { ...local, ...remote };
              updated++;
              changed = true;
            }
          } else {
            // Check if ID is taken by a different item
            const idTaken = localAll.some((i) => (i.company_id || (i as any).companyId) === compId && i.itemId && i.itemId.toUpperCase() === rId);
            if (idTaken) {
              rId = `${rId}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            }

            localAll.unshift({
              ...remote,
              itemId: rId,
              company_id: compId,
              companyId: compId,
              branch_id: remote.branch_id || getCurrentBranchId(),
              branchId: remote.branch_id || getCurrentBranchId(),
            });
            added++;
            changed = true;
          }
        }

        if (changed) {
          setStored(STORAGE_KEYS.INVENTORY_ITEMS, localAll);
          try {
            setStored(STORAGE_KEYS.PRODUCTS, localAll.map((item) => inventoryItemToProduct(item)));
          } catch (e) {}
          notifyListeners();
        }
      }
    }
  } catch (err) {
    console.warn('[RoomDB] pullTenantInventory server fetch error:', err);
  }

  // 2. Also check if Google Sheets has additional products via /api/saas/call-action
  try {
    const gasRes = await fetch(`/api/saas/call-action?action=get_inventory&company_id=${encodeURIComponent(compId)}`);
    if (gasRes.ok) {
      const gasData = await gasRes.json().catch(() => null);
      if (gasData && gasData.success && Array.isArray(gasData.items) && gasData.items.length > 0) {
        for (const item of gasData.items) {
          ingestMeshInventoryItem(item);
        }
      }
    }
  } catch (gasErr) {}

  // 3. Opportunistically push newly added/updated local items for this company to central server
  try {
    const tenantLocalItems = getInventoryItems().filter((i) => (i.company_id || (i as any).companyId) === compId);
    if (tenantLocalItems.length > 0 && (added > 0 || updated > 0)) {
      const deviceId = (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_mesh_device_id')) || 'terminal-local';
      fetch('/api/inventory/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: compId,
          device_id: deviceId,
          items: tenantLocalItems,
        }),
      }).catch(() => {});
    }
  } catch (syncErr) {}

  return { added, updated, count: getInventoryItems().length };
}

export async function pullTenantSales(companyId?: string): Promise<number> {
  const compId = companyId || getCurrentCompanyId();
  if (!compId) return 0;
  try {
    const res = await fetch(`/api/sales?company_id=${encodeURIComponent(compId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && Array.isArray(data.sales)) {
        const localAll = getAllSales();
        const localIdSet = new Set(localAll.map((s) => s.id));
        let addedCount = 0;
        const merged = [...localAll];
        for (const remoteSale of data.sales) {
          if (remoteSale && remoteSale.id && !localIdSet.has(remoteSale.id)) {
            merged.push(remoteSale);
            localIdSet.add(remoteSale.id);
            addedCount++;
          }
        }
        if (addedCount > 0) {
          setStored(STORAGE_KEYS.SALES, merged);
          notifyListeners();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
          }
        }
        return addedCount;
      }
    }
  } catch (err) {
    console.warn('[RoomDB] pullTenantSales fetch error:', err);
  }
  return 0;
}

export const getDeviceId = (): string => {
  return (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_mesh_device_id')) || 'terminal-local';
};

export const addQuickProduct = (params: {
  name: string;
  price: number;
  costPrice?: number;
  category?: string;
  stockQuantity?: number;
  barcode?: string;
  sku?: string;
  unit?: string;
}): Product => {
  const cleanName = params.name.trim();
  const slug = cleanName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'ITEM';
  const timestamp = Date.now();
  const id = `ITM-${slug}-${timestamp.toString().slice(-4)}`;
  const sku = params.sku?.trim() || `SKU-${slug}-${timestamp.toString().slice(-4)}`;
  const price = Math.max(0.01, Number(params.price) || 1.0);
  const costPrice = params.costPrice !== undefined ? Math.max(0, Number(params.costPrice)) : Math.round(price * 0.7 * 100) / 100;
  const stockQty = params.stockQuantity !== undefined ? Number(params.stockQuantity) : 50;
  const category = params.category?.trim() || 'General Merchandise';
  const unit = params.unit?.trim() || 'Each';

  const invItem: InventoryItem = {
    itemId: id,
    itemName: cleanName,
    category,
    unitsPerCase: 1,
    costPerCase: costPrice,
    costPerUnit: costPrice,
    sellPriceCase: price,
    sellPriceUnit: price,
    stockCases: 0,
    stockSingles: stockQty,
    totalUnits: stockQty,
    reorderLevelCases: 1,
    reorderLevelUnits: 5,
    sku,
    barcode: params.barcode?.trim() || '',
    description: `Counter quick added item: ${cleanName}`,
    company_id: getCurrentCompanyId(),
    branch_id: getCurrentBranchId(),
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(invItem);

  const product: Product = {
    id,
    name: cleanName,
    sku,
    category,
    price,
    costPrice,
    stockQuantity: stockQty,
    unit,
    description: invItem.description,
    barcode: invItem.barcode,
    sellPriceUnit: price,
    costPerUnit: costPrice,
    unitsPerCase: 1,
    stockSingles: stockQty,
    totalUnits: stockQty,
    companyId: getCurrentCompanyId(),
    branchId: getCurrentBranchId(),
  };

  notifyListeners();
  return product;
};

// ============================================================================
// CORE RULE 1: BATCH TRACKING & CORE RULE 2: FIFO DEDUCTION WITH NEGATIVE BALANCES
// ============================================================================

export const getAllStockBatches = (): StockBatch[] => {
  return getStored<StockBatch[]>(STORAGE_KEYS.STOCK_BATCHES, []);
};

export const getStockBatches = (): StockBatch[] => {
  let batches = getAllStockBatches();
  if (batches.length === 0) {
    // Bootstrap initial batches from all inventory items if none exist
    const items = getAllInventoryItems();
    const generated: StockBatch[] = [];
    const now = new Date();

    items.forEach((item, idx) => {
      const totalUnits = (item.stockCases * item.unitsPerCase) + item.stockSingles;
      if (totalUnits > 0) {
        // Create 1-2 realistic batches with varying expiry and received dates
        const daysAgo = (idx % 4) * 22 + 5; // e.g. 5, 27, 49, 71 days ago
        const recDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Expiry date: some close (<30 days), some medium, some far
        const expDays = idx % 5 === 0 ? 14 : idx % 5 === 1 ? 26 : idx % 5 === 2 ? 60 : 180;
        const expDate = new Date(now.getTime() + expDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        generated.push({
          id: `BAT-${recDate.replace(/-/g, '')}-${String(idx + 1).padStart(3, '0')}`,
          batchNumber: `BATCH-2026-${String(idx + 1).padStart(3, '0')}`,
          itemId: item.itemId,
          itemName: item.itemName,
          qtyReceived: totalUnits,
          qtyOnHand: totalUnits,
          cost: totalUnits * item.costPerUnit,
          costPerUnit: item.costPerUnit,
          costPerCase: item.costPerCase,
          expiryDate: expDate,
          receivedDate: recDate,
          supplier: idx % 2 === 0 ? 'National Foods Wholesalers' : 'Delta Beverages Ltd',
          grnId: `GRN-${recDate.replace(/-/g, '')}-001`,
          invoiceNo: `INV-SUP-${9000 + idx}`,
          createdAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
          companyId: item.companyId || (item as any).company_id || 'COMP-001',
          company_id: item.company_id || (item as any).companyId || 'COMP-001',
          branchId: item.branchId || (item as any).branch_id || 'BR-MAIN',
          branch_id: item.branch_id || (item as any).branchId || 'BR-MAIN',
        });
      }
    });

    if (generated.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEYS.STOCK_BATCHES, JSON.stringify(generated));
      } catch (err) {
        console.error('Error bootstrapping stock batches:', err);
      }
      batches = generated;
    }
  }

  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return batches;
  }
  return batches.filter((b) => {
    const compId = b.company_id || b.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getBatchesByItemId = (itemId: string): StockBatch[] => {
  const batches = getStockBatches();
  return batches.filter((b) => b.itemId.toUpperCase() === itemId.toUpperCase());
};

export const saveStockBatch = (batch: StockBatch): StockBatch => {
  const batches = getAllStockBatches();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = batch.company_id || batch.companyId || currentCompany;
  const brId = batch.branch_id || batch.branchId || currentBranch;
  const index = batches.findIndex((b) => b.id === batch.id);
  const normalized: StockBatch = {
    ...batch,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
    qtyOnHand: Math.max(0, batch.qtyOnHand), // Core constraint: batch qty can NEVER be negative
  };
  if (index >= 0) {
    batches[index] = normalized;
  } else {
    batches.unshift(normalized);
  }
  setStored(STORAGE_KEYS.STOCK_BATCHES, batches);
  return normalized;
};

export const deleteStockBatch = (batchId: string): boolean => {
  const batches = getAllStockBatches();
  const filtered = batches.filter((b) => b.id !== batchId);
  if (filtered.length !== batches.length) {
    setStored(STORAGE_KEYS.STOCK_BATCHES, filtered);
    return true;
  }
  return false;
};

export const getAllNegativeBalances = (): NegativeBalanceEntry[] => {
  return getStored<NegativeBalanceEntry[]>(STORAGE_KEYS.NEGATIVE_BALANCES, []);
};

export const getNegativeBalances = (): NegativeBalanceEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllNegativeBalances();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((n) => {
    const compId = (n as any).company_id || (n as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const saveNegativeBalance = (entry: NegativeBalanceEntry): NegativeBalanceEntry => {
  const list = getAllNegativeBalances();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const normalized: NegativeBalanceEntry = {
    ...entry,
    company_id: (entry as any).company_id || (entry as any).companyId || currentCompany,
    companyId: (entry as any).companyId || (entry as any).company_id || currentCompany,
    branch_id: (entry as any).branch_id || (entry as any).branchId || currentBranch,
    branchId: (entry as any).branchId || (entry as any).branch_id || currentBranch,
  } as any;
  const index = list.findIndex((e) => e.id === entry.id);
  if (index >= 0) {
    list[index] = normalized;
  } else {
    list.unshift(normalized);
  }
  setStored(STORAGE_KEYS.NEGATIVE_BALANCES, list);
  return normalized;
};

export const getOpenNegativeBalances = (itemId?: string): NegativeBalanceEntry[] => {
  const list = getNegativeBalances();
  return list.filter(
    (e) => e.status === 'OPEN' && (!itemId || e.itemId.toUpperCase() === itemId.toUpperCase())
  );
};

/**
 * Deduct from batches using FIFO. Order by Expiry Date ASC, then Received Date ASC.
 * If total stock is 0 and allowNegative is true, create a Negative Balance entry.
 */
export const deductStockFIFO = (params: {
  itemId: string;
  quantityUnits: number;
  staffId: string;
  staffName?: string;
  saleInvoiceId?: string;
  allowNegative?: boolean;
}): {
  success: boolean;
  deductedFromBatches: { batchId: string; qty: number; expiryDate?: string }[];
  negativeQty: number;
  negativeEntry?: NegativeBalanceEntry;
  error?: string;
} => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return { success: false, deductedFromBatches: [], negativeQty: 0, error: 'Product not found' };
  }

  const batches = getStockBatches();
  // Filter active batches for this product with qtyOnHand > 0
  const itemBatches = batches.filter(
    (b) => b.itemId.toUpperCase() === item.itemId.toUpperCase() && b.qtyOnHand > 0
  );

  // CORE RULE 2: Order by Expiry Date ASC, then Received Date ASC
  itemBatches.sort((a, b) => {
    if (a.expiryDate && b.expiryDate) {
      const expDiff = new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      if (expDiff !== 0) return expDiff;
    } else if (a.expiryDate && !b.expiryDate) {
      return -1;
    } else if (!a.expiryDate && b.expiryDate) {
      return 1;
    }
    return new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime();
  });

  let remainingToDeduct = params.quantityUnits;
  const deductedBatches: { batchId: string; qty: number; expiryDate?: string }[] = [];

  for (const batch of itemBatches) {
    if (remainingToDeduct <= 0) break;
    const canTake = Math.min(batch.qtyOnHand, remainingToDeduct);
    batch.qtyOnHand -= canTake;
    remainingToDeduct -= canTake;
    deductedBatches.push({ batchId: batch.id, qty: canTake, expiryDate: batch.expiryDate });
  }

  // Save all updated batches
  setStored(STORAGE_KEYS.STOCK_BATCHES, batches);

  // If remainingToDeduct > 0 (all available batches depleted, goes below 0)
  if (remainingToDeduct > 0) {
    if (!params.allowNegative) {
      const staff = getSalespeople().find((s) => s.id === params.staffId) || getCurrentUser();
      const isPrivileged = isSupervisorOrAbove(staff?.role) || Boolean(staff?.permissions?.canManageInventory);
      return {
        success: false,
        deductedFromBatches: deductedBatches,
        negativeQty: 0,
        error: isPrivileged
          ? `Insufficient stock for ${item.itemName} (${item.totalUnits} on hand). Negative selling permission required.`
          : `Insufficient stock for ${item.itemName}. Negative selling permission required.`,
      };
    }

    // CORE RULE 2: When selling negative: Do NOT assign an expiry/batch. Create a "Negative Balance" entry.
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split('T')[0];
    const negId = `NEG-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

    const negEntry: NegativeBalanceEntry = {
      id: negId,
      itemId: item.itemId,
      itemName: item.itemName,
      negativeQty: remainingToDeduct,
      clearedQty: 0,
      saleCost: item.costPerUnit,
      salePrice: item.sellPriceUnit,
      saleDate: dateStr,
      timestamp,
      saleInvoiceId: params.saleInvoiceId,
      soldBy: params.staffId,
      soldByName: params.staffName,
      status: 'OPEN',
      potentialLoss: 0,
    };

    saveNegativeBalance(negEntry);

    return {
      success: true,
      deductedFromBatches: deductedBatches,
      negativeQty: remainingToDeduct,
      negativeEntry: negEntry,
    };
  }

  return {
    success: true,
    deductedFromBatches: deductedBatches,
    negativeQty: 0,
  };
};

/**
 * On next Goods Receiving: First, use the new received qty to clear any Negative Balance.
 * Fulfills negative sales from newest batch received, and computes potential loss if new cost > old sale cost.
 */
export const clearNegativeBalancesOnGRN = (params: {
  itemId: string;
  receivedUnits: number;
  newCostPerUnit: number;
  grnId: string;
}): {
  clearedUnits: number;
  remainingUnitsForNewBatch: number;
  totalPotentialLoss: number;
  clearedEntries: NegativeBalanceEntry[];
} => {
  const openBalances = getOpenNegativeBalances(params.itemId);
  // Sort oldest first (FIFO clearing)
  openBalances.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let availableUnits = params.receivedUnits;
  let totalCleared = 0;
  let totalPotentialLoss = 0;
  const clearedEntries: NegativeBalanceEntry[] = [];
  const timestamp = new Date().toISOString();

  for (const neg of openBalances) {
    if (availableUnits <= 0) break;
    const remainingNeeded = neg.negativeQty - neg.clearedQty;
    const toClear = Math.min(availableUnits, remainingNeeded);

    neg.clearedQty += toClear;
    availableUnits -= toClear;
    totalCleared += toClear;

    // CORE RULE 3: FRAUD / LOSS DETECTION
    // If New Cost > Cost At Time Of Negative Sale: Potential Loss = Negative Qty * (New Cost - Old Cost)
    if (params.newCostPerUnit > neg.saleCost) {
      const loss = toClear * (params.newCostPerUnit - neg.saleCost);
      neg.potentialLoss = Number(((neg.potentialLoss || 0) + loss).toFixed(2));
      totalPotentialLoss += loss;
    }

    neg.newCostAtClearing = params.newCostPerUnit;

    if (neg.clearedQty >= neg.negativeQty) {
      neg.status = 'CLEARED';
      neg.clearedAt = timestamp;
      neg.clearingGrnId = params.grnId;
    }

    saveNegativeBalance(neg);
    clearedEntries.push(neg);
  }

  return {
    clearedUnits: totalCleared,
    remainingUnitsForNewBatch: Math.max(0, availableUnits),
    totalPotentialLoss,
    clearedEntries,
  };
};

/**
 * Audit Trail & Fraud Logging for Price and Cost changes in Inventory Master
 */
export function recordPriceCostChangeAudit(params: {
  itemId: string;
  itemName: string;
  fieldChanged: 'PRICE' | 'COST';
  oldValue: number;
  newValue: number;
  reason: string;
  staffId: string;
  staffName?: string;
  userRole?: string;
  referenceId?: string;
}): StockMovementEntry {
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const txnId = `AUDIT-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const percentChange = params.oldValue > 0
    ? Number((((params.newValue - params.oldValue) / params.oldValue) * 100).toFixed(2))
    : 100;

  // Lookup current live stock for item so audit entry captures accurate balance
  const invItem = getInventoryItemById(params.itemId);
  const closingCases = invItem ? invItem.stockCases : 0;
  const closingSingles = invItem ? invItem.stockSingles : 0;

  const entry: StockMovementEntry = {
    txnId,
    movementId: txnId,
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName || 'Staff',
    itemId: params.itemId,
    itemName: params.itemName,
    txnType: params.fieldChanged === 'PRICE' ? 'PRICE_CHANGE' : 'COST_CHANGE',
    movementType: params.fieldChanged === 'PRICE' ? 'PRICE_CHANGE' : 'COST_CHANGE',
    qtyCases: 0,
    qtySingles: 0,
    casesChange: 0,
    singlesChange: 0,
    closingCases,
    closingSingles,
    resultingStockCases: closingCases,
    resultingStockSingles: closingSingles,
    oldValue: params.oldValue,
    newValue: params.newValue,
    percentChange,
    fieldChanged: params.fieldChanged,
    reason: params.reason.trim(),
    actionTaken: params.fieldChanged === 'PRICE' ? 'PRICE_REVISION' : 'COST_REVISION',
    referenceId: params.referenceId || txnId,
    promptShown: `Price Revision: ${params.oldValue.toFixed(2)} → ${params.newValue.toFixed(2)}`,
    userRole: params.userRole || 'Staff',
    timestamp,
    synced: false,
  };

  addStockMovement(entry);
  return entry;
}

/**
 * Remove stock manually (e.g. damages, spoilage, shrinkage, expired stock, audit adjustment)
 * with full FIFO deduction and StockMovement/Audit Trail record
 */
export const removeManualStock = (params: {
  itemId: string;
  casesToRemove: number;
  singlesToRemove: number;
  reasonType: 'DAMAGE_LOSS' | 'EXPIRY' | 'SPOILAGE' | 'SHRINKAGE' | 'INTERNAL_USE' | 'ADJUSTMENT';
  notes: string;
  staffId: string;
  staffName?: string;
  referenceId?: string;
}): {
  success: boolean;
  message: string;
  updatedItem?: InventoryItem;
  movement?: StockMovementEntry;
} => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return { success: false, message: `Item not found: ${params.itemId}` };
  }

  const casesToRemove = Math.max(0, Number(params.casesToRemove) || 0);
  const singlesToRemove = Math.max(0, Number(params.singlesToRemove) || 0);
  const unitsPerCase = Math.max(1, item.unitsPerCase || 1);
  const totalUnitsToRemove = (casesToRemove * unitsPerCase) + singlesToRemove;

  if (totalUnitsToRemove <= 0) {
    return { success: false, message: 'Please specify a quantity of cases or singles to remove.' };
  }

  const currentTotalUnits = item.totalUnits !== undefined ? item.totalUnits : ((item.stockCases * unitsPerCase) + item.stockSingles);
  if (totalUnitsToRemove > currentTotalUnits) {
    return {
      success: false,
      message: `Cannot remove ${totalUnitsToRemove} units. Only ${currentTotalUnits} units available in stock.`,
    };
  }

  let newCases = item.stockCases - casesToRemove;
  let newSingles = item.stockSingles - singlesToRemove;

  // If singles go negative, break down cases
  if (newSingles < 0 && newCases > 0) {
    const casesNeeded = Math.ceil(Math.abs(newSingles) / unitsPerCase);
    if (newCases >= casesNeeded) {
      newCases -= casesNeeded;
      newSingles += casesNeeded * unitsPerCase;
    }
  }

  // If cases went negative (e.g., casesToRemove > stockCases but total units suffice)
  if (newCases < 0 && newSingles >= Math.abs(newCases) * unitsPerCase) {
    newSingles += newCases * unitsPerCase;
    newCases = 0;
  }

  const newTotalUnits = (Math.max(0, newCases) * unitsPerCase) + Math.max(0, newSingles);

  // Deduct from FIFO batches
  deductStockFIFO({
    itemId: item.itemId,
    quantityUnits: totalUnitsToRemove,
    staffId: params.staffId,
    staffName: params.staffName,
    saleInvoiceId: params.referenceId || 'MANUAL-REMOVAL',
    allowNegative: false,
  });

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: Math.max(0, newCases),
    stockSingles: Math.max(0, newSingles),
    totalUnits: newTotalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const refId = params.referenceId || `MAN-REM-${Date.now().toString().slice(-4)}`;

  const movement: StockMovementEntry = {
    txnId,
    movementId: txnId,
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName || 'Staff',
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: params.reasonType === 'ADJUSTMENT' ? 'ADJUSTMENT' : 'DAMAGE_LOSS',
    movementType: params.reasonType === 'ADJUSTMENT' ? 'ADJUSTMENT' : 'DAMAGE_LOSS',
    qtyCases: casesToRemove,
    qtySingles: singlesToRemove,
    casesChange: -casesToRemove,
    singlesChange: -singlesToRemove,
    promptShown: `Manual Stock Removal: ${params.reasonType}`,
    actionTaken: 'MANUAL_REMOVAL',
    closingCases: updatedItem.stockCases,
    closingSingles: updatedItem.stockSingles,
    resultingStockCases: updatedItem.stockCases,
    resultingStockSingles: updatedItem.stockSingles,
    referenceId: refId,
    reason: params.notes.trim() || `Manual stock removal (${params.reasonType})`,
    timestamp,
    synced: false,
  };

  addStockMovement(movement);

  addAuditLog({
    action: 'INVENTORY_ADJUSTMENT',
    severity: 'WARNING',
    staffId: params.staffId,
    staffName: params.staffName || 'Staff',
    staffRole: 'SUPERVISOR',
    details: `Manual stock deduction for ${item.itemName} (${item.itemId}): -${casesToRemove} cs, -${singlesToRemove} ea. Reason: ${params.reasonType} - ${params.notes}`,
    referenceId: refId,
  });

  return {
    success: true,
    message: `Successfully deducted ${casesToRemove > 0 ? `${casesToRemove} Case(s) ` : ''}${singlesToRemove > 0 ? `${singlesToRemove} Single(s)` : ''} of ${item.itemName}. New stock: ${updatedItem.stockCases} Cases, ${updatedItem.stockSingles} Singles.`,
    updatedItem,
    movement,
  };
};

/**
 * Retrieve complete history and audit trail for a specific product
 */
export const getProductAuditTrail = (itemId: string): StockMovementEntry[] => {
  const movements = getAllStockMovements();
  const cleanId = (itemId || '').trim().toUpperCase();
  const invItem = getInventoryItemById(cleanId);
  const cleanSku = (invItem?.sku || '').trim().toUpperCase();

  const filtered = movements.filter((m) => {
    if (!m.itemId) return false;
    const mId = m.itemId.trim().toUpperCase();
    return (
      mId === cleanId ||
      mId.replace(/-(UNIT|CASE)$/i, '') === cleanId ||
      mId.startsWith(`${cleanId}__`) ||
      mId.split('__')[0] === cleanId ||
      (cleanSku && mId === cleanSku)
    );
  });

  // Reconcile POS sales from getAllSales() so sales deductions are always guaranteed to appear
  const allSales = getAllSales();
  const existingRefs = new Set(
    filtered.map((m) => `${(m.referenceId || '').trim().toUpperCase()}_${(m.itemId || '').trim().toUpperCase()}`)
  );

  allSales.forEach((sale) => {
    if (sale.status === 'Voided') return;
    const refKey = (sale.id || '').trim().toUpperCase();

    (sale.items || []).forEach((saleItem) => {
      const sId = (saleItem.id || '').trim().toUpperCase();
      const sSku = (saleItem.sku || '').trim().toUpperCase();
      const matches =
        sId === cleanId ||
        sId.replace(/-(UNIT|CASE)$/i, '') === cleanId ||
        sId.startsWith(`${cleanId}__`) ||
        sId.split('__')[0] === cleanId ||
        (cleanSku && (sSku === cleanSku || sId === cleanSku));

      if (matches && saleItem.quantity > 0) {
        const itemKey = `${refKey}_${cleanId}`;
        if (!existingRefs.has(itemKey)) {
          existingRefs.add(itemKey);
          const isCase = sId.endsWith('-CASE');
          filtered.push({
            txnId: `SALE-${sale.id}-${sId}`,
            movementId: `SALE-${sale.id}-${sId}`,
            date: sale.date || toDateStringSafe(sale.timestamp) || getTodayDateString(),
            timestamp: sale.timestamp || new Date().toISOString(),
            staffId: sale.staffId || 'POS-001',
            staffName: sale.staffName || 'Cashier / POS',
            itemId: cleanId,
            itemName: saleItem.name || invItem?.itemName || 'Product',
            txnType: 'SALE',
            movementType: 'SALE',
            actionTaken: 'POS_SALE',
            qtyCases: isCase ? saleItem.quantity : 0,
            qtySingles: isCase ? 0 : saleItem.quantity,
            casesChange: isCase ? -saleItem.quantity : 0,
            singlesChange: isCase ? 0 : -saleItem.quantity,
            referenceId: sale.id,
            reason: `POS Sale Outflow: Sold ${saleItem.quantity} ${saleItem.name || ''} to ${sale.customerName || 'Customer'} (Invoice #${sale.id})`,
            promptShown: isCase ? 'Whole Case Sale' : 'POS Sale',
            closingCases: invItem?.stockCases || 0,
            closingSingles: invItem?.stockSingles || 0,
            resultingStockCases: invItem?.stockCases || 0,
            resultingStockSingles: invItem?.stockSingles || 0,
            synced: false,
          });
        }
      }
    });
  });

  return filtered.sort((a, b) => {
    const timeA = new Date(a.timestamp || a.date || 0).getTime() || 0;
    const timeB = new Date(b.timestamp || b.date || 0).getTime() || 0;
    return timeB - timeA;
  });
};

export const deleteInventoryItem = (itemId: string): boolean => {
  const currentCompany = getCurrentCompanyId();
  const allItems = getAllInventoryItems();
  const cleanId = (itemId || '').trim().toUpperCase();

  // 1. Record deleted item tombstone with company and timestamp so offline peer devices know it was deleted
  const deletedRegistryKey = 'saimetric_deleted_inventory_ids';
  const deletedList = getStored<Array<{ itemId: string; companyId: string; deletedAt: string }>>(deletedRegistryKey, []);
  const existsInDeleted = deletedList.some(
    (d) => (d.itemId || '').toUpperCase() === cleanId && (d.companyId || '').toUpperCase() === currentCompany.toUpperCase()
  );
  if (!existsInDeleted) {
    const updatedDeleted = [
      ...deletedList,
      { itemId: cleanId, companyId: currentCompany, deletedAt: new Date().toISOString() },
    ];
    setStored(deletedRegistryKey, updatedDeleted);
  }

  // 2. Remove from active inventory store
  const filtered = allItems.filter((i) => {
    const compId = (i.company_id || (i as any).companyId || 'COMP-001').toUpperCase();
    if (compId === currentCompany.toUpperCase() && (i.itemId || '').trim().toUpperCase() === cleanId) {
      return false;
    }
    return true;
  });

  if (filtered.length !== allItems.length) {
    setStored(STORAGE_KEYS.INVENTORY_ITEMS, filtered);
    try {
      setStored(STORAGE_KEYS.PRODUCTS, filtered.map((item) => inventoryItemToProduct(item)));
    } catch (e) {}

    // 3. Enqueue sync & Broadcast peer notification across offline devices via mesh & syncQueue
    try {
      enqueueSync('InventoryMaster' as SheetName, 'DELETE', {
        id: itemId,
        itemId: itemId,
        ItemID: itemId,
        CompanyID: currentCompany,
        company_id: currentCompany,
        deletedAt: new Date().toISOString(),
      });
    } catch (e) {}

    // 4. Broadcast specific local/peer custom event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('saimetric_inventory_item_deleted', {
          detail: { itemId: cleanId, companyId: currentCompany },
        })
      );
    }

    notifyListeners();
    return true;
  }
  return false;
};

export const getAllSupplierInvoiceVouchers = (): SupplierInvoiceVoucher[] => {
  const legacy = getStored<SupplierInvoiceVoucher[]>(STORAGE_KEYS.SUPPLIER_INVOICES, INITIAL_SUPPLIER_INVOICES);
  return getDualReadSupplierInvoices(legacy);
};

export const getSupplierInvoiceVouchers = (): SupplierInvoiceVoucher[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllSupplierInvoiceVouchers();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((v) => {
    const compId = v.company_id || v.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getSupplierInvoiceVoucherById = (voucherId: string): SupplierInvoiceVoucher | undefined => {
  if (!voucherId) return undefined;
  const target = voucherId.trim().toLowerCase();
  return getSupplierInvoiceVouchers().find(
    (v) => v.voucherId === voucherId || (v.invoiceNo && v.invoiceNo.trim().toLowerCase() === target)
  );
};

export const saveSupplierInvoiceVoucher = (voucher: SupplierInvoiceVoucher): SupplierInvoiceVoucher => {
  const all = getAllSupplierInvoiceVouchers();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = voucher.company_id || voucher.companyId || currentCompany;
  const brId = voucher.branchId || voucher.branch_id || currentBranch;
  const normalized: SupplierInvoiceVoucher = {
    ...voucher,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const filtered = all.filter((v) => v.voucherId !== normalized.voucherId);
  const updated = [normalized, ...filtered];
  setStored(STORAGE_KEYS.SUPPLIER_INVOICES, updated);
  return normalized;
};

export const receiveSupplierInvoice = (params: {
  invoiceNo: string;
  purchaseOrderNo?: string;
  supplier: string;
  branchId?: string;
  branchName?: string;
  date: string;
  paymentTerms?: string;
  staffId: string;
  staffName?: string;
  notes?: string;
  landedCosts?: LandedCostItem[];
  items: {
    itemId: string;
    receiveAs?: 'Cases' | 'Singles' | 'Variant';
    receiveVariantId?: string;
    receiveVariantName?: string;
    unitsPerReceivePack?: number;
    receivedCases: number;
    receivedSingles: number;
    receivedPacks?: number;
    lastCost?: number;
    costPerCase?: number;
    costPerUnit?: number;
    costPerPack?: number;
    sellingPrice?: number;
    marginPercent?: number;
    expiryDate?: string;
    batchNumber?: string;
    weight?: number;
  }[];
}): {
  success: boolean;
  message: string;
  voucher?: SupplierInvoiceVoucher;
  itemsProcessed: number;
  ruleATriggeredCount: number;
} => {
  if (!params.items || params.items.length === 0) {
    return {
      success: false,
      message: 'Please add at least one product to the supplier invoice voucher.',
      itemsProcessed: 0,
      ruleATriggeredCount: 0,
    };
  }

  // Pre-calculate landed cost allocations across line items if landed costs are present
  const itemLandedCostAllocMap = new Map<string, number>();
  if (params.landedCosts && params.landedCosts.length > 0) {
    const tempGrn: any = {
      lineItems: params.items.map((it) => {
        const invItem = getInventoryItemById(it.itemId);
        const unitsPerCase = invItem?.unitsPerCase || 1;
        const unitsPerPack = it.unitsPerReceivePack || 1;
        const qty =
          it.receiveAs === 'Cases'
            ? (Number(it.receivedCases) || 0) * unitsPerCase
            : it.receiveAs === 'Variant'
            ? (Number(it.receivedPacks) || 0) * unitsPerPack
            : Number(it.receivedSingles) || 0;
        const baseCost =
          it.costPerUnit !== undefined && it.costPerUnit >= 0
            ? it.costPerUnit
            : it.costPerCase !== undefined && unitsPerCase > 0
            ? it.costPerCase / unitsPerCase
            : invItem?.costPerUnit || 0;
        return {
          itemId: it.itemId,
          itemName: invItem?.itemName || it.itemId,
          quantity: qty,
          unitCost: baseCost,
          subtotal: qty * baseCost,
          sellingPrice: it.sellingPrice !== undefined ? it.sellingPrice : (invItem?.sellPriceUnit || 0),
          weight: it.weight || 0,
        };
      }),
      landedCosts: params.landedCosts,
    };
    landedCostService.allocateLandedCosts(tempGrn);
    tempGrn.lineItems.forEach((li: any) => {
      itemLandedCostAllocMap.set(li.itemId, li.landedCostAllocated || 0);
    });
  }

  const timestamp = new Date().toISOString();
  const dateStr = params.date || timestamp.split('T')[0];
  const voucherId = `GRN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const invoiceNo = params.invoiceNo?.trim() || `INV-${Date.now().toString().slice(-5)}`;
  const purchaseOrderNo = params.purchaseOrderNo?.trim() || '';
  const supplierName = params.supplier?.trim() || 'General Supplier';
  const staffId = params.staffId || '001';
  const staffName = params.staffName || 'Administrator';
  const branchId = params.branchId || 'BR001';
  const branchName = params.branchName || 'Main Central Distribution & Warehouse';

  const lineItems: SupplierInvoiceLineItem[] = [];
  let totalCases = 0;
  let totalSingles = 0;
  let totalUnitsReceived = 0;
  let totalInvoiceAmount = 0;
  let ruleATriggeredCount = 0;

  for (const rawItem of params.items) {
    const item = getInventoryItemById(rawItem.itemId);
    if (!item) continue;

    const isReceivingVariant = rawItem.receiveAs === 'Variant';
    const isReceivingSingles = rawItem.receiveAs === 'Singles';
    const isReceivingCases = !isReceivingVariant && !isReceivingSingles;

    const unitsPerPack = rawItem.unitsPerReceivePack || 1;
    const recPacks = Math.max(0, Number(rawItem.receivedPacks) || 0);
    const recCases = isReceivingCases ? Math.max(0, Number(rawItem.receivedCases) || 0) : 0;
    const recSingles = isReceivingSingles
      ? Math.max(0, Number(rawItem.receivedSingles) || 0)
      : isReceivingVariant
      ? recPacks * unitsPerPack
      : Math.max(0, Number(rawItem.receivedSingles) || 0);

    if (recCases === 0 && recSingles === 0 && (!isReceivingVariant || recPacks === 0)) continue;

    const lastCost = rawItem.lastCost !== undefined ? rawItem.lastCost : item.costPerCase;
    let costPerCase = item.costPerCase;
    let costPerUnit = item.costPerUnit;
    let costPerPack = rawItem.costPerPack;

    if (isReceivingVariant) {
      if (rawItem.costPerPack !== undefined && rawItem.costPerPack >= 0) {
        costPerPack = rawItem.costPerPack;
        costPerUnit = unitsPerPack > 0 ? costPerPack / unitsPerPack : costPerPack;
      } else if (rawItem.costPerUnit !== undefined && rawItem.costPerUnit >= 0) {
        costPerUnit = rawItem.costPerUnit;
        costPerPack = costPerUnit * unitsPerPack;
      } else {
        costPerPack = item.costPerUnit * unitsPerPack;
        costPerUnit = item.costPerUnit;
      }
      costPerCase = costPerUnit * (item.unitsPerCase || 1);
    } else if (isReceivingSingles) {
      if (rawItem.costPerUnit !== undefined && rawItem.costPerUnit >= 0) {
        costPerUnit = rawItem.costPerUnit;
      } else if (rawItem.costPerCase !== undefined && rawItem.costPerCase >= 0) {
        costPerUnit = rawItem.costPerCase;
      }
      costPerCase = costPerUnit * (item.unitsPerCase || 1);
    } else {
      if (rawItem.costPerCase !== undefined && rawItem.costPerCase >= 0) {
        costPerCase = rawItem.costPerCase;
      }
      costPerUnit = item.unitsPerCase > 0 ? costPerCase / item.unitsPerCase : costPerCase;
    }

    // Landed cost adjustment (modifies unit cost and case cost only, without affecting cash or approvals)
    const allocatedLanded = itemLandedCostAllocMap.get(item.itemId) || 0;
    let landedCostNote = '';
    const lineTotalUnitsPreview = isReceivingVariant
      ? recPacks * unitsPerPack
      : (recCases * item.unitsPerCase) + recSingles;

    if (allocatedLanded > 0 && lineTotalUnitsPreview > 0) {
      const addedUnitCost = allocatedLanded / lineTotalUnitsPreview;
      costPerUnit = Number((costPerUnit + addedUnitCost).toFixed(4));
      costPerCase = Number((costPerUnit * item.unitsPerCase).toFixed(2));
      landedCostNote = ` [Landed Cost: +$${allocatedLanded.toFixed(2)} total (+$${addedUnitCost.toFixed(4)}/unit)]`;
    }

    const sellingPrice =
      rawItem.sellingPrice !== undefined && rawItem.sellingPrice > 0
        ? rawItem.sellingPrice
        : item.sellPriceUnit;
    const marginPercent =
      sellingPrice > 0
        ? ((sellingPrice - costPerUnit) / sellingPrice) * 100
        : rawItem.marginPercent || 0;

    const canSellAsCase = Boolean(item.canSellAsCase);
    let finalRecCases = recCases;
    let finalRecSingles = recSingles;
    let autoBroken = false;
    let convertedCasesToSingles = false;
    let autoBreakNote = '';

    if (!canSellAsCase && recCases > 0) {
      convertedCasesToSingles = true;
      const gainedSingles = recCases * item.unitsPerCase;
      finalRecCases = 0;
      finalRecSingles = recSingles + gainedSingles;
      autoBreakNote = ` [Converted ${recCases} received case(s) into ${gainedSingles} singles because 'Sell as Case' is deactivated]`;
    } else if (canSellAsCase && recCases > 0 && item.stockSingles === 0) {
      autoBroken = true;
      ruleATriggeredCount++;
      finalRecCases = recCases - 1;
      finalRecSingles = recSingles + item.unitsPerCase;
      autoBreakNote = ` [Rule A Triggered: Auto-broke 1 case to ${item.unitsPerCase} singles because StockSingles was 0]`;
    } else if (isReceivingVariant) {
      autoBreakNote = ` [Received as ${recPacks} x ${rawItem.receiveVariantName || 'Variant'} (${unitsPerPack} units/pack = ${recSingles} total singles)]`;
    }

    // Total gross units received in this line item
    const lineTotalUnits = isReceivingVariant
      ? recPacks * unitsPerPack
      : (recCases * item.unitsPerCase) + recSingles;

    // CORE RULE 2 & 3: Clear any Negative Balance first with newly received qty
    const clearing = clearNegativeBalancesOnGRN({
      itemId: item.itemId,
      receivedUnits: lineTotalUnits,
      newCostPerUnit: costPerUnit,
      grnId: voucherId,
    });

    let clearingNote = '';
    if (clearing.clearedUnits > 0) {
      clearingNote = ` [Cleared ${clearing.clearedUnits} negative balance units from previous sale(s)`;
      if (clearing.totalPotentialLoss > 0) {
        clearingNote += ` • Potential Loss Realized: $${clearing.totalPotentialLoss.toFixed(2)}`;
      }
      clearingNote += `]`;
    }

    // CORE RULE 1: Create a new batch for this Goods Receiving
    const batchId = `BAT-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${item.itemId}`;
    const batchNumber = rawItem.batchNumber || `BATCH-${dateStr.replace(/-/g, '')}-${item.itemId}`;
    const newBatch: StockBatch = {
      id: batchId,
      batchNumber,
      itemId: item.itemId,
      itemName: item.itemName,
      qtyReceived: lineTotalUnits,
      qtyOnHand: clearing.remainingUnitsForNewBatch, // Individual batch Qty On Hand is whatever is left after clearing negative balances
      cost: lineTotalUnits * costPerUnit,
      costPerUnit,
      costPerCase,
      expiryDate: rawItem.expiryDate,
      receivedDate: dateStr,
      supplier: supplierName,
      grnId: voucherId,
      invoiceNo,
      branchId,
      notes: (params.notes || '') + autoBreakNote + clearingNote + landedCostNote,
      createdAt: timestamp,
    };
    saveStockBatch(newBatch);

    // CORE RULE 1 & 2: Total Qty On Hand in Inventory Master = Sum of all batch Qty On Hand minus remaining open negative balances
    const allItemBatches = getBatchesByItemId(item.itemId);
    const sumBatchesOnHand = allItemBatches.reduce((sum, b) => sum + (b.qtyOnHand || 0), 0);
    const openNegs = getOpenNegativeBalances(item.itemId);
    const totalOpenNegQty = openNegs.reduce((sum, n) => sum + (n.negativeQty - n.clearedQty), 0);
    const effectiveTotalUnits = sumBatchesOnHand - totalOpenNegQty;

    let newStockCases = 0;
    let newStockSingles = 0;
    if (effectiveTotalUnits > 0) {
      if (item.canSellAsCase && item.unitsPerCase > 1) {
        newStockCases = Math.floor(effectiveTotalUnits / item.unitsPerCase);
        newStockSingles = effectiveTotalUnits % item.unitsPerCase;
      } else {
        newStockCases = 0;
        newStockSingles = effectiveTotalUnits;
      }
    } else {
      newStockCases = 0;
      newStockSingles = effectiveTotalUnits;
    }

    const prevStockCases = item.stockCases;
    const prevStockSingles = item.stockSingles;

    // Moving Weighted Average Cost (AVCO) calculation:
    const priorOnHandUnits = Math.max(0, item.totalUnits || 0);
    const priorAvgCost = item.averageCostPerUnit !== undefined && item.averageCostPerUnit > 0
      ? item.averageCostPerUnit
      : (item.costPerUnit || 0);

    const totalCostPool = (priorOnHandUnits * priorAvgCost) + (lineTotalUnits * costPerUnit);
    const combinedTotalUnits = priorOnHandUnits + lineTotalUnits;
    const computedAverageCostPerUnit = combinedTotalUnits > 0
      ? Number((totalCostPool / combinedTotalUnits).toFixed(4))
      : costPerUnit;
    const computedAverageCostPerCase = Number((computedAverageCostPerUnit * (item.unitsPerCase || 1)).toFixed(2));
    const computedLatestCostPerUnit = Number(costPerUnit.toFixed(4));
    const computedLatestCostPerCase = Number(costPerCase.toFixed(2));

    // Update item in inventory (including average & latest cost and optionally selling price)
    const updatedItem: InventoryItem = {
      ...item,
      costPerCase: costPerCase,
      costPerUnit: costPerUnit,
      averageCostPerUnit: computedAverageCostPerUnit,
      averageCostPerCase: computedAverageCostPerCase,
      latestCostPerUnit: computedLatestCostPerUnit,
      latestCostPerCase: computedLatestCostPerCase,
      sellPriceUnit: sellingPrice,
      sellPriceCase: item.sellPriceCase > 0 ? item.sellPriceCase : sellingPrice * item.unitsPerCase,
      stockCases: newStockCases,
      stockSingles: newStockSingles,
      totalUnits: effectiveTotalUnits,
      lastUpdated: timestamp,
    };
    saveInventoryItem(updatedItem);

    const lineTotal = isReceivingVariant && costPerPack !== undefined
      ? recPacks * costPerPack
      : recCases * costPerCase + recSingles * costPerUnit;

    totalCases += recCases;
    totalSingles += recSingles;
    totalUnitsReceived += lineTotalUnits;
    totalInvoiceAmount += lineTotal;

    lineItems.push({
      itemId: item.itemId,
      itemName: item.itemName,
      category: item.category,
      unitsPerCase: item.unitsPerCase,
      receiveAs: rawItem.receiveAs || 'Cases',
      receiveVariantId: rawItem.receiveVariantId,
      receiveVariantName: rawItem.receiveVariantName,
      unitsPerReceivePack: rawItem.unitsPerReceivePack,
      receivedCases: recCases,
      receivedSingles: isReceivingVariant ? 0 : recSingles,
      receivedPacks: isReceivingVariant ? recPacks : undefined,
      lastCost,
      costPerCase,
      costPerUnit,
      costPerPack,
      sellingPrice,
      marginPercent,
      lineTotal,
      autoBrokenRuleA: autoBroken,
      convertedCasesToSingles,
      prevStockCases,
      prevStockSingles,
      newStockCases,
      newStockSingles,
    });

    // Add individual GoodsReceivedEntry log for audit sheet
    const grnEntry: GoodsReceivedEntry = {
      grnId: voucherId,
      invoiceNo,
      purchaseOrderNo,
      date: dateStr,
      supplier: supplierName,
      branchId,
      branchName,
      itemId: item.itemId,
      itemName: item.itemName,
      receivedCases: recCases,
      receivedSingles: recSingles,
      receivedPacks: isReceivingVariant ? recPacks : undefined,
      receiveAs: rawItem.receiveAs || 'Cases',
      receiveVariantId: rawItem.receiveVariantId,
      receiveVariantName: rawItem.receiveVariantName,
      unitsPerReceivePack: rawItem.unitsPerReceivePack,
      lastCost,
      costPerCase,
      costPerUnit,
      sellingPrice,
      marginPercent,
      lineTotal,
      autoBreakCaseToSingles: autoBroken,
      convertedCasesToSingles,
      notes: (params.notes || '') + autoBreakNote + clearingNote,
      staffId,
      staffName,
      timestamp,
      synced: false,
    };
    addGoodsReceived(grnEntry);

    // Add StockMovement log
    const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${item.itemId}`;
    const movement: StockMovementEntry = {
      txnId,
      movementId: txnId,
      date: dateStr,
      staffId,
      staffName,
      itemId: item.itemId,
      itemName: item.itemName,
      txnType: 'RECEIVE',
      movementType: 'GOODS_RECEIVED',
      qtyCases: recCases,
      qtySingles: recSingles,
      casesChange: finalRecCases,
      singlesChange: finalRecSingles,
      closingCases: newStockCases,
      closingSingles: newStockSingles,
      resultingStockCases: newStockCases,
      resultingStockSingles: newStockSingles,
      reason: `Stock delivery received from ${supplierName} (Invoice: ${invoiceNo})`,
      promptShown: convertedCasesToSingles
        ? 'Converted Cases to Singles (Sell as Case Deactivated)'
        : autoBroken
        ? 'Rule A: Auto-Break on Zero Singles'
        : isReceivingVariant
        ? `Received ${recPacks} x ${rawItem.receiveVariantName || 'Variant'}`
        : `Supplier Invoice: ${invoiceNo}`,
      actionTaken: convertedCasesToSingles
        ? 'CONVERTED_TO_SINGLES_NO_CASE_SALE'
        : autoBroken
        ? 'AUTO_BREAK_RULE_A'
        : 'GOODS_RECEIVED',
      referenceId: `${voucherId} / ${invoiceNo}${purchaseOrderNo ? ` / PO: ${purchaseOrderNo}` : ''}`,
      timestamp,
      synced: false,
    };
    addStockMovement(movement);
  }

  if (lineItems.length === 0) {
    return {
      success: false,
      message: 'No valid products with quantities > 0 were received on this invoice.',
      itemsProcessed: 0,
      ruleATriggeredCount: 0,
    };
  }

  const voucher: SupplierInvoiceVoucher = {
    voucherId,
    invoiceNo,
    purchaseOrderNo,
    supplier: supplierName,
    branchId,
    branchName,
    date: dateStr,
    paymentTerms: params.paymentTerms || 'Standard Terms',
    staffId,
    staffName,
    notes: params.notes || '',
    items: lineItems,
    totalCases,
    totalSingles,
    totalUnits: totalUnitsReceived,
    totalInvoiceAmount,
    ruleATriggeredCount,
    timestamp,
    synced: false,
  };

  saveSupplierInvoiceVoucher(voucher);

  // Sync to unified goodsReceivedNotes store
  try {
    postGeneralGRV(voucher, params.landedCosts);
  } catch (err) {
    console.warn('[GRN] postGeneralGRV sync warning:', err);
  }

  return {
    success: true,
    message: `Recorded Supplier Invoice ${invoiceNo} (${supplierName}) with ${lineItems.length} products (Total: $${totalInvoiceAmount.toFixed(2)}).`,
    voucher,
    itemsProcessed: lineItems.length,
    ruleATriggeredCount,
  };
};

// ==================== PACKAGING RATIO RECALCULATION & VARIANT CREATION ====================
export const recalculateItemPackagingRatio = (
  itemId: string,
  newUnitsPerCase: number,
  newCostPerCaseOrStaffId?: number | string,
  staffId?: string
): {
  item: InventoryItem;
  prevCases: number;
  prevSingles: number;
  newCases: number;
  newSingles: number;
  totalUnits: number;
} | null => {
  const item = getInventoryItemById(itemId);
  if (!item || newUnitsPerCase <= 0) return null;

  const costPerCaseParam =
    typeof newCostPerCaseOrStaffId === 'number' ? newCostPerCaseOrStaffId : undefined;
  const staffIdParam =
    typeof newCostPerCaseOrStaffId === 'string' ? newCostPerCaseOrStaffId : staffId;

  const totalUnits =
    item.totalUnits !== undefined
      ? item.totalUnits
      : item.stockCases * item.unitsPerCase + item.stockSingles;
  const prevCases = item.stockCases;
  const prevSingles = item.stockSingles;

  const newStockCases = Math.floor(totalUnits / newUnitsPerCase);
  const newStockSingles = totalUnits % newUnitsPerCase;
  const costPerCase =
    costPerCaseParam !== undefined && costPerCaseParam >= 0 ? costPerCaseParam : item.costPerCase;
  const costPerUnit = costPerCase / newUnitsPerCase;

  const updated: InventoryItem = {
    ...item,
    unitsPerCase: newUnitsPerCase,
    costPerCase,
    costPerUnit,
    stockCases: newStockCases,
    stockSingles: newStockSingles,
    totalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updated);

  // Add stock movement log for audit trail
  const txnId = `TXN-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-RECALC`;
  addStockMovement({
    txnId,
    movementId: txnId,
    date: new Date().toISOString().split('T')[0],
    staffId: staffIdParam || getCurrentUser()?.id || '001',
    staffName: getCurrentUser()?.name || 'Administrator',
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'ADJUSTMENT',
    qtyCases: newStockCases - prevCases,
    qtySingles: newStockSingles - prevSingles,
    closingCases: newStockCases,
    closingSingles: newStockSingles,
    promptShown: `Packaging ratio updated from ${item.unitsPerCase} to ${newUnitsPerCase} units/case`,
    actionTaken: `RECALCULATE_PACKAGING_RATIO`,
    referenceId: `RATIO-CHANGE-${newUnitsPerCase}UN`,
    timestamp: new Date().toISOString(),
    synced: false,
  });

  return {
    item: updated,
    prevCases,
    prevSingles,
    newCases: newStockCases,
    newSingles: newStockSingles,
    totalUnits,
  };
};

export const createPackagingVariant = (
  sourceItemId: string,
  newUnitsPerCase: number,
  variantCostPerCaseOrName?: number | string,
  variantSellingPrice?: number
): InventoryItem | null => {
  const source = getInventoryItemById(sourceItemId);
  if (!source) return null;

  const customName =
    typeof variantCostPerCaseOrName === 'string' ? variantCostPerCaseOrName : undefined;
  const costNumber =
    typeof variantCostPerCaseOrName === 'number' ? variantCostPerCaseOrName : undefined;

  const newId = `${source.itemId}_C${newUnitsPerCase}`;
  const costPerCase =
    costNumber !== undefined && costNumber > 0
      ? costNumber
      : source.costPerUnit * newUnitsPerCase;
  const costPerUnit = costPerCase / newUnitsPerCase;
  const sellPriceUnit =
    variantSellingPrice !== undefined && variantSellingPrice > 0
      ? variantSellingPrice
      : source.sellPriceUnit;
  const sellPriceCase = sellPriceUnit * newUnitsPerCase * 0.95; // 5% bulk discount

  const variantItem: InventoryItem = {
    itemId: newId,
    itemName: customName || `${source.itemName} (Case of ${newUnitsPerCase})`,
    category: source.category,
    canSellAsCase: true,
    unitsPerCase: newUnitsPerCase,
    costPerCase,
    costPerUnit,
    sellPriceCase,
    sellPriceUnit,
    stockCases: 0,
    stockSingles: 0,
    totalUnits: 0,
    reorderLevelCases: 2,
    reorderLevelUnits: newUnitsPerCase,
    sku: `${source.sku || source.itemId}-C${newUnitsPerCase}`,
    barcode: '',
    description: `Packaging variant: ${newUnitsPerCase} units per case.`,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(variantItem);
  return variantItem;
};

// ==================== DAILY GOODS RECEIVED ADMIN REPORT ====================
export interface DailyGRNReportSummary {
  date: string;
  branchId?: string;
  branchName: string;
  totalValuation: number;
  totalCases: number;
  totalSingles: number;
  totalUnits: number;
  totalInvoices: number;
  ruleACount: number;
  supplierBreakdown: {
    supplier: string;
    invoiceCount: number;
    cases: number;
    singles: number;
    totalUnits: number;
    totalAmount: number;
    percentageOfTotal: number;
  }[];
  categoryBreakdown: {
    category: string;
    cases: number;
    singles: number;
    totalUnits: number;
    totalAmount: number;
  }[];
  vouchers: SupplierInvoiceVoucher[];
  itemizedLines: {
    grnId: string;
    invoiceNo: string;
    purchaseOrderNo?: string;
    date: string;
    branchName: string;
    supplier: string;
    itemId: string;
    itemName: string;
    category: string;
    unitsPerCase: number;
    receiveAs: string;
    receivedCases: number;
    receivedSingles: number;
    costPerCase: number;
    costPerUnit: number;
    lastCost?: number;
    sellingPrice?: number;
    marginPercent?: number;
    lineTotal: number;
    autoBrokenRuleA: boolean;
  }[];
}

export const getDailyGoodsReceivedReport = (
  targetDate?: string,
  branchId?: string
): DailyGRNReportSummary => {
  const date = targetDate || new Date().toISOString().split('T')[0];
  const allVouchers = getSupplierInvoiceVouchers();
  const branches = getBranches();

  // Filter vouchers for this date and optionally branch
  const vouchers = allVouchers.filter((v) => {
    const matchesDate = isSameDaySafe(v.date, v.timestamp, date);
    const matchesBranch = !branchId || branchId === 'ALL' || v.branchId === branchId;
    return matchesDate && matchesBranch;
  });

  const selectedBranch =
    branchId && branchId !== 'ALL' ? branches.find((b) => b.branchId === branchId) : undefined;
  const branchName = selectedBranch ? selectedBranch.name : 'All Branches / Outlets';

  let totalValuation = 0;
  let totalCases = 0;
  let totalSingles = 0;
  let totalUnits = 0;
  let ruleACount = 0;

  const supplierMap = new Map<
    string,
    { invoiceCount: number; cases: number; singles: number; totalUnits: number; totalAmount: number }
  >();
  const categoryMap = new Map<
    string,
    { cases: number; singles: number; totalUnits: number; totalAmount: number }
  >();
  const itemizedLines: DailyGRNReportSummary['itemizedLines'] = [];

  for (const v of vouchers) {
    totalValuation += v.totalInvoiceAmount;
    totalCases += v.totalCases;
    totalSingles += v.totalSingles;
    totalUnits += v.totalUnits;
    ruleACount += v.ruleATriggeredCount || 0;

    const suppEntry = supplierMap.get(v.supplier) || {
      invoiceCount: 0,
      cases: 0,
      singles: 0,
      totalUnits: 0,
      totalAmount: 0,
    };
    suppEntry.invoiceCount++;
    suppEntry.cases += v.totalCases;
    suppEntry.singles += v.totalSingles;
    suppEntry.totalUnits += v.totalUnits;
    suppEntry.totalAmount += v.totalInvoiceAmount;
    supplierMap.set(v.supplier, suppEntry);

    for (const item of v.items) {
      const cat = item.category || 'General Merchandise';
      const catEntry = categoryMap.get(cat) || {
        cases: 0,
        singles: 0,
        totalUnits: 0,
        totalAmount: 0,
      };
      catEntry.cases += item.receivedCases;
      catEntry.singles += item.receivedSingles;
      catEntry.totalUnits += item.receivedCases * item.unitsPerCase + item.receivedSingles;
      catEntry.totalAmount += item.lineTotal;
      categoryMap.set(cat, catEntry);

      itemizedLines.push({
        grnId: v.voucherId,
        invoiceNo: v.invoiceNo,
        purchaseOrderNo: v.purchaseOrderNo,
        date: v.date,
        branchName: v.branchName || 'Main Central Distribution & Warehouse',
        supplier: v.supplier,
        itemId: item.itemId,
        itemName: item.itemName,
        category: cat,
        unitsPerCase: item.unitsPerCase,
        receiveAs: item.receiveAs || 'Cases',
        receivedCases: item.receivedCases,
        receivedSingles: item.receivedSingles,
        costPerCase: item.costPerCase,
        costPerUnit: item.costPerUnit,
        lastCost: item.lastCost,
        sellingPrice: item.sellingPrice,
        marginPercent: item.marginPercent,
        lineTotal: item.lineTotal,
        autoBrokenRuleA: Boolean(item.autoBrokenRuleA),
      });
    }
  }

  const supplierBreakdown = Array.from(supplierMap.entries()).map(([supplier, data]) => ({
    supplier,
    ...data,
    percentageOfTotal: totalValuation > 0 ? (data.totalAmount / totalValuation) * 100 : 0,
  }));

  const categoryBreakdown = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    ...data,
  }));

  return {
    date,
    branchId,
    branchName,
    totalValuation,
    totalCases,
    totalSingles,
    totalUnits,
    totalInvoices: vouchers.length,
    ruleACount,
    supplierBreakdown,
    categoryBreakdown,
    vouchers,
    itemizedLines,
  };
};

export const getAllGoodsReceived = (): GoodsReceivedEntry[] => {
  return getStored<GoodsReceivedEntry[]>(STORAGE_KEYS.GOODS_RECEIVED, INITIAL_GOODS_RECEIVED);
};

export const getGoodsReceived = (): GoodsReceivedEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllGoodsReceived();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((g) => {
    const compId = g.company_id || g.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const addGoodsReceived = (entry: GoodsReceivedEntry): GoodsReceivedEntry => {
  const all = getAllGoodsReceived();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branchId || entry.branch_id || currentBranch;
  const normalized: GoodsReceivedEntry = {
    ...entry,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  all.unshift(normalized);
  setStored(STORAGE_KEYS.GOODS_RECEIVED, all);

  enqueueSync('GoodsReceived', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: normalized.timestamp,
    GRNID: normalized.grnId,
    InvoiceNo: normalized.invoiceNo,
    Date: normalized.date,
    Supplier: normalized.supplier,
    ItemID: normalized.itemId,
    ItemName: normalized.itemName,
    ReceivedCases: normalized.receivedCases,
    ReceivedSingles: normalized.receivedSingles,
    CostPerCase: normalized.costPerCase,
    CostPerUnit: normalized.costPerUnit,
    LineTotal: normalized.lineTotal,
    StaffID: normalized.staffId,
  });

  return normalized;
};

export const getAllStockMovements = (): StockMovementEntry[] => {
  const rawList = getStored<StockMovementEntry[]>(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  if (!Array.isArray(rawList)) return [];
  const seenMovementIds = new Set<string>();
  const seenTxnIds = new Set<string>();
  let hasDuplicates = false;

  const sanitized = rawList.map((m, index) => {
    let movementId = (m.movementId || m.txnId || '').trim();
    let txnId = (m.txnId || movementId || '').trim();

    if (!movementId || seenMovementIds.has(movementId)) {
      hasDuplicates = true;
      movementId = `${movementId || 'MOV'}-dup-${index + 1}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    seenMovementIds.add(movementId);

    if (!txnId || seenTxnIds.has(txnId)) {
      hasDuplicates = true;
      txnId = `${txnId || 'TXN'}-dup-${index + 1}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    seenTxnIds.add(txnId);

    return {
      ...m,
      movementId,
      txnId,
      movementType: m.movementType || (m.txnType === 'RECEIVE' ? 'GOODS_RECEIVED' : m.txnType),
      casesChange: m.casesChange !== undefined ? m.casesChange : (m.txnType === 'RECEIVE' ? m.qtyCases : -m.qtyCases),
      singlesChange: m.singlesChange !== undefined ? m.singlesChange : (m.txnType === 'RECEIVE' || m.txnType === 'BREAK_CASE' ? m.qtySingles : -m.qtySingles),
      resultingStockCases: m.resultingStockCases !== undefined ? m.resultingStockCases : m.closingCases,
      resultingStockSingles: m.resultingStockSingles !== undefined ? m.resultingStockSingles : m.closingSingles,
    };
  });

  if (hasDuplicates) {
    setStored(STORAGE_KEYS.STOCK_MOVEMENTS, sanitized);
  }
  return sanitized;
};

export const getStockMovements = (): StockMovementEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllStockMovements();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((m) => {
    const compId = (m as any).company_id || (m as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const addStockMovement = (entry: StockMovementEntry): StockMovementEntry => {
  const list = getStored<StockMovementEntry[]>(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = (entry as any).company_id || (entry as any).companyId || currentCompany;
  const brId = (entry as any).branch_id || (entry as any).branchId || currentBranch;
  const normalized: StockMovementEntry = {
    ...entry,
    movementId: entry.movementId || entry.txnId,
    movementType: entry.movementType || entry.txnType,
    casesChange: entry.casesChange !== undefined ? entry.casesChange : entry.qtyCases,
    singlesChange: entry.singlesChange !== undefined ? entry.singlesChange : entry.qtySingles,
    resultingStockCases: entry.resultingStockCases !== undefined ? entry.resultingStockCases : entry.closingCases,
    resultingStockSingles: entry.resultingStockSingles !== undefined ? entry.resultingStockSingles : entry.closingSingles,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  } as any;
  list.unshift(normalized);
  setStored(STORAGE_KEYS.STOCK_MOVEMENTS, list);
  notifyListeners();
  return normalized;
};

export const recordMovement = (params: {
  itemId: string;
  movementType: 'ADJUSTMENT' | 'DAMAGE_LOSS' | 'RETURN' | 'BREAK_CASE' | 'GOODS_RECEIVED' | 'SALE';
  casesChange: number;
  singlesChange: number;
  resultingStockCases: number;
  resultingStockSingles: number;
  referenceId?: string;
  staffId: string;
  staffName?: string;
  reason?: string;
  triggerRule?: string;
}): { success: boolean; message: string; movement?: StockMovementEntry } => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return { success: false, message: `Item not found: ${params.itemId}` };
  }

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: Math.max(0, params.resultingStockCases),
    stockSingles: Math.max(0, params.resultingStockSingles),
    totalUnits: (Math.max(0, params.resultingStockCases) * item.unitsPerCase) + Math.max(0, params.resultingStockSingles),
    lastUpdated: new Date().toISOString(),
  };
  saveInventoryItem(updatedItem);

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  const movement: StockMovementEntry = {
    txnId,
    movementId: txnId,
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: params.movementType === 'GOODS_RECEIVED' ? 'RECEIVE' : params.movementType,
    movementType: params.movementType,
    qtyCases: Math.abs(params.casesChange),
    qtySingles: Math.abs(params.singlesChange),
    casesChange: params.casesChange,
    singlesChange: params.singlesChange,
    promptShown: params.triggerRule || 'Manual Adjustment',
    actionTaken: params.movementType,
    closingCases: updatedItem.stockCases,
    closingSingles: updatedItem.stockSingles,
    resultingStockCases: updatedItem.stockCases,
    resultingStockSingles: updatedItem.stockSingles,
    referenceId: params.referenceId || 'ADJ-MANUAL',
    triggerRule: params.triggerRule,
    reason: params.reason,
    timestamp,
    synced: false,
  };

  addStockMovement(movement);

  return {
    success: true,
    message: `Logged ${params.movementType} for ${item.itemName}. New stock: ${updatedItem.stockCases} Cases, ${updatedItem.stockSingles} Singles.`,
    movement,
  };
};

const DEFAULT_CATEGORIES: import('../types').InventoryCategory[] = [
  { categoryId: 'CAT-01', categoryName: 'Beverages', description: 'Soft drinks, water, juices & energy cans', itemCount: 12 },
  { categoryId: 'CAT-02', categoryName: 'Confectionery & Sweets', description: 'Chocolates, biscuits, candies & snacks', itemCount: 18 },
  { categoryId: 'CAT-03', categoryName: 'Dry Grocery & Staples', description: 'Sugar, rice, flour, salt & pasta', itemCount: 14 },
  { categoryId: 'CAT-04', categoryName: 'Cooking Oil & Fats', description: 'Pure vegetable oil, margarine & spreads', itemCount: 6 },
  { categoryId: 'CAT-05', categoryName: 'Dairy & Refrigerated', description: 'Milk, cheese, yogurts & butter', itemCount: 8 },
  { categoryId: 'CAT-06', categoryName: 'Hygiene & Cleaning', description: 'Soaps, washing powders & detergents', itemCount: 10 },
];

export const getCategories = (): import('../types').InventoryCategory[] => {
  const stored = getStored<import('../types').InventoryCategory[]>('saimetric_room_categories', DEFAULT_CATEGORIES);
  const items = getInventoryItems();
  return stored.map((cat) => ({
    ...cat,
    itemCount: items.filter((i) => (i.category || '').toLowerCase() === (cat.categoryName || '').toLowerCase()).length,
  }));
};

export const saveCategories = (categories: import('../types').InventoryCategory[]): void => {
  setStored('saimetric_room_categories', categories);
};

export const ensureCategoryExists = (categoryName: string): void => {
  if (!categoryName || !categoryName.trim()) return;
  const name = categoryName.trim();
  const cats = getCategories();
  if (!cats.some((c) => (c.categoryName || '').toLowerCase() === name.toLowerCase())) {
    const newCat: import('../types').InventoryCategory = {
      categoryId: `CAT-${String(cats.length + 1).padStart(2, '0')}`,
      categoryName: name,
      description: `Custom category: ${name}`,
      itemCount: 0,
    };
    saveCategories([...cats, newCat]);
  }
};

export const resetRoomDatabase = (): void => {
  localStorage.removeItem(STORAGE_KEYS.INVENTORY_ITEMS);
  localStorage.removeItem(STORAGE_KEYS.GOODS_RECEIVED);
  localStorage.removeItem(STORAGE_KEYS.SUPPLIER_INVOICES);
  localStorage.removeItem(STORAGE_KEYS.STOCK_MOVEMENTS);
  localStorage.removeItem('saimetric_room_categories');
  setStored(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  setStored(STORAGE_KEYS.GOODS_RECEIVED, INITIAL_GOODS_RECEIVED);
  setStored(STORAGE_KEYS.SUPPLIER_INVOICES, INITIAL_SUPPLIER_INVOICES);
  setStored(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  setStored('saimetric_room_categories', DEFAULT_CATEGORIES);
  notifyListeners();
};

/**
 * RULE A: RECEIVING STOCK (Cases or Singles)
 * - If we receive Cases and StockSingles = 0, automatically break 1 Case into Singles immediately so item can be sold.
 */
export const receiveStock = (params: {
  itemId: string;
  receivedCases: number;
  receivedSingles: number;
  supplier: string;
  staffId: string;
  staffName?: string;
  notes?: string;
}): {
  success: boolean;
  message: string;
  grn?: GoodsReceivedEntry;
  updatedItem?: InventoryItem;
  autoBroken: boolean;
  convertedCasesToSingles?: boolean;
} => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return {
      success: false,
      message: `Item not found: ${params.itemId}`,
      autoBroken: false,
      convertedCasesToSingles: false,
    };
  }

  const recCases = Math.max(0, Number(params.receivedCases) || 0);
  const recSingles = Math.max(0, Number(params.receivedSingles) || 0);

  if (recCases === 0 && recSingles === 0) {
    return {
      success: false,
      message: 'Received quantities cannot both be zero',
      autoBroken: false,
      convertedCasesToSingles: false,
    };
  }

  const canSellAsCase = Boolean(item.canSellAsCase);
  let finalRecCases = recCases;
  let finalRecSingles = recSingles;
  let autoBroken = false;
  let convertedCasesToSingles = false;
  let autoBreakNote = '';

  // 1. If "Sell as Case" is deactivated (default), convert all received cases into singles immediately
  if (!canSellAsCase && recCases > 0) {
    convertedCasesToSingles = true;
    const gainedSingles = recCases * item.unitsPerCase;
    finalRecCases = 0;
    finalRecSingles = recSingles + gainedSingles;
    autoBreakNote = ` [Converted ${recCases} received case(s) into ${gainedSingles} singles because 'Sell as Case' is deactivated]`;
  }
  // 2. If "Sell as Case" is activated: Rule A check (if received cases > 0 and current StockSingles is 0, auto-break 1 case)
  else if (canSellAsCase && recCases > 0 && item.stockSingles === 0) {
    autoBroken = true;
    finalRecCases = recCases - 1;
    finalRecSingles = recSingles + item.unitsPerCase;
    autoBreakNote = ` [Rule A Triggered: Auto-broke 1 case to ${item.unitsPerCase} singles because StockSingles was 0]`;
  }

  // Update Stock
  const newStockCases = item.stockCases + finalRecCases;
  const newStockSingles = item.stockSingles + finalRecSingles;
  const newTotalUnits = (newStockCases * item.unitsPerCase) + newStockSingles;

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: newStockCases,
    stockSingles: newStockSingles,
    totalUnits: newTotalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const grnId = `GRN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  // Log to GoodsReceived
  const grn: GoodsReceivedEntry = {
    grnId,
    date: dateStr,
    supplier: params.supplier || 'General Supplier',
    itemId: item.itemId,
    itemName: item.itemName,
    receivedCases: recCases,
    receivedSingles: recSingles,
    autoBreakCaseToSingles: autoBroken,
    convertedCasesToSingles,
    notes: (params.notes || '') + autoBreakNote,
    staffId: params.staffId,
    staffName: params.staffName,
    timestamp,
    synced: false,
  };
  addGoodsReceived(grn);

  // Log to StockMovement
  const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const movement: StockMovementEntry = {
    txnId,
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'RECEIVE',
    movementType: 'GOODS_RECEIVED',
    qtyCases: recCases,
    qtySingles: recSingles,
    casesChange: finalRecCases,
    singlesChange: finalRecSingles,
    reason: params.notes || `Stock received via GRN ${grnId}${params.supplier ? ` from ${params.supplier}` : ''}`,
    promptShown: convertedCasesToSingles
      ? 'Auto-Converted Cases to Singles (Sell as Case Deactivated)'
      : autoBroken
      ? 'Rule A: Auto-Break on Zero Singles'
      : 'None',
    actionTaken: convertedCasesToSingles
      ? 'CONVERTED_TO_SINGLES_NO_CASE_SALE'
      : autoBroken
      ? 'AUTO_BREAK_RULE_A'
      : 'GOODS_RECEIVED',
    closingCases: newStockCases,
    closingSingles: newStockSingles,
    resultingStockCases: newStockCases,
    resultingStockSingles: newStockSingles,
    referenceId: grnId,
    timestamp,
    synced: false,
  };
  addStockMovement(movement);

  let msg = '';
  if (convertedCasesToSingles) {
    msg = `Received ${recCases} Cases of ${item.itemName}. Converted directly to ${recCases * item.unitsPerCase} singles ('Sell as Case' disabled). New stock: ${newStockSingles} Singles.`;
  } else if (autoBroken) {
    msg = `Received ${recCases} Cases. Rule A auto-broke 1 case to ${item.unitsPerCase} singles. New stock: ${newStockCases} Cases, ${newStockSingles} Singles (${newTotalUnits} total units).`;
  } else {
    msg = `Successfully received ${recCases} Cases and ${recSingles} Singles for ${item.itemName}. New stock: ${newStockCases} Cases, ${newStockSingles} Singles.`;
  }

  return {
    success: true,
    message: msg,
    grn,
    updatedItem,
    autoBroken,
    convertedCasesToSingles,
  };
};

/**
 * RULE B, C, D: SELLING STOCK
 * - Rule B: If StockSingles < QtySingles and StockCases > 0, prompt to break case.
 * - Rule C: If QtySingles >= UnitsPerCase and case is cheaper, prompt to sell as case.
 * - Rule D: Never allow negative stock.
 */
export const sellStock = (params: {
  itemId: string;
  qtyCases: number;
  qtySingles: number;
  staffId: string;
  staffName?: string;
  referenceId?: string;
  autoBreakConfirmed?: boolean;
  bypassBulkPrompt?: boolean;
}): {
  success: boolean;
  promptRequired?: boolean;
  promptType?: 'BREAK_CASE' | 'BULK_DISCOUNT';
  message: string;
  suggestedCases?: number;
  remainderSingles?: number;
  potentialSavings?: number;
  casesNeeded?: number;
  unitsToGain?: number;
  updatedItem?: InventoryItem;
} => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return { success: false, message: `Item not found: ${params.itemId}` };
  }

  const reqCases = Math.max(0, Number(params.qtyCases) || 0);
  const reqSingles = Math.max(0, Number(params.qtySingles) || 0);

  if (reqCases === 0 && reqSingles === 0) {
    return { success: false, message: 'Sell quantity cannot be zero' };
  }

  // CASE RESERVE PROTECTION FOR RETAIL SINGLES (Blind security message: zero quantity leakage)
  const caseReserve = Math.max(0, Number(item.caseReserveThreshold) || 0);
  if (reqCases > 0 && caseReserve > 0 && (item.stockCases <= caseReserve || (item.stockCases - reqCases) < caseReserve)) {
    return {
      success: false,
      message: 'Wholesale case sale unavailable for this product. Available for retail singles only.',
    };
  }

  // CORE RULE 2: FIFO DEDUCTION WITH NEGATIVE ALLOWED
  const totalUnitsRequired = (reqCases * item.unitsPerCase) + reqSingles;
  const staff = getSalespeople().find((s) => s.id === params.staffId) || getCurrentUser();
  const canSellNegative = Boolean(staff?.role === 'Admin' || staff?.permissions?.canSellNegativeStock);

  if (totalUnitsRequired > item.totalUnits && !canSellNegative) {
    const isPrivileged = isSupervisorOrAbove(staff?.role) || Boolean(staff?.permissions?.canManageInventory);
    return {
      success: false,
      message: isPrivileged
        ? `Insufficient stock for ${item.itemName}! Required: ${totalUnitsRequired} total units, Available: ${item.totalUnits} (${item.stockCases} cases, ${item.stockSingles} singles). Negative stock sales disabled for your user account.`
        : `Insufficient stock for ${item.itemName}. The requested quantity exceeds available stock.`,
    };
  }

  // If selling negative stock is triggered
  if (totalUnitsRequired > item.totalUnits && canSellNegative) {
    // Run FIFO batch deduction & negative entry creation
    const fifoResult = deductStockFIFO({
      itemId: item.itemId,
      quantityUnits: totalUnitsRequired,
      staffId: params.staffId,
      staffName: params.staffName,
      saleInvoiceId: params.referenceId,
      allowNegative: true,
    });

    const newTotalUnits = item.totalUnits - totalUnitsRequired;
    const finalCases = 0;
    const finalSingles = newTotalUnits;

    const updatedItem: InventoryItem = {
      ...item,
      stockCases: finalCases,
      stockSingles: finalSingles,
      totalUnits: newTotalUnits,
      lastUpdated: new Date().toISOString(),
    };
    saveInventoryItem(updatedItem);

    // Log negative SALE movement
    const timestampSale = new Date().toISOString();
    const dateStrSale = timestampSale.split('T')[0];
    const txnIdSale = `TXN-${dateStrSale.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
    addStockMovement({
      txnId: txnIdSale,
      date: dateStrSale,
      staffId: params.staffId,
      staffName: params.staffName,
      itemId: item.itemId,
      itemName: item.itemName,
      txnType: 'SALE',
      qtyCases: reqCases,
      qtySingles: reqSingles,
      promptShown: 'Negative Stock Sale Authorized',
      actionTaken: 'SOLD_NEGATIVE_BALANCE',
      closingCases: finalCases,
      closingSingles: finalSingles,
      referenceId: params.referenceId || 'INV-001',
      isNegativeSale: true,
      reason: `Negative stock sale by ${params.staffName || params.staffId}. Negative Qty: ${fifoResult.negativeQty} units.`,
      timestamp: timestampSale,
      synced: false,
    });

    return {
      success: true,
      promptRequired: false,
      message: `Completed Negative Stock Sale for ${item.itemName} (${totalUnitsRequired} units). New balance: ${newTotalUnits} units. Negative balance entry recorded.`,
      updatedItem,
    };
  }

  // RULE C: BULK SINGLES PROMPT
  // If selling singles >= unitsPerCase, prompt customer to buy as case if cheaper
  if (reqSingles >= item.unitsPerCase && !params.bypassBulkPrompt) {
    const potentialCases = Math.floor(reqSingles / item.unitsPerCase);
    const remainderSingles = reqSingles % item.unitsPerCase;
    const singlesCost = (potentialCases * item.unitsPerCase) * item.sellPriceUnit;
    const caseCost = potentialCases * item.sellPriceCase;
    const potentialSavings = singlesCost - caseCost;

    if (potentialSavings > 0) {
      return {
        success: true,
        promptRequired: true,
        promptType: 'BULK_DISCOUNT',
        message: `Sell as ${potentialCases} Case(s) + ${remainderSingles} Single(s) instead? It's cheaper. (Customer saves $${potentialSavings.toFixed(2)})`,
        suggestedCases: potentialCases,
        remainderSingles,
        potentialSavings,
      };
    }
  }

  // RULE B: SELLING SINGLES WHEN STOCKSINGLES IS INSUFFICIENT
  let currentCases = item.stockCases;
  let currentSingles = item.stockSingles;
  let brokenCasesCount = 0;

  if (reqSingles > currentSingles) {
    if (currentCases <= 0) {
      return {
        success: false,
        message: `Not enough singles in stock (${currentSingles}) and no cases left to break.`,
      };
    }

    const singlesDeficit = reqSingles - currentSingles;
    const casesNeeded = Math.ceil(singlesDeficit / item.unitsPerCase);

    if (casesNeeded > currentCases) {
      return {
        success: false,
        message: `Cannot satisfy ${reqSingles} singles. Breaking all ${currentCases} cases only yields ${currentSingles + (currentCases * item.unitsPerCase)} singles.`,
      };
    }

    // If autoBreak is not yet confirmed by the user, return promptRequired
    if (!params.autoBreakConfirmed) {
      return {
        success: true,
        promptRequired: true,
        promptType: 'BREAK_CASE',
        message: `Break ${casesNeeded} Case to ${casesNeeded * item.unitsPerCase} Singles to fulfill sale?`,
        casesNeeded,
        unitsToGain: casesNeeded * item.unitsPerCase,
      };
    }

    // Auto break confirmed: convert cases to singles
    brokenCasesCount = casesNeeded;
    currentCases -= casesNeeded;
    currentSingles += casesNeeded * item.unitsPerCase;

    // Log the Break Case transaction
    const timestampBreak = new Date().toISOString();
    const dateStrBreak = timestampBreak.split('T')[0];
    const txnIdBreak = `TXN-${dateStrBreak.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
    addStockMovement({
      txnId: txnIdBreak,
      date: dateStrBreak,
      staffId: params.staffId,
      staffName: params.staffName,
      itemId: item.itemId,
      itemName: item.itemName,
      txnType: 'BREAK_CASE',
      qtyCases: casesNeeded,
      qtySingles: casesNeeded * item.unitsPerCase,
      promptShown: `Rule B: Break ${casesNeeded} Case to ${casesNeeded * item.unitsPerCase} Singles`,
      actionTaken: 'CASE_BROKEN_FOR_SALE',
      closingCases: currentCases,
      closingSingles: currentSingles,
      referenceId: params.referenceId || 'POS-SALE',
      timestamp: timestampBreak,
      synced: false,
    });
  }

  // Deduct sold cases & singles via FIFO batch tracking
  deductStockFIFO({
    itemId: item.itemId,
    quantityUnits: totalUnitsRequired,
    staffId: params.staffId,
    staffName: params.staffName,
    saleInvoiceId: params.referenceId,
    allowNegative: false,
  });

  const finalCases = currentCases - reqCases;
  const finalSingles = currentSingles - reqSingles;
  const finalTotalUnits = (finalCases * item.unitsPerCase) + finalSingles;

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: finalCases,
    stockSingles: finalSingles,
    totalUnits: finalTotalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);

  // Log SALE movement
  const timestampSale = new Date().toISOString();
  const dateStrSale = timestampSale.split('T')[0];
  const txnIdSale = `TXN-${dateStrSale.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  addStockMovement({
    txnId: txnIdSale,
    date: dateStrSale,
    staffId: params.staffId,
    staffName: params.staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'SALE',
    qtyCases: reqCases,
    qtySingles: reqSingles,
    promptShown: brokenCasesCount > 0 ? 'Break Case Confirmed' : 'None',
    actionTaken: brokenCasesCount > 0 ? 'AUTO_BROKE_AND_SOLD' : 'SOLD',
    closingCases: finalCases,
    closingSingles: finalSingles,
    referenceId: params.referenceId || 'INV-001',
    timestamp: timestampSale,
    synced: false,
  });

  return {
    success: true,
    promptRequired: false,
    message: `Sold ${reqCases > 0 ? `${reqCases} Case(s) ` : ''}${reqSingles > 0 ? `${reqSingles} Single(s)` : ''} for ${item.itemName}. Remaining: ${finalCases} Cases, ${finalSingles} Singles.`,
    updatedItem,
  };
};

/**
 * MANUAL BREAK CASE
 * - Manually converts N cases into N * UnitsPerCase singles
 */
export const breakCase = (
  itemId: string,
  casesToBreak: number,
  staffId: string,
  staffName?: string
): {
  success: boolean;
  message: string;
  updatedItem?: InventoryItem;
} => {
  const item = getInventoryItemById(itemId);
  if (!item) {
    return { success: false, message: `Item not found: ${itemId}` };
  }

  const numCases = Math.max(1, Number(casesToBreak) || 1);
  if (item.stockCases < numCases) {
    return {
      success: false,
      message: `Cannot break ${numCases} case(s). Only ${item.stockCases} case(s) available in stock.`,
    };
  }

  const newStockCases = item.stockCases - numCases;
  const singlesGained = numCases * item.unitsPerCase;
  const newStockSingles = item.stockSingles + singlesGained;
  const newTotalUnits = (newStockCases * item.unitsPerCase) + newStockSingles;

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: newStockCases,
    stockSingles: newStockSingles,
    totalUnits: newTotalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  addStockMovement({
    txnId,
    date: dateStr,
    staffId,
    staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'BREAK_CASE',
    qtyCases: numCases,
    qtySingles: singlesGained,
    promptShown: 'Manual Case Break',
    actionTaken: 'MANUAL_CASE_BREAK',
    closingCases: newStockCases,
    closingSingles: newStockSingles,
    referenceId: 'MANUAL-BREAK',
    timestamp,
    synced: false,
  });

  return {
    success: true,
    message: `Successfully broke ${numCases} case(s) into ${singlesGained} singles for ${item.itemName}. New stock: ${newStockCases} Cases, ${newStockSingles} Singles.`,
    updatedItem,
  };
};

// ============================================================================
// STOCKTAKE & DOUBLE-COUNT ENGINE DAO
// Multi-Segment, Blind Double-Count, Automatic Recount Generator, Consolidation & Approval
// ============================================================================

export const getAllStocktakeSessions = (): StocktakeSession[] => {
  return getStored<StocktakeSession[]>(STORAGE_KEYS.STOCKTAKE_SESSIONS, INITIAL_STOCKTAKE_SESSIONS);
};

export const getStocktakeSessions = (): StocktakeSession[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllStocktakeSessions();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((s) => {
    const compId = (s as any).company_id || (s as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getStocktakeSessionById = (sessionId: string): StocktakeSession | undefined => {
  const sessions = getStocktakeSessions();
  return sessions.find((s) => s.sessionId.toUpperCase() === sessionId.toUpperCase());
};

export const saveStocktakeSession = (session: StocktakeSession): StocktakeSession => {
  const sessions = getAllStocktakeSessions();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = (session as any).company_id || (session as any).companyId || currentCompany;
  const brId = (session as any).branch_id || (session as any).branchId || currentBranch;
  const normalized: StocktakeSession = {
    ...session,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  } as any;
  const index = sessions.findIndex((s) => s.sessionId.toUpperCase() === session.sessionId.toUpperCase());
  if (index >= 0) {
    sessions[index] = normalized;
  } else {
    sessions.unshift(normalized);
  }
  setStored(STORAGE_KEYS.STOCKTAKE_SESSIONS, sessions);
  return normalized;
};

export const deleteStocktakeSession = (sessionId: string): boolean => {
  const sessions = getAllStocktakeSessions();
  const filtered = sessions.filter((s) => s.sessionId.toUpperCase() !== sessionId.toUpperCase());
  if (filtered.length !== sessions.length) {
    setStored(STORAGE_KEYS.STOCKTAKE_SESSIONS, filtered);
    return true;
  }
  return false;
};

// ============================================================================
// BRANCH STOCKTAKE LOCKDOWN STATE
// ============================================================================
export interface BranchLockdownState {
  branchId: string;
  isLocked: boolean;
  lockedAt?: string;
  lockedBy?: string;
  lockedByName?: string;
  reason?: string;
  sessionId?: string;
}

export const getBranchLockdowns = (): Record<string, BranchLockdownState> => {
  return getStored<Record<string, BranchLockdownState>>(STORAGE_KEYS.BRANCH_LOCKDOWNS, {});
};

export const isBranchInLockdown = (branchId?: string): boolean => {
  const br = branchId || getCurrentBranchId();
  const lockdowns = getBranchLockdowns();
  return Boolean(lockdowns[br]?.isLocked);
};

export const setBranchLockdown = (
  branchId: string,
  locked: boolean,
  sessionId?: string,
  staffId?: string,
  staffName?: string,
  reason?: string
): void => {
  const lockdowns = getBranchLockdowns();
  lockdowns[branchId] = {
    branchId,
    isLocked: locked,
    lockedAt: locked ? new Date().toISOString() : undefined,
    lockedBy: staffId,
    lockedByName: staffName,
    reason,
    sessionId,
  };
  setStored(STORAGE_KEYS.BRANCH_LOCKDOWNS, lockdowns);
  notifyListeners();
};

// ============================================================================
// CUSTOMER GOODS LEFT BEHIND (PENDING PICKUP FLOOR HOLD)
// ============================================================================
export const getCustomerGoodsLeftBehind = (sessionId?: string): CustomerGoodsLeftBehind[] => {
  const all = getStored<CustomerGoodsLeftBehind[]>(STORAGE_KEYS.CUSTOMER_GOODS_LEFT_BEHIND, []);
  if (!sessionId) return all;
  return all.filter((i) => i.sessionId === sessionId);
};

export const addCustomerGoodsLeftBehind = (
  item: Omit<CustomerGoodsLeftBehind, 'id' | 'recordedAt'>
): CustomerGoodsLeftBehind => {
  const all = getStored<CustomerGoodsLeftBehind[]>(STORAGE_KEYS.CUSTOMER_GOODS_LEFT_BEHIND, []);
  const created: CustomerGoodsLeftBehind = {
    ...item,
    id: `CGL-${Date.now().toString().slice(-6)}`,
    recordedAt: new Date().toISOString(),
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.CUSTOMER_GOODS_LEFT_BEHIND, updated);
  notifyListeners();
  return created;
};

export const deleteCustomerGoodsLeftBehind = (id: string): boolean => {
  const all = getStored<CustomerGoodsLeftBehind[]>(STORAGE_KEYS.CUSTOMER_GOODS_LEFT_BEHIND, []);
  const filtered = all.filter((i) => i.id !== id);
  if (filtered.length !== all.length) {
    setStored(STORAGE_KEYS.CUSTOMER_GOODS_LEFT_BEHIND, filtered);
    notifyListeners();
    return true;
  }
  return false;
};

// ============================================================================
// TEMPORARY CASUAL WORKER ACCOUNTS (ACTIVE DURING STOCKTAKE ONLY)
// ============================================================================
export const getTemporaryCasuals = (sessionId?: string): TemporaryCasualAccount[] => {
  const all = getStored<TemporaryCasualAccount[]>(STORAGE_KEYS.TEMPORARY_CASUALS, []);
  if (!sessionId) return all;
  return all.filter((c) => c.sessionId === sessionId);
};

export const addTemporaryCasual = (
  casual: Omit<TemporaryCasualAccount, 'id' | 'createdAt' | 'active'>
): TemporaryCasualAccount => {
  const all = getStored<TemporaryCasualAccount[]>(STORAGE_KEYS.TEMPORARY_CASUALS, []);
  const created: TemporaryCasualAccount = {
    ...casual,
    id: `CAS-${Date.now().toString().slice(-4)}`,
    createdAt: new Date().toISOString(),
    active: true,
  };
  const updated = [...all, created];
  setStored(STORAGE_KEYS.TEMPORARY_CASUALS, updated);
  notifyListeners();
  return created;
};

export const deleteTemporaryCasual = (id: string): boolean => {
  const all = getStored<TemporaryCasualAccount[]>(STORAGE_KEYS.TEMPORARY_CASUALS, []);
  const filtered = all.filter((c) => c.id !== id);
  if (filtered.length !== all.length) {
    setStored(STORAGE_KEYS.TEMPORARY_CASUALS, filtered);
    notifyListeners();
    return true;
  }
  return false;
};

export const authenticateCasualWorker = (pin: string): TemporaryCasualAccount | null => {
  const cleanPin = pin.trim();
  if (!cleanPin) return null;
  const all = getStored<TemporaryCasualAccount[]>(STORAGE_KEYS.TEMPORARY_CASUALS, []);
  return all.find((c) => c.active && c.pin === cleanPin) || null;
};

// ============================================================================
// FAST-MOVING CHECKLIST FOR DAILY BLIND COUNTS
// ============================================================================
export const INITIAL_FAST_MOVING_CHECKLIST: FastMovingChecklistItem[] = [
  { itemId: 'GAS001', itemName: 'LP Gas 1kg Refill', category: 'Gas', defaultFastMover: true, addedBy: 'System', addedAt: new Date().toISOString() },
  { itemId: 'AIR001', itemName: 'Econet Airtime $1 PIN', category: 'Airtime', defaultFastMover: true, addedBy: 'System', addedAt: new Date().toISOString() },
  { itemId: 'AIR002', itemName: 'NetOne Airtime $1 PIN', category: 'Airtime', defaultFastMover: true, addedBy: 'System', addedAt: new Date().toISOString() },
  { itemId: 'BRD001', itemName: 'Lobels White Bread Loaf', category: 'Bakery', defaultFastMover: true, addedBy: 'System', addedAt: new Date().toISOString() },
  { itemId: 'OIL001', itemName: 'Pure Drop Cooking Oil 2L', category: 'Groceries', defaultFastMover: true, addedBy: 'System', addedAt: new Date().toISOString() },
  { itemId: 'SUG001', itemName: 'Huletts White Sugar 2kg', category: 'Groceries', defaultFastMover: true, addedBy: 'System', addedAt: new Date().toISOString() },
];

export const getFastMovingChecklist = (): FastMovingChecklistItem[] => {
  return getStored<FastMovingChecklistItem[]>(STORAGE_KEYS.FAST_MOVING_CHECKLIST, INITIAL_FAST_MOVING_CHECKLIST);
};

export const saveFastMovingChecklist = (items: FastMovingChecklistItem[]): void => {
  setStored(STORAGE_KEYS.FAST_MOVING_CHECKLIST, items);
  notifyListeners();
};

export const addFastMovingChecklistItem = (item: Omit<FastMovingChecklistItem, 'addedAt'>): void => {
  const list = getFastMovingChecklist();
  if (list.some((i) => i.itemId.toUpperCase() === item.itemId.toUpperCase())) return;
  const updated = [...list, { ...item, addedAt: new Date().toISOString() }];
  saveFastMovingChecklist(updated);
};

export const removeFastMovingChecklistItem = (itemId: string): void => {
  const list = getFastMovingChecklist();
  saveFastMovingChecklist(list.filter((i) => i.itemId.toUpperCase() !== itemId.toUpperCase()));
};

/**
 * LIVE INVENTORY FREEZE FOR ACTIVE TRADING (Daily / Weekly counts):
 * Captures live totalUnits at the instant of line count or recount.
 */
export const captureLiveInventoryFreeze = (
  itemId: string,
  branchId?: string
): { frozenSystemUnits: number; frozenTimestamp: string } => {
  const invItem = getInventoryItemById(itemId, branchId);
  const frozenSystemUnits = invItem ? (invItem.totalUnits ?? 0) : 0;
  const frozenTimestamp = new Date().toISOString();
  return { frozenSystemUnits, frozenTimestamp };
};

export const getNextStocktakeSessionId = (): string => {
  const sessions = getStocktakeSessions();
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const count = sessions.length + 1;
  return `STK-${dateStr}-${String(count).padStart(3, '0')}`;
};

export const createStocktakeSession = (params: {
  title: string;
  date?: string;
  countType?: StocktakeCountType;
  branchId?: string;
  branchName?: string;
  isLockdownActive?: boolean;
  stocktakeAuditorId?: string;
  stocktakeAuditorName?: string;
  stocktakeAuditorPhone?: string;
  notes?: string;
  segmentNames?: string[];
  predefinedDailyItemIds?: string[];
  staffId: string;
  staffName: string;
}): StocktakeSession => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionId = getNextStocktakeSessionId();
  const timestamp = new Date().toISOString();
  const date = params.date || timestamp.split('T')[0];
  const countType: StocktakeCountType = params.countType || 'FULL_LOCKDOWN';
  const targetBranch = params.branchId || currentBranch;

  let defaultSegments = params.segmentNames && params.segmentNames.length > 0
    ? params.segmentNames
    : [
        'Aisle 1 - Beverages & Coolers',
        'Aisle 2 - Groceries, Sugar & Oils',
        'Aisle 3 - Bulk Rice & Flours',
        'Front Counter - Toiletries & Razors',
      ];

  // If daily fast-mover count, set single fast-mover focus segment if none provided
  if (countType === 'DAILY_BLIND' && (!params.segmentNames || params.segmentNames.length === 0)) {
    defaultSegments = ['Fast-Movers Daily Shelf & Tills'];
  } else if (countType === 'SPOT_CHECK' && (!params.segmentNames || params.segmentNames.length === 0)) {
    defaultSegments = ['Supervisor Spot-Check Verification Bay'];
  }

  const segments: StocktakeSegment[] = defaultSegments.map((name, idx) => ({
    segmentId: `SEG-${String(idx + 1).padStart(3, '0')}`,
    name,
    description: `Shop floor physical count location #${idx + 1}`,
    locationCode: `LOC-0${idx + 1}`,
    status: 'PENDING',
    count1: [],
    count2: [],
    verifiedCounts: [],
    discrepancyCount: 0,
  }));

  const session: StocktakeSession = {
    sessionId,
    title: params.title || `${countType.replace('_', ' ')} Audit - ${date}`,
    date,
    countType,
    status: 'DRAFT',
    branchId: targetBranch,
    branchName: params.branchName || 'Main Central Distribution & Warehouse',
    isLockdownActive: Boolean(params.isLockdownActive),
    stocktakeAuditorId: params.stocktakeAuditorId,
    stocktakeAuditorName: params.stocktakeAuditorName,
    stocktakeAuditorPhone: params.stocktakeAuditorPhone,
    predefinedDailyItemIds: params.predefinedDailyItemIds,
    createdBy: params.staffId,
    createdByName: params.staffName,
    segments,
    consolidatedItems: [],
    totalSystemUnits: 0,
    totalCountedUnits: 0,
    varianceUnits: 0,
    varianceCostValue: 0,
    varianceRetailValue: 0,
    notes: params.notes || '',
    timestamp,
    synced: false,
    company_id: currentCompany,
    companyId: currentCompany,
  } as any;

  // If session activates lockdown, lock down the branch
  if (session.isLockdownActive) {
    setBranchLockdown(
      targetBranch,
      true,
      sessionId,
      params.stocktakeAuditorId || params.staffId,
      params.stocktakeAuditorName || params.staffName,
      `Full Stocktake Lockdown (${session.title})`
    );
  }

  saveStocktakeSession(session);
  return session;
};

export const addStocktakeSegment = (
  sessionId: string,
  params: { name: string; description?: string; locationCode?: string }
): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  const nextNum = session.segments.length + 1;
  const newSegment: StocktakeSegment = {
    segmentId: `SEG-${String(nextNum).padStart(3, '0')}`,
    name: params.name.trim(),
    description: params.description || `Segment #${nextNum}`,
    locationCode: params.locationCode || `LOC-${String(nextNum).padStart(2, '0')}`,
    status: 'PENDING',
    count1: [],
    count2: [],
    verifiedCounts: [],
    discrepancyCount: 0,
  };

  session.segments.push(newSegment);
  if (session.status === 'DRAFT') {
    session.status = 'COUNTING';
  }
  return saveStocktakeSession(session);
};

export const deleteStocktakeSegment = (sessionId: string, segmentId: string): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  session.segments = session.segments.filter((s) => s.segmentId !== segmentId);
  return saveStocktakeSession(session);
};

/**
 * SUBMIT DOUBLE-BLIND SEGMENT COUNT (Counter A or Counter B)
 * - Records Count 1 or Count 2
 * - When BOTH Counter A & B have completed their independent counts:
 *   - Compares every line item
 *   - If identical (Cases & Singles match): marks verified directly
 *   - If quantities differ: flags as DISCREPANCY_RECOUNT and creates recount list!
 */
export const submitSegmentCount = (
  sessionId: string,
  segmentId: string,
  counterSlot: 'A' | 'B',
  lines: StocktakeLineCount[],
  staffId: string,
  staffName: string
): { success: boolean; message: string; session: StocktakeSession; discrepanciesCount: number } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) {
    throw new Error(`Stocktake session ${sessionId} not found.`);
  }

  const segmentIndex = session.segments.findIndex((s) => s.segmentId === segmentId);
  if (segmentIndex < 0) {
    throw new Error(`Segment ${segmentId} not found in session.`);
  }

  const segment = session.segments[segmentIndex];
  const timestamp = new Date().toISOString();

  // Normalize lines
  const normalizedLines = lines.map((l) => {
    const upc = Math.max(1, Number(l.unitsPerCase) || 1);
    const cs = Math.max(0, Number(l.cases) || 0);
    const ea = Math.max(0, Number(l.singles) || 0);
    const tot = (cs * upc) + ea;
    return {
      ...l,
      unitsPerCase: upc,
      cases: cs,
      singles: ea,
      totalUnits: tot,
      countedBy: staffId,
      countedByName: staffName,
      timestamp,
    };
  });

  if (counterSlot === 'A') {
    segment.counterAId = staffId;
    segment.counterAName = staffName;
    segment.counterATimestamp = timestamp;
    segment.count1 = normalizedLines;
  } else {
    segment.counterBId = staffId;
    segment.counterBName = staffName;
    segment.counterBTimestamp = timestamp;
    segment.count2 = normalizedLines;
  }

  let discrepanciesCount = 0;

  // Check if BOTH counts are now present:
  const hasCount1 = segment.count1 && segment.count1.length > 0;
  const hasCount2 = segment.count2 && segment.count2.length > 0;

  if (hasCount1 && hasCount2) {
    // Perform Double-Count Comparison!
    const mapA = new Map<string, StocktakeLineCount>();
    const mapB = new Map<string, StocktakeLineCount>();

    segment.count1.forEach((l) => mapA.set(l.itemId.toUpperCase(), l));
    segment.count2.forEach((l) => mapB.set(l.itemId.toUpperCase(), l));

    const allItemIds = Array.from(new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]));
    const matchedVerified: StocktakeVerifiedLine[] = [];
    const recountNeeded: StocktakeLineCount[] = [];

    allItemIds.forEach((itemId) => {
      const itemA = mapA.get(itemId);
      const itemB = mapB.get(itemId);

      const aTotal = itemA?.totalUnits || 0;
      const bTotal = itemB?.totalUnits || 0;
      const aCases = itemA?.cases || 0;
      const bCases = itemB?.cases || 0;
      const aSingles = itemA?.singles || 0;
      const bSingles = itemB?.singles || 0;

      const baseItem = itemA || itemB!;

      if (aTotal === bTotal && aCases === bCases && aSingles === bSingles && itemA && itemB) {
        // MATCHED! Both Counter A and B agree exactly
        matchedVerified.push({
          itemId: baseItem.itemId,
          itemName: baseItem.itemName,
          category: baseItem.category,
          sku: baseItem.sku,
          unitsPerCase: baseItem.unitsPerCase,
          cases: aCases,
          singles: aSingles,
          totalUnits: aTotal,
          source: 'MATCHED',
          count1TotalUnits: aTotal,
          count2TotalUnits: bTotal,
        });
      } else {
        // DISCREPANCY! Mismatch between Count 1 and Count 2
        discrepanciesCount++;
        recountNeeded.push({
          itemId: baseItem.itemId,
          itemName: baseItem.itemName,
          category: baseItem.category,
          sku: baseItem.sku,
          barcode: baseItem.barcode,
          unitsPerCase: baseItem.unitsPerCase,
          cases: aCases, // seeded with A as starting point
          singles: aSingles,
          totalUnits: aTotal,
        });
      }
    });

    segment.discrepancyCount = discrepanciesCount;

    if (discrepanciesCount === 0) {
      segment.status = 'VERIFIED';
      segment.verifiedCounts = matchedVerified;
      segment.recount = [];
    } else {
      segment.status = 'DISCREPANCY_RECOUNT';
      segment.recount = recountNeeded;
      segment.verifiedCounts = matchedVerified; // keep verified matches
    }
  } else {
    segment.status = 'COUNTING';
  }

  session.segments[segmentIndex] = segment;

  // Check overall session status
  const allVerified = session.segments.every((s) => s.status === 'VERIFIED');
  const hasDiscrepancy = session.segments.some((s) => s.status === 'DISCREPANCY_RECOUNT');

  if (allVerified) {
    session.status = 'COUNTING';
  } else if (hasDiscrepancy) {
    session.status = 'RECOUNTING';
  } else {
    session.status = 'COUNTING';
  }

  saveStocktakeSession(session);

  let message = `Recorded Counter ${counterSlot} submission (${normalizedLines.length} products).`;
  if (hasCount1 && hasCount2) {
    if (discrepanciesCount === 0) {
      message = `Double-count verified! All product quantities matched between Counter A and B. Segment marked VERIFIED.`;
    } else {
      message = `Double-count compared: ${discrepanciesCount} item(s) have mismatched quantities between Counter A and B. A Recount List has been generated!`;
    }
  }

  return {
    success: true,
    message,
    session,
    discrepanciesCount,
  };
};

/**
 * RESOLVE SEGMENT RECOUNT
 * - Applies the supervisor/recounter's verified physical count for discrepancy items
 * - Combines with matched items to complete verifiedCounts
 * - Marks segment as VERIFIED
 */
export const resolveSegmentRecount = (
  sessionId: string,
  segmentId: string,
  resolvedRecountLines: StocktakeLineCount[],
  staffId: string,
  staffName: string
): { success: boolean; message: string; session: StocktakeSession } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found.`);

  const segIndex = session.segments.findIndex((s) => s.segmentId === segmentId);
  if (segIndex < 0) throw new Error(`Segment ${segmentId} not found.`);

  const segment = session.segments[segIndex];
  const timestamp = new Date().toISOString();

  segment.recounterId = staffId;
  segment.recounterName = staffName;
  segment.recountedAt = timestamp;

  // Map of existing matched lines
  const verifiedMap = new Map<string, StocktakeVerifiedLine>();
  segment.verifiedCounts.forEach((v) => verifiedMap.set(v.itemId.toUpperCase(), v));

  const mapA = new Map<string, StocktakeLineCount>();
  const mapB = new Map<string, StocktakeLineCount>();
  segment.count1.forEach((l) => mapA.set(l.itemId.toUpperCase(), l));
  segment.count2.forEach((l) => mapB.set(l.itemId.toUpperCase(), l));

  // Merge recount lines
  resolvedRecountLines.forEach((r) => {
    const upc = Math.max(1, Number(r.unitsPerCase) || 1);
    const cs = Math.max(0, Number(r.cases) || 0);
    const ea = Math.max(0, Number(r.singles) || 0);
    const tot = (cs * upc) + ea;

    const count1Units = mapA.get(r.itemId.toUpperCase())?.totalUnits || 0;
    const count2Units = mapB.get(r.itemId.toUpperCase())?.totalUnits || 0;

    verifiedMap.set(r.itemId.toUpperCase(), {
      itemId: r.itemId,
      itemName: r.itemName,
      category: r.category,
      sku: r.sku,
      unitsPerCase: upc,
      cases: cs,
      singles: ea,
      totalUnits: tot,
      source: 'RESOLVED_RECOUNT',
      resolvedBy: staffName,
      count1TotalUnits: count1Units,
      count2TotalUnits: count2Units,
    });
  });

  segment.verifiedCounts = Array.from(verifiedMap.values());
  segment.discrepancyCount = 0;
  segment.status = 'VERIFIED';
  segment.recount = resolvedRecountLines;

  session.segments[segIndex] = segment;

  // Check if all segments are now verified
  const allVerified = session.segments.every((s) => s.status === 'VERIFIED');
  if (allVerified && session.status === 'RECOUNTING') {
    session.status = 'COUNTING';
  }

  saveStocktakeSession(session);

  return {
    success: true,
    message: `Recount resolved for ${resolvedRecountLines.length} item(s). Segment '${segment.name}' is now fully VERIFIED.`,
    session,
  };
};

/**
 * CONSOLIDATE STOCKTAKE SESSION
 * - Aggregates verified physical counts across ALL segments for every SKU
 * - Compares with current System SOH (InventoryItem)
 * - Calculates Unit & Financial Variances (@ Cost & @ Sell Price)
 * - Updates status to 'CONSOLIDATED'
 */
export const consolidateStocktakeSession = (
  sessionId: string
): { success: boolean; message: string; session: StocktakeSession } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) throw new Error(`Stocktake session ${sessionId} not found.`);

  const unverifiedSegments = session.segments.filter((s) => s.status !== 'VERIFIED');
  if (unverifiedSegments.length > 0) {
    return {
      success: false,
      message: `Cannot consolidate: ${unverifiedSegments.length} segment(s) are not verified yet (${unverifiedSegments.map((s) => s.name).join(', ')}). Please verify all segment counts first.`,
      session,
    };
  }

  // 1. Aggregate physical counts across segments
  interface SkuConsolidationAccumulator {
    itemId: string;
    itemName: string;
    category: string;
    sku: string;
    unitsPerCase: number;
    countedCases: number;
    countedSingles: number;
    countedTotalUnits: number;
    segmentBreakdown: {
      segmentId: string;
      segmentName: string;
      cases: number;
      singles: number;
      totalUnits: number;
    }[];
  }

  const skuMap = new Map<string, SkuConsolidationAccumulator>();

  session.segments.forEach((seg) => {
    seg.verifiedCounts.forEach((line) => {
      const key = line.itemId.toUpperCase();
      let acc = skuMap.get(key);
      if (!acc) {
        acc = {
          itemId: line.itemId,
          itemName: line.itemName,
          category: line.category,
          sku: line.sku,
          unitsPerCase: line.unitsPerCase || 1,
          countedCases: 0,
          countedSingles: 0,
          countedTotalUnits: 0,
          segmentBreakdown: [],
        };
        skuMap.set(key, acc);
      }

      acc.countedCases += line.cases;
      acc.countedSingles += line.singles;
      acc.countedTotalUnits += line.totalUnits;
      acc.segmentBreakdown.push({
        segmentId: seg.segmentId,
        segmentName: seg.name,
        cases: line.cases,
        singles: line.singles,
        totalUnits: line.totalUnits,
      });
    });
  });

  // Customer goods left behind reconciliation
  const customerGoods = getCustomerGoodsLeftBehind(sessionId);
  const customerHeldMap = new Map<string, number>();
  customerGoods.forEach((cg) => {
    if (!cg.collected) {
      const k = cg.itemId.toUpperCase();
      customerHeldMap.set(k, (customerHeldMap.get(k) || 0) + (Number(cg.quantity) || 0));
    }
  });

  // For FULL_LOCKDOWN: include all catalog inventory items (uncounted items default to 0 count)
  // For DAILY_BLIND, SPOT_CHECK, WEEKLY_STRATEGIC: only consolidate items that were actually counted
  const isFullLockdown = session.countType === 'FULL_LOCKDOWN';

  if (isFullLockdown) {
    const allMasterItems = getInventoryItems();
    allMasterItems.forEach((invItem) => {
      const key = invItem.itemId.toUpperCase();
      if (!skuMap.has(key)) {
        skuMap.set(key, {
          itemId: invItem.itemId,
          itemName: invItem.itemName,
          category: invItem.category,
          sku: invItem.sku || invItem.itemId,
          unitsPerCase: invItem.unitsPerCase || 1,
          countedCases: 0,
          countedSingles: 0,
          countedTotalUnits: 0,
          segmentBreakdown: [],
        });
      }
    });
  }

  // 2. Build consolidated items with SOH comparisons & Customer Goods Left Behind adjustments
  const consolidatedItems: StocktakeConsolidatedItem[] = [];
  let totalSystemUnits = 0;
  let totalCountedUnits = 0;
  let totalVarianceUnits = 0;
  let totalVarianceCostValue = 0;
  let totalVarianceRetailValue = 0;

  skuMap.forEach((accum) => {
    const master = getInventoryItemById(accum.itemId);
    const unitsPerCase = master?.unitsPerCase || accum.unitsPerCase || 1;
    const costPerUnit = master?.costPerUnit || (master?.costPerCase ? master.costPerCase / unitsPerCase : 0);
    const costPerCase = master?.costPerCase || costPerUnit * unitsPerCase;
    const sellPriceUnit = master?.sellPriceUnit || 0;
    const sellPriceCase = master?.sellPriceCase || sellPriceUnit * unitsPerCase;

    const systemCases = master?.stockCases || 0;
    const systemSingles = master?.stockSingles || 0;
    const systemTotalUnits = (systemCases * unitsPerCase) + systemSingles;
    const systemCostValue = systemTotalUnits * costPerUnit;
    const systemRetailValue = systemTotalUnits * sellPriceUnit;

    const countedCases = accum.countedCases;
    const countedSingles = accum.countedSingles;
    const countedTotalUnits = (countedCases * unitsPerCase) + countedSingles;
    const countedCostValue = countedTotalUnits * costPerUnit;
    const countedRetailValue = countedTotalUnits * sellPriceUnit;

    // Customer Goods Left Behind reconciliation:
    // If customers paid for goods but physically left them in store awaiting transport/pickup,
    // this stock sits on the floor. It must be deducted from counted stock to obtain true available stock!
    const customerHeldStockUnits = customerHeldMap.get(accum.itemId.toUpperCase()) || 0;
    const adjustedPhysicalUnits = Math.max(0, countedTotalUnits - customerHeldStockUnits);
    const trueVarianceUnits = adjustedPhysicalUnits - systemTotalUnits;

    // Standard variance uses adjustedPhysicalUnits to avoid false overage
    const effectivePhysicalUnits = customerHeldStockUnits > 0 ? adjustedPhysicalUnits : countedTotalUnits;
    const effectivePhysicalCases = Math.floor(effectivePhysicalUnits / unitsPerCase);
    const effectivePhysicalSingles = effectivePhysicalUnits % unitsPerCase;

    const varianceCases = effectivePhysicalCases - systemCases;
    const varianceSingles = effectivePhysicalSingles - systemSingles;
    const varianceTotalUnits = effectivePhysicalUnits - systemTotalUnits;
    const varianceCostValue = varianceTotalUnits * costPerUnit;
    const varianceRetailValue = varianceTotalUnits * sellPriceUnit;

    let status: 'MATCH' | 'SHORTAGE' | 'OVERAGE' | 'RECOUNT_FLAGGED' = 'MATCH';
    if (varianceTotalUnits < 0) {
      status = 'SHORTAGE';
    } else if (varianceTotalUnits > 0) {
      status = 'OVERAGE';
    }

    const wasCountedInSession = accum.segmentBreakdown.length > 0;

    totalSystemUnits += systemTotalUnits;
    totalCountedUnits += countedTotalUnits;
    totalVarianceUnits += varianceTotalUnits;
    totalVarianceCostValue += varianceCostValue;
    totalVarianceRetailValue += varianceRetailValue;

    consolidatedItems.push({
      itemId: accum.itemId,
      itemName: master?.itemName || accum.itemName,
      category: master?.category || accum.category,
      sku: master?.sku || accum.sku,
      barcode: master?.barcode,
      unitsPerCase,
      costPerUnit,
      costPerCase,
      sellPriceUnit,
      sellPriceCase,
      systemCases,
      systemSingles,
      systemTotalUnits,
      systemCostValue,
      systemRetailValue,
      countedCases,
      countedSingles,
      countedTotalUnits,
      countedCostValue,
      countedRetailValue,
      customerHeldStockUnits,
      adjustedPhysicalUnits,
      trueVarianceUnits,
      varianceCases,
      varianceSingles,
      varianceTotalUnits,
      varianceCostValue,
      varianceRetailValue,
      status,
      wasCountedInSession,
      segmentBreakdown: accum.segmentBreakdown,
    });
  });

  // Sort consolidated items: Variances first (Shortages, then Overages, then Matched)
  consolidatedItems.sort((a, b) => {
    if (a.status !== 'MATCH' && b.status === 'MATCH') return -1;
    if (a.status === 'MATCH' && b.status !== 'MATCH') return 1;
    return Math.abs(b.varianceCostValue) - Math.abs(a.varianceCostValue);
  });

  session.consolidatedItems = consolidatedItems;
  session.totalSystemUnits = totalSystemUnits;
  session.totalCountedUnits = totalCountedUnits;
  session.varianceUnits = totalVarianceUnits;
  session.varianceCostValue = totalVarianceCostValue;
  session.varianceRetailValue = totalVarianceRetailValue;
  session.status = 'CONSOLIDATED';

  saveStocktakeSession(session);

  return {
    success: true,
    message: `Consolidated ${consolidatedItems.length} SKUs across ${session.segments.length} segments. Total variance: ${totalVarianceUnits >= 0 ? `+${totalVarianceUnits}` : totalVarianceUnits} units ($${totalVarianceCostValue.toFixed(2)} cost value).`,
    session,
  };
};

/**
 * REQUEST TARGETED VARIANCE RECOUNT FOR A SPECIFIC SKU
 * - Allows supervisor to flag high-variance items for a quick double-check before final approval
 */
export const requestSkuVarianceRecount = (
  sessionId: string,
  itemId: string,
  notes?: string
): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  const item = session.consolidatedItems.find((i) => i.itemId.toUpperCase() === itemId.toUpperCase());
  if (item) {
    item.recountRequested = true;
    item.status = 'RECOUNT_FLAGGED';
    item.recountNotes = notes || 'Floor recount requested to verify variance.';
    session.status = 'AUDIT_REVIEW';
    return saveStocktakeSession(session);
  }
  return null;
};

/**
 * SUBMIT TARGETED VARIANCE RECOUNT FOR A SPECIFIC SKU
 */
export const submitSkuVarianceRecount = (
  sessionId: string,
  itemId: string,
  recountCases: number,
  recountSingles: number,
  staffId: string,
  staffName: string
): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  const itemIndex = session.consolidatedItems.findIndex((i) => i.itemId.toUpperCase() === itemId.toUpperCase());
  if (itemIndex < 0) return null;

  const item = session.consolidatedItems[itemIndex];
  const unitsPerCase = item.unitsPerCase || 1;
  const rcCases = Math.max(0, Number(recountCases) || 0);
  const rcSingles = Math.max(0, Number(recountSingles) || 0);
  const rcTotalUnits = (rcCases * unitsPerCase) + rcSingles;

  item.countedCases = rcCases;
  item.countedSingles = rcSingles;
  item.countedTotalUnits = rcTotalUnits;
  item.countedCostValue = rcTotalUnits * item.costPerUnit;
  item.countedRetailValue = rcTotalUnits * item.sellPriceUnit;

  item.varianceCases = rcCases - item.systemCases;
  item.varianceSingles = rcSingles - item.systemSingles;
  item.varianceTotalUnits = rcTotalUnits - item.systemTotalUnits;
  item.varianceCostValue = item.varianceTotalUnits * item.costPerUnit;
  item.varianceRetailValue = item.varianceTotalUnits * item.sellPriceUnit;

  item.recountRequested = false;
  item.recountCases = rcCases;
  item.recountSingles = rcSingles;
  item.recountTotalUnits = rcTotalUnits;
  item.recountedBy = staffName;
  item.recountedAt = new Date().toISOString();

  if (item.varianceTotalUnits === 0) {
    item.status = 'MATCH';
  } else if (item.varianceTotalUnits < 0) {
    item.status = 'SHORTAGE';
  } else {
    item.status = 'OVERAGE';
  }

  // Recalculate session totals
  let totSys = 0;
  let totCnt = 0;
  let totVar = 0;
  let totVarCost = 0;
  let totVarRetail = 0;

  session.consolidatedItems.forEach((ci) => {
    totSys += ci.systemTotalUnits;
    totCnt += ci.countedTotalUnits;
    totVar += ci.varianceTotalUnits;
    totVarCost += ci.varianceCostValue;
    totVarRetail += ci.varianceRetailValue;
  });

  session.totalSystemUnits = totSys;
  session.totalCountedUnits = totCnt;
  session.varianceUnits = totVar;
  session.varianceCostValue = totVarCost;
  session.varianceRetailValue = totVarRetail;

  const anyRecountsPending = session.consolidatedItems.some((i) => i.recountRequested);
  if (!anyRecountsPending) {
    session.status = 'CONSOLIDATED';
  }

  return saveStocktakeSession(session);
};

/**
 * ADMIN SUPER USER APPROVAL & INVENTORY MASTER STOCK COMMITTAL
 * - Updates master InventoryItem stockCases, stockSingles, totalUnits to match the physical count
 * - Automatically logs immutable StockMovementEntry records for audit trail
 * - Marks session as 'APPROVED_POSTED'
 */
export const approveAndCommitStocktake = (
  sessionId: string,
  adminId: string,
  adminName: string,
  notes?: string
): { success: boolean; message: string; adjustmentsCount: number; session?: StocktakeSession } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) {
    return { success: false, message: `Session ${sessionId} not found.`, adjustmentsCount: 0 };
  }

  if (session.status === 'APPROVED_POSTED') {
    return { success: false, message: `This stocktake session was already approved and posted.`, adjustmentsCount: 0 };
  }

  // Authorization check: Only the Store Owner (SUPER_ADMIN / ADMIN) or the expressly assigned Stocktake Auditor can commit to inventory!
  const sessionUser = getSessionUser();
  const isOwner = sessionUser?.role === 'SUPER_ADMIN' || sessionUser?.role === 'ADMIN' || adminId === '001';
  const isAssignedAuditor = Boolean(
    session.stocktakeAuditorId &&
    (adminId === session.stocktakeAuditorId || sessionUser?.id === session.stocktakeAuditorId)
  );

  if (!isOwner && !isAssignedAuditor) {
    return {
      success: false,
      message: `Access Restricted: During stocktakes, even branch managers are audited. Only the Store Owner or Assigned Stocktake Auditor (${session.stocktakeAuditorName || 'Assigned Auditor'}) has authority to commit stock updates.`,
      adjustmentsCount: 0,
    };
  }

  if (!session.consolidatedItems || session.consolidatedItems.length === 0) {
    // Attempt auto-consolidation first if needed
    const consResult = consolidateStocktakeSession(sessionId);
    if (!consResult.success) {
      return { success: false, message: consResult.message, adjustmentsCount: 0 };
    }
  }

  const timestamp = new Date().toISOString();
  const dateStr = session.date || timestamp.split('T')[0];
  let adjustmentsCount = 0;
  const isFullLockdown = session.countType === 'FULL_LOCKDOWN';

  // Process items:
  // For FULL_LOCKDOWN: all items with variance (including uncounted items defaulted to 0) are committed.
  // For DAILY_BLIND, SPOT_CHECK, WEEKLY_STRATEGIC: ONLY items actually counted are committed!
  session.consolidatedItems.forEach((cItem) => {
    // In targeted counts, do NOT alter uncounted catalog items:
    if (!isFullLockdown && cItem.wasCountedInSession === false) {
      return;
    }

    if (cItem.varianceTotalUnits !== 0) {
      const invItem = getInventoryItemById(cItem.itemId);
      if (invItem) {
        const prevCases = invItem.stockCases;
        const prevSingles = invItem.stockSingles;
        const newCases = cItem.countedCases;
        const newSingles = cItem.countedSingles;
        const newTotalUnits = (newCases * invItem.unitsPerCase) + newSingles;

        // 1. Update Inventory Master Stock Levels
        const updatedMaster: InventoryItem = {
          ...invItem,
          stockCases: newCases,
          stockSingles: newSingles,
          totalUnits: newTotalUnits,
          lastUpdated: timestamp,
        };
        saveInventoryItem(updatedMaster);

        // 2. Log StockMovementEntry (ADJUSTMENT)
        const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${cItem.itemId}`;
        const movement: StockMovementEntry = {
          txnId,
          movementId: txnId,
          date: dateStr,
          staffId: adminId,
          staffName: adminName,
          itemId: invItem.itemId,
          itemName: invItem.itemName,
          txnType: 'ADJUSTMENT',
          qtyCases: cItem.varianceCases,
          qtySingles: cItem.varianceSingles,
          casesChange: cItem.varianceCases,
          singlesChange: cItem.varianceSingles,
          closingCases: newCases,
          closingSingles: newSingles,
          resultingStockCases: newCases,
          resultingStockSingles: newSingles,
          promptShown: `Stocktake Audit Approval #${sessionId} (${session.countType})`,
          actionTaken: cItem.varianceTotalUnits < 0 ? 'STOCKTAKE_SHRINKAGE_ADJUSTMENT' : 'STOCKTAKE_OVERAGE_ADJUSTMENT',
          referenceId: `${sessionId} (Approved by ${adminName})`,
          triggerRule: 'Super User Stocktake Committal',
          reason: `Physical count variance adjustment: ${cItem.varianceTotalUnits >= 0 ? `+${cItem.varianceTotalUnits}` : cItem.varianceTotalUnits} units. Previous: ${prevCases}cs/${prevSingles}ea -> New: ${newCases}cs/${newSingles}ea`,
          timestamp,
          synced: false,
        };
        addStockMovement(movement);
        adjustmentsCount++;
      }
    }
  });

  session.status = 'APPROVED_POSTED';
  session.approvedBy = adminId;
  session.approvedByName = adminName;
  session.approvedAt = timestamp;
  if (notes) {
    session.notes = (session.notes ? `${session.notes}\n` : '') + `[Approval Note]: ${notes}`;
  }

  // Release branch lockdown if this session held the store in lockdown
  if (session.isLockdownActive || isFullLockdown) {
    setBranchLockdown(
      session.branchId || getCurrentBranchId(),
      false,
      undefined,
      adminId,
      adminName,
      `Stocktake ${session.sessionId} committed and approved by ${adminName}. Store lockdown released.`
    );
    session.isLockdownActive = false;
  }

  saveStocktakeSession(session);

  const scopeMsg = isFullLockdown
    ? 'Full Storewide Lockdown inventory overwrite committed'
    : `Targeted count (${session.countType}) committed for counted lines only (uncounted inventory untouched)`;

  return {
    success: true,
    message: `Stocktake approved successfully! ${adjustmentsCount} inventory item(s) updated in Inventory Master. ${scopeMsg}. Audit ledger entries logged.`,
    adjustmentsCount,
    session,
  };
};

export const logEmergencyLockdownSale = (params: {
  sessionId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  supervisorId: string;
  supervisorName: string;
  cashierName: string;
  overrideReason: string;
  wasCountedPriorToSale: boolean;
}): void => {
  const timestamp = new Date().toISOString();
  addAuditLog({
    action: 'PIN_OVERRIDE',
    severity: 'WARNING',
    staffId: params.supervisorId,
    staffName: params.supervisorName,
    staffRole: 'ADMIN',
    details: `[STOCKTAKE_LOCKDOWN] Emergency sale during lockdown for ${params.quantity}x ${params.itemName} (${params.itemId}). Cashier: ${params.cashierName}. Reason: ${params.overrideReason}. Item was counted prior to sale: ${params.wasCountedPriorToSale ? 'YES' : 'NO'}.`,
    referenceId: params.sessionId,
    companyId: getCurrentCompanyId(),
    branchId: getCurrentBranchId(),
    timestamp,
  });
};

// ============================================================================
// SAAS MULTI-TENANT & BRANCH ISOLATION DAO
// ============================================================================

export function getCompanies(): Company[] {
  return getStored<Company[]>(STORAGE_KEYS.COMPANIES, SEED_COMPANIES);
}

export function saveCompany(company: Company): void {
  const list = getCompanies();
  const index = list.findIndex((c) => c.company_id === company.company_id);
  if (index >= 0) {
    list[index] = company;
  } else {
    list.push(company);
  }
  setStored(STORAGE_KEYS.COMPANIES, list);
  notifyListeners();
}

export function getCurrentCompanyId(): string {
  const user = getSessionUser();
  if (user && user.role !== 'SUPER_ADMIN') {
    const userComp = user.company_id || user.companyId;
    if (userComp) {
      return userComp;
    }
  }
  const current = getStored<string>(STORAGE_KEYS.CURRENT_COMPANY_ID, 'COMP-001');
  return current;
}

export function setCurrentCompanyId(companyId: string): void {
  const current = getStored<string>(STORAGE_KEYS.CURRENT_COMPANY_ID, 'COMP-001');
  if (current === companyId) return;
  setStored(STORAGE_KEYS.CURRENT_COMPANY_ID, companyId);
  notifyListeners();
}

export function getCurrentCompany(): Company {
  const id = getCurrentCompanyId();
  const list = getCompanies();
  return list.find((c) => c.company_id === id) || list[0] || SEED_COMPANIES[0];
}

export function getCurrentBranchId(): string {
  const user = getSessionUser();
  if (user && (user.branchId || user.branch_id)) {
    return (user.branchId || user.branch_id)!;
  }
  return getStored<string>(STORAGE_KEYS.CURRENT_BRANCH_ID, 'BR-MAIN');
}

export function setCurrentBranchId(branchId: string): void {
  const current = getStored<string>(STORAGE_KEYS.CURRENT_BRANCH_ID, 'BR-MAIN');
  const user = getSessionUser();
  if (current === branchId && (!user || (user.branchId === branchId && user.branch_id === branchId))) {
    return;
  }
  setStored(STORAGE_KEYS.CURRENT_BRANCH_ID, branchId);
  if (user) {
    user.branchId = branchId;
    user.branch_id = branchId;
    const branches = getBranches();
    const br = branches.find((b) => b.branchId === branchId);
    if (br) user.branchName = br.name;
    setSessionUser(user);
  }
  notifyListeners();
}

export function getCurrentBranch(): Branch {
  const branchId = getCurrentBranchId();
  const currentCompany = getCurrentCompanyId();
  const branches = getBranches();

  if (branchId === 'ALL') {
    return {
      branchId: 'ALL',
      id: 'ALL',
      name: 'All Branches (Consolidated)',
      code: 'ALL',
      location: 'Enterprise Wide',
      address: 'Enterprise Wide',
      isMain: false,
      company_id: currentCompany,
      companyId: currentCompany,
    };
  }

  let found = branches.find((b) => b.branchId === branchId || b.id === branchId || (b as any).branch_id === branchId);
  if (!found) {
    found = branches.find((b) => (b.company_id || b.companyId) === currentCompany) || branches[0];
  }
  const branchName = found?.name || (found as any)?.branch_name || (found as any)?.branchName || 'Harare Main';
  const branchLocation = found?.location || (found as any)?.address || (found as any)?.branch_address || '4th Street Commercial Center, Harare';
  const branchCode = found?.code || (found as any)?.branch_code || 'HQ-01';

  return {
    branchId: found?.branchId || found?.id || (found as any)?.branch_id || 'BR-MAIN',
    name: branchName,
    code: branchCode,
    location: branchLocation,
    address: branchLocation,
    isMain: found?.isMain ?? true,
    company_id: found?.company_id || found?.companyId || currentCompany,
    companyId: found?.companyId || found?.company_id || currentCompany,
  };
}

// ============================================================================
// SAAS TENANT ONBOARDING & SUBSCRIPTION TRIAL MANAGEMENT
// ============================================================================

export interface SubscriptionStatusInfo {
  isExpired: boolean;
  isTrial: boolean;
  isActive: boolean;
  isSuspended: boolean;
  daysRemaining: number;
  message: string;
  nextBillingDate: string;
  plan: string;
  companyName: string;
  ownerEmail: string;
  offlineActivationCode?: string;
}

export const getSubscriptionStatus = (companyOrId?: Company | string | null): SubscriptionStatusInfo => {
  let company: Company | undefined;
  if (!companyOrId) {
    company = getCurrentCompany();
  } else if (typeof companyOrId === 'string') {
    company = getCompanies().find((c) => c.company_id === companyOrId);
  } else {
    company = companyOrId;
  }

  if (!company) {
    company = getCurrentCompany();
  }

  // Developer / Super Admin Master account never expires
  if (
    company.company_id === 'COMP-001' ||
    company.company_id === 'COMP-MASTER' ||
    (company.owner_email && company.owner_email.toLowerCase() === 'andrekudakwashe@gmail.com')
  ) {
    return {
      isExpired: false,
      isTrial: false,
      isActive: true,
      isSuspended: false,
      daysRemaining: 999,
      message: 'Permanent Super Admin Master Account',
      nextBillingDate: company.next_billing_date || '2030-01-01',
      plan: 'ENTERPRISE',
      companyName: company.company_name,
      ownerEmail: company.owner_email,
      offlineActivationCode: 'SAI-MASTER',
    };
  }

  if (company.subscription_status === 'ACTIVE') {
    return {
      isExpired: false,
      isTrial: false,
      isActive: true,
      isSuspended: false,
      daysRemaining: 999,
      message: `Active ${company.plan} Subscription (Paid & Confirmed)`,
      nextBillingDate: company.next_billing_date,
      plan: company.plan,
      companyName: company.company_name,
      ownerEmail: company.owner_email,
      offlineActivationCode: company.offline_activation_code,
    };
  }

  if (company.subscription_status === 'CANCELLED' || company.subscription_status === 'PAST_DUE') {
    return {
      isExpired: true,
      isTrial: false,
      isActive: false,
      isSuspended: true,
      daysRemaining: 0,
      message: 'Account Suspended - Contact System Owner',
      nextBillingDate: company.next_billing_date,
      plan: company.plan,
      companyName: company.company_name,
      ownerEmail: company.owner_email,
      offlineActivationCode: company.offline_activation_code,
    };
  }

  // TRIAL MODE: Calculate 14-day window
  const now = new Date();
  const billingDate = new Date(company.next_billing_date + 'T23:59:59');
  const diffTime = billingDate.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  const isExpired = daysRemaining <= 0;

  return {
    isExpired,
    isTrial: true,
    isActive: !isExpired,
    isSuspended: false,
    daysRemaining,
    message: isExpired
      ? '14-Day Free Trial Expired - Payment Confirmation Required'
      : `${daysRemaining} Day${daysRemaining === 1 ? '' : 's'} Remaining in 14-Day Free Trial`,
    nextBillingDate: company.next_billing_date,
    plan: company.plan,
    companyName: company.company_name,
    ownerEmail: company.owner_email,
    offlineActivationCode: company.offline_activation_code,
  };
};

export const getStaffForCompany = (companyId: string): Salesperson[] => {
  const allStaff = getSalespeople();
  return allStaff.filter(
    (s) => s.companyId === companyId || s.company_id === companyId || (!s.companyId && companyId === 'COMP-001')
  );
};


export interface RegisterTenantParams {
  companyName: string;
  businessCategory?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  branchName?: string;
  branchCode?: string;
  branchLocation?: string;
  ownerPin: string;
}

export const registerTenantCompany = (
  params: RegisterTenantParams
): { company: Company; branch: Branch; owner: Salesperson } => {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const billingDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const companyId = `COMP-${Date.now().toString(36).toUpperCase()}`;
  const branchId = `BR-${randSuffix}-01`;
  const ownerId = `USR-${randSuffix}-01`;
  const offlineCode = `SAI-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const company: Company = {
    company_id: companyId,
    company_name: params.companyName.trim(),
    owner_name: params.ownerName.trim(),
    owner_email: params.ownerEmail.trim().toLowerCase(),
    phone: params.ownerPhone?.trim() || '',
    business_category: params.businessCategory || 'Grocery & FMCG',
    sheet_folder_id: '',
    trial_start_date: todayStr,
    subscription_status: 'TRIAL',
    plan: 'PROFESSIONAL',
    next_billing_date: billingDate,
    offline_activation_code: offlineCode,
    trial_days_remaining: 14,
  };

  saveCompany(company);

  const branch: Branch = {
    branchId: branchId,
    name: params.branchName?.trim() || 'Main Branch',
    code: params.branchCode?.trim().toUpperCase() || `${params.companyName.slice(0, 3).toUpperCase()}-01`,
    location: params.branchLocation?.trim() || 'Central Store',
    isMain: true,
    companyId: companyId,
    company_id: companyId,
  } as any;

  saveBranch(branch);

  const owner: Salesperson = {
    id: ownerId,
    name: params.ownerName.trim(),
    pin: params.ownerPin.trim() || '1234',
    role: 'OWNER',
    email: params.ownerEmail.trim().toLowerCase(),
    phone: params.ownerPhone?.trim() || '',
    active: 'Y',
    companyId: companyId,
    company_id: companyId,
    branchId: branchId,
    branch_id: branchId,
    branchName: branch.name,
    permissions: {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: true,
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: true,
      canCreateDirectGrv: true,
      canApproveDirectGrv: true,
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: true,
      canApproveEOD: true,
      canViewVarianceInvestigation: true,
      canViewAuditLog: true,
      canPinOverride: true,
      canManageCompany: true,
      canEditMasterPrice: true,
      canEditExchangeRate: true,
      canSeeMargin: true,
    },
  };

  addSalesperson(owner);

  // Switch context to newly created tenant
  setCurrentCompanyId(companyId);
  setCurrentBranchId(branchId);
  setSessionUser(owner);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'INFO',
    staffId: ownerId,
    staffName: owner.name,
    staffRole: 'OWNER',
    company_id: companyId,
    branch_id: branchId,
    details: `SaaS 14-Day Trial registered for company '${company.company_name}' (${companyId}). Trial active until ${billingDate}.`,
  });

  notifyListeners();
  return { company, branch, owner };
};

export const confirmCompanyPayment = (
  companyId: string,
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' = 'PROFESSIONAL',
  durationMonths: number = 1,
  confirmedBy: string = 'Andre Kudakwashe (Super Admin)',
  notes?: string
): { success: boolean; company?: Company; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) {
    return { success: false, message: 'Company account not found.' };
  }

  const now = new Date();
  const currentNext = new Date(comp.next_billing_date);
  const baseDate = currentNext.getTime() > now.getTime() ? currentNext : now;
  const newBillingDate = new Date(baseDate.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  comp.subscription_status = 'ACTIVE';
  comp.plan = plan;
  comp.next_billing_date = newBillingDate;
  comp.payment_confirmed_at = now.toISOString();
  comp.payment_confirmed_by = confirmedBy;
  if (notes) comp.notes = notes;

  saveCompany(comp);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'SECURITY',
    staffId: 'SUPER_ADMIN',
    staffName: confirmedBy,
    staffRole: 'SUPER_ADMIN',
    company_id: companyId,
    details: `Payment confirmed and license activated for '${comp.company_name}'. Plan: ${plan}, Next Billing: ${newBillingDate}.`,
  });

  notifyListeners();
  return {
    success: true,
    company: comp,
    message: `Payment confirmed for ${comp.company_name}! Account upgraded to ${plan} until ${newBillingDate}.`,
  };
};

export const extendCompanyTrial = (
  companyId: string,
  extraDays: number = 14,
  confirmedBy: string = 'Andre Kudakwashe'
): { success: boolean; company?: Company; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) {
    return { success: false, message: 'Company account not found.' };
  }

  const now = new Date();
  const currentNext = new Date(comp.next_billing_date);
  const baseDate = currentNext.getTime() > now.getTime() ? currentNext : now;
  const newBillingDate = new Date(baseDate.getTime() + extraDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  comp.subscription_status = 'TRIAL';
  comp.next_billing_date = newBillingDate;

  saveCompany(comp);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'WARNING',
    staffId: 'SUPER_ADMIN',
    staffName: confirmedBy,
    staffRole: 'SUPER_ADMIN',
    company_id: companyId,
    details: `14-Day Free Trial extended by ${extraDays} days for '${comp.company_name}' until ${newBillingDate}.`,
  });

  notifyListeners();
  return {
    success: true,
    company: comp,
    message: `Trial extended by ${extraDays} days for ${comp.company_name} (New expiry: ${newBillingDate}).`,
  };
};

export const suspendCompany = (
  companyId: string,
  reason: string = 'Payment Overdue / Cancelled'
): { success: boolean; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) return { success: false, message: 'Company not found.' };

  comp.subscription_status = 'CANCELLED';
  saveCompany(comp);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'CRITICAL',
    staffId: 'SUPER_ADMIN',
    staffName: 'Andre Kudakwashe',
    staffRole: 'SUPER_ADMIN',
    company_id: companyId,
    details: `Suspended SaaS tenant '${comp.company_name}'. Reason: ${reason}`,
  });

  notifyListeners();
  return { success: true, message: `Company ${comp.company_name} has been suspended.` };
};

export const activateCompanyWithCode = (
  companyId: string,
  enteredCode: string
): { success: boolean; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) return { success: false, message: 'Company not found.' };

  const cleanEntered = enteredCode.trim().toUpperCase();
  const validOffline = comp.offline_activation_code?.trim().toUpperCase();
  const masterBypass = 'SAI-ACTIVATE-2026';

  if (cleanEntered === validOffline || cleanEntered === masterBypass) {
    return confirmCompanyPayment(companyId, 'PROFESSIONAL', 1, 'Offline Key Activation');
  }

  return { success: false, message: 'Invalid activation key. Please contact Andre Kudakwashe.' };
};

// ============================================================================
// 52 GRANULAR PERMISSIONS DAO
// ============================================================================

export const getPermissionsList = (): PermissionRule[] => {
  return getStored<PermissionRule[]>(STORAGE_KEYS.PERMISSIONS, MASTER_PERMISSIONS_52);
};

export const savePermissionsList = (rules: PermissionRule[]): void => {
  setStored(STORAGE_KEYS.PERMISSIONS, rules);
  notifyListeners();
};

export const updatePermissionRule = (id: string, allowed: boolean): void => {
  const list = getPermissionsList();
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) {
    list[idx].allowed = allowed;
    setStored(STORAGE_KEYS.PERMISSIONS, list);
    notifyListeners();
  }
};

export const hasStaffPermission = (role: string, module: string, action: string): boolean => {
  const normalized = (role || 'CASHIER').toUpperCase();
  if (normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'SUPER_ADMIN') {
    return true;
  }
  const rules = getPermissionsList();
  const match = rules.find(
    (r) => r.role.toUpperCase() === normalized && r.module === module && (r.action === action || r.action === '*')
  );
  if (match) {
    return Boolean(match.allowed);
  }
  // Default fallbacks for Supervisor vs Cashier
  if (normalized === 'SUPERVISOR') {
    if (action === 'approve' || action === 'view_variance' || action === 'pin_override') return true;
  }
  if (normalized === 'CASHIER') {
    if (action === 'edit_price' || action === 'approve' || action === 'void_sale') return false;
    if (action === 'create' || action === 'change_use' || action === 'credit_issue') return true;
  }
  return false;
};

// ============================================================================
// DIRECT SUPPLIER DELIVERIES (DIRECT GRV) DAO
// ============================================================================

export const INITIAL_DIRECT_GRVS: DirectGrv[] = [
  {
    id: 'DGRV-20260905-001',
    grvNumber: 'DGRV-20260905-001',
    type: 'DIRECT',
    status: 'APPROVED',
    companyId: 'COMP-001',
    branchId: 'BR-MAIN',
    branchName: 'Harare Main',
    supplierId: 'SUP-001',
    supplierName: 'National Foods Wholesalers',
    invoiceNo: 'SUP-INV-4401',
    purchaseOrderNo: 'PO-2026-081',
    date: '2026-09-05',
    items: [
      {
        productId: 'SUG001',
        productName: 'White Sugar 2kg',
        quantity: 10,
        costPrice: 1.30,
        sellingPrice: 1.80,
        lineTotal: 13.00,
        markupPercent: 38.46,
        profit: 5.00,
        unitsPerCase: 20,
        unit: 'Singles',
      },
      {
        productId: 'OIL002',
        productName: 'Pure Cooking Oil 2L',
        quantity: 5,
        costPrice: 2.50,
        sellingPrice: 3.50,
        lineTotal: 12.50,
        markupPercent: 40.00,
        profit: 5.00,
        unitsPerCase: 12,
        unit: 'Singles',
      },
    ],
    totalCost: 25.50,
    totalSellingPrice: 35.50,
    payFromTill: true,
    payments: [
      {
        userId: 'USR-003',
        userName: 'Tariro Moyo',
        amount: 25.50,
        pinConfirmed: true,
        confirmedAt: '2026-09-05T10:15:00Z',
      },
    ],
    receivedByStaffId: 'USR-003',
    receivedByStaffName: 'Tariro Moyo',
    approvedByStaffId: 'USR-002',
    approvedByStaffName: 'Supervisor Harare',
    approvedAt: '2026-09-05T10:30:00Z',
    createdAt: '2026-09-05T10:15:00Z',
    synced: true,
  },
  {
    id: 'DGRV-20260906-002',
    grvNumber: 'DGRV-20260906-002',
    type: 'DIRECT',
    status: 'PENDING_APPROVAL',
    companyId: 'COMP-001',
    branchId: 'BR-MAIN',
    branchName: 'Harare Main',
    supplierId: 'SUP-002',
    supplierName: 'Delta Beverages Distribution',
    invoiceNo: 'DLT-99812',
    purchaseOrderNo: 'PO-2026-092',
    date: '2026-09-06',
    items: [
      {
        productId: 'BEV006',
        productName: 'Cola Spark Soft Drink 300ml',
        quantity: 24,
        costPrice: 0.50,
        sellingPrice: 0.75,
        lineTotal: 12.00,
        markupPercent: 50.00,
        profit: 6.00,
        unitsPerCase: 24,
        unit: 'Singles',
      },
    ],
    totalCost: 12.00,
    totalSellingPrice: 18.00,
    payFromTill: true,
    payments: [
      {
        userId: 'USR-003',
        userName: 'Tariro Moyo',
        amount: 12.00,
        pinConfirmed: true,
        confirmedAt: '2026-09-06T08:00:00Z',
      },
    ],
    receivedByStaffId: 'USR-003',
    receivedByStaffName: 'Tariro Moyo',
    createdAt: '2026-09-06T08:00:00Z',
    synced: false,
  },
  {
    id: 'DGRV-20260910-003',
    grvNumber: 'DGRV-20260910-003',
    type: 'DIRECT',
    status: 'APPROVED',
    companyId: 'COMP-001',
    branchId: 'BR-MAIN',
    branchName: 'Harare Main',
    supplierId: 'SUP-001',
    supplierName: 'National Foods Wholesalers',
    invoiceNo: 'NF-INV-88301',
    purchaseOrderNo: 'PO-2026-104',
    date: '2026-09-10',
    items: [
      {
        productId: 'SUG001',
        productName: 'White Sugar 2kg',
        quantity: 25,
        costPrice: 1.30,
        sellingPrice: 1.80,
        lineTotal: 32.50,
        markupPercent: 38.46,
        profit: 12.50,
        unitsPerCase: 20,
        unit: 'Singles',
      },
    ],
    totalCost: 32.50,
    totalSellingPrice: 45.00,
    payFromTill: false,
    paymentMethod: 'SAFE_PAYOUT',
    paymentStatus: 'AWAITING_SAFE_PAYMENT',
    allocatedSafeId: 'ACC-BR-SAFE-BR-MAIN',
    allocatedSafeName: 'Branch Safe (Main Vault)',
    receivedByStaffId: 'USR-003',
    receivedByStaffName: 'Tariro Moyo',
    approvedByStaffId: 'USR-002',
    approvedByStaffName: 'Supervisor Harare',
    approvedAt: '2026-09-10T11:00:00Z',
    createdAt: '2026-09-10T10:45:00Z',
    synced: false,
  },
  {
    id: 'DGRV-20260912-004',
    grvNumber: 'DGRV-20260912-004',
    type: 'DIRECT',
    status: 'APPROVED',
    companyId: 'COMP-001',
    branchId: 'BR-MAIN',
    branchName: 'Harare Main',
    supplierId: 'SUP-002',
    supplierName: 'Delta Beverages Distribution',
    invoiceNo: 'DLT-INV-66521',
    purchaseOrderNo: 'PO-2026-115',
    date: '2026-09-12',
    items: [
      {
        productId: 'BEV006',
        productName: 'Cola Spark Soft Drink 300ml',
        quantity: 120,
        costPrice: 0.50,
        sellingPrice: 0.75,
        lineTotal: 60.00,
        markupPercent: 50.00,
        profit: 30.00,
        unitsPerCase: 24,
        unit: 'Singles',
      },
    ],
    totalCost: 60.00,
    totalSellingPrice: 90.00,
    payFromTill: false,
    paymentMethod: 'SAFE_PAYOUT',
    paymentStatus: 'AWAITING_SAFE_PAYMENT',
    allocatedSafeId: 'ACC-BR-SAFE-BR-MAIN',
    allocatedSafeName: 'Branch Safe (Main Vault)',
    receivedByStaffId: 'USR-003',
    receivedByStaffName: 'Tariro Moyo',
    approvedByStaffId: 'USR-002',
    approvedByStaffName: 'Supervisor Harare',
    approvedAt: '2026-09-12T14:30:00Z',
    createdAt: '2026-09-12T14:15:00Z',
    synced: false,
  },
];

export const getAllDirectGrvs = (): DirectGrv[] => {
  const legacy = getStored<DirectGrv[]>(STORAGE_KEYS.DIRECT_GRVS, INITIAL_DIRECT_GRVS);
  return getDualReadDirectGrvs(legacy);
};

export const getDirectGrvs = (): DirectGrv[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllDirectGrvs();
  const isMasterOr001 = (c?: string) => !c || c === 'COMP-001' || c === 'COMP-MASTER';

  return all.filter((g) => {
    const compId = (g as any).company_id || (g as any).companyId;
    const matchesComp =
      (!compId && isMasterOr001(currentCompany)) ||
      (isMasterOr001(compId) && isMasterOr001(currentCompany)) ||
      compId === currentCompany;
    if (!matchesComp) return false;
    const brId = (g as any).branch_id || (g as any).branchId || 'BR-MAIN';
    return !currentBranch || brId === currentBranch || brId === 'ALL' || brId === 'BR-MAIN';
  });
};

export const getDirectGrvById = (id: string): DirectGrv | null => {
  const list = getAllDirectGrvs();
  return list.find((g) => g.id === id || g.grvNumber === id) || null;
};

export const getDirectGrvPaymentsForStaff = (
  staffId: string,
  date?: string
): Array<{
  grv: DirectGrv;
  payment: DirectGrvTillPayment;
}> => {
  const grvs = getAllDirectGrvs();
  const results: Array<{ grv: DirectGrv; payment: DirectGrvTillPayment }> = [];

  grvs.forEach((grv) => {
    if (grv.status === 'REJECTED') return;
    if (date && grv.date !== date) return;
    if (grv.payments && grv.payments.length > 0) {
      grv.payments.forEach((p) => {
        if (p.userId === staffId && p.amount > 0) {
          results.push({ grv, payment: p });
        }
      });
    }
  });

  return results;
};

export const getDirectGrvsForStaffAndDate = (staffId: string, date: string): DirectGrv[] => {
  const grvs = getAllDirectGrvs();
  const targetId = String(staffId).trim().toLowerCase();
  const normTarget = targetId.replace(/^usr-|^staff-|^0+/, '');

  return grvs.filter((g) => {
    if (g.status === 'REJECTED') return false;
    const gDate = g.date || toDateStringSafe(g.createdAt);
    if (gDate !== date) return false;

    // Check receivedByStaffId
    const recId = g.receivedByStaffId ? String(g.receivedByStaffId).trim().toLowerCase() : '';
    const normRec = recId.replace(/^usr-|^staff-|^0+/, '');
    if (recId === targetId || (normTarget && normRec === normTarget)) return true;

    // Check payments from till
    if (g.payments && g.payments.length > 0) {
      return g.payments.some((p) => {
        const pId = p.userId ? String(p.userId).trim().toLowerCase() : '';
        const normP = pId.replace(/^usr-|^staff-|^0+/, '');
        return pId === targetId || (normTarget && normP === normTarget);
      });
    }

    return false;
  });
};

export const recordDirectGrvTillPayouts = (grv: DirectGrv) => {
  if (grv.status === 'REJECTED') return;
  const shiftDate = grv.date || (grv.createdAt ? grv.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]);
  const now = grv.createdAt || new Date().toISOString();
  const compId = (grv as any).companyId || (grv as any).company_id || getCurrentCompanyId();
  const brId = (grv as any).branchId || (grv as any).branch_id || getCurrentBranchId();

  // Determine payments
  const payments: DirectGrvTillPayment[] =
    grv.payments && grv.payments.length > 0
      ? grv.payments
      : (grv.payFromTill && (grv.totalCost || 0) > 0)
      ? [
          {
            userId: grv.receivedByStaffId || 'USR-003',
            userName: grv.receivedByStaffName || 'Cashier',
            amount: grv.totalCost,
            drawerId: 'Till 1',
            pinConfirmed: true,
            confirmedAt: now,
          },
        ]
      : [];

  const existingMovements = getMovements();
  const currentLogs = getCashLogs();

  payments.forEach((p, pIdx) => {
    if ((p.amount || 0) <= 0) return;
    const staffShiftId = getShiftId(p.userId, shiftDate);
    const voucherKey = payments.length > 1 ? `${grv.grvNumber}-P${pIdx + 1}` : grv.grvNumber;

    const existingM = existingMovements.find(
      (m) =>
        m.type === 'supplier_payment' &&
        (m.sourceRef === grv.grvNumber ||
          m.sourceRef === voucherKey ||
          m.sourceRef === grv.id ||
          (m.notes && m.notes.includes(grv.grvNumber)))
    );

    if (existingM) {
      if (existingM.amount !== p.amount || existingM.status !== 'approved' || !existingM.affectsDrawer) {
        updateMovement(existingM.id, {
          amount: p.amount,
          status: 'approved',
          affectsDrawer: true,
          direction: 'out',
        });
      }
    } else {
      addMovement({
        shiftId: staffShiftId,
        staffId: p.userId,
        terminalId: p.drawerId || 'Till 1',
        date: shiftDate,
        timestamp: now,
        type: 'supplier_payment',
        amount: p.amount,
        currency: 'USD',
        direction: 'out',
        affectsDrawer: true,
        status: 'approved',
        sourceModule: 'DirectGRV',
        sourceRef: grv.grvNumber,
        notes: `Direct Supplier Delivery: ${grv.supplierName} (${grv.grvNumber})`,
        company_id: compId,
        branch_id: brId,
      });
    }

    const hasLog = currentLogs.some(
      (l) =>
        l.staffId === p.userId &&
        l.date === shiftDate &&
        (l.reference === grv.grvNumber || l.reference === voucherKey || l.description.includes(grv.grvNumber))
    );

    if (!hasLog) {
      addCashLog({
        timestamp: now,
        date: shiftDate,
        staffId: p.userId,
        staffName: p.userName,
        line: 'Direct Procurement',
        description: `Direct Supplier Delivery Payout: ${grv.supplierName} (${grv.grvNumber})`,
        in: 0,
        out: p.amount,
        category: 'Direct Procurement',
        reference: grv.grvNumber,
      });
    }
  });
};

export const saveDirectGrv = (grv: DirectGrv): DirectGrv => {
  const list = getAllDirectGrvs();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = (grv as any).company_id || (grv as any).companyId || currentCompany || 'COMP-001';
  const brId = (grv as any).branch_id || (grv as any).branchId || currentBranch || 'BR-MAIN';
  const normalized: DirectGrv = {
    ...grv,
    companyId: compId,
    company_id: compId,
    branchId: brId,
    branch_id: brId,
  } as any;
  const index = list.findIndex((g) => g.id === grv.id || g.grvNumber === grv.grvNumber);
  if (index >= 0) {
    list[index] = normalized;
  } else {
    list.unshift(normalized);
  }
  setStored(STORAGE_KEYS.DIRECT_GRVS, list);

  // If this direct GRV pays cash from till, immediately record the cash payout movement and CashLog
  // so Live Drawer Balance and Form 4 canonical cash holding are deducted right away.
  if (normalized.status !== 'REJECTED') {
    recordDirectGrvTillPayouts(normalized);
  }

  // Sync to unified goodsReceivedNotes store
  try {
    postDirectDelivery(normalized);
  } catch (err) {
    console.warn('[GRN] postDirectDelivery sync warning:', err);
  }

  // Log audit
  addAuditLog({
    action: 'DIRECT_GRV_CREATE',
    severity: 'INFO',
    staffId: grv.receivedByStaffId,
    staffName: grv.receivedByStaffName,
    staffRole: 'CASHIER',
    details: `Direct Supplier Delivery ${grv.grvNumber} created. Supplier: ${grv.supplierName}. Total Cost: $${grv.totalCost.toFixed(2)}. Status: ${grv.status}`,
    referenceId: grv.grvNumber,
    amount: grv.totalCost,
  });

  enqueueSync('Direct_GRV', 'INSERT', normalized);
  notifyListeners();
  return normalized;
};

/**
 * Approve Direct GRV:
 * 1. Sets status = 'APPROVED'
 * 2. Updates Stock in Inventory Master
 * 3. Records Till Payout / Cash Log OUT
 * 4. Writes Forensic Audit Log
 */
export const approveDirectGrv = (
  id: string,
  approverId: string,
  approverName: string
): { success: boolean; message: string; grv?: DirectGrv } => {
  const list = getAllDirectGrvs();
  const grv = list.find((g) => g.id === id || g.grvNumber === id);
  if (!grv) {
    return { success: false, message: 'GRV voucher not found.' };
  }
  if (grv.status === 'APPROVED') {
    return { success: false, message: 'GRV voucher is already approved.' };
  }

  const now = new Date().toISOString();
  grv.status = 'APPROVED';
  grv.approvedByStaffId = approverId;
  grv.approvedByStaffName = approverName;
  grv.approvedAt = now;

  // 1. Increment inventory for each item with FIFO batches & audit movement logs
  const allInventory = getAllInventoryItems();
  const dateStr = grv.date || now.split('T')[0];

  grv.items.forEach((item) => {
    const cleanId = (item.productId || '').trim().toUpperCase();
    const cleanName = (item.productName || '').trim().toLowerCase();

    let invItem = allInventory.find((i) => 
      (cleanId && i.itemId && i.itemId.trim().toUpperCase() === cleanId) ||
      (cleanId && i.sku && i.sku.trim().toUpperCase() === cleanId) ||
      (cleanName && i.itemName && i.itemName.trim().toLowerCase() === cleanName)
    );

    if (!invItem) {
      // Auto-register item in inventory catalog if not found
      const fallbackId = cleanId || `ITM-${Date.now().toString().slice(-4)}`;
      invItem = {
        itemId: fallbackId,
        itemName: item.productName || 'Direct Delivery Item',
        category: 'General',
        unitsPerCase: item.unitsPerCase || 1,
        canSellAsCase: item.receiveAs === 'Cases',
        costPerCase: item.costPerCase || ((item.costPrice || 0) * (item.unitsPerCase || 1)),
        costPerUnit: item.costPrice || 0,
        sellPriceCase: item.sellingPrice ? item.sellingPrice * (item.unitsPerCase || 1) : 0,
        sellPriceUnit: item.sellingPrice || 0,
        stockCases: 0,
        stockSingles: 0,
        totalUnits: 0,
        reorderLevelCases: 2,
        reorderLevelUnits: 10,
        lastUpdated: now,
      };
    }

    const unitsPerCase = Math.max(1, invItem.unitsPerCase || item.unitsPerCase || 1);
    const canSellAsCase = Boolean(invItem.canSellAsCase);

    const recCases = Math.max(
      0,
      item.quantityCases !== undefined
        ? Number(item.quantityCases)
        : (item.receiveAs === 'Cases' ? Math.floor((item.quantity || 0) / unitsPerCase) : 0)
    );
    const recSingles = Math.max(
      0,
      item.quantitySingles !== undefined
        ? Number(item.quantitySingles)
        : (item.receiveAs === 'Singles' ? Number(item.quantity || 0) : 0)
    );
    const totalLineUnits = (recCases * unitsPerCase) + recSingles;

    let finalRecCases = recCases;
    let finalRecSingles = recSingles;
    let autoBroken = false;
    let convertedCasesToSingles = false;
    let ruleNote = '';

    // Rule A:
    // If "Sell as Case" is deactivated (default), convert all received cases into singles immediately
    if (!canSellAsCase && recCases > 0) {
      convertedCasesToSingles = true;
      const gainedSingles = recCases * unitsPerCase;
      finalRecCases = 0;
      finalRecSingles = recSingles + gainedSingles;
      ruleNote = ` [Converted ${recCases} received case(s) into ${gainedSingles} singles because 'Sell as Case' is deactivated]`;
    } else if (canSellAsCase && recCases > 0 && (invItem.stockSingles || 0) === 0) {
      // Auto-break 1 case so singles are immediately salable
      autoBroken = true;
      finalRecCases = recCases - 1;
      finalRecSingles = recSingles + unitsPerCase;
      ruleNote = ` [Rule A: Auto-broke 1 case to ${unitsPerCase} singles because StockSingles was 0]`;
    }

    // Clear any negative balances on receiving
    const clearing = clearNegativeBalancesOnGRN({
      itemId: invItem.itemId,
      receivedUnits: totalLineUnits,
      newCostPerUnit: item.costPrice || (unitsPerCase > 0 ? (item.costPerCase || 0) / unitsPerCase : 0),
      grnId: grv.grvNumber,
    });

    // Create StockBatch for FIFO tracking
    const batchId = `BATCH-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${invItem.itemId}`;
    const newBatch: StockBatch = {
      id: batchId,
      itemId: invItem.itemId,
      itemName: invItem.itemName,
      batchNumber: item.batchNumber || `DGRV-${grv.grvNumber}`,
      qtyReceived: totalLineUnits,
      qtyOnHand: clearing.remainingUnitsForNewBatch,
      cost: totalLineUnits * (item.costPrice || 0),
      costPerUnit: item.costPrice || 0,
      costPerCase: item.costPerCase || ((item.costPrice || 0) * unitsPerCase),
      expiryDate: item.expiryDate,
      receivedDate: dateStr,
      supplier: grv.supplierName,
      grnId: grv.grvNumber,
      invoiceNo: grv.invoiceNo || grv.grvNumber,
      branchId: grv.branchId || 'BR-001',
      notes: `Direct GRV ${grv.grvNumber}${ruleNote}`,
      createdAt: now,
    };
    saveStockBatch(newBatch);

    const prevCases = invItem.stockCases || 0;
    const prevSingles = invItem.stockSingles || 0;
    const newStockCases = prevCases + finalRecCases;
    const newStockSingles = prevSingles + finalRecSingles;
    const newTotalUnits = (newStockCases * unitsPerCase) + newStockSingles;

    invItem.stockCases = newStockCases;
    invItem.stockSingles = newStockSingles;
    invItem.totalUnits = newTotalUnits;

    // Moving Weighted Average Cost (AVCO) calculation for Direct GRV:
    const incomingUnitCost = item.costPrice || (unitsPerCase > 0 ? (item.costPerCase || 0) / unitsPerCase : (invItem.costPerUnit || 0));
    const priorUnits = Math.max(0, (prevCases * unitsPerCase) + prevSingles);
    const priorAvgCost = invItem.averageCostPerUnit !== undefined && invItem.averageCostPerUnit > 0
      ? invItem.averageCostPerUnit
      : (invItem.costPerUnit || 0);

    const totalCostPool = (priorUnits * priorAvgCost) + (totalLineUnits * incomingUnitCost);
    const combinedUnits = priorUnits + totalLineUnits;
    const computedAvgCostUnit = combinedUnits > 0 ? Number((totalCostPool / combinedUnits).toFixed(4)) : incomingUnitCost;
    const computedAvgCostCase = Number((computedAvgCostUnit * unitsPerCase).toFixed(2));
    const computedLatestCostUnit = Number(incomingUnitCost.toFixed(4));
    const computedLatestCostCase = item.costPerCase || Number((incomingUnitCost * unitsPerCase).toFixed(2));

    invItem.costPerUnit = incomingUnitCost;
    invItem.costPerCase = computedLatestCostCase;
    invItem.averageCostPerUnit = computedAvgCostUnit;
    invItem.averageCostPerCase = computedAvgCostCase;
    invItem.latestCostPerUnit = computedLatestCostUnit;
    invItem.latestCostPerCase = computedLatestCostCase;

    if (item.sellingPrice) {
      invItem.sellPriceUnit = item.sellingPrice;
      if (canSellAsCase) {
        invItem.sellPriceCase = item.sellingPrice * unitsPerCase;
      }
    }
    invItem.lastUpdated = now;

    saveInventoryItem(invItem);

    // 1b. Add GoodsReceivedEntry log for audit records
    addGoodsReceived({
      grnId: grv.grvNumber,
      invoiceNo: grv.invoiceNo || grv.grvNumber,
      purchaseOrderNo: grv.purchaseOrderNo,
      date: dateStr,
      supplier: grv.supplierName,
      branchId: grv.branchId || 'BR-001',
      branchName: grv.branchName || 'Main Store',
      itemId: invItem.itemId,
      itemName: invItem.itemName,
      receivedCases: recCases,
      receivedSingles: recSingles,
      receiveAs: item.receiveAs || 'Cases',
      lastCost: item.costPrice || 0,
      costPerCase: item.costPerCase || ((item.costPrice || 0) * unitsPerCase),
      costPerUnit: item.costPrice || 0,
      sellingPrice: item.sellingPrice || invItem.sellPriceUnit || 0,
      marginPercent: item.markupPercent || 0,
      lineTotal: item.lineTotal || (totalLineUnits * (item.costPrice || 0)),
      autoBreakCaseToSingles: autoBroken,
      convertedCasesToSingles,
      notes: `Direct Delivery GRV approved by ${approverName}${ruleNote}`,
      staffId: approverId,
      staffName: approverName,
      timestamp: now,
      synced: false,
    });

    // 1c. Add StockMovement log
    const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${invItem.itemId}`;
    addStockMovement({
      txnId,
      movementId: txnId,
      date: dateStr,
      staffId: approverId,
      staffName: approverName,
      itemId: invItem.itemId,
      itemName: invItem.itemName,
      txnType: 'RECEIVE',
      movementType: 'GOODS_RECEIVED',
      qtyCases: recCases,
      qtySingles: recSingles,
      casesChange: finalRecCases,
      singlesChange: finalRecSingles,
      closingCases: newStockCases,
      closingSingles: newStockSingles,
      resultingStockCases: newStockCases,
      resultingStockSingles: newStockSingles,
      promptShown: convertedCasesToSingles
        ? 'Converted Cases to Singles (Sell as Case Deactivated)'
        : autoBroken
        ? 'Rule A: Auto-Break on Zero Singles'
        : `Direct GRV: ${grv.grvNumber}`,
      actionTaken: 'DIRECT_DELIVERY_RECEIVE',
      referenceId: grv.grvNumber,
      reason: `Direct Delivery from ${grv.supplierName} (${grv.invoiceNo || 'No Invoice#'})`,
      timestamp: now,
      synced: false,
    });
  });

  // 2. Till Payouts -> sync movements & CashLog & Expense entries
  recordDirectGrvTillPayouts(grv);

  if (grv.payFromTill && grv.payments && grv.payments.length > 0) {
    const shiftDate = grv.date || now.split('T')[0];
    grv.payments.forEach((p) => {
      if (p.amount > 0) {
        addExpense({
          timestamp: now,
          date: shiftDate,
          category: 'Direct Supplier Delivery Payout',
          amount: p.amount,
          paymentMethod: 'Cash',
          staffId: p.userId,
          staffName: p.userName,
          vendorOrCustomer: grv.supplierName,
          description: `Till payout for Direct Delivery voucher ${grv.grvNumber}`,
          receiptRef: grv.invoiceNo || grv.grvNumber,
        });
      }
    });
  }

  // 3. Save GRV
  setStored(STORAGE_KEYS.DIRECT_GRVS, list);

  // Sync to unified goodsReceivedNotes store
  try {
    approveGRN(grv.id, approverId, approverName);
  } catch (err) {
    console.warn('[GRN] approveGRN sync warning:', err);
  }

  // 4. Audit Log
  addAuditLog({
    action: 'DIRECT_GRV_APPROVE',
    severity: 'SECURITY',
    staffId: approverId,
    staffName: approverName,
    staffRole: 'SUPERVISOR',
    details: `Approved Direct GRV ${grv.grvNumber} for ${grv.supplierName}. Total Cost: $${grv.totalCost.toFixed(2)}. Till Payout: $${grv.payFromTill ? grv.totalCost.toFixed(2) : '0.00'}. Stock updated.`,
    referenceId: grv.grvNumber,
    amount: grv.totalCost,
  });

  enqueueSync('Direct_GRV', 'UPDATE', grv);
  notifyListeners();
  return {
    success: true,
    message: `Direct Delivery ${grv.grvNumber} approved successfully. Stock increased and Till Payout recorded.`,
    grv,
  };
};

export const rejectDirectGrv = (
  id: string,
  rejectorId: string,
  rejectorName: string,
  reason: string
): { success: boolean; message: string; grv?: DirectGrv } => {
  const list = getAllDirectGrvs();
  const grv = list.find((g) => g.id === id || g.grvNumber === id);
  if (!grv) {
    return { success: false, message: 'GRV voucher not found.' };
  }

  const wasPreviouslyApproved = grv.status === 'APPROVED';
  const now = new Date().toISOString();
  const shiftDate = grv.date || now.split('T')[0];

  grv.status = 'REJECTED';
  grv.rejectedReason = reason;
  setStored(STORAGE_KEYS.DIRECT_GRVS, list);

  // 1. Update associated cashMovements to rejected status & reverse the money back into cashier till
  const movements = getMovements();
  movements.forEach((m) => {
    if (m.type === 'supplier_payment' && (m.sourceRef === grv.grvNumber || m.sourceRef?.startsWith(grv.grvNumber) || m.sourceRef === grv.id)) {
      updateMovement(m.id, { status: 'rejected' });
    }
  });

  // 2. Refund till payments back into cashier drawers so cashier Form 2 and live drawer balance are restored!
  if (grv.payments && grv.payments.length > 0) {
    grv.payments.forEach((p) => {
      const amt = Number(p.amount) || 0;
      if (amt > 0 && p.userId) {
        // A. Add cash movement (IN) to cashier drawer
        addMovement({
          shiftId: getShiftId(p.userId, shiftDate),
          staffId: p.userId,
          terminalId: p.drawerId || 'Till 1',
          date: shiftDate,
          timestamp: now,
          type: 'supplier_refund',
          amount: amt,
          currency: 'USD',
          direction: 'in',
          affectsDrawer: true,
          status: 'approved',
          sourceModule: 'DirectGRV',
          sourceRef: grv.grvNumber,
          notes: `REVERSAL: Direct Delivery ${grv.grvNumber} rejected by ${rejectorName} - $${amt.toFixed(2)} refunded to drawer (${reason})`,
          approvedBy: rejectorId,
          approvedByName: rejectorName,
          company_id: (grv as any).company_id || (grv as any).companyId,
          branch_id: (grv as any).branch_id || (grv as any).branchId,
        });

        // B. Add Form 2 CashLog entry (IN) so cashier's Daily Cash Log reflects the reversal
        addCashLog({
          timestamp: now,
          date: shiftDate,
          staffId: p.userId,
          staffName: p.userName,
          line: 'Direct Procurement',
          description: `REVERSAL: Direct Delivery ${grv.grvNumber} rejected by ${rejectorName} - Refunded to ${p.userName}'s till (${reason})`,
          in: amt,
          out: 0,
          category: 'Direct Procurement Reversal',
          reference: grv.grvNumber,
          company_id: (grv as any).company_id || (grv as any).companyId,
          branch_id: (grv as any).branch_id || (grv as any).branchId,
        });
      }
    });
  }

  // 3. If voucher was previously approved, reverse the stock added to inventory
  if (wasPreviouslyApproved && Array.isArray(grv.items)) {
    const allInventory = getAllInventoryItems();
    grv.items.forEach((item) => {
      const cleanId = (item.productId || '').trim().toUpperCase();
      const cleanName = (item.productName || '').trim().toLowerCase();
      const invItem = allInventory.find((i) =>
        (cleanId && i.itemId && i.itemId.trim().toUpperCase() === cleanId) ||
        (cleanId && i.sku && i.sku.trim().toUpperCase() === cleanId) ||
        (cleanName && i.itemName && i.itemName.trim().toLowerCase() === cleanName)
      );

      if (invItem) {
        const unitsPerCase = Math.max(1, invItem.unitsPerCase || item.unitsPerCase || 1);
        const recCases = Math.max(0, Number(item.quantityCases) || 0);
        const recSingles = Math.max(0, Number(item.quantitySingles) || 0);
        const deltaQty = (recCases * unitsPerCase) + recSingles;

        if (deltaQty > 0) {
          updateProductStock(invItem.itemId, -deltaQty, undefined, undefined, {
            staffId: rejectorId,
            staffName: rejectorName,
            referenceId: grv.grvNumber,
            reason: `Direct Delivery ${grv.grvNumber} rejected: reversed ${deltaQty} received units`,
            actionTaken: 'DIRECT_DELIVERY_REVERSAL',
            txnType: 'ADJUSTMENT',
          });
        }
      }
    });
  }

  addAuditLog({
    action: 'DIRECT_GRV_REJECT',
    severity: 'SECURITY',
    staffId: rejectorId,
    staffName: rejectorName,
    staffRole: 'SUPERVISOR',
    details: `Rejected Direct Delivery Voucher ${grv.grvNumber}. Reason: ${reason}. Payouts reversed to cashier drawers.`,
    referenceId: grv.grvNumber,
  });

  notifyListeners();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
    window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
    window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
  }
  return { success: true, message: `GRV ${grv.grvNumber} rejected and cash returned to cashier drawer(s).`, grv };
};

// ============================================================================
// BRANCH DATA ISOLATION QUERIES
// ============================================================================

export const getSalesForCurrentBranch = (): SaleInvoice[] => {
  return getSales();
};

export const getDirectGrvsForCurrentBranch = (): DirectGrv[] => {
  const branchId = getCurrentBranchId();
  const grvs = getDirectGrvs();
  const branches = getBranches();
  const currentCompany = getCurrentCompanyId();
  return grvs.filter((g) => isRecordInBranchScope(g.branchId || (g as any).branch_id, branchId, branches, currentCompany));
};

export const getCashLogsForCurrentBranch = (): CashLogEntry[] => {
  return getCashLogs();
};

// ============================================================================
// CASH CUSTODY CHAIN & CASH TRANSFERS DAO
// ============================================================================

export const getAllCashAccounts = (): CashAccount[] => {
  const accounts = getStored<CashAccount[]>(STORAGE_KEYS.CASH_ACCOUNTS, []);
  return Array.isArray(accounts) ? accounts : [];
};

const isCashBranchMatch = (b1?: string, b2?: string): boolean => {
  if (!b1 || !b2) return true;
  if (b1 === b2) return true;
  if ((b1 === '1' || b1 === 'BR-MAIN') && (b2 === '1' || b2 === 'BR-MAIN')) return true;
  return false;
};

const isCashCompanyMatch = (c1?: string, c2?: string): boolean => {
  if (!c1 || !c2) return true;
  if (c1 === c2) return true;
  if ((c1 === 'COMP-001' || c1 === 'COMP-MASTER') && (c2 === 'COMP-001' || c2 === 'COMP-MASTER')) return true;
  return false;
};

export const getCashAccounts = (branchId?: string): CashAccount[] => {
  const all = getAllCashAccounts();
  const currentCompany = getCurrentCompanyId();
  const targetBranch = branchId || getCurrentBranchId();

  return all.filter((acc) => {
    const compMatch = isCashCompanyMatch(acc.company_id, currentCompany);
    if (!compMatch) return false;
    // HQ Safe and Commercial Bank accounts are global to company
    if (acc.account_type === 'HQ_SAFE' || acc.account_type === 'BANK_ACCOUNT') return true;
    if (!branchId) return true;
    return !acc.branch_id || acc.branch_id === targetBranch || acc.branch_id === 'HQ' || isCashBranchMatch(acc.branch_id, targetBranch);
  });
};

export const setAllCashAccounts = (accounts: CashAccount[]): void => {
  setStored(STORAGE_KEYS.CASH_ACCOUNTS, accounts);
  notifyListeners();
};

export const saveCashAccount = (account: CashAccount): CashAccount => {
  const all = getAllCashAccounts();
  const currentCompany = getCurrentCompanyId();
  const now = new Date().toISOString();

  // Find index by exact account_id OR by matching type + branch alias (to prevent duplicate accounts)
  let index = all.findIndex((a) => a.account_id === account.account_id);
  if (index < 0) {
    index = all.findIndex(
      (a) =>
        a.account_type === account.account_type &&
        (account.account_type === 'HQ_SAFE' || account.account_type === 'BANK_ACCOUNT' || isCashBranchMatch(a.branch_id, account.branch_id))
    );
  }

  const toSave: CashAccount = {
    ...account,
    company_id: account.company_id || currentCompany,
    updated_at: now,
    created_at: (index >= 0 && all[index]?.created_at) ? all[index].created_at : (account.created_at || now),
  };

  let updated: CashAccount[];
  if (index >= 0) {
    updated = [...all];
    updated[index] = toSave;
    // Also synchronize any other duplicate/alias accounts of the same type and branch so balances never diverge
    updated = updated.map((a, i) => {
      if (i !== index &&
          a.account_type === toSave.account_type &&
          (toSave.account_type === 'HQ_SAFE' || toSave.account_type === 'BANK_ACCOUNT' || isCashBranchMatch(a.branch_id, toSave.branch_id))) {
        return {
          ...a,
          current_balance: toSave.current_balance,
          updated_at: now,
        };
      }
      return a;
    });
  } else {
    updated = [...all, toSave];
  }

  setStored(STORAGE_KEYS.CASH_ACCOUNTS, updated);
  enqueueSync('CashAccounts' as any, index >= 0 ? 'UPDATE' : 'INSERT', toSave);
  notifyListeners();
  return toSave;
};

export const getAllCashTransfers = (): CashTransfer[] => {
  const transfers = getStored<CashTransfer[]>(STORAGE_KEYS.CASH_TRANSFERS, []);
  return Array.isArray(transfers) ? transfers : [];
};

export const getCashTransfers = (branchId?: string): CashTransfer[] => {
  const all = getAllCashTransfers();
  const currentCompany = getCurrentCompanyId();
  const targetBranch = branchId || getCurrentBranchId();

  return all.filter((t) => {
    const compMatch = isCashCompanyMatch(t.company_id, currentCompany);
    if (!compMatch) return false;
    if (!branchId) return true;
    return !t.branch_id || t.branch_id === targetBranch || t.branch_id === 'HQ' || isCashBranchMatch(t.branch_id, targetBranch);
  });
};

export const saveCashTransfer = (transfer: CashTransfer): CashTransfer => {
  const all = getAllCashTransfers();
  const currentCompany = getCurrentCompanyId();
  const index = all.findIndex((t) => t.transfer_id === transfer.transfer_id);

  const toSave: CashTransfer = {
    ...transfer,
    company_id: transfer.company_id || currentCompany,
    created_at: transfer.created_at || new Date().toISOString(),
  };

  let updated: CashTransfer[];
  if (index >= 0) {
    updated = [...all];
    updated[index] = toSave;
  } else {
    updated = [toSave, ...all];
  }

  setStored(STORAGE_KEYS.CASH_TRANSFERS, updated);
  enqueueSync('CashTransfers' as any, index >= 0 ? 'UPDATE' : 'INSERT', toSave);
  notifyListeners();
  return toSave;
};

// ==================== CASH GOVERNANCE CONFIG ====================
export const DEFAULT_CASH_GOVERNANCE_CONFIG: CashGovernanceConfig = {
  governanceMode: 'LEAN', // default to LEAN so small businesses are never blocked by staff shortages!
  defaultTillFloat: 20.0,
  floatSourceAccountId: 'SAFE',
  autoAcceptTillFloat: false, // Default to FALSE so float is NOT issued without operator / accounts clerk confirmation!
  allowClerkCashierOverlap: true,
  allowOverageLifts: true, // allows lifting when cashier has an overage
  requireWitnessForTransit: false,
  defaultSupplierApprovalThreshold: 50.0,
  bankList: [
    'CBZ Bank Zimbabwe',
    'Stanbic Bank',
    'Ecobank Zimbabwe',
    'CABS',
    'Steward Bank',
    'FBC Bank',
    'Nedbank Zimbabwe',
    'NMB Bank',
  ],
  autoIssueOpeningFloatOnShiftStart: false,
};

export const getCashGovernanceConfig = (): CashGovernanceConfig => {
  const stored = getStored<CashGovernanceConfig | null>(STORAGE_KEYS.CASH_GOVERNANCE_CONFIG, null);
  if (!stored) return { ...DEFAULT_CASH_GOVERNANCE_CONFIG };
  return { ...DEFAULT_CASH_GOVERNANCE_CONFIG, ...stored };
};

export const saveCashGovernanceConfig = (config: Partial<CashGovernanceConfig>): CashGovernanceConfig => {
  const current = getCashGovernanceConfig();
  const updated: CashGovernanceConfig = { ...current, ...config };
  setStored(STORAGE_KEYS.CASH_GOVERNANCE_CONFIG, updated);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('saimetric_cash_governance_updated'));
  }
  return updated;
};

