/**
 * Saimetric Client-Side Persistent IndexedDB Engine
 * Manages persistent storage, schema migration, sync queue, delta sync metadata, and tenant context.
 */

export interface StoreIndexDefinition {
  name: string;
  keyPath: string | string[];
  options?: IDBIndexParameters;
}

export interface StoreDefinition {
  keyPath: string;
  autoIncrement?: boolean;
  indexes: StoreIndexDefinition[];
}

export type PersistentSyncStatus = 'pending' | 'syncing' | 'done' | 'failed';
export type PersistentSyncPriority = 'HIGH' | 'NORMAL' | 'LOW';

export interface PersistentSyncItem {
  id: string;
  clientRequestId: string;
  action: string;
  endpoint: string;
  sheetName: string;
  payload: Record<string, any>;
  status: PersistentSyncStatus;
  retries: number;
  createdAt: string;
  nextRetryAt: number;
  lastError?: string;
  response?: any;
  company_id?: string;
  priority?: PersistentSyncPriority;
}

export interface SyncMetaRecord {
  key: string; // "users" | "branches"
  lastSyncAt: string;
  lastServerTime: string;
}

export interface TenantContextRecord {
  company_id: string;
  company_name?: string;
  subscription_status: string;
  plan: string;
  next_billing_date: string;
  trial_days_remaining: number;
  sheet_id: string;
  branch_isolation_mode: string;
  schema_version: number;
  updated_at: string;
  lastFetchedAt: string;
}

export const IDB_NAME = 'saimetric_cash_db';
export const CURRENT_IDB_SCHEMA_VERSION = 7; // v7: Sharded high-volume stores (sales, inventoryItems, cashLogs, stockMovements)
export const CURRENT_SAAS_SCHEMA_VERSION = 1; // Master SaaS schema version from backend

export const IDB_STORES: Record<string, StoreDefinition> = {
  deleted_records: {
    keyPath: 'id',
    indexes: [
      { name: 'entityType', keyPath: 'entityType', options: { unique: false } },
      { name: 'deletedAt', keyPath: 'deletedAt', options: { unique: false } },
      { name: 'company_id', keyPath: 'company_id', options: { unique: false } },
    ],
  },
  fixedMonthlyCosts: {
    keyPath: 'uuid',
    indexes: [
      { name: 'shop_id', keyPath: 'shop_id', options: { unique: false } },
      { name: 'category', keyPath: 'category', options: { unique: false } },
      { name: 'currency', keyPath: 'currency', options: { unique: false } },
      { name: 'is_active', keyPath: 'is_active', options: { unique: false } },
      { name: 'is_deleted', keyPath: 'is_deleted', options: { unique: false } },
    ],
  },
  cashMovements: {
    keyPath: 'id',
    indexes: [
      { name: 'shiftId', keyPath: 'shiftId', options: { unique: false } },
      { name: 'date', keyPath: 'date', options: { unique: false } },
      { name: 'staffId', keyPath: 'staffId', options: { unique: false } },
      { name: 'type', keyPath: 'type', options: { unique: false } },
      { name: 'status', keyPath: 'status', options: { unique: false } },
      { name: 'sourceRef', keyPath: 'sourceRef', options: { unique: false } },
    ],
  },
  goodsReceivedNotes: {
    keyPath: 'id',
    indexes: [
      { name: 'grnNumber', keyPath: 'grnNumber', options: { unique: false } },
      { name: 'dateReceived', keyPath: 'dateReceived', options: { unique: false } },
      { name: 'receivedBy', keyPath: 'receivedBy', options: { unique: false } },
      { name: 'status', keyPath: 'status', options: { unique: false } },
      { name: 'sourceTemplate', keyPath: 'sourceTemplate', options: { unique: false } },
      { name: 'cashMovementId', keyPath: 'cashMovementId', options: { unique: false } },
    ],
  },
  directDeliveries: {
    keyPath: 'id',
    indexes: [
      { name: 'grvNumber', keyPath: 'grvNumber', options: { unique: false } },
      { name: 'date', keyPath: 'date', options: { unique: false } },
      { name: 'status', keyPath: 'status', options: { unique: false } },
    ],
  },
  generalGRVs: {
    keyPath: 'id',
    indexes: [
      { name: 'voucherId', keyPath: 'voucherId', options: { unique: false } },
      { name: 'invoiceNo', keyPath: 'invoiceNo', options: { unique: false } },
      { name: 'date', keyPath: 'date', options: { unique: false } },
    ],
  },
  syncQueue: {
    keyPath: 'id',
    indexes: [
      { name: 'status', keyPath: 'status', options: { unique: false } },
      { name: 'company_id', keyPath: 'company_id', options: { unique: false } },
      { name: 'priority', keyPath: 'priority', options: { unique: false } },
      { name: 'nextRetryAt', keyPath: 'nextRetryAt', options: { unique: false } },
      { name: 'endpoint', keyPath: 'endpoint', options: { unique: false } },
      { name: 'clientRequestId', keyPath: 'clientRequestId', options: { unique: true } },
    ],
  },
  syncMeta: {
    keyPath: 'key',
    indexes: [],
  },
  tenantContext: {
    keyPath: 'company_id',
    indexes: [
      { name: 'updated_at', keyPath: 'updated_at', options: { unique: false } },
    ],
  },
  meta: {
    keyPath: 'key',
    indexes: [],
  },
  // Phase 2B: Dedicated sharded high-volume stores eliminating monolithic meta JSON re-writes
  sales: {
    keyPath: 'id',
    indexes: [
      { name: 'company_id', keyPath: 'company_id', options: { unique: false } },
      { name: 'branch_id', keyPath: 'branch_id', options: { unique: false } },
      { name: 'date', keyPath: 'date', options: { unique: false } },
      { name: 'staffId', keyPath: 'staffId', options: { unique: false } },
      { name: 'status', keyPath: 'status', options: { unique: false } },
      { name: 'lastUpdated', keyPath: 'lastUpdated', options: { unique: false } },
      { name: 'company_branch', keyPath: ['company_id', 'branch_id'], options: { unique: false } },
    ],
  },
  inventoryItems: {
    keyPath: 'itemId',
    indexes: [
      { name: 'company_id', keyPath: 'company_id', options: { unique: false } },
      { name: 'branch_id', keyPath: 'branch_id', options: { unique: false } },
      { name: 'sku', keyPath: 'sku', options: { unique: false } },
      { name: 'category', keyPath: 'category', options: { unique: false } },
      { name: 'lastUpdated', keyPath: 'lastUpdated', options: { unique: false } },
      { name: 'company_branch', keyPath: ['company_id', 'branch_id'], options: { unique: false } },
    ],
  },
  cashLogs: {
    keyPath: 'id',
    indexes: [
      { name: 'company_id', keyPath: 'company_id', options: { unique: false } },
      { name: 'branch_id', keyPath: 'branch_id', options: { unique: false } },
      { name: 'date', keyPath: 'date', options: { unique: false } },
      { name: 'staffId', keyPath: 'staffId', options: { unique: false } },
      { name: 'status', keyPath: 'status', options: { unique: false } },
      { name: 'lastUpdated', keyPath: 'lastUpdated', options: { unique: false } },
      { name: 'company_branch', keyPath: ['company_id', 'branch_id'], options: { unique: false } },
    ],
  },
  stockMovements: {
    keyPath: 'id',
    indexes: [
      { name: 'company_id', keyPath: 'company_id', options: { unique: false } },
      { name: 'branch_id', keyPath: 'branch_id', options: { unique: false } },
      { name: 'date', keyPath: 'date', options: { unique: false } },
      { name: 'itemId', keyPath: 'itemId', options: { unique: false } },
      { name: 'type', keyPath: 'type', options: { unique: false } },
      { name: 'company_branch', keyPath: ['company_id', 'branch_id'], options: { unique: false } },
    ],
  },
};

let dbPromise: Promise<IDBDatabase | null> | null = null;
let dbInstance: IDBDatabase | null = null;

/**
 * Returns current indexedDB implementation (browser window or custom global in tests)
 */
function getIDBFactory(): IDBFactory | null {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).indexedDB) {
    return (globalThis as any).indexedDB;
  }
  return null;
}

/**
 * Initialize or upgrade IndexedDB with all stores and indexes in IDB_STORES.
 */
export function initIndexedDB(): Promise<IDBDatabase | null> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbPromise) {
    return dbPromise;
  }

  const factory = getIDBFactory();
  if (!factory) {
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve) => {
    try {
      const request = factory.open(IDB_NAME, CURRENT_IDB_SCHEMA_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const migrationSummary = {
          createdStores: [] as string[],
          addedIndexes: [] as string[],
        };

        // Ensure all stores in IDB_STORES exist
        for (const storeName of Object.keys(IDB_STORES)) {
          const def = IDB_STORES[storeName];
          let store: IDBObjectStore;
          if (!db.objectStoreNames.contains(storeName)) {
            store = db.createObjectStore(storeName, {
              keyPath: def.keyPath,
              autoIncrement: def.autoIncrement || false,
            });
            migrationSummary.createdStores.push(storeName);
          } else {
            store = request.transaction!.objectStore(storeName);
          }

          // Ensure all indexes exist
          for (const idx of def.indexes) {
            if (!store.indexNames.contains(idx.name)) {
              store.createIndex(idx.name, idx.keyPath, idx.options);
              migrationSummary.addedIndexes.push(`${storeName}.${idx.name}`);
            }
          }
        }

        console.info('[IDB Migration]', {
          oldVersion: event.oldVersion,
          newVersion: event.newVersion,
          summary: migrationSummary,
        });
      };

      request.onsuccess = async (event: Event) => {
        dbInstance = (event.target as IDBOpenDBRequest).result;
        
        // Handle connection close / refresh
        dbInstance.onclose = () => {
          dbInstance = null;
          dbPromise = null;
        };

        // Post-open verification of meta.schema_version
        try {
          const storedVer = await getMeta('schema_version');
          if (!storedVer || storedVer < CURRENT_SAAS_SCHEMA_VERSION) {
            await setMeta('schema_version', CURRENT_SAAS_SCHEMA_VERSION);
            await setMeta('migrated_at', new Date().toISOString());
            console.info(`[IDB] Updated meta.schema_version to ${CURRENT_SAAS_SCHEMA_VERSION}`);
          }
        } catch (e) {
          console.warn('[IDB] Could not write schema_version to meta store:', e);
        }

        resolve(dbInstance);
      };

      request.onerror = (err) => {
        console.error('[IDB] open error:', err);
        dbPromise = null;
        resolve(null);
      };
    } catch (e) {
      console.error('[IDB] initialization exception:', e);
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

// ==================== TRANSACTION HELPERS ====================

export function executeTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T> {
  return new Promise((resolve, reject) => {
    initIndexedDB().then((db) => {
      if (!db) {
        return reject(new Error('IndexedDB not available in current environment'));
      }
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = fn(store);

        if (req) {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } else {
          tx.oncomplete = () => resolve(undefined as any);
          tx.onerror = () => reject(tx.error);
        }
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function getAllFromIDBStore<T>(storeName: string): Promise<T[]> {
  try {
    const res = await executeTx<T[]>(storeName, 'readonly', (store) => store.getAll());
    return res || [];
  } catch (err) {
    console.warn(`[IDB] getAllFromIDBStore(${storeName}) failed:`, err);
    return [];
  }
}

export async function putToIDBStore<T>(storeName: string, item: T): Promise<void> {
  try {
    await executeTx(storeName, 'readwrite', (store) => store.put(item));
  } catch (err) {
    console.warn(`[IDB] putToIDBStore(${storeName}) failed:`, err);
  }
}

export async function getFromIDBStore<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const res = await executeTx<T>(storeName, 'readonly', (store) => store.get(key));
    return res || null;
  } catch {
    return null;
  }
}

// ==================== META STORE ====================

export async function getMeta<T = any>(key: string): Promise<T | null> {
  try {
    const res = await executeTx<{ key: string; value: T }>('meta', 'readonly', (store) =>
      store.get(key)
    );
    return res ? res.value : null;
  } catch {
    return null;
  }
}

export async function setMeta(key: string, value: any): Promise<void> {
  try {
    await executeTx('meta', 'readwrite', (store) =>
      store.put({ key, value, updatedAt: new Date().toISOString() })
    );
  } catch (err) {
    console.warn(`[IDB] setMeta(${key}) error:`, err);
  }
}

export async function deleteMeta(key: string): Promise<void> {
  try {
    await executeTx('meta', 'readwrite', (store) => store.delete(key));
  } catch (err) {
    console.warn(`[IDB] deleteMeta(${key}) error:`, err);
  }
}

// ==================== SYNC QUEUE STORE ====================

export async function enqueueSyncItem(
  item: Omit<PersistentSyncItem, 'id' | 'createdAt' | 'status' | 'retries' | 'nextRetryAt'> & {
    id?: string;
    createdAt?: string;
    status?: PersistentSyncStatus;
    retries?: number;
    nextRetryAt?: number;
    company_id?: string;
    priority?: PersistentSyncPriority;
  }
): Promise<PersistentSyncItem> {
  const company_id = item.company_id || item.payload?.company_id || item.payload?.CompanyID || 'COMP-001';
  const priority = item.priority || 'NORMAL';

  const fullItem: PersistentSyncItem = {
    id: item.id || `sq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    clientRequestId: item.clientRequestId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `uuid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`),
    action: item.action,
    endpoint: item.endpoint,
    sheetName: item.sheetName,
    payload: item.payload,
    status: item.status || 'pending',
    retries: item.retries !== undefined ? item.retries : 0,
    createdAt: item.createdAt || new Date().toISOString(),
    nextRetryAt: item.nextRetryAt !== undefined ? item.nextRetryAt : Date.now(),
    lastError: item.lastError,
    response: item.response,
    company_id,
    priority,
  };

  await executeTx('syncQueue', 'readwrite', (store) => store.put(fullItem));
  return fullItem;
}

export async function getSyncQueueItems(filterStatus?: PersistentSyncStatus, companyId?: string): Promise<PersistentSyncItem[]> {
  try {
    const items = await executeTx<PersistentSyncItem[]>('syncQueue', 'readonly', (store) => {
      if (filterStatus) {
        const index = store.index('status');
        return index.getAll(filterStatus);
      }
      return store.getAll();
    });
    if (!items) return [];

    if (companyId && companyId !== 'ALL') {
      const cleanComp = companyId.trim().toUpperCase();
      return items.filter((i) => {
        const itemComp = (i.company_id || i.payload?.company_id || i.payload?.CompanyID || '').trim().toUpperCase();
        return itemComp === cleanComp;
      });
    }

    return items;
  } catch {
    return [];
  }
}

export async function getPendingSyncQueueItems(maxTimeMs: number = Date.now(), companyId?: string): Promise<PersistentSyncItem[]> {
  try {
    const all = await getSyncQueueItems('pending', companyId);
    const filtered = all.filter((item) => item.nextRetryAt <= maxTimeMs);

    // Priority ordering: HIGH (0) first, then NORMAL (1), then LOW (2), then createdAt ASC
    const priorityWeight: Record<PersistentSyncPriority, number> = {
      HIGH: 0,
      NORMAL: 1,
      LOW: 2,
    };

    filtered.sort((a, b) => {
      const pA = priorityWeight[a.priority || 'NORMAL'] ?? 1;
      const pB = priorityWeight[b.priority || 'NORMAL'] ?? 1;
      if (pA !== pB) return pA - pB;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return filtered;
  } catch {
    return [];
  }
}

/**
 * High-performance batch removal of sync items in a single IndexedDB transaction
 */
export async function batchRemoveSyncItems(ids: string[]): Promise<number> {
  if (!ids || ids.length === 0) return 0;
  return new Promise((resolve) => {
    initIndexedDB().then((db) => {
      if (!db) return resolve(0);
      try {
        const tx = db.transaction('syncQueue', 'readwrite');
        const store = tx.objectStore('syncQueue');
        let count = 0;
        for (const id of ids) {
          store.delete(id);
          count++;
        }
        tx.oncomplete = () => resolve(count);
        tx.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  });
}

/**
 * High-performance batch update of sync items in a single IndexedDB transaction
 */
export async function batchUpdateSyncItems(
  updates: { id: string; updates: Partial<PersistentSyncItem> }[]
): Promise<number> {
  if (!updates || updates.length === 0) return 0;
  return new Promise((resolve) => {
    initIndexedDB().then((db) => {
      if (!db) return resolve(0);
      try {
        const tx = db.transaction('syncQueue', 'readwrite');
        const store = tx.objectStore('syncQueue');
        let count = 0;
        for (const u of updates) {
          const getReq = store.get(u.id);
          getReq.onsuccess = () => {
            if (getReq.result) {
              store.put({ ...getReq.result, ...u.updates });
              count++;
            }
          };
        }
        tx.oncomplete = () => resolve(count);
        tx.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  });
}

/**
 * Compacts the pending queue by removing redundant intermediate updates for the same entity.
 * For example: if item SUG001 had 10 stock/price changes while offline, keep only the latest state!
 * Also caps routine audit logs to prevent queue starvation.
 * Executes removals in a single atomic transaction.
 */
export async function compactPendingSyncItems(companyId?: string): Promise<{ originalCount: number; compactedCount: number; removedCount: number }> {
  try {
    const pendingItems = await getSyncQueueItems('pending', companyId);
    if (pendingItems.length <= 1) {
      return { originalCount: pendingItems.length, compactedCount: pendingItems.length, removedCount: 0 };
    }

    const itemsToRemove: string[] = [];
    const seenEntities = new Map<string, PersistentSyncItem>(); // key: comp:sheetName:entityId -> latest item
    const seenRequestIds = new Set<string>();

    // Sort newest to oldest so first seen is latest
    const sorted = [...pendingItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    let auditLogCount = 0;

    for (const item of sorted) {
      const comp = (item.company_id || item.payload?.company_id || item.payload?.CompanyID || 'COMP-001').toUpperCase();
      const sheet = item.sheetName;

      // Drop duplicate clientRequestId if seen
      if (item.clientRequestId) {
        if (seenRequestIds.has(item.clientRequestId)) {
          itemsToRemove.push(item.id);
          continue;
        }
        seenRequestIds.add(item.clientRequestId);
      }

      // Entity key extraction for deduplication
      if (sheet === 'InventoryMaster' || sheet === 'Products' || item.action === 'sync_inventory' || item.action === 'upsert_product') {
        const entityId = (item.payload?.ItemID || item.payload?.itemId || item.payload?.id || '').trim().toUpperCase();
        if (entityId) {
          const key = `${comp}:${sheet}:${entityId}`;
          if (seenEntities.has(key)) {
            // Found older update for same product -> discard older update
            itemsToRemove.push(item.id);
            continue;
          } else {
            seenEntities.set(key, item);
          }
        }
      } else if (sheet === 'Audit_Log') {
        auditLogCount++;
        // Keep at most 20 latest audit logs in pending queue to avoid blocking real financial transactions
        if (auditLogCount > 20) {
          itemsToRemove.push(item.id);
          continue;
        }
      }
    }

    // Delete redundant items in a single atomic transaction
    if (itemsToRemove.length > 0) {
      await batchRemoveSyncItems(itemsToRemove);
    }

    return {
      originalCount: pendingItems.length,
      compactedCount: pendingItems.length - itemsToRemove.length,
      removedCount: itemsToRemove.length,
    };
  } catch (err) {
    console.warn('[IDB] Queue compaction error:', err);
    return { originalCount: 0, compactedCount: 0, removedCount: 0 };
  }
}

/**
 * Normalizes existing records in the sync queue, repairing missing company IDs and removing stale rows
 */
export async function healAndNormalizeSyncQueue(fallbackCompId: string = 'COMP-001'): Promise<{ normalized: number; pruned: number }> {
  try {
    const all = await getSyncQueueItems();
    if (!all || all.length === 0) return { normalized: 0, pruned: 0 };

    const toUpdate: { id: string; updates: Partial<PersistentSyncItem> }[] = [];
    const toDelete: string[] = [];

    const now = Date.now();
    const thresholdOldDone = now - (24 * 60 * 60 * 1000);

    for (const item of all) {
      // 1. Purge ancient completed items
      if (item.status === 'done') {
        const cMs = new Date(item.createdAt).getTime();
        if (cMs < thresholdOldDone || isNaN(cMs)) {
          toDelete.push(item.id);
          continue;
        }
      }

      // 2. Ensure company_id is populated and normalized
      const currentComp = (item.company_id || item.payload?.company_id || item.payload?.CompanyID || '').trim().toUpperCase();
      if (!currentComp) {
        toUpdate.push({
          id: item.id,
          updates: { company_id: fallbackCompId },
        });
      }
    }

    if (toDelete.length > 0) {
      await batchRemoveSyncItems(toDelete);
    }
    if (toUpdate.length > 0) {
      await batchUpdateSyncItems(toUpdate);
    }

    return { normalized: toUpdate.length, pruned: toDelete.length };
  } catch (err) {
    console.warn('[IDB] healAndNormalizeSyncQueue error:', err);
    return { normalized: 0, pruned: 0 };
  }
}

/**
 * Cleanup stale completed items to keep IndexedDB lean
 */
export async function cleanupStaleSyncQueue(maxAgeHours: number = 24): Promise<number> {
  try {
    const doneItems = await getSyncQueueItems('done');
    const thresholdMs = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    let removed = 0;

    for (const item of doneItems) {
      const createdMs = new Date(item.createdAt).getTime();
      if (createdMs < thresholdMs || isNaN(createdMs)) {
        await removeSyncItem(item.id);
        removed++;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

export async function updateSyncItem(id: string, updates: Partial<PersistentSyncItem>): Promise<void> {
  try {
    const existing = await executeTx<PersistentSyncItem>('syncQueue', 'readonly', (store) => store.get(id));
    if (existing) {
      const merged: PersistentSyncItem = { ...existing, ...updates };
      await executeTx('syncQueue', 'readwrite', (store) => store.put(merged));
    }
  } catch (err) {
    console.error(`[IDB] Failed to update syncQueue item ${id}:`, err);
  }
}

export async function removeSyncItem(id: string): Promise<void> {
  try {
    await executeTx('syncQueue', 'readwrite', (store) => store.delete(id));
  } catch (err) {
    console.error(`[IDB] Failed to delete syncQueue item ${id}:`, err);
  }
}

export async function clearSyncedItems(): Promise<number> {
  try {
    const doneItems = await getSyncQueueItems('done');
    for (const item of doneItems) {
      await removeSyncItem(item.id);
    }
    return doneItems.length;
  } catch {
    return 0;
  }
}

export async function clearAllSyncQueue(): Promise<void> {
  try {
    await executeTx('syncQueue', 'readwrite', (store) => store.clear());
  } catch (err) {
    console.warn('[IDB] Failed to clear syncQueue store:', err);
  }
}

// ==================== SYNC META STORE (Delta Refresh) ====================

export async function getSyncMeta(key: string): Promise<SyncMetaRecord | null> {
  try {
    const rec = await executeTx<SyncMetaRecord>('syncMeta', 'readonly', (store) => store.get(key));
    return rec || null;
  } catch {
    return null;
  }
}

export async function setSyncMeta(key: string, lastSyncAt: string, lastServerTime: string): Promise<void> {
  try {
    const rec: SyncMetaRecord = { key, lastSyncAt, lastServerTime };
    await executeTx('syncMeta', 'readwrite', (store) => store.put(rec));
  } catch (err) {
    console.warn(`[IDB] Failed to save syncMeta for ${key}:`, err);
  }
}

// ==================== TENANT CONTEXT STORE ====================

export async function getTenantContext(company_id: string): Promise<TenantContextRecord | null> {
  try {
    const rec = await executeTx<TenantContextRecord>('tenantContext', 'readonly', (store) =>
      store.get(company_id)
    );
    return rec || null;
  } catch {
    return null;
  }
}

export async function saveTenantContext(record: TenantContextRecord): Promise<void> {
  try {
    const withTimestamp = {
      ...record,
      lastFetchedAt: record.lastFetchedAt || new Date().toISOString(),
    };
    await executeTx('tenantContext', 'readwrite', (store) => store.put(withTimestamp));
  } catch (err) {
    console.warn(`[IDB] Failed to save tenantContext for ${record.company_id}:`, err);
  }
}

export async function purgeTenantContextCredentials(company_id?: string): Promise<void> {
  try {
    const all = await getAllFromIDBStore<TenantContextRecord>('tenantContext');
    if (!all || all.length === 0) return;
    for (const rec of all) {
      if (!company_id || rec.company_id === company_id) {
        await executeTx('tenantContext', 'readwrite', (store) =>
          store.put({
            ...rec,
            sheet_id: '',
          })
        );
      }
    }
  } catch (err) {
    console.warn('[IDB] Failed to purge tenantContext credentials:', err);
  }
}

// ==================== PHASE 2B: SHARDED HIGH-VOLUME STORES & DELTA SYNC ====================

export type ShardedStoreName = 'sales' | 'inventoryItems' | 'cashLogs' | 'stockMovements';

const shardedStampCaches = new Map<ShardedStoreName, Map<string, string>>();
const shardedWriteChains = new Map<ShardedStoreName, Promise<any>>();

const getKeyPathForShardedStore = (storeName: ShardedStoreName): string =>
  storeName === 'inventoryItems' ? 'itemId' : 'id';

export const normalizeShardedRecord = (storeName: ShardedStoreName, raw: any): any | null => {
  if (!raw || typeof raw !== 'object') return null;
  const company_id = String(raw.company_id || raw.companyId || 'COMP-001').trim();
  const branch_id = String(raw.branch_id || raw.branchId || 'ALL').trim();

  if (storeName === 'inventoryItems') {
    const itemId = String(raw.itemId || raw.id || '').trim();
    if (!itemId) return null;
    if (
      raw.itemId === itemId &&
      raw.company_id === company_id &&
      raw.branch_id === branch_id
    ) {
      return raw;
    }
    return { ...raw, itemId, company_id, branch_id };
  }

  const id = String(raw.id || '').trim();
  if (!id) return null;
  if (raw.id === id && raw.company_id === company_id && raw.branch_id === branch_id) {
    return raw;
  }
  return { ...raw, id, company_id, branch_id };
};

/**
 * Fast deterministic stamp covering mutating fields so unchanged rows never get re-written to IndexedDB.
 */
export const computeShardedRecordStamp = (rec: any): string => {
  if (!rec || typeof rec !== 'object') return '';
  const ts = rec.lastUpdated || rec.updatedAt || rec.timestamp || rec.version || '';
  const status = rec.status || '';
  const qty =
    rec.stockQuantity ?? rec.quantity ?? rec.qtyChange ?? rec.amount ?? rec.totalAmount ?? '';
  const cases = rec.stockCases ?? '';
  const price = rec.price ?? rec.sellingPrice ?? rec.costPrice ?? '';
  const syncFlag = `${rec.synced ?? ''}_${rec.cloudSynced ?? ''}_${rec.syncedToCloud ?? ''}_${rec.hubSynced ?? ''}`;
  const flags = `${rec.voided ?? ''}_${rec.isDeleted ?? ''}_${rec.deleted ?? ''}`;
  const itemsLen = Array.isArray(rec.items) ? rec.items.length : 0;
  const keysLen = Object.keys(rec).length;
  return `${ts}|${status}|${qty}|${cases}|${price}|${syncFlag}|${flags}|${itemsLen}|${keysLen}|${rec.name || rec.itemName || ''}|${rec.barcode || ''}|${rec.customerName || ''}|${rec.notes || ''}`;
};

export const seedShardedDeltaCache = (storeName: ShardedStoreName, records: any[]): void => {
  const keyField = getKeyPathForShardedStore(storeName);
  const nextMap = new Map<string, string>();
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r[keyField] || r.id || '').trim();
    if (!id) continue;
    nextMap.set(id, computeShardedRecordStamp(r));
  }
  shardedStampCaches.set(storeName, nextMap);
};

export async function loadShardedCollection<T = any>(
  storeName: ShardedStoreName,
  seedDelta: boolean = true
): Promise<T[]> {
  try {
    const rows = await getAllFromIDBStore<T>(storeName);
    if (seedDelta && Array.isArray(rows) && rows.length > 0) {
      seedShardedDeltaCache(storeName, rows);
    }
    return rows || [];
  } catch (err) {
    console.warn(`[IDB] loadShardedCollection(${storeName}) failed:`, err);
    return [];
  }
}

/**
 * Persists ONLY changed/inserted records and removed IDs for high-volume collections
 * in a single atomic IndexedDB readwrite transaction, serialized per store.
 */
export function syncShardedCollectionDelta(
  storeName: ShardedStoreName,
  records: any[]
): Promise<{ putCount: number; deleteCount: number }> {
  const prevChain = shardedWriteChains.get(storeName) || Promise.resolve();
  const nextRun = prevChain
    .catch(() => {})
    .then(async (): Promise<{ putCount: number; deleteCount: number }> => {
      if (!Array.isArray(records)) return { putCount: 0, deleteCount: 0 };

      const db = await initIndexedDB();
      if (!db || !db.objectStoreNames.contains(storeName)) {
        return { putCount: 0, deleteCount: 0 };
      }

      const keyField = getKeyPathForShardedStore(storeName);
      let prevMap = shardedStampCaches.get(storeName);

      // If cache is cold, read existing keys+stamps from IDB once so deletes are exact and redundant puts skipped
      if (!prevMap) {
        prevMap = new Map<string, string>();
        try {
          const existing = await getAllFromIDBStore<any>(storeName);
          for (const item of existing) {
            const k = String(item?.[keyField] || '').trim();
            if (k) prevMap.set(k, computeShardedRecordStamp(item));
          }
        } catch {
          // Proceed with empty map -> upserts all current records
        }
      }

      const nextMap = new Map<string, string>();
      const toPut: any[] = [];
      const toDelete: string[] = [];

      for (const raw of records) {
        const normalized = normalizeShardedRecord(storeName, raw);
        if (!normalized) continue;
        const key = String(normalized[keyField]);
        const stamp = computeShardedRecordStamp(normalized);
        nextMap.set(key, stamp);
        if (prevMap.get(key) !== stamp) {
          toPut.push(normalized);
        }
      }

      for (const oldKey of prevMap.keys()) {
        if (!nextMap.has(oldKey)) {
          toDelete.push(oldKey);
        }
      }

      shardedStampCaches.set(storeName, nextMap);

      if (toPut.length === 0 && toDelete.length === 0) {
        return { putCount: 0, deleteCount: 0 };
      }

      return await new Promise<{ putCount: number; deleteCount: number }>((resolve) => {
        try {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          for (const rec of toPut) {
            store.put(rec);
          }
          for (const delId of toDelete) {
            store.delete(delId);
          }
          tx.oncomplete = () => resolve({ putCount: toPut.length, deleteCount: toDelete.length });
          tx.onerror = () => resolve({ putCount: 0, deleteCount: 0 });
        } catch {
          resolve({ putCount: 0, deleteCount: 0 });
        }
      });
    });

  shardedWriteChains.set(storeName, nextRun);
  return nextRun;
}

export async function queryShardedByCompanyBranch<T = any>(
  storeName: ShardedStoreName,
  companyId: string,
  branchId: string
): Promise<T[]> {
  try {
    const res = await executeTx<T[]>(storeName, 'readonly', (store) => {
      if (store.indexNames.contains('company_branch')) {
        const idx = store.index('company_branch');
        return idx.getAll([companyId, branchId]);
      }
      return store.getAll();
    });
    return res || [];
  } catch (err) {
    console.warn(`[IDB] queryShardedByCompanyBranch(${storeName}) error:`, err);
    return [];
  }
}

export async function queryShardedByDate<T = any>(
  storeName: ShardedStoreName,
  date: string
): Promise<T[]> {
  try {
    const res = await executeTx<T[]>(storeName, 'readonly', (store) => {
      if (store.indexNames.contains('date')) {
        return store.index('date').getAll(date);
      }
      return store.getAll();
    });
    return res || [];
  } catch (err) {
    console.warn(`[IDB] queryShardedByDate(${storeName}) error:`, err);
    return [];
  }
}

