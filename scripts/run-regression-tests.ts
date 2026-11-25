/**
 * SAIMETRIC Automated Regression Test Suite (Phase 5)
 *
 * Verifies all enterprise reliability & scalability invariants across Phases 3A, 3B, 4A, and 4B:
 *  1. `.saimpack` Archive Pack PBKDF2-SHA256 + AES-256-GCM decrypt/verify & T1-only rules
 *  2. Browser Storage Quota Guard cold T1 pruning (never drops unsynced T1 or live T2 tables)
 *  3. Modular DAOs (Audit Log DAO & Expense DAO isolation, deduplication, and cash reversals)
 *  4. Checkout-Safe PWA Update Controller (never interrupts active POS checkout)
 *  5. Sync Engine Resilience (jittered backoff, DLQ permanent-error classifier, circuit breaker, cross-tab lock)
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

import {
  SAIMPACK_FORMAT,
  ALLOWED_T1_ENTITY_TYPES,
  decryptAndVerifyArchiveEnvelope,
} from '../src/server/archivePackIngestRouter';
import { memoryCache } from '../src/db/roomStorageEngine';
import { STORAGE_KEYS } from '../src/db/storageKeys';
import { pruneSyncedColdT1FromHotCache } from '../src/db/storageQuotaGuard';
import { createAuditLogDao } from '../src/db/daos/auditLogDao';
import { createExpenseDao } from '../src/db/daos/expenseDao';
import {
  createPWAUpdateController,
  isChunkLoadErrorMessage,
} from '../src/services/pwaUpdateController';
import {
  computeJitteredBackoffMs,
  classifySyncError,
  SyncCircuitBreaker,
  withCrossTabSyncLock,
} from '../src/services/sync/syncResilience';

type TestCase = { name: string; run: () => Promise<void> | void };

const suites: TestCase[] = [
  {
    name: 'Phase 3A — .saimpack PBKDF2-SHA256 + AES-256-GCM verification & T1-only allowlist',
    run: () => {
      const passphrase = 'BranchArchiveSecret!2026';
      const inner = {
        format: SAIMPACK_FORMAT,
        packId: 'PACK-20261125-001',
        tenantId: 'COMP-001',
        branchId: 'BR-MAIN',
        branchName: 'Harare Main',
        hubId: 'HUB-01',
        t1Only: true,
        bypassClockDriftOnCloudIngest: true,
        createdAt: Date.now(),
        fromTs: Date.now() - 120 * 86400_000,
        toTs: Date.now() - 30 * 86400_000,
        cutoffTs: Date.now() - 7 * 86400_000,
        preserveRecentDays: 7,
        recordCount: 1,
        entityCounts: { sales: 1 },
        stores: {
          sales: [{ id: 'INV-HIST-1', date: '2026-06-01', total: 88.5 }],
        },
        genericEntities: {},
      };
      const jsonBytes = Buffer.from(JSON.stringify(inner), 'utf8');
      const gzipBytes = zlib.gzipSync(jsonBytes);
      const gzipSha256 = crypto.createHash('sha256').update(gzipBytes).digest('hex');
      const payloadSha256 = crypto.createHash('sha256').update(jsonBytes).digest('hex');

      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = crypto.pbkdf2Sync(passphrase, salt, 120000, 32, 'sha256');
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(gzipBytes), cipher.final()]);
      const tag = cipher.getAuthTag();

      const envelope = {
        format: SAIMPACK_FORMAT,
        packId: inner.packId,
        tenantId: inner.tenantId,
        branchId: inner.branchId,
        branchName: inner.branchName,
        hubId: inner.hubId,
        t1Only: true,
        createdAt: inner.createdAt,
        fromTs: inner.fromTs,
        toTs: inner.toTs,
        cutoffTs: inner.cutoffTs,
        preserveRecentDays: 7,
        recordCount: 1,
        entityCounts: { sales: 1 },
        uncompressedBytes: jsonBytes.length,
        compressedBytes: gzipBytes.length,
        gzipSha256,
        payloadSha256,
        encrypted: true,
        encAlg: 'aes-256-gcm',
        kdf: 'pbkdf2-sha256',
        kdfIterations: 120000,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        payloadBase64: encrypted.toString('base64'),
      };

      const okRes = decryptAndVerifyArchiveEnvelope(envelope, passphrase);
      assert.equal(okRes.ok, true, 'Valid encrypted .saimpack envelope must decrypt and verify');
      if (okRes.ok) {
        assert.equal(okRes.innerPayload.packId, inner.packId);
        assert.equal(okRes.innerPayload.bypassClockDriftOnCloudIngest, true);
      }

      const badPassRes = decryptAndVerifyArchiveEnvelope(envelope, 'WrongPassphrase');
      assert.equal(badPassRes.ok, false, 'Wrong passphrase must fail AES-GCM authentication');

      // Ensure live T2 master tables are strictly excluded from ALLOWED_T1_ENTITY_TYPES
      assert.equal(ALLOWED_T1_ENTITY_TYPES.has('sale'), true);
      assert.equal(ALLOWED_T1_ENTITY_TYPES.has('audit_log'), true);
      assert.equal(ALLOWED_T1_ENTITY_TYPES.has('inventory_item'), false);
      assert.equal(ALLOWED_T1_ENTITY_TYPES.has('customer'), false);
      assert.equal(ALLOWED_T1_ENTITY_TYPES.has('staff'), false);
      assert.equal(ALLOWED_T1_ENTITY_TYPES.has('branch'), false);
    },
  },
  {
    name: 'Phase 3B — Storage Quota Guard prunes only cloud-synced cold T1 & protects unsynced T1 / T2',
    run: () => {
      const oldIso = new Date(Date.now() - 180 * 86400_000).toISOString();
      const recentIso = new Date(Date.now() - 5 * 86400_000).toISOString();
      const sales: any[] = [];
      for (let i = 0; i < 520; i++) {
        sales.push({ id: `S-OLD-SYNC-${i}`, timestamp: oldIso, synced: true, total: 10 });
      }
      for (let i = 0; i < 20; i++) {
        sales.push({ id: `S-OLD-UNSYNC-${i}`, timestamp: oldIso, synced: false, total: 25 });
      }
      for (let i = 0; i < 30; i++) {
        sales.push({ id: `S-RECENT-${i}`, timestamp: recentIso, synced: true, total: 15 });
      }
      const inventory = Array.from({ length: 600 }, (_, i) => ({
        id: `INV-${i}`,
        timestamp: oldIso,
        synced: true,
        name: `Product ${i}`,
      }));

      memoryCache.set(STORAGE_KEYS.SALES, sales);
      memoryCache.set(STORAGE_KEYS.INVENTORY_ITEMS, inventory);

      const res = pruneSyncedColdT1FromHotCache(90);
      assert.equal(res.prunedCount, 520);
      const remainingSales = (memoryCache.get(STORAGE_KEYS.SALES) as any[]) || [];
      assert.equal(remainingSales.length, 50);
      assert.equal(
        remainingSales.filter((s) => s.id.startsWith('S-OLD-UNSYNC-')).length,
        20,
        'Unsynced T1 must never be pruned'
      );
      assert.equal(
        ((memoryCache.get(STORAGE_KEYS.INVENTORY_ITEMS) as any[]) || []).length,
        600,
        'Live T2 master inventory must never be pruned'
      );
    },
  },
  {
    name: 'Phase 3B — Modular Audit Log DAO & Expense DAO invariants',
    run: () => {
      const auditStore: Record<string, any> = {
        [STORAGE_KEYS.AUDIT_LOGS]: [
          { id: 'AUD-DUP', action: 'LOGIN', severity: 'INFO' },
          { id: 'AUD-DUP', action: 'LOGIN', severity: 'INFO' },
        ],
      };
      const auditSyncs: any[] = [];
      const auditDao = createAuditLogDao({
        getStored: (k, d) => (k in auditStore ? auditStore[k] : d),
        setStored: (k, v) => {
          auditStore[k] = v;
        },
        initialAuditLogs: [],
        getCurrentBranchId: () => 'BR-1',
        getCurrentCompanyId: () => 'COMP-1',
        getBranches: () => [],
        isCompanyInTenantScope: () => true,
        isRecordInBranchScope: () => true,
        enqueueSync: (sheet, action, data) => auditSyncs.push({ sheet, action, data }),
        getCurrentUser: () => ({ id: 'CASH-1', name: 'Alice', role: 'Cashier' } as any),
      });

      assert.equal(new Set(auditDao.getRawStoredAuditLogs().map((a) => a.id)).size, 2);
      auditDao.logLogin({ id: 'CASH-1', name: 'Alice', role: 'Cashier' } as any);
      assert.equal(auditSyncs.length, 0, 'Routine INFO logins must not bloat sync queue');
      auditDao.logManagerOverride({
        action: 'REFUND_INVOICE',
        manager: { id: 'MGR-1', name: 'Bob', role: 'Manager' } as any,
        details: 'Refund verified',
        amount: 35,
      });
      assert.equal(auditSyncs.length, 1, 'Critical override must enqueue to Audit_Log');

      const expStore: Record<string, any> = { [STORAGE_KEYS.EXPENSES]: [] };
      const cashLogs: any[] = [];
      const movements: any[] = [];
      const expenseDao = createExpenseDao({
        getStored: (k, d) => (k in expStore ? expStore[k] : d),
        setStored: (k, v) => {
          expStore[k] = v;
        },
        initialExpenses: [],
        getCurrentBranchId: () => 'BR-1',
        getCurrentCompanyId: () => 'COMP-1',
        getBranches: () => [],
        isCompanyInTenantScope: () => true,
        isRecordInBranchScope: () => true,
        getSessionUser: () => ({ id: 'CASH-1', name: 'Alice', role: 'Cashier' } as any),
        isSupervisorOrAbove: (r) => r === 'Manager' || r === 'Supervisor',
        generateUUID: () => 'EXP-REG-1',
        getCashLogs: () => cashLogs,
        addCashLog: (entry) => {
          cashLogs.push(entry);
          return entry;
        },
        getMovements: () => movements,
        addMovement: (entry) => {
          movements.push(entry);
          return entry;
        },
        getShiftId: (s, d, b) => `${s}_${d}_${b}`,
        enqueueSync: () => {},
        notifyExpenseChanged: () => {},
        notifyListeners: () => {},
      });

      const exp = expenseDao.addExpense({
        date: '2026-11-25',
        timestamp: new Date().toISOString(),
        category: 'Supplies',
        amount: 18,
        paymentMethod: 'Cash',
        staffId: 'CASH-1',
        staffName: 'Alice',
        description: 'Thermal rolls',
      } as any);
      assert.equal(exp.status, 'pending_supervisor');
      assert.equal(cashLogs.length, 1);

      const rejected = expenseDao.rejectExpense(
        exp.id,
        { id: 'MGR-1', name: 'Bob', role: 'Manager' } as any,
        'Duplicate'
      );
      assert.equal(rejected, true);
      assert.equal(cashLogs.length, 2, 'Rejecting cash expense must log reversal');
      assert.equal(movements.length, 1, 'Rejecting cash expense must record reversal movement');

      const staleMesh = expenseDao.addExpense(
        { ...exp, status: 'pending_supervisor', fromMesh: true } as any,
        { fromSync: true }
      );
      assert.equal(staleMesh.status, 'rejected', 'Finalized status must resist stale pending packets');
    },
  },
  {
    name: 'Phase 4A — Checkout-Safe PWA Update Controller never interrupts active POS cart',
    run: async () => {
      let checkoutBusy = true;
      let appliedCount = 0;
      let pendingTimer: (() => void) | null = null;

      const ctrl = createPWAUpdateController({
        isCheckoutActive: () => checkoutBusy,
        triggerUpdateSW: async () => {
          appliedCount += 1;
        },
        checkRegistrationUpdate: async () => {},
        onReloadFallback: () => {},
        setTimer: (fn) => {
          pendingTimer = fn;
          return 1 as any;
        },
        clearTimer: () => {
          pendingTimer = null;
        },
      });

      ctrl.notifyNeedRefresh();
      assert.equal(ctrl.getState().updateAvailable, true);
      assert.equal(appliedCount, 0);

      const req = await ctrl.requestApplyUpdate();
      assert.equal(req, 'queued', 'Update during active cart must queue instead of reloading');
      assert.equal(appliedCount, 0);

      checkoutBusy = false;
      ctrl.refreshCheckoutStatus();
      assert.ok(pendingTimer !== null);

      // New customer starts scanning before timer fires -> cancel auto-apply
      checkoutBusy = true;
      ctrl.refreshCheckoutStatus();
      assert.equal(pendingTimer, null);

      // Cart clears and remains idle -> applies cleanly
      checkoutBusy = false;
      ctrl.refreshCheckoutStatus();
      assert.ok(pendingTimer !== null);
      pendingTimer!();
      await Promise.resolve();
      assert.equal(appliedCount, 1);

      assert.equal(isChunkLoadErrorMessage('Failed to fetch dynamically imported module'), true);
      assert.equal(isChunkLoadErrorMessage('Generic network error'), false);
    },
  },
  {
    name: 'Phase 4B — Sync Resilience (Jitter, Permanent DLQ Classifier, Circuit Breaker, Cross-Tab Lock)',
    run: async () => {
      assert.equal(computeJitteredBackoffMs(3, { baseMs: 1000, jitterRatio: 0.25, rng: () => 0 }), 3000);
      assert.equal(computeJitteredBackoffMs(3, { baseMs: 1000, jitterRatio: 0.25, rng: () => 1 }), 5000);
      assert.equal(
        computeJitteredBackoffMs(20, { baseMs: 1000, maxMs: 300000, jitterRatio: 0, rng: () => 0.5 }),
        300000
      );

      assert.equal(classifySyncError('MASTER_SHEET_WRITE_BLOCKED: tenant leak'), 'PERMANENT');
      assert.equal(classifySyncError('Cloud proxy returned HTTP 403'), 'PERMANENT');
      assert.equal(classifySyncError('Cloud sync timed out (55s)'), 'TRANSIENT');
      assert.equal(classifySyncError('HTTP 503 Service Unavailable'), 'TRANSIENT');

      const cb = new SyncCircuitBreaker({
        failureThreshold: 3,
        baseCooldownMs: 30_000,
        maxCooldownMs: 120_000,
        rng: () => 0.5,
      });
      const t0 = 1_000_000;
      assert.equal(cb.recordTransientFailure('err1', t0), 'CLOSED');
      assert.equal(cb.recordTransientFailure('err2', t0 + 1000), 'CLOSED');
      assert.equal(cb.recordTransientFailure('err3', t0 + 2000), 'OPEN');
      assert.equal(cb.canAttempt(t0 + 5000), false);
      assert.equal(cb.canAttempt(t0 + 35_000), true);
      assert.equal(cb.canAttempt(t0 + 35_001), false);
      cb.recordTransientFailure('probe fail', t0 + 36_000);
      assert.equal(cb.getSnapshot(t0 + 36_000).cooldownMs, 60_000);
      cb.recordSuccess();
      assert.equal(cb.getSnapshot(t0 + 40_000).state, 'CLOSED');

      const memLS: Record<string, string> = {};
      (globalThis as any).localStorage = {
        getItem: (k: string) => (k in memLS ? memLS[k] : null),
        setItem: (k: string, v: string) => {
          memLS[k] = v;
        },
        removeItem: (k: string) => {
          delete memLS[k];
        },
      };
      memLS['saimetric_lock_reg_comp'] = JSON.stringify({
        owner: 'peer_tab',
        expiresAt: Date.now() + 60_000,
      });
      const blocked = await withCrossTabSyncLock('reg_comp', async () => 'RAN', 'SKIPPED');
      assert.equal(blocked.acquired, false);

      memLS['saimetric_lock_reg_comp'] = JSON.stringify({
        owner: 'peer_tab',
        expiresAt: Date.now() - 1000,
      });
      const acquired = await withCrossTabSyncLock('reg_comp', async () => 'RAN', 'SKIPPED');
      assert.equal(acquired.acquired, true);
      assert.equal(acquired.result, 'RAN');
      assert.equal(memLS['saimetric_lock_reg_comp'], undefined);
    },
  },
];

async function main() {
  let passed = 0;
  for (const tc of suites) {
    const start = Date.now();
    await tc.run();
    passed += 1;
    console.log(`[RegressionTest] PASS (${Date.now() - start}ms): ${tc.name}`);
  }
  console.log(`\n[RegressionTest] ALL ${passed}/${suites.length} SUITES PASSED`);
}

main().catch((err) => {
  console.error('[RegressionTest] FAILED:', err);
  process.exit(1);
});
