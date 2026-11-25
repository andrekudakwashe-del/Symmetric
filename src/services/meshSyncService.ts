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
  InternalConsumption,
  StocktakeSession,
} from '../types';
import type { MqttClient } from 'mqtt';
import {
  getSales,
  getAllSales,
  getSaleById,
  addSale,
  getSyncQueue,
  getSheetsConfig,
  getRawStoredSheetsConfig,
  purgeLocalCloudCredentialsFromStorage,
  isCloudConfigPurged,
  purgeSyncedRecords,
  onSaleCreated,
  ingestMeshSale,
  onInventoryCreated,
  ingestMeshInventoryItem,
  ingestMeshInventoryItemsChunk,
  recalculateInventoryValuationOnce,
  getRawStoredInventoryItems,
  getRawStoredSalespeople,
  getRawStoredCustomers,
  getAllSalespeople,
  getCustomers,
  setStored,
  STORAGE_KEYS,
  mergeT1Records,
  isPosActiveCheckout,
  beginBatchUpdate,
  endBatchUpdate,
  isOfflineModeForced,
  getTransactionsDigest,
  applyTombstone,
  recordTombstone,
  getTombstones,
  markTombstonesSyncedToHub,
  parseTimestampMs,
  extractRecordTimestamp,
  pullTenantInventory,
  getCurrentCompanyId,
  getCurrentCompany,
  getCurrentBranchId,
  getCurrentBranch,
  getSessionUser,
  getBranches,
  getAllBranches,
  getTemporaryCasuals,
  getAllStocktakeSessions,
  isRecordInBranchScope,
  onDatabaseMutation,
  DatabaseMutationEvent,
  resolveEntityType,
  isValidBranchRecord,
  ingestMeshBranch,
  ingestMeshStaff,
  ingestMeshSupervisorApproval,
  ingestMeshCashLog,
  onCashLogCreated,
  onCashLogUpdated,
  deduplicateCashLogs,
  normalizeCashLogRecord,
  healMultiCurrencySalesAndMovements,
  healCustomerNamesAndChangeCreditLedgers,
  ingestMeshCustomer,
  ingestMeshGRV,
  recordDirectGrvTillPayouts,
  getDirectGrvs,
  getRawStoredDirectGrvs,
  getRawStoredCustomerChanges,
  getRawStoredCreditSales,
  getRawStoredCashLogs,
  getRawStoredStockMovements,
  getRawStoredExpenses,
  getRawStoredCashLifts,
  getRawStoredSuppliers,
  getRawStoredAuditLogs,
  getRawStoredGoodsReceived,
  getRawStoredCashTransfers,
  getRawStoredReconciliations,
  getRawStoredAdminSales,
  getRawStoredCashCounts,
  getRawStoredSupplierInvoiceVouchers,
  getRawStoredBusinessDayClosures,
  getRawStoredCashAccounts,
  getRawStoredStocktakeSessions,
  getRawStoredDailyBlindConfigs,
  getRawStoredDailyBlindCounts,
  ingestMeshDailyBlindConfig,
  ingestMeshDailyBlindCount,
  getCreditGroups,
  ingestMeshInventoryDelete,
  getDeletedInventoryItems,
  ingestMeshSettings,
  markSyncItemsAsSynced,
  clearAllSyncQueueItems,
  getDeltaRecordsSince,
  ingestMeshCustomerChange,
  ingestMeshCreditSale,
  ingestMeshCreditGroup,
  ingestMeshStockMovement,
  stripStockMovementDupSuffix,
  ingestMeshCashLift,
  ingestMeshGoodsReceived,
  addExpense,
  addSupplier,
  saveAdminSalesEntry,
  saveFinalCashCount,
  saveSupplierInvoiceVoucher,
  saveBusinessDayClosure,
  saveElectronicSettlement,
  saveCategories,
  getCategories,
  saveReconciliation,
  saveCashAccount,
  saveBranch,
  saveCashTransfer,
  ingestMeshCashTransfer,
  getAllExpenses,
  getAllCashAccounts,
  getAllCashTransfers,
  generateInvoiceNumber,
  getNextInvoiceId,
  getDeviceId,
  markSaleAsSynced,
  markRecordsCloudSynced,
  syncCasualWorkersFromHub,
  syncLockdownFromHub,
  claimZoneSlot,
  updateZoneFromHubStatus,
  ingestStocktakeSessionFromMesh,
  resolveConflictingLocalStocktakeSession,
  saveStocktakeSegment,
  updateZoneClaim,
  markZoneVerified,
  markZoneVariance,
  saveStocktakeSession,
  getStocktakeSessionById,
  saveZoneAssignment,
  saveZoneAssignmentsBatch,
  applyJointRecountSignature,
  reopenFinalizedSegmentSlot,
  onSaleUpdated,
  onStaffChanged,
  onCustomerChanged,
  onSupplierChanged,
  onBranchChanged,
  onCashAccountChanged,
  onCashTransferChanged,
  onElectronicSettlementChanged,
  getElectronicSettlements,
  onExpenseChanged,
  onDirectGrvChanged,
  getPermissionsList,
  getPermissionsMatrixUpdatedAt,
  ingestMeshPermissionsMatrix,
  onPermissionsMatrixChanged,
  getMultiCurrencyConfig,
  getMultiCurrencyUpdatedAt,
  onMultiCurrencyChanged,
  ingestMeshMultiCurrencyConfig,
} from '../db/roomDatabase';
import {
  onInternalConsumptionChanged,
  ingestMeshInternalConsumption,
  getInternalConsumptions,
} from './walletService';
import {
  getStoredRoleDefinitions,
  getRoleDefinitionsUpdatedAt,
  ingestMeshRoleDefinitions,
  onRoleDefinitionsChanged,
} from './roleNavigationService';
import { getMovements, addMovement, onCashMovementCreated, CashMovement } from '../db/cashLedger';
import { persistentSyncEngine } from './persistentSyncEngine';
import { getSyncMeta, setSyncMeta } from '../db/indexedDBService';
import {
  LocalHubConfig,
  normalizeHubUrl,
  PairedHubProfile,
  extractHostAndPort,
  sanitizeLanIps,
  sanitizeMdnsHost,
  ActiveLeaderInfo,
  HubMode,
  HubRole,
  normalizeBranchEpoch,
  normalizeHubMode,
  normalizeHubPriority,
  normalizeHubRole,
  sanitizeActiveLeaderInfo,
} from '../utils/localHubConfig';
import {
  computeClientAuthProof,
  computeHubAuthProof,
  computeVisualConfirmCode,
  constantTimeEqual,
  generateClientNonce,
  parsePairDeepLink,
} from '../utils/hubAuthCrypto';
import type { HubAuthState } from './sync/LocalHubAdapter';
import { discoverPairedHub, DiscoveryStage } from './sync/hubRoamingDiscovery';
import {
  ColdHubHydrationQueue,
  ColdHubHydrationProgress,
  DEFAULT_COLD_HUB_ENTITY_ORDER,
  yieldToMainThread,
} from './sync/coldHubHydrationQueue';
import {
  HubStorageRpcManager,
  type HubStorageCapacity,
  type HubStoragePressureAlert,
  type HubStorageSnapshot,
  type HubArchivePackListResult,
  type HubArchiveCreateOptions,
  type HubArchiveCreateResult,
  type HubArchiveDownloadProgress,
  type HubArchiveDownloadResult,
  type HubArchiveEvictResult,
} from './mesh/hubStorageService';
import {
  reportTrustedTimeSample,
  triggerClockTamperLock,
  recordSecurityAlert,
} from '../utils/clockSecurity';
import {
  hashPin,
  generatePinSalt,
  sanitizeUserForExport,
} from '../utils/pinCrypto';
import {
  getLastStaffSync,
  setLastStaffSync,
  markStaffSyncComplete,
  SAIMETRIC_LAST_STAFF_SYNC,
  getLastBranchSync,
  setLastBranchSync,
  markBranchSyncComplete,
  SAIMETRIC_LAST_BRANCH_SYNC,
  getLastCustomerSync,
  setLastCustomerSync,
  markCustomerSyncComplete,
  SAIMETRIC_LAST_CUSTOMER_SYNC,
  getLastCashAccountSync,
  setLastCashAccountSync,
  markCashAccountSyncComplete,
  SAIMETRIC_LAST_CASH_ACCOUNT_SYNC,
  getLastCasualWorkerSync,
  setLastCasualWorkerSync,
  markCasualWorkerSyncComplete,
  SAIMETRIC_LAST_CASUAL_WORKER_SYNC,
  getLastStocktakeSessionSync,
  setLastStocktakeSessionSync,
  markStocktakeSessionSyncComplete,
  SAIMETRIC_LAST_STOCKTAKE_SESSION_SYNC,
  getLastMultiCurrencySync,
  setLastMultiCurrencySync,
  markMultiCurrencySyncComplete,
  SAIMETRIC_LAST_MULTI_CURRENCY_SYNC,
  getTenantAuthToken,
  getRoutingEpoch,
  setRoutingEpoch,
  resetCloudCatchupCursors,
} from './sync/highWaterMarks';
import { SyncEnvelope, SyncAction, EntitySnapshot } from './sync/SyncEnvelope';
import { ENTITY_REGISTRY } from './sync/EntityRegistry';
import { SyncCore, normalizeTombstoneEntityType } from './sync/syncCore';
import { SyncAdapter } from './sync/SyncAdapter';
import { LocalHubAdapter } from './sync/LocalHubAdapter';
import { AppScriptsAdapter } from './sync/AppScriptsAdapter';
import { SupabaseAdapter } from './sync/SupabaseAdapter';
import { MongoDBAdapter } from './sync/MongoDBAdapter';
import { getActiveCloudConfig, ActiveDatabaseType } from './sync/cloudConfigResolver';
import {
  registerSyncCoreIngestBridge,
  registerSyncCoreIngestBatchBridge,
  registerSyncCoreSaveAndSyncBridge,
  registerTombstoneLookup,
} from './sync/syncIngestBridge';

import {
  PackageSyncMode,
  MeshConnectionMode,
  MeshSyncProgress,
  MeshEventLog,
  VirtualDevice,
  SyncCoreListener,
  PREFS_BRANCH_KEY,
  PREFS_BRANCH_ID_KEY,
  PREFS_DEVICE_KEY,
  PREFS_DEVICE_ID_KEY,
  PREFS_COMPANY_KEY,
  PREFS_AUTODETECT_KEY,
  PUBLIC_MQTT_BROKERS,
  computeIdsChecksum,
  generateEntitySnapshot,
  getPackageSyncMode,
  calculateRecordHash,
  playChime,
  registerSyncCoreListener,
  notifySyncCoreListeners,
} from './mesh/meshTypesAndHelpers';
import { lookupExistingRecordForEnvelope } from './mesh/envelopeRecordLookup';
import {
  buildGenericCloudConfigPacket,
  HubCloudConfigPacket,
} from './mesh/cloudConfigPacketBuilder';
import {
  ingestMeshSupplierRecord,
  ingestMeshAdminSalesRecord,
  ingestMeshCashCountRecord,
  ingestMeshVoucherRecord,
  ingestMeshClosureRecord,
  ingestMeshSettlementRecord,
  ingestMeshCategoriesRecord,
  generateOfflineBatchPayloadForConfig,
  ingestOfflineBatchPayloadForConfig,
} from './mesh/meshIngestHandlers';
import { StocktakeMeshTransport } from './mesh/stocktakeMeshTransport';
import { VirtualMeshSimulator } from './mesh/virtualMeshSimulator';

export {
  isPosActiveCheckout,
  computeIdsChecksum,
  generateEntitySnapshot,
  getPackageSyncMode,
  calculateRecordHash,
  registerSyncCoreListener,
};
export type {
  PackageSyncMode,
  MeshConnectionMode,
  MeshSyncProgress,
  MeshEventLog,
  VirtualDevice,
};

let _cloudSyncPaused = false;

export const pauseCloudSync = () => {
  try {
    const comp = getCurrentCompany();
    if (comp?.sync_strategy === 'CLOUD_ONLY') {
      console.log('[Sync Strategy] Tenant configured as CLOUD_ONLY. Direct cloud sync remains active.');
      return;
    }
  } catch {}
  _cloudSyncPaused = true;
  persistentSyncEngine.pauseOutboundSync();
  console.log('[Edge Gateway] 🛑 Local Hub WebSocket active. Direct cloud sync (App Scripts/Supabase) paused to prevent sync wars.');
};

export const resumeCloudSync = () => {
  try {
    const comp = getCurrentCompany();
    if (comp?.sync_strategy === 'HUB_ONLY') {
      console.log('[Sync Strategy] Tenant configured as HUB_ONLY. Direct cloud sync remains paused.');
      return;
    }
  } catch {}
  _cloudSyncPaused = false;
  persistentSyncEngine.resumeOutboundSync();
  console.log('[Edge Gateway] 🟢 Local Hub WebSocket disconnected. Direct cloud sync resumed.');
};

export const isCloudSyncPaused = (): boolean => {
  try {
    const comp = getCurrentCompany();
    if (comp?.sync_strategy === 'CLOUD_ONLY') return false;
    if (comp?.sync_strategy === 'HUB_ONLY') return true;
  } catch {}
  return _cloudSyncPaused || (typeof meshSyncService !== 'undefined' && meshSyncService.isLocalHubActive());
};

class MeshSyncManager {
  private config: P2PMeshConfig;
  private channel: BroadcastChannel | null = null;
  private logs: MeshEventLog[] = [];
  private logListeners: Array<(logs: MeshEventLog[]) => void> = [];
  private peerListeners: Array<(count: number, peers: P2PMeshPeer[]) => void> = [];
  private seenPacketIds: Set<string> = new Set();
  private opportunisticTimer: number | null = null;
  private autoDetectTimer: number | null = null;
  private readonly virtualMeshSimulator: VirtualMeshSimulator;
  private readonly stocktakeTransport: StocktakeMeshTransport;

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

  // Offline Local WebRTC & LAN Gateways
  private webrtcPeerConnection: RTCPeerConnection | null = null;
  private webrtcDataChannel: RTCDataChannel | null = null;
  private isWebRtcConnected: boolean = false;
  private localGatewayUrl: string = '';
  private localGatewayPollTimer: number | null = null;
  private lastMeshPollTimestamp: number = Date.now();
  private lastNotifiedPeerSignature: string = '';
  private lastCatchUpRequestTime: Map<string, number> = new Map();

  // Hexagonal SyncCore & Transport Adapters (LocalHubAdapter exclusively owns WebSocket;
  // only ONE Cloud Adapter is ever instantiated & active at a time per config.databaseType)
  private localHubAdapter: LocalHubAdapter;
  private activeCloudAdapter:
    | (SyncAdapter & { pause?: () => void; resume?: () => void; isPaused?: () => boolean })
    | null = null;
  private activeCloudAdapterType: ActiveDatabaseType | null = null;
  private cloudReceiveUnsubscribe: (() => void) | null = null;
  private syncCore: SyncCore;

  // Local WebSocket Hub state tracking
  private isLocalHubConnected: boolean = false;
  private isLocalHubLost: boolean = false;
  private localHubDisconnectedAt: number | null = null;
  private localHubLostGraceTimer: number | null = null;
  private activeConnectionMode: MeshConnectionMode = 'LOCAL_OFFLINE';
  private localHubHeartbeatTimer: number | null = null;
  private localHubReconnectTimer: number | null = null;
  private lastHubPongReceivedAt: number = 0;
  private connectionModeListeners: Array<(mode: MeshConnectionMode, details: any) => void> = [];
  private knownSaleIds: Set<string> = new Set();
  private broadcastedInvoiceIds: Set<string> = new Set();
  private batchUiTimer: number | null = null;
  private isIngestingFromHub: boolean = false;
  private hubIngestQueue: any[] = [];
  private hubProcessingTimer: number | null = null;
  private hasPerformedInitialCatchup: boolean = false;
  private lastInitialCatchupTime: number = 0;
  private isAwaitingDrainAck: boolean = false;
  private drainAckFallbackTimer: any = null;
  private lastBroadcastByItemId: Map<string, number> = new Map();
  private autoHealIntervalTimer: number | null = null;
  private reconPushedTimestamps: Map<string, number> = new Map();

  // Mutual Authentication, Pairing, IP Roaming & OTA State
  private localHubReconnectAttempts: number = 0;
  private legacyFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pairChallengeWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private activeClientNonce: string = '';
  private activeHubId: string | null = null;
  private activeHubMdnsHost: string | null = null;
  private activeHubLanIps: string[] = [];
  private activeHubVersion: string | null = null;
  private activeHubRuntime: 'ANDROID_APK' | 'TERMUX' | 'UNKNOWN' = 'UNKNOWN';
  private activeHubOtaSlot: string | null = null;
  private activeHubRole: HubRole | null = null;
  private activeHubPriority: number | null = null;
  private activeHubBranchEpoch: number = 1;
  private activeHubMode: HubMode = 'ACTIVE';
  private activeHubIsColdHub: boolean = false;
  private activeLeaderHubId: string | null = null;
  private activeLeaderInfo: ActiveLeaderInfo | null = null;
  private unpairedActiveLeader: ActiveLeaderInfo | null = null;
  private isHandlingFailoverHandoff: boolean = false;
  private pendingFailoverToastMessage: string | null = null;
  private coldHubHydrationQueue!: ColdHubHydrationQueue;
  private hubStorageManager!: HubStorageRpcManager;
  private hubHydrationProgress: ColdHubHydrationProgress = {
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
  private hubAuthError: string | null = null;
  private lastAuthFailureWasRevoked: boolean = false;
  private revokedHubIds: Set<string> = new Set();
  private hubDiscoveryPromise: Promise<boolean> | null = null;
  private isDiscoveringHub: boolean = false;
  private discoveryStage: DiscoveryStage | null = null;
  private pendingRoamedToast: boolean = false;
  private hubOtaStatus: { status: string; targetVersion?: string; etaSeconds?: number; message?: string; updatedAt: number } | null = null;
  private pendingPairRequest: {
    wsUrl: string;
    pairCode?: string;
    clientNonce: string;
    visualCode?: string;
    hubId?: string;
    mdnsHost?: string;
    lanIps?: string[];
    branchName?: string;
    startedAt: number;
  } | null = null;

  // Chunked Ingestion & Async Progress State
  private syncProgressListeners: Array<(progress: MeshSyncProgress) => void> = [];
  private currentSyncProgress: MeshSyncProgress = { isActive: false, current: 0, total: 0, message: '', percentage: 0 };

  public subscribeSyncProgress(listener: (progress: MeshSyncProgress) => void): () => void {
    this.syncProgressListeners.push(listener);
    try {
      listener(this.currentSyncProgress);
    } catch (_) {}
    return () => {
      this.syncProgressListeners = this.syncProgressListeners.filter((l) => l !== listener);
    };
  }

  public getSyncProgress(): MeshSyncProgress {
    return this.currentSyncProgress;
  }

  public updateSyncProgress(current: number, total: number, message?: string): void {
    const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const msg = message || `Syncing ${current}/${total} items...`;
    this.currentSyncProgress = {
      isActive: current < total,
      current,
      total,
      message: msg,
      percentage,
    };
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('saimetric_sync_progress', { detail: this.currentSyncProgress }));
    }
    this.syncProgressListeners.forEach((fn) => {
      try { fn(this.currentSyncProgress); } catch (_) {}
    });
  }

  public finishSyncProgress(total: number, message: string = 'Sync Complete'): void {
    this.currentSyncProgress = {
      isActive: false,
      current: total,
      total,
      message,
      percentage: 100,
    };
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('saimetric_sync_progress', { detail: this.currentSyncProgress }));
    }
    this.syncProgressListeners.forEach((fn) => {
      try { fn(this.currentSyncProgress); } catch (_) {}
    });
    setTimeout(() => {
      this.currentSyncProgress = { isActive: false, current: 0, total: 0, message: '', percentage: 0 };
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('saimetric_sync_progress', { detail: this.currentSyncProgress }));
      }
      this.syncProgressListeners.forEach((fn) => {
        try { fn(this.currentSyncProgress); } catch (_) {}
      });
    }, 2000);
  }

  // Hub Branch Identity & Roaming Owner Safeguard
  private hubBranchId: string | null = LocalHubConfig.getHubBranchId();
  private hubBranchName: string | null = LocalHubConfig.getHubBranchName();
  private isCloudOnlyMode: boolean = LocalHubConfig.isCloudOnlyMode();

  // Safeguard 1: Sync Receipt (ACK) Watchdog
  // Waits for {"type": "SYNC_RECEIPT", "invoice_id": "..."} before marking sale as synced.
  // If not confirmed within 30 seconds, the sale remains in queue and is retried.
  private pendingSaleAcks: Map<string, { sale: SaleInvoice; sentAt: number; lastRetryAt: number; retries: number }> = new Map();
  private ackWatchdogTimer: number | null = null;

  /**
   * Robust extractor for Invoice/Sale IDs across standard envelopes,
   * nested wrappers ({ data: { invoice_id: '...' } }), and legacy formats.
   */
  public extractInvoiceId(packet: any): string | null {
    if (!packet || typeof packet !== 'object') return null;
    const candidate =
      packet.invoice_id ||
      packet.invoiceId ||
      packet.saleId ||
      packet.sale_id ||
      packet.invoiceNumber ||
      packet.invoice_number ||
      (packet.data && (
        packet.data.invoice_id ||
        packet.data.invoiceId ||
        packet.data.saleId ||
        packet.data.sale_id ||
        packet.data.invoiceNumber ||
        packet.data.id
      )) ||
      (packet.payload && (
        packet.payload.invoice_id ||
        packet.payload.invoiceId ||
        packet.payload.saleId ||
        packet.payload.sale_id ||
        packet.payload.invoiceNumber ||
        packet.payload.id
      )) ||
      (packet.sale && (
        packet.sale.id ||
        packet.sale.invoice_id ||
        packet.sale.invoiceId ||
        packet.sale.invoiceNumber
      )) ||
      packet.id;

    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    return null;
  }

  /**
   * Invoice generator adhering to: [user_prefix]-[YYMMDD]-[HHMMSS]-[Random3Digits]
   * Example: KM5-261024-143022-892
   */
  public getNextInvoiceId(staffId?: any, staffName?: string): string {
    return generateInvoiceNumber(staffId, staffName);
  }

  private startAckWatchdogLoop() {
    if (this.ackWatchdogTimer) return;
    // Slow down watchdog checks to 15 seconds to prevent spamming
    this.ackWatchdogTimer = window.setInterval(() => {
      this.checkPendingSaleAcks();
    }, 15000);
  }

  private checkPendingSaleAcks() {
    if (this.pendingSaleAcks.size === 0) return;

    // Requirement 5: Do NOT retry if the Local Hub is disconnected.
    // Only retry if the Hub is connected and actively dropping packets.
    const isHubReady =
      this.isLocalHubConnected &&
      this.localHubAdapter.isConnected();

    if (!isHubReady) {
      return;
    }

    const now = Date.now();
    const MAX_RETRIES = 3;
    const RETRY_INTERVAL_MS = 30000; // 30 seconds

    for (const [invoiceId, pending] of Array.from(this.pendingSaleAcks.entries())) {
      // Requirement 4: Silent Legacy Ingestion filter
      // If legacy INV- invoice, silently drop from pending watchdog queue without retrying
      if (!invoiceId || /^INV-/i.test(invoiceId)) {
        this.pendingSaleAcks.delete(invoiceId);
        continue;
      }

      // Requirement 2: Handle Nested Payloads
      // Check for ID in direct key as well as nested wrappers
      const saleObj: any = pending.sale;
      const targetId =
        this.extractInvoiceId(saleObj) ||
        saleObj?.id ||
        saleObj?.invoice_id ||
        saleObj?.invoiceId ||
        invoiceId;

      if (!targetId || /^INV-/i.test(targetId)) {
        this.pendingSaleAcks.delete(invoiceId);
        continue;
      }

      // 1. Check if already marked synced in local RoomDatabase
      const allSales = getAllSales();
      const existing = allSales.find(
        (s) =>
          s.id === invoiceId ||
          s.id === targetId ||
          (s.id && s.id.toUpperCase() === targetId.toUpperCase())
      );
      if (existing && (existing.synced || existing.syncStatus === 'synced')) {
        this.pendingSaleAcks.delete(invoiceId);
        continue;
      }

      // 2. Only retry if 30s has elapsed since last retry
      if (now - pending.lastRetryAt >= RETRY_INTERVAL_MS) {
        // Cap retries at 3 attempts (90s). If Hub/peers don't ACK, stop spamming WebSocket.
        if (pending.retries >= MAX_RETRIES) {
          this.pendingSaleAcks.delete(invoiceId);
          this.addLog(
            'CONFLICT_RESOLVED',
            `Sync Receipt Watchdog: Max retries (${MAX_RETRIES}) reached for Sale #${invoiceId}. Halting WebSocket re-transmission to protect local network bandwidth. Record is safely preserved in local database & sync queue.`,
            this.config.deviceName,
            undefined,
            undefined,
            invoiceId
          );
          continue;
        }

        pending.retries++;
        pending.lastRetryAt = now;
        this.addLog(
          'BROADCAST',
          `Sync Receipt Watchdog: Sale #${invoiceId} unconfirmed after 30s. Retrying transmission to Local Hub (Attempt #${pending.retries}/${MAX_RETRIES})...`,
          this.config.deviceName,
          undefined,
          5,
          invoiceId
        );
        const retryEnvelope: SyncEnvelope = {
          packetId: `RETRY-SALE-${targetId}-${Date.now()}`,
          entityType: 'sale',
          entityId: targetId,
          action: 'APPEND',
          data: pending.sale,
          updatedAt: Date.now(),
          originDeviceId: this.config.deviceId,
          targetBranchId: this.config.branchId,
          class: 'T1',
          meta: {
            wireAction: 'SALE_RECORD',
            isRetry: true,
            retryCount: pending.retries,
          },
        };
        try {
          void this.localHubAdapter.broadcast(retryEnvelope);
        } catch (e) {
          console.warn('[MeshSync] Error re-transmitting un-ACKed sale:', e);
        }
      }
    }
  }

  public handleIncomingSaleSyncReceipt(invoiceId: string, originName: string = 'Local Hub') {
    if (!invoiceId) return;
    const cleanId = String(invoiceId).trim();

    // 1. Direct delete from pendingSaleAcks
    let hadPending = this.pendingSaleAcks.delete(cleanId);

    // 2. If not found by direct key, search case-insensitively and inspect nested payload in pendingSaleAcks
    if (!hadPending) {
      for (const [key, pending] of this.pendingSaleAcks.entries()) {
        const nestedId = this.extractInvoiceId(pending.sale) || (pending.sale as any)?.id;
        const matchesKey = key.toUpperCase() === cleanId.toUpperCase();
        const matchesNested = nestedId && nestedId.toUpperCase() === cleanId.toUpperCase();
        const matchesTrimmed = key.replace(/^INV-0*/i, '') === cleanId.replace(/^INV-0*/i, '');

        if (matchesKey || matchesNested || matchesTrimmed) {
          this.pendingSaleAcks.delete(key);
          hadPending = true;
          break;
        }
      }
    }

    // 3. Mark in local RoomDatabase & Persistent IndexedDB queue
    const didMark = markSaleAsSynced(cleanId);
    persistentSyncEngine.markReceiptAsSynced([], [cleanId]);

    // Requirement 1: Add a console.log when a receipt is successfully received so we can verify it.
    console.log(
      `[MeshSync] ✅ SYNC_RECEIPT successfully received and verified for Sale #${cleanId} from ${originName}. ` +
      `Cleared from pending watchdog queue (hadPending: ${hadPending}, markedSynced: ${didMark}). ` +
      `Remaining pending sales: ${this.pendingSaleAcks.size}`
    );

    // Fire-and-Forget: Process silently into local database and STOP.
    // Do NOT generate a new ACK in response. Do NOT rebroadcast it.
    this.addLog(
      'ACK',
      `Sync Receipt (ACK) confirmed for Sale #${cleanId} from ${originName}. Marked as Synced locally!`,
      originName,
      this.config.deviceName,
      undefined,
      cleanId
    );

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_sync_receipt_received', {
        detail: { invoiceId: cleanId, originName, hadPending, didMark }
      }));
    }
  }

  public getPendingSaleAcks(): Array<{ invoiceId: string; sentAt: number; retries: number; durationSec: number }> {
    const now = Date.now();
    const result: Array<{ invoiceId: string; sentAt: number; retries: number; durationSec: number }> = [];
    for (const [invoiceId, pending] of this.pendingSaleAcks.entries()) {
      result.push({
        invoiceId,
        sentAt: pending.sentAt,
        retries: pending.retries,
        durationSec: Math.round((now - pending.sentAt) / 1000),
      });
    }
    return result;
  }

  private pendingHubUiEvents: Map<string, any> = new Map();

  private dispatchHubCoalescedEvent(eventName: string, detail?: any) {
    if (typeof window === 'undefined') return;
    if (this.isIngestingFromHub) {
      this.pendingHubUiEvents.set(eventName, detail);
      this.scheduleBatchUiUpdate();
      return;
    }
    window.dispatchEvent(
      detail !== undefined ? new CustomEvent(eventName, { detail }) : new CustomEvent(eventName)
    );
  }

  private scheduleBatchUiUpdate() {
    if (this.batchUiTimer) return;
    this.batchUiTimer = window.setTimeout(() => {
      this.batchUiTimer = null;
      if (typeof window !== 'undefined') {
        const queued = Array.from(this.pendingHubUiEvents.entries());
        this.pendingHubUiEvents.clear();
        const dispatched = new Set<string>();
        for (const [evtName, detail] of queued) {
          dispatched.add(evtName);
          window.dispatchEvent(
            detail !== undefined ? new CustomEvent(evtName, { detail }) : new CustomEvent(evtName)
          );
        }
        if (!dispatched.has('saimetric_sales_updated')) {
          window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
        }
        if (!dispatched.has('saimetric_cash_updated')) {
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
        if (!dispatched.has('saimetric_inventory_updated')) {
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
      }
    }, 150);
  }

  constructor() {
    this.config = this.loadConfig();

    // Hydrate IndexedDB Multi-Hub Credential Vault backup asynchronously on boot
    void LocalHubConfig.hydrateVaultFromIndexedDb().then(() => {
      this.emitHubSecurityEvent();
    });

    // Hexagonal Architecture Initialization: Adapters + SyncCore + Ingest Bridge
    this.localHubAdapter = new LocalHubAdapter();
    this.syncLocalHubContext();

    // Non-freezing, ACK-paced Cold-Hub Hydration Queue
    this.coldHubHydrationQueue = new ColdHubHydrationQueue({
      isCheckoutActive: () => isPosActiveCheckout(),
      isSocketReady: () => this.isLocalHubConnected && this.localHubAdapter.isReadyForSync(),
      getSocketBufferedAmount: () => this.localHubAdapter.getBufferedAmount(),
      pushSingleRecord: (entityType, recordId, sweepId, isColdHub) =>
        this.pushSingleReconRecord(entityType, recordId, sweepId, isColdHub),
      sendChunkMarker: (payload) => {
        this.localHubAdapter.sendControlPacket(payload);
      },
      onProgress: (progress) => {
        this.hubHydrationProgress = progress;
        this.emitHubSecurityEvent();
      },
    });

    // Hub v4.2.0 Encrypted WAL Storage Telemetry, Pressure Alerts & Authenticated .saimpack RPCs
    this.hubStorageManager = new HubStorageRpcManager({
      isAuthenticated: () =>
        this.isLocalHubConnected && this.localHubAdapter.getAuthState() === 'AUTHENTICATED',
      sendPacket: (payload) => this.localHubAdapter.sendControlPacket(payload),
      getActiveHubId: () => this.activeHubId,
    });

    const cloudAdapter = this.getOrCreateSingleCloudAdapter();
    const initialAdapter =
      this.isLocalHubActive() && !this.isCloudOnlyMode
        ? this.localHubAdapter
        : cloudAdapter;
    this.syncCore = new SyncCore(initialAdapter, this.config.deviceId);
    if (this.isLocalHubActive() && !this.isCloudOnlyMode) {
      cloudAdapter.pause?.();
    }
    this.syncCore.setTombstoneProvider(() => getTombstones());
    registerTombstoneLookup(() => getTombstones());

    registerSyncCoreIngestBridge((envelope, existingRecord, onAcceptedPersist) =>
      this.syncCore.ingest(envelope, existingRecord, onAcceptedPersist)
    );
    registerSyncCoreIngestBatchBridge((envelopes, options) =>
      this.syncCore.ingestBatch(envelopes, options)
    );
    registerSyncCoreSaveAndSyncBridge(async (envelope) => {
      if (this.isIngestingFromHub) {
        return { success: false, packetId: envelope.packetId, error: 'INGEST_GUARD_ACTIVE' };
      }
      this.seenPacketIds.add(envelope.packetId);
      this.syncLocalHubContext();
      this.syncActiveAdapter();
      const result = await this.syncCore.saveAndSync(envelope);
      const wirePacket = this.localHubAdapter.envelopeToWirePacket(envelope);
      this.mirrorToSecondaryP2PTransports(envelope.meta?.topicSuffix || envelope.entityType, wirePacket);
      return result;
    });

    // Bind LocalHubAdapter exclusive WebSocket lifecycle callbacks
    this.localHubAdapter.onOpenCallback = (hubUrl: string) => {
      if (this.legacyFallbackTimer) {
        clearTimeout(this.legacyFallbackTimer);
        this.legacyFallbackTimer = null;
      }
      if (this.localHubLostGraceTimer) {
        clearTimeout(this.localHubLostGraceTimer);
        this.localHubLostGraceTimer = null;
      }
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      }
      if (this.pairChallengeWaitTimer) {
        clearTimeout(this.pairChallengeWaitTimer);
        this.pairChallengeWaitTimer = null;
      }
      this.localHubReconnectAttempts = 0;
      this.hubAuthError = null;
      this.lastHubPongReceivedAt = Date.now();
      this.syncLocalHubContext();

      // 1. Explicit Pairing Flow: wait briefly (up to 500ms) for AUTH_CHALLENGE first so
      //    if this Hub's hubId is ALREADY paired, we immediately authenticate via Mutual HMAC
      //    instead of ever forcing a re-pair!
      if (this.pendingPairRequest && normalizeHubUrl(this.pendingPairRequest.wsUrl) === normalizeHubUrl(hubUrl)) {
        this.localHubAdapter.setAuthState('HANDSHAKING', null);
        this.pairChallengeWaitTimer = setTimeout(() => {
          this.pairChallengeWaitTimer = null;
          if (!this.pendingPairRequest || !this.localHubAdapter.isConnected()) return;
          if (this.localHubAdapter.getAuthState() === 'AUTHENTICATED') return;
          this.sendPendingPairRequestPacket(hubUrl);
        }, 500);
        this.emitHubSecurityEvent();
        return;
      }

      // 2. Normal Connect: Wait up to 1.2s for AUTH_CHALLENGE (Android APK / Secure Hub).
      // Also send minimal PING_HUB so Termux backup hubs reply immediately with HUB_INFO.
      const isStrictPairedUrl = LocalHubConfig.isStrictAuthRequiredForUrl(hubUrl);
      this.addLog(
        'DISCOVERY',
        `Local WebSocket Hub opened (${hubUrl}). Negotiating ${isStrictPairedUrl ? 'strict mutual auth' : 'identity & auth handshake'}...`,
        this.config.deviceName
      );

      try {
        this.localHubAdapter.sendControlPacket({
          type: 'PING_HUB',
          action: 'PING_HUB',
          deviceId: this.config.deviceId,
          deviceName: this.config.deviceName,
          timestamp: Date.now(),
        });
      } catch {}

      this.legacyFallbackTimer = setTimeout(() => {
        this.legacyFallbackTimer = null;
        if (!this.localHubAdapter.isConnected()) return;
        const curState = this.localHubAdapter.getAuthState();
        if (curState !== 'HANDSHAKING') return;

        // Downgrade protection: if this URL is paired to a secure Hub, refuse unauthenticated fallback!
        if (LocalHubConfig.isStrictAuthRequiredForUrl(hubUrl)) {
          this.hubAuthError =
            'Security block: Paired Hub did not send an authentication challenge. Unpair explicitly if switching back to Termux backup.';
          this.localHubAdapter.setAuthState('AUTH_FAILED', null);
          this.addLog('SECURITY_DROP', this.hubAuthError, this.config.deviceName);
          this.emitHubSecurityEvent();
          void this.localHubAdapter.disconnect(false);
          return;
        }

        // Seamless Termux backup coexistence for unpaired legacy Hubs
        this.activeHubRuntime = 'TERMUX';
        this.localHubAdapter.setAuthState('LEGACY_BACKUP', null);
        this.completePostAuthHubSession(hubUrl, false);
      }, 1200);
    };

    this.localHubAdapter.onControlPacketCallback = (pType: string, parsed: any) => {
      if (pType === 'PONG') {
        this.lastHubPongReceivedAt = Date.now();
        if (typeof parsed.ts === 'number' && parsed.ts > 1_600_000_000_000) {
          reportTrustedTimeSample(parsed.ts, 'LOCAL_HUB');
        }
        return;
      }

      if (pType === 'AUTH_CHALLENGE') {
        void this.handleAuthChallenge(parsed);
        return;
      }

      if (pType === 'AUTH_OK') {
        void this.handleAuthOk(parsed);
        return;
      }

      if (pType === 'AUTH_FAILED') {
        this.handleAuthFailed(parsed);
        return;
      }

      if (pType === 'PAIR_PENDING') {
        this.handlePairPending(parsed);
        return;
      }

      if (pType === 'PAIR_APPROVED') {
        this.handlePairApproved(parsed);
        return;
      }

      if (pType === 'PAIR_REJECTED') {
        this.handlePairRejected(parsed);
        return;
      }

      if (pType === 'HUB_UPDATING') {
        this.handleHubUpdating(parsed);
        return;
      }

      if (pType === 'HUB_UPDATE_STATUS') {
        this.hubOtaStatus = {
          status: String(parsed.status || 'INFO'),
          targetVersion: parsed.targetVersion || parsed.version,
          etaSeconds: parsed.etaSeconds,
          message: parsed.message || 'Hub OTA status updated.',
          updatedAt: Date.now(),
        };
        this.emitHubSecurityEvent();
        return;
      }

      if (pType === 'HUB_ROLE_STATUS') {
        void this.handleHubRoleStatus(parsed);
        return;
      }

      if (pType === 'RECON_PUSH_CHUNK_ACK' || pType === 'RECON_CHUNK_ACK') {
        this.coldHubHydrationQueue.notifyAck({
          sweepId: parsed.sweepId ? String(parsed.sweepId) : undefined,
          entityType: parsed.entityType ? String(parsed.entityType) : undefined,
          chunkIndex: typeof parsed.chunkIndex === 'number' ? parsed.chunkIndex : undefined,
        });
        return;
      }

      if (
        pType === 'STORAGE_PRESSURE_ALERT' ||
        pType === 'STORAGE_STATUS_RESPONSE' ||
        pType === 'ARCHIVE_PACK_LIST_RESPONSE' ||
        pType === 'ARCHIVE_PACK_CREATED' ||
        pType === 'ARCHIVE_PACK_DOWNLOAD_CHUNK' ||
        pType === 'ARCHIVE_PACK_EVICT_ACK' ||
        pType === 'ARCHIVE_PACK_ERROR'
      ) {
        this.hubStorageManager.handleIncomingPacket(pType, parsed);
        if (pType === 'STORAGE_PRESSURE_ALERT') {
          this.addLog(
            'STORAGE',
            `Local Hub storage pressure alert: ${parsed.stage || 'WARNING'} (${parsed.usagePct ?? '?'}% — ${parsed.totalRecords ?? '?'} / ${parsed.softRecordLimit ?? '?'} records, ${parsed.unsyncedT1Count ?? 0} unsynced T1).`,
            this.activeHubId || 'Local Hub'
          );
        }
        return;
      }

      if (pType === 'HUB_INFO') {
        // Record metadata even during pre-auth lobby; only trigger sync if authenticated or legacy backup
        this.activeHubId = parsed.hub_id || parsed.hubId || this.activeHubId;
        this.activeHubVersion = parsed.version || this.activeHubVersion;
        if (parsed.hub_runtime === 'ANDROID_APK' || parsed.hub_runtime === 'TERMUX') {
          this.activeHubRuntime = parsed.hub_runtime;
        }
        if (parsed.ota_slot) {
          this.activeHubOtaSlot = String(parsed.ota_slot);
        }
        if (parsed.storageCapacity || parsed.storage_capacity) {
          this.hubStorageManager.updateFromHealth(
            parsed.storageCapacity || parsed.storage_capacity,
            this.activeHubId || undefined
          );
        }
        this.applyHubFailoverMetadata(parsed);
        // If Hub explicitly reports auth_required === false and we are still handshaking on an unpaired Termux backup, activate immediately
        if (
          this.localHubAdapter.getAuthState() === 'HANDSHAKING' &&
          parsed.auth_required !== true &&
          !LocalHubConfig.isStrictAuthRequiredForUrl(this.localHubAdapter.getActiveHubUrl())
        ) {
          if (this.legacyFallbackTimer) {
            clearTimeout(this.legacyFallbackTimer);
            this.legacyFallbackTimer = null;
          }
          this.localHubAdapter.setAuthState('LEGACY_BACKUP', null);
          this.completePostAuthHubSession(this.localHubAdapter.getActiveHubUrl(), false);
        }
        if (this.localHubAdapter.isReadyForSync()) {
          this.handleIncomingHubInfo(parsed);
          if (normalizeHubMode(parsed.hubMode ?? parsed.hub_mode) === 'STANDBY' && parsed.activeLeaderInfo) {
            void this.handleHubRoleStatus(parsed);
          }
        }
        this.emitHubSecurityEvent();
      } else if (pType === 'RESET_CONFIRMED') {
        this.handleIncomingResetConfirmed(parsed);
      } else if (pType === 'DRAIN_COMPLETE_ACK') {
        if (this.drainAckFallbackTimer) {
          clearTimeout(this.drainAckFallbackTimer);
          this.drainAckFallbackTimer = null;
        }
        if (this.isAwaitingDrainAck) {
          this.isAwaitingDrainAck = false;
          this.triggerDeltaCatchUpAfterFlush();
        }
      } else if (pType === 'SYNC_ACK') {
        this.handleSyncAck(parsed);
      } else if (pType === 'RECON_SWEEP_TRIGGER') {
        this.handleReconSweepTrigger(parsed);
      } else if (pType === 'SYNC_SNAPSHOT_REQUEST') {
        this.handleSyncSnapshotRequest(parsed);
      } else if (pType === 'SYNC_ID_DIGEST_REQUEST') {
        this.handleSyncIdDigestRequest(parsed);
      } else if (pType === 'RECON_BACKFILL_PAYLOAD') {
        this.handleIncomingReconBackfill(parsed);
      } else if (pType === 'RECON_PUSH_BACKFILL_REQUEST') {
        void this.handleReconPushBackfillRequest(parsed);
      } else if (pType === 'HUB_CLOUD_BROADCAST') {
        this.handleHubCloudBroadcast(parsed);
      } else if (pType === 'SECURITY_ALERT') {
        this.handleSecurityAlertPacket(parsed);
      } else if (pType === 'HUB_ROUTING_EPOCH_UPDATED') {
        const compId = String(parsed.company_id || this.config.companyId || 'COMP-001').trim();
        const nextEp = Number(parsed.routing_epoch || parsed.current_routing_epoch || 0);
        if (nextEp > 0) setRoutingEpoch(compId, nextEp);
        resetCloudCatchupCursors(compId, this.config.branchId);
      } else if (pType === 'CLOUD_AUTH_REFRESH_REQUIRED') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_cloud_auth_required', { detail: parsed }));
        }
        setTimeout(() => {
          if (this.getActiveSyncStrategy() === 'HUB_CLOUD' && this.isLocalHubConnected) {
            this.sendAndPurgeCloudConfigIfHubCloud();
          }
        }, 1500);
      }
    };

    this.localHubAdapter.onPacketsCallback = (batch: any[]) => {
      this.enqueueHubPackets(batch);
    };

    this.localHubAdapter.onErrorCallback = () => {
      this.handleLocalHubLost('Local Hub WebSocket connection dropped');
    };

    this.localHubAdapter.onCloseCallback = (reason: string) => {
      this.handleLocalHubLost(reason || 'Local Hub WebSocket closed');
    };

    this.syncActiveAdapter();

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

    this.virtualMeshSimulator = new VirtualMeshSimulator({
      getConfig: () => this.config,
      addLog: (type, message, sourceDevice, targetDevice, ttl, uuid) =>
        this.addLog(type, message, sourceDevice, targetDevice, ttl, uuid),
      notifyPeerSubscribers: () => this.notifyPeerSubscribers(),
    });
    this.stocktakeTransport = new StocktakeMeshTransport({
      getConfig: () => this.config,
      isLocalHubConnected: () => this.isLocalHubConnected,
      sendControlPacket: (packet) => this.localHubAdapter.sendControlPacket(packet),
      dispatchEnvelope: (entityType, entityId, data, options) =>
        this.dispatchEnvelope(entityType, entityId, data, options),
      addLog: (type, message, sourceDevice) => this.addLog(type, message, sourceDevice),
      notifyPeerSubscribers: () => this.notifyPeerSubscribers(),
    });

    this.initServerStream();
    this.initBroadcastChannel();
    this.initVirtualMeshDefault();
    this.startOpportunisticCloudSyncTimer();
    this.configurePackageAwareAutoHeal();

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

    // Online / Offline, Wi-Fi/Hotspot Network Change & Instant Wake Reconnect listeners
    if (typeof window !== 'undefined') {
      // Check for native-camera deep-link params (?pairHost=...&pairCode=...&hubId=...&mdnsHost=...)
      try {
        const deepLink = parsePairDeepLink(window.location.search || '');
        if (deepLink) {
          // Strip pairing query parameters immediately so codes never linger in browser history
          try {
            window.history.replaceState({}, '', window.location.pathname + window.location.hash);
          } catch {}
          setTimeout(() => {
            // NEVER force re-pairing if hubId is already paired!
            const existingByHubId = deepLink.hubId
              ? LocalHubConfig.getPairedHubById(deepLink.hubId)
              : null;
            if (existingByHubId && !this.revokedHubIds.has(existingByHubId.hubId.toUpperCase())) {
              const prevHost = existingByHubId.lastKnownHost.toLowerCase();
              const nextHost = deepLink.lastKnownHost.toLowerCase();
              LocalHubConfig.touchPairedHubProfile(existingByHubId.hubId, {
                wsUrl: deepLink.wsUrl,
                lastKnownHost: deepLink.lastKnownHost,
                port: deepLink.port,
                ...(deepLink.mdnsHost ? { mdnsHost: deepLink.mdnsHost } : {}),
                ...(deepLink.lanIps ? { lanIps: deepLink.lanIps } : {}),
              });
              LocalHubConfig.setLocalHubUrl(deepLink.wsUrl);
              if (prevHost && prevHost !== nextHost) {
                this.pendingRoamedToast = true;
              }
              this.connectLocalHub(deepLink.wsUrl);
              return;
            }
            this.startHubPairing(deepLink.wsUrl, deepLink.pairCode, {
              hubId: deepLink.hubId,
              mdnsHost: deepLink.mdnsHost,
              lanIps: deepLink.lanIps,
            });
          }, 800);
        }
      } catch {}

      window.addEventListener('online', () => {
        this.addLog(
          'DISCOVERY',
          'Network state restored. Checking Local Hub IP & mesh relay...',
          this.config.deviceName
        );
        this.localHubReconnectAttempts = 0;
        if (!this.isLocalHubConnected && this.localHubAdapter.getAuthState() !== 'AUTH_FAILED') {
          if (LocalHubConfig.hasAnyPairedHub()) {
            void this.discoverAndReconnectHub();
          } else {
            this.connectLocalHub();
          }
        }
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
        if (LocalHubConfig.hasAnyPairedHub() && !this.isLocalHubConnected) {
          void this.discoverAndReconnectHub();
        } else {
          this.connectLocalHub();
        }
      });

      // Wi-Fi SSID / Hotspot switch detection via Network Information API (navigator.connection)
      try {
        const navConn = (navigator as any)?.connection;
        if (navConn && typeof navConn.addEventListener === 'function') {
          navConn.addEventListener('change', () => {
            this.addLog(
              'DISCOVERY',
              'Wi-Fi / network interface changed. Probing paired Local Hub at new IP...',
              this.config.deviceName
            );
            this.localHubReconnectAttempts = 0;
            if (LocalHubConfig.hasAnyPairedHub() && this.localHubAdapter.getAuthState() !== 'AUTH_FAILED') {
              void this.discoverAndReconnectHub({ forceScan: !this.isLocalHubConnected });
            } else if (!this.isLocalHubConnected && this.localHubAdapter.getAuthState() !== 'AUTH_FAILED') {
              this.connectLocalHub();
            }
          });
        }
      } catch {}

      // When terminal awakens, tab regains focus or user unlocks device after being away
      window.addEventListener('focus', () => {
        if (!this.isLocalHubConnected && this.localHubAdapter.getAuthState() !== 'AUTH_FAILED') {
          this.localHubReconnectAttempts = 0;
          if (LocalHubConfig.hasAnyPairedHub()) {
            void this.discoverAndReconnectHub();
          } else {
            this.connectLocalHub();
          }
        }
        this.checkAndRequestCatchUpIfStale();
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            if (!this.isLocalHubConnected && this.localHubAdapter.getAuthState() !== 'AUTH_FAILED') {
              this.localHubReconnectAttempts = 0;
              if (LocalHubConfig.hasAnyPairedHub()) {
                void this.discoverAndReconnectHub();
              } else {
                this.connectLocalHub();
              }
            }
            this.checkAndRequestCatchUpIfStale();
          }
        });
      }
    }

    // Auto-hook into POS Sales: broadcast in real-time
    onSaleCreated((sale: SaleInvoice) => {
      this.broadcastSale(sale).catch(() => {});
    });

    // Auto-hook into POS Sales updates (Refunds, Voids, Item Exchanges): broadcast in real-time
    onSaleUpdated((sale: SaleInvoice, extraCashLogs?: CashLogEntry[]) => {
      this.broadcastSaleUpdate(sale, extraCashLogs).catch(() => {});
    });

    // Auto-hook into Form 2 Cash Logs (Refunds, Voids, Sale Deposits, Manual Entries)
    onCashLogCreated((log: CashLogEntry) => {
      this.broadcastCashLog(log, 'APPEND');
    });
    onCashLogUpdated((log: CashLogEntry) => {
      this.broadcastCashLog(log, 'UPSERT');
    });

    // Auto-hook into Staff creation & edits: broadcast to Local Hub & mesh
    onStaffChanged((staff: Salesperson) => {
      const activeStrategy = getPackageSyncMode();
      console.log('[STAFF TRACE] 2. Sync Router. Strategy:', activeStrategy, 'isLocalHubActive:', this.isLocalHubActive());
      this.broadcastStaff(staff);
    });

    // Auto-hook into 52 Granular Permissions Matrix changes
    onPermissionsMatrixChanged((rules, updatedAt) => {
      this.broadcastPermissionsMatrix(rules, updatedAt);
    });

    // Auto-hook into Role Navigation / Access Config changes
    onRoleDefinitionsChanged((defs, updatedAt) => {
      this.broadcastRoleDefinitions(defs, updatedAt);
    });

    // Auto-hook into Multi-Currency & Exchange Rates changes (T2 LWW)
    onMultiCurrencyChanged((mcConfig) => {
      this.broadcastMultiCurrencyConfig(mcConfig);
    });

    // Auto-hook into Customer creation & edits: broadcast to Local Hub & mesh
    onCustomerChanged((cust: any) => {
      this.broadcastCustomer(cust);
    });

    // Auto-hook into Supplier creation & edits: broadcast to Local Hub & mesh
    onSupplierChanged((supp: any) => {
      this.broadcastSupplier(supp);
    });

    // Auto-hook into Branch creation & edits: broadcast to Local Hub & mesh
    onBranchChanged((branch: any) => {
      this.broadcastBranch(branch);
    });

    // Auto-hook into Cash Account creation & edits: broadcast to Local Hub & mesh
    onCashAccountChanged((account: any) => {
      this.broadcastCashAccount(account);
    });

    // Auto-hook into Cash Transfer creation & state transitions: broadcast to Local Hub & mesh
    onCashTransferChanged((transfer: any) => {
      this.broadcastCashTransfer(transfer);
    });

    // Auto-hook into Electronic Settlements (EcoCash & ZiG confirmations): broadcast via SyncCore to Local Hub, Cloud & mesh
    onElectronicSettlementChanged((settlement: any) => {
      this.broadcastElectronicSettlement(settlement);
    });

    // Auto-hook into Cash Drawer Movements: broadcast in real-time so cash balances across devices
    onCashMovementCreated((movement: CashMovement) => {
      this.broadcastCashMovement(movement);
    });

    // Auto-hook into Expenses (Create / Supervisor Approve / Reject): broadcast to Local Hub & mesh
    onExpenseChanged((expense: any) => {
      this.broadcastExpense(expense);
    });

    // Auto-hook into Direct GRVs (Create / Supervisor Approve / Reject): broadcast to Local Hub & mesh
    onDirectGrvChanged((grv: DirectGrv) => {
      this.broadcastDirectGrv(grv);
    });

    // Auto-hook into Shop Use / Internal Consumption (Create / Approve / Reject): broadcast to Local Hub & mesh
    onInternalConsumptionChanged((req: InternalConsumption) => {
      this.broadcastInternalConsumption(req);
    });

    // Auto-hook into POS Inventory: broadcast product changes
    onInventoryCreated((item: InventoryItem) => {
      this.broadcastInventoryItem(item);
    });

    // Auto-hook into Whole Database Mutation Bus
    onDatabaseMutation((mutation: DatabaseMutationEvent) => {
      if (mutation.fromSync === true || (mutation as any).payload?.fromSync === true) {
        return;
      }
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
    this.startAckWatchdogLoop();

    // Safeguard 3: Inventory Reconciliation listener
    if (typeof window !== 'undefined') {
      window.addEventListener('saimetric_stock_variance_detected', (e: any) => {
        const d = e.detail || {};
        this.addLog(
          'CONFLICT_RESOLVED',
          `⚠️ STOCK VARIANCE: "${d.itemName}" (${d.itemId}) fell negative (${d.negativeUnits} units) after offline sale deduction (Invoice #${d.referenceId || 'N/A'}). Logged in Audit Log.`,
          'Reconciliation Engine'
        );
      });
      // Safeguard 4: Expose Tornado test runner on window
      (window as any).__runTornadoTest = (numDevices = 5, salesPerDevice = 10) =>
        this.simulateTornadoBurst(numDevices, salesPerDevice);

      // Re-Handshake on Login: Automatically dispatch fresh HANDSHAKE packet when user logs in
      window.addEventListener('saimetric_user_logged_in', (e: any) => {
        const user = e?.detail;
        const branchId = user?.branchId || user?.branch_id || getCurrentBranchId();
        const branchName = user?.branchName;
        this.sendHandshake(branchId, branchName);
      });
    }

    // Periodic pull from server - gentle background interval ONLY when Local Hub is inactive
    if (typeof window !== 'undefined') {
      window.setInterval(() => {
        if (this.isLocalHubActive() && !this.isCloudOnlyMode) return;
        const cloudAdapter = this.getOrCreateSingleCloudAdapter();
        if (cloudAdapter.isPaused?.() || getActiveCloudConfig().databaseType !== 'appscripts') return;
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

    const deviceId = getDeviceId();

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
    this.syncLocalHubContext();
    this.syncCore.setDeviceId(this.config.deviceId);

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
      this.syncLocalHubContext();

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
      hubAuthState: this.localHubAdapter.getAuthState(),
      hubId: this.activeHubId,
      hubVersion: this.activeHubVersion,
      hubRuntime: this.activeHubRuntime,
      hubOtaSlot: this.activeHubOtaSlot,
      hubAuthError: this.hubAuthError,
      hubOtaStatus: this.hubOtaStatus,
      pendingPairVisualCode: this.pendingPairRequest?.visualCode || null,
    };
  }

  // ==================== MUTUAL AUTH, PAIRING & OTA HANDLERS ====================

  public getHubSecurityStatus(): {
    authState: HubAuthState;
    hubUrl: string;
    hubId: string | null;
    mdnsHost: string | null;
    hubVersion: string | null;
    hubRuntime: 'ANDROID_APK' | 'TERMUX' | 'UNKNOWN';
    otaSlot: string | null;
    hubRole: HubRole | null;
    hubPriority: number | null;
    branchEpoch: number;
    hubMode: HubMode;
    isColdHub: boolean;
    activeLeaderHubId: string | null;
    activeLeaderInfo: ActiveLeaderInfo | null;
    unpairedActiveLeader: ActiveLeaderInfo | null;
    hydrationProgress: ColdHubHydrationProgress;
    isMutuallyAuthenticated: boolean;
    pairedProfile: PairedHubProfile | null;
    hasPairedHubs: boolean;
    authError: string | null;
    wasRevoked: boolean;
    isDiscovering: boolean;
    discoveryStage: DiscoveryStage | null;
    otaStatus: { status: string; targetVersion?: string; etaSeconds?: number; message?: string; updatedAt: number } | null;
    pendingPair: { wsUrl: string; visualCode?: string; hubId?: string; branchName?: string } | null;
  } {
    const hubUrl = LocalHubConfig.getLocalHubUrl();
    const pairedProfile =
      (this.activeHubId ? LocalHubConfig.getPairedHubById(this.activeHubId) : null) ||
      LocalHubConfig.getPairedHubForUrl(hubUrl) ||
      LocalHubConfig.getPrimaryPairedHub(this.config.branchId);
    const authState = this.localHubAdapter.getAuthState();
    const effectiveRole = this.activeHubRole || pairedProfile?.hubRole || null;
    const effectivePriority =
      this.activeHubPriority !== null
        ? this.activeHubPriority
        : pairedProfile?.hubPriority ?? null;
    return {
      authState,
      hubUrl,
      hubId: this.activeHubId || pairedProfile?.hubId || null,
      mdnsHost: this.activeHubMdnsHost || pairedProfile?.mdnsHost || null,
      hubVersion: this.activeHubVersion || pairedProfile?.hubVersion || null,
      hubRuntime: this.activeHubRuntime !== 'UNKNOWN' ? this.activeHubRuntime : (pairedProfile?.hubRuntime || 'UNKNOWN'),
      otaSlot: this.activeHubOtaSlot,
      hubRole: effectiveRole,
      hubPriority: effectivePriority,
      branchEpoch: Math.max(this.activeHubBranchEpoch, pairedProfile?.lastEpoch || 1),
      hubMode: this.activeHubMode,
      isColdHub: this.activeHubIsColdHub,
      activeLeaderHubId: this.activeLeaderHubId,
      activeLeaderInfo: this.activeLeaderInfo,
      unpairedActiveLeader: this.unpairedActiveLeader,
      hydrationProgress: { ...this.hubHydrationProgress },
      isMutuallyAuthenticated: authState === 'AUTHENTICATED',
      pairedProfile,
      hasPairedHubs: LocalHubConfig.hasAnyPairedHub(),
      authError: this.hubAuthError,
      wasRevoked: this.lastAuthFailureWasRevoked,
      isDiscovering: this.isDiscoveringHub,
      discoveryStage: this.discoveryStage,
      otaStatus: this.hubOtaStatus,
      pendingPair: this.pendingPairRequest
        ? {
            wsUrl: this.pendingPairRequest.wsUrl,
            visualCode: this.pendingPairRequest.visualCode,
            hubId: this.pendingPairRequest.hubId,
            branchName: this.pendingPairRequest.branchName,
          }
        : null,
    };
  }

  public dismissUnpairedActiveLeader(): void {
    if (!this.unpairedActiveLeader) return;
    this.unpairedActiveLeader = null;
    this.emitHubSecurityEvent();
  }

  public getHubStorageSnapshot(): HubStorageSnapshot {
    return this.hubStorageManager.getSnapshot();
  }

  public subscribeHubStorage(listener: (snap: HubStorageSnapshot) => void): () => void {
    return this.hubStorageManager.subscribe(listener);
  }

  public dismissHubStorageAlert(): void {
    this.hubStorageManager.dismissBanner();
  }

  public ingestHubHealthStorageCapacity(rawCapacity: any, hubId?: string): void {
    this.hubStorageManager.updateFromHealth(rawCapacity, hubId || this.activeHubId || undefined);
  }

  public queryHubStorageStatus(): Promise<HubStorageCapacity | null> {
    return this.hubStorageManager.queryStorageStatus();
  }

  public listHubArchivePacks(): Promise<HubArchivePackListResult> {
    return this.hubStorageManager.listArchivePacks();
  }

  public createHubArchivePack(options: HubArchiveCreateOptions = {}): Promise<HubArchiveCreateResult> {
    return this.hubStorageManager.createArchivePack(options);
  }

  public downloadHubArchivePack(
    packId: string,
    options?: {
      onProgress?: (progress: HubArchiveDownloadProgress) => void;
      autoSaveToBrowser?: boolean;
    }
  ): Promise<HubArchiveDownloadResult> {
    return this.hubStorageManager.downloadArchivePack(packId, options);
  }

  public confirmHubArchiveEvict(packId: string, payloadSha256: string): Promise<HubArchiveEvictResult> {
    return this.hubStorageManager.confirmArchiveEvict(packId, payloadSha256);
  }

  private applyHubFailoverMetadata(packet: any): {
    hubRole?: HubRole;
    hubPriority?: number;
    branchEpoch?: number;
    hubMode?: HubMode;
    isColdHub?: boolean;
    activeLeaderHubId?: string | null;
    activeLeaderInfo?: ActiveLeaderInfo | null;
  } {
    if (!packet || typeof packet !== 'object') return {};
    const rawRole = packet.hubRole ?? packet.hub_role;
    const rawPriority = packet.hubPriority ?? packet.hub_priority;
    const rawEpoch = packet.branchEpoch ?? packet.branch_epoch;
    const rawMode = packet.hubMode ?? packet.hub_mode;
    const rawCold = packet.isColdHub ?? packet.is_cold_hub;
    const rawLeaderId = packet.activeLeaderHubId ?? packet.active_leader_hub_id;
    const rawLeaderInfo = packet.activeLeaderInfo ?? packet.active_leader_info;

    const hubRole = rawRole ? normalizeHubRole(rawRole) : undefined;
    const hubPriority =
      rawPriority !== undefined && rawPriority !== null
        ? normalizeHubPriority(rawPriority, hubRole)
        : hubRole
        ? normalizeHubPriority(undefined, hubRole)
        : undefined;
    const branchEpoch =
      rawEpoch !== undefined && rawEpoch !== null ? normalizeBranchEpoch(rawEpoch) : undefined;
    const hubMode = rawMode ? normalizeHubMode(rawMode) : undefined;
    const isColdHub = typeof rawCold === 'boolean' ? rawCold : undefined;
    const activeLeaderHubId =
      rawLeaderId !== undefined ? (rawLeaderId ? String(rawLeaderId).trim() : null) : undefined;
    const activeLeaderInfo =
      rawLeaderInfo !== undefined ? sanitizeActiveLeaderInfo(rawLeaderInfo) : undefined;

    if (hubRole) this.activeHubRole = hubRole;
    if (hubPriority !== undefined) this.activeHubPriority = hubPriority;
    if (branchEpoch !== undefined) this.activeHubBranchEpoch = branchEpoch;
    if (hubMode) this.activeHubMode = hubMode;
    if (isColdHub !== undefined) this.activeHubIsColdHub = isColdHub;
    if (activeLeaderHubId !== undefined) this.activeLeaderHubId = activeLeaderHubId;
    if (activeLeaderInfo !== undefined) this.activeLeaderInfo = activeLeaderInfo;

    return {
      ...(hubRole ? { hubRole } : {}),
      ...(hubPriority !== undefined ? { hubPriority } : {}),
      ...(branchEpoch !== undefined ? { branchEpoch } : {}),
      ...(hubMode ? { hubMode } : {}),
      ...(isColdHub !== undefined ? { isColdHub } : {}),
      ...(activeLeaderHubId !== undefined ? { activeLeaderHubId } : {}),
      ...(activeLeaderInfo !== undefined ? { activeLeaderInfo } : {}),
    };
  }

  /**
   * Handles live `HUB_ROLE_STATUS` failover events from the currently connected Hub.
   * When the connected Hub transitions to `STANDBY` and announces `activeLeaderInfo`:
   *   1. Flush pending in-flight T1 outbox items cleanly.
   *   2. Close the current socket and cancel any cold-hub hydration.
   *   3. If `activeLeaderInfo.hubId` is already in the Multi-Hub Vault, reconnect silently via HMAC-SHA256!
   *   4. If NOT paired yet (e.g., emergency replacement phone), surface the non-blocking
   *      "New Active Branch Hub Detected — Approve Pairing" banner.
   */
  public async handleHubRoleStatus(packet: any): Promise<void> {
    if (!packet || typeof packet !== 'object') return;
    const meta = this.applyHubFailoverMetadata(packet);
    const packetHubId = String(packet.hubId || packet.hub_id || this.activeHubId || '').trim();

    if (packetHubId && (meta.hubRole || meta.hubPriority !== undefined || meta.branchEpoch !== undefined || meta.hubMode)) {
      LocalHubConfig.touchPairedHubProfile(packetHubId, {
        ...(meta.hubRole ? { hubRole: meta.hubRole } : {}),
        ...(meta.hubPriority !== undefined ? { hubPriority: meta.hubPriority } : {}),
        ...(meta.branchEpoch !== undefined ? { lastEpoch: meta.branchEpoch } : {}),
        ...(meta.hubMode ? { hubMode: meta.hubMode } : {}),
      });
    }

    this.emitHubSecurityEvent();

    if (meta.hubMode !== 'STANDBY') {
      return;
    }

    const leader = meta.activeLeaderInfo || this.activeLeaderInfo;
    if (!leader || !leader.hubId || !leader.wsUrl) {
      return;
    }

    // Strict tenant/branch scope check before switching Hubs
    const activeInfo = this.getActiveBranchInfo();
    const pktTenant = String(packet.tenantId || packet.tenant_id || '').trim().toUpperCase();
    const pktBranch = String(packet.branchId || packet.branch_id || '').trim().toUpperCase();
    const myTenant = String(activeInfo.companyId || this.config.companyId || '').trim().toUpperCase();
    const myBranch = String(activeInfo.branchId || this.config.branchId || '').trim().toUpperCase();
    if (pktTenant && myTenant && pktTenant !== myTenant) return;
    if (pktBranch && myBranch && myBranch !== 'ALL' && pktBranch !== 'UNASSIGNED' && pktBranch !== myBranch) {
      return;
    }

    // Already connected to this leader Hub on the same URL
    const sameHubId = this.activeHubId && this.activeHubId.toUpperCase() === leader.hubId.toUpperCase();
    const sameWsUrl =
      normalizeHubUrl(this.localHubAdapter.getActiveHubUrl()) === normalizeHubUrl(leader.wsUrl);
    if (sameHubId && sameWsUrl) {
      return;
    }

    if (this.isHandlingFailoverHandoff) {
      return;
    }
    this.isHandlingFailoverHandoff = true;

    try {
      // Cancel any in-flight cold hydration targeting the demoted STANDBY Hub
      this.coldHubHydrationQueue.cancel();

      // Flush pending T1 outbox before leaving the demoted Hub
      if (this.isLocalHubConnected && this.localHubAdapter.isReadyForSync() && !this.isCloudOnlyMode) {
        try {
          await this.drainQueueToLocalHub();
          await new Promise((r) => setTimeout(r, 150));
        } catch {}
      }

      const leaderProfile = LocalHubConfig.getPairedHubById(leader.hubId);
      const isRevoked = this.revokedHubIds.has(leader.hubId.toUpperCase());

      if (leaderProfile && !isRevoked) {
        this.unpairedActiveLeader = null;
        const parsedLeader = extractHostAndPort(leader.wsUrl);
        LocalHubConfig.touchPairedHubProfile(leader.hubId, {
          wsUrl: leader.wsUrl,
          lastWsUrl: leader.wsUrl,
          lastIp: leader.lanIp || parsedLeader.hostname,
          lastKnownHost: parsedLeader.hostPort,
          port: leader.wsPort || parsedLeader.port,
          lastPort: leader.wsPort || parsedLeader.port,
          hubRole: leader.hubRole,
          hubPriority: leader.hubPriority,
          lastEpoch: leader.branchEpoch,
          hubMode: 'ACTIVE',
        });
        LocalHubConfig.setLocalHubUrl(leader.wsUrl);

        this.pendingFailoverToastMessage = `Switched to Active Branch Hub (${leader.hubRole}) — reconnected securely`;
        this.addLog(
          'DISCOVERY',
          `Active Hub handoff: ${packetHubId || 'Previous Hub'} entered STANDBY -> silently failing over to ${leader.hubId} (${leader.hubRole}, Epoch ${leader.branchEpoch}) at ${leader.wsUrl}.`,
          this.config.deviceName
        );

        if (this.localHubReconnectTimer) {
          clearTimeout(this.localHubReconnectTimer);
          this.localHubReconnectTimer = null;
        }

        await this.localHubAdapter.disconnect(true);
        this.syncLocalHubContext();
        void this.localHubAdapter.connect(leader.wsUrl);
      } else {
        // Emergency replacement Hub is ACTIVE on this branch but not yet in our Multi-Hub Vault
        this.unpairedActiveLeader = leader;
        this.addLog(
          'DISCOVERY',
          `New unpaired Active Branch Hub detected (${leader.hubId} / ${leader.hubRole} at ${leader.wsUrl}). Waiting for operator pairing approval.`,
          this.config.deviceName
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('saimetric_unpaired_leader_detected', { detail: leader })
          );
        }
      }
      this.emitHubSecurityEvent();
    } finally {
      this.isHandlingFailoverHandoff = false;
    }
  }

  private emitHubSecurityEvent(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('saimetric_hub_security_updated', {
          detail: this.getHubSecurityStatus(),
        })
      );
    }
  }

  private emitHubToast(message: string): void {
    if (typeof window !== 'undefined' && message) {
      window.dispatchEvent(
        new CustomEvent('saimetric_hub_toast', {
          detail: { message },
        })
      );
    }
  }

  private sendPendingPairRequestPacket(hubUrl: string): void {
    if (!this.pendingPairRequest) return;
    const activeInfo = this.getActiveBranchInfo();
    this.localHubAdapter.setAuthState('PAIRING_PENDING', null);
    this.localHubAdapter.sendControlPacket({
      type: 'PAIR_REQUEST',
      action: 'PAIR_REQUEST',
      pairCode: this.pendingPairRequest.pairCode || '',
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      branchId: activeInfo.branchId,
      branchName: activeInfo.branchName,
      tenantId: activeInfo.companyId,
      clientNonce: this.pendingPairRequest.clientNonce,
      timestamp: Date.now(),
    });
    this.addLog(
      'DISCOVERY',
      `Pairing handshake sent to Local Hub (${hubUrl})...`,
      this.config.deviceName
    );
    this.emitHubSecurityEvent();
  }

  /**
   * Deterministic 3-Hub Failover & Wi-Fi/Hotspot IP Roaming Discovery:
   *   - Filters strictly to the logged-in user's `tenantId` and `branchId`.
   *   - Ranks candidates by ACTIVE > STANDBY, highest branchEpoch, highest hubPriority,
   *     lowest hubId, and paired tie-break across all 3 branch Hubs (PRIMARY / BACKUP / TILL_FALLBACK).
   *   - Reconnects silently via Mutual HMAC-SHA256 when the winning Hub is already in the Multi-Hub Vault,
   *     or triggers the non-blocking "New Active Branch Hub Detected — Approve Pairing" banner if unpaired.
   */
  public async discoverAndReconnectHub(options?: {
    skipLastKnown?: boolean;
    forceScan?: boolean;
    allowUnpairedDiscovery?: boolean;
  }): Promise<boolean> {
    if (this.hubDiscoveryPromise) {
      return this.hubDiscoveryPromise;
    }

    const pairedHubs = LocalHubConfig.getPairedHubs();
    if (pairedHubs.length === 0 && !options?.allowUnpairedDiscovery) {
      return false;
    }

    if (this.isLocalHubConnected && !options?.forceScan) {
      return true;
    }

    const activeInfo = this.getActiveBranchInfo();
    const effectiveTenantId = activeInfo.companyId || this.config.companyId;
    const effectiveBranchId = activeInfo.branchId || this.config.branchId;

    const preferredHub =
      (this.activeHubId ? LocalHubConfig.getPairedHubById(this.activeHubId) : null) ||
      LocalHubConfig.getPrimaryPairedHub(effectiveBranchId);

    this.isDiscoveringHub = true;
    this.discoveryStage = options?.skipLastKnown ? 'MDNS' : 'LAST_KNOWN';
    this.emitHubSecurityEvent();

    this.hubDiscoveryPromise = (async () => {
      try {
        const result = await discoverPairedHub(pairedHubs, preferredHub, {
          skipLastKnown: options?.skipLastKnown,
          preferredTenantId: effectiveTenantId,
          preferredBranchId: effectiveBranchId,
          allowUnpairedActiveLeader: true,
          onStageChange: (stage) => {
            this.discoveryStage = stage;
            this.emitHubSecurityEvent();
          },
        });

        if (!result) {
          return false;
        }

        if (result.storageCapacity) {
          this.hubStorageManager.updateFromHealth(result.storageCapacity, result.hubId);
        }

        // If an emergency replacement ACTIVE Hub is discovered for this branch/tenant,
        // do not force-connect unauthenticated — present the non-blocking Approve Pairing banner!
        if (!result.isPaired) {
          const leaderInfo: ActiveLeaderInfo = {
            hubId: result.hubId,
            hubRole: result.hubRole || 'PRIMARY',
            hubPriority: result.hubPriority ?? 100,
            branchEpoch: result.branchEpoch ?? 1,
            lanIp: result.lastIp || extractHostAndPort(result.wsUrl).hostname,
            wsPort: result.port || 8080,
            wsUrl: result.wsUrl,
          };
          this.unpairedActiveLeader = leaderInfo;
          this.addLog(
            'DISCOVERY',
            `New Active Branch Hub detected (${leaderInfo.hubId} / ${leaderInfo.hubRole} at ${leaderInfo.wsUrl}). Operator pairing approval required.`,
            this.config.deviceName
          );
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('saimetric_unpaired_leader_detected', { detail: leaderInfo })
            );
          }
          this.emitHubSecurityEvent();
          return false;
        }

        const existing = LocalHubConfig.getPairedHubById(result.hubId);
        const prevHost = existing?.lastKnownHost?.toLowerCase() || '';
        const newHost = result.lastKnownHost.toLowerCase();
        const ipActuallyChanged = result.ipChanged || (Boolean(prevHost) && prevHost !== newHost);
        const switchedToDifferentHub =
          Boolean(this.activeHubId) &&
          this.activeHubId!.toUpperCase() !== result.hubId.toUpperCase();

        LocalHubConfig.touchPairedHubProfile(result.hubId, {
          wsUrl: result.wsUrl,
          lastWsUrl: result.wsUrl,
          lastIp: result.lastIp || extractHostAndPort(result.wsUrl).hostname,
          lastKnownHost: result.lastKnownHost,
          port: result.port,
          lastPort: result.port,
          ...(result.mdnsHost ? { mdnsHost: result.mdnsHost } : {}),
          ...(result.lanIps && result.lanIps.length > 0 ? { lanIps: result.lanIps } : {}),
          ...(result.hubRole ? { hubRole: result.hubRole } : {}),
          ...(result.hubPriority !== undefined ? { hubPriority: result.hubPriority } : {}),
          ...(result.branchEpoch !== undefined ? { lastEpoch: result.branchEpoch } : {}),
          ...(result.hubMode ? { hubMode: result.hubMode } : {}),
        });
        LocalHubConfig.setLocalHubUrl(result.wsUrl);
        this.unpairedActiveLeader = null;

        if (switchedToDifferentHub) {
          this.pendingFailoverToastMessage = `Switched to Active Branch Hub (${result.hubRole || existing?.hubRole || 'HUB'}) — reconnected securely`;
          this.addLog(
            'DISCOVERY',
            `Failover elected paired Hub ${result.hubId} (${result.hubRole || 'HUB'}, Epoch ${result.branchEpoch || 1}) at ${result.lastKnownHost} via ${result.discoveredVia}. Authenticating...`,
            this.config.deviceName
          );
        } else if (ipActuallyChanged) {
          this.pendingRoamedToast = true;
          this.addLog(
            'DISCOVERY',
            `Paired Hub ${result.hubId} found at new Wi-Fi IP (${result.lastKnownHost} via ${result.discoveredVia}). Authenticating...`,
            this.config.deviceName
          );
        }

        if (this.localHubReconnectTimer) {
          clearTimeout(this.localHubReconnectTimer);
          this.localHubReconnectTimer = null;
        }

        // Cancel any cold-hub hydration targeting the previous socket and connect to the winning Hub
        this.coldHubHydrationQueue.cancel();
        await this.localHubAdapter.disconnect(true);
        this.syncLocalHubContext();
        void this.localHubAdapter.connect(result.wsUrl);
        return true;
      } catch (err) {
        console.warn('[MeshSync] Roaming discovery error:', err);
        return false;
      } finally {
        this.isDiscoveringHub = false;
        this.discoveryStage = null;
        this.hubDiscoveryPromise = null;
        this.emitHubSecurityEvent();
      }
    })();

    return this.hubDiscoveryPromise;
  }

  /**
   * Starts a zero-camera pairing session with a Local Hub (Android APK or Auth-enabled Termux).
   * If `hint.hubId` is ALREADY paired (and not revoked), updates its host & connects via Mutual HMAC instead!
   */
  public startHubPairing(
    rawUrl: string,
    pairCode?: string,
    hint?: { hubId?: string; mdnsHost?: string; lanIps?: string[] }
  ): void {
    const cleanUrl = LocalHubConfig.setLocalHubUrl(rawUrl);
    const parsedHost = extractHostAndPort(cleanUrl);

    // Never re-pair an already-paired hubId unless it was explicitly revoked
    if (hint?.hubId) {
      const existing = LocalHubConfig.getPairedHubById(hint.hubId);
      if (existing && !this.revokedHubIds.has(existing.hubId.toUpperCase())) {
        const prevHost = existing.lastKnownHost.toLowerCase();
        LocalHubConfig.touchPairedHubProfile(existing.hubId, {
          wsUrl: cleanUrl,
          lastKnownHost: parsedHost.hostPort,
          port: parsedHost.port,
          ...(hint.mdnsHost ? { mdnsHost: hint.mdnsHost } : {}),
          ...(hint.lanIps ? { lanIps: hint.lanIps } : {}),
        });
        if (prevHost && prevHost !== parsedHost.hostPort.toLowerCase()) {
          this.pendingRoamedToast = true;
        }
        this.pendingPairRequest = null;
        this.hubAuthError = null;
        this.lastAuthFailureWasRevoked = false;
        this.emitHubSecurityEvent();
        void this.localHubAdapter.disconnect(true).then(() => {
          this.connectLocalHub(cleanUrl);
        });
        return;
      }
    }

    const cleanCode = String(pairCode || '').replace(/[^0-9A-Za-z]/g, '').trim();
    const clientNonce = generateClientNonce();

    this.hubAuthError = null;
    this.lastAuthFailureWasRevoked = false;
    this.pendingPairRequest = {
      wsUrl: cleanUrl,
      ...(cleanCode ? { pairCode: cleanCode } : {}),
      clientNonce,
      ...(hint?.hubId ? { hubId: hint.hubId } : {}),
      ...(hint?.mdnsHost ? { mdnsHost: hint.mdnsHost } : {}),
      ...(hint?.lanIps ? { lanIps: hint.lanIps } : {}),
      startedAt: Date.now(),
    };

    if (this.localHubReconnectTimer) {
      clearTimeout(this.localHubReconnectTimer);
      this.localHubReconnectTimer = null;
    }

    this.emitHubSecurityEvent();
    void this.localHubAdapter.disconnect(true).then(() => {
      this.syncLocalHubContext();
      void this.localHubAdapter.connect(cleanUrl);
    });
  }

  public cancelHubPairing(): void {
    if (this.pairChallengeWaitTimer) {
      clearTimeout(this.pairChallengeWaitTimer);
      this.pairChallengeWaitTimer = null;
    }
    this.pendingPairRequest = null;
    if (this.localHubAdapter.getAuthState() === 'PAIRING_PENDING') {
      void this.localHubAdapter.disconnect(true);
    }
    this.emitHubSecurityEvent();
  }

  /**
   * Unpairs the given Hub (or active hubId/URL), allowing explicit switch to a new Hub or Termux backup.
   */
  public unpairLocalHub(hubIdOrUrl?: string): void {
    const target = hubIdOrUrl || this.activeHubId || LocalHubConfig.getLocalHubUrl();
    LocalHubConfig.removePairedHubProfile(target);
    if (target) this.revokedHubIds.delete(String(target).trim().toUpperCase());
    this.hubAuthError = null;
    this.lastAuthFailureWasRevoked = false;
    this.pendingPairRequest = null;
    this.activeHubId = null;
    this.activeHubMdnsHost = null;
    this.activeHubLanIps = [];
    this.localHubAdapter.setAuthState('DISCONNECTED', null);
    this.emitHubSecurityEvent();
    void this.localHubAdapter.disconnect(true).then(() => {
      this.connectLocalHub();
    });
  }

  /**
   * Requests the connected Android Hub APK to check for signed cloud OTA bundle updates.
   */
  public requestHubUpdateCheck(): boolean {
    if (!this.localHubAdapter.isReadyForSync()) return false;
    return this.localHubAdapter.sendControlPacket({
      type: 'CHECK_HUB_UPDATE',
      action: 'CHECK_HUB_UPDATE',
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      timestamp: Date.now(),
    });
  }

  private completePostAuthHubSession(hubUrl: string, isMutualAuth: boolean): void {
    this.isLocalHubConnected = true;
    this.isWsConnected = true;
    this.isLocalHubLost = false;
    this.localHubDisconnectedAt = null;
    this.hubAuthError = null;
    this.lastAuthFailureWasRevoked = false;
    this.hubOtaStatus = null;
    this.lastHubPongReceivedAt = Date.now();
    this.syncLocalHubContext();
    this.syncActiveAdapter();
    this.evaluateConnectionPriority();

    this.addLog(
      'DISCOVERY',
      isMutualAuth
        ? `Local Hub MUTUALLY AUTHENTICATED: ${hubUrl} (Secure Paired Session).`
        : `Local Hub CONNECTED (Termux Backup Mode): ${hubUrl} (0% Internet Required).`,
      this.config.deviceName
    );
    playChime();

    const activeSyncStrategy = this.getActiveSyncStrategy();
    try {
      const cfg = activeSyncStrategy === 'CLOUD_ONLY' ? null : getSheetsConfig();
      const cloudUrl = activeSyncStrategy === 'CLOUD_ONLY' ? '' : (cfg?.deploymentUrl || '');
      this.localHubAdapter.sendControlPacket({
        type: 'PING_HUB',
        action: 'PING_HUB',
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        cloudSyncUrl: cloudUrl,
        cloudUrl: cloudUrl,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('[MeshSync] Error sending post-auth PING_HUB:', e);
    }

    if (activeSyncStrategy === 'HUB_CLOUD') {
      this.sendAndPurgeCloudConfigIfHubCloud();
    }

    try {
      this.localHubAdapter.sendControlPacket({
        type: 'STOCKTAKE_SESSION_LIST_REQUEST',
        action: 'STOCKTAKE_SESSION_LIST_REQUEST',
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        timestamp: Date.now(),
      });
    } catch {}

    this.emitHubSecurityEvent();
    this.notifyPeerSubscribers(true);
    this.notifyConnectionModeChange();

    // Non-blocking storage telemetry poll after Mutual-HMAC AUTH_OK (Hub v4.2.0+)
    if (isMutualAuth) {
      setTimeout(() => {
        if (this.isLocalHubConnected && this.localHubAdapter.getAuthState() === 'AUTHENTICATED') {
          this.hubStorageManager.queryStorageStatus().catch(() => {});
        }
      }, 1500);
    }

    // Fallback for legacy Hubs without HUB_INFO response
    setTimeout(async () => {
      if (this.isLocalHubConnected && this.localHubAdapter.isReadyForSync() && !this.hubBranchId && !this.isCloudOnlyMode) {
        this.drainQueueToLocalHub();
        this.hasPerformedInitialCatchup = true;
        this.lastInitialCatchupTime = Date.now();
        const lastSync = await this.getLastInventorySyncTimestamp();
        this.requestCatchUpSync('ALL', lastSync, false, false).catch(() => {});
      }
    }, 2000);
  }

  private async handleAuthChallenge(packet: any): Promise<void> {
    if (this.legacyFallbackTimer) {
      clearTimeout(this.legacyFallbackTimer);
      this.legacyFallbackTimer = null;
    }
    if (this.pairChallengeWaitTimer) {
      clearTimeout(this.pairChallengeWaitTimer);
      this.pairChallengeWaitTimer = null;
    }

    const hubUrl = this.localHubAdapter.getActiveHubUrl() || LocalHubConfig.getLocalHubUrl();
    const hubId = String(packet.hubId || packet.hub_id || '').trim();
    const branchId = String(packet.branchId || packet.branch_id || '').trim();
    const nonce = String(packet.nonce || '').trim();
    const challengeTs = Number(packet.timestamp || Date.now());
    const authRequired = packet.auth_required !== false;
    const challengeMdns = sanitizeMdnsHost(packet.mdnsHost || packet.mdns_host);
    const challengeLanIps = sanitizeLanIps(packet.lanIps || packet.lan_ips);

    this.activeHubId = hubId || this.activeHubId;
    if (challengeMdns) this.activeHubMdnsHost = challengeMdns;
    if (challengeLanIps.length > 0) this.activeHubLanIps = challengeLanIps;
    if (packet.version) this.activeHubVersion = String(packet.version);
    if (packet.hub_runtime === 'ANDROID_APK' || packet.hub_runtime === 'TERMUX') {
      this.activeHubRuntime = packet.hub_runtime;
    }
    const challengeFailover = this.applyHubFailoverMetadata(packet);

    // REQUIREMENT 1 & 2: ALWAYS look up paired credentials strictly by `hubId` FIRST (never by IP!).
    const profileByHubId = hubId ? LocalHubConfig.getPairedHubById(hubId) : null;
    const isExplicitlyRevoked = hubId ? this.revokedHubIds.has(hubId.toUpperCase()) : false;

    // If `deviceSecret` exists for `msg.hubId` (and not revoked), IMMEDIATELY authenticate via
    // Mutual HMAC-SHA256 regardless of which IP/hostname we connected through — NEVER re-pair!
    if (profileByHubId && !isExplicitlyRevoked) {
      if (this.pendingPairRequest) {
        this.pendingPairRequest = null;
      }
      // Persist any updated mdnsHost / lanIps / role / epoch learned from AUTH_CHALLENGE
      if (
        challengeMdns ||
        challengeLanIps.length > 0 ||
        challengeFailover.hubRole ||
        challengeFailover.hubPriority !== undefined ||
        challengeFailover.branchEpoch !== undefined ||
        challengeFailover.hubMode
      ) {
        LocalHubConfig.touchPairedHubProfile(profileByHubId.hubId, {
          ...(challengeMdns ? { mdnsHost: challengeMdns } : {}),
          ...(challengeLanIps.length > 0 ? { lanIps: challengeLanIps } : {}),
          ...(challengeFailover.hubRole ? { hubRole: challengeFailover.hubRole } : {}),
          ...(challengeFailover.hubPriority !== undefined ? { hubPriority: challengeFailover.hubPriority } : {}),
          ...(challengeFailover.branchEpoch !== undefined ? { lastEpoch: challengeFailover.branchEpoch } : {}),
          ...(challengeFailover.hubMode ? { hubMode: challengeFailover.hubMode } : {}),
        });
      }
    } else if (this.pendingPairRequest) {
      // Only start PAIR_REQUEST if pairedHubs[hubId] does not exist (or was explicitly revoked)
      if (challengeMdns) this.pendingPairRequest.mdnsHost = challengeMdns;
      if (challengeLanIps.length > 0) this.pendingPairRequest.lanIps = challengeLanIps;
      if (hubId) this.pendingPairRequest.hubId = hubId;
      this.sendPendingPairRequestPacket(hubUrl);
      return;
    }

    const profile = profileByHubId;

    if (!profile) {
      if (!authRequired) {
        // Optional-auth Termux backup Hub — proceed cleanly without blocking!
        this.localHubAdapter.setAuthState('LEGACY_BACKUP', null);
        this.completePostAuthHubSession(hubUrl, false);
        return;
      }
      this.hubAuthError =
        'This Hub requires device pairing. Open Local Hub Settings and pair with the 6-digit code or tap Pair to approve on the Hub.';
      this.localHubAdapter.setAuthState('AUTH_FAILED', null);
      this.addLog('SECURITY_DROP', this.hubAuthError, this.config.deviceName);
      this.emitHubSecurityEvent();
      void this.localHubAdapter.disconnect(false);
      return;
    }

    // Verify timestamp freshness (±120s tolerance for LAN clock skew before NTP/Hub time sync)
    if (Math.abs(Date.now() - challengeTs) > 120_000) {
      this.hubAuthError = 'Hub authentication challenge expired or device clock is severely skewed.';
      this.localHubAdapter.setAuthState('AUTH_FAILED', null);
      this.emitHubSecurityEvent();
      void this.localHubAdapter.disconnect(false);
      return;
    }

    // If Hub sent an upfront hubProof (optional), verify immediately
    if (packet.hubProof && hubId && nonce) {
      const expectedUpfront = await computeHubAuthProof(
        profile.deviceSecret,
        nonce,
        hubId,
        branchId || profile.branchId,
        challengeTs
      );
      if (!constantTimeEqual(String(packet.hubProof), expectedUpfront)) {
        this.hubAuthError = 'Hub Identity Mismatch! Possible spoofed Hub detected on this Wi-Fi network.';
        this.localHubAdapter.setAuthState('AUTH_FAILED', null);
        this.addLog('SECURITY_DROP', this.hubAuthError, this.config.deviceName);
        this.emitHubSecurityEvent();
        void this.localHubAdapter.disconnect(false);
        return;
      }
    }

    // Compute client proof + fresh clientNonce so Hub proves its own identity in AUTH_OK
    const clientNonce = generateClientNonce();
    this.activeClientNonce = clientNonce;
    const responseTs = Date.now();
    const effectiveHubId = hubId || profile.hubId;
    const clientProof = await computeClientAuthProof(
      profile.deviceSecret,
      nonce,
      effectiveHubId,
      profile.deviceId || this.config.deviceId,
      responseTs
    );

    this.localHubAdapter.sendControlPacket({
      type: 'AUTH_RESPONSE',
      action: 'AUTH_RESPONSE',
      deviceId: profile.deviceId || this.config.deviceId,
      deviceName: this.config.deviceName,
      branchId: this.config.branchId,
      tenantId: this.config.companyId,
      nonce,
      clientNonce,
      timestamp: responseTs,
      clientProof,
    });
  }

  private async handleAuthOk(packet: any): Promise<void> {
    if (this.legacyFallbackTimer) {
      clearTimeout(this.legacyFallbackTimer);
      this.legacyFallbackTimer = null;
    }

    const hubUrl = this.localHubAdapter.getActiveHubUrl() || LocalHubConfig.getLocalHubUrl();
    const hubId = String(packet.hubId || packet.hub_id || this.activeHubId || '').trim();
    const branchId = String(packet.branchId || packet.branch_id || '').trim();
    const serverTime = Number(packet.serverTime || packet.timestamp || 0);
    const okMdns = sanitizeMdnsHost(packet.mdnsHost || packet.mdns_host) || this.activeHubMdnsHost || undefined;
    const okLanIps = sanitizeLanIps(packet.lanIps || packet.lan_ips);
    const mergedLanIps = okLanIps.length > 0 ? okLanIps : this.activeHubLanIps;

    // Look up strictly by hubId first!
    const profile =
      (hubId ? LocalHubConfig.getPairedHubById(hubId) : null) ||
      LocalHubConfig.getPairedHubForUrl(hubUrl);

    if (!profile) {
      this.hubAuthError = 'Received AUTH_OK without matching local paired profile.';
      this.localHubAdapter.setAuthState('AUTH_FAILED', null);
      this.emitHubSecurityEvent();
      void this.localHubAdapter.disconnect(false);
      return;
    }

    // Mutual verification: verify Hub's HMAC proof over our clientNonce (stops rogue/spoofed Hubs!)
    if (!packet.hubProof || !this.activeClientNonce) {
      this.hubAuthError = 'Hub failed mutual identity proof (missing hubProof). Connection blocked.';
      this.localHubAdapter.setAuthState('AUTH_FAILED', null);
      this.addLog('SECURITY_DROP', this.hubAuthError, this.config.deviceName);
      this.emitHubSecurityEvent();
      void this.localHubAdapter.disconnect(false);
      return;
    }

    const expectedHubProof = await computeHubAuthProof(
      profile.deviceSecret,
      this.activeClientNonce,
      hubId || profile.hubId,
      branchId || profile.branchId,
      serverTime
    );

    if (!constantTimeEqual(String(packet.hubProof), expectedHubProof)) {
      this.hubAuthError = 'Hub Identity Verification FAILED! Possible spoofed Hub on this network.';
      this.localHubAdapter.setAuthState('AUTH_FAILED', null);
      this.addLog('SECURITY_DROP', this.hubAuthError, this.config.deviceName);
      this.emitHubSecurityEvent();
      void this.localHubAdapter.disconnect(false);
      return;
    }

    this.activeClientNonce = '';
    this.activeHubId = hubId || profile.hubId;
    if (okMdns) this.activeHubMdnsHost = okMdns;
    if (mergedLanIps.length > 0) this.activeHubLanIps = mergedLanIps;
    this.revokedHubIds.delete(profile.hubId.toUpperCase());
    const okFailover = this.applyHubFailoverMetadata(packet);

    if (
      this.unpairedActiveLeader &&
      this.unpairedActiveLeader.hubId.toUpperCase() === profile.hubId.toUpperCase()
    ) {
      this.unpairedActiveLeader = null;
    }

    if (packet.version) this.activeHubVersion = String(packet.version);
    if (packet.hub_runtime === 'ANDROID_APK' || packet.hub_runtime === 'TERMUX') {
      this.activeHubRuntime = packet.hub_runtime;
    }
    if (packet.ota_slot) this.activeHubOtaSlot = String(packet.ota_slot);
    if (serverTime > 1_600_000_000_000) {
      reportTrustedTimeSample(serverTime, 'LOCAL_HUB');
    }

    const parsedActive = extractHostAndPort(hubUrl);
    const prevHost = profile.lastKnownHost.toLowerCase();
    const hostChanged = Boolean(prevHost) && prevHost !== parsedActive.hostPort.toLowerCase();

    // Update lastKnownHost, mdnsHost, lanIps, role, priority, epoch & mode under pairedHubs[hubId] ONLY after AUTH_OK passes!
    LocalHubConfig.touchPairedHubProfile(profile.hubId, {
      wsUrl: hubUrl,
      lastWsUrl: hubUrl,
      lastIp: parsedActive.hostname,
      lastKnownHost: parsedActive.hostPort,
      port: parsedActive.port,
      lastPort: parsedActive.port,
      ...(okMdns ? { mdnsHost: okMdns } : {}),
      ...(mergedLanIps.length > 0 ? { lanIps: mergedLanIps } : {}),
      ...(branchId ? { branchId } : {}),
      ...(packet.branchName || packet.branch_name ? { branchName: String(packet.branchName || packet.branch_name) } : {}),
      ...(packet.version ? { hubVersion: String(packet.version) } : {}),
      ...(this.activeHubRuntime !== 'UNKNOWN' ? { hubRuntime: this.activeHubRuntime } : {}),
      ...(okFailover.hubRole ? { hubRole: okFailover.hubRole } : {}),
      ...(okFailover.hubPriority !== undefined ? { hubPriority: okFailover.hubPriority } : {}),
      ...(okFailover.branchEpoch !== undefined ? { lastEpoch: okFailover.branchEpoch } : {}),
      ...(okFailover.hubMode ? { hubMode: okFailover.hubMode } : {}),
      lastConnectedAt: Date.now(),
    });

    if (LocalHubConfig.getLocalHubUrl() !== normalizeHubUrl(hubUrl)) {
      LocalHubConfig.setLocalHubUrl(hubUrl);
    }

    this.localHubAdapter.setAuthState('AUTHENTICATED', profile.deviceSecret);
    this.completePostAuthHubSession(hubUrl, true);

    if (this.pendingFailoverToastMessage) {
      const msg = this.pendingFailoverToastMessage;
      this.pendingFailoverToastMessage = null;
      this.pendingRoamedToast = false;
      this.emitHubToast(msg);
    } else if (this.pendingRoamedToast || hostChanged) {
      this.pendingRoamedToast = false;
      this.emitHubToast('Hub found at new Wi-Fi IP — reconnected securely');
    }

    // If this authenticated Hub is currently STANDBY and points to an ACTIVE leader, follow handoff automatically
    if (okFailover.hubMode === 'STANDBY' && okFailover.activeLeaderInfo) {
      void this.handleHubRoleStatus(packet);
    }
  }

  private handleAuthFailed(packet: any): void {
    if (this.legacyFallbackTimer) {
      clearTimeout(this.legacyFallbackTimer);
      this.legacyFallbackTimer = null;
    }
    const reason = String(packet.reason || packet.message || 'Authentication rejected by Local Hub.');
    const lowerReason = reason.toLowerCase();
    const isRevoked =
      lowerReason.includes('revok') ||
      lowerReason.includes('unrecognized device') ||
      lowerReason.includes('pair this device');

    this.lastAuthFailureWasRevoked = isRevoked;
    if (isRevoked && this.activeHubId) {
      this.revokedHubIds.add(this.activeHubId.toUpperCase());
    }

    this.hubAuthError = reason;
    this.localHubAdapter.setAuthState('AUTH_FAILED', null);
    this.addLog('SECURITY_DROP', `Hub Auth Rejected: ${reason}`, this.config.deviceName);
    this.emitHubSecurityEvent();
    void this.localHubAdapter.disconnect(false);
  }

  private handlePairPending(packet: any): void {
    const hubId = String(packet.hubId || packet.hub_id || 'HUB').trim();
    const branchName = String(packet.branchName || packet.branch_name || 'Local Hub').trim();
    const serverCode = String(packet.confirmCode || packet.visualCode || '').trim();
    const clientNonce = this.pendingPairRequest?.clientNonce || '';
    const visualCode =
      serverCode || computeVisualConfirmCode(hubId, this.config.deviceId, clientNonce);

    if (this.pendingPairRequest) {
      this.pendingPairRequest = {
        ...this.pendingPairRequest,
        hubId,
        branchName,
        visualCode,
      };
    }
    this.localHubAdapter.setAuthState('PAIRING_PENDING', null);
    this.addLog(
      'DISCOVERY',
      `Waiting for Hub approval (${branchName}). Confirm code on Hub screen: ${visualCode}`,
      this.config.deviceName
    );
    this.emitHubSecurityEvent();
  }

  private handlePairApproved(packet: any): void {
    if (this.legacyFallbackTimer) {
      clearTimeout(this.legacyFallbackTimer);
      this.legacyFallbackTimer = null;
    }
    if (this.pairChallengeWaitTimer) {
      clearTimeout(this.pairChallengeWaitTimer);
      this.pairChallengeWaitTimer = null;
    }

    const hubUrl = this.pendingPairRequest?.wsUrl || this.localHubAdapter.getActiveHubUrl() || LocalHubConfig.getLocalHubUrl();
    const parsedHost = extractHostAndPort(hubUrl);
    const hubId = String(packet.hubId || packet.hub_id || `HUB-${Date.now()}`).trim();
    const branchId = String(packet.branchId || packet.branch_id || this.config.branchId || 'BR-MAIN').trim();
    const branchName = String(packet.branchName || packet.branch_name || this.config.branchName || branchId).trim();
    const tenantId = String(packet.tenantId || packet.tenant_id || this.config.companyId || 'COMP-001').trim();
    const deviceSecret = String(packet.deviceSecret || '').trim();
    const mdnsHost =
      sanitizeMdnsHost(packet.mdnsHost || packet.mdns_host) ||
      this.pendingPairRequest?.mdnsHost ||
      this.activeHubMdnsHost ||
      undefined;
    const lanIps = sanitizeLanIps([
      ...sanitizeLanIps(packet.lanIps || packet.lan_ips),
      ...(this.pendingPairRequest?.lanIps || []),
      ...this.activeHubLanIps,
    ]);

    if (!deviceSecret) {
      this.handlePairRejected({ message: 'Hub did not return a device pairing key.' });
      return;
    }

    const runtime: 'ANDROID_APK' | 'TERMUX' | 'UNKNOWN' =
      packet.hub_runtime === 'ANDROID_APK'
        ? 'ANDROID_APK'
        : packet.hub_runtime === 'TERMUX'
        ? 'TERMUX'
        : 'UNKNOWN';

    const pairFailover = this.applyHubFailoverMetadata(packet);
    const role = pairFailover.hubRole || normalizeHubRole(packet.hubRole ?? packet.hub_role);
    const priority =
      pairFailover.hubPriority !== undefined
        ? pairFailover.hubPriority
        : normalizeHubPriority(packet.hubPriority ?? packet.hub_priority, role);
    const epoch = pairFailover.branchEpoch ?? normalizeBranchEpoch(packet.branchEpoch ?? packet.branch_epoch);
    const mode = pairFailover.hubMode || normalizeHubMode(packet.hubMode ?? packet.hub_mode);

    LocalHubConfig.savePairedHubProfile({
      hubId,
      wsUrl: hubUrl,
      lastWsUrl: hubUrl,
      lastIp: parsedHost.hostname,
      lastKnownHost: parsedHost.hostPort,
      port: parsedHost.port,
      lastPort: parsedHost.port,
      ...(mdnsHost ? { mdnsHost } : {}),
      ...(lanIps.length > 0 ? { lanIps } : {}),
      branchId,
      branchName,
      tenantId,
      deviceId: this.config.deviceId,
      deviceSecret,
      hubRole: role,
      hubPriority: priority,
      lastEpoch: epoch,
      hubMode: mode,
      ...(packet.hubPubKey ? { hubPubKey: String(packet.hubPubKey) } : {}),
      ...(packet.version ? { hubVersion: String(packet.version) } : {}),
      hubRuntime: runtime,
      pairedAt: Date.now(),
      lastConnectedAt: Date.now(),
    });

    this.revokedHubIds.delete(hubId.toUpperCase());
    this.unpairedActiveLeader = null;
    this.pendingPairRequest = null;
    this.activeHubId = hubId;
    if (mdnsHost) this.activeHubMdnsHost = mdnsHost;
    if (lanIps.length > 0) this.activeHubLanIps = lanIps;
    this.activeHubVersion = packet.version ? String(packet.version) : this.activeHubVersion;
    this.activeHubRuntime = runtime;
    this.hubAuthError = null;
    this.lastAuthFailureWasRevoked = false;

    this.localHubAdapter.setAuthState('AUTHENTICATED', deviceSecret);
    this.completePostAuthHubSession(hubUrl, true);
  }

  private handlePairRejected(packet: any): void {
    const reason = String(packet.reason || packet.message || 'Pairing rejected or code expired.');
    this.pendingPairRequest = null;
    this.hubAuthError = reason;
    this.localHubAdapter.setAuthState('AUTH_FAILED', null);
    this.addLog('SECURITY_DROP', `Hub Pairing Failed: ${reason}`, this.config.deviceName);
    this.emitHubSecurityEvent();
    void this.localHubAdapter.disconnect(false);
  }

  private handleHubUpdating(packet: any): void {
    const etaSeconds = Math.max(3, Math.min(60, Number(packet.etaSeconds || 6)));
    const targetVersion = String(packet.targetVersion || packet.version || '').trim();
    this.hubOtaStatus = {
      status: 'UPDATING',
      targetVersion,
      etaSeconds,
      message: `Hub applying signed cloud update${targetVersion ? ` v${targetVersion}` : ''}. Reconnecting in ~${etaSeconds}s...`,
      updatedAt: Date.now(),
    };
    this.localHubAdapter.setAuthState('UPDATING');
    this.addLog('DISCOVERY', this.hubOtaStatus.message!, this.config.deviceName);
    this.emitHubSecurityEvent();

    if (this.localHubReconnectTimer) {
      clearTimeout(this.localHubReconnectTimer);
    }
    this.localHubReconnectTimer = window.setTimeout(() => {
      this.localHubReconnectTimer = null;
      this.localHubReconnectAttempts = 0;
      this.connectLocalHub();
    }, etaSeconds * 1000);
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
    return generateOfflineBatchPayloadForConfig(this.config);
  }

  public ingestOfflineBatchPayload(rawString: string): {
    success: boolean;
    syncedCount: number;
    message: string;
    details?: string;
  } {
    return ingestOfflineBatchPayloadForConfig(rawString, this.config, {
      addLog: (type, message, sourceDevice, targetDevice) =>
        this.addLog(type, message, sourceDevice, targetDevice),
      notifyPeerSubscribers: () => this.notifyPeerSubscribers(),
    });
  }

  // =========================================================================
  // LOCAL WEBSOCKET HUB (ROUTED EXCLUSIVELY THROUGH LocalHubAdapter + SyncCore)
  // =========================================================================
  private isWsConnected: boolean = false;
  private isTorchOn: boolean = false;
  private activeVideoTrack: MediaStreamTrack | null = null;

  private syncLocalHubContext(): void {
    this.localHubAdapter.setContext({
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      branchCode: this.config.branchCode,
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      hubBranchId: this.hubBranchId,
      isCloudOnlyMode: this.isCloudOnlyMode,
      isIngestingFromHub: this.isIngestingFromHub,
    });
  }

  /**
   * Strict Single-Cloud Adapter Factory (Part A: No Data Racing).
   * Ensures ONLY ONE Cloud Adapter matching `config.databaseType` is instantiated and active at a time.
   * Any previous non-matching Cloud Adapter is paused/disconnected and dereferenced.
   */
  private getOrCreateSingleCloudAdapter(): SyncAdapter & {
    pause?: () => void;
    resume?: () => void;
    isPaused?: () => boolean;
  } {
    const { databaseType } = getActiveCloudConfig();
    if (this.activeCloudAdapter && this.activeCloudAdapterType === databaseType) {
      return this.activeCloudAdapter;
    }

    if (this.cloudReceiveUnsubscribe) {
      try {
        this.cloudReceiveUnsubscribe();
      } catch {}
      this.cloudReceiveUnsubscribe = null;
    }

    if (this.activeCloudAdapter) {
      try {
        this.activeCloudAdapter.pause?.();
        void this.activeCloudAdapter.disconnect();
      } catch {}
      this.activeCloudAdapter = null;
    }

    this.activeCloudAdapterType = databaseType;

    if (databaseType === 'supabase') {
      this.activeCloudAdapter = new SupabaseAdapter();
    } else if (databaseType === 'mongodb') {
      this.activeCloudAdapter = new MongoDBAdapter();
    } else if (databaseType === 'appscripts') {
      const asAdapter = new AppScriptsAdapter();
      asAdapter.registerCloudRelayChecker(() => this.shouldThisTerminalRelayToCloud());
      asAdapter.registerCloudReceiptBroadcaster((receipt) => {
        void this.broadcastSyncReceipt(receipt);
      });
      this.activeCloudAdapter = asAdapter;
    } else {
      // Passive disabled adapter for 'room' / 'none' / 'firebase' when LocalHub is off
      this.activeCloudAdapter = {
        name: `DisabledCloudAdapter(${databaseType})`,
        pause: () => {},
        resume: () => {},
        isPaused: () => true,
        broadcast: async (envelope) => ({
          success: false,
          packetId: envelope.packetId,
          error: `Cloud adapter disabled for databaseType=${databaseType}`,
        }),
        onReceive: () => () => {},
        connect: async () => {},
        disconnect: async () => {},
        isConnected: () => false,
        requestCatchUp: async () => ({ envelopes: [], cutoffTimestamp: Date.now() }),
        drainOfflineQueue: async () => {},
      };
    }

    this.cloudReceiveUnsubscribe = this.activeCloudAdapter.onReceive((env) => {
      void this.ingestEnvelopeThroughSyncCore(env, 'CLOUD_SYNC');
    });

    return this.activeCloudAdapter;
  }

  /**
   * Hexagonal Switch:
   * - If Local Hub is active (and not Cloud-Only), route all outbound sync to LocalHubAdapter
   *   and completely pause the active Cloud Adapter to stop Ghost Overwrites & Dual-Racing.
   * - Otherwise, route all outbound sync to the SINGLE Cloud Adapter matching config.databaseType.
   */
  private syncActiveAdapter(): void {
    if (!this.syncCore) return;
    this.syncLocalHubContext();
    const cloudAdapter = this.getOrCreateSingleCloudAdapter();
    const activeStrategy = this.getActiveSyncStrategy();
    const hasConfiguredHub = Boolean(LocalHubConfig.getLocalHubUrl().trim());
    const inHubGraceWindow =
      activeStrategy === 'HUB_CLOUD' &&
      !this.isCloudOnlyMode &&
      hasConfiguredHub &&
      !this.isLocalHubConnected &&
      this.localHubDisconnectedAt !== null &&
      !this.isLocalHubLost;
    const useLocalHub = (this.isLocalHubActive() && !this.isCloudOnlyMode) || inHubGraceWindow;
    if (useLocalHub) {
      this.syncCore.setAdapter(this.localHubAdapter);
      cloudAdapter.pause?.();
      pauseCloudSync();
    } else {
      this.syncCore.setAdapter(cloudAdapter);
      cloudAdapter.resume?.();
      if (this.activeCloudAdapterType === 'appscripts') {
        resumeCloudSync();
      } else {
        pauseCloudSync();
      }
    }
  }

  private getActiveSyncStrategy(): 'HUB_CLOUD' | 'HUB_ONLY' | 'CLOUD_ONLY' {
    try {
      const comp = getCurrentCompany();
      if (this.isCloudOnlyMode || LocalHubConfig.isCloudOnlyMode() || comp?.sync_strategy === 'CLOUD_ONLY') {
        return 'CLOUD_ONLY';
      }
      if (comp?.sync_strategy === 'HUB_ONLY') {
        return 'HUB_ONLY';
      }
    } catch {}
    return 'HUB_CLOUD';
  }

  private buildGenericCloudConfigPacket(): HubCloudConfigPacket | null {
    return buildGenericCloudConfigPacket();
  }

  public getElectedCloudRelayLeaderId(): string | null {
    const isSelfOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!isSelfOnline) return null;

    const candidates: string[] = [this.config.deviceId];
    const now = Date.now();
    for (const peer of this.discoveredPeers.values()) {
      if (now - peer.lastSeen <= 35000 && peer.isOnline && peer.hasInternet !== false) {
        candidates.push(peer.id);
      }
    }
    candidates.sort();
    return candidates[0] || this.config.deviceId;
  }

  public isCloudRelayLeader(): boolean {
    const leaderId = this.getElectedCloudRelayLeaderId();
    return leaderId === null ? false : leaderId === this.config.deviceId;
  }

  public shouldThisTerminalRelayToCloud(): boolean {
    if (this.isLocalHubActive() && !this.isCloudOnlyMode) {
      return false;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return false;
    }
    return this.isCloudRelayLeader();
  }

  private sendAndPurgeCloudConfigIfHubCloud(): void {
    const strategy = this.getActiveSyncStrategy();
    if (strategy !== 'HUB_CLOUD') {
      return;
    }

    const config = this.buildGenericCloudConfigPacket();
    if (!config) {
      return;
    }

    const sent = this.localHubAdapter.sendControlPacket({
      type: 'SYNC_CLOUD_CONFIG',
      action: 'SYNC_CLOUD_CONFIG',
      config,
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      timestamp: Date.now(),
    });

    if (sent) {
      purgeLocalCloudCredentialsFromStorage(config.companyId);
      this.addLog(
        'CLOUD_SYNC',
        `Synced encrypted cloud config (${config.databaseType}) to Local Hub and purged local PWA credentials.`,
        this.config.deviceName
      );
    }
  }

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

    if (this.isCloudOnlyMode) {
      newMode = 'CLOUD_ONLY';
    } else if (forceLocalHub) {
      // User explicitly forced local hub
      if (this.isLocalHubConnected) {
        newMode = 'LOCAL_HUB';
      } else {
        newMode = 'LOCAL_OFFLINE';
        if (!this.localHubAdapter.hasActiveOrConnectingSocket() && !this.localHubReconnectTimer) {
          this.connectLocalHub();
        }
      }
    } else if (isOnline && (this.isMqttConnected || this.isServerRelayConnected)) {
      newMode = 'CLOUD_MESH';
    } else if (this.isLocalHubConnected) {
      newMode = 'LOCAL_HUB';
    } else {
      newMode = 'LOCAL_OFFLINE';
      if (!this.localHubAdapter.hasActiveOrConnectingSocket() && !this.localHubReconnectTimer) {
        this.connectLocalHub();
      }
    }

    const modeChanged = newMode !== this.activeConnectionMode;
    this.activeConnectionMode = newMode;
    this.syncActiveAdapter();

    if (modeChanged) {
      this.notifyConnectionModeChange();
    }

    return this.activeConnectionMode;
  }

  public connectLocalHub(customUrl?: string) {
    if (this.localHubReconnectTimer) {
      clearTimeout(this.localHubReconnectTimer);
      this.localHubReconnectTimer = null;
    }
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }

    if (this.localHubAdapter.hasActiveOrConnectingSocket()) {
      return;
    }

    const hubUrl = customUrl ? normalizeHubUrl(customUrl) : LocalHubConfig.getLocalHubUrl();
    if (!hubUrl) return;

    this.syncLocalHubContext();
    this.addLog('DISCOVERY', `Connecting to Local WebSocket Hub at ${hubUrl}...`, this.config.deviceName);
    void this.localHubAdapter.connect(hubUrl);

    // Step 1 fail-fast watchdog (~1.5s): if a paired Hub's lastKnownHost stalls (e.g. switched Wi-Fi subnet),
    // abort the stalled TCP attempt and launch Step 2 (mDNS) -> Step 3 (/health) IP roaming discovery!
    if (!customUrl && !this.pendingPairRequest && LocalHubConfig.hasAnyPairedHub()) {
      this.connectTimeoutTimer = setTimeout(() => {
        this.connectTimeoutTimer = null;
        if (!this.localHubAdapter.isConnected() && !this.isDiscoveringHub) {
          void this.localHubAdapter.disconnect(true).then(() => {
            void this.discoverAndReconnectHub({ skipLastKnown: true });
          });
        }
      }, 1500);
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
    // Inside this execution window, outbound broadcasts are strictly prohibited,
    // and RoomDatabase notifications are batched so 10 packets trigger 1 clean UI update instead of 10.
    this.isIngestingFromHub = true;
    this.syncLocalHubContext();
    beginBatchUpdate();
    try {
      for (const item of batch) {
        this.processSingleLocalHubPacket(item);
      }
    } catch (err) {
      console.warn('[MeshSync] Error processing hub ingest batch:', err);
    } finally {
      endBatchUpdate();
      this.isIngestingFromHub = false;
      this.syncLocalHubContext();
    }

    if (this.hubIngestQueue.length > 0) {
      // 50ms pause between batches yields the event loop to the browser UI & network threads
      this.hubProcessingTimer = window.setTimeout(() => {
        this.processHubQueueBatch();
      }, 50);
    } else {
      // Completed burst ingestion: trigger UI batch update
      this.scheduleBatchUiUpdate();
    }
  }

  /**
   * Look up existing record in RoomDatabase so SyncCore.ingest() can strictly enforce
   * T1 append-only dedupe and T2 60-second LWW before any write hits the database.
   */
  private lookupExistingRecordForEnvelope(envelope: SyncEnvelope): any {
    return lookupExistingRecordForEnvelope(envelope);
  }

  /**
   * Unified SyncCore Ingest Gate: ALL inbound LAN/Hub/Mesh/Recon/Cloud packets pass through here.
   * If SyncCore rejects a T2 record as stale under the 60s LWW window, RoomDatabase is NEVER touched.
   */
  private async ingestEnvelopeThroughSyncCore(
    envelope: SyncEnvelope,
    originName: string,
    options?: { isReconBackfill?: boolean }
  ): Promise<boolean> {
    if (!envelope || !envelope.entityType) return false;

    const existingRecord = this.lookupExistingRecordForEnvelope(envelope);
    const result = await this.syncCore.ingest(envelope, existingRecord, async (acceptedEnv) => {
      await this.applyAcceptedEnvelope(acceptedEnv, originName, options);
    });

    if (!result.accepted) {
      if (result.reason === 'STALE_T2') {
        console.warn(
          `[SyncCore LWW] 🛡️ Blocked stale T2 [${envelope.entityType}:${envelope.entityId}] from hitting RoomDatabase.`
        );
      } else if (result.reason === 'RESURRECTION_BLOCKED') {
        console.warn(
          `[SyncCore Resurrection Guard] 🪦 Blocked resurrection of [${envelope.entityType}:${envelope.entityId}] from ${originName}.`
        );
      }
      return false;
    }

    return true;
  }

  /**
   * Persists an envelope that has already passed SyncCore validation (LWW, dedupe, self-origin).
   */
  private async applyAcceptedEnvelope(
    envelope: SyncEnvelope,
    originName: string,
    options?: { isReconBackfill?: boolean }
  ): Promise<void> {
    const isSilent = Boolean(options?.isReconBackfill);
    const d: any = envelope.data || {};
    const unwrapped = envelope.meta?.unwrappedPacket || {};
    const packetComp =
      d.company_id || d.companyId || unwrapped.companyId || unwrapped.company_id || this.config.companyId;
    const ttl = unwrapped.ttl || 5;

    if (envelope.action === 'DELETE') {
      if (envelope.entityId) {
        if (envelope.entityType === 'inventory_item') {
          ingestMeshInventoryDelete(envelope.entityId, packetComp);
        }
        applyTombstone({
          entityType: envelope.entityType,
          entityId: envelope.entityId,
          deletedAt: envelope.updatedAt || Date.now(),
        });
        this.addLog(
          'EPIDEMIC_HOP',
          `Record [${envelope.entityType}:${envelope.entityId}] deleted on peer ${originName}. Deletion synced across local mesh!`,
          originName,
          this.config.deviceName
        );
      }
      return;
    }

    switch (envelope.entityType) {
      case 'sale': {
        const saleId = envelope.entityId || this.extractInvoiceId(d) || d.id;
        if (!saleId || !d) return;
        const isLegacyInv = /^INV-/i.test(saleId);
        const isSaleUpdate =
          envelope.action === 'UPSERT' ||
          Boolean(envelope.meta?.isSaleUpdate) ||
          d.status === 'Refunded' ||
          d.status === 'Voided' ||
          d.mobileVerificationStatus === 'VERIFIED' ||
          d.mobileVerificationStatus === 'FLAGGED' ||
          Boolean(d.hasExchanges);

        if (this.knownSaleIds.has(saleId) && !isSaleUpdate) {
          return;
        }
        this.knownSaleIds.add(saleId);
        this.broadcastedInvoiceIds.add(saleId);

        const attachedLogs: CashLogEntry[] = Array.isArray(d.reversalCashLogs)
          ? d.reversalCashLogs
          : Array.isArray(unwrapped.reversalCashLogs)
          ? unwrapped.reversalCashLogs
          : [];
        const cleanSaleData: any = { ...d };
        if ('reversalCashLogs' in cleanSaleData) {
          delete cleanSaleData.reversalCashLogs;
        }

        const ingested = ingestMeshSale({
          ...cleanSaleData,
          id: saleId,
          company_id: this.config.companyId,
          branch_id: cleanSaleData.branch_id || cleanSaleData.branchId || this.config.branchId,
          fromMesh: true,
        } as any);

        if (attachedLogs.length > 0) {
          attachedLogs.forEach((cl) => {
            if (cl && typeof cl === 'object') {
              ingestMeshCashLog({ ...cl, fromMesh: true } as any);
            }
          });
        }

        if ((ingested || attachedLogs.length > 0) && !isSilent) {
          this.dispatchHubCoalescedEvent('saimetric_sales_updated');
          this.dispatchHubCoalescedEvent('saimetric_cash_updated');
          this.dispatchHubCoalescedEvent('saimetric_inventory_updated');
          this.scheduleBatchUiUpdate();
          this.addLog(
            'EPIDEMIC_HOP',
            `Received ${isLegacyInv ? 'Legacy ' : ''}Sale #${saleId} ($${(d.total || 0).toFixed(2)}) from ${originName}. Synced locally.`,
            originName,
            this.config.deviceName,
            ttl,
            saleId
          );
        }
        break;
      }

      case 'inventory_item': {
        if (!d || (!d.itemId && !d.id)) return;
        const hubTimestamp =
          parseTimestampMs(
            envelope.hubTimestamp ?? envelope.updatedAt ?? d.hubTimestamp ?? d.updatedAt
          ) || Date.now();
        const hubLastUpdated =
          unwrapped.lastUpdated || d.lastUpdated || new Date(hubTimestamp).toISOString();
        const ingested = ingestMeshInventoryItem({
          ...d,
          updatedAt: hubTimestamp,
          hubTimestamp,
          lastUpdated: hubLastUpdated,
          company_id: this.config.companyId,
          branch_id: d.branch_id || 'ALL',
          fromMesh: true,
        });
        if (ingested && !isSilent) {
          this.dispatchHubCoalescedEvent('saimetric_inventory_updated', d);
          this.dispatchHubCoalescedEvent('saimetric_products_updated', d);
          this.dispatchHubCoalescedEvent('mesh-inventory-received', { item: d, originName });
          this.scheduleBatchUiUpdate();
          this.notifyPeerSubscribers();
          this.addLog(
            'EPIDEMIC_HOP',
            `Received Product "${d.itemName || d.name}" (Price: $${(d.sellPriceUnit || 0).toFixed(2)}) from ${originName}. Re-rendered instantly.`,
            originName,
            this.config.deviceName,
            ttl,
            d.itemId || envelope.entityId
          );
        }
        break;
      }

      case 'cash_log':
        if (d) {
          const ingested = ingestMeshCashLog({ ...d, fromMesh: true } as any);
          if (ingested && !isSilent && typeof window !== 'undefined') {
            this.dispatchHubCoalescedEvent('saimetric_cash_updated');
            this.dispatchHubCoalescedEvent('saimetric_cash_movements_updated');
            this.addLog(
              'EPIDEMIC_HOP',
              `Cash Drawer movement synced from ${originName}: In $${d.in || 0} / Out $${d.out || 0} (${d.description || ''}).`,
              originName,
              this.config.deviceName
            );
          }
        }
        break;

      case 'customer_change':
        if (d) {
          if (ingestMeshCustomerChange(d) && !isSilent && typeof window !== 'undefined') {
            if (!this.isIngestingFromHub) playChime();
            this.dispatchHubCoalescedEvent('saimetric_customer_changes_updated', d);
            this.dispatchHubCoalescedEvent('saimetric_customers_updated');
            this.dispatchHubCoalescedEvent('saimetric_cash_updated');
            this.addLog(
              'EPIDEMIC_HOP',
              `Customer Change voucher synced from ${originName}: ${d.customerName || ''} ($${d.amount || d.in || d.out || 0})`,
              originName,
              this.config.deviceName
            );
          }
        }
        break;

      case 'credit_sale':
        if (d) {
          if (ingestMeshCreditSale(d) && !isSilent && typeof window !== 'undefined') {
            if (!this.isIngestingFromHub) playChime();
            this.dispatchHubCoalescedEvent('saimetric_credit_sales_updated', d);
            this.dispatchHubCoalescedEvent('saimetric_customers_updated');
            this.dispatchHubCoalescedEvent('saimetric_cash_updated');
            this.addLog(
              'EPIDEMIC_HOP',
              `Credit Sale synced from ${originName}: ${d.customerName || ''} ($${d.amount || 0})`,
              originName,
              this.config.deviceName
            );
          }
        }
        break;

      case 'credit_group':
        if (d) {
          if (ingestMeshCreditGroup(d) && !isSilent && typeof window !== 'undefined') {
            playChime();
            window.dispatchEvent(new CustomEvent('saimetric_credit_groups_updated', { detail: d }));
          }
        }
        break;

      case 'daily_blind_config':
        if (d) {
          if (ingestMeshDailyBlindConfig({ ...d, id: d.id || envelope.entityId }) && !isSilent && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_daily_blind_updated', { detail: { type: 'config', record: d } }));
          }
        }
        break;

      case 'daily_blind_count':
        if (d) {
          if (ingestMeshDailyBlindCount({ ...d, id: d.id || envelope.entityId }) && !isSilent && typeof window !== 'undefined') {
            playChime();
            window.dispatchEvent(new CustomEvent('saimetric_daily_blind_updated', { detail: { type: 'count', record: d } }));
          }
        }
        break;

      case 'stock_movement':
        if (d) {
          if (ingestMeshStockMovement(d) && !isSilent && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
          }
        }
        break;

      case 'direct_grv':
        if (d) {
          const cleanGrv: any = { ...d };
          delete cleanGrv.fromMesh;
          delete cleanGrv.fromSync;
          const ingested = ingestMeshGRV(cleanGrv as any);
          if (isSilent) {
            recordDirectGrvTillPayouts(cleanGrv as any);
          } else if (ingested && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_direct_grvs_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
            this.addLog(
              'EPIDEMIC_HOP',
              `Goods Received Delivery ${d.grvNumber || envelope.entityId} synced from ${originName}.`,
              originName,
              this.config.deviceName
            );
          }
        }
        break;

      case 'goods_received':
        if (d && ingestMeshGoodsReceived(d) && !isSilent && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
        break;

      case 'expense':
        if (d) {
          const cleanExp: any = { ...d };
          delete cleanExp.fromMesh;
          delete cleanExp.fromSync;
          addExpense(cleanExp, { fromSync: true });
          if (!isSilent && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
            this.addLog(
              'EPIDEMIC_HOP',
              `Expense synced from ${originName}: $${d.amount || 0} (${d.category || ''})`,
              originName,
              this.config.deviceName
            );
          }
        }
        break;

      case 'internal_consumption':
        if (d && d.id && ingestMeshInternalConsumption(d) && !isSilent && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_internal_consumption_updated', { detail: d }));
          window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        }
        break;

      case 'cash_movement':
        if (d && d.id) {
          const cur = getMovements();
          if (!cur.some((m) => m.id === d.id)) {
            addMovement({ ...d, fromMesh: true });
            if (!isSilent && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
              window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
            }
          }
        }
        break;

      case 'cash_lift':
        if (d && ingestMeshCashLift(d) && !isSilent && typeof window !== 'undefined') {
          playChime();
          window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
        break;

      case 'cash_transfer':
        if (d && ingestMeshCashTransfer(d) && !isSilent && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_cash_transfers_updated', { detail: d }));
          window.dispatchEvent(new CustomEvent('saimetric_cash_accounts_updated', { detail: d }));
          window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
          window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        }
        break;

      case 'staff':
        if (d && d.id) {
          const staffTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
          const ingested = ingestMeshStaff({ ...d, fromMesh: true } as any, { fromSync: true });
          if (staffTime > 0) {
            setLastStaffSync(Math.max(getLastStaffSync(), staffTime));
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_salespeople_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_staff_updated', { detail: d }));
          }
          if (ingested && !isSilent) {
            this.addLog(
              'EPIDEMIC_HOP',
              `Staff account ${d.name || d.id} (${d.role || 'STAFF'}) synced from ${originName}.`,
              originName,
              this.config.deviceName
            );
            this.notifyPeerSubscribers();
          }
        }
        break;

      case 'permissions_matrix': {
        const rules = Array.isArray(d) ? d : d.rules;
        const incomingUpdatedAt = envelope.updatedAt || parseTimestampMs(d?.updatedAt);
        if (Array.isArray(rules) && rules.length > 0) {
          if (ingestMeshPermissionsMatrix(rules, incomingUpdatedAt) && !isSilent) {
            this.addLog(
              'EPIDEMIC_HOP',
              `Permissions Matrix (${rules.length} rules) synced from ${originName}.`,
              originName,
              this.config.deviceName
            );
            this.notifyPeerSubscribers();
          }
        }
        break;
      }

      case 'role_configs': {
        const defs = d?.definitions || d;
        const incomingUpdatedAt = envelope.updatedAt || parseTimestampMs(d?.updatedAt);
        if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
          if (ingestMeshRoleDefinitions(defs, incomingUpdatedAt) && !isSilent) {
            this.addLog(
              'EPIDEMIC_HOP',
              `Role Configurations synced from ${originName}.`,
              originName,
              this.config.deviceName
            );
            this.notifyPeerSubscribers();
          }
        }
        break;
      }

      case 'multi_currency': {
        const mcConfig = d?.multiCurrencyConfig || d?.exchangeRates || d;
        const incomingUpdatedAt =
          envelope.updatedAt || parseTimestampMs(mcConfig?.updatedAt ?? mcConfig?.lastUpdated);
        if (mcConfig && typeof mcConfig === 'object' && mcConfig.rates) {
          const ingested = ingestMeshMultiCurrencyConfig(mcConfig, incomingUpdatedAt);
          if (incomingUpdatedAt > 0) {
            setLastMultiCurrencySync(Math.max(getLastMultiCurrencySync(), incomingUpdatedAt));
          }
          if (ingested && !isSilent) {
            this.addLog(
              'EPIDEMIC_HOP',
              `Multi-Currency & Exchange Rates synced (Base: ${mcConfig.baseCurrency || 'USD'}).`,
              originName,
              this.config.deviceName
            );
            this.notifyPeerSubscribers();
          }
        }
        break;
      }

      case 'customer':
        if (d && (d.customerId || d.id)) {
          const custTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
          ingestMeshCustomer({ ...d, fromMesh: true }, { fromSync: true });
          if (custTime > 0) {
            setLastCustomerSync(Math.max(getLastCustomerSync(), custTime));
          }
          if (!isSilent && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
          }
        }
        break;

      case 'branch':
        if (d && isValidBranchRecord(d) && (d.branchId || d.id || d.branch_id || d.BranchID)) {
          const rawBrId = String(d.branchId || d.id || d.branch_id || d.BranchID || 'BR-MAIN').trim();
          const lowerBr = rawBrId.toLowerCase();
          const canonBrId = lowerBr === '1' || lowerBr === 'br-main' || lowerBr === 'br001' ? 'BR-MAIN' : rawBrId;
          const branchTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
          const normalizedBranch = { ...d, branchId: canonBrId, id: canonBrId, branch_id: canonBrId, fromMesh: true };
          saveBranch(normalizedBranch, { fromSync: true });
          if (branchTime > 0) {
            setLastBranchSync(Math.max(getLastBranchSync(), branchTime));
          }
          if (!isSilent && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_branches_updated', { detail: normalizedBranch }));
          }
        }
        break;

      case 'cash_account':
        if (d && (d.account_id || d.id)) {
          const accTime = extractRecordTimestamp(d) || envelope.updatedAt || 0;
          saveCashAccount({ ...d, fromMesh: true }, { fromSync: true });
          if (accTime > 0) {
            setLastCashAccountSync(Math.max(getLastCashAccountSync(), accTime));
          }
          if (!isSilent && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_cash_accounts_updated', { detail: d }));
            window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
          }
        }
        break;

      case 'supplier':
        if (d && (d.supplierId || d.id || d.SupplierID)) {
          this.ingestMeshSupplier({ ...d, fromMesh: true });
        }
        break;

      case 'admin_sales':
        if (d && (d.id || d.staffId)) {
          this.ingestMeshAdminSales({ ...d, fromMesh: true });
        }
        break;

      case 'cash_count':
        if (d && (d.id || d.staffId)) {
          this.ingestMeshCashCount({ ...d, fromMesh: true });
        }
        break;

      case 'supplier_invoice_voucher':
        if (d && (d.voucherId || d.id)) {
          this.ingestMeshVoucher({ ...d, fromMesh: true });
        }
        break;

      case 'business_day_closure':
        if (d && (d.id || d.date)) {
          this.ingestMeshClosure({ ...d, fromMesh: true });
        }
        break;

      case 'electronic_settlement':
        if (d && (d.id || d.date)) {
          this.ingestMeshSettlement({ ...d, fromMesh: true });
        }
        break;

      case 'inventory_category':
        if (d) {
          this.ingestMeshCategories(d);
        }
        break;

      case 'supervisor_approval':
      case 'audit_log':
        if (d) {
          const ingested = ingestMeshSupervisorApproval({ ...d, fromMesh: true } as any);
          if (ingested && !isSilent) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('saimetric_audit_log_updated', { detail: d }));
            }
            this.addLog(
              'EPIDEMIC_HOP',
              `Supervisor Approval [${d.action || 'APPROVAL'}] by ${d.authorizedByName || d.staffName || 'Supervisor'} from ${originName}.`,
              originName,
              this.config.deviceName
            );
          }
        }
        break;

      case 'reconciliation':
        if (d) {
          saveReconciliation(d, { fromSync: true });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_reconciliations_updated', { detail: d }));
          }
        }
        break;

      case 'system_settings':
        if (d) {
          ingestMeshSettings(d);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_settings_updated', { detail: d }));
          }
        }
        break;

      case 'tombstone':
        if (d && d.entityId && d.entityType) {
          applyTombstone({
            ...d,
            deletedAt: d.deletedAt ?? envelope.updatedAt ?? envelope.hubTimestamp,
          });
        }
        break;

      case 'casual_worker':
        if (Array.isArray(d)) {
          syncCasualWorkersFromHub(d, { fromSync: true });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_casual_workers_updated'));
            window.dispatchEvent(new CustomEvent('saimetric_casuals_updated'));
          }
        }
        break;

      case 'branch_lockdown':
        syncLockdownFromHub({
          branchId: d.branchId || this.config.branchId,
          isLocked: Boolean(d.isLocked),
          sessionId: d.sessionId,
          lockedBy: d.lockedBy,
          lockedByName: d.lockedByName,
          lockedAt: d.lockedAt,
          reason: d.reason,
          updatedAt: d.updatedAt || envelope.updatedAt || Date.now(),
          lastUpdated: d.lastUpdated,
        });
        break;

      case 'stocktake_segment': {
        const seg = d?.segment || d;
        const zoneId = seg?.segmentId || seg?.id || d?.zoneId;
        if (seg) {
          saveStocktakeSegment(seg, d?.sessionId || seg?.sessionId);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: d }));
          }
          console.log('[Stocktake] Segment synced via SyncCore:', zoneId);
        }
        break;
      }

      case 'stocktake_zone_claim': {
        const zoneId = d?.zoneId || envelope.entityId;
        updateZoneClaim(
          zoneId,
          d?.slot,
          {
            staffId: d?.staffId,
            staffName: d?.staffName,
            deviceId: d?.deviceId,
            zoneName: d?.zone?.zoneName || d?.zoneName,
            sessionId: d?.sessionId,
          },
          d?.sessionId
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: d }));
        }
        break;
      }

      case 'stocktake_joint_proposal': {
        const zoneId = d?.zoneId || envelope.entityId;
        applyJointRecountSignature(
          d?.sessionId,
          zoneId,
          d?.proposedBySlot || 'A',
          d?.proposedByName || 'Peer Counter',
          d?.recountLines || []
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('saimetric_stocktake_joint_proposal', { detail: d }));
          window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: d }));
        }
        break;
      }

      case 'stocktake_joint_finalized': {
        const zoneId = d?.zoneId || envelope.entityId;
        applyJointRecountSignature(
          d?.sessionId,
          zoneId,
          'BOTH',
          d?.resolvedByName || 'Dual Counters',
          d?.resolvedLines || []
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('saimetric_stocktake_match_verified', {
              detail: { zoneId, verifiedCounts: d?.resolvedLines },
            })
          );
          window.dispatchEvent(
            new CustomEvent('saimetric_stocktake_zone_updated', {
              detail: { zoneId, status: 'VERIFIED' },
            })
          );
        }
        break;
      }

      case 'stocktake_session': {
        const sObj = d?.session && typeof d.session === 'object' ? { ...d, ...d.session } : d;
        const sId = sObj?.sessionId || sObj?.id || envelope.entityId;
        if (sId) {
          ingestStocktakeSessionFromMesh({
            ...sObj,
            sessionId: sId,
            sessionName: sObj?.sessionName || sObj?.title,
            title: sObj?.title || sObj?.sessionName,
            segments: sObj?.segments || [],
            startedBy: sObj?.startedBy || sObj?.createdByName || sObj?.createdBy,
            startedAt: sObj?.startedAt || sObj?.timestamp,
            updatedAt: sObj?.updatedAt || envelope.updatedAt,
          });
        }
        break;
      }

      default:
        break;
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
      packet.origin_device_name ||
      packet.originDeviceName ||
      packet.deviceName ||
      (packet.data &&
        (packet.data.origin_device_id ||
          packet.data.originDeviceId ||
          packet.data.deviceId ||
          packet.data.origin_device_name ||
          packet.data.deviceName)) ||
      (packet.payload &&
        (packet.payload.origin_device_id ||
          packet.payload.originDeviceId ||
          packet.payload.deviceId ||
          packet.payload.origin_device_name ||
          packet.payload.deviceName));

    if (rawOrigin && (rawOrigin === this.config.deviceId || rawOrigin === this.config.deviceName)) {
      return;
    }

    // Unwrap envelope wrappers if hub relays through { data: ... } or { payload: ... }
    if (packet.data && typeof packet.data === 'object') {
      if (packet.data.type || packet.data.action) {
        packet = packet.data;
      }
    } else if (packet.payload && typeof packet.payload === 'object') {
      if (packet.payload.type || packet.payload.action) {
        packet = packet.payload;
      }
    }

    const originId =
      packet.origin_device_id ||
      packet.originDeviceId ||
      packet.deviceId ||
      packet.sourceDevice;

    if (originId && (originId === this.config.deviceId || originId === this.config.deviceName)) {
      return;
    }

    // Strict Tenant Isolation: Discard packets from different tenant
    const packetComp = (
      packet.company_id ||
      packet.companyId ||
      (packet.payload && (packet.payload.company_id || packet.payload.companyId)) ||
      ''
    )
      .trim()
      .toUpperCase();
    const localComp = (this.config.companyId || '').trim().toUpperCase();
    const normTenant = (c: string) => (!c || c === 'COMP-001' || c === 'COMP-MASTER' ? 'COMP-001' : c);
    if (packetComp && localComp && normTenant(packetComp) !== normTenant(localComp)) {
      return;
    }

    notifySyncCoreListeners(packet);

    const pType = String(packet.type || packet.action || '');
    const pTypeUpper = pType.toUpperCase();
    const originName =
      packet.origin_device_name || packet.originDeviceName || packet.deviceName || 'Peer Terminal';

    // Control & status frames
    if (pTypeUpper === 'DRAIN_COMPLETE_ACK') {
      if (this.drainAckFallbackTimer) {
        clearTimeout(this.drainAckFallbackTimer);
        this.drainAckFallbackTimer = null;
      }
      if (this.isAwaitingDrainAck) {
        this.isAwaitingDrainAck = false;
        this.triggerDeltaCatchUpAfterFlush();
      }
      return;
    }

    if (pTypeUpper === 'SYNC_ACK') {
      this.handleSyncAck(packet);
      return;
    }

    if (pTypeUpper === 'T1_CLOUD_SYNC_ACK') {
      const ackId = String(packet.id || packet.invoice_id || packet.grvNumber || '').trim();
      if (ackId) {
        markRecordsCloudSynced([ackId], [], packet.entityType, true);
        if (/^INV-/i.test(ackId) || String(packet.entityType || '').toUpperCase() === 'SALE') {
          this.pendingSaleAcks.delete(ackId);
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('saimetric_cloud_sync_ack', {
            detail: { entityType: packet.entityType, id: packet.id, isCloudSynced: true },
          })
        );
      }
      return;
    }

    if (pTypeUpper === 'INVENTORY_SNAPSHOT_RESPONSE') {
      const snapTombstones = packet.tombstones;
      if (Array.isArray(snapTombstones) && snapTombstones.length > 0) {
        for (const tomb of snapTombstones) {
          if (tomb && tomb.entityId && tomb.entityType) {
            applyTombstone(tomb);
          }
        }
      }
      const items = packet.items || packet.payload;
      if (Array.isArray(items)) {
        for (const it of items) {
          const snapEnv: SyncEnvelope = {
            packetId: `SNAP-${it.itemId || it.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            entityType: 'inventory_item',
            entityId: String(it.itemId || it.id || ''),
            action: 'UPSERT',
            data: it,
            updatedAt: parseTimestampMs(it.hubTimestamp ?? it.updatedAt ?? packet.timestamp) || Date.now(),
            hubTimestamp: parseTimestampMs(it.hubTimestamp ?? it.updatedAt),
            originDeviceId: 'LOCAL_HUB_SNAPSHOT',
            targetBranchId: 'ALL',
            class: 'T2',
          };
          void this.ingestEnvelopeThroughSyncCore(snapEnv, 'Local Hub Snapshot', { isReconBackfill: true });
        }
        recalculateInventoryValuationOnce();
        console.log(`[Snapshot Heartbeat] 📸 Ingested authoritative inventory snapshot of ${items.length} items (${Array.isArray(snapTombstones) ? snapTombstones.length : 0} tombstones) via SyncCore`);
      }
      return;
    }

    if (pTypeUpper === 'HISTORICAL_T1_RESPONSE') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_historical_response', { detail: packet }));
      }
      return;
    }

    if (pTypeUpper === 'FINANCIAL_REPORT_RESPONSE') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_financial_report_response', { detail: packet }));
      }
      return;
    }

    if (pTypeUpper === 'RECON_SWEEP_TRIGGER') {
      this.handleReconSweepTrigger(packet);
      return;
    }
    if (pTypeUpper === 'SYNC_SNAPSHOT_REQUEST') {
      this.handleSyncSnapshotRequest(packet);
      return;
    }
    if (pTypeUpper === 'SYNC_ID_DIGEST_REQUEST') {
      this.handleSyncIdDigestRequest(packet);
      return;
    }
    if (pTypeUpper === 'RECON_BACKFILL_PAYLOAD') {
      this.handleIncomingReconBackfill(packet);
      return;
    }
    if (pTypeUpper === 'RECON_PUSH_BACKFILL_REQUEST') {
      this.handleReconPushBackfillRequest(packet);
      return;
    }
    if (pTypeUpper === 'HUB_CLOUD_BROADCAST') {
      this.handleHubCloudBroadcast(packet);
      return;
    }

    // Stocktake Hub status frames
    if (pTypeUpper === 'STOCKTAKE_ZONE_STATUS_UPDATE') {
      const zoneId = packet.zoneId;
      if (packet.sessionId && zoneId) {
        updateZoneFromHubStatus(packet.sessionId, zoneId, packet.status, undefined, undefined, {
          hasCountA: packet.hasCountA,
          hasCountB: packet.hasCountB,
          teamAFinalized: packet.teamAFinalized,
          teamBFinalized: packet.teamBFinalized,
          comparisonFinalized: packet.comparisonFinalized,
          teamAStaffId: packet.teamAStaffId,
          teamBStaffId: packet.teamBStaffId,
          teamAStaffName: packet.teamAStaffName,
          teamBStaffName: packet.teamBStaffName,
        });
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_stocktake_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: packet }));
      }
      return;
    }

    if (pTypeUpper === 'STOCKTAKE_MATCH_VERIFIED') {
      markZoneVerified(packet.zoneId, packet.verifiedCounts || [], packet.sessionId);
      if (packet.comparisonFinalized && packet.sessionId && packet.zoneId) {
        updateZoneFromHubStatus(packet.sessionId, packet.zoneId, 'VERIFIED', undefined, packet.verifiedCounts || [], {
          comparisonFinalized: true,
        });
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_stocktake_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_match_verified', { detail: packet }));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: packet }));
      }
      return;
    }

    if (pTypeUpper === 'STOCKTAKE_VARIANCE_ALERT') {
      markZoneVariance(packet.zoneId, packet.discrepancies || [], packet.sessionId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_stocktake_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_variance_alert', { detail: packet }));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: packet }));
      }
      return;
    }

    if (pTypeUpper === 'STOCKTAKE_ACK_SUBMIT') {
      if (packet.sessionId && packet.zoneId) {
        const currentSess = getStocktakeSessionById(packet.sessionId);
        const existingSeg = currentSess?.segments?.find((s: any) => (s.segmentId || s.id) === packet.zoneId);
        if (!existingSeg || (existingSeg.status !== 'VERIFIED' && existingSeg.status !== 'DISCREPANCY_RECOUNT')) {
          updateZoneFromHubStatus(packet.sessionId, packet.zoneId, 'VAULTED', undefined, undefined, {
            hasCountA: packet.slot === 'A' ? true : undefined,
            hasCountB: packet.slot === 'B' ? true : undefined,
            teamAFinalized: packet.slot === 'A' ? true : undefined,
            teamBFinalized: packet.slot === 'B' ? true : undefined,
          });
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_stocktake_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_ack_submit', { detail: packet }));
      }
      return;
    }

    if (pTypeUpper === 'STOCKTAKE_SEGMENT_UNLOCKED') {
      const segId = packet.segmentId || packet.zoneId;
      if (packet.sessionId && segId) {
        reopenFinalizedSegmentSlot(
          packet.sessionId,
          segId,
          packet.target || 'ALL',
          packet.actorId || 'AUDITOR',
          packet.actorName || 'Stocktake Auditor',
          packet.reason || 'Unlocked via Hub'
        );
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_stocktake_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_zone_updated', { detail: packet }));
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_segment_unlocked', { detail: packet }));
      }
      return;
    }

    if (
      pTypeUpper === 'STOCKTAKE_CLAIM_REJECTED' ||
      pTypeUpper === 'STOCKTAKE_SLOT_LOCKED' ||
      pTypeUpper === 'STOCKTAKE_SESSION_CONFLICT'
    ) {
      let enrichedDetail: any = packet;
      if (pTypeUpper === 'STOCKTAKE_SESSION_CONFLICT') {
        const rejectedId = String(packet.sessionId || '').trim();
        if (rejectedId) {
          this.localHubAdapter.removeQueuedPacketsByEntityId(rejectedId);
        }
        const res = resolveConflictingLocalStocktakeSession(
          rejectedId,
          packet.existingSession,
          packet.existingLockdown || null
        );
        enrichedDetail = {
          ...packet,
          hadOfflineCounts: res.hadOfflineCounts,
          resolved: res.resolved,
        };
        this.requestStocktakeSessionList();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_stocktake_rejected', { detail: enrichedDetail }));
        window.dispatchEvent(new Event('saimetric_stocktake_updated'));
      }
      return;
    }

    if (pTypeUpper === 'STOCKTAKE_SESSION_LIST') {
      const sessions = packet.sessions || packet.payload?.sessions || [];
      const segments = packet.segments || packet.payload?.segments || [];
      const zoneAssignments = packet.zoneAssignments || packet.payload?.zoneAssignments || [];
      const stocktakeTombstones = packet.tombstones || packet.payload?.tombstones || [];
      const branchLockdowns = packet.branchLockdowns || packet.payload?.branchLockdowns || null;

      // Apply stocktake tombstones BEFORE ingesting sessions so deleted sessions are purged first
      if (Array.isArray(stocktakeTombstones) && stocktakeTombstones.length > 0) {
        stocktakeTombstones.forEach((tomb: any) => {
          if (tomb && tomb.entityId) {
            applyTombstone({
              entityType: tomb.entityType || 'stocktake_session',
              entityId: tomb.entityId,
              deletedAt: tomb.deletedAt || tomb.updatedAt || Date.now(),
            });
          }
        });
      }

      if (Array.isArray(zoneAssignments) && zoneAssignments.length > 0) {
        saveZoneAssignmentsBatch(zoneAssignments.filter((z: any) => z && z.sessionId && z.zoneId));
      }

      if (Array.isArray(sessions) && sessions.length > 0) {
        sessions.forEach((sess: any) => {
          if (sess && sess.sessionId) {
            const sessSegments =
              Array.isArray(sess.segments) && sess.segments.length > 0
                ? sess.segments
                : Array.isArray(segments)
                ? segments.filter((sg: any) => sg.sessionId === sess.sessionId)
                : [];
            const sessEnv: SyncEnvelope = {
              packetId: `STLIST-${sess.sessionId}-${extractRecordTimestamp(sess) || Date.now()}`,
              entityType: 'stocktake_session',
              entityId: String(sess.sessionId),
              action: 'UPSERT',
              data: { ...sess, segments: sessSegments },
              updatedAt: extractRecordTimestamp(sess) || Date.now(),
              originDeviceId: originId || 'LOCAL_HUB',
              targetBranchId: sess.branchId || this.config.branchId,
              class: 'T2',
            };
            void this.ingestEnvelopeThroughSyncCore(sessEnv, originName);
          }
        });
      }

      if (branchLockdowns && typeof branchLockdowns === 'object') {
        Object.values(branchLockdowns).forEach((lk: any) => {
          if (lk && lk.branchId) {
            syncLockdownFromHub(lk);
          }
        });
      }
      return;
    }

    const isReceipt =
      pTypeUpper === 'SYNC_RECEIPT' ||
      pTypeUpper === 'CLOUD_SYNC_ACK' ||
      pTypeUpper === 'ANTI-DOUBLE-POST ACK' ||
      pTypeUpper === 'SALE_ACK' ||
      pTypeUpper === 'ACK';

    if (isReceipt) {
      const invId = this.extractInvoiceId(packet);
      if (invId) {
        this.handleIncomingSaleSyncReceipt(invId, originName);
      }
      const postedIds: string[] =
        packet.postedIds ||
        packet.invoice_ids ||
        packet.invoiceIds ||
        packet.data?.postedIds ||
        packet.payload?.postedIds ||
        packet.data?.invoice_ids;
      if (Array.isArray(postedIds)) {
        for (const pid of postedIds) {
          if (pid) this.handleIncomingSaleSyncReceipt(pid, originName);
        }
      }
      this.handleIncomingSyncReceipt(packet);
      return;
    }

    if (pTypeUpper === 'CATCHUP_RESPONSE') {
      this.handleIncomingCatchupResponse(packet);
      return;
    }

    if (pTypeUpper === 'CATCHUP_REQUEST') {
      this.handleIncomingCatchupRequest(packet);
      return;
    }

    // Fix E: Clear stuck entries from LocalHubAdapter's pending queue on LWW reject / authoritative Hub push
    const isFromHubAuthoritative =
      packet.origin_device_id === 'LOCAL_HUB' ||
      packet.originDeviceId === 'LOCAL_HUB';

    const isInvPacket =
      pTypeUpper === 'INVENTORY' ||
      pTypeUpper === 'INVENTORY_ITEM' ||
      pTypeUpper === 'INVENTORY_UPDATE' ||
      pTypeUpper === 'INVENTORY_RECORD' ||
      Boolean(packet.item);

    const isLwwRejectOrHubPush =
      isFromHubAuthoritative ||
      packet.entityType === 'branch' ||
      packet.entityType === 'staff' ||
      packet.entityType === 'customer' ||
      packet.entityType === 'cash_account' ||
      pTypeUpper === 'BRANCH_SYNC' ||
      pTypeUpper === 'BRANCH' ||
      packet.action === 'LWW_REJECT' ||
      packet.status === 'rejected' ||
      packet.error === 'LWW_STALE' ||
      (typeof packet.message === 'string' && packet.message.toUpperCase().includes('LWW'));

    const envelope = this.localHubAdapter.packetToEnvelope(packet);

    if (isLwwRejectOrHubPush) {
      let clearId = envelope?.entityId || '';
      if (pTypeUpper === 'CASUAL_WORKERS_SYNC') clearId = 'ALL';
      else if (
        pTypeUpper === 'MULTI_CURRENCY_SYNC' ||
        pTypeUpper === 'EXCHANGE_RATES_SYNC' ||
        pTypeUpper === 'MULTI_CURRENCY' ||
        pTypeUpper === 'EXCHANGE_RATES' ||
        packet.entityType === 'multi_currency'
      ) {
        clearId = 'MULTI_CURRENCY_CONFIG';
      } else if (isInvPacket) {
        const it = packet.item || packet.payload || packet;
        clearId = it?.itemId || it?.id || clearId;
      }
      if (clearId && clearId !== 'UNKNOWN') {
        const removed = this.localHubAdapter.removeQueuedPacketsByEntityId(clearId);
        if (removed > 0) {
          console.log(`[Queue] Removed rejected/authoritative entry: ${envelope?.entityType || pTypeUpper} ${clearId}`);
        }
      }
    }

    if (!envelope) {
      return;
    }

    // Resolve pending sale ACKs on implicit relay
    if (envelope.entityType === 'sale' && envelope.entityId) {
      const saleId = envelope.entityId;
      if (this.pendingSaleAcks.has(saleId)) {
        if (/^INV-/i.test(saleId)) {
          this.pendingSaleAcks.delete(saleId);
        } else {
          this.handleIncomingSaleSyncReceipt(saleId, originName);
        }
      }
    }

    // Route through SyncCore.ingest() (T2 60s LWW + T1 append-only dedupe + packet dedupe)
    void this.ingestEnvelopeThroughSyncCore(envelope, originName);
  }

  private handleLocalHubLost(reason: string) {
    this.coldHubHydrationQueue.cancel();
    this.hubStorageManager.handleDisconnected();
    if (this.localHubHeartbeatTimer) {
      clearInterval(this.localHubHeartbeatTimer);
      this.localHubHeartbeatTimer = null;
    }

    const wasConnected = this.isLocalHubConnected;
    this.isLocalHubConnected = false;
    this.isWsConnected = false;

    if (this.localHubDisconnectedAt === null) {
      this.localHubDisconnectedAt = Date.now();
    }

    if (!this.localHubLostGraceTimer && !this.isLocalHubLost) {
      this.localHubLostGraceTimer = window.setTimeout(() => {
        this.localHubLostGraceTimer = null;
        if (!this.isLocalHubConnected && this.localHubDisconnectedAt !== null) {
          const downDuration = Date.now() - this.localHubDisconnectedAt;
          if (downDuration >= 120000) {
            this.isLocalHubLost = true;
            this.syncActiveAdapter();
            this.notifyPeerSubscribers(true);
            this.notifyConnectionModeChange();
          }
        }
      }, 120000);
    }

    if (this.legacyFallbackTimer) {
      clearTimeout(this.legacyFallbackTimer);
      this.legacyFallbackTimer = null;
    }

    const authState = this.localHubAdapter.getAuthState();
    const isPlannedOtaRestart = authState === 'UPDATING';
    const isAuthBlocked = authState === 'AUTH_FAILED';

    if (wasConnected && !isPlannedOtaRestart) {
      this.addLog(
        'DISCOVERY',
        `Local Hub disconnected (${reason}). ${isAuthBlocked ? 'Waiting for pairing/auth resolution.' : 'Reconnecting quietly in background...'}`,
        this.config.deviceName
      );
    }

    this.syncActiveAdapter();
    this.evaluateConnectionPriority();
    this.emitHubSecurityEvent();
    this.notifyPeerSubscribers(true);
    this.notifyConnectionModeChange();

    // Do not spin reconnect loops when authentication/identity check explicitly failed
    if (isAuthBlocked || isPlannedOtaRestart) {
      return;
    }

    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }

    // Jittered exponential backoff (1.5s -> 3s -> 6s -> 12s max) with automatic IP Roaming Discovery
    // whenever the device has paired Hubs and the old IP stopped answering.
    if (!this.localHubReconnectTimer) {
      const attempt = Math.min(this.localHubReconnectAttempts, 3);
      this.localHubReconnectAttempts += 1;
      const baseDelay = 1500 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 600);
      this.localHubReconnectTimer = window.setTimeout(() => {
        this.localHubReconnectTimer = null;
        if (LocalHubConfig.hasAnyPairedHub() && !this.pendingPairRequest) {
          void this.discoverAndReconnectHub().then((found) => {
            if (!found && !this.isLocalHubConnected && !this.localHubAdapter.hasActiveOrConnectingSocket()) {
              this.connectLocalHub();
            }
          });
        } else {
          this.connectLocalHub();
        }
      }, baseDelay + jitter);
    }
  }

  /**
   * Resolves the current active branch ID, name, and company ID
   * prioritizing the logged-in session user, current branch setting, and device registration.
   */
  public getActiveBranchInfo(): { branchId: string; branchName: string; companyId: string } {
    const sessionUser = getSessionUser();
    let regBranchId: string | null = null;
    let currBranchId: string | null = null;
    let loginSelectedBranchId: string | null = null;

    try {
      if (typeof localStorage !== 'undefined') {
        regBranchId = localStorage.getItem('saimetric_device_reg_branch_id');
        currBranchId = localStorage.getItem('saimetric_room_current_branch_id');
        loginSelectedBranchId = localStorage.getItem('saimetric_last_selected_branch_id');
      }
    } catch {}

    const branchId = (
      sessionUser?.branch_id ||
      sessionUser?.branchId ||
      currBranchId ||
      regBranchId ||
      loginSelectedBranchId ||
      getCurrentBranchId() ||
      'VEN-01'
    ).trim();

    const branches = getBranches();
    const matched = branches.find(
      (b) =>
        b.branchId?.toUpperCase() === branchId.toUpperCase() ||
        b.id?.toUpperCase() === branchId.toUpperCase() ||
        b.code?.toUpperCase() === branchId.toUpperCase()
    );

    const branchName =
      sessionUser?.branchName ||
      matched?.name ||
      (matched as any)?.branch_name ||
      branchId ||
      'Main Branch';

    const companyId =
      sessionUser?.company_id ||
      sessionUser?.companyId ||
      getCurrentCompanyId() ||
      'COMP-001';

    return { branchId, branchName, companyId };
  }

  /**
   * Dispatches a HANDSHAKE packet to the Local Hub to assign or re-bind its branch identity.
   */
  public sendHandshake(targetBranchId?: string, targetBranchName?: string): boolean {
    const activeInfo = this.getActiveBranchInfo();
    const branchId = (targetBranchId || activeInfo.branchId || '').trim();
    const branchName = (targetBranchName || activeInfo.branchName || branchId || 'Active Branch').trim();
    const companyId = activeInfo.companyId;

    if (!branchId || branchId.toUpperCase() === 'UNASSIGNED') {
      return false;
    }

    if (!this.localHubAdapter.isConnected()) {
      console.warn('[MeshSync] Cannot send Handshake - Local Hub WebSocket is not open for branch:', branchId);
      return false;
    }

    try {
      const handshakePacket = {
        type: 'HANDSHAKE',
        action: 'HANDSHAKE',
        branch_id: branchId,
        branchId: branchId,
        branch_name: branchName,
        branchName: branchName,
        target_branch_id: branchId,
        tenant_id: companyId,
        company_id: companyId,
        companyId: companyId,
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        timestamp: Date.now(),
      };

      const sent = this.localHubAdapter.sendControlPacket(handshakePacket);
      if (!sent) return false;
      console.log('[MeshSync] Handshake sent to Hub for branch:', branchId);
      this.addLog(
        'BROADCAST',
        `Handshake sent to Hub for branch: ${branchId} (${branchName})`,
        this.config.deviceName
      );
      return true;
    } catch (err) {
      console.warn('[MeshSync] Error sending HANDSHAKE to Local Hub:', err);
      return false;
    }
  }

  public handleIncomingHubInfo(packet: any) {
    const rawBranchId = (packet.branch_id || packet.branchId || '').trim();
    const branchName = (packet.branch_name || packet.branchName || rawBranchId || 'Local Hub').trim();
    const tenantId = packet.tenant_id || packet.tenantId;

    const isUnassigned = !rawBranchId || rawBranchId.toUpperCase() === 'UNASSIGNED';
    const branchId = isUnassigned ? 'UNASSIGNED' : rawBranchId;

    this.hubBranchId = isUnassigned ? 'UNASSIGNED' : branchId;
    this.hubBranchName = isUnassigned ? 'Unassigned Hub' : branchName;

    if (!isUnassigned) {
      LocalHubConfig.setHubBranchIdentity(branchId, branchName, tenantId);
    } else {
      LocalHubConfig.clearHubBranchIdentity();
    }

    if (typeof packet.timestamp === 'number' && packet.timestamp > 1_600_000_000_000) {
      reportTrustedTimeSample(packet.timestamp, 'LOCAL_HUB');
    }

    this.addLog(
      'DISCOVERY',
      `Hub Handshake Verified: Tethered to [${this.hubBranchName}] (${branchId}).`,
      this.config.deviceName
    );

    // Requirement 1: Auto-Send Handshake on HUB_INFO
    // When the app receives a HUB_INFO packet where branch_id === 'UNASSIGNED',
    // it must IMMEDIATELY send the HANDSHAKE packet using the current active user's branch (e.g., VEN-01).
    // Do not wait for a login event—if a user is already logged in, trigger the handshake instantly.
    if (isUnassigned) {
      const activeInfo = this.getActiveBranchInfo();
      if (activeInfo.branchId && activeInfo.branchId.toUpperCase() !== 'UNASSIGNED') {
        this.sendHandshake(activeInfo.branchId, activeInfo.branchName);
      }
      this.evaluateConnectionPriority();
      this.notifyPeerSubscribers(true);
      this.notifyConnectionModeChange();
      return;
    }

    // Safeguard 2: Check if logged-in user or active device branch matches Hub branch
    const sessionUser = getSessionUser();
    const activeBranchId = (sessionUser?.branch_id || sessionUser?.branchId || getCurrentBranchId() || '').trim().toUpperCase();
    const targetHubBranch = (branchId || '').trim().toUpperCase();

    if (
      activeBranchId &&
      targetHubBranch &&
      targetHubBranch !== 'UNASSIGNED' &&
      activeBranchId !== targetHubBranch &&
      activeBranchId !== 'ALL'
    ) {
      this.isCloudOnlyMode = true;
      LocalHubConfig.setCloudOnlyMode(true);
      this.addLog(
        'SECURITY_DROP',
        `Cloud-Only Mode Activated: Active branch [${activeBranchId}] does not match Hub [${targetHubBranch}]. Hub sync blocked to prevent data contamination.`,
        this.config.deviceName
      );
    } else {
      this.isCloudOnlyMode = false;
      LocalHubConfig.setCloudOnlyMode(false);
    }

    this.syncActiveAdapter();
    this.evaluateConnectionPriority();
    this.notifyPeerSubscribers(true);
    this.notifyConnectionModeChange();

    if (!this.isCloudOnlyMode) {
      // Flush-Before-Pull: Drain local changes to Hub first, wait for ACK, then request Delta Catch-Up
      this.drainQueueToLocalHub();
    }
  }

  public handleIncomingResetConfirmed(packet: any) {
    this.hubBranchId = 'UNASSIGNED';
    this.hubBranchName = 'Unassigned Hub';
    this.isCloudOnlyMode = false;
    LocalHubConfig.clearHubBranchIdentity();
    LocalHubConfig.setCloudOnlyMode(false);

    this.addLog(
      'CONFLICT_RESOLVED',
      'Local Hub reset confirmed. Hub memory wiped and branch unassigned.',
      this.config.deviceName
    );

    this.syncActiveAdapter();
    this.evaluateConnectionPriority();
    this.notifyPeerSubscribers(true);
    this.notifyConnectionModeChange();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('saimetric_hub_reset_confirmed', { detail: packet }));
    }

    setTimeout(() => {
      const activeInfo = this.getActiveBranchInfo();
      if (activeInfo.branchId && activeInfo.branchId.toUpperCase() !== 'UNASSIGNED') {
        this.sendHandshake(activeInfo.branchId, activeInfo.branchName);
      }
    }, 2000);
  }

  public resetHubIdentity(newBranchId?: string, newBranchName?: string): boolean {
    if (!this.localHubAdapter.isConnected()) {
      this.hubBranchId = 'UNASSIGNED';
      this.hubBranchName = 'Unassigned Hub';
      this.isCloudOnlyMode = false;
      LocalHubConfig.clearHubBranchIdentity();
      LocalHubConfig.setCloudOnlyMode(false);
      this.syncActiveAdapter();
      this.notifyConnectionModeChange();
      return false;
    }

    try {
      const resetPacket = {
        type: 'RESET_BRANCH',
        action: 'RESET_BRANCH',
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        new_branch_id: newBranchId || 'UNASSIGNED',
        new_branch_name: newBranchName || 'Unassigned Hub',
        timestamp: Date.now(),
      };
      this.localHubAdapter.sendControlPacket(resetPacket);
      this.hubBranchId = 'UNASSIGNED';
      this.hubBranchName = 'Unassigned Hub';
      this.isCloudOnlyMode = false;
      LocalHubConfig.clearHubBranchIdentity();
      LocalHubConfig.setCloudOnlyMode(false);
      this.syncActiveAdapter();
      this.notifyConnectionModeChange();
      this.addLog('BROADCAST', 'Sent RESET_BRANCH command to Local Hub.', this.config.deviceName);
      return true;
    } catch (err) {
      console.warn('[MeshSync] Error sending RESET_BRANCH:', err);
      return false;
    }
  }

  public getHubBranchId(): string | null {
    return this.hubBranchId || LocalHubConfig.getHubBranchId();
  }

  public getHubBranchName(): string | null {
    return this.hubBranchName || LocalHubConfig.getHubBranchName();
  }

  public isCloudOnly(): boolean {
    return this.isCloudOnlyMode;
  }

  public setCloudOnlyMode(enabled: boolean): void {
    this.isCloudOnlyMode = enabled;
    LocalHubConfig.setCloudOnlyMode(enabled);
    this.syncActiveAdapter();
    this.evaluateConnectionPriority();
    this.notifyConnectionModeChange();
  }

  private handleSecurityAlertPacket(packet: any) {
    if (!packet || typeof packet !== 'object') return;
    const targetDeviceId = String(packet.targetDeviceId || packet.deviceId || '').trim();
    const isForThisDevice = !targetDeviceId || targetDeviceId === this.config.deviceId;
    const wasBlocked = packet.packetAccepted === false || packet.alertType === 'VOID_REFUND_BLOCKED';
    const resolvedAlertType =
      packet.alertType === 'VOID_REFUND_BLOCKED' ||
      packet.alertType === 'HUB_FLAGGED_BACKDATE' ||
      packet.alertType === 'SUSPICIOUS_BACKDATE' ||
      packet.alertType === 'CLOCK_TAMPERING' ||
      packet.alertType === 'HUB_REJECTED_BACKDATE'
        ? packet.alertType
        : wasBlocked
        ? 'VOID_REFUND_BLOCKED'
        : 'HUB_FLAGGED_BACKDATE';
    const msg =
      packet.message ||
      (wasBlocked
        ? `Security Lock: Void/Refund blocked from ${targetDeviceId || 'terminal'} due to clock drift. Enable Automatic Date & Time.`
        : `Clock Flag: Backdated packet from ${targetDeviceId || 'terminal'} was accepted by Hub and flagged for review. Voids & refunds restricted until Automatic Date & Time is enabled.`);

    triggerClockTamperLock(msg, {
      deviceId: targetDeviceId || this.config.deviceId,
      deviceName: packet.deviceName || targetDeviceId,
      packetType: packet.packetType || packet.action || 'TRANSACTION',
      invoiceId: packet.invoiceId || packet.entityId,
      claimedTimestamp: typeof packet.claimedTimestamp === 'number' ? packet.claimedTimestamp : undefined,
      hubTimestamp: typeof packet.hubTimestamp === 'number' ? packet.hubTimestamp : undefined,
      serverReceivedAt: typeof packet.serverReceivedAt === 'string' ? packet.serverReceivedAt : undefined,
      lockCurrentDevice: isForThisDevice,
      alertType: resolvedAlertType,
    });

    // Only remove from pending Hub queue if the Hub explicitly rejected a high-risk Void/Refund packet.
    // Normal sales/cash logs flagged by the Hub stay synced uninterrupted.
    if (isForThisDevice && wasBlocked) {
      this.localHubAdapter.removePendingPacketById(packet.packetId, packet.entityId || packet.invoiceId);
      if (packet.invoiceId && this.pendingSaleAcks.has(String(packet.invoiceId))) {
        this.pendingSaleAcks.delete(String(packet.invoiceId));
      }
    }

    this.addLog(wasBlocked ? 'SECURITY_DROP' : 'CONFLICT_RESOLVED', msg, targetDeviceId || 'Local Hub', this.config.deviceName);
  }

  private async drainQueueToLocalHub() {
    if (!this.localHubAdapter.isConnected()) return;

    if (this.isCloudOnlyMode) {
      this.addLog(
        'SECURITY_DROP',
        `Drain paused: Device is in Cloud-Only Mode. Local sales blocked from syncing to Hub.`,
        this.config.deviceName
      );
      return;
    }

    const currentHubBranch = this.hubBranchId;
    if (!currentHubBranch || currentHubBranch === 'UNASSIGNED') {
      return; // Await identity handshake before flushing
    }

    this.syncLocalHubContext();

    try {
      // 1. Drain pending offline packets via LocalHubAdapter
      const { flushedCount, pausedForeignCount } =
        this.localHubAdapter.drainMatchedPendingPackets(currentHubBranch);

      if (flushedCount > 0) {
        this.addLog(
          'BROADCAST',
          `Local Hub connected (${currentHubBranch}): Flushed ${flushedCount} branch-matched packet(s). (${pausedForeignCount} foreign-branch packet(s) remain paused in queue).`,
          this.config.deviceName
        );
      }

      const singleCloud = this.getOrCreateSingleCloudAdapter();
      if (pausedForeignCount > 0 && !singleCloud.isPaused?.()) {
        singleCloud.drainOfflineQueue().catch(() => {});
      }

      // 2. Scan local database for offline sales matching this Hub's branch
      // Include records that already synced directly to cloud (isCloudSynced: true) while Hub was offline
      // so Hub stores them locally with isCloudSynced: true, skips duplicate cloud push, and ACKs handoff!
      const allSales = getAllSales();
      const unsyncedSales = allSales.filter(
        (s) =>
          s &&
          s.id &&
          !(s as any).fromMesh &&
          !(s as any).syncedToHub &&
          (!s.synced || s.syncStatus !== 'synced' || (s as any).isCloudSynced === true)
      );

      const branchMatchedSales = unsyncedSales.filter((s) => {
        const sBranch = (s.branchId || s.branch_id || '').trim().toUpperCase();
        return !sBranch || sBranch === currentHubBranch.toUpperCase();
      });

      const foreignBranchSales = unsyncedSales.filter((s) => {
        const sBranch = (s.branchId || s.branch_id || '').trim().toUpperCase();
        return sBranch && sBranch !== currentHubBranch.toUpperCase();
      });

      if (branchMatchedSales.length > 0) {
        this.addLog(
          'BROADCAST',
          `Reconnection Catch-Up: Flushing ${branchMatchedSales.length} offline sale(s) matching [${currentHubBranch}] to Local Hub...`,
          this.config.deviceName
        );

        for (const sale of branchMatchedSales) {
          if (!/^INV-/i.test(sale.id) && !sale.synced) {
            this.pendingSaleAcks.set(sale.id, {
              sale,
              sentAt: Date.now(),
              lastRetryAt: Date.now(),
              retries: 0,
            });
          }

          const saleIsCloudSynced = (sale as any).isCloudSynced === true;
          const saleEnvelope: SyncEnvelope = {
            packetId: `OFFLINE-FLUSH-${sale.id}-${Date.now()}`,
            entityType: 'sale',
            entityId: sale.id,
            action: 'APPEND',
            data: saleIsCloudSynced ? { ...sale, isCloudSynced: true } : sale,
            updatedAt: sale.timestamp || Date.now(),
            originDeviceId: this.config.deviceId,
            targetBranchId: currentHubBranch,
            class: 'T1',
            ...(saleIsCloudSynced ? { isCloudSynced: true } : {}),
            meta: {
              wireAction: 'SALE_RECORD',
              isOfflineCatchup: true,
            },
          };

          try {
            await this.localHubAdapter.broadcast(saleEnvelope);
          } catch (err) {
            console.warn('[MeshSync] Error sending offline sale to hub:', err);
          }
        }
      }

      if (foreignBranchSales.length > 0) {
        this.addLog(
          'DISCOVERY',
          `Data Isolation: ${foreignBranchSales.length} offline sale(s) belong to other branches. Paused for Local Hub.`,
          this.config.deviceName
        );
        if (!singleCloud.isPaused?.()) {
          singleCloud.drainOfflineQueue().catch(() => {});
        }
      }

      // 3. Scan for offline Direct GRVs matching this Hub's branch (carrying isCloudSynced flag if already pushed to cloud)
      const allGrvs = getDirectGrvs();
      const offlineGrvs = allGrvs.filter(
        (g) => g && g.grvNumber && !(g as any).fromMesh && !(g as any).syncedToHub
      );
      const branchMatchedGrvs = offlineGrvs.filter((g) => {
        const gBranch = (g.branchId || (g as any).branch_id || '').trim().toUpperCase();
        return !gBranch || gBranch === currentHubBranch.toUpperCase();
      });

      if (branchMatchedGrvs.length > 0) {
        for (const grv of branchMatchedGrvs) {
          const grvCloudSynced = (grv as any).isCloudSynced === true;
          (grv as any).syncedToHub = true;
          const grvEnvelope: SyncEnvelope = {
            packetId: `OFFLINE-GRV-${grv.grvNumber}-${Date.now()}`,
            entityType: 'direct_grv',
            entityId: grv.grvNumber || grv.id,
            action: 'APPEND',
            data: grvCloudSynced ? { ...grv, isCloudSynced: true } : grv,
            updatedAt: grv.createdAt ? new Date(grv.createdAt).getTime() : Date.now(),
            originDeviceId: this.config.deviceId,
            targetBranchId: currentHubBranch,
            class: 'T1',
            ...(grvCloudSynced ? { isCloudSynced: true } : {}),
            meta: { isOfflineCatchup: true },
          };
          try {
            await this.localHubAdapter.broadcast(grvEnvelope);
          } catch (_) {}
        }
      }

      // 3b. Scan for other offline T1 records (Expenses, Cash Logs, Credit Sales, Customer Changes, Cash Lifts)
      // that either haven't synced to Hub yet or were cloud-synced offline and need Dual-Writer handoff
      const flushT1List = async (
        records: any[],
        entityType: string,
        prefix: string,
        getId: (r: any) => string
      ) => {
        for (const rec of records) {
          const recId = getId(rec);
          if (!rec || !recId || rec.fromMesh || rec.fromSync || rec.syncedToHub) continue;
          const rBranch = String(rec.branchId || rec.branch_id || '').trim().toUpperCase();
          if (rBranch && rBranch !== 'ALL' && rBranch !== currentHubBranch.toUpperCase()) continue;
          const recCloudSynced = rec.isCloudSynced === true;
          if (rec.synced && !recCloudSynced) continue;
          rec.syncedToHub = true;
          const env: SyncEnvelope = {
            packetId: `${prefix}-${recId}-${Date.now()}`,
            entityType,
            entityId: recId,
            action: 'APPEND',
            data: recCloudSynced ? { ...rec, isCloudSynced: true } : rec,
            updatedAt: parseTimestampMs(rec.updatedAt || rec.timestamp || rec.createdAt) || Date.now(),
            originDeviceId: this.config.deviceId,
            targetBranchId: currentHubBranch,
            class: 'T1',
            ...(recCloudSynced ? { isCloudSynced: true } : {}),
            meta: { isOfflineCatchup: true },
          };
          try {
            await this.localHubAdapter.broadcast(env);
          } catch (_) {}
        }
      };

      await flushT1List(getRawStoredExpenses(), 'expense', 'OFFLINE-EXP', (e) => String(e?.id || ''));
      await flushT1List(getRawStoredCashLogs(), 'cash_log', 'OFFLINE-CL', (c) => String(c?.id || ''));
      await flushT1List(getRawStoredCreditSales(), 'credit_sale', 'OFFLINE-CR', (c) => String(c?.id || c?.creditId || ''));
      await flushT1List(getRawStoredCustomerChanges(), 'customer_change', 'OFFLINE-CHG', (c) => String(c?.id || c?.changeId || ''));
      await flushT1List(getRawStoredCashLifts(), 'cash_lift', 'OFFLINE-CLIFT', (l) => String(l?.id || l?.liftId || ''));
      for (const tr of getRawStoredCashTransfers()) {
        const tId = String(tr?.transfer_id || (tr as any)?.id || '');
        if (!tId) continue;
        const rBranch = String(tr?.branch_id || '').trim().toUpperCase();
        const rTarget = String(tr?.target_branch_id || '').trim().toUpperCase();
        const isGlobalTr =
          rBranch === 'HQ' ||
          rBranch === 'ALL' ||
          rTarget === 'ALL' ||
          tr?.type === 'HQ_TO_BRANCH' ||
          tr?.type === 'BRANCH_TO_HQ' ||
          tr?.type === 'BANK_DEPOSIT' ||
          tr?.type === 'BANK_WITHDRAWAL' ||
          tr?.type === 'CAPITAL_INFUSION' ||
          tr?.type === 'SUPPLIER_PAYMENT' ||
          tr?.type === 'THIRD_PARTY_PAYOUT';
        if (!isGlobalTr && rBranch && rBranch !== 'ALL' && rBranch !== currentHubBranch.toUpperCase()) continue;
        if ((tr as any).synced && (tr as any).isCloudSynced !== true) continue;
        const env: SyncEnvelope = {
          packetId: `OFFLINE-TRF-${tId}-${Date.now()}`,
          entityType: 'cash_transfer',
          entityId: tId,
          action: tr?.status && tr.status !== 'DRAFT' ? 'UPSERT' : 'APPEND',
          data: { ...tr, target_branch_id: isGlobalTr ? 'ALL' : (tr?.branch_id || currentHubBranch) },
          updatedAt: parseTimestampMs(tr?.updatedAt || tr?.lastUpdated || tr?.created_at) || Date.now(),
          originDeviceId: this.config.deviceId,
          targetBranchId: isGlobalTr ? 'ALL' : (tr?.branch_id || currentHubBranch),
          class: 'T1',
          ...((tr as any)?.isCloudSynced === true ? { isCloudSynced: true } : {}),
          meta: { isOfflineCatchup: true },
        };
        try {
          await this.localHubAdapter.broadcast(env);
        } catch (_) {}
      }

      // 4. Staff Delta Sync on reconnect (replaces Staff Firehose with high-water-mark deltas)
      const lastStaffSync = getLastStaffSync();
      const allStaff = getAllSalespeople();
      console.log('[HWM] Filtering staff. HWM:', lastStaffSync, 'Total records:', allStaff.length);
      const filteredStaff = lastStaffSync === 0
        ? allStaff
        : allStaff.filter((s: any) => parseTimestampMs(s.updatedAt || s.lastUpdated || s.lastActive) > lastStaffSync);

      console.log(`[Staff] Delta sync on reconnect: ${filteredStaff.length} of ${allStaff.length} staff broadcast (since ${new Date(lastStaffSync).toISOString()})`);

      for (const st of filteredStaff) {
        this.broadcastStaff(st);
      }
      if (lastStaffSync > 0) {
        setLastStaffSync(Date.now());
      }

      // 4.1 Branch Delta Sync on reconnect (strictly scoped to current company)
      const lastBranchSync = getLastBranchSync();
      const allBranches = getBranches();
      console.log('[HWM] Filtering branch. HWM:', lastBranchSync, 'Total records:', allBranches.length);
      const filteredBranches = lastBranchSync === 0
        ? allBranches
        : allBranches.filter((b: any) => parseTimestampMs(b.updatedAt || b.lastUpdated || (b as any).updated_at) > lastBranchSync);

      console.log(`[Branch] Delta sync on reconnect: ${filteredBranches.length} of ${allBranches.length} branches broadcast (since ${new Date(lastBranchSync).toISOString()})`);

      for (const br of filteredBranches) {
        this.broadcastBranch(br);
      }
      if (lastBranchSync === 0 && allBranches.length > 0) {
        setLastBranchSync(Date.now());
      }

      // 4.2 Customer Delta Sync on reconnect
      const lastCustomerSync = getLastCustomerSync();
      const allCustomers = getCustomers();
      console.log('[HWM] Filtering customer. HWM:', lastCustomerSync, 'Total records:', allCustomers.length);
      const filteredCustomers = lastCustomerSync === 0
        ? allCustomers
        : allCustomers.filter((c: any) => parseTimestampMs(c.updatedAt || c.lastUpdated || (c as any).updated_at) > lastCustomerSync);

      console.log(`[Customer] Delta sync on reconnect: ${filteredCustomers.length} of ${allCustomers.length} customers broadcast (since ${new Date(lastCustomerSync).toISOString()})`);

      for (const cust of filteredCustomers) {
        this.broadcastCustomer(cust);
      }
      if (lastCustomerSync === 0 && allCustomers.length > 0) {
        setLastCustomerSync(Date.now());
      }

      // 4.3 Cash Account Delta Sync on reconnect
      const lastCashAccountSync = getLastCashAccountSync();
      const allCashAccounts = getAllCashAccounts();
      console.log('[HWM] Filtering cash account. HWM:', lastCashAccountSync, 'Total records:', allCashAccounts.length);
      const filteredCashAccounts = lastCashAccountSync === 0
        ? allCashAccounts
        : allCashAccounts.filter((a: any) => parseTimestampMs(a.updatedAt || a.lastUpdated || (a as any).updated_at) > lastCashAccountSync);

      console.log(`[CashAccount] Delta sync on reconnect: ${filteredCashAccounts.length} of ${allCashAccounts.length} cash accounts broadcast (since ${new Date(lastCashAccountSync).toISOString()})`);

      for (const acc of filteredCashAccounts) {
        this.broadcastCashAccount(acc);
      }
      if (lastCashAccountSync === 0 && allCashAccounts.length > 0) {
        setLastCashAccountSync(Date.now());
      }

      // 4.4 Casual Workers Delta Sync on reconnect
      const lastCasualWorkerSync = getLastCasualWorkerSync();
      const allCasuals = getTemporaryCasuals();
      console.log('[HWM] Filtering casual worker. HWM:', lastCasualWorkerSync, 'Total records:', allCasuals.length);
      const filteredCasuals = lastCasualWorkerSync === 0
        ? allCasuals
        : allCasuals.filter((cw: any) => parseTimestampMs(cw.updatedAt || cw.lastUpdated || (cw as any).updated_at) > lastCasualWorkerSync);

      console.log(`[CasualWorker] Delta sync on reconnect: ${filteredCasuals.length} of ${allCasuals.length} casual workers broadcast (since ${new Date(lastCasualWorkerSync).toISOString()})`);

      if (filteredCasuals.length > 0) {
        this.broadcastCasualWorkers(filteredCasuals);
      }
      if (lastCasualWorkerSync === 0 && allCasuals.length > 0) {
        setLastCasualWorkerSync(Date.now());
      }

      // 4.5 Stocktake Session Delta Sync on reconnect
      const lastStocktakeSync = getLastStocktakeSessionSync();
      const allSessions = getAllStocktakeSessions();
      console.log('[HWM] Filtering stocktake session. HWM:', lastStocktakeSync, 'Total records:', allSessions.length);
      const filteredSessions = lastStocktakeSync === 0
        ? allSessions
        : allSessions.filter((s: any) => parseTimestampMs(s.updatedAt || s.lastUpdated || (s as any).updated_at) > lastStocktakeSync);

      console.log(`[StocktakeSession] Delta sync on reconnect: ${filteredSessions.length} of ${allSessions.length} stocktake sessions broadcast (since ${new Date(lastStocktakeSync).toISOString()})`);

      for (const sess of filteredSessions) {
        this.broadcastStocktakeSession(sess);
      }
      if (lastStocktakeSync === 0 && allSessions.length > 0) {
        setLastStocktakeSessionSync(Date.now());
      }

      // 4.6 Multi-Currency & Exchange Rates Delta Sync on reconnect (never push untouched System Default)
      const lastMultiCurrencySync = getLastMultiCurrencySync();
      const localMcConfig = getMultiCurrencyConfig();
      const localMcTime = getMultiCurrencyUpdatedAt(localMcConfig);
      if (localMcTime > 0 && (lastMultiCurrencySync === 0 || localMcTime > lastMultiCurrencySync)) {
        this.broadcastMultiCurrencyConfig(localMcConfig);
        if (lastMultiCurrencySync > 0) {
          setLastMultiCurrencySync(Date.now());
        }
      }

      // 4.7 Tombstones Delta Sync on reconnect (guarantees offline deletions always reach the Hub)
      const normTombTenant = (c?: string) =>
        !c || c === 'COMP-001' || c === 'COMP-MASTER' || c === 'DEFAULT' ? 'COMP-001' : c.trim().toUpperCase();
      const unsyncedTombstones = getTombstones().filter((t) => {
        if (!t || !t.entityId || !t.entityType) return false;
        if (t.syncedToHub) return false;
        if (t.company_id && this.config.companyId && normTombTenant(t.company_id) !== normTombTenant(this.config.companyId)) {
          return false;
        }
        return true;
      });
      if (unsyncedTombstones.length > 0) {
        console.log(`[TombstoneSync] Flushing ${unsyncedTombstones.length} unsynced local tombstone(s) to Local Hub on reconnect`);
        for (const tomb of unsyncedTombstones) {
          const cleanId = String(tomb.entityId).trim();
          const tombTs = tomb.deletedAt || Date.now();
          void this.localHubAdapter.broadcast({
            packetId: `TOMB-FLUSH-${tomb.entityType}-${cleanId}-${tombTs}`,
            entityType: 'tombstone',
            entityId: cleanId,
            action: 'APPEND',
            data: tomb,
            updatedAt: tombTs,
            originDeviceId: this.config.deviceId,
            targetBranchId: 'ALL',
            class: 'T1',
            meta: {
              topicSuffix: 'tombstone',
              companyId: tomb.company_id || this.config.companyId,
              isReconPush: true,
            },
          });
        }
      }

      // 5. Flush-Before-Pull: Signal DRAIN_COMPLETE_PING to Local Hub
      this.isAwaitingDrainAck = true;
      const pingPacket = {
        type: 'DRAIN_COMPLETE_PING',
        action: 'DRAIN_COMPLETE_PING',
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        branchId: currentHubBranch,
        companyId: this.config.companyId,
        timestamp: Date.now(),
      };
      try {
        this.localHubAdapter.sendControlPacket(pingPacket);
        this.addLog(
          'BROADCAST',
          `Flush-Before-Pull: Offline changes flushed. Awaiting Hub ACK before requesting delta catch-up...`,
          this.config.deviceName
        );
      } catch (_) {}

      // Fallback timer: If Hub does not send DRAIN_COMPLETE_ACK within 2000ms, proceed with catch-up
      if (this.drainAckFallbackTimer) clearTimeout(this.drainAckFallbackTimer);
      this.drainAckFallbackTimer = setTimeout(() => {
        if (this.isAwaitingDrainAck) {
          this.isAwaitingDrainAck = false;
          this.triggerDeltaCatchUpAfterFlush();
        }
      }, 2000);
    } catch (e) {
      console.warn('[MeshSync] Error draining queue to local hub:', e);
    }
  }

  private async triggerDeltaCatchUpAfterFlush() {
    if (this.isLocalHubConnected && !this.isCloudOnlyMode) {
      this.hasPerformedInitialCatchup = true;
      this.lastInitialCatchupTime = Date.now();
      const branchId = this.hubBranchId || 'ALL';
      const lastSync = await this.getLastInventorySyncTimestamp();
      this.addLog(
        'BROADCAST',
        `Flush-Before-Pull Complete: Local Hub acknowledged flush. Requesting Delta Catch-Up for [${branchId}]...`,
        this.config.deviceName
      );
      this.requestCatchUpSync(branchId, lastSync, false, false).catch(() => {});
    }
  }

  private handleSyncAck(packet: any) {
    if (!packet || !packet.id) return;
    const entityType = String(packet.entityType || '').toUpperCase();
    const stampedAt = Number(packet.updatedAt) || Date.now();
    const lastUpdated = packet.lastUpdated || new Date(stampedAt).toISOString();

    if (entityType === 'INVENTORY') {
      const all = getRawStoredInventoryItems();
      const cleanId = String(packet.id).trim().toUpperCase();
      const idx = all.findIndex((i) => (i.itemId || (i as any).id || '').trim().toUpperCase() === cleanId);
      if (idx >= 0) {
        all[idx] = {
          ...all[idx],
          updatedAt: stampedAt,
          hubTimestamp: stampedAt,
          lastUpdated,
        };
        setStored(STORAGE_KEYS.INVENTORY_ITEMS, all);
      }
    } else if (entityType === 'STAFF') {
      const all = getRawStoredSalespeople();
      const idx = all.findIndex((s) => s.id === packet.id);
      if (idx >= 0) {
        all[idx] = {
          ...all[idx],
          updatedAt: stampedAt,
          hubTimestamp: stampedAt,
          lastUpdated,
          isDirty: false,
        };
        setStored(STORAGE_KEYS.SALESPEOPLE, all);
      }
    } else if (entityType === 'CUSTOMER') {
      const all = getRawStoredCustomers();
      const idx = all.findIndex((c) => (c.customerId || (c as any).id) === packet.id);
      if (idx >= 0) {
        all[idx] = {
          ...all[idx],
          updatedAt: stampedAt,
          hubTimestamp: stampedAt,
          lastUpdated,
        };
        setStored(STORAGE_KEYS.CUSTOMERS, all);
      }
    } else if (entityType === 'GRV') {
      const all = getDirectGrvs();
      const idx = all.findIndex((g) => g.grvNumber === packet.id || g.id === packet.id);
      if (idx >= 0) {
        all[idx] = {
          ...all[idx],
          updatedAt: stampedAt,
          hubTimestamp: stampedAt,
          lastUpdated,
        };
        setStored(STORAGE_KEYS.DIRECT_GRVS, all);
      }
    } else if (entityType === 'TOMBSTONE') {
      const ackIds = [packet.id, packet.entityId, packet.recordId].filter(Boolean);
      if (ackIds.length > 0) {
        markTombstonesSyncedToHub(ackIds, packet.targetEntityType);
      }
    }

    // Advance ACK-paced Cold-Hub Hydration smoothly even on Hubs that emit per-record SYNC_ACK
    this.coldHubHydrationQueue.notifyAck({
      entityType: packet.entityType ? String(packet.entityType) : undefined,
    });
  }

  private notifyConnectionModeChange() {
    const details = {
      mode: this.activeConnectionMode,
      isLocalHubConnected: this.isLocalHubConnected,
      isLocalHubLost: this.isLocalHubLost,
      localHubUrl: LocalHubConfig.getLocalHubUrl(),
      forceLocalHub: LocalHubConfig.getForceLocalHub(),
      hubBranchId: this.hubBranchId,
      hubBranchName: this.hubBranchName,
      isCloudOnlyMode: this.isCloudOnlyMode,
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

  // =========================================================================
  // AUTOMATED RECONCILIATION & AUTO-HEAL ENGINE (PHASE 3)
  // =========================================================================

  public configurePackageAwareAutoHeal(): void {
    if (this.autoHealIntervalTimer !== null) {
      clearInterval(this.autoHealIntervalTimer);
      this.autoHealIntervalTimer = null;
    }

    const mode = getPackageSyncMode();
    console.log(`[Package Routing] 📦 Configuring Auto-Heal for mode: ${mode}`);

    if (mode === 'CLOUD_ONLY_SUPABASE') {
      // Constraint 1: Disable 30-min auto-heal interval entirely. Rely on Supabase native delta pulls.
      console.log('[Package Routing] ⚡ CLOUD_ONLY_SUPABASE: 30-min auto-heal sweep disabled. Native delta pulls active.');
      return;
    }

    if (mode === 'CLOUD_ONLY_APPSCRIPTS') {
      // Constraint 2: Throttle to every 4 hours to prevent Google API rate limits.
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
      console.log('[Package Routing] ⏳ CLOUD_ONLY_APPSCRIPTS: Auto-heal throttled to every 4 hours.');
      this.autoHealIntervalTimer = window.setInterval(() => {
        this.runClientAutoHealSweep();
      }, FOUR_HOURS_MS);
      return;
    }

    // Constraint 3: HUB_ONLY or HUB_CLOUD allows fast 30-minute interval against Local Hub ONLY.
    const THIRTY_MINS_MS = 30 * 60 * 1000;
    console.log(`[Package Routing] 🚀 ${mode}: Fast 30-minute auto-heal enabled against Local Hub.`);
    this.autoHealIntervalTimer = window.setInterval(() => {
      this.runClientAutoHealSweep();
    }, THIRTY_MINS_MS);
  }

  public runClientAutoHealSweep(): void {
    const mode = getPackageSyncMode();
    if (mode === 'CLOUD_ONLY_SUPABASE') return;

    // POS Busy Check: If cart is active in checkout, defer sweep by 60s
    if (isPosActiveCheckout()) {
      console.log('[Auto-Heal] 🛒 POS active checkout. Deferring scheduled auto-heal sweep by 60s.');
      setTimeout(() => this.runClientAutoHealSweep(), 60000);
      return;
    }

    if (mode === 'HUB_ONLY' || mode === 'HUB_CLOUD') {
      // CRITICAL: Must ONLY run snapshot sweep against Local Hub.
      if (!this.localHubAdapter.isConnected()) {
        console.log('[Auto-Heal] Local Hub not connected. Deferring Hub sweep.');
        return;
      }
      const sweepId = `client-sweep-${Date.now()}`;
      const trigger = {
        type: 'RECON_SWEEP_TRIGGER',
        action: 'RECON_SWEEP_TRIGGER',
        sweepId,
        targetEntities: [
          'sales',
          'customer_changes',
          'credit_sales',
          'cash_logs',
          'stock_movements',
          'direct_grvs',
          'expenses',
          'inventory',
          'customers',
          'suppliers',
          'staff',
          'branches',
        ],
        hubTimestamp: Date.now(),
        originDeviceId: this.config.deviceId,
      };
      try {
        this.localHubAdapter.sendControlPacket(trigger);
        console.log(`[Auto-Heal] 🧹 Dispatched snapshot sweep trigger (${sweepId}) to Local Hub.`);
      } catch (err: any) {
        console.warn('[Auto-Heal] Error dispatching sweep trigger to Local Hub:', err?.message);
      }
    } else if (mode === 'CLOUD_ONLY_APPSCRIPTS' || mode === 'CLOUD_ONLY_SUPABASE') {
      const cloudAdapter = this.getOrCreateSingleCloudAdapter();
      if (cloudAdapter.isPaused?.()) return;
      console.log(`[Auto-Heal] ☁️ Running 4-hour throttled Cloud sweep for ${getActiveCloudConfig().databaseType}.`);
      cloudAdapter.drainOfflineQueue().catch(() => {});
    }
  }

  public handleReconSweepTrigger(packet: any): void {
    const sweepCfg = this.coldHubHydrationQueue.registerSweep({
      sweepId: packet?.sweepId,
      isColdHub: Boolean(packet?.isColdHub ?? packet?.is_cold_hub),
      pushChunkSize: packet?.pushChunkSize ?? packet?.push_chunk_size,
      targetEntities: Array.isArray(packet?.targetEntities) ? packet.targetEntities : undefined,
    });

    if (sweepCfg.isColdHub) {
      this.activeHubIsColdHub = true;
      this.emitHubSecurityEvent();
    }

    const sweepId = sweepCfg.sweepId;
    const targetEntities: string[] =
      sweepCfg.targetEntities.length > 0
        ? sweepCfg.targetEntities
        : [...DEFAULT_COLD_HUB_ENTITY_ORDER];

    if (isPosActiveCheckout()) {
      console.log(`[Recon Sweep] 🛒 POS terminal is active in checkout. Deferring sweep (${sweepId}) by 60s.`);
      setTimeout(() => {
        this.handleReconSweepTrigger(packet);
      }, 60000);
      return;
    }

    console.log(
      `[Recon Sweep] 🚀 Processing ${sweepCfg.isColdHub ? 'COLD-HUB ' : ''}snapshot sweep (${sweepId}) for ${targetEntities.length} entities (chunkSize=${sweepCfg.pushChunkSize})...`
    );

    // Yield between each entity snapshot so cold-hub 13-entity sweeps NEVER block the UI or checkout thread
    void (async () => {
      for (const ent of targetEntities) {
        if (!this.isLocalHubConnected || !this.localHubAdapter.isReadyForSync()) {
          return;
        }
        // Pause gracefully if cashier opens checkout mid-sweep
        while (isPosActiveCheckout()) {
          await new Promise((r) => setTimeout(r, 1500));
          if (!this.isLocalHubConnected || !this.localHubAdapter.isReadyForSync()) {
            return;
          }
        }
        try {
          const snapshot = generateEntitySnapshot(ent, packet.dateRange?.start, packet.dateRange?.end);
          const snapPacket = {
            type: 'SYNC_SNAPSHOT_RESPONSE',
            action: 'SYNC_SNAPSHOT_RESPONSE',
            sweepId,
            entityType: ent,
            isColdHub: sweepCfg.isColdHub,
            snapshot,
            deviceId: this.config.deviceId,
            timestamp: Date.now(),
          };
          this.localHubAdapter.sendControlPacket(snapPacket);
        } catch (err: any) {
          console.warn(`[Recon Sweep] Error generating snapshot for ${ent}:`, err?.message);
        }
        await yieldToMainThread(sweepCfg.isColdHub ? 25 : 10);
      }
    })();
  }

  public handleSyncSnapshotRequest(packet: any): void {
    const sweepId = packet.sweepId || `sweep-${Date.now()}`;
    const entity = packet.entityType;
    if (!entity) return;

    if (isPosActiveCheckout()) {
      console.log(`[Recon Sweep] 🛒 POS active checkout. Deferring snapshot request for ${entity} by 60s.`);
      setTimeout(() => this.handleSyncSnapshotRequest(packet), 60000);
      return;
    }

    try {
      const snapshot = generateEntitySnapshot(entity, packet.startDate, packet.endDate);
      const snapPacket = {
        type: 'SYNC_SNAPSHOT_RESPONSE',
        action: 'SYNC_SNAPSHOT_RESPONSE',
        sweepId,
        entityType: entity,
        snapshot,
        deviceId: this.config.deviceId,
        timestamp: Date.now(),
      };
      this.localHubAdapter.sendControlPacket(snapPacket);
    } catch (err: any) {
      console.warn(`[Recon Sweep] Error responding to snapshot request for ${entity}:`, err?.message);
    }
  }

  public handleSyncIdDigestRequest(packet: any): void {
    const sweepId = packet.sweepId || `sweep-${Date.now()}`;
    const entity = packet.entityType;
    if (!entity) return;

    if (isPosActiveCheckout()) {
      console.log(`[Recon Sweep] 🛒 POS active checkout. Deferring ID digest request for ${entity} by 60s.`);
      setTimeout(() => this.handleSyncIdDigestRequest(packet), 60000);
      return;
    }

    try {
      const normEntity = String(entity).toLowerCase().trim();
      if (normEntity === 'customer_changes' || normEntity === 'credit_sales') {
        try {
          healCustomerNamesAndChangeCreditLedgers();
        } catch {}
      }

      const digest = getTransactionsDigest(entity, packet.startDate, packet.endDate);
      const responsePacket = {
        type: 'SYNC_ID_DIGEST_RESPONSE',
        action: 'SYNC_ID_DIGEST_RESPONSE',
        sweepId,
        entityType: entity,
        digest,
        deviceId: this.config.deviceId,
        timestamp: Date.now(),
      };

      if (this.localHubAdapter.sendControlPacket(responsePacket)) {
        console.log(`[Recon Sweep] 📤 Sent granular ID digest for "${entity}" (${digest.count} items) to Hub`);
      }

      // APK-Compatible Recovery: Older Android Hub APKs only compare IDs in Phase 2 (missing
      // colliding sequential Change/Credit IDs and Refunded/Voided sale status diffs).
      // When Phase 1 snapshot totals already flagged a variance for these entities, proactively
      // run throttled PWA-side reconciliation so totals converge $1-for-$1 without an APK rebuild.
      const nowMs = Date.now();
      if (normEntity === 'customer_changes' || normEntity === 'credit_sales') {
        const pullKey = `recon:cc-full-catchup`;
        const lastPull = this.reconPushedTimestamps.get(pullKey) || 0;
        if (nowMs - lastPull > 5 * 60 * 1000) {
          this.reconPushedTimestamps.set(pullKey, nowMs);
          setTimeout(() => {
            void this.requestCatchUpSync(undefined, '1970-01-01T00:00:00.000Z', false, true).catch(() => {});
          }, 1500);
        }
      } else if (normEntity === 'sales') {
        const cutoffMs = nowMs - 14 * 24 * 3600 * 1000;
        const refundedOrVoided = getAllSales().filter((s) => {
          if (s.status !== 'Refunded' && s.status !== 'Voided') return false;
          const ts = extractRecordTimestamp(s);
          return ts >= cutoffMs;
        });
        for (const s of refundedOrVoided) {
          const rKey = `recon:sale-status:${String(s.id || '').trim().toUpperCase()}:${s.status}`;
          const lastPush = this.reconPushedTimestamps.get(rKey) || 0;
          if (nowMs - lastPush > 5 * 60 * 1000) {
            this.reconPushedTimestamps.set(rKey, nowMs);
            void this.broadcastSaleUpdate(s).catch(() => {});
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Recon Sweep] Error responding to ID digest request for ${entity}:`, err?.message);
    }
  }

  public handleIncomingReconBackfill(packet: any): void {
    if (!packet) return;
    const sweepId = packet.sweepId || 'unknown';
    const entityType = String(packet.entityType || '').toLowerCase().trim();
    const records = packet.records;
    if (!Array.isArray(records) || records.length === 0) return;

    if (isPosActiveCheckout()) {
      console.log(`[Auto-Heal] 🛒 POS active checkout. Deferring backfill ingestion (${records.length} records) by 60s.`);
      setTimeout(() => {
        this.handleIncomingReconBackfill(packet);
      }, 60000);
      return;
    }

    const canonMap: Record<string, string> = {
      sales: 'sale',
      sale: 'sale',
      customer_changes: 'customer_change',
      customer_change: 'customer_change',
      credit_sales: 'credit_sale',
      credit_sale: 'credit_sale',
      cash_logs: 'cash_log',
      cash_log: 'cash_log',
      stock_movements: 'stock_movement',
      stock_movement: 'stock_movement',
      direct_grvs: 'direct_grv',
      direct_grv: 'direct_grv',
      grv: 'direct_grv',
      expenses: 'expense',
      expense: 'expense',
      inventory: 'inventory_item',
      inventory_item: 'inventory_item',
      products: 'inventory_item',
      customers: 'customer',
      customer: 'customer',
      staff: 'staff',
      salespeople: 'staff',
      users: 'staff',
      branches: 'branch',
      branch: 'branch',
      cash_accounts: 'cash_account',
      cash_account: 'cash_account',
      tombstones: 'tombstone',
      tombstone: 'tombstone',
    };
    const canonEntity = canonMap[entityType];
    if (!canonEntity || !ENTITY_REGISTRY[canonEntity]) return;
    const spec = ENTITY_REGISTRY[canonEntity];

    console.log(`[Auto-Heal] 📥 Ingesting backfill for "${canonEntity}" via SyncCore: chunk ${packet.chunkIndex ?? 0}/${packet.totalChunks ?? 1} (${records.length} records, sweep: ${sweepId})`);

    const CHUNK_SIZE = 25;
    const totalBatches = Math.ceil(records.length / CHUNK_SIZE);
    let currentBatch = 0;

    const processNextBatch = async () => {
      if (currentBatch >= totalBatches) {
        this.dispatchSilentReconUiEvent(entityType);
        return;
      }

      const start = currentBatch * CHUNK_SIZE;
      const batchRecords = records.slice(start, start + CHUNK_SIZE);

      for (let idx = 0; idx < batchRecords.length; idx++) {
        const rec = batchRecords[idx];
        if (!rec || typeof rec !== 'object') continue;
        const recId = String(
          rec.id ||
            rec.itemId ||
            rec.branchId ||
            rec.branch_id ||
            rec.BranchID ||
            rec.customerId ||
            rec.grvNumber ||
            rec.changeId ||
            rec.creditId ||
            rec.movementId ||
            rec.txnId ||
            `${canonEntity}-${start + idx}`
        );
        const recTs =
          extractRecordTimestamp(rec) ||
          parseTimestampMs(rec.hubTimestamp ?? rec.updatedAt ?? rec.timestamp);
        const envelope: SyncEnvelope = {
          packetId: `RECON-${sweepId}-${canonEntity}-${recId}-${recTs}-${start + idx}`,
          entityType: canonEntity,
          entityId: recId,
          action: spec.appendOnly ? 'APPEND' : 'UPSERT',
          data: rec,
          updatedAt: recTs,
          hubTimestamp: parseTimestampMs(rec.hubTimestamp ?? rec.updatedAt) || undefined,
          originDeviceId: 'LOCAL_HUB_RECON',
          targetBranchId: rec.branch_id || rec.branchId || this.config.branchId,
          class: spec.class,
        };
        await this.ingestEnvelopeThroughSyncCore(envelope, 'Local Hub Recon', {
          isReconBackfill: true,
        });
      }

      currentBatch++;
      if (currentBatch < totalBatches) {
        setTimeout(() => {
          void processNextBatch();
        }, 15);
      } else {
        this.dispatchSilentReconUiEvent(entityType);
      }
    };

    void processNextBatch();
  }

  private dispatchSilentReconUiEvent(entityType: string): void {
    if (typeof window === 'undefined') return;
    const norm = entityType.toLowerCase().trim();
    if (norm === 'sales' || norm === 'sale') {
      window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
    } else if (norm === 'customer_changes' || norm === 'customer_change') {
      window.dispatchEvent(new CustomEvent('saimetric_customer_changes_updated'));
    } else if (norm === 'credit_sales' || norm === 'credit_sale') {
      window.dispatchEvent(new CustomEvent('saimetric_credit_sales_updated'));
    } else if (norm === 'cash_logs' || norm === 'cash_log') {
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
    } else if (norm === 'direct_grvs' || norm === 'direct_grv' || norm === 'grv') {
      window.dispatchEvent(new CustomEvent('saimetric_direct_grvs_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
    } else if (norm === 'stock_movements' || norm === 'inventory') {
      window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
    } else if (norm === 'expenses' || norm === 'expense') {
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
    } else if (norm === 'customers' || norm === 'customer') {
      window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
    } else if (norm === 'staff' || norm === 'salespeople' || norm === 'users') {
      window.dispatchEvent(new CustomEvent('saimetric_staff_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_salespeople_updated'));
    } else if (norm === 'branches' || norm === 'branch') {
      window.dispatchEvent(new CustomEvent('saimetric_branches_updated'));
    }
  }

  public handleHubCloudBroadcast(packet: any): void {
    if (!packet) return;
    if (Array.isArray(packet.envelopes) && packet.envelopes.length > 0) {
      console.log(`[Auto-Heal] ☁️ Hub broadcasted ${packet.envelopes.length} canonical cloud envelope(s) to this terminal.`);
      (async () => {
        for (const rawEnv of packet.envelopes) {
          if (!rawEnv || !rawEnv.entityType) continue;
          const eType = String(rawEnv.entityType).trim().toLowerCase() as any;
          const spec = ENTITY_REGISTRY[eType as keyof typeof ENTITY_REGISTRY];
          const env: SyncEnvelope = {
            packetId: rawEnv.packetId || `HUB-CLOUD-${eType}-${rawEnv.entityId}-${Date.now()}`,
            entityType: eType,
            entityId: String(rawEnv.entityId || ''),
            action: rawEnv.action === 'DELETE' ? 'DELETE' : 'UPSERT',
            data: rawEnv.data,
            updatedAt: Number(rawEnv.updatedAt || Date.now()),
            version: Number(rawEnv.version || 1),
            mutationSource: rawEnv.mutationSource || 'HUB_CLOUD_CATCHUP',
            originDeviceId: rawEnv.originDeviceId || 'LOCAL_HUB_CLOUD',
            targetBranchId: rawEnv.targetBranchId || this.config.branchId || 'ALL',
            class: spec ? spec.class : (rawEnv.class === 'T2' ? 'T2' : 'T1'),
            isCloudSynced: true,
          };
          await this.ingestEnvelopeThroughSyncCore(env, 'HUB_CLOUD', { isReconBackfill: true });
        }
      })().catch(() => {});
      return;
    }
    if (!Array.isArray(packet.records)) return;
    console.log(`[Auto-Heal] ☁️ Hub broadcasted ${packet.records.length} upstream cloud record(s) to this terminal.`);
    this.handleIncomingReconBackfill({
      sweepId: `cloud-broadcast-${Date.now()}`,
      entityType: packet.entityType || 'sales',
      records: packet.records,
      chunkIndex: 0,
      totalChunks: 1,
    });
  }

  public async handleReconPushBackfillRequest(packet: any): Promise<void> {
    if (!packet) return;
    const sweepId = String(packet.sweepId || `sweep-${Date.now()}`).trim();
    const entityType = String(packet.entityType || packet.entity || 'sales').toLowerCase().trim();
    const missingIds: string[] = Array.isArray(packet.missingIds)
      ? packet.missingIds
      : Array.isArray(packet.ids)
      ? packet.ids
      : [];
    if (missingIds.length === 0) return;

    const now = Date.now();
    // Prune loop-guard entries older than 60s
    for (const [key, ts] of Array.from(this.reconPushedTimestamps.entries())) {
      if (now - ts > 60000) {
        this.reconPushedTimestamps.delete(key);
      }
    }

    const sweepCfg = this.coldHubHydrationQueue.getSweepConfig(sweepId);
    const isColdHub = Boolean(packet.isColdHub ?? packet.is_cold_hub ?? sweepCfg?.isColdHub ?? false);
    const pushChunkSize = packet.pushChunkSize ?? packet.push_chunk_size ?? sweepCfg?.pushChunkSize ?? 25;

    console.log(
      `[Auto-Heal] 📤 Queuing ${missingIds.length} missing "${entityType}" record(s) for chunked ACK-paced push (sweep: ${sweepId}, coldHub=${isColdHub}, chunkSize=${pushChunkSize})`
    );

    // Delegate strictly to ColdHubHydrationQueue (entity-ordered, chunked, checkout-pausing, ACK-paced)
    this.coldHubHydrationQueue.enqueuePushJob({
      sweepId,
      entityType,
      missingIds,
      pushChunkSize: Number(pushChunkSize),
      isColdHub,
    });
  }

  private async pushSingleReconRecord(
    rawEntityType: string,
    rawId: string,
    sweepId: string,
    isColdHub: boolean
  ): Promise<boolean> {
    if (!rawId) return false;
    const entityType = String(rawEntityType || '').toLowerCase().trim();
    const cleanId = String(rawId).trim();
    const cleanUpper = cleanId.toUpperCase();
    // Scope cooldown by activeHubId + sweepId during Cold-Hub hydration so a newly started
    // Backup/Till Hub immediately receives records even if Primary Hub was just synced seconds ago.
    const dedupeKey = isColdHub
      ? `${this.activeHubId || 'HUB'}:${sweepId}:${entityType}:${cleanUpper}`
      : `${this.activeHubId || 'HUB'}:${entityType}:${cleanUpper}`;

    const lastPushed = this.reconPushedTimestamps.get(dedupeKey);
    if (lastPushed && Date.now() - lastPushed < 60000) {
      return false;
    }

    if (entityType === 'tombstones' || entityType === 'tombstone') {
      const rec = getTombstones().find(
        (t: any) => String(t.entityId || t.id || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        await this.dispatchEnvelope('tombstone', String(rec.entityId || cleanId), rec, {
          action: 'DELETE',
          topicSuffix: 'tombstone',
          packetId: `TMB-RECON-${cleanId}-${Date.now()}`,
          targetBranchId: 'ALL',
          meta: { isReconPush: true },
        });
        return true;
      }
      return false;
    }

    if (entityType === 'cash_accounts' || entityType === 'cash_account') {
      const rec = getRawStoredCashAccounts().find(
        (a: any) => String(a.account_id || a.id || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        await this.dispatchEnvelope('cash_account', String(rec.account_id || cleanId), cleanRec, {
          action: 'UPSERT',
          topicSuffix: 'cash_account',
          packetId: `CA-RECON-${cleanId}-${Date.now()}`,
          targetBranchId: cleanRec.branch_id || this.config.branchId,
          meta: { isReconPush: true },
        });
        return true;
      }
      return false;
    }

    if (entityType === 'sales' || entityType === 'sale') {
      const sale = getSaleById(cleanId);
      if (sale) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const payloadSale: SaleInvoice = {
          ...sale,
          ...(typeof (sale as any).isCloudSynced === 'boolean'
            ? { isCloudSynced: (sale as any).isCloudSynced }
            : (sale as any).synced
            ? { isCloudSynced: true }
            : {}),
        };
        if (sale.status === 'Refunded' || sale.status === 'Voided' || sale.mobileVerificationStatus) {
          await this.broadcastSaleUpdate(payloadSale);
        } else {
          await this.broadcastSale(payloadSale, { isReconPush: true });
        }
        return true;
      }
      return false;
    }

    if (entityType === 'customer_changes' || entityType === 'customer_change') {
      const rec = getRawStoredCustomerChanges().find((c) =>
        [c.id, (c as any).changeId].some(
          (val) => val != null && String(val).trim().toUpperCase() === cleanUpper
        )
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        this.broadcastCustomerChange(cleanRec, { isReconPush: true });
        return true;
      }
      return false;
    }

    if (entityType === 'credit_sales' || entityType === 'credit_sale') {
      const rec = getRawStoredCreditSales().find((c) =>
        [c.id, (c as any).creditId, (c as any).creditSaleId].some(
          (val) => val != null && String(val).trim().toUpperCase() === cleanUpper
        )
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        this.broadcastCreditSale(cleanRec, { isReconPush: true });
        return true;
      }
      return false;
    }

    if (entityType === 'cash_logs' || entityType === 'cash_log') {
      const rec = getRawStoredCashLogs().find(
        (c) => String(c.id || `${c.date}_${c.timestamp}` || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        await this.dispatchEnvelope('cash_log', cleanId, cleanRec, {
          action: 'APPEND',
          topicSuffix: 'cash_log',
          packetId: `CL-RECON-${cleanId}-${Date.now()}`,
          meta: { isReconPush: true },
        });
        return true;
      }
      return false;
    }

    if (entityType === 'stock_movements' || entityType === 'stock_movement') {
      const allMoves = getRawStoredStockMovements();
      const rec = allMoves.find(
        (m: any) => String(m.id || m.txnId || m.movementId || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        const recId = String((rec as any).id || rec.movementId || rec.txnId || cleanId).trim();
        const baseId = stripStockMovementDupSuffix(recId);
        // Never push back an echo -dup- clone if the canonical base record exists for the same item
        if (
          recId !== baseId &&
          allMoves.some((other: any) => {
            const oId = String(other.id || other.movementId || other.txnId || '').trim();
            return (
              stripStockMovementDupSuffix(oId) === baseId &&
              String(other.itemId || '').trim() === String(rec.itemId || '').trim()
            );
          })
        ) {
          return false;
        }
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = {
          ...rec,
          id: recId,
          movementId: rec.movementId || recId,
          txnId: rec.txnId || recId,
        };
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        await this.dispatchEnvelope('stock_movement', recId, cleanRec, {
          action: 'APPEND',
          topicSuffix: 'stock_movement',
          packetId: `SM-RECON-${recId}-${Date.now()}`,
          meta: { isReconPush: true },
        });
        return true;
      }
      return false;
    }

    if (entityType === 'direct_grvs' || entityType === 'direct_grv' || entityType === 'grv') {
      const rec = getRawStoredDirectGrvs().find(
        (g: any) => String(g.id || g.grvId || g.grvNumber || g.reference || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        const grvStatusUpper = String(cleanRec.status || '').toUpperCase();
        await this.dispatchEnvelope('direct_grv', cleanId, cleanRec, {
          action: grvStatusUpper && grvStatusUpper !== 'PENDING' ? 'UPSERT' : 'APPEND',
          topicSuffix: 'direct_grv',
          packetId: `GRV-RECON-${cleanId}-${Date.now()}`,
          meta: { isReconPush: true },
        });
        return true;
      }
      return false;
    }

    if (entityType === 'expenses' || entityType === 'expense') {
      const rec = getRawStoredExpenses().find(
        (e) => String(e.id || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        const expStatusLower = String(cleanRec.status || '').toLowerCase();
        await this.dispatchEnvelope('expense', cleanId, cleanRec, {
          action:
            expStatusLower && expStatusLower !== 'pending' && expStatusLower !== 'pending_supervisor'
              ? 'UPSERT'
              : 'APPEND',
          topicSuffix: 'expense',
          packetId: `EXP-RECON-${cleanId}-${Date.now()}`,
          meta: { isReconPush: true },
        });
        return true;
      }
      return false;
    }

    if (entityType === 'inventory' || entityType === 'inventory_item' || entityType === 'products') {
      const rec = getRawStoredInventoryItems().find(
        (it) => String(it.itemId || (it as any).id || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        this.broadcastInventoryItem(cleanRec, extractRecordTimestamp(cleanRec) || Date.now(), {
          isReconPush: true,
        });
        return true;
      }
      return false;
    }

    if (entityType === 'customers' || entityType === 'customer') {
      const rec = getRawStoredCustomers().find((c) =>
        [c.customerId, (c as any).id].some(
          (val) => val != null && String(val).trim().toUpperCase() === cleanUpper
        )
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        this.broadcastCustomer(cleanRec, { isReconPush: true });
        return true;
      }
      return false;
    }

    if (entityType === 'suppliers' || entityType === 'supplier') {
      const rec = getRawStoredSuppliers().find((s) =>
        [s.supplierId, (s as any).id].some(
          (val) => val != null && String(val).trim().toUpperCase() === cleanUpper
        )
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        this.broadcastSupplier(cleanRec, { isReconPush: true });
        return true;
      }
      return false;
    }

    if (entityType === 'staff' || entityType === 'salespeople' || entityType === 'users') {
      const rec = getRawStoredSalespeople().find(
        (s) => String(s.id || '').trim().toUpperCase() === cleanUpper
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        this.broadcastStaff(cleanRec, { isReconPush: true });
        return true;
      }
      return false;
    }

    if (entityType === 'branches' || entityType === 'branch') {
      const normCanon = (raw?: string) => {
        const c = String(raw || '').trim().toUpperCase();
        return c === '1' || c === 'BR001' || c === 'BR-MAIN' ? 'BR-MAIN' : c;
      };
      const targetCanon = normCanon(cleanUpper);
      const rec = getBranches().find(
        (b: any) => normCanon(b.branchId || b.id || b.branch_id) === targetCanon
      );
      if (rec) {
        this.reconPushedTimestamps.set(dedupeKey, Date.now());
        const cleanRec: any = { ...rec };
        delete cleanRec.fromMesh;
        delete cleanRec.fromSync;
        if (cleanRec.isCloudSynced || cleanRec.synced) cleanRec.isCloudSynced = true;
        this.broadcastBranch(cleanRec, { isReconPush: true });
        return true;
      }
      return false;
    }

    return false;
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

  private localGatewayBackoffUntil: number = 0;
  private localGatewayFailureCount: number = 0;
  private sseConsecutiveErrors: number = 0;
  private sseRetryTimer: number | null = null;

  private startLocalGatewayPolling() {
    if (this.localGatewayPollTimer) {
      clearInterval(this.localGatewayPollTimer);
    }
    const gateway = this.localGatewayUrl ? this.localGatewayUrl.replace(/\/+$/, '') : '';
    const isSameOriginRemote =
      !gateway &&
      typeof window !== 'undefined' &&
      !['localhost', '127.0.0.1'].includes(window.location.hostname) &&
      !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname);

    // Use a gentle interval on remote/hosted previews to avoid tripping proxy rate limits
    const pollIntervalMs = isSameOriginRemote ? 15000 : 5000;

    this.localGatewayPollTimer = window.setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (Date.now() < this.localGatewayBackoffUntil) return;
      // Offline-First & Local Hub Priority: never waste HTTP connections polling /api/mesh/*
      // when connected directly to the Termux Local Hub or when offline.
      if (this.isLocalHubConnected && !this.isCloudOnlyMode) return;
      if (isOfflineModeForced() || (typeof navigator !== 'undefined' && !navigator.onLine)) return;

      const tripBackoff = (status: number) => {
        this.localGatewayFailureCount = Math.min(this.localGatewayFailureCount + 1, 6);
        const delayMs =
          status === 429
            ? Math.min(300000, 30000 * Math.pow(2, this.localGatewayFailureCount - 1))
            : status === 404
            ? 300000
            : Math.min(120000, 10000 * Math.pow(2, this.localGatewayFailureCount - 1));
        this.localGatewayBackoffUntil = Date.now() + delayMs;
      };

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
        if (res.status === 429 || res.status === 404 || res.status >= 500) {
          tripBackoff(res.status);
          return;
        }
        const hbType = res.headers.get('content-type') || '';
        if (res.ok && hbType.includes('application/json')) {
          this.localGatewayFailureCount = 0;
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
        } else if (res.ok && !hbType.includes('application/json')) {
          // Static SPA host returned index.html — stop polling /api/mesh/*
          tripBackoff(404);
          return;
        }

        // Skip redundant HTTP polling if the live SSE stream is already connected
        if (this.serverEventSource && this.serverEventSource.readyState === EventSource.OPEN) {
          return;
        }

        // 2. Poll new packets from central server buffer (scoped by tenant and branch)
        const pollRes = await fetch(
          `${gateway}/api/mesh/poll?branchCode=${encodeURIComponent(
            this.config.branchCode
          )}&branchId=${encodeURIComponent(this.config.branchId)}&company_id=${encodeURIComponent(
            this.config.companyId
          )}&since=${this.lastMeshPollTimestamp}&deviceId=${encodeURIComponent(this.config.deviceId)}`
        );
        if (pollRes.status === 429 || pollRes.status === 404 || pollRes.status >= 500) {
          tripBackoff(pollRes.status);
          return;
        }
        const pollType = pollRes.headers.get('content-type') || '';
        if (pollRes.ok && pollType.includes('application/json')) {
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
      } catch (e) {
        tripBackoff(0);
      }
    }, pollIntervalMs);
  }

  // =========================================================================
  // TRANSPORT 0: INTEGRATED REAL-TIME SSE STREAM & CENTRAL RELAY (Zero-Config)
  // =========================================================================
  private initServerStream() {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    if (this.sseRetryTimer) {
      clearTimeout(this.sseRetryTimer);
      this.sseRetryTimer = null;
    }
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
        this.sseConsecutiveErrors = 0;
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
            this.sseConsecutiveErrors = 0;
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
        this.sseConsecutiveErrors += 1;
        // Stop native EventSource 3-second reconnect storm on 429/404 hosts
        if (this.sseConsecutiveErrors >= 2) {
          try {
            es.close();
          } catch {}
          if (this.serverEventSource === es) {
            this.serverEventSource = null;
          }
          const retryDelayMs = Math.min(300000, 60000 * this.sseConsecutiveErrors);
          this.sseRetryTimer = window.setTimeout(() => {
            if (typeof document === 'undefined' || !document.hidden) {
              this.initServerStream();
            }
          }, retryDelayMs);
        }
      };
    } catch (err) {
      console.warn('[MeshSync] Server stream init error:', err);
    }
  }

  // =========================================================================
  // TRANSPORT 1: REAL-TIME MQTT OVER WEBSOCKET RELAY (Bypasses router isolation)
  // =========================================================================
  private async initMqttRelay() {
    if (typeof window === 'undefined') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
      } catch (e) {}
    }

    const brokerUrl = PUBLIC_MQTT_BROKERS[this.currentBrokerIndex];
    this.brokerName = brokerUrl.includes('emqx') ? 'EMQX Public Mesh Relay' : 'HiveMQ Public Mesh Relay';

    try {
      const mqttMod = await import('mqtt');
      const mqttLib = mqttMod.default || (mqttMod as any);
      const clientId = `saimetric_${this.config.deviceId}_${Math.random().toString(36).substring(2, 7)}`;
      const client: MqttClient = mqttLib.connect(brokerUrl, {
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
  private snapshotHeartbeatTimer: number | null = null;

  private startHeartbeatLoop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.sendHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat();
    }, 18000);

    // 10-Minute Authoritative T2 Inventory Snapshot Heartbeat from Local Hub
    if (this.snapshotHeartbeatTimer) clearInterval(this.snapshotHeartbeatTimer);
    this.snapshotHeartbeatTimer = window.setInterval(() => {
      if (this.isLocalHubActive()) {
        this.requestInventorySnapshot();
      }
    }, 10 * 60 * 1000);
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
      if (changed && !this.virtualMeshSimulator.isSimulationActive()) {
        this.notifyPeerSubscribers();
      }
    }, 15000);
  }

  private sendHeartbeat() {
    const isMobile = typeof navigator !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTablet = typeof navigator !== 'undefined' && /iPad|tablet|(android(?!.*mobile))/i.test(navigator.userAgent);
    const deviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';
    const hasInternet = typeof navigator !== 'undefined' ? navigator.onLine : true;

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
      hasInternet,
      isCloudRelayLeader: this.isCloudRelayLeader(),
      timestamp: Date.now(),
      salesCount: getSales().length,
      pendingCount: getSyncQueue().length,
    };

    this.mirrorToSecondaryP2PTransports('heartbeat', heartbeatPacket);
  }

  // =========================================================================
  // HEXAGONAL SYNC CORE DISPATCH & SECONDARY P2P MIRROR
  // =========================================================================
  private mirrorToSecondaryP2PTransports(topicSuffix: string, packet: any) {
    if (this.isIngestingFromHub && !packet?.isReconPush) {
      return;
    }

    const jsonStr = JSON.stringify(packet);

    // 0. WebRTC DataChannel (Direct Local Wi-Fi / Hotspot)
    if (this.webrtcDataChannel && this.webrtcDataChannel.readyState === 'open') {
      try {
        this.webrtcDataChannel.send(jsonStr);
      } catch (e) {}
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
        packet_id: packet.packet_id || packet.packetId || `PKT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
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

  /**
   * Canonical outbound entrypoint: builds a SyncEnvelope, enforces the Hexagonal
   * Adapter switch (LocalHubAdapter vs AppScriptsAdapter), routes through
   * SyncCore.saveAndSync(), and mirrors to secondary P2P transports.
   */
  private async dispatchEnvelope(
    entityType: string,
    entityId: string,
    data: any,
    opts?: {
      action?: SyncAction;
      targetBranchId?: string;
      updatedAt?: number;
      packetId?: string;
      topicSuffix?: string;
      meta?: Record<string, any>;
    }
  ): Promise<SyncEnvelope> {
    const spec = ENTITY_REGISTRY[entityType];
    const now = opts?.updatedAt || Date.now();
    const packetId =
      opts?.packetId ||
      `${entityType}-${entityId || 'unknown'}-${now}-${Math.random().toString(36).substring(2, 6)}`;
    this.seenPacketIds.add(packetId);

    const dataCloudSynced = Boolean(data && typeof data === 'object' && (data as any).isCloudSynced === true);
    const resolvedVersion =
      opts?.meta?.version !== undefined
        ? Number(opts.meta.version)
        : data && typeof data === 'object' && (data as any).version !== undefined
        ? Number((data as any).version)
        : undefined;
    const resolvedMutationSource =
      opts?.meta?.mutationSource ||
      (data && typeof data === 'object' ? (data as any).mutationSource : undefined);
    const envelope: SyncEnvelope = {
      packetId,
      entityType,
      entityId: String(entityId || 'UNKNOWN'),
      action: opts?.action || (spec?.appendOnly ? 'APPEND' : 'UPSERT'),
      data,
      updatedAt: now,
      ...(resolvedVersion !== undefined && !isNaN(resolvedVersion) ? { version: resolvedVersion } : {}),
      ...(resolvedMutationSource ? { mutationSource: resolvedMutationSource } : {}),
      originDeviceId: this.config.deviceId,
      targetBranchId: opts?.targetBranchId || this.config.branchId || 'ALL',
      class: spec?.class || 'T1',
      ...(dataCloudSynced ? { isCloudSynced: true } : {}),
      meta: {
        ...(opts?.meta || {}),
        companyId: this.config.companyId,
        branchCode: this.config.branchCode,
        originDeviceName: this.config.deviceName,
        topicSuffix: opts?.topicSuffix || entityType,
      },
    };

    if (this.isIngestingFromHub && !opts?.meta?.isReconPush) {
      return envelope;
    }

    this.syncLocalHubContext();
    this.syncActiveAdapter();
    await this.syncCore.saveAndSync(envelope);

    const wirePacket = this.localHubAdapter.envelopeToWirePacket(envelope);
    this.mirrorToSecondaryP2PTransports(opts?.topicSuffix || entityType, wirePacket);
    return envelope;
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

    const caPayload = packet.cashAccount || packet.payload;
    const isGlobalCashAccountPkt =
      (packet.type === 'cash_account' || packet.type === 'CASH_ACCOUNT') &&
      (caPayload?.account_type === 'HQ_SAFE' ||
        caPayload?.account_type === 'BANK_ACCOUNT' ||
        String(caPayload?.branch_id || '').toUpperCase().trim() === 'HQ');
    const ctPayload = packet.cashTransfer || packet.payload;
    const ctTypeUpper = String(ctPayload?.type || '').toUpperCase().trim();
    const isGlobalCashTransferPkt =
      (packet.type === 'cash_transfer' || packet.type === 'CASH_TRANSFER') &&
      (branchCandidate === 'HQ' ||
        branchCandidate === 'ALL' ||
        ctTypeUpper === 'HQ_TO_BRANCH' ||
        ctTypeUpper === 'BRANCH_TO_HQ' ||
        ctTypeUpper === 'BANK_DEPOSIT' ||
        ctTypeUpper === 'BANK_WITHDRAWAL' ||
        ctTypeUpper === 'CAPITAL_INFUSION' ||
        ctTypeUpper === 'SUPPLIER_PAYMENT' ||
        ctTypeUpper === 'THIRD_PARTY_PAYOUT');
    const clPayload = packet.cashLog || packet.payload;
    const isVaultCashLogPkt =
      (packet.type === 'cash_log' || packet.type === 'CASH_LOG' || packet.action === 'CASH_LOG_RECORD' || packet.action === 'CASH_LOG_UPDATE') &&
      Boolean(
        clPayload?.isVaultCustody ||
          String(clPayload?.staffId || '').toUpperCase().trim() === 'VAULT_CUSTODY' ||
          branchCandidate === 'HQ'
      );

    const isCatalogOrCompanyPacket =
      topic.endsWith('/inventory') ||
      packet.type === 'inventory' ||
      packet.type === 'INVENTORY' ||
      packet.type === 'INVENTORY_ITEM' ||
      packet.type === 'INVENTORY_UPDATE' ||
      packet.action === 'INVENTORY_RECORD' ||
      packet.action === 'INVENTORY_UPDATE' ||
      packet.type === 'TOMBSTONE_SYNC' ||
      packet.action === 'TOMBSTONE_SYNC' ||
      packet.type === 'tombstone' ||
      packet.entityType === 'tombstone' ||
      packet.type === 'product' ||
      packet.type === 'staff' ||
      packet.type === 'STAFF' ||
      packet.action === 'STAFF_SYNC' ||
      packet.action === 'STAFF_RECORD' ||
      packet.type === 'staff_permission' ||
      packet.action === 'STAFF_PERMISSION_RECORD' ||
      packet.type === 'permissions_matrix' ||
      packet.type === 'PERMISSIONS_MATRIX_SYNC' ||
      packet.action === 'PERMISSIONS_MATRIX_SYNC' ||
      packet.type === 'role_configs' ||
      packet.type === 'ROLE_CONFIGS_SYNC' ||
      packet.action === 'ROLE_CONFIGS_SYNC' ||
      packet.type === 'multi_currency' ||
      packet.type === 'MULTI_CURRENCY' ||
      packet.type === 'MULTI_CURRENCY_SYNC' ||
      packet.action === 'MULTI_CURRENCY_SYNC' ||
      packet.type === 'exchange_rates' ||
      packet.type === 'EXCHANGE_RATES_SYNC' ||
      packet.action === 'EXCHANGE_RATES_SYNC' ||
      packet.type === 'branch' ||
      packet.type === 'BRANCH' ||
      packet.action === 'BRANCH_SYNC' ||
      packet.type === 'customer' ||
      packet.type === 'CUSTOMER' ||
      packet.action === 'CUSTOMER_SYNC' ||
      isGlobalCashAccountPkt ||
      isGlobalCashTransferPkt ||
      isVaultCashLogPkt ||
      packet.target_branch_id === 'ALL' ||
      branchCandidate === 'ALL';

    if (!isCatalogOrCompanyPacket && !branchMatches) {
      this.addLog(
        'SECURITY_DROP',
        `Blocked cross-branch packet for branch [${packetBranchId || packetBranchCode}] (Active Terminal Branch: [${localBranchId}/${localBranchCode}]).`,
        packet.origin_device_name || packet.originDeviceName || packet.deviceName || 'Peer Terminal'
      );
      return;
    }

    // Deduplicate packets (never deduplicate inventory updates by static itemId)
    const isInventoryPacket =
      isCatalogOrCompanyPacket &&
      (topic.endsWith('/inventory') ||
        packet.type === 'inventory' ||
        packet.type === 'INVENTORY' ||
        packet.type === 'INVENTORY_ITEM' ||
        packet.type === 'INVENTORY_UPDATE' ||
        packet.action === 'INVENTORY_RECORD' ||
        packet.action === 'INVENTORY_UPDATE' ||
        Boolean(packet.item));

    const packetId = packet.packet_id || packet.packetId || (!isInventoryPacket && packet.id);
    if (packetId && this.seenPacketIds.has(packetId)) return;
    if (packetId) this.seenPacketIds.add(packetId);

    const originName = packet.origin_device_name || packet.originDeviceName || packet.deviceName || 'Peer Terminal';

    // Auto-discover or refresh peer on ANY incoming packet
    const isNew = !this.discoveredPeers.has(packetOrigin);
    if (isNew) {
      const peerData: P2PMeshPeer = {
        id: packetOrigin,
        name: packet.deviceName || originName,
        isOnline: true,
        hasInternet: typeof packet.hasInternet === 'boolean' ? packet.hasInternet : true,
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
      if (!this.isLocalHubConnected && !this.isIngestingFromHub) {
        this.requestCatchUpSync(packetOrigin).catch(() => {});
      }

      if (!this.virtualMeshSimulator.isSimulationActive()) {
        this.notifyPeerSubscribers();
      }
    } else {
      const peer = this.discoveredPeers.get(packetOrigin)!;
      peer.lastSeen = Date.now();
      peer.isOnline = true;
      if (typeof packet.hasInternet === 'boolean') peer.hasInternet = packet.hasInternet;
      if (packet.pendingCount !== undefined) peer.pendingCount = packet.pendingCount;
      if (packet.salesCount !== undefined) peer.totalSalesCount = packet.salesCount;
    }

    // 1. HEARTBEAT DISCOVERY
    if (topic.endsWith('/heartbeat') || packet.type === 'heartbeat' || packet.action === 'HEARTBEAT') {
      return;
    }

    // 1b. P2P CATCH-UP DELTA PROTOCOL
    if (topic.endsWith('/catchup_request') || packet.type === 'catchup_request' || packet.action === 'CATCHUP_REQUEST') {
      this.handleIncomingCatchupRequest(packet);
      return;
    }

    if (topic.endsWith('/catchup_response') || packet.type === 'catchup_response' || packet.action === 'CATCHUP_RESPONSE') {
      this.handleIncomingCatchupResponse(packet);
      return;
    }

    // 2. STOCKTAKE PACKETS (zone status frames + SyncCore envelopes)
    if (topic.includes('stocktake') || (typeof packet.type === 'string' && packet.type.startsWith('STOCKTAKE_')) || (typeof packet.action === 'string' && packet.action.startsWith('STOCKTAKE_'))) {
      this.processSingleLocalHubPacket(packet);
      return;
    }

    // 3. UNIFIED DB MUTATION / DELETION
    if (
      topic.endsWith('/mutation') ||
      packet.type === 'db_mutation' ||
      packet.action === 'DB_MUTATION' ||
      packet.type === 'db_deletion' ||
      packet.action === 'DELETE'
    ) {
      this.handleIncomingDatabaseMutation(packet);
      return;
    }

    // 4. ANTI-DOUBLE-POSTING SYNC RECEIPT, HUB SALE ACK & CLOUD SYNC ACK
    const isReceipt =
      topic.endsWith('/sync_receipt') ||
      topic.endsWith('/receipt') ||
      packet.type === 'sync_receipt' ||
      packet.action === 'SYNC_RECEIPT' ||
      packet.type === 'SYNC_RECEIPT' ||
      packet.type === 'cloud_sync_ack' ||
      packet.type === 'CLOUD_SYNC_ACK' ||
      packet.action === 'CLOUD_SYNC_ACK' ||
      packet.type === 'ANTI-DOUBLE-POST ACK' ||
      packet.action === 'ANTI-DOUBLE-POST ACK' ||
      packet.type === 'sale_ack' ||
      packet.action === 'SALE_ACK' ||
      packet.type === 'ACK' ||
      packet.action === 'ACK';

    if (isReceipt) {
      const invId = this.extractInvoiceId(packet);
      if (invId) {
        this.handleIncomingSaleSyncReceipt(invId, originName);
      }
      const postedIds: string[] =
        packet.postedIds ||
        packet.invoice_ids ||
        packet.invoiceIds ||
        packet.data?.postedIds ||
        packet.payload?.postedIds ||
        packet.data?.invoice_ids;
      if (Array.isArray(postedIds)) {
        for (const pid of postedIds) {
          if (pid) this.handleIncomingSaleSyncReceipt(pid, originName);
        }
      }
      this.handleIncomingSyncReceipt(packet);
      return;
    }

    // 5. LIVE TEST PING
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

    // 6. ALL DATA ENTITIES -> Unified SyncCore.ingest() Pipeline
    const envelope = this.localHubAdapter.packetToEnvelope(packet);
    if (!envelope) return;

    if (envelope.entityType === 'sale' && envelope.entityId && this.pendingSaleAcks.has(envelope.entityId)) {
      if (/^INV-/i.test(envelope.entityId)) {
        this.pendingSaleAcks.delete(envelope.entityId);
      } else {
        this.handleIncomingSaleSyncReceipt(envelope.entityId, originName);
      }
    }

    void this.ingestEnvelopeThroughSyncCore(envelope, originName).then((accepted) => {
      if (accepted) playChime();
    });
  }

  private handleIncomingDatabaseMutation(packet: any) {
    if (!packet || (!packet.payload && !packet.recordId)) return;
    const originName = packet.origin_device_name || packet.originDeviceName || 'Peer Terminal';
    const envelope = this.localHubAdapter.packetToEnvelope({
      ...packet,
      type: packet.type || 'db_mutation',
    });
    if (!envelope) return;
    void this.ingestEnvelopeThroughSyncCore(envelope, originName).then((accepted) => {
      if (accepted && packet.action !== 'DELETE') {
        playChime();
      }
    });
  }

  // =========================================================================
  // T1 & T2 INGESTORS (DELEGATED TO src/services/mesh/meshIngestHandlers.ts)
  // =========================================================================

  public ingestMeshSupplier(payload: any): boolean {
    return ingestMeshSupplierRecord(payload);
  }

  public ingestMeshAdminSales(payload: any): boolean {
    return ingestMeshAdminSalesRecord(payload);
  }

  public ingestMeshCashCount(payload: any): boolean {
    return ingestMeshCashCountRecord(payload);
  }

  public ingestMeshVoucher(payload: any): boolean {
    return ingestMeshVoucherRecord(payload);
  }

  public ingestMeshClosure(payload: any): boolean {
    return ingestMeshClosureRecord(payload);
  }

  public ingestMeshSettlement(payload: any): boolean {
    return ingestMeshSettlementRecord(payload);
  }

  public ingestMeshCategories(payload: any): boolean {
    return ingestMeshCategoriesRecord(payload);
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
    await this.dispatchEnvelope(
      'sync_receipt',
      packetId,
      {
        sheetName: receipt.sheetName || 'SyncItems',
        postedClientRequestIds: clientReqIds,
        postedIds: ids,
      },
      {
        action: 'APPEND',
        topicSuffix: 'sync_receipt',
        packetId,
      }
    );

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

    // 1. Mark in RoomDatabase sync queue & sales + entity records
    const roomMarked = markSyncItemsAsSynced(clientReqIds, ids);
    try {
      markRecordsCloudSynced(ids, clientReqIds, packet.entityType, false);
    } catch {}

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

  // Persisted sync timestamp key requested: saimetric_last_inventory_sync
  public static readonly LAST_INVENTORY_SYNC_KEY = 'saimetric_last_inventory_sync';

  public async getLastInventorySyncTimestamp(): Promise<string> {
    // 1. Try IndexedDB first
    try {
      const meta = await getSyncMeta(MeshSyncManager.LAST_INVENTORY_SYNC_KEY);
      if (meta && meta.lastSyncAt) {
        return meta.lastSyncAt;
      }
      if (meta && meta.lastServerTime) {
        const num = Number(meta.lastServerTime);
        if (!isNaN(num) && num > 0) {
          return new Date(num).toISOString();
        }
      }
    } catch (_) {}

    // 2. Try localStorage saimetric_last_inventory_sync
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(MeshSyncManager.LAST_INVENTORY_SYNC_KEY);
      if (stored) {
        const num = Number(stored);
        if (!isNaN(num) && num > 0) {
          return new Date(num).toISOString();
        }
        const parsed = new Date(stored).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          return new Date(parsed).toISOString();
        }
      }
    }

    // 3. Fallback to branch-scoped key
    const branchKey = `saimetric_mesh_last_sync_${this.config.branchId}_${this.config.companyId}`;
    if (typeof window !== 'undefined' && window.localStorage) {
      const bStored = window.localStorage.getItem(branchKey);
      if (bStored) {
        const parsed = new Date(bStored).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          return new Date(parsed).toISOString();
        }
      }
    }

    // 4. Default: Return 0 when uninitialized so initial sync fetches everything accurately
    return '0';
  }

  public async setLastInventorySyncTimestamp(val: number | string): Promise<void> {
    let numTimestamp: number = Date.now();
    let isoTimestamp: string = new Date().toISOString();

    if (typeof val === 'number') {
      numTimestamp = val;
      isoTimestamp = new Date(val).toISOString();
    } else if (typeof val === 'string') {
      const asNum = Number(val);
      if (!isNaN(asNum) && asNum > 1000000000000) {
        numTimestamp = asNum;
        isoTimestamp = new Date(asNum).toISOString();
      } else {
        const parsed = new Date(val).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          numTimestamp = parsed;
          isoTimestamp = new Date(parsed).toISOString();
        }
      }
    }

    // 1. Persist in localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(MeshSyncManager.LAST_INVENTORY_SYNC_KEY, String(numTimestamp));
      const branchKey = `saimetric_mesh_last_sync_${this.config.branchId}_${this.config.companyId}`;
      window.localStorage.setItem(branchKey, isoTimestamp);
    }

    // 2. Persist in IndexedDB
    try {
      await setSyncMeta(MeshSyncManager.LAST_INVENTORY_SYNC_KEY, isoTimestamp, String(numTimestamp));
    } catch (e) {
      console.warn('[MeshSync] Error storing saimetric_last_inventory_sync in IndexedDB:', e);
    }
  }

  public getLastMeshSyncTimestamp(): string {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(MeshSyncManager.LAST_INVENTORY_SYNC_KEY);
      if (stored) {
        const num = Number(stored);
        if (!isNaN(num) && num > 0) return new Date(num).toISOString();
        const p = new Date(stored).getTime();
        if (!isNaN(p) && p > 0) return new Date(p).toISOString();
      }
    }
    const key = `saimetric_mesh_last_sync_${this.config.branchId}_${this.config.companyId}`;
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(key);
      if (stored) return stored;
    }
    // Default to 5 minutes ago instead of 48 hours to prevent 501 firehose
    return new Date(Date.now() - 5 * 60 * 1000).toISOString();
  }

  public setLastMeshSyncTimestamp(isoStr: string) {
    this.setLastInventorySyncTimestamp(isoStr).catch(() => {});
  }

  public getLastStaffSync(): number {
    return getLastStaffSync();
  }

  public setLastStaffSync(ts: number): void {
    setLastStaffSync(ts);
  }

  public markStaffSyncComplete(hubCutoffTs: number): void {
    markStaffSyncComplete(hubCutoffTs);
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
    if (force && !this.localHubAdapter.isConnected()) {
      this.connectLocalHub();
    }

    let sinceTimestamp = customSinceIso;
    if (!sinceTimestamp) {
      if (force) {
        sinceTimestamp = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      } else {
        sinceTimestamp = await this.getLastInventorySyncTimestamp();
      }
    }

    // 4. Verification: Add a console.log that prints [CatchUp] Requesting items since: [timestamp] immediately before sending the request.
    console.log(`[CatchUp] Requesting items since: [${sinceTimestamp}]`);
    console.log(`[CatchUp] Requesting items since: ${sinceTimestamp}`);

    const packetId = `CRQ-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.seenPacketIds.add(packetId);

    const staffHwm = this.getLastStaffSync();
    const isStaffExplicitZero = staffHwm === 0 || force;
    const staffSinceTimestamp = isStaffExplicitZero ? '1970-01-01T00:00:00.000Z' : new Date(staffHwm).toISOString();

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
      staffSinceTime: staffHwm,
      staffSinceTimestamp,
      isReciprocal: Boolean(isReciprocal),
      isForced: Boolean(force),
      requestedTypes: [
        'inventoryItems',
        'sales',
        'directGrvs',
        'cashLogs',
        'cashLifts',
        'cashMovements',
        'customerChanges',
        'creditSales',
        'stockMovements',
        'expenses',
        'cashTransfers',
        'cashCounts',
        'salespeople',
        'customers',
        'branches',
      ],
      includeInventory: true,
      timestamp: Date.now(),
      ttl: 5,
    };

    if (!this.isCloudOnlyMode) {
      this.localHubAdapter.sendControlPacket(packet);
    }
    this.mirrorToSecondaryP2PTransports('catchup_request', packet);

    if (this.isCloudOnlyMode || !this.isLocalHubConnected) {
      this.syncActiveAdapter();
      const cloudAdapter = this.getOrCreateSingleCloudAdapter();
      if (!cloudAdapter.isPaused?.()) {
        const sinceMs = force ? 0 : (sinceTimestamp ? Date.parse(sinceTimestamp) || 0 : 0);
        void cloudAdapter.drainOfflineQueue().catch(() => {});
        void cloudAdapter.requestCatchUp(sinceMs).catch(() => {});
      }
    }

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
    if (this.isLocalHubConnected || this.localHubAdapter.isConnected()) {
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
    const deltaElectronicSettlements = filterSince(getElectronicSettlements('ALL'));
    const deltaCashCounts = filterSince(getRawStoredCashCounts());
    const localMc = getMultiCurrencyConfig();
    const localMcTime = getMultiCurrencyUpdatedAt(localMc);
    const includeMc = localMcTime > 0 && (localMcTime >= sinceTime || sinceTime <= 0);

    const enrichedDelta = {
      ...delta,
      expenses: deltaExpenses,
      cashAccounts: deltaCashAccounts,
      cashTransfers: deltaCashTransfers,
      electronicSettlements: deltaElectronicSettlements,
      cashCounts: deltaCashCounts,
      ...(includeMc ? { multiCurrencyConfig: localMc } : {}),
    };

    const totalRecords =
      delta.sales.length +
      delta.cashLogs.length +
      (delta.cashLifts?.length || 0) +
      (delta.cashMovements?.length || 0) +
      delta.customerChanges.length +
      delta.creditSales.length +
      delta.stockMovements.length +
      delta.directGrvs.length +
      (delta.goodsReceivedNotes?.length || 0) +
      (delta.auditLogs?.length || 0) +
      deltaExpenses.length +
      deltaCashAccounts.length +
      deltaCashTransfers.length +
      deltaElectronicSettlements.length +
      (delta.internalConsumptions?.length || 0);

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
      isReciprocal: true,
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
        internalConsumptionsCount: delta.internalConsumptions?.length || 0,
        totalRecords,
      },
      timestamp: Date.now(),
      ttl: 5,
    };

    this.mirrorToSecondaryP2PTransports('catchup_response', responsePacket);

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

    const totalInventoryCount = Array.isArray(delta.inventoryItems) ? delta.inventoryItems.length : 0;
    const totalSalesCount = Array.isArray(delta.sales) ? delta.sales.length : 0;
    const totalCashLogsCount = Array.isArray(delta.cashLogs) ? delta.cashLogs.length : 0;
    const totalStockMovesCount = Array.isArray(delta.stockMovements) ? delta.stockMovements.length : 0;

    const totalRecordsToProcess =
      totalInventoryCount +
      totalSalesCount +
      totalCashLogsCount +
      totalStockMovesCount +
      (delta.directGrvs?.length || 0) +
      (delta.expenses?.length || 0);

    let overallProcessed = 0;
    if (totalRecordsToProcess > 0) {
      this.updateSyncProgress(0, totalRecordsToProcess, `Syncing 0/${totalRecordsToProcess} items...`);
    }

    // 0. Apply Tombstones FIRST so Resurrection Guard blocks any stale T2 items in this catchup delta
    if (Array.isArray(delta.tombstones) && delta.tombstones.length > 0) {
      for (const tomb of delta.tombstones) {
        if (tomb && tomb.entityId && tomb.entityType) {
          applyTombstone(tomb);
        }
      }
      overallProcessed += delta.tombstones.length;
    }

    if (Array.isArray(delta.securityAlerts) && delta.securityAlerts.length > 0) {
      for (const sa of delta.securityAlerts) {
        if (sa && sa.message) {
          recordSecurityAlert({
            id: sa.id,
            type:
              sa.alertType ||
              (sa.type && sa.type !== 'SECURITY_ALERT' ? sa.type : 'HUB_FLAGGED_BACKDATE'),
            deviceId: sa.deviceId || sa.targetDeviceId || 'UNKNOWN-DEVICE',
            deviceName: sa.deviceName,
            packetType: sa.packetType,
            invoiceId: sa.invoiceId,
            claimedTimestamp: sa.claimedTimestamp,
            hubTimestamp: sa.hubTimestamp,
            serverReceivedAt: sa.serverReceivedAt,
            driftMs: sa.driftMs,
            message: sa.message,
            createdAt: sa.timestamp || sa.createdAt,
          });
        }
      }
    }

    // 1. Ingest Sales (T1 - Append-Only Merge)
    if (Array.isArray(delta.sales) && delta.sales.length > 0) {
      mergeT1Records(STORAGE_KEYS.SALES, delta.sales);
      salesIngested += delta.sales.length;
      overallProcessed += delta.sales.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
    }

    // 2. Ingest Cash Logs, Lifts & Movements (T1 - Append-Only Merge)
    if (Array.isArray(delta.cashLogs) && delta.cashLogs.length > 0) {
      mergeT1Records(STORAGE_KEYS.CASH_LOGS, delta.cashLogs);
      try {
        const cleanedLogs = deduplicateCashLogs(
          getRawStoredCashLogs().map((r) => normalizeCashLogRecord(r))
        );
        setStored(STORAGE_KEYS.CASH_LOGS, cleanedLogs);
      } catch {}
      cashLogsIngested += delta.cashLogs.length;
      overallProcessed += delta.cashLogs.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
    }
    if ((Array.isArray(delta.sales) && delta.sales.length > 0) || (Array.isArray(delta.cashLogs) && delta.cashLogs.length > 0)) {
      try {
        healMultiCurrencySalesAndMovements();
      } catch {}
    }
    if (Array.isArray(delta.cashLifts) && delta.cashLifts.length > 0) {
      mergeT1Records(STORAGE_KEYS.CASH_LIFTS, delta.cashLifts);
      cashLiftsIngested += delta.cashLifts.length;
      overallProcessed += delta.cashLifts.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_lifts_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
    }
    if (Array.isArray(delta.cashMovements) && delta.cashMovements.length > 0) {
      mergeT1Records('saimetric_room_cash_movements', delta.cashMovements);
      overallProcessed += delta.cashMovements.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
    }

    // 3. Ingest Customer Changes & Credit Sales (T1 - Append-Only Merge)
    let touchedChangeOrCredit = false;
    if (Array.isArray(delta.customerChanges) && delta.customerChanges.length > 0) {
      mergeT1Records(STORAGE_KEYS.CUSTOMER_CHANGES, delta.customerChanges);
      changesIngested += delta.customerChanges.length;
      overallProcessed += delta.customerChanges.length;
      touchedChangeOrCredit = true;
    }
    if (Array.isArray(delta.creditSales) && delta.creditSales.length > 0) {
      mergeT1Records(STORAGE_KEYS.CREDIT_SALES, delta.creditSales);
      changesIngested += delta.creditSales.length;
      overallProcessed += delta.creditSales.length;
      touchedChangeOrCredit = true;
    }
    if (touchedChangeOrCredit) {
      try {
        healCustomerNamesAndChangeCreditLedgers();
      } catch {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_customer_changes_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_credit_sales_updated'));
      }
    }

    // 4. Ingest Stock Movements, GRVs & Goods Received Notes (T1 - Append-Only Merge, Strict Dedupe)
    if (Array.isArray(delta.stockMovements) && delta.stockMovements.length > 0) {
      const existingMoves = getRawStoredStockMovements();
      const filteredIncoming = delta.stockMovements.filter((sm: any) => {
        if (!sm || typeof sm !== 'object') return false;
        const smId = String(sm.id || sm.movementId || sm.txnId || '').trim();
        if (!smId) return false;
        const baseId = stripStockMovementDupSuffix(smId);
        if (smId !== baseId) {
          const itemId = String(sm.itemId || '').trim();
          const hasBase = existingMoves.some((ex: any) => {
            const exId = String(ex.id || ex.movementId || ex.txnId || '').trim();
            return stripStockMovementDupSuffix(exId) === baseId && (!itemId || !ex.itemId || String(ex.itemId).trim() === itemId);
          });
          if (hasBase) return false;
        }
        return true;
      });
      if (filteredIncoming.length > 0) {
        mergeT1Records(STORAGE_KEYS.STOCK_MOVEMENTS, filteredIncoming);
        getRawStoredStockMovements();
      }
      movementsIngested += filteredIncoming.length;
      overallProcessed += filteredIncoming.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      }
    }
    if (Array.isArray(delta.directGrvs) && delta.directGrvs.length > 0) {
      mergeT1Records(STORAGE_KEYS.DIRECT_GRVS, delta.directGrvs);
      delta.directGrvs.forEach((grv: any) => {
        recordDirectGrvTillPayouts({ ...grv, fromMesh: true } as any);
      });
      overallProcessed += delta.directGrvs.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_direct_grvs_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated'));
      }
    }
    if (Array.isArray(delta.goodsReceivedNotes) && delta.goodsReceivedNotes.length > 0) {
      mergeT1Records(STORAGE_KEYS.GOODS_RECEIVED_NOTES, delta.goodsReceivedNotes);
      grnIngested += delta.goodsReceivedNotes.length;
      overallProcessed += delta.goodsReceivedNotes.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_grn_updated'));
      }
    }

    // 5. Ingest Audit Logs / Supervisor PIN Approvals (T1 - Append-Only Merge)
    if (Array.isArray(delta.auditLogs) && delta.auditLogs.length > 0) {
      mergeT1Records(STORAGE_KEYS.AUDIT_LOGS, delta.auditLogs);
      auditLogsIngested += delta.auditLogs.length;
      overallProcessed += delta.auditLogs.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_audit_log_updated'));
      }
    }

    // 6. CHUNKED INGESTION FOR INVENTORY ITEMS VIA SYNCCORE (60s LWW authority + 50/chunk yield)
    if (Array.isArray(delta.inventoryItems) && delta.inventoryItems.length > 0) {
      const items = delta.inventoryItems;
      const CHUNK_SIZE = 50;
      const totalInv = items.length;

      for (let i = 0; i < totalInv; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);

        await Promise.all(
          chunk.map((it: any) => {
            const id = String(it?.itemId || it?.id || '');
            if (!id) return Promise.resolve(false);
            const ts = extractRecordTimestamp(it);
            return this.ingestEnvelopeThroughSyncCore(
              {
                packetId: `CATCHUP-INV-${id}-${ts}-${Math.random().toString(36).substring(2, 6)}`,
                entityType: 'inventory_item',
                entityId: id,
                action: 'UPSERT',
                data: it,
                updatedAt: ts,
                hubTimestamp: parseTimestampMs(it?.hubTimestamp ?? it?.updatedAt) || undefined,
                originDeviceId: packetOrigin || 'MESH_CATCHUP',
                targetBranchId: it?.branch_id || 'ALL',
                class: 'T2',
              },
              originName,
              { isReconBackfill: true }
            );
          })
        );

        overallProcessed += chunk.length;
        this.updateSyncProgress(
          overallProcessed,
          totalRecordsToProcess,
          `Syncing ${overallProcessed}/${totalRecordsToProcess} items...`
        );

        // Yield to the browser main thread so the UI can paint and respond to touch events
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Batch Valuation: Recalculate total valuation ONCE at the end of all chunks
      recalculateInventoryValuationOnce();
    }

    // 7. Ingest Expenses (T1 - Append-Only Merge)
    if (Array.isArray(delta.expenses) && delta.expenses.length > 0) {
      mergeT1Records(STORAGE_KEYS.EXPENSES, delta.expenses);
      expensesIngested += delta.expenses.length;
      overallProcessed += delta.expenses.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_expenses_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
    }

    // 7b. Ingest Shop Use / Internal Consumption (T1 - Monotonic Merge)
    if (Array.isArray((delta as any).internalConsumptions) && (delta as any).internalConsumptions.length > 0) {
      mergeT1Records('saimetric_internal_consumption', (delta as any).internalConsumptions);
      overallProcessed += (delta as any).internalConsumptions.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_internal_consumption_updated'));
      }
    }

    // 8. Ingest Cash Accounts (T2 via SyncCore) & Transfers (T1)
    if (Array.isArray(delta.cashAccounts) && delta.cashAccounts.length > 0) {
      for (const acc of delta.cashAccounts) {
        const accId = String(acc?.account_id || acc?.id || '');
        if (!accId) continue;
        const ts = extractRecordTimestamp(acc);
        if (
          await this.ingestEnvelopeThroughSyncCore(
            {
              packetId: `CATCHUP-CACC-${accId}-${ts}`,
              entityType: 'cash_account',
              entityId: accId,
              action: 'UPSERT',
              data: acc,
              updatedAt: ts,
              originDeviceId: packetOrigin || 'MESH_CATCHUP',
              targetBranchId: acc?.branch_id || this.config.branchId,
              class: 'T2',
            },
            originName,
            { isReconBackfill: true }
          )
        ) {
          accountsIngested++;
        }
      }
    }
    if (Array.isArray(delta.cashTransfers) && delta.cashTransfers.length > 0) {
      let transfersIngested = 0;
      for (const tr of delta.cashTransfers) {
        if (ingestMeshCashTransfer(tr)) {
          transfersIngested++;
        }
      }
      accountsIngested += transfersIngested;
      overallProcessed += transfersIngested;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_cash_transfers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_accounts_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_accounts_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_cash_updated'));
      }
    }

    // 8.1 Ingest Staff & Customers (T2 via SyncCore)
    let staffIngested = 0;
    if (Array.isArray(delta.salespeople)) {
      for (const st of delta.salespeople) {
        if (!st?.id) continue;
        const ts = extractRecordTimestamp(st);
        if (
          await this.ingestEnvelopeThroughSyncCore(
            {
              packetId: `CATCHUP-STAFF-${st.id}-${ts}`,
              entityType: 'staff',
              entityId: String(st.id),
              action: 'UPSERT',
              data: st,
              updatedAt: ts,
              originDeviceId: packetOrigin || 'MESH_CATCHUP',
              targetBranchId: 'ALL',
              class: 'T2',
            },
            originName,
            { isReconBackfill: true }
          )
        ) {
          staffIngested++;
        }
      }
      if (staffIngested > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_salespeople_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_staff_updated'));
      }
    }
    let custIngested = 0;
    if (Array.isArray(delta.customers)) {
      for (const cust of delta.customers) {
        const custId = String(cust?.customerId || cust?.id || '');
        if (!custId) continue;
        const ts = extractRecordTimestamp(cust);
        if (
          await this.ingestEnvelopeThroughSyncCore(
            {
              packetId: `CATCHUP-CUST-${custId}-${ts}`,
              entityType: 'customer',
              entityId: custId,
              action: 'UPSERT',
              data: cust,
              updatedAt: ts,
              originDeviceId: packetOrigin || 'MESH_CATCHUP',
              targetBranchId: 'ALL',
              class: 'T2',
            },
            originName,
            { isReconBackfill: true }
          )
        ) {
          custIngested++;
        }
      }
      if (custIngested > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_customers_updated'));
      }
    }

    if (Array.isArray((delta as any).creditGroups) && (delta as any).creditGroups.length > 0) {
      for (const group of (delta as any).creditGroups) {
        const gId = String(group?.id || group?.groupId || '');
        if (!gId) continue;
        const ts = extractRecordTimestamp(group);
        await this.ingestEnvelopeThroughSyncCore(
          {
            packetId: `CATCHUP-CGRP-${gId}-${ts}`,
            entityType: 'credit_group',
            entityId: gId,
            action: 'UPSERT',
            data: group,
            updatedAt: ts,
            originDeviceId: packetOrigin || 'MESH_CATCHUP',
            targetBranchId: this.config.branchId,
            class: 'T2',
          },
          originName,
          { isReconBackfill: true }
        );
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_credit_groups_updated'));
      }
    }

    // 8.2 Ingest Stocktake Sessions, Segments & Zone Assignments from Catch-up Delta (T2 via SyncCore)
    if (Array.isArray(delta.zoneAssignments) && delta.zoneAssignments.length > 0) {
      const validZones = delta.zoneAssignments.filter((z: any) => z && z.sessionId && z.zoneId);
      if (validZones.length > 0) {
        saveZoneAssignmentsBatch(validZones);
      }
    }

    if (Array.isArray(delta.stocktakeSessions) && delta.stocktakeSessions.length > 0) {
      for (const sess of delta.stocktakeSessions) {
        if (sess && sess.sessionId) {
          const sessSegments = Array.isArray(sess.segments) && sess.segments.length > 0
            ? sess.segments
            : (Array.isArray(delta.stocktakeSegments) ? delta.stocktakeSegments.filter((sg: any) => sg.sessionId === sess.sessionId) : []);
          const ts = extractRecordTimestamp(sess);
          await this.ingestEnvelopeThroughSyncCore(
            {
              packetId: `CATCHUP-STS-${sess.sessionId}-${ts}`,
              entityType: 'stocktake_session',
              entityId: String(sess.sessionId),
              action: 'UPSERT',
              data: { ...sess, segments: sessSegments },
              updatedAt: ts,
              originDeviceId: packetOrigin || 'MESH_CATCHUP',
              targetBranchId: sess.branchId || this.config.branchId,
              class: 'T2',
            },
            originName,
            { isReconBackfill: true }
          );
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_stocktake_updated'));
      }
    }

    // 8.2b Ingest Daily Blind Count Configs & Archived Reports from Catch-up Delta (T2 via SyncCore)
    if (Array.isArray((delta as any).dailyBlindConfigs) && (delta as any).dailyBlindConfigs.length > 0) {
      for (const cfg of (delta as any).dailyBlindConfigs) {
        if (!cfg || !cfg.id) continue;
        const ts = extractRecordTimestamp(cfg);
        await this.ingestEnvelopeThroughSyncCore(
          {
            packetId: `CATCHUP-DBC-${cfg.id}-${ts}`,
            entityType: 'daily_blind_config',
            entityId: String(cfg.id),
            action: 'UPSERT',
            data: cfg,
            updatedAt: ts,
            originDeviceId: packetOrigin || 'MESH_CATCHUP',
            targetBranchId: cfg.branch_id || this.config.branchId,
            class: 'T2',
          },
          originName,
          { isReconBackfill: true }
        );
      }
    }

    if (Array.isArray((delta as any).dailyBlindCounts) && (delta as any).dailyBlindCounts.length > 0) {
      for (const rec of (delta as any).dailyBlindCounts) {
        if (!rec || !rec.id) continue;
        const ts = extractRecordTimestamp(rec);
        await this.ingestEnvelopeThroughSyncCore(
          {
            packetId: `CATCHUP-DBCNT-${rec.id}-${ts}`,
            entityType: 'daily_blind_count',
            entityId: String(rec.id),
            action: 'UPSERT',
            data: rec,
            updatedAt: ts,
            originDeviceId: packetOrigin || 'MESH_CATCHUP',
            targetBranchId: rec.branch_id || this.config.branchId,
            class: 'T2',
          },
          originName,
          { isReconBackfill: true }
        );
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_daily_blind_updated'));
      }
    }

    // 8.2b Ingest Branch Lockdowns from Catch-up Delta (LWW)
    const rawLockdowns = (delta as any).branchLockdowns;
    if (rawLockdowns && typeof rawLockdowns === 'object') {
      const lockdownEntries = Array.isArray(rawLockdowns)
        ? rawLockdowns
        : Object.values(rawLockdowns);
      for (const lockRec of lockdownEntries) {
        if (lockRec && (lockRec as any).branchId) {
          syncLockdownFromHub(lockRec as any);
        }
      }
    }

    // 8.3 Ingest Branches from Catch-up Delta (T2 via SyncCore)
    let branchesIngested = 0;
    if (Array.isArray(delta.branches)) {
      for (const br of delta.branches) {
        const rawBrId = String(br?.branchId || br?.id || br?.branch_id || br?.BranchID || '').trim();
        if (!rawBrId || !isValidBranchRecord(br)) continue;
        const lowerBr = rawBrId.toLowerCase();
        const brId = lowerBr === '1' || lowerBr === 'br-main' || lowerBr === 'br001' ? 'BR-MAIN' : rawBrId;
        const ts = extractRecordTimestamp(br);
        if (
          await this.ingestEnvelopeThroughSyncCore(
            {
              packetId: `CATCHUP-BR-${brId}-${ts}`,
              entityType: 'branch',
              entityId: brId,
              action: 'UPSERT',
              data: { ...br, branchId: brId, id: brId, branch_id: brId },
              updatedAt: ts,
              originDeviceId: packetOrigin || 'MESH_CATCHUP',
              targetBranchId: 'ALL',
              class: 'T2',
            },
            originName,
            { isReconBackfill: true }
          )
        ) {
          branchesIngested++;
        }
      }
      if (branchesIngested > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_branches_updated'));
      }
    }

    // 8.4 Ingest Casual Workers from Catch-up Delta (T2 via SyncCore)
    if (Array.isArray(delta.casualWorkers)) {
      const tombList = getTombstones();
      const filteredCasuals = delta.casualWorkers.filter((cw: any) => {
        const cId = String(cw?.id || '').trim().toUpperCase();
        if (!cId) return true;
        const tomb = tombList.find(
          (t) =>
            normalizeTombstoneEntityType(t.entityType) === 'casual_worker' &&
            String(t.entityId || '').trim().toUpperCase() === cId
        );
        if (!tomb) return true;
        return !(Number(tomb.deletedAt || 0) > extractRecordTimestamp(cw));
      });
      const ts = Math.max(...filteredCasuals.map((c: any) => extractRecordTimestamp(c)), 0);
      await this.ingestEnvelopeThroughSyncCore(
        {
          packetId: `CATCHUP-CAS-${ts}`,
          entityType: 'casual_worker',
          entityId: 'CASUAL_WORKERS_LIST',
          action: 'UPSERT',
          data: filteredCasuals,
          updatedAt: ts,
          originDeviceId: packetOrigin || 'MESH_CATCHUP',
          targetBranchId: this.config.branchId,
          class: 'T2',
        },
        originName,
        { isReconBackfill: true }
      );
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saimetric_casual_workers_updated'));
        window.dispatchEvent(new CustomEvent('saimetric_casuals_updated'));
      }
    }

    // 8.5 Ingest Suppliers from Catch-up Delta (T2 via SyncCore)
    if (Array.isArray(delta.suppliers) && delta.suppliers.length > 0) {
      for (const supp of delta.suppliers) {
        const sId = String(supp?.supplierId || supp?.id || supp?.SupplierID || '');
        if (!sId) continue;
        const ts = extractRecordTimestamp(supp);
        await this.ingestEnvelopeThroughSyncCore(
          {
            packetId: `CATCHUP-SUPP-${sId}-${ts}`,
            entityType: 'supplier',
            entityId: sId,
            action: 'UPSERT',
            data: supp,
            updatedAt: ts,
            originDeviceId: packetOrigin || 'MESH_CATCHUP',
            targetBranchId: this.config.branchId,
            class: 'T2',
          },
          originName,
          { isReconBackfill: true }
        );
      }
      overallProcessed += delta.suppliers.length;
    }

    // 8.6 Ingest Admin Sales from Catch-up Delta (T1 - Append-Only Merge)
    if (Array.isArray(delta.adminSales) && delta.adminSales.length > 0) {
      mergeT1Records(STORAGE_KEYS.ADMIN_SALES, delta.adminSales);
      overallProcessed += delta.adminSales.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_admin_sales_updated'));
      }
    }

    // 8.7 Ingest Cash Counts from Catch-up Delta (Upsert + sync physical_count movement snapshot for Form 4)
    if (Array.isArray(delta.cashCounts) && delta.cashCounts.length > 0) {
      mergeT1Records(STORAGE_KEYS.CASH_COUNTS, delta.cashCounts);
      for (const cc of delta.cashCounts) {
        if (cc && (cc.id || cc.staffId)) {
          this.ingestMeshCashCount(cc);
        }
      }
      overallProcessed += delta.cashCounts.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_cash_counts_updated'));
        window.dispatchEvent(new Event('saimetric_cash_movements_updated'));
        window.dispatchEvent(new Event('saimetric_cash_updated'));
      }
    }

    // 8.8 Ingest Vouchers / Supplier Invoices from Catch-up Delta (T1 - Append-Only Merge)
    if (Array.isArray(delta.vouchers) && delta.vouchers.length > 0) {
      mergeT1Records(STORAGE_KEYS.SUPPLIER_INVOICES, delta.vouchers);
      overallProcessed += delta.vouchers.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_vouchers_updated'));
      }
    }

    // 8.9 Ingest Business Day Closures from Catch-up Delta (T1 - Append-Only Merge)
    if (Array.isArray(delta.businessDayClosures) && delta.businessDayClosures.length > 0) {
      mergeT1Records(STORAGE_KEYS.BUSINESS_DAY_CLOSURES, delta.businessDayClosures);
      overallProcessed += delta.businessDayClosures.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_closures_updated'));
      }
    }

    // 8.10 Ingest Electronic Settlements from Catch-up Delta (T1 - Append-Only Merge)
    if (Array.isArray(delta.electronicSettlements) && delta.electronicSettlements.length > 0) {
      mergeT1Records(STORAGE_KEYS.ELECTRONIC_SETTLEMENTS, delta.electronicSettlements);
      overallProcessed += delta.electronicSettlements.length;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('saimetric_settlements_updated'));
      }
    }

    // 8.11 Ingest Categories from Catch-up Delta (T2 via SyncCore)
    if (Array.isArray(delta.categories)) {
      const catTs = Math.max(...delta.categories.map((c: any) => parseTimestampMs(c.updatedAt || c.lastUpdated || c.timestamp || 0)), 0) || parseTimestampMs(packet.cutoffTimestamp || packet.timestamp);
      await this.ingestEnvelopeThroughSyncCore(
        {
          packetId: `CATCHUP-CAT-${catTs || Date.now()}`,
          entityType: 'inventory_category',
          entityId: 'CATEGORIES_CONFIG',
          action: 'UPSERT',
          data: delta.categories,
          updatedAt: catTs || Date.now(),
          originDeviceId: packetOrigin || 'MESH_CATCHUP',
          targetBranchId: 'ALL',
          class: 'T2',
        },
        originName,
        { isReconBackfill: true }
      );
      overallProcessed += delta.categories.length;
    }

    // 8.11b Ingest Permissions Matrix from Catch-up Delta (T2 via SyncCore)
    const rawPermsDelta = (delta as any).permissionsMatrix;
    if (Array.isArray(rawPermsDelta) || (rawPermsDelta && Array.isArray(rawPermsDelta.rules) && rawPermsDelta.rules.length > 0)) {
      const rules = Array.isArray(rawPermsDelta) ? rawPermsDelta : rawPermsDelta.rules;
      const permTs = parseTimestampMs((!Array.isArray(rawPermsDelta) ? rawPermsDelta.updatedAt : undefined) || packet.cutoffTimestamp || packet.timestamp);
      if (rules.length > 0) {
        await this.ingestEnvelopeThroughSyncCore(
          {
            packetId: `CATCHUP-PERMS-${permTs || Date.now()}`,
            entityType: 'permissions_matrix',
            entityId: 'PERMISSIONS_MATRIX_CONFIG',
            action: 'UPSERT',
            data: { rules, updatedAt: permTs },
            updatedAt: permTs || Date.now(),
            originDeviceId: packetOrigin || 'MESH_CATCHUP',
            targetBranchId: 'ALL',
            class: 'T2',
          },
          originName,
          { isReconBackfill: true }
        );
        overallProcessed += rules.length;
      }
    }

    // 8.11c Ingest Role Configurations from Catch-up Delta (T2 via SyncCore)
    const rawRolesDelta = (delta as any).roleConfigs || (delta as any).roleDefinitions;
    if (rawRolesDelta && typeof rawRolesDelta === 'object' && !Array.isArray(rawRolesDelta)) {
      const roleDefs = rawRolesDelta.definitions && typeof rawRolesDelta.definitions === 'object'
        ? rawRolesDelta.definitions
        : rawRolesDelta;
      const roleUpdatedAt = parseTimestampMs(rawRolesDelta.updatedAt || packet.cutoffTimestamp || packet.timestamp);
      if (Object.keys(roleDefs).length > 0) {
        await this.ingestEnvelopeThroughSyncCore(
          {
            packetId: `CATCHUP-ROLES-${roleUpdatedAt || Date.now()}`,
            entityType: 'role_configs',
            entityId: 'ROLE_CONFIGS_DEFINITIONS',
            action: 'UPSERT',
            data: { definitions: roleDefs, updatedAt: roleUpdatedAt },
            updatedAt: roleUpdatedAt || Date.now(),
            originDeviceId: packetOrigin || 'MESH_CATCHUP',
            targetBranchId: 'ALL',
            class: 'T2',
          },
          originName,
          { isReconBackfill: true }
        );
        overallProcessed += Object.keys(roleDefs).length;
      }
    }

    // 8.11d Ingest Multi-Currency & Exchange Rates from Catch-up Delta (T2 via SyncCore)
    const rawMcDelta = (delta as any).multiCurrencyConfig || (delta as any).exchangeRates;
    if (rawMcDelta && typeof rawMcDelta === 'object') {
      const mcConfig = rawMcDelta.config && typeof rawMcDelta.config === 'object' ? rawMcDelta.config : rawMcDelta;
      const mcUpdatedAt = parseTimestampMs(
        rawMcDelta.updatedAt ?? mcConfig?.updatedAt ?? mcConfig?.lastUpdated ?? packet.cutoffTimestamp ?? packet.timestamp
      );
      if (mcConfig && mcConfig.rates) {
        if (
          await this.ingestEnvelopeThroughSyncCore(
            {
              packetId: `CATCHUP-MC-${mcUpdatedAt || Date.now()}`,
              entityType: 'multi_currency',
              entityId: 'MULTI_CURRENCY_CONFIG',
              action: 'UPSERT',
              data: mcConfig,
              updatedAt: mcUpdatedAt || Date.now(),
              originDeviceId: packetOrigin || 'MESH_CATCHUP',
              targetBranchId: 'ALL',
              class: 'T2',
            },
            originName,
            { isReconBackfill: true }
          )
        ) {
          overallProcessed += 1;
        }
      }
    }

    // 8.11e Ingest schema-agnostic generic envelopes from Universal Hub (reconciliation, goods_received, future entities)
    const rawGenericEnvelopes = (delta as any).genericEnvelopes;
    if (Array.isArray(rawGenericEnvelopes) && rawGenericEnvelopes.length > 0) {
      for (const gEnv of rawGenericEnvelopes) {
        if (!gEnv || !gEnv.entityType || !gEnv.entityId || !gEnv.data) continue;
        try {
          if (
            await this.ingestEnvelopeThroughSyncCore(
              {
                packetId: gEnv.packetId || `CATCHUP-GEN-${gEnv.entityType}-${gEnv.entityId}`,
                entityType: String(gEnv.entityType),
                entityId: String(gEnv.entityId),
                action: gEnv.action || 'UPSERT',
                data: gEnv.data,
                updatedAt: parseTimestampMs(gEnv.updatedAt || gEnv.data?.updatedAt) || Date.now(),
                originDeviceId: gEnv.originDeviceId || packetOrigin || 'LOCAL_HUB',
                targetBranchId: gEnv.targetBranchId || this.config.branchId || 'ALL',
                class: gEnv.class === 'T2' ? 'T2' : 'T1',
              },
              originName,
              { isReconBackfill: true }
            )
          ) {
            overallProcessed += 1;
          }
        } catch (genErr) {
          console.warn('[CatchUp] Notice ingesting generic Hub envelope:', genErr);
        }
      }
    }

    // Complete sync progress indicator
    if (totalRecordsToProcess > 0) {
      this.finishSyncProgress(totalRecordsToProcess, 'Sync Complete');
    }

    // 3. Update on Success: After the catchup_response is fully ingested, update saimetric_last_inventory_sync to Date.now() (the Hub's cutoffTimestamp)
    const cutoffVal = packet.cutoffTimestamp ? new Date(packet.cutoffTimestamp).getTime() : Date.now();
    const validCutoff = !isNaN(cutoffVal) && cutoffVal > 0 ? cutoffVal : Date.now();
    await this.setLastInventorySyncTimestamp(validCutoff);
    this.setLastMeshSyncTimestamp(new Date(validCutoff).toISOString());
    markStaffSyncComplete(validCutoff);
    markBranchSyncComplete(validCutoff);
    markCustomerSyncComplete(validCutoff);
    markCashAccountSyncComplete(validCutoff);
    markCasualWorkerSyncComplete(validCutoff);
    markStocktakeSessionSyncComplete(validCutoff);
    console.log(`[CatchUp] Catch-up delta ingested successfully. Updated saimetric_last_inventory_sync & all 6 T2 HWMs: [${new Date(validCutoff).toISOString()}] (${validCutoff})`);

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
      window.dispatchEvent(new Event('saimetric_sales_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_sales_updated'));
      window.dispatchEvent(new Event('saimetric_inventory_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_inventory_updated'));
      window.dispatchEvent(new Event('saimetric_products_updated'));
      window.dispatchEvent(new CustomEvent('saimetric_products_updated'));
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
  public async broadcastSale(sale: SaleInvoice, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!sale || !sale.id) return;

    // Check if already broadcasted by this device (bypassed for explicit Hub recon push backfill)
    if (!isReconPush && this.broadcastedInvoiceIds.has(sale.id)) {
      return;
    }

    // Do not re-broadcast sales received from peers/mesh (unless explicitly requested by Hub recon backfill)
    if (!isReconPush && (sale as any).fromMesh) {
      return;
    }

    // Check local database: if this invoice already exists in stored sales from mesh
    if (!isReconPush) {
      const storedSales = getAllSales();
      const existing = storedSales.find((s) => s.id === sale.id);
      if (existing && (existing as any).fromMesh) {
        this.broadcastedInvoiceIds.add(sale.id);
        this.knownSaleIds.add(sale.id);
        return;
      }
    }

    // Mark as broadcasted so we never send it to the Hub again
    this.broadcastedInvoiceIds.add(sale.id);
    this.knownSaleIds.add(sale.id);

    // Safeguard 1: Register in pendingSaleAcks to await {"type": "SYNC_RECEIPT", "invoice_id": "..."}
    // Requirement 4: Legacy INV- sales & recon backfill pushes must NOT trigger Watchdog retries
    if (!isReconPush && !/^INV-/i.test(sale.id)) {
      this.pendingSaleAcks.set(sale.id, {
        sale,
        sentAt: Date.now(),
        lastRetryAt: Date.now(),
        retries: 0,
      });
    }

    // Stop Payload Bloat: Build canonical SyncEnvelope and route via SyncCore.saveAndSync()
    const packetId = `SALE-PKT-${sale.id}-${Date.now()}`;
    const salePayload = isReconPush
      ? (() => {
          const copy: any = { ...sale };
          delete copy.fromMesh;
          if (copy.synced || copy.isCloudSynced) {
            copy.isCloudSynced = true;
          }
          return copy;
        })()
      : sale;

    await this.dispatchEnvelope('sale', sale.id, salePayload, {
      action: 'APPEND',
      topicSuffix: 'sale',
      packetId,
      meta: { wireAction: 'SALE_RECORD', isReconPush },
    });

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

  /**
   * Broadcast an updated sale (Refund, Void, or Item Exchange) to all peers & Local Hub
   */
  public async broadcastSaleUpdate(sale: SaleInvoice, extraCashLogs?: CashLogEntry[]) {
    if (this.isIngestingFromHub) return;
    if (!sale || !sale.id) return;

    const nowMs = Date.now();
    const cleanSalePayload: any = {
      ...sale,
      updatedAt: (sale as any).updatedAt || nowMs,
      lastUpdated: (sale as any).lastUpdated || new Date(nowMs).toISOString(),
    };
    delete cleanSalePayload.fromMesh;
    delete cleanSalePayload.fromSync;
    if (Array.isArray(extraCashLogs) && extraCashLogs.length > 0) {
      cleanSalePayload.reversalCashLogs = extraCashLogs.map((cl) => {
        const copy = { ...cl };
        delete (copy as any).fromMesh;
        delete (copy as any).fromSync;
        return copy;
      });
    }

    const packetId = `SALE-UPD-${sale.id}-${nowMs}`;
    await this.dispatchEnvelope('sale', sale.id, cleanSalePayload, {
      action: 'UPSERT',
      updatedAt: cleanSalePayload.updatedAt,
      topicSuffix: 'sale',
      packetId,
      meta: { wireAction: 'SALE_UPDATE', isSaleUpdate: true },
    });

    this.addLog(
      'BROADCAST',
      `Sale #${sale.id} Update (${sale.status || 'Updated'}${sale.hasExchanges ? ' / Exchange' : ''}) broadcasted to WiFi mesh`,
      this.config.deviceName,
      undefined,
      5,
      sale.id
    );

    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast a Form 2 CashLog entry creation or reversal update (Refund, Void, Cash Sale, Multi-Currency)
   */
  public broadcastCashLog(
    log: CashLogEntry,
    action: 'APPEND' | 'UPSERT' = 'APPEND',
    options?: { isReconPush?: boolean }
  ) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!log || !log.id) return;
    if (!isReconPush && ((log as any).fromMesh || (log as any).fromSync)) return;

    const cleanLog: any = {
      ...log,
      updatedAt: (log as any).updatedAt || Date.now(),
      lastUpdated: (log as any).lastUpdated || new Date().toISOString(),
    };
    delete cleanLog.fromMesh;
    delete cleanLog.fromSync;

    const isVaultLog = Boolean(
      cleanLog.isVaultCustody ||
        String(cleanLog.staffId || '').toUpperCase().trim() === 'VAULT_CUSTODY' ||
        String(cleanLog.branch_id || cleanLog.branchId || '').toUpperCase().trim() === 'HQ'
    );
    const packetId = `CL-PKT-${cleanLog.id}-${Date.now()}`;
    void this.dispatchEnvelope('cash_log', cleanLog.id, cleanLog, {
      action,
      ...(isVaultLog ? { targetBranchId: 'ALL' } : {}),
      updatedAt: cleanLog.updatedAt,
      topicSuffix: 'cash_log',
      packetId,
      meta: {
        wireAction: action === 'UPSERT' ? 'CASH_LOG_UPDATE' : 'CASH_LOG_RECORD',
        isReconPush,
      },
    });
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast a staff account (Till Operator, Manager, Casual) creation or edit to peers & Hub
   */
  public broadcastStaff(staff: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!staff || !staff.id) return;
    if (!isReconPush && (staff.fromMesh || staff.fromSync)) return;

    staff.updatedAt = staff.updatedAt || Date.now();
    staff.lastUpdated = staff.lastUpdated || new Date().toISOString();

    const packetId = `STAFF-PKT-${staff.id}-${Date.now()}`;

    // Ensure password and credentials integrity across LAN / Hub (NEVER transmit plaintext pin)
    const sanitizedStaff = sanitizeUserForExport(staff);
    const effectiveHash = staff.pin_hash || (sanitizedStaff as any).pin_hash || '';
    const effectivePassword = (sanitizedStaff as any).password || effectiveHash || '';
    const assignedBranchIds = Array.isArray((staff as any).assignedBranchIds)
      ? (staff as any).assignedBranchIds
      : Array.isArray(staff.branchAssignments) && staff.branchAssignments.length > 0
      ? staff.branchAssignments.map((b: any) => b.branchId).filter(Boolean)
      : (staff.branchId ? [staff.branchId] : []);
    const staffPayload = {
      ...sanitizedStaff,
      password: effectivePassword,
      pin_hash: effectiveHash,
      ...(staff.pin_salt ? { pin_salt: staff.pin_salt } : {}),
      ...(staff.pinVersion !== undefined ? { pinVersion: Number(staff.pinVersion) } : {}),
      ...(staff.pinUpdatedAt ? { pinUpdatedAt: staff.pinUpdatedAt } : {}),
      version: Math.max(1, Number(staff.version || 1)),
      mutationSource: staff.mutationSource || 'USER_EDIT',
      assignedBranchIds,
      updatedAt: staff.updatedAt,
      lastUpdated: staff.lastUpdated,
    };

    console.log('[STAFF TRACE] 3. SyncCore Outbound:', JSON.stringify(staffPayload));
    void this.dispatchEnvelope('staff', staff.id, staffPayload, {
      action: 'UPSERT',
      targetBranchId: 'ALL',
      updatedAt: staff.updatedAt,
      topicSuffix: 'staff',
      packetId,
      meta: {
        isReconPush,
        version: staffPayload.version,
        mutationSource: staffPayload.mutationSource,
      },
    });
    this.addLog('BROADCAST', `Staff account ${staff.name} (${staff.id} - ${staff.role}) broadcasted to WiFi mesh (PIN protected)`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast 52 Granular Permissions Matrix rules across Local Hub & mesh peers
   */
  public broadcastPermissionsMatrix(rules?: any[], updatedAt?: number) {
    if (this.isIngestingFromHub) return;
    const effectiveRules = Array.isArray(rules) && rules.length > 0 ? rules : getPermissionsList();
    const effectiveUpdatedAt = updatedAt || getPermissionsMatrixUpdatedAt() || Date.now();
    const packetId = `PERMS-PKT-${effectiveUpdatedAt}`;

    void this.dispatchEnvelope(
      'permissions_matrix',
      'PERMISSIONS_MATRIX_CONFIG',
      { rules: effectiveRules, updatedAt: effectiveUpdatedAt },
      {
        action: 'UPSERT',
        targetBranchId: 'ALL',
        updatedAt: effectiveUpdatedAt,
        topicSuffix: 'permissions_matrix',
        packetId,
      }
    );
    this.addLog('BROADCAST', `Granular Permissions Matrix (${effectiveRules.length} rules) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast Role Configurations & Module Access definitions across Local Hub & mesh peers
   */
  public broadcastRoleDefinitions(defs?: Record<string, any>, updatedAt?: number) {
    if (this.isIngestingFromHub) return;
    const effectiveDefs = defs && typeof defs === 'object' ? defs : getStoredRoleDefinitions();
    const effectiveUpdatedAt = updatedAt || getRoleDefinitionsUpdatedAt() || Date.now();
    const packetId = `ROLES-PKT-${effectiveUpdatedAt}`;

    void this.dispatchEnvelope(
      'role_configs',
      'ROLE_CONFIGS_DEFINITIONS',
      { definitions: effectiveDefs, updatedAt: effectiveUpdatedAt },
      {
        action: 'UPSERT',
        targetBranchId: 'ALL',
        updatedAt: effectiveUpdatedAt,
        topicSuffix: 'role_configs',
        packetId,
      }
    );
    this.addLog('BROADCAST', `Role Configurations & Module Access broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast Multi-Currency & Exchange Rates configuration (T2 LWW) across Local Hub & mesh peers
   */
  public broadcastMultiCurrencyConfig(config?: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    const effectiveConfig = config && config.rates ? config : getMultiCurrencyConfig();
    const effectiveUpdatedAt = getMultiCurrencyUpdatedAt(effectiveConfig) || Date.now();
    if (!isReconPush && effectiveUpdatedAt === 0) return;

    const packetId = `CURR-PKT-${effectiveUpdatedAt}-${Math.random().toString(36).substring(2, 5)}`;

    const payloadConfig = {
      ...effectiveConfig,
      companyId: effectiveConfig.companyId || this.config.companyId,
      updatedAt: effectiveUpdatedAt,
      lastUpdated: effectiveConfig.lastUpdated || new Date(effectiveUpdatedAt).toISOString(),
      isSystemDefault: false,
    };

    void this.dispatchEnvelope('multi_currency', 'MULTI_CURRENCY_CONFIG', payloadConfig, {
      action: 'UPSERT',
      targetBranchId: 'ALL',
      updatedAt: effectiveUpdatedAt,
      topicSuffix: 'multi_currency',
      packetId,
      meta: { isReconPush },
    });
    this.addLog(
      'BROADCAST',
      `Multi-Currency & Exchange Rates (Base: ${payloadConfig.baseCurrency || 'USD'}) broadcasted to WiFi mesh`,
      this.config.deviceName
    );
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast a customer profile creation or credit limit update to peers & Hub
   */
  public broadcastCustomer(customer: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!customer) return;
    if (!isReconPush && (customer.fromMesh || (customer as any).fromSync)) return;

    customer.updatedAt = customer.updatedAt || Date.now();
    customer.lastUpdated = customer.lastUpdated || new Date().toISOString();

    const custId = customer.customerId || customer.id || 'C_NEW';
    const packetId = `CUST-PKT-${custId}-${Date.now()}`;

    void this.dispatchEnvelope('customer', custId, customer, {
      action: 'UPSERT',
      updatedAt: customer.updatedAt,
      topicSuffix: 'customer',
      packetId,
      meta: { isReconPush },
    });
    this.addLog('BROADCAST', `Customer account ${customer.name} (${custId}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast a supplier creation or update to peers & Hub so cashiers across devices can select them
   */
  public broadcastSupplier(supplier: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!supplier) return;
    if (!isReconPush && (supplier.fromMesh || (supplier as any).fromSync)) return;

    supplier.updatedAt = supplier.updatedAt || Date.now();
    supplier.lastUpdated = supplier.lastUpdated || new Date().toISOString();

    const suppId = supplier.supplierId || supplier.id || 'SUP_NEW';
    const packetId = `SUPP-PKT-${suppId}-${Date.now()}`;

    void this.dispatchEnvelope('supplier', suppId, supplier, {
      action: 'UPSERT',
      updatedAt: supplier.updatedAt,
      topicSuffix: 'supplier',
      packetId,
      meta: { isReconPush },
    });
    this.addLog('BROADCAST', `Supplier ${supplier.name} (${suppId}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast customer change entry (Form 3) to peers & Hub
   */
  public broadcastCustomerChange(change: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!change) return;
    if (!isReconPush && (change.fromMesh || change.fromSync)) return;

    const id = change.id || change.changeId || `CHG-${Date.now()}`;
    const packetId = `CHG-PKT-${id}-${Date.now()}`;

    void this.dispatchEnvelope('customer_change', id, change, {
      action: 'APPEND',
      topicSuffix: 'customer_change',
      packetId,
      meta: { isReconPush },
    });
    this.addLog('BROADCAST', `Customer change voucher for ${change.customerName} ($${change.in || change.out || 0}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast customer credit sale / debt payment (Form 3) to peers & Hub
   */
  public broadcastCreditSale(credit: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!credit) return;
    if (!isReconPush && (credit.fromMesh || credit.fromSync)) return;

    const id = credit.id || credit.creditId || `CR-${Date.now()}`;
    const packetId = `CRD-PKT-${id}-${Date.now()}`;

    void this.dispatchEnvelope('credit_sale', id, credit, {
      action: 'APPEND',
      topicSuffix: 'credit_sale',
      packetId,
      meta: { isReconPush },
    });
    this.addLog('BROADCAST', `Credit transaction for ${credit.customerName} ($${credit.amount || credit.in || credit.out || 0}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast expense creation, supervisor approval, or rejection to peers & Hub
   */
  public broadcastExpense(expense: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!expense || !expense.id) return;
    const expStatusLower = String(expense.status || '').toLowerCase();
    const isFinalizedDecision = expStatusLower === 'approved' || expStatusLower === 'rejected';
    if (!isReconPush && !isFinalizedDecision && (expense.fromMesh || expense.fromSync)) return;

    const cleanRec: any = {
      ...expense,
      updatedAt: expense.updatedAt || Date.now(),
      lastUpdated: expense.lastUpdated || new Date().toISOString(),
    };
    delete cleanRec.fromMesh;
    delete cleanRec.fromSync;

    const packetId = `EXP-PKT-${cleanRec.id}-${Date.now()}`;
    void this.dispatchEnvelope('expense', cleanRec.id, cleanRec, {
      action: expStatusLower && expStatusLower !== 'pending' && expStatusLower !== 'pending_supervisor' ? 'UPSERT' : 'APPEND',
      updatedAt: cleanRec.updatedAt,
      topicSuffix: 'expense',
      packetId,
      meta: { isReconPush },
    });
    this.addLog('BROADCAST', `Expense #${cleanRec.id} (${cleanRec.status}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast Direct GRV creation, supervisor approval, or rejection to peers & Hub
   */
  public broadcastDirectGrv(grv: DirectGrv, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!grv || (!grv.id && !grv.grvNumber)) return;
    const grvStatusUpper = String(grv.status || '').toUpperCase();
    const isFinalizedDecision = grvStatusUpper === 'APPROVED' || grvStatusUpper === 'REJECTED';
    if (!isReconPush && !isFinalizedDecision && ((grv as any).fromMesh || (grv as any).fromSync)) return;

    const cleanRec: any = {
      ...grv,
      updatedAt: (grv as any).updatedAt || Date.now(),
      lastUpdated: (grv as any).lastUpdated || new Date().toISOString(),
    };
    delete cleanRec.fromMesh;
    delete cleanRec.fromSync;

    const gId = cleanRec.grvNumber || cleanRec.id;
    const packetId = `GRV-PKT-${gId}-${Date.now()}`;

    void this.dispatchEnvelope('direct_grv', gId, cleanRec, {
      action: grvStatusUpper && grvStatusUpper !== 'PENDING' ? 'UPSERT' : 'APPEND',
      updatedAt: cleanRec.updatedAt,
      topicSuffix: 'direct_grv',
      packetId,
      meta: { isReconPush },
    });
    this.addLog('BROADCAST', `Direct GRV ${gId} (${cleanRec.status}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast Shop Use / Internal Consumption creation, approval, or rejection to peers & Hub
   */
  public broadcastInternalConsumption(record: InternalConsumption, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!record || !record.id) return;

    const cleanRec: any = {
      ...record,
      updatedAt: record.updatedAt || Date.now(),
      lastUpdated: record.lastUpdated || new Date().toISOString(),
    };
    delete cleanRec.fromMesh;
    delete cleanRec.fromSync;
    const icStatusUpper = String(cleanRec.status || '').toUpperCase();
    const packetId = `IC-PKT-${cleanRec.id}-${Date.now()}`;

    void this.dispatchEnvelope('internal_consumption', cleanRec.id, cleanRec, {
      action: icStatusUpper && icStatusUpper !== 'PENDING' ? 'UPSERT' : 'APPEND',
      updatedAt: cleanRec.updatedAt,
      topicSuffix: 'internal_consumption',
      packetId,
      meta: { isReconPush },
    });
    this.addLog('BROADCAST', `Shop Use #${cleanRec.id} (${cleanRec.status}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast a branch creation or edit to peers & Hub
   */
  public broadcastBranch(branch: any, opts?: { isReconPush?: boolean }) {
    if (this.isIngestingFromHub && !opts?.isReconPush) return;
    if (!branch) return;
    if (!opts?.isReconPush && (branch.fromMesh || (branch as any).fromSync)) return;

    const rawId = String(branch.branchId || branch.id || (branch as any).branch_id || (branch as any).BranchID || 'BR-MAIN').trim();
    const lowerId = rawId.toLowerCase();
    const bId = lowerId === '1' || lowerId === 'br-main' || lowerId === 'br001' ? 'BR-MAIN' : rawId;
    const cleanBranch = { ...branch, branchId: bId, id: bId, branch_id: bId };
    cleanBranch.updatedAt = cleanBranch.updatedAt || Date.now();
    cleanBranch.lastUpdated = cleanBranch.lastUpdated || new Date(cleanBranch.updatedAt).toISOString();

    const packetId = `BRANCH-PKT-${bId}-${Date.now()}`;
    void this.dispatchEnvelope('branch', bId, cleanBranch, {
      action: 'UPSERT',
      targetBranchId: 'ALL',
      updatedAt: cleanBranch.updatedAt,
      topicSuffix: 'branch',
      packetId,
      ...(opts?.isReconPush ? { meta: { isReconPush: true } } : {}),
    });
    this.addLog('BROADCAST', `Branch [${cleanBranch.name || cleanBranch.branchName || bId}] broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast a cash account creation or edit to peers & Hub
   */
  public broadcastCashAccount(account: any) {
    if (this.isIngestingFromHub) return;
    if (!account) return;
    if (account.fromMesh || (account as any).fromSync) return;

    const accId = account.account_id || account.id || 'ACC_UNKNOWN';
    account.updatedAt = account.updatedAt || Date.now();
    account.lastUpdated = account.lastUpdated || new Date().toISOString();

    const isGlobalAcc =
      account.account_type === 'HQ_SAFE' ||
      account.account_type === 'BANK_ACCOUNT' ||
      String(account.branch_id || '').toUpperCase().trim() === 'HQ' ||
      String(account.target_branch_id || '').toUpperCase().trim() === 'ALL';

    const packetId = `CASHACC-PKT-${accId}-${Date.now()}`;
    void this.dispatchEnvelope('cash_account', accId, account, {
      action: 'UPSERT',
      targetBranchId: isGlobalAcc ? 'ALL' : (account.branch_id || this.config.branchId),
      updatedAt: account.updatedAt,
      topicSuffix: 'cash_account',
      packetId,
    });
    this.addLog('BROADCAST', `Cash Account [${account.account_name || accId}] broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast a cash transfer voucher (creation, HQ transit, receipt, return, approval) via SyncCore
   */
  public broadcastCashTransfer(transfer: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!transfer) return;
    if (!isReconPush && (transfer.fromMesh || transfer.fromSync)) return;

    const tId = String(transfer.transfer_id || transfer.id || '').trim();
    if (!tId) return;

    const updatedAt = transfer.updatedAt || Date.now();
    const lastUpdated = transfer.lastUpdated || new Date(updatedAt).toISOString();
    const typeUpper = String(transfer.type || '').toUpperCase().trim();
    const brUpper = String(transfer.branch_id || '').toUpperCase().trim();
    const isGlobalTransfer =
      brUpper === 'HQ' ||
      brUpper === 'ALL' ||
      String(transfer.target_branch_id || '').toUpperCase().trim() === 'ALL' ||
      typeUpper === 'HQ_TO_BRANCH' ||
      typeUpper === 'BRANCH_TO_HQ' ||
      typeUpper === 'BANK_DEPOSIT' ||
      typeUpper === 'BANK_WITHDRAWAL' ||
      typeUpper === 'ELECTRONIC_SETTLEMENT' ||
      typeUpper === 'CAPITAL_INFUSION' ||
      typeUpper === 'SUPPLIER_PAYMENT' ||
      typeUpper === 'THIRD_PARTY_PAYOUT';

    const cleanTransfer: any = {
      ...transfer,
      transfer_id: tId,
      target_branch_id: isGlobalTransfer ? 'ALL' : (transfer.target_branch_id || transfer.branch_id || this.config.branchId),
      updatedAt,
      lastUpdated,
    };
    delete cleanTransfer.fromMesh;
    delete cleanTransfer.fromSync;

    const packetId = `TRF-PKT-${tId}-${updatedAt}`;
    void this.dispatchEnvelope('cash_transfer', tId, cleanTransfer, {
      action: cleanTransfer.status && cleanTransfer.status !== 'DRAFT' ? 'UPSERT' : 'APPEND',
      targetBranchId: isGlobalTransfer ? 'ALL' : (cleanTransfer.branch_id || this.config.branchId),
      updatedAt,
      topicSuffix: 'cash_transfer',
      packetId,
      meta: {
        wireAction: cleanTransfer.status && cleanTransfer.status !== 'DRAFT' ? 'CASH_TRANSFER_UPDATE' : 'CASH_TRANSFER',
        isReconPush,
      },
    });
    this.addLog('BROADCAST', `Cash Transfer ${tId} (${cleanTransfer.status || 'NEW'}) broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast an Electronic Settlement (EcoCash / ZiG Form 4 confirmation) via SyncCore
   * to Local Hub, active Cloud backend (GAS / Supabase / MongoDB), and mesh peers.
   */
  public broadcastElectronicSettlement(settlement: any, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!settlement) return;
    if (!isReconPush && (settlement.fromMesh || settlement.fromSync)) return;

    const sId = String(settlement.id || `SETTLE-${settlement.date}-${settlement.branchId || this.config.branchId || 'BR-MAIN'}`).trim();
    if (!sId) return;

    const updatedAt = settlement.updatedAt || Date.now();
    const lastUpdated = settlement.lastUpdated || new Date(updatedAt).toISOString();
    const cleanSettlement: any = {
      ...settlement,
      id: sId,
      companyId: settlement.companyId || settlement.company_id || this.config.companyId,
      company_id: settlement.company_id || settlement.companyId || this.config.companyId,
      branchId: settlement.branchId || settlement.branch_id || this.config.branchId || 'BR-MAIN',
      branch_id: settlement.branch_id || settlement.branchId || this.config.branchId || 'BR-MAIN',
      target_branch_id: 'ALL',
      updatedAt,
      lastUpdated,
    };
    delete cleanSettlement.fromMesh;
    delete cleanSettlement.fromSync;

    const packetId = `STL-PKT-${sId}-${updatedAt}`;
    void this.dispatchEnvelope('electronic_settlement', sId, cleanSettlement, {
      action: 'UPSERT',
      targetBranchId: 'ALL',
      updatedAt,
      topicSuffix: 'electronic_settlement',
      packetId,
      meta: {
        wireAction: 'SETTLEMENT_SYNC',
        isReconPush,
      },
    });
    this.addLog('BROADCAST', `Electronic Settlement ${sId} (${cleanSettlement.date}) broadcasted to SyncCore & mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  /**
   * Broadcast an individual cash drawer movement (refund, change, credit payment, float)
   */
  public broadcastCashMovement(movement: any) {
    if (this.isIngestingFromHub) return;
    if (!movement || !movement.id) return;
    if (movement.fromMesh) return;

    const packetId = `MOV-PKT-${movement.id}-${Date.now()}`;
    void this.dispatchEnvelope('cash_movement', movement.id, movement, {
      action: 'APPEND',
      topicSuffix: 'cash_movement',
      packetId,
    });
    this.addLog('BROADCAST', `Cash Movement [${movement.type}] $${movement.amount} broadcasted to WiFi mesh`, this.config.deviceName);
    this.notifyPeerSubscribers();
  }

  public broadcastInventoryItem(item: InventoryItem, explicitTimestamp?: number, options?: { isReconPush?: boolean }) {
    const isReconPush = Boolean(options?.isReconPush);
    if (this.isIngestingFromHub && !isReconPush) return;
    if (!item) return;
    delete (item as any).fromMesh;

    const cleanId = (item.itemId || item.id || '').trim();
    const callTime = Date.now();
    console.log('[DEBUG] broadcastInventoryItem called for:', item.itemId || item.id, 'at:', callTime);

    if (cleanId && !isReconPush) {
      const prev = this.lastBroadcastByItemId.get(cleanId);
      if (prev && callTime - prev < 500) {
        return; // Ignore duplicate broadcast within 500ms
      }
      this.lastBroadcastByItemId.set(cleanId, callTime);
    }

    const now = explicitTimestamp || callTime;
    const nowIso = new Date(now).toISOString();
    item.updatedAt = now;
    (item as any).hubTimestamp = now;
    item.lastUpdated = nowIso;

    console.log('[DEBUG] Broadcasting price to Hub:', item.itemName);

    const packetId = `ITEM-UPDATE-${cleanId || now}-${now}-${Math.random().toString(36).substring(2, 6)}`;
    const enrichedItem = {
      ...item,
      totalUnits: Number(item.totalUnits || 0),
      stockSingles: Number(item.stockSingles !== undefined ? item.stockSingles : item.totalUnits || 0),
      snapshotTimestamp: now,
      updatedAt: now,
      hubTimestamp: now,
      lastUpdated: nowIso,
    };

    void this.dispatchEnvelope('inventory_item', cleanId || String(now), enrichedItem, {
      action: 'UPSERT',
      targetBranchId: 'ALL',
      updatedAt: now,
      topicSuffix: 'inventory',
      packetId,
      meta: { isReconPush },
    });

    this.addLog(
      'BROADCAST',
      `Product "${item.itemName}" Price: $${(item.sellPriceUnit || 0).toFixed(2)} (${cleanId}) broadcasted to Local Hub & mesh (target: ALL)`,
      this.config.deviceName,
      undefined,
      5,
      cleanId
    );

    this.notifyPeerSubscribers();
  }

  public broadcastInventoryUpdate = (item: InventoryItem) => this.broadcastInventoryItem(item);

  /**
   * Broadcasts a tombstone (soft delete) to the Hub and peers
   */
  public broadcastTombstone(entityType: string, entityId: string) {
    if (this.isIngestingFromHub || !entityType || !entityId) return;
    const cleanId = String(entityId).trim();
    const cleanType = String(entityType).trim().toLowerCase();
    const now = Date.now();
    const packetId = `TOMB-PKT-${cleanType}-${cleanId}-${now}`;

    const tombstone = {
      id: `TOMB-${cleanType}-${cleanId}`,
      entityType: cleanType,
      entityId: cleanId,
      isDeleted: true,
      deletedAt: now,
      deletedAtIso: new Date(now).toISOString(),
      company_id: this.config.companyId,
      branch_id: this.config.branchId,
    };

    void this.dispatchEnvelope('tombstone', cleanId, tombstone, {
      action: 'APPEND',
      targetBranchId: 'ALL',
      updatedAt: now,
      topicSuffix: 'tombstone',
      packetId,
    });
    this.addLog('BROADCAST', `Soft deleted ${cleanType} #${cleanId} broadcasted to Hub & peers`, this.config.deviceName, undefined, 5, cleanId);
  }

  /**
   * Resets all T2 Catalog High Water Marks to 0 to force complete catalog re-sync
   */
  public async resetCatalogHwmToZero(): Promise<void> {
    await this.setLastInventorySyncTimestamp(0);
    this.setLastMeshSyncTimestamp('0');
    setLastStaffSync(0);
    setLastBranchSync(0);
    setLastCustomerSync(0);
    setLastCashAccountSync(0);
    setLastCasualWorkerSync(0);
    setLastStocktakeSessionSync(0);
    console.log('[Sync Manager] Reset all T2 Catalog HWMs to 0.');
    await this.requestCatchUpSync('ALL', '0', false, true);
  }

  /**
   * Resets T1 Transaction High Water Mark back to a chosen date to catch up transactions
   */
  public async resetTransactionHwm(dateStr: string): Promise<void> {
    const timestampMs = dateStr ? new Date(dateStr).getTime() : 0;
    const targetIso = !isNaN(timestampMs) && timestampMs > 0 ? new Date(timestampMs).toISOString() : new Date(0).toISOString();
    console.log(`[Sync Manager] Force Transaction Sync starting from ${targetIso}`);
    await this.requestCatchUpSync('ALL', targetIso, false, true);
  }

  /**
   * Requests an authoritative T2 Inventory Snapshot from the Hub
   */
  public requestInventorySnapshot() {
    if (!this.localHubAdapter.isConnected()) return;
    const pkt = {
      type: 'INVENTORY_SNAPSHOT_REQUEST',
      action: 'INVENTORY_SNAPSHOT_REQUEST',
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      originDeviceId: this.config.deviceId,
      timestamp: Date.now(),
    };
    if (this.localHubAdapter.sendControlPacket(pkt)) {
      console.log('[Snapshot Heartbeat] 📸 Requested 10-minute T2 Inventory Snapshot from Local Hub');
    }
  }

  /**
   * Fetches historical T1 transactions on-demand from the Hub without saving to local IndexedDB
   */
  public async fetchHistoricalT1(targetEntity: string, startDate?: string, endDate?: string): Promise<any[]> {
    if (!this.localHubAdapter.isConnected()) {
      throw new Error('Local Hub is not connected. Historical fetch requires active Hub connection.');
    }
    const requestId = `HIST-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const pkt = {
      type: 'FETCH_HISTORICAL_T1',
      action: 'FETCH_HISTORICAL_T1',
      requestId,
      targetEntity,
      startDate: startDate || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      endDate: endDate || new Date().toISOString(),
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      originDeviceId: this.config.deviceId,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('saimetric_historical_response' as any, listener);
        reject(new Error('Historical fetch timed out after 10s'));
      }, 10000);

      const listener = (event: any) => {
        if (event.detail && event.detail.requestId === requestId) {
          clearTimeout(timeout);
          window.removeEventListener('saimetric_historical_response' as any, listener);
          resolve(event.detail.records || []);
        }
      };

      window.addEventListener('saimetric_historical_response' as any, listener);
      if (!this.localHubAdapter.sendControlPacket(pkt)) {
        clearTimeout(timeout);
        window.removeEventListener('saimetric_historical_response' as any, listener);
        reject(new Error('Failed to send historical T1 request to Local Hub'));
      }
    });
  }

  /**
   * Requests server-side aggregated financial report from the Local Hub
   */
  public async fetchFinancialReport(startDate?: string, endDate?: string): Promise<any> {
    if (!this.localHubAdapter.isConnected()) {
      throw new Error('Local Hub is not connected. Server-side report requires active Hub connection.');
    }
    const requestId = `RPT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const pkt = {
      type: 'GET_FINANCIAL_REPORT',
      action: 'GET_FINANCIAL_REPORT',
      requestId,
      startDate: startDate || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      endDate: endDate || new Date().toISOString(),
      companyId: this.config.companyId,
      branchId: this.config.branchId,
      originDeviceId: this.config.deviceId,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('saimetric_financial_report_response' as any, listener);
        reject(new Error('Financial report request timed out after 10s'));
      }, 10000);

      const listener = (event: any) => {
        if (event.detail && event.detail.requestId === requestId) {
          clearTimeout(timeout);
          window.removeEventListener('saimetric_financial_report_response' as any, listener);
          resolve(event.detail.report || null);
        }
      };

      window.addEventListener('saimetric_financial_report_response' as any, listener);
      if (!this.localHubAdapter.sendControlPacket(pkt)) {
        clearTimeout(timeout);
        window.removeEventListener('saimetric_financial_report_response' as any, listener);
        reject(new Error('Failed to send financial report request to Local Hub'));
      }
    });
  }

  public broadcastDatabaseMutation(mutation: DatabaseMutationEvent) {
    if (this.isIngestingFromHub) return;
    if (mutation.fromSync === true || (mutation as any).payload?.fromSync === true) return;

    // Fix B: Suppress duplicate db_mutation network broadcasts for the 6 T2 entities
    // Dedicated broadcast handlers already broadcast these with LWW timestamps.
    const rawTarget = String(mutation.sheetName || mutation.entityType || '').toLowerCase().trim();
    const isT2Entity =
      rawTarget === 'salespeople' ||
      rawTarget === 'users' ||
      rawTarget === 'staff' ||
      rawTarget === 'branches' ||
      rawTarget === 'branch' ||
      rawTarget === 'customers' ||
      rawTarget === 'customer' ||
      rawTarget === 'cashaccounts' ||
      rawTarget === 'cash_accounts' ||
      rawTarget === 'cash_account' ||
      rawTarget === 'temporary_casuals' ||
      rawTarget === 'temporary_casual_accounts' ||
      rawTarget === 'casual_workers' ||
      rawTarget === 'casual_worker' ||
      rawTarget === 'stocktake_sessions' ||
      rawTarget === 'stocktake_session' ||
      rawTarget === 'stocktake' ||
      rawTarget === 'daily_blind_config' ||
      rawTarget === 'daily_blind_configs' ||
      rawTarget === 'dailyblindconfigs' ||
      rawTarget === 'daily_blind_count' ||
      rawTarget === 'daily_blind_counts' ||
      rawTarget === 'dailyblindcounts';

    if (isT2Entity) {
      return;
    }

    // CashLog and CashTransfer mutations are already broadcasted cleanly via dedicated SyncCore handlers
    if (
      (rawTarget === 'cashlog' ||
        rawTarget === 'cash_log' ||
        rawTarget === 'cash_logs' ||
        rawTarget === 'cashtransfer' ||
        rawTarget === 'cashtransfers' ||
        rawTarget === 'cash_transfer' ||
        rawTarget === 'cash_transfers') &&
      mutation.action !== 'DELETE'
    ) {
      return;
    }

    // Form 4 Reconciliation approvals/rejections: dispatch directly as 'reconciliation'
    // so Universal Hub stores & catches them up via genericEnvelopes AND peers apply via case 'reconciliation'.
    if (rawTarget === 'reconciliations' || rawTarget === 'reconciliation') {
      const recPayload: any = { ...(mutation.payload || {}) };
      delete recPayload.fromMesh;
      delete recPayload.fromSync;
      const recId = String(mutation.recordId || recPayload.id || `REC-${Date.now()}`).trim();
      const updatedAt = recPayload.updatedAt || Date.now();
      recPayload.updatedAt = updatedAt;
      recPayload.lastUpdated = recPayload.lastUpdated || new Date(updatedAt).toISOString();
      const packetId = `REC-PKT-${recId}-${updatedAt}`;
      void this.dispatchEnvelope('reconciliation', recId, recPayload, {
        action: 'UPSERT',
        updatedAt,
        topicSuffix: 'reconciliation',
        packetId,
      });
      this.addLog(
        'BROADCAST',
        `Form 4 Reconciliation #${recId} (${recPayload.status || 'SAVED'}) broadcasted to WiFi mesh.`,
        this.config.deviceName
      );
      this.notifyPeerSubscribers();
      return;
    }

    // Form 1 Cash Counts: dispatch directly as 'cash_count' so LocalHubAdapter emits APK-compatible
    // CASH_COUNT (with sheetName: 'CashCounts'), Cloud Sync maps to 'cash_counts', and peers accept edits.
    if (rawTarget === 'cashcounts' || rawTarget === 'cash_count' || rawTarget === 'cash_counts') {
      const ccPayload: any = { ...(mutation.payload || {}) };
      delete ccPayload.fromMesh;
      delete ccPayload.fromSync;
      const ccId = String(mutation.recordId || ccPayload.id || `CNT-${Date.now()}`).trim();
      const updatedAt = ccPayload.updatedAt || Date.now();
      ccPayload.id = ccId;
      ccPayload.updatedAt = updatedAt;
      ccPayload.lastUpdated = ccPayload.lastUpdated || new Date(updatedAt).toISOString();
      const packetId = `CC-PKT-${ccId}-${updatedAt}`;
      void this.dispatchEnvelope('cash_count', ccId, ccPayload, {
        action: 'UPSERT',
        updatedAt,
        topicSuffix: 'cash_count',
        packetId,
      });
      this.addLog(
        'BROADCAST',
        `Form 1 Cash Count #${ccId} ($${Number(ccPayload.finalCashOutTotal || 0).toFixed(2)}) broadcasted to WiFi mesh.`,
        this.config.deviceName
      );
      this.notifyPeerSubscribers();
      return;
    }

    const packetId = `MUT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const mutAction: SyncAction = mutation.action === 'DELETE' ? 'DELETE' : 'UPSERT';
    void this.dispatchEnvelope('sheet_mutation', String(mutation.recordId || packetId), mutation.payload, {
      action: mutAction,
      topicSuffix: 'mutation',
      packetId,
      meta: {
        mutationEntityType: mutation.entityType,
        sheetName: mutation.sheetName,
        clientRequestId: mutation.clientRequestId,
      },
    });

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

    this.mirrorToSecondaryP2PTransports('ping', packet);
    this.addLog('BROADCAST', `Sent live test ping: "${message}"`, this.config.deviceName);
    return true;
  }

  // =========================================================================
  // PEER LIST COMPUTATION
  // =========================================================================
  public getOnlineDeviceCount(): number {
    if (this.virtualMeshSimulator.isSimulationActive()) {
      return this.virtualMeshSimulator.getOnlineSimulatedCount();
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

  private peerNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private logNotifyTimer: ReturnType<typeof setTimeout> | null = null;

  private notifyPeerSubscribers(force: boolean = false) {
    if (!force && this.isIngestingFromHub) {
      if (!this.peerNotifyTimer) {
        this.peerNotifyTimer = setTimeout(() => {
          this.peerNotifyTimer = null;
          this.notifyPeerSubscribers(false);
        }, 450);
      }
      return;
    }

    if (!force) {
      if (this.peerNotifyTimer) return;
      this.peerNotifyTimer = setTimeout(() => {
        this.peerNotifyTimer = null;
        this.flushPeerSubscribers(false);
      }, 300);
      return;
    }

    if (this.peerNotifyTimer) {
      clearTimeout(this.peerNotifyTimer);
      this.peerNotifyTimer = null;
    }
    this.flushPeerSubscribers(true);
  }

  private flushPeerSubscribers(force: boolean = false) {
    if (this.peerListeners.length === 0) return;
    let count: number;
    let peersList: P2PMeshPeer[];

    if (this.virtualMeshSimulator.isSimulationActive()) {
      const sim = this.virtualMeshSimulator.getSimulatedPeersSnapshot();
      count = sim.count;
      peersList = sim.peers;
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

    if (this.logListeners.length === 0) return;
    if (!this.logNotifyTimer) {
      this.logNotifyTimer = setTimeout(() => {
        this.logNotifyTimer = null;
        if (this.logListeners.length === 0) return;
        const snapshot = [...this.logs];
        this.logListeners.forEach((fn) => {
          try {
            fn(snapshot);
          } catch (e) {}
        });
      }, 250);
    }
  }

  // =========================================================================
  // SIMULATION & TEST PLAN LAB (DELEGATED TO src/services/mesh/virtualMeshSimulator.ts)
  // =========================================================================
  public setSimulationMode(active: boolean) {
    this.virtualMeshSimulator.setSimulationMode(active);
  }

  public isSimulationActive(): boolean {
    return this.virtualMeshSimulator.isSimulationActive();
  }

  public initVirtualMeshDefault() {
    this.virtualMeshSimulator.initVirtualMeshDefault();
  }

  public getVirtualDevices(): VirtualDevice[] {
    return this.virtualMeshSimulator.getVirtualDevices();
  }

  public addVirtualDevice(name?: string): VirtualDevice {
    return this.virtualMeshSimulator.addVirtualDevice(name);
  }

  public toggleDeviceOnline(deviceId: string) {
    this.virtualMeshSimulator.toggleDeviceOnline(deviceId);
  }

  public toggleDeviceInternet(deviceId: string) {
    this.virtualMeshSimulator.toggleDeviceInternet(deviceId);
  }

  public makeSaleOnDevice(deviceId: string, amount: number = 45.0, customerName: string = 'Walk-in') {
    return this.virtualMeshSimulator.makeSaleOnDevice(deviceId, amount, customerName);
  }

  public async triggerOpportunisticCloudSync(deviceId?: string): Promise<{ syncedCount: number }> {
    return this.virtualMeshSimulator.triggerOpportunisticCloudSync(deviceId);
  }

  private startOpportunisticCloudSyncTimer() {
    this.opportunisticTimer = window.setInterval(async () => {
      const cloudAdapter = this.getOrCreateSingleCloudAdapter();
      if ((this.isLocalHubActive() && !this.isCloudOnlyMode) || cloudAdapter.isPaused?.()) {
        return;
      }
      if (!this.shouldThisTerminalRelayToCloud()) {
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          // Pull BEFORE pushing so a fresh device never skips older cloud data,
          // and pass 0 so AppScriptsAdapter uses its persisted server_seq cursor (or full seq=0 on first pull).
          await cloudAdapter.requestCatchUp(0);
          await cloudAdapter.drainOfflineQueue();
        } catch (e) {}
      }
    }, 120000);
  }

  public async executeOfficialTestPlan(
    onStepUpdate?: (step: number, title: string, details: string) => void
  ): Promise<boolean> {
    return this.virtualMeshSimulator.executeOfficialTestPlan(onStepUpdate);
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

  public async simulateTornadoBurst(
    numDevices: number = 5,
    salesPerDevice: number = 10
  ) {
    return this.virtualMeshSimulator.simulateTornadoBurst(numDevices, salesPerDevice);
  }

  // =========================================================================
  // BLIND DOUBLE-COUNT STOCKTAKE & ZONE CLAIMING PROTOCOL DISPATCHERS
  // (DELEGATED TO src/services/mesh/stocktakeMeshTransport.ts)
  // =========================================================================
  public claimStocktakeZone(
    sessionId: string,
    zoneId: string,
    slot: 'A' | 'B',
    staffId: string,
    staffName: string,
    zoneName?: string
  ): void {
    this.stocktakeTransport.claimStocktakeZone(sessionId, zoneId, slot, staffId, staffName, zoneName);
  }

  public submitBlindStocktakeCount(
    sessionId: string,
    zoneId: string,
    slot: 'A' | 'B' | 'RECOUNT',
    staffId: string,
    staffName: string,
    lines: any[]
  ): void {
    this.stocktakeTransport.submitBlindStocktakeCount(sessionId, zoneId, slot, staffId, staffName, lines);
  }

  public proposeJointRecount(
    sessionId: string,
    zoneId: string,
    slot: 'A' | 'B',
    staffName: string,
    lines: any[]
  ): void {
    this.stocktakeTransport.proposeJointRecount(sessionId, zoneId, slot, staffName, lines);
  }

  public finalizeJointRecount(
    sessionId: string,
    zoneId: string,
    resolvedLines: any[],
    resolvedByName: string
  ): void {
    this.stocktakeTransport.finalizeJointRecount(sessionId, zoneId, resolvedLines, resolvedByName);
  }

  public unlockStocktakeSegment(
    sessionId: string,
    segmentId: string,
    target: 'A' | 'B' | 'COMPARISON' | 'ALL',
    actorId: string,
    actorName: string,
    reason: string
  ): void {
    this.stocktakeTransport.unlockStocktakeSegment(sessionId, segmentId, target, actorId, actorName, reason);
  }

  public broadcastCasualWorkers(casuals: any[]): void {
    this.stocktakeTransport.broadcastCasualWorkers(casuals);
  }

  public broadcastStocktakeLockdown(
    branchId: string,
    sessionId: string,
    isLocked: boolean,
    lockedByName: string,
    reason?: string,
    lockedBy?: string
  ): void {
    this.stocktakeTransport.broadcastStocktakeLockdown(branchId, sessionId, isLocked, lockedByName, reason, lockedBy);
  }

  public requestStocktakeSessionList(): void {
    this.stocktakeTransport.requestStocktakeSessionList();
  }

  public broadcastStocktakeSession(session: StocktakeSession): void {
    this.stocktakeTransport.broadcastStocktakeSession(session);
  }

  public broadcastStocktakeSessionStarted(data: {
    sessionId: string;
    sessionName: string;
    segments: any[];
    startedBy: string;
    startedAt: string;
    countType?: string;
    branchId?: string;
    branchName?: string;
    isLockdownActive?: boolean;
    notes?: string;
    updatedAt?: number | string;
    [key: string]: any;
  }): void {
    this.stocktakeTransport.broadcastStocktakeSessionStarted(data);
  }

  public broadcastStocktakeSegmentCreated(sessionId: string, segment: any): void {
    this.stocktakeTransport.broadcastStocktakeSegmentCreated(sessionId, segment);
  }

  public sendSyncEnvelope(envelope: any): boolean {
    if (!envelope || typeof envelope !== 'object') return false;
    if (envelope.entityType && envelope.packetId) {
      this.syncActiveAdapter();
      void this.syncCore.saveAndSync(envelope as SyncEnvelope).catch(() => {});
      return true;
    }
    return this.localHubAdapter.sendControlPacket(envelope);
  }

  public async drainOfflineQueue(): Promise<void> {
    this.syncActiveAdapter();
    if (this.isLocalHubActive() && !this.isCloudOnlyMode) {
      await this.drainQueueToLocalHub();
    } else {
      const cloudAdapter = this.getOrCreateSingleCloudAdapter();
      await cloudAdapter.drainOfflineQueue();
    }
  }

  /**
   * Immediately performs a pull-first cloud catch-up and queue drain (used on login & branch switch)
   * so second devices see all catalog items, sales, cash logs, and customers without waiting 2 minutes.
   */
  public async triggerCloudSyncNow(forceFullIfFresh: boolean = true): Promise<void> {
    try {
      this.syncActiveAdapter();
      if (this.isLocalHubActive() && !this.isCloudOnlyMode) {
        void this.requestCatchUpSync('ALL', forceFullIfFresh ? undefined : new Date(Date.now() - 3600 * 1000).toISOString(), false, false).catch(() => {});
        return;
      }
      const cloudAdapter = this.getOrCreateSingleCloudAdapter();
      if (cloudAdapter.isPaused?.()) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      await cloudAdapter.requestCatchUp(forceFullIfFresh ? 0 : Date.now() - 3600 * 1000);
      await cloudAdapter.drainOfflineQueue();
    } catch (e) {
      console.warn('[MeshSync] triggerCloudSyncNow warning:', e);
    }
  }

  public disconnect(intentional: boolean = false): void {
    if (intentional) {
      void this.localHubAdapter.disconnect();
      this.isLocalHubConnected = false;
      this.isWsConnected = false;
      if (this.localHubReconnectTimer) {
        clearTimeout(this.localHubReconnectTimer);
        this.localHubReconnectTimer = null;
      }
      this.syncActiveAdapter();
      this.notifyConnectionModeChange();
    } else {
      this.handleLocalHubLost('LocalHubAdapter disconnect');
    }
  }
}

export const meshSyncService = new MeshSyncManager();
export { generateInvoiceNumber, getNextInvoiceId };
export {
  getLastStaffSync,
  setLastStaffSync,
  markStaffSyncComplete,
  SAIMETRIC_LAST_STAFF_SYNC,
  getLastBranchSync,
  setLastBranchSync,
  markBranchSyncComplete,
  SAIMETRIC_LAST_BRANCH_SYNC,
  getLastCustomerSync,
  setLastCustomerSync,
  markCustomerSyncComplete,
  SAIMETRIC_LAST_CUSTOMER_SYNC,
  getLastCashAccountSync,
  setLastCashAccountSync,
  markCashAccountSyncComplete,
  SAIMETRIC_LAST_CASH_ACCOUNT_SYNC,
  getLastCasualWorkerSync,
  setLastCasualWorkerSync,
  markCasualWorkerSyncComplete,
  SAIMETRIC_LAST_CASUAL_WORKER_SYNC,
  getLastStocktakeSessionSync,
  setLastStocktakeSessionSync,
  markStocktakeSessionSyncComplete,
  SAIMETRIC_LAST_STOCKTAKE_SESSION_SYNC,
  getLastMultiCurrencySync,
  setLastMultiCurrencySync,
  markMultiCurrencySyncComplete,
  SAIMETRIC_LAST_MULTI_CURRENCY_SYNC,
};


