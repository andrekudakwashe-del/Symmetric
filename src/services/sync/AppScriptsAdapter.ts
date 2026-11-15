import { SyncAdapter, BroadcastResult, CatchUpResult } from './SyncAdapter';
import { SyncEnvelope } from './SyncEnvelope';
import { ENTITY_REGISTRY } from './EntityRegistry';
import { persistentSyncEngine } from '../persistentSyncEngine';
import {
  syncItemToGoogleSheets,
  processSyncQueue,
  fetchProductsFromSheet,
  syncCompanyToCloud,
} from '../googleSheetsSync';
import { registerAppScriptsPausedChecker } from './syncIngestBridge';
import { getCurrentCompany } from '../../db/roomDatabase';
import { SyncQueueItem } from '../../types';

const ENTITY_TO_SHEET: Record<string, string> = {
  sale: 'Sales',
  inventory_item: 'InventoryMaster',
  staff: 'Salespeople',
  branch: 'Branches',
  customer: 'Customers',
  customer_change: 'CustomerChange',
  credit_sale: 'CreditSales',
  credit_group: 'CreditGroups',
  cash_log: 'CashLog',
  cash_lift: 'CashLifts',
  cash_movement: 'CashMovements',
  cash_account: 'CashAccounts',
  cash_transfer: 'CashTransfers',
  direct_grv: 'DirectGRVs',
  goods_received: 'GoodsReceived',
  stock_movement: 'StockMovement',
  expense: 'Expenses',
  internal_consumption: 'InternalConsumption',
  supervisor_approval: 'Audit_Log',
  audit_log: 'Audit_Log',
  reconciliation: 'Reconciliations',
  business_day_closure: 'BusinessDayClosures',
  electronic_settlement: 'ElectronicSettlements',
  cash_count: 'CashCounts',
  admin_sales: 'AdminSales',
  supplier_invoice_voucher: 'SupplierInvoices',
  supplier: 'Suppliers',
  inventory_category: 'Categories',
  stocktake_session: 'StocktakeSessions',
  stocktake_segment: 'StocktakeSegments',
  casual_worker: 'CasualWorkers',
  system_settings: 'Settings',
  multi_currency: 'MultiCurrency',
  permissions_matrix: 'PermissionsMatrix',
  role_configs: 'RoleConfigs',
};

/**
 * Entities NOT automatically enqueued by roomDatabase's enqueueSync() that should be
 * dispatched explicitly when AppScriptsAdapter is active.
 */
const EXPLICIT_DIRECT_CLOUD_ENTITIES = new Set([
  'multi_currency',
  'permissions_matrix',
  'role_configs',
  'system_settings',
]);

export class AppScriptsAdapter implements SyncAdapter {
  readonly name = 'AppScriptsAdapter';

  private paused = false;
  private receiveHandlers: Set<(envelope: SyncEnvelope) => void> = new Set();
  private dispatchedPacketIds: Set<string> = new Set();

  constructor() {
    registerAppScriptsPausedChecker(() => this.isPaused());
  }

  /**
   * Stops outbound pushes and inbound pulls when the Local Hub is active
   * (stopping Ghost Overwrites of staff passwords & config).
   */
  public pause(): void {
    if (!this.paused) {
      this.paused = true;
      persistentSyncEngine.pauseOutboundSync();
      console.log('[AppScriptsAdapter] 🛑 Paused (Local Hub active or HUB_ONLY mode).');
    }
  }

  /**
   * Resumes cloud pushes and pulls when operating in Cloud-Only / Hub-offline mode.
   */
  public resume(): void {
    try {
      const comp = getCurrentCompany();
      if (comp?.sync_strategy === 'HUB_ONLY') {
        this.paused = true;
        persistentSyncEngine.pauseOutboundSync();
        return;
      }
    } catch {}

    if (this.paused) {
      this.paused = false;
      persistentSyncEngine.resumeOutboundSync();
      console.log('[AppScriptsAdapter] 🟢 Resumed (Cloud-Only / Hub disconnected).');
    } else if (persistentSyncEngine.isSyncPaused()) {
      persistentSyncEngine.resumeOutboundSync();
    }
  }

  public isPaused(): boolean {
    try {
      const comp = getCurrentCompany();
      if (comp?.sync_strategy === 'HUB_ONLY') return true;
      if (comp?.sync_strategy === 'CLOUD_ONLY') return false;
    } catch {}
    return this.paused || persistentSyncEngine.isSyncPaused();
  }

  async connect(): Promise<void> {
    if (this.isPaused()) {
      return;
    }
    try {
      await persistentSyncEngine.initialize();
    } catch (err) {
      console.warn('[AppScriptsAdapter] connect initialize warning:', err);
    }
  }

  async disconnect(): Promise<void> {
    this.pause();
  }

  isConnected(): boolean {
    if (this.isPaused()) return false;
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  onReceive(handler: (envelope: SyncEnvelope) => void): () => void {
    this.receiveHandlers.add(handler);
    return () => {
      this.receiveHandlers.delete(handler);
    };
  }

  public emitReceivedEnvelope(envelope: SyncEnvelope): void {
    if (this.isPaused()) return;
    this.receiveHandlers.forEach((fn) => {
      try {
        fn(envelope);
      } catch {}
    });
  }

  async broadcast(envelope: SyncEnvelope): Promise<BroadcastResult> {
    if (this.isPaused()) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'AppScriptsAdapter paused (Local Hub is active)',
      };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'Device offline; queued locally in persistentSyncEngine',
      };
    }

    if (this.dispatchedPacketIds.has(envelope.packetId)) {
      return {
        success: true,
        packetId: envelope.packetId,
      };
    }
    if (this.dispatchedPacketIds.size > 5000) {
      const first = this.dispatchedPacketIds.values().next().value;
      if (first) this.dispatchedPacketIds.delete(first);
    }
    this.dispatchedPacketIds.add(envelope.packetId);

    const spec = ENTITY_REGISTRY[envelope.entityType];
    if (!spec || !spec.requiresBroadcast) {
      return {
        success: true,
        packetId: envelope.packetId,
      };
    }

    const sheetName =
      envelope.meta?.sheetName || ENTITY_TO_SHEET[envelope.entityType] || envelope.entityType;
    const isExplicitDirect =
      EXPLICIT_DIRECT_CLOUD_ENTITIES.has(envelope.entityType) ||
      Boolean(envelope.meta?.forceCloudPush);

    try {
      if (isExplicitDirect) {
        const d: any = envelope.data || {};
        const queueItem: SyncQueueItem = {
          id: envelope.packetId,
          sheetName: sheetName as any,
          action: envelope.action === 'DELETE' ? 'DELETE' : 'UPDATE',
          payload: {
            ...d,
            id: d.id || envelope.entityId,
            entityType: envelope.entityType,
            updatedAt: envelope.updatedAt,
            clientRequestId: envelope.packetId,
            company_id: d.company_id || d.companyId || getCurrentCompany()?.company_id || 'COMP-001',
            branch_id: d.branch_id || d.branchId || envelope.targetBranchId || 'ALL',
          },
          timestamp: envelope.updatedAt || Date.now(),
          retries: 0,
          status: 'pending',
        };
        await syncItemToGoogleSheets(queueItem);
      } else {
        // roomDatabase's enqueueSync() already enqueued T1/T2 items into IndexedDB/localStorage;
        // trigger an immediate non-blocking flush rather than duplicating queue entries.
        processSyncQueue().catch(() => {});
        persistentSyncEngine.drainSyncQueue().catch(() => {});
      }

      return {
        success: true,
        packetId: envelope.packetId,
      };
    } catch (err: any) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: err?.message || String(err),
      };
    }
  }

  async requestCatchUp(_sinceTimestamp: number): Promise<CatchUpResult> {
    if (this.isPaused()) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }

    try {
      await Promise.allSettled([
        persistentSyncEngine.performDeltaSync(),
        fetchProductsFromSheet(),
      ]);
    } catch (err) {
      console.warn('[AppScriptsAdapter] requestCatchUp error:', err);
    }

    return {
      envelopes: [],
      cutoffTimestamp: Date.now(),
    };
  }

  async drainOfflineQueue(): Promise<void> {
    if (this.isPaused()) {
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    try {
      await processSyncQueue();
      await persistentSyncEngine.drainSyncQueue();
    } catch (err) {
      console.warn('[AppScriptsAdapter] drainOfflineQueue error:', err);
    }
  }

  public async pushCompanyProfile(company: any): Promise<void> {
    if (this.isPaused()) return;
    await syncCompanyToCloud(company);
  }
}
