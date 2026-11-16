import { SyncAdapter, BroadcastResult, CatchUpResult } from './SyncAdapter';
import { SyncEnvelope, SyncAction } from './SyncEnvelope';
import { ENTITY_REGISTRY } from './EntityRegistry';
import { LocalHubConfig, normalizeHubUrl } from '../../utils/localHubConfig';

const PENDING_QUEUE_STORAGE_KEY = 'saimetric_pending_local_hub_queue';

export interface LocalHubContext {
  companyId: string;
  branchId: string;
  branchCode: string;
  deviceId: string;
  deviceName: string;
  hubBranchId: string | null;
  isCloudOnlyMode: boolean;
  isIngestingFromHub: boolean;
}

const CONTROL_PACKET_TYPES = new Set([
  'HUB_INFO',
  'RESET_CONFIRMED',
  'DRAIN_COMPLETE_ACK',
  'SYNC_ACK',
  'T1_CLOUD_SYNC_ACK',
  'INVENTORY_SNAPSHOT_RESPONSE',
  'HISTORICAL_T1_RESPONSE',
  'FINANCIAL_REPORT_RESPONSE',
  'RECON_SWEEP_TRIGGER',
  'SYNC_SNAPSHOT_REQUEST',
  'SYNC_ID_DIGEST_REQUEST',
  'RECON_BACKFILL_PAYLOAD',
  'RECON_PUSH_BACKFILL_REQUEST',
  'HUB_CLOUD_BROADCAST',
  'CATCHUP_REQUEST',
  'CATCHUP_RESPONSE',
  'PING',
  'HEARTBEAT',
  'PONG',
]);

export class LocalHubAdapter implements SyncAdapter {
  readonly name = 'LocalHubAdapter';

  private ws: WebSocket | null = null;
  private context: LocalHubContext = {
    companyId: 'COMP-001',
    branchId: 'BR-MAIN',
    branchCode: 'HQ-01',
    deviceId: 'DEV-UNKNOWN',
    deviceName: 'Terminal',
    hubBranchId: null,
    isCloudOnlyMode: false,
    isIngestingFromHub: false,
  };

  private pendingQueue: any[] = [];
  private receiveHandlers: Set<(envelope: SyncEnvelope) => void> = new Set();

  // Lifecycle callbacks consumed by MeshSyncManager
  public onOpenCallback: ((url: string) => void) | null = null;
  public onCloseCallback: ((reason: string) => void) | null = null;
  public onErrorCallback: ((err: any, url: string) => void) | null = null;
  public onControlPacketCallback: ((pType: string, packet: any) => void) | null = null;
  public onPacketsCallback: ((packets: any[]) => void) | null = null;

  constructor() {
    this.pendingQueue = this.loadPendingQueue();
  }

  public setContext(partial: Partial<LocalHubContext>): void {
    this.context = { ...this.context, ...partial };
  }

  public getContext(): LocalHubContext {
    return this.context;
  }

  // ==================== WEBSOCKET TRANSPORT (EXCLUSIVE OWNER) ====================

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public isConnecting(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.CONNECTING;
  }

  public hasActiveOrConnectingSocket(): boolean {
    return this.isConnected() || this.isConnecting();
  }

  public async connect(customUrl?: string): Promise<void> {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        return; // Never tear down an active or handshaking socket
      }
      this.cleanupSocket(true);
    }

    const hubUrl = customUrl ? normalizeHubUrl(customUrl) : LocalHubConfig.getLocalHubUrl();
    if (!hubUrl) return;

    try {
      const ws = new WebSocket(hubUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.onOpenCallback?.(hubUrl);
      };

      ws.onmessage = async (event) => {
        if (this.ws !== ws) return;
        try {
          if (!event.data) return;
          let rawData: any = event.data;
          if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
            rawData = await rawData.text();
          } else if (typeof ArrayBuffer !== 'undefined' && rawData instanceof ArrayBuffer) {
            rawData = new TextDecoder().decode(rawData);
          }
          if (typeof rawData !== 'string') return;

          const parsed = JSON.parse(rawData);
          if (!parsed) return;

          // Single control-packet intercept (HUB_INFO, RESET_CONFIRMED, SYNC_ACK, RECON_*, etc.)
          if (!Array.isArray(parsed) && typeof parsed === 'object') {
            const pType = String(parsed.type || parsed.action || '').toUpperCase();
            if (
              pType === 'HUB_INFO' ||
              pType === 'RESET_CONFIRMED' ||
              pType === 'DRAIN_COMPLETE_ACK' ||
              pType === 'SYNC_ACK' ||
              pType === 'RECON_SWEEP_TRIGGER' ||
              pType === 'SYNC_SNAPSHOT_REQUEST' ||
              pType === 'SYNC_ID_DIGEST_REQUEST' ||
              pType === 'RECON_BACKFILL_PAYLOAD' ||
              pType === 'RECON_PUSH_BACKFILL_REQUEST' ||
              pType === 'HUB_CLOUD_BROADCAST' ||
              pType === 'SYNC_CLOUD_CONFIG_ACK'
            ) {
              this.onControlPacketCallback?.(pType, parsed);
              return;
            }
          }

          let batch: any[] = [];
          if (Array.isArray(parsed)) {
            batch = parsed;
          } else if (typeof parsed === 'object') {
            if (Array.isArray(parsed.packets)) {
              batch = parsed.packets;
            } else if (Array.isArray(parsed.history)) {
              batch = parsed.history;
            } else {
              batch = [parsed];
            }
          }

          if (batch.length > 0) {
            // Emit converted SyncEnvelopes to SyncAdapter.onReceive subscribers
            if (this.receiveHandlers.size > 0) {
              for (const pkt of batch) {
                const env = this.packetToEnvelope(pkt);
                if (env) {
                  this.receiveHandlers.forEach((fn) => {
                    try {
                      fn(env);
                    } catch {}
                  });
                }
              }
            }
            this.onPacketsCallback?.(batch);
          }
        } catch (err) {
          console.warn('[LocalHubAdapter] Error parsing incoming hub message:', err);
        }
      };

      ws.onerror = (err) => {
        if (this.ws !== ws) return;
        console.warn(`[LocalHubAdapter] WebSocket error at ${hubUrl}:`, err);
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          this.cleanupSocket(false);
          this.onErrorCallback?.(err, hubUrl);
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.cleanupSocket(false);
        this.onCloseCallback?.('Local Hub WebSocket closed');
      };
    } catch (err: any) {
      this.cleanupSocket(false);
      this.onErrorCallback?.(err, hubUrl);
    }
  }

  public async disconnect(intentional: boolean = true): Promise<void> {
    this.cleanupSocket(true);
    if (!intentional) {
      this.onCloseCallback?.('LocalHubAdapter disconnect');
    }
  }

  private cleanupSocket(nullifyHandlers: boolean): void {
    if (!this.ws) return;
    try {
      if (nullifyHandlers) {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
      }
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
    } catch {}
    this.ws = null;
  }

  // ==================== CONTROL & ENVELOPE TRANSMISSION ====================

  /**
   * Sends non-entity control/handshake/recon frames directly over the WebSocket.
   */
  public sendControlPacket(packet: any): boolean {
    if (!this.isConnected() || !this.ws) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(packet));
      return true;
    } catch (err) {
      console.warn('[LocalHubAdapter] Error sending control packet:', err);
      return false;
    }
  }

  /**
   * Sends a wire packet or queues it locally for replay when Hub reconnects.
   */
  public sendRawWirePacket(wirePacket: any, queueIfOffline: boolean = true): boolean {
    if (!wirePacket) return false;
    if (this.isConnected() && this.ws) {
      try {
        this.ws.send(JSON.stringify(wirePacket));
        return true;
      } catch {
        if (queueIfOffline) this.queueOutgoingPacket(wirePacket);
        return false;
      }
    }
    if (queueIfOffline) {
      this.queueOutgoingPacket(wirePacket);
    }
    return false;
  }

  async broadcast(envelope: SyncEnvelope): Promise<BroadcastResult> {
    const isReconPush = Boolean(envelope.meta?.isReconPush);
    if (this.context.isIngestingFromHub && !isReconPush) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'INGEST_GUARD_ACTIVE',
      };
    }

    const wirePacket = this.envelopeToWirePacket(envelope);
    const topicSuffix = String(envelope.meta?.topicSuffix || envelope.entityType || '').toLowerCase();

    const isMaintenance =
      topicSuffix === 'heartbeat' ||
      topicSuffix === 'ping' ||
      wirePacket.type === 'heartbeat' ||
      wirePacket.type === 'ping' ||
      wirePacket.action === 'HEARTBEAT' ||
      wirePacket.action === 'PING';

    if (isMaintenance) {
      return {
        success: true,
        packetId: envelope.packetId,
      };
    }

    const targetBranch = String(
      wirePacket.target_branch_id ||
      wirePacket.branchId ||
      wirePacket.branch_id ||
      envelope.targetBranchId ||
      ''
    )
      .trim()
      .toUpperCase();

    const isCatalogPacket = this.isCatalogOrCompanyWirePacket(wirePacket, topicSuffix, targetBranch);
    const isStocktakePacket =
      topicSuffix.startsWith('stocktake') ||
      (typeof wirePacket.type === 'string' && wirePacket.type.startsWith('STOCKTAKE_')) ||
      (typeof wirePacket.action === 'string' && wirePacket.action.startsWith('STOCKTAKE_'));

    const hubBranch = this.context.hubBranchId;
    const isBranchMismatch =
      !isCatalogPacket &&
      !isStocktakePacket &&
      Boolean(hubBranch) &&
      hubBranch !== 'UNASSIGNED' &&
      Boolean(targetBranch) &&
      targetBranch !== hubBranch!.toUpperCase() &&
      targetBranch !== 'ALL';

    if (this.context.isCloudOnlyMode || isBranchMismatch) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: this.context.isCloudOnlyMode ? 'CLOUD_ONLY_MODE' : 'BRANCH_MISMATCH',
      };
    }

    const sent = this.sendRawWirePacket(wirePacket, true);
    if (!sent) {
      return {
        success: false,
        packetId: envelope.packetId,
        error: 'Local Hub WebSocket offline; packet queued for Hub drain',
      };
    }

    return {
      success: true,
      packetId: envelope.packetId,
    };
  }

  onReceive(handler: (envelope: SyncEnvelope) => void): () => void {
    this.receiveHandlers.add(handler);
    return () => {
      this.receiveHandlers.delete(handler);
    };
  }

  async requestCatchUp(sinceTimestamp: number): Promise<CatchUpResult> {
    const sinceIso = sinceTimestamp > 0 ? new Date(sinceTimestamp).toISOString() : '0';
    this.sendControlPacket({
      type: 'catchup_request',
      action: 'CATCHUP_REQUEST',
      packet_id: `CRQ-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      companyId: this.context.companyId,
      branchId: this.context.branchId,
      branchCode: this.context.branchCode,
      originDeviceId: this.context.deviceId,
      originDeviceName: this.context.deviceName,
      targetDeviceId: 'ALL',
      sinceTimestamp: sinceIso,
      includeInventory: true,
      timestamp: Date.now(),
      ttl: 5,
    });
    return {
      envelopes: [],
      cutoffTimestamp: Date.now(),
    };
  }

  // ==================== OFFLINE PENDING QUEUE ====================

  public getPendingQueue(): any[] {
    return this.pendingQueue;
  }

  public getPendingQueueLength(): number {
    return this.pendingQueue.length;
  }

  public queueOutgoingPacket(packet: any): void {
    if (!packet || this.context.isIngestingFromHub) return;

    if (
      packet.type === 'heartbeat' ||
      packet.type === 'ping' ||
      packet.type === 'catchup_request' ||
      packet.type === 'catchup_response' ||
      packet.action === 'HEARTBEAT' ||
      packet.action === 'PING' ||
      packet.action === 'CATCHUP_REQUEST' ||
      packet.action === 'CATCHUP_RESPONSE'
    ) {
      return;
    }

    if (
      packet.fromMesh ||
      packet.isOfflineCatchup ||
      (packet.item && packet.item.fromMesh) ||
      (packet.payload && packet.payload.fromMesh)
    ) {
      return;
    }

    const pktKind = String(packet.type || packet.action || 'PKT').trim().toUpperCase();
    const rawItemId =
      packet.entityId ||
      (packet.tombstone && (packet.tombstone.entityId || packet.tombstone.id)) ||
      packet.itemId ||
      (packet.item && (packet.item.itemId || packet.item.id)) ||
      (packet.staff && packet.staff.id) ||
      (packet.branch && (packet.branch.branchId || packet.branch.id)) ||
      (packet.customer && (packet.customer.customerId || packet.customer.id)) ||
      (packet.payload &&
        (packet.payload.entityId ||
          packet.payload.itemId ||
          packet.payload.id ||
          packet.payload.branchId ||
          packet.payload.customerId)) ||
      (pktKind === 'PERMISSIONS_MATRIX_SYNC' ||
      pktKind === 'ROLE_CONFIGS_SYNC' ||
      pktKind === 'MULTI_CURRENCY_SYNC' ||
      pktKind === 'EXCHANGE_RATES_SYNC'
        ? 'SINGLETON'
        : undefined);

    if (pktKind === 'TOMBSTONE_SYNC' && rawItemId) {
      this.removeQueuedPacketsByEntityId(String(rawItemId));
    }

    if (rawItemId) {
      const cleanKey = `${pktKind}:${String(rawItemId).trim().toUpperCase()}`;
      const existingIdx = this.pendingQueue.findIndex((p) => {
        const pKind = String(p.type || p.action || 'PKT').trim().toUpperCase();
        const pItemId =
          p.entityId ||
          (p.tombstone && (p.tombstone.entityId || p.tombstone.id)) ||
          p.itemId ||
          (p.item && (p.item.itemId || p.item.id)) ||
          (p.staff && p.staff.id) ||
          (p.branch && (p.branch.branchId || p.branch.id)) ||
          (p.customer && (p.customer.customerId || p.customer.id)) ||
          (p.payload &&
            (p.payload.entityId ||
              p.payload.itemId ||
              p.payload.id ||
              p.payload.branchId ||
              p.payload.customerId)) ||
          (pKind === 'PERMISSIONS_MATRIX_SYNC' ||
          pKind === 'ROLE_CONFIGS_SYNC' ||
          pKind === 'MULTI_CURRENCY_SYNC' ||
          pKind === 'EXCHANGE_RATES_SYNC'
            ? 'SINGLETON'
            : undefined);
        return pItemId && `${pKind}:${String(pItemId).trim().toUpperCase()}` === cleanKey;
      });
      if (existingIdx >= 0) {
        this.pendingQueue[existingIdx] = packet;
        this.savePendingQueue();
        return;
      }
    }

    if (this.pendingQueue.length > 100) {
      this.pendingQueue.shift();
    }
    this.pendingQueue.push(packet);
    this.savePendingQueue();
  }

  public removeQueuedPacketsByEntityId(entityId: string): number {
    if (!entityId) return 0;
    const cleanTargetId = String(entityId).trim().toUpperCase();
    const initialLen = this.pendingQueue.length;
    this.pendingQueue = this.pendingQueue.filter((p) => {
      const pItemId =
        p.recordId ||
        p.entityId ||
        p.itemId ||
        p.id ||
        p.branchId ||
        p.branch_id ||
        p.sessionId ||
        (p.type === 'MULTI_CURRENCY_SYNC' ||
        p.type === 'EXCHANGE_RATES_SYNC' ||
        p.action === 'MULTI_CURRENCY_SYNC'
          ? 'MULTI_CURRENCY_CONFIG'
          : undefined) ||
        (p.tombstone && (p.tombstone.entityId || p.tombstone.id)) ||
        (p.item && (p.item.itemId || p.item.id)) ||
        (p.branch && (p.branch.branchId || p.branch.id || p.branch.branch_id || p.branch.recordId)) ||
        (p.staff && (p.staff.id || p.staff.staffId || p.staff.recordId)) ||
        (p.customer && (p.customer.customerId || p.customer.id || p.customer.recordId)) ||
        (p.cashAccount &&
          (p.cashAccount.account_id || p.cashAccount.id || p.cashAccount.recordId)) ||
        (p.payload &&
          (p.payload.recordId ||
            p.payload.entityId ||
            p.payload.itemId ||
            p.payload.id ||
            p.payload.branchId ||
            p.payload.branch_id ||
            p.payload.customerId ||
            p.payload.account_id ||
            p.payload.sessionId));

      const matches = pItemId && String(pItemId).trim().toUpperCase() === cleanTargetId;
      return !matches;
    });

    const removed = initialLen - this.pendingQueue.length;
    if (removed > 0) {
      this.savePendingQueue();
    }
    return removed;
  }

  public drainMatchedPendingPackets(hubBranchId: string): {
    flushedCount: number;
    pausedForeignCount: number;
  } {
    if (!this.isConnected() || !this.ws || !hubBranchId || hubBranchId === 'UNASSIGNED') {
      return { flushedCount: 0, pausedForeignCount: 0 };
    }
    if (this.pendingQueue.length === 0) {
      return { flushedCount: 0, pausedForeignCount: 0 };
    }

    const matchingPackets: any[] = [];
    const pausedPackets: any[] = [];
    const upperHubBranch = hubBranchId.trim().toUpperCase();

    for (const p of this.pendingQueue) {
      const targetBr = String(
        p.target_branch_id ||
        p.branchId ||
        p.branch_id ||
        (p.payload && (p.payload.branch_id || p.payload.branchId)) ||
        ''
      )
        .trim()
        .toUpperCase();

      const isCatalog = this.isCatalogOrCompanyWirePacket(p, '', targetBr);

      if (isCatalog || targetBr === upperHubBranch || !targetBr) {
        matchingPackets.push(p);
      } else {
        pausedPackets.push(p);
      }
    }

    this.pendingQueue = pausedPackets;
    this.savePendingQueue();

    let flushedCount = 0;
    for (const queuedPacket of matchingPackets) {
      try {
        this.ws.send(JSON.stringify(queuedPacket));
        flushedCount++;
      } catch {
        this.pendingQueue.push(queuedPacket);
      }
    }
    if (flushedCount < matchingPackets.length) {
      this.savePendingQueue();
    }

    return { flushedCount, pausedForeignCount: pausedPackets.length };
  }

  async drainOfflineQueue(): Promise<void> {
    if (!this.isConnected() || this.context.isCloudOnlyMode) return;
    const hubBranch = this.context.hubBranchId;
    if (!hubBranch || hubBranch === 'UNASSIGNED') return;
    this.drainMatchedPendingPackets(hubBranch);
  }

  private loadPendingQueue(): any[] {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(PENDING_QUEUE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.filter(
              (p) =>
                p &&
                !p.fromMesh &&
                !p.isOfflineCatchup &&
                !(p.item && p.item.fromMesh) &&
                !(p.payload && p.payload.fromMesh)
            );
          }
        }
      }
    } catch {}
    return [];
  }

  private savePendingQueue(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          PENDING_QUEUE_STORAGE_KEY,
          JSON.stringify(this.pendingQueue.slice(-100))
        );
      }
    } catch {}
  }

  // ==================== WIRE CONVERSION (ENVELOPE <-> TERMUX HUB) ====================

  public envelopeToWirePacket(envelope: SyncEnvelope): any {
    const ctx = this.context;
    const rawData: any = envelope.data || {};
    const isCloudSynced = Boolean(
      envelope.isCloudSynced === true || rawData?.isCloudSynced === true
    );
    const d: any =
      isCloudSynced && rawData && typeof rawData === 'object' && !Array.isArray(rawData)
        ? { ...rawData, isCloudSynced: true }
        : rawData;
    const meta: any = envelope.meta || {};
    const base = {
      packet_id: envelope.packetId,
      packetId: envelope.packetId,
      entityType: envelope.entityType,
      entityId: envelope.entityId,
      companyId: d.company_id || d.companyId || ctx.companyId,
      company_id: d.company_id || d.companyId || ctx.companyId,
      branchId: envelope.targetBranchId || d.branch_id || d.branchId || ctx.branchId,
      branch_id: envelope.targetBranchId || d.branch_id || d.branchId || ctx.branchId,
      target_branch_id: envelope.targetBranchId || ctx.branchId,
      branchCode: ctx.branchCode,
      deviceId: ctx.deviceId,
      originDeviceId: envelope.originDeviceId || ctx.deviceId,
      origin_device_id: envelope.originDeviceId || ctx.deviceId,
      originDeviceName: ctx.deviceName,
      origin_device_name: ctx.deviceName,
      updatedAt: envelope.updatedAt,
      timestamp: envelope.updatedAt || Date.now(),
      isReconPush: Boolean(meta.isReconPush),
      ...(isCloudSynced ? { isCloudSynced: true } : {}),
      ttl: 5,
    };

    switch (envelope.entityType) {
      case 'sale':
        return {
          ...base,
          type: 'sale',
          action: meta.wireAction || (envelope.action === 'UPSERT' ? 'SALE_UPDATE' : 'SALE_RECORD'),
          sale: d,
          payload: d,
        };

      case 'inventory_item': {
        const cleanId = envelope.entityId || d.itemId || d.id || '';
        const now = envelope.updatedAt || Date.now();
        const nowIso = d.lastUpdated || new Date(now).toISOString();
        const enriched = {
          ...d,
          totalUnits: Number(d.totalUnits || 0),
          stockSingles: Number(d.stockSingles !== undefined ? d.stockSingles : d.totalUnits || 0),
          snapshotTimestamp: now,
          updatedAt: now,
          hubTimestamp: now,
          lastUpdated: nowIso,
        };
        return {
          ...base,
          type: 'INVENTORY_ITEM',
          action: 'INVENTORY_UPDATE',
          branchId: 'ALL',
          branch_id: 'ALL',
          target_branch_id: 'ALL',
          itemId: cleanId,
          itemName: d.itemName,
          sellPriceUnit: d.sellPriceUnit,
          sellPriceCase: d.sellPriceCase,
          costPerUnit: d.costPerUnit,
          costPerCase: d.costPerCase,
          unitsPerCase: d.unitsPerCase,
          canSellAsCase: Boolean(d.canSellAsCase),
          stockCases: d.stockCases,
          stockSingles: enriched.stockSingles,
          totalUnits: enriched.totalUnits,
          snapshotTimestamp: now,
          category: d.category,
          sku: d.sku,
          barcode: d.barcode,
          packagingVariants: d.packagingVariants || [],
          branchOverrides: d.branchOverrides,
          item: enriched,
          payload: enriched,
          hubTimestamp: now,
          lastUpdated: nowIso,
        };
      }

      case 'staff': {
        const effectiveHash = d.pin_hash || '';
        const effectivePassword = d.password || effectiveHash || '';
        return {
          ...base,
          type: 'staff',
          action: 'STAFF_SYNC',
          target_branch_id: 'ALL',
          staff: d,
          payload: d,
          password: effectivePassword,
          pin_hash: effectiveHash,
        };
      }

      case 'permissions_matrix': {
        const rules = Array.isArray(d.rules) ? d.rules : Array.isArray(d) ? d : [];
        return {
          ...base,
          type: 'PERMISSIONS_MATRIX_SYNC',
          action: 'PERMISSIONS_MATRIX_SYNC',
          target_branch_id: 'ALL',
          rules,
          permissionsMatrix: { rules, updatedAt: envelope.updatedAt },
          payload: { rules, updatedAt: envelope.updatedAt },
        };
      }

      case 'role_configs': {
        const definitions = d.definitions || d;
        return {
          ...base,
          type: 'ROLE_CONFIGS_SYNC',
          action: 'ROLE_CONFIGS_SYNC',
          target_branch_id: 'ALL',
          definitions,
          roleConfigs: { definitions, updatedAt: envelope.updatedAt },
          payload: { definitions, updatedAt: envelope.updatedAt },
        };
      }

      case 'multi_currency':
        return {
          ...base,
          type: 'MULTI_CURRENCY_SYNC',
          action: 'MULTI_CURRENCY_SYNC',
          entityType: 'multi_currency',
          recordId: 'MULTI_CURRENCY_CONFIG',
          target_branch_id: 'ALL',
          multiCurrencyConfig: d,
          exchangeRates: d,
          payload: d,
        };

      case 'customer':
        return {
          ...base,
          type: 'customer',
          action: 'CUSTOMER_SYNC',
          target_branch_id: envelope.targetBranchId || 'ALL',
          customer: d,
          payload: d,
        };

      case 'customer_change':
        return {
          ...base,
          type: 'customer_change',
          action: 'CUSTOMER_CHANGE_RECORD',
          change: d,
          payload: d,
        };

      case 'credit_sale':
        return {
          ...base,
          type: 'credit_sale',
          action: 'CREDIT_SALE_RECORD',
          credit: d,
          payload: d,
        };

      case 'credit_group':
        return {
          ...base,
          type: 'credit_group',
          action: 'CREDIT_GROUP_SYNC',
          group: d,
          payload: d,
        };

      case 'expense':
        return {
          ...base,
          type: 'expense',
          action: 'EXPENSE_RECORD',
          expense: d,
          payload: d,
        };

      case 'direct_grv':
        return {
          ...base,
          type: 'direct_grv',
          action: 'GRV_RECORD',
          entityType: 'grv',
          directGrv: d,
          payload: d,
        };

      case 'internal_consumption':
        return {
          ...base,
          type: 'internal_consumption',
          action: 'INTERNAL_CONSUMPTION_RECORD',
          internalConsumption: d,
          payload: d,
        };

      case 'branch':
        return {
          ...base,
          type: 'branch',
          action: 'BRANCH_SYNC',
          branchId: envelope.entityId,
          target_branch_id: 'ALL',
          branch: d,
          payload: d,
        };

      case 'cash_account': {
        const isGlobalAcc =
          d?.account_type === 'HQ_SAFE' ||
          d?.account_type === 'BANK_ACCOUNT' ||
          String(d?.branch_id || '').toUpperCase().trim() === 'HQ' ||
          String(d?.target_branch_id || '').toUpperCase().trim() === 'ALL';
        return {
          ...base,
          type: 'cash_account',
          action: 'CASH_ACCOUNT_SYNC',
          target_branch_id: isGlobalAcc ? 'ALL' : (d?.branch_id || ctx.branchId),
          cashAccount: d,
          payload: d,
        };
      }

      case 'cash_transfer': {
        const typeUpper = String(d?.type || '').toUpperCase().trim();
        const brUpper = String(d?.branch_id || ctx.branchId || '').toUpperCase().trim();
        const isGlobalTransfer =
          brUpper === 'HQ' ||
          brUpper === 'ALL' ||
          String(d?.target_branch_id || '').toUpperCase().trim() === 'ALL' ||
          typeUpper === 'HQ_TO_BRANCH' ||
          typeUpper === 'BRANCH_TO_HQ' ||
          typeUpper === 'BANK_DEPOSIT' ||
          typeUpper === 'BANK_WITHDRAWAL' ||
          typeUpper === 'CAPITAL_INFUSION' ||
          typeUpper === 'SUPPLIER_PAYMENT' ||
          typeUpper === 'THIRD_PARTY_PAYOUT';
        return {
          ...base,
          type: 'cash_transfer',
          action: envelope.action === 'UPSERT' ? 'CASH_TRANSFER_UPDATE' : 'CASH_TRANSFER',
          target_branch_id: isGlobalTransfer ? 'ALL' : (d?.branch_id || ctx.branchId),
          cashTransfer: d,
          payload: d,
        };
      }

      case 'cash_movement':
        return {
          ...base,
          type: 'cash_movement',
          action: 'CASH_MOVEMENT_RECORD',
          movement: d,
          payload: d,
        };

      case 'cash_log': {
        const isVaultLog = Boolean(
          d?.isVaultCustody ||
          String(d?.staffId || '').toUpperCase().trim() === 'VAULT_CUSTODY' ||
          String(d?.branch_id || d?.branchId || '').toUpperCase().trim() === 'HQ'
        );
        return {
          ...base,
          type: 'cash_log',
          action: envelope.action === 'UPSERT' ? 'CASH_LOG_UPDATE' : 'CASH_LOG_RECORD',
          ...(isVaultLog ? { target_branch_id: 'ALL' } : {}),
          cashLog: d,
          payload: d,
        };
      }

      case 'stock_movement':
        return {
          ...base,
          type: 'stock_movement',
          action: 'STOCK_MOVEMENT_RECORD',
          movement: d,
          payload: d,
        };

      case 'tombstone':
        return {
          ...base,
          type: 'TOMBSTONE_SYNC',
          action: 'TOMBSTONE_SYNC',
          target_branch_id: 'ALL',
          tombstone: d,
          payload: d,
        };

      case 'casual_worker':
        return {
          ...base,
          type: 'CASUAL_WORKERS_SYNC',
          action: 'CASUAL_WORKERS_SYNC',
          casualWorkers: Array.isArray(d) ? d : d.casualWorkers || [],
          payload: Array.isArray(d) ? d : d.casualWorkers || [],
        };

      case 'branch_lockdown':
        return {
          ...base,
          type: 'STOCKTAKE_LOCKDOWN_BROADCAST',
          branchId: d.branchId || ctx.branchId,
          sessionId: d.sessionId,
          isLocked: Boolean(d.isLocked),
          lockedByName: d.lockedByName,
          reason: d.reason,
        };

      case 'stocktake_session':
        return {
          ...base,
          type: 'STOCKTAKE_SESSION_STARTED',
          action: 'STOCKTAKE_SESSION_STARTED',
          sessionId: d.sessionId || envelope.entityId,
          sessionName: d.sessionName || d.title,
          title: d.sessionName || d.title,
          segments: d.segments || [],
          startedBy: d.startedBy,
          startedAt: d.startedAt,
          countType: d.countType,
          branchId: d.branchId || ctx.branchId,
          branchName: d.branchName,
          isLockdownActive: d.isLockdownActive,
          notes: d.notes,
          deviceName: ctx.deviceName,
        };

      case 'stocktake_segment':
        return {
          ...base,
          type: 'STOCKTAKE_SEGMENT_CREATED',
          action: 'STOCKTAKE_SEGMENT_CREATED',
          sessionId: d.sessionId,
          segment: d.segment || d,
          deviceName: ctx.deviceName,
        };

      case 'stocktake_zone_claim':
        return {
          ...base,
          type: 'STOCKTAKE_ZONE_CLAIM',
          sessionId: d.sessionId,
          zoneId: d.zoneId,
          slot: d.slot,
          staffId: d.staffId,
          staffName: d.staffName,
          zoneName: d.zoneName,
        };

      case 'stocktake_count_submission':
        return {
          ...base,
          type: 'STOCKTAKE_COUNT_SUBMIT',
          sessionId: d.sessionId,
          zoneId: d.zoneId,
          slot: d.slot,
          staffId: d.staffId,
          staffName: d.staffName,
          lines: d.lines,
        };

      case 'stocktake_joint_proposal':
        return {
          ...base,
          type: 'STOCKTAKE_JOINT_PROPOSAL',
          sessionId: d.sessionId,
          zoneId: d.zoneId,
          proposedBySlot: d.proposedBySlot || d.slot,
          proposedByName: d.proposedByName || d.staffName,
          recountLines: d.recountLines || d.lines,
        };

      case 'stocktake_joint_finalized':
        return {
          ...base,
          type: 'STOCKTAKE_JOINT_FINALIZED',
          sessionId: d.sessionId,
          zoneId: d.zoneId,
          resolvedLines: d.resolvedLines,
          signedByA: true,
          signedByB: true,
          resolvedByName: d.resolvedByName,
        };

      case 'sheet_mutation':
        return {
          ...base,
          type: envelope.action === 'DELETE' ? 'db_deletion' : 'db_mutation',
          action: envelope.action === 'DELETE' ? 'DELETE' : 'DB_MUTATION',
          entityType: meta.mutationEntityType || envelope.entityType,
          sheetName: meta.sheetName || '',
          recordId: envelope.entityId,
          payload: d,
          clientRequestId: meta.clientRequestId,
        };

      case 'sync_receipt':
        return {
          ...base,
          type: 'sync_receipt',
          action: 'SYNC_RECEIPT',
          sheetName: d.sheetName || 'SyncItems',
          postedClientRequestIds: d.postedClientRequestIds || [],
          postedIds: d.postedIds || [],
        };

      default:
        return {
          ...base,
          type: meta.wireType || envelope.entityType,
          action: meta.wireAction || envelope.action,
          payload: d,
        };
    }
  }

  public packetToEnvelope(packet: any): SyncEnvelope | null {
    if (!packet || typeof packet !== 'object') return null;

    // Unwrap nested envelopes if present
    let unwrapped = packet;
    if (unwrapped.data && typeof unwrapped.data === 'object' && (unwrapped.data.type || unwrapped.data.action)) {
      unwrapped = unwrapped.data;
    } else if (unwrapped.payload && typeof unwrapped.payload === 'object' && (unwrapped.payload.type || unwrapped.payload.action)) {
      unwrapped = unwrapped.payload;
    }

    const rawType = String(unwrapped.type || unwrapped.action || unwrapped.entityType || unwrapped.entity || '').trim();
    const pTypeUpper = rawType.toUpperCase();
    const pTypeLower = rawType.toLowerCase();

    if (!rawType || CONTROL_PACKET_TYPES.has(pTypeUpper)) {
      return null;
    }

    let entityType: string | null = null;
    let entityId = '';
    let data: any = unwrapped.payload || unwrapped.data || unwrapped;
    let action: SyncAction = 'UPSERT';
    let isSaleUpdate = false;

    if (pTypeLower === 'sale' || pTypeUpper === 'SALE_RECORD' || pTypeUpper === 'SALE_UPDATE' || pTypeUpper === 'SALE' || pTypeUpper === 'SALE_CREATED' || unwrapped.sale) {
      entityType = 'sale';
      data =
        unwrapped.sale ||
        (unwrapped.data && (unwrapped.data.items || unwrapped.data.total !== undefined) ? unwrapped.data : unwrapped.data?.sale) ||
        unwrapped.payload?.sale ||
        unwrapped.payload ||
        unwrapped;
      entityId = String(
        unwrapped.invoice_id ||
          unwrapped.invoiceId ||
          unwrapped.saleId ||
          data?.id ||
          data?.invoice_id ||
          data?.invoiceId ||
          unwrapped.id ||
          ''
      );
      isSaleUpdate =
        unwrapped.action === 'SALE_UPDATE' ||
        data?.status === 'Refunded' ||
        data?.status === 'Voided' ||
        data?.mobileVerificationStatus === 'VERIFIED' ||
        data?.mobileVerificationStatus === 'FLAGGED' ||
        Boolean(data?.hasExchanges);
      action = isSaleUpdate ? 'UPSERT' : 'APPEND';
    } else if (
      pTypeLower === 'inventory' ||
      pTypeUpper === 'INVENTORY' ||
      pTypeUpper === 'INVENTORY_ITEM' ||
      pTypeUpper === 'INVENTORY_UPDATE' ||
      pTypeUpper === 'INVENTORY_RECORD' ||
      Boolean(unwrapped.item)
    ) {
      entityType = 'inventory_item';
      data = unwrapped.item || unwrapped.payload || unwrapped;
      entityId = String(data?.itemId || data?.id || unwrapped.itemId || unwrapped.entityId || unwrapped.id || '');
    } else if (pTypeLower === 'db_mutation' || pTypeUpper === 'DB_MUTATION' || pTypeLower === 'db_deletion') {
      const sheet = String(unwrapped.sheetName || '');
      const mutPayload = unwrapped.payload || {};
      const resolved = this.resolveDbMutationEntityType(sheet, unwrapped.entityType, mutPayload);
      entityType = resolved;
      data = mutPayload;
      entityId = String(
        unwrapped.recordId ||
          mutPayload?.id ||
          mutPayload?.itemId ||
          mutPayload?.branchId ||
          mutPayload?.customerId ||
          mutPayload?.grvNumber ||
          mutPayload?.voucherId ||
          mutPayload?.sessionId ||
          `${resolved}-${Date.now()}`
      );
      const spec = ENTITY_REGISTRY[resolved];
      if (unwrapped.action === 'DELETE' || pTypeLower === 'db_deletion') {
        action = 'DELETE';
      } else {
        action = spec?.appendOnly && unwrapped.action !== 'UPSERT' ? 'APPEND' : 'UPSERT';
      }
    } else if (
      pTypeLower === 'cash_log' ||
      pTypeUpper === 'CASH_LOG' ||
      pTypeUpper === 'CASH_LOG_RECORD' ||
      pTypeUpper === 'CASH_LOG_UPDATE'
    ) {
      entityType = 'cash_log';
      data = unwrapped.cashLog || unwrapped.payload || unwrapped;
      entityId = String(data?.id || unwrapped.id || `CL-${data?.date || ''}-${data?.timestamp || Date.now()}`);
      action = pTypeUpper === 'CASH_LOG_UPDATE' || unwrapped.action === 'CASH_LOG_UPDATE' || unwrapped.action === 'UPSERT' ? 'UPSERT' : 'APPEND';
    } else if (pTypeLower === 'customer_change' || pTypeUpper === 'CUSTOMER_CHANGE_RECORD' || pTypeUpper === 'CUSTOMER_CHANGE' || pTypeUpper === 'CUSTOMER_CHANGE_SYNC') {
      entityType = 'customer_change';
      data = unwrapped.change || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.changeId || unwrapped.id || '');
      action = unwrapped.action === 'UPSERT' ? 'UPSERT' : 'APPEND';
    } else if (pTypeLower === 'credit_sale' || pTypeUpper === 'CREDIT_SALE_RECORD' || pTypeUpper === 'CREDIT_SALE' || pTypeUpper === 'CREDIT_SALE_SYNC') {
      entityType = 'credit_sale';
      data = unwrapped.credit || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.creditId || unwrapped.id || '');
      action = unwrapped.action === 'UPSERT' ? 'UPSERT' : 'APPEND';
    } else if (pTypeLower === 'credit_group' || pTypeUpper === 'CREDIT_GROUP_SYNC') {
      entityType = 'credit_group';
      data = unwrapped.group || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.groupId || unwrapped.id || '');
    } else if (pTypeLower === 'stock_movement' || pTypeUpper === 'STOCK_MOVEMENT' || pTypeUpper === 'STOCK_MOVEMENT_RECORD') {
      entityType = 'stock_movement';
      data = unwrapped.movement || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.txnId || data?.movementId || unwrapped.id || '');
      action = 'APPEND';
    } else if (pTypeLower === 'grv' || pTypeUpper === 'GRV_RECORD' || pTypeLower === 'direct_grv' || pTypeUpper === 'DIRECT_GRV') {
      entityType = 'direct_grv';
      data = unwrapped.directGrv || unwrapped.grv || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.grvNumber || unwrapped.id || '');
      action = data?.status && data.status !== 'PENDING' ? 'UPSERT' : 'APPEND';
    } else if (pTypeLower === 'goods_received' || pTypeUpper === 'GOODS_RECEIVED_RECORD') {
      entityType = 'goods_received';
      data = unwrapped.grn || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.grnId || unwrapped.id || '');
      action = 'APPEND';
    } else if (pTypeLower === 'expense' || pTypeUpper === 'EXPENSE' || pTypeUpper === 'EXPENSE_RECORD') {
      entityType = 'expense';
      data = unwrapped.expense || unwrapped.payload || unwrapped;
      entityId = String(data?.id || unwrapped.id || '');
      action = data?.status && data.status !== 'PENDING' ? 'UPSERT' : 'APPEND';
    } else if (
      pTypeLower === 'internal_consumption' ||
      pTypeUpper === 'INTERNAL_CONSUMPTION' ||
      pTypeUpper === 'INTERNAL_CONSUMPTION_RECORD' ||
      pTypeUpper === 'SHOP_USE'
    ) {
      entityType = 'internal_consumption';
      data = unwrapped.internalConsumption || unwrapped.payload || unwrapped;
      entityId = String(data?.id || unwrapped.id || '');
      action = data?.status && data.status !== 'PENDING' ? 'UPSERT' : 'APPEND';
    } else if (pTypeLower === 'cash_movement' || pTypeUpper === 'CASH_MOVEMENT' || pTypeUpper === 'CASH_MOVEMENTS' || pTypeUpper === 'CASH_MOVEMENT_RECORD') {
      entityType = 'cash_movement';
      data = unwrapped.movement || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.movementId || unwrapped.id || '');
      action = 'APPEND';
    } else if (pTypeLower === 'cash_lift' || pTypeUpper === 'CASH_LIFT' || pTypeUpper === 'CASH_LIFT_RECORD') {
      entityType = 'cash_lift';
      data = unwrapped.lift || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.liftId || unwrapped.id || '');
      action = 'APPEND';
    } else if (
      pTypeLower === 'staff' ||
      pTypeUpper === 'STAFF' ||
      pTypeUpper === 'STAFF_SYNC' ||
      pTypeUpper === 'STAFF_RECORD' ||
      pTypeLower === 'staff_permission' ||
      pTypeUpper === 'STAFF_PERMISSION_RECORD'
    ) {
      entityType = 'staff';
      data = unwrapped.staff || unwrapped.payload || unwrapped;
      entityId = String(data?.id || data?.staffId || unwrapped.entityId || unwrapped.id || '');
    } else if (pTypeLower === 'permissions_matrix' || pTypeUpper === 'PERMISSIONS_MATRIX' || pTypeUpper === 'PERMISSIONS_MATRIX_SYNC') {
      entityType = 'permissions_matrix';
      data = {
        rules: unwrapped.rules || unwrapped.permissionsMatrix?.rules || unwrapped.payload?.rules || unwrapped.payload,
        updatedAt: unwrapped.updatedAt || unwrapped.hubTimestamp || unwrapped.timestamp,
      };
      entityId = 'PERMISSIONS_MATRIX_CONFIG';
    } else if (pTypeLower === 'role_configs' || pTypeUpper === 'ROLE_CONFIGS' || pTypeUpper === 'ROLE_CONFIGS_SYNC') {
      entityType = 'role_configs';
      data = {
        definitions:
          unwrapped.definitions ||
          unwrapped.roleConfigs?.definitions ||
          unwrapped.roleDefinitions ||
          unwrapped.payload?.definitions ||
          unwrapped.payload,
        updatedAt: unwrapped.updatedAt || unwrapped.hubTimestamp || unwrapped.timestamp,
      };
      entityId = 'ROLE_CONFIGS_DEFINITIONS';
    } else if (
      pTypeLower === 'multi_currency' ||
      pTypeUpper === 'MULTI_CURRENCY' ||
      pTypeUpper === 'MULTI_CURRENCY_SYNC' ||
      pTypeLower === 'exchange_rates' ||
      pTypeUpper === 'EXCHANGE_RATES' ||
      pTypeUpper === 'EXCHANGE_RATES_SYNC'
    ) {
      entityType = 'multi_currency';
      data =
        unwrapped.multiCurrencyConfig ||
        unwrapped.exchangeRates ||
        unwrapped.payload?.multiCurrencyConfig ||
        unwrapped.payload?.exchangeRates ||
        unwrapped.payload ||
        unwrapped;
      entityId = 'MULTI_CURRENCY_CONFIG';
    } else if (pTypeLower === 'customer' || pTypeUpper === 'CUSTOMER' || pTypeUpper === 'CUSTOMER_SYNC' || pTypeUpper === 'CUSTOMER_RECORD') {
      entityType = 'customer';
      data = unwrapped.customer || unwrapped.payload || unwrapped;
      entityId = String(data?.customerId || data?.id || unwrapped.entityId || unwrapped.id || '');
    } else if (pTypeLower === 'branch' || pTypeUpper === 'BRANCH' || pTypeUpper === 'BRANCH_SYNC' || pTypeUpper === 'BRANCH_RECORD' || pTypeLower === 'branch_setup' || pTypeUpper === 'BRANCH_SETUP_RECORD') {
      entityType = 'branch';
      data = unwrapped.branch || unwrapped.payload || unwrapped;
      entityId = String(data?.branchId || data?.id || unwrapped.entityId || unwrapped.id || '');
    } else if (pTypeLower === 'cash_account' || pTypeUpper === 'CASH_ACCOUNT' || pTypeUpper === 'CASH_ACCOUNT_SYNC' || pTypeUpper === 'CASH_ACCOUNT_RECORD') {
      entityType = 'cash_account';
      data = unwrapped.cashAccount || unwrapped.payload || unwrapped;
      entityId = String(data?.account_id || data?.id || unwrapped.entityId || unwrapped.id || '');
    } else if (
      pTypeLower === 'cash_transfer' ||
      pTypeLower === 'cash_transfers' ||
      pTypeUpper === 'CASH_TRANSFER' ||
      pTypeUpper === 'CASH_TRANSFERS' ||
      pTypeUpper === 'CASH_TRANSFER_SYNC' ||
      pTypeUpper === 'CASH_TRANSFER_UPDATE' ||
      pTypeUpper === 'CASH_TRANSFER_RECORD'
    ) {
      entityType = 'cash_transfer';
      data = unwrapped.cashTransfer || unwrapped.payload || unwrapped;
      entityId = String(data?.transfer_id || data?.id || unwrapped.entityId || unwrapped.id || '');
      const st = String(data?.status || '').toUpperCase();
      action = st && st !== 'DRAFT' ? 'UPSERT' : 'APPEND';
    } else if (pTypeLower === 'supplier' || pTypeUpper === 'SUPPLIER' || pTypeUpper === 'SUPPLIER_SYNC' || pTypeUpper === 'SUPPLIER_RECORD') {
      entityType = 'supplier';
      data = unwrapped.supplier || unwrapped.payload || unwrapped.item || unwrapped;
      entityId = String(data?.supplierId || data?.id || data?.SupplierID || '');
    } else if (pTypeLower === 'admin_sales' || pTypeUpper === 'ADMIN_SALES' || pTypeUpper === 'ADMIN_SALES_SYNC' || pTypeUpper === 'ADMIN_SALES_RECORD') {
      entityType = 'admin_sales';
      data = unwrapped.adminSale || unwrapped.payload || unwrapped.item || unwrapped;
      entityId = String(data?.id || data?.staffId || '');
      action = 'APPEND';
    } else if (pTypeLower === 'cash_count' || pTypeUpper === 'CASH_COUNT' || pTypeUpper === 'CASH_COUNT_SYNC' || pTypeUpper === 'CASH_COUNT_RECORD') {
      entityType = 'cash_count';
      data = unwrapped.cashCount || unwrapped.payload || unwrapped.item || unwrapped;
      entityId = String(data?.id || data?.staffId || '');
      action = 'APPEND';
    } else if (pTypeLower === 'voucher' || pTypeUpper === 'VOUCHER' || pTypeUpper === 'VOUCHER_SYNC' || pTypeUpper === 'VOUCHER_RECORD' || pTypeLower === 'supplier_invoice' || pTypeUpper === 'SUPPLIER_INVOICE') {
      entityType = 'supplier_invoice_voucher';
      data = unwrapped.voucher || unwrapped.payload || unwrapped.item || unwrapped;
      entityId = String(data?.voucherId || data?.id || '');
      action = 'APPEND';
    } else if (pTypeLower === 'closure' || pTypeUpper === 'CLOSURE' || pTypeUpper === 'CLOSURE_SYNC' || pTypeUpper === 'CLOSURE_RECORD' || pTypeLower === 'eod' || pTypeUpper === 'EOD') {
      entityType = 'business_day_closure';
      data = unwrapped.closure || unwrapped.payload || unwrapped.item || unwrapped;
      entityId = String(data?.id || data?.date || '');
      action = 'APPEND';
    } else if (pTypeLower === 'settlement' || pTypeUpper === 'SETTLEMENT' || pTypeUpper === 'SETTLEMENT_SYNC' || pTypeUpper === 'SETTLEMENT_RECORD') {
      entityType = 'electronic_settlement';
      data = unwrapped.settlement || unwrapped.payload || unwrapped.item || unwrapped;
      entityId = String(data?.id || data?.date || '');
      action = 'APPEND';
    } else if (pTypeLower === 'category' || pTypeUpper === 'CATEGORY' || pTypeUpper === 'CATEGORY_SYNC' || pTypeUpper === 'CATEGORIES_SYNC' || pTypeLower === 'categories' || pTypeUpper === 'CATEGORIES') {
      entityType = 'inventory_category';
      data = unwrapped.categories || unwrapped.category || unwrapped.payload || unwrapped.item || unwrapped;
      entityId = 'CATEGORIES_CONFIG';
    } else if (pTypeLower === 'supervisor_approval' || pTypeUpper === 'SUPERVISOR_APPROVAL_RECORD') {
      entityType = 'supervisor_approval';
      data = unwrapped.auditLog || unwrapped.payload || unwrapped;
      entityId = String(data?.id || unwrapped.id || '');
      action = 'APPEND';
    } else if (pTypeLower === 'settings' || pTypeUpper === 'SETTINGS_RECORD') {
      entityType = 'system_settings';
      data = unwrapped.settings || unwrapped.payload || unwrapped;
      entityId = 'SYSTEM_SETTINGS';
    } else if (pTypeUpper === 'TOMBSTONE_SYNC' || pTypeLower === 'tombstone') {
      entityType = 'tombstone';
      data = unwrapped.tombstone || unwrapped.payload || unwrapped;
      entityId = String(data?.entityId || data?.id || '');
      action = 'APPEND';
    } else if (pTypeUpper === 'CASUAL_WORKERS_SYNC') {
      entityType = 'casual_worker';
      data = unwrapped.casualWorkers || unwrapped.payload || unwrapped.casuals;
      entityId = 'CASUAL_WORKERS_LIST';
    } else if (pTypeUpper === 'STOCKTAKE_LOCKDOWN_BROADCAST') {
      entityType = 'branch_lockdown';
      data = unwrapped;
      entityId = String(unwrapped.sessionId || unwrapped.branchId || 'LOCKDOWN');
    } else if (pTypeUpper === 'STOCKTAKE_SEGMENT_CREATED') {
      entityType = 'stocktake_segment';
      data = unwrapped.segment || unwrapped;
      entityId = String(data?.segmentId || data?.id || unwrapped.zoneId || '');
    } else if (pTypeUpper === 'STOCKTAKE_ZONE_CLAIMED' || pTypeUpper === 'STOCKTAKE_ZONE_CLAIM') {
      entityType = 'stocktake_zone_claim';
      data = unwrapped;
      entityId = String(unwrapped.zoneId || '');
    } else if (pTypeUpper === 'STOCKTAKE_JOINT_PROPOSAL') {
      entityType = 'stocktake_joint_proposal';
      data = unwrapped;
      entityId = String(unwrapped.zoneId || '');
    } else if (pTypeUpper === 'STOCKTAKE_JOINT_FINALIZED') {
      entityType = 'stocktake_joint_finalized';
      data = unwrapped;
      entityId = String(unwrapped.zoneId || '');
      action = 'APPEND';
    } else if (pTypeUpper === 'STOCKTAKE_SESSION_STARTED') {
      entityType = 'stocktake_session';
      data = unwrapped;
      entityId = String(unwrapped.sessionId || unwrapped.session?.sessionId || '');
    } else if (ENTITY_REGISTRY[pTypeLower]) {
      entityType = pTypeLower;
      entityId = String(unwrapped.entityId || unwrapped.id || data?.id || 'UNKNOWN');
    }

    if (!entityType || !ENTITY_REGISTRY[entityType]) {
      return null;
    }

    const spec = ENTITY_REGISTRY[entityType];
    const updatedAt = this.parseTimestamp(
      unwrapped.updatedAt ?? unwrapped.timestamp ?? unwrapped.lastUpdated ?? data?.updatedAt ?? data?.lastUpdated
    );
    const hubTimestamp = this.parseOptionalTimestamp(unwrapped.hubTimestamp ?? unwrapped.hub_timestamp ?? data?.hubTimestamp);
    const originDeviceId = String(
      unwrapped.origin_device_id ||
        unwrapped.originDeviceId ||
        unwrapped.deviceId ||
        unwrapped.sourceDevice ||
        ''
    );
    const targetBranchId = String(
      unwrapped.targetBranchId || unwrapped.target_branch_id || unwrapped.branchId || unwrapped.branch_id || ''
    );
    const fallbackUniqueId = `${entityType}-${entityId || 'row'}-${updatedAt}-${Math.random().toString(36).substring(2, 7)}`;
    const isInv = entityType === 'inventory_item';
    const packetId = String(
      unwrapped.packetId ||
        unwrapped.packet_id ||
        (!isInv && unwrapped.id ? unwrapped.id : '') ||
        fallbackUniqueId
    );

    const incomingCloudSynced = Boolean(
      unwrapped.isCloudSynced === true || packet.isCloudSynced === true || data?.isCloudSynced === true
    );

    return {
      packetId,
      entityType,
      entityId: entityId || 'UNKNOWN',
      action,
      data,
      updatedAt,
      hubTimestamp,
      originDeviceId,
      targetBranchId,
      class: spec.class,
      ...(incomingCloudSynced ? { isCloudSynced: true } : {}),
      meta: {
        rawPacket: packet,
        unwrappedPacket: unwrapped,
        pType: rawType,
        isSaleUpdate,
        sheetName: unwrapped.sheetName,
        isDbMutation: pTypeLower === 'db_mutation' || pTypeUpper === 'DB_MUTATION',
      },
    };
  }

  private resolveDbMutationEntityType(sheetName: string, rawEntityType?: string, payload?: any): string {
    const sheet = String(sheetName || '').trim();
    const raw = String(rawEntityType || '').trim().toLowerCase();

    if (sheet === 'CustomerChange' || payload?.changeId) return 'customer_change';
    if (sheet === 'CreditSales' || payload?.creditId) return 'credit_sale';
    if (sheet === 'CreditGroups' || raw === 'credit_group') return 'credit_group';
    if (sheet === 'Sales' || raw === 'sale') return 'sale';
    if (sheet === 'InventoryMaster' || sheet === 'Products' || raw === 'inventory' || raw === 'inventory_item') return 'inventory_item';
    if (sheet === 'Salespeople' || sheet === 'users' || raw === 'staff') return 'staff';
    if (sheet === 'Branches' || raw === 'branch') return 'branch';
    if (sheet === 'Customers' || raw === 'customer') return 'customer';
    if (sheet === 'Audit_Log' || sheet === 'SupervisorApprovals' || raw === 'supervisor_approval') return 'supervisor_approval';
    if (sheet === 'CashLog' || raw === 'cash_log') return 'cash_log';
    if (sheet === 'CashLifts' || raw === 'cash_lift') return 'cash_lift';
    if (sheet === 'CashMovements' || raw === 'cash_movement') return 'cash_movement';
    if (sheet === 'CashAccounts' || raw === 'cash_account') return 'cash_account';
    if (sheet === 'CashTransfers' || raw === 'cash_transfer') return 'cash_transfer';
    if (sheet === 'GoodsReceived' || payload?.grnId) return 'goods_received';
    if (sheet === 'DirectGRVs' || raw === 'grv' || raw === 'direct_grv') return 'direct_grv';
    if (sheet === 'StockMovement' || raw === 'stock_movement') return 'stock_movement';
    if (sheet === 'Expenses' || raw === 'expense') return 'expense';
    if (sheet === 'InternalConsumption' || raw === 'internal_consumption') return 'internal_consumption';
    if (sheet === 'Reconciliations' || raw === 'reconciliation') return 'reconciliation';
    if (sheet === 'Settings' || raw === 'setting' || raw === 'system_settings') return 'system_settings';
    if (sheet === 'MultiCurrency' || raw === 'multi_currency') return 'multi_currency';
    if (sheet === 'Suppliers' || raw === 'supplier') return 'supplier';
    if (sheet === 'AdminSales' || raw === 'admin_sales') return 'admin_sales';
    if (sheet === 'CashCounts' || raw === 'cash_count') return 'cash_count';
    if (sheet === 'Vouchers' || sheet === 'SupplierInvoices' || raw === 'voucher' || raw === 'supplier_invoice_voucher') return 'supplier_invoice_voucher';
    if (sheet === 'Closures' || sheet === 'BusinessDayClosures' || raw === 'closure' || raw === 'business_day_closure') return 'business_day_closure';
    if (sheet === 'Settlements' || sheet === 'ElectronicSettlements' || raw === 'settlement' || raw === 'electronic_settlement') return 'electronic_settlement';
    if (sheet === 'Categories' || raw === 'category' || raw === 'inventory_category') return 'inventory_category';
    if (sheet === 'StocktakeSessions' || raw === 'stocktake_session') return 'stocktake_session';
    if (payload?.invoiceNumber) return 'sale';
    if (payload?.staffId && (payload?.in !== undefined || payload?.out !== undefined)) return 'cash_log';
    if (payload?.movementType) return 'stock_movement';
    if (payload?.liftId) return 'cash_lift';
    if (payload?.vendorOrCustomer) return 'expense';
    if (raw && ENTITY_REGISTRY[raw]) return raw;
    return 'sheet_mutation';
  }

  private isCatalogOrCompanyWirePacket(packet: any, topicSuffix: string, targetBranch: string): boolean {
    const pt = String(packet.type || '').toUpperCase();
    const pa = String(packet.action || '').toUpperCase();
    const ca = packet.cashAccount || packet.payload;
    const isGlobalCashAccount =
      pt === 'CASH_ACCOUNT' &&
      (ca?.account_type === 'HQ_SAFE' ||
        ca?.account_type === 'BANK_ACCOUNT' ||
        String(ca?.branch_id || '').toUpperCase().trim() === 'HQ');
    const ct = packet.cashTransfer || packet.payload;
    const ctType = String(ct?.type || '').toUpperCase().trim();
    const ctBranch = String(ct?.branch_id || '').toUpperCase().trim();
    const isGlobalCashTransfer =
      pt === 'CASH_TRANSFER' &&
      (ctBranch === 'HQ' ||
        ctBranch === 'ALL' ||
        ctType === 'HQ_TO_BRANCH' ||
        ctType === 'BRANCH_TO_HQ' ||
        ctType === 'BANK_DEPOSIT' ||
        ctType === 'BANK_WITHDRAWAL' ||
        ctType === 'CAPITAL_INFUSION' ||
        ctType === 'SUPPLIER_PAYMENT' ||
        ctType === 'THIRD_PARTY_PAYOUT');
    const cl = packet.cashLog || packet.payload;
    const isVaultCashLog =
      (pt === 'CASH_LOG' || pa === 'CASH_LOG_RECORD' || pa === 'CASH_LOG_UPDATE') &&
      Boolean(
        cl?.isVaultCustody ||
          String(cl?.staffId || '').toUpperCase().trim() === 'VAULT_CUSTODY' ||
          String(cl?.branch_id || cl?.branchId || '').toUpperCase().trim() === 'HQ'
      );
    return (
      topicSuffix === 'inventory' ||
      topicSuffix === 'inventory_item' ||
      pt === 'INVENTORY' ||
      pt === 'INVENTORY_ITEM' ||
      pt === 'INVENTORY_UPDATE' ||
      pa === 'INVENTORY_RECORD' ||
      pa === 'INVENTORY_UPDATE' ||
      pt === 'PRODUCT' ||
      pt === 'STAFF' ||
      pa === 'STAFF_SYNC' ||
      pt === 'STAFF_PERMISSION' ||
      pa === 'STAFF_PERMISSION_RECORD' ||
      pt === 'PERMISSIONS_MATRIX_SYNC' ||
      pa === 'PERMISSIONS_MATRIX_SYNC' ||
      pt === 'ROLE_CONFIGS_SYNC' ||
      pa === 'ROLE_CONFIGS_SYNC' ||
      pt === 'MULTI_CURRENCY_SYNC' ||
      pa === 'MULTI_CURRENCY_SYNC' ||
      pt === 'EXCHANGE_RATES_SYNC' ||
      pa === 'EXCHANGE_RATES_SYNC' ||
      pt === 'BRANCH' ||
      pa === 'BRANCH_SYNC' ||
      pt === 'TOMBSTONE_SYNC' ||
      pa === 'TOMBSTONE_SYNC' ||
      isGlobalCashAccount ||
      isGlobalCashTransfer ||
      isVaultCashLog ||
      packet.target_branch_id === 'ALL' ||
      targetBranch === 'ALL'
    );
  }

  private parseTimestamp(val: any): number {
    if (val === undefined || val === null) return Date.now();
    if (typeof val === 'number') return isNaN(val) ? Date.now() : val;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
      const num = Number(val);
      if (!isNaN(num)) return num;
      const parsed = new Date(val).getTime();
      return isNaN(parsed) ? Date.now() : parsed;
    }
    return Date.now();
  }

  private parseOptionalTimestamp(val: any): number | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'number') return isNaN(val) ? undefined : val;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
      const num = Number(val);
      if (!isNaN(num)) return num;
      const parsed = new Date(val).getTime();
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }
}
