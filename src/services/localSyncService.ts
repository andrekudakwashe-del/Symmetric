/**
 * LocalSyncService - Zero-Internet P2P Mesh Synchronization Engine
 * Inspired by SHAREit, Xender, Zapya, and FireChat mesh architecture.
 *
 * Works 100% offline via direct Wi-Fi Hotspot (192.168.43.1 / 192.168.x.x),
 * Local WebSockets, WebRTC DataChannels (zero STUN/TURN), and BroadcastChannel.
 */

import { getLocalIp, COMMON_HOTSPOT_IPS } from '../utils/getLocalIp';
import {
  ingestMeshSale,
  addSale,
  getSales,
  getCurrentCompanyId,
  getCurrentBranchId,
  getCurrentBranch,
} from '../db/roomDatabase';
import {
  getPendingSyncQueueItems,
  batchUpdateSyncItems,
  PersistentSyncItem,
} from '../db/indexedDBService';
import { SaleInvoice } from '../types';

export type TillMeshRole = 'HOST' | 'CLIENT';

export interface LocalPeerInfo {
  id: string;
  name: string;
  ip: string;
  role: TillMeshRole;
  lastSeen: number;
  connectedVia: 'WEBSOCKET' | 'WEBRTC' | 'BROADCAST_CHANNEL';
}

export interface LocalSyncStats {
  role: TillMeshRole;
  hostIp: string;
  localIp: string;
  isConnectedToHost: boolean;
  connectedClientsCount: number;
  lastSyncTimestamp: number;
  totalSyncedSalesCount: number;
  queuedItemsCount: number;
  activeTransport: 'WEBSOCKET' | 'WEBRTC' | 'BROADCAST_CHANNEL' | 'DISCONNECTED';
}

type LocalSyncListener = (stats: LocalSyncStats) => void;
type SaleReceivedListener = (sale: SaleInvoice, fromPeer: string) => void;

class LocalSyncService {
  private role: TillMeshRole = 'CLIENT';
  private hostIp: string = '192.168.43.1';
  private localIp: string = '192.168.43.1';
  private port: number = 3000;

  // Transport handles
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private isConnectingWs: boolean = false;
  private broadcastChannel: BroadcastChannel | null = null;
  
  // WebRTC offline direct channel handles
  private rtcPeerConnection: RTCPeerConnection | null = null;
  private rtcDataChannel: RTCDataChannel | null = null;
  private currentRtcOfferStr: string = '';

  // Peer & State tracking
  private isReachable: boolean = false;
  private lastSyncTime: number = 0;
  private totalSalesSynced: number = 0;
  private connectedPeers: Map<string, LocalPeerInfo> = new Map();
  private processedPacketIds: Set<string> = new Set();
  
  // Listeners
  private statsListeners: Set<LocalSyncListener> = new Set();
  private saleListeners: Set<SaleReceivedListener> = new Set();

  private deviceId: string = '';
  private deviceName: string = '';

  constructor() {
    this.initDeviceIdentity();
    this.loadPersistedConfig();
    this.initBroadcastChannel();
    this.detectLocalIp();

    // Auto-probe and initiate local mesh loop
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange());
      window.addEventListener('offline', () => this.handleNetworkChange());
      // Heartbeat pulse every 15 seconds
      setInterval(() => this.heartbeatPulse(), 15000);
      // Auto queue drain check every 25 seconds
      setInterval(() => {
        if (this.isLocalHostReachable()) {
          this.syncQueueToHost().catch(() => {});
        }
      }, 25000);
    }
  }

  private initDeviceIdentity() {
    if (typeof window === 'undefined') return;
    try {
      let id = localStorage.getItem('saimetric_pos_device_id');
      if (!id) {
        id = `TILL-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        localStorage.setItem('saimetric_pos_device_id', id);
      }
      this.deviceId = id;

      let name = localStorage.getItem('saimetric_pos_device_name');
      if (!name) {
        name = `Till-${id.slice(-4)}`;
        localStorage.setItem('saimetric_pos_device_name', name);
      }
      this.deviceName = name;
    } catch (_) {
      this.deviceId = 'TILL-LOCAL';
      this.deviceName = 'Till-Terminal';
    }
  }

  private loadPersistedConfig() {
    if (typeof window === 'undefined') return;
    try {
      const savedRole = localStorage.getItem('saimetric_pos_mesh_role') as TillMeshRole;
      if (savedRole === 'HOST' || savedRole === 'CLIENT') {
        this.role = savedRole;
      }

      const savedHostIp = localStorage.getItem('saimetric_pos_host_ip');
      if (savedHostIp && savedHostIp.trim()) {
        this.hostIp = savedHostIp.trim();
      } else {
        this.hostIp = '192.168.43.1';
      }
    } catch (_) {}
  }

  public async detectLocalIp(): Promise<string> {
    try {
      const ip = await getLocalIp();
      if (ip) {
        this.localIp = ip;
        if (this.role === 'HOST' && (!this.hostIp || this.hostIp === '127.0.0.1')) {
          this.hostIp = ip;
        }
      }
      this.notifyStats();
      return this.localIp;
    } catch (_) {
      return this.localIp;
    }
  }

  // ========================== CONFIGURATION ==========================

  public setRole(role: TillMeshRole) {
    this.role = role;
    try {
      localStorage.setItem('saimetric_pos_mesh_role', role);
    } catch (_) {}

    if (role === 'HOST') {
      this.hostIp = this.localIp || '192.168.43.1';
      this.isReachable = true;
      this.createWebRtcOffer().catch(() => {});
    } else {
      this.isReachable = false;
      this.connectToHost();
    }
    this.notifyStats();
  }

  public getRole(): TillMeshRole {
    return this.role;
  }

  public setHostIp(ip: string) {
    const clean = ip.trim();
    if (!clean) return;
    this.hostIp = clean;
    try {
      localStorage.setItem('saimetric_pos_host_ip', clean);
    } catch (_) {}
    if (this.role === 'CLIENT') {
      this.reconnect();
    }
    this.notifyStats();
  }

  public getHostIp(): string {
    return this.hostIp;
  }

  public getLocalIp(): string {
    return this.localIp;
  }

  public isSecureContext(): boolean {
    return typeof window !== 'undefined' && window.location.protocol === 'https:';
  }

  public getHostWsUrl(): string {
    if (this.isSecureContext()) {
      return `wss://${window.location.host}`;
    }
    const ip = this.role === 'HOST' ? (this.localIp || '192.168.43.1') : this.hostIp;
    return `ws://${ip}:${this.port}`;
  }

  public getHostHttpUrl(): string {
    if (this.isSecureContext()) {
      return window.location.origin;
    }
    const ip = this.role === 'HOST' ? (this.localIp || '192.168.43.1') : this.hostIp;
    return `http://${ip}:${this.port}`;
  }

  public getCommonIps(): string[] {
    return COMMON_HOTSPOT_IPS;
  }

  // ========================== REACHABILITY & SYNC CHECK ==========================

  /**
   * Returns true if local mesh Host is reachable right now via direct Wi-Fi Hotspot / LAN.
   * This implements: "if(localHostReachable) syncToLocalHost() else if(navigator.onLine) syncToCloud()"
   */
  public isLocalHostReachable(): boolean {
    if (this.role === 'HOST') return true;
    return this.isReachable && (
      (this.ws !== null && this.ws.readyState === WebSocket.OPEN) ||
      (this.rtcDataChannel !== null && this.rtcDataChannel.readyState === 'open')
    );
  }

  // ========================== BROADCAST CHANNEL (SAME-DEVICE) ==========================

  private initBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.broadcastChannel = new BroadcastChannel('saimetric_local_p2p_mesh');
      this.broadcastChannel.onmessage = (event) => {
        if (!event.data) return;
        this.handleIncomingPacket(event.data, 'BROADCAST_CHANNEL');
      };
    } catch (_) {}
  }

  // ========================== WEBSOCKET TRANSPORT ==========================

  public connectToHost(overrideIp?: string) {
    if (typeof window === 'undefined') return;
    if (this.isConnectingWs) return;

    const isHttps = this.isSecureContext();
    const targetIp = overrideIp || (this.role === 'HOST' ? '127.0.0.1' : this.hostIp);
    let wsUrl: string;

    if (overrideIp) {
      const clean = overrideIp.trim();
      if (clean.startsWith('wss://') || clean.startsWith('ws://')) {
        wsUrl = isHttps ? clean.replace(/^ws:\/\//i, 'wss://') : clean;
      } else {
        const proto = isHttps ? 'wss:' : 'ws:';
        wsUrl = `${proto}//${clean}${clean.includes(':') ? '' : `:${this.port}`}`;
      }
    } else if (isHttps) {
      // When app is loaded over HTTPS, connect to secure wss:// on current origin
      // to maintain strict SSL encryption and prevent browser "Not Secure" (red hexagon with white X) warning!
      wsUrl = `wss://${window.location.host}`;
    } else {
      wsUrl = `ws://${targetIp}:${this.port}`;
    }

    // Safety guard: If parent page is on HTTPS, browsers block insecure ws:// or raw LAN IP connections
    // as Mixed Content. Do not open raw LAN IP WebSocket on HTTPS to protect certificate status:
    if (isHttps && /^wss?:\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(wsUrl)) {
      console.info('[LocalMesh] On HTTPS: Direct LAN raw IP WebSocket suppressed to prevent mixed content. P2P uses WebRTC DataChannel & BroadcastChannel.');
      return;
    }

    try {
      this.isConnectingWs = true;
      if (this.ws) {
        try { this.ws.close(); } catch (_) {}
        this.ws = null;
      }

      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        this.isConnectingWs = false;
        this.isReachable = true;
        console.info(`[LocalMesh] Connected to Host Till at ${wsUrl}`);

        // Send handshake announce
        this.sendPacket({
          type: 'HANDSHAKE',
          senderId: this.deviceId,
          senderName: this.deviceName,
          role: this.role,
          timestamp: Date.now(),
        });

        // If client, immediately drain pending queue to Host
        if (this.role === 'CLIENT') {
          this.syncQueueToHost().catch(() => {});
        }

        this.notifyStats();
      };

      socket.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handleIncomingPacket(packet, 'WEBSOCKET');
        } catch (_) {}
      };

      socket.onerror = () => {
        this.isConnectingWs = false;
        // Don't set completely unreachable immediately, try common Hotspot IP fallback if client and not on HTTPS
        if (this.role === 'CLIENT' && !this.isSecureContext() && targetIp !== '192.168.43.1') {
          // Probe default Android hotspot gateway on plain HTTP
          setTimeout(() => {
            if (!this.isLocalHostReachable()) {
              this.probeAlternativeIps();
            }
          }, 1500);
        }
      };

      socket.onclose = () => {
        this.isConnectingWs = false;
        if (this.ws === socket) {
          this.ws = null;
          if (this.role === 'CLIENT') {
            this.isReachable = false;
          }
        }
        this.notifyStats();
        // Auto-reconnect backoff (skip if on HTTPS and targeting raw LAN IP)
        clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = setTimeout(() => {
          if (!this.isLocalHostReachable() && this.role === 'CLIENT') {
            if (!this.isSecureContext() || !this.hostIp.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)) {
              this.connectToHost();
            }
          }
        }, 5000);
      };
    } catch (_) {
      this.isConnectingWs = false;
    }
  }

  public reconnect() {
    clearTimeout(this.wsReconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.connectToHost();
  }

  private async probeAlternativeIps() {
    // If loaded over HTTPS, never probe insecure ws:// on private LAN IPs
    // as each failed attempt triggers browser Mixed Content warnings (white X in red hexagon)
    if (this.isSecureContext()) return;

    for (const ip of COMMON_HOTSPOT_IPS) {
      if (ip === this.hostIp) continue;
      try {
        const testWs = new WebSocket(`ws://${ip}:${this.port}`);
        const success = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => {
            try { testWs.close(); } catch (_) {}
            resolve(false);
          }, 1000);
          testWs.onopen = () => {
            clearTimeout(t);
            resolve(true);
          };
          testWs.onerror = () => {
            clearTimeout(t);
            resolve(false);
          };
        });

        if (success) {
          console.info(`[LocalMesh] Auto-discovered Host Till on Hotspot IP: ${ip}`);
          this.setHostIp(ip);
          return;
        }
      } catch (_) {}
    }
  }

  // ========================== WEBRTC AIRDROP / QR PAIRING ==========================

  public async createWebRtcOffer(): Promise<string> {
    if (typeof RTCPeerConnection === 'undefined') return '';
    try {
      this.cleanupWebRtc();
      const pc = new RTCPeerConnection({ iceServers: [] });
      this.rtcPeerConnection = pc;

      const dc = pc.createDataChannel('saimetric-mesh-channel', { ordered: true });
      this.setupDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Collect ICE candidates into offer
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const check = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', check);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', check);
          setTimeout(resolve, 1000);
        }
      });

      const offerPayload = {
        type: 'WEBRTC_OFFER',
        hostIp: this.localIp,
        port: this.port,
        wsUrl: this.getHostWsUrl(),
        httpUrl: this.getHostHttpUrl(),
        sdp: pc.localDescription?.sdp,
        timestamp: Date.now(),
      };

      this.currentRtcOfferStr = JSON.stringify(offerPayload);
      return this.currentRtcOfferStr;
    } catch (_) {
      return '';
    }
  }

  public getWebRtcOfferString(): string {
    return this.currentRtcOfferStr;
  }

  public async handleScannedQrData(qrText: string): Promise<{ success: boolean; message: string }> {
    if (!qrText || !qrText.trim()) {
      return { success: false, message: 'Empty QR code data' };
    }

    try {
      // 1. Check if raw IP string (e.g. "192.168.43.1" or "192.168.43.1:3000")
      const trimmed = qrText.trim();
      const ipMatch = trimmed.match(/^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(?::([0-9]+))?$/);
      if (ipMatch) {
        this.setHostIp(ipMatch[1]);
        this.connectToHost(ipMatch[1]);
        return { success: true, message: `Connected to Host Till at ${ipMatch[1]}` };
      }

      // 2. Check if WebSocket URL (e.g. "ws://192.168.43.1:3000")
      if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
        const u = new URL(trimmed);
        if (u.hostname) {
          this.setHostIp(u.hostname);
          this.connectToHost(u.hostname);
          return { success: true, message: `Connected to Host Till at ${u.hostname}` };
        }
      }

      // 3. Check if HTTP URL (e.g. "http://192.168.43.1:3000" or ":5173")
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const u = new URL(trimmed);
        if (u.hostname) {
          this.setHostIp(u.hostname);
          this.connectToHost(u.hostname);
          return { success: true, message: `Paired with Host Till at ${u.hostname}` };
        }
      }

      // 4. Check if JSON payload (WebRTC Offer / Pairing Token)
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const parsed = JSON.parse(trimmed);
        if (parsed.hostIp) {
          this.setHostIp(parsed.hostIp);
        }
        if (parsed.wsUrl) {
          const u = new URL(parsed.wsUrl);
          this.setHostIp(u.hostname);
        }
        if (parsed.sdp && this.role === 'CLIENT') {
          await this.answerWebRtcOffer(parsed.sdp);
        }
        this.connectToHost();
        return { success: true, message: 'Successfully paired via AirDrop QR code!' };
      }
    } catch (err: any) {
      return { success: false, message: `Failed to parse QR data: ${err.message || 'Invalid format'}` };
    }

    return { success: false, message: 'Unrecognized QR format' };
  }

  private async answerWebRtcOffer(offerSdp: string) {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      this.cleanupWebRtc();
      const pc = new RTCPeerConnection({ iceServers: [] });
      this.rtcPeerConnection = pc;

      pc.ondatachannel = (ev) => {
        this.setupDataChannel(ev.channel);
      };

      await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // In pure AirDrop mode, answer would be shown back. Since WebSocket is active, send via ws
      this.sendPacket({
        type: 'WEBRTC_ANSWER',
        sdp: answer.sdp,
        senderId: this.deviceId,
      });
    } catch (_) {}
  }

  private setupDataChannel(dc: RTCDataChannel) {
    this.rtcDataChannel = dc;
    dc.onopen = () => {
      this.isReachable = true;
      this.notifyStats();
      if (this.role === 'CLIENT') {
        this.syncQueueToHost().catch(() => {});
      }
    };
    dc.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        this.handleIncomingPacket(packet, 'WEBRTC');
      } catch (_) {}
    };
    dc.onclose = () => {
      if (this.rtcDataChannel === dc) {
        this.rtcDataChannel = null;
      }
      this.notifyStats();
    };
  }

  private cleanupWebRtc() {
    if (this.rtcDataChannel) {
      try { this.rtcDataChannel.close(); } catch (_) {}
      this.rtcDataChannel = null;
    }
    if (this.rtcPeerConnection) {
      try { this.rtcPeerConnection.close(); } catch (_) {}
      this.rtcPeerConnection = null;
    }
  }

  // ========================== PACKET TRANSMISSION ==========================

  public sendPacket(packet: any): boolean {
    const raw = JSON.stringify(packet);
    let sent = false;

    // 1. WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(raw);
        sent = true;
      } catch (_) {}
    }

    // 2. WebRTC DataChannel
    if (this.rtcDataChannel && this.rtcDataChannel.readyState === 'open') {
      try {
        this.rtcDataChannel.send(raw);
        sent = true;
      } catch (_) {}
    }

    // 3. BroadcastChannel (cross-tab on same machine)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(packet);
        sent = true;
      } catch (_) {}
    }

    return sent;
  }

  // ========================== PACKET RECEPTION ==========================

  private async handleIncomingPacket(packet: any, transport: 'WEBSOCKET' | 'WEBRTC' | 'BROADCAST_CHANNEL') {
    if (!packet || typeof packet !== 'object') return;
    const packetId = packet.packetId || packet.id || packet.clientRequestId;
    if (packetId && this.processedPacketIds.has(packetId)) {
      return; // Deduplicate
    }
    if (packetId) {
      this.processedPacketIds.add(packetId);
      if (this.processedPacketIds.size > 2000) {
        const first = this.processedPacketIds.values().next().value;
        if (first) this.processedPacketIds.delete(first);
      }
    }

    // Update peer tracking
    if (packet.senderId && packet.senderId !== this.deviceId) {
      this.connectedPeers.set(packet.senderId, {
        id: packet.senderId,
        name: packet.senderName || 'Peer Till',
        ip: packet.senderIp || this.hostIp,
        role: packet.role || 'CLIENT',
        lastSeen: Date.now(),
        connectedVia: transport,
      });
    }

    switch (packet.type) {
      case 'HANDSHAKE': {
        // If Host, respond with Welcome ACK + Current Branch Context
        if (this.role === 'HOST') {
          this.sendPacket({
            type: 'HANDSHAKE_ACK',
            hostId: this.deviceId,
            hostName: this.deviceName,
            branchId: getCurrentBranchId(),
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'SALE_CREATED':
      case 'SALE': {
        const sale = packet.payload || packet.sale;
        if (sale && sale.id) {
          console.info(`[LocalMesh] Received sale ${sale.id} via local mesh (${sale.items?.length || 0} items)`);
          
          // Ingest into IndexedDB/roomDatabase
          ingestMeshSale(sale);

          // Notify UI listeners
          this.totalSalesSynced++;
          this.lastSyncTime = Date.now();
          this.saleListeners.forEach((fn) => {
            try { fn(sale, packet.senderName || 'Client Till'); } catch (_) {}
          });

          // If this is Host, broadcast to any other connected clients
          if (this.role === 'HOST') {
            this.sendPacket({
              type: 'SALE_BROADCAST',
              senderId: this.deviceId,
              payload: sale,
              packetId: `BC-${Date.now()}-${sale.id}`,
            });
          }

          // Acknowledge receipt
          if (packet.senderId && packet.senderId !== this.deviceId) {
            this.sendPacket({
              type: 'SALE_ACK',
              saleId: sale.id,
              targetId: packet.senderId,
            });
          }
        }
        break;
      }

      case 'SYNC_QUEUE_PUSH': {
        const items: PersistentSyncItem[] = packet.items || [];
        if (Array.isArray(items) && items.length > 0) {
          console.info(`[LocalMesh] Host received ${items.length} sync queue items from Client Till`);
          
          // Host saves records into its roomDatabase
          for (const item of items) {
            if (item.action === 'add_sale' || item.sheetName === 'Sales') {
              if (item.payload && item.payload.id) {
                ingestMeshSale(item.payload);
              }
            }
          }

          // Return ACK to Client
          this.sendPacket({
            type: 'SYNC_QUEUE_ACK',
            itemIds: items.map((i) => i.id),
            targetId: packet.senderId,
          });
        }
        break;
      }

      case 'SYNC_QUEUE_ACK': {
        if (packet.targetId === this.deviceId && Array.isArray(packet.itemIds)) {
          console.info(`[LocalMesh] Client confirmed ${packet.itemIds.length} items synced to Host Till`);
          await batchUpdateSyncItems(
            packet.itemIds.map((id: string) => ({
              id,
              updates: { status: 'done', response: { success: true, localHostSynced: true } },
            }))
          );
        }
        break;
      }

      case 'PING': {
        this.sendPacket({ type: 'PONG', senderId: this.deviceId });
        break;
      }

      default:
        break;
    }

    this.notifyStats();
  }

  // ========================== CLIENT SYNC OPERATIONS ==========================

  /**
   * Pushes a freshly completed sale directly to Host Till with 0% internet.
   */
  public async pushSaleToHost(sale: SaleInvoice): Promise<boolean> {
    if (this.role === 'HOST') return true; // Host already has it

    const packet = {
      type: 'SALE_CREATED',
      senderId: this.deviceId,
      senderName: this.deviceName,
      packetId: `SALE-PKT-${Date.now()}-${sale.id}`,
      payload: sale,
      timestamp: Date.now(),
    };

    const sent = this.sendPacket(packet);
    if (sent) {
      this.totalSalesSynced++;
      this.lastSyncTime = Date.now();
      console.info(`[LocalMesh] Pushed sale ${sale.id} directly to Host Till via local Wi-Fi mesh.`);
    }
    return sent;
  }

  /**
   * Pushes pending sync_queue items to Host Till.
   * Host persists them in its IndexedDB and later flushes to cloud when internet returns.
   */
  public async syncQueueToHost(): Promise<{ pushedCount: number; success: boolean }> {
    if (this.role === 'HOST') {
      return { pushedCount: 0, success: true };
    }

    if (!this.isLocalHostReachable()) {
      return { pushedCount: 0, success: false };
    }

    try {
      const companyId = getCurrentCompanyId();
      const pendingItems = await getPendingSyncQueueItems(Date.now(), companyId);

      if (pendingItems.length === 0) {
        return { pushedCount: 0, success: true };
      }

      const packet = {
        type: 'SYNC_QUEUE_PUSH',
        senderId: this.deviceId,
        senderName: this.deviceName,
        items: pendingItems,
        timestamp: Date.now(),
      };

      const sent = this.sendPacket(packet);
      if (sent) {
        this.lastSyncTime = Date.now();
        return { pushedCount: pendingItems.length, success: true };
      }
    } catch (_) {}

    return { pushedCount: 0, success: false };
  }

  // ========================== HEARTBEAT & HOUSEKEEPING ==========================

  private heartbeatPulse() {
    const now = Date.now();
    // Prune stale peers (>35s)
    for (const [id, peer] of this.connectedPeers.entries()) {
      if (now - peer.lastSeen > 35000) {
        this.connectedPeers.delete(id);
      }
    }

    if (this.role === 'CLIENT' && !this.isLocalHostReachable()) {
      if (!this.isSecureContext() || !this.hostIp.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)) {
        this.connectToHost();
      }
    } else if (this.isLocalHostReachable()) {
      this.sendPacket({
        type: 'PING',
        senderId: this.deviceId,
        senderName: this.deviceName,
      });
    }

    this.notifyStats();
  }

  private handleNetworkChange() {
    this.detectLocalIp();
    if (this.role === 'CLIENT') {
      this.reconnect();
    }
  }

  // ========================== SUBSCRIPTIONS & DIAGNOSTICS ==========================

  public onSaleReceived(listener: SaleReceivedListener) {
    this.saleListeners.add(listener);
    return () => this.saleListeners.delete(listener);
  }

  public subscribeStats(listener: LocalSyncListener) {
    this.statsListeners.add(listener);
    listener(this.getStats());
    return () => this.statsListeners.delete(listener);
  }

  public getStats(): LocalSyncStats {
    let transport: 'WEBSOCKET' | 'WEBRTC' | 'BROADCAST_CHANNEL' | 'DISCONNECTED' = 'DISCONNECTED';
    if (this.ws && this.ws.readyState === WebSocket.OPEN) transport = 'WEBSOCKET';
    else if (this.rtcDataChannel && this.rtcDataChannel.readyState === 'open') transport = 'WEBRTC';
    else if (this.broadcastChannel) transport = 'BROADCAST_CHANNEL';

    return {
      role: this.role,
      hostIp: this.hostIp,
      localIp: this.localIp,
      isConnectedToHost: this.isLocalHostReachable(),
      connectedClientsCount: this.connectedPeers.size,
      lastSyncTimestamp: this.lastSyncTime,
      totalSyncedSalesCount: this.totalSalesSynced,
      queuedItemsCount: 0,
      activeTransport: transport,
    };
  }

  public getConnectedPeers(): LocalPeerInfo[] {
    return Array.from(this.connectedPeers.values());
  }

  private notifyStats() {
    const stats = this.getStats();
    this.statsListeners.forEach((fn) => {
      try { fn(stats); } catch (_) {}
    });
  }
}

export const localSyncService = new LocalSyncService();
export default localSyncService;
