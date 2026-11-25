/**
 * LocalHubConfig
 * Manages configuration and discovery for the offline Local WebSocket Hub (e.g. Node.js on Termux Android).
 * Stores URL in localStorage (`saimetric_local_hub_url`) and testing flags (`saimetric_force_local_hub`).
 */

export const STORAGE_KEY_LOCAL_HUB_URL = 'saimetric_local_hub_url';
export const STORAGE_KEY_FORCE_LOCAL_HUB = 'saimetric_force_local_hub';
export const STORAGE_KEY_HUB_BRANCH_ID = 'saimetric_hub_branch_id';
export const STORAGE_KEY_HUB_BRANCH_NAME = 'saimetric_hub_branch_name';
export const STORAGE_KEY_HUB_TENANT_ID = 'saimetric_hub_tenant_id';
export const STORAGE_KEY_CLOUD_ONLY_MODE = 'saimetric_cloud_only_mode';
export const STORAGE_KEY_PAIRED_HUBS = 'saimetric_paired_hubs_v1';
export const DEFAULT_LOCAL_HUB_URL = 'ws://192.168.43.1:8080';

export type HubRole = 'PRIMARY' | 'BACKUP' | 'TILL_FALLBACK';
export type HubMode = 'ACTIVE' | 'STANDBY';

export interface ActiveLeaderInfo {
  hubId: string;
  hubRole: HubRole;
  hubPriority: number;
  branchEpoch: number;
  lanIp: string;
  wsPort: number;
  wsUrl: string;
  branchId?: string;
  branchName?: string;
  tenantId?: string;
  mdnsHost?: string;
}

export interface HubFailoverMeta {
  hubId: string;
  tenantId?: string;
  branchId?: string;
  branchName?: string;
  hubRole: HubRole;
  hubPriority: number;
  branchEpoch: number;
  hubMode: HubMode;
  isColdHub: boolean;
  activeLeaderHubId: string | null;
  activeLeaderInfo: ActiveLeaderInfo | null;
}

export interface PairedHubProfile {
  hubId: string;
  wsUrl: string;
  lastWsUrl: string;
  lastIp: string;
  lastKnownHost: string;
  mdnsHost?: string;
  port: number;
  lastPort: number;
  lanIps?: string[];
  branchId: string;
  branchName: string;
  tenantId: string;
  deviceId: string;
  deviceSecret: string;
  hubRole: HubRole;
  hubPriority: number;
  lastEpoch: number;
  hubMode?: HubMode;
  hubPubKey?: string;
  hubVersion?: string;
  hubRuntime?: 'ANDROID_APK' | 'TERMUX' | 'UNKNOWN';
  pairedAt: number;
  lastConnectedAt?: number;
}

export function normalizeHubRole(raw?: unknown): HubRole {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'BACKUP' || s === 'SECONDARY') return 'BACKUP';
  if (s === 'TILL_FALLBACK' || s === 'TILL' || s === 'CASHIER_FALLBACK' || s === 'FALLBACK') {
    return 'TILL_FALLBACK';
  }
  return 'PRIMARY';
}

export function defaultPriorityForRole(role: HubRole): number {
  if (role === 'PRIMARY') return 100;
  if (role === 'BACKUP') return 50;
  return 10;
}

export function normalizeHubPriority(raw: unknown, role: HubRole): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  return defaultPriorityForRole(role);
}

export function normalizeHubMode(raw?: unknown): HubMode {
  const s = String(raw || '').trim().toUpperCase();
  return s === 'STANDBY' ? 'STANDBY' : 'ACTIVE';
}

export function normalizeBranchEpoch(raw?: unknown, fallback = 1): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return Math.max(1, Math.floor(fallback));
}

/**
 * Validates and normalizes `activeLeaderInfo` received over WebSocket or `/health`.
 * Rejects non-ws/wss schemes and unsafe hostnames to prevent protocol injection / SSRF.
 */
export function sanitizeActiveLeaderInfo(raw: any): ActiveLeaderInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const hubId = String(raw.hubId || raw.hub_id || '').trim();
  if (!hubId) return null;

  const role = normalizeHubRole(raw.hubRole || raw.hub_role);
  const priority = normalizeHubPriority(raw.hubPriority ?? raw.hub_priority, role);
  const branchEpoch = normalizeBranchEpoch(raw.branchEpoch ?? raw.branch_epoch, 1);

  const rawIp = String(raw.lanIp || raw.lan_ip || '').trim();
  const rawPort = Number(raw.wsPort ?? raw.ws_port ?? raw.port ?? 8080);
  const wsPort = Number.isFinite(rawPort) && rawPort > 0 && rawPort <= 65535 ? Math.floor(rawPort) : 8080;

  let candidateUrl = String(raw.wsUrl || raw.ws_url || '').trim();
  if (candidateUrl) {
    // Reject any URI scheme (with or without //) other than ws:// or wss://
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidateUrl);
    if (hasScheme && !/^wss?:\/\//i.test(candidateUrl)) {
      return null;
    }
    const urlToParse = hasScheme ? candidateUrl : `ws://${candidateUrl}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlToParse);
    } catch {
      return null;
    }
    if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
      return null;
    }
    const portNum = parsedUrl.port ? Number(parsedUrl.port) : wsPort;
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
      return null;
    }
    candidateUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}:${Math.floor(portNum)}`;
  } else if (rawIp && (VALID_IPV4_REGEX.test(rawIp) || VALID_MDNS_REGEX.test(rawIp))) {
    candidateUrl = `ws://${rawIp}:${wsPort}`;
  } else {
    return null;
  }

  const parsed = extractHostAndPort(candidateUrl);
  if (!parsed.hostname || (!VALID_IPV4_REGEX.test(parsed.hostname) && !VALID_MDNS_REGEX.test(parsed.hostname))) {
    return null;
  }

  const lanIp = VALID_IPV4_REGEX.test(rawIp) ? rawIp : parsed.hostname;
  const safeWsUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
  const mdnsHost = sanitizeMdnsHost(raw.mdnsHost || raw.mdns_host);

  return {
    hubId,
    hubRole: role,
    hubPriority: priority,
    branchEpoch,
    lanIp,
    wsPort: parsed.port,
    wsUrl: safeWsUrl,
    ...(raw.branchId || raw.branch_id ? { branchId: String(raw.branchId || raw.branch_id).trim() } : {}),
    ...(raw.branchName || raw.branch_name ? { branchName: String(raw.branchName || raw.branch_name).trim() } : {}),
    ...(raw.tenantId || raw.tenant_id ? { tenantId: String(raw.tenantId || raw.tenant_id).trim() } : {}),
    ...(mdnsHost ? { mdnsHost } : {}),
  };
}

const VALID_MDNS_REGEX = /^[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})*$/;
const VALID_IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export function sanitizeMdnsHost(raw?: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/:\d+$/, '').replace(/\/.*$/, '');
  if (!cleaned || !VALID_MDNS_REGEX.test(cleaned)) return undefined;
  return cleaned;
}

export function sanitizeLanIps(raw?: unknown): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const unique = new Set<string>();
  for (const item of arr) {
    const ip = String(item || '').trim();
    if (VALID_IPV4_REGEX.test(ip) && !ip.startsWith('0.')) {
      unique.add(ip);
    }
  }
  return Array.from(unique);
}

export function extractHostAndPort(rawUrl: string): { hostPort: string; hostname: string; port: number; protocol: 'ws:' | 'wss:' } {
  const normalized = normalizeHubUrl(rawUrl || DEFAULT_LOCAL_HUB_URL);
  try {
    const parsed = new URL(normalized);
    const protocol: 'ws:' | 'wss:' = parsed.protocol === 'wss:' ? 'wss:' : 'ws:';
    const portNum = parsed.port ? parseInt(parsed.port, 10) : (protocol === 'wss:' ? 443 : 8080);
    const port = Number.isFinite(portNum) && portNum > 0 && portNum <= 65535 ? portNum : 8080;
    const hostname = parsed.hostname || '192.168.43.1';
    return { hostPort: `${hostname}:${port}`, hostname, port, protocol };
  } catch {
    return { hostPort: '192.168.43.1:8080', hostname: '192.168.43.1', port: 8080, protocol: 'ws:' };
  }
}

export interface LocalHubTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Normalizes user or QR-scanned input into a valid WebSocket URL.
 * Supports:
 * - Direct ws:// or wss:// URLs
 * - http:// or https:// URLs (converted to ws:// or wss://)
 * - Raw IPs like 192.168.43.1:8080 or 192.168.1.5
 * - JSON strings containing `wsUrl`, `url`, `ip`, or `host`
 */
export function normalizeHubUrl(rawInput: string): string {
  if (!rawInput) return DEFAULT_LOCAL_HUB_URL;
  let text = rawInput.trim();

  // 1. Try parsing JSON if input is a JSON string
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.wsUrl) return normalizeHubUrl(parsed.wsUrl);
      if (parsed.url) return normalizeHubUrl(parsed.url);
      if (parsed.ip || parsed.host) {
        const port = parsed.port || 8080;
        return `ws://${parsed.ip || parsed.host}:${port}`;
      }
    } catch {
      // Not valid JSON, continue with string handling
    }
  }

  // Remove trailing slashes
  text = text.replace(/\/+$/, '');

  // 2. Convert http(s) to ws(s)
  if (text.startsWith('https://')) {
    return 'wss://' + text.substring('https://'.length);
  }
  if (text.startsWith('http://')) {
    return 'ws://' + text.substring('http://'.length);
  }

  // 3. Already valid ws:// or wss://
  if (text.startsWith('ws://') || text.startsWith('wss://')) {
    return text;
  }

  // 4. Raw IP or hostname (e.g. "192.168.43.1:8080" or "192.168.43.1")
  const ipMatch = text.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?$/);
  if (ipMatch) {
    if (text.includes(':')) {
      return `ws://${text}`;
    }
    return `ws://${text}:8080`;
  }

  // Fallback: prepend ws://
  return `ws://${text}`;
}

export class LocalHubConfig {
  /**
   * Retrieves the configured Local Hub URL from localStorage.
   */
  public static getLocalHubUrl(): string {
    if (typeof window === 'undefined') return DEFAULT_LOCAL_HUB_URL;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LOCAL_HUB_URL);
      if (saved && saved.trim().length > 0) {
        return normalizeHubUrl(saved);
      }
    } catch (e) {
      console.warn('[LocalHubConfig] Failed to read hub URL from storage:', e);
    }
    return DEFAULT_LOCAL_HUB_URL;
  }

  /**
   * Updates and saves the Local Hub URL in localStorage.
   */
  public static setLocalHubUrl(rawUrl: string): string {
    const normalized = normalizeHubUrl(rawUrl);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_LOCAL_HUB_URL, normalized);
        this.dispatchConfigChange();
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to write hub URL to storage:', e);
      }
    }
    return normalized;
  }

  /**
   * Checks whether "Force Local Hub" mode is enabled.
   */
  public static getForceLocalHub(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY_FORCE_LOCAL_HUB) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Toggles "Force Local Hub" mode for offline testing.
   */
  public static setForceLocalHub(force: boolean): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_FORCE_LOCAL_HUB, force ? 'true' : 'false');
        this.dispatchConfigChange();
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to write force flag to storage:', e);
      }
    }
  }

  /**
   * Retrieves the tethered Hub's branch ID.
   */
  public static getHubBranchId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const val = localStorage.getItem(STORAGE_KEY_HUB_BRANCH_ID);
      return val && val.trim().length > 0 ? val.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves the tethered Hub's branch Name (e.g. "Harare Main").
   */
  public static getHubBranchName(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const val = localStorage.getItem(STORAGE_KEY_HUB_BRANCH_NAME);
      return val && val.trim().length > 0 ? val.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves the tethered Hub's tenant ID.
   */
  public static getHubTenantId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const val = localStorage.getItem(STORAGE_KEY_HUB_TENANT_ID);
      return val && val.trim().length > 0 ? val.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Stores the tethered Local Hub's branch identity.
   */
  public static setHubBranchIdentity(branchId: string, branchName: string, tenantId?: string): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_HUB_BRANCH_ID, branchId);
        localStorage.setItem(STORAGE_KEY_HUB_BRANCH_NAME, branchName);
        if (tenantId) {
          localStorage.setItem(STORAGE_KEY_HUB_TENANT_ID, tenantId);
        }
        this.dispatchConfigChange();
        window.dispatchEvent(
          new CustomEvent('saimetric_hub_identity_updated', {
            detail: { branch_id: branchId, branch_name: branchName, tenant_id: tenantId },
          })
        );
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to write hub identity:', e);
      }
    }
  }

  /**
   * Clears the tethered Local Hub's branch identity (e.g. after RESET_BRANCH).
   */
  public static clearHubBranchIdentity(): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY_HUB_BRANCH_ID);
        localStorage.removeItem(STORAGE_KEY_HUB_BRANCH_NAME);
        localStorage.removeItem(STORAGE_KEY_HUB_TENANT_ID);
        this.dispatchConfigChange();
        window.dispatchEvent(
          new CustomEvent('saimetric_hub_identity_updated', {
            detail: { branch_id: null, branch_name: null },
          })
        );
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to clear hub identity:', e);
      }
    }
  }

  /**
   * Checks whether the device is in Cloud-Only Mode due to branch mismatch.
   */
  public static isCloudOnlyMode(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY_CLOUD_ONLY_MODE) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Sets whether the device is in Cloud-Only Mode.
   */
  public static setCloudOnlyMode(enabled: boolean): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_CLOUD_ONLY_MODE, enabled ? 'true' : 'false');
        this.dispatchConfigChange();
        window.dispatchEvent(
          new CustomEvent('saimetric_cloud_only_mode_changed', {
            detail: { isCloudOnlyMode: enabled },
          })
        );
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to set cloud only mode:', e);
      }
    }
  }

  // ==================== MULTI-HUB CREDENTIAL VAULT (KEYED BY hubId, 3-DEVICE FAILOVER) ====================

  private static readonly IDB_VAULT_DB = 'saimetric_multi_hub_vault_db';
  private static readonly IDB_VAULT_STORE = 'paired_hubs';
  private static idbHydrated = false;

  private static openVaultIdb(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.IDB_VAULT_DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.IDB_VAULT_STORE)) {
            db.createObjectStore(this.IDB_VAULT_STORE, { keyPath: 'hubId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private static mirrorVaultToIndexedDb(map: Record<string, PairedHubProfile>): void {
    void this.openVaultIdb().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(this.IDB_VAULT_STORE, 'readwrite');
        const store = tx.objectStore(this.IDB_VAULT_STORE);
        store.clear();
        for (const rec of Object.values(map)) {
          store.put(rec);
        }
      } catch {}
    });
  }

  /**
   * Restores any Multi-Hub Vault entries from IndexedDB into localStorage if localStorage
   * was cleared or is missing a hubId (non-blocking boot helper).
   */
  public static async hydrateVaultFromIndexedDb(): Promise<Record<string, PairedHubProfile>> {
    const current = this.getPairedHubsMap();
    if (this.idbHydrated) return current;
    this.idbHydrated = true;

    const db = await this.openVaultIdb();
    if (!db) return current;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.IDB_VAULT_STORE, 'readonly');
        const store = tx.objectStore(this.IDB_VAULT_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? req.result : [];
          let mergedChanged = false;
          const merged: Record<string, PairedHubProfile> = { ...current };
          for (const row of rows) {
            const norm = this.normalizeProfileRecord(row);
            if (!norm) continue;
            const existingKey = Object.keys(merged).find(
              (k) => k.toUpperCase() === norm.hubId.toUpperCase()
            );
            if (!existingKey) {
              merged[norm.hubId] = norm;
              mergedChanged = true;
            }
          }
          if (mergedChanged) {
            try {
              localStorage.setItem(STORAGE_KEY_PAIRED_HUBS, JSON.stringify(merged));
              this.dispatchConfigChange();
            } catch {}
          }
          resolve(merged);
        };
        req.onerror = () => resolve(current);
      } catch {
        resolve(current);
      }
    });
  }

  private static normalizeProfileRecord(raw: any): PairedHubProfile | null {
    if (!raw || typeof raw !== 'object') return null;
    const hubId = String(raw.hubId || '').trim();
    const deviceSecret = String(raw.deviceSecret || '').trim();
    if (!hubId || !deviceSecret) return null;

    const baseUrl =
      raw.lastWsUrl ||
      raw.wsUrl ||
      (raw.lastKnownHost ? `ws://${raw.lastKnownHost}` : null) ||
      (raw.lastIp ? `ws://${raw.lastIp}:${raw.lastPort || raw.port || 8080}` : DEFAULT_LOCAL_HUB_URL);
    const parsed = extractHostAndPort(baseUrl);
    const rawPort = Number(raw.lastPort ?? raw.port);
    const port =
      Number.isFinite(rawPort) && rawPort > 0 && rawPort <= 65535
        ? Math.floor(rawPort)
        : parsed.port;
    const lastIp =
      typeof raw.lastIp === 'string' && raw.lastIp.trim()
        ? raw.lastIp.trim()
        : parsed.hostname;
    const lastKnownHost =
      typeof raw.lastKnownHost === 'string' && raw.lastKnownHost.trim()
        ? raw.lastKnownHost.trim().includes(':')
          ? raw.lastKnownHost.trim()
          : `${raw.lastKnownHost.trim()}:${port}`
        : `${lastIp}:${port}`;
    const wsUrl = normalizeHubUrl(`${parsed.protocol}//${lastKnownHost}`);
    const mdnsHost = sanitizeMdnsHost(raw.mdnsHost);
    const lanIps = sanitizeLanIps([...(Array.isArray(raw.lanIps) ? raw.lanIps : []), lastIp]);
    const hubRole = normalizeHubRole(raw.hubRole);
    const hubPriority = normalizeHubPriority(raw.hubPriority, hubRole);
    const lastEpoch = normalizeBranchEpoch(raw.lastEpoch ?? raw.branchEpoch, 1);
    const hubMode = raw.hubMode ? normalizeHubMode(raw.hubMode) : undefined;

    return {
      hubId,
      wsUrl,
      lastWsUrl: wsUrl,
      lastIp,
      lastKnownHost,
      ...(mdnsHost ? { mdnsHost } : {}),
      port,
      lastPort: port,
      ...(lanIps.length > 0 ? { lanIps } : {}),
      branchId: String(raw.branchId || 'UNASSIGNED').trim(),
      branchName: String(raw.branchName || raw.branchId || 'Local Hub').trim(),
      tenantId: String(raw.tenantId || 'COMP-001').trim(),
      deviceId: String(raw.deviceId || '').trim(),
      deviceSecret,
      hubRole,
      hubPriority,
      lastEpoch,
      ...(hubMode ? { hubMode } : {}),
      ...(raw.hubPubKey ? { hubPubKey: String(raw.hubPubKey) } : {}),
      ...(raw.hubVersion ? { hubVersion: String(raw.hubVersion) } : {}),
      hubRuntime:
        raw.hubRuntime === 'ANDROID_APK' || raw.hubRuntime === 'TERMUX'
          ? raw.hubRuntime
          : 'UNKNOWN',
      pairedAt: Number(raw.pairedAt) || Date.now(),
      lastConnectedAt: Number(raw.lastConnectedAt) || Number(raw.pairedAt) || Date.now(),
    };
  }

  /**
   * Returns paired Hub credentials strictly indexed by `hubId` (never by IP address).
   * Automatically migrates any legacy array format into Record<hubId, PairedHubProfile>.
   */
  public static getPairedHubsMap(): Record<string, PairedHubProfile> {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PAIRED_HUBS);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const map: Record<string, PairedHubProfile> = {};

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const norm = this.normalizeProfileRecord(item);
          if (norm) map[norm.hubId] = norm;
        }
        try {
          localStorage.setItem(STORAGE_KEY_PAIRED_HUBS, JSON.stringify(map));
          this.mirrorVaultToIndexedDb(map);
        } catch {}
        return map;
      }

      if (parsed && typeof parsed === 'object') {
        for (const val of Object.values(parsed)) {
          const norm = this.normalizeProfileRecord(val);
          if (norm) map[norm.hubId] = norm;
        }
      }
      return map;
    } catch {
      return {};
    }
  }

  public static getPairedHubs(): PairedHubProfile[] {
    return Object.values(this.getPairedHubsMap()).sort((a, b) => {
      if ((b.hubPriority || 0) !== (a.hubPriority || 0)) {
        return (b.hubPriority || 0) - (a.hubPriority || 0);
      }
      return (b.lastConnectedAt || b.pairedAt || 0) - (a.lastConnectedAt || a.pairedAt || 0);
    });
  }

  public static getPairedHubsForBranch(branchId: string, tenantId?: string): PairedHubProfile[] {
    const targetBranch = String(branchId || '').trim().toUpperCase();
    const targetTenant = String(tenantId || '').trim().toUpperCase();
    if (!targetBranch) return this.getPairedHubs();
    return this.getPairedHubs().filter((p) => {
      const sameBranch = p.branchId.toUpperCase() === targetBranch;
      const sameTenant = !targetTenant || !p.tenantId || p.tenantId.toUpperCase() === targetTenant;
      return sameBranch && sameTenant;
    });
  }

  public static hasAnyPairedHub(): boolean {
    return Object.keys(this.getPairedHubsMap()).length > 0;
  }

  private static writePairedHubsMap(map: Record<string, PairedHubProfile>): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_PAIRED_HUBS, JSON.stringify(map));
      this.mirrorVaultToIndexedDb(map);
      this.dispatchConfigChange();
    } catch (e) {
      console.warn('[LocalHubConfig] Failed to persist paired hub profiles:', e);
    }
  }

  /**
   * Saves or updates a paired Hub record keyed strictly by `hubId`.
   * Never overwrites or evicts another Hub in the same branch or on the same IP/hotspot.
   */
  public static savePairedHubProfile(
    profile: Omit<
      PairedHubProfile,
      'lastKnownHost' | 'port' | 'lastWsUrl' | 'lastIp' | 'lastPort' | 'hubRole' | 'hubPriority' | 'lastEpoch'
    > & {
      lastKnownHost?: string;
      port?: number;
      lastWsUrl?: string;
      lastIp?: string;
      lastPort?: number;
      hubRole?: HubRole;
      hubPriority?: number;
      lastEpoch?: number;
    }
  ): void {
    const map = this.getPairedHubsMap();
    const targetUpper = String(profile.hubId || '').trim().toUpperCase();
    const existingKey = Object.keys(map).find((k) => k.toUpperCase() === targetUpper);
    const existing = existingKey ? map[existingKey] : null;
    if (existingKey && existingKey !== profile.hubId) {
      delete map[existingKey];
    }

    const nextRole = profile.hubRole ? normalizeHubRole(profile.hubRole) : (existing?.hubRole || 'PRIMARY');
    const nextPriority =
      profile.hubPriority !== undefined
        ? normalizeHubPriority(profile.hubPriority, nextRole)
        : existing?.hubPriority !== undefined
        ? existing.hubPriority
        : defaultPriorityForRole(nextRole);
    const nextEpoch = Math.max(
      existing?.lastEpoch || 1,
      normalizeBranchEpoch(profile.lastEpoch, existing?.lastEpoch || 1)
    );

    const mergedRaw = {
      ...(existing || {}),
      ...profile,
      hubRole: nextRole,
      hubPriority: nextPriority,
      lastEpoch: nextEpoch,
      mdnsHost: sanitizeMdnsHost(profile.mdnsHost) || existing?.mdnsHost,
      lanIps:
        profile.lanIps && profile.lanIps.length > 0
          ? sanitizeLanIps([...(profile.lanIps || []), ...(existing?.lanIps || [])])
          : existing?.lanIps,
      pairedAt: existing?.pairedAt || profile.pairedAt || Date.now(),
      lastConnectedAt: profile.lastConnectedAt || Date.now(),
    };

    const normalized = this.normalizeProfileRecord(mergedRaw);
    if (!normalized) return;
    map[normalized.hubId] = normalized;
    this.writePairedHubsMap(map);
  }

  public static removePairedHubProfile(hubIdOrUrl: string): void {
    const target = String(hubIdOrUrl || '').trim().toUpperCase();
    if (!target) return;
    const map = this.getPairedHubsMap();
    let changed = false;

    // 1. Strict hubId removal first so we never accidentally remove another Hub sharing a hotspot IP
    for (const [key, p] of Object.entries(map)) {
      if (key.toUpperCase() === target || p.hubId.toUpperCase() === target) {
        delete map[key];
        changed = true;
      }
    }

    // 2. Fallback to URL removal only if no exact hubId matched
    if (!changed) {
      const targetUrl = normalizeHubUrl(hubIdOrUrl);
      for (const [key, p] of Object.entries(map)) {
        if (normalizeHubUrl(p.wsUrl) === targetUrl) {
          delete map[key];
          changed = true;
        }
      }
    }

    if (changed) {
      this.writePairedHubsMap(map);
    }
  }

  public static getPairedHubById(hubId: string): PairedHubProfile | null {
    const target = String(hubId || '').trim().toUpperCase();
    if (!target) return null;
    const map = this.getPairedHubsMap();
    for (const p of Object.values(map)) {
      if (p.hubId.toUpperCase() === target) return p;
    }
    return null;
  }

  public static getPairedHubForBranch(branchId: string): PairedHubProfile | null {
    const branchHubs = this.getPairedHubsForBranch(branchId);
    return branchHubs.length > 0 ? branchHubs[0] : null;
  }

  public static getPairedHubForUrl(rawUrl: string): PairedHubProfile | null {
    if (!rawUrl) return null;
    const cleanUrl = normalizeHubUrl(rawUrl);
    const parsed = extractHostAndPort(cleanUrl);
    return (
      this.getPairedHubs().find(
        (p) =>
          normalizeHubUrl(p.wsUrl) === cleanUrl ||
          p.lastKnownHost.toLowerCase() === parsed.hostPort.toLowerCase() ||
          (p.mdnsHost && p.mdnsHost.toLowerCase() === parsed.hostname.toLowerCase())
      ) || null
    );
  }

  public static getPrimaryPairedHub(preferredBranchId?: string): PairedHubProfile | null {
    const currentUrl = this.getLocalHubUrl();
    const byUrl = this.getPairedHubForUrl(currentUrl);
    if (byUrl) return byUrl;
    if (preferredBranchId) {
      const byBranch = this.getPairedHubForBranch(preferredBranchId);
      if (byBranch) return byBranch;
    }
    const all = this.getPairedHubs();
    return all.length > 0 ? all[0] : null;
  }

  /**
   * Returns true if the target URL is already associated with a paired secure Hub profile,
   * preventing silent downgrade to an unauthenticated spoofed Hub on the same LAN IP.
   */
  public static isStrictAuthRequiredForUrl(rawUrl: string): boolean {
    return this.getPairedHubForUrl(rawUrl) !== null;
  }

  /**
   * Updates lastKnownHost / lastIp / lastWsUrl / lastPort / hubRole / hubPriority / lastEpoch / hubMode
   * on a paired Hub profile keyed strictly by `hubId`.
   */
  public static touchPairedHubProfile(
    hubId: string,
    patch: Partial<
      Pick<
        PairedHubProfile,
        | 'wsUrl'
        | 'lastWsUrl'
        | 'lastIp'
        | 'lastKnownHost'
        | 'mdnsHost'
        | 'port'
        | 'lastPort'
        | 'lanIps'
        | 'branchId'
        | 'branchName'
        | 'tenantId'
        | 'hubRole'
        | 'hubPriority'
        | 'lastEpoch'
        | 'hubMode'
        | 'hubVersion'
        | 'hubRuntime'
        | 'lastConnectedAt'
      >
    >
  ): void {
    const map = this.getPairedHubsMap();
    const target = String(hubId || '').trim().toUpperCase();
    const existingKey = Object.keys(map).find((k) => k.toUpperCase() === target);
    if (!existingKey) return;

    const prev = map[existingKey];
    let nextWsUrl = prev.wsUrl;
    let nextLastKnownHost = prev.lastKnownHost;
    let nextLastIp = prev.lastIp;
    let nextPort = prev.lastPort || prev.port || 8080;

    const rawHostInput = patch.lastKnownHost || patch.lastWsUrl || patch.wsUrl;
    if (rawHostInput) {
      const parsed = extractHostAndPort(rawHostInput);
      nextPort = patch.lastPort || patch.port || parsed.port;
      nextLastIp = patch.lastIp || parsed.hostname;
      nextLastKnownHost = `${parsed.hostname}:${nextPort}`;
      nextWsUrl = `${parsed.protocol}//${nextLastKnownHost}`;
    } else if (patch.lastIp) {
      nextPort = patch.lastPort || patch.port || nextPort;
      nextLastIp = patch.lastIp;
      nextLastKnownHost = `${nextLastIp}:${nextPort}`;
      nextWsUrl = `ws://${nextLastKnownHost}`;
    } else if (patch.lastPort || patch.port) {
      nextPort = patch.lastPort || patch.port || nextPort;
    }

    const nextMdns = sanitizeMdnsHost(patch.mdnsHost) || prev.mdnsHost;
    const nextLanIps =
      patch.lanIps && patch.lanIps.length > 0
        ? sanitizeLanIps([...patch.lanIps, nextLastIp, ...(prev.lanIps || [])]).slice(0, 12)
        : prev.lanIps;

    const nextRole = patch.hubRole ? normalizeHubRole(patch.hubRole) : prev.hubRole;
    const nextPriority =
      patch.hubPriority !== undefined
        ? normalizeHubPriority(patch.hubPriority, nextRole)
        : prev.hubPriority;
    const nextEpoch =
      patch.lastEpoch !== undefined
        ? Math.max(prev.lastEpoch || 1, normalizeBranchEpoch(patch.lastEpoch, prev.lastEpoch || 1))
        : prev.lastEpoch;

    const updated = this.normalizeProfileRecord({
      ...prev,
      ...patch,
      wsUrl: nextWsUrl,
      lastWsUrl: nextWsUrl,
      lastIp: nextLastIp,
      lastKnownHost: nextLastKnownHost,
      port: nextPort,
      lastPort: nextPort,
      hubRole: nextRole,
      hubPriority: nextPriority,
      lastEpoch: nextEpoch,
      ...(nextMdns ? { mdnsHost: nextMdns } : {}),
      ...(nextLanIps && nextLanIps.length > 0 ? { lanIps: nextLanIps } : {}),
      lastConnectedAt: patch.lastConnectedAt || Date.now(),
    });

    if (updated) {
      map[existingKey] = updated;
      this.writePairedHubsMap(map);
    }
  }

  /**
   * For roaming Managers/Owners: if the newly selected branch already has a paired Hub,
   * switches the active Local Hub URL automatically without overwriting other branches' credentials.
   */
  public static switchToPairedBranchHub(branchId: string): PairedHubProfile | null {
    const profile = this.getPairedHubForBranch(branchId);
    if (!profile) return null;
    if (this.getLocalHubUrl() !== profile.wsUrl) {
      this.setLocalHubUrl(profile.wsUrl);
    }
    return profile;
  }

  /**
   * Tests connection to a WebSocket Hub with round-trip latency measurement.
   */
  public static async testHubConnection(rawUrl: string, timeoutMs: number = 4000): Promise<LocalHubTestResult> {
    const url = normalizeHubUrl(rawUrl);
    const startTime = performance.now();

    return new Promise((resolve) => {
      let settled = false;
      let ws: WebSocket | null = null;
      let timer: number | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (ws) {
          try {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            ws.close();
          } catch {}
          ws = null;
        }
      };

      const finish = (result: LocalHubTestResult) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      };

      timer = window.setTimeout(() => {
        finish({
          success: false,
          error: `Connection timed out after ${timeoutMs}ms. Verify Termux Node server is running on ${url}.`,
        });
      }, timeoutMs);

      try {
        ws = new WebSocket(url);

        ws.onopen = () => {
          const latencyMs = Math.round(performance.now() - startTime);
          try {
            // Optional test ping packet
            ws?.send(JSON.stringify({ type: 'PING', source: 'TEST_PROBE', timestamp: Date.now() }));
          } catch {}
          finish({
            success: true,
            latencyMs,
          });
        };

        ws.onerror = () => {
          finish({
            success: false,
            error: `Unable to connect to ${url}. Ensure device is on the same Wi-Fi / Hotspot.`,
          });
        };

        ws.onclose = (ev) => {
          if (!settled) {
            finish({
              success: false,
              error: `Connection closed (${ev.code || 'Unreachable'}). Check Termux WebSocket hub status.`,
            });
          }
        };
      } catch (err: any) {
        finish({
          success: false,
          error: err?.message || 'WebSocket creation error',
        });
      }
    });
  }

  /**
   * Broadcasts a DOM event so UI and meshSyncService can react dynamically to config changes.
   */
  public static dispatchConfigChange(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('saimetric-local-hub-config-changed', {
          detail: {
            url: this.getLocalHubUrl(),
            forceLocalHub: this.getForceLocalHub(),
            hubBranchId: this.getHubBranchId(),
            hubBranchName: this.getHubBranchName(),
            isCloudOnlyMode: this.isCloudOnlyMode(),
          },
        })
      );
    }
  }

  /**
   * Subscribes to local hub configuration changes.
   */
  public static subscribe(callback: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('saimetric-local-hub-config-changed', handler);
    return () => {
      window.removeEventListener('saimetric-local-hub-config-changed', handler);
    };
  }
}
