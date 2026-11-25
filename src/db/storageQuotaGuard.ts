/**
 * Browser Storage Quota Guard & Safe Hot-Cache Pruning (Phase 3B)
 *
 * Mirrors Local Hub v4.2.0 capacity discipline on the PWA side:
 *  1. Requests persistent browser storage (`navigator.storage.persist()`) so Android/Chrome
 *     does not evict offline IndexedDB stores under OS disk pressure.
 *  2. Polls `navigator.storage.estimate()` to monitor quota usage and emit non-blocking
 *     capacity telemetry (`NORMAL` | `WARNING_75` | `CRITICAL_90`).
 *  3. Safely prunes ONLY already cloud-synced historical T1 rows older than `keepDays`
 *     from hot in-memory RAM cache (NEVER touches unsynced T1 records or live T2 master tables).
 */

import { STORAGE_KEYS } from './storageKeys';
import { memoryCache, notifyListeners } from './roomStorageEngine';

export type BrowserStorageStage = 'NORMAL' | 'WARNING_75' | 'CRITICAL_90';

export interface BrowserStorageHealth {
  usageBytes: number;
  quotaBytes: number;
  usagePct: number;
  isPersisted: boolean;
  stage: BrowserStorageStage;
  hotMemoryRecords: Record<string, number>;
  totalHotMemoryRecords: number;
  lastPrunedAt: number | null;
  lastPrunedCount: number;
  updatedAt: number;
}

/**
 * Only these append-only T1 transactional collections are eligible for hot-RAM cold pruning,
 * and ONLY records explicitly confirmed as synced to Cloud AND older than `keepDays`.
 * Live T2 master tables (INVENTORY_ITEMS, CUSTOMERS, SALESPERSONS, BRANCHES, WALLETS, etc.)
 * are strictly excluded.
 */
const PRUNABLE_T1_HOT_KEYS: ReadonlyArray<string> = [
  STORAGE_KEYS.SALES,
  STORAGE_KEYS.AUDIT_LOGS,
  STORAGE_KEYS.CASH_LOGS,
  STORAGE_KEYS.CASH_COUNTS,
  STORAGE_KEYS.CASH_LIFTS,
  STORAGE_KEYS.STOCK_MOVEMENTS,
  STORAGE_KEYS.EXPENSES,
];

let latestHealth: BrowserStorageHealth = {
  usageBytes: 0,
  quotaBytes: 0,
  usagePct: 0,
  isPersisted: false,
  stage: 'NORMAL',
  hotMemoryRecords: {},
  totalHotMemoryRecords: 0,
  lastPrunedAt: null,
  lastPrunedCount: 0,
  updatedAt: 0,
};

const listeners = new Set<(health: BrowserStorageHealth) => void>();
let monitorStarted = false;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

function computeHotMemoryCounts(): { counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {};
  let total = 0;
  memoryCache.forEach((val, key) => {
    if (Array.isArray(val)) {
      counts[key] = val.length;
      total += val.length;
    }
  });
  return { counts, total };
}

function classifyStage(usagePct: number): BrowserStorageStage {
  if (usagePct >= 90) return 'CRITICAL_90';
  if (usagePct >= 75) return 'WARNING_75';
  return 'NORMAL';
}

function emitHealth(): void {
  const snap = getBrowserStorageHealth();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {}
  });
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('saimetric_browser_storage_health', { detail: snap }));
    } catch {}
  }
}

export function getBrowserStorageHealth(): BrowserStorageHealth {
  const { counts, total } = computeHotMemoryCounts();
  return {
    ...latestHealth,
    hotMemoryRecords: counts,
    totalHotMemoryRecords: total,
  };
}

export function subscribeBrowserStorageHealth(
  listener: (health: BrowserStorageHealth) => void
): () => void {
  listeners.add(listener);
  try {
    listener(getBrowserStorageHealth());
  } catch {}
  return () => {
    listeners.delete(listener);
  };
}

function extractRecordTimestampMs(rec: any): number {
  if (!rec || typeof rec !== 'object') return 0;
  if (typeof rec.timestamp === 'number' && Number.isFinite(rec.timestamp)) {
    return rec.timestamp > 1e12 ? rec.timestamp : rec.timestamp * 1000;
  }
  const candidates = [rec.timestamp, rec.createdAt, rec.created_at, rec.date];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const parsed = Date.parse(c);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function isConfirmedCloudSynced(rec: any, storageKey: string): boolean {
  if (!rec || typeof rec !== 'object') return false;
  // Routine INFO audit logs do not queue to cloud and are safe to prune after keepDays
  if (storageKey === STORAGE_KEYS.AUDIT_LOGS && rec.severity === 'INFO') {
    return true;
  }
  return Boolean(
    rec.synced === true ||
      rec.isSynced === true ||
      rec.isCloudSynced === true ||
      rec.cloud_synced === true ||
      rec.syncStatus === 'SYNCED'
  );
}

/**
 * Safely prunes ONLY already cloud-synced historical T1 rows older than `keepDays`
 * from hot RAM (`memoryCache`) so long-running POS tablets keep low heap usage.
 * IndexedDB retains durable history; unsynced T1 records and all T2 master tables
 * are NEVER pruned.
 */
export interface PruneHotCacheResult {
  prunedCount: number;
  byKey: Record<string, number>;
}

export function pruneSyncedColdT1FromHotCache(keepDays = 90): PruneHotCacheResult {
  const safeDays = Math.max(14, Math.floor(Number(keepDays) || 90));
  const cutoffMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const byKey: Record<string, number> = {};
  let totalPruned = 0;

  for (const key of PRUNABLE_T1_HOT_KEYS) {
    const arr = memoryCache.get(key);
    if (!Array.isArray(arr) || arr.length <= 500) continue;

    const kept: any[] = [];
    let removedHere = 0;

    for (const rec of arr) {
      const ts = extractRecordTimestampMs(rec);
      const isOld = ts > 0 && ts < cutoffMs;
      if (isOld && isConfirmedCloudSynced(rec, key)) {
        removedHere += 1;
      } else {
        kept.push(rec);
      }
    }

    if (removedHere > 0) {
      memoryCache.set(key, kept);
      byKey[key] = removedHere;
      totalPruned += removedHere;
    }
  }

  if (totalPruned > 0) {
    latestHealth = {
      ...latestHealth,
      lastPrunedAt: Date.now(),
      lastPrunedCount: totalPruned,
      updatedAt: Date.now(),
    };
    notifyListeners();
    emitHealth();
  }

  return { prunedCount: totalPruned, byKey };
}

/**
 * Refreshes browser quota metrics via `navigator.storage.estimate()` and checks persistence.
 */
export async function refreshBrowserStorageHealth(): Promise<BrowserStorageHealth> {
  const { counts, total } = computeHotMemoryCounts();
  let usageBytes = latestHealth.usageBytes;
  let quotaBytes = latestHealth.quotaBytes;
  let isPersisted = latestHealth.isPersisted;

  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        usageBytes = Number(est.usage) || 0;
        quotaBytes = Number(est.quota) || 0;
      }
      if (typeof navigator.storage.persisted === 'function') {
        isPersisted = await navigator.storage.persisted();
      }
    }
  } catch {
    // Some embedded WebViews do not expose navigator.storage
  }

  const usagePct =
    quotaBytes > 0 ? Math.min(100, Number(((usageBytes / quotaBytes) * 100).toFixed(2))) : 0;
  const stage = classifyStage(usagePct);

  latestHealth = {
    ...latestHealth,
    usageBytes,
    quotaBytes,
    usagePct,
    isPersisted,
    stage,
    hotMemoryRecords: counts,
    totalHotMemoryRecords: total,
    updatedAt: Date.now(),
  };

  // Auto-prune synced cold T1 rows from hot RAM if browser storage enters critical pressure
  if (stage === 'CRITICAL_90' && total > 5000) {
    pruneSyncedColdT1FromHotCache(60);
  }

  emitHealth();
  return getBrowserStorageHealth();
}

/**
 * Starts persistent storage protection + periodic quota monitoring (idempotent).
 */
export function startBrowserStorageQuotaGuard(): void {
  if (monitorStarted || typeof window === 'undefined') return;
  monitorStarted = true;

  // Request durable persistence so the OS does not silently wipe offline POS data
  if (navigator.storage && typeof navigator.storage.persist === 'function') {
    navigator.storage.persist().catch(() => {});
  }

  // Initial non-blocking estimate after startup settles
  setTimeout(() => {
    void refreshBrowserStorageHealth();
  }, 4000);

  // Periodic background check every 10 minutes
  monitorInterval = setInterval(() => {
    void refreshBrowserStorageHealth();
  }, 10 * 60 * 1000);
}

export function stopBrowserStorageQuotaGuard(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  monitorStarted = false;
}
