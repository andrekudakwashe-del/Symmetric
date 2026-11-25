/**
 * HubRoamingDiscovery & Deterministic 3-Hub Failover Election Client
 *
 * Supports:
 *   1) Multi-Hub Credential Vault (Manager = PRIMARY/100, Backup = BACKUP/50, Till = TILL_FALLBACK/10)
 *   2) Deterministic Leader Selection across mDNS / Android NSD bridge / remembered LAN IPs / /health fallback:
 *      - Filter strictly to logged-in user's `tenantId` & `branchId`
 *      - Prefer `hubMode === "ACTIVE"` (fallback to `"STANDBY"` only if no `"ACTIVE"` responds)
 *      - Rank by highest `branchEpoch`, then highest `hubPriority`, then lexicographically lowest `hubId`,
 *        with already-paired `hubId` preferred on ties
 *   3) Seamless Wi-Fi/Hotspot IP Roaming (Last Known -> mDNS/NSD -> Hotspot Gateways -> /24 Subnets)
 *
 * Security:
 *   Discovery ONLY locates candidate hosts. Trust is NEVER granted by `/health` alone —
 *   the WebSocket still executes full v4.1.0 Mutual HMAC-SHA256 (`AUTH_CHALLENGE -> AUTH_RESPONSE -> AUTH_OK`).
 */

import {
  ActiveLeaderInfo,
  HubMode,
  HubRole,
  PairedHubProfile,
  extractHostAndPort,
  normalizeBranchEpoch,
  normalizeHubMode,
  normalizeHubPriority,
  normalizeHubRole,
  sanitizeActiveLeaderInfo,
  sanitizeLanIps,
  sanitizeMdnsHost,
} from '../../utils/localHubConfig';

export type DiscoveryStage = 'LAST_KNOWN' | 'MDNS' | 'HOTSPOT_PROBE' | 'SUBNET_PROBE';

export interface DiscoveredHubCandidate {
  ip: string;
  port: number;
  wsUrl: string;
  lastKnownHost: string;
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
  mdnsHost?: string;
  lanIps?: string[];
  isPaired: boolean;
  discoveredVia: DiscoveryStage;
}

export interface HubDiscoveryResult {
  wsUrl: string;
  lastKnownHost: string;
  lastIp: string;
  port: number;
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
  mdnsHost?: string;
  lanIps?: string[];
  isPaired: boolean;
  discoveredVia: DiscoveryStage;
  ipChanged: boolean;
}

const HOTSPOT_AND_GATEWAY_IPS = [
  '192.168.43.1',  // Android Wi-Fi Hotspot
  '192.168.137.1', // Windows Mobile Hotspot / ICS
  '172.20.10.1',   // iOS Personal Hotspot
  '192.168.1.1',   // Common branch router
  '192.168.0.1',   // Common branch router
  '10.0.0.1',      // Enterprise / Mikrotik gateway
  '127.0.0.1',     // Same-device Hub APK
];

const COMMON_BRANCH_SUBNETS = ['192.168.1', '192.168.0', '192.168.43'];

const IPV4_PREFIX_REGEX = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/;
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

function extractSubnetPrefix(hostOrIp?: string): string | null {
  if (!hostOrIp) return null;
  const host = hostOrIp.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').split(':')[0].trim();
  if (host === '127.0.0.1' || host.startsWith('127.')) return null;
  const m = host.match(IPV4_PREFIX_REGEX);
  return m ? m[1] : null;
}

/**
 * Reads optional native Android NSD / mDNS discovered endpoints if injected by a WebView/TWA bridge.
 */
function getNativeNsdSeedEndpoints(): Array<{ host: string; port: number }> {
  if (typeof window === 'undefined') return [];
  const results: Array<{ host: string; port: number }> = [];
  const seen = new Set<string>();
  const add = (host: string, port: number) => {
    const cleanHost = String(host || '').trim().toLowerCase();
    const cleanPort = Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : 8080;
    if (!cleanHost) return;
    if (!IPV4_REGEX.test(cleanHost) && !sanitizeMdnsHost(cleanHost)) return;
    const key = `${cleanHost}:${cleanPort}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ host: cleanHost, port: cleanPort });
    }
  };

  try {
    const w = window as any;
    const rawList =
      (Array.isArray(w.__SAIMETRIC_NSD_HUBS__) ? w.__SAIMETRIC_NSD_HUBS__ : null) ||
      (typeof w.AndroidNsdBridge?.getDiscoveredHubs === 'function'
        ? JSON.parse(String(w.AndroidNsdBridge.getDiscoveredHubs() || '[]'))
        : null);
    if (Array.isArray(rawList)) {
      for (const item of rawList) {
        if (!item) continue;
        if (typeof item === 'string') {
          const parsed = extractHostAndPort(item);
          add(parsed.hostname, parsed.port);
        } else if (typeof item === 'object') {
          const host = item.lanIp || item.ip || item.host || item.mdnsHost || '';
          const port = Number(item.wsPort || item.port || 8080);
          if (host) add(host, port);
        }
      }
    }
  } catch {}

  return results;
}

/**
 * Deterministic Leader Ranking for 3-Device Failover:
 *   1. Prefer `hubMode === "ACTIVE"` (only fall back to `"STANDBY"` if no `"ACTIVE"` candidate responds)
 *   2. Highest `branchEpoch`
 *   3. Highest `hubPriority` (PRIMARY=100 > BACKUP=50 > TILL_FALLBACK=10)
 *   4. Lexicographically lowest `hubId`
 *   5. Already-paired `hubId` preferred if tied
 */
export function rankHubCandidates(
  candidates: DiscoveredHubCandidate[],
  pairedHubIds?: Set<string>
): DiscoveredHubCandidate[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  // Deduplicate by hubId keeping the ACTIVE / highest-epoch view of each Hub
  const byHubId = new Map<string, DiscoveredHubCandidate>();
  for (const c of candidates) {
    const key = c.hubId.toUpperCase();
    const existing = byHubId.get(key);
    if (!existing) {
      byHubId.set(key, c);
    } else if (
      (c.hubMode === 'ACTIVE' && existing.hubMode !== 'ACTIVE') ||
      c.branchEpoch > existing.branchEpoch
    ) {
      byHubId.set(key, c);
    }
  }

  const deduped = Array.from(byHubId.values());
  const activeOnly = deduped.filter((c) => c.hubMode === 'ACTIVE');
  const pool = activeOnly.length > 0 ? activeOnly : deduped;

  return pool.sort((a, b) => {
    // 1. ACTIVE over STANDBY
    const aActive = a.hubMode === 'ACTIVE' ? 1 : 0;
    const bActive = b.hubMode === 'ACTIVE' ? 1 : 0;
    if (bActive !== aActive) return bActive - aActive;

    // 2. Highest branchEpoch
    if (b.branchEpoch !== a.branchEpoch) return b.branchEpoch - a.branchEpoch;

    // 3. Highest hubPriority
    if (b.hubPriority !== a.hubPriority) return b.hubPriority - a.hubPriority;

    // 4. Lexicographically lowest hubId
    const idCmp = a.hubId.localeCompare(b.hubId);
    if (idCmp !== 0) return idCmp;

    // 5. Already-paired preferred if tied
    const aPaired = a.isPaired || Boolean(pairedHubIds?.has(a.hubId.toUpperCase())) ? 1 : 0;
    const bPaired = b.isPaired || Boolean(pairedHubIds?.has(b.hubId.toUpperCase())) ? 1 : 0;
    return bPaired - aPaired;
  });
}

function matchesTenantAndBranch(
  reportedTenant: string | undefined,
  reportedBranch: string | undefined,
  expectedTenantId?: string,
  expectedBranchId?: string
): boolean {
  const normExpectedTenant = String(expectedTenantId || '').trim().toUpperCase();
  const normExpectedBranch = String(expectedBranchId || '').trim().toUpperCase();
  const normRepTenant = String(reportedTenant || '').trim().toUpperCase();
  const normRepBranch = String(reportedBranch || '').trim().toUpperCase();

  if (normExpectedTenant && normRepTenant && normRepTenant !== normExpectedTenant) {
    return false;
  }
  if (
    normExpectedBranch &&
    normExpectedBranch !== 'ALL' &&
    normExpectedBranch !== 'UNASSIGNED' &&
    normRepBranch &&
    normRepBranch !== 'ALL' &&
    normRepBranch !== 'UNASSIGNED' &&
    normRepBranch !== normExpectedBranch
  ) {
    return false;
  }
  return true;
}

/**
 * Lightweight WebSocket reachability + AUTH_CHALLENGE metadata pre-check.
 */
async function probeWsEndpoint(
  wsUrl: string,
  pairedHubIds: Set<string>,
  timeoutMs: number,
  expectedTenantId?: string,
  expectedBranchId?: string,
  allowUnpairedForSameBranch = false
): Promise<DiscoveredHubCandidate | null> {
  if (typeof WebSocket === 'undefined') return null;

  const parsedUrl = extractHostAndPort(wsUrl);

  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let challengeTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: DiscoveredHubCandidate | null) => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (challengeTimer) clearTimeout(challengeTimer);
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = () => {};
          ws.onclose = null;
          ws.close();
        } catch {}
        ws = null;
      }
      resolve(result);
    };

    connectTimer = setTimeout(() => finish(null), timeoutMs);

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        challengeTimer = setTimeout(() => {
          // Opened without immediate AUTH_CHALLENGE (legacy Hub) — not eligible for failover metadata
          finish(null);
        }, 550);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data || ''));
          const msgHubId = String(msg?.hubId || msg?.hub_id || '').trim();
          if (!msgHubId) return;

          const reportedTenant = String(msg?.tenantId || msg?.tenant_id || '').trim() || undefined;
          const reportedBranch = String(msg?.branchId || msg?.branch_id || '').trim() || undefined;
          const isPaired = pairedHubIds.has(msgHubId.toUpperCase());

          if (!matchesTenantAndBranch(reportedTenant, reportedBranch, expectedTenantId, expectedBranchId)) {
            finish(null);
            return;
          }

          if (!isPaired && !allowUnpairedForSameBranch) {
            finish(null);
            return;
          }

          const hubRole = normalizeHubRole(msg?.hubRole || msg?.hub_role);
          const hubPriority = normalizeHubPriority(msg?.hubPriority ?? msg?.hub_priority, hubRole);
          const branchEpoch = normalizeBranchEpoch(msg?.branchEpoch ?? msg?.branch_epoch, 1);
          const hubMode = normalizeHubMode(msg?.hubMode || msg?.hub_mode);
          const isColdHub = Boolean(msg?.isColdHub ?? msg?.is_cold_hub);
          const activeLeaderInfo = sanitizeActiveLeaderInfo(msg?.activeLeaderInfo || msg?.active_leader_info);
          const activeLeaderHubId =
            String(msg?.activeLeaderHubId || msg?.active_leader_hub_id || activeLeaderInfo?.hubId || '').trim() || null;

          finish({
            ip: parsedUrl.hostname,
            port: parsedUrl.port,
            wsUrl,
            lastKnownHost: parsedUrl.hostPort,
            hubId: msgHubId,
            tenantId: reportedTenant,
            branchId: reportedBranch,
            branchName: String(msg?.branchName || msg?.branch_name || '').trim() || undefined,
            hubRole,
            hubPriority,
            branchEpoch,
            hubMode,
            isColdHub,
            activeLeaderHubId,
            activeLeaderInfo,
            mdnsHost: sanitizeMdnsHost(msg?.mdnsHost || msg?.mdns_host),
            lanIps: sanitizeLanIps(msg?.lanIps || msg?.lan_ips),
            isPaired,
            discoveredVia: 'LAST_KNOWN',
          });
        } catch {}
      };

      ws.onerror = () => finish(null);
      ws.onclose = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

/**
 * Probes `http://<host>:<port>/health` (CORS enabled on Hub).
 * Accepts paired Hubs AND (when tenantId & branchId match strictly) emergency unpaired ACTIVE branch Hubs.
 */
async function probeHttpHealthCandidate(
  host: string,
  port: number,
  pairedHubMap: Map<string, PairedHubProfile>,
  expectedTenantId: string | undefined,
  expectedBranchId: string | undefined,
  discoveredVia: DiscoveryStage,
  signal: AbortSignal,
  timeoutMs = 450,
  allowUnpairedForSameBranch = false
): Promise<DiscoveredHubCandidate | null> {
  if (signal.aborted || typeof fetch === 'undefined') return null;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`http://${host}:${port}/health`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || data.status !== 'ok') return null;

    const reportedHubId = String(data.hubId || data.hub_id || '').trim();
    if (!reportedHubId) return null;

    const reportedTenant = String(data.tenantId || data.tenant_id || '').trim() || undefined;
    const reportedBranch = String(data.branchId || data.branch_id || '').trim() || undefined;
    const reportedBranchName = String(data.branchName || data.branch_name || '').trim() || undefined;

    const matchedProfile = pairedHubMap.get(reportedHubId.toUpperCase());
    const isPaired = Boolean(matchedProfile);

    // Strict tenant & branch filter
    if (!matchesTenantAndBranch(reportedTenant, reportedBranch, expectedTenantId, expectedBranchId)) {
      return null;
    }

    // If not paired, only accept when tenantId + branchId are explicitly matched (never accept unknown tenant/branch!)
    if (!isPaired) {
      if (!allowUnpairedForSameBranch) return null;
      if (!expectedTenantId || !expectedBranchId || !reportedTenant || !reportedBranch) {
        return null;
      }
    } else if (
      matchedProfile &&
      reportedTenant &&
      matchedProfile.tenantId &&
      reportedTenant.toUpperCase() !== matchedProfile.tenantId.toUpperCase()
    ) {
      return null;
    }

    const hubRole = normalizeHubRole(data.hubRole || data.hub_role || matchedProfile?.hubRole);
    const hubPriority = normalizeHubPriority(
      data.hubPriority ?? data.hub_priority ?? matchedProfile?.hubPriority,
      hubRole
    );
    const branchEpoch = normalizeBranchEpoch(
      data.branchEpoch ?? data.branch_epoch ?? matchedProfile?.lastEpoch,
      1
    );
    const hubMode = normalizeHubMode(data.hubMode || data.hub_mode);
    const isColdHub = Boolean(data.isColdHub ?? data.is_cold_hub);
    const activeLeaderInfo = sanitizeActiveLeaderInfo(data.activeLeaderInfo || data.active_leader_info);
    const activeLeaderHubId =
      String(data.activeLeaderHubId || data.active_leader_hub_id || activeLeaderInfo?.hubId || '').trim() || null;

    const effectivePort = Number(data.wsPort ?? data.port ?? port) || port;
    const safePort = effectivePort > 0 && effectivePort <= 65535 ? Math.floor(effectivePort) : port;
    const hostPort = `${host}:${safePort}`;

    return {
      ip: host,
      port: safePort,
      wsUrl: `ws://${hostPort}`,
      lastKnownHost: hostPort,
      hubId: matchedProfile?.hubId || reportedHubId,
      tenantId: reportedTenant || matchedProfile?.tenantId,
      branchId: reportedBranch || matchedProfile?.branchId,
      branchName: reportedBranchName || matchedProfile?.branchName,
      hubRole,
      hubPriority,
      branchEpoch,
      hubMode,
      isColdHub,
      activeLeaderHubId,
      activeLeaderInfo,
      mdnsHost: sanitizeMdnsHost(data.mdnsHost || data.mdns_host) || matchedProfile?.mdnsHost,
      lanIps: sanitizeLanIps(data.lanIps || data.lan_ips),
      isPaired,
      discoveredVia,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Runs bounded-concurrency `/health` probes across a list of hosts.
 * When `collectAll` is true (fast small pools: remembered IPs / gateways), gathers ALL responding
 * branch Hubs so deterministic ranking picks the true ACTIVE highest-epoch/priority leader.
 * When `collectAll` is false (/24 subnet sweeps), returns immediately on the first ACTIVE match.
 */
async function runConcurrentHealthProbes(
  targets: Array<{ host: string; port: number }>,
  pairedHubMap: Map<string, PairedHubProfile>,
  expectedTenantId: string | undefined,
  expectedBranchId: string | undefined,
  discoveredVia: DiscoveryStage,
  options: {
    concurrency?: number;
    timeoutMs?: number;
    collectAll?: boolean;
    allowUnpairedForSameBranch?: boolean;
  } = {}
): Promise<DiscoveredHubCandidate[]> {
  if (targets.length === 0) return [];
  const concurrency = options.concurrency ?? 20;
  const timeoutMs = options.timeoutMs ?? 450;
  const collectAll = Boolean(options.collectAll);
  const allowUnpaired = Boolean(options.allowUnpairedForSameBranch);

  return new Promise((resolve) => {
    const parentController = new AbortController();
    let nextIdx = 0;
    let settled = false;
    const found: DiscoveredHubCandidate[] = [];

    const finish = () => {
      if (settled) return;
      settled = true;
      parentController.abort();
      resolve(found);
    };

    const worker = async () => {
      while (!settled && !parentController.signal.aborted && nextIdx < targets.length) {
        const target = targets[nextIdx++];
        const match = await probeHttpHealthCandidate(
          target.host,
          target.port,
          pairedHubMap,
          expectedTenantId,
          expectedBranchId,
          discoveredVia,
          parentController.signal,
          timeoutMs,
          allowUnpaired
        );
        if (match && !settled) {
          found.push(match);
          // For large /24 scans, stop immediately on first ACTIVE paired Hub (unless STANDBY hints another leader)
          if (!collectAll && match.hubMode === 'ACTIVE' && match.isPaired) {
            finish();
            return;
          }
        }
      }
    };

    const workerCount = Math.min(concurrency, targets.length);
    Promise.all(Array.from({ length: workerCount }, () => worker())).then(() => {
      finish();
    });
  });
}

function toDiscoveryResult(
  winner: DiscoveredHubCandidate,
  previousHostPort: string
): HubDiscoveryResult {
  return {
    wsUrl: winner.wsUrl,
    lastKnownHost: winner.lastKnownHost,
    lastIp: winner.ip,
    port: winner.port,
    hubId: winner.hubId,
    tenantId: winner.tenantId,
    branchId: winner.branchId,
    branchName: winner.branchName,
    hubRole: winner.hubRole,
    hubPriority: winner.hubPriority,
    branchEpoch: winner.branchEpoch,
    hubMode: winner.hubMode,
    isColdHub: winner.isColdHub,
    activeLeaderHubId: winner.activeLeaderHubId,
    activeLeaderInfo: winner.activeLeaderInfo,
    mdnsHost: winner.mdnsHost,
    lanIps: winner.lanIps,
    isPaired: winner.isPaired,
    discoveredVia: winner.discoveredVia,
    ipChanged: winner.lastKnownHost.toLowerCase() !== previousHostPort.toLowerCase(),
  };
}

/**
 * If any responding Hub is in STANDBY and advertises `activeLeaderInfo`, directly probe that
 * advertised leader so failover snaps to the real ACTIVE leader without a full subnet scan.
 */
async function followStandbyLeaderRedirects(
  candidates: DiscoveredHubCandidate[],
  pairedHubMap: Map<string, PairedHubProfile>,
  expectedTenantId: string | undefined,
  expectedBranchId: string | undefined,
  allowUnpaired: boolean
): Promise<DiscoveredHubCandidate[]> {
  const redirectTargets: Array<{ host: string; port: number }> = [];
  const seen = new Set(candidates.map((c) => `${c.ip}:${c.port}`.toLowerCase()));

  for (const c of candidates) {
    if (c.hubMode === 'STANDBY' && c.activeLeaderInfo) {
      const parsed = extractHostAndPort(c.activeLeaderInfo.wsUrl);
      const key = `${parsed.hostname}:${parsed.port}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        redirectTargets.push({ host: parsed.hostname, port: parsed.port });
      }
    }
  }

  if (redirectTargets.length === 0) return candidates;

  const extra = await runConcurrentHealthProbes(
    redirectTargets,
    pairedHubMap,
    expectedTenantId,
    expectedBranchId,
    'HOTSPOT_PROBE',
    {
      concurrency: 6,
      timeoutMs: 650,
      collectAll: true,
      allowUnpairedForSameBranch: allowUnpaired,
    }
  );

  // If the advertised ACTIVE leader didn't respond to HTTP /health (e.g. strict firewall) but STANDBY gave valid activeLeaderInfo,
  // still synthesize a candidate from activeLeaderInfo only if direct probe failed AND it matches tenant/branch
  const combined = [...candidates, ...extra];
  const combinedIds = new Set(combined.map((c) => c.hubId.toUpperCase()));
  for (const c of candidates) {
    if (c.hubMode === 'STANDBY' && c.activeLeaderInfo && !combinedIds.has(c.activeLeaderInfo.hubId.toUpperCase())) {
      const info = c.activeLeaderInfo;
      if (matchesTenantAndBranch(info.tenantId || c.tenantId, info.branchId || c.branchId, expectedTenantId, expectedBranchId)) {
        const parsed = extractHostAndPort(info.wsUrl);
        combined.push({
          ip: info.lanIp || parsed.hostname,
          port: info.wsPort || parsed.port,
          wsUrl: info.wsUrl,
          lastKnownHost: `${parsed.hostname}:${parsed.port}`,
          hubId: info.hubId,
          tenantId: info.tenantId || c.tenantId,
          branchId: info.branchId || c.branchId,
          branchName: info.branchName || c.branchName,
          hubRole: info.hubRole,
          hubPriority: info.hubPriority,
          branchEpoch: info.branchEpoch,
          hubMode: 'ACTIVE',
          isColdHub: false,
          activeLeaderHubId: info.hubId,
          activeLeaderInfo: info,
          mdnsHost: info.mdnsHost,
          isPaired: pairedHubMap.has(info.hubId.toUpperCase()),
          discoveredVia: c.discoveredVia,
        });
      }
    }
  }

  return combined;
}

/**
 * Full Multi-Hub Failover & Seamless IP Roaming Discovery:
 *   - Probes all paired branch Hubs (Primary / Backup / Till Fallback), mDNS/NSD, hotspot gateways, and /24 subnets.
 *   - Ranks all responding candidates deterministically by:
 *       ACTIVE > STANDBY -> highest branchEpoch -> highest hubPriority -> lowest hubId -> paired tie-break
 *   - Supports discovering an emergency unpaired ACTIVE branch Hub when `allowUnpairedActiveLeader` is true.
 */
export async function discoverPairedHub(
  pairedHubs: PairedHubProfile[],
  preferredHub?: PairedHubProfile | null,
  options?: {
    skipLastKnown?: boolean;
    preferredTenantId?: string;
    preferredBranchId?: string;
    allowUnpairedActiveLeader?: boolean;
    onStageChange?: (stage: DiscoveryStage) => void;
  }
): Promise<HubDiscoveryResult | null> {
  const allowUnpaired = Boolean(options?.allowUnpairedActiveLeader);
  if ((!Array.isArray(pairedHubs) || pairedHubs.length === 0) && !allowUnpaired) {
    return null;
  }

  const expectedTenantId = options?.preferredTenantId || preferredHub?.tenantId || pairedHubs[0]?.tenantId;
  const expectedBranchId = options?.preferredBranchId || preferredHub?.branchId || pairedHubs[0]?.branchId;

  // Scope pairedHubs to current tenant/branch when specified, while preserving all Vault entries for lookup
  const branchScopedHubs = pairedHubs.filter((h) =>
    matchesTenantAndBranch(h.tenantId, h.branchId, expectedTenantId, expectedBranchId)
  );
  const candidatePoolHubs = branchScopedHubs.length > 0 ? branchScopedHubs : pairedHubs;

  const primary = preferredHub || candidatePoolHubs[0] || null;
  const pairedHubMap = new Map<string, PairedHubProfile>();
  const pairedHubIds = new Set<string>();
  for (const h of pairedHubs) {
    pairedHubMap.set(h.hubId.toUpperCase(), h);
    pairedHubIds.add(h.hubId.toUpperCase());
  }

  const primaryPort = primary?.lastPort || primary?.port || (primary ? extractHostAndPort(primary.wsUrl).port : 8080) || 8080;
  const previousHostPort = (
    primary?.lastKnownHost ||
    (primary ? extractHostAndPort(primary.wsUrl).hostPort : '')
  ).toLowerCase();

  const discoveredAll: DiscoveredHubCandidate[] = [];
  const triedTargetKeys = new Set<string>();
  const markTried = (host: string, port: number): boolean => {
    const key = `${host.trim().toLowerCase()}:${port}`;
    if (triedTargetKeys.has(key)) return false;
    triedTargetKeys.add(key);
    return true;
  };

  // ---- STEP 1: Fast Parallel Probe of ALL Remembered Multi-Hub Vault Hosts (Manager + Backup + Till) ----
  if (!options?.skipLastKnown && candidatePoolHubs.length > 0) {
    options?.onStageChange?.('LAST_KNOWN');
    const rememberedTargets: Array<{ host: string; port: number }> = [];
    for (const hub of [primary, ...candidatePoolHubs]) {
      if (!hub) continue;
      const parsed = extractHostAndPort(hub.lastWsUrl || hub.wsUrl);
      const port = hub.lastPort || hub.port || parsed.port || 8080;
      if (markTried(parsed.hostname, port)) {
        rememberedTargets.push({ host: parsed.hostname, port });
      }
      if (hub.lastIp && markTried(hub.lastIp, port)) {
        rememberedTargets.push({ host: hub.lastIp, port });
      }
    }

    // Also include native Android NSD bridge seeds if available
    for (const seed of getNativeNsdSeedEndpoints()) {
      if (markTried(seed.host, seed.port)) {
        rememberedTargets.push(seed);
      }
    }

    if (rememberedTargets.length > 0) {
      const step1Health = await runConcurrentHealthProbes(
        rememberedTargets,
        pairedHubMap,
        expectedTenantId,
        expectedBranchId,
        'LAST_KNOWN',
        {
          concurrency: 12,
          timeoutMs: 1200,
          collectAll: true,
          allowUnpairedForSameBranch: allowUnpaired,
        }
      );

      if (step1Health.length > 0) {
        const resolved = await followStandbyLeaderRedirects(
          step1Health,
          pairedHubMap,
          expectedTenantId,
          expectedBranchId,
          allowUnpaired
        );
        discoveredAll.push(...resolved);
        const ranked = rankHubCandidates(discoveredAll, pairedHubIds);
        // Fast path: if we already found an ACTIVE leader among remembered branch Hubs, return immediately!
        if (ranked.length > 0 && ranked[0].hubMode === 'ACTIVE') {
          return toDiscoveryResult(ranked[0], previousHostPort);
        }
      } else if (primary?.lastKnownHost) {
        // Fallback WebSocket peek if HTTP /health was blocked but WS is reachable
        const wsPeek = await probeWsEndpoint(
          `ws://${primary.lastKnownHost}`,
          pairedHubIds,
          1500,
          expectedTenantId,
          expectedBranchId,
          allowUnpaired
        );
        if (wsPeek && wsPeek.hubMode === 'ACTIVE') {
          return toDiscoveryResult(wsPeek, previousHostPort);
        }
        if (wsPeek) discoveredAll.push(wsPeek);
      }
    }
  }

  // ---- STEP 2: Native Android NSD Bridge + Primary mDNS Hostnames (.local) across ALL Paired Branch Hubs ----
  const nsdSeeds = getNativeNsdSeedEndpoints().filter((seed) => markTried(seed.host, seed.port));
  if (nsdSeeds.length > 0) {
    options?.onStageChange?.('MDNS');
    const nsdHits = await runConcurrentHealthProbes(
      nsdSeeds,
      pairedHubMap,
      expectedTenantId,
      expectedBranchId,
      'MDNS',
      {
        concurrency: 12,
        timeoutMs: 1200,
        collectAll: true,
        allowUnpairedForSameBranch: allowUnpaired,
      }
    );
    if (nsdHits.length > 0) {
      const resolved = await followStandbyLeaderRedirects(
        nsdHits,
        pairedHubMap,
        expectedTenantId,
        expectedBranchId,
        allowUnpaired
      );
      discoveredAll.push(...resolved);
      const ranked = rankHubCandidates(discoveredAll, pairedHubIds);
      if (ranked.length > 0 && ranked[0].hubMode === 'ACTIVE') {
        return toDiscoveryResult(ranked[0], previousHostPort);
      }
    }
  }

  const mdnsCandidates: Array<{ hub: PairedHubProfile; mdnsHost: string; port: number }> = [];
  const seenMdns = new Set<string>();
  for (const hub of [primary, ...candidatePoolHubs]) {
    if (!hub) continue;
    const cleanMdns = sanitizeMdnsHost(hub.mdnsHost);
    if (cleanMdns && !seenMdns.has(cleanMdns)) {
      seenMdns.add(cleanMdns);
      mdnsCandidates.push({ hub, mdnsHost: cleanMdns, port: hub.lastPort || hub.port || 8080 });
    }
  }

  if (mdnsCandidates.length > 0) {
    options?.onStageChange?.('MDNS');
    const mdnsResults = await Promise.all(
      mdnsCandidates.map(async (cand) => {
        const mdnsWsUrl = `ws://${cand.mdnsHost}:${cand.port}`;
        const wsHit = await probeWsEndpoint(
          mdnsWsUrl,
          pairedHubIds,
          2000,
          expectedTenantId,
          expectedBranchId,
          allowUnpaired
        );
        if (wsHit) {
          return { ...wsHit, discoveredVia: 'MDNS' as DiscoveryStage };
        }
        return null;
      })
    );

    const validMdns = mdnsResults.filter((x): x is DiscoveredHubCandidate => Boolean(x));
    if (validMdns.length > 0) {
      const resolved = await followStandbyLeaderRedirects(
        validMdns,
        pairedHubMap,
        expectedTenantId,
        expectedBranchId,
        allowUnpaired
      );
      discoveredAll.push(...resolved);
      const ranked = rankHubCandidates(discoveredAll, pairedHubIds);
      if (ranked.length > 0 && ranked[0].hubMode === 'ACTIVE') {
        return toDiscoveryResult(ranked[0], previousHostPort);
      }
    }
  }

  // ---- STEP 3a: Fallback /health Hotspot, Tethering Gateways & All Vault LAN IPs ----
  options?.onStageChange?.('HOTSPOT_PROBE');
  const priorityTargets: Array<{ host: string; port: number }> = [];

  for (const gw of HOTSPOT_AND_GATEWAY_IPS) {
    if (markTried(gw, primaryPort)) {
      priorityTargets.push({ host: gw, port: primaryPort });
    }
  }
  for (const hub of [primary, ...candidatePoolHubs]) {
    if (!hub) continue;
    const p = hub.lastPort || hub.port || primaryPort;
    for (const lanIp of hub.lanIps || []) {
      if (markTried(lanIp, p)) {
        priorityTargets.push({ host: lanIp, port: p });
      }
    }
  }

  if (priorityTargets.length > 0) {
    const gatewayMatches = await runConcurrentHealthProbes(
      priorityTargets,
      pairedHubMap,
      expectedTenantId,
      expectedBranchId,
      'HOTSPOT_PROBE',
      {
        concurrency: 20,
        timeoutMs: 450,
        collectAll: true,
        allowUnpairedForSameBranch: allowUnpaired,
      }
    );

    if (gatewayMatches.length > 0) {
      const resolved = await followStandbyLeaderRedirects(
        gatewayMatches,
        pairedHubMap,
        expectedTenantId,
        expectedBranchId,
        allowUnpaired
      );
      discoveredAll.push(...resolved);
      const ranked = rankHubCandidates(discoveredAll, pairedHubIds);
      if (ranked.length > 0 && ranked[0].hubMode === 'ACTIVE') {
        return toDiscoveryResult(ranked[0], previousHostPort);
      }
    }
  }

  // ---- STEP 3b: Fallback /24 Subnet Scan (lastKnownHost prefix first, then common branch subnets) ----
  options?.onStageChange?.('SUBNET_PROBE');
  const subnetOrder: string[] = [];
  const addSubnet = (prefix: string | null) => {
    if (prefix && !subnetOrder.includes(prefix)) {
      subnetOrder.push(prefix);
    }
  };

  addSubnet(extractSubnetPrefix(primary?.lastKnownHost));
  for (const hub of candidatePoolHubs) {
    addSubnet(extractSubnetPrefix(hub.lastKnownHost));
    addSubnet(extractSubnetPrefix(hub.lastIp));
    for (const lanIp of hub.lanIps || []) {
      addSubnet(extractSubnetPrefix(lanIp));
    }
  }
  for (const common of COMMON_BRANCH_SUBNETS) {
    addSubnet(common);
  }

  for (const prefix of subnetOrder) {
    const subnetTargets: Array<{ host: string; port: number }> = [];
    for (let host = 1; host <= 254; host++) {
      const candidateIp = `${prefix}.${host}`;
      if (markTried(candidateIp, primaryPort)) {
        subnetTargets.push({ host: candidateIp, port: primaryPort });
      }
    }

    const subnetMatches = await runConcurrentHealthProbes(
      subnetTargets,
      pairedHubMap,
      expectedTenantId,
      expectedBranchId,
      'SUBNET_PROBE',
      {
        concurrency: 20,
        timeoutMs: 450,
        collectAll: false,
        allowUnpairedForSameBranch: allowUnpaired,
      }
    );

    if (subnetMatches.length > 0) {
      const resolved = await followStandbyLeaderRedirects(
        subnetMatches,
        pairedHubMap,
        expectedTenantId,
        expectedBranchId,
        allowUnpaired
      );
      discoveredAll.push(...resolved);
      const ranked = rankHubCandidates(discoveredAll, pairedHubIds);
      if (ranked.length > 0 && ranked[0].hubMode === 'ACTIVE') {
        return toDiscoveryResult(ranked[0], previousHostPort);
      }
    }
  }

  // Final fallback: if ONLY STANDBY candidate(s) responded across all steps, pick the highest-ranked one
  const finalRanked = rankHubCandidates(discoveredAll, pairedHubIds);
  if (finalRanked.length > 0) {
    return toDiscoveryResult(finalRanked[0], previousHostPort);
  }

  return null;
}
