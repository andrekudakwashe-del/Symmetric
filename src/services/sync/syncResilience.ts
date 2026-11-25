/**
 * SAIMETRIC Sync Engine Resilience Primitives (Phase 4B)
 *
 * Enterprise reliability layer for offline-first POS outbox draining:
 *  1. Jittered Exponential Backoff (prevents thundering-herd storms on branch reconnect).
 *  2. Permanent vs. Transient Error Classification (immediate Dead-Letter Quarantine for
 *     poison-pill validation/auth/isolation errors so healthy sales keep syncing).
 *  3. Circuit Breaker (stops burning retry counts across 100+ queued records during an outage).
 *  4. Cross-Tab Sync Leader Lock (`navigator.locks` with `localStorage` lease fallback) so
 *     multiple open POS/Admin tabs never double-drain the same company outbox concurrently.
 */

export type SyncErrorCategory = 'PERMANENT' | 'TRANSIENT';
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  cooldownMs: number;
  cooldownRemainingMs: number;
  lastError: string | null;
  tripCount: number;
}

const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 300_000; // 5 minutes
const DEFAULT_JITTER_RATIO = 0.25;

/**
 * Computes exponential backoff with symmetric randomized jitter (±jitterRatio).
 * retryAttempt is 1-based (1 -> ~1s, 2 -> ~2s, 3 -> ~4s, ... capped at maxMs).
 */
export function computeJitteredBackoffMs(
  retryAttempt: number,
  options?: {
    baseMs?: number;
    maxMs?: number;
    jitterRatio?: number;
    rng?: () => number;
  }
): number {
  const baseMs = options?.baseMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxMs = options?.maxMs ?? DEFAULT_MAX_BACKOFF_MS;
  const jitterRatio = Math.max(0, Math.min(0.5, options?.jitterRatio ?? DEFAULT_JITTER_RATIO));
  const rng = options?.rng ?? Math.random;

  const exp = Math.max(0, Math.floor(retryAttempt) - 1);
  const raw = Math.min(maxMs, baseMs * Math.pow(2, Math.min(exp, 10)));
  const spread = raw * jitterRatio;
  const offset = (rng() * 2 - 1) * spread;
  return Math.max(250, Math.round(raw + offset));
}

const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /MASTER_SHEET_WRITE_BLOCKED/i,
  /DEDICATED_SHEET_REQUIRED/i,
  /TENANT_SUSPENDED/i,
  /TRIAL_EXPIRED/i,
  /AppScripts sync disabled/i,
  /HTTP\s*400\b/i,
  /HTTP\s*401\b/i,
  /HTTP\s*403\b/i,
  /HTTP\s*404\b/i,
  /HTTP\s*422\b/i,
  /unauthorized/i,
  /forbidden/i,
  /invalid payload/i,
  /schema mismatch/i,
  /validation failed/i,
  /missing required field/i,
  /unknown action/i,
  /cross-branch.*blocked/i,
];

const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /timeout/i,
  /timed out/i,
  /abort/i,
  /network/i,
  /failed to fetch/i,
  /load failed/i,
  /offline/i,
  /HTTP\s*408\b/i,
  /HTTP\s*429\b/i,
  /HTTP\s*5\d\d\b/i,
  /rate limit/i,
  /too many requests/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /econnreset|enotfound|etimedout/i,
];

/**
 * Classifies a sync failure into PERMANENT (quarantine immediately into Dead-Letter Queue)
 * or TRANSIENT (retry with jittered exponential backoff + circuit breaker).
 */
export function classifySyncError(err: unknown): SyncErrorCategory {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String((err as any)?.message || err || '');

  // Explicit transient signals take priority over generic strings
  for (const re of TRANSIENT_ERROR_PATTERNS) {
    if (re.test(msg)) return 'TRANSIENT';
  }
  for (const re of PERMANENT_ERROR_PATTERNS) {
    if (re.test(msg)) return 'PERMANENT';
  }
  // Default to TRANSIENT so unexpected network/proxy hiccups never drop valid sales prematurely
  return 'TRANSIENT';
}

/**
 * Outbox Circuit Breaker to prevent cascading timeouts across hundreds of queued writes
 * when Cloud / Google Apps Script is experiencing an outage.
 */
export class SyncCircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private tripCount = 0;
  private lastError: string | null = null;
  private halfOpenProbeInFlight = false;

  private readonly failureThreshold: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly rng: () => number;

  constructor(options?: {
    failureThreshold?: number;
    baseCooldownMs?: number;
    maxCooldownMs?: number;
    rng?: () => number;
  }) {
    this.failureThreshold = Math.max(1, options?.failureThreshold ?? 3);
    this.baseCooldownMs = Math.max(1000, options?.baseCooldownMs ?? 30_000);
    this.maxCooldownMs = Math.max(this.baseCooldownMs, options?.maxCooldownMs ?? 300_000);
    this.rng = options?.rng ?? Math.random;
  }

  private currentCooldownMs(): number {
    if (this.tripCount <= 0) return 0;
    return Math.min(this.maxCooldownMs, this.baseCooldownMs * Math.pow(2, Math.min(this.tripCount - 1, 5)));
  }

  public canAttempt(now: number = Date.now()): boolean {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      const elapsed = this.openedAt !== null ? now - this.openedAt : Infinity;
      if (elapsed >= this.currentCooldownMs()) {
        this.state = 'HALF_OPEN';
        this.halfOpenProbeInFlight = true;
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow only one probe attempt at a time
    if (this.halfOpenProbeInFlight) return false;
    this.halfOpenProbeInFlight = true;
    return true;
  }

  public recordSuccess(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.tripCount = 0;
    this.lastError = null;
    this.halfOpenProbeInFlight = false;
  }

  public recordTransientFailure(errorMessage: string, now: number = Date.now()): CircuitBreakerState {
    this.lastError = errorMessage;
    this.consecutiveFailures += 1;

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.tripCount += 1;
      const jitterFactor = 0.9 + this.rng() * 0.2;
      // Store slightly jittered open timestamp for spread-out recovery
      this.openedAt = now + Math.round((jitterFactor - 1) * 2000);
      this.halfOpenProbeInFlight = false;
    }
    return this.state;
  }

  public reset(): void {
    this.recordSuccess();
  }

  public getSnapshot(now: number = Date.now()): CircuitBreakerSnapshot {
    const cooldownMs = this.state === 'OPEN' ? this.currentCooldownMs() : 0;
    const elapsed = this.openedAt !== null ? Math.max(0, now - this.openedAt) : 0;
    const cooldownRemainingMs = this.state === 'OPEN' ? Math.max(0, cooldownMs - elapsed) : 0;

    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      cooldownMs,
      cooldownRemainingMs,
      lastError: this.lastError,
      tripCount: this.tripCount,
    };
  }
}

const TAB_INSTANCE_ID = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const LEASE_TTL_MS = 90_000;

/**
 * Acquires a non-blocking cross-tab exclusive lock so only ONE open browser tab
 * drains a company's sync queue at any instant.
 * Uses Web Locks API (`navigator.locks`) when available, with a safe `localStorage`
 * lease fallback for older embedded WebViews.
 */
export async function withCrossTabSyncLock<T>(
  lockName: string,
  fn: () => Promise<T>,
  fallbackValue: T
): Promise<{ acquired: boolean; result: T }> {
  // 1. Native Web Locks API (atomic, auto-released on tab crash/close)
  const navLocks =
    typeof navigator !== 'undefined' && (navigator as any).locks && typeof (navigator as any).locks.request === 'function'
      ? (navigator as any).locks
      : null;

  if (navLocks) {
    return await navLocks.request(lockName, { ifAvailable: true }, async (lock: any) => {
      if (!lock) {
        return { acquired: false, result: fallbackValue };
      }
      const result = await fn();
      return { acquired: true, result };
    });
  }

  // 2. Fallback: localStorage lease lock
  if (typeof localStorage === 'undefined') {
    const result = await fn();
    return { acquired: true, result };
  }

  const storageKey = `saimetric_lock_${lockName}`;
  const now = Date.now();
  try {
    const existingRaw = localStorage.getItem(storageKey);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw);
      if (existing && existing.owner !== TAB_INSTANCE_ID && Number(existing.expiresAt) > now) {
        return { acquired: false, result: fallbackValue };
      }
    }
    localStorage.setItem(
      storageKey,
      JSON.stringify({ owner: TAB_INSTANCE_ID, expiresAt: now + LEASE_TTL_MS })
    );
  } catch {
    // If localStorage is blocked, allow execution rather than deadlocking sync
  }

  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    try {
      const currentRaw = localStorage.getItem(storageKey);
      if (currentRaw) {
        const current = JSON.parse(currentRaw);
        if (current?.owner === TAB_INSTANCE_ID) {
          localStorage.removeItem(storageKey);
        }
      }
    } catch {}
  }
}

export function isWebLocksSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean((navigator as any).locks && typeof (navigator as any).locks.request === 'function')
  );
}
