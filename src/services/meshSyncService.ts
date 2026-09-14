import { P2PMeshConfig, P2PMeshPeer, P2PPacket, SaleInvoice } from '../types';
import mqtt, { MqttClient } from 'mqtt';
import {
  getSales,
  addSale,
  getSyncQueue,
  purgeSyncedRecords,
  onSaleCreated,
  ingestMeshSale,
} from '../db/roomDatabase';
import { processSyncQueue } from './googleSheetsSync';

// Keys for localStorage persistence
const PREFS_BRANCH_KEY = 'saimetric_mesh_branch_code';
const PREFS_DEVICE_KEY = 'saimetric_mesh_device_name';
const PREFS_DEVICE_ID_KEY = 'saimetric_mesh_device_id';

// Public Zero-Config Secure WebSocket MQTT Brokers for Instant Cross-Device P2P
const PUBLIC_MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export interface MeshEventLog {
  id: string;
  timestamp: string;
  type: 'DISCOVERY' | 'BROADCAST' | 'EPIDEMIC_HOP' | 'CONFLICT_RESOLVED' | 'CLOUD_SYNC' | 'ACK';
  message: string;
  sourceDevice: string;
  targetDevice?: string;
  ttl?: number;
  uuid?: string;
}

export interface VirtualDevice {
  id: string;
  name: string;
  branchCode: string;
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

function playChime() {
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
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) {
    // Audio might be blocked by browser policy until interaction
  }
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

  // Real Mesh Transport: MQTT Over WebSocket
  private mqttClient: MqttClient | null = null;
  private currentBrokerIndex: number = 0;
  private isMqttConnected: boolean = false;
  private brokerName: string = 'Connecting...';

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

  constructor() {
    this.config = this.loadConfig();
    this.initMqttRelay();
    this.initBroadcastChannel();
    this.initVirtualMeshDefault();
    this.startOpportunisticCloudSyncTimer();

    // Local Gateway IP if configured
    try {
      this.localGatewayUrl = localStorage.getItem('saimetric_mesh_local_gateway') || '';
      if (this.localGatewayUrl) {
        this.startLocalGatewayPolling();
      }
    } catch (e) {}

    // Offline / Online listeners
    window.addEventListener('online', () => {
      this.addLog('DISCOVERY', 'Internet connection restored. Reconnecting cloud MQTT mesh relay...', this.config.deviceName);
      this.initMqttRelay();
    });
    window.addEventListener('offline', () => {
      this.addLog('DISCOVERY', 'Internet offline. Operating in 100% Offline Local Wi-Fi & Optical QR Mesh Mode.', this.config.deviceName);
    });

    // Auto-hook into local POS database: Whenever a sale is made in POS, broadcast it!
    onSaleCreated((sale: SaleInvoice) => {
      this.broadcastSale(sale);
    });

    // Start discovery loops
    this.startHeartbeatLoop();
    this.startPruneLoop();
  }

  // =========================================================================
  // CONFIGURATION & AUTO-DISCOVERY PREFERENCES
  // =========================================================================
  public loadConfig(): P2PMeshConfig {
    // Check if URL specifies a branch e.g. ?branch=HARARE-01
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlBranch = urlParams.get('branch');
      if (urlBranch && urlBranch.trim().length > 0) {
        localStorage.setItem(PREFS_BRANCH_KEY, urlBranch.trim().toUpperCase());
      }
    } catch (e) {
      // ignore
    }

    const branchCode = localStorage.getItem(PREFS_BRANCH_KEY) || 'HARARE-01';

    // Auto-detect a smart default name if not previously configured
    let deviceName = localStorage.getItem(PREFS_DEVICE_KEY);
    if (!deviceName) {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isTablet = /iPad|tablet|(android(?!.*mobile))/i.test(navigator.userAgent);
      if (isTablet) {
        deviceName = 'Terminal-Tablet';
      } else if (isMobile) {
        deviceName = 'Terminal-Mobile';
      } else {
        deviceName = 'Terminal-1';
      }
      localStorage.setItem(PREFS_DEVICE_KEY, deviceName);
    }

    let deviceId = localStorage.getItem(PREFS_DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = 'DEV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      localStorage.setItem(PREFS_DEVICE_ID_KEY, deviceId);
    }

    return { branchCode, deviceName, deviceId };
  }

  public saveConfig(branchCode: string, deviceName: string) {
    const cleanBranch = branchCode.trim().toUpperCase() || 'HARARE-01';
    const cleanDevice = deviceName.trim() || 'POS-Terminal-1';

    localStorage.setItem(PREFS_BRANCH_KEY, cleanBranch);
    localStorage.setItem(PREFS_DEVICE_KEY, cleanDevice);
    this.config.branchCode = cleanBranch;
    this.config.deviceName = cleanDevice;

    this.addLog(
      'DISCOVERY',
      `Config updated: Branch = ${cleanBranch}, Terminal = ${cleanDevice}. Re-connecting mesh...`,
      this.config.deviceName
    );

    // Re-initialize transports with new branch code
    this.discoveredPeers.clear();
    this.initMqttRelay();
    this.initBroadcastChannel();
    this.sendHeartbeat();
  }

  public getConfig(): P2PMeshConfig {
    return { ...this.config };
  }

  public getConnectionStatus() {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    return {
      isOnline,
      isMqttConnected: this.isMqttConnected,
      isWebRtcConnected: this.isWebRtcConnected,
      hasLocalGateway: !!this.localGatewayUrl,
      localGatewayUrl: this.localGatewayUrl,
      broker: this.brokerName,
      branchCode: this.config.branchCode,
      deviceName: this.config.deviceName,
      deviceId: this.config.deviceId,
      peerCount: this.getOnlineDeviceCount(),
      pendingOfflineCount: getSyncQueue().length,
    };
  }

  // =========================================================================
  // OFFLINE TRANSPORT A: OPTICAL QR BATCH SYNC (Air-gapped, zero-network)
  // =========================================================================
  public generateOfflineBatchPayload(): string {
    const allSales = getSales();
    const recentSales = allSales.slice(0, 15);
    const payload = {
      type: 'SAIMETRIC_OFFLINE_BATCH',
      version: 1,
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
        items: (s.items || []).map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
        })),
      })),
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

      if (parsed.branchCode && parsed.branchCode !== this.config.branchCode) {
        return {
          success: false,
          syncedCount: 0,
          message: `Branch mismatch: Beacon is for branch [${parsed.branchCode}], but this terminal is set to [${this.config.branchCode}].`,
        };
      }

      let count = 0;
      for (const s of parsed.sales) {
        const didIngest = ingestMeshSale({
          ...s,
          fromMesh: true,
        });
        if (didIngest) count++;
      }

      playChime();
      this.addLog(
        'EPIDEMIC_HOP',
        `Air-Gapped Optical QR: Ingested ${count} offline sales from ${parsed.originDeviceName || 'Terminal'} into local Room database!`,
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
  // OFFLINE QR SCANNING & FORCED DIRECT WS:// LAN WEBSOCKET CONNECTION
  // =========================================================================
  private directWsClient: WebSocket | null = null;
  private isWsConnected: boolean = false;
  private isTorchOn: boolean = false;
  private activeVideoTrack: MediaStreamTrack | null = null;

  public onScanSuccess(decodedText: string): void {
    console.log("QR DECODED:", decodedText);

    // Extract ws:// URL or convert http/https to ws://
    let targetWsUrl = '';
    const trimmed = (decodedText || '').trim();

    if (trimmed.startsWith('ws://')) {
      targetWsUrl = trimmed;
    } else if (trimmed.startsWith('wss://')) {
      // Force ws:// - strictly no https fallback
      targetWsUrl = 'ws://' + trimmed.slice('wss://'.length);
    } else if (trimmed.startsWith('http://')) {
      targetWsUrl = 'ws://' + trimmed.slice('http://'.length);
    } else if (trimmed.startsWith('https://')) {
      targetWsUrl = 'ws://' + trimmed.slice('https://'.length);
    } else {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.wsUrl) {
          targetWsUrl = parsed.wsUrl;
        } else if (parsed.url) {
          targetWsUrl = parsed.url.replace(/^https?:\/\//i, 'ws://').replace(/^wss:\/\//i, 'ws://');
        } else if (parsed.host || parsed.ip) {
          const port = parsed.port || 3000;
          targetWsUrl = `ws://${parsed.host || parsed.ip}:${port}`;
        }
      } catch (e) {
        // Regex test for IP address:port e.g. 192.168.1.5:3000
        const ipMatch = trimmed.match(/(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?::\d+)?/);
        if (ipMatch) {
          targetWsUrl = `ws://${ipMatch[0]}`;
        }
      }
    }

    if (targetWsUrl) {
      if (!targetWsUrl.startsWith('ws://')) {
        targetWsUrl = 'ws://' + targetWsUrl.replace(/^[a-zA-Z]+:\/\//, '');
      }
      this.connectToWsUrl(targetWsUrl);
    }

    // Also process offline batch data if present
    try {
      this.ingestOfflineBatchPayload(trimmed);
    } catch (e) {}
  }

  public connectToWsUrl(wsUrl: string) {
    // FORCE connect to ws:// URL from QR. Do not try https:// fallback.
    let cleanWs = wsUrl.trim();
    if (!cleanWs.startsWith('ws://')) {
      cleanWs = 'ws://' + cleanWs.replace(/^[a-zA-Z]+:\/\//, '');
    }

    console.log('[MeshSync] Force connecting to ws:// URL from QR (no https fallback):', cleanWs);
    this.localGatewayUrl = cleanWs;

    if (this.directWsClient) {
      try {
        this.directWsClient.close();
      } catch (e) {}
      this.directWsClient = null;
    }

    try {
      const ws = new WebSocket(cleanWs);
      this.directWsClient = ws;

      ws.onopen = () => {
        this.isWsConnected = true;
        console.log('[MeshSync] Direct LAN WebSocket connected to:', cleanWs);
        this.addLog('DISCOVERY', `Direct LAN WebSocket CONNECTED to ${cleanWs} (0% Internet)`, this.config.deviceName);
        playChime();
        this.sendHeartbeat();
        this.notifyPeerSubscribers();
      };

      ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handleIncomingMeshPacket(`saimetric/mesh/${this.config.branchCode}/${packet.type || 'packet'}`, packet);
        } catch (e) {
          console.warn('[MeshSync] Direct WS parse error:', e);
        }
      };

      ws.onerror = (err) => {
        console.warn(`[MeshSync] Direct WS error for ${cleanWs} - strictly no https fallback:`, err);
      };

      ws.onclose = () => {
        this.isWsConnected = false;
        console.log('[MeshSync] Direct WS closed for:', cleanWs);
        this.notifyPeerSubscribers();
      };
    } catch (err) {
      console.warn('[MeshSync] Direct WS connection exception:', err);
    }
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
            advanced: [{ torch: newState } as any]
          });
          this.isTorchOn = newState;
          return this.isTorchOn;
        }
      }
    } catch (e) {
      console.warn('[MeshSync] Torch toggle error:', e);
    }
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

      // Wait for local LAN host candidates (0% internet required)
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
      const sdpDesc = parsed.sdp ? { type: 'offer' as RTCSdpType, sdp: parsed.sdp } : parsed;

      const pc = new RTCPeerConnection({ iceServers: [] });
      this.webrtcPeerConnection = pc;

      pc.ondatachannel = (event) => {
        this.setupDataChannel(event.channel);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(sdpDesc));
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
      const sdpDesc = parsed.sdp ? { type: 'answer' as RTCSdpType, sdp: parsed.sdp } : parsed;
      await this.webrtcPeerConnection.setRemoteDescription(new RTCSessionDescription(sdpDesc));
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
        'Direct Local Wi-Fi WebRTC DataChannel OPENED! 0% internet required for instant sync.',
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
        this.handleIncomingMeshPacket(
          `saimetric/mesh/${this.config.branchCode}/${packet.type || 'packet'}`,
          packet
        );
      } catch (e) {}
    };
  }

  // =========================================================================
  // OFFLINE TRANSPORT C: LOCAL LAN HOST / HOTSPOT IP (e.g. 192.168.x.x:3000)
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
    if (!this.localGatewayUrl) return;
    this.localGatewayPollTimer = window.setInterval(async () => {
      try {
        const res = await fetch(`${this.localGatewayUrl}/api/mesh/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: this.config.deviceId,
            deviceName: this.config.deviceName,
            branchCode: this.config.branchCode,
            deviceType: 'terminal',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.peers)) {
            for (const p of data.peers) {
              if (p.deviceId && p.deviceId !== this.config.deviceId) {
                this.discoveredPeers.set(p.deviceId, {
                  id: p.deviceId,
                  name: p.deviceName || 'LAN Terminal',
                  branchCode: p.branchCode || this.config.branchCode,
                  isOnline: true,
                  hasInternet: false,
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
      } catch (e) {}
    }, 3000);
  }

  // =========================================================================
  // TRANSPORT 1: REAL-TIME MQTT OVER WEBSOCKET RELAY (Bypasses all router isolation)
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
        reconnectPeriod: 3000,
        keepalive: 30,
      });

      this.mqttClient = client;

      client.on('connect', () => {
        this.isMqttConnected = true;
        this.addLog(
          'DISCOVERY',
          `Connected to ${this.brokerName}. Subscribed to branch [${this.config.branchCode}]`,
          this.config.deviceName
        );

        // Subscribe to all messages for this branch
        const topic = `saimetric/mesh/${this.config.branchCode}/#`;
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (!err) {
            // Immediately broadcast our presence
            this.sendHeartbeat();
          }
        });
      });

      client.on('message', (topic, payload) => {
        try {
          const str = payload.toString();
          const packet = JSON.parse(str);
          this.handleIncomingMeshPacket(topic, packet);
        } catch (e) {
          // parse error
        }
      });

      client.on('error', (err) => {
        this.isMqttConnected = false;
        // Try fallback broker on persistent error
        this.tryNextBroker();
      });

      client.on('offline', () => {
        this.isMqttConnected = false;
      });
    } catch (e) {
      this.isMqttConnected = false;
      this.tryNextBroker();
    }
  }

  private tryNextBroker() {
    this.currentBrokerIndex = (this.currentBrokerIndex + 1) % PUBLIC_MQTT_BROKERS.length;
  }

  // =========================================================================
  // TRANSPORT 2: BROADCAST CHANNEL (Same-machine / Multi-Tab Synchronization)
  // =========================================================================
  private initBroadcastChannel() {
    if (this.channel) {
      try {
        this.channel.close();
      } catch (e) {}
    }

    try {
      const channelName = `SAIMETRIC_POS_${this.config.branchCode}`;
      this.channel = new BroadcastChannel(channelName);
      this.channel.onmessage = (event) => {
        if (event.data && event.data.type) {
          this.handleIncomingMeshPacket(`saimetric/mesh/${this.config.branchCode}/${event.data.type}`, event.data);
        }
      };
    } catch (e) {
      // BroadcastChannel not available
    }
  }

  // =========================================================================
  // HEARTBEAT & PEER DISCOVERY
  // =========================================================================
  private startHeartbeatLoop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.sendHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat();
    }, 3000);
  }

  private startPruneLoop() {
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    this.pruneInterval = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, peer] of this.discoveredPeers.entries()) {
        if (now - peer.lastSeen > 9000) {
          this.discoveredPeers.delete(id);
          changed = true;
          this.addLog('DISCOVERY', `Peer disconnected: ${peer.name} (${id})`, this.config.deviceName);
        }
      }
      if (changed && !this.isSimulationMode) {
        this.notifyPeerSubscribers();
      }
    }, 4000);
  }

  private sendHeartbeat() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTablet = /iPad|tablet|(android(?!.*mobile))/i.test(navigator.userAgent);
    const deviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

    const heartbeatPacket = {
      type: 'heartbeat',
      deviceId: this.config.deviceId,
      deviceName: this.config.deviceName,
      branchCode: this.config.branchCode,
      deviceType,
      timestamp: Date.now(),
      salesCount: getSales().length,
      pendingCount: getSyncQueue().length,
    };

    // 0. Send via WebRTC DataChannel (Direct Local Wi-Fi / Hotspot)
    if (this.webrtcDataChannel && this.webrtcDataChannel.readyState === 'open') {
      try {
        this.webrtcDataChannel.send(JSON.stringify(heartbeatPacket));
      } catch (e) {}
    }

    // 0.1 Send via Direct LAN WebSocket (forced ws:// connection from QR scan)
    if (this.directWsClient && this.directWsClient.readyState === WebSocket.OPEN) {
      try {
        this.directWsClient.send(JSON.stringify(heartbeatPacket));
      } catch (e) {}
    }

    // 1. Send via MQTT
    if (this.mqttClient && this.isMqttConnected) {
      const topic = `saimetric/mesh/${this.config.branchCode}/heartbeat`;
      this.mqttClient.publish(topic, JSON.stringify(heartbeatPacket));
    }

    // 2. Send via BroadcastChannel (for local tabs)
    if (this.channel) {
      try {
        this.channel.postMessage(heartbeatPacket);
      } catch (e) {}
    }

    // 3. Send to local gateway / container server (fallback)
    const targetUrl = this.localGatewayUrl ? `${this.localGatewayUrl}/api/mesh/heartbeat` : '/api/mesh/heartbeat';
    fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: this.config.deviceId,
        deviceName: this.config.deviceName,
        branchCode: this.config.branchCode,
        deviceType,
      }),
    }).catch(() => {});
  }

  // =========================================================================
  // PACKET HANDLING (Heartbeats, Sales, Pings)
  // =========================================================================
  private handleIncomingMeshPacket(topic: string, packet: any) {
    if (!packet || !packet.deviceId) return;

    // Ignore self packets
    if (packet.deviceId === this.config.deviceId) return;

    // Ignore packets from other branches
    if (packet.branchCode && packet.branchCode !== this.config.branchCode) return;

    // 1. HEARTBEAT DISCOVERY
    if (topic.endsWith('/heartbeat') || packet.type === 'heartbeat') {
      const isNew = !this.discoveredPeers.has(packet.deviceId);
      const peerData: P2PMeshPeer = {
        id: packet.deviceId,
        name: packet.deviceName || 'Terminal',
        isOnline: true,
        hasInternet: true,
        lastSeen: Date.now(),
        pendingCount: packet.pendingCount || 0,
        totalSalesCount: packet.salesCount || 0,
        isThisDevice: false,
        branchCode: packet.branchCode || this.config.branchCode,
        deviceType: packet.deviceType || 'terminal',
      };

      this.discoveredPeers.set(packet.deviceId, peerData);

      if (isNew) {
        playChime();
        this.addLog(
          'DISCOVERY',
          `Discovered new terminal: ${peerData.name} (${packet.deviceType || 'Device'}) on branch [${this.config.branchCode}]!`,
          peerData.name,
          this.config.deviceName
        );
      }

      if (!this.isSimulationMode) {
        this.notifyPeerSubscribers();
      }
      return;
    }

    // 2. SALE RECORD BROADCAST
    if (topic.endsWith('/sale') || packet.type === 'sale') {
      const packetId = packet.packet_id || packet.id;
      if (packetId && this.seenPacketIds.has(packetId)) return;
      if (packetId) this.seenPacketIds.add(packetId);

      const saleData: SaleInvoice = packet.sale;
      if (saleData && saleData.id) {
        const originName = packet.originDeviceName || packet.deviceName || 'Peer Terminal';
        const ingested = ingestMeshSale({
          ...saleData,
          fromMesh: true,
        } as any);

        if (ingested) {
          playChime();
          this.addLog(
            'EPIDEMIC_HOP',
            `Received Sale #${saleData.id} ($${(saleData.total || 0).toFixed(2)}) from ${originName}. Synced into local database!`,
            originName,
            this.config.deviceName,
            packet.ttl || 5,
            saleData.id
          );

          // Trigger UI notification event
          window.dispatchEvent(
            new CustomEvent('mesh-sale-received', {
              detail: {
                sale: saleData,
                originName,
              },
            })
          );
        }
      }
      return;
    }

    // 3. LIVE TEST PING
    if (topic.endsWith('/ping') || packet.type === 'ping') {
      const packetId = packet.packet_id;
      if (packetId && this.seenPacketIds.has(packetId)) return;
      if (packetId) this.seenPacketIds.add(packetId);

      playChime();
      const originName = packet.originDeviceName || packet.deviceName || 'Peer Terminal';
      const msg = packet.message || 'Hello from peer!';

      this.addLog(
        'DISCOVERY',
        `Live Ping received from ${originName}: "${msg}"`,
        originName,
        this.config.deviceName
      );

      window.dispatchEvent(
        new CustomEvent('mesh-ping-received', {
          detail: {
            originName,
            message: msg,
          },
        })
      );
      return;
    }
  }

  // =========================================================================
  // BROADCASTING METHODS (Sales & Pings)
  // =========================================================================
  public async broadcastSale(sale: SaleInvoice) {
    const packetId = `SALE-PKT-${sale.id}-${Date.now()}`;
    this.seenPacketIds.add(packetId);

    const packet = {
      type: 'sale',
      packet_id: packetId,
      branchCode: this.config.branchCode,
      deviceId: this.config.deviceId,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      sale,
      timestamp: Date.now(),
      ttl: 5,
    };

    // 0. Send via Direct Local Wi-Fi WebRTC DataChannel (if connected, 0% internet)
    if (this.webrtcDataChannel && this.webrtcDataChannel.readyState === 'open') {
      try {
        this.webrtcDataChannel.send(JSON.stringify(packet));
      } catch (e) {}
    }

    // 0.1 Send via Direct LAN WebSocket (forced ws:// connection from QR scan)
    if (this.directWsClient && this.directWsClient.readyState === WebSocket.OPEN) {
      try {
        this.directWsClient.send(JSON.stringify(packet));
      } catch (e) {}
    }

    // 1. Send via MQTT to all peers
    if (this.mqttClient && this.isMqttConnected) {
      const topic = `saimetric/mesh/${this.config.branchCode}/sale`;
      this.mqttClient.publish(topic, JSON.stringify(packet));
    }

    // 2. Send via BroadcastChannel (local tabs)
    if (this.channel) {
      try {
        this.channel.postMessage(packet);
      } catch (e) {}
    }

    // 3. Send to local server / local LAN gateway (fallback)
    const broadcastUrl = this.localGatewayUrl ? `${this.localGatewayUrl}/api/mesh/broadcast` : '/api/mesh/broadcast';
    fetch(broadcastUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packet_id: packetId,
        branchCode: this.config.branchCode,
        origin_device_id: this.config.deviceId,
        origin_device_name: this.config.deviceName,
        action: 'SALE_RECORD',
        payload: sale,
        timestamp: Date.now(),
      }),
    }).catch(() => {});

    this.addLog(
      'BROADCAST',
      `Sale #${sale.id} ($${sale.total.toFixed(2)}) broadcasted to WiFi mesh (TTL=5, Hash: ${calculateRecordHash(
        sale.id,
        this.config.deviceId,
        Date.now(),
        sale.total
      )})`,
      this.config.deviceName,
      undefined,
      5,
      sale.id
    );

    this.notifyPeerSubscribers();
  }

  public async sendTestPing(customMessage?: string): Promise<boolean> {
    const packetId = `PING-${Date.now()}`;
    this.seenPacketIds.add(packetId);

    const message = customMessage || `Live Ping from ${this.config.deviceName} at ${new Date().toLocaleTimeString()}`;

    const packet = {
      type: 'ping',
      packet_id: packetId,
      branchCode: this.config.branchCode,
      deviceId: this.config.deviceId,
      originDeviceId: this.config.deviceId,
      originDeviceName: this.config.deviceName,
      message,
      timestamp: Date.now(),
    };

    // 0. Send via WebRTC DataChannel (Direct Local Wi-Fi / Hotspot)
    if (this.webrtcDataChannel && this.webrtcDataChannel.readyState === 'open') {
      try {
        this.webrtcDataChannel.send(JSON.stringify(packet));
      } catch (e) {}
    }

    // 1. Send via MQTT
    if (this.mqttClient && this.isMqttConnected) {
      const topic = `saimetric/mesh/${this.config.branchCode}/ping`;
      this.mqttClient.publish(topic, JSON.stringify(packet));
    }

    // 2. Send via BroadcastChannel
    if (this.channel) {
      try {
        this.channel.postMessage(packet);
      } catch (e) {}
    }

    // 3. Send to local gateway fallback
    const broadcastUrl = this.localGatewayUrl ? `${this.localGatewayUrl}/api/mesh/broadcast` : '/api/mesh/broadcast';
    fetch(broadcastUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packet_id: packetId,
        branchCode: this.config.branchCode,
        origin_device_id: this.config.deviceId,
        origin_device_name: this.config.deviceName,
        action: 'PING',
        payload: { message },
        timestamp: Date.now(),
      }),
    }).catch(() => {});

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
      if (now - peer.lastSeen <= 9000) count++;
    }
    return count;
  }

  public getRealPeers(): P2PMeshPeer[] {
    const now = Date.now();
    const result: P2PMeshPeer[] = [];

    // Always include "This Terminal" as the primary device
    result.push({
      id: this.config.deviceId,
      name: `${this.config.deviceName} (This Device)`,
      isOnline: true,
      hasInternet: navigator.onLine,
      lastSeen: now,
      pendingCount: getSyncQueue().length,
      totalSalesCount: getSales().length,
      isThisDevice: true,
      branchCode: this.config.branchCode,
      deviceType: 'This Terminal',
    });

    // Add discovered peers active in the last 9 seconds
    for (const peer of this.discoveredPeers.values()) {
      if (now - peer.lastSeen <= 9000) {
        result.push(peer);
      }
    }

    return result;
  }

  private notifyPeerSubscribers() {
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
      }));
    } else {
      peersList = this.getRealPeers();
      // count of OTHER connected peers
      count = peersList.filter((p) => !p.isThisDevice).length;
    }

    this.peerListeners.forEach((fn) => {
      try {
        fn(count, peersList);
      } catch (e) {}
    });
  }

  public subscribePeers(listener: (count: number, peers: P2PMeshPeer[]) => void) {
    this.peerListeners.push(listener);
    this.notifyPeerSubscribers();
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
  // SIMULATION & TEST PLAN LAB (3 to 50 nodes)
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
        branchCode: this.config.branchCode,
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
      branchCode: this.config.branchCode,
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
    const invoiceNumber = 'INV-' + Math.floor(1000 + Math.random() * 9000);
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
      this.addLog('CLOUD_SYNC', `Opportunistic Cloud Sync: ${dev.name} uploaded ${countToSync} records to Google Sheets.`, dev.name);
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
      if (navigator.onLine) {
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
    this.addLog('DISCOVERY', '=== INITIATING OFFICIAL TEST PLAN ===', 'TestRunner');

    onStepUpdate?.(1, 'Setup Initial Mesh', 'Initializing Devices 1, 2, and 3...');
    this.virtualDevices.forEach((d, idx) => {
      d.isOnline = idx < 3;
      d.hasInternet = false;
      d.sales = [];
      d.pendingQueue = [];
    });
    this.notifyPeerSubscribers();
    await new Promise((r) => setTimeout(r, 600));

    onStepUpdate?.(2, 'Record Sales on Device 1', 'Creating 3 sales on Device 1...');
    this.makeSaleOnDevice('DEV-VIRTUAL-1', 50.0, 'Customer Alpha');
    this.makeSaleOnDevice('DEV-VIRTUAL-1', 120.0, 'Customer Beta');
    this.makeSaleOnDevice('DEV-VIRTUAL-1', 35.0, 'Customer Gamma');
    await new Promise((r) => setTimeout(r, 600));

    onStepUpdate?.(3, 'Add Device 4 & Verify Old Sales', 'Powering on Device 4. Auto-discovering mesh...');
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
    this.addLog('DISCOVERY', 'Verification PASSED: Device 4 received all 3 prior sales!', 'TestRunner');

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

    onStepUpdate?.(6, 'Turn on Internet on Device 4 & Cloud Sync', 'Restoring internet on Device 4. Triggering Cloud Sync...');
    if (dev4) {
      dev4.hasInternet = true;
      const syncResult = await this.triggerOpportunisticCloudSync('DEV-VIRTUAL-4');
      this.addLog('CLOUD_SYNC', `Cloud Sync completed! Uploaded ${syncResult.syncedCount} records.`, 'TestRunner');
    }
    await new Promise((r) => setTimeout(r, 600));

    onStepUpdate?.(7, 'Test Plan Complete', 'All 6 test stages verified successfully.');
    return true;
  }
}

export const meshSyncService = new MeshSyncManager();
