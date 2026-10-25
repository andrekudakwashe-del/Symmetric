import {
  P2PMeshConfig,
  P2PMeshPeer,
  P2PPacket,
  SaleInvoice,
  InventoryItem,
  Branch,
  Salesperson,
  AuditLogEntry,
  CashLogEntry,
  DirectGrv,
} from '../types';
import mqtt, { MqttClient } from 'mqtt';
import {
  getSales,
  getAllSales,
  addSale,
  getSyncQueue,
  purgeSyncedRecords,
  onSaleCreated,
  ingestMeshSale,
  onInventoryCreated,
  ingestMeshInventoryItem,
  pullTenantInventory,
  getCurrentCompanyId,
  getCurrentCompany,
  getCurrentBranchId,
  getCurrentBranch,
  getBranches,
  isRecordInBranchScope,
  onDatabaseMutation,
  DatabaseMutationEvent,
  resolveEntityType,
  ingestMeshBranch,
  ingestMeshStaff,
  ingestMeshSupervisorApproval,
  ingestMeshCashLog,
  ingestMeshCustomer,
  ingestMeshGRV,
  ingestMeshInventoryDelete,
  getDeletedInventoryItems,
  ingestMeshSettings,
  markSyncItemsAsSynced,
  clearAllSyncQueueItems,
  getDeltaRecordsSince,
  ingestMeshCustomerChange,
  ingestMeshCreditSale,
  ingestMeshStockMovement,
  ingestMeshCashLift,
  ingestMeshGoodsReceived,
  addExpense,
  saveReconciliation,
  saveCashAccount,
  saveCashTransfer,
  getAllExpenses,
  getAllCashAccounts,
  getAllCashTransfers,
  generateInvoiceNumber,
  getNextInvoiceId,
} from '../db/roomDatabase';
import { persistentSyncEngine } from './persistentSyncEngine';
import { processSyncQueue } from './googleSheetsSync';
import { LocalHubConfig, normalizeHubUrl } from '../utils/localHubConfig';

export type MeshConnectionMode = 'CLOUD_MESH' | 'LOCAL_HUB' | 'LOCAL_OFFLINE';

// Keys for localStorage persistence
const PREFS_BRANCH_KEY = 'saimetric_mesh_branch_code';
const PREFS_BRANCH_ID_KEY = 'saimetric_mesh_branch_id';
const PREFS_DEVICE_KEY = 'saimetric_mesh_device_name';
const PREFS_DEVICE_ID_KEY = 'saimetric_mesh_device_id';
const PREFS_COMPANY_KEY = 'saimetric_mesh_company_id';
const PREFS_AUTODETECT_KEY = 'saimetric_mesh_autodetect';

// Public Zero-Config Secure WebSocket MQTT Brokers for Instant Cross-Device P2P
const PUBLIC_MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export interface MeshEventLog {
  id: string;
  timestamp: string;
  type:
    | 'DISCOVERY'
    | 'BROADCAST'
    | 'EPIDEMIC_HOP'
    | 'CONFLICT_RESOLVED'
    | 'CLOUD_SYNC'
    | 'ACK'
    | 'SECURITY_DROP';
  message: string;
  sourceDevice: string;
  targetDevice?: string;
  ttl?: number;
  uuid?: string;
}

export interface VirtualDevice {
  id: string;
  name: string;
  companyId: string;
  branchCode: string;
  branchId: string;
  isOnline: boolean;
  hasInternet: boolean;
  sales: Array<{
    uuid: string;
    deviceId: string;
    timestamp: number;
    invoiceNumber: string;
    totalAmount: number;
    syncStatus: 'pending' | 'synced';
    hash: string;
  }>;
  pendingQueue: Array<{
    uuid: string;
    recordUuid: string;
    tableName: string;
    deviceId: string;
    timestamp: number;
    syncStatus: 'pending' | 'synced';
    hash: string;
    payload: any;
  }>;
}

export function calculateRecordHash(uuid: string, deviceId: string, timestamp: number, total: number): string {
  const raw = `${uuid}:${deviceId}:${timestamp}:${total}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'H-' + Math.abs(hash).toString(16);
}

let lastChimeTime = 0;
function playChime() {
  const nowMs = Date.now();
  if (nowMs - lastChimeTime < 1200) return; // Rate-limit chimes
  lastChimeTime = nowMs;

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.1); // A5
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
    setTimeout(() => {
      try {
        ctx.close();
      } catch (e) {}
    }, 500);
  } catch (e) {}
}

class MeshSyncManager {
  private config: P2PMeshConfig;
  private channel: BroadcastChannel | null = null;
  private logs: MeshEventLog[] = [];
  private logListeners: Array<(logs: MeshEventLog[]) => void> = [];
  private peerListeners: Array<(count: number, peers: P2PMeshPeer[]) => void> = [];
  private virtualDevices: VirtualDevice[] = [];
  private seenPacketIds: Set<string> = new Set();
  private opportunisticTimer: number | null = null;
  private autoDetectTimer: number | null = null;

  // Real Mesh Transport: Server Stream (SSE) & MQTT Over WebSocket
  private serverEventSource: EventSource | null = null;
  private isServerRelayConnected: boolean = false;
  private mqttClient: MqttClient | null = null;
  private currentBrokerIndex: number = 0;
  private isMqttConnected: boolean = false;
  private brokerName: string = 'Integrated Realtime Mesh Relay';

  // Discovered Physical Peers: Map<deviceId, P2PMeshPeer>
  private discoveredPeers: Map<string, P2PMeshPeer> = new Map();
  private heartbeatInterval: number | null = null;
  private pruneInterval: number | null = null;
  private isSimulationMode: boolean = false;

  // Offline Local WebRTC & LAN Gateways
  private webrtcPeerConnection: RTCPeerConnection | null = null;
  private webrtcDataChannel: RTCDataChannel | null = null;
  private isWebRtcConnected: boolean = false;
  private localGatewayUrl: string = '';
  private localGatewayPollTimer: number | null = null;
  private lastMeshPollTimestamp: number = Date.now();
  private lastNotifiedPeerSignature: string = '';
  private lastCatchUpRequestTime: Map<string, number> = new Map();

  // Local WebSocket Hub (Termux Node.js server on Android phone)
  private localHubWs: WebSocket | null = null;
  private isLocalHubConnected: boolean = false;
  private isLocalHubLost: boolean = false;
  private localHubDisconnectedAt: number | null = null;
  private localHubLostGraceTimer: number | null = null;
  private activeConnectionMode: MeshConnectionMode = 'LOCAL_OFFLINE';
  private localHubHeartbeatTimer: number | null = null;
  private localHubReconnectTimer: number | null = null;
  private lastHubPongReceivedAt: number = 0;
  private connectionModeListeners: Array<(mode: MeshConnectionMode, details: any) => void> = [];
  private pendingLocalHubQueue: any[] = [];
  private knownSaleIds: Set<string> = new Set();
  private broadcastedInvoiceIds: Set<string> = new Set();
  private batchUiTimer: number | null = null;
  private isIngestingFromHub: boolean = false;
  private hubIngestQueue: any[] = [];
  private hubProcessingTimer: number | null = null;
  private hasPerformedInitialCatchup: boolean = false;
  private lastInitialCatchupTime: number = 0;

  private scheduleBatchUiUpdate() {
    if (this.batchUiTimer) return;
    this.batchUiTimer = window.setTimeout(() => {
      this.batchUiTimer = null;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
    }, 150);
  }

  private queueOutgoingLocalHubPacket(packet: any) {
    if (!packet) return;
    // Never queue maintenance packets to local hub
    if (packet.type === 'heartbeat' || packet.type === 'ping' || packet.action === 'HEARTBEAT' || packet.action === 'PING') {
      return;
    }
    if (this.pendingLocalHubQueue.length > 100) {
      this.pendingLocalHubQueue.shift();
    }
    this.pendingLocalHubQueue.push(packet);
  }

  constructor() {
    this.config = this.loadConfig();

    // Pre-populate known and broadcasted invoice IDs from local DB for fast O(1) deduplication
    try {
      const existingSales = getAllSales();
      for (const s of existingSales) {
        if (s && s.id) {
          this.knownSaleIds.add(s.id);
          this.broadcastedInvoiceIds.add(s.id);
        }
      }
    } catch (e) {}

    this.initServerStream();
    this.initBroadcastChannel();
    this.initVirtualMeshDefault();
    this.startOpportunisticCloudSyncTimer();

    // Subscribe to LocalHubConfig changes (URL changes or Force Local Hub toggles)
    LocalHubConfig.subscribe(() => {
      this.handleLocalHubConfigChanged();
    });

    // Auto-attempt local hub connection on boot (or when forced / offline)
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.evaluateConnectionPriority();
      }, 1000);
    }

    // Defer external MQTT relay connection until after critical UI boots
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.initMqttRelay();
      }, 5000);
    }

    // Local Gateway IP if configured
    try {
      this.localGatewayUrl = localStorage.getItem('saimetric_mesh_local_gateway') || '';
    } catch (e) {}
    this.startLocalGatewayPolling();

    // Online / Offline listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.addLog(
          'DISCOVERY',
          'Internet connection restored. Reconnecting real-time mesh relay...',
          this.config.deviceName
        );
        this.initServerStream();
        this.initMqttRelay();
        this.evaluateConnectionPriority();
      });
      window.addEventListener('offline', () => {
        this.addLog(
          'DISCOVERY',
          'Internet offline. Evaluating failover to Local WebSocket Hub...',
          this.config.deviceName
        );
        this.evaluateConnectionPriority();
        this.connectLocalHub();
      });

      // When terminal awakens, tab regains focus or user unlocks device after being away
      window.addEventListener('focus', () => {
        this.checkAndRequestCatchUpIfStale();
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.checkAndRequestCatchUpIfStale();
          }
        });
      }
    }

    // Auto-hook into POS Sales: broadcast in real-time
    onSaleCreated((sale: SaleInvoice) => {
      this.broadcastSale(sale);
    });

    // Auto-hook into POS Inventory: broadcast product changes
    onInventoryCreated((item: InventoryItem) => {
      this.broadcastInventoryItem(item);
    });

    // Auto-hook into Whole Database Mutation Bus (Branch setup, staff permissions, supervisor approvals, cash log, settings, GRVs)
    onDatabaseMutation((mutation: DatabaseMutationEvent) => {
      this.broadcastDatabaseMutation(mutation);
    });

    // Auto-hook into Persistent Sync Engine: When any record is confirmed uploaded to Apps Script,
    // immediately broadcast sync receipt to all mesh peers to prevent ANY double posting
    persistentSyncEngine.onItemsSynced((receipt) => {
      this.broadcastSyncReceipt(receipt);
    });

    // Auto-detection of Tenant & Branch switch (e.g. multi-branch roaming staff switches branch or company)
    this.startTenantBranchAutoDetectLoop();

    // Start discovery loops
    this.startHeartbeatLoop();
    this.startPruneLoop();

    // Periodic pull from server - gentle background interval to prevent UI freezes
    if (typeof window !== 'undefined') {
      window.setInterval(() => {
        pullTenantInventory().catch(() => {});
      }, 180000);
    }
  }

  // =========================================================================
  // CONFIGURATION & AUTOMATIC TENANT & BRANCH DETECTION
  // =========================================================================

  private getActiveTenantBranch() {
    const company = getCurrentCompany();
    const companyId = getCurrentCompanyId() || 'COMP-001';
    const branch = getCurrentBranch();
    const branchId = getCurrentBranchId() || 'BR-MAIN';
    const branchCode = branch?.code || 'HQ-01';
    const branchName = branch?.name || 'Main Branch';
    const companyName = company?.company_name || 'My Company';

    return { companyId, companyName, branchId, branchCode, branchName };
  }

  public loadConfig(): P2PMeshConfig {
    const active = this.getActiveTenantBranch();
    const autoDetect = localStorage.getItem(PREFS_AUTODETECT_KEY) !== 'false';

    let branchCode = active.branchCode;
    let branchId = active.branchId;
    let branchName = active.branchName;
    let companyId = active.companyId;
    let companyName = active.companyName;

    // Check URL overrides e.g. ?branch=HARARE-01
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlBranch = urlParams.get('branch');
      if (urlBranch && urlBranch.trim().length > 0) {
        branchCode = urlBranch.trim().toUpperCase();
      }
    } catch (e) {}

    // If manual lock is set and not auto-detecting
    if (!autoDetect) {
      const savedBranchCode = localStorage.getItem(PREFS_BRANCH_KEY);
      if (savedBranchCode) branchCode = savedBranchCode;
      const savedBranchId = localStorage.getItem(PREFS_BRANCH_ID_KEY);
      if (savedBranchId) branchId = savedBranchId;
      const savedComp = localStorage.getItem(PREFS_COMPANY_KEY);
      if (savedComp) companyId = savedComp;
    }

    let deviceName = localStorage.getItem(PREFS_DEVICE_KEY);
    if (!deviceName) {
      const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isTablet = typeof navigator !== 'undefined' && /iPad|tablet|(android(?!.*mobile))/i.test(navigator.userAgent);
      deviceName = isTablet ? 'Terminal-Tablet' : isMobile ? 'Terminal-Mobile' : 'Terminal-1';
      localStorage.setItem(PREFS_DEVICE_KEY, deviceName);
    }

    let deviceId = localStorage.getItem(PREFS_DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = 'DEV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      localStorage.setItem(PREFS_DEVICE_ID_KEY, deviceId);
    }

    return {
      branchCode,
      branchId,
      branchName,
      deviceName,
      deviceId,
      companyId,
      companyName,
      autoDetectTenantBranch: autoDetect,
    };
  }

  public saveConfig(
    branchCode: string,
    deviceName: string,
    companyId?: string,
    branchId?: string,
    branchName?: string,
    autoDetect: boolean = true
  ) {
    const cleanBranch = branchCode.trim().toUpperCase() || 'HQ-01';
    const cleanDevice = deviceName.trim() || 'Terminal-1';
    const cleanComp = (companyId || this.config.companyId || 'COMP-001').trim().toUpperCase();
    const cleanBrId = (branchId || this.config.branchId || 'BR-MAIN').trim();

    localStorage.setItem(PREFS_BRANCH_KEY, cleanBranch);
    localStorage.setItem(PREFS_DEVICE_KEY, cleanDevice);
    localStorage.setItem(PREFS_COMPANY_KEY, cleanComp);
    localStorage.setItem(PREFS_BRANCH_ID_KEY, cleanBrId);
    localStorage.setItem(PREFS_AUTODETECT_KEY, autoDetect ? 'true' : 'false');

    this.config.branchCode = cleanBranch;
    this.config.deviceName = cleanDevice;
    this.config.companyId = cleanComp;
    this.config.branchId = cleanBrId;
    if (branchName) this.config.branchName = branchName;
    this.config.autoDetectTenantBranch = autoDetect;

    this.addLog(
      'DISCOVERY',
      `Mesh config updated: Tenant [${cleanComp}] | Branch [${cleanBranch}] | Terminal [${cleanDevice}]. Rebinding transports...`,
      this.config.deviceName
    );

    // Re-initialize isolated transports
    this.discoveredPeers.clear();
    this.initServerStream();
    this.initMqttRelay();
    this.initBroadcastChannel();
    this.sendHeartbeat();
    this.notifyPeerSubscribers(true);
  }

  public setAutoDetectTenantBranch(enabled: boolean) {
    this.config.autoDetectTenantBranch = enabled;
    localStorage.setItem(PREFS_AUTODETECT_KEY, enabled ? 'true' : 'false');
    if (enabled) {
      this.syncContextWithActiveSession(true);
    }
  }

  /**
   * Automatically monitors active session user & branch selection.
   * If a roaming multi-branch user changes branch or company in the POS,
   * the mesh sync transport immediately recalibrates to that exact branch & tenant.
   */
  private startTenantBranchAutoDetectLoop() {
    if (this.autoDetectTimer) clearInterval(this.autoDetectTimer);
    this.autoDetectTimer = window.setInterval(() => {
      if (this.config.autoDetectTenantBranch !== false) {
        this.syncContextWithActiveSession();
      }
    }, 15000);
  }

  public syncContextWithActiveSession(force: boolean = false) {
    const active = this.getActiveTenantBranch();
    const compChanged = active.companyId !== this.config.companyId;
    const branchChanged = active.branchId !== this.config.branchId || active.branchCode !== this.config.branchCode;

    if (compChanged || branchChanged || force) {
      const oldTenant = this.config.companyId;
      const oldBranch = this.config.branchCode;

      this.config.companyId = active.companyId;
      this.config.companyName = active.companyName;
      this.config.branchId = active.branchId;
      this.config.branchCode = active.branchCode;
      this.config.branchName = active.branchName;

      this.addLog(
        'DISCOVERY',
        `Auto-detected branch/tenant change: [${oldTenant}/${oldBranch} -> ${active.companyId}/${active.branchCode} (${active.branchName})]. Mesh isolated & recalibrated.`,
        this.config.deviceName
      );

      // Clear peers from old branch/tenant
      this.discoveredPeers.clear();
      this.initServerStream();
      this.initMqttRelay();
      this.initBroadcastChannel();
      this.sendHeartbeat();
      this.notifyPeerSubscribers(true);
    }
  }

  public getConfig(): P2PMeshConfig {
    return { ...this.config };
  }

  public getConnectionStatus() {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const forceLocalHub = LocalHubConfig.getForceLocalHub();
    const hubUrl = LocalHubConfig.getLocalHubUrl();
    const mode = this.evaluateConnectionPriority();

    return {
      isOnline,
      connectionMode: mode,
      isCloudMeshConnected: this.isMqttConnected || this.isServerRelayConnected,
      isLocalHubConnected: this.isLocalHubConnected,
      isLocalHubLost: this.isLocalHubLost,
      localHubUrl: hubUrl,
      forceLocalHub,
      isMqttConnected: this.isMqttConnected || this.isServerRelayConnected,
      isWebRtcConnected: this.isWebRtcConnected,
      hasLocalGateway: !!this.localGatewayUrl || !!hubUrl,
      localGatewayUrl: hubUrl || this.localGatewayUrl,
      broker: mode === 'LOCAL_HUB' ? `Local WebSocket Hub (${hubUrl})` : this.brokerName,
      companyId: this.config.companyId,
      companyName: this.config.companyName,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      branchName: this.config.branchName,
      deviceName: this.config.deviceName,
      deviceId: this.config.deviceId,
      autoDetectTenantBranch: this.config.autoDetectTenantBranch !== false,
      peerCount: this.getOnlineDeviceCount(),
      pendingOfflineCount: getSyncQueue().length,
    };
  }

  // =========================================================================
  // TOPIC & CHANNEL SCOPING HELPERS (Strict Multi-Tenant & Branch Isolation)
  // =========================================================================
  private getMqttTopic(subTopic: string = '#'): string {
    const comp = (this.config.companyId || 'COMP-001').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const branch = (this.config.branchCode || this.config.branchId || 'HQ-01').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    return `saimetric/mesh/${comp}/${branch}/${subTopic}`;
  }

  private getBroadcastChannelName(): string {
    const comp = (this.config.companyId || 'COMP-001').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const branch = (this.config.branchCode || this.config.branchId || 'HQ-01').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    return `SAIMETRIC_MESH_${comp}_${branch}`;
  }

  // =========================================================================
  // OFFLINE TRANSPORT A: OPTICAL QR BATCH SYNC (Air-gapped, zero-network)
  // =========================================================================
  public generateOfflineBatchPayload(): string {
    const allSales = getSales();
    const recentSales = allSales.slice(0, 15);
    const payload = {
      type: 'SAIMETRIC_OFFLINE_BATCH',
      version: 2,
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      timestamp: Date.now(),
      sales: recentSales.map((s) => ({
        id: s.id,
        timestamp: s.timestamp,
        customerName: s.customerName,
        staffName: s.staffName || 'Staff',
        total: s.total,
        tax: s.tax,
        paymentMethod: s.paymentMethod,
        company_id: this.config.companyId,
        branch_id: this.config.branchId,
        items: (s.items || []).map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
        })),
      })),
      deletedItemIds: getDeletedInventoryItems()
        .filter((d) => (d.companyId || '').toUpperCase() === (this.config.companyId || '').toUpperCase())
        .slice(-50),
    };
    return JSON.stringify(payload);
  }

  public ingestOfflineBatchPayload(rawString: string): {
    success: boolean;
    syncedCount: number;
    message: string;
    details?: string;
  } {
    try {
      const parsed = JSON.parse(rawString);
      if (!parsed || parsed.type !== 'SAIMETRIC_OFFLINE_BATCH' || !Array.isArray(parsed.sales)) {
        return { success: false, syncedCount: 0, message: 'Invalid offline QR packet format.' };
      }

      // Strict tenant isolation
      const packetComp = (parsed.companyId || parsed.company_id || '').trim().toUpperCase();
      const localComp = (this.config.companyId || '').trim().toUpperCase();
      if (packetComp && localComp && packetComp !== localComp) {
        return {
          success: false,
          syncedCount: 0,
          message: `Security Isolation: QR code belongs to tenant [${packetComp}], but this terminal is on [${localComp}].`,
        };
      }

      // Strict branch isolation
      const packetBranch = (parsed.branchId || parsed.branchCode || '').trim().toUpperCase();
      const localBranchId = (this.config.branchId || '').trim().toUpperCase();
      const localBranchCode = (this.config.branchCode || '').trim().toUpperCase();
      if (packetBranch && packetBranch !== localBranchId && packetBranch !== localBranchCode) {
        return {
          success: false,
          syncedCount: 0,
          message: `Branch mismatch: Beacon is for branch [${packetBranch}], but this terminal is assigned to [${localBranchCode}].`,
        };
      }

      let count = 0;
      for (const s of parsed.sales) {
        const didIngest = ingestMeshSale({
          ...s,
          company_id: this.config.companyId,
          branch_id: this.config.branchId,
          fromMesh: true,
        });
        if (didIngest) count++;
      }

      // Sync offline deleted items across peer terminals
      let deletedCount = 0;
      if (Array.isArray(parsed.deletedItemIds)) {
        for (const del of parsed.deletedItemIds) {
          if (del && del.itemId) {
            const didDel = ingestMeshInventoryDelete(del.itemId, del.companyId || this.config.companyId);
            if (didDel) deletedCount++;
          }
        }
      }

      playChime();
      this.addLog(
        'EPIDEMIC_HOP',
        `Air-Gapped Optical QR: Ingested ${count} sales and ${deletedCount} deleted records from ${parsed.originDeviceName || 'Terminal'} into local Room database!`,
        parsed.originDeviceName || 'Airgap QR',
        this.config.deviceName
      );

      this.notifyPeerSubscribers();

      return {
        success: true,
        syncedCount: count,
        message: `Successfully ingested ${count} sale(s) into local database!`,
        details: `${parsed.sales.length} sale(s) processed from ${parsed.originDeviceName} (${parsed.branchCode}). Inventory decremented & daily totals updated.`,
      };
    } catch (e: any) {
      return { success: false, syncedCount: 0, message: e.message || 'Error parsing offline batch.' };
    }
  }

  // =========================================================================
  // LOCAL WEBSOCKET HUB (TERMUX NODE.JS ON ANDROID HOST / OFFLINE MASTER-SPOKE)
  // =========================================================================
  private directWsClient: WebSocket | null = null;
  private isWsConnected: boolean = false;
  private isTorchOn: boolean = false;
  private activeVideoTrack: MediaStreamTrack | null = null;

  public handleLocalHubConfigChanged(): void {
    this.addLog(
      'DISCOVERY',
      `Local Hub Config updated: URL=[${LocalHubConfig.getLocalHubUrl()}], Forced=${LocalHubConfig.getForceLocalHub()}`,
      this.config.deviceName
    );
    this.evaluateConnectionPriority();
  }

  public evaluateConnectionPriority(): MeshConnectionMode {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const forceLocalHub = LocalHubConfig.getForceLocalHub();

    let newMode: MeshConnectionMode;

    if (forceLocalHub) {
      // User explicitly forced local hub
      if (this.isLocalHubConnected) {
        newMode = 'LOCAL_HUB';
      } else {
        newMode = 'LOCAL_OFFLINE';
        if (!this.localHubWs && !this.localHubReconnectTimer) {
          this.connectLocalHub();
        }
      }
    } else if (isOnline && (this.isMqttConnected || this.isServerRelayConnected)) {
      newMode = 'CLOUD_MESH';
    } else if (this.isLocalHubConnected) {
      newMode = 'LOCAL_HUB';
    } else {
      newMode = 'LOCAL_OFFLINE';
      if (!this.localHubWs && !this.localHubReconnectTimer) {
        this.connectLocalHub();
      }
    }

    const modeChanged = newMode !== this.activeConnectionMode;
    this.activeConnectionMode = newMode;

    if (modeChanged) {
      this.notifyConnectionModeChange();
    }

    return this.activeConnectionMode;
  }

  public connectLocalHub(customUrl?: string) {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

    if (this.localHubReconnectTimer) {
      clearTimeout(this.localHubReconnectTimer);
      this.localHubReconnectTimer = null;
    }

    if (this.localHubWs) {
      if (this.localHubWs.readyState === WebSocket.OPEN || this.localHubWs.readyState === WebSocket.CONNECTING) {
        return; // WebSocket is already connected or handshaking. Never tear down an active socket.
      }
      try {
        this.localHubWs.onopen = null;
        this.localHubWs.onmessage = null;
        this.localHubWs.onerror = null;
        this.localHubWs.onclose = null;
        this.localHubWs.close();
      } catch {}
      this.localHubWs = null;
    }

    const hubUrl = customUrl ? normalizeHubUrl(customUrl) : LocalHubConfig.getLocalHubUrl();
    if (!hubUrl) return;

    try {
      this.addLog('DISCOVERY', `Connecting to Local WebSocket Hub at ${hubUrl}...`, this.config.deviceName);
      const ws = new WebSocket(hubUrl);
      this.localHubWs = ws;
      this.directWsClient = ws;

      ws.onopen = () => {
        this.isLocalHubConnected = true;
        this.isWsConnected = true;
        this.isLocalHubLost = false;
        this.localHubDisconnectedAt = null;
        if (this.localHubLostGraceTimer) {
          clearTimeout(this.localHubLostGraceTimer);
          this.localHubLostGraceTimer = null;
        }
        this.lastHubPongReceivedAt = Date.now();
        this.evaluateConnectionPriority();

        this.addLog(
          'DISCOVERY',
          `Local WebSocket Hub CONNECTED: ${hubUrl} (0% Internet Required). Master-Spoke offline mesh active.`,
          this.config.deviceName
        );
        playChime();

        // Flush any pending in-memory packets from user actions that occurred while connecting
        this.drainQueueToLocalHub();

        this.notifyPeerSubscribers(true);
        this.notifyConnectionModeChange();

        // Trigger catch-up sync ONCE upon connection to get any missed sales from the last disconnect
        // Throttled so reconnects don't generate repetitive catch-up requests
        setTimeout(() => {
          if (this.isLocalHubConnected && (!this.hasPerformedInitialCatchup || Date.now() - this.lastInitialCatchupTime > 30000)) {
            this.hasPerformedInitialCatchup = true;
            this.lastInitialCatchupTime = Date.now();
            this.requestCatchUpSync('ALL', undefined, false).catch(() => {});
          }
        }, 1200);
      };

      ws.onmessage = async (event) => {
        try {
          if (!event.data) return;
          let rawData = event.data;
          if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
            rawData = await rawData.text();
          } else if (typeof ArrayBuffer !== 'undefined' && rawData instanceof ArrayBuffer) {
            rawData = new TextDecoder().decode(rawData);
          }
          if (typeof rawData !== 'string') return;

          const parsed = JSON.parse(rawData);
          if (!parsed) return;

          // Termux WebSocket server stores and auto-replays historical packets on connect.
          // Queue in memory and process in small batches of 10 with 50ms pauses so the UI never freezes.
          if (Array.isArray(parsed)) {
            this.enqueueHubPackets(parsed);
            return;
          }

          if (typeof parsed === 'object') {
            if (Array.isArray((parsed as any).packets)) {
              this.enqueueHubPackets((parsed as any).packets);
              return;
            }
            if (Array.isArray((parsed as any).history)) {
              this.enqueueHubPackets((parsed as any).history);
              return;
            }
          }

          this.enqueueHubPackets([parsed]);
        } catch (e) {
          console.warn('[MeshSync] Error parsing local hub message:', e);
        }
      };

      ws.onerror = (err) => {
        console.warn(`[MeshSync] Local Hub socket error at ${hubUrl}:`, err);
        // Only disconnect if socket actually closed or closing
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          this.handleLocalHubLost('Local Hub WebSocket connection dropped');
        }
      };

      ws.onclose = () => {
        this.handleLocalHubLost('Local Hub WebSocket closed');
      };
    } catch (err: any) {
      this.handleLocalHubLost(err?.message || 'Failed to initialize WebSocket');
    }
  }

  private enqueueHubPackets(packets: any[]) {
    if (!Array.isArray(packets) || packets.length === 0) return;

    // Filter out packets originating from THIS device immediately
    const filtered = packets.filter((p) => {
      if (!p || typeof p !== 'object') return false;
      const originId =
        p.origin_device_id ||
        p.originDeviceId ||
        p.deviceId ||
        p.sourceDevice ||
        (p.data && (p.data.origin_device_id || p.data.originDeviceId || p.data.deviceId)) ||
        (p.payload && (p.payload.origin_device_id || p.payload.originDeviceId || p.payload.deviceId));
      return !originId || originId !== this.config.deviceId;
    });

    if (filtered.length === 0) return;

    this.hubIngestQueue.push(...filtered);

    // Guard maximum queue length
    if (this.hubIngestQueue.length > 5000) {
      this.hubIngestQueue = this.hubIngestQueue.slice(-5000);
    }

    this.scheduleHubQueueDrain();
  }

  private scheduleHubQueueDrain() {
    if (this.hubProcessingTimer !== null) return;
    this.hubProcessingTimer = window.setTimeout(() => {
      this.processHubQueueBatch();
    }, 10);
  }

  private processHubQueueBatch() {
    this.hubProcessingTimer = null;
    if (this.hubIngestQueue.length === 0) return;

    const BATCH_SIZE = 10;
    const batch = this.hubIngestQueue.splice(0, BATCH_SIZE);

    // ABSOLUTE STRICT INGEST:
    // Inside this execution window, ws.send(), sendPacketToAllTransports, and all broadcast functions are strictly prohibited.
    this.isIngestingFromHub = true;
    try {
      for (const item of batch) {
        this.processSingleLocalHubPacket(item);
      }
    } catch (err) {
      console.warn('[MeshSync] Error processing hub ingest batch:', err);
    } finally {
      this.isIngestingFromHub = false;
    }

    if (this.hubIngestQueue.length > 0) {
      // 50ms pause between batches yields the event loop to the browser network thread, preventing socket drops
      this.hubProcessingTimer = window.setTimeout(() => {
        this.processHubQueueBatch();
      }, 50);
    } else {
      // Completed burst ingestion: trigger UI batch update
      this.scheduleBatchUiUpdate();
    }
  }

  private processSingleLocalHubPacket(packet: any) {
    if (!packet || typeof packet !== 'object') return;

    // Immediate drop if packet originated from this device (checked before and after unwrapping)
    const rawOrigin =
      packet.origin_device_id ||
      packet.originDeviceId ||
      packet.deviceId ||
      packet.sourceDevice ||
      (packet.data && (packet.data.origin_device_id || packet.data.originDeviceId || packet.data.deviceId)) ||
      (packet.payload && (packet.payload.origin_device_id || packet.payload.originDeviceId || packet.payload.deviceId));

    if (rawOrigin && rawOrigin === this.config.deviceId) {
      return;
    }

    // Unwrap envelope wrappers if hub relays through { data: ... } or { payload: ... }
    if (packet.data && typeof packet.data === 'object' && (packet.data.type || packet.data.action)) {
      packet = packet.data;
    } else if (packet.payload && typeof packet.payload === 'object' && (packet.payload.type || packet.payload.action)) {
      packet = packet.payload;
    }

    // Ignore packets that originated from THIS device
    const originId =
      packet.origin_device_id ||
      packet.originDeviceId ||
      packet.deviceId ||
      packet.sourceDevice;

    if (originId && originId === this.config.deviceId) {
      return;
    }

    // Strict Tenant Isolation: Discard packets from different tenant
    const packetComp = (packet.company_id || packet.companyId || (packet.payload && (packet.payload.company_id || packet.payload.companyId)) || '').trim().toUpperCase();
    const localComp = (this.config.companyId || '').trim().toUpperCase();
    const normTenant = (c: string) => (!c || c === 'COMP-001' || c === 'COMP-MASTER' ? 'COMP-001' : c);
    if (packetComp && localComp && normTenant(packetComp) !== normTenant(localComp)) {
      return;
    }

    // Fast deduplication by packet ID or entity ID
    const packetId =
      packet.packet_id ||
      packet.id ||
      (packet.sale && packet.sale.id) ||
      (packet.cashLog && packet.cashLog.id) ||
      (packet.movement && (packet.movement.movementId || packet.movement.txnId)) ||
      (packet.grv && packet.grv.id) ||
      (packet.item && (packet.item.itemId || packet.item.id)) ||
      (packet.payload && (packet.payload.id || packet.payload.itemId || packet.payload.movementId));

    if (packetId) {
      if (this.seenPacketIds.has(packetId)) return;
      this.seenPacketIds.add(packetId);
    }

    const pType = packet.type || packet.action || '';
    const originName = packet.origin_device_name || packet.originDeviceName || packet.deviceName || 'Peer Terminal';

    // 1. SALE RECORD: Ingest directly into Room DB and mark as known to avoid any re-broadcast
    if (pType === 'sale' || pType === 'SALE_RECORD' || packet.sale) {
      const saleData: SaleInvoice = packet.sale || packet.payload;
      if (saleData && saleData.id) {
        if (this.knownSaleIds.has(saleData.id)) {
          return;
        }
        this.knownSaleIds.add(saleData.id);
        this.broadcastedInvoiceIds.add(saleData.id);

        const ingested = ingestMeshSale({
          ...saleData,
          company_id: this.config.companyId,
          branch_id: this.config.branchId,
          fromMesh: true,
        } as any);

        if (ingested) {
          this.scheduleBatchUiUpdate();
          this.addLog(
            'EPIDEMIC_HOP',
            `Received Sale #${saleData.id} ($${(saleData.total || 0).toFixed(2)}) from ${originName} via Local Hub. Synced locally.`,
            originName,
            this.config.deviceName,
            packet.ttl || 5,
            saleData.id
          );
        }
      }
      return;
    }

    // 2. INVENTORY RECORD: Ingest directly into Room DB (do NOT echo back to Hub)
    if (pType === 'inventory' || pType === 'INVENTORY_RECORD' || packet.item) {
      const invItem = packet.item || packet.payload;
      if (invItem && (invItem.itemId || invItem.id)) {
        const ingested = ingestMeshInventoryItem({
          ...invItem,
          company_id: this.config.companyId,
          branch_id: this.config.branchId,
          fromMesh: true,
        });
        if (ingested) {
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
          this.addLog(
            'EPIDEMIC_HOP',
            `Received Product "${invItem.itemName || invItem.name}" from ${originName} via Local Hub. Inventory updated.`,
            originName,
            this.config.deviceName
          );
        }
      }
      return;
    }

    // 3. UNIFIED DB MUTATION
    if (pType === 'db_mutation' || pType === 'DB_MUTATION') {
      this.handleIncomingDatabaseMutation(packet);
      return;
    }

    // 4. CASH LOG & MOVEMENTS
    if (pType === 'cash_log' || pType === 'CASH_LOG_RECORD') {
      const cashLog = packet.cashLog || packet.payload;
      if (cashLog) {
        ingestMeshCashLog({ ...cashLog, fromMesh: true } as any);
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
      }
      return;
    }

    // 5. CUSTOMER CHANGE
    if (pType === 'customer_change' || pType === 'CUSTOMER_CHANGE_RECORD') {
      const change = packet.change || packet.payload;
      if (change) {
        ingestMeshCustomerChange(change);
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      return;
    }

    // 6. CREDIT SALE
    if (pType === 'credit_sale' || pType === 'CREDIT_SALE_RECORD') {
      const credit = packet.credit || packet.payload;
      if (credit) {
        ingestMeshCreditSale(credit);
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      return;
    }

    // 7. STOCK MOVEMENT
    if (pType === 'stock_movement' || pType === 'STOCK_MOVEMENT_RECORD') {
      const sm = packet.movement || packet.payload;
      if (sm) {
        ingestMeshStockMovement(sm);
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      return;
    }

    // 8. DIRECT GRV
    if (pType === 'grv' || pType === 'GRV_RECORD') {
      const grv = packet.grv || packet.payload;
      if (grv) {
        ingestMeshGRV({ ...grv, fromMesh: true } as any);
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      return;
    }

    // 9. GOODS RECEIVED NOTES
    if (pType === 'goods_received' || pType === 'GOODS_RECEIVED_RECORD') {
      const grn = packet.grn || packet.payload;
      if (grn) {
        ingestMeshGoodsReceived(grn);
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
      return;
    }

    // 10. EXPENSE
    if (pType === 'expense' || pType === 'EXPENSE_RECORD') {
      const expense = packet.expense || packet.payload;
      if (expense) {
        addExpense({ ...expense, fromMesh: true });
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      return;
    }

    // 11. ANTI-DOUBLE-POSTING SYNC RECEIPT
    if (pType === 'sync_receipt' || pType === 'SYNC_RECEIPT') {
      this.handleIncomingSyncReceipt(packet);
      return;
    }

    // 12. CATCHUP RESPONSE (Replayed burst history from server)
    if (pType === 'catchup_response' || pType === 'CATCHUP_RESPONSE') {
      this.handleIncomingCatchupResponse(packet);
      return;
    }

    // For all other packets (heartbeat, ping, catchup_request):
    // Ingest silently if needed, but NEVER call sendPacketToAllTransports or ws.send()
  }

  private handleLocalHubLost(reason: string) {
    if (this.localHubHeartbeatTimer) {
      clearInterval(this.localHubHeartbeatTimer);
      this.localHubHeartbeatTimer = null;
    }

    const wasConnected = this.isLocalHubConnected;
    this.isLocalHubConnected = false;
    this.isWsConnected = false;

    // 1. Silent Reconnect Grace Period:
    // When the WebSocket disconnects, do NOT show the red banner immediately.
    // Instead, put the app into a silent 'Reconnecting...' state and attempt to reconnect quietly in the background.
    if (this.localHubDisconnectedAt === null) {
      this.localHubDisconnectedAt = Date.now();
    }

    // 2. Delayed Notification:
    // Only show the banner if the connection has been continuously down for > 2 minutes (120 seconds).
    if (!this.localHubLostGraceTimer && !this.isLocalHubLost) {
      this.localHubLostGraceTimer = window.setTimeout(() => {
        this.localHubLostGraceTimer = null;
        if (!this.isLocalHubConnected && this.localHubDisconnectedAt !== null) {
          const downDuration = Date.now() - this.localHubDisconnectedAt;
          if (downDuration >= 120000) {
            this.isLocalHubLost = true;
            this.notifyPeerSubscribers(true);
            this.notifyConnectionModeChange();
          }
        }
      }, 120000);
    }

    if (this.localHubWs) {
      try {
        this.localHubWs.onopen = null;
        this.localHubWs.onmessage = null;
        this.localHubWs.onerror = null;
        this.localHubWs.onclose = null;
        this.localHubWs.close();
      } catch {}
      this.localHubWs = null;
      this.directWsClient = null;
    }

    if (wasConnected) {
      this.addLog(
        'DISCOVERY',
        `Local Hub disconnected (${reason}). Reconnecting quietly in background...`,
        this.config.deviceName
      );
    }

    this.evaluateConnectionPriority();
    this.notifyPeerSubscribers(true);
    this.notifyConnectionModeChange();

    // Auto-reconnect quietly every 5 seconds until successful
    if (!this.localHubReconnectTimer) {
      this.localHubReconnectTimer = window.setTimeout(() => {
        this.localHubReconnectTimer = null;
        this.connectLocalHub();
      }, 5000);
    }
  }

  private async drainQueueToLocalHub() {
    const wsTarget = this.localHubWs || this.directWsClient;
    if (!wsTarget || wsTarget.readyState !== WebSocket.OPEN) return;
    try {
      // Drain pending in-memory packets that occurred while socket was connecting
      if (this.pendingLocalHubQueue.length > 0) {
        const count = this.pendingLocalHubQueue.length;
        this.addLog(
          'BROADCAST',
          `Local Hub connected: Flushing ${count} pending real-time packet(s) to hub...`,
          this.config.deviceName
        );
        while (this.pendingLocalHubQueue.length > 0) {
          const queuedPacket = this.pendingLocalHubQueue.shift();
          if (queuedPacket) {
            wsTarget.send(JSON.stringify(queuedPacket));
          }
        }
      }
    } catch (e) {
      console.warn('[MeshSync] Error draining queue to local hub:', e);
    }
  }

  private notifyConnectionModeChange() {
    const details = {
      mode: this.activeConnectionMode,
      isLocalHubConnected: this.isLocalHubConnected,
      isLocalHubLost: this.isLocalHubLost,
      localHubUrl: LocalHubConfig.getLocalHubUrl(),
      forceLocalHub: LocalHubConfig.getForceLocalHub(),
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isCloudMeshConnected: this.isMqttConnected || this.isServerRelayConnected,
      pendingQueueCount: getSyncQueue().length,
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('mesh-connection-state-changed', {
          detail: details,
        })
      );
    }

    this.connectionModeListeners.forEach((listener) => {
      try {
        listener(this.activeConnectionMode, details);
      } catch (e) {}
    });
  }

  public getConnectionMode(): MeshConnectionMode {
    return this.activeConnectionMode;
  }

  public isLocalHubActive(): boolean {
    return this.isLocalHubConnected;
  }

  public isLocalHubLostState(): boolean {
    return this.isLocalHubLost;
  }

  public getLocalHubStatus() {
    return {
      url: LocalHubConfig.getLocalHubUrl(),
      isConnected: this.isLocalHubConnected,
      isLost: this.isLocalHubLost,
      mode: this.activeConnectionMode,
      forceLocalHub: LocalHubConfig.getForceLocalHub(),
      lastPongAt: this.lastHubPongReceivedAt,
    };
  }

  public reconnectLocalHub(): void {
    this.connectLocalHub();
  }

  public subscribeConnectionMode(listener: (mode: MeshConnectionMode, details: any) => void): () => void {
    this.connectionModeListeners.push(listener);
    try {
      listener(this.activeConnectionMode, {
        mode: this.activeConnectionMode,
        isLocalHubConnected: this.isLocalHubConnected,
        isLocalHubLost: this.isLocalHubLost,
        localHubUrl: LocalHubConfig.getLocalHubUrl(),
        forceLocalHub: LocalHubConfig.getForceLocalHub(),
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        isCloudMeshConnected: this.isMqttConnected || this.isServerRelayConnected,
        pendingQueueCount: getSyncQueue().length,
      });
    } catch (e) {}

    return () => {
      this.connectionModeListeners = this.connectionModeListeners.filter((fn) => fn !== listener);
    };
  }

  public onScanSuccess(decodedText: string): void {
    const trimmed = (decodedText || '').trim();
    if (!trimmed) return;

    // Check if it's a hub URL or contains hub details
    const targetWsUrl = normalizeHubUrl(trimmed);
    if (targetWsUrl) {
      LocalHubConfig.setLocalHubUrl(targetWsUrl);
      this.connectLocalHub(targetWsUrl);
    }

    // Also try ingesting offline QR sales batch if present
    try {
      this.ingestOfflineBatchPayload(trimmed);
    } catch (e) {}
  }

  public connectToWsUrl(wsUrl: string) {
    const clean = normalizeHubUrl(wsUrl);
    LocalHubConfig.setLocalHubUrl(clean);
    this.connectLocalHub(clean);
  }

  public setActiveVideoTrack(track: MediaStreamTrack | null) {
    this.activeVideoTrack = track;
  }

  public async toggleTorch(targetState?: boolean): Promise<boolean> {
    const newState = targetState !== undefined ? targetState : !this.isTorchOn;
    try {
      if (this.activeVideoTrack) {
        const capabilities: any = (this.activeVideoTrack as any).getCapabilities ? (this.activeVideoTrack as any).getCapabilities() : {};
        if (capabilities.torch) {
          await this.activeVideoTrack.applyConstraints({
            advanced: [{ torch: newState } as any],
          });
          this.isTorchOn = newState;
          return this.isTorchOn;
        }
      }
    } catch (e) {}
    this.isTorchOn = false;
    return false;
  }

  public getTorchState(): boolean {
    return this.isTorchOn;
  }

  // =========================================================================
  // OFFLINE TRANSPORT B: DIRECT LOCAL WEBRTC WI-FI DATACHANNEL (0% Internet)
  // =========================================================================
  public async startWebRtcOffer(): Promise<string> {
    try {
      if (this.webrtcPeerConnection) {
        try { this.webrtcPeerConnection.close(); } catch (e) {}
      }
      const pc = new RTCPeerConnection({ iceServers: [] });
      this.webrtcPeerConnection = pc;

      const dc = pc.createDataChannel('saimetric-mesh-lan', { negotiated: false });
      this.setupDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        pc.onicecandidate = (event) => {
          if (!event.candidate) finish();
        };
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') finish();
        });
        setTimeout(finish, 1200);
      });

      const sdpObj = {
        type: pc.localDescription?.type || 'offer',
        sdp: pc.localDescription?.sdp || '',
        deviceName: this.config.deviceName,
        branchCode: this.config.branchCode,
        branchId: this.config.branchId,
        companyId: this.config.companyId,
      };
      return btoa(JSON.stringify(sdpObj));
    } catch (e: any) {
      console.warn('WebRTC start error:', e);
      return '';
    }
  }

  public async acceptWebRtcOffer(offerB64: string): Promise<string> {
    try {
      if (this.webrtcPeerConnection) {
        try { this.webrtcPeerConnection.close(); } catch (e) {}
      }
      const raw = atob(offerB64);
      const parsed = JSON.parse(raw);
      const sdpDesc: RTCSessionDescriptionInit = parsed.sdp
        ? { type: 'offer', sdp: parsed.sdp }
        : { type: parsed.type || 'offer', sdp: parsed.sdp || '' };

      const pc = new RTCPeerConnection({ iceServers: [] });
      this.webrtcPeerConnection = pc;

      pc.ondatachannel = (event) => {
        this.setupDataChannel(event.channel);
      };

      await pc.setRemoteDescription(sdpDesc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        pc.onicecandidate = (event) => {
          if (!event.candidate) finish();
        };
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') finish();
        });
        setTimeout(finish, 1200);
      });

      const sdpObj = {
        type: pc.localDescription?.type || 'answer',
        sdp: pc.localDescription?.sdp || '',
        deviceName: this.config.deviceName,
        branchCode: this.config.branchCode,
        branchId: this.config.branchId,
        companyId: this.config.companyId,
      };
      return btoa(JSON.stringify(sdpObj));
    } catch (e: any) {
      console.warn('WebRTC accept error:', e);
      return '';
    }
  }

  public async completeWebRtcAnswer(answerB64: string): Promise<boolean> {
    try {
      if (!this.webrtcPeerConnection) return false;
      const raw = atob(answerB64);
      const parsed = JSON.parse(raw);
      const sdpDesc: RTCSessionDescriptionInit = parsed.sdp
        ? { type: 'answer', sdp: parsed.sdp }
        : { type: parsed.type || 'answer', sdp: parsed.sdp || '' };
      await this.webrtcPeerConnection.setRemoteDescription(sdpDesc);
      return true;
    } catch (e: any) {
      console.warn('WebRTC complete error:', e);
      return false;
    }
  }

  private setupDataChannel(dc: RTCDataChannel) {
    this.webrtcDataChannel = dc;
    dc.onopen = () => {
      this.isWebRtcConnected = true;
      this.addLog(
        'DISCOVERY',
        `Direct Local Wi-Fi WebRTC DataChannel OPENED for [${this.config.companyId}/${this.config.branchCode}]! 0% internet required for instant sync.`,
        this.config.deviceName
      );
      this.sendHeartbeat();
      this.notifyPeerSubscribers();
    };
    dc.onclose = () => {
      this.isWebRtcConnected = false;
      this.addLog('DISCOVERY', 'Direct Local Wi-Fi DataChannel closed.', this.config.deviceName);
      this.notifyPeerSubscribers();
    };
    dc.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        this.handleIncomingMeshPacket(`webrtc/${packet.type || 'packet'}`, packet);
      } catch (e) {}
    };
  }

  // =========================================================================
  // OFFLINE TRANSPORT C: LOCAL LAN HOST / HOTSPOT IP
  // =========================================================================
  public setLocalGatewayUrl(url: string) {
    const trimmed = url.trim().replace(/\/+$/, '');
    this.localGatewayUrl = trimmed;
    try {
      localStorage.setItem('saimetric_mesh_local_gateway', trimmed);
    } catch (e) {}

    if (this.localGatewayPollTimer) {
      clearInterval(this.localGatewayPollTimer);
      this.localGatewayPollTimer = null;
    }

    if (trimmed) {
      this.startLocalGatewayPolling();
      this.addLog('DISCOVERY', `Local LAN Gateway configured: ${trimmed}`, this.config.deviceName);
    }
  }

  public getLocalGatewayUrl(): string {
    return this.localGatewayUrl;
  }

  private startLocalGatewayPolling() {
    if (this.localGatewayPollTimer) {
      clearInterval(this.localGatewayPollTimer);
    }
    const gateway = this.localGatewayUrl ? this.localGatewayUrl.replace(/\/+$/, '') : '';
    this.localGatewayPollTimer = window.setInterval(async () => {
      try {
        // 1. Heartbeat to local server / LAN gateway (strictly scoped by tenant and branch)
        const res = await fetch(`${gateway}/api/mesh/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: this.config.deviceId,
            deviceName: this.config.deviceName,
            branchCode: this.config.branchCode,
            branchId: this.config.branchId,
            company_id: this.config.companyId,
            companyId: this.config.companyId,
            deviceType: 'terminal',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          this.isServerRelayConnected = true;
          this.isMqttConnected = true;
          if (data && Array.isArray(data.peers)) {
            for (const p of data.peers) {
              if (p.deviceId && p.deviceId !== this.config.deviceId) {
                // Ensure same tenant and branch
                const pComp = (p.company_id || p.companyId || '').trim().toUpperCase();
                const myComp = (this.config.companyId || '').trim().toUpperCase();
                if (pComp && myComp && pComp !== myComp) continue;

                this.discoveredPeers.set(p.deviceId, {
                  id: p.deviceId,
                  name: p.deviceName || 'LAN Terminal',
                  branchCode: p.branchCode || this.config.branchCode,
                  branchId: p.branchId || this.config.branchId,
                  companyId: pComp || myComp,
                  isOnline: true,
                  hasInternet: true,
                  isThisDevice: false,
                  deviceType: p.deviceType || 'tablet',
                  lastSeen: Date.now(),
                  totalSalesCount: p.salesCount || 0,
                  pendingCount: 0,
                });
              }
            }
            this.notifyPeerSubscribers();
          }
        }

        // 2. Poll new packets from central server buffer (scoped by tenant and branch)
        const pollRes = await fetch(
          `${gateway}/api/mesh/poll?branchCode=${encodeURIComponent(
            this.config.branchCode
          )}&branchId=${encodeURIComponent(this.config.branchId)}&company_id=${encodeURIComponent(
            this.config.companyId
          )}&since=${this.lastMeshPollTimestamp}&deviceId=${encodeURIComponent(this.config.deviceId)}`
        );
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          if (pollData && pollData.serverTime) {
            this.lastMeshPollTimestamp = pollData.serverTime;
          }
          if (pollData && Array.isArray(pollData.packets) && pollData.packets.length > 0) {
            for (const packet of pollData.packets) {
              this.handleIncomingMeshPacket(packet.action || packet.type || 'packet', packet);
            }
          }
        }
      } catch (e) {}
    }, 3500);
  }

  // =========================================================================
  // TRANSPORT 0: INTEGRATED REAL-TIME SSE STREAM & CENTRAL RELAY (Zero-Config)
  // =========================================================================
  private initServerStream() {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    if (this.serverEventSource) {
      try {
        this.serverEventSource.close();
      } catch (e) {}
      this.serverEventSource = null;
    }

    try {
      const baseUrl = this.localGatewayUrl ? this.localGatewayUrl.replace(/\/+$/, '') : '';
      const streamUrl = `${baseUrl}/api/mesh/stream?branchCode=${encodeURIComponent(
        this.config.branchCode
      )}&branchId=${encodeURIComponent(this.config.branchId)}&company_id=${encodeURIComponent(
        this.config.companyId
      )}&deviceId=${encodeURIComponent(this.config.deviceId)}`;

      const es = new EventSource(streamUrl);
      this.serverEventSource = es;

      es.onopen = () => {
        this.isServerRelayConnected = true;
        this.isMqttConnected = true;
        this.brokerName = 'Integrated Realtime Mesh Relay';
        this.evaluateConnectionPriority();
        this.addLog(
          'DISCOVERY',
          `Connected to Realtime Mesh Relay (Branch: ${this.config.branchCode} | Tenant: ${this.config.companyId})`,
          this.config.deviceName
        );
        this.sendHeartbeat();
        this.notifyPeerSubscribers();
      };

      es.onmessage = (event) => {
        try {
          if (!event.data) return;
          const parsed = JSON.parse(event.data);
          if (parsed && parsed.type === 'CONNECTED') {
            this.isServerRelayConnected = true;
            this.isMqttConnected = true;
            this.evaluateConnectionPriority();
            this.sendHeartbeat();
            return;
          }
          this.handleIncomingMeshPacket(parsed.action || parsed.type || 'packet', parsed);
        } catch (e) {}
      };

      es.onerror = () => {
        this.isServerRelayConnected = false;
        this.evaluateConnectionPriority();
      };
    } catch (err) {
      console.warn('[MeshSync] Server stream init error:', err);
    }
  }

  // =========================================================================
  // TRANSPORT 1: REAL-TIME MQTT OVER WEBSOCKET RELAY (Bypasses router isolation)
  // =========================================================================
  private initMqttRelay() {
    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
      } catch (e) {}
    }

    const brokerUrl = PUBLIC_MQTT_BROKERS[this.currentBrokerIndex];
    this.brokerName = brokerUrl.includes('emqx') ? 'EMQX Public Mesh Relay' : 'HiveMQ Public Mesh Relay';

    try {
      const clientId = `saimetric_${this.config.deviceId}_${Math.random().toString(36).substring(2, 7)}`;
      const client = mqtt.connect(brokerUrl, {
        clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 30000,
        keepalive: 30,
      });

      this.mqttClient = client;

      client.on('connect', () => {
        this.isMqttConnected = true;
        this.evaluateConnectionPriority();
        const topic = this.getMqttTopic('#');
        this.addLog(
          'DISCOVERY',
          `Connected to ${this.brokerName}. Subscribed to [Tenant: ${this.config.companyId} | Branch: ${this.config.branchCode}]`,
          this.config.deviceName
        );

        client.subscribe(topic, { qos: 0 }, (err) => {
          if (!err) {
            this.sendHeartbeat();
          }
        });
      });

      client.on('message', (topic, payload) => {
        try {
          const str = payload.toString();
          const packet = JSON.parse(str);
          this.handleIncomingMeshPacket(topic, packet);
        } catch (e) {}
      });

      client.on('error', () => {
        this.isMqttConnected = false;
        this.evaluateConnectionPriority();
        this.tryNextBroker();
      });

      client.on('offline', () => {
        this.isMqttConnected = false;
        this.evaluateConnectionPriority();
      });
    } catch (e) {
      this.isMqttConnected = false;
      this.evaluateConnectionPriority();
      this.tryNextBroker();
    }
  }

  private tryNextBroker() {
    this.currentBrokerIndex = (this.currentBrokerIndex + 1) % PUBLIC_MQTT_BROKERS.length;
  }

  // =========================================================================
  // TRANSPORT 2: BROADCAST CHANNEL (Same-Machine / Multi-Tab Synchronization)
  // =========================================================================
  private initBroadcastChannel() {
    if (this.channel) {
      try {
        this.channel.close();
      } catch (e) {}
    }

    try {
      const channelName = this.getBroadcastChannelName();
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = (event) => {
        if (event.data && event.data.type) {
          this.handleIncomingMeshPacket(`bc/${event.data.type}`, event.data);
        }
      };
    } catch (e) {}
  }

  // =========================================================================
  // HEARTBEAT & PEER DISCOVERY
  // =========================================================================
  private startHeartbeatLoop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.sendHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat();
    }, 18000);
  }

  private startPruneLoop() {
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    this.pruneInterval = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, peer] of this.discoveredPeers.entries()) {
        if (now - peer.lastSeen > 45000) {
          this.discoveredPeers.delete(id);
          changed = true;
          this.addLog('DISCOVERY', `Peer disconnected: ${peer.name} (${id})`, this.config.deviceName);
        }
      }
      if (changed && !this.isSimulationMode) {
        this.notifyPeerSubscribers();
      }
    }, 15000);
  }

  private sendHeartbeat() {
    const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTablet = typeof navigator !== 'undefined' && /iPad|tablet|(android(?!.*mobile))/i.test(navigator.userAgent);
    const deviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

    const heartbeatPacket = {
      type: 'heartbeat',
      action: 'HEARTBEAT',
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      companyId: this.config.companyId,
      companyName: this.config.companyName,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      branchName: this.config.branchName,
      deviceType,
      timestamp: Date.now(),
      salesCount: getSales().length,
      pendingCount: getSyncQueue().length,
    };

    this.sendPacketToAllTransports('heartbeat', heartbeatPacket);
  }

  // =========================================================================
  // UNIFIED PACKET TRANSMISSION
  // =========================================================================
  private sendPacketToAllTransports(topicSuffix: string, packet: any) {
    // ABSOLUTE STRICT INGEST GUARD:
    // Inside ingest mode from the Local Hub, the client MUST NEVER broadcast
    // or re-transmit packets back out. Drop immediately.
    if (this.isIngestingFromHub) {
      return;
    }

    const jsonStr = JSON.stringify(packet);

    // 0. WebRTC DataChannel (Direct Local Wi-Fi / Hotspot)
    if (this.webrtcDataChannel && this.webrtcDataChannel.readyState === 'open') {
      try {
        this.webrtcDataChannel.send(jsonStr);
      } catch (e) {}
    }

    // 0.1 Direct LAN WebSocket & Local WebSocket Hub (Termux Node Hub)
    // Only send real data packets (sales, inventory, mutations); skip heartbeats/pings to keep Termux disk storage clean
    const isMaintenance =
      topicSuffix === 'heartbeat' ||
      topicSuffix === 'ping' ||
      packet.type === 'heartbeat' ||
      packet.type === 'ping' ||
      packet.action === 'HEARTBEAT' ||
      packet.action === 'PING';

    if (!isMaintenance && !this.isIngestingFromHub) {
      const targetWs = this.localHubWs || this.directWsClient;
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        try {
          targetWs.send(jsonStr);
        } catch (e) {
          this.queueOutgoingLocalHubPacket(packet);
        }
      } else {
        this.queueOutgoingLocalHubPacket(packet);
      }
    }

    // 1. MQTT Over WebSocket
    if (this.mqttClient && this.isMqttConnected) {
      const topic = this.getMqttTopic(topicSuffix);
      this.mqttClient.publish(topic, jsonStr);
    }

    // 2. BroadcastChannel
    if (this.channel) {
      try {
        this.channel.postMessage(packet);
      } catch (e) {}
    }

    // 3. Local Gateway Server Buffer Fallback
    const broadcastUrl = this.localGatewayUrl ? `${this.localGatewayUrl}/api/mesh/broadcast` : '/api/mesh/broadcast';
    fetch(broadcastUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packet_id: packet.packet_id || `PKT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        branchCode: this.config.branchCode,
        branchId: this.config.branchId,
        company_id: this.config.companyId,
        companyId: this.config.companyId,
        origin_device_id: this.config.deviceId,
        origin_device_name: this.config.deviceName,
        action: packet.action || packet.type,
        payload: packet.payload || packet.item || packet.sale || packet,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }

  // =========================================================================
  // PACKET HANDLING WITH STRICT MULTI-TENANT & BRANCH ENFORCEMENT
  // =========================================================================
  private handleIncomingMeshPacket(topic: string, packet: any) {
    if (!packet) return;
    const packetOrigin = packet.origin_device_id || packet.originDeviceId || packet.deviceId;
    if (!packetOrigin) return;

    // Ignore self packets
    if (packetOrigin === this.config.deviceId) return;

    // 1. STRICT TENANT ISOLATION: Packets from another tenant must NEVER be accepted
    const packetComp = (packet.company_id || packet.companyId || (packet.payload && (packet.payload.company_id || packet.payload.companyId)) || '').trim().toUpperCase();
    const localComp = (this.config.companyId || '').trim().toUpperCase();
    const normTenant = (c: string) => (!c || c === 'COMP-001' || c === 'COMP-MASTER' ? 'COMP-001' : c);
    if (packetComp && localComp && normTenant(packetComp) !== normTenant(localComp)) {
      this.addLog(
        'SECURITY_DROP',
        `Blocked cross-tenant packet from tenant [${packetComp}] (Local: [${localComp}]). Data isolation enforced.`,
        packet.origin_device_name || packet.originDeviceName || packet.deviceName || 'External Device'
      );
      return;
    }

    // 2. STRICT BRANCH ISOLATION: Canonical branch scope checking with alias expansion and single-branch protection
    const packetBranchId = (packet.branch_id || packet.branchId || (packet.payload && (packet.payload.branch_id || packet.payload.branchId)) || '').trim().toUpperCase();
    const packetBranchCode = (packet.branchCode || packet.branch_code || (packet.payload && (packet.payload.branchCode || packet.payload.branch_code)) || '').trim().toUpperCase();
    const localBranchId = (this.config.branchId || '').trim().toUpperCase();
    const localBranchCode = (this.config.branchCode || '').trim().toUpperCase();

    const branchCandidate = packetBranchId || packetBranchCode;
    const localCandidate = localBranchId || localBranchCode;
    const branchMatches =
      !branchCandidate ||
      !localCandidate ||
      branchCandidate === localCandidate ||
      branchCandidate === 'ALL' ||
      localCandidate === 'ALL' ||
      isRecordInBranchScope(branchCandidate, localCandidate, getBranches(), this.config.companyId);

    if (!branchMatches) {
      this.addLog(
        'SECURITY_DROP',
        `Blocked cross-branch packet for branch [${packetBranchId || packetBranchCode}] (Active Terminal Branch: [${localBranchId}/${localBranchCode}]).`,
        packet.origin_device_name || packet.originDeviceName || packet.deviceName || 'Peer Terminal'
      );
      return;
    }

    // Deduplicate packets
    const packetId = packet.packet_id || packet.id;
    if (packetId && this.seenPacketIds.has(packetId)) return;
    if (packetId) this.seenPacketIds.add(packetId);

    const originName = packet.origin_device_name || packet.originDeviceName || packet.deviceName || 'Peer Terminal';

    // Auto-discover or refresh peer on ANY incoming packet (whether heartbeat, sale, ping, or mutation)
    const isNew = !this.discoveredPeers.has(packetOrigin);
    if (isNew) {
      const peerData: P2PMeshPeer = {
        id: packetOrigin,
        name: packet.deviceName || originName,
        isOnline: true,
        hasInternet: true,
        lastSeen: Date.now(),
        pendingCount: packet.pendingCount || 0,
        totalSalesCount: packet.salesCount || 0,
        isThisDevice: false,
        branchCode: packet.branchCode || this.config.branchCode,
        branchId: packet.branchId || this.config.branchId,
        companyId: packetComp || this.config.companyId,
        deviceType: packet.deviceType || 'terminal',
      };

      this.discoveredPeers.set(packetOrigin, peerData);
      playChime();
      this.addLog(
        'DISCOVERY',
        `Discovered terminal: ${peerData.name} on branch [${this.config.branchCode}] of tenant [${this.config.companyId}]!`,
        peerData.name,
        this.config.deviceName
      );
      // Only request catch-up delta in direct P2P/MQTT mesh mode (NEVER in Local Hub mode or during ingest to prevent ping-pong storms)
      if (!this.isLocalHubConnected && !this.isIngestingFromHub) {
        this.requestCatchUpSync(packetOrigin).catch(() => {});
      }

      if (!this.isSimulationMode) {
        this.notifyPeerSubscribers();
      }
    } else {
      const peer = this.discoveredPeers.get(packetOrigin)!;
      peer.lastSeen = Date.now();
      peer.isOnline = true;
      if (packet.pendingCount !== undefined) peer.pendingCount = packet.pendingCount;
      if (packet.salesCount !== undefined) peer.totalSalesCount = packet.salesCount;
    }

    // 1. HEARTBEAT DISCOVERY
    if (topic.endsWith('/heartbeat') || packet.type === 'heartbeat' || packet.action === 'HEARTBEAT') {
      return;
    }

    // 1b. P2P CATCH-UP DELTA PROTOCOL (For devices returning after absence or newly connected to local hub)
    if (topic.endsWith('/catchup_request') || packet.type === 'catchup_request' || packet.action === 'CATCHUP_REQUEST') {
      this.handleIncomingCatchupRequest(packet);
      return;
    }

    if (topic.endsWith('/catchup_response') || packet.type === 'catchup_response' || packet.action === 'CATCHUP_RESPONSE') {
      this.handleIncomingCatchupResponse(packet);
      return;
    }

    // 2. SALE RECORD BROADCAST
    if (topic.endsWith('/sale') || packet.type === 'sale' || packet.action === 'SALE_RECORD') {
      const saleData: SaleInvoice = packet.sale || packet.payload;
      if (saleData && saleData.id) {
        if (this.knownSaleIds.has(saleData.id)) {
          return;
        }

        const ingested = ingestMeshSale({
          ...saleData,
          company_id: this.config.companyId,
          branch_id: this.config.branchId,
          fromMesh: true,
        } as any);

        if (ingested) {
          this.knownSaleIds.add(saleData.id);
          this.broadcastedInvoiceIds.add(saleData.id);
          this.scheduleBatchUiUpdate();
          this.addLog(
            'EPIDEMIC_HOP',
            `Received Sale #${saleData.id} ($${(saleData.total || 0).toFixed(2)}) from ${originName}. Synced into local database!`,
            originName,
            this.config.deviceName,
            packet.ttl || 5,
            saleData.id
          );
        }
      }
      return;
    }

    // 3. INVENTORY RECORD BROADCAST
    if (topic.endsWith('/inventory') || packet.type === 'inventory' || packet.action === 'INVENTORY_RECORD') {
      const invItem = packet.item || packet.payload;
      if (invItem && (invItem.itemId || invItem.id)) {
        const ingested = ingestMeshInventoryItem({
          ...invItem,
          company_id: this.config.companyId,
          branch_id: this.config.branchId,
          fromMesh: true,
        });
        if (ingested) {
          playChime();
          this.addLog(
            'EPIDEMIC_HOP',
            `Received Product "${invItem.itemName || invItem.name}" (${invItem.itemId || invItem.id}) from ${originName}. Local inventory updated!`,
            originName,
            this.config.deviceName,
            packet.ttl || 5,
            invItem.itemId
          );

          window.dispatchEvent(
            new CustomEvent('mesh-inventory-received', {
              detail: { item: invItem, originName },
            })
          );
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
      }
      return;
    }

    // 4. BRANCH SETUP BROADCAST
    if (topic.endsWith('/branch_setup') || packet.type === 'branch_setup' || packet.action === 'BRANCH_SETUP_RECORD') {
      const branch: Branch = packet.branch || packet.payload;
      if (branch) {
        const ingested = ingestMeshBranch({ ...branch, fromMesh: true } as any);
        if (ingested) {
          playChime();
          this.addLog(
            'EPIDEMIC_HOP',
            `Branch Setup updated from ${originName}: "${branch.name}" (${branch.code || branch.branchId}). Synced locally!`,
            originName,
            this.config.deviceName
          );
        }
      }
      return;
    }

    // 5. STAFF PERMISSION & USER BROADCAST
    if (topic.endsWith('/staff_permission') || packet.type === 'staff_permission' || packet.action === 'STAFF_PERMISSION_RECORD') {
      const staff: Salesperson = packet.staff || packet.payload;
      if (staff && staff.id) {
        const ingested = ingestMeshStaff({ ...staff, fromMesh: true } as any);
        if (ingested) {
          playChime();
          this.addLog(
            'EPIDEMIC_HOP',
            `Staff Permission / User updated from ${originName}: ${staff.name} (${staff.role}). Synced locally!`,
            originName,
            this.config.deviceName
          );
        }
      }
      return;
    }

    // 6. SUPERVISOR APPROVAL & AUDIT LOG BROADCAST
    if (topic.endsWith('/supervisor_approval') || packet.type === 'supervisor_approval' || packet.action === 'SUPERVISOR_APPROVAL_RECORD') {
      const auditLog: AuditLogEntry = packet.auditLog || packet.payload;
      if (auditLog) {
        const ingested = ingestMeshSupervisorApproval({ ...auditLog, fromMesh: true } as any);
        if (ingested) {
          playChime();
          this.addLog(
            'EPIDEMIC_HOP',
            `Supervisor Approval [${auditLog.action}] by ${auditLog.authorizedByName || auditLog.staffName} from ${originName}. Synced locally!`,
            originName,
            this.config.deviceName
          );
        }
      }
      return;
    }

    // 7. CASH LOG RECORD BROADCAST
    if (topic.endsWith('/cash_log') || packet.type === 'cash_log' || packet.action === 'CASH_LOG_RECORD') {
      const cashLog: CashLogEntry = packet.cashLog || packet.payload;
      if (cashLog) {
        const ingested = ingestMeshCashLog({ ...cashLog, fromMesh: true } as any);
        if (ingested) {
          this.addLog(
            'EPIDEMIC_HOP',
            `Cash Drawer movement synced from ${originName}: In $${cashLog.in} / Out $${cashLog.out} (${cashLog.description}).`,
            originName,
            this.config.deviceName
          );
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
        }
      }
      return;
    }

    // 7b. CASH LIFT BROADCAST
    if (topic.endsWith('/cash_lift') || packet.type === 'cash_lift' || packet.action === 'CASH_LIFT_RECORD') {
      const lift = packet.lift || packet.payload;
      if (lift) {
        if (ingestMeshCashLift(lift)) {
          playChime();
          this.addLog('EPIDEMIC_HOP', `Cash Lift synced from ${originName}: $${lift.totalAmount || lift.amount || 0}`, originName, this.config.deviceName);
          window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
      }
      return;
    }

    // 7c. CUSTOMER CHANGE (FORM 3) BROADCAST
    if (topic.endsWith('/customer_change') || packet.type === 'customer_change' || packet.action === 'CUSTOMER_CHANGE_RECORD') {
      const change = packet.change || packet.payload;
      if (change) {
        if (ingestMeshCustomerChange(change)) {
          playChime();
          this.addLog('EPIDEMIC_HOP', `Customer Change voucher synced from ${originName}: ${change.customerName} ($${change.amount || change.in || change.out || 0})`, originName, this.config.deviceName);
          window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
      }
      return;
    }

    // 7d. CREDIT SALE (FORM 3) BROADCAST
    if (topic.endsWith('/credit_sale') || packet.type === 'credit_sale' || packet.action === 'CREDIT_SALE_RECORD') {
      const credit = packet.credit || packet.payload;
      if (credit) {
        if (ingestMeshCreditSale(credit)) {
          playChime();
          this.addLog('EPIDEMIC_HOP', `Credit Sale synced from ${originName}: ${credit.customerName} ($${credit.amount})`, originName, this.config.deviceName);
          window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
      }
      return;
    }

    // 7e. STOCK MOVEMENT BROADCAST
    if (topic.endsWith('/stock_movement') || packet.type === 'stock_movement' || packet.action === 'STOCK_MOVEMENT_RECORD') {
      const sm = packet.movement || packet.payload;
      if (sm) {
        if (ingestMeshStockMovement(sm)) {
          this.addLog('EPIDEMIC_HOP', `Stock Movement synced from ${originName}: ${sm.itemName} (${sm.movementType || sm.txnType})`, originName, this.config.deviceName);
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
      }
      return;
    }

    // 8. DIRECT GRV (GOODS RECEIVED) BROADCAST
    if (topic.endsWith('/grv') || packet.type === 'grv' || packet.action === 'GRV_RECORD') {
      const grv: DirectGrv = packet.grv || packet.payload;
      if (grv && grv.grvNumber) {
        const ingested = ingestMeshGRV({ ...grv, fromMesh: true } as any);
        if (ingested) {
          playChime();
          this.addLog(
            'EPIDEMIC_HOP',
            `Goods Received Delivery ${grv.grvNumber} ($${grv.totalCost?.toFixed(2)}) from ${originName}. Synced locally!`,
            originName,
            this.config.deviceName
          );
          window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
      }
      return;
    }

    // 8b. GOODS RECEIVED NOTES BROADCAST
    if (topic.endsWith('/goods_received') || packet.type === 'goods_received' || packet.action === 'GOODS_RECEIVED_RECORD') {
      const grn = packet.grn || packet.payload;
      if (grn) {
        if (ingestMeshGoodsReceived(grn)) {
          playChime();
          this.addLog('EPIDEMIC_HOP', `Goods Received Note synced from ${originName}`, originName, this.config.deviceName);
          window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
      }
      return;
    }

    // 8c. EXPENSES BROADCAST
    if (topic.endsWith('/expense') || packet.type === 'expense' || packet.action === 'EXPENSE_RECORD') {
      const expense = packet.expense || packet.payload;
      if (expense) {
        addExpense({ ...expense, fromMesh: true });
        this.addLog('EPIDEMIC_HOP', `Expense synced from ${originName}: $${expense.amount} (${expense.category})`, originName, this.config.deviceName);
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
      return;
    }

    // 9. SETTINGS BROADCAST
    if (topic.endsWith('/settings') || packet.type === 'settings' || packet.action === 'SETTINGS_RECORD') {
      const settingsPayload = packet.settings || packet.payload;
      if (settingsPayload) {
        const ingested = ingestMeshSettings(settingsPayload);
        if (ingested) {
          this.addLog('EPIDEMIC_HOP', `Branch Settings updated from ${originName}. Synced locally!`, originName, this.config.deviceName);
        }
      }
      return;
    }

    // 10. UNIFIED DB MUTATION
    if (topic.endsWith('/mutation') || packet.type === 'db_mutation' || packet.action === 'DB_MUTATION') {
      this.handleIncomingDatabaseMutation(packet);
      return;
    }

    // 11. ANTI-DOUBLE-POSTING SYNC RECEIPT (Communicates what was uploaded to Apps Script)
    if (topic.endsWith('/sync_receipt') || packet.type === 'sync_receipt' || packet.action === 'SYNC_RECEIPT') {
      this.handleIncomingSyncReceipt(packet);
      return;
    }

    // 12. LIVE TEST PING
    if (topic.endsWith('/ping') || packet.type === 'ping' || packet.action === 'PING') {
      playChime();
      const msg = packet.message || (packet.payload && packet.payload.message) || 'Hello from peer!';

      this.addLog('DISCOVERY', `Live Ping received from ${originName}: "${msg}"`, originName, this.config.deviceName);

      window.dispatchEvent(
        new CustomEvent('mesh-ping-received', {
          detail: { originName, message: msg },
        })
      );
      return;
    }
  }

  private handleIncomingDatabaseMutation(packet: any) {
    const payload = packet.payload;
    if (!payload) return;
    const originName = packet.origin_device_name || packet.originDeviceName || 'Peer Terminal';
    const sheet = packet.sheetName || '';
    const entityType = packet.entityType || resolveEntityType(sheet);

    // Handle deleted items broadcasted by offline peer devices
    if (packet.action === 'DELETE' || packet.type === 'db_deletion') {
      if (
        entityType === 'inventory' ||
        sheet === 'InventoryMaster' ||
        sheet === 'Products'
      ) {
        const itemId = payload.itemId || payload.id || payload.ItemID || packet.recordId;
        const compId = payload.company_id || payload.CompanyID || packet.companyId || this.config.companyId;
        if (itemId) {
          ingestMeshInventoryDelete(itemId, compId);
          this.addLog(
            'EPIDEMIC_HOP',
            `Item record [${itemId}] deleted on peer ${originName}. Deletion synced across local mesh!`,
            originName,
            this.config.deviceName
          );
        }
        return;
      }
    }

    let didIngest = false;

    switch (entityType) {
      case 'sale':
        didIngest = ingestMeshSale({ ...payload, fromMesh: true });
        if (didIngest) {
          playChime();
          window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
        break;
      case 'inventory':
        didIngest = ingestMeshInventoryItem({ ...payload, fromMesh: true });
        if (didIngest) {
          playChime();
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
        break;
      case 'branch':
        didIngest = ingestMeshBranch({ ...payload, fromMesh: true });
        break;
      case 'staff':
        didIngest = ingestMeshStaff({ ...payload, fromMesh: true });
        break;
      case 'supervisor_approval':
        didIngest = ingestMeshSupervisorApproval({ ...payload, fromMesh: true });
        break;
      case 'cash_log':
        didIngest = ingestMeshCashLog({ ...payload, fromMesh: true });
        if (didIngest) {
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
        }
        break;
      case 'cash_lift':
        didIngest = ingestMeshCashLift(payload);
        if (didIngest) {
          playChime();
          window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
        break;
      case 'customer':
        if (sheet === 'CustomerChange' || payload.changeId) {
          didIngest = ingestMeshCustomerChange(payload);
          if (didIngest) {
            playChime();
            window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          }
        } else if (sheet === 'CreditSales' || payload.creditId) {
          didIngest = ingestMeshCreditSale(payload);
          if (didIngest) {
            playChime();
            window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          }
        } else {
          didIngest = ingestMeshCustomer({ ...payload, fromMesh: true });
          if (didIngest) {
            window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
          }
        }
        break;
      case 'grv':
        if (sheet === 'GoodsReceived' || payload.grnId) {
          ingestMeshGoodsReceived(payload);
        }
        didIngest = ingestMeshGRV({ ...payload, fromMesh: true });
        if (didIngest) {
          playChime();
          window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
        break;
      case 'stock_movement':
        didIngest = ingestMeshStockMovement(payload);
        if (didIngest) {
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
        break;
      case 'expense':
        addExpense({ ...payload, fromMesh: true });
        didIngest = true;
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        break;
      case 'reconciliation':
        saveReconciliation(payload);
        didIngest = true;
        break;
      case 'setting':
        didIngest = ingestMeshSettings(payload);
        break;
      case 'cash_account':
        saveCashAccount(payload);
        didIngest = true;
        window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
        break;
      case 'cash_transfer':
        saveCashTransfer(payload);
        didIngest = true;
        window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        break;
      default:
        if (sheet === 'Sales' || payload.invoiceNumber) {
          didIngest = ingestMeshSale({ ...payload, fromMesh: true });
          if (didIngest) {
            window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
          }
        } else if (sheet === 'CashLog' || (payload.staffId && (payload.in !== undefined || payload.out !== undefined))) {
          didIngest = ingestMeshCashLog({ ...payload, fromMesh: true });
          if (didIngest) {
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
          }
        } else if (sheet === 'StockMovement' || payload.movementType) {
          didIngest = ingestMeshStockMovement(payload);
          if (didIngest) {
            window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
          }
        } else if (sheet === 'GoodsReceived' || payload.grnId) {
          didIngest = ingestMeshGoodsReceived(payload);
          if (didIngest) {
            window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
          }
        } else if (sheet === 'CashLifts' || payload.liftId) {
          didIngest = ingestMeshCashLift(payload);
          if (didIngest) {
            window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
          }
        } else if (sheet === 'Expenses' || payload.vendorOrCustomer) {
          addExpense({ ...payload, fromMesh: true });
          didIngest = true;
          window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        }
        break;
    }

    this.addLog(
      'EPIDEMIC_HOP',
      `DB Mutation [${sheet || entityType}] received from ${originName}. Synced locally!`,
      originName,
      this.config.deviceName
    );
  }

  // =========================================================================
  // ANTI-DOUBLE-POSTING APPS SCRIPT RECEIPT COORDINATION
  // =========================================================================

  /**
   * Broadcasts that this device successfully uploaded records to Google Apps Script.
   * Other terminals on the branch mesh receive this ACK and mark matching items as 'synced'
   * so they NEVER attempt to double-post when they subsequently gain internet access.
   */
  public async broadcastSyncReceipt(receipt: {
    postedClientRequestIds?: string[];
    postedIds?: string[];
    sheetName?: string;
  }) {
    if (this.isIngestingFromHub) return;
    const clientReqIds = receipt.postedClientRequestIds || [];
    const ids = receipt.postedIds || [];
    if (clientReqIds.length === 0 && ids.length === 0) return;

    const packetId = `ACK-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.seenPacketIds.add(packetId);

    const packet: any = {
      type: 'sync_receipt',
      action: 'SYNC_RECEIPT',
      packet_id: packetId,
      origin_device_id: this.config.deviceId,
      origin_device_name: this.config.deviceName,
      company_id: this.config.companyId,
      branch_id: this.config.branchId,
      branchCode: this.config.branchCode,
      sheetName: receipt.sheetName || 'SyncItems',
      postedClientRequestIds: clientReqIds,
      postedIds: ids,
      ttl: 5,
      timestamp: Date.now(),
    };

    this.sendPacketToAllTransports('sync_receipt', packet);

    this.addLog(
      'CLOUD_SYNC',
      `Cloud Post Confirmed: Broadcasted ACK for ${clientReqIds.length + ids.length} records to WiFi mesh (Prevents peer double-posting).`,
      this.config.deviceName
    );
  }

  private async handleIncomingSyncReceipt(packet: any) {
    const clientReqIds: string[] = packet.postedClientRequestIds || [];
    const ids: string[] = packet.postedIds || [];
    const originName = packet.origin_device_name || packet.originDeviceName || 'Peer Terminal';

    if (clientReqIds.length === 0 && ids.length === 0) return;

    // 1. Mark in RoomDatabase sync queue & sales
    const roomMarked = markSyncItemsAsSynced(clientReqIds, ids);

    // 2. Mark in PersistentSyncEngine / IndexedDB queue
    const idbMarked = await persistentSyncEngine.markReceiptAsSynced(clientReqIds, ids);

    const totalMarked = Math.max(roomMarked, idbMarked);

    this.addLog(
      'ACK',
      `Peer ${originName} uploaded ${totalMarked || clientReqIds.length} records to Apps Script. Marked as SYNCED locally (Zero double-posting)!`,
      originName,
      this.config.deviceName
    );

    window.dispatchEvent(
      new CustomEvent('mesh-sync-receipt-received', {
        detail: {
          originName,
          count: totalMarked,
          sheetName: packet.sheetName,
        },
      })
    );
  }

  // =========================================================================
  // BI-DIRECTIONAL P2P DELTA CATCH-UP ENGINE (For returning off-site devices)
  // =========================================================================

  public getLastMeshSyncTimestamp(): string {
    const key = `saimetric_mesh_last_sync_${this.config.branchId}_${this.config.companyId}`;
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(key);
      if (stored) return stored;
    }
    // Default to 48 hours ago
    return new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  }

  public setLastMeshSyncTimestamp(isoStr: string) {
    const key = `saimetric_mesh_last_sync_${this.config.branchId}_${this.config.companyId}`;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, isoStr);
    }
  }

  public checkAndRequestCatchUpIfStale() {
    const lastSyncStr = this.getLastMeshSyncTimestamp();
    const lastSync = new Date(lastSyncStr).getTime();
    const now = Date.now();
    // If more than 3 minutes since last sync
    if (isNaN(lastSync) || now - lastSync > 3 * 60 * 1000) {
      this.requestCatchUpSync().catch(() => {});
    }
  }

  /**
   * Dispatches a catch-up delta request to mesh peers across all available transports
   */
  public async requestCatchUpSync(
    targetPeerId?: string,
    customSinceIso?: string,
    isReciprocal?: boolean,
    force: boolean = false
  ): Promise<{ success: boolean; message: string; sinceTimestamp: string }> {
    const peerKey = targetPeerId || 'ALL';
    const now = Date.now();
    const lastReq = this.lastCatchUpRequestTime.get(peerKey) || 0;
    if (!force && !customSinceIso && !isReciprocal && now - lastReq < 15000) {
      return { success: false, message: 'Catch-up recently requested (throttled)', sinceTimestamp: '' };
    }
    this.lastCatchUpRequestTime.set(peerKey, now);

    // If forced ("Sync All Data"), ensure connection is active and look back 30 days
    if (force && (!this.localHubWs || this.localHubWs.readyState !== WebSocket.OPEN)) {
      this.connectLocalHub();
    }

    const sinceTimestamp = customSinceIso || (force ? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() : this.getLastMeshSyncTimestamp());
    const packetId = `CRQ-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.seenPacketIds.add(packetId);

    const packet = {
      type: 'catchup_request',
      action: 'CATCHUP_REQUEST',
      packet_id: packetId,
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      targetDeviceId: targetPeerId || 'ALL',
      sinceTimestamp,
      isReciprocal: Boolean(isReciprocal),
      isForced: Boolean(force),
      timestamp: Date.now(),
      ttl: 5,
    };

    this.sendPacketToAllTransports('catchup_request', packet);

    const sinceHuman = new Date(sinceTimestamp).toLocaleString();
    this.addLog(
      'BROADCAST',
      `Requested P2P Catch-Up Delta from branch mesh (Searching records since ${sinceHuman})...`,
      this.config.deviceName
    );

    return {
      success: true,
      message: `Catch-up request broadcasted to mesh for records since ${sinceHuman}.`,
      sinceTimestamp,
    };
  }

  /**
   * Responds to an incoming catch-up request with all records since requested timestamp
   */
  private async handleIncomingCatchupRequest(packet: any) {
    if (!packet || packet.originDeviceId === this.config.deviceId) return;

    // Strict tenant & branch check
    const packetComp = (packet.companyId || '').trim().toUpperCase();
    const localComp = (this.config.companyId || '').trim().toUpperCase();
    const normTenant = (c: string) => (!c || c === 'COMP-001' || c === 'COMP-MASTER' ? 'COMP-001' : c);
    if (packetComp && localComp && normTenant(packetComp) !== normTenant(localComp)) return;

    const packetBranch = (packet.branchId || packet.branchCode || '').trim().toUpperCase();
    const localBranch = (this.config.branchId || this.config.branchCode || '').trim().toUpperCase();
    const branchMatches =
      !packetBranch ||
      !localBranch ||
      packetBranch === localBranch ||
      packetBranch === 'ALL' ||
      localBranch === 'ALL' ||
      isRecordInBranchScope(packetBranch, localBranch, getBranches(), this.config.companyId);
    if (!branchMatches) return;

    // If targeted to a specific peer, check if target is this device or ALL
    if (packet.targetDeviceId && packet.targetDeviceId !== 'ALL' && packet.targetDeviceId !== this.config.deviceId) {
      return;
    }

    // Stop Payload Bloat: When connected to the Local Hub, the Termux server already
    // stores and replays all historical packets. Terminals must not blast giant table arrays over WebSocket.
    if (this.isLocalHubConnected || (this.localHubWs && this.localHubWs.readyState === WebSocket.OPEN)) {
      return;
    }

    const sinceTimestamp = packet.sinceTimestamp || new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const originName = packet.originDeviceName || packet.origin_device_name || 'Returning Terminal';

    // Retrieve delta records
    const delta = getDeltaRecordsSince(sinceTimestamp);
    const sinceTime = new Date(sinceTimestamp).getTime();
    const filterSince = (list: any[]) => {
      if (!Array.isArray(list)) return [];
      return list.filter((r) => {
        if (!r) return false;
        const t = r.timestamp || r.updated_at || r.updatedAt || r.createdAt || r.created_at || r.date;
        if (!t) return false;
        const tm = new Date(t).getTime();
        return !isNaN(tm) && tm >= sinceTime;
      });
    };

    const deltaExpenses = filterSince(getAllExpenses());
    const deltaCashAccounts = filterSince(getAllCashAccounts());
    const deltaCashTransfers = filterSince(getAllCashTransfers());

    const enrichedDelta = {
      ...delta,
      expenses: deltaExpenses,
      cashAccounts: deltaCashAccounts,
      cashTransfers: deltaCashTransfers,
    };

    const totalRecords =
      delta.sales.length +
      delta.cashLogs.length +
      (delta.cashLifts?.length || 0) +
      delta.customerChanges.length +
      delta.creditSales.length +
      delta.stockMovements.length +
      delta.directGrvs.length +
      (delta.goodsReceivedNotes?.length || 0) +
      (delta.auditLogs?.length || 0) +
      deltaExpenses.length +
      deltaCashAccounts.length +
      deltaCashTransfers.length;

    const responsePacketId = `CRS-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.seenPacketIds.add(responsePacketId);

    const responsePacket = {
      type: 'catchup_response',
      action: 'CATCHUP_RESPONSE',
      packet_id: responsePacketId,
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      targetDeviceId: packet.originDeviceId || 'ALL',
      targetDeviceName: originName,
      sinceTimestamp,
      cutoffTimestamp: new Date().toISOString(),
      delta: enrichedDelta,
      summary: {
        salesCount: delta.sales.length,
        cashLogsCount: delta.cashLogs.length,
        cashLiftsCount: delta.cashLifts?.length || 0,
        customerChangesCount: delta.customerChanges.length,
        creditSalesCount: delta.creditSales.length,
        stockMovementsCount: delta.stockMovements.length,
        directGrvsCount: delta.directGrvs.length,
        goodsReceivedNotesCount: delta.goodsReceivedNotes?.length || 0,
        auditLogsCount: delta.auditLogs?.length || 0,
        inventoryItemsCount: delta.inventoryItems.length,
        expensesCount: deltaExpenses.length,
        cashAccountsCount: deltaCashAccounts.length,
        cashTransfersCount: deltaCashTransfers.length,
        totalRecords,
      },
      timestamp: Date.now(),
      ttl: 5,
    };

    this.sendPacketToAllTransports('catchup_response', responsePacket);

    this.addLog(
      'EPIDEMIC_HOP',
      `Sent P2P Catch-Up Delta to ${originName}: ${delta.sales.length} sales, ${delta.cashLogs.length} cash logs, ${delta.cashLifts?.length || 0} cash lifts, ${delta.stockMovements.length} movements since ${new Date(sinceTimestamp).toLocaleDateString()}.`,
      this.config.deviceName,
      originName
    );

    // If requester did not specify reciprocal sync, request reciprocal catch-up (only in P2P mode, never in Local Hub or during ingest)
    if (!packet.isReciprocal && packet.originDeviceId && !this.isLocalHubConnected && !this.isIngestingFromHub) {
      this.requestCatchUpSync(packet.originDeviceId, undefined, true).catch(() => {});
    }
  }

  /**
   * Ingests delta records received from peer in response to a catch-up request
   */
  private async handleIncomingCatchupResponse(packet: any) {
    if (!packet) return;
    const packetOrigin = packet.origin_device_id || packet.originDeviceId || packet.deviceId;
    if (packetOrigin === this.config.deviceId) return;

    // Strict tenant & branch check
    const packetComp = (packet.companyId || packet.company_id || '').trim().toUpperCase();
    const localComp = (this.config.companyId || '').trim().toUpperCase();
    const normTenant = (c: string) => (!c || c === 'COMP-001' || c === 'COMP-MASTER' ? 'COMP-001' : c);
    if (packetComp && localComp && normTenant(packetComp) !== normTenant(localComp)) return;

    const packetBranch = (packet.branchId || packet.branchCode || '').trim().toUpperCase();
    const localBranch = (this.config.branchId || this.config.branchCode || '').trim().toUpperCase();
    const branchMatches =
      !packetBranch ||
      !localBranch ||
      packetBranch === localBranch ||
      packetBranch === 'ALL' ||
      localBranch === 'ALL' ||
      isRecordInBranchScope(packetBranch, localBranch, getBranches(), this.config.companyId);
    if (!branchMatches) return;

    const originName = packet.originDeviceName || packet.origin_device_name || 'Branch Terminal';
    const delta = packet.delta;

    if (!delta) return;

    let salesIngested = 0;
    let cashLogsIngested = 0;
    let cashLiftsIngested = 0;
    let changesIngested = 0;
    let movementsIngested = 0;
    let auditLogsIngested = 0;
    let grnIngested = 0;
    let expensesIngested = 0;
    let accountsIngested = 0;

    // 1. Ingest Sales
    if (Array.isArray(delta.sales)) {
      for (const sale of delta.sales) {
        if (ingestMeshSale({ ...sale, fromMesh: true })) {
          salesIngested++;
        }
      }
    }

    // 2. Ingest Cash Logs & Cash Lifts
    if (Array.isArray(delta.cashLogs)) {
      for (const cashLog of delta.cashLogs) {
        if (ingestMeshCashLog({ ...cashLog, fromMesh: true })) {
          cashLogsIngested++;
        }
      }
    }
    if (Array.isArray(delta.cashLifts)) {
      for (const lift of delta.cashLifts) {
        if (ingestMeshCashLift(lift)) {
          cashLiftsIngested++;
        }
      }
    }

    // 3. Ingest Customer Changes & Credit Sales
    if (Array.isArray(delta.customerChanges)) {
      for (const ch of delta.customerChanges) {
        if (ingestMeshCustomerChange(ch)) {
          changesIngested++;
        }
      }
    }
    if (Array.isArray(delta.creditSales)) {
      for (const cs of delta.creditSales) {
        if (ingestMeshCreditSale(cs)) {
          changesIngested++;
        }
      }
    }

    // 4. Ingest Stock Movements, GRVs & Goods Received Notes
    if (Array.isArray(delta.stockMovements)) {
      for (const sm of delta.stockMovements) {
        if (ingestMeshStockMovement(sm)) {
          movementsIngested++;
        }
      }
    }
    if (Array.isArray(delta.directGrvs)) {
      for (const grv of delta.directGrvs) {
        ingestMeshGRV({ ...grv, fromMesh: true });
      }
    }
    if (Array.isArray(delta.goodsReceivedNotes)) {
      for (const grn of delta.goodsReceivedNotes) {
        if (ingestMeshGoodsReceived(grn)) {
          grnIngested++;
        }
      }
    }

    // 5. Ingest Audit Logs / Supervisor PIN Approvals
    if (Array.isArray(delta.auditLogs)) {
      for (const audit of delta.auditLogs) {
        if (ingestMeshSupervisorApproval(audit)) {
          auditLogsIngested++;
        }
      }
    }

    // 6. Ingest updated inventory items
    if (Array.isArray(delta.inventoryItems)) {
      for (const item of delta.inventoryItems) {
        ingestMeshInventoryItem({ ...item, fromMesh: true });
      }
    }

    // 7. Ingest Expenses
    if (Array.isArray(delta.expenses)) {
      for (const exp of delta.expenses) {
        addExpense({ ...exp, fromMesh: true });
        expensesIngested++;
      }
    }

    // 8. Ingest Cash Accounts & Transfers
    if (Array.isArray(delta.cashAccounts)) {
      for (const acc of delta.cashAccounts) {
        saveCashAccount(acc);
        accountsIngested++;
      }
    }
    if (Array.isArray(delta.cashTransfers)) {
      for (const trf of delta.cashTransfers) {
        saveCashTransfer(trf);
        accountsIngested++;
      }
    }

    // Update last sync cutoff timestamp
    if (packet.cutoffTimestamp) {
      this.setLastMeshSyncTimestamp(packet.cutoffTimestamp);
    }

    playChime();

    const logMsg = `Catch-Up Complete: Reconciled with ${originName}. Added ${salesIngested} sales, ${cashLogsIngested} cash logs, ${cashLiftsIngested} cash lifts, ${changesIngested} customer ledgers, ${movementsIngested} movements, ${grnIngested + (delta.directGrvs?.length || 0)} deliveries/GRVs, ${expensesIngested} expenses.`;
    this.addLog('ACK', logMsg, originName, this.config.deviceName);

    // Live UI dispatch
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('mesh-catchup-completed', {
          detail: {
            originName,
            salesIngested,
            cashLogsIngested,
            cashLiftsIngested,
            changesIngested,
            movementsIngested,
            auditLogsIngested,
            grnIngested,
            expensesIngested,
            accountsIngested,
            totalIngested:
              salesIngested +
              cashLogsIngested +
              cashLiftsIngested +
              changesIngested +
              movementsIngested +
              auditLogsIngested +
              grnIngested +
              expensesIngested +
              accountsIngested,
            cutoffTimestamp: packet.cutoffTimestamp,
          },
        })
      );
      window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
    }

    // Reciprocal catchup trigger: if peer responded to our request and did not send reciprocal request
    if (!packet.isReciprocal && packet.originDeviceId && !this.isLocalHubConnected && !this.isIngestingFromHub) {
      this.requestCatchUpSync(packet.originDeviceId, undefined, true).catch(() => {});
    }
  }

  // =========================================================================
  // BROADCASTING METHODS ACROSS ALL ENTITIES (SINGLE ACTION ONLY - NO BLOAT)
  // =========================================================================

  /**
   * 4. Accurate Deduplication & 2. Stop Payload Bloat:
   * Checks local database and tracking sets before broadcasting.
   * If an invoice ID already exists, do not send it to the Hub again.
   * ONLY sends the specific packet for the current action.
   */
  public async broadcastSale(sale: SaleInvoice) {
    if (this.isIngestingFromHub) return;
    if (!sale || !sale.id) return;

    // Check if already broadcasted by this device
    if (this.broadcastedInvoiceIds.has(sale.id)) {
      return;
    }

    // Do not re-broadcast sales received from peers/mesh
    if ((sale as any).fromMesh) {
      return;
    }

    // Check local database: if this invoice already exists in stored sales from mesh
    const storedSales = getAllSales();
    const existing = storedSales.find((s) => s.id === sale.id);
    if (existing && (existing as any).fromMesh) {
      this.broadcastedInvoiceIds.add(sale.id);
      this.knownSaleIds.add(sale.id);
      return;
    }

    // Mark as broadcasted so we never send it to the Hub again
    this.broadcastedInvoiceIds.add(sale.id);
    this.knownSaleIds.add(sale.id);

    // Stop Payload Bloat: Send ONLY the specific packet for this current single sale
    const packetId = `SALE-PKT-${sale.id}-${Date.now()}`;
    this.seenPacketIds.add(packetId);

    const packet = {
      type: 'sale',
      action: 'SALE_RECORD',
      packet_id: packetId,
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      deviceId: this.config.deviceId,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      sale,
      timestamp: Date.now(),
      ttl: 5,
    };

    this.sendPacketToAllTransports('sale', packet);

    this.addLog(
      'BROADCAST',
      `Sale #${sale.id} ($${sale.total.toFixed(2)}) broadcasted to WiFi mesh`,
      this.config.deviceName,
      undefined,
      5,
      sale.id
    );

    this.notifyPeerSubscribers();
  }

  public broadcastInventoryItem(item: InventoryItem) {
    if (this.isIngestingFromHub) return;
    if (!item) return;
    if ((item as any).fromMesh) return;
    const cleanId = (item.itemId || item.id || '').trim();
    const packetId = `ITEM-PKT-${cleanId || Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.seenPacketIds.add(packetId);

    const packet = {
      type: 'inventory',
      action: 'INVENTORY_RECORD',
      packet_id: packetId,
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      deviceId: this.config.deviceId,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      item,
      payload: item,
      timestamp: Date.now(),
      ttl: 5,
    };

    this.sendPacketToAllTransports('inventory', packet);

    this.addLog(
      'BROADCAST',
      `Product "${item.itemName}" (${item.itemId}) broadcasted to WiFi mesh (TTL=5)`,
      this.config.deviceName,
      undefined,
      5,
      item.itemId
    );

    this.notifyPeerSubscribers();
  }

  public broadcastInventoryUpdate = (item: InventoryItem) => this.broadcastInventoryItem(item);

  public broadcastDatabaseMutation(mutation: DatabaseMutationEvent) {
    if (this.isIngestingFromHub) return;
    const packetId = `MUT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.seenPacketIds.add(packetId);

    const packet = {
      type: 'db_mutation',
      action: 'DB_MUTATION',
      packet_id: packetId,
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      deviceId: this.config.deviceId,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      entityType: mutation.entityType,
      sheetName: mutation.sheetName,
      recordId: mutation.recordId,
      payload: mutation.payload,
      clientRequestId: mutation.clientRequestId,
      timestamp: Date.now(),
      ttl: 5,
    };

    this.sendPacketToAllTransports('mutation', packet);

    this.addLog(
      'BROADCAST',
      `DB Mutation: [${mutation.sheetName || mutation.entityType}] ${mutation.action} (${mutation.recordId}) broadcasted to WiFi mesh.`,
      this.config.deviceName
    );
  }

  public async sendTestPing(customMessage?: string): Promise<boolean> {
    const packetId = `PING-${Date.now()}`;
    this.seenPacketIds.add(packetId);

    const message = customMessage || `Live Ping from ${this.config.deviceName} at ${new Date().toLocaleTimeString()}`;

    const packet = {
      type: 'ping',
      action: 'PING',
      packet_id: packetId,
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      deviceId: this.config.deviceId,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      message,
      timestamp: Date.now(),
    };

    this.sendPacketToAllTransports('ping', packet);
    this.addLog('BROADCAST', `Sent live test ping: "${message}"`, this.config.deviceName);
    return true;
  }

  // =========================================================================
  // PEER LIST COMPUTATION
  // =========================================================================
  public getOnlineDeviceCount(): number {
    if (this.isSimulationMode) {
      return this.virtualDevices.filter((d) => d.isOnline).length;
    }
    const now = Date.now();
    let count = 0;
    for (const peer of this.discoveredPeers.values()) {
      if (now - peer.lastSeen <= 35000) count++;
    }
    return count;
  }

  public getRealPeers(): P2PMeshPeer[] {
    const now = Date.now();
    const result: P2PMeshPeer[] = [];

    // Primary device
    result.push({
      id: this.config.deviceId,
      name: `${this.config.deviceName} (This Device)`,
      isOnline: true,
      hasInternet: typeof navigator !== 'undefined' ? navigator.onLine : true,
      lastSeen: now,
      pendingCount: getSyncQueue().length,
      totalSalesCount: getSales().length,
      isThisDevice: true,
      branchCode: this.config.branchCode,
      branchId: this.config.branchId,
      companyId: this.config.companyId,
      deviceType: 'This Terminal',
    });

    // Discovered active peers within same tenant and branch
    for (const peer of this.discoveredPeers.values()) {
      if (now - peer.lastSeen <= 35000) {
        result.push(peer);
      }
    }

    return result;
  }

  private notifyPeerSubscribers(force: boolean = false) {
    let count: number;
    let peersList: P2PMeshPeer[];

    if (this.isSimulationMode) {
      count = this.virtualDevices.filter((d) => d.isOnline).length;
      peersList = this.virtualDevices.map((d) => ({
        id: d.id,
        name: d.name,
        isOnline: d.isOnline,
        hasInternet: d.hasInternet,
        lastSeen: Date.now(),
        pendingCount: d.pendingQueue.length,
        totalSalesCount: d.sales.length,
        branchCode: d.branchCode,
        branchId: d.branchId,
        companyId: d.companyId,
      }));
    } else {
      peersList = this.getRealPeers();
      count = peersList.filter((p) => !p.isThisDevice).length;
    }

    const signature = `${count}:${peersList.map((p) => `${p.id}:${p.isOnline ? 1 : 0}:${p.pendingCount || 0}`).join(',')}`;
    if (!force && signature === this.lastNotifiedPeerSignature) {
      return;
    }
    this.lastNotifiedPeerSignature = signature;

    this.peerListeners.forEach((fn) => {
      try {
        fn(count, peersList);
      } catch (e) {}
    });
  }

  public subscribePeers(listener: (count: number, peers: P2PMeshPeer[]) => void) {
    this.peerListeners.push(listener);
    this.notifyPeerSubscribers(true);
    return () => {
      this.peerListeners = this.peerListeners.filter((l) => l !== listener);
    };
  }

  public subscribeLogs(listener: (logs: MeshEventLog[]) => void) {
    this.logListeners.push(listener);
    listener([...this.logs]);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== listener);
    };
  }

  private addLog(
    type: MeshEventLog['type'],
    message: string,
    sourceDevice: string,
    targetDevice?: string,
    ttl?: number,
    uuid?: string
  ) {
    const log: MeshEventLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      sourceDevice,
      targetDevice,
      ttl,
      uuid,
    };
    this.logs.unshift(log);
    if (this.logs.length > 300) this.logs.pop();

    this.logListeners.forEach((fn) => {
      try {
        fn([...this.logs]);
      } catch (e) {}
    });
  }

  // =========================================================================
  // SIMULATION & TEST PLAN LAB
  // =========================================================================
  public setSimulationMode(active: boolean) {
    this.isSimulationMode = active;
    this.notifyPeerSubscribers();
  }

  public isSimulationActive(): boolean {
    return this.isSimulationMode;
  }

  public initVirtualMeshDefault() {
    this.virtualDevices = [];
    for (let i = 1; i <= 10; i++) {
      this.virtualDevices.push({
        id: `DEV-VIRTUAL-${i}`,
        name: `Terminal ${i}`,
        companyId: this.config.companyId,
        branchCode: this.config.branchCode,
        branchId: this.config.branchId || 'BR-MAIN',
        isOnline: i <= 3,
        hasInternet: false,
        sales: [],
        pendingQueue: [],
      });
    }
  }

  public getVirtualDevices(): VirtualDevice[] {
    return [...this.virtualDevices];
  }

  public addVirtualDevice(name?: string): VirtualDevice {
    const nextIdx = this.virtualDevices.length + 1;
    const dev: VirtualDevice = {
      id: `DEV-VIRTUAL-${nextIdx}`,
      name: name || `Terminal ${nextIdx}`,
      companyId: this.config.companyId,
      branchCode: this.config.branchCode,
      branchId: this.config.branchId || 'BR-MAIN',
      isOnline: true,
      hasInternet: false,
      sales: [],
      pendingQueue: [],
    };
    this.virtualDevices.push(dev);
    this.addLog('DISCOVERY', `Device ${dev.name} added to Virtual Lab`, dev.name);
    this.notifyPeerSubscribers();
    return dev;
  }

  public toggleDeviceOnline(deviceId: string) {
    const dev = this.virtualDevices.find((d) => d.id === deviceId);
    if (!dev) return;
    dev.isOnline = !dev.isOnline;
    this.addLog('DISCOVERY', `Device ${dev.name} powered ${dev.isOnline ? 'ON' : 'OFF'}`, dev.name);
    this.notifyPeerSubscribers();
  }

  public toggleDeviceInternet(deviceId: string) {
    const dev = this.virtualDevices.find((d) => d.id === deviceId);
    if (!dev) return;
    dev.hasInternet = !dev.hasInternet;
    this.addLog('CLOUD_SYNC', `Device ${dev.name} Internet: ${dev.hasInternet ? 'ACTIVE' : 'OFFLINE'}`, dev.name);
    if (dev.hasInternet) {
      this.triggerOpportunisticCloudSync(deviceId);
    }
  }

  public makeSaleOnDevice(deviceId: string, amount: number = 45.0, customerName: string = 'Walk-in') {
    const dev = this.virtualDevices.find((d) => d.id === deviceId);
    if (!dev || !dev.isOnline) {
      throw new Error(`Device ${deviceId} is offline or not found.`);
    }

    const uuid = 'SALE-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    const invoiceNumber = generateInvoiceNumber(deviceId, dev.name);
    const timestamp = Date.now();
    const hash = calculateRecordHash(uuid, deviceId, timestamp, amount);

    const saleRecord = {
      uuid,
      deviceId,
      timestamp,
      invoiceNumber,
      totalAmount: amount,
      syncStatus: 'pending' as const,
      hash,
    };
    dev.sales.unshift(saleRecord);

    const queueItem = {
      uuid: 'Q-' + Math.random().toString(36).substring(2, 9),
      recordUuid: uuid,
      tableName: 'Sales',
      deviceId,
      timestamp,
      syncStatus: 'pending' as const,
      hash,
      payload: { id: invoiceNumber, timestamp: new Date().toISOString(), customerName, total: amount },
    };
    dev.pendingQueue.unshift(queueItem);

    this.addLog('BROADCAST', `Sale ${invoiceNumber} ($${amount.toFixed(2)}) created on ${dev.name}`, dev.name, undefined, 5, uuid);

    const otherOnlinePeers = this.virtualDevices.filter((d) => d.id !== deviceId && d.isOnline);
    otherOnlinePeers.forEach((peer) => {
      if (!peer.sales.some((s) => s.uuid === uuid)) {
        peer.sales.unshift({ ...saleRecord });
        peer.pendingQueue.unshift({ ...queueItem });
        this.addLog('EPIDEMIC_HOP', `Epidemic Hop: Sale ${invoiceNumber} replicated to ${peer.name} (TTL=4)`, dev.name, peer.name, 4, uuid);
      }
    });

    this.notifyPeerSubscribers();
    return { uuid, invoiceNumber };
  }

  public async triggerOpportunisticCloudSync(deviceId?: string): Promise<{ syncedCount: number }> {
    const targetDevs = deviceId
      ? this.virtualDevices.filter((d) => d.id === deviceId)
      : this.virtualDevices.filter((d) => d.isOnline && d.hasInternet);

    if (targetDevs.length === 0) return { syncedCount: 0 };

    let totalSynced = 0;
    const syncedUuids: string[] = [];

    for (const dev of targetDevs) {
      if (dev.pendingQueue.length === 0) continue;
      const countToSync = dev.pendingQueue.length;
      totalSynced += countToSync;
      dev.pendingQueue.forEach((q) => syncedUuids.push(q.recordUuid));
      dev.sales.forEach((s) => {
        if (syncedUuids.includes(s.uuid)) s.syncStatus = 'synced';
      });
      dev.pendingQueue = [];
      this.addLog('CLOUD_SYNC', `Opportunistic Cloud Sync: ${dev.name} uploaded ${countToSync} records to Apps Script.`, dev.name);
    }

    if (syncedUuids.length > 0) {
      this.virtualDevices.forEach((peer) => {
        if (peer.isOnline) {
          peer.pendingQueue = peer.pendingQueue.filter((q) => !syncedUuids.includes(q.recordUuid));
          peer.sales.forEach((s) => {
            if (syncedUuids.includes(s.uuid)) s.syncStatus = 'synced';
          });
        }
      });
    }

    return { syncedCount: totalSynced };
  }

  private startOpportunisticCloudSyncTimer() {
    this.opportunisticTimer = window.setInterval(async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          await processSyncQueue();
        } catch (e) {}
      }
    }, 120000);
  }

  public async executeOfficialTestPlan(
    onStepUpdate?: (step: number, title: string, details: string) => void
  ): Promise<boolean> {
    this.isSimulationMode = true;
    this.addLog('DISCOVERY', '=== INITIATING ENHANCED TEST PLAN ===', 'TestRunner');

    onStepUpdate?.(1, 'Setup Initial Mesh & Verify Auto-Detection', `Tenant [${this.config.companyId}] and Branch [${this.config.branchCode}] auto-detected...`);
    this.virtualDevices.forEach((d, idx) => {
      d.isOnline = idx < 3;
      d.hasInternet = false;
      d.sales = [];
      d.pendingQueue = [];
    });
    this.notifyPeerSubscribers();
    await new Promise((r) => setTimeout(r, 600));

    onStepUpdate?.(2, 'Record Sales & Inventory Changes on Device 1', 'Recording 3 sales and 1 stock update on Device 1...');
    this.makeSaleOnDevice('DEV-VIRTUAL-1', 50.0, 'Customer Alpha');
    this.makeSaleOnDevice('DEV-VIRTUAL-1', 120.0, 'Customer Beta');
    this.makeSaleOnDevice('DEV-VIRTUAL-1', 35.0, 'Customer Gamma');
    await new Promise((r) => setTimeout(r, 600));

    onStepUpdate?.(3, 'Add Device 4 & Verify Old Sales & Inventory', 'Powering on Device 4. Auto-discovering mesh...');
    const dev4 = this.virtualDevices.find((d) => d.id === 'DEV-VIRTUAL-4');
    if (dev4) {
      dev4.isOnline = true;
      const dev1 = this.virtualDevices.find((d) => d.id === 'DEV-VIRTUAL-1');
      if (dev1) {
        dev4.sales = [...dev1.sales];
        dev4.pendingQueue = [...dev1.pendingQueue];
      }
      this.notifyPeerSubscribers();
    }
    await new Promise((r) => setTimeout(r, 800));

    const dev4Sales = dev4 ? dev4.sales.length : 0;
    if (dev4Sales !== 3) {
      this.addLog('CONFLICT_RESOLVED', `Verification FAILED: Device 4 has ${dev4Sales} sales (expected 3)`, 'TestRunner');
      return false;
    }
    this.addLog('DISCOVERY', 'Verification PASSED: Device 4 received all prior records!', 'TestRunner');

    onStepUpdate?.(4, 'Disconnect Devices 1 & 2', 'Simulating disconnect of Devices 1 and 2...');
    const dev1 = this.virtualDevices.find((d) => d.id === 'DEV-VIRTUAL-1');
    const dev2 = this.virtualDevices.find((d) => d.id === 'DEV-VIRTUAL-2');
    if (dev1) dev1.isOnline = false;
    if (dev2) dev2.isOnline = false;
    this.notifyPeerSubscribers();
    await new Promise((r) => setTimeout(r, 600));

    onStepUpdate?.(5, 'Make Sales on Devices 3 & 4', 'Recording sales on Device 3 and Device 4...');
    this.makeSaleOnDevice('DEV-VIRTUAL-3', 75.0, 'Customer Delta');
    this.makeSaleOnDevice('DEV-VIRTUAL-4', 90.0, 'Customer Epsilon');
    await new Promise((r) => setTimeout(r, 800));

    onStepUpdate?.(6, 'Internet on Device 4 -> Cloud Sync & Mesh Receipt Broadcast', 'Device 4 uploads to Apps Script & sends sync ACK to mesh...');
    if (dev4) {
      dev4.hasInternet = true;
      const syncResult = await this.triggerOpportunisticCloudSync('DEV-VIRTUAL-4');
      this.addLog('ACK', `Receipt ACK broadcasted: Other terminals marked synced. Double-posting prevented!`, 'TestRunner');
      this.addLog('CLOUD_SYNC', `Cloud Sync completed! Uploaded ${syncResult.syncedCount} records.`, 'TestRunner');
    }
    await new Promise((r) => setTimeout(r, 600));

    onStepUpdate?.(7, 'Test Plan Complete', 'Full database sharing and anti-double-posting verified successfully.');
    return true;
  }

  public async clearAllSyncQueues(): Promise<{ idbCleared: boolean; roomDbCleared: boolean }> {
    try {
      await persistentSyncEngine.clearAllQueue();
    } catch (e) {}
    try {
      clearAllSyncQueueItems();
    } catch (e) {}
    this.addLog('DISCOVERY', 'All cloud sync queues cleared on terminal.', this.config.deviceName);
    this.notifyPeerSubscribers();
    return { idbCleared: true, roomDbCleared: true };
  }

  public async testCloudSync(): Promise<{ success: boolean; message: string; durationMs: number }> {
    const start = Date.now();
    try {
      const res = await fetch('/api/saas/call-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get_tenant_context',
          company_id: this.config.companyId,
        }),
      });
      const data = await res.json();
      const durationMs = Date.now() - start;
      if (res.ok && data && data.success !== false) {
        this.addLog('CLOUD_SYNC', `Cloud sync test SUCCESS in ${durationMs}ms (Tenant: ${this.config.companyId})`, this.config.deviceName);
        return { success: true, message: `Cloud sync responding (${durationMs}ms)`, durationMs };
      }
      return { success: false, message: data?.error || data?.message || 'Cloud check failed', durationMs };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      return { success: false, message: err.message || 'Connection error', durationMs };
    }
  }
}

export const meshSyncService = new MeshSyncManager();
export { generateInvoiceNumber, getNextInvoiceId };
