#!/usr/bin/env node
/**
 * Saimetric POS - Standalone High-Reliability Local Hub for Termux Android / Local LAN (v3.3)
 *
 * Designed specifically for Termux Android Hotspot environments (192.168.43.1:8080)
 * and Local Branch LANs. Acts as the local authoritative source of truth for the branch.
 *
 * DUAL-SYNC ARCHITECTURE:
 * 1. Transactional Data (Append-Only - NO Timestamp Rejection):
 *    - SALE, GRV, CASH_LOG, STOCK_MOVEMENT, CASH_MOVEMENT, CASH_LIFT, EXPENSE, CASH_TRANSFER.
 *    - Offline devices pushing 5-hour-old invoices are ALWAYS accepted as long as invoice_id is unique.
 *    - The Void Exception: If Hub has an invoice marked Voided or Refunded and a device sends an
 *      old Completed version, the Hub rejects the stale status and sends the Voided record back.
 *
 * 2. Configuration Data (Strict LWW - Hub Authority Clock):
 *    - INVENTORY_ITEM, STAFF (passwords/permissions), CUSTOMER (credit limits).
 *    - Hub stamps accepted records with new Date().toISOString() and Date.now().
 *    - Stale updates older than Hub's stored record are rejected and Hub sends authoritative record back.
 *
 * 3. Delta Catch-Up (No Firehose):
 *    - In CATCHUP_REQUEST, only sends records where updatedAt >= sinceTime. Never dumps the entire catalog.
 *
 * 4. Flush-Before-Pull:
 *    - DRAIN_COMPLETE_PING / DRAIN_COMPLETE_ACK handshake guarantees all offline invoices are safely
 *      vaulted on Hub BEFORE delta catch-up is requested.
 *
 * 5. Full Security & Operations:
 *    - Blind Double-Count Stocktake Holding Vault (`hubBlindStore`).
 *    - CCTV Limits & 30-Day Disk Rotation (2GB hardware safety limit).
 *    - Strict Branch Isolation & Handshake (`PING_HUB`, `HUB_INFO`, `RESET_BRANCH`, `HANDSHAKE`).
 *    - CommonJS Native Execution for Termux Android (`require` syntax).
 *
 * Quick Start on Termux:
 *   pkg update -y && pkg install nodejs -y && npm install ws
 *   node termux-hub.js --port 8080
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Read CLI port or default to 8080
const portArgIdx = process.argv.indexOf('--port');
const PORT = portArgIdx !== -1 && process.argv[portArgIdx + 1]
  ? parseInt(process.argv[portArgIdx + 1], 10)
  : parseInt(process.env.PORT || '8080', 10);

// Branch & Tenant Identity for Hub
const branchIdArgIdx = process.argv.indexOf('--branch-id');
let hubBranchId = branchIdArgIdx !== -1 && process.argv[branchIdArgIdx + 1]
  ? process.argv[branchIdArgIdx + 1]
  : (process.env.HUB_BRANCH_ID || 'BR-HARARE');

const branchNameArgIdx = process.argv.indexOf('--branch-name');
let hubBranchName = branchNameArgIdx !== -1 && process.argv[branchNameArgIdx + 1]
  ? process.argv[branchNameArgIdx + 1]
  : (process.env.HUB_BRANCH_NAME || 'Harare Main');

const tenantIdArgIdx = process.argv.indexOf('--tenant-id');
let hubTenantId = tenantIdArgIdx !== -1 && process.argv[tenantIdArgIdx + 1]
  ? process.argv[tenantIdArgIdx + 1]
  : (process.env.HUB_TENANT_ID || 'COMP-001');

// Runtime & Mutual-Auth Security Mode
// - Termux backup defaults to HUB_REQUIRE_AUTH = false for zero-friction continuity
// - Android Hub APK (HUB_RUNTIME=ANDROID_APK) or --require-auth enforces strict mutual HMAC auth
const HUB_VERSION = '4.2.5';
const HUB_RUNTIME = String(process.env.HUB_RUNTIME || 'TERMUX').toUpperCase() === 'ANDROID_APK'
  ? 'ANDROID_APK'
  : 'TERMUX';
const HUB_OTA_SLOT = String(process.env.HUB_OTA_SLOT || (HUB_RUNTIME === 'ANDROID_APK' ? 'A' : 'TERMUX'));
const HUB_REQUIRE_AUTH =
  process.argv.includes('--require-auth') ||
  String(process.env.HUB_REQUIRE_AUTH || '').toLowerCase() === 'true' ||
  (HUB_RUNTIME === 'ANDROID_APK' && String(process.env.HUB_REQUIRE_AUTH || '').toLowerCase() !== 'false');

const mdnsHostArgIdx = process.argv.indexOf('--mdns-host');
const HUB_MDNS_HOST = (
  mdnsHostArgIdx !== -1 && process.argv[mdnsHostArgIdx + 1]
    ? process.argv[mdnsHostArgIdx + 1]
    : (process.env.HUB_MDNS_HOST || '')
).trim().toLowerCase();

function getHubLanIps() {
  try {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const ifaceList of Object.values(nets || {})) {
      if (!Array.isArray(ifaceList)) continue;
      for (const iface of ifaceList) {
        if (!iface || iface.internal) continue;
        const family = typeof iface.family === 'string' ? iface.family : String(iface.family);
        if ((family === 'IPv4' || family === '4') && iface.address && !ips.includes(iface.address)) {
          ips.push(iface.address);
        }
      }
    }
    return ips;
  } catch {
    return [];
  }
}

function getHubMdnsHost() {
  if (HUB_MDNS_HOST) return HUB_MDNS_HOST;
  if (typeof hubSecurityState !== 'undefined' && hubSecurityState && hubSecurityState.hubId) {
    return `${String(hubSecurityState.hubId).toLowerCase()}.local`;
  }
  return '';
}

// 3-Hub Device Failover Configuration (PRIMARY=100, BACKUP=50, TILL_FALLBACK=10)
const roleArgIdx = process.argv.indexOf('--role');
function normalizeTermuxHubRole(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'BACKUP') return 'BACKUP';
  if (s === 'TILL_FALLBACK' || s === 'TILL') return 'TILL_FALLBACK';
  return 'PRIMARY';
}
function defaultTermuxHubPriority(role) {
  if (role === 'BACKUP') return 50;
  if (role === 'TILL_FALLBACK') return 10;
  return 100;
}
let hubRole = normalizeTermuxHubRole(
  roleArgIdx !== -1 && process.argv[roleArgIdx + 1]
    ? process.argv[roleArgIdx + 1]
    : (process.env.HUB_ROLE || 'PRIMARY')
);
const priorityArgIdx = process.argv.indexOf('--priority');
const rawPriority =
  priorityArgIdx !== -1 && process.argv[priorityArgIdx + 1]
    ? Number(process.argv[priorityArgIdx + 1])
    : Number(process.env.HUB_PRIORITY);
let hubPriority = Number.isFinite(rawPriority) && rawPriority > 0 ? Math.floor(rawPriority) : defaultTermuxHubPriority(hubRole);

const epochArgIdx = process.argv.indexOf('--epoch');
const rawEpoch =
  epochArgIdx !== -1 && process.argv[epochArgIdx + 1]
    ? Number(process.argv[epochArgIdx + 1])
    : Number(process.env.HUB_BRANCH_EPOCH);
let hubBranchEpoch = Number.isFinite(rawEpoch) && rawEpoch >= 1 ? Math.floor(rawEpoch) : 1;

const modeArgIdx = process.argv.indexOf('--mode');
let hubMode = String(
  modeArgIdx !== -1 && process.argv[modeArgIdx + 1]
    ? process.argv[modeArgIdx + 1]
    : (process.env.HUB_MODE || 'ACTIVE')
).trim().toUpperCase() === 'STANDBY'
  ? 'STANDBY'
  : 'ACTIVE';

let activeLeaderHubId = null;
let activeLeaderInfo = null;

function isHubCold() {
  return (
    typeof salesStore !== 'undefined' &&
    typeof inventoryStore !== 'undefined' &&
    Array.isArray(salesStore) &&
    Array.isArray(inventoryStore) &&
    salesStore.length === 0 &&
    inventoryStore.length === 0
  );
}

function getHubFailoverMeta() {
  const selfId =
    typeof hubSecurityState !== 'undefined' && hubSecurityState && hubSecurityState.hubId
      ? hubSecurityState.hubId
      : null;
  const ips = getHubLanIps();
  const primaryLanIp = ips[0] || '127.0.0.1';
  const effectiveLeaderId = hubMode === 'ACTIVE' ? selfId : activeLeaderHubId;
  const effectiveLeaderInfo =
    hubMode === 'ACTIVE' && selfId
      ? {
          hubId: selfId,
          hubRole,
          hubPriority,
          branchEpoch: hubBranchEpoch,
          lanIp: primaryLanIp,
          wsPort: PORT,
          wsUrl: `ws://${primaryLanIp}:${PORT}`,
        }
      : activeLeaderInfo;

  return {
    hubRole,
    hubPriority,
    branchEpoch: hubBranchEpoch,
    hubMode,
    isColdHub: isHubCold(),
    activeLeaderHubId: effectiveLeaderId,
    activeLeaderInfo: effectiveLeaderInfo,
  };
}

function broadcastHubRoleStatus() {
  if (typeof wss === 'undefined' || !wss) return;
  const payload = JSON.stringify({
    type: 'HUB_ROLE_STATUS',
    action: 'HUB_ROLE_STATUS',
    hubId: hubSecurityState?.hubId || null,
    tenantId: hubTenantId,
    branchId: hubBranchId,
    ...getHubFailoverMeta(),
    timestamp: Date.now(),
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch {}
    }
  });
}

// Edge Gateway Cloud Bridge configuration (App Scripts / Supabase forwarding)
const cloudUrlArgIdx = process.argv.indexOf('--cloud-url');
let cloudSyncUrl = cloudUrlArgIdx !== -1 && process.argv[cloudUrlArgIdx + 1]
  ? process.argv[cloudUrlArgIdx + 1]
  : (process.env.CLOUD_SYNC_URL || process.env.VITE_GOOGLE_APPS_SCRIPT_URL || '');

// Edge-to-Cloud Supabase configuration
const supabaseUrlArgIdx = process.argv.indexOf('--supabase-url');
let supabaseUrl = supabaseUrlArgIdx !== -1 && process.argv[supabaseUrlArgIdx + 1]
  ? process.argv[supabaseUrlArgIdx + 1]
  : (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '');

const supabaseKeyArgIdx = process.argv.indexOf('--supabase-key');
let supabaseKey = supabaseKeyArgIdx !== -1 && process.argv[supabaseKeyArgIdx + 1]
  ? process.argv[supabaseKeyArgIdx + 1]
  : (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '');

// High-Water Marks & V7.0 Enterprise Cloud Routing State for Edge-to-Cloud Sync
let lastCloudSyncTimestamp = 0;
let lastAppsScriptServerSeq = 0;
let cloudRoutingEpoch = 1;
let cloudBackoffUntil = 0;
let cloudSpreadsheetId = '';
let cloudJwtToken = '';
let cloudGatewayUrl = '';
let lastPolicyFetchAt = 0;

// Cloud-driven runtime policy (auto-updated via SYNC_CLOUD_CONFIG and Gateway/Apps Script ping)
// Enables tuning timeouts, batch sizes, intervals, and security guards without rebuilding the APK/Hub.
const DEFAULT_HUB_RUNTIME_POLICY = {
  protocolVersion: '4.0',
  pushBatchSize: 20,
  pullMaxPages: 12,
  requestTimeoutMs: 45000,
  syncIntervalMs: 5 * 60 * 1000,
  clockDriftToleranceMs: 5 * 60 * 1000,
  blockBackdatedVoidsOnly: true,
  blockedBackdateActions: ['VOID', 'REFUND'],
  blockedMasterSheetIds: ['1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE'],
  t2EntityTypes: [],
  globalBranchEntityTypes: [],
  retentionDays: 30,
  maxStorageMb: 2048,
  genericBucketMaxItems: 5000,
};
let hubRuntimePolicy = { ...DEFAULT_HUB_RUNTIME_POLICY };
let cloudSyncIntervalHandle = null;

function applyHubRuntimePolicy(incoming) {
  if (!incoming || typeof incoming !== 'object') return false;
  const prevInterval = hubRuntimePolicy.syncIntervalMs;
  const clamp = (val, min, max, fallback) => {
    const n = Number(val);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const normalizeStrList = (arr, upper, fallback) => {
    if (!Array.isArray(arr)) return fallback;
    const cleaned = arr
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .map((s) => (upper ? s.toUpperCase() : s.toLowerCase()));
    return Array.from(new Set(cleaned));
  };
  hubRuntimePolicy = {
    protocolVersion: String(incoming.protocolVersion || hubRuntimePolicy.protocolVersion || '4.0'),
    pushBatchSize: clamp(incoming.pushBatchSize, 5, 50, hubRuntimePolicy.pushBatchSize),
    pullMaxPages: clamp(incoming.pullMaxPages, 2, 25, hubRuntimePolicy.pullMaxPages),
    requestTimeoutMs: clamp(incoming.requestTimeoutMs, 10000, 90000, hubRuntimePolicy.requestTimeoutMs),
    syncIntervalMs: clamp(incoming.syncIntervalMs, 30000, 30 * 60 * 1000, hubRuntimePolicy.syncIntervalMs),
    clockDriftToleranceMs: clamp(incoming.clockDriftToleranceMs, 60000, 30 * 60 * 1000, hubRuntimePolicy.clockDriftToleranceMs),
    blockBackdatedVoidsOnly:
      incoming.blockBackdatedVoidsOnly !== undefined
        ? Boolean(incoming.blockBackdatedVoidsOnly)
        : hubRuntimePolicy.blockBackdatedVoidsOnly,
    blockedBackdateActions:
      Array.isArray(incoming.blockedBackdateActions) && incoming.blockedBackdateActions.length > 0
        ? normalizeStrList(incoming.blockedBackdateActions, true, hubRuntimePolicy.blockedBackdateActions)
        : hubRuntimePolicy.blockedBackdateActions,
    blockedMasterSheetIds: Array.isArray(incoming.blockedMasterSheetIds) && incoming.blockedMasterSheetIds.length > 0
      ? incoming.blockedMasterSheetIds.map((s) => String(s || '').trim()).filter(Boolean)
      : hubRuntimePolicy.blockedMasterSheetIds,
    t2EntityTypes: Array.isArray(incoming.t2EntityTypes)
      ? normalizeStrList(incoming.t2EntityTypes, false, hubRuntimePolicy.t2EntityTypes)
      : hubRuntimePolicy.t2EntityTypes,
    globalBranchEntityTypes: Array.isArray(incoming.globalBranchEntityTypes)
      ? normalizeStrList(incoming.globalBranchEntityTypes, false, hubRuntimePolicy.globalBranchEntityTypes)
      : hubRuntimePolicy.globalBranchEntityTypes,
    retentionDays: clamp(incoming.retentionDays, 7, 3650, hubRuntimePolicy.retentionDays),
    maxStorageMb: clamp(incoming.maxStorageMb, 64, 16384, hubRuntimePolicy.maxStorageMb),
    genericBucketMaxItems: clamp(incoming.genericBucketMaxItems, 500, 50000, hubRuntimePolicy.genericBucketMaxItems),
  };
  if (hubRuntimePolicy.syncIntervalMs !== prevInterval && typeof restartCloudSyncTimer === 'function') {
    restartCloudSyncTimer();
  }
  return true;
}

function isHubMasterTenant(companyId) {
  const u = String(companyId || '').trim().toUpperCase();
  return u === 'COMP-001' || u === 'COMP-MASTER' || u === 'MASTER';
}

function isBlockedMasterSheetWrite(companyId, spreadsheetId) {
  if (isHubMasterTenant(companyId)) return false;
  const sid = String(spreadsheetId || '').trim();
  if (!sid) return true;
  const blockedList = Array.isArray(hubRuntimePolicy.blockedMasterSheetIds)
    ? hubRuntimePolicy.blockedMasterSheetIds
    : DEFAULT_HUB_RUNTIME_POLICY.blockedMasterSheetIds;
  return blockedList.includes(sid);
}

// Universal Encrypted Cloud Configuration (Database-Agnostic)
const CLOUD_CONFIG_FILE = path.join(process.cwd(), 'hub-cloud-config.enc');
const CLOUD_CONFIG_KEY_FILE = path.join(process.cwd(), '.hub-config.key');
let cloudConfig = null;

function getCloudConfigMasterSecret() {
  if (process.env.HUB_CONFIG_SECRET && String(process.env.HUB_CONFIG_SECRET).trim()) {
    return String(process.env.HUB_CONFIG_SECRET).trim();
  }
  let fileKey = '';
  try {
    if (fs.existsSync(CLOUD_CONFIG_KEY_FILE)) {
      fileKey = fs.readFileSync(CLOUD_CONFIG_KEY_FILE, 'utf8').trim();
    } else {
      fileKey = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(CLOUD_CONFIG_KEY_FILE, fileKey, { encoding: 'utf8', mode: 0o600 });
    }
  } catch (e) {
    fileKey = 'saimetric-hub-fallback-key';
  }
  return `${fileKey}|${os.hostname()}|${process.cwd()}`;
}

function encryptAndSaveCloudConfig(cfgObj) {
  try {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(getCloudConfigMasterSecret(), salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(cfgObj);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    const encryptedString = `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    fs.writeFileSync(CLOUD_CONFIG_FILE, encryptedString, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (err) {
    console.error('[Termux Hub] Failed to encrypt and save Cloud Config:', err.message);
    return false;
  }
}

function loadEncryptedCloudConfig() {
  try {
    if (!fs.existsSync(CLOUD_CONFIG_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(CLOUD_CONFIG_FILE, 'utf8').trim();
    if (!raw) return null;
    const parts = raw.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted cloud config format');
    }
    const [saltHex, ivHex, tagHex, cipherHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const key = crypto.scryptSync(getCloudConfigMasterSecret(), salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === 'object') {
      cloudConfig = parsed;
      const creds = parsed.credentials && typeof parsed.credentials === 'object' ? parsed.credentials : {};
      if (parsed.companyId && String(parsed.companyId).trim()) {
        hubTenantId = String(parsed.companyId).trim();
      }
      if (creds.token || creds.jwt) cloudJwtToken = String(creds.token || creds.jwt).trim();
      if (creds.spreadsheetId || creds.sheetId) cloudSpreadsheetId = String(creds.spreadsheetId || creds.sheetId).trim();
      if (parsed.gatewayUrl || creds.gatewayUrl) cloudGatewayUrl = String(parsed.gatewayUrl || creds.gatewayUrl).trim();
      if (parsed.runtimePolicy && typeof parsed.runtimePolicy === 'object') {
        applyHubRuntimePolicy(parsed.runtimePolicy);
      }
      if (Number(creds.routingEpoch || creds.routing_epoch) > 0) {
        cloudRoutingEpoch = Math.max(cloudRoutingEpoch, Number(creds.routingEpoch || creds.routing_epoch));
      }
      console.log('[Termux Hub] 🔓 Loaded and decrypted Cloud Config from hub-cloud-config.enc. DB Type:', cloudConfig.databaseType || 'unknown', '| Tenant:', hubTenantId, cloudGatewayUrl ? '| Gateway: enabled' : '');
      return cloudConfig;
    }
  } catch (err) {
    console.warn('[Termux Hub] Notice loading encrypted cloud config:', err.message);
  }
  return null;
}

function getHubCloudAuthFields() {
  const creds = (cloudConfig && cloudConfig.credentials && typeof cloudConfig.credentials === 'object') ? cloudConfig.credentials : {};
  const jwt = String(cloudJwtToken || creds.token || creds.jwt || '').trim();
  const sheetId = String(cloudSpreadsheetId || creds.spreadsheetId || creds.sheetId || '').trim();
  const epoch = Number(cloudRoutingEpoch || creds.routingEpoch || creds.routing_epoch || 1) || 1;
  return {
    ...(jwt ? { jwt, token: jwt } : {}),
    ...(sheetId ? { spreadsheet_id: sheetId, sheet_id: sheetId, tenant_sheet_id: sheetId } : {}),
    routing_epoch: epoch,
  };
}

function applyHubCloudBackoff(waitMs, reason) {
  const bounded = Math.min(300000, Math.max(1000, Number(waitMs) || 3000));
  cloudBackoffUntil = Math.max(cloudBackoffUntil, Date.now() + bounded);
  console.warn(`[Edge-to-Cloud] ⏳ Cloud backoff active for ${Math.round(bounded / 1000)}s (${reason})`);
}

function handleHubAppsScriptErrorResponse(json) {
  if (!json || typeof json !== 'object') return 'UNKNOWN';
  const code = String(json.code || '').toUpperCase().trim();

  if (code === 'ROUTING_EPOCH_STALE') {
    const nextEp = Number(json.current_routing_epoch || json.routing_epoch || 0);
    if (nextEp > 0) cloudRoutingEpoch = nextEp;
    const nextSid = String(json.spreadsheet_id || json.sheet_id || '').trim();
    if (nextSid && nextSid.length >= 10) cloudSpreadsheetId = nextSid;
    if (cloudConfig && typeof cloudConfig === 'object') {
      cloudConfig.credentials = {
        ...(cloudConfig.credentials || {}),
        ...(cloudSpreadsheetId ? { spreadsheetId: cloudSpreadsheetId } : {}),
        routingEpoch: cloudRoutingEpoch,
      };
      encryptAndSaveCloudConfig(cloudConfig);
    }
    lastAppsScriptServerSeq = 0;
    lastCloudSyncTimestamp = 0;
    scheduleSave();
    const epochMsg = JSON.stringify({
      type: 'HUB_ROUTING_EPOCH_UPDATED',
      action: 'HUB_ROUTING_EPOCH_UPDATED',
      company_id: hubTenantId,
      routing_epoch: cloudRoutingEpoch,
      spreadsheet_id: cloudSpreadsheetId,
      timestamp: Date.now(),
    });
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        try { c.send(epochMsg); } catch (e) {}
      }
    });
    console.warn(`[Edge-to-Cloud] 🔄 ROUTING_EPOCH_STALE handled -> updated epoch=${cloudRoutingEpoch}, reset catch-up cursors.`);
    return 'EPOCH_STALE';
  }

  if (code === 'JWT_EXPIRED' || code === 'JWT_INVALID' || code === 'JWT_MISSING') {
    applyHubCloudBackoff(60000, code);
    const refreshMsg = JSON.stringify({
      type: 'CLOUD_AUTH_REFRESH_REQUIRED',
      action: 'CLOUD_AUTH_REFRESH_REQUIRED',
      company_id: hubTenantId,
      code,
      timestamp: Date.now(),
    });
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        try { c.send(refreshMsg); } catch (e) {}
      }
    });
    return 'AUTH_REQUIRED';
  }

  if (code === 'RATE_LIMITED' || code === 'TENANT_LOCK_BUSY' || code === 'KILL_SWITCH_ACTIVE' || code === 'TENANT_SUSPENDED') {
    const baseMs = Number(json.retryAfterMs) || (code === 'KILL_SWITCH_ACTIVE' || code === 'TENANT_SUSPENDED' ? 300000 : code === 'RATE_LIMITED' ? 15000 : 2500);
    const jitter = (code === 'KILL_SWITCH_ACTIVE' || code === 'TENANT_SUSPENDED') ? baseMs : baseMs + Math.floor(Math.random() * 1500);
    applyHubCloudBackoff(jitter, code);
    return 'BACKOFF';
  }

  return code || 'ERROR';
}

function resolveCloudAdapterConfig() {
  if (cloudConfig && typeof cloudConfig === 'object') {
    if (String(cloudConfig.strategy || '').toUpperCase() === 'HUB_ONLY') {
      return { databaseType: 'none', credentials: {}, gatewayUrl: '', useUnifiedGateway: false };
    }
    const rawDbType = String(cloudConfig.databaseType || '').toLowerCase().trim();
    const creds = (cloudConfig.credentials && typeof cloudConfig.credentials === 'object') ? cloudConfig.credentials : {};
    const gwUrl = String(cloudConfig.gatewayUrl || creds.gatewayUrl || cloudGatewayUrl || '').trim();
    const normalizedDbType =
      rawDbType === 'mongo'
        ? 'mongodb'
        : rawDbType === 'sheets_appscript' || rawDbType === 'google_sheets'
        ? 'appscripts'
        : rawDbType || (gwUrl ? 'gateway' : 'none');

    // Freeze-Once Rule: Prefer the single frozen 3-action envelope protocol (ping/push_envelopes/pull_catchup)
    // whenever talking to Apps Script OR via the unified Cloud Sync Gateway (which handles Supabase/Firebase/future DBs server-side).
    const useUnifiedGateway = Boolean(
      normalizedDbType === 'appscripts' ||
      normalizedDbType === 'gateway' ||
      (gwUrl && (normalizedDbType === 'supabase' || normalizedDbType === 'firebase' || normalizedDbType === 'mongodb' || normalizedDbType !== 'none'))
    );

    return {
      databaseType: normalizedDbType,
      credentials: creds,
      gatewayUrl: gwUrl,
      useUnifiedGateway,
    };
  }

  // Fallback to CLI/Env configuration if encrypted cloudConfig is not yet present
  if (cloudGatewayUrl) {
    return { databaseType: 'gateway', credentials: { url: cloudSyncUrl }, gatewayUrl: cloudGatewayUrl, useUnifiedGateway: true };
  }
  if (supabaseUrl && supabaseKey) {
    return { databaseType: 'supabase', credentials: { url: supabaseUrl, apiKey: supabaseKey }, gatewayUrl: '', useUnifiedGateway: false };
  }
  if (cloudSyncUrl) {
    return { databaseType: 'appscripts', credentials: { url: cloudSyncUrl }, gatewayUrl: '', useUnifiedGateway: true };
  }
  return { databaseType: 'none', credentials: {}, gatewayUrl: '', useUnifiedGateway: false };
}

function mapEntityTypeToTable(entityType) {
  const t = String(entityType || '').toUpperCase();
  if (t === 'SALE' || t === 'SALES') return 'sales';
  if (t === 'STAFF' || t === 'SALESPERSON') return 'staff';
  if (t === 'CUSTOMER' || t === 'CUSTOMERS') return 'customers';
  if (t === 'INVENTORY' || t === 'INVENTORY_ITEM') return 'inventory';
  if (t === 'EXPENSE' || t === 'EXPENSES') return 'expenses';
  if (t === 'CASH_LOG' || t === 'CASH_LOGS') return 'cash_logs';
  if (t === 'GRV' || t === 'DIRECT_GRV' || t === 'DIRECT_GRVS') return 'direct_grvs';
  if (t === 'CUSTOMER_CHANGE' || t === 'CUSTOMER_CHANGES') return 'customer_changes';
  if (t === 'CREDIT_SALE' || t === 'CREDIT_SALES') return 'credit_sales';
  if (t === 'STOCK_MOVEMENT' || t === 'STOCK_MOVEMENTS') return 'stock_movements';
  return String(entityType || 'records').toLowerCase();
}

/**
 * Edge Gateway Cloud Bridge:
 * Dynamically routes accepted records to the active encrypted cloudConfig adapter.
 * Fire-and-forget with error catching so offline hubs never crash or block.
 */
function hasIncomingCloudSyncFlag(packet, ...records) {
  if (packet?.isCloudSynced === true) return true;
  if (packet?.payload?.isCloudSynced === true) return true;
  if (packet?.data?.isCloudSynced === true) return true;
  return records.some((r) => Boolean(r && r.isCloudSynced === true));
}

function parseHubTimestampMs(val) {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val;
  if (typeof val === 'string' && val.trim().length > 0) {
    const asNum = Number(val.trim());
    if (Number.isFinite(asNum) && asNum > 1_000_000_000_000) return asNum;
    const parsed = Date.parse(val.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function validatePacketClock(ws, packet, recordObj, deviceId, packetTypeLabel) {
  const originDev = String(deviceId || packet?.origin_device_id || packet?.originDeviceId || packet?.deviceId || 'UNKNOWN-DEVICE').trim();
  const upperOrigin = originDev.toUpperCase();
  if (
    packet?.fromCloud === true ||
    packet?.isReconPush === true ||
    upperOrigin === 'CLOUD' ||
    upperOrigin === 'SUPABASE_CLOUD' ||
    upperOrigin === 'LOCAL_HUB'
  ) {
    return { accepted: true, bypassReason: 'CLOUD_OR_RECON' };
  }

  const isOfflineSync = Boolean(
    packet?.isOfflineSync === true ||
    packet?.isOfflineCatchup === true ||
    packet?.payload?.isOfflineSync === true ||
    packet?.sale?.isOfflineSync === true ||
    packet?.cashLog?.isOfflineSync === true ||
    recordObj?.isOfflineSync === true
  );

  const hubNow = Date.now();
  const pktTs = parseHubTimestampMs(
    packet?.timestamp ||
    packet?.updatedAt ||
    recordObj?.refundedAt ||
    recordObj?.voidedAt ||
    recordObj?.timestamp ||
    recordObj?.updatedAt
  );

  if (isOfflineSync) {
    if (pktTs > 0 && pktTs < hubNow - 300000) {
      const minsAgo = Math.round((hubNow - pktTs) / 60000);
      console.log(`[Termux Hub] ⏳ Accepted delayed offline sync (${packetTypeLabel}) from [${originDev}] (created ~${minsAgo}m ago).`);
    }
    return { accepted: true, delayedOfflineSync: true };
  }

  const driftToleranceMs = Number(hubRuntimePolicy.clockDriftToleranceMs) || 300000;
  if (pktTs > 0 && pktTs < hubNow - driftToleranceMs) {
    const blockedActions = Array.isArray(hubRuntimePolicy.blockedBackdateActions) && hubRuntimePolicy.blockedBackdateActions.length > 0
      ? hubRuntimePolicy.blockedBackdateActions
      : DEFAULT_HUB_RUNTIME_POLICY.blockedBackdateActions;
    const upperLabel = String(packetTypeLabel || '').trim().toUpperCase();
    const isVoidOrRefundPacket = Boolean(
      blockedActions.includes(upperLabel) ||
      (blockedActions.includes('VOID') && (recordObj?.status === 'Voided' || recordObj?.voidedAt)) ||
      (blockedActions.includes('REFUND') && (recordObj?.status === 'Refunded' || recordObj?.refundedAt))
    );

    const invId = recordObj?.id || packet?.invoice_id || packet?.id || undefined;
    const hubNowIso = new Date(hubNow).toISOString();

    if (recordObj && typeof recordObj === 'object') {
      recordObj.suspicious_backdate = true;
      recordObj.clock_tamper_flagged = true;
      if (!recordObj.server_received_at) {
        recordObj.server_received_at = hubNowIso;
      }
    }

    const alertType = isVoidOrRefundPacket ? 'VOID_REFUND_BLOCKED' : 'HUB_FLAGGED_BACKDATE';
    const alertMsg = isVoidOrRefundPacket
      ? `Security Lock: Backdated ${recordObj?.status || packetTypeLabel || 'Void/Refund'} blocked from ${originDev}. Please enable Automatic Date & Time.`
      : `Clock Flag: Backdated ${packetTypeLabel} from ${originDev} was ACCEPTED and synced to Hub (flagged for audit). Voids & refunds restricted until Automatic Date & Time is enabled.`;

    console.warn(`[Termux Hub] 🛡️ ${isVoidOrRefundPacket ? 'BLOCKED BACKDATED ACTION' : 'FLAGGED & ACCEPTED'} (${packetTypeLabel}) from [${originDev}].`);

    // Deduplicate generic alerts for same device + invoice (or same device within 15m when no invoiceId)
    const recentDup = securityAlertsStore.some((a) => {
      if (!a || a.deviceId !== originDev) return false;
      if (invId && a.invoiceId === invId && (a.alertType || a.type) === alertType) return true;
      if (!invId && (a.alertType || a.type) === alertType) {
        const prevMs = Date.parse(a.timestamp || a.createdAt || '');
        if (Number.isFinite(prevMs) && hubNow - prevMs < 15 * 60 * 1000) return true;
      }
      return false;
    });

    const alertPacket = {
      id: `SEC-${hubNow}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      type: 'SECURITY_ALERT',
      action: 'SECURITY_ALERT',
      alertType,
      packetAccepted: !isVoidOrRefundPacket,
      reason: 'CLOCK_TAMPERING',
      targetDeviceId: originDev,
      deviceId: originDev,
      deviceName: packet?.origin_device_name || packet?.originDeviceName || originDev,
      packetType: packetTypeLabel,
      packetId: packet?.packet_id || packet?.packetId || undefined,
      invoiceId: invId,
      claimedTimestamp: pktTs,
      hubTimestamp: hubNow,
      serverReceivedAt: hubNowIso,
      driftMs: pktTs - hubNow,
      origin_device_id: 'LOCAL_HUB',
      origin_device_name: 'Termux Local Hub',
      timestamp: hubNowIso,
      message: alertMsg,
    };

    if (!recentDup) {
      securityAlertsStore.unshift(alertPacket);
      if (securityAlertsStore.length > 200) {
        securityAlertsStore = securityAlertsStore.slice(0, 200);
      }
      scheduleSave();

      const serializedAlert = JSON.stringify(alertPacket);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(serializedAlert); } catch (e) {}
      }
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try { client.send(serializedAlert); } catch (e) {}
        }
      });
    }

    // Critical policy: NEVER drop normal sales/cash operational data from reaching the Hub.
    // Only block high-risk Void/Refund reversals when device clock tampering is detected.
    return { accepted: !isVoidOrRefundPacket, flagged: true, alert: alertPacket };
  }

  return { accepted: true };
}

function broadcastCloudSyncAck(wsSender, entityType, id) {
  const ackPayload = {
    type: 'T1_CLOUD_SYNC_ACK',
    action: 'T1_CLOUD_SYNC_ACK',
    entityType,
    id,
    isCloudSynced: true,
    origin_device_id: 'LOCAL_HUB',
    origin_device_name: 'Termux Local Hub',
    timestamp: Date.now(),
  };
  const ackStr = JSON.stringify(ackPayload);
  if (wsSender && wsSender.readyState === WebSocket.OPEN) {
    try { wsSender.send(ackStr); } catch (e) {}
  }
  wss.clients.forEach((c) => {
    if (c !== wsSender && c.readyState === WebSocket.OPEN) {
      try { c.send(ackStr); } catch (e) {}
    }
  });
}

function annotateCloudBackdateFlag(entityType, record, serverHeaderDate) {
  if (!record || typeof record !== 'object') return;
  const serverMs = serverHeaderDate ? Date.parse(serverHeaderDate) : Date.now();
  const validMs = Number.isFinite(serverMs) && serverMs > 1600000000000 ? serverMs : Date.now();
  const serverIso = new Date(validMs).toISOString();
  const serverDay = serverIso.slice(0, 10);
  if (!record.server_received_at) record.server_received_at = serverIso;

  let claimedDay = '';
  if (typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(record.date.trim())) {
    claimedDay = record.date.trim().slice(0, 10);
  } else if (record.timestamp) {
    const tMs = typeof record.timestamp === 'number' ? record.timestamp : Date.parse(String(record.timestamp));
    if (Number.isFinite(tMs) && tMs > 0) claimedDay = new Date(tMs).toISOString().slice(0, 10);
  }
  const isSuspicious = Boolean(record.suspicious_backdate || (claimedDay && claimedDay < serverDay));
  if (isSuspicious) {
    record.suspicious_backdate = true;
    const invId = record.id || record.invoice_id || '';
    const alertId = `BACKDATE-${entityType}-${invId || validMs}`;
    if (typeof securityAlertsStore !== 'undefined' && Array.isArray(securityAlertsStore)) {
      const exists = securityAlertsStore.some((a) => a.id === alertId || (invId && a.invoiceId === invId && a.type === 'SUSPICIOUS_BACKDATE'));
      if (!exists) {
        const alertObj = {
          id: alertId,
          type: 'SUSPICIOUS_BACKDATE',
          deviceId: record.deviceId || record.origin_device_id || 'LOCAL_HUB',
          packetType: entityType,
          invoiceId: invId,
          claimedDate: claimedDay,
          claimedTimestamp: record.timestamp,
          serverReceivedAt: record.server_received_at,
          message: `Cloud sync flagged backdated ${entityType} #${invId || 'record'} (Claimed: ${claimedDay}, Server received: ${serverDay}).`,
          createdAt: serverIso,
        };
        securityAlertsStore.unshift(alertObj);
        if (securityAlertsStore.length > 150) securityAlertsStore.length = 150;
        const alertPkt = JSON.stringify({
          type: 'SECURITY_ALERT',
          action: 'SECURITY_ALERT',
          alertType: 'SUSPICIOUS_BACKDATE',
          targetDeviceId: '',
          deviceId: alertObj.deviceId,
          packetType: entityType,
          invoiceId: invId,
          claimedTimestamp: record.timestamp,
          serverReceivedAt: record.server_received_at,
          message: alertObj.message,
          origin_device_id: 'LOCAL_HUB',
          timestamp: validMs,
        });
        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            try { c.send(alertPkt); } catch (e) {}
          }
        });
      }
    }
  }
}

const T2_CANONICAL_TYPES = new Set([
  'inventory_item',
  'staff',
  'customer',
  'supplier',
  'branch',
  'cash_account',
  'casual_worker',
  'branch_lockdown',
  'credit_group',
  'inventory_category',
  'stocktake_session',
  'stocktake_segment',
  'stocktake_zone_assignment',
  'stocktake_zone_claim',
  'stocktake_count_submission',
  'stocktake_joint_proposal',
  'stocktake_joint_finalized',
  'stocktake_segment_unlock',
  'daily_blind_config',
  'daily_blind_count',
  'purchase_order',
  'permissions_matrix',
  'role_configs',
  'multi_currency',
  'system_settings',
  'sheets_config',
]);

const GLOBAL_BRANCH_CANONICAL_TYPES = new Set([
  'inventory_item',
  'staff',
  'branch',
  'supplier',
  'inventory_category',
  'permissions_matrix',
  'role_configs',
  'multi_currency',
]);

function isCanonicalT2Type(rawType) {
  const c = String(rawType || '').trim().toLowerCase();
  if (!c) return false;
  if (T2_CANONICAL_TYPES.has(c)) return true;
  return Array.isArray(hubRuntimePolicy.t2EntityTypes) && hubRuntimePolicy.t2EntityTypes.includes(c);
}

function isHubGlobalBranchEntityType(rawType) {
  const c = String(rawType || '').trim().toLowerCase();
  if (!c) return false;
  if (GLOBAL_BRANCH_CANONICAL_TYPES.has(c)) return true;
  return Array.isArray(hubRuntimePolicy.globalBranchEntityTypes) && hubRuntimePolicy.globalBranchEntityTypes.includes(c);
}

function mapHubEntityToCanonicalType(entityType) {
  const t = String(entityType || '').trim().toUpperCase();
  if (t === 'SALE' || t === 'SALE_UPDATE' || t === 'SALES') return 'sale';
  if (t === 'INVENTORY' || t === 'INVENTORY_ITEM' || t === 'INVENTORY_UPDATE') return 'inventory_item';
  if (t === 'STAFF' || t === 'SALESPERSON' || t === 'STAFF_MEMBER') return 'staff';
  if (t === 'CUSTOMER' || t === 'CUSTOMERS') return 'customer';
  if (t === 'CUSTOMER_CHANGE' || t === 'CUSTOMER_CHANGES') return 'customer_change';
  if (t === 'CREDIT_SALE' || t === 'CREDIT_SALES') return 'credit_sale';
  if (t === 'CREDIT_GROUP' || t === 'CREDIT_GROUPS') return 'credit_group';
  if (t === 'CASH_LOG' || t === 'CASH_LOGS') return 'cash_log';
  if (t === 'CASH_LIFT' || t === 'CASH_LIFTS') return 'cash_lift';
  if (t === 'CASH_MOVEMENT' || t === 'CASH_MOVEMENTS') return 'cash_movement';
  if (t === 'CASH_ACCOUNT' || t === 'CASH_ACCOUNTS') return 'cash_account';
  if (t === 'CASH_TRANSFER' || t === 'CASH_TRANSFERS') return 'cash_transfer';
  if (t === 'GRV' || t === 'DIRECT_GRV' || t === 'DIRECT_GRVS') return 'direct_grv';
  if (t === 'GOODS_RECEIVED' || t === 'GRN' || t === 'GOODSRECEIVED') return 'goods_received';
  if (t === 'EXPENSE' || t === 'EXPENSES') return 'expense';
  if (t === 'INTERNAL_CONSUMPTION' || t === 'SHOP_USE' || t === 'INTERNAL_CONSUMPTIONS') return 'internal_consumption';
  if (t === 'STOCK_MOVEMENT' || t === 'STOCK_MOVEMENTS') return 'stock_movement';
  if (t === 'RECONCILIATION' || t === 'RECONCILIATIONS') return 'reconciliation';
  if (t === 'SUPPLIER' || t === 'SUPPLIERS') return 'supplier';
  if (t === 'ADMIN_SALE' || t === 'ADMIN_SALES') return 'admin_sale';
  if (t === 'CASH_COUNT' || t === 'CASH_COUNTS') return 'cash_count';
  if (t === 'VOUCHER' || t === 'VOUCHERS' || t === 'SUPPLIER_INVOICE' || t === 'SUPPLIER_INVOICE_VOUCHER') return 'supplier_invoice_voucher';
  if (t === 'BUSINESS_DAY_CLOSURE' || t === 'BUSINESS_DAY_CLOSURES') return 'business_day_closure';
  if (t === 'ELECTRONIC_SETTLEMENT' || t === 'ELECTRONIC_SETTLEMENTS') return 'electronic_settlement';
  if (t === 'CATEGORY' || t === 'CATEGORIES' || t === 'INVENTORY_CATEGORY') return 'inventory_category';
  if (t === 'BRANCH' || t === 'BRANCHES') return 'branch';
  if (t === 'CASUAL_WORKER' || t === 'CASUAL_WORKERS') return 'casual_worker';
  if (t === 'BRANCH_LOCKDOWN' || t === 'BRANCH_LOCKDOWNS') return 'branch_lockdown';
  if (t === 'STOCKTAKE_SESSION' || t === 'STOCKTAKE_SESSIONS') return 'stocktake_session';
  if (t === 'STOCKTAKE_SEGMENT' || t === 'STOCKTAKE_SEGMENTS') return 'stocktake_segment';
  if (t === 'STOCKTAKE_ZONE_ASSIGNMENT' || t === 'STOCKTAKE_ZONE_ASSIGNMENTS') return 'stocktake_zone_assignment';
  if (t === 'STOCKTAKE_BLIND_COUNT' || t === 'STOCKTAKE_COUNT_SUBMISSION') return 'stocktake_count_submission';
  if (t === 'DAILY_BLIND_CONFIG' || t === 'DAILY_BLIND_CONFIGS' || t === 'DAILY_BLIND_CONFIG_SYNC') return 'daily_blind_config';
  if (t === 'DAILY_BLIND_COUNT' || t === 'DAILY_BLIND_COUNTS' || t === 'DAILY_BLIND_COUNT_SYNC') return 'daily_blind_count';
  if (t === 'PURCHASE_ORDER' || t === 'PURCHASE_ORDERS' || t === 'PURCHASE_ORDER_SYNC') return 'purchase_order';
  if (t === 'TOMBSTONE' || t === 'TOMBSTONES') return 'tombstone';
  if (t === 'PERMISSIONS_MATRIX') return 'permissions_matrix';
  if (t === 'ROLE_CONFIGS') return 'role_configs';
  if (t === 'MULTI_CURRENCY') return 'multi_currency';
  return String(entityType || 'audit_log').trim().toLowerCase();
}

function getHubCanonicalEntityId(record, canonicalType) {
  if (!record || typeof record !== 'object') return '';
  if (canonicalType === 'sale' || canonicalType === 'admin_sale') {
    return String(record.id || record.invoice_id || record.InvoiceID || record.sale_id || '').trim();
  }
  if (canonicalType === 'inventory_item') return String(record.itemId || record.ItemID || record.ProductID || record.id || '').trim();
  if (canonicalType === 'staff' || canonicalType === 'casual_worker') return String(record.id || record.staffId || record.pin_hash || '').trim();
  if (canonicalType === 'customer') return String(record.customerId || record.CustomerID || record.id || '').trim();
  if (canonicalType === 'customer_change') return String(record.id || record.changeId || record.ChangeID || '').trim();
  if (canonicalType === 'credit_sale') return String(record.id || record.creditId || record.CreditID || '').trim();
  if (canonicalType === 'expense') return String(record.id || record.expenseId || record.ExpenseID || '').trim();
  if (canonicalType === 'goods_received') return String(record.id || record.grnId || record.GRNID || record.grn_id || '').trim();
  if (canonicalType === 'reconciliation') return String(record.id || record.reconciliationId || record.date || '').trim();
  if (canonicalType === 'branch' || canonicalType === 'branch_lockdown') return String(record.branchId || record.branch_id || record.id || hubBranchId || 'BR-MAIN').trim();
  if (canonicalType === 'cash_account') return String(record.account_id || record.id || '').trim();
  if (canonicalType === 'cash_transfer') return String(record.transfer_id || record.id || '').trim();
  if (canonicalType === 'supplier') return String(record.supplierId || record.SupplierID || record.id || '').trim();
  if (canonicalType === 'inventory_category') return String(record.categoryId || record.id || record.categoryName || '').trim();
  if (canonicalType === 'credit_group') return String(record.groupId || record.id || '').trim();
  if (canonicalType === 'direct_grv') return String(record.id || record.grvNumber || record.grn_id || '').trim();
  if (canonicalType === 'supplier_invoice_voucher') return String(record.id || record.voucherNumber || record.voucherId || '').trim();
  if (canonicalType === 'stocktake_session') return String(record.sessionId || record.id || '').trim();
  if (canonicalType === 'stocktake_segment') return String(record.segmentId || record.id || '').trim();
  if (canonicalType === 'stocktake_zone_assignment') return String(record.id || `${record.sessionId || ''}::${record.zoneId || ''}`).trim();
  if (canonicalType === 'daily_blind_config') return String(record.id || record.configId || '').trim();
  if (canonicalType === 'daily_blind_count') return String(record.id || record.countId || '').trim();
  if (canonicalType === 'purchase_order') return String(record.id || record.poNumber || record.poId || '').trim();
  if (canonicalType === 'permissions_matrix') return 'PERMISSIONS_MATRIX';
  if (canonicalType === 'role_configs') return 'ROLE_CONFIGS';
  if (canonicalType === 'multi_currency') return 'MULTI_CURRENCY_CONFIG';
  if (canonicalType === 'tombstone') return String(record.id || `${record.entityType || 'entity'}::${record.entityId || ''}`).trim();
  return String(record.id || record.entityId || record.recordId || record.logId || record.cashLogId || record.changeId || record.creditId || record.movementId || record.countId || record.closureId || record.settlementId || '').trim();
}

function normalizeIncomingCloudRecord(eType, rawData, fallbackId) {
  if (!rawData || typeof rawData !== 'object') return rawData;
  const d = { ...rawData };
  if (eType === 'inventory_item') {
    const trueId = String(d.itemId || d.ItemID || d.ProductID || d.id || '').trim();
    const safeId = trueId && !/^USR-/i.test(trueId) ? trueId : (fallbackId && !/^USR-/i.test(fallbackId) ? fallbackId : trueId || fallbackId);
    if (safeId) {
      d.itemId = safeId;
      d.id = safeId;
    }
    if (!d.itemName && (d.ItemName || d.Name || d.name || d.ProductName)) {
      d.itemName = d.ItemName || d.Name || d.name || d.ProductName;
    }
    if (!d.category && d.Category) d.category = d.Category;
    if (d.unitsPerCase === undefined && (d.UnitsPerCase !== undefined || d.CaseSize !== undefined)) {
      d.unitsPerCase = Math.max(1, Number(d.UnitsPerCase || d.CaseSize || 1) || 1);
    }
    if (d.costPerUnit === undefined) {
      const cu = d.costPriceUnit ?? d.CostPriceUnit ?? d.CostPerUnit ?? d.costPrice ?? d.CostPrice;
      if (cu !== undefined) d.costPerUnit = Number(cu) || 0;
    }
    if (d.costPerCase === undefined) {
      const cc = d.costPriceCase ?? d.CostPriceCase ?? d.CostPerCase;
      if (cc !== undefined) d.costPerCase = Number(cc) || 0;
      else if (d.costPerUnit !== undefined) d.costPerCase = Number(d.costPerUnit) * Math.max(1, Number(d.unitsPerCase || 1));
    }
    if (d.sellPriceUnit === undefined) {
      const su = d.SellPriceUnit ?? d.SellingPrice ?? d.price;
      if (su !== undefined) d.sellPriceUnit = Number(su) || 0;
    }
    if (d.sellPriceCase === undefined) {
      const sc = d.SellPriceCase;
      if (sc !== undefined) d.sellPriceCase = Number(sc) || 0;
    }
    if (d.totalUnits === undefined && (d.TotalUnits !== undefined || d.StockQuantity !== undefined)) {
      d.totalUnits = Number(d.TotalUnits ?? d.StockQuantity ?? 0) || 0;
    }
  } else if (eType === 'sale') {
    const sid = String(d.id || d.invoice_id || d.InvoiceID || fallbackId || '').trim();
    if (sid) d.id = sid;
    if (d.total === undefined && d.Total !== undefined) d.total = Number(d.Total) || 0;
    if (d.subtotal === undefined && d.Subtotal !== undefined) d.subtotal = Number(d.Subtotal) || 0;
    if (d.discount === undefined && d.Discount !== undefined) d.discount = Number(d.Discount) || 0;
    if (d.amountTendered === undefined && d.AmountTendered !== undefined) d.amountTendered = Number(d.AmountTendered) || 0;
    if (d.changeGiven === undefined && (d.ChangeGiven !== undefined || d.ChangeDue !== undefined)) {
      d.changeGiven = Number(d.ChangeGiven ?? d.ChangeDue ?? 0) || 0;
    }
    if (!d.itemsSummary && d.ItemsSummary) d.itemsSummary = String(d.ItemsSummary);
    if (!d.paymentMethod && d.PaymentMethod) d.paymentMethod = String(d.PaymentMethod);
    if (!d.staffName && (d.StaffName || d.Cashier)) d.staffName = String(d.StaffName || d.Cashier);
    if (!d.customerName && d.CustomerName) d.customerName = String(d.CustomerName);
    if (!d.currency && d.Currency) d.currency = String(d.Currency);
    if (!d.date && d.Date) d.date = String(d.Date);
  } else if (eType === 'expense') {
    if (!d.id && (d.ExpenseID || fallbackId)) d.id = String(d.ExpenseID || fallbackId);
    if (!d.description && d.Description) d.description = String(d.Description);
    if (!d.category && d.Category) d.category = String(d.Category);
    if (d.amount === undefined && d.Amount !== undefined) d.amount = Number(d.Amount) || 0;
    if (!d.date && d.Date) d.date = String(d.Date);
  } else if (eType === 'customer') {
    const cid = String(d.customerId || d.CustomerID || d.id || fallbackId || '').trim();
    if (cid) { d.customerId = cid; d.id = cid; }
    if (!d.name && d.Name) d.name = String(d.Name);
    if (!d.phone && d.Phone) d.phone = String(d.Phone);
  } else if (eType === 'customer_change') {
    if (!d.id && (d.ChangeID || fallbackId)) d.id = String(d.ChangeID || fallbackId);
    if (!d.customerName && d.CustomerName) d.customerName = String(d.CustomerName);
    if (d.amount === undefined && d.Amount !== undefined) d.amount = Number(d.Amount) || 0;
  } else if (eType === 'credit_sale') {
    if (!d.id && (d.CreditID || fallbackId)) d.id = String(d.CreditID || fallbackId);
    if (!d.customerName && d.CustomerName) d.customerName = String(d.CustomerName);
    if (d.totalAmount === undefined && d.TotalAmount !== undefined) d.totalAmount = Number(d.TotalAmount) || 0;
  }
  return d;
}

function buildHubSyncEnvelope(entityType, record) {
  const canonicalType = mapHubEntityToCanonicalType(entityType);
  const recId = getHubCanonicalEntityId(record, canonicalType) || `REC-${Date.now()}`;
  const cleanData = record && typeof record === 'object' ? { ...record } : { id: recId };
  if ('pin' in cleanData) delete cleanData.pin;
  if ('rawPin' in cleanData) delete cleanData.rawPin;
  if ('password' in cleanData) delete cleanData.password;
  cleanData.company_id = cleanData.company_id || cleanData.companyId || hubTenantId;
  cleanData.branch_id = cleanData.branch_id || cleanData.branchId || hubBranchId;

  const updatedAtMs =
    parseHubTimestampMs(cleanData.updatedAt || cleanData.lastUpdated || cleanData.hubTimestamp || cleanData.timestamp) || Date.now();
  const targetBranch =
    cleanData.targetBranchId ||
    cleanData.target_branch_id ||
    (isHubGlobalBranchEntityType(canonicalType)
      ? 'ALL'
      : cleanData.branch_id || hubBranchId || 'ALL');

  // For stocktake_session, keep serialized payload safely under Google Sheets 50,000-char cell limit
  if (canonicalType === 'stocktake_session' && Array.isArray(cleanData.segments)) {
    try {
      const approxLen = JSON.stringify(cleanData).length;
      if (approxLen > 42000) {
        cleanData.segments = cleanData.segments.map((seg) => {
          if (!seg || typeof seg !== 'object') return seg;
          const compact = { ...seg };
          if (Array.isArray(compact.count1) && compact.count1.length > 0) compact.count1 = [];
          if (Array.isArray(compact.count2) && compact.count2.length > 0) compact.count2 = [];
          return compact;
        });
      }
    } catch (_) {}
  }

  const isT2Mutable = isCanonicalT2Type(canonicalType);
  const versionNum = Number(cleanData.version || 1);
  // T2 mutable records must emit a fresh packetId per revision so Cloud's packet dedupe ring never drops updates
  const resolvedPacketId = isT2Mutable
    ? `HUB-ENV-${canonicalType}-${recId}-v${versionNum}-${updatedAtMs}-${Math.random().toString(36).slice(2, 6)}`
    : String(cleanData.packetId || cleanData.clientRequestId || `HUB-ENV-${canonicalType}-${recId}-${Date.now()}`);

  return {
    packetId: resolvedPacketId,
    entityType: canonicalType,
    entityId: recId,
    action: 'UPSERT',
    data: cleanData,
    updatedAt: updatedAtMs,
    version: versionNum,
    mutationSource: cleanData.mutationSource || 'LOCAL_HUB',
    originDeviceId: cleanData.originDeviceId || cleanData.origin_device_id || `HUB-${hubBranchId}`,
    targetBranchId: targetBranch,
    class: isT2Mutable ? 'T2' : 'T1',
  };
}

async function postAppsScriptJson(targetUrl, bodyObj, timeoutMsOverride) {
  const postStr = JSON.stringify(bodyObj);
  const timeoutMs = Number(timeoutMsOverride) || Number(hubRuntimePolicy.requestTimeoutMs) || 45000;
  const isGateway = Boolean(cloudGatewayUrl && targetUrl === cloudGatewayUrl);
  const contentType = isGateway ? 'application/json' : 'text/plain;charset=utf-8';

  const parseSafeJson = (rawText) => {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return { json: null, isHtml: false };
    if (trimmed.startsWith('<')) return { json: null, isHtml: true };
    try {
      return { json: JSON.parse(trimmed), isHtml: false };
    } catch (_) {
      return { json: null, isHtml: false };
    }
  };

  if (typeof fetch === 'function') {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: postStr,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const text = await res.text();
      const parsed = parseSafeJson(text);
      return {
        ok: res.ok && !parsed.isHtml,
        status: res.status,
        isHtml: parsed.isHtml,
        dateHeader: res.headers && res.headers.get ? res.headers.get('date') : null,
        json: parsed.json,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return await new Promise((resolve, reject) => {
    const isHttps = targetUrl.startsWith('https:');
    const client = isHttps ? require('https') : require('http');
    const url = new URL(targetUrl);
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(postStr),
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        const parsed = parseSafeJson(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300 && !parsed.isHtml,
          status: res.statusCode,
          isHtml: parsed.isHtml,
          dateHeader: res.headers ? res.headers.date : null,
          json: parsed.json,
        });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Cloud request timed out after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', reject);
    req.write(postStr);
    req.end();
  });
}

async function fetchCloudGatewayPolicy(targetUrl) {
  if (!targetUrl || Date.now() - lastPolicyFetchAt < 15 * 60 * 1000) return;
  lastPolicyFetchAt = Date.now();
  try {
    const pingUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}action=ping`;
    if (typeof fetch === 'function') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
      try {
        const res = await fetch(pingUrl, { method: 'GET', ...(controller ? { signal: controller.signal } : {}) });
        const text = await res.text();
        if (res.ok && text && !text.trim().startsWith('<')) {
          const json = JSON.parse(text);
          if (json && json.policy && typeof json.policy === 'object') {
            applyHubRuntimePolicy(json.policy);
            scheduleSave();
            console.log(`[Edge-to-Cloud] 🧭 Synced cloud runtime policy (v${hubRuntimePolicy.protocolVersion}, batch=${hubRuntimePolicy.pushBatchSize}, pages=${hubRuntimePolicy.pullMaxPages}, timeout=${Math.round(hubRuntimePolicy.requestTimeoutMs / 1000)}s)`);
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } catch (err) {
    console.log(`[Edge-to-Cloud] Policy ping notice: ${err.message}`);
  }
}

function resolveUnifiedGatewayTarget(adapterCfg) {
  if (adapterCfg.gatewayUrl) {
    return {
      url: adapterCfg.gatewayUrl,
      isCloudGateway: true,
      extraGatewayFields: {
        backend_type: adapterCfg.databaseType,
        credentials: adapterCfg.credentials || {},
      },
    };
  }
  const url = String(
    adapterCfg.credentials.url ||
    adapterCfg.credentials.webhookUrl ||
    adapterCfg.credentials.masterWebhookUrl ||
    cloudSyncUrl ||
    ''
  ).trim();
  return { url, isCloudGateway: false, extraGatewayFields: {} };
}

function pushToCloud(entityType, record) {
  if (!record) return;
  if (record.isCloudSynced === true) {
    console.log(`[Edge Gateway] ⏭️ Dual-Writer Skip: ${entityType} (${record.id || record.invoice_id || record.grvNumber || record.customerId || record.itemId || ''}) already cloud-synced by PWA.`);
    return;
  }
  try {
    const adapterCfg = resolveCloudAdapterConfig();
    if (adapterCfg.databaseType === 'none') return;

    const canonicalType = mapHubEntityToCanonicalType(entityType);
    const isT1 = !T2_CANONICAL_TYPES.has(canonicalType) && canonicalType !== 'tombstone';
    const markCloudSyncedAndAck = () => {
      record.isCloudSynced = true;
      scheduleSave();
      if (isT1) {
        const ackStr = JSON.stringify({
          type: 'T1_CLOUD_SYNC_ACK',
          action: 'T1_CLOUD_SYNC_ACK',
          entityType,
          id: getHubCanonicalEntityId(record, canonicalType),
          isCloudSynced: true,
          server_received_at: record.server_received_at,
          suspicious_backdate: record.suspicious_backdate,
          origin_device_id: 'LOCAL_HUB',
          timestamp: Date.now(),
        });
        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            try { c.send(ackStr); } catch (e) {}
          }
        });
      }
    };

    // Freeze-Once Unified Cloud Gateway / Apps Script Adapter (Canonical Frozen 3-Action Protocol)
    if (adapterCfg.useUnifiedGateway) {
      if (cloudBackoffUntil > Date.now()) {
        return;
      }
      const target = resolveUnifiedGatewayTarget(adapterCfg);
      if (!target.url) return;

      const authFields = getHubCloudAuthFields();
      if (adapterCfg.databaseType === 'appscripts' && isBlockedMasterSheetWrite(hubTenantId, authFields.spreadsheet_id)) {
        console.warn(`[Edge Gateway] 🛡️ Blocked write for non-master tenant ${hubTenantId}: dedicated spreadsheet_id required (Master Sheet protected).`);
        return;
      }

      const envelope = buildHubSyncEnvelope(entityType, record);
      postAppsScriptJson(target.url, {
        action: 'push_envelopes',
        company_id: hubTenantId,
        branch_id: hubBranchId,
        user_id: `HUB-${hubBranchId}`,
        user_role: 'OWNER',
        user_branch_id: hubBranchId,
        ...authFields,
        ...target.extraGatewayFields,
        envelopes: [envelope],
        timestamp: Date.now(),
      }).then((res) => {
        if (!res.ok) {
          console.log(`[Edge Gateway] Cloud HTTP ${res.status}${res.isHtml ? ' (HTML error page)' : ''} for ${canonicalType}`);
          return;
        }
        const json = res.json;
        if (json && json.policy && typeof json.policy === 'object') {
          applyHubRuntimePolicy(json.policy);
        }
        if (json && (json.success === false || json.status === 'error' || (typeof json.httpStatus === 'number' && json.httpStatus >= 400))) {
          handleHubAppsScriptErrorResponse(json);
          return;
        }
        if (json && typeof json.current_routing_epoch === 'number' && json.current_routing_epoch > cloudRoutingEpoch) {
          cloudRoutingEpoch = json.current_routing_epoch;
        }
        if (json && json.server_received_at) record.server_received_at = json.server_received_at;
        if (json && Array.isArray(json.flaggedBackdateIds) && json.flaggedBackdateIds.includes(envelope.entityId)) {
          record.suspicious_backdate = true;
        } else if (json && json.suspicious_backdate !== undefined) {
          record.suspicious_backdate = Boolean(json.suspicious_backdate);
        }
        if (canonicalType === 'sale' || canonicalType === 'cash_log') {
          annotateCloudBackdateFlag(entityType, record, res.dateHeader || null);
        }
        console.log(`[Edge Gateway] ☁️ Pushed canonical envelope ${canonicalType}:${envelope.entityId} via ${target.isCloudGateway ? 'Cloud Sync Gateway' : 'Apps Script'}`);
        markCloudSyncedAndAck();
      }).catch((err) => {
        console.log(`[Edge Gateway] Cloud bridge notice for ${canonicalType}: ${err.message}`);
      });
      return;
    }

    if (adapterCfg.databaseType === 'supabase') {
      const sbUrl = String(adapterCfg.credentials.url || adapterCfg.credentials.projectUrl || '').trim().replace(/\/+$/, '');
      const sbKey = String(adapterCfg.credentials.apiKey || adapterCfg.credentials.serviceRoleKey || adapterCfg.credentials.anonKey || '').trim();
      if (!sbUrl || !sbKey || typeof fetch !== 'function') return;
      const tbl = mapEntityTypeToTable(entityType);
      const needsServerClock = entityType === 'SALE' || entityType === 'SALE_UPDATE' || entityType === 'CASH_LOG';
      if (needsServerClock) {
        annotateCloudBackdateFlag(entityType, record, null);
      }
      const sendSupabase = (payloadRec, allowRetry) => {
        fetch(`${sbUrl}/rest/v1/${tbl}`, {
          method: 'POST',
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify([payloadRec]),
        }).then((res) => {
          if (res.ok || res.status === 201) {
            if (needsServerClock) {
              annotateCloudBackdateFlag(entityType, record, res.headers && res.headers.get ? res.headers.get('date') : null);
            }
            console.log(`[Edge Gateway] ☁️ Pushed ${entityType} to Supabase table '${tbl}'`);
            markCloudSyncedAndAck();
          } else if (res.status === 400 && allowRetry && needsServerClock) {
            const stripped = { ...payloadRec };
            delete stripped.server_received_at;
            delete stripped.suspicious_backdate;
            sendSupabase(stripped, false);
          }
        }).catch((err) => {
          console.log(`[Edge Gateway] Supabase push notice for ${entityType}: ${err.message}`);
        });
      };
      sendSupabase(record, true);
      return;
    }

    if (adapterCfg.databaseType === 'mongodb') {
      const mongoUri = String(adapterCfg.credentials.mongoUri || adapterCfg.credentials.uri || '').trim();
      const dataApiUrl = String(adapterCfg.credentials.url || '').trim().replace(/\/+$/, '');
      const dataApiKey = String(adapterCfg.credentials.apiKey || '').trim();
      if (dataApiUrl && dataApiKey && typeof fetch === 'function') {
        const tbl = mapEntityTypeToTable(entityType);
        fetch(`${dataApiUrl}/action/insertOne`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': dataApiKey,
          },
          body: JSON.stringify({
            collection: tbl,
            database: adapterCfg.credentials.database || 'saimetric_pos',
            document: record,
          }),
        }).then((res) => {
          if (res.ok || res.status === 201) markCloudSyncedAndAck();
        }).catch(() => {});
      } else if (mongoUri) {
        try {
          const { MongoClient } = require('mongodb');
          const client = new MongoClient(mongoUri);
          client.connect().then(async () => {
            const db = client.db(adapterCfg.credentials.database || 'saimetric_pos');
            const tbl = mapEntityTypeToTable(entityType);
            const idVal = record.id || record.invoice_id || record.itemId || record.customerId || `${Date.now()}`;
            await db.collection(tbl).updateOne({ id: idVal }, { $set: record }, { upsert: true });
            markCloudSyncedAndAck();
            await client.close();
          }).catch((e) => {
            console.log(`[Edge Gateway] MongoDB push notice for ${entityType}: ${e.message}`);
          });
        } catch (e) {
          console.log(`[Edge Gateway] MongoDB driver not installed locally; configured URI queued for ${entityType}`);
        }
      }
      return;
    }

    if (adapterCfg.databaseType === 'firebase') {
      const projectId = String(adapterCfg.credentials.projectId || '').trim();
      const apiKey = String(adapterCfg.credentials.apiKey || '').trim();
      if (!projectId || typeof fetch !== 'function') return;
      const tbl = mapEntityTypeToTable(entityType);
      const docId = encodeURIComponent(String(record.id || record.invoice_id || record.itemId || record.customerId || Date.now()));
      const qs = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
      fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${tbl}/${docId}${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { payloadJson: { stringValue: JSON.stringify(record) } } }),
      }).then((res) => {
        if (res.ok) markCloudSyncedAndAck();
      }).catch(() => {});
      return;
    }
  } catch (err) {
    console.log(`[Edge Gateway] Cloud push notice: ${err.message}`);
  }
}

function roundHubUnits(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Number(n.toFixed(3));
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Canonical "One Number, Two Views" decomposition on the Local Hub:
 * - Invariant: totalUnits === (stockCases * unitsPerCase) + stockSingles
 * - Negative stock rule: whenever totalUnits < 0, stockCases = 0 and stockSingles = totalUnits
 */
function decomposeHubStockUnits(totalUnits, unitsPerCase, keepCasesZero) {
  const upc = Math.max(1, Number(unitsPerCase) || 1);
  const total = roundHubUnits(totalUnits);
  if (total < 0) {
    return { stockCases: 0, stockSingles: total, totalUnits: total, unitsPerCase: upc };
  }
  if (upc <= 1 || keepCasesZero) {
    return { stockCases: 0, stockSingles: total, totalUnits: total, unitsPerCase: upc };
  }
  const stockCases = Math.floor(total / upc);
  const stockSingles = roundHubUnits(total - stockCases * upc);
  return {
    stockCases,
    stockSingles,
    totalUnits: roundHubUnits(stockCases * upc + stockSingles),
    unitsPerCase: upc,
  };
}

function normalizeHubStockFields(item) {
  if (!item) return { stockCases: 0, stockSingles: 0, totalUnits: 0, unitsPerCase: 1 };
  const upc = Math.max(1, Number(item.unitsPerCase || item.UnitsPerCase) || 1);
  const rawCases = item.stockCases !== undefined && item.stockCases !== null && item.stockCases !== '' ? Number(item.stockCases) : NaN;
  const rawSingles = item.stockSingles !== undefined && item.stockSingles !== null && item.stockSingles !== '' ? Number(item.stockSingles) : NaN;
  const totalCandidate = item.totalUnits !== undefined && item.totalUnits !== null && item.totalUnits !== '' ? item.totalUnits : item.stockQuantity;
  const rawTotal = totalCandidate !== undefined && totalCandidate !== null && totalCandidate !== '' ? Number(totalCandidate) : NaN;

  const casesFinite = Number.isFinite(rawCases);
  const singlesFinite = Number.isFinite(rawSingles);
  const totalFinite = Number.isFinite(rawTotal);

  if (casesFinite && singlesFinite && rawCases >= 0 && rawSingles >= 0) {
    const pairSum = roundHubUnits(rawCases * upc + rawSingles);
    if (!totalFinite || Math.abs(pairSum - rawTotal) < 0.001) {
      return { stockCases: roundHubUnits(rawCases), stockSingles: roundHubUnits(rawSingles), totalUnits: pairSum, unitsPerCase: upc };
    }
  }

  const resolvedTotal = totalFinite
    ? roundHubUnits(rawTotal)
    : roundHubUnits((casesFinite ? rawCases : 0) * upc + (singlesFinite ? rawSingles : 0));
  const keepCasesZero = upc <= 1 || (item.canSellAsCase === false && (!casesFinite || rawCases <= 0));
  return decomposeHubStockUnits(resolvedTotal, upc, keepCasesZero);
}

function resolveHubAvgUnitCost(item) {
  if (!item) return 0;
  const avg = Number(item.averageCostPerUnit);
  if (Number.isFinite(avg) && avg > 0) return Number(avg.toFixed(4));
  const cpu = Number(item.costPerUnit);
  if (Number.isFinite(cpu) && cpu > 0) return Number(cpu.toFixed(4));
  const cpc = Number(item.costPerCase);
  const upc = Math.max(1, Number(item.unitsPerCase || item.UnitsPerCase) || 1);
  if (Number.isFinite(cpc) && cpc > 0) return Number((cpc / upc).toFixed(4));
  return 0;
}

function resolveHubPoolCents(item, currentUnits) {
  const units = Number(currentUnits || 0);
  if (units <= 0) return 0;
  const avg = resolveHubAvgUnitCost(item);
  const rawPool = item && item.stockValueCents !== undefined && item.stockValueCents !== null ? Math.round(Number(item.stockValueCents)) : NaN;
  if (Number.isFinite(rawPool) && rawPool >= 0 && !(rawPool === 0 && avg > 0)) {
    return rawPool;
  }
  return Math.max(0, Math.round(units * avg * 100));
}

function applyHubStockUnits(item, nextTotalUnits, options) {
  if (!item) return;
  const prevStock = normalizeHubStockFields(item);
  const prevUnits = prevStock.totalUnits;
  const upc = Math.max(1, Number(item.unitsPerCase || item.UnitsPerCase) || 1);
  const keepCasesZero = upc <= 1 || (item.canSellAsCase === false && !(Number(item.stockCases) > 0));
  const decomposed = decomposeHubStockUnits(nextTotalUnits, upc, keepCasesZero);

  // Maintain integer-cent stockValueCents value pool cleanly across outflows/returns
  if (!options || options.skipPoolUpdate !== true) {
    const avgCost = resolveHubAvgUnitCost(item);
    if (decomposed.totalUnits <= 0) {
      item.stockValueCents = 0;
    } else if (decomposed.totalUnits < prevUnits && prevUnits > 0) {
      const prevPool = resolveHubPoolCents(item, prevUnits);
      const deduct = roundHubUnits(prevUnits - decomposed.totalUnits);
      const cogsCents = Math.min(prevPool, Math.round((prevPool * deduct) / prevUnits));
      item.stockValueCents = Math.max(0, prevPool - cogsCents);
    } else if (decomposed.totalUnits > prevUnits) {
      const added = roundHubUnits(decomposed.totalUnits - prevUnits);
      if (prevUnits >= 0) {
        const prevPool = resolveHubPoolCents(item, prevUnits);
        item.stockValueCents = prevPool + Math.round(added * avgCost * 100);
      } else {
        item.stockValueCents = Math.round(decomposed.totalUnits * avgCost * 100);
      }
    }
  }

  item.unitsPerCase = decomposed.unitsPerCase;
  item.stockCases = decomposed.stockCases;
  item.stockSingles = decomposed.stockSingles;
  item.totalUnits = decomposed.totalUnits;
}

/**
 * Broadcasts an authoritative T2 Inventory Snapshot to all connected peers
 */
function broadcastInventorySnapshot(item) {
  if (!item) return;
  const snapTime = Date.now();
  const stock = normalizeHubStockFields(item);
  item.unitsPerCase = stock.unitsPerCase;
  item.stockCases = stock.stockCases;
  item.stockSingles = stock.stockSingles;
  item.totalUnits = stock.totalUnits;
  item.stockValueCents = stock.totalUnits <= 0 ? 0 : resolveHubPoolCents(item, stock.totalUnits);
  item.snapshotTimestamp = snapTime;
  item.updatedAt = snapTime;
  item.hubTimestamp = snapTime;
  item.lastUpdated = new Date(snapTime).toISOString();
  scheduleSave();

  const snapshotPayload = {
    ...item,
    unitsPerCase: stock.unitsPerCase,
    stockCases: stock.stockCases,
    stockSingles: stock.stockSingles,
    totalUnits: stock.totalUnits,
    stockValueCents: item.stockValueCents,
    snapshotTimestamp: snapTime,
  };

  const pktStr = JSON.stringify({
    type: 'INVENTORY_UPDATE',
    action: 'INVENTORY_UPDATE',
    entityType: 'INVENTORY',
    itemId: item.itemId || item.id,
    item: snapshotPayload,
    payload: snapshotPayload,
    snapshotTimestamp: snapTime,
    unitsPerCase: stock.unitsPerCase,
    stockCases: stock.stockCases,
    stockSingles: stock.stockSingles,
    totalUnits: stock.totalUnits,
    stockValueCents: item.stockValueCents,
    averageCostPerUnit: item.averageCostPerUnit,
    averageCostPerCase: item.averageCostPerCase,
    latestCostPerUnit: item.latestCostPerUnit,
    latestCostPerCase: item.latestCostPerCase,
    origin_device_id: 'LOCAL_HUB',
    origin_device_name: 'Termux Local Hub',
    timestamp: snapTime,
  });

  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(pktStr); } catch (e) {}
    }
  });
}

const DATA_FILE = path.join(process.cwd(), 'termux-hub-data.json');
const BLIND_VAULT_FILE = path.join(process.cwd(), 'hub-blind-vault.json');
const MAX_STORAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB Safety Limit for Termux hardware
const ROTATION_DAYS = 30; // 30-day rotation for archived historical movements

// In-Memory & File-backed Stores
let salesStore = [];
let inventoryStore = [];
let directGrvsStore = [];
let cashMovementsStore = [];
let cashLiftsStore = [];
let cashLogsStore = [];
let customerChangesStore = [];
let creditSalesStore = [];
let creditGroupsStore = [];
let stockMovementsStore = [];
let expensesStore = [];
let cashTransfersStore = [];
let internalConsumptionsStore = [];

// T1 Batch A Stores (Append-Only)
let suppliersStore = [];
let adminSalesStore = [];
let cashCountsStore = [];
let vouchersStore = [];

// T2 Batch B+C Categories Store
let categoriesStore = [];

// Stocktake Dedicated Stores
let casualWorkersStore = [];
let zoneAssignmentsStore = [];
let branchLockdownsStore = {};
let stocktakeSessionsStore = [];
let stocktakeSegmentsStore = [];
let dailyBlindConfigsStore = [];
let dailyBlindCountsStore = [];
let purchaseOrdersStore = [];

// Staff & Customer Master Stores (Synced across multi-device Wi-Fi)
let salespeopleStore = [];
let customersStore = [];
let branchesStore = [];
let cashAccountsStore = [];
let permissionsMatrixStore = { rules: [], updatedAt: 0 };
let roleConfigsStore = { definitions: null, updatedAt: 0 };
let multiCurrencyStore = { config: null, updatedAt: 0 };

// Tombstones Store (Soft Deletes across multi-device Wi-Fi)
let tombstonesStore = [];

// Security Alerts Store (Clock tampering & rejected backdated transactions)
let securityAlertsStore = [];

// Business Day Closures & EOD Archives
let businessDayClosuresStore = [];
let electronicSettlementsStore = [];

// Schema-Agnostic Generic Envelope Store (handles reconciliation, goods_received, and ANY future entityType without APK rebuilds)
// Structure: { [entityType: string]: { [entityId: string]: { ...record, _entityType, _entityId, _class, _updatedAt, isCloudSynced } } }
let genericEntitiesStore = {};

function upsertGenericEntityInHub(entityType, entityId, dataObj, meta = {}) {
  const eType = String(entityType || '').trim().toLowerCase();
  const eId = String(entityId || '').trim();
  if (!eType || !eId || !dataObj || typeof dataObj !== 'object') return false;
  if (!genericEntitiesStore[eType] || typeof genericEntitiesStore[eType] !== 'object') {
    genericEntitiesStore[eType] = {};
  }
  const bucket = genericEntitiesStore[eType];
  const existing = bucket[eId];
  const incomingTs = parseHubTimestampMs(meta.updatedAt || dataObj.updatedAt || dataObj.lastUpdated || dataObj.timestamp) || Date.now();
  const entityClass = meta.class || (isCanonicalT2Type(eType) ? 'T2' : 'T1');
  if (existing) {
    const existingTs = parseHubTimestampMs(existing._updatedAt || existing.updatedAt || existing.lastUpdated) || 0;
    if (entityClass === 'T2' && existingTs > 0 && existingTs > incomingTs + 60000) {
      return false;
    }
  }
  const merged = {
    ...(existing || {}),
    ...dataObj,
    id: dataObj.id || eId,
    company_id: dataObj.company_id || dataObj.companyId || hubTenantId,
    branch_id: dataObj.branch_id || dataObj.branchId || hubBranchId,
    _entityType: eType,
    _entityId: eId,
    _class: entityClass,
    _updatedAt: incomingTs,
    updatedAt: incomingTs,
    ...(meta.isCloudSynced === true ? { isCloudSynced: true } : { isCloudSynced: existing?.isCloudSynced === true && meta.isCloudSynced !== false }),
  };
  bucket[eId] = merged;
  // Cap per-entity-type generic bucket via cloud-controlled runtime policy (default 5000) to protect mobile device RAM
  const bucketMaxItems = Math.max(500, Number(hubRuntimePolicy.genericBucketMaxItems) || 5000);
  const keys = Object.keys(bucket);
  if (keys.length > bucketMaxItems) {
    keys
      .sort((a, b) => (bucket[a]?._updatedAt || 0) - (bucket[b]?._updatedAt || 0))
      .slice(0, keys.length - bucketMaxItems)
      .forEach((k) => delete bucket[k]);
  }
  return true;
}

// Secret holding vault for blind double-counting backed by hub-blind-vault.json:
// Structure: { [sessionId]: { [zoneId]: { A: null, B: null } } }
let hubBlindStore = {};

function loadBlindVault() {
  try {
    if (fs.existsSync(BLIND_VAULT_FILE)) {
      const raw = fs.readFileSync(BLIND_VAULT_FILE, 'utf8');
      hubBlindStore = JSON.parse(raw) || {};
      const sessionCount = Object.keys(hubBlindStore).length;
      console.log(`[Hub] Loaded ${sessionCount} sessions from blind vault.`);
    } else {
      hubBlindStore = {};
    }
  } catch (e) {
    console.warn('[Hub] Notice loading blind vault file:', e.message);
    hubBlindStore = {};
  }
}

function saveBlindVault() {
  try {
    fs.writeFileSync(BLIND_VAULT_FILE, JSON.stringify(hubBlindStore, null, 2), 'utf8');
  } catch (e) {
    console.error('[Hub] Error saving blind vault:', e.message);
  }
}

let packetCounter = 0;
const seenPacketIds = new Set();

/**
 * Strict Schema Validation for Branches:
 * Rejects records that have customer fields (creditLimit, outstandingDebt, customerId, currentBalance, maxCreditReceiptCount, isCustomLimit)
 * or staff fields (pin_hash, pin_salt, pin, role, permissions, branchAssignments, email).
 */
function isValidBranchRecord(rec) {
  if (!rec || typeof rec !== 'object') return false;
  // Reject if contains customer fields
  if (
    rec.creditLimit !== undefined ||
    rec.outstandingDebt !== undefined ||
    rec.customerId !== undefined ||
    rec.currentBalance !== undefined ||
    rec.maxCreditReceiptCount !== undefined ||
    rec.isCustomLimit !== undefined ||
    rec.creditGroupId !== undefined ||
    rec.creditGroupName !== undefined ||
    rec.debt !== undefined
  ) {
    return false;
  }
  // Reject if contains staff fields
  if (
    rec.pin_hash !== undefined ||
    rec.pin_salt !== undefined ||
    rec.pin !== undefined ||
    rec.role !== undefined ||
    rec.permissions !== undefined ||
    rec.branchAssignments !== undefined
  ) {
    return false;
  }
  // Reject if contains supplier fields
  if (
    rec.supplierId !== undefined ||
    rec.SupplierID !== undefined ||
    rec.contactPerson !== undefined ||
    rec.paymentTerms !== undefined ||
    rec.taxNumber !== undefined ||
    rec.accountNumber !== undefined ||
    rec.bankAccount !== undefined ||
    rec.bankName !== undefined ||
    (rec.category !== undefined && typeof rec.category === 'string' && !rec.code && !rec.location)
  ) {
    return false;
  }
  // Reject if contains inventory / product fields
  if (
    rec.itemId !== undefined ||
    rec.costPrice !== undefined ||
    rec.costPerUnit !== undefined ||
    rec.sellPriceUnit !== undefined ||
    rec.totalUnits !== undefined ||
    rec.stockSingles !== undefined ||
    rec.stockCases !== undefined ||
    rec.unitsPerCase !== undefined ||
    rec.barcode !== undefined ||
    rec.sku !== undefined
  ) {
    return false;
  }
  // Must have an identifier and not be empty
  const bId = rec.branchId || rec.id || rec.branch_id || rec.BranchID;
  return Boolean(bId);
}

function canonicalizeHubBranchId(rawId) {
  const clean = String(rawId || '').trim();
  if (!clean) return 'BR-MAIN';
  const low = clean.toLowerCase();
  return (low === '1' || low === 'br-main' || low === 'br001') ? 'BR-MAIN' : clean;
}

function normHubBranchTenant(val) {
  const u = String(val || 'COMP-001').trim().toUpperCase();
  return (!u || u === 'DEFAULT' || u === 'COMP-001' || u === 'COMP-MASTER') ? 'COMP-001' : u;
}

function isHubPlaceholderBranchName(name) {
  const clean = String(name || '').trim().toLowerCase();
  return !clean || clean === 'branch' || clean === 'main branch' || clean === 'unnamed branch';
}

function isHubPlaceholderBranchCode(code, id) {
  const clean = String(code || '').trim().toLowerCase();
  const cleanId = String(id || '').trim().toLowerCase();
  return !clean || (cleanId.length > 0 && clean === cleanId) || clean === 'branch';
}

function normalizeAndDeduplicateHubBranches(list) {
  if (!Array.isArray(list)) return [];
  const byKey = new Map();
  const codeToKey = new Map();
  for (const b of list) {
    if (!isValidBranchRecord(b)) {
      console.warn(`[Termux Hub] 🧹 Purged contaminated non-branch record from Hub memory/disk: ${b?.name || b?.branchName || b?.branchId || b?.id}`);
      continue;
    }
    const rawId = b.branchId || b.id || b.branch_id || b.BranchID;
    const canonId = canonicalizeHubBranchId(rawId);
    const comp = normHubBranchTenant(b.company_id || b.companyId || b.CompanyID || hubTenantId);
    const name = String(b.name || b.branch_name || b.branchName || b.Name || '').trim();
    const code = String(b.code || b.branch_code || b.branchCode || b.Code || '').trim();
    const loc = String(b.location || b.address || b.Location || b.Address || '').trim();

    const normRec = {
      ...b,
      branchId: canonId,
      id: canonId,
      branch_id: canonId,
      company_id: comp,
      companyId: comp,
      ...(name ? { name } : {}),
      ...(code ? { code } : {}),
      ...(loc ? { location: loc, address: loc } : {}),
    };

    const idKey = `${comp}::${canonId.toUpperCase()}`;
    const codeKey = !isHubPlaceholderBranchCode(code, canonId) ? `${comp}::CODE::${code.toUpperCase()}` : '';
    const dupKey = byKey.has(idKey) ? idKey : (codeKey ? codeToKey.get(codeKey) : undefined);

    if (dupKey && byKey.has(dupKey)) {
      const prev = byKey.get(dupKey);
      const prevTs = getTimestamp(prev);
      const currTs = getTimestamp(normRec);
      const preferCurr =
        (canonId === 'BR-MAIN' && prev.branchId !== 'BR-MAIN') ||
        (canonId === prev.branchId && currTs > prevTs) ||
        (isHubPlaceholderBranchName(prev.name) && !isHubPlaceholderBranchName(normRec.name));
      const winner = preferCurr ? normRec : prev;
      const loser = preferCurr ? prev : normRec;
      byKey.set(dupKey, {
        ...loser,
        ...winner,
        name: !isHubPlaceholderBranchName(winner.name) ? winner.name : (loser.name || winner.name),
        code: !isHubPlaceholderBranchCode(winner.code, winner.branchId) ? winner.code : (loser.code || winner.code),
        location: winner.location || loser.location || '',
        address: winner.address || winner.location || loser.address || loser.location || '',
      });
      continue;
    }

    byKey.set(idKey, normRec);
    if (codeKey) codeToKey.set(codeKey, idKey);
  }
  return Array.from(byKey.values());
}

function isValidStaffRecord(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.customerId !== undefined || rec.creditLimit !== undefined || rec.supplierId !== undefined) {
    return false;
  }
  return Boolean(rec.id || rec.staffId || rec.pin_hash || rec.role);
}

function isValidCustomerRecord(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.pin_hash !== undefined || rec.pin_salt !== undefined || rec.role !== undefined || rec.supplierId !== undefined) {
    return false;
  }
  return Boolean(rec.customerId || rec.id || rec.name || rec.creditLimit !== undefined);
}

// Helper: Match record by tenant and branch
function isMatch(rec, reqComp, reqBranch, isCatalog = false) {
  if (!rec) return false;
  const normComp = (val) => {
    const u = String(val || 'COMP-001').trim().toUpperCase();
    return (!u || u === 'DEFAULT' || u === 'COMP-001' || u === 'COMP-MASTER') ? 'COMP-001' : u;
  };
  const c = normComp(rec.company_id || rec.companyId);
  const rc = reqComp ? normComp(reqComp) : '';
  if (rc && c && c !== rc) return false;
  if (isCatalog) {
    if (rec.assignedBranchIds && Array.isArray(rec.assignedBranchIds) && rec.assignedBranchIds.length > 0) {
      if (reqBranch && reqBranch !== 'ALL' && !rec.assignedBranchIds.map((b) => String(b).toUpperCase()).includes(reqBranch)) {
        return false;
      }
    }
    return true;
  }
  const b = (rec.branch_id || rec.branchId || '').trim().toUpperCase();
  if (reqBranch && b && reqBranch !== 'ALL' && b !== 'ALL' && b !== reqBranch) return false;
  return true;
}

// Helper: Extract timestamp in milliseconds (considers refund/void timestamps so CatchUp never omits them)
function getTimestamp(rec) {
  if (!rec) return 0;
  const parseTs = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    const tm = new Date(v).getTime();
    return isNaN(tm) ? 0 : tm;
  };
  const candidates = [
    rec.updatedAt,
    rec.hubTimestamp,
    rec.lastUpdated,
    rec.updated_at,
    rec.refundedAt,
    rec.voidedAt,
    rec.mobileVerifiedAt,
  ];
  let best = 0;
  for (let i = 0; i < candidates.length; i++) {
    const val = parseTs(candidates[i]);
    if (val > best) best = val;
  }
  if (best > 0) return best;
  const fallback = rec.timestamp ?? rec.createdAt ?? rec.created_at ?? rec.date;
  return parseTs(fallback);
}

// Cloud-Controlled Disk Rotation (default 30 days) & Storage Safety Trim (default 2GB)
// Safe Pruning: ONLY delete records older than effectiveRetentionDays AND isCloudSynced === true!
function pruneOldRecords() {
  const effectiveRetentionDays = Math.max(7, Number(hubRuntimePolicy.retentionDays) || ROTATION_DAYS);
  const cutoffTime = Date.now() - (effectiveRetentionDays * 24 * 60 * 60 * 1000);
  const shouldRetain = (rec) => {
    const isOld = getTimestamp(rec) < cutoffTime && Boolean(rec.date);
    if (!isOld) return true; // Retain recent records
    // If old, only prune if confirmed synced to cloud!
    return rec.isCloudSynced !== true;
  };

  salesStore = salesStore.filter(shouldRetain);
  directGrvsStore = directGrvsStore.filter(shouldRetain);
  cashMovementsStore = cashMovementsStore.filter(shouldRetain);
  cashLogsStore = cashLogsStore.filter(shouldRetain);
  cashLiftsStore = cashLiftsStore.filter(shouldRetain);
  customerChangesStore = customerChangesStore.filter(shouldRetain);
  creditSalesStore = creditSalesStore.filter(shouldRetain);
  creditGroupsStore = creditGroupsStore.filter(shouldRetain);
  stockMovementsStore = stockMovementsStore.filter(shouldRetain);
  expensesStore = expensesStore.filter(shouldRetain);
  cashTransfersStore = cashTransfersStore.filter(shouldRetain);
  internalConsumptionsStore = internalConsumptionsStore.filter(shouldRetain);
  suppliersStore = suppliersStore.filter(shouldRetain);
  adminSalesStore = adminSalesStore.filter(shouldRetain);
  cashCountsStore = cashCountsStore.filter(shouldRetain);
  vouchersStore = vouchersStore.filter(shouldRetain);
  businessDayClosuresStore = businessDayClosuresStore.filter(shouldRetain);
  electronicSettlementsStore = electronicSettlementsStore.filter(shouldRetain);

  // Additive pruning for cloud-synced T1 records inside genericEntitiesStore (never prunes T2 or unsynced records)
  if (genericEntitiesStore && typeof genericEntitiesStore === 'object') {
    for (const [gType, bucket] of Object.entries(genericEntitiesStore)) {
      if (!bucket || typeof bucket !== 'object') continue;
      if (isCanonicalT2Type(gType)) continue;
      for (const [gId, rec] of Object.entries(bucket)) {
        if (!rec || typeof rec !== 'object') continue;
        if (rec._class === 'T2') continue;
        if (rec.isCloudSynced !== true) continue;
        const recTs = Number(rec._updatedAt || getTimestamp(rec)) || 0;
        if (recTs > 0 && recTs < cutoffTime) {
          delete bucket[gId];
        }
      }
    }
  }
}

const DATA_TMP_FILE = `${DATA_FILE}.tmp`;
const DATA_BACKUP_FILE = `${DATA_FILE}.bak`;

function readParsedDataFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw || !raw.trim()) return null;
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

// Load persistent data if exists (with automatic .bak recovery if primary was interrupted)
function loadData() {
  try {
    let parsed = null;
    try {
      parsed = readParsedDataFile(DATA_FILE);
    } catch (primaryErr) {
      console.warn('[Termux Hub] Primary data file unreadable, attempting .bak recovery:', primaryErr.message);
      try {
        parsed = readParsedDataFile(DATA_BACKUP_FILE);
        if (parsed) {
          fs.copyFileSync(DATA_BACKUP_FILE, DATA_FILE);
          console.log('[Termux Hub] ✅ Recovered branch state cleanly from backup snapshot.');
        }
      } catch (bakErr) {
        console.warn('[Termux Hub] Backup recovery failed:', bakErr.message);
      }
    }
    if (!parsed && fs.existsSync(DATA_BACKUP_FILE)) {
      try {
        parsed = readParsedDataFile(DATA_BACKUP_FILE);
      } catch {}
    }

    if (parsed) {
      if (parsed.hubBranchId) hubBranchId = parsed.hubBranchId;
      if (parsed.hubBranchName) hubBranchName = parsed.hubBranchName;
      if (parsed.hubTenantId) hubTenantId = parsed.hubTenantId;
      if (parsed.lastCloudSyncTimestamp) lastCloudSyncTimestamp = Number(parsed.lastCloudSyncTimestamp) || 0;
      if (parsed.lastAppsScriptServerSeq) lastAppsScriptServerSeq = Number(parsed.lastAppsScriptServerSeq) || 0;
      if (parsed.cloudRoutingEpoch) cloudRoutingEpoch = Math.max(1, Number(parsed.cloudRoutingEpoch) || 1);
      if (parsed.cloudSpreadsheetId) cloudSpreadsheetId = String(parsed.cloudSpreadsheetId || '').trim();
      if (parsed.cloudGatewayUrl) cloudGatewayUrl = String(parsed.cloudGatewayUrl || '').trim();
      if (parsed.hubRuntimePolicy && typeof parsed.hubRuntimePolicy === 'object') {
        applyHubRuntimePolicy(parsed.hubRuntimePolicy);
      }
      if (parsed.genericEntities && typeof parsed.genericEntities === 'object') {
        genericEntitiesStore = parsed.genericEntities;
      }
      if (Array.isArray(parsed.sales)) salesStore = parsed.sales;
      if (Array.isArray(parsed.inventory)) inventoryStore = parsed.inventory;
      if (Array.isArray(parsed.directGrvs)) directGrvsStore = parsed.directGrvs;
      if (Array.isArray(parsed.cashMovements)) cashMovementsStore = parsed.cashMovements;
      if (Array.isArray(parsed.cashLifts)) cashLiftsStore = parsed.cashLifts;
      if (Array.isArray(parsed.cashLogs)) cashLogsStore = deduplicateHubCashLogs(parsed.cashLogs);
      if (Array.isArray(parsed.customerChanges)) customerChangesStore = parsed.customerChanges;
      if (Array.isArray(parsed.creditSales)) creditSalesStore = parsed.creditSales;
      if (Array.isArray(parsed.creditGroups)) creditGroupsStore = parsed.creditGroups;
      if (Array.isArray(parsed.stockMovements)) stockMovementsStore = deduplicateHubStockMovements(parsed.stockMovements);
      if (Array.isArray(parsed.expenses)) expensesStore = parsed.expenses;
      if (Array.isArray(parsed.cashTransfers)) cashTransfersStore = parsed.cashTransfers;
      if (Array.isArray(parsed.internalConsumptions)) internalConsumptionsStore = parsed.internalConsumptions;
      if (Array.isArray(parsed.suppliers)) suppliersStore = parsed.suppliers;
      if (Array.isArray(parsed.adminSales)) adminSalesStore = parsed.adminSales;
      if (Array.isArray(parsed.cashCounts)) cashCountsStore = parsed.cashCounts;
      if (Array.isArray(parsed.vouchers)) vouchersStore = parsed.vouchers;
      if (Array.isArray(parsed.categories)) categoriesStore = parsed.categories;
      if (Array.isArray(parsed.casualWorkers)) {
        casualWorkersStore = parsed.casualWorkers.map((cw) => {
          if (cw && cw.pin) delete cw.pin;
          return cw;
        });
      }
      if (Array.isArray(parsed.zoneAssignments)) zoneAssignmentsStore = parsed.zoneAssignments;
      if (Array.isArray(parsed.salespeople)) {
        salespeopleStore = parsed.salespeople.map((sp) => {
          if (sp && sp.pin) delete sp.pin;
          return sp;
        });
      }
      if (Array.isArray(parsed.customers)) customersStore = parsed.customers.filter(isValidCustomerRecord);
      if (Array.isArray(parsed.branches)) {
        branchesStore = normalizeAndDeduplicateHubBranches(parsed.branches);
      }
      if (Array.isArray(parsed.cashAccounts)) cashAccountsStore = parsed.cashAccounts;
      if (Array.isArray(parsed.businessDayClosures)) businessDayClosuresStore = parsed.businessDayClosures;
      if (Array.isArray(parsed.electronicSettlements)) electronicSettlementsStore = parsed.electronicSettlements;
      if (parsed.branchLockdowns && typeof parsed.branchLockdowns === 'object') {
        branchLockdownsStore = parsed.branchLockdowns;
      }
      if (Array.isArray(parsed.stocktakeSessions)) stocktakeSessionsStore = parsed.stocktakeSessions;
      if (Array.isArray(parsed.stocktakeSegments)) stocktakeSegmentsStore = parsed.stocktakeSegments;
      if (Array.isArray(parsed.dailyBlindConfigs)) dailyBlindConfigsStore = parsed.dailyBlindConfigs;
      if (Array.isArray(parsed.dailyBlindCounts)) dailyBlindCountsStore = parsed.dailyBlindCounts;
      if (Array.isArray(parsed.purchaseOrders)) purchaseOrdersStore = parsed.purchaseOrders;
      if (Array.isArray(parsed.tombstones)) tombstonesStore = parsed.tombstones;
      if (Array.isArray(parsed.securityAlerts)) securityAlertsStore = parsed.securityAlerts;
      if (parsed.permissionsMatrix && Array.isArray(parsed.permissionsMatrix.rules)) {
        permissionsMatrixStore = {
          rules: parsed.permissionsMatrix.rules,
          updatedAt: Number(parsed.permissionsMatrix.updatedAt) || 0,
          ...(parsed.permissionsMatrix.isCloudSynced === true ? { isCloudSynced: true } : {}),
        };
      }
      if (parsed.roleConfigs && parsed.roleConfigs.definitions && typeof parsed.roleConfigs.definitions === 'object') {
        roleConfigsStore = {
          definitions: parsed.roleConfigs.definitions,
          updatedAt: Number(parsed.roleConfigs.updatedAt) || 0,
          ...(parsed.roleConfigs.isCloudSynced === true ? { isCloudSynced: true } : {}),
        };
      }
      if (parsed.multiCurrency && parsed.multiCurrency.config && typeof parsed.multiCurrency.config === 'object') {
        multiCurrencyStore = {
          config: parsed.multiCurrency.config,
          updatedAt: Number(parsed.multiCurrency.updatedAt) || 0,
        };
      }

      // Purge any records already superseded by tombstones on startup
      if (tombstonesStore.length > 0) {
        for (const t of tombstonesStore) {
          if (t && t.entityId) {
            purgeEntityFromHubStores(t.entityType, t.entityId, Number(t.deletedAt) || getTimestamp(t) || Date.now());
          }
        }
      }

      console.log(
        `[Termux Hub] Loaded from disk: [Branch: ${hubBranchId} - ${hubBranchName}], ${salesStore.length} sales, ${directGrvsStore.length} direct GRVs, ${inventoryStore.length} items, ${salespeopleStore.length} staff, ${customersStore.length} customers, ${branchesStore.length} branches, ${cashAccountsStore.length} cash accounts, ${suppliersStore.length} suppliers, ${adminSalesStore.length} admin sales, ${cashCountsStore.length} cash counts, ${vouchersStore.length} vouchers, ${businessDayClosuresStore.length} closures, ${electronicSettlementsStore.length} settlements, ${categoriesStore.length} categories, ${tombstonesStore.length} tombstones.`
      );
    }
  } catch (e) {
    console.warn('[Termux Hub] Notice loading data file:', e.message);
  }
  // Load and decrypt universal cloud configuration from hub-cloud-config.enc into global cloudConfig
  loadEncryptedCloudConfig();
}

// Persist collections to disk atomically (compact JSON, single-flight async write + .bak + exit flush)
let saveTimeout = null;
let saveInFlight = false;
let saveDirty = false;
let isShuttingDown = false;

function scheduleSave() {
  saveDirty = true;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    void saveData();
  }, 200);
}

function buildSerializedDataPayload() {
  pruneOldRecords();

  const payload = {
    hubBranchId,
    hubBranchName,
    hubTenantId,
    lastCloudSyncTimestamp,
    lastAppsScriptServerSeq,
    cloudRoutingEpoch,
    cloudSpreadsheetId,
    cloudGatewayUrl,
    hubRuntimePolicy,
    sales: salesStore,
    inventory: inventoryStore,
    directGrvs: directGrvsStore,
    cashMovements: cashMovementsStore,
    cashLifts: cashLiftsStore,
    cashLogs: cashLogsStore,
    customerChanges: customerChangesStore,
    creditSales: creditSalesStore,
    creditGroups: creditGroupsStore,
    stockMovements: stockMovementsStore,
    expenses: expensesStore,
    cashTransfers: cashTransfersStore,
    internalConsumptions: internalConsumptionsStore,
    suppliers: suppliersStore,
    adminSales: adminSalesStore,
    cashCounts: cashCountsStore,
    vouchers: vouchersStore,
    categories: categoriesStore,
    casualWorkers: casualWorkersStore,
    zoneAssignments: zoneAssignmentsStore,
    salespeople: salespeopleStore,
    customers: customersStore,
    branches: branchesStore,
    cashAccounts: cashAccountsStore,
    businessDayClosures: businessDayClosuresStore,
    electronicSettlements: electronicSettlementsStore,
    branchLockdowns: branchLockdownsStore,
    stocktakeSessions: stocktakeSessionsStore,
    dailyBlindConfigs: dailyBlindConfigsStore,
    dailyBlindCounts: dailyBlindCountsStore,
    purchaseOrders: purchaseOrdersStore,
    stocktakeSegments: stocktakeSegmentsStore,
    tombstones: tombstonesStore,
    securityAlerts: securityAlertsStore,
    permissionsMatrix: permissionsMatrixStore,
    roleConfigs: roleConfigsStore,
    multiCurrency: multiCurrencyStore,
    genericEntities: genericEntitiesStore,
    savedAt: new Date().toISOString(),
  };

  // Compact JSON cuts file size & CPU time ~35-40% vs pretty-printed output
  const serialized = JSON.stringify(payload);
  const byteSize = Buffer.byteLength(serialized, 'utf8');
  const effectiveMaxStorageMb = Math.max(64, Number(hubRuntimePolicy.maxStorageMb) || 2048);
  const effectiveMaxBytes = effectiveMaxStorageMb * 1024 * 1024;
  if (byteSize > effectiveMaxBytes) {
    // Storage Guard: Check if unsynced records exist. NEVER delete unsynced records to save space!
    const hasUnsyncedGeneric = Object.values(genericEntitiesStore || {}).some((bucket) =>
      bucket && typeof bucket === 'object'
        ? Object.values(bucket).some((r) => r && r.isCloudSynced !== true)
        : false
    );
    const hasUnsynced =
      salesStore.some((s) => s.isCloudSynced !== true) ||
      directGrvsStore.some((g) => g.isCloudSynced !== true) ||
      expensesStore.some((e) => e.isCloudSynced !== true) ||
      hasUnsyncedGeneric;
    if (hasUnsynced) {
      console.error(`[Termux Hub] ❌ CRITICAL: Hub storage (${(byteSize / (1024 * 1024)).toFixed(1)} MB) exceeds ${effectiveMaxStorageMb} MB policy limit, but unsynced transactions are present. Cannot prune unsynced records!`);
      throw new Error(`Termux Hub storage capacity reached (${effectiveMaxStorageMb} MB) with un-synced cloud transactions. Please restore cloud connectivity.`);
    } else {
      console.warn(`[Termux Hub] Warning: Hub data exceeds ${effectiveMaxStorageMb} MB limit. Trimming already-synced oldest records...`);
      salesStore = salesStore.filter((s) => s.isCloudSynced !== true).concat(salesStore.filter((s) => s.isCloudSynced === true).slice(0, 2500));
      directGrvsStore = directGrvsStore.filter((g) => g.isCloudSynced !== true).concat(directGrvsStore.filter((g) => g.isCloudSynced === true).slice(0, 500));
      payload.sales = salesStore;
      payload.directGrvs = directGrvsStore;
      return JSON.stringify(payload);
    }
  }
  return serialized;
}

function saveDataSyncAtomic() {
  try {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    const serialized = buildSerializedDataPayload();
    const fd = fs.openSync(DATA_TMP_FILE, 'w', 0o600);
    try {
      fs.writeSync(fd, serialized, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(DATA_FILE)) {
      try { fs.copyFileSync(DATA_FILE, DATA_BACKUP_FILE); } catch {}
    }
    fs.renameSync(DATA_TMP_FILE, DATA_FILE);
    saveDirty = false;
  } catch (e) {
    console.error('[Termux Hub] Error in atomic sync save:', e.message);
  }
}

async function saveData() {
  if (isShuttingDown) {
    saveDataSyncAtomic();
    return;
  }
  if (saveInFlight) {
    saveDirty = true;
    return;
  }
  saveInFlight = true;
  try {
    do {
      saveDirty = false;
      const serialized = buildSerializedDataPayload();
      const handle = await fs.promises.open(DATA_TMP_FILE, 'w', 0o600);
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (fs.existsSync(DATA_FILE)) {
        try { await fs.promises.copyFile(DATA_FILE, DATA_BACKUP_FILE); } catch {}
      }
      await fs.promises.rename(DATA_TMP_FILE, DATA_FILE);
    } while (saveDirty && !isShuttingDown);
  } catch (e) {
    console.error('[Termux Hub] Error saving data file:', e.message);
  } finally {
    saveInFlight = false;
  }
}

loadData();
loadBlindVault();

// =====================================================================
// MUTUAL HMAC-SHA256 AUTH & ZERO-CAMERA PAIRING ENGINE (v4.1.0)
// Compatible with both Android Hub APK (strict auth) & Termux Backup
// =====================================================================
const SECURITY_FILE = path.join(process.cwd(), 'hub-security.json');
const SECURITY_TMP_FILE = `${SECURITY_FILE}.tmp`;
const SECURITY_BACKUP_FILE = `${SECURITY_FILE}.bak`;
let hubSecurityState = {
  hubId: `HUB-${hubBranchId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
  pairedDevices: {},
  activePairCode: null,
  pairCodeExpiresAt: 0,
};
const pendingPairRequests = new Map(); // deviceId -> { ws, deviceId, deviceName, branchId, tenantId, confirmCode, createdAt }
const pairRateLimitMap = new Map(); // ip -> { count, windowStart }

function loadHubSecurityState() {
  try {
    let parsed = null;
    try {
      parsed = readParsedDataFile(SECURITY_FILE);
    } catch (primaryErr) {
      console.warn('[Termux Hub] hub-security.json unreadable, trying backup:', primaryErr.message);
      parsed = readParsedDataFile(SECURITY_BACKUP_FILE);
    }
    if (parsed && typeof parsed === 'object') {
      hubSecurityState = {
        hubId: String(parsed.hubId || hubSecurityState.hubId),
        pairedDevices: parsed.pairedDevices && typeof parsed.pairedDevices === 'object' ? parsed.pairedDevices : {},
        activePairCode: parsed.activePairCode || null,
        pairCodeExpiresAt: Number(parsed.pairCodeExpiresAt || 0),
      };
    } else if (!fs.existsSync(SECURITY_FILE)) {
      saveHubSecurityState();
    }
  } catch (err) {
    console.warn('[Termux Hub] Failed to load hub-security.json:', err.message);
  }
}

function saveHubSecurityState() {
  try {
    const serialized = JSON.stringify(hubSecurityState, null, 2);
    const fd = fs.openSync(SECURITY_TMP_FILE, 'w', 0o600);
    try {
      fs.writeSync(fd, serialized, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(SECURITY_FILE)) {
      try { fs.copyFileSync(SECURITY_FILE, SECURITY_BACKUP_FILE); } catch {}
    }
    fs.renameSync(SECURITY_TMP_FILE, SECURITY_FILE);
  } catch (err) {
    console.warn('[Termux Hub] Failed to save hub-security.json:', err.message);
  }
}

function hubHmacSha256Hex(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(String(message), 'utf8').digest('hex');
}

function hubConstantTimeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (!sa || !sb || sa.length !== sb.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sa, 'utf8'), Buffer.from(sb, 'utf8'));
  } catch {
    return false;
  }
}

function computeHubVisualConfirmCode(hubId, deviceId, clientNonce) {
  const hashHex = crypto
    .createHash('sha256')
    .update(`PAIR:${hubId}:${deviceId}:${clientNonce}`, 'utf8')
    .digest('hex');
  const num = parseInt(hashHex.slice(0, 8), 16) % 1000000;
  const padded = String(num).padStart(6, '0');
  return `${padded.slice(0, 3)}-${padded.slice(3, 6)}`;
}

function issueNewPairCode(ttlMs = 120000) {
  const code = String(crypto.randomInt(100000, 1000000));
  hubSecurityState.activePairCode = code;
  hubSecurityState.pairCodeExpiresAt = Date.now() + ttlMs;
  saveHubSecurityState();
  return { pairCode: code, expiresAt: hubSecurityState.pairCodeExpiresAt };
}

function isPairRateLimited(remoteIp) {
  const key = String(remoteIp || 'unknown');
  const now = Date.now();
  const entry = pairRateLimitMap.get(key);
  if (!entry || now - entry.windowStart > 60000) {
    pairRateLimitMap.set(key, { count: 0, windowStart: now });
    return false;
  }
  return entry.count >= 5;
}

function recordPairFailure(remoteIp) {
  const key = String(remoteIp || 'unknown');
  const now = Date.now();
  const entry = pairRateLimitMap.get(key);
  if (!entry || now - entry.windowStart > 60000) {
    pairRateLimitMap.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function emitHubIpcEvent(eventObj) {
  try {
    console.log(`[HUB_IPC] ${JSON.stringify(eventObj)}`);
  } catch {}
}

function approveDevicePairing(ws, deviceInfo) {
  const deviceId = String(deviceInfo.deviceId || '').trim();
  if (!deviceId) return null;
  const deviceSecret = crypto.randomBytes(32).toString('hex');
  hubSecurityState.pairedDevices[deviceId] = {
    deviceId,
    deviceName: String(deviceInfo.deviceName || 'POS Terminal'),
    branchId: String(deviceInfo.branchId || hubBranchId),
    tenantId: String(deviceInfo.tenantId || hubTenantId),
    deviceSecret,
    pairedAt: Date.now(),
    lastSeenAt: Date.now(),
    revoked: false,
  };
  saveHubSecurityState();

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.isAuthenticated = true;
    ws.pairedDeviceId = deviceId;
    ws.pairedDeviceSecret = deviceSecret;
    ws.authNonce = '';
    try {
      ws.send(JSON.stringify({
        type: 'PAIR_APPROVED',
        action: 'PAIR_APPROVED',
        hubId: hubSecurityState.hubId,
        hub_id: hubSecurityState.hubId,
        branchId: hubBranchId,
        branch_id: hubBranchId,
        branchName: hubBranchName,
        branch_name: hubBranchName,
        tenantId: hubTenantId,
        tenant_id: hubTenantId,
        deviceSecret,
        version: HUB_VERSION,
        hub_runtime: HUB_RUNTIME,
        ota_slot: HUB_OTA_SLOT,
        mdnsHost: getHubMdnsHost(),
        lanIps: getHubLanIps(),
        port: PORT,
        ...getHubFailoverMeta(),
        serverTime: Date.now(),
      }));
    } catch {}
  }
  pendingPairRequests.delete(deviceId);
  console.log(`[Termux Hub] 🔐 Paired device "${deviceInfo.deviceName || deviceId}" (${deviceId}) cleanly.`);
  return hubSecurityState.pairedDevices[deviceId];
}

function isLocalhostRequest(req) {
  const addr = String(req.socket?.remoteAddress || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      if (body.length < 65536) body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

loadHubSecurityState();

// HTTP server for health checks, ping, and localhost-only Native Shell admin bridge
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/ping' || req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        status: 'ok',
        hub: 'Termux-Local-Hub-Saimetric',
        hubId: hubSecurityState.hubId,
        version: HUB_VERSION,
        hubRuntime: HUB_RUNTIME,
        otaSlot: HUB_OTA_SLOT,
        authRequired: HUB_REQUIRE_AUTH,
        pairedDevicesCount: Object.values(hubSecurityState.pairedDevices).filter((d) => d && !d.revoked).length,
        branchId: hubBranchId,
        branchName: hubBranchName,
        tenantId: hubTenantId,
        mdnsHost: getHubMdnsHost(),
        lanIps: getHubLanIps(),
        port: PORT,
        ...getHubFailoverMeta(),
        salesCount: salesStore.length,
        directGrvsCount: directGrvsStore.length,
        inventoryCount: inventoryStore.length,
        staffCount: salespeopleStore.length,
        customerCount: customersStore.length,
        branchesCount: branchesStore.length,
        cashAccountsCount: cashAccountsStore.length,
        tombstonesCount: tombstonesStore.length,
        uptime: process.uptime(),
      })
    );
  }

  if (req.url === '/hub-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        type: 'HUB_INFO',
        action: 'HUB_INFO',
        hubId: hubSecurityState.hubId,
        tenantId: hubTenantId,
        branchId: hubBranchId,
        branch_id: hubBranchId,
        branch_name: hubBranchName,
        tenant_id: hubTenantId,
        hub_id: hubSecurityState.hubId,
        mdnsHost: getHubMdnsHost(),
        lanIps: getHubLanIps(),
        port: PORT,
        version: HUB_VERSION,
        hub_runtime: HUB_RUNTIME,
        ota_slot: HUB_OTA_SLOT,
        auth_required: HUB_REQUIRE_AUTH,
        ...getHubFailoverMeta(),
        totalRecords: salesStore.length + directGrvsStore.length,
        casualWorkersCount: casualWorkersStore.length,
        branchesCount: branchesStore.length,
        cashAccountsCount: cashAccountsStore.length,
        tombstonesCount: tombstonesStore.length,
        timestamp: Date.now(),
      })
    );
  }

  // Localhost-only Native Shell Admin API (127.0.0.1 only — unreachable from LAN Wi-Fi)
  if (req.url && req.url.startsWith('/local-admin/')) {
    if (!isLocalhostRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Localhost access only' }));
    }

    if (req.method === 'GET' && req.url === '/local-admin/security-state') {
      const now = Date.now();
      const safeDevices = Object.values(hubSecurityState.pairedDevices).map((d) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        branchId: d.branchId,
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
        revoked: Boolean(d.revoked),
      }));
      const pending = Array.from(pendingPairRequests.values())
        .filter((p) => now - p.createdAt < 120000)
        .map((p) => ({
          deviceId: p.deviceId,
          deviceName: p.deviceName,
          branchId: p.branchId,
          confirmCode: p.confirmCode,
          createdAt: p.createdAt,
        }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        hubId: hubSecurityState.hubId,
        branchId: hubBranchId,
        branchName: hubBranchName,
        tenantId: hubTenantId,
        version: HUB_VERSION,
        hubRuntime: HUB_RUNTIME,
        otaSlot: HUB_OTA_SLOT,
        authRequired: HUB_REQUIRE_AUTH,
        activePairCode: hubSecurityState.pairCodeExpiresAt > now ? hubSecurityState.activePairCode : null,
        pairCodeExpiresAt: hubSecurityState.pairCodeExpiresAt > now ? hubSecurityState.pairCodeExpiresAt : 0,
        pairedDevices: safeDevices,
        pendingApprovals: pending,
      }));
    }

    if (req.method === 'POST' && req.url === '/local-admin/pair-code') {
      const issued = issueNewPairCode(120000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ hubId: hubSecurityState.hubId, ...issued }));
    }

    if (req.method === 'POST' && req.url === '/local-admin/approve-pair') {
      const body = await readJsonBody(req);
      const pending = pendingPairRequests.get(String(body.deviceId || ''));
      if (!pending) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Pending pairing request not found or expired' }));
      }
      approveDevicePairing(pending.ws, pending);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, deviceId: pending.deviceId }));
    }

    if (req.method === 'POST' && req.url === '/local-admin/reject-pair') {
      const body = await readJsonBody(req);
      const pending = pendingPairRequests.get(String(body.deviceId || ''));
      if (pending) {
        try {
          if (pending.ws && pending.ws.readyState === WebSocket.OPEN) {
            pending.ws.send(JSON.stringify({
              type: 'PAIR_REJECTED',
              action: 'PAIR_REJECTED',
              reason: String(body.reason || 'Pairing rejected on Local Hub.'),
            }));
          }
        } catch {}
        pendingPairRequests.delete(pending.deviceId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    if (req.method === 'POST' && req.url === '/local-admin/revoke-device') {
      const body = await readJsonBody(req);
      const targetId = String(body.deviceId || '').trim();
      if (targetId && hubSecurityState.pairedDevices[targetId]) {
        hubSecurityState.pairedDevices[targetId].revoked = true;
        saveHubSecurityState();
        wss.clients.forEach((client) => {
          if (client.pairedDeviceId === targetId && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({ type: 'AUTH_FAILED', reason: 'Device pairing was revoked on the Local Hub.' }));
              client.close(4003, 'Device revoked');
            } catch {}
          }
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, revokedDeviceId: targetId }));
    }

    if (req.method === 'POST' && req.url === '/local-admin/broadcast-updating') {
      const body = await readJsonBody(req);
      const notice = JSON.stringify({
        type: 'HUB_UPDATING',
        action: 'HUB_UPDATING',
        targetVersion: String(body.targetVersion || ''),
        etaSeconds: Number(body.etaSeconds || 6),
        timestamp: Date.now(),
      });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(notice); } catch {}
        }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// =====================================================================
// CASH LOG SEMANTIC DEDUPLICATION HELPERS
// =====================================================================

function getHubCashLogRef(log) {
  if (!log || typeof log !== 'object') return '';
  const direct = String(log.reference || log.Reference || '').trim();
  if (direct) return direct;
  const text = `${log.description || log.Description || ''} ${log.notes || ''}`;
  const m = text.match(/#([A-Za-z0-9_-]+)/);
  return m && m[1] ? m[1].trim() : '';
}

function getHubCashLogSemanticKey(log) {
  const ref = getHubCashLogRef(log).toUpperCase();
  if (!ref) return null;
  const idStr = String(log.id || log.cashLogId || '').toUpperCase();
  const line = String(log.line || log.Line || '').toLowerCase();
  const cat = String(log.category || '').toLowerCase();
  const desc = String(log.description || log.Description || '').toLowerCase();
  const cur = String(log.currency || '').toLowerCase();
  const comp = String(log.company_id || log.companyId || 'COMP-001').trim().toUpperCase();
  const br = String(log.branch_id || log.branchId || 'BR-MAIN').trim().toUpperCase();

  if (idStr.startsWith('CL-REF-') || cat === 'refund' || line.includes('refund') || desc.includes('cash refund')) {
    return `${comp}::${br}::REF::${ref}`;
  }
  if (idStr.startsWith('CL-VOID-') || line.includes('void') || desc.includes('cash reversal for voided')) {
    return `${comp}::${br}::VOID::${ref}`;
  }
  if (idStr.startsWith('CL-CSH-') || line.includes('cash sale')) {
    return `${comp}::${br}::CSH::${ref}`;
  }
  if (idStr.startsWith('CL-CRDEP-') || line.includes('credit deposit')) {
    return `${comp}::${br}::CRDEP::${ref}`;
  }

  const isW =
    idStr.startsWith('CL-WDR-') ||
    log.isWithdrawal === true ||
    log.isWithdrawal === 'true' ||
    line.includes('withdrawal') ||
    cat.includes('withdrawal') ||
    desc.includes('withdrawal') ||
    desc.includes('cash-out');
  let curBucket = '';
  if (cur.includes('eco') || line.includes('eco') || cat.includes('eco') || desc.includes('ecocash')) {
    curBucket = 'ECOCASH';
  } else if (cur.includes('zig') || line.includes('zig') || cat.includes('zig') || desc.includes('zig')) {
    curBucket = 'ZIG';
  } else {
    const rawCur = String(log.currency || '').trim().toUpperCase();
    if (rawCur && rawCur !== 'USD') curBucket = rawCur;
  }
  if (!curBucket && !isW) return null;
  return `${comp}::${br}::${isW ? 'WDR' : 'NCSALE'}::${ref}::${curBucket || 'FX'}`;
}

function deduplicateHubCashLogs(logs) {
  if (!Array.isArray(logs)) return [];
  const score = (l) => {
    let s = 0;
    const id = String(l?.id || l?.cashLogId || '');
    if (
      id.startsWith('CL-WDR-') ||
      id.startsWith('CL-SALE-') ||
      id.startsWith('CL-CSH-') ||
      id.startsWith('CL-CRDEP-') ||
      id.startsWith('CL-REF-') ||
      id.startsWith('CL-VOID-')
    ) {
      s += 100;
    }
    if (l?.isRefunded || l?.isVoided || l?.isFlaggedMobileReversal) s += 25;
    if (l?.reference || l?.Reference) s += 10;
    if (l?.currency) s += 5;
    if (typeof l?.isWithdrawal === 'boolean') s += 5;
    return s;
  };
  const out = [];
  const byId = new Map();
  const bySem = new Map();
  for (const item of logs) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || item.cashLogId || '').trim();
    const sem = getHubCashLogSemanticKey(item);
    if (id && byId.has(id)) {
      const idx = byId.get(id);
      if (score(item) >= score(out[idx])) out[idx] = { ...out[idx], ...item };
      continue;
    }
    if (sem && bySem.has(sem)) {
      const idx = bySem.get(sem);
      if (score(item) >= score(out[idx])) {
        out[idx] = { ...out[idx], ...item };
        if (id) byId.set(id, idx);
      }
      continue;
    }
    const idx = out.length;
    out.push(item);
    if (id) byId.set(id, idx);
    if (sem) bySem.set(sem, idx);
  }
  return out;
}

function stripHubStockMovementDupSuffix(id) {
  return String(id || '').trim().replace(/(?:-dup-\d+-\d{4})+$/gi, '');
}

function deduplicateHubStockMovements(movements) {
  if (!Array.isArray(movements)) return [];
  const out = [];
  const seenExactIds = new Set();
  const seenBaseItemKeys = new Set();
  for (const item of movements) {
    if (!item || typeof item !== 'object') continue;
    const rawId = String(item.id || item.movementId || item.txnId || '').trim();
    if (!rawId) continue;
    const baseId = stripHubStockMovementDupSuffix(rawId);
    const itemId = String(item.itemId || '').trim();
    const isDupId = rawId !== baseId;
    const baseItemKey = `${baseId}::${itemId}`;
    if (seenExactIds.has(rawId) || (isDupId && seenBaseItemKeys.has(baseItemKey))) {
      continue;
    }
    let finalId = rawId;
    if (isDupId && !seenExactIds.has(baseId) && !movements.some((other) => {
      const oId = String(other?.id || other?.movementId || other?.txnId || '').trim();
      return oId === baseId;
    })) {
      finalId = baseId;
    }
    seenExactIds.add(rawId);
    seenExactIds.add(finalId);
    seenBaseItemKeys.add(baseItemKey);
    out.push({
      ...item,
      id: item.id || finalId,
      movementId: (item.movementId && !isDupId ? item.movementId : finalId),
      txnId: (item.txnId && !isDupId ? item.txnId : finalId),
    });
  }
  return out;
}

function upsertHubCashLog(rawLog, incomingCloudSynced = false) {
  if (!rawLog || typeof rawLog !== 'object') return null;
  const log = {
    ...rawLog,
    id: rawLog.id || rawLog.cashLogId,
    timestamp: rawLog.timestamp ?? rawLog.Timestamp,
    date: rawLog.date ?? rawLog.Date,
    staffId: rawLog.staffId ?? rawLog.StaffID,
    staffName: rawLog.staffName ?? rawLog.StaffName,
    line: rawLog.line ?? rawLog.Line,
    description: rawLog.description ?? rawLog.Description,
    in: rawLog.in !== undefined ? rawLog.in : rawLog.In,
    out: rawLog.out !== undefined ? rawLog.out : rawLog.Out,
    reference: rawLog.reference ?? rawLog.Reference ?? (getHubCashLogRef(rawLog) || undefined),
  };
  const logId = log.id;
  const semKey = getHubCashLogSemanticKey(log);
  if (!logId && !semKey) return null;

  const exByIdIdx = logId ? cashLogsStore.findIndex((l) => l.id === logId || l.cashLogId === logId) : -1;
  const exBySemIdx = semKey ? cashLogsStore.findIndex((l) => getHubCashLogSemanticKey(l) === semKey) : -1;
  const exIdx = exByIdIdx >= 0 ? exByIdIdx : exBySemIdx;
  const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && cashLogsStore[exIdx].isCloudSynced === true);
  if (exIdx >= 0) {
    cashLogsStore[exIdx] = {
      ...cashLogsStore[exIdx],
      ...log,
      id: cashLogsStore[exIdx].id || logId,
      ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
    };
  } else if (logId) {
    cashLogsStore.unshift({ ...log, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
    console.log(`[Termux Hub] 📥 Accepted Cash Log [${log.line || logId}] (Append-Only)`);
  }
  return logId || semKey;
}

// =====================================================================
// UNIVERSAL TOMBSTONE RESURRECTION GUARD HELPERS
// =====================================================================

function normalizeHubEntityType(rawType) {
  const norm = String(rawType || '').trim().toLowerCase();
  if (norm === 'inventory' || norm === 'inventory_item' || norm === 'inventory_items' || norm === 'inventorymaster' || norm === 'product' || norm === 'products') {
    return 'inventory_item';
  }
  if (norm === 'customer' || norm === 'customers') return 'customer';
  if (norm === 'staff' || norm === 'salesperson' || norm === 'salespeople' || norm === 'user' || norm === 'users') return 'staff';
  if (norm === 'supplier' || norm === 'suppliers') return 'supplier';
  if (norm === 'branch' || norm === 'branches') return 'branch';
  if (norm === 'category' || norm === 'categories' || norm === 'inventory_category') return 'inventory_category';
  if (norm === 'cash_account' || norm === 'cash_accounts' || norm === 'cashaccounts') return 'cash_account';
  if (norm === 'credit_group' || norm === 'credit_groups' || norm === 'creditgroups') return 'credit_group';
  if (norm === 'casual_worker' || norm === 'casual_workers' || norm === 'casualworkers') return 'casual_worker';
  if (norm === 'stocktake_session' || norm === 'stocktake_sessions' || norm === 'stocktakesessions') return 'stocktake_session';
  return norm;
}

function isHubT2EntityType(rawType) {
  const n = normalizeHubEntityType(rawType);
  if (
    [
      'inventory_item',
      'customer',
      'staff',
      'supplier',
      'branch',
      'inventory_category',
      'cash_account',
      'credit_group',
      'casual_worker',
      'stocktake_session',
    ].includes(n)
  ) {
    return true;
  }
  const canon = mapHubEntityToCanonicalType(rawType);
  return Array.isArray(hubRuntimePolicy.t2EntityTypes) && (hubRuntimePolicy.t2EntityTypes.includes(n) || hubRuntimePolicy.t2EntityTypes.includes(canon));
}

function getTombstoneRecordId(rec, norm) {
  if (!rec) return '';
  if (typeof rec === 'string' || typeof rec === 'number') return String(rec).trim();
  const n = normalizeHubEntityType(norm);
  if (n === 'inventory_item') return String(rec.itemId || rec.ItemID || rec.id || '').trim();
  if (n === 'customer') return String(rec.customerId || rec.id || '').trim();
  if (n === 'staff') return String(rec.id || rec.staffId || '').trim();
  if (n === 'supplier') return String(rec.supplierId || rec.SupplierID || rec.id || '').trim();
  if (n === 'branch') return String(rec.branchId || rec.branch_id || rec.id || '').trim();
  if (n === 'inventory_category') return String(rec.categoryId || rec.id || rec.categoryName || rec.name || '').trim();
  if (n === 'cash_account') return String(rec.account_id || rec.id || '').trim();
  if (n === 'credit_group') return String(rec.groupId || rec.id || '').trim();
  if (n === 'casual_worker') return String(rec.id || rec.pin_hash || '').trim();
  if (n === 'stocktake_session') return String(rec.sessionId || rec.id || '').trim();
  return String(getEntityId(rec, norm) || rec._entityId || rec.id || '').trim();
}

function isCatalogTombstoneType(rawType) {
  const n = normalizeHubEntityType(rawType);
  if (
    [
      'inventory_item',
      'customer',
      'staff',
      'supplier',
      'branch',
      'inventory_category',
      'credit_group',
      'casual_worker',
    ].includes(n)
  ) {
    return true;
  }
  return isHubGlobalBranchEntityType(n) || isHubGlobalBranchEntityType(mapHubEntityToCanonicalType(rawType));
}

function findHubTombstone(entityId, entityType) {
  const cleanId = String(entityId || '').trim().toUpperCase();
  if (!cleanId) return null;
  const cleanType = entityType ? normalizeHubEntityType(entityType) : '';
  let newest = null;
  let newestTs = -1;
  for (const t of tombstonesStore) {
    if (!t || !t.entityId) continue;
    if (String(t.entityId).trim().toUpperCase() !== cleanId) continue;
    if (cleanType && normalizeHubEntityType(t.entityType) !== cleanType) continue;
    const ts = Number(t.deletedAt) || getTimestamp(t) || 0;
    if (ts >= newestTs) {
      newestTs = ts;
      newest = t;
    }
  }
  return newest;
}

function isTombstoned(entityId, entityType, incomingTs) {
  const tomb = findHubTombstone(entityId, entityType);
  if (!tomb) return false;
  const deletedAt = Number(tomb.deletedAt) || getTimestamp(tomb) || 0;
  if (incomingTs === undefined || incomingTs === null) return true;
  const recTs = Number(incomingTs) || 0;
  if (recTs <= 0) return true;
  return deletedAt > recTs;
}

function purgeEntityFromHubStores(entityType, entityId, tombstoneDeletedAt) {
  const cleanUpper = String(entityId || '').trim().toUpperCase();
  if (!cleanUpper) return false;
  const norm = normalizeHubEntityType(entityType);
  let purged = false;

  const removeFrom = (arr, idFn) => {
    const before = arr.length;
    const kept = arr.filter((item) => {
      if (!item) return false;
      const candidate = String(idFn(item) || '').trim().toUpperCase();
      if (candidate !== cleanUpper) return true;
      if (tombstoneDeletedAt !== undefined) {
        const itemTs = getTimestamp(item);
        // Allow up to 120s clock skew between deleting client and Hub-stamped item
        if (itemTs > tombstoneDeletedAt + 120000) return true;
      }
      return false;
    });
    if (kept.length !== before) purged = true;
    return kept;
  };

  if (!norm || norm === 'inventory_item') {
    inventoryStore = removeFrom(inventoryStore, (i) => i.itemId || i.ItemID || i.id);
  }
  if (!norm || norm === 'customer') {
    customersStore = removeFrom(customersStore, (c) => c.customerId || c.id);
  }
  if (!norm || norm === 'staff') {
    salespeopleStore = removeFrom(salespeopleStore, (s) => s.id || s.staffId);
  }
  if (!norm || norm === 'supplier') {
    suppliersStore = removeFrom(suppliersStore, (s) => s.supplierId || s.SupplierID || s.id);
  }
  if (!norm || norm === 'branch') {
    branchesStore = removeFrom(branchesStore, (b) => b.branchId || b.branch_id || b.id);
  }
  if (!norm || norm === 'inventory_category') {
    categoriesStore = removeFrom(categoriesStore, (c) => c.categoryId || c.id || c.categoryName);
  }
  if (!norm || norm === 'cash_account') {
    cashAccountsStore = removeFrom(cashAccountsStore, (a) => a.account_id || a.id);
  }
  if (!norm || norm === 'credit_group') {
    creditGroupsStore = removeFrom(creditGroupsStore, (g) => g.groupId || g.id);
  }
  if (!norm || norm === 'casual_worker') {
    casualWorkersStore = removeFrom(casualWorkersStore, (w) => w.id || w.pin_hash);
  }
  if (!norm || norm === 'stocktake_session') {
    stocktakeSessionsStore = removeFrom(stocktakeSessionsStore, (s) => s.sessionId || s.id);
    // Also cascade-purge orphaned segments & zone assignments belonging to the deleted session
    const segBefore = stocktakeSegmentsStore.length;
    stocktakeSegmentsStore = stocktakeSegmentsStore.filter(
      (seg) => !seg || String(seg.sessionId || '').trim().toUpperCase() !== cleanUpper
    );
    if (stocktakeSegmentsStore.length !== segBefore) purged = true;

    const zoneBefore = zoneAssignmentsStore.length;
    zoneAssignmentsStore = zoneAssignmentsStore.filter(
      (z) => !z || String(z.sessionId || '').trim().toUpperCase() !== cleanUpper
    );
    if (zoneAssignmentsStore.length !== zoneBefore) purged = true;

    // Release branch lockdown ONLY if locked by this deleted session
    if (branchLockdownsStore && typeof branchLockdownsStore === 'object') {
      const releaseNow = Date.now();
      const releaseIso = new Date(releaseNow).toISOString();
      for (const brKey of Object.keys(branchLockdownsStore)) {
        const lk = branchLockdownsStore[brKey];
        if (lk && lk.isLocked && String(lk.sessionId || '').trim().toUpperCase() === cleanUpper) {
          const unlockedState = {
            ...lk,
            branchId: lk.branchId || brKey,
            isLocked: false,
            lockedAt: undefined,
            reason: `Auto-released: stocktake session ${cleanUpper} was deleted`,
            updatedAt: releaseNow,
            lastUpdated: releaseIso,
            isCloudSynced: false,
          };
          branchLockdownsStore[brKey] = unlockedState;
          purged = true;
          try {
            if (typeof wss !== 'undefined' && wss && wss.clients) {
              const unlockMsg = JSON.stringify({
                type: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                action: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                ...unlockedState,
                origin_device_id: 'LOCAL_HUB',
                timestamp: releaseNow,
              });
              wss.clients.forEach((client) => {
                if (client && client.readyState === WebSocket.OPEN) {
                  try { client.send(unlockMsg); } catch (e) {}
                }
              });
            }
          } catch (e) {}
        }
      }
    }
  }

  // Additive tombstone purge for schema-agnostic genericEntitiesStore buckets (future & generic entities)
  if (genericEntitiesStore && typeof genericEntitiesStore === 'object') {
    const canonGen = entityType ? mapHubEntityToCanonicalType(entityType) : '';
    const targetBuckets = !norm
      ? Object.keys(genericEntitiesStore)
      : Array.from(new Set([norm, canonGen].filter(Boolean)));
    for (const bKey of targetBuckets) {
      const bucket = genericEntitiesStore[bKey];
      if (!bucket || typeof bucket !== 'object') continue;
      for (const recKey of Object.keys(bucket)) {
        const rec = bucket[recKey];
        if (!rec) continue;
        const candidateId = String(rec._entityId || rec.id || recKey || '').trim().toUpperCase();
        if (candidateId !== cleanUpper && String(recKey).trim().toUpperCase() !== cleanUpper) continue;
        if (tombstoneDeletedAt !== undefined) {
          const itemTs = Number(rec._updatedAt || getTimestamp(rec)) || 0;
          if (itemTs > tombstoneDeletedAt + 120000) continue;
        }
        delete bucket[recKey];
        purged = true;
      }
    }
  }

  return purged;
}

function recordAndPurgeHubTombstone(entityType, entityId, deletedAt, extra = {}) {
  const cleanId = String(entityId || '').trim();
  const normType = normalizeHubEntityType(entityType);
  if (!cleanId || !normType) return null;
  const now = Date.now();
  const ts = Number(deletedAt) || now;
  const tId = extra.id || `TOMB-${normType}-${cleanId}`;
  const exIdx = tombstonesStore.findIndex(
    (t) =>
      t &&
      (t.id === tId ||
        (normalizeHubEntityType(t.entityType) === normType &&
          String(t.entityId || '').trim().toUpperCase() === cleanId.toUpperCase()))
  );
  const existingTs = exIdx >= 0 ? Number(tombstonesStore[exIdx].deletedAt) || 0 : 0;
  const finalTs = Math.max(ts, existingTs);
  const stampedTomb = {
    ...extra,
    id: tId,
    entityType: normType,
    entityId: cleanId,
    isDeleted: true,
    deletedAt: finalTs,
    updatedAt: finalTs,
    hubTimestamp: now,
  };
  if (exIdx >= 0) {
    tombstonesStore[exIdx] = stampedTomb;
  } else {
    tombstonesStore.unshift(stampedTomb);
  }
  purgeEntityFromHubStores(normType, cleanId, finalTs);
  return stampedTomb;
}

// =====================================================================
// AUTOMATED RECONCILIATION ENGINE HELPERS (PHASE 2)
// =====================================================================

function getStoreByEntityType(norm) {
  switch (norm) {
    case 'sales':
    case 'sale':
      return salesStore;
    case 'customer_changes':
    case 'customer_change':
      return customerChangesStore;
    case 'credit_sales':
    case 'credit_sale':
      return creditSalesStore;
    case 'cash_logs':
    case 'cash_log':
      return cashLogsStore;
    case 'stock_movements':
    case 'stock_movement':
      return stockMovementsStore;
    case 'direct_grvs':
    case 'direct_grv':
    case 'grv':
      return directGrvsStore;
    case 'expenses':
    case 'expense':
      return expensesStore;
    case 'inventory':
    case 'inventory_item':
    case 'products':
      return inventoryStore;
    case 'customers':
    case 'customer':
      return customersStore;
    case 'staff':
    case 'salespeople':
    case 'users':
      return salespeopleStore;
    case 'suppliers':
    case 'supplier':
      return suppliersStore;
    case 'branches':
    case 'branch':
      return branchesStore;
    case 'cash_accounts':
    case 'cash_account':
      return cashAccountsStore;
    case 'tombstones':
    case 'tombstone':
      return tombstonesStore;
    case 'categories':
    case 'category':
    case 'inventory_category':
      return categoriesStore;
    default: {
      if (genericEntitiesStore && typeof genericEntitiesStore === 'object') {
        const directBucket = genericEntitiesStore[norm];
        if (directBucket && typeof directBucket === 'object') return Object.values(directBucket);
        const canonKey = mapHubEntityToCanonicalType(norm);
        const canonBucket = canonKey ? genericEntitiesStore[canonKey] : null;
        if (canonBucket && typeof canonBucket === 'object') return Object.values(canonBucket);
      }
      return [];
    }
  }
}

function getEntityId(rec, norm) {
  if (!rec) return null;
  switch (norm) {
    case 'sales':
    case 'sale':
      return rec.id || rec.invoice_id || rec.invoiceId;
    case 'customer_changes':
    case 'customer_change':
      return rec.id || rec.changeId;
    case 'credit_sales':
    case 'credit_sale':
      return rec.id || rec.creditId;
    case 'cash_logs':
    case 'cash_log':
      return rec.id || (rec.date && rec.timestamp ? `${rec.date}_${rec.timestamp}` : null);
    case 'stock_movements':
    case 'stock_movement':
      return rec.id || rec.txnId || rec.movementId;
    case 'direct_grvs':
    case 'direct_grv':
    case 'grv':
      return rec.id || rec.grvId || rec.reference;
    case 'expenses':
    case 'expense':
      return rec.id;
    case 'inventory':
    case 'inventory_item':
    case 'products':
      return rec.itemId || rec.id;
    case 'customers':
    case 'customer':
      return rec.customerId || rec.id;
    case 'staff':
    case 'salespeople':
    case 'users':
      return rec.id;
    case 'suppliers':
    case 'supplier':
      return rec.supplierId || rec.SupplierID || rec.id;
    case 'branches':
    case 'branch':
      return canonicalizeHubBranchId(rec.branchId || rec.branch_id || rec.BranchID || rec.id);
    case 'cash_accounts':
    case 'cash_account':
      return rec.account_id || rec.id;
    case 'tombstones':
    case 'tombstone':
      return rec.entityId || rec.id;
    case 'categories':
    case 'category':
    case 'inventory_category':
      return rec.categoryId || rec.id || rec.categoryName;
    default:
      return rec._entityId || rec.id || rec.entityId || null;
  }
}

function getRecordTimestamp(rec) {
  if (!rec) return 0;
  const val = rec.updatedAt || rec.lastUpdated || rec.hubTimestamp || rec.deletedAt || rec.timestamp || rec.date || rec.createdAt;
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

function getRecordTotal(rec, norm) {
  if (!rec) return 0;
  switch (norm) {
    case 'sales':
    case 'sale':
      return rec.status === 'Voided' || rec.status === 'Refunded' ? 0 : (Number(rec.total) || 0);
    case 'customer_changes':
    case 'customer_change':
      return (Number(rec.in) || 0) - (Number(rec.out) || 0);
    case 'credit_sales':
    case 'credit_sale':
      return (Number(rec.out ?? rec.amount) || 0) - (Number(rec.in) || 0);
    case 'cash_logs':
    case 'cash_log':
      return (Number(rec.in) || 0) - (Number(rec.out) || 0);
    case 'stock_movements':
    case 'stock_movement':
      return Number(rec.quantity || rec.qty) || 0;
    case 'direct_grvs':
    case 'direct_grv':
    case 'grv':
      return Number(rec.totalAmount || rec.total) || 0;
    case 'expenses':
    case 'expense':
      return Number(rec.amount) || 0;
    case 'inventory':
    case 'inventory_item':
    case 'products':
      return Number(rec.totalUnits || rec.stockSingles) || 0;
    case 'customers':
    case 'customer':
      return Number(rec.creditLimit) || 0;
    case 'cash_accounts':
    case 'cash_account':
      return Number(rec.balance ?? rec.current_balance) || 0;
    case 'tombstones':
    case 'tombstone':
      return 0;
    default:
      return Number(rec.total ?? rec.totalAmount ?? rec.amount ?? rec.points ?? 0) || 0;
  }
}

// Generic Local Query API helper (supports BOTH dedicated stores and genericEntitiesStore without APK rebuilds)
function queryHubEntities(queryOpts = {}) {
  const rawType = String(queryOpts.entityType || queryOpts.entity || '').trim().toLowerCase();
  if (!rawType) {
    return { entityType: '', records: [], count: 0, totalMatched: 0, truncated: false };
  }
  const canonType = mapHubEntityToCanonicalType(rawType);
  const reqComp = String(queryOpts.companyId || queryOpts.company_id || hubTenantId || 'COMP-001').trim().toUpperCase();
  const reqBranchRaw = String(queryOpts.branchId || queryOpts.branch_id || queryOpts.branchCode || 'ALL').trim().toUpperCase();
  const reqBranch = reqBranchRaw || 'ALL';
  const dateFromMs = queryOpts.dateFrom ? (typeof queryOpts.dateFrom === 'number' ? queryOpts.dateFrom : new Date(queryOpts.dateFrom).getTime()) : 0;
  const dateToMs = queryOpts.dateTo ? (typeof queryOpts.dateTo === 'number' ? queryOpts.dateTo : new Date(queryOpts.dateTo).getTime()) : Infinity;
  const filterStatus = queryOpts.status ? String(queryOpts.status).trim().toLowerCase() : '';
  const limitNum = Math.min(1000, Math.max(1, Number(queryOpts.limit) || 200));

  const getStoreForQuery = () => {
    const primary = getStoreByEntityType(rawType);
    if (primary.length > 0) return primary;
    const byCanon = getStoreByEntityType(canonType);
    if (byCanon.length > 0) return byCanon;
    switch (canonType) {
      case 'cash_lift': return cashLiftsStore;
      case 'cash_movement': return cashMovementsStore;
      case 'cash_transfer': return cashTransfersStore;
      case 'cash_account': return cashAccountsStore;
      case 'credit_group': return creditGroupsStore;
      case 'internal_consumption': return internalConsumptionsStore;
      case 'admin_sale': return adminSalesStore;
      case 'cash_count': return cashCountsStore;
      case 'supplier_invoice_voucher': return vouchersStore;
      case 'business_day_closure': return businessDayClosuresStore;
      case 'electronic_settlement': return electronicSettlementsStore;
      case 'casual_worker': return casualWorkersStore;
      case 'stocktake_session': return stocktakeSessionsStore;
      case 'stocktake_segment': return stocktakeSegmentsStore;
      case 'stocktake_zone_assignment': return zoneAssignmentsStore;
      default: return [];
    }
  };

  const sourceList = getStoreForQuery();
  const isGlobal = isHubGlobalBranchEntityType(canonType) || isHubGlobalBranchEntityType(rawType);
  const isT2 = isHubT2EntityType(canonType) || isCanonicalT2Type(canonType);

  const matched = [];
  for (const rec of sourceList) {
    if (!rec || typeof rec !== 'object') continue;
    const recComp = String(rec.companyId || rec.company_id || hubTenantId || 'COMP-001').trim().toUpperCase();
    if (reqComp !== 'ALL' && recComp !== reqComp) continue;
    if (!isGlobal && reqBranch !== 'ALL') {
      const recBranch = String(rec.branchId || rec.branch_id || rec.branchCode || hubBranchId || '').trim().toUpperCase();
      if (recBranch && recBranch !== 'ALL' && recBranch !== reqBranch) continue;
    }
    const id = getEntityId(rec, canonType) || rec._entityId || rec.id;
    const recTs = getRecordTimestamp(rec);
    if (isT2 && id && isTombstoned(id, canonType, recTs)) continue;
    if (dateFromMs > 0 && Number.isFinite(dateFromMs) && recTs > 0 && recTs < dateFromMs) continue;
    if (Number.isFinite(dateToMs) && recTs > 0 && recTs > dateToMs) continue;
    if (filterStatus && String(rec.status || '').trim().toLowerCase() !== filterStatus) continue;

    // Strip any sensitive credential fields defensively
    const safeRec = { ...rec };
    if ('pin' in safeRec) delete safeRec.pin;
    if ('rawPin' in safeRec) delete safeRec.rawPin;
    if ('password' in safeRec) delete safeRec.password;
    if ('passwordHash' in safeRec) delete safeRec.passwordHash;
    matched.push(safeRec);
  }

  matched.sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a));
  const totalMatched = matched.length;
  const sliced = matched.slice(0, limitNum);
  return {
    entityType: canonType,
    records: sliced,
    count: sliced.length,
    totalMatched,
    truncated: totalMatched > sliced.length,
  };
}

function computeIdsChecksum(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return '00000000';
  const sorted = [...ids].sort();
  let hash = 0x811c9dc5;
  for (const id of sorted) {
    const str = String(id);
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 124; // '|'
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function computeHubSnapshot(entityType, startDate, endDate) {
  const norm = String(entityType || '').toLowerCase().trim();
  const startTime = startDate ? new Date(startDate).getTime() : 0;
  const endTime = endDate ? new Date(endDate).getTime() : Infinity;
  const inRange = (t) => {
    if (!t || isNaN(t) || t <= 0) return true;
    return t >= startTime && t <= endTime;
  };

  const store = getStoreByEntityType(norm);
  let count = 0;
  let totalSum = 0;
  const ids = [];

  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    const t = getRecordTimestamp(rec);
    if (isHubT2EntityType(norm) && isTombstoned(id, norm, t)) continue;
    if (inRange(t)) {
      count++;
      totalSum += getRecordTotal(rec, norm);
      ids.push(String(id));
    }
  }

  const idHash = computeIdsChecksum(ids);

  return {
    entityType: norm,
    startDate,
    endDate,
    count,
    totalSum: Number(totalSum.toFixed(2)),
    idHash,
    generatedAt: Date.now(),
  };
}

function computeHubDigest(entityType, startDate, endDate) {
  const norm = String(entityType || '').toLowerCase().trim();
  const startTime = startDate ? new Date(startDate).getTime() : 0;
  const endTime = endDate ? new Date(endDate).getTime() : Infinity;
  const inRange = (t) => {
    if (!t || isNaN(t) || t <= 0) return true;
    return t >= startTime && t <= endTime;
  };

  const items = [];
  let totalSum = 0;
  const store = getStoreByEntityType(norm);

  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    const t = getRecordTimestamp(rec);
    if (isHubT2EntityType(norm) && isTombstoned(id, norm, t)) continue;
    if (inRange(t)) {
      const total = getRecordTotal(rec, norm);
      totalSum += total;
      items.push({
        id: String(id),
        total,
        status: rec.status,
        timestamp: t,
        updatedAt: (rec.updatedAt || rec.lastUpdated) ? getRecordTimestamp(rec) : undefined,
      });
    }
  }

  return {
    entityType: norm,
    startDate,
    endDate,
    items,
    count: items.length,
    totalSum,
    generatedAt: Date.now(),
  };
}

function computeDigestDiff(clientDigest, entityType) {
  if (!clientDigest || !Array.isArray(clientDigest.items)) {
    return [];
  }
  const norm = String(entityType || clientDigest.entityType || '').toLowerCase().trim();
  const startTime = clientDigest.startDate ? new Date(clientDigest.startDate).getTime() : 0;
  const endTime = clientDigest.endDate ? new Date(clientDigest.endDate).getTime() : Infinity;

  const inRange = (t) => {
    if (!t || isNaN(t) || t <= 0) return true;
    return t >= startTime && t <= endTime;
  };

  const clientMap = new Map();
  for (const item of clientDigest.items) {
    if (item && item.id != null) {
      clientMap.set(String(item.id).trim(), item);
    }
  }

  const isT2 = isHubT2EntityType(norm);

  const store = getStoreByEntityType(norm);
  const missingOrOutdated = [];

  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    const cleanId = String(id).trim();
    const hubRecTime = getRecordTimestamp(rec);
    if (isT2 && isTombstoned(cleanId, norm, hubRecTime)) continue;

    if (!inRange(hubRecTime)) continue;

    const clientItem = clientMap.get(cleanId);

    if (!clientItem) {
      // Missing completely on client
      missingOrOutdated.push(rec);
    } else if (isT2) {
      // T2 LWW check with 60000ms threshold
      const hubUpdated = getRecordTimestamp(rec);
      const clientUpdated = clientItem.updatedAt || clientItem.timestamp || 0;
      if (hubUpdated - clientUpdated > 60000) {
        missingOrOutdated.push(rec);
      }
    } else if (norm === 'sales' || norm === 'sale') {
      // T1 check: status discrepancy (e.g. Voided/Refunded on Hub)
      if (rec.status && clientItem.status && rec.status !== clientItem.status) {
        missingOrOutdated.push(rec);
      }
    } else if (norm === 'customer_changes' || norm === 'customer_change' || norm === 'credit_sales' || norm === 'credit_sale') {
      // T1 check: colliding sequential ID with different amount (e.g. CHG-002 $56 vs $89)
      const hubTotal = getRecordTotal(rec, norm);
      const clientTotal = Number(clientItem.total) || 0;
      if (Math.abs(hubTotal - clientTotal) > 0.005) {
        missingOrOutdated.push(rec);
      }
    } else if (
      norm === 'expenses' ||
      norm === 'expense' ||
      norm === 'direct_grvs' ||
      norm === 'direct_grv' ||
      norm === 'grv' ||
      norm === 'internal_consumptions' ||
      norm === 'internal_consumption'
    ) {
      // T1 approval status discrepancy (e.g. APPROVED/REJECTED on Hub vs PENDING on client)
      if (rec.status && clientItem.status && String(rec.status).toLowerCase() !== String(clientItem.status).toLowerCase()) {
        missingOrOutdated.push(rec);
      }
    }
  }

  return missingOrOutdated;
}

function computeClientMissingOnHub(clientDigest, entityType) {
  if (!clientDigest || !Array.isArray(clientDigest.items)) {
    return [];
  }
  const norm = String(entityType || clientDigest.entityType || '').toLowerCase().trim();
  const isT2 = isHubT2EntityType(norm);

  const store = getStoreByEntityType(norm);
  const hubMap = new Map();
  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    if (isT2 && isTombstoned(id, norm, getRecordTimestamp(rec))) continue;
    hubMap.set(String(id).trim(), rec);
  }

  const missingOnHubIds = [];
  for (const item of clientDigest.items) {
    if (!item || item.id == null) continue;
    const cleanId = String(item.id).trim();
    const clientTs = item.updatedAt || item.timestamp || 0;
    if (isT2 && isTombstoned(cleanId, norm, clientTs)) continue;
    const hubRec = hubMap.get(cleanId);
    if (!hubRec) {
      missingOnHubIds.push(cleanId);
    } else if (isT2) {
      const hubUpdated = getRecordTimestamp(hubRec);
      const clientUpdated = clientTs;
      if (clientUpdated - hubUpdated > 60000) {
        missingOnHubIds.push(cleanId);
      }
    } else if (norm === 'sales' || norm === 'sale') {
      // Request push if client has Refunded/Voided while Hub still has Completed
      if (item.status && hubRec.status && item.status !== hubRec.status) {
        missingOnHubIds.push(cleanId);
      }
    } else if (norm === 'customer_changes' || norm === 'customer_change' || norm === 'credit_sales' || norm === 'credit_sale') {
      // Request push if client has colliding ID with different amount
      const hubTotal = getRecordTotal(hubRec, norm);
      const clientTotal = Number(item.total) || 0;
      if (Math.abs(hubTotal - clientTotal) > 0.005) {
        missingOnHubIds.push(cleanId);
      }
    } else if (
      norm === 'expenses' ||
      norm === 'expense' ||
      norm === 'direct_grvs' ||
      norm === 'direct_grv' ||
      norm === 'grv' ||
      norm === 'internal_consumptions' ||
      norm === 'internal_consumption'
    ) {
      if (item.status && hubRec.status && String(item.status).toLowerCase() !== String(hubRec.status).toLowerCase()) {
        missingOnHubIds.push(cleanId);
      }
    }
  }
  return missingOnHubIds;
}

function computeClientTombstonedItems(clientDigest, entityType) {
  if (!clientDigest || !Array.isArray(clientDigest.items)) {
    return [];
  }
  const norm = String(entityType || clientDigest.entityType || '').toLowerCase().trim();
  if (!isHubT2EntityType(norm)) {
    return [];
  }
  const canonicalType = normalizeHubEntityType(norm);
  const tombstonesToPush = [];
  const seen = new Set();
  for (const item of clientDigest.items) {
    if (!item || item.id == null) continue;
    const cleanId = String(item.id).trim();
    const clientTs = item.updatedAt || item.timestamp || 0;
    if (isTombstoned(cleanId, canonicalType, clientTs)) {
      const tomb = findHubTombstone(cleanId, canonicalType);
      if (tomb) {
        const key = `${canonicalType}::${cleanId.toUpperCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          tombstonesToPush.push(tomb);
        }
      }
    }
  }
  return tombstonesToPush;
}

function streamReconBackfill(ws, sweepId, entityType, missingRecords) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!missingRecords || missingRecords.length === 0) {
    console.log(`[Termux Hub] 🧹 No missing records found for "${entityType}" (sweep: ${sweepId}). In sync!`);
    return;
  }

  const CHUNK_SIZE = 25;
  const totalChunks = Math.ceil(missingRecords.length / CHUNK_SIZE);
  console.log(`[Termux Hub] 🚀 Streaming backfill for "${entityType}": ${missingRecords.length} records in ${totalChunks} chunk(s) (sweep: ${sweepId})`);

  let currentChunk = 0;
  function sendNextChunk() {
    if (ws.readyState !== WebSocket.OPEN || currentChunk >= totalChunks) {
      if (currentChunk >= totalChunks) {
        console.log(`[Termux Hub] ✅ Completed backfill streaming for "${entityType}" (sweep: ${sweepId})`);
      }
      return;
    }

    const start = currentChunk * CHUNK_SIZE;
    const chunkRecords = missingRecords.slice(start, start + CHUNK_SIZE);
    const packet = {
      type: 'RECON_BACKFILL_PAYLOAD',
      action: 'RECON_BACKFILL_PAYLOAD',
      sweepId,
      entityType,
      records: chunkRecords.map((r) => {
        if (typeof r === 'object' && r !== null) {
          return { ...r, hubTimestamp: Date.now() };
        }
        return r;
      }),
      chunkIndex: currentChunk,
      totalChunks,
      hubTimestamp: Date.now(),
      originDeviceId: `HUB-${hubBranchId}`,
      branchId: hubBranchId,
    };

    try {
      ws.send(JSON.stringify(packet));
    } catch (err) {
      console.warn(`[Termux Hub] Error sending backfill chunk ${currentChunk + 1}/${totalChunks}:`, err.message);
      return;
    }

    currentChunk++;
    if (currentChunk < totalChunks) {
      setTimeout(sendNextChunk, 15);
    } else {
      console.log(`[Termux Hub] ✅ Completed backfill streaming for "${entityType}" (sweep: ${sweepId})`);
    }
  }

  sendNextChunk();
}

function triggerClientReconSweep(clientWs, isSod = false) {
  if (!clientWs || clientWs.readyState !== WebSocket.OPEN) return;
  const sweepId = `sweep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const cold = isHubCold();
  const triggerPacket = {
    type: 'RECON_SWEEP_TRIGGER',
    sweepId,
    isColdHub: cold,
    pushChunkSize: 25,
    targetEntities: [
      'tombstones',
      'branches',
      'staff',
      'cash_accounts',
      'customers',
      'inventory',
      'sales',
      'customer_changes',
      'credit_sales',
      'cash_logs',
      'stock_movements',
      'direct_grvs',
      'expenses',
    ],
    isSod: Boolean(isSod),
    useSnapshotFirst: true,
    hubTimestamp: Date.now(),
    originDeviceId: `HUB-${hubBranchId}`,
  };
  try {
    clientWs.send(JSON.stringify(triggerPacket));
    console.log(`[Termux Hub] 🧹 Sent RECON_SWEEP_TRIGGER (${sweepId}${cold ? ' [COLD HUB]' : ''}${isSod ? ' [SOD]' : ''}) to POS terminal`);
  } catch (err) {
    console.warn('[Termux Hub] Failed to send RECON_SWEEP_TRIGGER:', err.message);
  }
}

function triggerAllClientsReconSweep() {
  console.log(`[Termux Hub] 🧹 Starting 30-min background reconciliation sweep across connected terminals...`);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      triggerClientReconSweep(client, false);
    }
  });
}

// Terminal connection and activity tracking for Start-of-Day (SOD) sweeps
const terminalLastActivity = new Map();

// WebSocket Server
const wss = new WebSocketServer({ server });

// Active 20s server-side keepalive to prevent silent Wi-Fi zombie sockets on Android
// Active 20s server-side keepalive + unauthenticated idle reaper
const UNAUTH_ALLOWED_OUTBOUND = new Set([
  'AUTH_CHALLENGE',
  'AUTH_OK',
  'AUTH_FAILED',
  'PAIR_PENDING',
  'PAIR_APPROVED',
  'PAIR_REJECTED',
  'HUB_INFO',
  'HUB_ROLE_STATUS',
  'PING',
  'PONG',
  'HUB_UPDATING',
  'HUB_UPDATE_STATUS',
]);

setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    // Drop unauthenticated sockets that stall (30s normal, 120s if actively waiting for Hub UI pairing approval)
    if (HUB_REQUIRE_AUTH && !client.isAuthenticated) {
      const limitMs = client.hasPendingPair ? 120000 : 30000;
      if (client.connectedAt && now - client.connectedAt > limitMs) {
        try {
          client.send(JSON.stringify({ type: 'AUTH_FAILED', reason: 'Authentication/pairing timeout.' }));
          client.close(4002, 'Auth timeout');
        } catch {}
        return;
      }
    }
    if (client.lastActivityAt && now - client.lastActivityAt > 50000) {
      try {
        client.terminate();
      } catch {}
      return;
    }
    try {
      client.send(JSON.stringify({ type: 'PING', ts: now }));
    } catch {}
  });
}, 20000);

wss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  console.log(`[Termux Hub] 🟢 POS Terminal connected from ${remoteIp} (AuthRequired=${HUB_REQUIRE_AUTH})`);

  let terminalDeviceId = null;
  ws.isAuthenticated = !HUB_REQUIRE_AUTH;
  ws.authNonce = crypto.randomBytes(32).toString('hex');
  ws.connectedAt = Date.now();
  ws.lastActivityAt = Date.now();
  ws.hasPendingPair = false;
  ws.pairedDeviceId = null;
  ws.pairedDeviceSecret = null;

  // Socket-level egress quarantine: prevents any broadcast loop from leaking business data before auth
  if (HUB_REQUIRE_AUTH) {
    const rawWsSend = ws.send.bind(ws);
    ws.send = (data, ...rest) => {
      if (!ws.isAuthenticated) {
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : null;
          const outType = String(parsed?.type || parsed?.action || '').toUpperCase();
          if (!UNAUTH_ALLOWED_OUTBOUND.has(outType)) {
            return;
          }
        } catch {
          return;
        }
      }
      return rawWsSend(data, ...rest);
    };
  }

  // Always send AUTH_CHALLENGE so paired clients authenticate mutually & Termux backup clients auto-detect optional mode
  try {
    ws.send(JSON.stringify({
      type: 'AUTH_CHALLENGE',
      action: 'AUTH_CHALLENGE',
      hubId: hubSecurityState.hubId,
      hub_id: hubSecurityState.hubId,
      branchId: hubBranchId,
      branch_id: hubBranchId,
      tenantId: hubTenantId,
      tenant_id: hubTenantId,
      nonce: ws.authNonce,
      timestamp: Date.now(),
      auth_required: HUB_REQUIRE_AUTH,
      version: HUB_VERSION,
      hub_runtime: HUB_RUNTIME,
      ota_slot: HUB_OTA_SLOT,
      mdnsHost: getHubMdnsHost(),
      lanIps: getHubLanIps(),
      port: PORT,
      ...getHubFailoverMeta(),
    }));
  } catch (e) {}

  // In open Termux backup mode, also send immediate HUB_GREETING for legacy compatibility
  if (!HUB_REQUIRE_AUTH) {
    try {
      const greeting = {
        type: 'HUB_GREETING',
        action: 'HUB_INFO',
        hubId: hubSecurityState.hubId,
        tenantId: hubTenantId,
        branchId: hubBranchId,
        hub_id: hubSecurityState.hubId,
        branch_id: hubBranchId,
        branch_name: hubBranchName,
        tenant_id: hubTenantId,
        version: HUB_VERSION,
        hub_runtime: HUB_RUNTIME,
        ota_slot: HUB_OTA_SLOT,
        auth_required: HUB_REQUIRE_AUTH,
        ...getHubFailoverMeta(),
        totalSales: salesStore.length,
        totalInventory: inventoryStore.length,
        lastCloudSyncTimestamp,
        message: `Connected to Saimetric Local Hub (${hubBranchName})`,
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(greeting));
    } catch (e) {}
  }

  // 3.5s delayed automatic background reconciliation sweep trigger upon authenticated connection
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN && ws.isAuthenticated) {
      if (terminalDeviceId) {
        const lastSeen = terminalLastActivity.get(terminalDeviceId) || 0;
        const gapMs = Date.now() - lastSeen;
        if (lastSeen > 0 && gapMs > 4 * 60 * 60 * 1000) {
          console.log(`[Termux Hub] 🌅 SOD (Start of Day) gap > 4h detected for terminal "${terminalDeviceId}" (${(gapMs / 3600000).toFixed(1)} hrs). Triggering SOD sweep!`);
          triggerClientReconSweep(ws, true);
          return;
        }
      }
      triggerClientReconSweep(ws, false);
    }
  }, 3500);

  ws.on('message', (message) => {
    try {
      ws.lastActivityAt = Date.now();
      const dataStr = message.toString();
      let packet;
      try {
        packet = JSON.parse(dataStr);
      } catch (err) {
        return;
      }

      if (!packet || typeof packet !== 'object') return;

      const pType = (packet.type || packet.action || '').toUpperCase();
      const payload = packet.payload || packet.data || packet.item;
      const sheetName = packet.sheetName || packet.sheet;
      const entityType = packet.entityType || packet.entity;

      // =====================================================================
      // KEEPALIVE PING / PONG
      // =====================================================================
      if (pType === 'PING' || pType === 'HEARTBEAT') {
        try {
          ws.send(JSON.stringify({ type: 'PONG', ts: packet.ts || Date.now() }));
        } catch {}
        return;
      }
      if (pType === 'PONG') {
        return;
      }

      // =====================================================================
      // ZERO-CAMERA PAIRING & MUTUAL HMAC AUTH HANDLERS
      // =====================================================================
      if (pType === 'PAIR_REQUEST') {
        if (isPairRateLimited(remoteIp)) {
          try {
            ws.send(JSON.stringify({
              type: 'PAIR_REJECTED',
              reason: 'Too many failed pairing attempts. Please wait 60 seconds and try again.',
            }));
          } catch {}
          return;
        }

        const reqDeviceId = String(packet.deviceId || '').trim();
        const reqDeviceName = String(packet.deviceName || 'POS Terminal').trim();
        const reqBranchId = String(packet.branchId || hubBranchId).trim();
        const reqTenantId = String(packet.tenantId || hubTenantId).trim();
        const reqPairCode = String(packet.pairCode || '').replace(/[^0-9A-Za-z]/g, '').trim();
        const reqClientNonce = String(packet.clientNonce || '').trim();

        if (!reqDeviceId) {
          try {
            ws.send(JSON.stringify({ type: 'PAIR_REJECTED', reason: 'Missing deviceId in PAIR_REQUEST.' }));
          } catch {}
          return;
        }

        // Path A: 6-digit single-use pairing code verification
        if (reqPairCode) {
          const now = Date.now();
          const hasValidCode =
            Boolean(hubSecurityState.activePairCode) &&
            hubSecurityState.pairCodeExpiresAt > now &&
            hubConstantTimeEqual(reqPairCode, hubSecurityState.activePairCode);

          if (!hasValidCode) {
            recordPairFailure(remoteIp);
            try {
              ws.send(JSON.stringify({
                type: 'PAIR_REJECTED',
                reason: 'Invalid or expired 6-digit pairing code. Generate a fresh code on the Hub.',
              }));
            } catch {}
            return;
          }

          // Consume single-use code immediately
          hubSecurityState.activePairCode = null;
          hubSecurityState.pairCodeExpiresAt = 0;
          approveDevicePairing(ws, {
            deviceId: reqDeviceId,
            deviceName: reqDeviceName,
            branchId: reqBranchId,
            tenantId: reqTenantId,
          });
          return;
        }

        // Path B: TV-Style / Desktop 1-Tap Approval on Hub UI (no camera or code needed)
        const confirmCode = computeHubVisualConfirmCode(hubSecurityState.hubId, reqDeviceId, reqClientNonce);
        pendingPairRequests.set(reqDeviceId, {
          ws,
          deviceId: reqDeviceId,
          deviceName: reqDeviceName,
          branchId: reqBranchId,
          tenantId: reqTenantId,
          confirmCode,
          createdAt: Date.now(),
        });

        emitHubIpcEvent({
          event: 'PAIR_APPROVAL_NEEDED',
          hubId: hubSecurityState.hubId,
          deviceId: reqDeviceId,
          deviceName: reqDeviceName,
          branchId: reqBranchId,
          confirmCode,
        });
        ws.hasPendingPair = true;
        console.log(`[Termux Hub] 🔐 PAIRING REQUEST from "${reqDeviceName}" (${reqDeviceId}) — Confirm Code: ${confirmCode}`);

        try {
          ws.send(JSON.stringify({
            type: 'PAIR_PENDING',
            action: 'PAIR_PENDING',
            hubId: hubSecurityState.hubId,
            hub_id: hubSecurityState.hubId,
            branchId: hubBranchId,
            branchName: hubBranchName,
            confirmCode,
            timestamp: Date.now(),
          }));
        } catch {}
        return;
      }

      if (pType === 'AUTH_RESPONSE') {
        const reqDeviceId = String(packet.deviceId || '').trim();
        const reqNonce = String(packet.nonce || '').trim();
        const reqClientNonce = String(packet.clientNonce || '').trim();
        const reqTs = Number(packet.timestamp || 0);
        const reqClientProof = String(packet.clientProof || '').trim();
        const deviceRec = hubSecurityState.pairedDevices[reqDeviceId];

        if (!deviceRec || deviceRec.revoked) {
          try {
            ws.send(JSON.stringify({
              type: 'AUTH_FAILED',
              reason: deviceRec?.revoked ? 'This device was revoked on the Local Hub.' : 'Unrecognized device. Pair this device first.',
            }));
            ws.close(4001, 'Unauthorized device');
          } catch {}
          return;
        }

        if (!ws.authNonce || !hubConstantTimeEqual(reqNonce, ws.authNonce)) {
          try {
            ws.send(JSON.stringify({ type: 'AUTH_FAILED', reason: 'Invalid or replayed auth nonce.' }));
            ws.close(4001, 'Invalid nonce');
          } catch {}
          return;
        }

        if (!Number.isFinite(reqTs) || Math.abs(Date.now() - reqTs) > 120000) {
          try {
            ws.send(JSON.stringify({ type: 'AUTH_FAILED', reason: 'Auth timestamp expired or clock drift exceeds 2 minutes.' }));
            ws.close(4001, 'Timestamp drift');
          } catch {}
          return;
        }

        const expectedClientProof = hubHmacSha256Hex(
          deviceRec.deviceSecret,
          `CLIENT:${reqNonce}:${hubSecurityState.hubId}:${reqDeviceId}:${reqTs}`
        );

        if (!hubConstantTimeEqual(reqClientProof, expectedClientProof)) {
          try {
            ws.send(JSON.stringify({ type: 'AUTH_FAILED', reason: 'Cryptographic client proof verification failed.' }));
            ws.close(4001, 'Invalid clientProof');
          } catch {}
          return;
        }

        // Mutual Proof: Hub proves its own identity over clientNonce so PWA rejects spoofed Hubs!
        const serverTime = Date.now();
        const hubProof = hubHmacSha256Hex(
          deviceRec.deviceSecret,
          `HUB:${reqClientNonce}:${hubSecurityState.hubId}:${hubBranchId}:${serverTime}`
        );

        ws.isAuthenticated = true;
        ws.pairedDeviceId = reqDeviceId;
        ws.pairedDeviceSecret = deviceRec.deviceSecret;
        ws.authNonce = ''; // Single-use nonce consumed
        deviceRec.lastSeenAt = serverTime;
        saveHubSecurityState();

        try {
          ws.send(JSON.stringify({
            type: 'AUTH_OK',
            action: 'AUTH_OK',
            hubId: hubSecurityState.hubId,
            hub_id: hubSecurityState.hubId,
            branchId: hubBranchId,
            branch_id: hubBranchId,
            branchName: hubBranchName,
            branch_name: hubBranchName,
            tenantId: hubTenantId,
            tenant_id: hubTenantId,
            version: HUB_VERSION,
            hub_runtime: HUB_RUNTIME,
            ota_slot: HUB_OTA_SLOT,
            mdnsHost: getHubMdnsHost(),
            lanIps: getHubLanIps(),
            port: PORT,
            ...getHubFailoverMeta(),
            serverTime,
            hubProof,
          }));
        } catch {}
        console.log(`[Termux Hub] ✅ Mutually authenticated terminal "${deviceRec.deviceName}" (${reqDeviceId})`);
        return;
      }

      // Quarantine guard: block all business packets until authenticated when HUB_REQUIRE_AUTH is active
      if (HUB_REQUIRE_AUTH && !ws.isAuthenticated && pType !== 'PING_HUB' && pType !== 'PING_IDENTITY') {
        try {
          ws.send(JSON.stringify({
            type: 'AUTH_FAILED',
            reason: 'Authentication required. Complete mutual handshake or pair this terminal first.',
          }));
        } catch {}
        return;
      }

      // Cloud OTA check hook (forwarded to Android Native Shell via IPC)
      if (pType === 'CHECK_HUB_UPDATE') {
        emitHubIpcEvent({
          event: 'CHECK_HUB_UPDATE',
          requestedBy: packet.deviceId || ws.pairedDeviceId || 'UNKNOWN',
          timestamp: Date.now(),
        });
        if (HUB_RUNTIME !== 'ANDROID_APK') {
          try {
            ws.send(JSON.stringify({
              type: 'HUB_UPDATE_STATUS',
              action: 'HUB_UPDATE_STATUS',
              status: 'TERMUX_MANUAL',
              message: `Running Termux Backup Hub v${HUB_VERSION}. Signed Cloud OTA applies to the Android Hub APK.`,
              timestamp: Date.now(),
            }));
          } catch {}
        }
        return;
      }

      if (packet.cloudSyncUrl || packet.cloudUrl) {
        cloudSyncUrl = packet.cloudSyncUrl || packet.cloudUrl;
      }

      const devId = packet.deviceId || packet.origin_device_id || packet.originDeviceId;
      if (devId) {
        terminalDeviceId = devId;
        terminalLastActivity.set(devId, Date.now());
      }

      if (packet.supabaseUrl) supabaseUrl = packet.supabaseUrl;
      if (packet.supabaseKey) supabaseKey = packet.supabaseKey;
      if (packet.cloudConfig) {
        if (packet.cloudConfig.supabaseUrl) supabaseUrl = packet.cloudConfig.supabaseUrl;
        if (packet.cloudConfig.supabaseKey) supabaseKey = packet.cloudConfig.supabaseKey;
      }

      // =====================================================================
      // UNIVERSAL ENCRYPTED CLOUD CONFIG HANDSHAKE (Database-Agnostic)
      // =====================================================================
      if (pType === 'SYNC_CLOUD_CONFIG') {
        if (packet.config && typeof packet.config === 'object') {
          cloudConfig = packet.config;
          const creds = cloudConfig.credentials && typeof cloudConfig.credentials === 'object' ? cloudConfig.credentials : {};
          const incomingCompanyId = String(cloudConfig.companyId || packet.companyId || packet.company_id || '').trim();
          const incomingTok = String(creds.token || creds.jwt || packet.token || packet.jwt || '').trim();
          const incomingSid = String(creds.spreadsheetId || creds.sheetId || packet.spreadsheet_id || '').trim();
          const incomingGw = String(cloudConfig.gatewayUrl || creds.gatewayUrl || packet.gatewayUrl || '').trim();
          const incomingEpoch = Number(creds.routingEpoch || creds.routing_epoch || packet.routing_epoch || 0);
          if (incomingCompanyId) {
            if (hubTenantId !== incomingCompanyId) {
              lastAppsScriptServerSeq = 0;
              lastCloudSyncTimestamp = 0;
            }
            hubTenantId = incomingCompanyId;
          }
          if (incomingTok) {
            cloudJwtToken = incomingTok;
            cloudBackoffUntil = 0; // Fresh token clears auth backoff immediately
          }
          if (incomingSid) cloudSpreadsheetId = incomingSid;
          if (incomingGw) cloudGatewayUrl = incomingGw;
          if (incomingEpoch > 0) cloudRoutingEpoch = Math.max(cloudRoutingEpoch, incomingEpoch);
          if (cloudConfig.runtimePolicy && typeof cloudConfig.runtimePolicy === 'object') {
            applyHubRuntimePolicy(cloudConfig.runtimePolicy);
          }
          encryptAndSaveCloudConfig(cloudConfig);
          scheduleSave();
          console.log('[Termux Hub] 🔒 Received and encrypted Cloud Config. DB Type:', packet.config.databaseType, '| Tenant:', hubTenantId, cloudGatewayUrl ? '| Unified Gateway: ON' : '');
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_CLOUD_CONFIG_ACK',
              action: 'SYNC_CLOUD_CONFIG_ACK',
              success: true,
              databaseType: packet.config.databaseType || 'unknown',
              companyId: hubTenantId,
              protocolVersion: hubRuntimePolicy.protocolVersion,
              routing_epoch: cloudRoutingEpoch,
              policy: hubRuntimePolicy,
              timestamp: Date.now(),
            }));
          } catch (e) {}
        }
        return;
      }

      // =====================================================================
      // AUTOMATED RECONCILIATION & DRIFT PREVENTION (Phase 2 & 3 Sweep Engine)
      // =====================================================================
      if (pType === 'SYNC_SNAPSHOT_RESPONSE') {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const entity = packet.entityType || packet.snapshot?.entityType;
        const clientSnap = packet.snapshot || packet.payload;

        if (clientSnap && entity) {
          const hubSnap = computeHubSnapshot(entity, clientSnap.startDate, clientSnap.endDate);
          const countMatch = clientSnap.count === hubSnap.count;
          const sumMatch = Math.abs((Number(clientSnap.totalSum) || 0) - (Number(hubSnap.totalSum) || 0)) < 0.01;
          const hashMatch = String(clientSnap.idHash || '').trim() === String(hubSnap.idHash || '').trim();

          if (countMatch && sumMatch && hashMatch) {
            console.log(`[Termux Hub] ⚡ SNAPSHOT MATCH for "${entity}" (count=${hubSnap.count}, sum=${hubSnap.totalSum}, hash=${hubSnap.idHash})! Terminal and Hub in sync (0 bytes diff).`);
          } else {
            console.log(`[Termux Hub] ⚠️ SNAPSHOT MISMATCH for "${entity}"! Client: (count=${clientSnap.count}, sum=${clientSnap.totalSum}, hash=${clientSnap.idHash}) vs Hub: (count=${hubSnap.count}, sum=${hubSnap.totalSum}, hash=${hubSnap.idHash}). Requesting granular ID digest...`);
            // Mismatch: Hub sends SYNC_ID_DIGEST_REQUEST so Phase 1 & 2 ID diff takes over
            const reqPacket = {
              type: 'SYNC_ID_DIGEST_REQUEST',
              action: 'SYNC_ID_DIGEST_REQUEST',
              sweepId,
              entityType: entity,
              startDate: clientSnap.startDate,
              endDate: clientSnap.endDate,
              hubTimestamp: Date.now(),
              originDeviceId: `HUB-${hubBranchId}`,
            };
            try {
              ws.send(JSON.stringify(reqPacket));
            } catch (err) {
              console.warn('[Termux Hub] Failed to send SYNC_ID_DIGEST_REQUEST:', err.message);
            }
          }
        }
        return;
      }

      if (pType === 'RECON_PUSH_CHUNK_COMPLETE') {
        try {
          ws.send(JSON.stringify({
            type: 'RECON_PUSH_CHUNK_ACK',
            action: 'RECON_PUSH_CHUNK_ACK',
            sweepId: packet.sweepId || '',
            entityType: packet.entityType || '',
            chunkIndex: typeof packet.chunkIndex === 'number' ? packet.chunkIndex : 0,
            timestamp: Date.now(),
          }));
        } catch {}
        return;
      }

      if (pType === 'SYNC_ID_DIGEST_RESPONSE') {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const entity = packet.entityType || packet.digest?.entityType;
        const digest = packet.digest || packet.payload;
        console.log(`[Termux Hub] 📥 Received SYNC_ID_DIGEST_RESPONSE for entity "${entity}" (${digest?.count || 0} items, sweep: ${sweepId})`);

        if (digest && entity) {
          const missingOrOutdated = computeDigestDiff(digest, entity);
          if (missingOrOutdated.length > 0) {
            console.log(`[Termux Hub] 🔍 computeDigestDiff found ${missingOrOutdated.length} diff record(s) for "${entity}" to push to client`);
            streamReconBackfill(ws, sweepId, entity, missingOrOutdated);
          }

          const clientMissingOnHub = computeClientMissingOnHub(digest, entity);
          if (clientMissingOnHub.length > 0) {
            console.log(`[Termux Hub] 📥 Detected ${clientMissingOnHub.length} record(s) for "${entity}" on client missing/newer than Hub. Sending RECON_PUSH_BACKFILL_REQUEST.`);
            try {
              ws.send(JSON.stringify({
                type: 'RECON_PUSH_BACKFILL_REQUEST',
                action: 'RECON_PUSH_BACKFILL_REQUEST',
                sweepId,
                entityType: entity,
                missingIds: clientMissingOnHub,
                isColdHub: isHubCold(),
                pushChunkSize: 25,
                hubTimestamp: Date.now(),
                originDeviceId: `HUB-${hubBranchId}`,
              }));
            } catch (err) {
              console.warn('[Termux Hub] Failed to send RECON_PUSH_BACKFILL_REQUEST:', err.message);
            }
          }

          const clientTombstones = computeClientTombstonedItems(digest, entity);
          if (clientTombstones.length > 0) {
            console.log(`[Termux Hub] 🪦 Detected ${clientTombstones.length} tombstoned "${entity}" item(s) still on client. Pushing TOMBSTONE_SYNC purge packets!`);
            for (const tomb of clientTombstones) {
              try {
                ws.send(JSON.stringify({
                  type: 'TOMBSTONE_SYNC',
                  action: 'TOMBSTONE_SYNC',
                  entityType: 'tombstone',
                  packet_id: `RECON-TOMB-${tomb.entityType}-${tomb.entityId}-${Date.now()}`,
                  tombstone: tomb,
                  payload: tomb,
                  companyId: tomb.companyId || tomb.company_id || hubTenantId,
                  company_id: tomb.company_id || tomb.companyId || hubTenantId,
                  hubTimestamp: tomb.hubTimestamp || tomb.deletedAt || Date.now(),
                  origin_device_id: 'LOCAL_HUB',
                  origin_device_name: 'Termux Local Hub',
                  timestamp: Date.now(),
                }));
              } catch (err) {
                console.warn('[Termux Hub] Failed to push recon TOMBSTONE_SYNC:', err.message);
              }
            }
          }

          if (missingOrOutdated.length === 0 && clientMissingOnHub.length === 0 && clientTombstones.length === 0) {
            console.log(`[Termux Hub] ✅ Client and Hub are fully reconciled for "${entity}" (0 diffs)`);
          }
        }
        return;
      }

      if (pType === 'SYNC_ID_DIGEST_REQUEST') {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const entity = packet.entityType;
        console.log(`[Termux Hub] 📥 Received SYNC_ID_DIGEST_REQUEST for entity "${entity}" (sweep: ${sweepId})`);
        if (entity) {
          const hubDigest = computeHubDigest(entity, packet.startDate, packet.endDate);
          const responsePacket = {
            type: 'SYNC_ID_DIGEST_RESPONSE',
            action: 'SYNC_ID_DIGEST_RESPONSE',
            sweepId,
            entityType: entity,
            digest: hubDigest,
            deviceId: `HUB-${hubBranchId}`,
            timestamp: Date.now(),
          };
          try {
            ws.send(JSON.stringify(responsePacket));
            console.log(`[Termux Hub] 📤 Sent Hub digest for "${entity}" (${hubDigest.count} items) to client`);
          } catch (err) {
            console.warn('[Termux Hub] Failed to send SYNC_ID_DIGEST_RESPONSE:', err.message);
          }
        }
        return;
      }

      if (pType === 'RECON_SWEEP_TRIGGER') {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const targetEntities = Array.isArray(packet.targetEntities)
          ? packet.targetEntities
          : ['sales', 'customer_changes', 'credit_sales', 'cash_logs', 'stock_movements', 'direct_grvs', 'expenses', 'inventory', 'customers', 'staff', 'branches'];
        console.log(`[Termux Hub] 🧹 Client requested RECON_SWEEP_TRIGGER for entities: ${targetEntities.join(', ')}`);
        for (const ent of targetEntities) {
          const reqPacket = {
            type: 'SYNC_ID_DIGEST_REQUEST',
            sweepId,
            entityType: ent,
            startDate: packet.dateRange?.start,
            endDate: packet.dateRange?.end,
            hubTimestamp: Date.now(),
            originDeviceId: `HUB-${hubBranchId}`,
          };
          try {
            ws.send(JSON.stringify(reqPacket));
          } catch (e) {}
        }
        return;
      }

      // =====================================================================
      // 0. PRE-AUTH LOBBY & HUB IDENTITY HANDSHAKE
      // =====================================================================
      if (pType === 'PING_HUB' || pType === 'PING_IDENTITY') {
        const hubInfoResponse = {
          type: 'HUB_INFO',
          action: 'HUB_INFO',
          branch_id: hubBranchId,
          branch_name: hubBranchName,
          tenant_id: hubTenantId,
          hub_id: hubSecurityState.hubId,
          version: HUB_VERSION,
          hub_runtime: HUB_RUNTIME,
          ota_slot: HUB_OTA_SLOT,
          auth_required: HUB_REQUIRE_AUTH,
          routing_epoch: cloudRoutingEpoch,
          totalRecords: salesStore.length + directGrvsStore.length,
          casualWorkersCount: casualWorkersStore.length,
          timestamp: Date.now(),
        };
        try {
          ws.send(JSON.stringify(hubInfoResponse));
          console.log(`[Termux Hub] Replied to PING_HUB: Branch ${hubBranchId} ("${hubBranchName}")`);
        } catch (e) {
          console.warn('[Termux Hub] Failed to send HUB_INFO response:', e.message);
        }
        return;
      }

      // =====================================================================
      // 0.1 RESET HUB IDENTITY & REPURPOSE HARDWARE
      // =====================================================================
      if (pType === 'RESET_BRANCH') {
        if (HUB_REQUIRE_AUTH) {
          const authTs = Number(packet.authTs || 0);
          const authSig = String(packet.authSig || '');
          const recordId = String(packet.packet_id || packet.entityId || packet.recordId || 'GLOBAL');
          const validTs = Number.isFinite(authTs) && Math.abs(Date.now() - authTs) <= 60000;
          const expectedSig = ws.pairedDeviceSecret
            ? hubHmacSha256Hex(ws.pairedDeviceSecret, `CMD:RESET_BRANCH:${recordId}:${authTs}`)
            : '';
          if (!ws.isAuthenticated || !validTs || !hubConstantTimeEqual(authSig, expectedSig)) {
            console.warn('[Termux Hub] 🛑 Blocked unsigned/invalid RESET_BRANCH command.');
            try {
              ws.send(JSON.stringify({
                type: 'AUTH_FAILED',
                reason: 'RESET_BRANCH requires a valid signed command from an authenticated paired terminal.',
              }));
            } catch {}
            return;
          }
        }
        console.warn(`[Termux Hub] ⚠️ RESET_BRANCH received! Wiping memory and resetting branch identity...`);
        salesStore = [];
        inventoryStore = [];
        directGrvsStore = [];
        cashMovementsStore = [];
        cashLiftsStore = [];
        cashLogsStore = [];
        customerChangesStore = [];
        creditSalesStore = [];
        creditGroupsStore = [];
        stockMovementsStore = [];
        expensesStore = [];
        cashTransfersStore = [];
        internalConsumptionsStore = [];
        casualWorkersStore = [];
        zoneAssignmentsStore = [];
        branchLockdownsStore = {};
        salespeopleStore = [];
        customersStore = [];
        branchesStore = [];
        cashAccountsStore = [];
        businessDayClosuresStore = [];
        electronicSettlementsStore = [];
        permissionsMatrixStore = { rules: [], updatedAt: 0 };
        roleConfigsStore = { definitions: null, updatedAt: 0 };
        multiCurrencyStore = { config: null, updatedAt: 0 };
        genericEntitiesStore = {};
        lastAppsScriptServerSeq = 0;

        hubBranchId = packet.new_branch_id || 'UNASSIGNED';
        hubBranchName = packet.new_branch_name || 'Unassigned Hub';
        saveData();

        const resetAck = {
          type: 'RESET_CONFIRMED',
          action: 'RESET_CONFIRMED',
          hub_id: `HUB-${hubBranchId}`,
          branch_id: hubBranchId,
          branch_name: hubBranchName,
          message: 'Local Hub has been reset and branch unassigned.',
          timestamp: Date.now(),
        };

        try {
          ws.send(JSON.stringify(resetAck));
        } catch (e) {}

        // Broadcast to all clients so they drop connections or re-handshake
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(resetAck));
            } catch (e) {}
          }
        });
        return;
      }

      // =====================================================================
      // 0.2 HANDSHAKE: ASSIGN OR RE-BIND HUB BRANCH IDENTITY
      // =====================================================================
      if (pType === 'HANDSHAKE' || pType === 'SET_BRANCH' || pType === 'ASSIGN_BRANCH') {
        const assignedBranchId = packet.branch_id || packet.branchId || packet.target_branch_id;
        const assignedBranchName = packet.branch_name || packet.branchName || assignedBranchId;
        const assignedTenantId = packet.tenant_id || packet.tenantId || packet.company_id || packet.companyId;

        if (assignedBranchId && assignedBranchId !== 'UNASSIGNED') {
          hubBranchId = assignedBranchId;
          if (assignedBranchName) hubBranchName = assignedBranchName;
          if (assignedTenantId) hubTenantId = assignedTenantId;
          saveData();
          console.log(`[Termux Hub] 🤝 Handshake accepted: Assigned to Branch ${hubBranchId} ("${hubBranchName}")`);

          const hubInfoResponse = {
            type: 'HUB_INFO',
            action: 'HUB_INFO',
            branch_id: hubBranchId,
            branch_name: hubBranchName,
            tenant_id: hubTenantId,
            hub_id: `HUB-${hubBranchId}`,
            version: '3.7.0',
            routing_epoch: cloudRoutingEpoch,
            totalRecords: salesStore.length + directGrvsStore.length,
            casualWorkersCount: casualWorkersStore.length,
            timestamp: Date.now(),
          };
          try {
            ws.send(JSON.stringify(hubInfoResponse));
          } catch (e) {
            console.warn('[Termux Hub] Failed to send HUB_INFO response after handshake:', e.message);
          }
          return;
        }
      }

      // =====================================================================
      // 0.25 FLUSH-BEFORE-PULL: DRAIN COMPLETE PING & ACK
      // =====================================================================
      if (pType === 'DRAIN_COMPLETE_PING') {
        scheduleSave();
        const drainAck = {
          type: 'DRAIN_COMPLETE_ACK',
          action: 'DRAIN_COMPLETE_ACK',
          deviceId: packet.deviceId,
          branchId: packet.branchId,
          hubTimestamp: Date.now(),
          timestamp: Date.now(),
        };
        try {
          ws.send(JSON.stringify(drainAck));
          console.log(`[Termux Hub] 🔄 Received DRAIN_COMPLETE_PING from device [${packet.deviceId}]. Offline queue flushed. Responded with DRAIN_COMPLETE_ACK.`);
        } catch (e) {}
        return;
      }

      // =====================================================================
      // 0.26 UNIVERSAL TOMBSTONES & T2 DELETE INTERCEPTOR (PRE-UPSERT GUARD)
      // =====================================================================
      const packetAction = String(packet.action || '').trim().toUpperCase();
      const rawDelEntityType = packet.entityType || payload?.entityType || sheetName || '';
      const isTombstoneEarly = pType === 'TOMBSTONE_SYNC' || pType === 'TOMBSTONE' || String(entityType || '').toLowerCase() === 'tombstone';
      const isDirectDelete = (packetAction === 'DELETE' || pType === 'DELETE' || pType === 'DB_DELETION') && isHubT2EntityType(rawDelEntityType || pType);

      if (isTombstoneEarly || isDirectDelete) {
        const tombObj = packet.tombstone || payload || packet;
        const resolvedType = normalizeHubEntityType(
          isTombstoneEarly
            ? (tombObj.entityType || packet.entityType)
            : (rawDelEntityType || pType)
        );
        const resolvedId = String(
          tombObj?.entityId ||
          packet.entityId ||
          packet.recordId ||
          tombObj?.itemId ||
          tombObj?.ItemID ||
          tombObj?.customerId ||
          tombObj?.supplierId ||
          tombObj?.SupplierID ||
          tombObj?.branchId ||
          tombObj?.account_id ||
          tombObj?.categoryId ||
          tombObj?.sessionId ||
          tombObj?.ProductID ||
          tombObj?.id ||
          packet.id ||
          ''
        ).trim();

        if (resolvedId && resolvedType) {
          const stampedTomb = recordAndPurgeHubTombstone(
            resolvedType,
            resolvedId,
            tombObj?.deletedAt || packet.updatedAt || packet.timestamp || Date.now(),
            {
              ...tombObj,
              companyId: tombObj?.companyId || tombObj?.company_id || packet.companyId || hubTenantId,
              company_id: tombObj?.company_id || tombObj?.companyId || packet.company_id || packet.companyId || hubTenantId,
              branchId: tombObj?.branchId || tombObj?.branch_id || packet.branchId || hubBranchId,
            }
          );
          scheduleSave();
          console.log(`[Termux Hub] 🪦 Recorded Tombstone & purged ${resolvedType} #${resolvedId} from Hub T2 stores`);

          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'tombstone',
              id: stampedTomb.id,
              entityId: resolvedId,
              recordId: resolvedId,
              targetEntityType: resolvedType,
              updatedAt: stampedTomb.deletedAt,
              hubTimestamp: stampedTomb.hubTimestamp,
            }));
          } catch (e) {}

          const tombcast = JSON.stringify({
            type: 'TOMBSTONE_SYNC',
            action: 'TOMBSTONE_SYNC',
            entityType: 'tombstone',
            packet_id: `TOMB-CAST-${stampedTomb.id}-${Date.now()}`,
            tombstone: stampedTomb,
            payload: stampedTomb,
            companyId: stampedTomb.companyId || stampedTomb.company_id || hubTenantId,
            company_id: stampedTomb.company_id || stampedTomb.companyId || hubTenantId,
            hubTimestamp: stampedTomb.hubTimestamp,
            origin_device_id: packet.origin_device_id || packet.originDeviceId || 'LOCAL_HUB',
            origin_device_name: packet.origin_device_name || packet.originDeviceName || 'Termux Local Hub',
            timestamp: Date.now(),
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(tombcast); } catch (e) {}
            }
          });
          return;
        }
      }

      // =====================================================================
      // 0.3 CASUAL WORKERS PIN SYNC OVER LOCAL HUB (STRICT LWW)
      // =====================================================================
      if (pType === 'CASUAL_WORKERS_SYNC') {
        const incoming = packet.casualWorkers || payload || packet.casuals;
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();

        if (Array.isArray(incoming)) {
          for (const cw of incoming) {
            if (!cw) continue;
            const cleanCw = { ...cw };
            delete cleanCw.pin; // Never persist raw pin
            const cwId = cleanCw.id || cleanCw.pin_hash;
            const incomingTime = getTimestamp(cleanCw) || getTimestamp(packet);
            if (cwId && isTombstoned(cwId, 'casual_worker', incomingTime)) {
              console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned casual worker #${cwId}`);
              continue;
            }
            const exIdx = casualWorkersStore.findIndex((c) => (cw.id && c.id === cw.id) || (cw.pin_hash && c.pin_hash === cw.pin_hash));

            if (exIdx >= 0) {
              const existing = casualWorkersStore[exIdx];
              const existingTime = getTimestamp(existing);
              if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
                console.log(
                  `[Termux Hub] 🛡️ LWW Reject: Stale casual worker update for ${cwId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
                );
                try {
                  ws.send(JSON.stringify({
                    type: 'CASUAL_WORKERS_SYNC',
                    action: 'CASUAL_WORKERS_SYNC',
                    casualWorkers: [existing],
                    payload: [existing],
                    updatedAt: existingTime,
                    hubTimestamp: existingTime,
                    lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                    origin_device_id: 'LOCAL_HUB',
                    origin_device_name: 'Termux Local Hub',
                    timestamp: Date.now(),
                  }));
                } catch (e) {}
                continue;
              }
            }

            const stamped = {
              ...cleanCw,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            };

            if (exIdx >= 0) {
              casualWorkersStore[exIdx] = { ...casualWorkersStore[exIdx], ...stamped };
            } else {
              casualWorkersStore.push(stamped);
            }
          }
          scheduleSave();

          // Send SYNC_ACK
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'CASUAL_WORKERS',
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}
        }

        const sanitizedPacket = {
          type: 'CASUAL_WORKERS_SYNC',
          action: 'CASUAL_WORKERS_SYNC',
          casualWorkers: casualWorkersStore,
          payload: casualWorkersStore,
          branchId: packet.branchId || hubBranchId,
          timestamp: hubNow,
          updatedAt: hubNow,
        };
        const forwardStr = JSON.stringify(sanitizedPacket);
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(forwardStr);
            } catch (e) {}
          }
        });
        return;
      }

      // =====================================================================
      // 0.4 STOCKTAKE BRANCH LOCKDOWN BROADCAST (SESSION-BOUND + LWW)
      // =====================================================================
      // DRAFT & SCHEDULED sessions sync freely without consuming the branch's 1-active-session floor slot.
      // PAUSED sessions retain the branch's active floor slot until resumed or archived.
      const ACTIVE_FLOOR_STATUSES_SET = new Set([
        'ACTIVE',
        'IN_PROGRESS',
        'COUNTING',
        'PAUSED',
        'RECOUNT',
        'RECOUNTING',
        'AUDIT_REVIEW',
        'CONSOLIDATED',
        'PENDING_SIGNOFF',
        'READY_FOR_COMMITTAL',
      ]);

      if (pType === 'STOCKTAKE_LOCKDOWN_BROADCAST') {
        const brId = packet.branchId || packet.branch_id || hubBranchId;
        const canonHubLockBr = (b) => {
          const u = String(b || '').trim().toUpperCase();
          if (u === '1' || u === 'BR001' || u === 'BR-001' || u === 'BR-MAIN' || u === 'HQ-01' || u === 'MAIN') return 'BR-MAIN';
          return u;
        };
        const brCanon = canonHubLockBr(brId);
        const hubNow = Date.now();
        const hubIso = new Date(hubNow).toISOString();
        const incomingTime = getTimestamp(packet) || hubNow;
        const existingLock =
          branchLockdownsStore[brId] ||
          Object.entries(branchLockdownsStore || {}).find(
            ([k, st]) => st && (canonHubLockBr(k) === brCanon || canonHubLockBr(st.branchId) === brCanon)
          )?.[1];
        const existingTime = existingLock ? getTimestamp(existingLock) : 0;

        // Bind lockdown strictly to the branch's authoritative active stocktake session
        const activeSessionForBranch = stocktakeSessionsStore.find((s) => {
          if (!s || !s.sessionId) return false;
          if (isTombstoned(s.sessionId, 'stocktake_session', getTimestamp(s))) return false;
          const sBranch = canonHubLockBr(s.branchId || hubBranchId || '');
          const sStatus = String(s.status || '').toUpperCase();
          return (!brCanon || !sBranch || sBranch === brCanon) && ACTIVE_FLOOR_STATUSES_SET.has(sStatus);
        });
        const incomingSessId = String(packet.sessionId || '').trim().toUpperCase();
        const activeSessId = activeSessionForBranch ? String(activeSessionForBranch.sessionId || '').trim().toUpperCase() : '';
        const existingLockSessId = existingLock && existingLock.sessionId ? String(existingLock.sessionId).trim().toUpperCase() : '';

        if (packet.isLocked && activeSessId && incomingSessId && incomingSessId !== activeSessId) {
          console.log(
            `[Termux Hub] 🛡️ Lockdown Session Guard: Rejected lockdown packet for ${brId} from non-active session [${incomingSessId}] while [${activeSessId}] is active.`
          );
          if (existingLock) {
            try {
              ws.send(JSON.stringify({
                type: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                action: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                ...existingLock,
                origin_device_id: 'LOCAL_HUB',
                timestamp: hubNow,
              }));
            } catch (e) {}
          }
          return;
        }
        if (existingLock && existingLock.isLocked && existingLockSessId && !packet.isLocked && incomingSessId && incomingSessId !== existingLockSessId) {
          const existingOwnerSess = stocktakeSessionsStore.find(
            (s) => s && String(s.sessionId || '').trim().toUpperCase() === existingLockSessId
          );
          const ownerIsStillActive = Boolean(
            existingOwnerSess && ACTIVE_FLOOR_STATUSES_SET.has(String(existingOwnerSess.status || '').toUpperCase())
          );
          if (ownerIsStillActive) {
            console.log(
              `[Termux Hub] 🛡️ Lockdown Unlock Guard: Rejected unlock for ${brId} from mismatched session [${incomingSessId}] (owned by [${existingLockSessId}]).`
            );
            try {
              ws.send(JSON.stringify({
                type: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                action: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                ...existingLock,
                origin_device_id: 'LOCAL_HUB',
                timestamp: hubNow,
              }));
            } catch (e) {}
            return;
          }
        }

        const isAuthoritativeUnlock =
          !packet.isLocked &&
          (!existingLock?.isLocked || !existingLockSessId || !incomingSessId || incomingSessId === existingLockSessId || !activeSessId);

        if (!isAuthoritativeUnlock && existingLock && existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 60000) {
          console.log(`[Termux Hub] 🛡️ LWW Reject: Stale STOCKTAKE_LOCKDOWN_BROADCAST for ${brId}`);
          return;
        }
        for (const k of Object.keys(branchLockdownsStore || {})) {
          if (canonHubLockBr(k) === brCanon || canonHubLockBr(branchLockdownsStore[k]?.branchId) === brCanon) {
            delete branchLockdownsStore[k];
          }
        }
        const effectiveUpdatedAt = Math.max(incomingTime, isAuthoritativeUnlock && existingTime > 0 ? existingTime + 1 : 0, hubNow);
        branchLockdownsStore[brId] = {
          branchId: brId,
          companyId: packet.companyId || packet.company_id || hubTenantId,
          company_id: packet.company_id || packet.companyId || hubTenantId,
          isLocked: Boolean(packet.isLocked),
          sessionId: packet.sessionId || existingLock?.sessionId,
          lockedAt: packet.isLocked ? (packet.lockedAt || hubIso) : undefined,
          lockedBy: packet.lockedBy,
          lockedByName: packet.lockedByName,
          reason: packet.reason,
          updatedAt: effectiveUpdatedAt,
          lastUpdated: packet.lastUpdated || new Date(effectiveUpdatedAt).toISOString(),
          isCloudSynced: false,
        };
        scheduleSave();
        console.log(`[Termux Hub] 🔒 Branch Lockdown status changed: ${brId} isLocked=${packet.isLocked} session=${packet.sessionId || 'N/A'}`);

        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(dataStr);
            } catch (e) {}
          }
        });
        return;
      }

      // =====================================================================
      // 0.45 STOCKTAKE SESSION & SEGMENT DISCOVERY (STRICT LWW + CANONICAL FIELDS)
      // =====================================================================
      const isStocktakeSession =
        pType === 'STOCKTAKE_SESSION_STARTED' ||
        pType === 'STOCKTAKE_SESSION_SYNC' ||
        pType === 'STOCKTAKE_SESSION';

      if (isStocktakeSession) {
        const sess = packet.session || payload || packet;
        const sessionId = packet.sessionId || sess.sessionId;
        if (sessionId) {
          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const incomingTime = getTimestamp(sess) || getTimestamp(packet);
          if (isTombstoned(sessionId, 'stocktake_session', incomingTime)) {
            console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned stocktake session #${sessionId}`);
            return;
          }
          const sIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          const existing = sIdx >= 0 ? stocktakeSessionsStore[sIdx] : null;
          const targetBranchNorm = String(packet.branchId || sess.branchId || existing?.branchId || hubBranchId || '')
            .trim()
            .toUpperCase();
          const incomingStatusNorm = String(packet.status || sess.status || existing?.status || 'DRAFT').toUpperCase();
          // Enforce max 1 live execution session per branch ONLY when activating or updating a live session.
          // Unlimited DRAFT, SCHEDULED, ARCHIVED, and CANCELLED sessions sync freely across all devices.
          if (ACTIVE_FLOOR_STATUSES_SET.has(incomingStatusNorm)) {
            const conflictingActive = stocktakeSessionsStore.find((s) => {
              if (!s || s.sessionId === sessionId) return false;
              if (isTombstoned(s.sessionId, 'stocktake_session', getTimestamp(s))) return false;
              const sBranch = String(s.branchId || hubBranchId || '').trim().toUpperCase();
              const sStatus = String(s.status || '').toUpperCase();
              return (!targetBranchNorm || !sBranch || sBranch === targetBranchNorm) && ACTIVE_FLOOR_STATUSES_SET.has(sStatus);
            });
            if (conflictingActive) {
              const conflictBranchKey = conflictingActive.branchId || targetBranchNorm || hubBranchId;
              const existingLockdown =
                branchLockdownsStore[conflictBranchKey] ||
                branchLockdownsStore[String(conflictBranchKey || '').toUpperCase()] ||
                Object.values(branchLockdownsStore || {}).find(
                  (lk) => lk && String(lk.sessionId || '').trim().toUpperCase() === String(conflictingActive.sessionId || '').trim().toUpperCase()
                ) ||
                null;
              console.log(
                `[Termux Hub] ⚠️ Rejected duplicate active stocktake [${sessionId}] (${incomingStatusNorm}) on branch ${targetBranchNorm}: [${conflictingActive.sessionId}] is already ${conflictingActive.status}.`
              );
              try {
                ws.send(JSON.stringify({
                  type: 'STOCKTAKE_SESSION_CONFLICT',
                  sessionId,
                  existingSessionId: conflictingActive.sessionId,
                  existingSessionName: conflictingActive.title || conflictingActive.sessionName || conflictingActive.sessionId,
                  existingSession: conflictingActive,
                  existingLockdown,
                  message: `Only 1 active floor stocktake session is allowed per branch. Close, commit, or archive "${conflictingActive.title || conflictingActive.sessionName}" first.`,
                  timestamp: hubNow,
                }));
              } catch (e) {}
              return;
            }
          }

          if (existing) {
            const existingTime = getTimestamp(existing);
            if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
              console.log(
                `[Termux Hub] 🛡️ LWW Reject: Stale stocktake session update for ${sessionId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
              );
              try {
                ws.send(JSON.stringify({
                  type: 'STOCKTAKE_SESSION_STARTED',
                  action: 'STOCKTAKE_SESSION_STARTED',
                  sessionId: existing.sessionId,
                  session: existing,
                  payload: existing,
                  updatedAt: existingTime,
                  hubTimestamp: existingTime,
                  lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                  origin_device_id: 'LOCAL_HUB',
                  origin_device_name: 'Termux Local Hub',
                  timestamp: Date.now(),
                }));
              } catch (e) {}
              return;
            }
          }

          // 1. Lossless union-merge of segments (never drop local segments or downgrade VERIFIED unless explicitly unlocked)
          const incomingSegmentsRaw = Array.isArray(packet.segments)
            ? packet.segments
            : (Array.isArray(sess.segments) ? sess.segments : []);
          const existingSegmentsRaw = Array.isArray(existing?.segments) ? existing.segments : [];
          const exSegMap = new Map();
          existingSegmentsRaw.forEach((es) => {
            const k = es && (es.segmentId || es.id);
            if (k) exSegMap.set(String(k).trim().toUpperCase(), es);
          });
          const incSegMap = new Map();
          incomingSegmentsRaw.forEach((sg) => {
            const k = sg && (sg.segmentId || sg.id);
            if (k) incSegMap.set(String(k).trim().toUpperCase(), sg);
          });

          const segRankMap = {
            PENDING: 0,
            IN_PROGRESS: 1,
            COUNTING: 1,
            AWAITING_DUAL_COUNT: 2,
            DISCREPANCY_REVIEW: 3,
            VERIFIED: 4,
          };
          const mergeCountLinesLossless = (exArr, incArr) => {
            const exList = Array.isArray(exArr) ? exArr : [];
            const incList = Array.isArray(incArr) ? incArr : [];
            if (exList.length === 0) return incList;
            if (incList.length === 0) return exList;
            const lineMap = new Map();
            exList.forEach((line) => {
              if (!line || (!line.itemId && !line.sku)) return;
              const lk = String(line.itemId || line.sku).trim().toUpperCase();
              lineMap.set(lk, line);
            });
            incList.forEach((line) => {
              if (!line || (!line.itemId && !line.sku)) return;
              const lk = String(line.itemId || line.sku).trim().toUpperCase();
              const prev = lineMap.get(lk);
              if (!prev) {
                lineMap.set(lk, line);
              } else {
                const prevTs = prev.timestamp ? new Date(prev.timestamp).getTime() : 0;
                const incTs = line.timestamp ? new Date(line.timestamp).getTime() : 0;
                lineMap.set(lk, incTs >= prevTs ? line : prev);
              }
            });
            return Array.from(lineMap.values());
          };

          const allSegKeys = [];
          const seenSegKeys = new Set();
          existingSegmentsRaw.forEach((es) => {
            const k = es && (es.segmentId || es.id);
            const norm = k ? String(k).trim().toUpperCase() : '';
            if (norm && !seenSegKeys.has(norm)) {
              seenSegKeys.add(norm);
              allSegKeys.push(norm);
            }
          });
          incomingSegmentsRaw.forEach((sg) => {
            const k = sg && (sg.segmentId || sg.id);
            const norm = k ? String(k).trim().toUpperCase() : '';
            if (norm && !seenSegKeys.has(norm)) {
              seenSegKeys.add(norm);
              allSegKeys.push(norm);
            }
          });

          const mergedSegments = allSegKeys.map((k) => {
            const exSeg = exSegMap.get(k);
            const sg = incSegMap.get(k);
            if (!exSeg) return sg;
            if (!sg) return exSeg;

            const uHistMap = new Map();
            (Array.isArray(exSeg.unlockHistory) ? exSeg.unlockHistory : []).forEach((u) => {
              uHistMap.set(`${u.unlockedAt || ''}:${u.target || ''}:${u.actorId || ''}`, u);
            });
            (Array.isArray(sg.unlockHistory) ? sg.unlockHistory : []).forEach((u) => {
              uHistMap.set(`${u.unlockedAt || ''}:${u.target || ''}:${u.actorId || ''}`, u);
            });
            const mergedUnlockHistory = Array.from(uHistMap.values());
            const exUnlockLen = Array.isArray(exSeg.unlockHistory) ? exSeg.unlockHistory.length : 0;
            const incomingHasNewUnlock = mergedUnlockHistory.length > exUnlockLen;

            const exStatus = String(exSeg.status || 'PENDING').toUpperCase();
            const incStatus = String(sg.status || 'PENDING').toUpperCase();
            const exRank = segRankMap[exStatus] ?? 0;
            const incRank = segRankMap[incStatus] ?? 0;
            const resolvedStatus = incomingHasNewUnlock
              ? (sg.status || exSeg.status)
              : (exRank > incRank ? exSeg.status : (sg.status || exSeg.status));

            const mergedCount1 = incomingHasNewUnlock
              ? (sg.count1 !== undefined ? sg.count1 : exSeg.count1)
              : mergeCountLinesLossless(exSeg.count1, sg.count1);
            const mergedCount2 = incomingHasNewUnlock
              ? (sg.count2 !== undefined ? sg.count2 : exSeg.count2)
              : mergeCountLinesLossless(exSeg.count2, sg.count2);
            const mergedVerifiedCounts = incomingHasNewUnlock
              ? (sg.verifiedCounts !== undefined ? sg.verifiedCounts : exSeg.verifiedCounts)
              : mergeCountLinesLossless(exSeg.verifiedCounts, sg.verifiedCounts);

            const resolvedC1Fin = incomingHasNewUnlock
              ? (sg.count1Finalized !== undefined ? sg.count1Finalized : exSeg.count1Finalized)
              : Boolean(exSeg.count1Finalized || sg.count1Finalized);
            const resolvedC2Fin = incomingHasNewUnlock
              ? (sg.count2Finalized !== undefined ? sg.count2Finalized : exSeg.count2Finalized)
              : Boolean(exSeg.count2Finalized || sg.count2Finalized);
            const resolvedCompFin = incomingHasNewUnlock
              ? (sg.comparisonFinalized !== undefined ? sg.comparisonFinalized : exSeg.comparisonFinalized)
              : Boolean(exSeg.comparisonFinalized || sg.comparisonFinalized);

            return {
              ...exSeg,
              ...sg,
              status: resolvedStatus,
              count1: mergedCount1,
              count2: mergedCount2,
              verifiedCounts: mergedVerifiedCounts,
              discrepancies:
                resolvedStatus === 'VERIFIED'
                  ? []
                  : (sg.discrepancies !== undefined ? sg.discrepancies : exSeg.discrepancies),
              count1Finalized: resolvedC1Fin,
              count2Finalized: resolvedC2Fin,
              comparisonFinalized: resolvedCompFin,
              count1FinalizedAt: sg.count1FinalizedAt || exSeg.count1FinalizedAt,
              count2FinalizedAt: sg.count2FinalizedAt || exSeg.count2FinalizedAt,
              comparisonFinalizedAt: sg.comparisonFinalizedAt || exSeg.comparisonFinalizedAt,
              comparisonFinalizedBy: sg.comparisonFinalizedBy || exSeg.comparisonFinalizedBy,
              unlockHistory: mergedUnlockHistory.length > 0 ? mergedUnlockHistory : undefined,
            };
          });

          // Track which segments are currently verified so unlocked segments do not linger in breakdowns
          const verifiedSegKeySet = new Set();
          mergedSegments.forEach((ms) => {
            const k = ms && (ms.segmentId || ms.id);
            if (!k) return;
            const st = String(ms.status || '').toUpperCase();
            if (st === 'VERIFIED' || ms.comparisonFinalized || (Array.isArray(ms.verifiedCounts) && ms.verifiedCounts.length > 0)) {
              verifiedSegKeySet.add(String(k).trim().toUpperCase());
            }
          });

          // 2. Lossless union-merge of consolidatedItems with additive segmentBreakdown aggregation (NEVER last-write-wins!)
          const incomingItems = Array.isArray(packet.consolidatedItems)
            ? packet.consolidatedItems
            : (Array.isArray(sess.consolidatedItems) ? sess.consolidatedItems : undefined);
          const existingItems = Array.isArray(existing?.consolidatedItems) ? existing.consolidatedItems : [];
          let mergedConsolidated = existingItems;
          if (Array.isArray(incomingItems) && incomingItems.length > 0) {
            const exItemMap = new Map();
            existingItems.forEach((ci) => {
              if (ci && (ci.itemId || ci.sku)) {
                exItemMap.set(String(ci.itemId || ci.sku).trim().toUpperCase(), ci);
              }
            });
            const incItemMap = new Map();
            incomingItems.forEach((ci) => {
              if (ci && (ci.itemId || ci.sku)) {
                incItemMap.set(String(ci.itemId || ci.sku).trim().toUpperCase(), ci);
              }
            });
            const allItemKeys = [];
            const seenItemKeys = new Set();
            incomingItems.forEach((ci) => {
              const k = ci && (ci.itemId || ci.sku) ? String(ci.itemId || ci.sku).trim().toUpperCase() : '';
              if (k && !seenItemKeys.has(k)) {
                seenItemKeys.add(k);
                allItemKeys.push(k);
              }
            });
            existingItems.forEach((ci) => {
              const k = ci && (ci.itemId || ci.sku) ? String(ci.itemId || ci.sku).trim().toUpperCase() : '';
              if (k && !seenItemKeys.has(k)) {
                seenItemKeys.add(k);
                allItemKeys.push(k);
              }
            });

            mergedConsolidated = allItemKeys.map((k) => {
              const ex = exItemMap.get(k);
              const inc = incItemMap.get(k);
              if (!ex) return inc;
              if (!inc) return ex;

              const exCT = ex.commentedAt ? new Date(ex.commentedAt).getTime() : 0;
              const incCT = inc.commentedAt ? new Date(inc.commentedAt).getTime() : 0;
              const keepEx = exCT > incCT && Boolean(ex.managerComment || ex.reasonCode);
              const commentMap = new Map();
              (Array.isArray(ex.varianceComments) ? ex.varianceComments : []).forEach((c) => {
                if (c && c.id) commentMap.set(c.id, c);
              });
              (Array.isArray(inc.varianceComments) ? inc.varianceComments : []).forEach((c) => {
                if (c && c.id) commentMap.set(c.id, c);
              });
              const mergedComments = Array.from(commentMap.values()).sort(
                (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
              );

              // Union-merge segmentBreakdown across existing + incoming so Fridge (4) + Warehouse (10) = 14
              const bdMap = new Map();
              (Array.isArray(ex.segmentBreakdown) ? ex.segmentBreakdown : []).forEach((sb) => {
                if (!sb || !sb.segmentId) return;
                const sk = String(sb.segmentId).trim().toUpperCase();
                if (verifiedSegKeySet.size === 0 || verifiedSegKeySet.has(sk)) {
                  bdMap.set(sk, sb);
                }
              });
              (Array.isArray(inc.segmentBreakdown) ? inc.segmentBreakdown : []).forEach((sb) => {
                if (!sb || !sb.segmentId) return;
                const sk = String(sb.segmentId).trim().toUpperCase();
                if (verifiedSegKeySet.size === 0 || verifiedSegKeySet.has(sk)) {
                  bdMap.set(sk, sb);
                }
              });
              const mergedBreakdown = Array.from(bdMap.values());

              const baseMerged = {
                ...ex,
                ...inc,
                segmentBreakdown: mergedBreakdown.length > 0 ? mergedBreakdown : (inc.segmentBreakdown ?? ex.segmentBreakdown),
                originalCountedCases: ex.originalCountedCases ?? inc.originalCountedCases,
                originalCountedSingles: ex.originalCountedSingles ?? inc.originalCountedSingles,
                originalCountedTotalUnits: ex.originalCountedTotalUnits ?? inc.originalCountedTotalUnits,
                originalVarianceUnits: ex.originalVarianceUnits ?? inc.originalVarianceUnits,
                originalVarianceCostValue: ex.originalVarianceCostValue ?? inc.originalVarianceCostValue,
                originalVarianceRetailValue: ex.originalVarianceRetailValue ?? inc.originalVarianceRetailValue,
                varianceComments: mergedComments.length > 0 ? mergedComments : (inc.varianceComments ?? ex.varianceComments),
                reasonCode: keepEx ? ex.reasonCode : (inc.reasonCode ?? ex.reasonCode),
                managerComment: keepEx ? ex.managerComment : (inc.managerComment ?? ex.managerComment),
                actionTaken: keepEx ? ex.actionTaken : (inc.actionTaken ?? ex.actionTaken),
                commentedById: keepEx ? ex.commentedById : (inc.commentedById ?? ex.commentedById),
                commentedByName: keepEx ? ex.commentedByName : (inc.commentedByName ?? ex.commentedByName),
                commentedAt: keepEx ? ex.commentedAt : (inc.commentedAt ?? ex.commentedAt),
                ownerAckStatus: inc.ownerAckStatus ?? ex.ownerAckStatus,
              };

              // If unioned segments combined counts from both devices (and no completed Blind Recount overrides it), re-sum!
              const hasBlindOverride =
                baseMerged.recountSheetStatus === 'COMPLETED' &&
                baseMerged.recountTotalUnits !== undefined;
              if (!hasBlindOverride && mergedBreakdown.length > 0) {
                const summedTotalUnits = mergedBreakdown.reduce((acc, sb) => acc + (Number(sb.totalUnits) || 0), 0);
                if (summedTotalUnits !== Number(baseMerged.countedTotalUnits || 0)) {
                  const upc = Math.max(1, Number(baseMerged.unitsPerCase || 1));
                  const costPerUnit = Number(baseMerged.costPerUnit || 0);
                  const sellPriceUnit = Number(baseMerged.sellPriceUnit || 0);
                  const systemTotalUnits = Number(baseMerged.systemTotalUnits || 0);
                  const systemCases = Number(baseMerged.systemCases || 0);
                  const systemSingles = Number(baseMerged.systemSingles || 0);
                  const customerHeld = Number(baseMerged.customerHeldStockUnits || 0);
                  const emergencySold = Number(baseMerged.emergencySalesUnits || 0);
                  const adjustedPhysicalUnits = Math.max(0, summedTotalUnits - customerHeld - emergencySold);
                  const effectivePhysicalUnits =
                    customerHeld > 0 || emergencySold > 0 ? adjustedPhysicalUnits : summedTotalUnits;
                  const varianceTotalUnits = effectivePhysicalUnits - systemTotalUnits;
                  const varianceCostValue = varianceTotalUnits * costPerUnit;
                  const varianceRetailValue = varianceTotalUnits * sellPriceUnit;
                  const hasPendingRecount =
                    baseMerged.recountSheetStatus === 'REQUESTED' || Boolean(baseMerged.recountRequested);
                  baseMerged.countedTotalUnits = summedTotalUnits;
                  baseMerged.countedCases = Math.floor(summedTotalUnits / upc);
                  baseMerged.countedSingles = summedTotalUnits % upc;
                  baseMerged.countedCostValue = summedTotalUnits * costPerUnit;
                  baseMerged.countedRetailValue = summedTotalUnits * sellPriceUnit;
                  baseMerged.adjustedPhysicalUnits = adjustedPhysicalUnits;
                  baseMerged.varianceCases = Math.floor(effectivePhysicalUnits / upc) - systemCases;
                  baseMerged.varianceSingles = (effectivePhysicalUnits % upc) - systemSingles;
                  baseMerged.varianceTotalUnits = varianceTotalUnits;
                  baseMerged.varianceCostValue = varianceCostValue;
                  baseMerged.varianceRetailValue = varianceRetailValue;
                  baseMerged.originalCountedTotalUnits = summedTotalUnits;
                  baseMerged.originalCountedCases = baseMerged.countedCases;
                  baseMerged.originalCountedSingles = baseMerged.countedSingles;
                  baseMerged.originalVarianceTotalUnits = varianceTotalUnits;
                  baseMerged.originalVarianceUnits = varianceTotalUnits;
                  baseMerged.originalVarianceCostValue = varianceCostValue;
                  baseMerged.originalVarianceRetailValue = varianceRetailValue;
                  baseMerged.status = hasPendingRecount
                    ? 'RECOUNT_FLAGGED'
                    : varianceTotalUnits < 0
                    ? 'SHORTAGE'
                    : varianceTotalUnits > 0
                    ? 'OVERAGE'
                    : 'MATCH';
                }
              }

              return baseMerged;
            });
          }

          const incomingPasses = Array.isArray(packet.guestPasses)
            ? packet.guestPasses
            : (Array.isArray(sess.guestPasses) ? sess.guestPasses : undefined);

          const resolvedLockdown =
            packet.isLockdownActive !== undefined
              ? Boolean(packet.isLockdownActive)
              : (sess.isLockdownActive !== undefined ? Boolean(sess.isLockdownActive) : Boolean(existing?.isLockdownActive));

          const mergedPauseHistory = (() => {
            const exHist = Array.isArray(existing?.pauseHistory) ? existing.pauseHistory : [];
            const incHist = Array.isArray(packet.pauseHistory)
              ? packet.pauseHistory
              : (Array.isArray(sess.pauseHistory) ? sess.pauseHistory : []);
            const map = new Map();
            [...exHist, ...incHist].forEach((entry) => {
              if (!entry || !entry.pausedAt) return;
              const prev = map.get(entry.pausedAt);
              map.set(entry.pausedAt, prev ? { ...prev, ...entry } : entry);
            });
            const merged = Array.from(map.values()).sort(
              (a, b) => new Date(a.pausedAt).getTime() - new Date(b.pausedAt).getTime()
            );
            return merged.length > 0 ? merged : undefined;
          })();

          const resolvedLockdownRequested =
            packet.lockdownRequested !== undefined
              ? Boolean(packet.lockdownRequested)
              : (sess.lockdownRequested !== undefined ? Boolean(sess.lockdownRequested) : existing?.lockdownRequested);

          const resolvedEverActivated =
            Boolean(packet.everActivated || sess.everActivated || existing?.everActivated ||
              ACTIVE_FLOOR_STATUSES_SET.has(incomingStatusNorm) || incomingStatusNorm === 'APPROVED_POSTED');

          const sessionObj = {
            ...(existing || {}),
            ...sess,
            sessionId,
            title: packet.sessionName || packet.title || sess.title || existing?.title || `Session ${sessionId}`,
            sessionName: packet.sessionName || packet.title || sess.title || existing?.sessionName || `Session ${sessionId}`,
            date: packet.date || sess.date || existing?.date || hubIso.split('T')[0],
            status: packet.status || sess.status || existing?.status || 'DRAFT',
            segments: mergedSegments,
            consolidatedItems: mergedConsolidated,
            guestPasses: incomingPasses !== undefined ? incomingPasses : existing?.guestPasses,
            startedBy: packet.startedBy || sess.startedBy || existing?.startedBy || 'Manager',
            startedAt: packet.startedAt || sess.startedAt || existing?.startedAt || hubIso,
            createdBy: packet.createdBy || sess.createdBy || existing?.createdBy || packet.startedBy || 'MANAGER',
            createdByName: packet.createdByName || sess.createdByName || existing?.createdByName || packet.startedBy || 'Manager',
            countType: packet.countType || sess.countType || existing?.countType || 'DAILY_BLIND',
            branchId: packet.branchId || sess.branchId || existing?.branchId || hubBranchId,
            branchName: packet.branchName || sess.branchName || existing?.branchName || hubBranchName,
            companyId: packet.companyId || sess.companyId || existing?.companyId || hubTenantId,
            company_id: packet.company_id || sess.company_id || existing?.company_id || hubTenantId,
            isLockdownActive: resolvedLockdown,
            lockdownRequested: resolvedLockdownRequested,
            everActivated: resolvedEverActivated,
            activatedAt: packet.activatedAt || sess.activatedAt || existing?.activatedAt,
            activatedBy: packet.activatedBy || sess.activatedBy || existing?.activatedBy,
            activatedByName: packet.activatedByName || sess.activatedByName || existing?.activatedByName,
            pausedAt: packet.pausedAt !== undefined ? packet.pausedAt : (sess.pausedAt !== undefined ? sess.pausedAt : existing?.pausedAt),
            pausedBy: packet.pausedBy !== undefined ? packet.pausedBy : (sess.pausedBy !== undefined ? sess.pausedBy : existing?.pausedBy),
            pausedByName: packet.pausedByName !== undefined ? packet.pausedByName : (sess.pausedByName !== undefined ? sess.pausedByName : existing?.pausedByName),
            pauseReason: packet.pauseReason !== undefined ? packet.pauseReason : (sess.pauseReason !== undefined ? sess.pauseReason : existing?.pauseReason),
            pausedFromStatus: packet.pausedFromStatus !== undefined ? packet.pausedFromStatus : (sess.pausedFromStatus !== undefined ? sess.pausedFromStatus : existing?.pausedFromStatus),
            pauseHistory: mergedPauseHistory,
            archivedAt: packet.archivedAt !== undefined ? packet.archivedAt : (sess.archivedAt !== undefined ? sess.archivedAt : existing?.archivedAt),
            archivedBy: packet.archivedBy !== undefined ? packet.archivedBy : (sess.archivedBy !== undefined ? sess.archivedBy : existing?.archivedBy),
            archivedByName: packet.archivedByName !== undefined ? packet.archivedByName : (sess.archivedByName !== undefined ? sess.archivedByName : existing?.archivedByName),
            archiveReason: packet.archiveReason !== undefined ? packet.archiveReason : (sess.archiveReason !== undefined ? sess.archiveReason : existing?.archiveReason),
            stocktakeAuditorId: packet.stocktakeAuditorId !== undefined ? packet.stocktakeAuditorId : (sess.stocktakeAuditorId !== undefined ? sess.stocktakeAuditorId : existing?.stocktakeAuditorId),
            stocktakeAuditorName: packet.stocktakeAuditorName !== undefined ? packet.stocktakeAuditorName : (sess.stocktakeAuditorName !== undefined ? sess.stocktakeAuditorName : existing?.stocktakeAuditorName),
            stocktakeAuditorPhone: packet.stocktakeAuditorPhone !== undefined ? packet.stocktakeAuditorPhone : (sess.stocktakeAuditorPhone !== undefined ? sess.stocktakeAuditorPhone : existing?.stocktakeAuditorPhone),
            auditorType: packet.auditorType || sess.auditorType || existing?.auditorType,
            auditorGuestPassId: packet.auditorGuestPassId || sess.auditorGuestPassId || existing?.auditorGuestPassId,
            auditorCasualId: packet.auditorCasualId || sess.auditorCasualId || existing?.auditorCasualId,
            predefinedDailyItemIds: packet.predefinedDailyItemIds || sess.predefinedDailyItemIds || existing?.predefinedDailyItemIds,
            certifiedById: packet.certifiedById || sess.certifiedById || existing?.certifiedById,
            certifiedByName: packet.certifiedByName || sess.certifiedByName || existing?.certifiedByName,
            certifiedAt: packet.certifiedAt || sess.certifiedAt || existing?.certifiedAt,
            approvedBy: packet.approvedBy || sess.approvedBy || existing?.approvedBy,
            approvedByName: packet.approvedByName || sess.approvedByName || existing?.approvedByName,
            approvedAt: packet.approvedAt || sess.approvedAt || existing?.approvedAt,
            varianceReviewStatus: packet.varianceReviewStatus || sess.varianceReviewStatus || existing?.varianceReviewStatus,
            varianceCommentDeadline: packet.varianceCommentDeadline || sess.varianceCommentDeadline || existing?.varianceCommentDeadline,
            varianceMaterialityThreshold:
              packet.varianceMaterialityThreshold !== undefined
                ? packet.varianceMaterialityThreshold
                : (sess.varianceMaterialityThreshold !== undefined ? sess.varianceMaterialityThreshold : existing?.varianceMaterialityThreshold),
            varianceMinUnitThreshold:
              packet.varianceMinUnitThreshold !== undefined
                ? packet.varianceMinUnitThreshold
                : (sess.varianceMinUnitThreshold !== undefined ? sess.varianceMinUnitThreshold : existing?.varianceMinUnitThreshold),
            varianceReviewWindowHours:
              packet.varianceReviewWindowHours !== undefined
                ? packet.varianceReviewWindowHours
                : (sess.varianceReviewWindowHours !== undefined ? sess.varianceReviewWindowHours : existing?.varianceReviewWindowHours),
            varianceReviewedById: packet.varianceReviewedById || sess.varianceReviewedById || existing?.varianceReviewedById,
            varianceReviewedByName: packet.varianceReviewedByName || sess.varianceReviewedByName || existing?.varianceReviewedByName,
            varianceReviewedAt: packet.varianceReviewedAt || sess.varianceReviewedAt || existing?.varianceReviewedAt,
            totalSystemUnits:
              mergedConsolidated.length > 0
                ? mergedConsolidated.reduce((acc, ci) => acc + (Number(ci.systemTotalUnits) || 0), 0)
                : (packet.totalSystemUnits !== undefined ? packet.totalSystemUnits : (sess.totalSystemUnits !== undefined ? sess.totalSystemUnits : (existing?.totalSystemUnits || 0))),
            totalCountedUnits:
              mergedConsolidated.length > 0
                ? mergedConsolidated.reduce((acc, ci) => acc + (Number(ci.countedTotalUnits) || 0), 0)
                : (packet.totalCountedUnits !== undefined ? packet.totalCountedUnits : (sess.totalCountedUnits !== undefined ? sess.totalCountedUnits : (existing?.totalCountedUnits || 0))),
            varianceUnits:
              mergedConsolidated.length > 0
                ? mergedConsolidated.reduce((acc, ci) => acc + (Number(ci.varianceTotalUnits) || 0), 0)
                : (packet.varianceUnits !== undefined ? packet.varianceUnits : (sess.varianceUnits !== undefined ? sess.varianceUnits : (existing?.varianceUnits || 0))),
            varianceCostValue:
              mergedConsolidated.length > 0
                ? mergedConsolidated.reduce((acc, ci) => acc + (Number(ci.varianceCostValue) || 0), 0)
                : (packet.varianceCostValue !== undefined ? packet.varianceCostValue : (sess.varianceCostValue !== undefined ? sess.varianceCostValue : (existing?.varianceCostValue || 0))),
            varianceRetailValue:
              mergedConsolidated.length > 0
                ? mergedConsolidated.reduce((acc, ci) => acc + (Number(ci.varianceRetailValue) || 0), 0)
                : (packet.varianceRetailValue !== undefined ? packet.varianceRetailValue : (sess.varianceRetailValue !== undefined ? sess.varianceRetailValue : (existing?.varianceRetailValue || 0))),
            notes: packet.notes !== undefined ? packet.notes : (sess.notes !== undefined ? sess.notes : (existing?.notes || '')),
            version: Math.max(Number(packet.version || sess.version || 0), Number(existing?.version || 0), 1),
            mutationSource: packet.mutationSource || sess.mutationSource || existing?.mutationSource || 'USER_EDIT',
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            // CRITICAL: Always mark client-originated stocktake updates dirty so Cloud push_envelopes syncs every revision
            isCloudSynced: false,
          };

          if (sIdx >= 0) {
            stocktakeSessionsStore[sIdx] = sessionObj;
          } else {
            stocktakeSessionsStore.unshift(sessionObj);
          }

          const isClosedSessionStatus =
            sessionObj.status === 'APPROVED_POSTED' ||
            sessionObj.status === 'ARCHIVED' ||
            sessionObj.status === 'CANCELLED';

          if (isClosedSessionStatus) {
            casualWorkersStore.forEach((cw) => {
              if (cw && cw.sessionId === sessionId && cw.active) {
                cw.active = false;
                cw.updatedAt = hubNow;
                cw.lastUpdated = hubIso;
                cw.isCloudSynced = false;
              }
            });
          }

          // Auto-release branchLockdownsStore if this session closed/completed or explicitly disengaged lockdown
          if ((isClosedSessionStatus || sessionObj.isLockdownActive === false) && branchLockdownsStore && typeof branchLockdownsStore === 'object') {
            const cleanSessUpper = String(sessionId || '').trim().toUpperCase();
            const sessBrCanon = String(sessionObj.branchId || hubBranchId || '').trim().toUpperCase();
            for (const brK of Object.keys(branchLockdownsStore)) {
              const lk = branchLockdownsStore[brK];
              if (!lk || !lk.isLocked) continue;
              const lkSessUpper = String(lk.sessionId || '').trim().toUpperCase();
              const lkBrUpper = String(lk.branchId || brK || '').trim().toUpperCase();
              if (lkSessUpper === cleanSessUpper || (!lkSessUpper && lkBrUpper === sessBrCanon)) {
                const releasedLock = {
                  ...lk,
                  branchId: lk.branchId || sessionObj.branchId || brK,
                  isLocked: false,
                  lockedAt: undefined,
                  sessionId,
                  reason: isClosedSessionStatus
                    ? `Auto-released: stocktake ${sessionId} is ${sessionObj.status}`
                    : `Lockdown disengaged for stocktake ${sessionId}`,
                  updatedAt: Math.max(hubNow, getTimestamp(lk) + 1),
                  lastUpdated: hubIso,
                  isCloudSynced: false,
                };
                branchLockdownsStore[brK] = releasedLock;
                const unlockBroadcastStr = JSON.stringify({
                  type: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                  action: 'STOCKTAKE_LOCKDOWN_BROADCAST',
                  ...releasedLock,
                  origin_device_id: 'LOCAL_HUB',
                  timestamp: hubNow,
                });
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    try {
                      client.send(unlockBroadcastStr);
                    } catch (e) {}
                  }
                });
              }
            }
          }

          if (Array.isArray(sessionObj.segments) && sessionObj.segments.length > 0) {
            sessionObj.segments.forEach((seg) => {
              const segId = seg.segmentId || seg.id;
              const exSegIdx = stocktakeSegmentsStore.findIndex(
                (s) => s.sessionId === sessionId && (s.segmentId === segId || s.id === segId)
              );
              const segObj = { ...seg, sessionId, segmentId: segId };
              if (exSegIdx >= 0) {
                stocktakeSegmentsStore[exSegIdx] = { ...stocktakeSegmentsStore[exSegIdx], ...segObj };
              } else {
                stocktakeSegmentsStore.push(segObj);
              }
            });
          }

          scheduleSave();
          console.log(
            `[Termux Hub] 📋 Synced Stocktake Session [${sessionId}] "${sessionObj.sessionName}" (${sessionObj.status}) with ${(sessionObj.segments || []).length} segments stamped at ${hubIso}.`
          );

          // Send SYNC_ACK
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'STOCKTAKE_SESSION',
              id: sessionId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          // Broadcast to all other peers with canonical branch/company/timestamp metadata
          const sessBroadcastStr = JSON.stringify({
            type: 'STOCKTAKE_SESSION_STARTED',
            action: 'STOCKTAKE_SESSION_STARTED',
            sessionId,
            branchId: sessionObj.branchId || hubBranchId,
            companyId: sessionObj.companyId || hubTenantId,
            company_id: sessionObj.companyId || hubTenantId,
            session: sessionObj,
            payload: sessionObj,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            origin_device_id: packet.origin_device_id || 'LOCAL_HUB',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(sessBroadcastStr);
              } catch (e) {}
            }
          });
        }
        return;
      }

      if (pType === 'STOCKTAKE_SEGMENT_CREATED') {
        const seg = packet.segment || packet;
        const sessionId = packet.sessionId || seg.sessionId;
        const segId = seg.segmentId || seg.id;
        if (segId) {
          const segObj = { ...seg, sessionId, segmentId: segId };
          const exSegIdx = stocktakeSegmentsStore.findIndex(
            (s) => (s.sessionId === sessionId || !sessionId) && (s.segmentId === segId || s.id === segId)
          );
          if (exSegIdx >= 0) {
            stocktakeSegmentsStore[exSegIdx] = { ...stocktakeSegmentsStore[exSegIdx], ...segObj };
          } else {
            stocktakeSegmentsStore.push(segObj);
          }

          if (sessionId) {
            const sIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
            if (sIdx >= 0) {
              const currentSess = stocktakeSessionsStore[sIdx];
              const segList = Array.isArray(currentSess.segments) ? [...currentSess.segments] : [];
              const exIdx = segList.findIndex((s) => s.segmentId === segId || s.id === segId);
              if (exIdx >= 0) {
                segList[exIdx] = { ...segList[exIdx], ...segObj };
              } else {
                segList.push(segObj);
              }
              currentSess.segments = segList;
              stocktakeSessionsStore[sIdx] = currentSess;
            }

            const exZone = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === segId);
            if (!exZone) {
              zoneAssignmentsStore.push({
                zoneId: segId,
                zoneName: segObj.name || segObj.title || segId,
                sessionId,
                branchId: hubBranchId,
                status: 'AVAILABLE',
              });
            }
          }

          scheduleSave();
          console.log(
            `[Termux Hub] 📋 STOCKTAKE_SEGMENT_CREATED broadcast: Segment [${segId}] in Session [${sessionId || 'N/A'}]. Saved to disk & broadcasted to peers.`
          );

          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(dataStr);
              } catch (e) {}
            }
          });
        }
        return;
      }

      if (pType === 'STOCKTAKE_SESSION_LIST_REQUEST') {
        try {
          const liveSessions = stocktakeSessionsStore.filter(
            (s) => s && s.sessionId && !isTombstoned(s.sessionId, 'stocktake_session', getTimestamp(s))
          );
          const sessionTombstones = tombstonesStore.filter(
            (t) => t && normalizeHubEntityType(t.entityType) === 'stocktake_session'
          );
          ws.send(
            JSON.stringify({
              type: 'STOCKTAKE_SESSION_LIST',
              action: 'STOCKTAKE_SESSION_LIST',
              sessions: liveSessions,
              segments: stocktakeSegmentsStore,
              zoneAssignments: zoneAssignmentsStore,
              tombstones: sessionTombstones,
              branchLockdowns: branchLockdownsStore || {},
              timestamp: Date.now(),
            })
          );
          console.log(
            `[Termux Hub] 📋 Replied to STOCKTAKE_SESSION_LIST_REQUEST with ${liveSessions.length} session(s), ${stocktakeSegmentsStore.length} segment(s), ${zoneAssignmentsStore.length} zone assignments, and ${sessionTombstones.length} tombstone(s).`
          );
        } catch (e) {}
        return;
      }

      // =====================================================================
      // 0.5 SELF-SERVICE ZONE CLAIMING
      // =====================================================================
      if (pType === 'STOCKTAKE_ZONE_CLAIM') {
        const incomingTime = getTimestamp(packet);
        const existingZone = zoneAssignmentsStore.find((z) => z.sessionId === packet.sessionId && z.zoneId === packet.zoneId);
        const existingTime = existingZone ? getTimestamp(existingZone) : 0;
        if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
          console.log(`[Termux Hub] 🛡️ LWW Reject: Stale STOCKTAKE_ZONE_CLAIM for ${packet.zoneId}`);
          return;
        }

        const { sessionId, zoneId, slot, deviceId, staffId, staffName } = packet;
        if (sessionId && zoneId && (slot === 'A' || slot === 'B')) {
          let zoneRec = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zoneId);
          const sessIdxPre = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          const sessPre = sessIdxPre >= 0 ? stocktakeSessionsStore[sessIdxPre] : null;
          const segPre = sessPre && Array.isArray(sessPre.segments)
            ? sessPre.segments.find((s) => (s.segmentId || s.id) === zoneId)
            : null;

          // Finalized lock validation
          if (
            zoneRec?.comparisonFinalized ||
            segPre?.comparisonFinalized ||
            (slot === 'A' && (zoneRec?.teamA?.finalized || segPre?.count1Finalized)) ||
            (slot === 'B' && (zoneRec?.teamB?.finalized || segPre?.count2Finalized))
          ) {
            try {
              ws.send(JSON.stringify({
                type: 'STOCKTAKE_SLOT_LOCKED',
                sessionId,
                zoneId,
                slot,
                message: `Team ${slot} / segment comparison is finalized & locked. Auditor unlock required.`,
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }

          // Cross-slot blind isolation validation (counterAId !== counterBId)
          const cleanStaff = String(staffId || '').trim().toUpperCase();
          const oppositeOwner = String(
            slot === 'A'
              ? (zoneRec?.teamB?.staffId || segPre?.counterBId || '')
              : (zoneRec?.teamA?.staffId || segPre?.counterAId || '')
          ).trim().toUpperCase();
          if (cleanStaff && oppositeOwner && oppositeOwner === cleanStaff) {
            try {
              ws.send(JSON.stringify({
                type: 'STOCKTAKE_CLAIM_REJECTED',
                sessionId,
                zoneId,
                slot,
                message: `Blind isolation: You already hold Team ${slot === 'A' ? 'B' : 'A'} on this segment and cannot claim Team ${slot}.`,
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }

          if (!zoneRec) {
            zoneRec = {
              zoneId,
              zoneName: packet.zoneName || zoneId,
              sessionId,
              branchId: packet.branchId || hubBranchId,
              status: slot === 'A' ? 'IN_PROGRESS' : 'AWAITING_DOUBLE_COUNT',
            };
            zoneAssignmentsStore.push(zoneRec);
          }

          if (slot === 'A') {
            zoneRec.teamA = { deviceId, staffId, staffName, claimedAt: new Date().toISOString(), submitted: false, finalized: false };
            zoneRec.status = zoneRec.teamB?.submitted ? 'AWAITING_DOUBLE_COUNT' : 'IN_PROGRESS';
          } else {
            zoneRec.teamB = { deviceId, staffId, staffName, claimedAt: new Date().toISOString(), submitted: false, finalized: false };
          }

          // Authoritatively update session and segment stores on Hub
          const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          if (sessIdx >= 0) {
            const sess = stocktakeSessionsStore[sessIdx];
            if (Array.isArray(sess.segments)) {
              const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
              if (seg) {
                if (slot === 'A') {
                  seg.counterAId = staffId;
                  seg.counterAName = staffName;
                  seg.counterATimestamp = new Date().toISOString();
                } else {
                  seg.counterBId = staffId;
                  seg.counterBName = staffName;
                  seg.counterBTimestamp = new Date().toISOString();
                }
                if (seg.status === 'PENDING') seg.status = 'COUNTING';
              }
            }
          }

          const segStoreIdx = stocktakeSegmentsStore.findIndex(
            (s) => (s.sessionId === sessionId || !s.sessionId) && (s.segmentId === zoneId || s.id === zoneId)
          );
          if (segStoreIdx >= 0) {
            if (slot === 'A') {
              stocktakeSegmentsStore[segStoreIdx].counterAId = staffId;
              stocktakeSegmentsStore[segStoreIdx].counterAName = staffName;
            } else {
              stocktakeSegmentsStore[segStoreIdx].counterBId = staffId;
              stocktakeSegmentsStore[segStoreIdx].counterBName = staffName;
            }
          }

          scheduleSave();
          console.log(`[Termux Hub] Zone ${zoneId} claimed by ${staffName} as Team ${slot}`);

          const claimedPacket = {
            type: 'STOCKTAKE_ZONE_CLAIMED',
            sessionId,
            zoneId,
            slot,
            deviceId,
            staffId,
            staffName,
            zone: zoneRec,
            timestamp: Date.now(),
          };

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(claimedPacket));
              } catch (e) {}
            }
          });
        }
        return;
      }

      // =====================================================================
      // 0.6 TRUE BLIND COUNTING: HUB SECRET HOLDING VAULT
      // =====================================================================
      if (pType === 'STOCKTAKE_COUNT_SUBMIT') {
        const { sessionId, zoneId, slot, deviceId, staffId, staffName, lines } = packet;

        if (!sessionId || !zoneId || (slot !== 'A' && slot !== 'B' && slot !== 'RECOUNT')) {
          return;
        }

        const existingZoneCheck = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zoneId);
        const sessIdxPre = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        const sessPre = sessIdxPre >= 0 ? stocktakeSessionsStore[sessIdxPre] : null;
        const segPre = sessPre && Array.isArray(sessPre.segments)
          ? sessPre.segments.find((s) => (s.segmentId || s.id) === zoneId)
          : null;
        const existingBlindEntry = hubBlindStore[sessionId]?.[zoneId];

        if (slot === 'A' || slot === 'B') {
          if (
            existingZoneCheck?.comparisonFinalized ||
            segPre?.comparisonFinalized ||
            (slot === 'A' && (existingZoneCheck?.teamA?.finalized || segPre?.count1Finalized)) ||
            (slot === 'B' && (existingZoneCheck?.teamB?.finalized || segPre?.count2Finalized))
          ) {
            try {
              ws.send(JSON.stringify({
                type: 'STOCKTAKE_SLOT_LOCKED',
                sessionId,
                zoneId,
                slot,
                message: `Team ${slot} count is finalized & locked. Auditor unlock required before re-submitting.`,
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }

          const cleanStaff = String(staffId || '').trim().toUpperCase();
          const oppositeOwner = String(
            slot === 'A'
              ? (existingBlindEntry?.B?.staffId || existingZoneCheck?.teamB?.staffId || segPre?.counterBId || '')
              : (existingBlindEntry?.A?.staffId || existingZoneCheck?.teamA?.staffId || segPre?.counterAId || '')
          ).trim().toUpperCase();
          if (cleanStaff && oppositeOwner && oppositeOwner === cleanStaff) {
            try {
              ws.send(JSON.stringify({
                type: 'STOCKTAKE_CLAIM_REJECTED',
                sessionId,
                zoneId,
                slot,
                message: `Blind isolation: You already counted Team ${slot === 'A' ? 'B' : 'A'} on this segment.`,
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }
        }

        if (!hubBlindStore[sessionId]) hubBlindStore[sessionId] = {};
        if (!hubBlindStore[sessionId][zoneId]) {
          hubBlindStore[sessionId][zoneId] = { A: null, B: null, recount: null };
        }

        const finalizedAtIso = new Date().toISOString();
        hubBlindStore[sessionId][zoneId][slot] = {
          deviceId,
          staffId,
          staffName,
          submittedAt: finalizedAtIso,
          lines: Array.isArray(lines) ? lines : [],
        };

        saveBlindVault();
        console.log(`[Hub] Vaulted Team ${slot} count for Zone ${zoneId}. Saved to disk.`);

        // Update zoneAssignmentsStore on Hub
        let zoneRec = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zoneId);
        if (!zoneRec) {
          zoneRec = {
            zoneId,
            zoneName: zoneId,
            sessionId,
            branchId: hubBranchId,
            status: slot === 'A' ? 'AWAITING_DOUBLE_COUNT' : 'IN_PROGRESS',
          };
          zoneAssignmentsStore.push(zoneRec);
        }

        if (slot === 'A') {
          if (!zoneRec.teamA) {
            zoneRec.teamA = { deviceId, staffId, staffName, claimedAt: finalizedAtIso, submitted: true };
          }
          zoneRec.teamA.staffId = staffId;
          zoneRec.teamA.staffName = staffName;
          zoneRec.teamA.submitted = true;
          zoneRec.teamA.submittedAt = finalizedAtIso;
          zoneRec.teamA.finalized = true;
          zoneRec.teamA.finalizedAt = finalizedAtIso;
          zoneRec.teamA.lineCount = Array.isArray(lines) ? lines.length : 0;
          if (!zoneRec.teamB?.submitted) zoneRec.status = 'AWAITING_DOUBLE_COUNT';
        } else if (slot === 'B') {
          if (!zoneRec.teamB) {
            zoneRec.teamB = { deviceId, staffId, staffName, claimedAt: finalizedAtIso, submitted: true };
          }
          zoneRec.teamB.staffId = staffId;
          zoneRec.teamB.staffName = staffName;
          zoneRec.teamB.submitted = true;
          zoneRec.teamB.submittedAt = finalizedAtIso;
          zoneRec.teamB.finalized = true;
          zoneRec.teamB.finalizedAt = finalizedAtIso;
          zoneRec.teamB.lineCount = Array.isArray(lines) ? lines.length : 0;
          if (!zoneRec.teamA?.submitted) zoneRec.status = 'IN_PROGRESS';
        }

        // Authoritatively update session store on Hub
        const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        if (sessIdx >= 0) {
          const sess = stocktakeSessionsStore[sessIdx];
          if (Array.isArray(sess.segments)) {
            const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
            if (seg) {
              if (slot === 'A') {
                seg.hasCountA = true;
                seg.count1Submitted = true;
                seg.count1Finalized = true;
                seg.count1FinalizedAt = finalizedAtIso;
                seg.counterAId = staffId;
                seg.counterAName = staffName;
                if (!seg.count2Submitted) seg.status = 'AWAITING_DOUBLE_COUNT';
              } else if (slot === 'B') {
                seg.hasCountB = true;
                seg.count2Submitted = true;
                seg.count2Finalized = true;
                seg.count2FinalizedAt = finalizedAtIso;
                seg.counterBId = staffId;
                seg.counterBName = staffName;
              }
            }
          }
        }

        scheduleSave();

        try {
          const ackPacket = {
            type: 'STOCKTAKE_ACK_SUBMIT',
            sessionId,
            zoneId,
            slot,
            status: 'VAULTED',
            message: `Count for Zone ${zoneId} finalized & secured in Hub Vault. Awaiting Team ${slot === 'A' ? 'B' : 'A'} submission.`,
            timestamp: Date.now(),
          };
          ws.send(JSON.stringify(ackPacket));
        } catch (e) {}

        const statusPacket = {
          type: 'STOCKTAKE_ZONE_STATUS_UPDATE',
          sessionId,
          zoneId,
          slot,
          staffId,
          staffName,
          teamAStaffId: hubBlindStore[sessionId][zoneId].A?.staffId || zoneRec.teamA?.staffId,
          teamBStaffId: hubBlindStore[sessionId][zoneId].B?.staffId || zoneRec.teamB?.staffId,
          teamAStaffName: hubBlindStore[sessionId][zoneId].A?.staffName || zoneRec.teamA?.staffName,
          teamBStaffName: hubBlindStore[sessionId][zoneId].B?.staffName || zoneRec.teamB?.staffName,
          hasCountA: Boolean(hubBlindStore[sessionId][zoneId].A),
          hasCountB: Boolean(hubBlindStore[sessionId][zoneId].B),
          teamAFinalized: Boolean(hubBlindStore[sessionId][zoneId].A),
          teamBFinalized: Boolean(hubBlindStore[sessionId][zoneId].B),
          comparisonFinalized: Boolean(zoneRec.comparisonFinalized),
          status:
            hubBlindStore[sessionId][zoneId].A && hubBlindStore[sessionId][zoneId].B
              ? 'COMPARING'
              : slot === 'A'
              ? 'AWAITING_DOUBLE_COUNT'
              : 'IN_PROGRESS',
          zone: zoneRec,
          timestamp: Date.now(),
        };

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(statusPacket));
            } catch (e) {}
          }
        });

        const subA = hubBlindStore[sessionId][zoneId].A;
        const subB = hubBlindStore[sessionId][zoneId].B;

        if (subA && subB) {
          const mapA = new Map();
          const mapB = new Map();
          (subA.lines || []).forEach((l) => mapA.set((l.itemId || l.id || '').toUpperCase(), l));
          (subB.lines || []).forEach((l) => mapB.set((l.itemId || l.id || '').toUpperCase(), l));

          const allKeys = Array.from(new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]));
          const discrepancies = [];
          const verifiedCounts = [];

          allKeys.forEach((key) => {
            const itemA = mapA.get(key);
            const itemB = mapB.get(key);
            const baseItem = itemA || itemB;
            const upc = Math.max(1, Number(baseItem ? baseItem.unitsPerCase : 1) || 1);

            const aCases = Number(itemA ? itemA.cases : 0) || 0;
            const bCases = Number(itemB ? itemB.cases : 0) || 0;
            const aSingles = Number(itemA ? itemA.singles : 0) || 0;
            const bSingles = Number(itemB ? itemB.singles : 0) || 0;

            // Normalized total base units (e.g., 5 cases of 10 = 50 units; 50 singles = 50 units)
            const aTot = itemA && itemA.totalUnits !== undefined && itemA.totalUnits !== null
              ? Number(itemA.totalUnits)
              : (aCases * upc + aSingles);
            const bTot = itemB && itemB.totalUnits !== undefined && itemB.totalUnits !== null
              ? Number(itemB.totalUnits)
              : (bCases * upc + bSingles);

            // If neither team entered any count (0 units), it is not a discrepancy
            if (aTot === 0 && bTot === 0) {
              return;
            }

            // If normalized total units match, the count has BALANCED 100%
            if (aTot === bTot) {
              verifiedCounts.push({
                itemId: baseItem.itemId || key,
                itemName: baseItem.itemName || key,
                category: baseItem.category,
                sku: baseItem.sku,
                unitsPerCase: upc,
                cases: Math.floor(aTot / upc),
                singles: aTot % upc,
                totalUnits: aTot,
                source: 'MATCHED',
              });
            } else {
              discrepancies.push({
                itemId: baseItem.itemId || key,
                itemName: baseItem.itemName || key,
                sku: baseItem.sku || key,
                unitsPerCase: upc,
                teamACases: aCases,
                teamASingles: aSingles,
                teamATotalUnits: aTot,
                teamBCases: bCases,
                teamBSingles: bSingles,
                teamBTotalUnits: bTot,
                differenceUnits: Math.abs(aTot - bTot),
              });
            }
          });

          if (discrepancies.length === 0) {
            const matchIso = new Date().toISOString();
            console.log(`[Termux Hub] ✅ Zone ${zoneId} DOUBLE-COUNT MATCHED 100% (${verifiedCounts.length} lines verified).`);
            if (zoneRec) {
              zoneRec.status = 'VERIFIED';
              zoneRec.verifiedCounts = verifiedCounts;
              zoneRec.comparisonFinalized = true;
              zoneRec.comparisonFinalizedAt = matchIso;
              zoneRec.comparisonFinalizedBy = `${subA.staffName || 'Team A'} & ${subB.staffName || 'Team B'}`;
            }
            if (sessIdx >= 0) {
              const sess = stocktakeSessionsStore[sessIdx];
              if (Array.isArray(sess.segments)) {
                const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
                if (seg) {
                  seg.status = 'VERIFIED';
                  seg.verifiedCounts = verifiedCounts;
                  seg.discrepancyCount = 0;
                  seg.recount = [];
                  seg.hasCountA = true;
                  seg.hasCountB = true;
                  seg.count1Submitted = true;
                  seg.count2Submitted = true;
                  seg.count1Finalized = true;
                  seg.count2Finalized = true;
                  seg.comparisonFinalized = true;
                  seg.comparisonFinalizedAt = matchIso;
                  seg.comparisonFinalizedBy = `${subA.staffName || 'Team A'} & ${subB.staffName || 'Team B'}`;
                }
              }
            }
            scheduleSave();

            const verifiedPacket = {
              type: 'STOCKTAKE_MATCH_VERIFIED',
              sessionId,
              zoneId,
              status: 'VERIFIED',
              comparisonFinalized: true,
              verifiedCounts,
              verifiedCount: verifiedCounts.length,
              zone: zoneRec,
              timestamp: Date.now(),
            };
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify(verifiedPacket));
                } catch (e) {}
              }
            });
          } else {
            console.log(`[Termux Hub] ⚠️ Zone ${zoneId} DISCREPANCY: ${discrepancies.length} variance item(s), preserving ${verifiedCounts.length} matched line(s). Alerting Teams A & B.`);
            if (zoneRec) {
              zoneRec.status = 'VARIANCE_FLAGGED';
              zoneRec.discrepancies = discrepancies;
              zoneRec.verifiedCounts = verifiedCounts;
            }
            if (sessIdx >= 0) {
              const sess = stocktakeSessionsStore[sessIdx];
              if (Array.isArray(sess.segments)) {
                const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
                if (seg) {
                  seg.status = 'DISCREPANCY_RECOUNT';
                  seg.discrepancies = discrepancies;
                  seg.discrepancyCount = discrepancies.length;
                  seg.verifiedCounts = verifiedCounts;
                  seg.hasCountA = true;
                  seg.hasCountB = true;
                  seg.count1Submitted = true;
                  seg.count2Submitted = true;
                }
                sess.status = 'RECOUNTING';
              }
            }
            scheduleSave();

            const variancePacket = {
              type: 'STOCKTAKE_VARIANCE_ALERT',
              sessionId,
              zoneId,
              status: 'VARIANCE_FLAGGED',
              discrepancies,
              discrepancyCount: discrepancies.length,
              verifiedCounts,
              matchedCount: verifiedCounts.length,
              teamAStaffName: subA.staffName,
              teamBStaffName: subB.staffName,
              zone: zoneRec,
              timestamp: Date.now(),
            };
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify(variancePacket));
                } catch (e) {}
              }
            });
          }
        }
        return;
      }

      // 0.49 STOCKTAKE PEER JOINT RECOUNT PROPOSAL
      if (pType === 'STOCKTAKE_JOINT_PROPOSAL') {
        const incomingTime = getTimestamp(packet);
        const existingZone = zoneAssignmentsStore.find((z) => z.zoneId === packet.zoneId && (!packet.sessionId || z.sessionId === packet.sessionId));
        const existingTime = existingZone?.jointRecount?.proposedAt ? getTimestamp({ updatedAt: existingZone.jointRecount.proposedAt }) : (existingZone ? getTimestamp(existingZone) : 0);
        if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
          console.log(`[Termux Hub] 🛡️ LWW Reject: Stale STOCKTAKE_JOINT_PROPOSAL for Zone ${packet.zoneId}`);
          return;
        }

        const sessionId = packet.sessionId;
        const zoneId = packet.zoneId;
        const slot = packet.proposedBySlot || packet.slot || 'A';
        const staffName = packet.proposedByName || packet.staffName || `Team ${slot}`;
        const lines = packet.recountLines || packet.lines || [];

        console.log(`[Termux Hub] ✍️ Joint Recount PROPOSAL from Team ${slot} (${staffName}) for Zone ${zoneId} (${lines.length} lines). Forwarding to peers.`);

        let zoneRec = zoneAssignmentsStore.find((z) => z.zoneId === zoneId && (!sessionId || z.sessionId === sessionId));
        if (!zoneRec) {
          zoneRec = {
            zoneId,
            zoneName: packet.zoneName || `Zone ${zoneId}`,
            sessionId: sessionId || 'DEFAULT',
            branchId: packet.branchId || hubBranchId,
            status: 'VARIANCE_FLAGGED',
          };
          zoneAssignmentsStore.push(zoneRec);
        }

        if (!zoneRec.jointRecount) {
          zoneRec.jointRecount = {
            signedByA: false,
            signedByB: false,
            lines: [],
          };
        }

        zoneRec.jointRecount.lines = lines;
        zoneRec.jointRecount.proposedBy = slot;
        zoneRec.jointRecount.proposedByName = staffName;
        zoneRec.jointRecount.proposedAt = Date.now();
        if (slot === 'A') zoneRec.jointRecount.signedByA = true;
        if (slot === 'B') zoneRec.jointRecount.signedByB = true;

        // Sync with stocktakeSessionsStore
        const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        if (sessIdx >= 0) {
          const sess = stocktakeSessionsStore[sessIdx];
          if (Array.isArray(sess.segments)) {
            const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
            if (seg) {
              seg.jointRecount = zoneRec.jointRecount;
            }
          }
        }

        scheduleSave();

        // Broadcast proposal packet to all other connected peers
        const proposalBroadcast = {
          type: 'STOCKTAKE_JOINT_PROPOSAL',
          sessionId,
          zoneId,
          proposedBySlot: slot,
          proposedByName: staffName,
          recountLines: lines,
          signedByA: zoneRec.jointRecount.signedByA,
          signedByB: zoneRec.jointRecount.signedByB,
          zone: zoneRec,
          timestamp: Date.now(),
        };

        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(proposalBroadcast));
            } catch (e) {}
          }
        });
        return;
      }

      // 0.50 STOCKTAKE JOINT RECOUNT FINALIZED (DUAL-SIGNATURE COMPLETE)
      if (pType === 'STOCKTAKE_JOINT_FINALIZED') {
        const incomingTime = getTimestamp(packet);
        const existingZone = zoneAssignmentsStore.find((z) => z.zoneId === packet.zoneId && (!packet.sessionId || z.sessionId === packet.sessionId));
        if (existingZone?.comparisonFinalized) {
          try {
            ws.send(JSON.stringify({
              type: 'STOCKTAKE_SLOT_LOCKED',
              sessionId: packet.sessionId,
              zoneId: packet.zoneId,
              message: 'Segment joint recount comparison is already finalized & locked. Auditor unlock required.',
              timestamp: Date.now(),
            }));
          } catch (e) {}
          return;
        }
        const existingTime = existingZone?.jointRecount?.resolvedAt ? getTimestamp({ updatedAt: existingZone.jointRecount.resolvedAt }) : (existingZone ? getTimestamp(existingZone) : 0);
        if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
          console.log(`[Termux Hub] 🛡️ LWW Reject: Stale STOCKTAKE_JOINT_FINALIZED for Zone ${packet.zoneId}`);
          return;
        }

        const sessionId = packet.sessionId;
        const zoneId = packet.zoneId;
        const resolvedLines = packet.resolvedLines || packet.lines || [];
        const staffName = packet.resolvedByName || packet.staffName || 'Dual Counters';
        const resolvedIso = new Date().toISOString();

        // Preserve ALL initially matched lines from blindVaultStore + existing zone/segment verifiedCounts,
        // then overlay resolvedLines on top so matched lines are NEVER discarded on joint recount!
        const mergedMap = new Map();
        const addVerifiedEntry = (raw, forcedSource) => {
          if (!raw || !raw.itemId) return;
          const k = String(raw.itemId).trim().toUpperCase();
          const upc = Math.max(1, Number(raw.unitsPerCase || 1));
          const tot =
            raw.totalUnits !== undefined && raw.totalUnits !== null
              ? Number(raw.totalUnits)
              : Number(raw.cases || 0) * upc + Number(raw.singles || 0);
          const prev = mergedMap.get(k);
          mergedMap.set(k, {
            itemId: raw.itemId,
            itemName: raw.itemName || prev?.itemName || raw.itemId,
            category: raw.category ?? prev?.category,
            sku: raw.sku ?? prev?.sku,
            unitsPerCase: upc,
            cases: Math.floor(tot / upc),
            singles: tot % upc,
            totalUnits: tot,
            source: forcedSource || raw.source || prev?.source || 'MATCHED',
            resolvedBy: forcedSource ? staffName : (raw.resolvedBy || prev?.resolvedBy),
          });
        };

        // 1. Reconstruct matched lines from blindVaultStore if both Team A & Team B submissions exist
        const vaultKey = `${sessionId || 'DEFAULT'}_${zoneId}`;
        const vaultEntry = blindVaultStore[vaultKey];
        if (vaultEntry?.countA?.lines && vaultEntry?.countB?.lines) {
          const vMapA = new Map();
          const vMapB = new Map();
          (vaultEntry.countA.lines || []).forEach((l) => {
            if (l && l.itemId) vMapA.set(String(l.itemId).trim().toUpperCase(), l);
          });
          (vaultEntry.countB.lines || []).forEach((l) => {
            if (l && l.itemId) vMapB.set(String(l.itemId).trim().toUpperCase(), l);
          });
          new Set([...vMapA.keys(), ...vMapB.keys()]).forEach((k) => {
            const a = vMapA.get(k);
            const b = vMapB.get(k);
            const base = a || b;
            if (!base) return;
            const upc = Math.max(1, Number(base.unitsPerCase || 1));
            const aTot = a ? (a.totalUnits !== undefined && a.totalUnits !== null ? Number(a.totalUnits) : Number(a.cases || 0) * upc + Number(a.singles || 0)) : 0;
            const bTot = b ? (b.totalUnits !== undefined && b.totalUnits !== null ? Number(b.totalUnits) : Number(b.cases || 0) * upc + Number(b.singles || 0)) : 0;
            if (aTot === bTot && aTot > 0) {
              addVerifiedEntry({ ...base, unitsPerCase: upc, cases: Math.floor(aTot / upc), singles: aTot % upc, totalUnits: aTot, source: 'MATCHED' });
            }
          });
        }

        let zoneRec = zoneAssignmentsStore.find((z) => z.zoneId === zoneId && (!sessionId || z.sessionId === sessionId));
        if (zoneRec && Array.isArray(zoneRec.verifiedCounts)) {
          zoneRec.verifiedCounts.forEach((v) => addVerifiedEntry(v));
        }

        const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        const existingSegForMerge =
          sessIdx >= 0 && Array.isArray(stocktakeSessionsStore[sessIdx].segments)
            ? stocktakeSessionsStore[sessIdx].segments.find((s) => (s.segmentId || s.id) === zoneId)
            : null;
        if (existingSegForMerge && Array.isArray(existingSegForMerge.verifiedCounts)) {
          existingSegForMerge.verifiedCounts.forEach((v) => addVerifiedEntry(v));
        }

        const segIdx = stocktakeSegmentsStore.findIndex((sg) => (sg.segmentId || sg.id) === zoneId);
        if (segIdx >= 0 && Array.isArray(stocktakeSegmentsStore[segIdx].verifiedCounts)) {
          stocktakeSegmentsStore[segIdx].verifiedCounts.forEach((v) => addVerifiedEntry(v));
        }

        // 2. Overlay resolved joint-recount lines on top
        resolvedLines.forEach((r) => addVerifiedEntry(r, 'JOINT_RECOUNT'));
        const finalVerifiedCounts = Array.from(mergedMap.values());

        console.log(`[Termux Hub] 🏆 Zone ${zoneId} JOINT RECOUNT FINALIZED & VERIFIED by ${staffName} (${resolvedLines.length} recounted -> ${finalVerifiedCounts.length} total verified lines).`);

        if (zoneRec) {
          zoneRec.status = 'VERIFIED';
          zoneRec.verifiedCounts = finalVerifiedCounts;
          zoneRec.comparisonFinalized = true;
          zoneRec.comparisonFinalizedAt = resolvedIso;
          zoneRec.comparisonFinalizedBy = staffName;
          if (!zoneRec.jointRecount) zoneRec.jointRecount = {};
          zoneRec.jointRecount.signedByA = true;
          zoneRec.jointRecount.signedByB = true;
          zoneRec.jointRecount.resolvedAt = Date.now();
          zoneRec.jointRecount.resolvedByName = staffName;
          zoneRec.jointRecount.lines = resolvedLines;
        }

        if (existingSegForMerge) {
          existingSegForMerge.status = 'VERIFIED';
          existingSegForMerge.verifiedCounts = finalVerifiedCounts;
          existingSegForMerge.discrepancies = [];
          existingSegForMerge.discrepancyCount = 0;
          existingSegForMerge.comparisonFinalized = true;
          existingSegForMerge.comparisonFinalizedAt = resolvedIso;
          existingSegForMerge.comparisonFinalizedBy = staffName;
        }

        if (segIdx >= 0) {
          stocktakeSegmentsStore[segIdx].status = 'VERIFIED';
          stocktakeSegmentsStore[segIdx].verifiedCounts = finalVerifiedCounts;
          stocktakeSegmentsStore[segIdx].discrepancies = [];
          stocktakeSegmentsStore[segIdx].discrepancyCount = 0;
          stocktakeSegmentsStore[segIdx].comparisonFinalized = true;
          stocktakeSegmentsStore[segIdx].comparisonFinalizedAt = resolvedIso;
          stocktakeSegmentsStore[segIdx].comparisonFinalizedBy = staffName;
        }

        scheduleSave();

        // Broadcast verification & status updates to all peers with FULL merged verifiedCounts
        const verifiedPacket = {
          type: 'STOCKTAKE_MATCH_VERIFIED',
          sessionId,
          zoneId,
          status: 'VERIFIED',
          comparisonFinalized: true,
          verifiedCounts: finalVerifiedCounts,
          resolvedByName: staffName,
          source: 'JOINT_RECOUNT',
          timestamp: Date.now(),
        };

        const statusPacket = {
          type: 'STOCKTAKE_ZONE_STATUS_UPDATE',
          sessionId,
          zoneId,
          status: 'VERIFIED',
          comparisonFinalized: true,
          verifiedCounts: finalVerifiedCounts,
          timestamp: Date.now(),
        };

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(verifiedPacket));
              client.send(JSON.stringify(statusPacket));
            } catch (e) {}
          }
        });
        return;
      }

      // 0.51 STOCKTAKE SEGMENT UNLOCK (AUDITOR / LEADER CORRECTION RE-OPEN)
      if (pType === 'STOCKTAKE_SEGMENT_UNLOCK') {
        const { sessionId, zoneId, segmentId, target = 'ALL', actorId = 'AUDITOR', actorName = 'Auditor', reason = 'Auditor correction unlock' } = packet;
        const zId = segmentId || zoneId;
        if (sessionId && zId) {
          const nowIso = new Date().toISOString();
          if (hubBlindStore[sessionId] && hubBlindStore[sessionId][zId]) {
            if (target === 'A' || target === 'ALL') hubBlindStore[sessionId][zId].A = null;
            if (target === 'B' || target === 'ALL') hubBlindStore[sessionId][zId].B = null;
            saveBlindVault();
          }

          const zoneRec = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zId);
          if (zoneRec) {
            if ((target === 'A' || target === 'ALL') && zoneRec.teamA) {
              zoneRec.teamA.submitted = false;
              zoneRec.teamA.finalized = false;
            }
            if ((target === 'B' || target === 'ALL') && zoneRec.teamB) {
              zoneRec.teamB.submitted = false;
              zoneRec.teamB.finalized = false;
            }
            zoneRec.comparisonFinalized = false;
            zoneRec.unlockedReason = reason;
            zoneRec.unlockedByName = actorName;
            zoneRec.unlockedAt = nowIso;
            zoneRec.status = target === 'COMPARISON' && zoneRec.discrepancies?.length ? 'VARIANCE_FLAGGED' : 'IN_PROGRESS';
          }

          const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          if (sessIdx >= 0) {
            const sess = stocktakeSessionsStore[sessIdx];
            if (Array.isArray(sess.segments)) {
              const seg = sess.segments.find((s) => (s.segmentId || s.id) === zId);
              if (seg) {
                if (target === 'A' || target === 'ALL') {
                  seg.count1Finalized = false;
                  seg.count1FinalizedAt = undefined;
                  seg.hasCountA = false;
                  seg.count1Submitted = false;
                }
                if (target === 'B' || target === 'ALL') {
                  seg.count2Finalized = false;
                  seg.count2FinalizedAt = undefined;
                  seg.hasCountB = false;
                  seg.count2Submitted = false;
                }
                if (target === 'COMPARISON' || target === 'ALL' || target === 'A' || target === 'B') {
                  seg.comparisonFinalized = false;
                  seg.comparisonFinalizedAt = undefined;
                  seg.comparisonFinalizedBy = undefined;
                }
                seg.status = target === 'COMPARISON' && (seg.discrepancies?.length || seg.recount?.length)
                  ? 'DISCREPANCY_RECOUNT'
                  : 'COUNTING';
                seg.unlockHistory = [
                  ...(Array.isArray(seg.unlockHistory) ? seg.unlockHistory : []),
                  { target, actorId, actorName, reason, unlockedAt: nowIso },
                ];
              }
            }
            if (sess.status === 'CONSOLIDATED' || sess.status === 'READY_FOR_COMMITTAL') {
              sess.status = 'COUNTING';
            }
          }

          scheduleSave();
          console.log(`[Termux Hub] 🔓 Segment ${zId} (${target}) unlocked by ${actorName}: ${reason}`);

          const unlockBroadcast = {
            type: 'STOCKTAKE_SEGMENT_UNLOCKED',
            sessionId,
            zoneId: zId,
            segmentId: zId,
            target,
            actorId,
            actorName,
            reason,
            unlockedAt: nowIso,
            timestamp: Date.now(),
          };
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(unlockBroadcast));
              } catch (e) {}
            }
          });
        }
        return;
      }

      // =====================================================================
      // 1. TRANSACTIONAL DATA: SALES INVOICES (APPEND-ONLY, NO TIMESTAMP REJECTION)
      // =====================================================================
      const isSale = pType === 'SALE' || pType === 'SALE_RECORD' || pType === 'SALE_UPDATE' || pType === 'SALE_CREATED' || !!packet.sale;
      const saleObj = packet.sale || (packet.data && (packet.data.items || packet.data.total !== undefined ? packet.data : packet.data.sale)) || packet.payload;
      const saleId =
        (saleObj && (saleObj.id || saleObj.invoice_id || saleObj.invoiceId)) ||
        packet.invoice_id ||
        packet.invoiceId ||
        packet.id ||
        (packet.data && (packet.data.invoice_id || packet.data.id));

      if (isSale && saleId) {
        const senderDeviceId = packet.origin_device_id || packet.originDeviceId || packet.deviceId || 'UNKNOWN-DEVICE';
        const isSaleMutation =
          pType === 'SALE_UPDATE' ||
          saleObj?.status === 'Refunded' ||
          saleObj?.status === 'Voided' ||
          Boolean(saleObj?.mobileVerificationStatus);
        if (!isSaleMutation) {
          const saleClockCheck = validatePacketClock(ws, packet, saleObj, senderDeviceId, 'SALE');
          if (!saleClockCheck.accepted) {
            return;
          }
        }
        const isLegacyInv = String(saleId).toUpperCase().startsWith('INV-');
        const existingIdx = salesStore.findIndex((s) => s.id === saleId);
        const prevSale = existingIdx >= 0 ? salesStore[existingIdx] : null;
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, saleObj);
        const resolvedCloudSynced = incomingCloudSynced || Boolean(prevSale && prevSale.isCloudSynced === true);
        const attachedReversalLogs = Array.isArray(saleObj?.reversalCashLogs)
          ? saleObj.reversalCashLogs
          : Array.isArray(packet.reversalCashLogs)
          ? packet.reversalCashLogs
          : [];
        const cleanSaleObj = saleObj && typeof saleObj === 'object' ? { ...saleObj } : saleObj;
        if (cleanSaleObj && 'reversalCashLogs' in cleanSaleObj) {
          delete cleanSaleObj.reversalCashLogs;
        }

        if (existingIdx >= 0) {
          // THE VOID EXCEPTION:
          // If the Hub already has the invoice marked as Voided or Refunded, and the device sends
          // an old version marked as Completed, the Hub MUST reject the old version and send the
          // authoritative Voided/Refunded status back to the device.
          const isExistingVoidOrRefund = prevSale.status === 'Voided' || prevSale.status === 'Refunded';
          const isIncomingCompleted = cleanSaleObj.status !== 'Voided' && cleanSaleObj.status !== 'Refunded';

          if (isExistingVoidOrRefund && isIncomingCompleted) {
            console.log(`[Termux Hub] 🛡️ Rejected stale Completed status for Sale #${saleId}. Hub is authoritative: invoice is ${prevSale.status}.`);
            try {
              ws.send(JSON.stringify({
                type: 'SALE_UPDATE',
                action: 'SALE_UPDATE',
                invoice_id: saleId,
                sale: prevSale,
                payload: prevSale,
                status: prevSale.status,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }

          const isExistingMobFinal = prevSale.mobileVerificationStatus === 'VERIFIED' || prevSale.mobileVerificationStatus === 'FLAGGED';
          const isIncomingMobPending = !cleanSaleObj?.mobileVerificationStatus || cleanSaleObj.mobileVerificationStatus === 'PENDING';
          if (isExistingMobFinal && isIncomingMobPending && isIncomingCompleted) {
            console.log(`[Termux Hub] 🛡️ Preserved authoritative mobile verification (${prevSale.mobileVerificationStatus}) for Sale #${saleId}.`);
            try {
              ws.send(JSON.stringify({
                type: 'SALE_UPDATE',
                action: 'SALE_UPDATE',
                invoice_id: saleId,
                sale: prevSale,
                payload: prevSale,
                status: prevSale.status,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }

          // Otherwise update existing record (e.g. cashier issuing refund/void, exchange, or mobile money verification)
          const nowHubMs = Date.now();
          const statusOrVerifyChanged =
            (cleanSaleObj?.status && cleanSaleObj.status !== prevSale?.status) ||
            (cleanSaleObj?.mobileVerificationStatus && cleanSaleObj.mobileVerificationStatus !== prevSale?.mobileVerificationStatus) ||
            Boolean(cleanSaleObj?.hasExchanges && !prevSale?.hasExchanges);
          const mergedSale = {
            ...salesStore[existingIdx],
            ...(cleanSaleObj || packet),
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
            ...(statusOrVerifyChanged
              ? {
                  updatedAt: Math.max(nowHubMs, Number(cleanSaleObj?.updatedAt) || 0),
                  hubTimestamp: nowHubMs,
                  lastUpdated: new Date(nowHubMs).toISOString(),
                }
              : {}),
          };
          if (isExistingMobFinal && isIncomingMobPending) {
            mergedSale.mobileVerificationStatus = prevSale.mobileVerificationStatus;
            mergedSale.mobileVerifiedAmountInCurrency = prevSale.mobileVerifiedAmountInCurrency;
            mergedSale.mobileExpectedAmountInCurrency = prevSale.mobileExpectedAmountInCurrency;
            mergedSale.mobileVerifiedRef = prevSale.mobileVerifiedRef;
            mergedSale.mobileVerifiedBy = prevSale.mobileVerifiedBy;
            mergedSale.mobileVerifiedByName = prevSale.mobileVerifiedByName;
            mergedSale.mobileVerifiedAt = prevSale.mobileVerifiedAt;
            mergedSale.mobileDisputeReason = prevSale.mobileDisputeReason;
            mergedSale.mobileDisputeResolution = prevSale.mobileDisputeResolution;
            mergedSale.mobileShortfallUsd = prevSale.mobileShortfallUsd;
          }
          salesStore[existingIdx] = mergedSale;
        } else {
          // APPEND-ONLY: Offline invoices arriving with old timestamps (e.g. offline for 5 hours)
          // MUST BE ACCEPTED as long as the invoice_id is unique! NO TIMESTAMP REJECTION!
          salesStore.unshift({
            ...(cleanSaleObj || packet),
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
          });
          console.log(`[Termux Hub] 📥 Accepted Offline/Online Sale #${saleId} (Append-Only${resolvedCloudSynced ? ', cloud-synced' : ''})`);
        }

        if (attachedReversalLogs.length > 0) {
          attachedReversalLogs.forEach((cl) => upsertHubCashLog(cl, incomingCloudSynced));
        }

        // Inventory movements: New Sale, Refund, Void, and Item Exchange
        const isNewRefund = saleObj?.status === 'Refunded' && prevSale?.status !== 'Refunded';
        const isNewVoid = saleObj?.status === 'Voided' && prevSale?.status !== 'Voided';

        if (saleObj && Array.isArray(saleObj.items)) {
          for (const it of saleObj.items) {
            if (!it || !it.id) continue;
            const invIdx = inventoryStore.findIndex((i) => i.itemId === it.id || i.id === it.id);
            if (invIdx >= 0) {
              const curUnits = normalizeHubStockFields(inventoryStore[invIdx]).totalUnits;
              const qty = Number(it.quantity || 0);
              let newUnits = curUnits;

              if (isNewRefund || isNewVoid) {
                newUnits = roundHubUnits(curUnits + qty);
                console.log(`[Termux Hub] Restocked ${qty}x ${it.name || it.id} from ${isNewRefund ? 'Refund' : 'Void'} on #${saleId}`);
              } else if (!prevSale && saleObj.status !== 'Refunded' && saleObj.status !== 'Voided') {
                newUnits = roundHubUnits(curUnits - qty);
              }

              applyHubStockUnits(inventoryStore[invIdx], newUnits);
              broadcastInventorySnapshot(inventoryStore[invIdx]);
            }
          }
        }

        // Handle item exchanges on immutable invoices
        if (saleObj && Array.isArray(saleObj.exchanges)) {
          const prevExchangeCount = (prevSale && Array.isArray(prevSale.exchanges)) ? prevSale.exchanges.length : 0;
          const newExchanges = saleObj.exchanges.slice(prevExchangeCount);
          for (const ex of newExchanges) {
            if (ex.returnedItem?.id && ex.returnedItem.restockCondition === 'restock') {
              const retIdx = inventoryStore.findIndex((i) => i.itemId === ex.returnedItem.id || i.id === ex.returnedItem.id);
              if (retIdx >= 0) {
                const cur = normalizeHubStockFields(inventoryStore[retIdx]).totalUnits;
                const retUnits = roundHubUnits(cur + Number(ex.returnedItem.quantity || 1));
                applyHubStockUnits(inventoryStore[retIdx], retUnits);
                broadcastInventorySnapshot(inventoryStore[retIdx]);
                console.log(`[Termux Hub] Restocked returned exchange item: +${ex.returnedItem.quantity}x ${ex.returnedItem.name}`);
              }
            }
            if (ex.replacementItem?.id) {
              const repIdx = inventoryStore.findIndex((i) => i.itemId === ex.replacementItem.id || i.id === ex.replacementItem.id);
              if (repIdx >= 0) {
                const cur = normalizeHubStockFields(inventoryStore[repIdx]).totalUnits;
                const repUnits = roundHubUnits(cur - Number(ex.replacementItem.quantity || 1));
                applyHubStockUnits(inventoryStore[repIdx], repUnits);
                broadcastInventorySnapshot(inventoryStore[repIdx]);
                console.log(`[Termux Hub] Depleted replacement exchange item: -${ex.replacementItem.quantity}x ${ex.replacementItem.name}`);
              }
            }
          }
        }

        // =====================================================================
        // 1.1 POS PARENT-CHILD EXTRACTION (CUSTOMER CHANGE & CREDIT SALES)
        // =====================================================================
        const amountToLeaveBehind =
          saleObj?.changeAmountLeftBehind !== undefined
            ? Number(saleObj.changeAmountLeftBehind)
            : (Number(saleObj?.changeDue) || 0);

        if (saleObj && saleObj.changeLeftBehind && amountToLeaveBehind > 0) {
          const chgId = `CHG-${saleId}`;
          const existingChgIdx = customerChangesStore.findIndex(
            (c) => c.id === chgId || c.changeId === chgId || c.reference === saleId || (c.notes && c.notes.includes(saleId))
          );
          if (existingChgIdx < 0) {
            const chgEntry = {
              id: chgId,
              changeId: chgId,
              timestamp: saleObj.timestamp || new Date().toISOString(),
              date: saleObj.date || (saleObj.timestamp ? saleObj.timestamp.split('T')[0] : new Date().toISOString().split('T')[0]),
              staffId: saleObj.staffId || '001',
              staffName: saleObj.staffName || 'Cashier',
              customerId: saleObj.customerId || '',
              customerName: saleObj.customerName || 'Customer',
              company_id: saleObj.company_id || saleObj.companyId || hubTenantId,
              branch_id: saleObj.branch_id || saleObj.branchId || hubBranchId,
              in: amountToLeaveBehind,
              out: 0,
              notes: `Change left behind (${amountToLeaveBehind.toFixed(2)}) from POS Invoice #${saleId}`,
              reference: saleId,
            };
            customerChangesStore.unshift(chgEntry);
            console.log(`[Termux Hub] 📥 Extracted Child Customer Change [${chgId}] from Sale #${saleId} ($${amountToLeaveBehind})`);
          }
        }

        if (saleObj && (saleObj.paymentMethod === 'Credit' || (saleObj.creditAmount && Number(saleObj.creditAmount) > 0))) {
          const crdId = `CR-${saleId}`;
          const existingCrdIdx = creditSalesStore.findIndex(
            (c) => c.id === crdId || c.creditId === crdId || (c.notes && c.notes.includes(saleId))
          );
          if (existingCrdIdx < 0) {
            const deposit = Number(saleObj.creditDeposit) || 0;
            const totalCreditAmount =
              saleObj.creditAmount !== undefined && Number(saleObj.creditAmount) > 0
                ? Number(saleObj.creditAmount)
                : Number(saleObj.total || 0);
            const crdEntry = {
              id: crdId,
              creditId: crdId,
              timestamp: saleObj.timestamp || new Date().toISOString(),
              date: saleObj.date || (saleObj.timestamp ? saleObj.timestamp.split('T')[0] : new Date().toISOString().split('T')[0]),
              staffId: saleObj.staffId || '001',
              staffName: saleObj.staffName || 'Staff',
              customerId: saleObj.customerId || '',
              customerName: saleObj.customerName || 'Customer',
              company_id: saleObj.company_id || saleObj.companyId || hubTenantId,
              branch_id: saleObj.branch_id || saleObj.branchId || hubBranchId,
              amount: totalCreditAmount,
              out: totalCreditAmount,
              in: deposit,
              itemDescription: saleObj.itemsSummary || 'POS Goods on Credit',
              dueDate: saleObj.creditDueDate || '',
              notes: `POS Credit Sale Invoice #${saleId}${deposit > 0 ? ` (${deposit.toFixed(2)} deposit paid)` : ''}`,
              status: deposit >= totalCreditAmount && totalCreditAmount > 0 ? 'Paid' : (deposit > 0 ? 'Partial' : 'Pending'),
            };
            creditSalesStore.unshift(crdEntry);
            console.log(`[Termux Hub] 📥 Extracted Child Credit Sale [${crdId}] from Sale #${saleId} ($${totalCreditAmount})`);
          }
        }

        scheduleSave();

        // Send point-to-point SYNC_RECEIPT ACK directly back to the sending device (non-legacy only)
        if (!isLegacyInv) {
          try {
            const ackPacket = {
              type: 'SYNC_RECEIPT',
              action: 'SYNC_RECEIPT',
              invoice_id: saleId,
              origin_device_id: 'LOCAL_HUB',
              origin_device_name: 'Termux Local Hub',
              timestamp: Date.now(),
            };
            ws.send(JSON.stringify(ackPacket));
            console.log(`[Termux Hub] Sale #${saleId} recorded. Sent SYNC_RECEIPT ACK to sender.`);
          } catch (ackErr) {}
        }

        if (incomingCloudSynced) {
          console.log(`[Termux Hub] ⏭️ Dual-Writer Skip: Sale #${saleId} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
          broadcastCloudSyncAck(ws, 'SALE', saleId);
        }
      }

      // =====================================================================
      // 2. TRANSACTIONAL DATA: DIRECT GOODS RECEIVED VOUCHERS (GRVs) (APPEND-ONLY)
      // =====================================================================
      const isGrv =
        pType === 'DIRECT_GRV' ||
        pType === 'GRV' ||
        pType === 'GRN' ||
        sheetName === 'Direct_GRV' ||
        entityType === 'grv' ||
        !!packet.directGrv ||
        (payload && payload.grvNumber);

      if (isGrv) {
        const grv = packet.directGrv || payload || packet.grv;
        if (grv && (grv.grvNumber || grv.id)) {
          const gId = grv.grvNumber || grv.id;
          const exIdx = directGrvsStore.findIndex((g) => g.grvNumber === gId || g.id === gId);
          const prevGrv = exIdx >= 0 ? directGrvsStore[exIdx] : null;
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, grv);
          const resolvedCloudSynced = incomingCloudSynced || Boolean(prevGrv && prevGrv.isCloudSynced === true);

          if (exIdx >= 0) {
            // Protect approved/rejected status from stale pending packets
            const isFinalized = prevGrv.status === 'APPROVED' || prevGrv.status === 'REJECTED';
            if (isFinalized && grv.status === 'PENDING') {
              console.log(`[Termux Hub] 🛡️ Retained final status ${prevGrv.status} for GRV #${gId}.`);
              try {
                ws.send(JSON.stringify({
                  type: 'DIRECT_GRV',
                  action: 'GRV_RECORD',
                  grvNumber: gId,
                  directGrv: prevGrv,
                  payload: prevGrv,
                  timestamp: Date.now(),
                }));
              } catch (e) {}
              return;
            }
            const mergedGrv = {
              ...directGrvsStore[exIdx],
              ...grv,
              ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
            };
            // Monotonic payment protection: never downgrade a PAID Direct GRV or raise unpaidBalance from a stale packet
            if (prevGrv.paymentStatus === 'PAID' && mergedGrv.paymentStatus !== 'PAID') {
              mergedGrv.paymentStatus = 'PAID';
              mergedGrv.unpaidBalance = 0;
            }
            if (prevGrv.paidVoucherId && !mergedGrv.paidVoucherId) {
              mergedGrv.paidVoucherId = prevGrv.paidVoucherId;
            }
            if (
              prevGrv.unpaidBalance !== undefined &&
              mergedGrv.unpaidBalance !== undefined &&
              Number(mergedGrv.unpaidBalance) > Number(prevGrv.unpaidBalance)
            ) {
              mergedGrv.unpaidBalance = prevGrv.unpaidBalance;
            }
            directGrvsStore[exIdx] = mergedGrv;
          } else {
            // Append-Only: Accept unique offline GRVs regardless of timestamp!
            directGrvsStore.unshift({
              ...grv,
              ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
            });
            console.log(`[Termux Hub] 📥 Accepted Offline/Online Direct GRV #${gId} (Append-Only)`);
          }

          const isNewlyRejected = grv.status === 'REJECTED' && prevGrv && prevGrv.status !== 'REJECTED';
          const isNewlyApprovedOrCreated = grv.status !== 'REJECTED' && (!prevGrv || prevGrv.status === 'REJECTED');

          if (isNewlyRejected && Array.isArray(grv.items)) {
            for (const item of grv.items) {
              const cleanId = (item.productId || item.itemId || item.id || '').trim();
              if (!cleanId) continue;
              const unitsToDeduct = Number(item.quantity || 0);
              const invIdx = inventoryStore.findIndex(
                (i) => i.itemId === cleanId || i.id === cleanId || (item.productName && i.itemName === item.productName)
              );
              if (invIdx >= 0) {
                const curUnits = normalizeHubStockFields(inventoryStore[invIdx]).totalUnits;
                applyHubStockUnits(inventoryStore[invIdx], Math.max(0, roundHubUnits(curUnits - unitsToDeduct)));
                broadcastInventorySnapshot(inventoryStore[invIdx]);
                console.log(`[Termux Hub] Reverted ${unitsToDeduct}x ${item.productName || cleanId} from rejected GRV #${gId}`);
              }
            }
          } else if (isNewlyApprovedOrCreated && Array.isArray(grv.items)) {
            for (const item of grv.items) {
              const cleanId = (item.productId || item.itemId || item.id || '').trim();
              if (!cleanId) continue;
              const unitsToAdd = Number(item.quantity || 0);
              const invIdx = inventoryStore.findIndex(
                (i) => i.itemId === cleanId || i.id === cleanId || (item.productName && i.itemName === item.productName)
              );
              if (invIdx >= 0) {
                const target = inventoryStore[invIdx];
                const curUnits = normalizeHubStockFields(target).totalUnits;
                const upc = Math.max(1, Number(target.unitsPerCase) || 1);
                const fallbackUnitCost = Number(item.costPrice || (item.costPerCase ? Number(item.costPerCase) / upc : 0)) || 0;
                const receivedTotalCents =
                  item.lineTotalCents !== undefined && Number.isFinite(Number(item.lineTotalCents)) && Number(item.lineTotalCents) >= 0
                    ? Math.round(Number(item.lineTotalCents))
                    : item.lineTotal !== undefined && Number.isFinite(Number(item.lineTotal)) && Number(item.lineTotal) >= 0
                    ? Math.round(Number(item.lineTotal) * 100)
                    : Math.max(0, Math.round(unitsToAdd * fallbackUnitCost * 100));
                const incomingUnitCost =
                  unitsToAdd > 0 && receivedTotalCents > 0
                    ? Number(((receivedTotalCents / 100) / unitsToAdd).toFixed(4))
                    : Number(fallbackUnitCost.toFixed(4));
                const nextUnits = roundHubUnits(curUnits + unitsToAdd);
                if (unitsToAdd > 0 && (receivedTotalCents > 0 || incomingUnitCost > 0)) {
                  const prevAvg = resolveHubAvgUnitCost(target);
                  let nextPoolCents = 0;
                  let nextAvg = incomingUnitCost;
                  if (curUnits >= 0) {
                    const prevPoolCents = resolveHubPoolCents(target, curUnits);
                    nextPoolCents = prevPoolCents + receivedTotalCents;
                    nextAvg = nextUnits > 0 ? Number(((nextPoolCents / 100) / nextUnits).toFixed(4)) : incomingUnitCost;
                  } else if (nextUnits > 0) {
                    nextPoolCents = Math.round((receivedTotalCents * nextUnits) / unitsToAdd);
                    nextAvg = Number(((nextPoolCents / 100) / nextUnits).toFixed(4));
                  } else {
                    nextPoolCents = 0;
                    nextAvg = incomingUnitCost > 0 ? incomingUnitCost : prevAvg;
                  }
                  target.stockValueCents = Math.max(0, nextPoolCents);
                  target.averageCostPerUnit = nextAvg;
                  target.averageCostPerCase = Number((nextAvg * upc).toFixed(2));
                  target.latestCostPerUnit = incomingUnitCost;
                  target.latestCostPerCase = Number((incomingUnitCost * upc).toFixed(2));
                  target.costPerUnit = target.latestCostPerUnit;
                  target.costPerCase = target.latestCostPerCase;
                }
                if (item.costPrice) target.costPrice = Number(incomingUnitCost.toFixed(4));
                if (item.costPerCase) target.costPerCase = item.costPerCase;
                applyHubStockUnits(target, nextUnits, { skipPoolUpdate: true });
                broadcastInventorySnapshot(target);
              } else {
                const upc = Math.max(1, Number(item.unitsPerCase) || 1);
                const initStock = decomposeHubStockUnits(unitsToAdd, upc, upc <= 1);
                const fallbackUnitCost = Number(item.costPrice || (item.costPerCase ? Number(item.costPerCase) / upc : 0)) || 0;
                const receivedTotalCents =
                  item.lineTotalCents !== undefined && Number.isFinite(Number(item.lineTotalCents)) && Number(item.lineTotalCents) >= 0
                    ? Math.round(Number(item.lineTotalCents))
                    : item.lineTotal !== undefined && Number.isFinite(Number(item.lineTotal)) && Number(item.lineTotal) >= 0
                    ? Math.round(Number(item.lineTotal) * 100)
                    : Math.max(0, Math.round(unitsToAdd * fallbackUnitCost * 100));
                const unitCost =
                  unitsToAdd > 0 && receivedTotalCents > 0
                    ? Number(((receivedTotalCents / 100) / unitsToAdd).toFixed(4))
                    : Number(fallbackUnitCost.toFixed(4));
                const caseCost = Number(item.costPerCase || Number((unitCost * upc).toFixed(2))) || 0;
                const newInvRecord = {
                  id: cleanId,
                  itemId: cleanId,
                  itemName: item.productName || cleanId,
                  unitsPerCase: upc,
                  stockCases: initStock.stockCases,
                  stockSingles: initStock.stockSingles,
                  totalUnits: initStock.totalUnits,
                  stockValueCents: initStock.totalUnits > 0 ? receivedTotalCents : 0,
                  costPrice: unitCost,
                  costPerUnit: Number(unitCost.toFixed(4)),
                  costPerCase: Number(caseCost.toFixed(2)),
                  averageCostPerUnit: Number(unitCost.toFixed(4)),
                  averageCostPerCase: Number(caseCost.toFixed(2)),
                  latestCostPerUnit: Number(unitCost.toFixed(4)),
                  latestCostPerCase: Number(caseCost.toFixed(2)),
                  sellPriceUnit: item.sellingPrice || 0,
                  company_id: grv.companyId || grv.company_id || packet.companyId || 'COMP-001',
                  branch_id: grv.branchId || grv.branch_id || packet.branchId || 'BR-MAIN',
                  updatedAt: new Date().toISOString(),
                  hubTimestamp: Date.now(),
                  lastUpdated: new Date().toISOString(),
                };
                inventoryStore.push(newInvRecord);
                broadcastInventorySnapshot(newInvRecord);
              }
            }
          }

          scheduleSave();

          // Send point-to-point confirmation back to sender
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'GRV',
              id: gId,
              updatedAt: Date.now(),
              hubTimestamp: Date.now(),
              lastUpdated: grv.lastUpdated || new Date().toISOString(),
            }));
          } catch (e) {}

          if (incomingCloudSynced) {
            console.log(`[Termux Hub] ⏭️ Dual-Writer Skip: GRV #${gId} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
            broadcastCloudSyncAck(ws, 'GRV', gId);
          }
        }
      }

      // =====================================================================
      // 3. CONFIGURATION DATA: PRODUCT CATALOG & INVENTORY (STRICT LWW)
      // =====================================================================
      const isInventory =
        pType === 'INVENTORY' ||
        pType === 'INVENTORY_RECORD' ||
        pType === 'INVENTORY_ITEM' ||
        pType === 'INVENTORY_UPDATE' ||
        pType === 'INVENTORY_BATCH' ||
        sheetName === 'InventoryMaster' ||
        sheetName === 'Products' ||
        entityType === 'inventory';

      if (isInventory) {
        const items = Array.isArray(payload) ? payload : [payload || packet.item];
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();

        for (const it of items) {
          if (!it) continue;
          const cleanId = (it.itemId || it.id || '').trim();
          if (!cleanId) continue;
          const incomingTime = getTimestamp(it) || getTimestamp(packet);
          if (isTombstoned(cleanId, 'inventory_item', incomingTime)) {
            const tomb = findHubTombstone(cleanId, 'inventory_item');
            console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned inventory item #${cleanId}`);
            if (tomb) {
              try {
                ws.send(JSON.stringify({
                  type: 'TOMBSTONE_SYNC',
                  action: 'TOMBSTONE_SYNC',
                  entityType: 'tombstone',
                  tombstone: tomb,
                  payload: tomb,
                  origin_device_id: 'LOCAL_HUB',
                  timestamp: Date.now(),
                }));
              } catch (e) {}
            }
            continue;
          }
          const exIdx = inventoryStore.findIndex(
            (i) => i.itemId === cleanId || i.id === cleanId || (it.sku && i.sku === it.sku)
          );

          // STRICT LWW:
          // If incoming update is strictly OLDER than the Hub's existing record (with 60s clock skew grace),
          // reject it and send the authoritative Hub data back to the device!
          if (exIdx >= 0) {
            const existing = inventoryStore[exIdx];
            const existingTime = getTimestamp(existing);
            if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
              console.log(
                `[Termux Hub] 🛡️ LWW Reject: Stale inventory update for ${cleanId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative data back.`
              );
              try {
                ws.send(JSON.stringify({
                  type: 'INVENTORY_ITEM',
                  action: 'INVENTORY_UPDATE',
                  itemId: cleanId,
                  item: existing,
                  payload: existing,
                  updatedAt: existingTime,
                  hubTimestamp: existingTime,
                  lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                  origin_device_id: 'LOCAL_HUB',
                  origin_device_name: 'Termux Local Hub',
                  timestamp: Date.now(),
                }));
              } catch (e) {}
              continue;
            }
          }

          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, it);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && inventoryStore[exIdx].isCloudSynced === true);

          const existingInv = exIdx >= 0 ? inventoryStore[exIdx] : null;
          const mergedRaw = existingInv ? { ...existingInv, ...it } : it;
          const canonicalStock = normalizeHubStockFields(mergedRaw);
          const resolvedAvgCostUnit =
            it.averageCostPerUnit !== undefined && Number(it.averageCostPerUnit) > 0
              ? Number(it.averageCostPerUnit)
              : existingInv && Number(existingInv.averageCostPerUnit) > 0
              ? Number(existingInv.averageCostPerUnit)
              : Number(mergedRaw.costPerUnit || (mergedRaw.costPerCase ? Number(mergedRaw.costPerCase) / canonicalStock.unitsPerCase : 0)) || 0;
          const resolvedAvgCostCase =
            it.averageCostPerCase !== undefined && Number(it.averageCostPerCase) > 0
              ? Number(it.averageCostPerCase)
              : Number((resolvedAvgCostUnit * canonicalStock.unitsPerCase).toFixed(2));

          const resolvedStockValueCents =
            canonicalStock.totalUnits <= 0
              ? 0
              : it.stockValueCents !== undefined && Number.isFinite(Number(it.stockValueCents)) && Number(it.stockValueCents) >= 0 && !(Number(it.stockValueCents) === 0 && resolvedAvgCostUnit > 0)
              ? Math.round(Number(it.stockValueCents))
              : Math.round(canonicalStock.totalUnits * resolvedAvgCostUnit * 100);

          // Hub is the Clock: Stamp record with Hub time
          const stamped = {
            ...mergedRaw,
            itemId: cleanId,
            id: cleanId,
            unitsPerCase: canonicalStock.unitsPerCase,
            stockCases: canonicalStock.stockCases,
            stockSingles: canonicalStock.stockSingles,
            totalUnits: canonicalStock.totalUnits,
            stockValueCents: resolvedStockValueCents,
            costPerUnit: Number((Number(mergedRaw.costPerUnit) || resolvedAvgCostUnit || 0).toFixed(4)),
            averageCostPerUnit: Number(resolvedAvgCostUnit.toFixed(4)),
            averageCostPerCase: Number(resolvedAvgCostCase.toFixed(2)),
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
          };

          if (exIdx >= 0) {
            inventoryStore[exIdx] = stamped;
          } else {
            inventoryStore.push(stamped);
          }
          console.log(`[Termux Hub] 📦 Updated Inventory Item: ${cleanId} "${it.itemName || ''}" Price: $${it.sellPriceUnit ?? it.price ?? ''} stamped at ${hubIso}`);

          // Send SYNC_ACK to sender
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'INVENTORY',
              id: cleanId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          if (incomingCloudSynced) {
            broadcastCloudSyncAck(ws, 'INVENTORY', cleanId);
          }

          // Broadcast authoritative price update to all other connected peer devices
          const broadcastPkt = JSON.stringify({
            type: 'INVENTORY_ITEM',
            action: 'INVENTORY_UPDATE',
            itemId: cleanId,
            item: stamped,
            payload: stamped,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(broadcastPkt); } catch (e) {}
            }
          });
        }
        scheduleSave();
      }

      // =====================================================================
      // 4. TRANSACTIONAL DATA: CASH MOVEMENTS, FLOATS & TRANSFERS (APPEND-ONLY)
      // =====================================================================
      const isCashMovement =
        pType === 'CASH_MOVEMENT' ||
        pType === 'CASH_MOVEMENTS' ||
        sheetName === 'CashMovements' ||
        !!packet.movement ||
        (payload && payload.shiftId && payload.direction);

      if (isCashMovement) {
        const move = packet.movement || payload;
        if (move && move.id) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, move);
          const exIdx = cashMovementsStore.findIndex((m) => m.id === move.id);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && cashMovementsStore[exIdx].isCloudSynced === true);
          if (exIdx >= 0) {
            cashMovementsStore[exIdx] = { ...cashMovementsStore[exIdx], ...move, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
          } else {
            cashMovementsStore.unshift({ ...move, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
            console.log(`[Termux Hub] 📥 Accepted Cash Movement [${move.id}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CASH_MOVEMENT', move.id);
        }
      }

      // =====================================================================
      // 5. TRANSACTIONAL DATA: SUPERVISOR CASH LIFTS (APPEND-ONLY)
      // =====================================================================
      const isCashLift =
        pType === 'CASH_LIFT' ||
        pType === 'CASH_LIFTS' ||
        sheetName === 'CashLifts' ||
        entityType === 'cash_lift' ||
        !!packet.cashLift ||
        (payload && (payload.liftId || payload.slipNumber));

      if (isCashLift) {
        const lift = packet.cashLift || payload;
        const liftId = lift && (lift.id || lift.liftId || lift.slipNumber);
        if (lift && liftId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, lift);
          const exIdx = cashLiftsStore.findIndex((l) => l.id === liftId || l.liftId === liftId);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && cashLiftsStore[exIdx].isCloudSynced === true);
          if (exIdx >= 0) {
            cashLiftsStore[exIdx] = { ...cashLiftsStore[exIdx], ...lift, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
          } else {
            cashLiftsStore.unshift({ ...lift, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
            console.log(`[Termux Hub] 📥 Accepted Cash Lift [${liftId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CASH_LIFT', liftId);
        }
      }

      // =====================================================================
      // 6. TRANSACTIONAL DATA: FORM 2 DAILY CASH LOGS (APPEND-ONLY + REVERSALS)
      // =====================================================================
      const isCashLog =
        pType === 'CASH_LOG' ||
        pType === 'CASH_LOG_RECORD' ||
        pType === 'CASH_LOG_UPDATE' ||
        sheetName === 'CashLog' ||
        entityType === 'cash_log' ||
        (payload && (payload.line || payload.Line) && (payload.in !== undefined || payload.out !== undefined || payload.In !== undefined || payload.Out !== undefined));

      if (isCashLog) {
        const rawLog = packet.cashLog || payload;
        if (rawLog) {
          const senderDeviceId = packet.origin_device_id || packet.originDeviceId || packet.deviceId || 'UNKNOWN-DEVICE';
          const cashClockCheck = validatePacketClock(ws, packet, rawLog, senderDeviceId, 'CASH_LOG');
          if (!cashClockCheck.accepted) {
            return;
          }
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawLog);
          const syncedKey = upsertHubCashLog(rawLog, incomingCloudSynced);
          if (syncedKey) {
            scheduleSave();
            if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CASH_LOG', syncedKey);
          }
        }
      }

      // =====================================================================
      // 7. TRANSACTIONAL DATA: CUSTOMER CHANGE & CREDIT SALES (APPEND-ONLY)
      // =====================================================================
      const isCustomerChangePacket =
        pType === 'CUSTOMER_CHANGE' ||
        pType === 'CUSTOMER_CHANGE_SYNC' ||
        pType === 'customer_change' ||
        sheetName === 'CustomerChange' ||
        packet.entityType === 'customer_change';
      const changeId = payload ? (payload.changeId || payload.id) : null;

      const extractHubPosInvRef = (rec, prefix) => {
        if (!rec || typeof rec !== 'object') return '';
        const explicitRef = String(rec.reference || rec.invoiceId || rec.saleId || '').trim();
        if (explicitRef) return explicitRef.toUpperCase();
        const rawId = String(rec.id || rec.changeId || rec.creditId || '').trim();
        if (rawId.toUpperCase().startsWith(prefix + '-') && rawId.length > prefix.length + 4) {
          const rest = rawId.slice(prefix.length + 1);
          if (!/^\d{1,4}$/.test(rest) && !/^[A-Z0-9]{4}-[A-Z0-9]+-[A-Z0-9]{3}$/i.test(rest)) {
            return rest.toUpperCase();
          }
        }
        const desc = String(rec.description || rec.notes || '');
        const m = desc.match(/Inv(?:oice)?\s*#?\s*([A-Z0-9][A-Z0-9_-]{3,})/i);
        return m && m[1] ? m[1].trim().toUpperCase() : '';
      };

      if (isCustomerChangePacket && payload && changeId) {
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
        const incomingInvRef = extractHubPosInvRef(payload, 'CHG');
        const canonicalChangeId = incomingInvRef ? `CHG-${incomingInvRef}` : changeId;
        let exIdx = customerChangesStore.findIndex((c) => c.changeId === canonicalChangeId || c.id === canonicalChangeId || c.changeId === changeId || c.id === changeId);
        if (exIdx < 0 && incomingInvRef) {
          exIdx = customerChangesStore.findIndex((c) => {
            const ref = extractHubPosInvRef(c, 'CHG');
            return ref && ref === incomingInvRef && String(c.customerId || '').trim().toUpperCase() === String(payload.customerId || '').trim().toUpperCase();
          });
        }
        // Collision guard: if same sequential ID belongs to a DIFFERENT customer or amount, preserve both with a deterministic suffix
        let finalChangeId = canonicalChangeId;
        if (exIdx >= 0) {
          const existing = customerChangesStore[exIdx];
          const sameCust = !payload.customerId || !existing.customerId || String(payload.customerId).trim().toUpperCase() === String(existing.customerId).trim().toUpperCase();
          const sameAmt = Math.abs((Number(payload.in) || 0) - (Number(existing.in) || 0)) < 0.005 && Math.abs((Number(payload.out) || 0) - (Number(existing.out) || 0)) < 0.005;
          if (!sameCust || !sameAmt) {
            const sig = `${payload.customerId || ''}|${payload.in || 0}|${payload.out || 0}|${payload.date || ''}|${payload.timestamp || ''}`;
            let h = 2166136261;
            for (let hi = 0; hi < sig.length; hi++) { h ^= sig.charCodeAt(hi); h = Math.imul(h, 16777619); }
            finalChangeId = `${changeId}-C${(h >>> 0).toString(36).toUpperCase().slice(0, 6)}`;
            exIdx = customerChangesStore.findIndex((c) => c.id === finalChangeId || c.changeId === finalChangeId);
          }
        }
        const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && customerChangesStore[exIdx].isCloudSynced === true);
        const normChange = {
          ...payload,
          id: finalChangeId,
          changeId: finalChangeId,
          ...(incomingInvRef && !payload.reference ? { reference: incomingInvRef } : {}),
          ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
        };
        if (exIdx >= 0) {
          customerChangesStore[exIdx] = { ...customerChangesStore[exIdx], ...normChange, id: finalChangeId, changeId: finalChangeId };
        } else {
          customerChangesStore.unshift(normChange);
          console.log(`[Termux Hub] 📥 Accepted Customer Change [${finalChangeId}] (Append-Only)`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CUSTOMER_CHANGE', finalChangeId);
      }

      const isCreditSalePacket =
        pType === 'CREDIT_SALE' ||
        pType === 'CREDIT_SALE_SYNC' ||
        pType === 'credit_sale' ||
        sheetName === 'CreditSales' ||
        packet.entityType === 'credit_sale';
      const creditId = payload ? (payload.creditId || payload.id) : null;

      if (isCreditSalePacket && payload && creditId) {
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
        const incomingInvRef = extractHubPosInvRef(payload, 'CR');
        const canonicalCreditId = incomingInvRef ? `CR-${incomingInvRef}` : creditId;
        let exIdx = creditSalesStore.findIndex((c) => c.creditId === canonicalCreditId || c.id === canonicalCreditId || c.creditId === creditId || c.id === creditId);
        if (exIdx < 0 && incomingInvRef) {
          exIdx = creditSalesStore.findIndex((c) => {
            const ref = extractHubPosInvRef(c, 'CR');
            return ref && ref === incomingInvRef && String(c.customerId || '').trim().toUpperCase() === String(payload.customerId || '').trim().toUpperCase();
          });
        }
        let finalCreditId = canonicalCreditId;
        if (exIdx >= 0) {
          const existing = creditSalesStore[exIdx];
          const sameCust = !payload.customerId || !existing.customerId || String(payload.customerId).trim().toUpperCase() === String(existing.customerId).trim().toUpperCase();
          const sameAmt = Math.abs((Number(payload.out ?? payload.amount) || 0) - (Number(existing.out ?? existing.amount) || 0)) < 0.005 && Math.abs((Number(payload.in) || 0) - (Number(existing.in) || 0)) < 0.005;
          if (!sameCust || !sameAmt) {
            const sig = `${payload.customerId || ''}|${payload.out ?? payload.amount ?? 0}|${payload.in || 0}|${payload.date || ''}|${payload.timestamp || ''}`;
            let h = 2166136261;
            for (let hi = 0; hi < sig.length; hi++) { h ^= sig.charCodeAt(hi); h = Math.imul(h, 16777619); }
            finalCreditId = `${creditId}-C${(h >>> 0).toString(36).toUpperCase().slice(0, 6)}`;
            exIdx = creditSalesStore.findIndex((c) => c.id === finalCreditId || c.creditId === finalCreditId);
          }
        }
        const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && creditSalesStore[exIdx].isCloudSynced === true);
        const normCredit = {
          ...payload,
          id: finalCreditId,
          creditId: finalCreditId,
          ...(incomingInvRef && !payload.reference ? { reference: incomingInvRef } : {}),
          ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
        };
        if (exIdx >= 0) {
          creditSalesStore[exIdx] = { ...creditSalesStore[exIdx], ...normCredit, id: finalCreditId, creditId: finalCreditId };
        } else {
          creditSalesStore.unshift(normCredit);
          console.log(`[Termux Hub] 📥 Accepted Credit Sale [${finalCreditId}] (Append-Only)`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CREDIT_SALE', finalCreditId);
      }

      // =====================================================================
      // 7.1 CONFIGURATION DATA: CREDIT GROUPS (T2 - LWW WITH 60000ms TOLERANCE)
      // =====================================================================
      const isCreditGroupPacket =
        pType === 'CREDIT_GROUP_SYNC' ||
        pType === 'credit_group' ||
        sheetName === 'CreditGroups' ||
        packet.entityType === 'credit_group';
      const groupId = payload ? (payload.id || payload.groupId) : null;

      if (isCreditGroupPacket && payload && groupId) {
        const incomingTime = getTimestamp(payload) || getTimestamp(packet);
        if (isTombstoned(groupId, 'credit_group', incomingTime)) {
          console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned credit group #${groupId}`);
        } else {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = creditGroupsStore.findIndex((g) => g.id === groupId || g.groupId === groupId);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && creditGroupsStore[exIdx].isCloudSynced === true);
          const stampedTime = incomingTime || Date.now();
          if (exIdx >= 0) {
            const existingTime = getTimestamp(creditGroupsStore[exIdx]) || 0;
            if (stampedTime >= existingTime - 60000) {
              creditGroupsStore[exIdx] = { ...creditGroupsStore[exIdx], ...payload, id: groupId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
              console.log(`[Termux Hub] 🔄 Updated Credit Group [${groupId}] via LWW`);
            }
          } else {
            creditGroupsStore.push({ ...payload, id: groupId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
            console.log(`[Termux Hub] 📥 Added new Credit Group [${groupId}]`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CREDIT_GROUP', groupId);
        }
      }

      // =====================================================================
      // 7.2 DAILY BLIND COUNT CONFIGS & ARCHIVED REPORTS (T2 - LWW)
      // =====================================================================
      const isDailyBlindConfigPacket =
        pType === 'DAILY_BLIND_CONFIG' ||
        pType === 'DAILY_BLIND_CONFIG_SYNC' ||
        pType === 'daily_blind_config' ||
        sheetName === 'DailyBlindConfigs' ||
        packet.entityType === 'daily_blind_config';
      const dbcPayload =
        (payload && typeof payload === 'object' ? payload : null) ||
        (packet.config && typeof packet.config === 'object' ? packet.config : null) ||
        (isDailyBlindConfigPacket ? packet : null);
      const dbcId = dbcPayload ? (dbcPayload.id || dbcPayload.configId || packet.id || packet.entityId) : '';

      if (isDailyBlindConfigPacket && dbcPayload && dbcId) {
        const incomingTime = getTimestamp(dbcPayload) || getTimestamp(packet) || Date.now();
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, dbcPayload);
        const cleanCfg = {
          id: dbcId,
          company_id: dbcPayload.company_id || dbcPayload.companyId || packet.company_id || packet.companyId || hubTenantId,
          branch_id: dbcPayload.branch_id || dbcPayload.branchId || packet.branch_id || packet.branchId || hubBranchId,
          selectedItemIds: Array.isArray(dbcPayload.selectedItemIds) ? dbcPayload.selectedItemIds : [],
          designatedAuditorId: dbcPayload.designatedAuditorId,
          designatedAuditorName: dbcPayload.designatedAuditorName,
          updatedBy: dbcPayload.updatedBy,
          updatedByName: dbcPayload.updatedByName,
          updatedAt: incomingTime,
          version: Number(dbcPayload.version || 1),
          mutationSource: dbcPayload.mutationSource || 'USER_EDIT',
        };
        const exIdx = dailyBlindConfigsStore.findIndex((c) => c && String(c.id).toUpperCase() === String(dbcId).toUpperCase());
        const resolvedCloudSynced = incomingCloudSynced;
        if (exIdx >= 0) {
          const existingTime = getTimestamp(dailyBlindConfigsStore[exIdx]) || 0;
          if (incomingTime >= existingTime - 60000) {
            dailyBlindConfigsStore[exIdx] = {
              ...dailyBlindConfigsStore[exIdx],
              ...cleanCfg,
              id: dbcId,
              isCloudSynced: resolvedCloudSynced,
            };
          }
        } else {
          dailyBlindConfigsStore.push({ ...cleanCfg, id: dbcId, isCloudSynced: resolvedCloudSynced });
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'DAILY_BLIND_CONFIG', dbcId);
      }

      const isDailyBlindCountPacket =
        pType === 'DAILY_BLIND_COUNT' ||
        pType === 'DAILY_BLIND_COUNT_SYNC' ||
        pType === 'daily_blind_count' ||
        sheetName === 'DailyBlindCounts' ||
        packet.entityType === 'daily_blind_count';
      const dbcntPayload =
        (payload && typeof payload === 'object' ? payload : null) ||
        (packet.record && typeof packet.record === 'object' ? packet.record : null) ||
        (isDailyBlindCountPacket ? packet : null);
      const dbcntId = dbcntPayload ? (dbcntPayload.id || dbcntPayload.countId || packet.id || packet.entityId) : '';

      if (isDailyBlindCountPacket && dbcntPayload && dbcntId) {
        const statusRank = { SUBMITTED: 1, EXPLANATION_REQUESTED: 2, EXPLANATION_SUBMITTED: 3, ARCHIVED: 4 };
        const incomingTime = getTimestamp(dbcntPayload) || getTimestamp(packet) || Date.now();
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, dbcntPayload);
        const cleanCount = {
          ...dbcntPayload,
          id: dbcntId,
          company_id: dbcntPayload.company_id || dbcntPayload.companyId || packet.company_id || packet.companyId || hubTenantId,
          branch_id: dbcntPayload.branch_id || dbcntPayload.branchId || packet.branch_id || packet.branchId || hubBranchId,
          updatedAt: incomingTime,
          reportOnly: true,
        };
        delete cleanCount.type;
        delete cleanCount.action;
        delete cleanCount.payload;
        delete cleanCount.record;
        const exIdx = dailyBlindCountsStore.findIndex((r) => r && String(r.id).toUpperCase() === String(dbcntId).toUpperCase());
        const resolvedCloudSynced = incomingCloudSynced;
        if (exIdx >= 0) {
          const existingRec = dailyBlindCountsStore[exIdx];
          const exRank = statusRank[existingRec.status] || 1;
          const incRank = statusRank[cleanCount.status] || 1;
          const existingTime = getTimestamp(existingRec) || 0;
          if (existingRec.status !== 'ARCHIVED' || cleanCount.status === 'ARCHIVED') {
            if (incRank > exRank || (incRank === exRank && incomingTime >= existingTime - 60000)) {
              dailyBlindCountsStore[exIdx] = {
                ...existingRec,
                ...cleanCount,
                id: dbcntId,
                reportOnly: true,
                isCloudSynced: resolvedCloudSynced,
              };
            }
          }
        } else {
          dailyBlindCountsStore.push({
            ...cleanCount,
            id: dbcntId,
            reportOnly: true,
            isCloudSynced: resolvedCloudSynced,
          });
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'DAILY_BLIND_COUNT', dbcntId);
      }

      const isPurchaseOrderPacket =
        pType === 'PURCHASE_ORDER' ||
        pType === 'PURCHASE_ORDER_SYNC' ||
        pType === 'PURCHASE_ORDERS' ||
        pType === 'purchase_order' ||
        sheetName === 'PurchaseOrders' ||
        packet.entityType === 'purchase_order';
      const poPayload =
        (packet.purchaseOrder && typeof packet.purchaseOrder === 'object' ? packet.purchaseOrder : null) ||
        (payload && typeof payload === 'object' ? payload : null) ||
        (isPurchaseOrderPacket ? packet : null);
      const poId = poPayload ? (poPayload.id || poPayload.poNumber || packet.id || packet.entityId) : '';

      if (isPurchaseOrderPacket && poPayload && poId) {
        const poStatusRank = {
          DRAFT: 1,
          REJECTED: 2,
          PENDING_APPROVAL: 3,
          APPROVED: 4,
          PARTIALLY_RECEIVED: 5,
          RECEIVED: 6,
          CANCELLED: 7,
        };
        const incomingTime = getTimestamp(poPayload) || getTimestamp(packet) || Date.now();
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, poPayload);
        const cleanPo = {
          ...poPayload,
          id: poId,
          poNumber: poPayload.poNumber || poId,
          company_id: poPayload.company_id || poPayload.companyId || packet.company_id || packet.companyId || hubTenantId,
          branch_id: poPayload.branch_id || poPayload.branchId || packet.branch_id || packet.branchId || hubBranchId,
          updatedAt: incomingTime,
        };
        delete cleanPo.type;
        delete cleanPo.action;
        delete cleanPo.payload;
        delete cleanPo.purchaseOrder;
        const exIdx = purchaseOrdersStore.findIndex(
          (r) =>
            r &&
            (String(r.id || '').toUpperCase() === String(poId).toUpperCase() ||
              String(r.poNumber || '').toUpperCase() === String(poId).toUpperCase())
        );
        if (exIdx >= 0) {
          const existingRec = purchaseOrdersStore[exIdx];
          const exRank = poStatusRank[existingRec.status] || 1;
          const incRank = poStatusRank[cleanPo.status] || 1;
          const existingTime = getTimestamp(existingRec) || 0;
          const shouldApply =
            !(exRank >= 4 && incRank < 4 && incomingTime <= existingTime + 120000) &&
            (incRank > exRank || incomingTime >= existingTime - 2000);
          if (shouldApply) {
            const linkedGrvs = Array.from(
              new Set([...(existingRec.linkedGrvIds || []), ...(cleanPo.linkedGrvIds || [])].filter(Boolean))
            );
            const exLineMap = new Map();
            (Array.isArray(existingRec.lines) ? existingRec.lines : []).forEach((l) => {
              if (l && l.lineId) exLineMap.set(l.lineId, l);
            });
            const mergedLines = (Array.isArray(cleanPo.lines) ? cleanPo.lines : existingRec.lines || []).map((l) => {
              const prev = l && l.lineId ? exLineMap.get(l.lineId) : null;
              if (!prev) return l;
              return {
                ...l,
                receivedUnits: Math.max(Number(l.receivedUnits || 0), Number(prev.receivedUnits || 0)),
                receivedCases: Math.max(Number(l.receivedCases || 0), Number(prev.receivedCases || 0)),
              };
            });
            purchaseOrdersStore[exIdx] = {
              ...existingRec,
              ...cleanPo,
              id: existingRec.id || poId,
              lines: mergedLines,
              linkedGrvIds: linkedGrvs,
              approvedById: cleanPo.approvedById || existingRec.approvedById,
              approvedByName: cleanPo.approvedByName || existingRec.approvedByName,
              approvedAt: cleanPo.approvedAt || existingRec.approvedAt,
              isCloudSynced: incomingCloudSynced,
            };
          }
        } else {
          purchaseOrdersStore.push({
            ...cleanPo,
            id: poId,
            isCloudSynced: incomingCloudSynced,
          });
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'PURCHASE_ORDER', poId);
      }

      // =====================================================================
      // 8. TRANSACTIONAL DATA: STOCK MOVEMENTS (APPEND-ONLY, DEDUPLICATED, BATCH-READY)
      // =====================================================================
      const movRawPayload = packet.movements || packet.movement || payload;
      const isStockMovementPkt =
        pType === 'STOCK_MOVEMENT' ||
        pType === 'STOCK_MOVEMENT_RECORD' ||
        pType === 'STOCK_MOVEMENT_BATCH' ||
        entityType === 'stock_movement' ||
        sheetName === 'StockMovement' ||
        sheetName === 'StockMovements';
      if (isStockMovementPkt && movRawPayload) {
        const movList = Array.isArray(movRawPayload) ? movRawPayload : [movRawPayload];
        let acceptedCount = 0;
        for (const movPayload of movList) {
          const rawMovId = movPayload && (movPayload.id || movPayload.movementId || movPayload.txnId);
          if (!movPayload || !rawMovId) continue;
          const mId = String(rawMovId).trim();
          const baseMovId = stripHubStockMovementDupSuffix(mId);
          const movItemId = String(movPayload.itemId || '').trim();
          const isDupClone =
            mId !== baseMovId &&
            stockMovementsStore.some((m) => {
              const existingId = String(m.id || m.movementId || m.txnId || '').trim();
              const existingBase = stripHubStockMovementDupSuffix(existingId);
              const existingItemId = String(m.itemId || '').trim();
              return existingBase === baseMovId && (!movItemId || !existingItemId || existingItemId === movItemId);
            });

          if (isDupClone) {
            console.log(`[Termux Hub] 🛡️ Ignored duplicate echo Stock Movement [${mId}] (base [${baseMovId}] already exists)`);
            continue;
          }
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, movPayload);
          const exIdx = stockMovementsStore.findIndex((m) => {
            const existingId = String(m.id || m.movementId || m.txnId || '').trim();
            return existingId === mId || m.id === mId || m.movementId === mId || m.txnId === mId;
          });
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && stockMovementsStore[exIdx].isCloudSynced === true);
          const normalizedMov = {
            ...movPayload,
            id: movPayload.id || mId,
            movementId: movPayload.movementId || mId,
            txnId: movPayload.txnId || mId,
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
          };
          if (exIdx >= 0) {
            stockMovementsStore[exIdx] = { ...stockMovementsStore[exIdx], ...normalizedMov };
          } else {
            stockMovementsStore.unshift(normalizedMov);
          }
          acceptedCount++;
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'STOCK_MOVEMENT', mId);
        }
        if (acceptedCount > 0) {
          console.log(`[Termux Hub] 📥 Accepted ${acceptedCount} Stock Movement(s) (Append-Only)`);
          scheduleSave();
        }
      }

      // =====================================================================
      // 9. TRANSACTIONAL DATA: EXPENSES & CASH TRANSFERS (APPEND-ONLY)
      // =====================================================================
      if ((pType === 'EXPENSE' || pType === 'expense' || sheetName === 'Expenses' || packet.entityType === 'expense') && payload && payload.id) {
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
        const exIdx = expensesStore.findIndex((e) => e.id === payload.id);
        const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && expensesStore[exIdx].isCloudSynced === true);
        if (exIdx >= 0) {
          const prevExp = expensesStore[exIdx];
          const prevSt = String(prevExp.status || '').toLowerCase();
          const incSt = String(payload.status || '').toLowerCase();
          const prevFinal = prevSt === 'approved' || prevSt === 'rejected';
          const incPending = !incSt || incSt === 'pending' || incSt === 'pending_supervisor';
          if (prevFinal && incPending) {
            try {
              ws.send(JSON.stringify({
                type: 'EXPENSE',
                action: 'EXPENSE',
                expense: prevExp,
                payload: prevExp,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }
          const nowExpMs = Date.now();
          expensesStore[exIdx] = {
            ...prevExp,
            ...payload,
            updatedAt: Math.max(nowExpMs, Number(payload.updatedAt) || 0),
            hubTimestamp: nowExpMs,
            lastUpdated: new Date(nowExpMs).toISOString(),
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
          };
        } else {
          expensesStore.unshift({ ...payload, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
          console.log(`[Termux Hub] 📥 Accepted Expense [${payload.id}] (Append-Only)`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'EXPENSE', payload.id);
      }

      if (
        (pType === 'INTERNAL_CONSUMPTION' || pType === 'SHOP_USE' || sheetName === 'InternalConsumption') &&
        (packet.internalConsumption || payload) &&
        (packet.internalConsumption?.id || payload?.id)
      ) {
        const icObj = packet.internalConsumption || payload;
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, icObj);
        const exIdx = internalConsumptionsStore.findIndex((c) => c.id === icObj.id);
        const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && internalConsumptionsStore[exIdx].isCloudSynced === true);
        if (exIdx >= 0) {
          const prevIc = internalConsumptionsStore[exIdx];
          const prevFinal = prevIc.status === 'APPROVED' || prevIc.status === 'REJECTED';
          const incPending = !icObj.status || icObj.status === 'PENDING' || icObj.status === 'PENDING_APPROVAL';
          if (prevFinal && incPending) {
            try {
              ws.send(JSON.stringify({
                type: 'INTERNAL_CONSUMPTION',
                action: 'INTERNAL_CONSUMPTION_RECORD',
                internalConsumption: prevIc,
                payload: prevIc,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            return;
          }
          internalConsumptionsStore[exIdx] = { ...prevIc, ...icObj, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
        } else {
          internalConsumptionsStore.unshift({ ...icObj, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
          console.log(`[Termux Hub] 📥 Accepted Shop Use / Internal Consumption [${icObj.id}]`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'INTERNAL_CONSUMPTION', icObj.id);
      }

      const trObj = packet.cashTransfer || payload;
      const isCashTransferPkt =
        pType === 'CASH_TRANSFER' ||
        pType === 'CASH_TRANSFER_SYNC' ||
        pType === 'CASH_TRANSFER_UPDATE' ||
        pType === 'CASH_TRANSFER_RECORD' ||
        pType === 'cash_transfer' ||
        sheetName === 'CashTransfers' ||
        sheetName === 'cash_transfers' ||
        entityType === 'cash_transfer' ||
        Boolean(packet.cashTransfer);
      if (isCashTransferPkt && trObj && (trObj.transfer_id || trObj.id)) {
        const tId = String(trObj.transfer_id || trObj.id).trim();
        const rawAmt = typeof trObj.amount === 'number' ? trObj.amount : parseFloat(String(trObj.amount || '0'));
        const safeAmt = Number.isFinite(rawAmt) ? Math.round(rawAmt * 100) / 100 : NaN;
        if (!Number.isFinite(safeAmt) || safeAmt < 0 || safeAmt > 10000000) {
          console.warn(`[Termux Hub] 🛡️ Rejected invalid Cash Transfer amount for ${tId}: ${trObj.amount}`);
        } else {
          const getTrRank = (st) => {
            const u = String(st || '').toUpperCase().trim();
            if (u === 'DRAFT') return 0;
            if (u === 'PENDING_APPROVAL' || u === 'PENDING_ACCEPTANCE') return 1;
            if (u === 'IN_TRANSIT') return 2;
            if (u === 'APPROVED') return 3;
            if (u === 'RECEIVED' || u === 'COMPLETED' || u === 'RETURNED' || u === 'CANCELLED' || u === 'REJECTED') return 4;
            return 0;
          };
          const trTypeUpper = String(trObj.type || '').toUpperCase().trim();
          const trBranchUpper = String(trObj.branch_id || '').toUpperCase().trim();
          const isGlobalTransfer =
            trBranchUpper === 'HQ' ||
            trBranchUpper === 'ALL' ||
            String(trObj.target_branch_id || '').toUpperCase().trim() === 'ALL' ||
            trTypeUpper === 'HQ_TO_BRANCH' ||
            trTypeUpper === 'BRANCH_TO_HQ' ||
            trTypeUpper === 'BANK_DEPOSIT' ||
            trTypeUpper === 'BANK_WITHDRAWAL' ||
            trTypeUpper === 'ELECTRONIC_SETTLEMENT' ||
            trTypeUpper === 'CAPITAL_INFUSION' ||
            trTypeUpper === 'SUPPLIER_PAYMENT' ||
            trTypeUpper === 'THIRD_PARTY_PAYOUT';

          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, trObj);
          const exIdx = cashTransfersStore.findIndex((t) => String(t.transfer_id || t.id || '').trim() === tId);
          const prevTr = exIdx >= 0 ? cashTransfersStore[exIdx] : null;
          const prevRank = prevTr ? getTrRank(prevTr.status) : -1;
          const nextRank = getTrRank(trObj.status);

          if (prevTr && nextRank < prevRank) {
            console.log(`[Termux Hub] 🛡️ Rejected stale Cash Transfer downgrade for ${tId} (${trObj.status} < ${prevTr.status})`);
            try {
              ws.send(JSON.stringify({
                packetId: `HUB-TRF-FIX-${tId}-${prevTr.status || 'ST'}-${hubNow}`,
                type: 'CASH_TRANSFER',
                action: 'CASH_TRANSFER_UPDATE',
                entityType: 'cash_transfer',
                target_branch_id: isGlobalTransfer ? 'ALL' : (prevTr.branch_id || 'BR-MAIN'),
                companyId: prevTr.company_id || packet.companyId,
                branchId: prevTr.branch_id || packet.branchId,
                cashTransfer: prevTr,
                payload: prevTr,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: hubNow,
              }));
            } catch (e) {}
            return;
          } else {
            const prevLinksCount = Array.isArray(prevTr?.linked_cash_log_ids) ? prevTr.linked_cash_log_ids.length : 0;
            const nextLinksCount = Array.isArray(trObj.linked_cash_log_ids) ? trObj.linked_cash_log_ids.length : 0;
            const hasMeaningfulChange =
              !prevTr ||
              nextRank > prevRank ||
              String(prevTr.status || '').toUpperCase() !== String(trObj.status || '').toUpperCase() ||
              nextLinksCount > prevLinksCount ||
              (trObj.received_by_user_id && trObj.received_by_user_id !== prevTr.received_by_user_id) ||
              (trObj.approved_by_user_id && trObj.approved_by_user_id !== prevTr.approved_by_user_id);
            // CRITICAL: When a peer advances transfer status locally (e.g. PENDING_ACCEPTANCE -> COMPLETED),
            // NEVER inherit prevTr.isCloudSynced=true! Clear it so the Hub pushes the updated status to Cloud!
            const resolvedCloudSynced = incomingCloudSynced || (!hasMeaningfulChange && Boolean(prevTr && prevTr.isCloudSynced === true));
            const mergedLinks = Array.from(
              new Set([
                ...(Array.isArray(prevTr?.linked_cash_log_ids) ? prevTr.linked_cash_log_ids : []),
                ...(Array.isArray(trObj.linked_cash_log_ids) ? trObj.linked_cash_log_ids : []),
              ])
            );
            const stampedTransfer = {
              ...(prevTr || {}),
              ...trObj,
              transfer_id: tId,
              amount: safeAmt,
              rank: Math.max(prevRank, nextRank),
              linked_cash_log_ids: mergedLinks,
              target_branch_id: isGlobalTransfer ? 'ALL' : (trObj.target_branch_id || trObj.branch_id || prevTr?.branch_id || 'BR-MAIN'),
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
              isCloudSynced: resolvedCloudSynced,
            };
            if (exIdx >= 0) {
              cashTransfersStore[exIdx] = stampedTransfer;
              console.log(`[Termux Hub] 🔄 Updated Cash Transfer [${tId}] -> ${stampedTransfer.status} (cloudSynced=${resolvedCloudSynced})`);
            } else {
              cashTransfersStore.unshift(stampedTransfer);
              console.log(`[Termux Hub] 📥 Accepted Cash Transfer [${tId}] (${stampedTransfer.type} $${safeAmt.toFixed(2)}, status=${stampedTransfer.status})`);
            }
            scheduleSave();

            try {
              ws.send(JSON.stringify({
                type: 'SYNC_ACK',
                action: 'SYNC_ACK',
                entityType: 'CASH_TRANSFER',
                id: tId,
                updatedAt: hubNow,
                hubTimestamp: hubNow,
                lastUpdated: hubIso,
              }));
            } catch (e) {}

            if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CASH_TRANSFER', tId);

            const trBroadcastStr = JSON.stringify({
              packetId: `HUB-TRF-${tId}-${stampedTransfer.status || 'ST'}-${hubNow}`,
              type: 'CASH_TRANSFER',
              action: stampedTransfer.status && stampedTransfer.status !== 'DRAFT' ? 'CASH_TRANSFER_UPDATE' : 'CASH_TRANSFER',
              entityType: 'cash_transfer',
              target_branch_id: stampedTransfer.target_branch_id,
              companyId: stampedTransfer.company_id || packet.companyId,
              branchId: stampedTransfer.branch_id || packet.branchId,
              cashTransfer: stampedTransfer,
              payload: stampedTransfer,
              origin_device_id: 'LOCAL_HUB',
              origin_device_name: 'Termux Local Hub',
              timestamp: hubNow,
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try { client.send(trBroadcastStr); } catch (e) {}
              }
            });
            return;
          }
        }
      }

      // =====================================================================
      // 9.05 TRANSACTIONAL DATA: SUPPLIERS, ADMIN SALES, CASH COUNTS, VOUCHERS (BATCH A)
      // =====================================================================
      const isSupplier =
        pType === 'SUPPLIER_SYNC' ||
        pType === 'SUPPLIER' ||
        pType === 'supplier' ||
        pType === 'SUPPLIER_RECORD' ||
        sheetName === 'Suppliers' ||
        sheetName === 'suppliers' ||
        entityType === 'supplier' ||
        entityType === 'Suppliers' ||
        Boolean(packet.supplier);
      const suppObj = packet.supplier || payload;
      if (isSupplier && suppObj) {
        const sId = suppObj.supplierId || suppObj.id || suppObj.SupplierID;
        const incomingTime = getTimestamp(suppObj) || getTimestamp(packet);
        if (sId && isTombstoned(sId, 'supplier', incomingTime)) {
          const tomb = findHubTombstone(sId, 'supplier');
          console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned supplier #${sId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: 'TOMBSTONE_SYNC', action: 'TOMBSTONE_SYNC', entityType: 'tombstone', tombstone: tomb, payload: tomb, origin_device_id: 'LOCAL_HUB', timestamp: Date.now() }));
            } catch (e) {}
          }
        } else if (sId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, suppObj);
          const exIdx = suppliersStore.findIndex((s) => (s.supplierId || s.id || s.SupplierID) === sId);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && suppliersStore[exIdx].isCloudSynced === true);
          if (exIdx >= 0) {
            suppliersStore[exIdx] = { ...suppliersStore[exIdx], ...suppObj, supplierId: sId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
          } else {
            suppliersStore.unshift({ ...suppObj, supplierId: sId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
            console.log(`[Termux Hub] 📥 Accepted Supplier [${sId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'SUPPLIER', sId);
        }
      }

      const isAdminSale = pType === 'ADMIN_SALES' || pType === 'ADMIN_SALES_SYNC' || pType === 'admin_sales' || sheetName === 'AdminSales';
      if (isAdminSale && payload) {
        const asId = payload.id || `AS-${payload.date}-${payload.staffId}`;
        if (asId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = adminSalesStore.findIndex((a) => a.id === asId);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && adminSalesStore[exIdx].isCloudSynced === true);
          if (exIdx >= 0) {
            adminSalesStore[exIdx] = { ...adminSalesStore[exIdx], ...payload, id: asId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
          } else {
            adminSalesStore.unshift({ ...payload, id: asId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
            console.log(`[Termux Hub] 📥 Accepted Admin Sale [${asId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'ADMIN_SALES', asId);
        }
      }

      const isCashCount =
        pType === 'CASH_COUNT' ||
        pType === 'CASH_COUNT_SYNC' ||
        pType === 'CASH_COUNT_RECORD' ||
        pType === 'cash_count' ||
        sheetName === 'CashCounts' ||
        packet.entityType === 'cash_count' ||
        Boolean(packet.cashCount);
      const ccPayload = (packet.cashCount && typeof packet.cashCount === 'object') ? packet.cashCount : payload;
      if (isCashCount && ccPayload) {
        const ccId = String(ccPayload.id || packet.recordId || packet.entityId || '').trim();
        if (ccId || (ccPayload.staffId && ccPayload.date)) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, ccPayload);
          const normComp = String(ccPayload.company_id || ccPayload.companyId || packet.companyId || 'COMP-001').trim().toUpperCase();
          const normBr = String(ccPayload.branch_id || ccPayload.branchId || packet.branchId || 'BR-MAIN').trim().toUpperCase();
          const normStaff = String(ccPayload.staffId || '').trim().toUpperCase();
          const normDate = String(ccPayload.date || '').trim();

          const exIdx = cashCountsStore.findIndex((c) => {
            if (ccId && c.id === ccId) return true;
            if (!normStaff || !normDate) return false;
            const cComp = String(c.company_id || c.companyId || 'COMP-001').trim().toUpperCase();
            const cBr = String(c.branch_id || c.branchId || 'BR-MAIN').trim().toUpperCase();
            const cStaff = String(c.staffId || '').trim().toUpperCase();
            return cComp === normComp && cBr === normBr && cStaff === normStaff && String(c.date || '').trim() === normDate;
          });

          const hubNow = Date.now();
          const incomingTs = Math.max(
            Number(ccPayload.updatedAt || 0),
            Number(packet.updatedAt || 0),
            getTimestamp(ccPayload) || 0
          ) || hubNow;
          const existingTs = exIdx >= 0 ? getTimestamp(cashCountsStore[exIdx]) : 0;

          if (exIdx >= 0 && existingTs > 0 && incomingTs < existingTs) {
            // Strictly older replay: keep newer record in Hub, still preserve cloud sync flag if incoming confirmed cloud
            if (incomingCloudSynced && cashCountsStore[exIdx].isCloudSynced !== true) {
              cashCountsStore[exIdx].isCloudSynced = true;
              scheduleSave();
            }
          } else {
            const finalId = ccId || (exIdx >= 0 ? cashCountsStore[exIdx].id : `CNT-${hubNow}`);
            const isNewerLocalEdit =
              exIdx >= 0 &&
              !incomingCloudSynced &&
              (incomingTs > existingTs ||
                Math.abs(Number(ccPayload.finalCashOutTotal || 0) - Number(cashCountsStore[exIdx].finalCashOutTotal || 0)) > 0.005 ||
                String(ccPayload.notes || '') !== String(cashCountsStore[exIdx].notes || ''));
            const resolvedCloudSynced = incomingCloudSynced
              ? true
              : isNewerLocalEdit
              ? false
              : (exIdx >= 0 && cashCountsStore[exIdx].isCloudSynced === true);
            const mergedCc = {
              ...(exIdx >= 0 ? cashCountsStore[exIdx] : {}),
              ...ccPayload,
              id: finalId,
              company_id: ccPayload.company_id || ccPayload.companyId || normComp,
              companyId: ccPayload.companyId || ccPayload.company_id || normComp,
              branch_id: ccPayload.branch_id || ccPayload.branchId || normBr,
              branchId: ccPayload.branchId || ccPayload.branch_id || normBr,
              updatedAt: Math.max(incomingTs, hubNow),
              hubTimestamp: hubNow,
              lastUpdated: new Date(Math.max(incomingTs, hubNow)).toISOString(),
              isCloudSynced: resolvedCloudSynced,
            };
            delete mergedCc.fromMesh;
            delete mergedCc.fromSync;

            if (exIdx >= 0) {
              cashCountsStore[exIdx] = mergedCc;
              console.log(`[Termux Hub] 🔄 Updated Cash Count [${finalId}] ($${Number(mergedCc.finalCashOutTotal || 0).toFixed(2)})`);
            } else {
              cashCountsStore.unshift(mergedCc);
              console.log(`[Termux Hub] 📥 Accepted Cash Count [${finalId}] ($${Number(mergedCc.finalCashOutTotal || 0).toFixed(2)})`);
            }
            scheduleSave();
            if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CASH_COUNT', finalId);
          }
        }
      }

      const isVoucher = pType === 'VOUCHER' || pType === 'VOUCHER_SYNC' || pType === 'voucher' || pType === 'supplier_invoice' || sheetName === 'SupplierInvoices' || sheetName === 'Vouchers';
      if (isVoucher && payload) {
        const vId = payload.voucherId || payload.id;
        if (vId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = vouchersStore.findIndex((v) => (v.voucherId || v.id) === vId);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && vouchersStore[exIdx].isCloudSynced === true);
          if (exIdx >= 0) {
            vouchersStore[exIdx] = { ...vouchersStore[exIdx], ...payload, voucherId: vId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
          } else {
            vouchersStore.unshift({ ...payload, voucherId: vId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
            console.log(`[Termux Hub] 📥 Accepted Voucher [${vId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'VOUCHER', vId);
        }
      }

      // =====================================================================
      // 9.06 TRANSACTIONAL DATA: BUSINESS DAY CLOSURES & SETTLEMENTS (T1 APPEND-ONLY)
      // =====================================================================
      const isClosure = pType === 'CLOSURE_SYNC' || pType === 'CLOSURE' || pType === 'closure' || pType === 'EOD' || sheetName === 'BusinessDayClosures' || sheetName === 'Closures';
      if (isClosure && payload) {
        const cId = payload.id || `EOD-${payload.date}-${payload.branchId || 'BR-MAIN'}`;
        if (cId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = businessDayClosuresStore.findIndex((c) => c.id === cId || (c.date === payload.date && c.branchId === payload.branchId));
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && businessDayClosuresStore[exIdx].isCloudSynced === true);
          if (exIdx >= 0) {
            businessDayClosuresStore[exIdx] = { ...businessDayClosuresStore[exIdx], ...payload, id: cId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
          } else {
            businessDayClosuresStore.unshift({ ...payload, id: cId, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
            console.log(`[Termux Hub] 📥 Accepted Closure [${cId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CLOSURE', cId);
        }
      }

      const isSettlement =
        pType === 'SETTLEMENT_SYNC' ||
        pType === 'SETTLEMENT' ||
        pType === 'settlement' ||
        pType === 'ELECTRONIC_SETTLEMENT' ||
        pType === 'ELECTRONIC_SETTLEMENT_SYNC' ||
        entityType === 'electronic_settlement' ||
        sheetName === 'ElectronicSettlements' ||
        sheetName === 'Settlements' ||
        Boolean(packet.settlement);
      const settleObj = packet.settlement || payload;
      if (isSettlement && settleObj) {
        const sBranch = settleObj.branchId || settleObj.branch_id || packet.branchId || 'BR-MAIN';
        const sComp = settleObj.company_id || settleObj.companyId || packet.companyId || packet.company_id || 'COMP-001';
        const sId = settleObj.id || `SETTLE-${settleObj.date}-${sBranch}`;
        if (sId) {
          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, settleObj);
          const normSComp = (v) => {
            const u = String(v || 'COMP-001').trim().toUpperCase();
            return (!u || u === 'DEFAULT' || u === 'COMP-001' || u === 'COMP-MASTER') ? 'COMP-001' : u;
          };
          const exIdx = electronicSettlementsStore.findIndex(
            (s) =>
              s.id === sId ||
              (s.date === settleObj.date &&
                (s.branchId || s.branch_id) === sBranch &&
                normSComp(s.company_id || s.companyId) === normSComp(sComp))
          );
          const prevSt = exIdx >= 0 ? electronicSettlementsStore[exIdx] : null;
          const resolvedCloudSynced = incomingCloudSynced || (prevSt && prevSt.isCloudSynced === true);
          const stampedSettlement = {
            ...(prevSt || {}),
            ...settleObj,
            id: sId,
            companyId: sComp,
            company_id: sComp,
            branchId: sBranch,
            branch_id: sBranch,
            target_branch_id: 'ALL',
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
          };
          if (exIdx >= 0) {
            electronicSettlementsStore[exIdx] = stampedSettlement;
            console.log(`[Termux Hub] 🔄 Updated Electronic Settlement [${sId}] (${stampedSettlement.date})`);
          } else {
            electronicSettlementsStore.unshift(stampedSettlement);
            console.log(`[Termux Hub] 📥 Accepted Electronic Settlement [${sId}] (${stampedSettlement.date})`);
          }
          scheduleSave();

          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'ELECTRONIC_SETTLEMENT',
              id: sId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'ELECTRONIC_SETTLEMENT', sId);

          const stBroadcastStr = JSON.stringify({
            type: 'SETTLEMENT_SYNC',
            action: 'SETTLEMENT_SYNC',
            target_branch_id: 'ALL',
            companyId: sComp,
            branchId: sBranch,
            settlement: stampedSettlement,
            payload: stampedSettlement,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(stBroadcastStr); } catch (e) {}
            }
          });
        }
      }

      // =====================================================================
      // 9.07 CONFIGURATION DATA: INVENTORY CATEGORIES (T2 STRICT LWW - 60000MS SKEW)
      // =====================================================================
      const isCategory = pType === 'CATEGORY_SYNC' || pType === 'CATEGORIES_SYNC' || pType === 'category' || pType === 'categories' || sheetName === 'Categories';
      if (isCategory && payload) {
        const rawCats = Array.isArray(payload) ? payload : (payload.categories || payload.item || payload.data);
        if (Array.isArray(rawCats)) {
          const existingTime = Math.max(
            ...categoriesStore.map((c) => getTimestamp(c)),
            getTimestamp(categoriesStore),
            0
          );
          const incomingTime = getTimestamp(payload);

          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 60000) {
            console.log(
              `[Termux Hub] 🛡️ LWW Reject: Stale Categories update (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative categories back.`
            );
            try {
              ws.send(JSON.stringify({
                type: 'CATEGORIES_SYNC',
                action: 'CATEGORIES_SYNC',
                categories: categoriesStore,
                payload: categoriesStore,
                origin_device_id: 'LOCAL_HUB',
                hubTimestamp: Date.now(),
              }));
            } catch (e) {}
          } else {
            categoriesStore = rawCats.filter((c) => !isTombstoned(getTombstoneRecordId(c, 'inventory_category'), 'inventory_category', getTimestamp(c) || incomingTime));
            console.log(`[Termux Hub] 📥 Accepted Categories update (${categoriesStore.length} categories, LWW Accepted)`);
            scheduleSave();
          }
        }
      }

      // =====================================================================
      // 9.1 CONFIGURATION DATA: STAFF & PASSWORDS (STRICT LWW - HUB AUTHORITY)
      // =====================================================================
      const rawStaffObj = packet.staff || (payload && (payload.pin_hash || payload.pin || payload.role) ? payload : null);
      let staffObj = null;
      if (rawStaffObj) {
        staffObj = { ...rawStaffObj };
        delete staffObj.pin; // CRITICAL: Never retain plain-text PIN in hub memory or disk
      }
      const isStaff = pType === 'STAFF' || pType === 'STAFF_SYNC' || pType === 'STAFF_RECORD' || sheetName === 'Salespeople' || sheetName === 'users' || !!staffObj;
      if (isStaff && staffObj && staffObj.id) {
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();
        const incomingTime = getTimestamp(staffObj) || getTimestamp(packet);
        if (isTombstoned(staffObj.id, 'staff', incomingTime)) {
          const tomb = findHubTombstone(staffObj.id, 'staff');
          console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned staff #${staffObj.id}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: 'TOMBSTONE_SYNC', action: 'TOMBSTONE_SYNC', entityType: 'tombstone', tombstone: tomb, payload: tomb, origin_device_id: 'LOCAL_HUB', timestamp: Date.now() }));
            } catch (e) {}
          }
          return;
        }
        const sIdx = salespeopleStore.findIndex((s) => s.id === staffObj.id);
        let accepted = true;

        if (sIdx >= 0) {
          const existing = salespeopleStore[sIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
            console.log(
              `[Termux Hub] 🛡️ LWW Reject: Stale staff update for ${staffObj.name || staffObj.id} (${staffObj.id}) (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                type: 'STAFF',
                action: 'STAFF_SYNC',
                staff: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            accepted = false;
          }
        }

        if (accepted) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawStaffObj, staffObj);
          const resolvedCloudSynced = incomingCloudSynced || (sIdx >= 0 && salespeopleStore[sIdx].isCloudSynced === true);
          staffObj.updatedAt = hubNow;
          staffObj.hubTimestamp = hubNow;
          staffObj.lastUpdated = hubIso;
          if (resolvedCloudSynced) staffObj.isCloudSynced = true;

          if (sIdx >= 0) {
            salespeopleStore[sIdx] = { ...salespeopleStore[sIdx], ...staffObj };
          } else {
            salespeopleStore.unshift(staffObj);
          }
          scheduleSave();
          console.log(`[Termux Hub] 👤 Synced Staff account securely: ${staffObj.name} (${staffObj.id} - ${staffObj.role}) stamped at ${hubIso}`);

          // Send SYNC_ACK
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'STAFF',
              id: staffObj.id,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          // Broadcast updated staff to other peers
          const staffBroadcastStr = JSON.stringify({
            type: 'STAFF',
            action: 'STAFF_SYNC',
            staff: staffObj,
            payload: staffObj,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(staffBroadcastStr); } catch (e) {}
            }
          });

          // Edge Gateway: Skip cloud push if PWA already synced it; otherwise push in background
          if (incomingCloudSynced) {
            console.log(`[Termux Hub] ⏭️ Dual-Writer Skip: STAFF #${staffObj.id} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
            broadcastCloudSyncAck(ws, 'STAFF', staffObj.id);
          } else {
            pushToCloud('STAFF', staffObj);
          }
        }
      }

      // =====================================================================
      // 9.1b CONFIGURATION DATA: 52 GRANULAR PERMISSIONS MATRIX (STRICT LWW)
      // =====================================================================
      if (pType === 'PERMISSIONS_MATRIX' || pType === 'PERMISSIONS_MATRIX_SYNC') {
        const incomingRules = packet.rules || packet.permissionsMatrix?.rules || (Array.isArray(payload) ? payload : payload?.rules);
        if (Array.isArray(incomingRules) && incomingRules.length > 0) {
          const hubNow = Date.now();
          const incomingTime = Number(packet.updatedAt ?? packet.permissionsMatrix?.updatedAt ?? packet.timestamp) || hubNow;
          const existingTime = Number(permissionsMatrixStore.updatedAt) || 0;
          if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
            try {
              ws.send(JSON.stringify({
                type: 'PERMISSIONS_MATRIX_SYNC',
                action: 'PERMISSIONS_MATRIX_SYNC',
                rules: permissionsMatrixStore.rules,
                permissionsMatrix: permissionsMatrixStore,
                updatedAt: existingTime,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
          } else {
            const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
            permissionsMatrixStore = { rules: incomingRules, updatedAt: hubNow, ...(incomingCloudSynced ? { isCloudSynced: true } : {}) };
            scheduleSave();
            console.log(`[Termux Hub] 🔐 Synced Permissions Matrix (${incomingRules.length} rules)`);
            try {
              ws.send(JSON.stringify({
                type: 'SYNC_ACK',
                action: 'SYNC_ACK',
                entityType: 'PERMISSIONS_MATRIX',
                updatedAt: hubNow,
              }));
            } catch (e) {}
            const permsBroadcastStr = JSON.stringify({
              type: 'PERMISSIONS_MATRIX_SYNC',
              action: 'PERMISSIONS_MATRIX_SYNC',
              rules: permissionsMatrixStore.rules,
              permissionsMatrix: permissionsMatrixStore,
              payload: permissionsMatrixStore,
              updatedAt: hubNow,
              origin_device_id: packet.origin_device_id || packet.originDeviceId || 'LOCAL_HUB',
              origin_device_name: packet.origin_device_name || packet.originDeviceName || 'Termux Local Hub',
              timestamp: hubNow,
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try { client.send(permsBroadcastStr); } catch (e) {}
              }
            });
            if (!incomingCloudSynced) {
              pushToCloud('PERMISSIONS_MATRIX', permissionsMatrixStore);
            }
          }
        }
        return;
      }

      // =====================================================================
      // 9.1c CONFIGURATION DATA: ROLE CONFIGURATIONS & MODULE ACCESS (LWW)
      // =====================================================================
      if (pType === 'ROLE_CONFIGS' || pType === 'ROLE_CONFIGS_SYNC') {
        const incomingDefs = packet.definitions || packet.roleConfigs?.definitions || payload?.definitions || (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null);
        if (incomingDefs && typeof incomingDefs === 'object') {
          const hubNow = Date.now();
          const incomingTime = Number(packet.updatedAt ?? packet.roleConfigs?.updatedAt ?? packet.timestamp) || hubNow;
          const existingTime = Number(roleConfigsStore.updatedAt) || 0;
          if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
            try {
              ws.send(JSON.stringify({
                type: 'ROLE_CONFIGS_SYNC',
                action: 'ROLE_CONFIGS_SYNC',
                definitions: roleConfigsStore.definitions,
                roleConfigs: roleConfigsStore,
                updatedAt: existingTime,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
          } else {
            const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
            roleConfigsStore = { definitions: incomingDefs, updatedAt: hubNow, ...(incomingCloudSynced ? { isCloudSynced: true } : {}) };
            scheduleSave();
            console.log(`[Termux Hub] 🛡️ Synced Role Configurations`);
            try {
              ws.send(JSON.stringify({
                type: 'SYNC_ACK',
                action: 'SYNC_ACK',
                entityType: 'ROLE_CONFIGS',
                updatedAt: hubNow,
              }));
            } catch (e) {}
            const rolesBroadcastStr = JSON.stringify({
              type: 'ROLE_CONFIGS_SYNC',
              action: 'ROLE_CONFIGS_SYNC',
              definitions: roleConfigsStore.definitions,
              roleConfigs: roleConfigsStore,
              payload: roleConfigsStore,
              updatedAt: hubNow,
              origin_device_id: packet.origin_device_id || packet.originDeviceId || 'LOCAL_HUB',
              origin_device_name: packet.origin_device_name || packet.originDeviceName || 'Termux Local Hub',
              timestamp: hubNow,
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try { client.send(rolesBroadcastStr); } catch (e) {}
              }
            });
            if (!incomingCloudSynced) {
              pushToCloud('ROLE_CONFIGS', roleConfigsStore);
            }
          }
        }
        return;
      }

      // =====================================================================
      // 9.1d CONFIGURATION DATA: MULTI-CURRENCY & EXCHANGE RATES (STRICT T2 LWW)
      // =====================================================================
      if (
        pType === 'MULTI_CURRENCY' ||
        pType === 'MULTI_CURRENCY_SYNC' ||
        pType === 'EXCHANGE_RATES' ||
        pType === 'EXCHANGE_RATES_SYNC'
      ) {
        const incomingMc =
          packet.multiCurrencyConfig ||
          packet.exchangeRates ||
          payload?.multiCurrencyConfig ||
          payload?.exchangeRates ||
          (payload && typeof payload === 'object' && payload.rates ? payload : null);
        if (incomingMc && typeof incomingMc === 'object' && incomingMc.rates) {
          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const rawIncomingTs = packet.updatedAt ?? incomingMc.updatedAt ?? incomingMc.lastUpdated ?? packet.timestamp;
          const incomingTime = incomingMc.isSystemDefault === true ? 0 : getTimestamp({ updatedAt: rawIncomingTs });
          const existingTime = Number(multiCurrencyStore.updatedAt) || 0;

          if (existingTime > 0 && (incomingTime === 0 || existingTime > incomingTime + 60000)) {
            console.log(
              `[Termux Hub] 🛡️ LWW Reject: Stale Multi-Currency update (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${incomingTime > 0 ? new Date(incomingTime).toISOString() : 'SystemDefault'}). Sending authoritative rates back.`
            );
            try {
              ws.send(JSON.stringify({
                type: 'MULTI_CURRENCY_SYNC',
                action: 'MULTI_CURRENCY_SYNC',
                entityType: 'multi_currency',
                recordId: 'MULTI_CURRENCY_CONFIG',
                multiCurrencyConfig: multiCurrencyStore.config,
                exchangeRates: multiCurrencyStore.config,
                payload: multiCurrencyStore.config,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
          } else if (incomingTime > 0 || existingTime === 0) {
            const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, incomingMc);
            const resolvedCloudSynced = incomingCloudSynced || Boolean(multiCurrencyStore.config && multiCurrencyStore.config.isCloudSynced === true);
            const storedMc = {
              ...incomingMc,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
              isSystemDefault: false,
              ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
            };
            multiCurrencyStore = { config: storedMc, updatedAt: hubNow };
            scheduleSave();
            console.log(
              `[Termux Hub] 💱 Synced Multi-Currency Config (Base: ${storedMc.baseCurrency || 'USD'}) stamped at ${hubIso}`
            );
            try {
              ws.send(JSON.stringify({
                type: 'SYNC_ACK',
                action: 'SYNC_ACK',
                entityType: 'MULTI_CURRENCY',
                recordId: 'MULTI_CURRENCY_CONFIG',
                updatedAt: hubNow,
                hubTimestamp: hubNow,
                lastUpdated: hubIso,
              }));
            } catch (e) {}
            const mcBroadcastStr = JSON.stringify({
              type: 'MULTI_CURRENCY_SYNC',
              action: 'MULTI_CURRENCY_SYNC',
              entityType: 'multi_currency',
              recordId: 'MULTI_CURRENCY_CONFIG',
              multiCurrencyConfig: storedMc,
              exchangeRates: storedMc,
              payload: storedMc,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
              origin_device_id: packet.origin_device_id || packet.originDeviceId || 'LOCAL_HUB',
              origin_device_name: packet.origin_device_name || packet.originDeviceName || 'Termux Local Hub',
              timestamp: hubNow,
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try { client.send(mcBroadcastStr); } catch (e) {}
              }
            });
            if (incomingCloudSynced) {
              console.log(`[Termux Hub] ⏭️ Dual-Writer Skip: MULTI_CURRENCY already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
              broadcastCloudSyncAck(ws, 'MULTI_CURRENCY', 'MULTI_CURRENCY_CONFIG');
            } else {
              pushToCloud('MULTI_CURRENCY', storedMc);
            }
          }
        }
        return;
      }

      // =====================================================================
      // 9.2 CONFIGURATION DATA: CUSTOMERS & CREDIT LIMITS (STRICT LWW)
      // =====================================================================
      // CRITICAL: Only match explicit CUSTOMER packets! Never hijack SALE, CUSTOMER_CHANGE,
      // or CREDIT_SALE packets that happen to carry payload.customerId.
      const isExplicitCustType =
        pType === 'CUSTOMER' ||
        pType === 'CUSTOMER_SYNC' ||
        pType === 'CUSTOMER_RECORD' ||
        pType === 'customer' ||
        sheetName === 'Customers' ||
        packet.entityType === 'customer' ||
        Boolean(packet.customer);
      const rawCustCandidate = packet.customer || (isExplicitCustType ? payload : null);
      const isNonCustomerTransactionBlob =
        !rawCustCandidate ||
        typeof rawCustCandidate !== 'object' ||
        'changeId' in rawCustCandidate ||
        'creditId' in rawCustCandidate ||
        'creditSaleId' in rawCustCandidate ||
        'invoiceNumber' in rawCustCandidate ||
        Array.isArray(rawCustCandidate.items) ||
        ('in' in rawCustCandidate && 'out' in rawCustCandidate);
      const custObj = isExplicitCustType && !isNonCustomerTransactionBlob ? rawCustCandidate : null;

      if (custObj && (custObj.customerId || custObj.id)) {
        const cId = custObj.customerId || custObj.id;
        const incomingName = String(custObj.name || custObj.CustomerName || custObj.customerName || '').trim();
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();
        const incomingTime = getTimestamp(custObj) || getTimestamp(packet);
        if (isTombstoned(cId, 'customer', incomingTime)) {
          const tomb = findHubTombstone(cId, 'customer');
          console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned customer #${cId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: 'TOMBSTONE_SYNC', action: 'TOMBSTONE_SYNC', entityType: 'tombstone', tombstone: tomb, payload: tomb, origin_device_id: 'LOCAL_HUB', timestamp: Date.now() }));
            } catch (e) {}
          }
          return;
        }
        const cIdx = customersStore.findIndex((c) => (c.customerId || c.id) === cId);
        // Never create a ghost blank-name customer record
        if (cIdx < 0 && !incomingName) {
          console.log(`[Termux Hub] 🛡️ Ignored blank-name customer payload for ${cId}`);
          return;
        }
        let accepted = true;

        if (cIdx >= 0) {
          const existing = customersStore[cIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
            console.log(
              `[Termux Hub] 🛡️ LWW Reject: Stale customer update for ${cId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                type: 'CUSTOMER',
                action: 'CUSTOMER_SYNC',
                customer: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            accepted = false;
          }
        }

        if (accepted) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, custObj);
          const resolvedCloudSynced = incomingCloudSynced || (cIdx >= 0 && customersStore[cIdx].isCloudSynced === true);
          const existingCust = cIdx >= 0 ? customersStore[cIdx] : null;
          const preservedName = incomingName || String(existingCust?.name || existingCust?.CustomerName || '').trim();
          const savedCust = {
            ...(existingCust || {}),
            ...custObj,
            customerId: cId,
            id: cId,
            name: preservedName,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
          };

          if (cIdx >= 0) {
            customersStore[cIdx] = savedCust;
          } else {
            customersStore.unshift(savedCust);
          }
          scheduleSave();
          console.log(`[Termux Hub] 👥 Synced Customer account: ${savedCust.name} (${cId}) stamped at ${hubIso}`);

          // Send SYNC_ACK
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'CUSTOMER',
              id: cId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          // Broadcast merged authoritative customer to other peers
          const custBroadcastStr = JSON.stringify({
            type: 'CUSTOMER',
            action: 'CUSTOMER_SYNC',
            customer: savedCust,
            payload: savedCust,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(custBroadcastStr); } catch (e) {}
            }
          });

          // Edge Gateway: Skip cloud push if PWA already synced it; otherwise push in background
          if (incomingCloudSynced) {
            console.log(`[Termux Hub] ⏭️ Dual-Writer Skip: CUSTOMER #${cId} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
            broadcastCloudSyncAck(ws, 'CUSTOMER', cId);
          } else {
            pushToCloud('CUSTOMER', savedCust);
          }
        }
      }

      // =====================================================================
      // 9.3 CONFIGURATION DATA: BRANCHES (STRICT LWW & STRICT TYPE ROUTING)
      // =====================================================================
      const rawBranchObj = packet.branch || ((entityType === 'branch' || sheetName === 'Branches' || sheetName === 'branches') ? payload : null);
      const isExplicitBranchType =
        pType === 'BRANCH' ||
        pType === 'BRANCH_SYNC' ||
        pType === 'BRANCH_RECORD' ||
        pType === 'branch' ||
        entityType === 'branch' ||
        sheetName === 'Branches' ||
        sheetName === 'branches' ||
        packet.type === 'BRANCH_SYNC' ||
        packet.type === 'BRANCH' ||
        packet.action === 'BRANCH_SYNC' ||
        Boolean(packet.branch);

      const isValidBranchSchema = isValidBranchRecord(rawBranchObj);
      const isBranch = isExplicitBranchType && isValidBranchSchema;

      if (isBranch && rawBranchObj && (rawBranchObj.branchId || rawBranchObj.id || rawBranchObj.branch_id || rawBranchObj.BranchID)) {
        const rawBId = rawBranchObj.branchId || rawBranchObj.id || rawBranchObj.branch_id || rawBranchObj.BranchID;
        const bId = canonicalizeHubBranchId(rawBId);
        const bComp = normHubBranchTenant(rawBranchObj.company_id || rawBranchObj.companyId || rawBranchObj.CompanyID || packet.companyId || packet.company_id || hubTenantId);
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();
        const incomingTime = getTimestamp(rawBranchObj) || getTimestamp(packet);
        if (isTombstoned(bId, 'branch', incomingTime)) {
          const tomb = findHubTombstone(bId, 'branch');
          console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned branch #${bId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: 'TOMBSTONE_SYNC', action: 'TOMBSTONE_SYNC', entityType: 'tombstone', tombstone: tomb, payload: tomb, origin_device_id: 'LOCAL_HUB', timestamp: Date.now() }));
            } catch (e) {}
          }
          return;
        }
        const incomingName = String(rawBranchObj.name || rawBranchObj.branch_name || rawBranchObj.branchName || rawBranchObj.Name || '').trim();
        const incomingCode = String(rawBranchObj.code || rawBranchObj.branch_code || rawBranchObj.branchCode || rawBranchObj.Code || '').trim();
        const incomingLoc = String(rawBranchObj.location || rawBranchObj.address || rawBranchObj.Location || rawBranchObj.Address || '').trim();

        let bIdx = branchesStore.findIndex(
          (b) =>
            normHubBranchTenant(b.company_id || b.companyId || hubTenantId) === bComp &&
            canonicalizeHubBranchId(b.branchId || b.id || b.branch_id).toUpperCase() === bId.toUpperCase()
        );
        if (bIdx < 0 && incomingCode && !isHubPlaceholderBranchCode(incomingCode, bId)) {
          bIdx = branchesStore.findIndex(
            (b) =>
              normHubBranchTenant(b.company_id || b.companyId || hubTenantId) === bComp &&
              String(b.code || '').trim().toUpperCase() === incomingCode.toUpperCase()
          );
        }
        let accepted = true;

        if (bIdx >= 0) {
          const existing = branchesStore[bIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
            console.log(
              `[Termux Hub] 🛡️ LWW Reject: Stale branch update for ${bId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                type: 'BRANCH',
                action: 'BRANCH_SYNC',
                branch: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            accepted = false;
          }
        }

        if (accepted) {
          const existing = bIdx >= 0 ? branchesStore[bIdx] : null;
          const resolvedId = existing ? canonicalizeHubBranchId(existing.branchId || bId) : bId;
          const resolvedName = !isHubPlaceholderBranchName(incomingName)
            ? incomingName
            : existing && !isHubPlaceholderBranchName(existing.name)
            ? existing.name
            : (incomingName || existing?.name || 'Main Branch');
          const resolvedCode = !isHubPlaceholderBranchCode(incomingCode, resolvedId)
            ? incomingCode
            : existing && !isHubPlaceholderBranchCode(existing.code, resolvedId)
            ? existing.code
            : (incomingCode || existing?.code || resolvedId);
          const resolvedLoc = incomingLoc || existing?.location || existing?.address || '';
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawBranchObj);
          const resolvedCloudSynced = incomingCloudSynced || (existing && existing.isCloudSynced === true);
          const stamped = {
            ...(existing || {}),
            ...rawBranchObj,
            branchId: resolvedId,
            id: resolvedId,
            branch_id: resolvedId,
            company_id: bComp,
            companyId: bComp,
            name: resolvedName,
            code: resolvedCode,
            location: resolvedLoc,
            address: resolvedLoc,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...(resolvedCloudSynced ? { isCloudSynced: true } : {}),
          };

          if (bIdx >= 0) {
            branchesStore[bIdx] = stamped;
          } else {
            branchesStore.unshift(stamped);
          }
          branchesStore = normalizeAndDeduplicateHubBranches(branchesStore);
          scheduleSave();
          console.log(`[Termux Hub] 🏢 Synced Branch: ${stamped.name || stamped.branchName || resolvedId} (${resolvedId}) stamped at ${hubIso}`);

          // Send SYNC_ACK
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'BRANCH',
              id: bId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'BRANCH', bId);

          // Broadcast updated branch to other peers
          const branchBroadcastStr = JSON.stringify({
            type: 'BRANCH',
            action: 'BRANCH_SYNC',
            branch: stamped,
            payload: stamped,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(branchBroadcastStr); } catch (e) {}
            }
          });
        }
      }

      // =====================================================================
      // 9.4 CONFIGURATION DATA: CASH ACCOUNTS (STRICT LWW)
      // =====================================================================
      const rawCashAccObj = packet.cashAccount || (payload && (payload.account_id || (sheetName && sheetName.toLowerCase() === 'cashaccounts')) ? payload : null);
      const isCashAccount = pType === 'CASH_ACCOUNT' || pType === 'CASH_ACCOUNT_SYNC' || pType === 'CASH_ACCOUNT_RECORD' || pType === 'cash_account' || sheetName === 'CashAccounts' || sheetName === 'cash_accounts' || !!rawCashAccObj;
      if (isCashAccount && rawCashAccObj && (rawCashAccObj.account_id || rawCashAccObj.id)) {
        const accId = rawCashAccObj.account_id || rawCashAccObj.id;
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();
        const incomingTime = getTimestamp(rawCashAccObj) || getTimestamp(packet);
        if (isTombstoned(accId, 'cash_account', incomingTime)) {
          const tomb = findHubTombstone(accId, 'cash_account');
          console.log(`[Termux Hub] 🪦 Resurrection Blocked for tombstoned cash account #${accId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: 'TOMBSTONE_SYNC', action: 'TOMBSTONE_SYNC', entityType: 'tombstone', tombstone: tomb, payload: tomb, origin_device_id: 'LOCAL_HUB', timestamp: Date.now() }));
            } catch (e) {}
          }
          return;
        }
        const incAccComp = String(rawCashAccObj.company_id || rawCashAccObj.companyId || packet.company_id || packet.companyId || '').trim().toUpperCase();
        const aIdx = cashAccountsStore.findIndex((a) => {
          if ((a.account_id || a.id) !== accId) return false;
          const exComp = String(a.company_id || a.companyId || '').trim().toUpperCase();
          return !incAccComp || !exComp || exComp === incAccComp;
        });
        let accepted = true;

        if (aIdx >= 0) {
          const existing = cashAccountsStore[aIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
            console.log(
              `[Termux Hub] 🛡️ LWW Reject: Stale cash account update for ${accId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                packetId: `HUB-CACC-FIX-${accId}-${hubNow}`,
                type: 'CASH_ACCOUNT',
                action: 'CASH_ACCOUNT_SYNC',
                entityType: 'cash_account',
                companyId: existing.company_id || packet.companyId,
                branchId: existing.branch_id || packet.branchId,
                target_branch_id: (existing.account_type === 'HQ_SAFE' || existing.account_type === 'BANK_ACCOUNT' || existing.branch_id === 'HQ') ? 'ALL' : (existing.branch_id || packet.branchId || 'BR-MAIN'),
                cashAccount: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            accepted = false;
          }
        }

        if (accepted) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawCashAccObj);
          const prevAcc = aIdx >= 0 ? cashAccountsStore[aIdx] : null;
          const balanceChanged =
            !prevAcc ||
            Math.abs((Number(rawCashAccObj.current_balance) || 0) - (Number(prevAcc.current_balance) || 0)) > 0.005 ||
            Math.abs((Number(rawCashAccObj.native_balance) || 0) - (Number(prevAcc.native_balance) || 0)) > 0.005;
          // CRITICAL: Never preserve stale isCloudSynced=true when a local balance update arrives!
          const resolvedCloudSynced = incomingCloudSynced || (!balanceChanged && Boolean(prevAcc && prevAcc.isCloudSynced === true));
          const isGlobalAcc =
            rawCashAccObj.account_type === 'HQ_SAFE' ||
            rawCashAccObj.account_type === 'BANK_ACCOUNT' ||
            String(rawCashAccObj.branch_id || '').toUpperCase().trim() === 'HQ';
          const stamped = {
            ...(prevAcc || {}),
            ...rawCashAccObj,
            account_id: accId,
            id: accId,
            target_branch_id: isGlobalAcc ? 'ALL' : (rawCashAccObj.target_branch_id || rawCashAccObj.branch_id || prevAcc?.branch_id || 'BR-MAIN'),
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            updated_at: hubIso,
            isCloudSynced: resolvedCloudSynced,
          };

          if (aIdx >= 0) {
            cashAccountsStore[aIdx] = stamped;
          } else {
            cashAccountsStore.unshift(stamped);
          }
          scheduleSave();
          console.log(`[Termux Hub] 💰 Synced Cash Account: ${stamped.account_name || accId} (${accId}) bal=$${Number(stamped.current_balance || 0).toFixed(2)} (cloudSynced=${resolvedCloudSynced})`);

          // Send SYNC_ACK
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'CASH_ACCOUNT',
              id: accId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CASH_ACCOUNT', accId);

          // Broadcast updated cash account to other peers
          const accBroadcastStr = JSON.stringify({
            packetId: `HUB-CACC-${accId}-${hubNow}`,
            type: 'CASH_ACCOUNT',
            action: 'CASH_ACCOUNT_SYNC',
            entityType: 'cash_account',
            companyId: stamped.company_id || packet.companyId,
            branchId: stamped.branch_id || packet.branchId,
            target_branch_id: stamped.target_branch_id,
            cashAccount: stamped,
            payload: stamped,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(accBroadcastStr); } catch (e) {}
            }
          });
        }
        return;
      }

      // =====================================================================
      // 9.3 END OF DAY (EOD) & BUSINESS DAY CLOSURES
      // =====================================================================
      const isEod =
        pType === 'END_OF_DAY_COMPLETED' ||
        pType === 'BUSINESS_DAY_CLOSURE' ||
        pType === 'EOD_COMPLETED' ||
        sheetName === 'BusinessDayClosures';

      if (isEod) {
        const closure = packet.closure || payload || packet.data;
        if (closure && (closure.id || closure.date)) {
          const cId = closure.id || `EOD-${closure.date}`;
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, closure);
          const exIdx = businessDayClosuresStore.findIndex((c) => c.id === cId || c.date === closure.date);
          const resolvedCloudSynced = incomingCloudSynced || (exIdx >= 0 && businessDayClosuresStore[exIdx].isCloudSynced === true);
          if (exIdx >= 0) {
            businessDayClosuresStore[exIdx] = { ...businessDayClosuresStore[exIdx], ...closure, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) };
          } else {
            businessDayClosuresStore.unshift({ ...closure, ...(resolvedCloudSynced ? { isCloudSynced: true } : {}) });
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, 'CLOSURE', cId);
          console.log(`[Termux Hub] Recorded End of Day Closure for Date: ${closure.date} by ${closure.closedBySupervisorName || 'Supervisor'}`);
        }
      }

      // =====================================================================
      // 9.4 TOMBSTONES / SOFT DELETES (STRICT ROUTING & SYNC)
      // =====================================================================
      const isTombstone = pType === 'TOMBSTONE_SYNC' || pType === 'tombstone' || entityType === 'tombstone';
      if (isTombstone) {
        const tombObj = packet.tombstone || payload || packet;
        if (tombObj && tombObj.entityId && tombObj.entityType) {
          const stampedTomb = recordAndPurgeHubTombstone(
            tombObj.entityType,
            tombObj.entityId,
            tombObj.deletedAt || Date.now(),
            tombObj
          );
          scheduleSave();
          console.log(`[Termux Hub] 🪦 Recorded Tombstone & purged ${stampedTomb.entityType} #${stampedTomb.entityId}`);

          // Broadcast tombstone to other connected peers
          const tombcast = JSON.stringify({
            type: 'TOMBSTONE_SYNC',
            action: 'TOMBSTONE_SYNC',
            entityType: 'tombstone',
            tombstone: stampedTomb,
            payload: stampedTomb,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: Date.now(),
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(tombcast); } catch (e) {}
            }
          });
          return;
        }
      }

      // =====================================================================
      // 9.5 INVENTORY SNAPSHOT REQUEST (ON-DEMAND HEARTBEAT)
      // =====================================================================
      const isSnapReq = pType === 'INVENTORY_SNAPSHOT_REQUEST' || pType === 'GET_INVENTORY_SNAPSHOT';
      if (isSnapReq) {
        const reqComp = (packet.companyId || packet.company_id || 'COMP-001').trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || 'BR-MAIN').trim().toUpperCase();
        const items = inventoryStore
          .filter((i) => !isTombstoned(getTombstoneRecordId(i, 'inventory_item'), 'inventory_item', getTimestamp(i)) && isMatch(i, reqComp, reqBranch, true))
          .map((i) => ({
            ...i,
            totalUnits: Number(i.totalUnits || 0),
            stockSingles: Number(i.stockSingles !== undefined ? i.stockSingles : i.totalUnits || 0),
            snapshotTimestamp: i.snapshotTimestamp || getTimestamp(i) || Date.now(),
          }));

        const snapTombstones = tombstonesStore.filter(
          (t) =>
            t &&
            normalizeHubEntityType(t.entityType) === 'inventory_item' &&
            isMatch(t, reqComp, reqBranch, true)
        );

        try {
          ws.send(JSON.stringify({
            type: 'INVENTORY_SNAPSHOT_RESPONSE',
            action: 'INVENTORY_SNAPSHOT_RESPONSE',
            items,
            tombstones: snapTombstones,
            count: items.length,
            snapshotTimestamp: Date.now(),
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: Date.now(),
          }));
          console.log(`[Termux Hub] 📸 Dispatched full inventory snapshot (${items.length} items, ${snapTombstones.length} tombstones) to peer`);
        } catch (e) {}
        return;
      }

      // =====================================================================
      // 9.6 FETCH HISTORICAL T1 ON-DEMAND (WITHOUT POPULATING CLIENT IDB)
      // =====================================================================
      const isHistoricalFetch = pType === 'FETCH_HISTORICAL_T1' || pType === 'GET_HISTORICAL_T1';
      if (isHistoricalFetch) {
        const reqComp = (packet.companyId || packet.company_id || 'COMP-001').trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || 'BR-MAIN').trim().toUpperCase();
        const targetEntity = String(packet.targetEntity || packet.entity || 'sales').toLowerCase();
        const startDate = packet.startDate ? new Date(packet.startDate).getTime() : 0;
        const endDate = packet.endDate ? new Date(packet.endDate).getTime() : Date.now();

        let results = [];
        if (targetEntity.includes('sale')) {
          results = salesStore.filter((s) => isMatch(s, reqComp, reqBranch) && getTimestamp(s) >= startDate && getTimestamp(s) <= endDate);
        } else if (targetEntity.includes('grv')) {
          results = directGrvsStore.filter((g) => isMatch(g, reqComp, reqBranch) && getTimestamp(g) >= startDate && getTimestamp(g) <= endDate);
        } else if (targetEntity.includes('expense')) {
          results = expensesStore.filter((e) => isMatch(e, reqComp, reqBranch) && getTimestamp(e) >= startDate && getTimestamp(e) <= endDate);
        } else if (targetEntity.includes('cash')) {
          results = cashLogsStore.filter((c) => isMatch(c, reqComp, reqBranch) && getTimestamp(c) >= startDate && getTimestamp(c) <= endDate);
        }

        try {
          ws.send(JSON.stringify({
            type: 'HISTORICAL_T1_RESPONSE',
            action: 'HISTORICAL_T1_RESPONSE',
            requestId: packet.requestId || packet.packet_id,
            targetEntity,
            records: results,
            count: results.length,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: Date.now(),
          }));
          console.log(`[Termux Hub] 📜 Dispatched ${results.length} historical ${targetEntity} records for query [${packet.startDate} -> ${packet.endDate}]`);
        } catch (e) {}
        return;
      }

      // =====================================================================
      // 9.7 SERVER-SIDE FINANCIAL REPORT AGGREGATION
      // =====================================================================
      const isFinReportReq = pType === 'GET_FINANCIAL_REPORT' || pType === 'FINANCIAL_REPORT_REQUEST';
      if (isFinReportReq) {
        const reqComp = (packet.companyId || packet.company_id || 'COMP-001').trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || 'BR-MAIN').trim().toUpperCase();
        const startDate = packet.startDate ? new Date(packet.startDate).getTime() : 0;
        const endDate = packet.endDate ? new Date(packet.endDate).getTime() : Date.now();

        const filteredSales = salesStore.filter(
          (s) => isMatch(s, reqComp, reqBranch) && s.status !== 'Voided' && getTimestamp(s) >= startDate && getTimestamp(s) <= endDate
        );
        const filteredExpenses = expensesStore.filter(
          (e) => isMatch(e, reqComp, reqBranch) && getTimestamp(e) >= startDate && getTimestamp(e) <= endDate
        );

        let totalRevenue = 0;
        let totalCogs = 0;
        let invoiceCount = filteredSales.length;

        for (const s of filteredSales) {
          totalRevenue += Number(s.total || s.total_amount || 0);
          if (Array.isArray(s.items)) {
            for (const it of s.items) {
              const qty = Number(it.quantity || 0);
              const cost = Number(it.costPrice || it.costPerUnit || 0);
              totalCogs += qty * cost;
            }
          }
        }

        let totalExpenses = 0;
        for (const exp of filteredExpenses) {
          totalExpenses += Number(exp.amount || 0);
        }

        const grossProfit = Number((totalRevenue - totalCogs).toFixed(2));
        const netProfit = Number((grossProfit - totalExpenses).toFixed(2));
        const grossMargin = totalRevenue > 0 ? Number(((grossProfit / totalRevenue) * 100).toFixed(2)) : 0;
        const netMargin = totalRevenue > 0 ? Number(((netProfit / totalRevenue) * 100).toFixed(2)) : 0;

        try {
          ws.send(JSON.stringify({
            type: 'FINANCIAL_REPORT_RESPONSE',
            action: 'FINANCIAL_REPORT_RESPONSE',
            requestId: packet.requestId || packet.packet_id,
            report: {
              startDate: packet.startDate,
              endDate: packet.endDate,
              invoiceCount,
              totalRevenue: Number(totalRevenue.toFixed(2)),
              totalCogs: Number(totalCogs.toFixed(2)),
              grossProfit,
              grossMarginPercentage: grossMargin,
              totalExpenses: Number(totalExpenses.toFixed(2)),
              netProfit,
              netMarginPercentage: netMargin,
              generatedAt: new Date().toISOString(),
            },
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: Date.now(),
          }));
          console.log(`[Termux Hub] 📊 Computed server-side financial report: Revenue=$${totalRevenue.toFixed(2)}, Net Profit=$${netProfit.toFixed(2)}`);
        } catch (e) {}
        return;
      }

      // =====================================================================
      // 9.8 GENERIC LOCAL QUERY API (FUTURE-PROOF REPORTS & KPI QUERIES)
      // =====================================================================
      const isGenericQueryReq = pType === 'QUERY_ENTITIES' || pType === 'QUERY_ENTITIES_REQUEST';
      if (isGenericQueryReq) {
        const queryResult = queryHubEntities({
          entityType: packet.entityType || packet.entity || packet.targetEntity,
          companyId: packet.companyId || packet.company_id || hubTenantId,
          branchId: packet.branchId || packet.branch_id || packet.branchCode || 'ALL',
          dateFrom: packet.dateFrom || packet.startDate,
          dateTo: packet.dateTo || packet.endDate,
          status: packet.status,
          limit: packet.limit,
        });
        try {
          ws.send(JSON.stringify({
            type: 'QUERY_ENTITIES_RESPONSE',
            action: 'QUERY_ENTITIES_RESPONSE',
            requestId: packet.requestId || packet.packet_id,
            entityType: queryResult.entityType,
            records: queryResult.records,
            count: queryResult.count,
            totalMatched: queryResult.totalMatched,
            truncated: queryResult.truncated,
            hubTimestamp: Date.now(),
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: Date.now(),
          }));
          console.log(`[Termux Hub] 🔎 QUERY_ENTITIES("${queryResult.entityType}") returned ${queryResult.count}/${queryResult.totalMatched} records`);
        } catch (e) {}
        return;
      }

      // =====================================================================
      // 10. DELTA CATCH-UP RESPONSE (NO FIREHOSE - ONLY updatedAt >= sinceTime)
      // =====================================================================
      const isCatchupReq = pType === 'catchup_request' || pType === 'CATCHUP_REQUEST';
      if (isCatchupReq) {
        let sinceTime = 0;
        let sinceTimestamp = packet.sinceTimestamp;
        const isExplicitZero =
          sinceTimestamp === 0 ||
          sinceTimestamp === '0' ||
          sinceTimestamp === '1970-01-01T00:00:00.000Z' ||
          sinceTimestamp === '1970-01-01T00:00:00Z';

        if (isExplicitZero || packet.isForced) {
          sinceTime = 0;
          sinceTimestamp = '1970-01-01T00:00:00.000Z';
        } else if (typeof sinceTimestamp === 'number') {
          sinceTime = sinceTimestamp;
        } else if (typeof sinceTimestamp === 'string') {
          const asNum = Number(sinceTimestamp);
          if (!isNaN(asNum) && asNum > 1000000000000) {
            sinceTime = asNum;
          } else {
            sinceTime = new Date(sinceTimestamp).getTime();
          }
        }

        // Guard against NaN or negative timestamps; default to 5m only if completely invalid/missing
        if (isNaN(sinceTime) || (sinceTime <= 0 && !isExplicitZero && !packet.isForced)) {
          sinceTime = Date.now() - 5 * 60 * 1000;
          sinceTimestamp = new Date(sinceTime).toISOString();
        } else if (!isExplicitZero) {
          sinceTimestamp = new Date(sinceTime).toISOString();
        }

        const reqDeviceId = packet.originDeviceId || 'unknown';
        const reqComp = (packet.companyId || packet.company_id || 'COMP-001').trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || 'BR-MAIN').trim().toUpperCase();

        console.log(
          `[Termux Hub] 📥 Received CATCHUP_REQUEST from ${reqDeviceId}: ` +
          `sinceTimestamp="${packet.sinceTimestamp}" parsed to sinceTime=${sinceTime} (${new Date(sinceTime).toISOString()}), isForced=${Boolean(packet.isForced)}`
        );

        // NO FIREHOSE: Send ONLY records where getTimestamp(item) >= sinceTime!
        // Do not dump the entire 501-item catalog unless explicitly forced!
        const missedSales = salesStore.filter((s) => isMatch(s, reqComp, reqBranch) && (getTimestamp(s) >= sinceTime || packet.isForced || isExplicitZero));
        const missedDirectGrvs = directGrvsStore.filter((g) => isMatch(g, reqComp, reqBranch) && (getTimestamp(g) >= sinceTime || packet.isForced || isExplicitZero));
        const missedInventory = inventoryStore
          .filter((item) => !isTombstoned(item.itemId || item.id, 'inventory_item', getTimestamp(item)))
          .filter((i) => isMatch(i, reqComp, reqBranch, true) && (getTimestamp(i) >= sinceTime || packet.isForced || isExplicitZero));
        const isVaultCashLogRec = (c) => Boolean(
          c?.isVaultCustody ||
          String(c?.staffId || '').toUpperCase().trim() === 'VAULT_CUSTODY' ||
          String(c?.branch_id || c?.branchId || '').toUpperCase().trim() === 'HQ'
        );
        const missedCashLogs = deduplicateHubCashLogs(
          cashLogsStore.filter((c) => isMatch(c, reqComp, isVaultCashLogRec(c) ? 'ALL' : reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero))
        );
        const missedCashLifts = cashLiftsStore.filter((l) => isMatch(l, reqComp, reqBranch) && (getTimestamp(l) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashMovements = cashMovementsStore.filter((m) => isMatch(m, reqComp, reqBranch) && (getTimestamp(m) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCustomerChanges = customerChangesStore.filter((ch) => isMatch(ch, reqComp, reqBranch) && (getTimestamp(ch) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCreditSales = creditSalesStore.filter((cs) => isMatch(cs, reqComp, reqBranch) && (getTimestamp(cs) >= sinceTime || packet.isForced || isExplicitZero));
        const missedStockMovements = deduplicateHubStockMovements(
          stockMovementsStore.filter((sm) => isMatch(sm, reqComp, reqBranch) && (getTimestamp(sm) >= sinceTime || packet.isForced || isExplicitZero))
        );
        const missedExpenses = expensesStore.filter((ex) => isMatch(ex, reqComp, reqBranch) && (getTimestamp(ex) >= sinceTime || packet.isForced || isExplicitZero));
        const missedInternalConsumptions = internalConsumptionsStore.filter((ic) => isMatch(ic, reqComp, reqBranch) && (getTimestamp(ic) >= sinceTime || packet.isForced || isExplicitZero));
        const isGlobalCashTransferRec = (tr) => {
          const t = String(tr?.type || '').toUpperCase().trim();
          const b = String(tr?.branch_id || '').toUpperCase().trim();
          const tb = String(tr?.target_branch_id || '').toUpperCase().trim();
          return b === 'HQ' || b === 'ALL' || tb === 'ALL' ||
            t === 'HQ_TO_BRANCH' || t === 'BRANCH_TO_HQ' || t === 'BANK_DEPOSIT' ||
            t === 'BANK_WITHDRAWAL' || t === 'ELECTRONIC_SETTLEMENT' || t === 'CAPITAL_INFUSION' || t === 'SUPPLIER_PAYMENT' || t === 'THIRD_PARTY_PAYOUT';
        };
        const missedCashTransfers = cashTransfersStore.filter((tr) => isMatch(tr, reqComp, isGlobalCashTransferRec(tr) ? 'ALL' : reqBranch) && (getTimestamp(tr) >= sinceTime || packet.isForced || isExplicitZero));
        const missedSuppliers = suppliersStore
          .filter((item) => !isTombstoned(item.supplierId || item.SupplierID || item.id, 'supplier', getTimestamp(item)))
          .filter((s) => isMatch(s, reqComp, reqBranch) && (getTimestamp(s) >= sinceTime || packet.isForced || isExplicitZero));
        const missedAdminSales = adminSalesStore.filter((a) => isMatch(a, reqComp, reqBranch) && (getTimestamp(a) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashCounts = cashCountsStore.filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero));
        const missedVouchers = vouchersStore.filter((v) => isMatch(v, reqComp, reqBranch) && (getTimestamp(v) >= sinceTime || packet.isForced || isExplicitZero));
        let isStaffExplicitZero = isExplicitZero;
        let staffSinceTime = sinceTime;
        if (packet.staffSinceTime !== undefined) {
          staffSinceTime = Number(packet.staffSinceTime) || 0;
          if (staffSinceTime === 0) isStaffExplicitZero = true;
        } else if (packet.staffSinceTimestamp === '1970-01-01T00:00:00.000Z') {
          staffSinceTime = 0;
          isStaffExplicitZero = true;
        }

        const missedSalespeople = salespeopleStore
          .filter((item) => !isTombstoned(item.id || item.staffId, 'staff', getTimestamp(item)))
          .filter((s) => isMatch(s, reqComp, 'ALL') && (getTimestamp(s) >= staffSinceTime || packet.isForced || isExplicitZero || isStaffExplicitZero));
        const missedCustomers = customersStore
          .filter((item) => !isTombstoned(item.customerId || item.id, 'customer', getTimestamp(item)))
          .filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero));
        const missedBranches = branchesStore
          .filter((item) => !isTombstoned(canonicalizeHubBranchId(item.branchId || item.branch_id || item.id), 'branch', getTimestamp(item)))
          .filter((b) => isValidBranchRecord(b) && isMatch(b, reqComp, 'ALL') && (getTimestamp(b) >= sinceTime || packet.isForced || isExplicitZero));
        const isGlobalCashAccRec = (a) => (
          a?.account_type === 'HQ_SAFE' ||
          a?.account_type === 'BANK_ACCOUNT' ||
          String(a?.branch_id || '').toUpperCase().trim() === 'HQ' ||
          String(a?.target_branch_id || '').toUpperCase().trim() === 'ALL'
        );
        const missedCashAccounts = cashAccountsStore
          .filter((item) => !isTombstoned(item.account_id || item.id, 'cash_account', getTimestamp(item)))
          .filter((a) => isMatch(a, reqComp, isGlobalCashAccRec(a) ? 'ALL' : reqBranch) && (getTimestamp(a) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCasualWorkers = casualWorkersStore
          .filter((item) => !isTombstoned(item.id || item.pin_hash, 'casual_worker', getTimestamp(item)))
          .filter((item) => isMatch(item, reqComp, 'ALL'));
        const missedCategories = categoriesStore
          .filter((item) => !isTombstoned(item.categoryId || item.id || item.categoryName, 'inventory_category', getTimestamp(item)))
          .filter((item) => isMatch(item, reqComp, 'ALL'));
        const missedCreditGroups = creditGroupsStore
          .filter((item) => !isTombstoned(item.groupId || item.id, 'credit_group', getTimestamp(item)))
          .filter((item) => isMatch(item, reqComp, 'ALL'));
        const missedStocktakeSessions = stocktakeSessionsStore
          .filter((item) => !isTombstoned(item.sessionId || item.id, 'stocktake_session', getTimestamp(item)))
          .filter((item) => isMatch(item, reqComp, reqBranch));
        const missedZoneAssignments = zoneAssignmentsStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedBranchLockdowns = Object.values(branchLockdownsStore || {}).filter(
          (item) => item && isMatch(item, reqComp, reqBranch)
        );
        const missedBusinessDayClosures = businessDayClosuresStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedElectronicSettlements = electronicSettlementsStore.filter(
          (item) => isMatch(item, reqComp, 'ALL') && (getTimestamp(item) >= sinceTime || packet.isForced || isExplicitZero)
        );
        const missedStocktakeSegments = stocktakeSegmentsStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedDailyBlindConfigs = dailyBlindConfigsStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedDailyBlindCounts = dailyBlindCountsStore.filter(
          (item) => isMatch(item, reqComp, reqBranch) && (getTimestamp(item) >= sinceTime || packet.isForced || isExplicitZero)
        );
        const missedPurchaseOrders = purchaseOrdersStore.filter(
          (item) => isMatch(item, reqComp, reqBranch) && (getTimestamp(item) >= sinceTime || packet.isForced || isExplicitZero)
        );
        const missedSecurityAlerts = securityAlertsStore.filter((item) => isMatch(item, reqComp, 'ALL')).slice(0, 50);
        const tombstoneWindowStart = Math.max(0, sinceTime - 5 * 60 * 1000);
        const missedTombstones = tombstonesStore.filter((t) => {
          if (!t || !t.entityId) return false;
          const isCat = isCatalogTombstoneType(t.entityType);
          if (!isMatch(t, reqComp, reqBranch, isCat)) return false;
          if (packet.isForced || isExplicitZero) return true;
          const tombTs = Math.max(Number(t.hubTimestamp) || 0, Number(t.deletedAt) || 0, getTimestamp(t));
          return tombTs >= tombstoneWindowStart;
        });

        const missedGenericEnvelopes = [];
        for (const [gType, bucket] of Object.entries(genericEntitiesStore || {})) {
          if (!bucket || typeof bucket !== 'object') continue;
          const isGlobalGen = isHubGlobalBranchEntityType(gType) || isCanonicalT2Type(gType);
          const isT2Gen = isCanonicalT2Type(gType);
          for (const [gId, rec] of Object.entries(bucket)) {
            if (!rec || typeof rec !== 'object') continue;
            const recTs = Number(rec._updatedAt || getTimestamp(rec)) || 0;
            if (isT2Gen && isTombstoned(gId, gType, recTs)) continue;
            if (!isMatch(rec, reqComp, reqBranch, isGlobalGen)) continue;
            if (recTs >= sinceTime || packet.isForced || isExplicitZero) {
              missedGenericEnvelopes.push({
                packetId: `HUB-GEN-${gType}-${gId}-${recTs}`,
                entityType: gType,
                entityId: gId,
                action: 'UPSERT',
                class: rec._class || (isT2Gen ? 'T2' : 'T1'),
                updatedAt: recTs || Date.now(),
                originDeviceId: 'LOCAL_HUB',
                targetBranchId: isGlobalGen ? 'ALL' : (rec.branch_id || rec.branchId || reqBranch || 'ALL'),
                data: rec,
              });
            }
          }
        }

        const catchupResponse = {
          type: 'catchup_response',
          action: 'CATCHUP_RESPONSE',
          packet_id: `CRS-HUB-${Date.now()}`,
          originDeviceId: 'LOCAL_HUB',
          originDeviceName: 'Termux Local Hub',
          targetDeviceId: reqDeviceId,
          sinceTimestamp,
          cutoffTimestamp: new Date().toISOString(),
          isReciprocal: true,
          delta: {
            sales: missedSales,
            directGrvs: missedDirectGrvs,
            inventoryItems: missedInventory,
            cashLogs: missedCashLogs,
            cashLifts: missedCashLifts,
            cashMovements: missedCashMovements,
            customerChanges: missedCustomerChanges,
            creditSales: missedCreditSales,
            stockMovements: missedStockMovements,
            expenses: missedExpenses,
            internalConsumptions: missedInternalConsumptions,
            cashTransfers: missedCashTransfers,
            suppliers: missedSuppliers,
            adminSales: missedAdminSales,
            cashCounts: missedCashCounts,
            vouchers: missedVouchers,
            casualWorkers: missedCasualWorkers,
            zoneAssignments: missedZoneAssignments,
            branchLockdowns: missedBranchLockdowns,
            salespeople: missedSalespeople,
            customers: missedCustomers,
            branches: missedBranches,
            cashAccounts: missedCashAccounts,
            businessDayClosures: missedBusinessDayClosures,
            electronicSettlements: missedElectronicSettlements,
            categories: missedCategories,
            creditGroups: missedCreditGroups,
            stocktakeSessions: missedStocktakeSessions,
            stocktakeSegments: missedStocktakeSegments,
            dailyBlindConfigs: missedDailyBlindConfigs,
            dailyBlindCounts: missedDailyBlindCounts,
            purchaseOrders: missedPurchaseOrders,
            tombstones: missedTombstones,
            ...(missedGenericEnvelopes.length > 0 ? { genericEnvelopes: missedGenericEnvelopes } : {}),
            ...(Array.isArray(permissionsMatrixStore.rules) && permissionsMatrixStore.rules.length > 0 && ((permissionsMatrixStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero)
              ? { permissionsMatrix: permissionsMatrixStore }
              : {}),
            ...(roleConfigsStore.definitions && ((roleConfigsStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero)
              ? { roleConfigs: roleConfigsStore }
              : {}),
            ...(multiCurrencyStore.config && ((multiCurrencyStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero)
              ? { multiCurrencyConfig: multiCurrencyStore.config }
              : {}),
            securityAlerts: missedSecurityAlerts,
          },
        };

        try {
          ws.send(JSON.stringify(catchupResponse));
          console.log(
            `[Termux Hub] 📤 Dispatched Delta Catch-up to ${reqDeviceId}: ` +
            `${missedSales.length} sales, ${missedDirectGrvs.length} GRVs, ` +
            `${missedInventory.length} inventory deltas (No Firehose), ` +
            `${missedCashLogs.length} cash logs, ${missedSuppliers.length} suppliers, ` +
            `${missedAdminSales.length} admin sales, ${missedCashCounts.length} cash counts, ` +
            `${missedVouchers.length} vouchers, ${missedSalespeople.length} staff, ${missedCustomers.length} customers, ` +
            `${categoriesStore.length} categories, ${missedTombstones.length} tombstones, ${missedGenericEnvelopes.length} generic envelopes.`
          );
        } catch (e) {
          console.warn('[Termux Hub] Failed to send catchup response:', e.message);
        }
        return;
      }

      // =====================================================================
      // 10.5. SCHEMA-AGNOSTIC GENERIC ENVELOPE CAPTURE (Future-Proof APK Relay)
      // Persists reconciliation, goods_received, and ANY future entityType automatically
      // =====================================================================
      const rawGenericEntityType = packet.entityType || (pType === 'DB_MUTATION' ? packet.sheetName : '');
      const genericPayloadObj = packet.payload && typeof packet.payload === 'object' ? packet.payload : (packet.data && typeof packet.data === 'object' ? packet.data : null);
      if (
        rawGenericEntityType &&
        genericPayloadObj &&
        pType !== 'HEARTBEAT' &&
        pType !== 'PING' &&
        pType !== 'PONG' &&
        pType !== 'SYNC_RECEIPT' &&
        pType !== 'SYNC_ACK'
      ) {
        const canonGenType = mapHubEntityToCanonicalType(rawGenericEntityType);
        const genId = String(packet.entityId || packet.recordId || getHubCanonicalEntityId(genericPayloadObj, canonGenType) || '').trim();
        if (canonGenType && genId && canonGenType !== 'sheet_mutation' && canonGenType !== 'sync_receipt') {
          const alreadyCloud = hasIncomingCloudSyncFlag(packet, genericPayloadObj);
          const storedOk = upsertGenericEntityInHub(canonGenType, genId, genericPayloadObj, {
            updatedAt: packet.updatedAt || packet.timestamp || Date.now(),
            class: packet.class,
            isCloudSynced: alreadyCloud,
          });
          if (storedOk) {
            scheduleSave();
            if (!alreadyCloud) {
              pushToCloud(canonGenType, genericEntitiesStore[canonGenType][genId]);
            }
          }
        }
      }

      // =====================================================================
      // 11. GENERAL BROADCAST TO OTHER AUTHENTICATED PEERS (NO ECHO / NO LEAK)
      // =====================================================================
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN && client.isAuthenticated !== false) {
          try {
            client.send(dataStr);
          } catch (e) {}
        }
      });
    } catch (err) {
      console.error('[Termux Hub] Error processing message:', err.message);
    }
  });

  ws.on('close', () => {
    for (const [devId, pending] of pendingPairRequests.entries()) {
      if (pending.ws === ws) {
        pendingPairRequests.delete(devId);
      }
    }
    console.log(`[Termux Hub] 🔴 POS Terminal disconnected`);
  });

  ws.on('error', (err) => {
    console.warn('[Termux Hub] Client WebSocket error:', err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================================`);
  console.log(`🚀 Saimetric POS - Universal Freeze-Once Local Hub (v${HUB_VERSION})`);
  console.log(`📡 WebSocket URL:  ws://0.0.0.0:${PORT}`);
  console.log(`🌐 HTTP Status:    http://0.0.0.0:${PORT}/health`);
  console.log(`🆔 Hub ID:         ${hubSecurityState.hubId} (${HUB_RUNTIME} / Slot ${HUB_OTA_SLOT})`);
  console.log(`🔐 Mutual Auth:    ${HUB_REQUIRE_AUTH ? 'STRICT (Paired Devices Only)' : 'OPTIONAL (Termux Backup Mode — pass --require-auth to enforce)'}`);
  console.log(`🏢 Branch ID:      ${hubBranchId} ("${hubBranchName}")`);
  console.log(`🏢 Tenant ID:      ${hubTenantId}`);
  console.log(`💾 Data File:      ${DATA_FILE}`);
  console.log(`⚡ Dual-Sync:      Transactional (Append-Only) & Config (Strict LWW)`);
  console.log(`🛡️  Staff LWW handler registered (v3.4.0)`);
  console.log(`🛡️  Customer LWW handler registered (v3.4.0)`);
  console.log(`🛡️  Branch LWW handler registered (v3.4.0)`);
  console.log(`🛡️  Casual Workers LWW handler registered (v3.4.0)`);
  console.log(`🛡️  Stocktake Session LWW handler registered (v3.4.0)`);
  console.log(`🛡️  Cash Account LWW handler registered (v3.4.0)`);
  console.log(`📦 Supplier sync registered (v3.5.0)`);
  console.log(`📦 Admin Sales sync registered (v3.5.0)`);
  console.log(`📦 Cash Count sync registered (v3.5.0)`);
  console.log(`📦 Voucher sync registered (v3.5.0)`);
  console.log(`📦 Closures & Settlements sync registered (v3.6.0)`);
  console.log(`📦 Categories sync registered (v3.6.0)`);
  console.log(`🧹 Automated Reconciliation Sweep Engine active (30m interval + connection trigger)`);
  console.log(`☁️  Edge-to-Cloud (Hub to Supabase) Bridge active (v3.7.0)`);
  console.log(`================================================================`);
});

// Automatic 30-minute background reconciliation sweep across all connected POS terminals
const RECON_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
setInterval(() => {
  triggerAllClientsReconSweep();
}, RECON_SWEEP_INTERVAL_MS);

/**
 * Edge-to-Cloud Bridge (Hub to Supabase Reconciliation):
 * 1. Queries Supabase: SELECT * FROM [table] WHERE updated_at > lastCloudSyncTimestamp
 * 2. Merges pulled records into local stores (LWW for T2, ID-dedup for T1)
 * 3. Pushes local records with isCloudSynced: false up to Supabase using UPSERT
 * 4. Broadcasts newly pulled records to connected PWAs via WebSocket
 */
async function syncEdgeToCloudSupabase() {
  const adapterCfg = resolveCloudAdapterConfig();
  if (adapterCfg.databaseType === 'none') {
    return;
  }

  const tablesToSync = [
    { name: 'sales', entityType: 'sales', isT2: false, store: salesStore },
    { name: 'customer_changes', entityType: 'customer_changes', isT2: false, store: customerChangesStore },
    { name: 'credit_sales', entityType: 'credit_sales', isT2: false, store: creditSalesStore },
    { name: 'cash_logs', entityType: 'cash_logs', isT2: false, store: cashLogsStore },
    { name: 'stock_movements', entityType: 'stock_movements', isT2: false, store: stockMovementsStore },
    { name: 'direct_grvs', entityType: 'direct_grvs', isT2: false, store: directGrvsStore },
    { name: 'expenses', entityType: 'expenses', isT2: false, store: expensesStore },
    { name: 'inventory', entityType: 'inventory', isT2: true, store: inventoryStore },
    { name: 'customers', entityType: 'customers', isT2: true, store: customersStore },
    { name: 'staff', entityType: 'staff', isT2: true, store: salespeopleStore },
  ];

  if (adapterCfg.databaseType === 'mongodb') {
    const mongoUri = String(adapterCfg.credentials.mongoUri || adapterCfg.credentials.uri || '').trim();
    if (!mongoUri) return;
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(mongoUri);
      await client.connect();
      const db = client.db(adapterCfg.credentials.database || 'saimetric_pos');
      for (const t of tablesToSync) {
        const unsynced = t.store.filter((r) => r && r.isCloudSynced !== true).slice(0, 50);
        for (const rec of unsynced) {
          const recId = String(getEntityId(rec, t.entityType) || '');
          if (!recId) continue;
          await db.collection(t.name).updateOne({ id: recId }, { $set: rec }, { upsert: true });
          rec.isCloudSynced = true;
        }
      }
      await client.close();
      lastCloudSyncTimestamp = Date.now();
      scheduleSave();
    } catch (err) {
      console.warn('[Edge-to-Cloud] MongoDB adapter notice:', err.message);
    }
    return;
  }

  if (adapterCfg.useUnifiedGateway) {
    if (cloudBackoffUntil > Date.now()) {
      return;
    }
    const target = resolveUnifiedGatewayTarget(adapterCfg);
    const targetUrl = target.url;
    if (!targetUrl) return;

    // Periodically fetch latest runtime policy from Cloud Gateway / Apps Script
    await fetchCloudGatewayPolicy(targetUrl);

    const getTrRankHub = (st) => {
      const u = String(st || '').toUpperCase().trim();
      if (u === 'DRAFT') return 0;
      if (u === 'PENDING_APPROVAL' || u === 'PENDING_ACCEPTANCE') return 1;
      if (u === 'IN_TRANSIT') return 2;
      if (u === 'APPROVED') return 3;
      if (u === 'RECEIVED' || u === 'COMPLETED' || u === 'RETURNED' || u === 'CANCELLED' || u === 'REJECTED') return 4;
      return 0;
    };

    const mergeStocktakeSessionHub = (existing, incoming) => {
      const exItems = Array.isArray(existing?.consolidatedItems) ? existing.consolidatedItems : [];
      const incItems = Array.isArray(incoming?.consolidatedItems) ? incoming.consolidatedItems : [];
      const pauseMap = new Map();
      [...(Array.isArray(existing?.pauseHistory) ? existing.pauseHistory : []), ...(Array.isArray(incoming?.pauseHistory) ? incoming.pauseHistory : [])].forEach((p) => {
        if (!p || !p.pausedAt) return;
        const prev = pauseMap.get(p.pausedAt);
        pauseMap.set(p.pausedAt, prev ? { ...prev, ...p } : p);
      });
      const mergedPauseHistory = Array.from(pauseMap.values()).sort(
        (a, b) => new Date(a.pausedAt).getTime() - new Date(b.pausedAt).getTime()
      );
      const baseMerged = {
        ...existing,
        ...incoming,
        ...(mergedPauseHistory.length > 0 ? { pauseHistory: mergedPauseHistory } : {}),
        isCloudSynced: true,
      };
      if (incItems.length === 0) return baseMerged;
      const exMap = new Map();
      exItems.forEach((ci) => { if (ci && ci.itemId) exMap.set(String(ci.itemId).toUpperCase(), ci); });
      const mergedItems = incItems.map((inc) => {
        const ex = exMap.get(String(inc.itemId || '').toUpperCase());
        if (!ex) return inc;
        const cMap = new Map();
        (Array.isArray(ex.varianceComments) ? ex.varianceComments : []).forEach((c) => { if (c && c.id) cMap.set(c.id, c); });
        (Array.isArray(inc.varianceComments) ? inc.varianceComments : []).forEach((c) => { if (c && c.id) cMap.set(c.id, c); });
        const mergedComments = Array.from(cMap.values()).sort(
          (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
        );
        return {
          ...ex,
          ...inc,
          ...(mergedComments.length > 0 ? { varianceComments: mergedComments } : {}),
        };
      });
      return { ...baseMerged, consolidatedItems: mergedItems };
    };

    const ingestCloudEnvelopeIntoHub = (env) => {
      if (!env || !env.entityType || !env.data || typeof env.data !== 'object') return false;
      const eType = mapHubEntityToCanonicalType(env.entityType);
      const rawNorm = normalizeIncomingCloudRecord(eType, env.data, env.entityId);
      const rec = { ...rawNorm, isCloudSynced: true };
      const cId = String(getHubCanonicalEntityId(rec, eType) || env.entityId || '').trim();
      if (!cId) return false;
      if (eType === 'inventory_item' && /^USR-/i.test(cId)) return false;
      const cloudTs = parseHubTimestampMs(env.updatedAt || rec.updatedAt || rec.lastUpdated || rec.hubTimestamp) || Date.now();

      if (eType === 'tombstone') {
        const tTargetType = normalizeHubEntityType(rec.entityType || '');
        const tTargetId = String(rec.entityId || cId).trim();
        const delAt = parseHubTimestampMs(rec.deletedAt || cloudTs) || Date.now();
        if (tTargetId) {
          recordAndPurgeHubTombstone(tTargetType, tTargetId, delAt, { ...rec, isCloudSynced: true });
          return true;
        }
        return false;
      }

      if (T2_CANONICAL_TYPES.has(eType) && cId && isTombstoned(cId, eType, cloudTs)) {
        return false;
      }

      if (eType === 'permissions_matrix') {
        const exTs = Number(permissionsMatrixStore.updatedAt) || 0;
        if (exTs > 0 && exTs > cloudTs + 60000) return false;
        const rules = Array.isArray(rec.rules) ? rec.rules : permissionsMatrixStore.rules;
        permissionsMatrixStore = { rules, updatedAt: cloudTs, isCloudSynced: true };
        return true;
      }
      if (eType === 'role_configs') {
        const exTs = Number(roleConfigsStore.updatedAt) || 0;
        if (exTs > 0 && exTs > cloudTs + 60000) return false;
        const defs = rec.definitions || rec;
        roleConfigsStore = { definitions: defs, updatedAt: cloudTs, isCloudSynced: true };
        return true;
      }
      if (eType === 'multi_currency') {
        const exTs = Number(multiCurrencyStore.updatedAt) || 0;
        if (exTs > 0 && (cloudTs === 0 || exTs > cloudTs + 60000)) return false;
        multiCurrencyStore = { config: rec, updatedAt: cloudTs };
        return true;
      }
      if (eType === 'branch_lockdown') {
        const brKey = String(rec.branchId || rec.branch_id || cId || hubBranchId).trim().toUpperCase();
        const ex = branchLockdownsStore[brKey] || branchLockdownsStore[rec.branchId || rec.branch_id || hubBranchId];
        const exTs = ex ? getRecordTimestamp(ex) : 0;
        const ACTIVE_LOCK_STATUSES = new Set([
          'ACTIVE', 'IN_PROGRESS', 'COUNTING', 'PAUSED',
          'RECOUNT', 'RECOUNTING', 'AUDIT_REVIEW', 'CONSOLIDATED',
          'PENDING_SIGNOFF', 'READY_FOR_COMMITTAL',
        ]);
        const activeSessForBr = stocktakeSessionsStore.find((s) => {
          if (!s || !s.sessionId) return false;
          if (isTombstoned(s.sessionId, 'stocktake_session', getTimestamp(s))) return false;
          const sBr = String(s.branchId || hubBranchId || '').trim().toUpperCase();
          return (!brKey || !sBr || sBr === brKey) && ACTIVE_LOCK_STATUSES.has(String(s.status || '').toUpperCase());
        });
        const incSessId = String(rec.sessionId || '').trim().toUpperCase();
        const actSessId = activeSessForBr ? String(activeSessForBr.sessionId || '').trim().toUpperCase() : '';
        if (actSessId && incSessId && incSessId !== actSessId) {
          return false;
        }
        if (ex && exTs > 0 && exTs > cloudTs + 60000) return false;
        branchLockdownsStore[rec.branchId || brKey] = { ...rec, isCloudSynced: true };
        return true;
      }

      if (eType === 'cash_log') {
        upsertHubCashLog(rec, true);
        return true;
      }

      const storeByType = {
        sale: { arr: salesStore, keyFn: (r) => r.id || r.invoice_id || r.InvoiceID },
        customer_change: { arr: customerChangesStore, keyFn: (r) => r.id || r.changeId },
        credit_sale: { arr: creditSalesStore, keyFn: (r) => r.id || r.creditId },
        cash_lift: { arr: cashLiftsStore, keyFn: (r) => r.id },
        cash_movement: { arr: cashMovementsStore, keyFn: (r) => r.id },
        cash_transfer: { arr: cashTransfersStore, keyFn: (r) => r.transfer_id || r.id },
        direct_grv: { arr: directGrvsStore, keyFn: (r) => r.id || r.grvNumber || r.grvId },
        expense: { arr: expensesStore, keyFn: (r) => r.id },
        internal_consumption: { arr: internalConsumptionsStore, keyFn: (r) => r.id },
        stock_movement: { arr: stockMovementsStore, keyFn: (r) => r.id || r.movementId || r.txnId },
        admin_sale: { arr: adminSalesStore, keyFn: (r) => r.id || r.invoice_id },
        cash_count: { arr: cashCountsStore, keyFn: (r) => r.id || r.countId },
        supplier_invoice_voucher: { arr: vouchersStore, keyFn: (r) => r.id || r.voucherNumber || r.voucherId },
        business_day_closure: { arr: businessDayClosuresStore, keyFn: (r) => r.id || r.closureId },
        electronic_settlement: { arr: electronicSettlementsStore, keyFn: (r) => r.id || r.settlementId },
        inventory_item: { arr: inventoryStore, keyFn: (r) => r.itemId || r.id || r.ItemID },
        customer: { arr: customersStore, keyFn: (r) => r.customerId || r.id },
        credit_group: { arr: creditGroupsStore, keyFn: (r) => r.groupId || r.id },
        supplier: { arr: suppliersStore, keyFn: (r) => r.supplierId || r.SupplierID || r.id },
        inventory_category: { arr: categoriesStore, keyFn: (r) => r.categoryId || r.id || r.categoryName },
        staff: { arr: salespeopleStore, keyFn: (r) => r.id || r.staffId },
        branch: { arr: branchesStore, keyFn: (r) => canonicalizeHubBranchId(r.branchId || r.branch_id || r.id) },
        cash_account: { arr: cashAccountsStore, keyFn: (r) => r.account_id || r.id },
        casual_worker: { arr: casualWorkersStore, keyFn: (r) => r.id || r.pin_hash },
        stocktake_session: { arr: stocktakeSessionsStore, keyFn: (r) => r.sessionId || r.id },
        stocktake_segment: { arr: stocktakeSegmentsStore, keyFn: (r) => r.segmentId || r.id },
        stocktake_zone_assignment: { arr: zoneAssignmentsStore, keyFn: (r) => r.id || `${r.sessionId || ''}::${r.zoneId || ''}` },
        daily_blind_config: { arr: dailyBlindConfigsStore, keyFn: (r) => r.id || r.configId },
        daily_blind_count: { arr: dailyBlindCountsStore, keyFn: (r) => r.id || r.countId },
        purchase_order: { arr: purchaseOrdersStore, keyFn: (r) => r.id || r.poNumber },
      };

      const targetSpec = storeByType[eType];
      if (!targetSpec) {
        // Schema-Agnostic Fallback: store reconciliation, goods_received, and ANY future entityType generically!
        return upsertGenericEntityInHub(eType, cId, rec, {
          updatedAt: cloudTs,
          class: env.class,
          isCloudSynced: true,
        });
      }

      if (eType === 'branch' && !isValidBranchRecord(rec)) return false;
      if (eType === 'staff') {
        if ('pin' in rec) delete rec.pin;
        if ('rawPin' in rec) delete rec.rawPin;
        if ('password' in rec) delete rec.password;
        if (!isValidStaffRecord(rec)) return false;
      }
      if (eType === 'customer' && !isValidCustomerRecord(rec)) return false;

      const idx = targetSpec.arr.findIndex((item) => String(targetSpec.keyFn(item) || '').trim().toUpperCase() === cId.toUpperCase());

      if (!T2_CANONICAL_TYPES.has(eType)) {
        if (idx === -1) {
          targetSpec.arr.unshift(rec);
          return true;
        }
        const ex = targetSpec.arr[idx];
        if (eType === 'sale') {
          const exVoid = ex.status === 'Voided' || ex.status === 'Refunded';
          const incCompleted = rec.status !== 'Voided' && rec.status !== 'Refunded';
          if (exVoid && incCompleted) return false;
          if (rec.status !== ex.status || rec.mobileVerificationStatus !== ex.mobileVerificationStatus) {
            targetSpec.arr[idx] = { ...ex, ...rec, isCloudSynced: true };
            return true;
          }
        } else if (eType === 'cash_transfer') {
          const exRank = getTrRankHub(ex.status);
          const incRank = getTrRankHub(rec.status);
          if (incRank > exRank || (incRank === exRank && cloudTs > getRecordTimestamp(ex))) {
            const linked = Array.from(new Set([...(ex.linked_cash_log_ids || []), ...(rec.linked_cash_log_ids || [])]));
            targetSpec.arr[idx] = { ...ex, ...rec, ...(linked.length > 0 ? { linked_cash_log_ids: linked } : {}), isCloudSynced: true };
            return true;
          }
        } else if (eType === 'credit_sale' || eType === 'expense' || eType === 'internal_consumption' || eType === 'direct_grv') {
          if (cloudTs > getRecordTimestamp(ex) && rec.status !== ex.status) {
            targetSpec.arr[idx] = { ...ex, ...rec, isCloudSynced: true };
            return true;
          }
        } else if (eType === 'electronic_settlement') {
          if (cloudTs > getRecordTimestamp(ex)) {
            targetSpec.arr[idx] = { ...ex, ...rec, isCloudSynced: true };
            return true;
          }
        }
        return false;
      }

      if (idx === -1) {
        if (eType === 'branch') {
          const normId = canonicalizeHubBranchId(cId);
          rec.id = normId;
          rec.branchId = normId;
        }
        targetSpec.arr.push(rec);
        return true;
      }

      const ex = targetSpec.arr[idx];
      const exTs = getRecordTimestamp(ex);
      if (exTs > 0 && (cloudTs === 0 || exTs > cloudTs + 60000)) {
        return false;
      }

      if (eType === 'staff') {
        const exPinVer = Number(ex.pinVersion || 0);
        const incPinVer = Number(rec.pinVersion || 0);
        const exPinTs = parseHubTimestampMs(ex.pinUpdatedAt) || exTs;
        const incPinTs = parseHubTimestampMs(rec.pinUpdatedAt) || cloudTs;
        if (ex.pin_hash && (!rec.pin_hash || (exPinVer > incPinVer && incPinVer === 0) || exPinVer > incPinVer || exPinTs > incPinTs + 5000)) {
          rec.pin_hash = ex.pin_hash;
          if (ex.pin_salt) rec.pin_salt = ex.pin_salt;
          rec.pinVersion = exPinVer;
          if (ex.pinUpdatedAt) rec.pinUpdatedAt = ex.pinUpdatedAt;
        }
        targetSpec.arr[idx] = { ...ex, ...rec, isCloudSynced: true };
        return true;
      }

      if (eType === 'branch') {
        const normId = canonicalizeHubBranchId(ex.branchId || cId);
        const nextName = isHubPlaceholderBranchName(rec.name) && !isHubPlaceholderBranchName(ex.name) ? ex.name : rec.name;
        const nextCode = isHubPlaceholderBranchCode(rec.code, normId) && !isHubPlaceholderBranchCode(ex.code, normId) ? ex.code : rec.code;
        targetSpec.arr[idx] = { ...ex, ...rec, id: normId, branchId: normId, name: nextName, code: nextCode, isCloudSynced: true };
        return true;
      }

      if (eType === 'stocktake_session') {
        targetSpec.arr[idx] = mergeStocktakeSessionHub(ex, rec);
        return true;
      }

      targetSpec.arr[idx] = { ...ex, ...rec, isCloudSynced: true };
      return true;
    };

    const newlyPulledEnvelopes = [];
    const authFields = getHubCloudAuthFields();
    let pullSucceeded = false;

    // STEP A (PULL-FIRST): Cursor-based pull_catchup BEFORE pushing so fresh Hubs never miss peer records
    try {
      let cursor = 0;
      let page = 0;
      let maxSeq = lastAppsScriptServerSeq;
      const effectiveSinceSeq = lastAppsScriptServerSeq > 0 ? lastAppsScriptServerSeq : 0;
      const effectiveSinceTs = lastAppsScriptServerSeq > 0 ? lastCloudSyncTimestamp : 0;
      const MAX_PAGES = Number(hubRuntimePolicy.pullMaxPages) || 12;

      while (cursor !== null && page < MAX_PAGES) {
        if (cloudBackoffUntil > Date.now()) break;
        const pullRes = await postAppsScriptJson(targetUrl, {
          action: 'pull_catchup',
          company_id: hubTenantId,
          branch_id: hubBranchId || 'ALL',
          user_role: 'OWNER',
          ...authFields,
          ...target.extraGatewayFields,
          since_seq: effectiveSinceSeq,
          since_ts: effectiveSinceTs,
          limit: 250,
          cursor,
        });
        if (!pullRes.ok || !pullRes.json) break;
        if (pullRes.json.policy && typeof pullRes.json.policy === 'object') {
          applyHubRuntimePolicy(pullRes.json.policy);
        }
        if (pullRes.json.success === false || pullRes.json.status === 'error' || (typeof pullRes.json.httpStatus === 'number' && pullRes.json.httpStatus >= 400)) {
          handleHubAppsScriptErrorResponse(pullRes.json);
          break;
        }
        pullSucceeded = true;
        if (typeof pullRes.json.current_routing_epoch === 'number' && pullRes.json.current_routing_epoch > cloudRoutingEpoch) {
          cloudRoutingEpoch = pullRes.json.current_routing_epoch;
        }

        const list = Array.isArray(pullRes.json.envelopes) ? pullRes.json.envelopes : [];
        list.sort((a, b) => {
          if (a?.entityType === 'tombstone' && b?.entityType !== 'tombstone') return -1;
          if (b?.entityType === 'tombstone' && a?.entityType !== 'tombstone') return 1;
          return (Number(a?.serverSeq || 0) - Number(b?.serverSeq || 0));
        });

        for (const rawEnv of list) {
          if (ingestCloudEnvelopeIntoHub(rawEnv)) {
            newlyPulledEnvelopes.push(rawEnv);
          }
          if (typeof rawEnv?.serverSeq === 'number' && rawEnv.serverSeq > maxSeq) {
            maxSeq = rawEnv.serverSeq;
          }
        }

        if (typeof pullRes.json.server_seq === 'number' && pullRes.json.server_seq > maxSeq) {
          maxSeq = pullRes.json.server_seq;
        }
        cursor = pullRes.json.hasMore && pullRes.json.nextCursor !== undefined && pullRes.json.nextCursor !== null
          ? Number(pullRes.json.nextCursor)
          : null;
        page++;
      }

      if (maxSeq > lastAppsScriptServerSeq) {
        lastAppsScriptServerSeq = maxSeq;
      }
    } catch (pullErr) {
      console.warn('[Edge-to-Cloud] Cloud pull_catchup notice:', pullErr.message);
    }

    // STEP B: Collect & push all unsynced records across all dedicated AND generic Hub stores via push_envelopes
    const canPushToTarget = !(
      adapterCfg.databaseType === 'appscripts' &&
      isBlockedMasterSheetWrite(hubTenantId, authFields.spreadsheet_id)
    );
    if (!canPushToTarget) {
      console.warn(`[Edge-to-Cloud] 🛡️ Skipping push_envelopes for non-master tenant ${hubTenantId}: dedicated spreadsheet_id required.`);
    }

    const pushSources = [
      { hubType: 'TOMBSTONE', store: tombstonesStore },
      { hubType: 'SALE', store: salesStore },
      { hubType: 'CUSTOMER_CHANGE', store: customerChangesStore },
      { hubType: 'CREDIT_SALE', store: creditSalesStore },
      { hubType: 'CREDIT_GROUP', store: creditGroupsStore },
      { hubType: 'CASH_LOG', store: cashLogsStore },
      { hubType: 'CASH_LIFT', store: cashLiftsStore },
      { hubType: 'CASH_MOVEMENT', store: cashMovementsStore },
      { hubType: 'CASH_ACCOUNT', store: cashAccountsStore },
      { hubType: 'CASH_TRANSFER', store: cashTransfersStore },
      { hubType: 'GRV', store: directGrvsStore },
      { hubType: 'EXPENSE', store: expensesStore },
      { hubType: 'INTERNAL_CONSUMPTION', store: internalConsumptionsStore },
      { hubType: 'STOCK_MOVEMENT', store: stockMovementsStore },
      { hubType: 'ADMIN_SALE', store: adminSalesStore },
      { hubType: 'CASH_COUNT', store: cashCountsStore },
      { hubType: 'VOUCHER', store: vouchersStore },
      { hubType: 'BUSINESS_DAY_CLOSURE', store: businessDayClosuresStore },
      { hubType: 'ELECTRONIC_SETTLEMENT', store: electronicSettlementsStore },
      { hubType: 'SUPPLIER', store: suppliersStore },
      { hubType: 'CATEGORY', store: categoriesStore },
      { hubType: 'CASUAL_WORKER', store: casualWorkersStore },
      { hubType: 'STOCKTAKE_SESSION', store: stocktakeSessionsStore },
      { hubType: 'STOCKTAKE_SEGMENT', store: stocktakeSegmentsStore },
      { hubType: 'STOCKTAKE_ZONE_ASSIGNMENT', store: zoneAssignmentsStore },
      { hubType: 'DAILY_BLIND_CONFIG', store: dailyBlindConfigsStore },
      { hubType: 'DAILY_BLIND_COUNT', store: dailyBlindCountsStore },
      { hubType: 'PURCHASE_ORDER', store: purchaseOrdersStore },
      { hubType: 'INVENTORY', store: inventoryStore },
      { hubType: 'CUSTOMER', store: customersStore },
      { hubType: 'STAFF', store: salespeopleStore },
      { hubType: 'BRANCH', store: branchesStore },
      { hubType: 'BRANCH_LOCKDOWN', store: Object.values(branchLockdownsStore || {}) },
    ];

    const pendingPushPairs = [];
    if (canPushToTarget) {
      for (const src of pushSources) {
        for (const rec of src.store) {
          if (!rec || typeof rec !== 'object' || rec.isCloudSynced === true) continue;
          const env = buildHubSyncEnvelope(src.hubType, rec);
          if (!env.entityId) continue;
          pendingPushPairs.push({ rec, env, hubType: src.hubType });
        }
      }
      // Include all unsynced schema-agnostic generic entities (reconciliation, goods_received, future entities)
      for (const [gType, bucket] of Object.entries(genericEntitiesStore || {})) {
        if (!bucket || typeof bucket !== 'object') continue;
        for (const rec of Object.values(bucket)) {
          if (!rec || typeof rec !== 'object' || rec.isCloudSynced === true) continue;
          const env = buildHubSyncEnvelope(gType, rec);
          if (!env.entityId) continue;
          pendingPushPairs.push({ rec, env, hubType: gType.toUpperCase() });
        }
      }
      if (Array.isArray(permissionsMatrixStore.rules) && permissionsMatrixStore.rules.length > 0 && permissionsMatrixStore.isCloudSynced !== true) {
        pendingPushPairs.push({ rec: permissionsMatrixStore, env: buildHubSyncEnvelope('PERMISSIONS_MATRIX', permissionsMatrixStore), hubType: 'PERMISSIONS_MATRIX' });
      }
      if (roleConfigsStore.definitions && roleConfigsStore.isCloudSynced !== true) {
        pendingPushPairs.push({ rec: roleConfigsStore, env: buildHubSyncEnvelope('ROLE_CONFIGS', roleConfigsStore), hubType: 'ROLE_CONFIGS' });
      }
      if (multiCurrencyStore.config && multiCurrencyStore.config.isCloudSynced !== true) {
        pendingPushPairs.push({ rec: multiCurrencyStore.config, env: buildHubSyncEnvelope('MULTI_CURRENCY', multiCurrencyStore.config), hubType: 'MULTI_CURRENCY' });
      }
    }

    const PUSH_BATCH = Number(hubRuntimePolicy.pushBatchSize) || 20;
    for (let i = 0; i < pendingPushPairs.length; i += PUSH_BATCH) {
      if (cloudBackoffUntil > Date.now()) break;
      const chunk = pendingPushPairs.slice(i, i + PUSH_BATCH);
      try {
        const pushRes = await postAppsScriptJson(targetUrl, {
          action: 'push_envelopes',
          company_id: hubTenantId,
          branch_id: hubBranchId,
          user_id: `HUB-${hubBranchId}`,
          user_role: 'OWNER',
          user_branch_id: hubBranchId,
          ...authFields,
          ...target.extraGatewayFields,
          envelopes: chunk.map((c) => c.env),
          timestamp: Date.now(),
        });
        if (pushRes.ok && pushRes.json && pushRes.json.policy && typeof pushRes.json.policy === 'object') {
          applyHubRuntimePolicy(pushRes.json.policy);
        }
        if (pushRes.ok && pushRes.json && (pushRes.json.success === false || pushRes.json.status === 'error' || (typeof pushRes.json.httpStatus === 'number' && pushRes.json.httpStatus >= 400))) {
          handleHubAppsScriptErrorResponse(pushRes.json);
          break;
        }
        if (pushRes.ok && pushRes.json && pushRes.json.success !== false) {
          if (typeof pushRes.json.current_routing_epoch === 'number' && pushRes.json.current_routing_epoch > cloudRoutingEpoch) {
            cloudRoutingEpoch = pushRes.json.current_routing_epoch;
          }
          const ackedSet = new Set(Array.isArray(pushRes.json.ackedPacketIds) ? pushRes.json.ackedPacketIds.map(String) : []);
          const flaggedSet = new Set(Array.isArray(pushRes.json.flaggedBackdateIds) ? pushRes.json.flaggedBackdateIds.map(String) : []);
          const failedMap = new Map();
          if (Array.isArray(pushRes.json.failed)) {
            for (const f of pushRes.json.failed) {
              if (f && f.packetId) failedMap.set(String(f.packetId), String(f.error || 'FAILED'));
            }
          }
          const srvIso = pushRes.json.server_received_at || new Date().toISOString();

          // Ingest conflicts FIRST (supports both { winner } and Code.gs direct { entityType, entityId, data })
          let cloudWinningSession = null;
          let cloudWinningLockdown = null;
          if (Array.isArray(pushRes.json.conflicts)) {
            for (const c of pushRes.json.conflicts) {
              if (!c) continue;
              const candidateEnv = c.winner || (c.entityType && c.data ? c : null);
              if (candidateEnv) {
                const cType = String(candidateEnv.entityType || '').trim().toLowerCase();
                if (cType === 'stocktake_session' && candidateEnv.data) {
                  cloudWinningSession = candidateEnv.data;
                } else if (cType === 'branch_lockdown' && candidateEnv.data) {
                  cloudWinningLockdown = candidateEnv.data;
                }
                if (ingestCloudEnvelopeIntoHub(candidateEnv)) {
                  newlyPulledEnvelopes.push(candidateEnv);
                }
              }
            }
          }

          for (const pair of chunk) {
            const pId = String(pair.env.packetId);
            const failErr = failedMap.get(pId);
            if (failErr) {
              if (failErr === 'ACTIVE_STOCKTAKE_ALREADY_EXISTS' && pair.hubType === 'STOCKTAKE_SESSION') {
                const rejSessId = pair.rec.sessionId || pair.env.entityId;
                const nowMs = Date.now();
                const nowIso = new Date(nowMs).toISOString();
                const hasCounts = Array.isArray(pair.rec.segments) && pair.rec.segments.some(
                  (seg) => (Array.isArray(seg.count1) && seg.count1.length > 0) || (Array.isArray(seg.count2) && seg.count2.length > 0)
                );
                const conflictReason = `Demoted by Cloud conflict: active stocktake already exists on this branch.`;
                if (hasCounts) {
                  pair.rec.pausedFromStatus = pair.rec.status;
                  pair.rec.status = 'PAUSED';
                  pair.rec.pausedAt = nowIso;
                  pair.rec.pausedBy = 'CLOUD_CONFLICT_GUARD';
                  pair.rec.pausedByName = 'Cloud Conflict Guard';
                  pair.rec.pauseReason = conflictReason;
                  pair.rec.isLockdownActive = false;
                  pair.rec.isCloudSynced = true;
                } else {
                  pair.rec.status = 'DRAFT';
                  pair.rec.isLockdownActive = false;
                  pair.rec.isCloudSynced = false;
                }
                pair.rec.updatedAt = nowMs;
                pair.rec.lastUpdated = nowIso;
                pair.rec.notes = `${pair.rec.notes ? pair.rec.notes + ' | ' : ''}${conflictReason}`;

                if (branchLockdownsStore && typeof branchLockdownsStore === 'object') {
                  for (const brK of Object.keys(branchLockdownsStore)) {
                    const lk = branchLockdownsStore[brK];
                    if (lk && String(lk.sessionId || '').trim().toUpperCase() === String(rejSessId || '').trim().toUpperCase()) {
                      if (cloudWinningLockdown) {
                        branchLockdownsStore[brK] = { ...cloudWinningLockdown, isCloudSynced: true };
                      } else {
                        branchLockdownsStore[brK] = {
                          ...lk,
                          isLocked: false,
                          lockedAt: undefined,
                          updatedAt: nowMs,
                          lastUpdated: nowIso,
                          isCloudSynced: true,
                        };
                      }
                    }
                  }
                }
                scheduleSave();
                try {
                  if (typeof wss !== 'undefined' && wss && wss.clients) {
                    const conflictNotice = JSON.stringify({
                      type: 'STOCKTAKE_SESSION_CONFLICT',
                      sessionId: rejSessId,
                      existingSessionId: cloudWinningSession?.sessionId || '',
                      existingSessionName: cloudWinningSession?.title || cloudWinningSession?.sessionName || cloudWinningSession?.sessionId || 'Active Cloud Session',
                      existingSession: cloudWinningSession,
                      existingLockdown: cloudWinningLockdown,
                      message: `Cloud already has an active stocktake session. Local session ${rejSessId} was archived read-only.`,
                      timestamp: nowMs,
                    });
                    wss.clients.forEach((client) => {
                      if (client && client.readyState === WebSocket.OPEN) {
                        try { client.send(conflictNotice); } catch (e) {}
                      }
                    });
                  }
                } catch (e) {}
              } else if (failErr === 'BRANCH_LOCKDOWN_SESSION_MISMATCH' && pair.hubType === 'BRANCH_LOCKDOWN') {
                pair.rec.isCloudSynced = true;
              }
              continue;
            }

            if (ackedSet.has(pId) || (ackedSet.size === 0 && failedMap.size === 0)) {
              pair.rec.isCloudSynced = true;
              if (!pair.rec.server_received_at) pair.rec.server_received_at = srvIso;
              if (flaggedSet.has(pair.env.entityId)) pair.rec.suspicious_backdate = true;
              if (pair.env.class === 'T1') {
                broadcastCloudSyncAck(null, pair.hubType, pair.env.entityId);
              }
            }
          }
        }
      } catch (pushErr) {
        console.warn('[Edge-to-Cloud] Cloud push_envelopes notice:', pushErr.message);
        break;
      }
    }

    // Only advance timestamp when pull succeeded so failed initial pulls never clip history
    if (pullSucceeded) {
      lastCloudSyncTimestamp = Date.now();
    }
    scheduleSave();

    // STEP C: Downstream broadcast canonical envelopes to connected PWAs
    if (newlyPulledEnvelopes.length > 0) {
      console.log(`[Edge-to-Cloud] 📡 Broadcasting ${newlyPulledEnvelopes.length} cloud envelope(s) to connected terminals...`);
      const broadcastStr = JSON.stringify({
        type: 'HUB_CLOUD_BROADCAST',
        action: 'HUB_CLOUD_BROADCAST',
        envelopes: newlyPulledEnvelopes,
        hubTimestamp: Date.now(),
        branchId: hubBranchId,
        count: newlyPulledEnvelopes.length,
      });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(broadcastStr); } catch (e) {}
        }
      });
    }
    return;
  }

  if (adapterCfg.databaseType !== 'supabase') {
    return;
  }

  const activeSupabaseUrl = String(adapterCfg.credentials.url || adapterCfg.credentials.projectUrl || '').trim();
  const activeSupabaseKey = String(adapterCfg.credentials.apiKey || adapterCfg.credentials.serviceRoleKey || adapterCfg.credentials.anonKey || '').trim();
  if (!activeSupabaseUrl || !activeSupabaseKey) {
    return;
  }

  const cleanBase = activeSupabaseUrl.replace(/\/+$/, '');
  const headers = {
    apikey: activeSupabaseKey,
    Authorization: `Bearer ${activeSupabaseKey}`,
    'Content-Type': 'application/json',
  };

  const newlyPulledRecords = [];

  for (const t of tablesToSync) {
    try {
      // 1. Hub Cloud Pull (WHERE updated_at > lastCloudSyncTimestamp)
      const queryTime = lastCloudSyncTimestamp > 0
        ? new Date(lastCloudSyncTimestamp).toISOString()
        : new Date(0).toISOString();
      const pullUrl = `${cleanBase}/rest/v1/${t.name}?updated_at=gt.${queryTime}&order=updated_at.asc&limit=250`;

      if (typeof fetch === 'function') {
        const res = await fetch(pullUrl, { method: 'GET', headers });
        if (res.ok) {
          const cloudRecords = await res.json();
          if (Array.isArray(cloudRecords) && cloudRecords.length > 0) {
            console.log(`[Edge-to-Cloud] ☁️ Pulled ${cloudRecords.length} record(s) from Supabase table '${t.name}'`);
            for (const cRec of cloudRecords) {
              const recId = getEntityId(cRec, t.entityType);
              if (!recId) continue;
              const cleanId = String(recId).trim();

              if (!t.isT2) {
                // T1: ID Deduplication
                const existingIdx = t.store.findIndex((s) => String(getEntityId(s, t.entityType)).trim() === cleanId);
                if (existingIdx === -1) {
                  cRec.isCloudSynced = true;
                  t.store.push(cRec);
                  newlyPulledRecords.push(cRec);
                } else if (t.entityType === 'sales' && cRec.status && t.store[existingIdx].status !== cRec.status) {
                  t.store[existingIdx].status = cRec.status;
                  t.store[existingIdx].isCloudSynced = true;
                  newlyPulledRecords.push(t.store[existingIdx]);
                }
              } else {
                // T2: Tombstone Resurrection Guard + 60000ms LWW
                const cloudUpdated = getRecordTimestamp(cRec);
                if (isTombstoned(cleanId, t.entityType, cloudUpdated)) {
                  console.log(`[Edge-to-Cloud] 🪦 Resurrection Blocked for tombstoned ${t.entityType} #${cleanId}`);
                  continue;
                }
                const existingIdx = t.store.findIndex((s) => String(getEntityId(s, t.entityType)).trim() === cleanId);
                if (existingIdx === -1) {
                  cRec.isCloudSynced = true;
                  t.store.push(cRec);
                  newlyPulledRecords.push(cRec);
                } else {
                  const localUpdated = getRecordTimestamp(t.store[existingIdx]);
                  if (cloudUpdated - localUpdated > 60000) {
                    cRec.isCloudSynced = true;
                    t.store[existingIdx] = cRec;
                    newlyPulledRecords.push(cRec);
                  }
                }
              }
            }
          }
        }
      }

      // 2. Hub Cloud Push (local records with isCloudSynced: false using UPSERT)
      const unsynced = t.store.filter((r) => r && r.isCloudSynced !== true);
      if (unsynced.length > 0 && typeof fetch === 'function') {
        const batchToPush = unsynced.slice(0, 50);
        const pushUrl = `${cleanBase}/rest/v1/${t.name}`;
        const pushRes = await fetch(pushUrl, {
          method: 'POST',
          headers: {
            ...headers,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify(batchToPush),
        });

        if (pushRes.ok || pushRes.status === 201) {
          const hdrDate = pushRes.headers && pushRes.headers.get ? pushRes.headers.get('date') : null;
          batchToPush.forEach((r) => {
            if (t.entityType === 'sales' || t.entityType === 'cash_logs') {
              annotateCloudBackdateFlag(t.entityType === 'sales' ? 'SALE' : 'CASH_LOG', r, hdrDate);
            }
            r.isCloudSynced = true;
          });
          console.log(`[Edge-to-Cloud] 🚀 Pushed and upserted ${batchToPush.length} record(s) to Supabase table '${t.name}'`);
        }
      }
    } catch (tblErr) {
      console.warn(`[Edge-to-Cloud] Notice syncing table '${t.name}':`, tblErr.message);
    }
  }

  // Update HWM and schedule local save
  lastCloudSyncTimestamp = Date.now();
  scheduleSave();

  // 3. Downstream Broadcast: Broadcast newly pulled records to connected PWAs
  if (newlyPulledRecords.length > 0) {
    console.log(`[Edge-to-Cloud] 📡 Broadcasting ${newlyPulledRecords.length} newly pulled cloud record(s) to connected terminals...`);
    const broadcastPkt = {
      type: 'HUB_CLOUD_BROADCAST',
      action: 'HUB_CLOUD_BROADCAST',
      records: newlyPulledRecords,
      hubTimestamp: Date.now(),
      branchId: hubBranchId,
      count: newlyPulledRecords.length,
    };

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(broadcastPkt));
        } catch (e) {}
      }
    });
  }
}

// Edge-to-Cloud Sync: Cloud-driven dynamic interval (default 5m, 10s after startup)
function restartCloudSyncTimer() {
  if (cloudSyncIntervalHandle) clearInterval(cloudSyncIntervalHandle);
  const intervalMs = Number(hubRuntimePolicy.syncIntervalMs) || 5 * 60 * 1000;
  cloudSyncIntervalHandle = setInterval(() => {
    syncEdgeToCloudSupabase();
  }, intervalMs);
}
setTimeout(() => { syncEdgeToCloudSupabase(); }, 10000);
restartCloudSyncTimer();

function flushBeforeExit(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (saveDirty || saveTimeout) {
    saveDataSyncAtomic();
  }
  if (signal) {
    process.exit(0);
  }
}

process.once('SIGINT', () => flushBeforeExit('SIGINT'));
process.once('SIGTERM', () => flushBeforeExit('SIGTERM'));
process.once('beforeExit', () => flushBeforeExit(null));



