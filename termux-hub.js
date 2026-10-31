#!/usr/bin/env node
/**
 * Saimetric POS - Standalone High-Reliability Local Hub for Termux Android / Local LAN (v3.2)
 *
 * Designed specifically for Termux Android Hotspot environments (192.168.43.1:8080)
 * and Local Branch LANs. Acts as the local authoritative source of truth for the branch:
 *
 * 1. Immediate SYNC_RECEIPT (ACK) sent back to sender for every sale.
 * 2. Full-Branch Multi-Entity Store:
 *    - Sales Invoices
 *    - Direct Delivery Vouchers (Direct GRVs) & Till Payouts
 *    - Product Catalog Master & Real-Time Stock Levels
 *    - Cash Movements (Opening Floats, Direct Procurements, Adjustments)
 *    - Supervisor Cash Lifts
 *    - Form 2 Daily Cash Logs
 *    - Customer Credit Accounts & Change Vouchers
 *    - Stock Movements (Wastage, Adjustments)
 *    - Petty Cash Expenses & Vault Cash Transfers
 * 3. Blind Double-Count Stocktake Protocol:
 *    - Hub Secret Holding Vault (`hubBlindStore`): Suppresses peer broadcast for Team A count.
 *    - Automated Server-side Line Comparison: Dispatches STOCKTAKE_MATCH_VERIFIED or STOCKTAKE_VARIANCE_ALERT.
 *    - Self-Service Zone Claiming & Locking.
 *    - Peer Dual-Signature Joint Recount Coordination.
 *    - Casual Worker 4-Digit PIN Distribution.
 *    - Universal Stocktake Lockdown Broadcast.
 * 4. 2GB CCTV Safety Threshold & 30-Day Storage Rotation.
 * 5. Strict Branch Isolation & Repurposing (`PING_HUB`, `HANDSHAKE`, `RESET_BRANCH`).
 * 6. CommonJS Native Execution for Termux Android (`require` syntax).
 *
 * Quick Start on Termux:
 *   pkg update && pkg install nodejs
 *   npm install ws
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

// Staff & Customer Master Stores (Synced across multi-device Wi-Fi)
let salespeopleStore = [];
let customersStore = [];

// Secret holding vault for blind double-counting:
// Structure: { [sessionId]: { [zoneId]: { A: null, B: null } } }
const hubBlindStore = {};

let packetCounter = 0;
const seenPacketIds = new Set();

// Helper: Match record by tenant and branch
function isMatch(rec, reqComp, reqBranch) {
  if (!rec) return false;
  const c = (rec.company_id || rec.companyId || 'COMP-001').trim().toUpperCase();
  if (reqComp && c && c !== reqComp && c !== 'COMP-MASTER' && reqComp !== 'COMP-MASTER') return false;
  const b = (rec.branch_id || rec.branchId || '').trim().toUpperCase();
  if (reqBranch && b && reqBranch !== 'ALL' && b !== 'ALL' && b !== reqBranch) return false;
  return true;
}

// Helper: Extract timestamp in milliseconds
function getTimestamp(rec) {
  if (!rec) return 0;
  const t = rec.timestamp || rec.updated_at || rec.updatedAt || rec.createdAt || rec.created_at || rec.date;
  if (!t) return 0;
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
      if (Array.isArray(parsed.casualWorkers)) casualWorkersStore = parsed.casualWorkers;
      if (Array.isArray(parsed.zoneAssignments)) zoneAssignmentsStore = parsed.zoneAssignments;
      if (Array.isArray(parsed.salespeople)) salespeopleStore = parsed.salespeople;
      if (Array.isArray(parsed.customers)) customersStore = parsed.customers;
      if (parsed.branchLockdowns && typeof parsed.branchLockdowns === 'object') {
        branchLockdownsStore = parsed.branchLockdowns;
      }

      console.log(
        `[Termux Hub] Loaded from disk: [Branch: ${hubBranchId} - ${hubBranchName}], ${salesStore.length} sales, ${directGrvsStore.length} direct GRVs, ${inventoryStore.length} items, ${salespeopleStore.length} staff, ${customersStore.length} customers, ${casualWorkersStore.length} casuals.`
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
      branchLockdowns: branchLockdownsStore,
      savedAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORAGE_BYTES) {
      console.warn(`[Termux Hub] Warning: Hub data exceeds 2GB limit. Trimming oldest logs...`);
      salesStore = salesStore.slice(0, 2500);
      directGrvsStore = directGrvsStore.slice(0, 500);
    }

    fs.writeFileSync(DATA_FILE, serialized, 'utf8');
  } catch (e) {
    console.error('[Termux Hub] Error saving data file:', e.message);
  }
}

loadData();

// HTTP server for health checks & ping
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/health' || req.url === '/api/health' || req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        status: 'ok',
        hub: 'Saimetric Termux Local Hub v3.2 (Blind Stocktake & Full-Store Sync)',
        port: PORT,
        branchId: hubBranchId,
        branchName: hubBranchName,
        clientsCount: wss ? wss.clients.size : 0,
        totalSalesStored: salesStore.length,
        totalDirectGrvsStored: directGrvsStore.length,
        totalInventoryItems: inventoryStore.length,
        totalCasualWorkers: casualWorkersStore.length,
        totalZonesAssigned: zoneAssignmentsStore.length,
        packetsProcessed: packetCounter,
        uptimeSec: Math.round(process.uptime()),
      })
    );
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(
    `Saimetric Termux Local Hub v3.2 Running on Port ${PORT}\nBranch: ${hubBranchId} (${hubBranchName})\nConnected Clients: ${wss ? wss.clients.size : 0}\nTotal Sales: ${salesStore.length}\nDirect GRVs: ${directGrvsStore.length}\nInventory Items: ${inventoryStore.length}\nCasual Workers: ${casualWorkersStore.length}\nPackets Processed: ${packetCounter}\n`
  );
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  console.log(`[Termux Hub] Client connected from ${clientIp}. Total active clients: ${wss.clients.size}`);

  ws.on('message', (msg) => {
    try {
      const dataStr = msg.toString();
      const packet = JSON.parse(dataStr);
      if (!packet || typeof packet !== 'object') return;

      packetCounter++;

      // Deduplicate by packet ID to prevent loop echo
      const pktId = packet.packet_id || packet.id || packet.clientRequestId;
      if (pktId) {
        if (seenPacketIds.has(pktId)) {
          return; // Drop duplicate packet immediately
        }
        seenPacketIds.add(pktId);
        if (seenPacketIds.size > 10000) {
          const first = seenPacketIds.values().next().value;
          seenPacketIds.delete(first);
        }
      }

      const pType = (packet.type || packet.action || '').toUpperCase();
      const entityType = (packet.entityType || '').toLowerCase();
      const sheetName = packet.sheetName || '';
      const payload = packet.payload || packet.item || packet.sale || packet.grv || packet.lift || packet.movement || packet.data;

      // Drop ACK packets immediately so they NEVER circulate, echo, or ping-pong in the mesh
      const isReceipt =
        pType === 'SYNC_RECEIPT' ||
        pType === 'CLOUD_SYNC_ACK' ||
        pType === 'ANTI-DOUBLE-POST ACK' ||
        pType === 'ACK' ||
        pType === 'SALE_ACK' ||
        pType === 'RECEIPT' ||
        pType === 'STOCKTAKE_ACK_SUBMIT';
      if (isReceipt) {
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
          hub_id: `HUB-${hubBranchId}`,
          version: '3.2.0',
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
        salespeopleStore = [];
        customersStore = [];
        branchLockdownsStore = {};
        seenPacketIds.clear();
        Object.keys(hubBlindStore).forEach((k) => delete hubBlindStore[k]);

        const newBranchId = packet.new_branch_id || packet.branch_id || 'UNASSIGNED';
        const newBranchName = packet.new_branch_name || packet.branch_name || 'Unassigned Hub';
        hubBranchId = newBranchId;
        hubBranchName = newBranchName;

        saveData();

        const resetAck = {
          type: 'RESET_CONFIRMED',
          action: 'RESET_CONFIRMED',
          status: 'WIPED',
          branch_id: hubBranchId,
          branch_name: hubBranchName,
          message: 'Local Hub has been wiped clean and is ready for re-assignment.',
          timestamp: Date.now(),
        };
        try {
          ws.send(JSON.stringify(resetAck));
        } catch (e) {}

        const wipeBroadcast = {
          type: 'HUB_INFO',
          action: 'HUB_INFO',
          branch_id: 'UNASSIGNED',
          branch_name: 'Unassigned Hub',
          status: 'UNASSIGNED',
          timestamp: Date.now(),
        };
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(wipeBroadcast));
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
            version: '3.2.0',
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
      // 0.3 CASUAL WORKERS PIN SYNC OVER LOCAL HUB
      // =====================================================================
      if (pType === 'CASUAL_WORKERS_SYNC') {
        const incoming = packet.casualWorkers || payload || packet.casuals;
        if (Array.isArray(incoming)) {
          // Merge casual workers by PIN or ID
          incoming.forEach((cw) => {
            if (!cw || !cw.pin) return;
            const idx = casualWorkersStore.findIndex((c) => c.pin === cw.pin || c.id === cw.id);
            if (idx >= 0) {
              casualWorkersStore[idx] = { ...casualWorkersStore[idx], ...cw };
            } else {
              casualWorkersStore.push(cw);
            }
          });
          scheduleSave();
          console.log(`[Termux Hub] Synced ${incoming.length} casual worker(s). Active casuals: ${casualWorkersStore.length}`);
        }

        // Broadcast to all other peers so every tablet receives the updated casual credentials
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

        // Forward to all clients immediately to freeze/unfreeze POS screens
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

        // Initialize secret holding vault for this session & zone
        if (!hubBlindStore[sessionId]) hubBlindStore[sessionId] = {};
        if (!hubBlindStore[sessionId][zoneId]) {
          hubBlindStore[sessionId][zoneId] = { A: null, B: null, recount: null };
        }

        // Store count in private vault
        hubBlindStore[sessionId][zoneId][slot] = {
          deviceId,
          staffId,
          staffName,
          submittedAt: new Date().toISOString(),
          lines: Array.isArray(lines) ? lines : [],
        };

        console.log(
          `[Termux Hub] 🤫 Vaulted Team ${slot} count for Zone ${zoneId} (${(lines || []).length} items) by ${staffName}. Broadcast suppressed to protect blind audit.`
        );

        // 1. Send point-to-point confirmation back ONLY to the submitting device
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

        // 2. Broadcast generic status update (NO LINE COUNTS OR VALUES) so dashboard grid updates
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

        // 3. Automated Server-Side Comparison if BOTH Team A and Team B have submitted
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
            // 100% MATCH! Auto-verify zone
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
            // DISCREPANCIES DETECTED -> Trigger Joint Recount Sheet
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

        // Drop packet from standard peer broadcast (Blind Vault Protection)
        return;
      }

      // =====================================================================
      // 0.7 PEER DUAL-SIGNATURE JOINT RECOUNT COORDINATION
      // =====================================================================
      if (pType === 'STOCKTAKE_JOINT_PROPOSAL') {
        // Forward proposal to other peers so Team A & Team B can see agreed numbers live
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(dataStr);
            } catch (e) {}
          }
        });
        return;
      }

      if (pType === 'STOCKTAKE_JOINT_FINALIZED') {
        const { sessionId, zoneId, resolvedLines, signedByA, signedByB, resolvedByName } = packet;
        console.log(`[Termux Hub] 🤝 Zone ${zoneId} Joint Recount finalized with Dual-Signatures (A=${signedByA}, B=${signedByB}).`);

        const verifiedPacket = {
          type: 'STOCKTAKE_MATCH_VERIFIED',
          sessionId,
          zoneId,
          status: 'VERIFIED',
          source: 'JOINT_RECOUNT',
          verifiedCounts: resolvedLines || [],
          resolvedByName,
          timestamp: Date.now(),
        };

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(verifiedPacket));
            } catch (e) {}
          }
        });
        return;
      }

      // =====================================================================
      // 1. SALES INVOICES & LIVE INVENTORY DEDUCTIONS
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
          salesStore[existingIdx] = { ...salesStore[existingIdx], ...(saleObj || packet) };
        } else {
          salesStore.unshift(saleObj || packet);
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
                // Restock inventory for customer refund or invoice void
                newUnits = Number((curUnits + qty).toFixed(3));
                console.log(`[Termux Hub] Restocked ${qty}x ${it.name || it.id} from ${isNewRefund ? 'Refund' : 'Void'} on #${saleId}`);
              } else if (!prevSale && saleObj.status !== 'Refunded' && saleObj.status !== 'Voided') {
                // Initial sale outflow
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
      // 2. DIRECT GOODS RECEIVED VOUCHERS (GRVs) & STOCK INWARD UPDATES
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
          if (exIdx >= 0) {
            directGrvsStore[exIdx] = { ...directGrvsStore[exIdx], ...grv };
          } else {
            directGrvsStore.unshift(grv);
          }

          if (grv.status !== 'REJECTED' && Array.isArray(grv.items)) {
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
                  lastUpdated: new Date().toISOString(),
                });
              }
            }
          }

          scheduleSave();
        }
      }

      // =====================================================================
      // 3. PRODUCT CATALOG & MASTER INVENTORY UPDATES
      // =====================================================================
      const isInventory =
        pType === 'INVENTORY' ||
        pType === 'INVENTORY_RECORD' ||
        pType === 'INVENTORY_ITEM' ||
        pType === 'INVENTORY_BATCH' ||
        sheetName === 'InventoryMaster' ||
        sheetName === 'Products' ||
        entityType === 'inventory';

      if (isInventory) {
        const items = Array.isArray(payload) ? payload : [payload || packet.item];
        for (const it of items) {
          if (!it) continue;
          const cleanId = (it.itemId || it.id || '').trim();
          if (!cleanId) continue;
          const exIdx = inventoryStore.findIndex(
            (i) => i.itemId === cleanId || i.id === cleanId || (it.sku && i.sku === it.sku)
          );
          if (exIdx >= 0) {
            inventoryStore[exIdx] = { ...inventoryStore[exIdx], ...it, itemId: cleanId };
          } else {
            inventoryStore.push({ ...it, itemId: cleanId, id: cleanId });
          }
        }
        scheduleSave();
      }

      // =====================================================================
      // 4. CASH MOVEMENTS, FLOATS & DRAWER TRANSFERS
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
          }
          scheduleSave();
        }
      }

      // =====================================================================
      // 5. SUPERVISOR CASH LIFTS (TILL PICK-UPS)
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
          }
          scheduleSave();
        }
      }

      // =====================================================================
      // 6. FORM 2 DAILY CASH LOGS
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
          }
          scheduleSave();
        }
      }

      // =====================================================================
      // 7. CUSTOMER CHANGE & CREDIT SALES
      // =====================================================================
      if ((pType === 'CUSTOMER_CHANGE' || sheetName === 'CustomerChange') && payload && payload.changeId) {
        const exIdx = customerChangesStore.findIndex((c) => c.changeId === payload.changeId || c.id === payload.changeId);
        if (exIdx >= 0) {
          customerChangesStore[exIdx] = { ...customerChangesStore[exIdx], ...payload };
        } else {
          customerChangesStore.unshift(payload);
        }
        scheduleSave();
      }

      if ((pType === 'CREDIT_SALE' || sheetName === 'CreditSales') && payload && payload.creditId) {
        const exIdx = creditSalesStore.findIndex((c) => c.creditId === payload.creditId || c.id === payload.creditId);
        if (exIdx >= 0) {
          creditSalesStore[exIdx] = { ...creditSalesStore[exIdx], ...payload };
        } else {
          creditSalesStore.unshift(payload);
        }
        scheduleSave();
      }

      // =====================================================================
      // 8. STOCK MOVEMENTS (WASTAGE / BREAKAGE / ADJUSTMENTS)
      // =====================================================================
      if ((pType === 'STOCK_MOVEMENT' || sheetName === 'StockMovement') && payload && (payload.id || payload.movementId)) {
        const mId = payload.id || payload.movementId;
        const exIdx = stockMovementsStore.findIndex((m) => m.id === mId || m.movementId === mId);
        if (exIdx >= 0) {
          stockMovementsStore[exIdx] = { ...stockMovementsStore[exIdx], ...payload };
        } else {
          stockMovementsStore.unshift(payload);
        }
        scheduleSave();
      }

      // =====================================================================
      // 9. EXPENSES & CASH TRANSFERS
      // =====================================================================
      if ((pType === 'EXPENSE' || sheetName === 'Expenses') && payload && payload.id) {
        const exIdx = expensesStore.findIndex((e) => e.id === payload.id);
        if (exIdx >= 0) {
          expensesStore[exIdx] = { ...expensesStore[exIdx], ...payload };
        } else {
          expensesStore.unshift(payload);
        }
        scheduleSave();
      }

      if ((pType === 'CASH_TRANSFER' || sheetName === 'CashTransfers') && payload && payload.id) {
        const exIdx = cashTransfersStore.findIndex((t) => t.id === payload.id);
        if (exIdx >= 0) {
          cashTransfersStore[exIdx] = { ...cashTransfersStore[exIdx], ...payload };
        } else {
          cashTransfersStore.unshift(payload);
        }
        scheduleSave();
      }

      // =====================================================================
      // 9.1 STAFF (TILL OPERATORS) & CUSTOMER PROFILES SYNC
      // =====================================================================
      const staffObj = packet.staff || (payload && (payload.pin || payload.role) ? payload : null);
      const isStaff = pType === 'STAFF' || pType === 'STAFF_SYNC' || pType === 'STAFF_RECORD' || sheetName === 'Salespeople' || sheetName === 'users' || !!staffObj;
      if (isStaff && staffObj && staffObj.id) {
        const sIdx = salespeopleStore.findIndex((s) => s.id === staffObj.id);
        if (sIdx >= 0) {
          salespeopleStore[sIdx] = { ...salespeopleStore[sIdx], ...staffObj };
        } else {
          salespeopleStore.unshift(staffObj);
        }
        scheduleSave();
        console.log(`[Termux Hub] Synced Staff account: ${staffObj.name} (${staffObj.id} - ${staffObj.role})`);
      }

      const custObj = packet.customer || (payload && (payload.customerId || payload.creditLimit !== undefined) ? payload : null);
      const isCust = pType === 'CUSTOMER' || pType === 'CUSTOMER_SYNC' || pType === 'CUSTOMER_RECORD' || sheetName === 'Customers' || !!custObj;
      if (isCust && custObj && (custObj.customerId || custObj.id)) {
        const cId = custObj.customerId || custObj.id;
        const cIdx = customersStore.findIndex((c) => (c.customerId || c.id) === cId);
        if (cIdx >= 0) {
          customersStore[cIdx] = { ...customersStore[cIdx], ...custObj };
        } else {
          customersStore.unshift(custObj);
        }
        scheduleSave();
        console.log(`[Termux Hub] Synced Customer account: ${custObj.name} (${cId})`);
      }

      // =====================================================================
      // 10. RECONNECTION CATCH-UP RESPONSE (REPLAY ALL MISSED DELTAS)
      // =====================================================================
      const isCatchupReq = pType === 'catchup_request' || pType === 'CATCHUP_REQUEST';
      if (isCatchupReq) {
        const sinceTimestamp = packet.sinceTimestamp || new Date(Date.now() - 48 * 3600 * 1000).toISOString();
        const sinceTime = new Date(sinceTimestamp).getTime();
        const reqDeviceId = packet.originDeviceId || 'unknown';
        const reqComp = (packet.companyId || packet.company_id || 'COMP-001').trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || 'BR-MAIN').trim().toUpperCase();

        const missedSales = salesStore.filter((s) => isMatch(s, reqComp, reqBranch) && getTimestamp(s) >= sinceTime);
        const missedDirectGrvs = directGrvsStore.filter((g) => isMatch(g, reqComp, reqBranch) && getTimestamp(g) >= sinceTime);
        const missedInventory = inventoryStore.filter((i) => isMatch(i, reqComp, reqBranch) && getTimestamp(i) >= sinceTime);
        const missedCashLogs = cashLogsStore.filter((c) => isMatch(c, reqComp, reqBranch) && getTimestamp(c) >= sinceTime);
        const missedCashLifts = cashLiftsStore.filter((l) => isMatch(l, reqComp, reqBranch) && getTimestamp(l) >= sinceTime);
        const missedCashMovements = cashMovementsStore.filter((m) => isMatch(m, reqComp, reqBranch) && getTimestamp(m) >= sinceTime);
        const missedCustomerChanges = customerChangesStore.filter((ch) => isMatch(ch, reqComp, reqBranch) && getTimestamp(ch) >= sinceTime);
        const missedCreditSales = creditSalesStore.filter((cs) => isMatch(cs, reqComp, reqBranch) && getTimestamp(cs) >= sinceTime);
        const missedStockMovements = stockMovementsStore.filter((sm) => isMatch(sm, reqComp, reqBranch) && getTimestamp(sm) >= sinceTime);
        const missedExpenses = expensesStore.filter((ex) => isMatch(ex, reqComp, reqBranch) && getTimestamp(ex) >= sinceTime);
        const missedCashTransfers = cashTransfersStore.filter((tr) => isMatch(tr, reqComp, reqBranch) && getTimestamp(tr) >= sinceTime);
        const missedSalespeople = salespeopleStore.filter((s) => isMatch(s, reqComp, reqBranch));
        const missedCustomers = customersStore.filter((c) => isMatch(c, reqComp, reqBranch));

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
          },
        };

        try {
          ws.send(JSON.stringify(catchupResponse));
          console.log(
            `[Termux Hub] Replayed catch-up to ${reqDeviceId}: ${missedSales.length} sales, ${missedDirectGrvs.length} GRVs, ${missedSalespeople.length} staff, ${missedCustomers.length} customers, ${casualWorkersStore.length} casuals.`
          );
        } catch (e) {
          console.warn('[Termux Hub] Failed to send catchup response:', e.message);
        }
        return;
      }

      // =====================================================================
      // 11. STRICT SENDER EXCLUSION BROADCAST (ANTI-ECHO)
      // =====================================================================
      // Forward real sales and non-blind mutations to all other connected devices
      let forwardedCount = 0;
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try {
            client.send(dataStr);
            forwardedCount++;
          } catch (e) {}
        }
      });
      if (forwardedCount > 0 && isSale) {
        console.log(`[Termux Hub] Forwarded Sale #${saleId} to ${forwardedCount} peer till(s).`);
      }
    } catch (parseErr) {
      console.warn('[Termux Hub] Error processing message:', parseErr.message);
    }
  });

  ws.on('close', () => {
    console.log(`[Termux Hub] Client disconnected. Total active clients: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.warn('[Termux Hub] Socket error:', err.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` Saimetric Local Hub v3.2 running on ws://0.0.0.0:${PORT}`);
  console.log(` Portable Hotspot Default IP: ws://192.168.43.1:${PORT}`);
  console.log(` CommonJS Native Syntax: READY FOR TERMUX NODE.JS`);
  console.log(` Blind Double-Count Stocktake Vault: ACTIVATED`);
  console.log(`====================================================`);
});
