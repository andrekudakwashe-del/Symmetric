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
import {
  roundUnitCost,
  formatUnitCost,
  computeGrvLineCosting,
  applyReceiptToValuePool,
  applyOutflowToValuePool,
  applyReturnToValuePool,
  computeItemValuationCents,
  computePortfolioValuation,
  computeReorderPointTotalUnits,
  isItemBelowReorderPoint,
  decomposeStockUnits,
  normalizeStockFields,
} from '../src/utils/inventoryMath';
import { resolveItemCost } from '../src/utils/costResolver';
import { filterCashierVisibleInvoices } from '../src/utils/cashierInvoiceFilter';
import {
  buildPurchaseOrderA4Html,
  buildPurchaseOrderThermal58mmHtml,
} from '../src/services/purchaseOrderPrintService';

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
  {
    name: 'Inventory Phase 1/2 — 4-decimal unit cost precision & bidirectional GRV Line-Total-First / Unit-Cost-First math',
    run: () => {
      assert.equal(roundUnitCost(1 / 24), 0.0417);
      assert.equal(formatUnitCost(0.0417), '0.0417');
      assert.equal(formatUnitCost(1.5), '1.50');
      assert.equal(formatUnitCost(0.3333), '0.3333');
      assert.equal(formatUnitCost(0), '0.00');

      // Line-Total-First: 3 cases x 24 units = 72 units, exact supplier line total $10.00
      const ltMode = computeGrvLineCosting({
        receiveAs: 'Cases',
        qty: 3,
        unitsPerCase: 24,
        costEntryMode: 'LINE_TOTAL',
        enteredLineTotal: 10.0,
      });
      assert.equal(ltMode.totalUnits, 72);
      assert.equal(ltMode.lineTotalCents, 1000);
      assert.equal(ltMode.lineTotal, 10);
      assert.equal(ltMode.costPerCase, 3.3333);
      assert.equal(ltMode.costPerUnit, 0.1389);

      // Unit-Cost-First: 120 loose units @ $0.0417/unit => $5.004 -> 500 cents
      const ucMode = computeGrvLineCosting({
        receiveAs: 'Singles',
        qty: 120,
        unitsPerCase: 24,
        costEntryMode: 'UNIT_COST',
        enteredUnitOrCaseCost: 0.0417,
      });
      assert.equal(ucMode.totalUnits, 120);
      assert.equal(ucMode.costPerUnit, 0.0417);
      assert.equal(ucMode.lineTotalCents, 500);
      assert.equal(ucMode.lineTotal, 5);

      // Variant prepacks in Line-Total-First mode: 5 packs of 6 = 30 units for $11.00
      const varMode = computeGrvLineCosting({
        receiveAs: 'Variant',
        qty: 5,
        unitsPerCase: 24,
        variantUnitsPerPack: 6,
        costEntryMode: 'LINE_TOTAL',
        enteredLineTotal: 11.0,
      });
      assert.equal(varMode.totalUnits, 30);
      assert.equal(varMode.lineTotalCents, 1100);
      assert.equal(varMode.costPerUnit, 0.3667);
    },
  },
  {
    name: 'Inventory Phase 1/2 — stockValueCents zero-penny GL reconciliation across receipts, sales, returns, and negative stock',
    run: () => {
      // Receive 3 cases x 24 = 72 units for $10.00 + $1.00 allocated landed cost = 1100 cents exact
      const receipt = applyReceiptToValuePool({
        prevTotalUnits: 0,
        prevStockValueCents: 0,
        prevAvgUnitCost: 0,
        unitsPerCase: 24,
        receivedUnits: 72,
        receivedTotalCents: 1100,
      });
      assert.equal(receipt.newTotalUnits, 72);
      assert.equal(receipt.stockValueCents, 1100);
      assert.equal(receipt.averageCostPerUnit, 0.1528);

      // Sell in arbitrary uneven chunks (7, 13, 19, 11, 22) summing to 72 units -> COGS must sum to EXACTLY 1100 cents and pool -> 0
      let units = receipt.newTotalUnits;
      let poolCents = receipt.stockValueCents;
      let totalCogsCents = 0;
      for (const sold of [7, 13, 19, 11, 22]) {
        const out = applyOutflowToValuePool({
          prevTotalUnits: units,
          prevStockValueCents: poolCents,
          prevAvgUnitCost: receipt.averageCostPerUnit,
          deductedUnits: sold,
        });
        totalCogsCents += out.cogsCents;
        units = out.newTotalUnits;
        poolCents = out.stockValueCents;
      }
      assert.equal(units, 0);
      assert.equal(poolCents, 0);
      assert.equal(totalCogsCents, 1100, 'Sum of COGS cents across full depletion must match received GL cents to the exact penny');

      // Return 5 units at MWAC, then sell them back -> pool returns cleanly to 0
      const ret = applyReturnToValuePool({
        prevTotalUnits: units,
        prevStockValueCents: poolCents,
        prevAvgUnitCost: receipt.averageCostPerUnit,
        returnedUnits: 5,
      });
      assert.equal(ret.newTotalUnits, 5);
      assert.equal(ret.stockValueCents, Math.round(5 * receipt.averageCostPerUnit * 100));
      const outAfterReturn = applyOutflowToValuePool({
        prevTotalUnits: ret.newTotalUnits,
        prevStockValueCents: ret.stockValueCents,
        prevAvgUnitCost: receipt.averageCostPerUnit,
        deductedUnits: 5,
      });
      assert.equal(outAfterReturn.newTotalUnits, 0);
      assert.equal(outAfterReturn.stockValueCents, 0);
      assert.equal(outAfterReturn.cogsCents, ret.stockValueCents);

      // Negative stock clearance: -10 units on hand, receive 24 units for $10.00 (1000 cents)
      // 14 positive units remain with proportional pool value = round(1000 * 14 / 24) = 583 cents, MWAC = $0.4164
      const negRec = applyReceiptToValuePool({
        prevTotalUnits: -10,
        prevStockValueCents: 0,
        prevAvgUnitCost: 0,
        unitsPerCase: 24,
        receivedUnits: 24,
        receivedTotalCents: 1000,
      });
      assert.equal(negRec.newTotalUnits, 14);
      assert.equal(negRec.stockValueCents, 583);
      assert.equal(negRec.latestCostPerUnit, 0.4167);
      assert.equal(negRec.averageCostPerUnit, 0.4164);

      // Canonical decomposition invariant: negative stock always keeps stockCases === 0
      const negDecomp = decomposeStockUnits(-10, 24);
      assert.equal(negDecomp.stockCases, 0);
      assert.equal(negDecomp.stockSingles, -10);
      assert.equal(negDecomp.totalUnits, -10);

      // Portfolio valuation honors exact stockValueCents and isolates negative SKUs
      const portfolio = computePortfolioValuation([
        {
          itemId: 'SKU-A',
          unitsPerCase: 24,
          totalUnits: 72,
          stockCases: 3,
          stockSingles: 0,
          averageCostPerUnit: 0.1389,
          stockValueCents: 1000, // exact $10.00 (whereas 72 * 0.1389 = $10.0008)
          sellPriceUnit: 0.25,
        },
        {
          itemId: 'SKU-NEG',
          unitsPerCase: 12,
          totalUnits: -5,
          stockCases: 0,
          stockSingles: -5,
          averageCostPerUnit: 1.0,
          stockValueCents: 0,
          sellPriceUnit: 1.5,
        },
      ]);
      assert.equal(computeItemValuationCents({ totalUnits: 72, unitsPerCase: 24, stockValueCents: 1000, averageCostPerUnit: 0.1389 }), 1000);
      assert.equal(portfolio.totalValuationCents, 1000);
      assert.equal(portfolio.totalValuationDollars, 10);
      assert.equal(portfolio.negativeSkuCount, 1);
      assert.equal(portfolio.negativeTotalUnits, -5);
      assert.equal(normalizeStockFields({ stockCases: 2, stockSingles: 5, unitsPerCase: 12 }).totalUnits, 29);
    },
  },
  {
    name: 'Inventory Phase 3–6 — Unified reorder-point parity, POS Product normalization, costResolver negative safety & multi-receipt MWAC',
    run: () => {
      // 1. Bulk case item: 5 cases x 24 = 120 units (0 loose singles), reorderLevelCases=2 (48u), reorderLevelUnits=10
      const bulkHealthy = {
        unitsPerCase: 24,
        stockCases: 5,
        stockSingles: 0,
        totalUnits: 120,
        reorderLevelCases: 2,
        reorderLevelUnits: 10,
      };
      assert.equal(computeReorderPointTotalUnits(bulkHealthy), 48);
      assert.equal(isItemBelowReorderPoint(bulkHealthy), false, '5 full cases (0 singles) must NOT be flagged low stock');

      // Boundary checks: <= 48 is low, 49 is optimal
      assert.equal(isItemBelowReorderPoint({ ...bulkHealthy, stockCases: 2, stockSingles: 0, totalUnits: 48 }), true);
      assert.equal(isItemBelowReorderPoint({ ...bulkHealthy, stockCases: 2, stockSingles: 1, totalUnits: 49 }), false);

      // Single-unit item: unitsPerCase=1, reorderLevelUnits=10
      const singleItem = { unitsPerCase: 1, stockCases: 0, stockSingles: 10, totalUnits: 10, reorderLevelCases: 2, reorderLevelUnits: 10 };
      assert.equal(computeReorderPointTotalUnits(singleItem), 10);
      assert.equal(isItemBelowReorderPoint(singleItem), true);
      assert.equal(isItemBelowReorderPoint({ ...singleItem, stockSingles: 11, totalUnits: 11 }), false);

      // Negative stock is ALWAYS below reorder point even if reorder thresholds are 0
      assert.equal(
        isItemBelowReorderPoint({ unitsPerCase: 24, stockCases: 0, stockSingles: -3, totalUnits: -3, reorderLevelCases: 0, reorderLevelUnits: 0 }),
        true
      );

      // POS Product case-variant shape (stockQuantity === stockCases) must NOT double-count via normalizeStockFields
      const posCaseProduct = {
        id: 'SKU-CASE-CASE',
        unitsPerCase: 24,
        stockQuantity: 2, // cases
        stockCases: 2,
        stockSingles: 0,
        totalUnits: 48,
        reorderLevelCases: 2,
        reorderLevelUnits: 10,
      };
      assert.equal(normalizeStockFields(posCaseProduct).totalUnits, 48);
      assert.equal(isItemBelowReorderPoint(posCaseProduct), true);

      // 2. costResolver negative stock safety & 4-decimal MWAC preservation
      const invItem: any = {
        itemId: 'ITM-NEG-1',
        itemName: 'Sugar 2kg',
        sku: 'SUG-2KG',
        category: 'Groceries',
        unitsPerCase: 24,
        stockCases: 0,
        stockSingles: -5,
        totalUnits: -5,
        costPerUnit: 0.1389,
        averageCostPerUnit: 0.1389,
        latestCostPerUnit: 0.1458,
        costPerCase: 3.3336,
        averageCostPerCase: 3.3336,
        latestCostPerCase: 3.4992,
        sellPriceUnit: 0.25,
        sellPriceCase: 6.0,
        reorderLevelCases: 2,
        reorderLevelUnits: 10,
      };

      const resolvedUnit = resolveItemCost({ id: 'ITM-NEG-1-UNIT', name: 'Sugar 2kg Each', quantity: 1, unitPrice: 0.25 }, [invItem], []);
      assert.equal(resolvedUnit.currentStock, -5);
      assert.equal(resolvedUnit.stockStatus, 'Out of Stock');
      assert.equal(resolvedUnit.avgCost, 0.1389, 'costResolver must preserve 4-decimal MWAC without 2-decimal truncation');

      const resolvedCase = resolveItemCost({ id: 'ITM-NEG-1-CASE', name: 'Sugar 2kg Case', quantity: 1, unitPrice: 6.0 }, [invItem], []);
      assert.equal(resolvedCase.itemType, 'case');
      assert.equal(resolvedCase.currentStock, 0, 'Negative totalUnits must yield 0 full cases, never -1');
      assert.equal(resolvedCase.stockStatus, 'Out of Stock');
      assert.equal(resolvedCase.avgCost, 3.3336);

      // 3. Multi-receipt MWAC + partial sale + second receipt + stocktake GL reconciliation
      // Receipt 1: 36 units for $10.00 (1000 cents)
      const r1 = applyReceiptToValuePool({
        prevTotalUnits: 0,
        prevStockValueCents: 0,
        prevAvgUnitCost: 0,
        unitsPerCase: 12,
        receivedUnits: 36,
        receivedTotalCents: 1000,
      });
      // Sell 10 units -> COGS = round(1000 * 10 / 36) = 278 cents, remaining pool = 722 cents for 26 units
      const s1 = applyOutflowToValuePool({
        prevTotalUnits: r1.newTotalUnits,
        prevStockValueCents: r1.stockValueCents,
        prevAvgUnitCost: r1.averageCostPerUnit,
        deductedUnits: 10,
      });
      assert.equal(s1.cogsCents, 278);
      assert.equal(s1.stockValueCents, 722);

      // Receipt 2: 24 units for $9.00 (900 cents) -> 50 units, pool = 1622 cents exact, MWAC = $0.3244
      const r2 = applyReceiptToValuePool({
        prevTotalUnits: s1.newTotalUnits,
        prevStockValueCents: s1.stockValueCents,
        prevAvgUnitCost: r1.averageCostPerUnit,
        unitsPerCase: 12,
        receivedUnits: 24,
        receivedTotalCents: 900,
      });
      assert.equal(r2.newTotalUnits, 50);
      assert.equal(r2.stockValueCents, 1622);
      assert.equal(r2.averageCostPerUnit, 0.3244);

      // Stocktake system cost matches exact pool cents ($16.22), and full depletion reconciles total GL (1000 + 900 = 1900 cents)
      const systemValCents = computeItemValuationCents({
        totalUnits: r2.newTotalUnits,
        unitsPerCase: 12,
        stockValueCents: r2.stockValueCents,
        averageCostPerUnit: r2.averageCostPerUnit,
      });
      assert.equal(systemValCents, 1622);
      const s2 = applyOutflowToValuePool({
        prevTotalUnits: r2.newTotalUnits,
        prevStockValueCents: r2.stockValueCents,
        prevAvgUnitCost: r2.averageCostPerUnit,
        deductedUnits: 50,
      });
      assert.equal(s1.cogsCents + s2.cogsCents, 1900, 'Multi-receipt cumulative COGS must equal cumulative GRV GL cents to the exact penny');
    },
  },
  {
    name: 'Blind Till Security — Cashiers only see their last 5 invoices and targeted older-invoice lookups return only referenced receipts',
    run: () => {
      const cashier: any = { id: 'CASH-1', name: 'Tendai Moyo', role: 'Cashier' };
      const baseTime = new Date('2026-11-27T08:00:00Z').getTime();
      const sales: any[] = [];
      // 12 invoices by Tendai Moyo (oldest #1 .. newest #12)
      for (let i = 1; i <= 12; i++) {
        sales.push({
          id: `INV-HQ-00${String(i).padStart(2, '0')}`,
          date: '2026-11-27',
          timestamp: new Date(baseTime + i * 60_000).toISOString(),
          staffId: 'CASH-1',
          staffName: 'Tendai Moyo',
          customerName: i === 2 ? 'Grace Chikwanda' : 'Walk-in Customer',
          customerPhone: i === 2 ? '0772998877' : '',
          paymentMethod: 'Cash',
          paymentReference: i === 3 ? 'ECOCASH-REF-7788' : undefined,
          total: 10 + i,
          status: 'Paid',
        });
      }
      // 3 invoices by another cashier (should never appear in Tendai's default last 5)
      for (let j = 13; j <= 15; j++) {
        sales.push({
          id: `INV-HQ-00${j}`,
          date: '2026-11-27',
          timestamp: new Date(baseTime + j * 60_000).toISOString(),
          staffId: 'CASH-2',
          staffName: 'Nyasha Dube',
          customerName: 'Walk-in Customer',
          paymentMethod: 'Cash',
          total: 25,
          status: 'Paid',
        });
      }

      // 1. Default view (empty query) -> ONLY Tendai's 5 newest invoices (#12..#8)
      const recent = filterCashierVisibleInvoices(sales, cashier, '');
      assert.equal(recent.mode, 'recent_5');
      assert.deepEqual(
        recent.invoices.map((s) => s.id),
        ['INV-HQ-0012', 'INV-HQ-0011', 'INV-HQ-0010', 'INV-HQ-0009', 'INV-HQ-0008']
      );

      // 2. Exact older invoice number lookup -> ONLY that single referenced invoice (#0004)
      const byExactId = filterCashierVisibleInvoices(sales, cashier, 'INV-HQ-0004');
      assert.equal(byExactId.mode, 'exact_match');
      assert.deepEqual(byExactId.invoices.map((s) => s.id), ['INV-HQ-0004']);

      // 3. Suffix lookup (#0004) -> ONLY that single referenced invoice
      const bySuffix = filterCashierVisibleInvoices(sales, cashier, '#0004');
      assert.equal(bySuffix.mode, 'exact_match');
      assert.deepEqual(bySuffix.invoices.map((s) => s.id), ['INV-HQ-0004']);

      // 4. Payment reference lookup -> ONLY that referenced invoice (#0003)
      const byRef = filterCashierVisibleInvoices(sales, cashier, 'ECOCASH-REF-7788');
      assert.equal(byRef.mode, 'exact_match');
      assert.deepEqual(byRef.invoices.map((s) => s.id), ['INV-HQ-0003']);

      // 5. Named customer & phone lookup -> ONLY Grace Chikwanda's older invoice (#0002)
      const byCustomer = filterCashierVisibleInvoices(sales, cashier, 'Grace Chikwanda');
      assert.equal(byCustomer.mode, 'exact_match');
      assert.deepEqual(byCustomer.invoices.map((s) => s.id), ['INV-HQ-0002']);

      const byPhone = filterCashierVisibleInvoices(sales, cashier, '0772998877');
      assert.equal(byPhone.mode, 'exact_match');
      assert.deepEqual(byPhone.invoices.map((s) => s.id), ['INV-HQ-0002']);

      // 6. Anti-loophole guards: short queries, generic Walk-in/Cash/year queries, or cashier's own name must NOT dump shift invoices
      assert.equal(filterCashierVisibleInvoices(sales, cashier, '00').mode, 'query_too_short');
      assert.equal(filterCashierVisibleInvoices(sales, cashier, '00').invoices.length, 0);
      assert.equal(filterCashierVisibleInvoices(sales, cashier, 'Walk-in').mode, 'query_too_broad');
      assert.equal(filterCashierVisibleInvoices(sales, cashier, 'Walk-in').invoices.length, 0);
      assert.equal(filterCashierVisibleInvoices(sales, cashier, 'Cash').mode, 'query_too_broad');
      assert.equal(filterCashierVisibleInvoices(sales, cashier, 'Tendai').mode, 'query_too_broad');
      assert.equal(filterCashierVisibleInvoices(sales, cashier, 'Tendai Moyo').mode, 'query_too_broad');
    },
  },
  {
    name: 'Purchase Order Printing — 58mm thermal & A4 outputs render edited descriptions cleanly without Master Ref clutter',
    run: async () => {
      const samplePo: any = {
        id: 'PO-HQ-2026-0007',
        poNumber: 'PO-HQ-2026-0007',
        company_id: 'COMP-001',
        branch_id: 'BR-MAIN',
        branchName: 'Main Store',
        supplierName: 'Delta Beverages',
        orderDate: '2026-11-27',
        expectedDeliveryDate: '2026-11-30',
        paymentTerms: 'COD',
        status: 'APPROVED',
        subtotal: 120,
        taxPercent: 0,
        taxAmount: 0,
        grandTotal: 120,
        totalCases: 10,
        totalUnits: 60,
        createdByName: 'Procurement Clerk',
        approvedByName: 'Store Manager',
        createdAt: '2026-11-27T08:00:00Z',
        lines: [
          {
            lineId: 'POL-1',
            itemId: 'ITM-BH-2L',
            code: 'BH-2L',
            masterDescription: 'Bally House 2L Assorted Original Master Name',
            poDescription: 'Bally House 2L Orange Flavour',
            orderCases: 10,
            orderSingles: 0,
            unitsPerCase: 6,
            totalUnits: 60,
            unitCost: 2.0,
            caseCost: 12.0,
            lineTotal: 120.0,
          },
        ],
      };

      const a4Html = buildPurchaseOrderA4Html(samplePo);
      assert.ok(a4Html.includes('Bally House 2L Orange Flavour'), 'A4 PO must include edited PO description');
      assert.ok(!a4Html.includes('Master Ref'), 'A4 PO must not display Master Ref label');
      assert.ok(
        !a4Html.includes('Bally House 2L Assorted Original Master Name'),
        'A4 PO must not display original masterDescription when edited'
      );

      const thermalHtml = buildPurchaseOrderThermal58mmHtml(samplePo, '58mm');
      assert.ok(thermalHtml.includes('58mm'), '58mm thermal PO must configure 58mm page width');
      assert.ok(thermalHtml.includes('PO-HQ-2026-0007'), '58mm thermal PO must include PO number');
      assert.ok(thermalHtml.includes('Bally House 2L Orange Flavour'), '58mm thermal PO must include edited description');
      assert.ok(thermalHtml.includes('[Cases]'), '58mm thermal PO must show pack type (Cases)');
      assert.ok(!thermalHtml.includes('BH-2L'), '58mm thermal PO must replace SKU code with pack type');
      assert.ok(!thermalHtml.includes('Items / Qty'), '58mm thermal PO must not show Total Quantity at bottom');
      assert.ok(!thermalHtml.includes('Total Qty'), '58mm thermal PO must not show Total Qty at bottom');
      assert.ok(thermalHtml.includes('$120.00'), '58mm thermal PO must include grand total');
      assert.ok(!thermalHtml.includes('Master Ref'), '58mm thermal PO must not display Master Ref');
      assert.ok(
        !thermalHtml.includes('Bally House 2L Assorted Original Master Name'),
        '58mm thermal PO must not display original masterDescription when edited'
      );

      // Verify Opal Washing Powder 2kg singles calculation fix (5 singles @ $3.45 with 8 u/cs === $17.25, NOT $2.16)
      const { computePurchaseOrderLine, resolveCatalogPoCosts } = await import(
        '../src/utils/purchaseOrderMath'
      );
      const opalSingles = computePurchaseOrderLine({
        orderAs: 'Singles',
        qty: 5,
        unitsPerCase: 8,
        costEntryMode: 'UNIT_COST',
        enteredPackCost: 3.45,
        enteredLineTotal: 0,
      });
      assert.equal(opalSingles.orderCases, 0);
      assert.equal(opalSingles.orderSingles, 5);
      assert.equal(opalSingles.totalUnits, 5);
      assert.equal(opalSingles.unitCost, 3.45);
      assert.equal(opalSingles.caseCost, 27.6);
      assert.equal(opalSingles.lineTotal, 17.25);

      // Verify Line-Total-First on Singles
      const opalLineTotal = computePurchaseOrderLine({
        orderAs: 'Singles',
        qty: 5,
        unitsPerCase: 8,
        costEntryMode: 'LINE_TOTAL',
        enteredPackCost: 0,
        enteredLineTotal: 17.25,
      });
      assert.equal(opalLineTotal.unitCost, 3.45);
      assert.equal(opalLineTotal.caseCost, 27.6);
      assert.equal(opalLineTotal.lineTotal, 17.25);

      // Verify legacy corrupted catalog item (costPerCase === costPerUnit on 8 u/cs item) self-heals
      const healedCatalog = resolveCatalogPoCosts({
        unitsPerCase: 8,
        costPerUnit: 3.45,
        costPerCase: 3.45,
      });
      assert.equal(healedCatalog.unitCost, 3.45);
      assert.equal(healedCatalog.caseCost, 27.6);

      // Verify 58mm thermal singles line shows [Singles] and omits SKU code & Total Quantity
      const singlesPo: any = {
        ...samplePo,
        poNumber: 'PO-SAIH-20261127-477',
        subtotal: 17.25,
        grandTotal: 17.25,
        totalCases: 0,
        totalUnits: 5,
        lines: [
          {
            lineId: 'POL-OPAL',
            itemId: 'SIMA-0341',
            code: 'SIMA-0341',
            masterDescription: 'Washing Powder Opal 2kg',
            poDescription: 'Washing Powder Opal 2kg',
            orderAs: 'Singles',
            orderCases: 0,
            orderSingles: 5,
            unitsPerCase: 8,
            totalUnits: 5,
            unitCost: 3.45,
            caseCost: 27.6,
            lineTotal: 17.25,
          },
        ],
      };
      const singles58 = buildPurchaseOrderThermal58mmHtml(singlesPo, '58mm');
      assert.ok(singles58.includes('[Singles]'), '58mm singles PO must display [Singles] pack type');
      assert.ok(!singles58.includes('SIMA-0341'), '58mm singles PO must not show SKU code');
      assert.ok(singles58.includes('$17.25'), '58mm singles PO must display $17.25 line total');
      const singlesA4 = buildPurchaseOrderA4Html(singlesPo);
      assert.ok(singlesA4.includes('$3.45/u'), 'A4 singles PO must display unit rate ($3.45/u)');
      assert.ok(singlesA4.includes('$17.25'), 'A4 singles PO must display $17.25 line total');
    },
  },
  {
    name: '11. Local Hub Identity Reconciliation & Synthetic HUB_INFO Guard',
    run: async () => {
      const {
        isSyntheticBranchHubId,
        resolveAuthoritativeHubId,
        reconcileHubIdentityDecision,
      } = await import('../src/services/sync/hubIdentityReconciler');

      // 11a: Synthetic HUB-<branchId> vs cryptographic hardware Hub ID
      assert.equal(isSyntheticBranchHubId('HUB-SAI-HQ-01', 'SAI-HQ-01'), true);
      assert.equal(isSyntheticBranchHubId('HUB-BR-MAIN', 'BR-MAIN'), true);
      assert.equal(isSyntheticBranchHubId('HUB-92B1A869BBC5', 'SAI-HQ-01'), false);

      // 11b: Verified AUTH_OK.hubId must never be overwritten by legacy HUB_INFO.hub_id
      const resolved = resolveAuthoritativeHubId({
        authenticatedHubId: 'HUB-92B1A869BBC5',
        activeHubId: 'HUB-92B1A869BBC5',
        incomingHubInfoId: 'HUB-SAI-HQ-01',
        incomingBranchId: 'SAI-HQ-01',
        activeBranchId: 'BR-MAIN',
        activeBranchCode: 'SAI-HQ-01',
        hasPairedProfileForAuthenticated: true,
      });
      assert.equal(resolved, 'HUB-92B1A869BBC5');

      // 11c: Mutually authenticated Hub matching active tenant or branch alias reconciles without isolation
      const authReconcileAlias = reconcileHubIdentityDecision({
        hubBranchId: 'SAI-HQ-01',
        hubBranchName: 'Headquarters',
        hubTenantId: 'COMP-001',
        activeBranchId: 'BR-MAIN',
        activeTenantId: 'COMP-001',
        isMutuallyAuthenticated: true,
      });
      assert.equal(authReconcileAlias.shouldIsolate, false);
      assert.equal(authReconcileAlias.reconciledBranchId, 'SAI-HQ-01');

      const authReconcileSameTenant = reconcileHubIdentityDecision({
        hubBranchId: 'BR-EAST-02',
        hubBranchName: 'East Branch',
        hubTenantId: 'COMP-001',
        activeBranchId: 'BR-MAIN',
        activeTenantId: 'COMP-001',
        isMutuallyAuthenticated: true,
      });
      assert.equal(authReconcileSameTenant.shouldIsolate, false);
      assert.equal(authReconcileSameTenant.reconciledBranchId, 'BR-EAST-02');

      // 11d: Unauthenticated wrong-branch Hub MUST isolate into Cloud-Only Mode
      const unauthWrongBranch = reconcileHubIdentityDecision({
        hubBranchId: 'BR-OTHER-99',
        hubTenantId: 'COMP-001',
        activeBranchId: 'BR-MAIN',
        activeTenantId: 'COMP-001',
        isMutuallyAuthenticated: false,
      });
      assert.equal(unauthWrongBranch.shouldIsolate, true);

      // 11e: Wrong-branch AND wrong-tenant Hub MUST isolate even if authenticated
      const wrongTenantAndBranch = reconcileHubIdentityDecision({
        hubBranchId: 'BR-FOREIGN-01',
        hubTenantId: 'COMP-999',
        activeBranchId: 'BR-MAIN',
        activeTenantId: 'COMP-001',
        isMutuallyAuthenticated: true,
      });
      assert.equal(wrongTenantAndBranch.shouldIsolate, true);
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
