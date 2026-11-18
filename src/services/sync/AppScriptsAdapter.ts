import { SyncAdapter, BroadcastResult, CatchUpResult } from './SyncAdapter';
import { SyncEnvelope, MutationSource } from './SyncEnvelope';
import { ENTITY_REGISTRY } from './EntityRegistry';
import { persistentSyncEngine } from '../persistentSyncEngine';
import { syncCompanyToCloud, refreshCloudJwtToken } from '../googleSheetsSync';
import {
  registerAppScriptsPausedChecker,
  routeCloudRecordThroughSyncCore,
} from './syncIngestBridge';
import { getActiveCloudConfig } from './cloudConfigResolver';
import {
  getCurrentCompany,
  getCurrentBranchId,
  getSessionUser,
  getSheetsConfig,
  getSyncQueue,
  updateSyncQueueItem,
  updateSheetsConfig,
  updateTenantSheetBinding,
  isOfflineModeForced,
  markRecordsCloudSynced,
  parseTimestampMs,
  resolveEntityType,
  annotateSaleCloudReceiptMetadata,
  DEFAULT_MASTER_WEBHOOK_URL,
} from '../../db/roomDatabase';
import { getPendingSyncQueueItems, updateSyncItem } from '../../db/indexedDBService';
import {
  getCloudCatchupSeq,
  setCloudCatchupSeq,
  getLastCloudCatchupTimestamp,
  setLastCloudCatchupTimestamp,
  getTenantAuthToken,
  getRoutingEpoch,
  setRoutingEpoch,
  resetCloudCatchupCursors,
} from './highWaterMarks';
import {
  applyCloudEnvelopeToRoomDb,
  lookupLocalRecordForCloudEnvelope,
} from './cloudEnvelopeIngestor';
import { evaluateSuspiciousBackdate, reportTrustedTimeSample } from '../../utils/clockSecurity';

const ENTITY_TO_SHEET: Record<string, string> = {
  sale: 'Sales',
  inventory_item: 'InventoryMaster',
  staff: 'Staff',
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
  wallet: 'Wallets',
  direct_grv: 'DirectGRVs',
  goods_received: 'GoodsReceived',
  stock_movement: 'StockMovements',
  expense: 'Expenses',
  internal_consumption: 'InternalConsumption',
  supervisor_approval: 'AuditLog',
  audit_log: 'AuditLog',
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
  stocktake_zone_assignment: 'StocktakeZoneAssignments',
  stocktake_zone_claim: 'StocktakeZoneClaims',
  stocktake_count_submission: 'StocktakeBlindVault',
  stocktake_joint_proposal: 'StocktakeJointProposals',
  stocktake_joint_finalized: 'StocktakeJointFinalized',
  stocktake_segment_unlock: 'StocktakeUnlockLog',
  casual_worker: 'CasualWorkers',
  branch_lockdown: 'BranchLockdowns',
  system_settings: 'SystemSettings',
  multi_currency: 'MultiCurrency',
  permissions_matrix: 'PermissionsMatrix',
  role_configs: 'RoleConfigs',
  sheets_config: 'SheetsConfig',
  tombstone: 'Tombstones',
};

export class AppScriptsAdapter implements SyncAdapter {
  readonly name = 'AppScriptsAdapter';
  readonly myDatabaseType = 'appscripts' as const;

  private paused = false;
  private receiveHandlers: Set<(envelope: SyncEnvelope) => void> = new Set();
  private dispatchedPacketIds: Set<string> = new Set();
  private isCatchingUp = false;
  private isDraining = false;
  private backoffUntilMs = 0;
  private backoffReason = '';
  private cloudRelayChecker: (() => boolean) | null = null;
  private cloudReceiptBroadcaster:
    | ((receipt: { postedClientRequestIds?: string[]; postedIds?: string[]; sheetName?: string }) => void)
    | null = null;

  constructor() {
    registerAppScriptsPausedChecker(() => this.isPaused());
  }

  public registerCloudRelayChecker(checker: () => boolean): void {
    this.cloudRelayChecker = checker;
  }

  public registerCloudReceiptBroadcaster(
    broadcaster: (receipt: { postedClientRequestIds?: string[]; postedIds?: string[]; sheetName?: string }) => void
  ): void {
    this.cloudReceiptBroadcaster = broadcaster;
  }

  public isBackoffActive(): boolean {
    return this.backoffUntilMs > Date.now();
  }

  public getBackoffRemainingMs(): number {
    return Math.max(0, this.backoffUntilMs - Date.now());
  }

  public canRelayToCloud(): boolean {
    if (this.isPaused() || this.isBackoffActive()) return false;
    return this.cloudRelayChecker ? this.cloudRelayChecker() : true;
  }

  private applyBackoff(waitMs: number, reason: string): void {
    const bounded = Math.min(300000, Math.max(1000, Number(waitMs) || 3000));
    this.backoffUntilMs = Math.max(this.backoffUntilMs, Date.now() + bounded);
    this.backoffReason = reason;
    console.warn(`[AppScriptsAdapter] ⏳ Cloud backoff active for ${Math.round(bounded / 1000)}s (${reason})`);
  }

  public pause(): void {
    if (!this.paused) {
      this.paused = true;
      persistentSyncEngine.pauseOutboundSync();
      console.log('[AppScriptsAdapter] 🛑 Paused (Local Hub active, HUB_ONLY, or non-appscripts tenant).');
    }
  }

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
    if (isOfflineModeForced()) return false;
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

  private resolveTargetCredentials() {
    const config = getActiveCloudConfig();
    const currentComp = getCurrentCompany();
    const sheetsCfg = getSheetsConfig();
    const targetWebhook = String(
      config.credentials.webhookUrl ||
        config.credentials.url ||
        currentComp.webhook_url ||
        sheetsCfg.webhookUrl ||
        sheetsCfg.masterWebhookUrl ||
        DEFAULT_MASTER_WEBHOOK_URL ||
        ''
    ).trim();
    const targetSheetId = String(
      config.credentials.sheetId ||
        config.credentials.spreadsheetId ||
        currentComp.sheet_id ||
        sheetsCfg.spreadsheetId ||
        ''
    ).trim();
    const companyId = currentComp.company_id || 'COMP-001';
    const branchId = getCurrentBranchId() || 'BR-MAIN';
    const sessionUser = getSessionUser();
    const userRole = String(sessionUser?.role || 'CASHIER').toUpperCase();
    const userBranchId = sessionUser?.branchId || (sessionUser as any)?.branch_id || branchId;

    return {
      config,
      sheetsCfg,
      targetWebhook,
      targetSheetId,
      companyId,
      branchId,
      userRole,
      userBranchId,
      userId: sessionUser?.id || 'SYSTEM',
    };
  }

  private sanitizeEnvelopeForCloud(envelope: SyncEnvelope, companyId: string, branchId: string): SyncEnvelope {
    const rawData: any =
      envelope.data && typeof envelope.data === 'object'
        ? Array.isArray(envelope.data)
          ? [...envelope.data]
          : { ...envelope.data }
        : { value: envelope.data };

    if (rawData && !Array.isArray(rawData)) {
      if ('reversalCashLogs' in rawData) delete rawData.reversalCashLogs;
      if (envelope.entityType === 'staff') {
        if ('pin' in rawData) delete rawData.pin;
        if ('rawPin' in rawData) delete rawData.rawPin;
        if ('password' in rawData) delete rawData.password;
      }
      rawData.company_id = rawData.company_id || rawData.companyId || companyId;
      rawData.branch_id = rawData.branch_id || rawData.branchId || envelope.targetBranchId || branchId || 'ALL';
    }

    const sheetName =
      envelope.meta?.sheetName || ENTITY_TO_SHEET[envelope.entityType] || envelope.entityType;

    return {
      ...envelope,
      data: rawData,
      updatedAt: envelope.updatedAt && envelope.updatedAt > 0 ? envelope.updatedAt : Date.now(),
      version: Number(envelope.version ?? (rawData && !Array.isArray(rawData) ? rawData.version : 1) ?? 1),
      mutationSource: envelope.mutationSource || (rawData && !Array.isArray(rawData) ? rawData.mutationSource : undefined) || 'USER_EDIT',
      targetBranchId: envelope.targetBranchId || (!Array.isArray(rawData) ? rawData.branch_id : undefined) || branchId || 'ALL',
      meta: {
        ...(envelope.meta || {}),
        sheetName,
      },
    };
  }

  private async handleStructuredGasResponse(
    resJson: any,
    creds: ReturnType<AppScriptsAdapter['resolveTargetCredentials']>,
    proxyPath: '/api/sheets/push-envelopes' | '/api/sheets/pull-catchup',
    action: 'push_envelopes' | 'pull_catchup',
    body: Record<string, any>,
    timeoutMs: number,
    allowRetry: boolean
  ): Promise<any> {
    if (!resJson || typeof resJson !== 'object') {
      throw new Error(`Apps Script ${action} invalid response`);
    }

    const code = String(resJson.code || '').toUpperCase().trim();

    if (code === 'ROUTING_EPOCH_STALE') {
      const nextEpoch = Number(resJson.current_routing_epoch || resJson.routing_epoch || 0);
      if (nextEpoch > 0) setRoutingEpoch(creds.companyId, nextEpoch);
      const nextSheetId = String(resJson.spreadsheet_id || resJson.sheet_id || '').trim();
      if (nextSheetId && nextSheetId.length >= 10) {
        updateTenantSheetBinding(creds.companyId, nextSheetId);
      }
      resetCloudCatchupCursors(creds.companyId, creds.branchId);
      await refreshCloudJwtToken(creds.companyId, creds.branchId, creds.userRole, creds.userId).catch(() => null);
      if (allowRetry) {
        return await this.postAppsScriptAction(proxyPath, action, body, timeoutMs, false);
      }
      throw new Error(resJson.error || 'ROUTING_EPOCH_STALE: Sync cursor reset; retry on next cycle.');
    }

    if (code === 'JWT_EXPIRED' || code === 'JWT_INVALID' || code === 'JWT_MISSING') {
      if (allowRetry) {
        const refreshed = await refreshCloudJwtToken(creds.companyId, creds.branchId, creds.userRole, creds.userId).catch(() => ({ success: false }));
        if (refreshed?.success) {
          return await this.postAppsScriptAction(proxyPath, action, body, timeoutMs, false);
        }
      }
      this.applyBackoff(60000, code);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('saimetric_cloud_auth_required', {
            detail: { companyId: creds.companyId, code },
          })
        );
      }
      throw new Error(resJson.error || `${code}: Authentication refresh required`);
    }

    if (
      code === 'RATE_LIMITED' ||
      code === 'TENANT_LOCK_BUSY' ||
      code === 'KILL_SWITCH_ACTIVE' ||
      code === 'TENANT_SUSPENDED'
    ) {
      const baseMs =
        Number(resJson.retryAfterMs) ||
        (code === 'KILL_SWITCH_ACTIVE' || code === 'TENANT_SUSPENDED' ? 300000 : code === 'RATE_LIMITED' ? 15000 : 2500);
      const jitterMs =
        code === 'KILL_SWITCH_ACTIVE' || code === 'TENANT_SUSPENDED'
          ? baseMs
          : baseMs + Math.floor(Math.random() * 1500);
      this.applyBackoff(jitterMs, code);
      throw new Error(resJson.error || `${code}: Backoff scheduled`);
    }

    throw new Error(resJson.error || resJson.message || `Apps Script ${action} rejected`);
  }

  private async postAppsScriptAction(
    proxyPath: '/api/sheets/push-envelopes' | '/api/sheets/pull-catchup',
    action: 'push_envelopes' | 'pull_catchup',
    body: Record<string, any>,
    timeoutMs: number,
    allowRetry: boolean = true
  ): Promise<any> {
    const creds = this.resolveTargetCredentials();
    const { targetWebhook, targetSheetId } = creds;
    if (!targetWebhook || !targetWebhook.startsWith('http')) {
      throw new Error('No Google Apps Script webhook URL configured; record remains queued for retry.');
    }

    const jwtToken = getTenantAuthToken(creds.companyId);
    const routingEpoch = getRoutingEpoch(creds.companyId);

    const payload = {
      ...body,
      action,
      tenant_sheet_id: targetSheetId,
      sheet_id: targetSheetId,
      spreadsheet_id: targetSheetId,
      routing_epoch: routingEpoch,
      ...(jwtToken ? { jwt: jwtToken, token: jwtToken } : {}),
      timestamp: new Date().toISOString(),
    };

    // 1. Try local Express proxy (zero CORS, handles redirects cleanly)
    let proxyUnavailable = false;
    try {
      const srvRes = await fetch(proxyPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
        },
        body: JSON.stringify({ webhook_url: targetWebhook, ...payload }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const srvJson = await srvRes.json().catch(() => null);
      if (srvRes.ok) {
        if (srvJson && srvJson.success !== false && srvJson.status !== 'error' && !(typeof srvJson.httpStatus === 'number' && srvJson.httpStatus >= 400)) {
          return srvJson;
        }
        return await this.handleStructuredGasResponse(srvJson, creds, proxyPath, action, body, timeoutMs, allowRetry);
      }

      if (srvJson && (srvJson.code || srvJson.httpStatus)) {
        return await this.handleStructuredGasResponse(srvJson, creds, proxyPath, action, body, timeoutMs, allowRetry);
      }

      if (srvRes.status === 404 || srvRes.status >= 502) {
        proxyUnavailable = true;
      } else {
        throw new Error(srvJson?.error || `Proxy ${proxyPath} returned HTTP ${srvRes.status}`);
      }
    } catch (proxyErr: any) {
      if (!proxyUnavailable && proxyErr?.name !== 'TypeError' && proxyErr?.name !== 'TimeoutError') {
        throw proxyErr;
      }
      proxyUnavailable = true;
    }

    // 2. Standalone PWA direct fetch to Apps Script (when proxy absent)
    if (proxyUnavailable) {
      const directRes = await fetch(targetWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!directRes.ok) {
        throw new Error(`Google Apps Script ${action} failed with HTTP ${directRes.status}`);
      }

      const directJson = await directRes.json().catch(() => null);
      if (
        directJson &&
        (directJson.success === false ||
          directJson.status === 'error' ||
          (typeof directJson.httpStatus === 'number' && directJson.httpStatus >= 400))
      ) {
        return await this.handleStructuredGasResponse(directJson, creds, proxyPath, action, body, timeoutMs, allowRetry);
      }
      return directJson || { success: true };
    }

    return { success: false };
  }

  private processServerPushResponse(
    envelopes: SyncEnvelope[],
    resData: any,
    companyId: string,
    branchId: string
  ): void {
    const srvTsMs = resData?.server_received_at ? Date.parse(resData.server_received_at) : Date.now();
    if (Number.isFinite(srvTsMs) && srvTsMs > 1_600_000_000_000) {
      reportTrustedTimeSample(srvTsMs, 'CLOUD_SERVER');
    }

    if (typeof resData?.current_routing_epoch === 'number' && resData.current_routing_epoch > getRoutingEpoch(companyId)) {
      setRoutingEpoch(companyId, resData.current_routing_epoch);
    }

    if (typeof resData?.server_seq === 'number' && resData.server_seq > getCloudCatchupSeq(companyId, branchId)) {
      setCloudCatchupSeq(companyId, branchId, resData.server_seq);
    }

    const resultsByPacket = new Map<string, any>();
    if (Array.isArray(resData?.results)) {
      resData.results.forEach((r: any) => {
        if (r?.packetId) resultsByPacket.set(String(r.packetId), r);
      });
    }

    const postedIds: string[] = [];
    const postedClientRequestIds: string[] = [];

    for (const env of envelopes) {
      const d: any = env.data || {};
      const itemRes = resultsByPacket.get(env.packetId);
      const srvReceivedAt = itemRes?.server_received_at || resData?.server_received_at;

      if (env.entityType === 'sale' && env.entityId) {
        const fallbackEval = evaluateSuspiciousBackdate(
          d.date || d.Date,
          d.timestamp || d.Timestamp || env.updatedAt,
          Number.isFinite(srvTsMs) ? srvTsMs : Date.now()
        );
        annotateSaleCloudReceiptMetadata(env.entityId, {
          server_received_at: srvReceivedAt || fallbackEval.server_received_at,
          suspicious_backdate:
            itemRes?.suspicious_backdate !== undefined
              ? Boolean(itemRes.suspicious_backdate)
              : fallbackEval.suspicious_backdate,
        });
      }

      const idList = [
        env.entityId,
        d.id,
        d.itemId,
        d.invoice_id,
        d.grvNumber,
        d.customerId,
        d.creditId,
        d.changeId,
        d.sessionId,
      ]
        .filter(Boolean)
        .map(String);
      const reqList = [env.packetId, d.clientRequestId].filter(Boolean).map(String);
      markRecordsCloudSynced(idList, reqList, env.entityType, false);
      idList.forEach((x) => { if (!postedIds.includes(x)) postedIds.push(x); });
      reqList.forEach((x) => { if (!postedClientRequestIds.includes(x)) postedClientRequestIds.push(x); });
    }

    if ((postedIds.length > 0 || postedClientRequestIds.length > 0) && this.cloudReceiptBroadcaster) {
      try {
        this.cloudReceiptBroadcaster({
          postedClientRequestIds,
          postedIds,
          sheetName: 'SyncEnvelopes',
        });
      } catch {}
    }

    // Apply authoritative cloud conflict winners (T2 LWW / Tombstones / Active Stocktake Session)
    if (Array.isArray(resData?.conflicts) && resData.conflicts.length > 0) {
      for (const conflict of resData.conflicts) {
        if (!conflict || !conflict.entityType || !conflict.entityId) continue;
        const cType = String(conflict.entityType).trim().toLowerCase();
        const spec = ENTITY_REGISTRY[cType];
        const rawMut = String(conflict.mutationSource || '').toUpperCase();
        const cMutSource: MutationSource = rawMut === 'SEED' ? 'SEED' : rawMut === 'USER_EDIT' ? 'USER_EDIT' : 'MIGRATION';
        const conflictEnv: SyncEnvelope = {
          packetId: `GAS-CONFLICT-${cType}-${conflict.entityId}-${conflict.updatedAt || Date.now()}`,
          entityType: cType,
          entityId: String(conflict.entityId),
          action: cType === 'tombstone' ? 'DELETE' : 'UPSERT',
          data: conflict.data,
          updatedAt: Number(conflict.updatedAt || Date.now()),
          version: Number(conflict.version || conflict.data?.version || 1),
          mutationSource: cMutSource,
          originDeviceId: 'APPS_SCRIPT_CLOUD',
          targetBranchId: branchId || 'ALL',
          class: spec ? spec.class : 'T2',
          isCloudSynced: true,
        };
        const existing = lookupLocalRecordForCloudEnvelope(conflictEnv);
        void routeCloudRecordThroughSyncCore(conflictEnv, existing, () => {
          applyCloudEnvelopeToRoomDb(conflictEnv, 'APPS_SCRIPT_CLOUD');
        });
        this.emitReceivedEnvelope(conflictEnv);
      }
    }
  }

  async broadcast(envelope: SyncEnvelope): Promise<BroadcastResult> {
    const creds = this.resolveTargetCredentials();
    if (creds.config.databaseType !== this.myDatabaseType) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: `AppScriptsAdapter disabled: active databaseType is ${creds.config.databaseType}`,
      };
    }

    if (this.isPaused()) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'AppScriptsAdapter paused (Local Hub is active)',
      };
    }

    if (!this.canRelayToCloud()) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: this.isBackoffActive()
          ? `AppScriptsAdapter backoff active (${this.backoffReason || 'RATE_LIMIT'})`
          : 'Non-leader P2P node: cloud upload deferred to elected Relay Leader',
      };
    }

    if (isOfflineModeForced() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      throw new Error('Device offline; Apps Script record retained in offline queue for retry.');
    }

    const spec = ENTITY_REGISTRY[envelope.entityType];
    if (!spec || !spec.requiresBroadcast) {
      return { success: true, packetId: envelope.packetId };
    }

    if (this.dispatchedPacketIds.has(envelope.packetId)) {
      return { success: true, packetId: envelope.packetId };
    }

    // Strict Branch-Level Isolation Check (mirrors legacy syncItemToGoogleSheets guard)
    const targetBranch = String(
      (envelope.data as any)?.branch_id || (envelope.data as any)?.branchId || envelope.targetBranchId || creds.branchId
    ).trim();
    const isCatalogEntity =
      envelope.entityType === 'inventory_item' ||
      envelope.entityType === 'staff' ||
      envelope.entityType === 'branch' ||
      envelope.entityType === 'customer' ||
      envelope.entityType === 'supplier' ||
      envelope.entityType === 'inventory_category' ||
      envelope.entityType === 'credit_group' ||
      envelope.entityType === 'permissions_matrix' ||
      envelope.entityType === 'role_configs' ||
      envelope.entityType === 'multi_currency' ||
      envelope.entityType === 'system_settings' ||
      envelope.entityType === 'sheets_config';

    if (
      !isCatalogEntity &&
      creds.userRole !== 'SUPER_ADMIN' &&
      creds.userRole !== 'OWNER' &&
      creds.userRole !== 'AUDITOR' &&
      targetBranch &&
      targetBranch !== 'ALL' &&
      creds.userBranchId &&
      creds.userBranchId !== 'ALL' &&
      targetBranch.toUpperCase() !== creds.userBranchId.toUpperCase()
    ) {
      throw new Error(
        `BRANCH_SECURITY_VIOLATION: User assigned to branch ${creds.userBranchId} attempted to sync data tagged for branch ${targetBranch}.`
      );
    }

    const cleanEnvelope = this.sanitizeEnvelopeForCloud(envelope, creds.companyId, creds.branchId);
    const resData = await this.postAppsScriptAction(
      '/api/sheets/push-envelopes',
      'push_envelopes',
      {
        envelopes: [cleanEnvelope],
        company_id: creds.companyId,
        branch_id: creds.branchId,
        user_id: creds.userId,
        user_role: creds.userRole,
        user_branch_id: creds.userBranchId,
      },
      15000
    );

    if (Array.isArray(resData?.failed) && resData.failed.length > 0 && !(resData?.ackedPacketIds || []).includes(envelope.packetId)) {
      const firstErr = resData.failed[0]?.error || 'Google Apps Script rejected envelope write';
      this.processServerPushResponse([], resData, creds.companyId, creds.branchId);
      throw new Error(firstErr);
    }

    if (this.dispatchedPacketIds.size > 5000) {
      const first = this.dispatchedPacketIds.values().next().value;
      if (first) this.dispatchedPacketIds.delete(first);
    }
    this.dispatchedPacketIds.add(envelope.packetId);

    envelope.isCloudSynced = true;
    if (envelope.data && typeof envelope.data === 'object') {
      (envelope.data as any).isCloudSynced = true;
    }

    this.processServerPushResponse([cleanEnvelope], resData, creds.companyId, creds.branchId);

    return {
      success: true,
      packetId: envelope.packetId,
    };
  }

  async requestCatchUp(sinceTimestamp: number): Promise<CatchUpResult> {
    const creds = this.resolveTargetCredentials();
    if (creds.config.databaseType !== this.myDatabaseType || !this.canRelayToCloud()) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }
    if (isOfflineModeForced() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }
    if (this.isCatchingUp) {
      return { envelopes: [], cutoffTimestamp: Date.now() };
    }

    this.isCatchingUp = true;
    const pulledEnvelopes: SyncEnvelope[] = [];
    let maxSeq = getCloudCatchupSeq(creds.companyId, creds.branchId);
    const storedTs = getLastCloudCatchupTimestamp(creds.companyId, creds.branchId);
    const isForcedReset = sinceTimestamp === 0;
    const effectiveSinceSeq = isForcedReset ? 0 : maxSeq;
    const effectiveSinceTs = isForcedReset
      ? 0
      : Math.max(Number(sinceTimestamp || 0), storedTs || 0);

    try {
      let cursor: number | null = 0;
      let page = 0;
      const MAX_PAGES = 4;

      while (cursor !== null && page < MAX_PAGES) {
        if (!this.canRelayToCloud()) break;
        const resData = await this.postAppsScriptAction(
          '/api/sheets/pull-catchup',
          'pull_catchup',
          {
            company_id: creds.companyId,
            branch_id: creds.branchId,
            user_role: creds.userRole,
            since_seq: effectiveSinceSeq,
            since_ts: effectiveSinceTs,
            limit: 250,
            cursor,
          },
          28000
        );

        const srvTsMs = resData?.server_received_at ? Date.parse(resData.server_received_at) : Date.now();
        if (Number.isFinite(srvTsMs) && srvTsMs > 1_600_000_000_000) {
          reportTrustedTimeSample(srvTsMs, 'CLOUD_SERVER');
        }

        const rawList = Array.isArray(resData?.envelopes) ? resData.envelopes : [];
        // Always apply tombstones before entity mutations
        rawList.sort((a: any, b: any) => {
          if (a?.entityType === 'tombstone' && b?.entityType !== 'tombstone') return -1;
          if (b?.entityType === 'tombstone' && a?.entityType !== 'tombstone') return 1;
          return (Number(a?.serverSeq || 0) - Number(b?.serverSeq || 0));
        });

        for (const rawEnv of rawList) {
          if (!rawEnv || !rawEnv.entityType) continue;
          const eType = String(rawEnv.entityType).trim().toLowerCase();
          const spec = ENTITY_REGISTRY[eType];
          const rawMut = String(rawEnv.mutationSource || '').toUpperCase();
          const envMutSource: MutationSource = rawMut === 'SEED' ? 'SEED' : rawMut === 'USER_EDIT' ? 'USER_EDIT' : 'MIGRATION';
          const env: SyncEnvelope = {
            packetId: String(rawEnv.packetId || `GAS-PULL-${eType}-${rawEnv.entityId}-${Date.now()}`),
            entityType: eType,
            entityId: String(rawEnv.entityId || ''),
            action: rawEnv.action === 'DELETE' ? 'DELETE' : 'UPSERT',
            data: rawEnv.data,
            updatedAt: parseTimestampMs(rawEnv.updatedAt) || Date.now(),
            version: Number(rawEnv.version || 1),
            mutationSource: envMutSource,
            originDeviceId: rawEnv.originDeviceId || 'APPS_SCRIPT_CLOUD',
            targetBranchId: rawEnv.targetBranchId || creds.branchId || 'ALL',
            class: spec ? spec.class : (rawEnv.class === 'T2' ? 'T2' : 'T1'),
            isCloudSynced: true,
          };

          const existing = lookupLocalRecordForCloudEnvelope(env);
          const ingestRes = await routeCloudRecordThroughSyncCore(env, existing, () => {
            applyCloudEnvelopeToRoomDb(env, 'APPS_SCRIPT_CLOUD');
          });

          if (ingestRes.accepted) {
            this.emitReceivedEnvelope(env);
            pulledEnvelopes.push(env);
          }

          if (typeof rawEnv.serverSeq === 'number' && rawEnv.serverSeq > maxSeq) {
            maxSeq = rawEnv.serverSeq;
          }
        }

        if (typeof resData?.server_seq === 'number' && resData.server_seq > maxSeq) {
          maxSeq = resData.server_seq;
        }

        cursor = resData?.hasMore && resData?.nextCursor !== undefined && resData?.nextCursor !== null
          ? Number(resData.nextCursor)
          : null;
        page++;
      }

      if (maxSeq > 0) {
        setCloudCatchupSeq(creds.companyId, creds.branchId, maxSeq);
      }
      const cutoff = Date.now();
      setLastCloudCatchupTimestamp(creds.companyId, creds.branchId, cutoff);
      updateSheetsConfig({ lastSyncTimestamp: new Date(cutoff).toISOString() });

      // Refresh SaaS tenant context (subscription status / plan) without duplicating operational entity pulls
      await persistentSyncEngine.refreshTenantContext(false).catch(() => {});

      return { envelopes: pulledEnvelopes, cutoffTimestamp: cutoff };
    } catch (err) {
      console.warn('[AppScriptsAdapter] requestCatchUp error:', err);
      return { envelopes: pulledEnvelopes, cutoffTimestamp: Date.now() };
    } finally {
      this.isCatchingUp = false;
    }
  }

  async drainOfflineQueue(): Promise<void> {
    const creds = this.resolveTargetCredentials();
    if (creds.config.databaseType !== this.myDatabaseType || !this.canRelayToCloud()) {
      return;
    }
    if (isOfflineModeForced() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return;
    }
    if (this.isDraining) return;

    this.isDraining = true;
    try {
      // 1. Drain LocalStorage SyncQueueItems via push_envelopes batches
      const lsQueue = getSyncQueue().filter((i) => i.status === 'pending' || i.status === 'failed');
      const BATCH_SIZE = 15;
      for (let i = 0; i < lsQueue.length; i += BATCH_SIZE) {
        if (!this.canRelayToCloud()) break;
        const chunk = lsQueue.slice(i, i + BATCH_SIZE);
        const envelopes: SyncEnvelope[] = [];
        for (const item of chunk) {
          const p = item.payload || {};
          const rawEntity = String(p.entityType || resolveEntityType(item.sheetName) || 'audit_log');
          const eType = ENTITY_REGISTRY[rawEntity] ? rawEntity : 'audit_log';
          const eId = String(
            p.id || p.itemId || p.InvoiceID || p.customerId || p.grvNumber || p.supplierId || p.sessionId || item.id
          );
          updateSyncQueueItem(item.id, { status: 'syncing' });
          const lsMut: MutationSource = p.mutationSource === 'SEED' ? 'SEED' : 'USER_EDIT';
          envelopes.push(
            this.sanitizeEnvelopeForCloud(
              {
                packetId: p.clientRequestId || item.id,
                entityType: eType,
                entityId: eId,
                action: item.action === 'DELETE' ? 'DELETE' : 'UPSERT',
                data: p,
                updatedAt: parseTimestampMs(p.updatedAt) || item.timestamp || Date.now(),
                version: Number(p.version || 1),
                mutationSource: lsMut,
                originDeviceId: 'PWA_OFFLINE_QUEUE',
                targetBranchId: p.branch_id || creds.branchId || 'ALL',
                class: ENTITY_REGISTRY[eType]?.class || 'T1',
              },
              creds.companyId,
              creds.branchId
            )
          );
        }

        try {
          const resData = await this.postAppsScriptAction(
            '/api/sheets/push-envelopes',
            'push_envelopes',
            {
              envelopes,
              company_id: creds.companyId,
              branch_id: creds.branchId,
              user_id: creds.userId,
              user_role: creds.userRole,
              user_branch_id: creds.userBranchId,
            },
            25000
          );
          const ackedSet = new Set<string>(Array.isArray(resData?.ackedPacketIds) ? resData.ackedPacketIds.map(String) : []);
          const failedMap = new Map<string, string>();
          if (Array.isArray(resData?.failed)) {
            resData.failed.forEach((f: any) => {
              if (f?.packetId) failedMap.set(String(f.packetId), String(f.error || 'Sync failed'));
            });
          }

          const ackedEnvelopes: SyncEnvelope[] = [];
          chunk.forEach((item, idx) => {
            const env = envelopes[idx];
            if (ackedSet.has(env.packetId) || (ackedSet.size === 0 && !failedMap.has(env.packetId))) {
              updateSyncQueueItem(item.id, { status: 'synced', error: undefined });
              ackedEnvelopes.push(env);
            } else {
              updateSyncQueueItem(item.id, {
                status: 'failed',
                retries: (item.retries || 0) + 1,
                error: failedMap.get(env.packetId) || 'Cloud write failed',
              });
            }
          });
          if (ackedEnvelopes.length > 0) {
            this.processServerPushResponse(ackedEnvelopes, resData, creds.companyId, creds.branchId);
          }
        } catch (batchErr: any) {
          chunk.forEach((item) => {
            updateSyncQueueItem(item.id, {
              status: 'failed',
              retries: (item.retries || 0) + 1,
              error: batchErr?.message || 'Batch push failed',
            });
          });
        }
      }

      // 2. Drain IndexedDB persistent sync queue items via push_envelopes
      const idbPending = await getPendingSyncQueueItems(Date.now(), creds.companyId);
      const operationalPending = idbPending.filter(
        (it) =>
          it.action !== 'upsert_staff' &&
          it.action !== 'create_branch' &&
          it.action !== 'sync_company'
      );
      const saasControlPending = idbPending.filter(
        (it) =>
          it.action === 'upsert_staff' ||
          it.action === 'create_branch' ||
          it.action === 'sync_company'
      );

      for (let j = 0; j < operationalPending.length; j += BATCH_SIZE) {
        if (!this.canRelayToCloud()) break;
        const chunk = operationalPending.slice(j, j + BATCH_SIZE);
        const envelopes: SyncEnvelope[] = chunk.map((item) => {
          const p = item.payload || {};
          const rawEntity = String(p.entityType || resolveEntityType(item.sheetName || '') || 'audit_log');
          const eType = ENTITY_REGISTRY[rawEntity] ? rawEntity : 'audit_log';
          const eId = String(p.id || p.itemId || p.InvoiceID || p.grvNumber || item.clientRequestId || item.id);
          const idbMut: MutationSource = p.mutationSource === 'SEED' ? 'SEED' : 'USER_EDIT';
          return this.sanitizeEnvelopeForCloud(
            {
              packetId: item.clientRequestId || item.id,
              entityType: eType,
              entityId: eId,
              action: item.action === 'DELETE' ? 'DELETE' : 'UPSERT',
              data: p,
              updatedAt: parseTimestampMs(p.updatedAt || item.createdAt) || Date.now(),
              version: Number(p.version || 1),
              mutationSource: idbMut,
              originDeviceId: 'PWA_IDB_QUEUE',
              targetBranchId: p.branch_id || creds.branchId || 'ALL',
              class: ENTITY_REGISTRY[eType]?.class || 'T1',
            },
            creds.companyId,
            creds.branchId
          );
        });

        try {
          const resData = await this.postAppsScriptAction(
            '/api/sheets/push-envelopes',
            'push_envelopes',
            {
              envelopes,
              company_id: creds.companyId,
              branch_id: creds.branchId,
              user_id: creds.userId,
              user_role: creds.userRole,
              user_branch_id: creds.userBranchId,
            },
            25000
          );
          const ackedSet = new Set<string>(Array.isArray(resData?.ackedPacketIds) ? resData.ackedPacketIds.map(String) : []);
          const ackedEnvelopes: SyncEnvelope[] = [];
          for (let k = 0; k < chunk.length; k++) {
            const item = chunk[k];
            const env = envelopes[k];
            if (ackedSet.has(env.packetId) || ackedSet.size === 0) {
              await updateSyncItem(item.id, { status: 'done', lastError: undefined });
              ackedEnvelopes.push(env);
            }
          }
          if (ackedEnvelopes.length > 0) {
            this.processServerPushResponse(ackedEnvelopes, resData, creds.companyId, creds.branchId);
          }
        } catch (idbErr: any) {
          for (const item of chunk) {
            await updateSyncItem(item.id, {
              status: 'failed',
              retries: (item.retries || 0) + 1,
              lastError: idbErr?.message || 'IDB envelope batch failed',
            });
          }
        }
      }

      if (saasControlPending.length > 0) {
        await persistentSyncEngine.drainSyncQueue(creds.companyId);
      }

      updateSheetsConfig({ lastSyncTimestamp: new Date().toISOString() });
    } catch (err) {
      console.warn('[AppScriptsAdapter] drainOfflineQueue error:', err);
    } finally {
      this.isDraining = false;
    }
  }

  public async pushCompanyProfile(company: any): Promise<void> {
    const creds = this.resolveTargetCredentials();
    if (creds.config.databaseType !== this.myDatabaseType || this.isPaused()) return;
    await syncCompanyToCloud(company);
  }
}
