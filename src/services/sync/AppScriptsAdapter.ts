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
import { getActiveCloudConfig } from './cloudConfigResolver';
import { getCurrentCompany, markRecordsCloudSynced } from '../../db/roomDatabase';
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

export class AppScriptsAdapter implements SyncAdapter {
  readonly name = 'AppScriptsAdapter';
  readonly myDatabaseType = 'appscripts' as const;

  private paused = false;
  private receiveHandlers: Set<(envelope: SyncEnvelope) => void> = new Set();
  private dispatchedPacketIds: Set<string> = new Set();

  constructor() {
    registerAppScriptsPausedChecker(() => this.isPaused());
  }

  /**
   * Stops outbound pushes and inbound pulls when the Local Hub is active
   * OR when active databaseType is not 'appscripts' (preventing Ghost Overwrites & Dual-Racing).
   */
  public pause(): void {
    if (!this.paused) {
      this.paused = true;
      persistentSyncEngine.pauseOutboundSync();
      console.log('[AppScriptsAdapter] 🛑 Paused (Local Hub active, HUB_ONLY, or non-appscripts tenant).');
    }
  }

  /**
   * Resumes cloud pushes and pulls ONLY when active databaseType === 'appscripts'
   * and operating in Cloud-Only / Hub-offline mode.
   */
  public resume(): void {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || cfg.strategy === 'HUB_ONLY') {
      this.paused = true;
      persistentSyncEngine.pauseOutboundSync();
      return;
    }

    if (this.paused) {
      this.paused = false;
      persistentSyncEngine.resumeOutboundSync();
      console.log('[AppScriptsAdapter] 🟢 Resumed (Single Active Cloud Adapter: appscripts).');
    } else if (persistentSyncEngine.isSyncPaused()) {
      persistentSyncEngine.resumeOutboundSync();
    }
  }

  public isPaused(): boolean {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType) {
      return true;
    }
    if (cfg.strategy === 'HUB_ONLY') {
      return true;
    }
    if (cfg.strategy === 'CLOUD_ONLY') {
      return false;
    }
    return this.paused || persistentSyncEngine.isSyncPaused();
  }

  async connect(): Promise<void> {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || this.isPaused()) {
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
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || this.isPaused()) return false;
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  onReceive(handler: (envelope: SyncEnvelope) => void): () => void {
    this.receiveHandlers.add(handler);
    return () => {
      this.receiveHandlers.delete(handler);
    };
  }

  public emitReceivedEnvelope(envelope: SyncEnvelope): void {
    const cfg = getActiveCloudConfig();
    if (cfg.databaseType !== this.myDatabaseType || this.isPaused()) return;
    this.receiveHandlers.forEach((fn) => {
      try {
        fn(envelope);
      } catch {}
    });
  }

  async broadcast(envelope: SyncEnvelope): Promise<BroadcastResult> {
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: `AppScriptsAdapter disabled: active databaseType is ${config.databaseType}`,
      };
    }

    if (this.isPaused()) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'AppScriptsAdapter paused (Local Hub is active)',
      };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Device offline; Apps Script record retained in offline queue for retry.');
    }

    const spec = ENTITY_REGISTRY[envelope.entityType];
    if (!spec || !spec.requiresBroadcast) {
      return {
        success: true,
        packetId: envelope.packetId,
      };
    }

    if (this.dispatchedPacketIds.has(envelope.packetId)) {
      return {
        success: true,
        packetId: envelope.packetId,
      };
    }

    const sheetName =
      envelope.meta?.sheetName || ENTITY_TO_SHEET[envelope.entityType] || envelope.entityType;
    const rawData: any =
      envelope.data && typeof envelope.data === 'object' ? { ...envelope.data } : { value: envelope.data };
    if (rawData && typeof rawData === 'object' && 'reversalCashLogs' in rawData) {
      delete rawData.reversalCashLogs;
    }
    const d = rawData;
    const queueItem: SyncQueueItem = {
      id: envelope.packetId,
      sheetName: sheetName as any,
      action: envelope.action === 'DELETE' ? 'DELETE' : 'UPDATE',
      payload: {
        ...d,
        id: d.id || envelope.entityId,
        entityType: envelope.entityType,
        updatedAt: envelope.updatedAt,
        clientRequestId: d.clientRequestId || envelope.packetId,
        company_id: d.company_id || d.companyId || getCurrentCompany()?.company_id || 'COMP-001',
        branch_id: d.branch_id || d.branchId || envelope.targetBranchId || 'ALL',
      },
      timestamp: envelope.updatedAt || Date.now(),
      retries: 0,
      status: 'pending',
    };

    // True Cloud ACK Confirmation: await the actual HTTP request and verify 200/201 response.
    // Do NOT fire-and-forget or return { success: true } blindly.
    const confirmed = await syncItemToGoogleSheets(queueItem);
    if (!confirmed) {
      throw new Error(
        `AppScripts sync failed without HTTP 200/201 confirmation for ${envelope.entityType}:${envelope.entityId}`
      );
    }

    if (this.dispatchedPacketIds.size > 5000) {
      const first = this.dispatchedPacketIds.values().next().value;
      if (first) this.dispatchedPacketIds.delete(first);
    }
    this.dispatchedPacketIds.add(envelope.packetId);

    // ONLY confirm isCloudSynced = true after verified HTTP 200/201 confirmation
    envelope.isCloudSynced = true;
    if (envelope.data && typeof envelope.data === 'object') {
      (envelope.data as any).isCloudSynced = true;
    }

    const idList = [
      envelope.entityId,
      d.id,
      d.itemId,
      d.invoice_id,
      d.grvNumber,
      d.customerId,
      d.creditId,
      d.changeId,
    ]
      .filter(Boolean)
      .map(String);
    const reqList = [envelope.packetId, d.clientRequestId].filter(Boolean).map(String);
    markRecordsCloudSynced(idList, reqList, envelope.entityType, false);

    return {
      success: true,
      packetId: envelope.packetId,
    };
  }

  async requestCatchUp(_sinceTimestamp: number): Promise<CatchUpResult> {
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType || this.isPaused()) {
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
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType || this.isPaused()) {
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
    const config = getActiveCloudConfig();
    if (config.databaseType !== this.myDatabaseType || this.isPaused()) return;
    await syncCompanyToCloud(company);
  }
}
