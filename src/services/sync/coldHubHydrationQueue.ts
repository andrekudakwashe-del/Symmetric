/**
 * ColdHubHydrationQueue
 *
 * Non-freezing, ACK-paced, chunked reverse-sync engine for hydrating a Cold Backup or
 * Cashier Till Fallback Hub after the Manager Hub leaves the branch.
 *
 * Key Guarantees:
 *   1. Honors exact `RECON_SWEEP_TRIGGER` order (`tombstones` -> `branches` -> `staff` ->
 *      `cash_accounts` -> `customers` -> `inventory` -> `sales` -> ... -> `expenses`) and `pushChunkSize` (default 25).
 *   2. Never dumps thousands of records synchronously: slices into chunks of `pushChunkSize`,
 *      yields to the browser main thread (`requestIdleCallback` / `setTimeout`), and respects
 *      WebSocket `bufferedAmount` backpressure.
 *   3. Pauses automatically whenever POS checkout is active (`isCheckoutActive()`) and resumes
 *      smoothly once the till is idle so barcode scanning and receipt printing never stutter.
 *   4. ACK-paced: waits for `RECON_PUSH_CHUNK_ACK` / `SYNC_ACK` between chunks (with a safe
 *      bounded fallback timeout for older Termux Hubs that don't emit chunk ACKs yet).
 */

export const DEFAULT_COLD_HUB_ENTITY_ORDER: readonly string[] = [
  'tombstones',
  'branches',
  'staff',
  'cash_accounts',
  'customers',
  'inventory',
  'sales',
  'customer_changes',
  'credit_sales',
  'cash_logs',
  'stock_movements',
  'stock_adjustments',
  'direct_grvs',
  'expenses',
];

export interface ColdHubSweepConfig {
  sweepId: string;
  isColdHub: boolean;
  pushChunkSize: number;
  targetEntities: string[];
  startedAt: number;
}

export interface HydrationPushJob {
  sweepId: string;
  entityType: string;
  missingIds: string[];
  pushChunkSize: number;
  isColdHub: boolean;
  entityOrderIndex: number;
}

export interface ColdHubHydrationProgress {
  active: boolean;
  sweepId: string | null;
  isColdHub: boolean;
  currentEntity: string | null;
  completedEntities: number;
  totalEntities: number;
  pushedRecords: number;
  totalRecords: number;
  currentChunk: number;
  totalChunks: number;
  pausedForCheckout: boolean;
  updatedAt: number;
}

export interface ColdHubHydrationCallbacks {
  isCheckoutActive: () => boolean;
  isSocketReady: () => boolean;
  getSocketBufferedAmount: () => number;
  pushSingleRecord: (entityType: string, recordId: string, sweepId: string, isColdHub: boolean) => Promise<boolean>;
  sendChunkMarker: (payload: {
    type: 'RECON_PUSH_CHUNK_COMPLETE';
    action: 'RECON_PUSH_CHUNK_COMPLETE';
    sweepId: string;
    entityType: string;
    chunkIndex: number;
    totalChunks: number;
    pushedInChunk: number;
    isColdHub: boolean;
    timestamp: number;
  }) => void;
  onProgress?: (progress: ColdHubHydrationProgress) => void;
}

function normalizeEntityKey(raw: string): string {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'tombstone') return 'tombstones';
  if (s === 'branch') return 'branches';
  if (s === 'salespeople' || s === 'users') return 'staff';
  if (s === 'cash_account') return 'cash_accounts';
  if (s === 'customer') return 'customers';
  if (s === 'inventory_item' || s === 'products') return 'inventory';
  if (s === 'sale') return 'sales';
  if (s === 'customer_change') return 'customer_changes';
  if (s === 'credit_sale') return 'credit_sales';
  if (s === 'cash_log') return 'cash_logs';
  if (s === 'stock_movement') return 'stock_movements';
  if (s === 'stock_adjustment') return 'stock_adjustments';
  if (s === 'direct_grv' || s === 'grv') return 'direct_grvs';
  if (s === 'expense') return 'expenses';
  return s;
}

/**
 * Yields back to the browser main thread so UI paints, touch events, and barcode scans stay 60fps.
 */
export function yieldToMainThread(minDelayMs = 20): Promise<void> {
  return new Promise((resolve) => {
    const g = globalThis as any;
    if (typeof g.requestIdleCallback === 'function' && minDelayMs <= 40) {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve();
        }
      }, Math.max(minDelayMs, 35));
      try {
        g.requestIdleCallback(
          () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve();
            }
          },
          { timeout: Math.max(minDelayMs, 50) }
        );
      } catch {
        clearTimeout(timer);
        setTimeout(resolve, minDelayMs);
      }
    } else {
      setTimeout(resolve, minDelayMs);
    }
  });
}

export class ColdHubHydrationQueue {
  private sweepConfigs = new Map<string, ColdHubSweepConfig>();
  private queue: HydrationPushJob[] = [];
  private isRunning = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelToken = 0;

  // ACK-pacing state
  private pendingAckResolver: (() => void) | null = null;
  private pendingAckKey: string | null = null;
  private pendingAckEntity: string | null = null;

  private progress: ColdHubHydrationProgress = {
    active: false,
    sweepId: null,
    isColdHub: false,
    currentEntity: null,
    completedEntities: 0,
    totalEntities: 0,
    pushedRecords: 0,
    totalRecords: 0,
    currentChunk: 0,
    totalChunks: 0,
    pausedForCheckout: false,
    updatedAt: Date.now(),
  };

  private callbacks: ColdHubHydrationCallbacks;

  constructor(callbacks: ColdHubHydrationCallbacks) {
    this.callbacks = callbacks;
  }

  public getProgress(): ColdHubHydrationProgress {
    return { ...this.progress };
  }

  /**
   * Registers sweep parameters received in `RECON_SWEEP_TRIGGER`.
   */
  public registerSweep(packet: {
    sweepId?: string;
    isColdHub?: boolean;
    pushChunkSize?: number;
    targetEntities?: string[];
  }): ColdHubSweepConfig {
    const sweepId = String(packet.sweepId || `sweep-${Date.now()}`).trim();
    const rawChunk = Number(packet.pushChunkSize);
    const pushChunkSize =
      Number.isFinite(rawChunk) && rawChunk >= 5 ? Math.min(100, Math.floor(rawChunk)) : 25;
    const targetEntities =
      Array.isArray(packet.targetEntities) && packet.targetEntities.length > 0
        ? packet.targetEntities.map((e) => String(e).trim()).filter(Boolean)
        : [...DEFAULT_COLD_HUB_ENTITY_ORDER];

    const config: ColdHubSweepConfig = {
      sweepId,
      isColdHub: Boolean(packet.isColdHub),
      pushChunkSize,
      targetEntities,
      startedAt: Date.now(),
    };

    // Keep map bounded
    if (this.sweepConfigs.size > 12) {
      const oldestKey = this.sweepConfigs.keys().next().value;
      if (oldestKey) this.sweepConfigs.delete(oldestKey);
    }
    this.sweepConfigs.set(sweepId, config);
    return config;
  }

  public getSweepConfig(sweepId?: string): ColdHubSweepConfig | undefined {
    if (!sweepId) return undefined;
    return this.sweepConfigs.get(sweepId);
  }

  /**
   * Enqueues a `RECON_PUSH_BACKFILL_REQUEST` job sorted strictly by `targetEntities` order
   * (so `tombstones`, `branches`, `staff`, `cash_accounts`, `customers`, `inventory` ALWAYS
   * hydrate BEFORE `sales` and other T1 transactions).
   */
  public enqueuePushJob(params: {
    sweepId: string;
    entityType: string;
    missingIds: string[];
    pushChunkSize?: number;
    isColdHub?: boolean;
  }): void {
    const cleanIds = Array.from(
      new Set((params.missingIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    );
    if (cleanIds.length === 0) return;

    const sweepCfg = this.sweepConfigs.get(params.sweepId);
    const isColdHub = params.isColdHub ?? sweepCfg?.isColdHub ?? false;
    const rawChunk = Number(params.pushChunkSize ?? sweepCfg?.pushChunkSize ?? 25);
    const pushChunkSize =
      Number.isFinite(rawChunk) && rawChunk >= 5 ? Math.min(100, Math.floor(rawChunk)) : 25;

    const orderSource = sweepCfg?.targetEntities || [...DEFAULT_COLD_HUB_ENTITY_ORDER];
    const normEnt = normalizeEntityKey(params.entityType);
    let orderIdx = orderSource.findIndex((e) => normalizeEntityKey(e) === normEnt);
    if (orderIdx === -1) {
      orderIdx = DEFAULT_COLD_HUB_ENTITY_ORDER.findIndex((e) => e === normEnt);
    }
    if (orderIdx === -1) orderIdx = 999;

    // Merge into existing queued job for same sweepId + entityType if already waiting
    const existing = this.queue.find(
      (j) => j.sweepId === params.sweepId && normalizeEntityKey(j.entityType) === normEnt
    );
    if (existing) {
      const mergedSet = new Set([...existing.missingIds, ...cleanIds]);
      const addedCount = mergedSet.size - existing.missingIds.length;
      existing.missingIds = Array.from(mergedSet);
      if (addedCount > 0) {
        this.progress.totalRecords += addedCount;
        this.emitProgress();
      }
    } else {
      this.queue.push({
        sweepId: params.sweepId,
        entityType: params.entityType,
        missingIds: cleanIds,
        pushChunkSize,
        isColdHub,
        entityOrderIndex: orderIdx,
      });
      this.queue.sort((a, b) => a.entityOrderIndex - b.entityOrderIndex);

      if (!this.progress.active) {
        this.progress = {
          active: true,
          sweepId: params.sweepId,
          isColdHub,
          currentEntity: params.entityType,
          completedEntities: 0,
          totalEntities: 1,
          pushedRecords: 0,
          totalRecords: cleanIds.length,
          currentChunk: 0,
          totalChunks: Math.ceil(cleanIds.length / pushChunkSize),
          pausedForCheckout: false,
          updatedAt: Date.now(),
        };
      } else {
        this.progress.totalEntities += 1;
        this.progress.totalRecords += cleanIds.length;
        if (isColdHub) this.progress.isColdHub = true;
      }
      this.emitProgress();
    }

    if (!this.isRunning && this.startTimer === null) {
      const token = this.cancelToken;
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        if (token === this.cancelToken && !this.isRunning && this.queue.length > 0) {
          void this.processLoop();
        }
      }, 25);
    }
  }

  /**
   * Called when Hub acknowledges a hydration chunk (`RECON_PUSH_CHUNK_ACK`) or record (`SYNC_ACK`).
   */
  public notifyAck(ack: { sweepId?: string; entityType?: string; chunkIndex?: number }): void {
    if (!this.pendingAckResolver) return;
    if (ack.sweepId && ack.entityType !== undefined && ack.chunkIndex !== undefined) {
      const key = `${ack.sweepId}:${normalizeEntityKey(ack.entityType)}:${ack.chunkIndex}`;
      if (this.pendingAckKey === key) {
        const resolve = this.pendingAckResolver;
        this.pendingAckResolver = null;
        this.pendingAckKey = null;
        this.pendingAckEntity = null;
        resolve();
        return;
      }
    }
    // Also allow matching entity-level SYNC_ACK to advance pacing smoothly on Hubs without explicit chunk ACK
    if (ack.entityType && this.pendingAckEntity && normalizeEntityKey(ack.entityType) === this.pendingAckEntity) {
      const resolve = this.pendingAckResolver;
      this.pendingAckResolver = null;
      this.pendingAckKey = null;
      this.pendingAckEntity = null;
      resolve();
    }
  }

  /**
   * Cancels any in-flight hydration (e.g. when disconnecting or failing over to a different Hub).
   */
  public cancel(): void {
    this.cancelToken++;
    if (this.startTimer !== null) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.queue = [];
    this.isRunning = false;
    if (this.pendingAckResolver) {
      const resolve = this.pendingAckResolver;
      this.pendingAckResolver = null;
      this.pendingAckKey = null;
      this.pendingAckEntity = null;
      resolve();
    }
    if (this.progress.active) {
      this.progress = {
        ...this.progress,
        active: false,
        pausedForCheckout: false,
        updatedAt: Date.now(),
      };
      this.emitProgress();
    }
  }

  private emitProgress(): void {
    this.progress.updatedAt = Date.now();
    this.callbacks.onProgress?.({ ...this.progress });
  }

  private async waitForChunkAckOrBackpressure(
    sweepId: string,
    entityType: string,
    chunkIndex: number,
    isColdHub: boolean,
    token: number
  ): Promise<void> {
    const key = `${sweepId}:${normalizeEntityKey(entityType)}:${chunkIndex}`;
    const timeoutMs = isColdHub ? 650 : 350;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.pendingAckKey === key) {
          this.pendingAckResolver = null;
          this.pendingAckKey = null;
          this.pendingAckEntity = null;
        }
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.pendingAckKey = key;
      this.pendingAckEntity = normalizeEntityKey(entityType);
      this.pendingAckResolver = finish;
    });

    if (token !== this.cancelToken) return;

    // WebSocket bufferedAmount backpressure drain (never exceed ~256KB queued in kernel buffer)
    let waits = 0;
    while (
      token === this.cancelToken &&
      this.callbacks.isSocketReady() &&
      this.callbacks.getSocketBufferedAmount() > 262_144 &&
      waits < 25
    ) {
      waits++;
      await yieldToMainThread(60);
    }

    // Guaranteed UI breath between chunks so POS stays completely fluid
    await yieldToMainThread(isColdHub ? 35 : 20);
  }

  private async waitWhileCheckoutActive(token: number): Promise<boolean> {
    if (!this.callbacks.isCheckoutActive()) {
      if (this.progress.pausedForCheckout) {
        this.progress.pausedForCheckout = false;
        this.emitProgress();
      }
      return true;
    }

    this.progress.pausedForCheckout = true;
    this.emitProgress();

    while (token === this.cancelToken && this.callbacks.isCheckoutActive()) {
      await new Promise((r) => setTimeout(r, 1200));
    }

    if (token !== this.cancelToken) return false;
    this.progress.pausedForCheckout = false;
    this.emitProgress();
    return true;
  }

  private async processLoop(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    const token = this.cancelToken;

    try {
      while (token === this.cancelToken && this.queue.length > 0) {
        // Re-sort before pulling next job in case a higher-priority entity (e.g. tombstones) arrived
        this.queue.sort((a, b) => a.entityOrderIndex - b.entityOrderIndex);
        const job = this.queue.shift()!;
        const totalChunks = Math.max(1, Math.ceil(job.missingIds.length / job.pushChunkSize));

        this.progress.currentEntity = job.entityType;
        this.progress.currentChunk = 0;
        this.progress.totalChunks = totalChunks;
        this.emitProgress();

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          if (token !== this.cancelToken || !this.callbacks.isSocketReady()) {
            return;
          }

          // Pause automatically if cashier is actively ringing up a customer
          const canContinue = await this.waitWhileCheckoutActive(token);
          if (!canContinue || !this.callbacks.isSocketReady()) return;

          const start = chunkIdx * job.pushChunkSize;
          const slice = job.missingIds.slice(start, start + job.pushChunkSize);
          let pushedInChunk = 0;

          for (let i = 0; i < slice.length; i++) {
            if (token !== this.cancelToken || !this.callbacks.isSocketReady()) return;
            try {
              const pushed = await this.callbacks.pushSingleRecord(
                job.entityType,
                slice[i],
                job.sweepId,
                job.isColdHub
              );
              if (pushed) {
                pushedInChunk++;
                this.progress.pushedRecords++;
              }
            } catch {}

            // Micro-yield every 5 records inside the chunk to keep input latency < 16ms
            if ((i + 1) % 5 === 0 && i + 1 < slice.length) {
              await yieldToMainThread(0);
            }
          }

          this.progress.currentChunk = chunkIdx + 1;
          this.emitProgress();

          // Signal chunk boundary to Hub for ACK-paced flow control
          try {
            this.callbacks.sendChunkMarker({
              type: 'RECON_PUSH_CHUNK_COMPLETE',
              action: 'RECON_PUSH_CHUNK_COMPLETE',
              sweepId: job.sweepId,
              entityType: job.entityType,
              chunkIndex: chunkIdx,
              totalChunks,
              pushedInChunk,
              isColdHub: job.isColdHub,
              timestamp: Date.now(),
            });
          } catch {}

          // Wait for Hub ACK / backpressure drain + main-thread yield before next chunk
          if (chunkIdx + 1 < totalChunks || this.queue.length > 0) {
            await this.waitForChunkAckOrBackpressure(
              job.sweepId,
              job.entityType,
              chunkIdx,
              job.isColdHub,
              token
            );
          }
        }

        this.progress.completedEntities++;
        this.emitProgress();
      }
    } finally {
      if (token === this.cancelToken) {
        this.isRunning = false;
        this.progress.active = false;
        this.progress.pausedForCheckout = false;
        this.emitProgress();
      }
    }
  }
}
