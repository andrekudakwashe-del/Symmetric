import { STORAGE_KEYS } from './storageKeys';
import {
  getMeta,
  setMeta,
  ShardedStoreName,
  loadShardedCollection,
  syncShardedCollectionDelta,
} from './indexedDBService';

export type Listener = () => void;
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
let batchDepth = 0;
let batchDirty = false;
let lastNotifyExecutedAt = 0;
const NOTIFY_COALESCE_WINDOW_MS = 140;

const executeNotifyListeners = () => {
  notifyScheduled = false;
  notifyTimer = null;
  lastNotifyExecutedAt = Date.now();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('Listener error:', e);
    }
  });
};

/**
 * Begin a bulk database mutation window (e.g. Hub catchup or Cloud pull batch).
 * Suppresses intermediate React listener storms and flushes once cleanly on endBatchUpdate().
 */
export const beginBatchUpdate = (): void => {
  batchDepth++;
};

/**
 * End a bulk database mutation window. Fires a single coalesced UI notification if any writes occurred.
 */
export const endBatchUpdate = (): void => {
  if (batchDepth > 0) batchDepth--;
  if (batchDepth === 0 && batchDirty) {
    batchDirty = false;
    notifyListeners();
  }
};

// Leading + trailing coalesced listener notification:
// - Single local user actions notify on the very next animation frame (0ms lag)
// - Rapid sync bursts coalesce into ~1 render every 140ms instead of 60fps render storms
export const notifyListeners = () => {
  if (batchDepth > 0) {
    batchDirty = true;
    return;
  }
  if (notifyScheduled) return;
  notifyScheduled = true;

  const elapsed = Date.now() - lastNotifyExecutedAt;
  if (elapsed >= NOTIFY_COALESCE_WINDOW_MS) {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(executeNotifyListeners);
    } else {
      if (notifyTimer) clearTimeout(notifyTimer);
      notifyTimer = setTimeout(executeNotifyListeners, 16);
    }
  } else {
    const remaining = Math.max(16, NOTIFY_COALESCE_WINDOW_MS - elapsed);
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = setTimeout(executeNotifyListeners, remaining);
  }
};

// High-performance in-memory layer: Prevents synchronous localStorage I/O freezes on UI thread
export const memoryCache = new Map<string, any>();

// High-volume collections sharded into dedicated indexed IndexedDB object stores (v7)
const SHARDED_COLLECTION_CONFIG: Record<
  string,
  { storeName: ShardedStoreName; idField: (item: any) => string }
> = {
  [STORAGE_KEYS.SALES]: {
    storeName: 'sales',
    idField: (s) => String(s?.id || ''),
  },
  [STORAGE_KEYS.INVENTORY_ITEMS]: {
    storeName: 'inventoryItems',
    idField: (i) => String(i?.itemId || i?.id || ''),
  },
  [STORAGE_KEYS.CASH_LOGS]: {
    storeName: 'cashLogs',
    idField: (c) => String(c?.id || ''),
  },
  [STORAGE_KEYS.STOCK_MOVEMENTS]: {
    storeName: 'stockMovements',
    idField: (m) => String(m?.id || ''),
  },
};

// Coalesced disk persistence queue: eliminates repeated synchronous JSON.stringify + localStorage.setItem
// freezes during Hub/Internet sync while guaranteeing 100% durability via pagehide/beforeunload/visibilitychange flush.
interface PendingStorageWrite {
  value: any;
  skipIdbOverwriteIfExisting?: boolean;
}
const pendingStorageWrites = new Map<string, PendingStorageWrite>();
let storageFlushTimer: any = null;
let storageMaxWaitTimer: any = null;
const STORAGE_FLUSH_DEBOUNCE_MS = 120;
const STORAGE_FLUSH_MAX_WAIT_MS = 400;

const IMMEDIATE_PERSIST_KEYS = new Set<string>([
  STORAGE_KEYS.SESSION_USER,
  STORAGE_KEYS.CURRENT_COMPANY_ID,
  STORAGE_KEYS.CURRENT_BRANCH_ID,
  STORAGE_KEYS.OFFLINE_MODE,
]);

const LOCALSTORAGE_SOFT_LIMIT_CHARS = 120_000;
const pendingIdbKeyHydrations = new Set<string>();

const hasIndexedDb = (): boolean => {
  if (typeof window !== 'undefined' && Boolean(window.indexedDB)) return true;
  if (typeof globalThis !== 'undefined' && Boolean((globalThis as any).indexedDB)) return true;
  return false;
};

const hydrateOverflowKeyFromIdb = (key: string): void => {
  if (!hasIndexedDb()) return;
  if (pendingIdbKeyHydrations.has(key)) return;
  pendingIdbKeyHydrations.add(key);

  const shardedCfg = SHARDED_COLLECTION_CONFIG[key];
  const loadPromise = shardedCfg
    ? loadShardedCollection<any>(shardedCfg.storeName, true).then(async (rows) => {
        if (rows && rows.length > 0) return rows;
        const legacy = await getMeta<any[]>(`room_${key}`);
        if (Array.isArray(legacy) && legacy.length > 0) {
          syncShardedCollectionDelta(shardedCfg.storeName, legacy).catch(() => {});
          return legacy;
        }
        return rows;
      })
    : getMeta(`room_${key}`);

  loadPromise
    .then((idbVal) => {
      if (idbVal !== null && idbVal !== undefined && (!Array.isArray(idbVal) || idbVal.length > 0)) {
        memoryCache.set(key, idbVal);
        notifyListeners();
      }
    })
    .catch(() => {})
    .finally(() => {
      pendingIdbKeyHydrations.delete(key);
    });
};

export const writeLocalStorageSafe = (key: string, value: any): void => {
  if (typeof localStorage === 'undefined') return;
  const serialized = JSON.stringify(value);
  if (serialized.length > LOCALSTORAGE_SOFT_LIMIT_CHARS) {
    // Store lightweight pointer in localStorage; full ledger lives in memoryCache + IndexedDB
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          __overflow_idb: true,
          count: Array.isArray(value) ? value.length : 1,
          updatedAt: Date.now(),
        })
      );
      return;
    } catch {
      // Fall through to quota cleanup if even tiny pointer failed
    }
  }
  try {
    localStorage.setItem(key, serialized);
  } catch (err) {
    console.warn(`[Storage] localStorage write for ${key} failed, attempting quota recovery:`, err);
    try {
      cleanupLocalStorageQuota();
      localStorage.setItem(key, serialized);
    } catch (retryErr) {
      console.warn(`[Storage] LocalStorage quota still exceeded for ${key}. Preserving in IndexedDB & Memory:`, retryErr);
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            __overflow_idb: true,
            count: Array.isArray(value) ? value.length : 1,
            updatedAt: Date.now(),
          })
        );
      } catch {
        try { localStorage.removeItem(key); } catch {}
      }
    }
  }
};

const persistSingleKeyNow = (key: string, value: any, skipIdbOverwriteIfExisting?: boolean): void => {
  writeLocalStorageSafe(key, value);

  if (!hasIndexedDb()) return;

  const shardedCfg = SHARDED_COLLECTION_CONFIG[key];
  if (shardedCfg && Array.isArray(value)) {
    if (skipIdbOverwriteIfExisting) {
      loadShardedCollection<any>(shardedCfg.storeName, true)
        .then(async (existingRows) => {
          if (existingRows && existingRows.length > 0) return;
          const legacyMeta = await getMeta<any[]>(`room_${key}`);
          if (Array.isArray(legacyMeta) && legacyMeta.length > 0) {
            await syncShardedCollectionDelta(shardedCfg.storeName, legacyMeta);
            return;
          }
          await syncShardedCollectionDelta(shardedCfg.storeName, value);
        })
        .catch(() => {
          syncShardedCollectionDelta(shardedCfg.storeName, value).catch(() => {});
        });
    } else {
      // Incremental delta write: only puts modified/inserted records and deletes removed IDs
      syncShardedCollectionDelta(shardedCfg.storeName, value).catch(() => {});
    }
    return;
  }

  // Persist asynchronously to IndexedDB meta store for standard/smaller keys
  if (skipIdbOverwriteIfExisting) {
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
};

export function flushPendingStorageWrites(): void {
  if (storageFlushTimer) {
    clearTimeout(storageFlushTimer);
    storageFlushTimer = null;
  }
  if (storageMaxWaitTimer) {
    clearTimeout(storageMaxWaitTimer);
    storageMaxWaitTimer = null;
  }
  if (pendingStorageWrites.size === 0) return;

  const entries = Array.from(pendingStorageWrites.entries());
  pendingStorageWrites.clear();
  for (const [key, entry] of entries) {
    try {
      persistSingleKeyNow(key, entry.value, entry.skipIdbOverwriteIfExisting);
    } catch (err) {
      console.error(`[Storage] Error flushing ${key}:`, err);
    }
  }
}

const scheduleStorageFlush = (): void => {
  if (storageFlushTimer) clearTimeout(storageFlushTimer);
  storageFlushTimer = setTimeout(() => {
    flushPendingStorageWrites();
  }, STORAGE_FLUSH_DEBOUNCE_MS);

  if (!storageMaxWaitTimer) {
    storageMaxWaitTimer = setTimeout(() => {
      flushPendingStorageWrites();
    }, STORAGE_FLUSH_MAX_WAIT_MS);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key) {
      memoryCache.delete(e.key);
      notifyListeners();
    }
  });
  // Guarantee zero data loss on tab close, refresh, or mobile app switch
  window.addEventListener('pagehide', () => {
    flushPendingStorageWrites();
  });
  window.addEventListener('beforeunload', () => {
    flushPendingStorageWrites();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPendingStorageWrites();
      }
    });
  }
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
  if (!hasIndexedDb()) return;
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
      { key: STORAGE_KEYS.DAILY_BLIND_CONFIGS, idField: (c) => c.id },
      { key: STORAGE_KEYS.DAILY_BLIND_COUNTS, idField: (c) => c.id },
    ];

    const criticalScalarKeys = [
      STORAGE_KEYS.SESSION_USER,
      STORAGE_KEYS.CURRENT_COMPANY_ID,
      STORAGE_KEYS.CURRENT_BRANCH_ID,
      STORAGE_KEYS.EXCHANGE_RATES,
      STORAGE_KEYS.SHEETS_CONFIG,
    ];

    let rehydratedAny = false;

    // 1. Rehydrate Collections in parallel batches (reading sharded v7 stores first with seamless v6 legacy migration)
    await Promise.all(
      criticalCollectionKeys.map(async ({ key, idField }) => {
        try {
          const shardedCfg = SHARDED_COLLECTION_CONFIG[key];
          let idbVal: any[] | null = null;
          let migratedLegacyToSharded = false;

          if (shardedCfg) {
            const shardedRows = await loadShardedCollection<any>(shardedCfg.storeName, true);
            if (Array.isArray(shardedRows) && shardedRows.length > 0) {
              idbVal = shardedRows;
            } else {
              // Seamless one-time migration from legacy v6 single-blob meta store to v7 sharded object store
              const legacyVal = await getMeta(`room_${key}`);
              if (Array.isArray(legacyVal) && legacyVal.length > 0) {
                idbVal = legacyVal;
                migratedLegacyToSharded = true;
              }
            }
          } else {
            idbVal = await getMeta(`room_${key}`);
          }

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
              writeLocalStorageSafe(key, merged);
              rehydratedAny = true;
            }

            if (shardedCfg && (migratedLegacyToSharded || hasNewFromIdb)) {
              await syncShardedCollectionDelta(shardedCfg.storeName, merged);
            }
          }
        } catch (err) {
          console.warn(`[Storage] Rehydrate collection error for ${key}:`, err);
        }
      })
    );

    // 2. Rehydrate Scalars & Configs in parallel
    await Promise.all(
      criticalScalarKeys.map(async (key) => {
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
              writeLocalStorageSafe(key, idbVal);
              rehydratedAny = true;
            }
          }
        } catch (err) {
          console.warn(`[Storage] Rehydrate scalar error for ${key}:`, err);
        }
      })
    );

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
      // Data is overflowed to IndexedDB: trigger async single-flight IDB hydration & return fallback for now
      hydrateOverflowKeyFromIdb(key);
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

export function setStored<T>(
  key: string,
  value: T,
  options?: { skipIdbOverwriteIfExisting?: boolean; immediate?: boolean }
): void {
  try {
    // 1. Update in-memory cache instantly (0ms UI latency & immediately consistent reads)
    memoryCache.set(key, value);

    // 2. Persist immediately for critical auth/context keys or when explicitly requested;
    //    otherwise coalesce rapid disk writes (120ms debounce / 400ms max-wait, auto-flushed on pagehide/unload)
    if (options?.immediate || IMMEDIATE_PERSIST_KEYS.has(key) || typeof window === 'undefined') {
      pendingStorageWrites.delete(key);
      persistSingleKeyNow(key, value, options?.skipIdbOverwriteIfExisting);
    } else {
      pendingStorageWrites.set(key, {
        value,
        skipIdbOverwriteIfExisting: options?.skipIdbOverwriteIfExisting,
      });
      scheduleStorageFlush();
    }

    // 3. Notify subscribers via batch-aware coalesced frame
    notifyListeners();
  } catch (err) {
    console.error(`Error in setStored for ${key}:`, err);
  }
}
