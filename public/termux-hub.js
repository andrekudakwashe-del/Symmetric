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
let stockMovementsStore = [];
let expensesStore = [];
let cashTransfersStore = [];

// Stocktake Dedicated Stores
let casualWorkersStore = [];
let zoneAssignmentsStore = [];
let branchLockdownsStore = {};
let stocktakeSessionsStore = [];
let stocktakeSegmentsStore = [];

// Staff & Customer Master Stores (Synced across multi-device Wi-Fi)
let salespeopleStore = [];
let customersStore = [];

// Business Day Closures & EOD Archives
let businessDayClosuresStore = [];
let electronicSettlementsStore = [];

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

// Helper: Match record by tenant and branch
function isMatch(rec, reqComp, reqBranch, isCatalog = false) {
  if (!rec) return false;
  const c = (rec.company_id || rec.companyId || 'COMP-001').trim().toUpperCase();
  if (reqComp && c && c !== reqComp && c !== 'COMP-MASTER' && reqComp !== 'COMP-MASTER') return false;
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

// Helper: Extract timestamp in milliseconds
function getTimestamp(rec) {
  if (!rec) return 0;
  const t =
    rec.updatedAt ??
    rec.hubTimestamp ??
    rec.lastUpdated ??
    rec.updated_at ??
    rec.timestamp ??
    rec.createdAt ??
    rec.created_at ??
    rec.date;
  if (t === undefined || t === null) return 0;
  if (typeof t === 'number') return t;
  const tm = new Date(t).getTime();
  return isNaN(tm) ? 0 : tm;
}

// 30-Day Disk Rotation & 2GB CCTV Safety Trim
function pruneOldRecords() {
  const cutoffTime = Date.now() - (ROTATION_DAYS * 24 * 60 * 60 * 1000);
  salesStore = salesStore.filter((s) => getTimestamp(s) >= cutoffTime || !s.date);
  directGrvsStore = directGrvsStore.filter((g) => getTimestamp(g) >= cutoffTime || !g.date);
  cashMovementsStore = cashMovementsStore.filter((m) => getTimestamp(m) >= cutoffTime || !m.date);
  cashLogsStore = cashLogsStore.filter((l) => getTimestamp(l) >= cutoffTime || !l.date);
  cashLiftsStore = cashLiftsStore.filter((l) => getTimestamp(l) >= cutoffTime || !l.date);
  customerChangesStore = customerChangesStore.filter((c) => getTimestamp(c) >= cutoffTime || !c.date);
  creditSalesStore = creditSalesStore.filter((cs) => getTimestamp(cs) >= cutoffTime || !cs.date);
  stockMovementsStore = stockMovementsStore.filter((sm) => getTimestamp(sm) >= cutoffTime || !sm.date);
  expensesStore = expensesStore.filter((e) => getTimestamp(e) >= cutoffTime || !e.date);
  cashTransfersStore = cashTransfersStore.filter((t) => getTimestamp(t) >= cutoffTime || !t.date);
}

// Load persistent data if exists
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.hubBranchId) hubBranchId = parsed.hubBranchId;
      if (parsed.hubBranchName) hubBranchName = parsed.hubBranchName;
      if (parsed.hubTenantId) hubTenantId = parsed.hubTenantId;
      if (Array.isArray(parsed.sales)) salesStore = parsed.sales;
      if (Array.isArray(parsed.inventory)) inventoryStore = parsed.inventory;
      if (Array.isArray(parsed.directGrvs)) directGrvsStore = parsed.directGrvs;
      if (Array.isArray(parsed.cashMovements)) cashMovementsStore = parsed.cashMovements;
      if (Array.isArray(parsed.cashLifts)) cashLiftsStore = parsed.cashLifts;
      if (Array.isArray(parsed.cashLogs)) cashLogsStore = parsed.cashLogs;
      if (Array.isArray(parsed.customerChanges)) customerChangesStore = parsed.customerChanges;
      if (Array.isArray(parsed.creditSales)) creditSalesStore = parsed.creditSales;
      if (Array.isArray(parsed.stockMovements)) stockMovementsStore = parsed.stockMovements;
      if (Array.isArray(parsed.expenses)) expensesStore = parsed.expenses;
      if (Array.isArray(parsed.cashTransfers)) cashTransfersStore = parsed.cashTransfers;
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
      if (Array.isArray(parsed.customers)) customersStore = parsed.customers;
      if (Array.isArray(parsed.businessDayClosures)) businessDayClosuresStore = parsed.businessDayClosures;
      if (Array.isArray(parsed.electronicSettlements)) electronicSettlementsStore = parsed.electronicSettlements;
      if (parsed.branchLockdowns && typeof parsed.branchLockdowns === 'object') {
        branchLockdownsStore = parsed.branchLockdowns;
      }
      if (Array.isArray(parsed.stocktakeSessions)) stocktakeSessionsStore = parsed.stocktakeSessions;
      if (Array.isArray(parsed.stocktakeSegments)) stocktakeSegmentsStore = parsed.stocktakeSegments;

      console.log(
        `[Termux Hub] Loaded from disk: [Branch: ${hubBranchId} - ${hubBranchName}], ${salesStore.length} sales, ${directGrvsStore.length} direct GRVs, ${inventoryStore.length} items, ${salespeopleStore.length} staff, ${customersStore.length} customers, ${businessDayClosuresStore.length} EOD closures, ${stocktakeSessionsStore.length} stocktake sessions.`
      );
    }
  } catch (e) {
    console.warn('[Termux Hub] Notice loading data file:', e.message);
  }
}

// Persist collections to disk
let saveTimeout = null;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveData, 200);
}

function saveData() {
  try {
    pruneOldRecords();

    const payload = {
      hubBranchId,
      hubBranchName,
      hubTenantId,
      sales: salesStore.slice(0, 5000),
      inventory: inventoryStore,
      directGrvs: directGrvsStore.slice(0, 1000),
      cashMovements: cashMovementsStore.slice(0, 2000),
      cashLifts: cashLiftsStore.slice(0, 1000),
      cashLogs: cashLogsStore.slice(0, 2000),
      customerChanges: customerChangesStore.slice(0, 2000),
      creditSales: creditSalesStore.slice(0, 2000),
      stockMovements: stockMovementsStore.slice(0, 2000),
      expenses: expensesStore.slice(0, 1000),
      cashTransfers: cashTransfersStore.slice(0, 1000),
      casualWorkers: casualWorkersStore.slice(0, 500),
      zoneAssignments: zoneAssignmentsStore.slice(0, 500),
      salespeople: salespeopleStore.slice(0, 1000),
      customers: customersStore.slice(0, 3000),
      businessDayClosures: businessDayClosuresStore.slice(0, 365),
      electronicSettlements: electronicSettlementsStore.slice(0, 365),
      branchLockdowns: branchLockdownsStore,
      stocktakeSessions: stocktakeSessionsStore.slice(0, 500),
      stocktakeSegments: stocktakeSegmentsStore.slice(0, 2000),
      savedAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORAGE_BYTES) {
      console.warn(`[Termux Hub] Warning: Hub data exceeds 2GB limit. Trimming oldest records...`);
      salesStore = salesStore.slice(0, 2500);
      directGrvsStore = directGrvsStore.slice(0, 500);
    }

    fs.writeFileSync(DATA_FILE, serialized, 'utf8');
  } catch (e) {
    console.error('[Termux Hub] Error saving data file:', e.message);
  }
}

loadData();
loadBlindVault();

// HTTP server for health checks & ping
const server = http.createServer((req, res) => {
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
        version: '3.3.0',
        branchId: hubBranchId,
        branchName: hubBranchName,
        tenantId: hubTenantId,
        salesCount: salesStore.length,
        directGrvsCount: directGrvsStore.length,
        inventoryCount: inventoryStore.length,
        staffCount: salespeopleStore.length,
        customerCount: customersStore.length,
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
        branch_id: hubBranchId,
        branch_name: hubBranchName,
        tenant_id: hubTenantId,
        hub_id: `HUB-${hubBranchId}`,
        version: '3.3.0',
        totalRecords: salesStore.length + directGrvsStore.length,
        casualWorkersCount: casualWorkersStore.length,
        timestamp: Date.now(),
      })
    );
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  console.log(`[Termux Hub] 🟢 POS Terminal connected from ${remoteIp}`);

  // Send immediate greeting with branch identity
  try {
    const greeting = {
      type: 'HUB_GREETING',
      action: 'HUB_INFO',
      hub_id: `HUB-${hubBranchId}`,
      branch_id: hubBranchId,
      branch_name: hubBranchName,
      tenant_id: hubTenantId,
      version: '3.3.0',
      totalSales: salesStore.length,
      totalInventory: inventoryStore.length,
      message: `Connected to Saimetric Local Hub (${hubBranchName})`,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(greeting));
  } catch (e) {}

  ws.on('message', (message) => {
    try {
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
      // 0. PRE-AUTH LOBBY & HUB IDENTITY HANDSHAKE
      // =====================================================================
      if (pType === 'PING_HUB' || pType === 'PING_IDENTITY') {
        const hubInfoResponse = {
          type: 'HUB_INFO',
          action: 'HUB_INFO',
          branch_id: hubBranchId,
          branch_name: hubBranchName,
          tenant_id: hubTenantId,
          hub_id: `HUB-${hubBranchId}`,
          version: '3.3.0',
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
        console.warn(`[Termux Hub] ⚠️ RESET_BRANCH received! Wiping memory and resetting branch identity...`);
        salesStore = [];
        inventoryStore = [];
        directGrvsStore = [];
        cashMovementsStore = [];
        cashLiftsStore = [];
        cashLogsStore = [];
        customerChangesStore = [];
        creditSalesStore = [];
        stockMovementsStore = [];
        expensesStore = [];
        cashTransfersStore = [];
        casualWorkersStore = [];
        zoneAssignmentsStore = [];
        branchLockdownsStore = {};
        salespeopleStore = [];
        customersStore = [];
        businessDayClosuresStore = [];
        electronicSettlementsStore = [];

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
            version: '3.3.0',
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
      // 0.3 CASUAL WORKERS PIN SYNC OVER LOCAL HUB
      // =====================================================================
      if (pType === 'CASUAL_WORKERS_SYNC') {
        const incoming = packet.casualWorkers || payload || packet.casuals;
        if (Array.isArray(incoming)) {
          incoming.forEach((cw) => {
            if (!cw) return;
            const cleanCw = { ...cw };
            delete cleanCw.pin; // Never persist raw pin
            const exIdx = casualWorkersStore.findIndex((c) => (cw.id && c.id === cw.id) || (cw.pin_hash && c.pin_hash === cw.pin_hash));
            if (exIdx >= 0) {
              casualWorkersStore[exIdx] = { ...casualWorkersStore[exIdx], ...cleanCw };
            } else {
              casualWorkersStore.push(cleanCw);
            }
          });
          scheduleSave();
        }

        const sanitizedPacket = { ...packet };
        if (Array.isArray(sanitizedPacket.casualWorkers)) {
          sanitizedPacket.casualWorkers = sanitizedPacket.casualWorkers.map((c) => {
            const copy = { ...c };
            delete copy.pin;
            return copy;
          });
        }
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
      // 0.4 STOCKTAKE BRANCH LOCKDOWN BROADCAST
      // =====================================================================
      if (pType === 'STOCKTAKE_LOCKDOWN_BROADCAST') {
        const brId = packet.branchId || packet.branch_id || hubBranchId;
        branchLockdownsStore[brId] = {
          branchId: brId,
          isLocked: Boolean(packet.isLocked),
          sessionId: packet.sessionId,
          lockedAt: packet.isLocked ? new Date().toISOString() : undefined,
          lockedByName: packet.lockedByName,
          reason: packet.reason,
        };
        scheduleSave();
        console.log(`[Termux Hub] 🔒 Branch Lockdown status changed: ${brId} isLocked=${packet.isLocked}`);

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(dataStr);
            } catch (e) {}
          }
        });
        return;
      }

      // =====================================================================
      // 0.45 STOCKTAKE SESSION & SEGMENT DISCOVERY
      // =====================================================================
      if (pType === 'STOCKTAKE_SESSION_STARTED') {
        const sess = packet.session || packet;
        const sessionId = packet.sessionId || sess.sessionId;
        if (sessionId) {
          const sIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          const sessionObj = {
            sessionId,
            title: packet.sessionName || packet.title || sess.title || `Session ${sessionId}`,
            sessionName: packet.sessionName || packet.title || sess.title || `Session ${sessionId}`,
            segments: Array.isArray(packet.segments) ? packet.segments : (sess.segments || []),
            startedBy: packet.startedBy || sess.startedBy || 'Manager',
            startedAt: packet.startedAt || sess.startedAt || new Date().toISOString(),
            countType: packet.countType || sess.countType || 'DAILY_BLIND',
            branchId: packet.branchId || sess.branchId || hubBranchId,
            branchName: packet.branchName || sess.branchName || hubBranchName,
            isLockdownActive: Boolean(packet.isLockdownActive || sess.isLockdownActive),
            notes: packet.notes || sess.notes || '',
            updatedAt: Date.now(),
          };

          if (sIdx >= 0) {
            stocktakeSessionsStore[sIdx] = { ...stocktakeSessionsStore[sIdx], ...sessionObj };
          } else {
            stocktakeSessionsStore.unshift(sessionObj);
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
            `[Termux Hub] 📋 Started Stocktake Session [${sessionId}] "${sessionObj.sessionName}" with ${(sessionObj.segments || []).length} segments. Saved to disk & broadcasted to peers.`
          );

          // Broadcast to all other peers
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
          ws.send(
            JSON.stringify({
              type: 'STOCKTAKE_SESSION_LIST',
              action: 'STOCKTAKE_SESSION_LIST',
              sessions: stocktakeSessionsStore,
              segments: stocktakeSegmentsStore,
              timestamp: Date.now(),
            })
          );
          console.log(
            `[Termux Hub] 📋 Replied to STOCKTAKE_SESSION_LIST_REQUEST with ${stocktakeSessionsStore.length} session(s) and ${stocktakeSegmentsStore.length} segment(s).`
          );
        } catch (e) {}
        return;
      }

      // =====================================================================
      // 0.5 SELF-SERVICE ZONE CLAIMING
      // =====================================================================
      if (pType === 'STOCKTAKE_ZONE_CLAIM') {
        const { sessionId, zoneId, slot, deviceId, staffId, staffName } = packet;
        if (sessionId && zoneId && (slot === 'A' || slot === 'B')) {
          let zoneRec = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zoneId);
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
            zoneRec.teamA = { deviceId, staffId, staffName, claimedAt: new Date().toISOString(), submitted: false };
            zoneRec.status = zoneRec.teamB?.submitted ? 'AWAITING_DOUBLE_COUNT' : 'IN_PROGRESS';
          } else {
            zoneRec.teamB = { deviceId, staffId, staffName, claimedAt: new Date().toISOString(), submitted: false };
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

        if (!hubBlindStore[sessionId]) hubBlindStore[sessionId] = {};
        if (!hubBlindStore[sessionId][zoneId]) {
          hubBlindStore[sessionId][zoneId] = { A: null, B: null, recount: null };
        }

        hubBlindStore[sessionId][zoneId][slot] = {
          deviceId,
          staffId,
          staffName,
          submittedAt: new Date().toISOString(),
          lines: Array.isArray(lines) ? lines : [],
        };

        saveBlindVault();
        console.log(`[Hub] Vaulted Team ${slot} count for Zone ${zoneId}. Saved to disk.`);

        try {
          const ackPacket = {
            type: 'STOCKTAKE_ACK_SUBMIT',
            sessionId,
            zoneId,
            slot,
            status: 'VAULTED',
            message: `Count for Zone ${zoneId} secured in Hub Vault. Awaiting Team ${slot === 'A' ? 'B' : 'A'} submission.`,
            timestamp: Date.now(),
          };
          ws.send(JSON.stringify(ackPacket));
        } catch (e) {}

        const statusPacket = {
          type: 'STOCKTAKE_ZONE_STATUS_UPDATE',
          sessionId,
          zoneId,
          slot,
          hasCountA: Boolean(hubBlindStore[sessionId][zoneId].A),
          hasCountB: Boolean(hubBlindStore[sessionId][zoneId].B),
          status:
            hubBlindStore[sessionId][zoneId].A && hubBlindStore[sessionId][zoneId].B
              ? 'COMPARING'
              : slot === 'A'
              ? 'AWAITING_DOUBLE_COUNT'
              : 'IN_PROGRESS',
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
            const aCases = Number(itemA ? itemA.cases : 0) || 0;
            const bCases = Number(itemB ? itemB.cases : 0) || 0;
            const aSingles = Number(itemA ? itemA.singles : 0) || 0;
            const bSingles = Number(itemB ? itemB.singles : 0) || 0;
            const aTot = Number(itemA ? itemA.totalUnits : 0) || 0;
            const bTot = Number(itemB ? itemB.totalUnits : 0) || 0;
            const baseItem = itemA || itemB;

            if (itemA && itemB && aCases === bCases && aSingles === bSingles && aTot === bTot) {
              verifiedCounts.push({
                itemId: baseItem.itemId || key,
                itemName: baseItem.itemName || key,
                category: baseItem.category,
                sku: baseItem.sku,
                unitsPerCase: baseItem.unitsPerCase || 1,
                cases: aCases,
                singles: aSingles,
                totalUnits: aTot,
                source: 'MATCHED',
              });
            } else {
              discrepancies.push({
                itemId: baseItem.itemId || key,
                itemName: baseItem.itemName || key,
                sku: baseItem.sku || key,
                unitsPerCase: baseItem.unitsPerCase || 1,
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
            console.log(`[Termux Hub] ✅ Zone ${zoneId} DOUBLE-COUNT MATCHED 100% (${verifiedCounts.length} lines verified).`);
            const verifiedPacket = {
              type: 'STOCKTAKE_MATCH_VERIFIED',
              sessionId,
              zoneId,
              status: 'VERIFIED',
              verifiedCounts,
              verifiedCount: verifiedCounts.length,
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
            console.log(`[Termux Hub] ⚠️ Zone ${zoneId} DISCREPANCY: ${discrepancies.length} variance item(s). Alerting Teams A & B.`);
            const variancePacket = {
              type: 'STOCKTAKE_VARIANCE_ALERT',
              sessionId,
              zoneId,
              status: 'VARIANCE_FLAGGED',
              discrepancies,
              discrepancyCount: discrepancies.length,
              teamAStaffName: subA.staffName,
              teamBStaffName: subB.staffName,
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

      // =====================================================================
      // 1. TRANSACTIONAL DATA: SALES INVOICES (APPEND-ONLY, NO TIMESTAMP REJECTION)
      // =====================================================================
      const isSale = pType === 'SALE' || pType === 'SALE_RECORD' || pType === 'SALE_CREATED' || !!packet.sale;
      const saleObj = packet.sale || (packet.data && (packet.data.items || packet.data.total !== undefined ? packet.data : packet.data.sale)) || packet.payload;
      const saleId =
        (saleObj && (saleObj.id || saleObj.invoice_id || saleObj.invoiceId)) ||
        packet.invoice_id ||
        packet.invoiceId ||
        packet.id ||
        (packet.data && (packet.data.invoice_id || packet.data.id));

      if (isSale && saleId) {
        const isLegacyInv = String(saleId).toUpperCase().startsWith('INV-');
        const existingIdx = salesStore.findIndex((s) => s.id === saleId);
        const prevSale = existingIdx >= 0 ? salesStore[existingIdx] : null;

        if (existingIdx >= 0) {
          // THE VOID EXCEPTION:
          // If the Hub already has the invoice marked as Voided or Refunded, and the device sends
          // an old version marked as Completed, the Hub MUST reject the old version and send the
          // authoritative Voided/Refunded status back to the device.
          const isExistingVoidOrRefund = prevSale.status === 'Voided' || prevSale.status === 'Refunded';
          const isIncomingCompleted = saleObj.status !== 'Voided' && saleObj.status !== 'Refunded';

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

          // Otherwise update existing record (e.g. cashier issuing refund/void or exchange)
          salesStore[existingIdx] = { ...salesStore[existingIdx], ...(saleObj || packet) };
        } else {
          // APPEND-ONLY: Offline invoices arriving with old timestamps (e.g. offline for 5 hours)
          // MUST BE ACCEPTED as long as the invoice_id is unique! NO TIMESTAMP REJECTION!
          salesStore.unshift(saleObj || packet);
          console.log(`[Termux Hub] 📥 Accepted Offline/Online Sale #${saleId} (Append-Only)`);
        }

        // Inventory movements: New Sale, Refund, Void, and Item Exchange
        const isNewRefund = saleObj?.status === 'Refunded' && prevSale?.status !== 'Refunded';
        const isNewVoid = saleObj?.status === 'Voided' && prevSale?.status !== 'Voided';

        if (saleObj && Array.isArray(saleObj.items)) {
          for (const it of saleObj.items) {
            if (!it || !it.id) continue;
            const invIdx = inventoryStore.findIndex((i) => i.itemId === it.id || i.id === it.id);
            if (invIdx >= 0) {
              const curUnits = Number(inventoryStore[invIdx].totalUnits || 0);
              const qty = Number(it.quantity || 0);
              let newUnits = curUnits;

              if (isNewRefund || isNewVoid) {
                newUnits = Number((curUnits + qty).toFixed(3));
                console.log(`[Termux Hub] Restocked ${qty}x ${it.name || it.id} from ${isNewRefund ? 'Refund' : 'Void'} on #${saleId}`);
              } else if (!prevSale && saleObj.status !== 'Refunded' && saleObj.status !== 'Voided') {
                newUnits = Number((curUnits - qty).toFixed(3));
              }

              inventoryStore[invIdx].totalUnits = newUnits;
              inventoryStore[invIdx].stockSingles = newUnits;
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
                const cur = Number(inventoryStore[retIdx].totalUnits || 0);
                const retUnits = Number((cur + Number(ex.returnedItem.quantity || 1)).toFixed(3));
                inventoryStore[retIdx].totalUnits = retUnits;
                inventoryStore[retIdx].stockSingles = retUnits;
                console.log(`[Termux Hub] Restocked returned exchange item: +${ex.returnedItem.quantity}x ${ex.returnedItem.name}`);
              }
            }
            if (ex.replacementItem?.id) {
              const repIdx = inventoryStore.findIndex((i) => i.itemId === ex.replacementItem.id || i.id === ex.replacementItem.id);
              if (repIdx >= 0) {
                const cur = Number(inventoryStore[repIdx].totalUnits || 0);
                const repUnits = Number((cur - Number(ex.replacementItem.quantity || 1)).toFixed(3));
                inventoryStore[repIdx].totalUnits = repUnits;
                inventoryStore[repIdx].stockSingles = repUnits;
                console.log(`[Termux Hub] Depleted replacement exchange item: -${ex.replacementItem.quantity}x ${ex.replacementItem.name}`);
              }
            }
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
            directGrvsStore[exIdx] = { ...directGrvsStore[exIdx], ...grv };
          } else {
            // Append-Only: Accept unique offline GRVs regardless of timestamp!
            directGrvsStore.unshift(grv);
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
                const curUnits = Number(inventoryStore[invIdx].totalUnits || 0);
                inventoryStore[invIdx].totalUnits = Math.max(0, Number((curUnits - unitsToDeduct).toFixed(3)));
                inventoryStore[invIdx].stockSingles = inventoryStore[invIdx].totalUnits;
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
                const curUnits = Number(inventoryStore[invIdx].totalUnits || 0);
                inventoryStore[invIdx].totalUnits = Number((curUnits + unitsToAdd).toFixed(3));
                inventoryStore[invIdx].stockSingles = inventoryStore[invIdx].totalUnits;
                if (item.costPrice) inventoryStore[invIdx].costPrice = item.costPrice;
                if (item.costPerCase) inventoryStore[invIdx].costPerCase = item.costPerCase;
              } else {
                inventoryStore.push({
                  id: cleanId,
                  itemId: cleanId,
                  itemName: item.productName || cleanId,
                  totalUnits: unitsToAdd,
                  stockSingles: unitsToAdd,
                  costPrice: item.costPrice || 0,
                  costPerCase: item.costPerCase || 0,
                  sellPriceUnit: item.sellingPrice || 0,
                  company_id: grv.companyId || grv.company_id || packet.companyId || 'COMP-001',
                  branch_id: grv.branchId || grv.branch_id || packet.branchId || 'BR-MAIN',
                  updatedAt: new Date().toISOString(),
                  hubTimestamp: Date.now(),
                  lastUpdated: new Date().toISOString(),
                });
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
          const exIdx = inventoryStore.findIndex(
            (i) => i.itemId === cleanId || i.id === cleanId || (it.sku && i.sku === it.sku)
          );
          const incomingTime = getTimestamp(it);

          // STRICT LWW:
          // If incoming update is strictly OLDER than the Hub's existing record (with 5s clock skew grace),
          // reject it and send the authoritative Hub data back to the device!
          if (exIdx >= 0) {
            const existing = inventoryStore[exIdx];
            const existingTime = getTimestamp(existing);
            if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 5000)) {
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

          // Hub is the Clock: Stamp record with Hub time
          const stamped = {
            ...it,
            itemId: cleanId,
            id: cleanId,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
          };

          if (exIdx >= 0) {
            inventoryStore[exIdx] = { ...inventoryStore[exIdx], ...stamped };
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
          const exIdx = cashMovementsStore.findIndex((m) => m.id === move.id);
          if (exIdx >= 0) {
            cashMovementsStore[exIdx] = { ...cashMovementsStore[exIdx], ...move };
          } else {
            cashMovementsStore.unshift(move);
            console.log(`[Termux Hub] 📥 Accepted Cash Movement [${move.id}] (Append-Only)`);
          }
          scheduleSave();
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
          const exIdx = cashLiftsStore.findIndex((l) => l.id === liftId || l.liftId === liftId);
          if (exIdx >= 0) {
            cashLiftsStore[exIdx] = { ...cashLiftsStore[exIdx], ...lift };
          } else {
            cashLiftsStore.unshift(lift);
            console.log(`[Termux Hub] 📥 Accepted Cash Lift [${liftId}] (Append-Only)`);
          }
          scheduleSave();
        }
      }

      // =====================================================================
      // 6. TRANSACTIONAL DATA: FORM 2 DAILY CASH LOGS (APPEND-ONLY)
      // =====================================================================
      const isCashLog =
        pType === 'CASH_LOG' ||
        sheetName === 'CashLog' ||
        entityType === 'cash_log' ||
        (payload && payload.line && (payload.in !== undefined || payload.out !== undefined));

      if (isCashLog) {
        const log = packet.cashLog || payload;
        if (log && (log.id || log.cashLogId)) {
          const logId = log.id || log.cashLogId;
          const exIdx = cashLogsStore.findIndex((l) => l.id === logId || l.cashLogId === logId);
          if (exIdx >= 0) {
            cashLogsStore[exIdx] = { ...cashLogsStore[exIdx], ...log };
          } else {
            cashLogsStore.unshift(log);
            console.log(`[Termux Hub] 📥 Accepted Cash Log [${log.line || logId}] (Append-Only)`);
          }
          scheduleSave();
        }
      }

      // =====================================================================
      // 7. TRANSACTIONAL DATA: CUSTOMER CHANGE & CREDIT SALES (APPEND-ONLY)
      // =====================================================================
      if ((pType === 'CUSTOMER_CHANGE' || sheetName === 'CustomerChange') && payload && payload.changeId) {
        const exIdx = customerChangesStore.findIndex((c) => c.changeId === payload.changeId || c.id === payload.changeId);
        if (exIdx >= 0) {
          customerChangesStore[exIdx] = { ...customerChangesStore[exIdx], ...payload };
        } else {
          customerChangesStore.unshift(payload);
          console.log(`[Termux Hub] 📥 Accepted Customer Change [${payload.changeId}] (Append-Only)`);
        }
        scheduleSave();
      }

      if ((pType === 'CREDIT_SALE' || sheetName === 'CreditSales') && payload && payload.creditId) {
        const exIdx = creditSalesStore.findIndex((c) => c.creditId === payload.creditId || c.id === payload.creditId);
        if (exIdx >= 0) {
          creditSalesStore[exIdx] = { ...creditSalesStore[exIdx], ...payload };
        } else {
          creditSalesStore.unshift(payload);
          console.log(`[Termux Hub] 📥 Accepted Credit Sale [${payload.creditId}] (Append-Only)`);
        }
        scheduleSave();
      }

      // =====================================================================
      // 8. TRANSACTIONAL DATA: STOCK MOVEMENTS (APPEND-ONLY, NO TIMESTAMP REJECTION)
      // =====================================================================
      if ((pType === 'STOCK_MOVEMENT' || sheetName === 'StockMovement') && payload && (payload.id || payload.movementId)) {
        const mId = payload.id || payload.movementId;
        const exIdx = stockMovementsStore.findIndex((m) => m.id === mId || m.movementId === mId);
        if (exIdx >= 0) {
          stockMovementsStore[exIdx] = { ...stockMovementsStore[exIdx], ...payload };
        } else {
          stockMovementsStore.unshift(payload);
          console.log(`[Termux Hub] 📥 Accepted Stock Movement [${mId}] (Append-Only)`);
        }
        scheduleSave();
      }

      // =====================================================================
      // 9. TRANSACTIONAL DATA: EXPENSES & CASH TRANSFERS (APPEND-ONLY)
      // =====================================================================
      if ((pType === 'EXPENSE' || sheetName === 'Expenses') && payload && payload.id) {
        const exIdx = expensesStore.findIndex((e) => e.id === payload.id);
        if (exIdx >= 0) {
          expensesStore[exIdx] = { ...expensesStore[exIdx], ...payload };
        } else {
          expensesStore.unshift(payload);
          console.log(`[Termux Hub] 📥 Accepted Expense [${payload.id}] (Append-Only)`);
        }
        scheduleSave();
      }

      if ((pType === 'CASH_TRANSFER' || sheetName === 'CashTransfers') && payload && payload.id) {
        const exIdx = cashTransfersStore.findIndex((t) => t.id === payload.id);
        if (exIdx >= 0) {
          cashTransfersStore[exIdx] = { ...cashTransfersStore[exIdx], ...payload };
        } else {
          cashTransfersStore.unshift(payload);
          console.log(`[Termux Hub] 📥 Accepted Cash Transfer [${payload.id}] (Append-Only)`);
        }
        scheduleSave();
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
        const sIdx = salespeopleStore.findIndex((s) => s.id === staffObj.id);
        const incomingTime = getTimestamp(staffObj);
        let accepted = true;

        if (sIdx >= 0) {
          const existing = salespeopleStore[sIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime) {
            console.log(`[Termux Hub] 🛡️ LWW Reject: Stale staff update for ${staffObj.name} (${staffObj.id}). Sending authoritative Hub record back.`);
            try {
              ws.send(JSON.stringify({
                type: 'STAFF',
                action: 'STAFF_SYNC',
                staff: existing,
                payload: existing,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            accepted = false;
          }
        }

        if (accepted) {
          staffObj.updatedAt = hubIso;
          staffObj.hubTimestamp = hubNow;
          staffObj.lastUpdated = hubIso;

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
        }
      }

      // =====================================================================
      // 9.2 CONFIGURATION DATA: CUSTOMERS & CREDIT LIMITS (STRICT LWW)
      // =====================================================================
      const custObj = packet.customer || (payload && (payload.customerId || payload.creditLimit !== undefined) ? payload : null);
      const isCust = pType === 'CUSTOMER' || pType === 'CUSTOMER_SYNC' || pType === 'CUSTOMER_RECORD' || sheetName === 'Customers' || !!custObj;
      if (isCust && custObj && (custObj.customerId || custObj.id)) {
        const cId = custObj.customerId || custObj.id;
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();
        const cIdx = customersStore.findIndex((c) => (c.customerId || c.id) === cId);
        const incomingTime = getTimestamp(custObj);
        let accepted = true;

        if (cIdx >= 0) {
          const existing = customersStore[cIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime) {
            console.log(`[Termux Hub] 🛡️ LWW Reject: Stale customer update for ${cId}. Sending authoritative Hub record back.`);
            try {
              ws.send(JSON.stringify({
                type: 'CUSTOMER',
                action: 'CUSTOMER_SYNC',
                customer: existing,
                payload: existing,
                origin_device_id: 'LOCAL_HUB',
                origin_device_name: 'Termux Local Hub',
                timestamp: Date.now(),
              }));
            } catch (e) {}
            accepted = false;
          }
        }

        if (accepted) {
          custObj.updatedAt = hubIso;
          custObj.hubTimestamp = hubNow;
          custObj.lastUpdated = hubIso;

          if (cIdx >= 0) {
            customersStore[cIdx] = { ...customersStore[cIdx], ...custObj };
          } else {
            customersStore.unshift(custObj);
          }
          scheduleSave();
          console.log(`[Termux Hub] 👥 Synced Customer account: ${custObj.name} (${cId}) stamped at ${hubIso}`);

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

          // Broadcast updated customer to other peers
          const custBroadcastStr = JSON.stringify({
            type: 'CUSTOMER',
            action: 'CUSTOMER_SYNC',
            customer: custObj,
            payload: custObj,
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(custBroadcastStr); } catch (e) {}
            }
          });
        }
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
          const exIdx = businessDayClosuresStore.findIndex((c) => c.id === cId || c.date === closure.date);
          if (exIdx >= 0) {
            businessDayClosuresStore[exIdx] = { ...businessDayClosuresStore[exIdx], ...closure };
          } else {
            businessDayClosuresStore.unshift(closure);
          }
          scheduleSave();
          console.log(`[Termux Hub] Recorded End of Day Closure for Date: ${closure.date} by ${closure.closedBySupervisorName || 'Supervisor'}`);
        }
      }

      // =====================================================================
      // 10. DELTA CATCH-UP RESPONSE (NO FIREHOSE - ONLY updatedAt >= sinceTime)
      // =====================================================================
      const isCatchupReq = pType === 'catchup_request' || pType === 'CATCHUP_REQUEST';
      if (isCatchupReq) {
        let sinceTime = 0;
        let sinceTimestamp = packet.sinceTimestamp;
        if (typeof sinceTimestamp === 'number') {
          sinceTime = sinceTimestamp;
        } else if (typeof sinceTimestamp === 'string') {
          const asNum = Number(sinceTimestamp);
          if (!isNaN(asNum) && asNum > 1000000000000) {
            sinceTime = asNum;
          } else {
            sinceTime = new Date(sinceTimestamp).getTime();
          }
        }

        // Guard against 0 or negative timestamps unless explicitly forced
        if (isNaN(sinceTime) || sinceTime <= 0) {
          sinceTime = packet.isForced ? 0 : Date.now() - 5 * 60 * 1000;
          sinceTimestamp = new Date(sinceTime).toISOString();
        } else {
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
        const missedSales = salesStore.filter((s) => isMatch(s, reqComp, reqBranch) && (getTimestamp(s) >= sinceTime || packet.isForced));
        const missedDirectGrvs = directGrvsStore.filter((g) => isMatch(g, reqComp, reqBranch) && (getTimestamp(g) >= sinceTime || packet.isForced));
        const missedInventory = inventoryStore.filter((i) => isMatch(i, reqComp, reqBranch, true) && (getTimestamp(i) >= sinceTime || packet.isForced));
        const missedCashLogs = cashLogsStore.filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced));
        const missedCashLifts = cashLiftsStore.filter((l) => isMatch(l, reqComp, reqBranch) && (getTimestamp(l) >= sinceTime || packet.isForced));
        const missedCashMovements = cashMovementsStore.filter((m) => isMatch(m, reqComp, reqBranch) && (getTimestamp(m) >= sinceTime || packet.isForced));
        const missedCustomerChanges = customerChangesStore.filter((ch) => isMatch(ch, reqComp, reqBranch) && (getTimestamp(ch) >= sinceTime || packet.isForced));
        const missedCreditSales = creditSalesStore.filter((cs) => isMatch(cs, reqComp, reqBranch) && (getTimestamp(cs) >= sinceTime || packet.isForced));
        const missedStockMovements = stockMovementsStore.filter((sm) => isMatch(sm, reqComp, reqBranch) && (getTimestamp(sm) >= sinceTime || packet.isForced));
        const missedExpenses = expensesStore.filter((ex) => isMatch(ex, reqComp, reqBranch) && (getTimestamp(ex) >= sinceTime || packet.isForced));
        const missedCashTransfers = cashTransfersStore.filter((tr) => isMatch(tr, reqComp, reqBranch) && (getTimestamp(tr) >= sinceTime || packet.isForced));
        const missedSalespeople = salespeopleStore.filter((s) => isMatch(s, reqComp, reqBranch) && (getTimestamp(s) >= sinceTime || packet.isForced));
        const missedCustomers = customersStore.filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced));

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
            cashTransfers: missedCashTransfers,
            casualWorkers: casualWorkersStore,
            zoneAssignments: zoneAssignmentsStore,
            branchLockdowns: branchLockdownsStore,
            salespeople: missedSalespeople,
            customers: missedCustomers,
            businessDayClosures: businessDayClosuresStore,
            stocktakeSessions: stocktakeSessionsStore,
            stocktakeSegments: stocktakeSegmentsStore,
          },
        };

        try {
          ws.send(JSON.stringify(catchupResponse));
          console.log(
            `[Termux Hub] 📤 Dispatched Delta Catch-up to ${reqDeviceId}: ` +
            `${missedSales.length} sales, ${missedDirectGrvs.length} GRVs, ` +
            `${missedInventory.length} inventory deltas (No Firehose), ` +
            `${missedCashLogs.length} cash logs, ${missedSalespeople.length} staff, ${missedCustomers.length} customers.`
          );
        } catch (e) {
          console.warn('[Termux Hub] Failed to send catchup response:', e.message);
        }
        return;
      }

      // =====================================================================
      // 11. GENERAL BROADCAST TO OTHER PEERS (DO NOT ECHO BACK TO SENDER)
      // =====================================================================
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
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
    console.log(`[Termux Hub] 🔴 POS Terminal disconnected`);
  });

  ws.on('error', (err) => {
    console.warn('[Termux Hub] Client WebSocket error:', err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================================`);
  console.log(`🚀 Saimetric POS - Standalone Local Hub (v3.3.0)`);
  console.log(`📡 WebSocket URL:  ws://0.0.0.0:${PORT}`);
  console.log(`🌐 HTTP Status:    http://0.0.0.0:${PORT}/health`);
  console.log(`🏢 Branch ID:      ${hubBranchId} ("${hubBranchName}")`);
  console.log(`🏢 Tenant ID:      ${hubTenantId}`);
  console.log(`💾 Data File:      ${DATA_FILE}`);
  console.log(`⚡ Dual-Sync:      Transactional (Append-Only) & Config (Strict LWW)`);
  console.log(`================================================================`);
});
