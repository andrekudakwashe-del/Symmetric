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

// High-Water Mark for Edge-to-Cloud Hub-to-Supabase Sync
let lastCloudSyncTimestamp = 0;

/**
 * Edge Gateway Cloud Bridge:
 * Forwards accepted master records (Staff, Customers) to cloud endpoint in background.
 * Fire-and-forget with error catching so offline hubs never crash or block.
 */
function pushToCloud(entityType, record) {
  if (!cloudSyncUrl || !record) return;
  try {
    const isT1 = entityType === 'SALE' || entityType === 'GRV' || entityType === 'CASH_LOG' || entityType === 'EXPENSE';
    const postData = JSON.stringify({
      action: entityType === 'STAFF' ? 'sync_staff_member' : (entityType === 'CUSTOMER' ? 'sync_customer' : (entityType === 'SALE' ? 'sync_sale' : 'sync_entity')),
      company_id: hubTenantId,
      branch_id: hubBranchId,
      entityType,
      record,
      payload: record,
      timestamp: Date.now(),
    });

    const markCloudSyncedAndAck = () => {
      record.isCloudSynced = true;
      scheduleSave();
      if (isT1) {
        const ackStr = JSON.stringify({
          type: 'T1_CLOUD_SYNC_ACK',
          action: 'T1_CLOUD_SYNC_ACK',
          entityType,
          id: record.id || record.invoice_id || record.grvNumber,
          isCloudSynced: true,
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

    if (typeof fetch === 'function') {
      fetch(cloudSyncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: postData,
      }).then((res) => {
        if (!res.ok) {
          console.log(`[Edge Gateway] Cloud bridge HTTP ${res.status} for ${entityType}`);
        } else {
          console.log(`[Edge Gateway] ☁️ Pushed ${entityType} (${record.id || record.customerId || record.name}) to Cloud Bridge`);
          markCloudSyncedAndAck();
        }
      }).catch((err) => {
        console.log(`[Edge Gateway] Cloud bridge notice for ${entityType}: ${err.message}`);
      });
    } else {
      const isHttps = cloudSyncUrl.startsWith('https:');
      const client = isHttps ? require('https') : require('http');
      const url = new URL(cloudSyncUrl);
      const req = client.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        console.log(`[Edge Gateway] ☁️ Pushed ${entityType} to Cloud Bridge (${res.statusCode})`);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          markCloudSyncedAndAck();
        }
      });
      req.on('error', (e) => {
        console.log(`[Edge Gateway] Cloud bridge network notice for ${entityType}: ${e.message}`);
      });
      req.write(postData);
      req.end();
    }
  } catch (err) {
    console.log(`[Edge Gateway] Cloud push notice: ${err.message}`);
  }
}

/**
 * Broadcasts an authoritative T2 Inventory Snapshot to all connected peers
 */
function broadcastInventorySnapshot(item) {
  if (!item) return;
  const snapTime = Date.now();
  item.snapshotTimestamp = snapTime;
  item.updatedAt = snapTime;
  item.hubTimestamp = snapTime;
  item.lastUpdated = new Date(snapTime).toISOString();
  scheduleSave();

  const pktStr = JSON.stringify({
    type: 'INVENTORY_UPDATE',
    action: 'INVENTORY_UPDATE',
    entityType: 'INVENTORY',
    itemId: item.itemId || item.id,
    item: {
      ...item,
      totalUnits: Number(item.totalUnits || 0),
      stockSingles: Number(item.stockSingles !== undefined ? item.stockSingles : item.totalUnits || 0),
      snapshotTimestamp: snapTime,
    },
    payload: {
      ...item,
      totalUnits: Number(item.totalUnits || 0),
      stockSingles: Number(item.stockSingles !== undefined ? item.stockSingles : item.totalUnits || 0),
      snapshotTimestamp: snapTime,
    },
    snapshotTimestamp: snapTime,
    totalUnits: Number(item.totalUnits || 0),
    stockSingles: Number(item.stockSingles !== undefined ? item.stockSingles : item.totalUnits || 0),
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

// Staff & Customer Master Stores (Synced across multi-device Wi-Fi)
let salespeopleStore = [];
let customersStore = [];
let branchesStore = [];
let cashAccountsStore = [];
let permissionsMatrixStore = { rules: [], updatedAt: 0 };
let roleConfigsStore = { definitions: null, updatedAt: 0 };

// Tombstones Store (Soft Deletes across multi-device Wi-Fi)
let tombstonesStore = [];

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
  const bId = rec.branchId || rec.id || rec.branch_id;
  return Boolean(bId);
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
// Safe Pruning: ONLY delete records older than ROTATION_DAYS AND isCloudSynced === true!
function pruneOldRecords() {
  const cutoffTime = Date.now() - (ROTATION_DAYS * 24 * 60 * 60 * 1000);
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
  suppliersStore = suppliersStore.filter(shouldRetain);
  adminSalesStore = adminSalesStore.filter(shouldRetain);
  cashCountsStore = cashCountsStore.filter(shouldRetain);
  vouchersStore = vouchersStore.filter(shouldRetain);
  businessDayClosuresStore = businessDayClosuresStore.filter(shouldRetain);
  electronicSettlementsStore = electronicSettlementsStore.filter(shouldRetain);
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
      if (parsed.lastCloudSyncTimestamp) lastCloudSyncTimestamp = Number(parsed.lastCloudSyncTimestamp) || 0;
      if (Array.isArray(parsed.sales)) salesStore = parsed.sales;
      if (Array.isArray(parsed.inventory)) inventoryStore = parsed.inventory;
      if (Array.isArray(parsed.directGrvs)) directGrvsStore = parsed.directGrvs;
      if (Array.isArray(parsed.cashMovements)) cashMovementsStore = parsed.cashMovements;
      if (Array.isArray(parsed.cashLifts)) cashLiftsStore = parsed.cashLifts;
      if (Array.isArray(parsed.cashLogs)) cashLogsStore = parsed.cashLogs;
      if (Array.isArray(parsed.customerChanges)) customerChangesStore = parsed.customerChanges;
      if (Array.isArray(parsed.creditSales)) creditSalesStore = parsed.creditSales;
      if (Array.isArray(parsed.creditGroups)) creditGroupsStore = parsed.creditGroups;
      if (Array.isArray(parsed.stockMovements)) stockMovementsStore = parsed.stockMovements;
      if (Array.isArray(parsed.expenses)) expensesStore = parsed.expenses;
      if (Array.isArray(parsed.cashTransfers)) cashTransfersStore = parsed.cashTransfers;
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
        branchesStore = parsed.branches.filter((b) => {
          const valid = isValidBranchRecord(b);
          if (!valid) {
            console.warn(`[Termux Hub] 🧹 Purged contaminated non-branch record from Hub memory/disk: ${b.name || b.branchName || b.branchId || b.id}`);
          }
          return valid;
        });
      }
      if (Array.isArray(parsed.cashAccounts)) cashAccountsStore = parsed.cashAccounts;
      if (Array.isArray(parsed.businessDayClosures)) businessDayClosuresStore = parsed.businessDayClosures;
      if (Array.isArray(parsed.electronicSettlements)) electronicSettlementsStore = parsed.electronicSettlements;
      if (parsed.branchLockdowns && typeof parsed.branchLockdowns === 'object') {
        branchLockdownsStore = parsed.branchLockdowns;
      }
      if (Array.isArray(parsed.stocktakeSessions)) stocktakeSessionsStore = parsed.stocktakeSessions;
      if (Array.isArray(parsed.stocktakeSegments)) stocktakeSegmentsStore = parsed.stocktakeSegments;
      if (Array.isArray(parsed.tombstones)) tombstonesStore = parsed.tombstones;
      if (parsed.permissionsMatrix && Array.isArray(parsed.permissionsMatrix.rules)) {
        permissionsMatrixStore = {
          rules: parsed.permissionsMatrix.rules,
          updatedAt: Number(parsed.permissionsMatrix.updatedAt) || 0,
        };
      }
      if (parsed.roleConfigs && parsed.roleConfigs.definitions && typeof parsed.roleConfigs.definitions === 'object') {
        roleConfigsStore = {
          definitions: parsed.roleConfigs.definitions,
          updatedAt: Number(parsed.roleConfigs.updatedAt) || 0,
        };
      }

      console.log(
        `[Termux Hub] Loaded from disk: [Branch: ${hubBranchId} - ${hubBranchName}], ${salesStore.length} sales, ${directGrvsStore.length} direct GRVs, ${inventoryStore.length} items, ${salespeopleStore.length} staff, ${customersStore.length} customers, ${branchesStore.length} branches, ${cashAccountsStore.length} cash accounts, ${suppliersStore.length} suppliers, ${adminSalesStore.length} admin sales, ${cashCountsStore.length} cash counts, ${vouchersStore.length} vouchers, ${businessDayClosuresStore.length} closures, ${electronicSettlementsStore.length} settlements, ${categoriesStore.length} categories, ${tombstonesStore.length} tombstones.`
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
      lastCloudSyncTimestamp,
      sales: salesStore.slice(0, 5000),
      inventory: inventoryStore,
      directGrvs: directGrvsStore.slice(0, 1000),
      cashMovements: cashMovementsStore.slice(0, 2000),
      cashLifts: cashLiftsStore.slice(0, 1000),
      cashLogs: cashLogsStore.slice(0, 2000),
      customerChanges: customerChangesStore.slice(0, 2000),
      creditSales: creditSalesStore.slice(0, 2000),
      creditGroups: creditGroupsStore,
      stockMovements: stockMovementsStore.slice(0, 2000),
      expenses: expensesStore.slice(0, 1000),
      cashTransfers: cashTransfersStore.slice(0, 1000),
      suppliers: suppliersStore.slice(0, 2000),
      adminSales: adminSalesStore.slice(0, 2000),
      cashCounts: cashCountsStore.slice(0, 2000),
      vouchers: vouchersStore.slice(0, 2000),
      categories: categoriesStore,
      casualWorkers: casualWorkersStore.slice(0, 500),
      zoneAssignments: zoneAssignmentsStore.slice(0, 500),
      salespeople: salespeopleStore.slice(0, 1000),
      customers: customersStore.slice(0, 3000),
      branches: branchesStore.slice(0, 100),
      cashAccounts: cashAccountsStore.slice(0, 500),
      businessDayClosures: businessDayClosuresStore.slice(0, 365),
      electronicSettlements: electronicSettlementsStore.slice(0, 365),
      branchLockdowns: branchLockdownsStore,
      stocktakeSessions: stocktakeSessionsStore.slice(0, 500),
      stocktakeSegments: stocktakeSegmentsStore.slice(0, 2000),
      tombstones: tombstonesStore.slice(0, 5000),
      permissionsMatrix: permissionsMatrixStore,
      roleConfigs: roleConfigsStore,
      savedAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(payload, null, 2);
    const byteSize = Buffer.byteLength(serialized, 'utf8');
    if (byteSize > MAX_STORAGE_BYTES) {
      // 2GB Guard: Check if unsynced records exist. NEVER delete unsynced records to save space!
      const hasUnsynced =
        salesStore.some((s) => s.isCloudSynced !== true) ||
        directGrvsStore.some((g) => g.isCloudSynced !== true) ||
        expensesStore.some((e) => e.isCloudSynced !== true);
      if (hasUnsynced) {
        console.error(`[Termux Hub] ❌ CRITICAL: Hub storage (${(byteSize / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds 2GB limit, but unsynced transactions are present. Cannot prune unsynced records!`);
        throw new Error('Termux Hub storage capacity reached (2GB) with un-synced cloud transactions. Please restore cloud connectivity.');
      } else {
        console.warn(`[Termux Hub] Warning: Hub data exceeds 2GB limit. Trimming already-synced oldest records...`);
        salesStore = salesStore.filter((s) => s.isCloudSynced !== true).concat(salesStore.filter((s) => s.isCloudSynced === true).slice(0, 2500));
        directGrvsStore = directGrvsStore.filter((g) => g.isCloudSynced !== true).concat(directGrvsStore.filter((g) => g.isCloudSynced === true).slice(0, 500));
      }
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
        version: '3.4.0',
        branchId: hubBranchId,
        branchName: hubBranchName,
        tenantId: hubTenantId,
        salesCount: salesStore.length,
        directGrvsCount: directGrvsStore.length,
        inventoryCount: inventoryStore.length,
        staffCount: salespeopleStore.length,
        customerCount: customersStore.length,
        branchesCount: branchesStore.length,
        cashAccountsCount: cashAccountsStore.length,
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
        version: '3.4.0',
        totalRecords: salesStore.length + directGrvsStore.length,
        casualWorkersCount: casualWorkersStore.length,
        branchesCount: branchesStore.length,
        cashAccountsCount: cashAccountsStore.length,
        timestamp: Date.now(),
      })
    );
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

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
    default:
      return [];
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
    default:
      return rec.id;
  }
}

function getRecordTimestamp(rec) {
  if (!rec) return 0;
  const val = rec.updatedAt || rec.lastUpdated || rec.hubTimestamp || rec.timestamp || rec.date || rec.createdAt;
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
      return Number(rec.amount || rec.out) || 0;
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
    default:
      return 0;
  }
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

  const isT2 = norm === 'inventory' || norm === 'inventory_item' || norm === 'products' ||
               norm === 'customers' || norm === 'customer' ||
               norm === 'staff' || norm === 'salespeople' || norm === 'users';

  const store = getStoreByEntityType(norm);
  const missingOrOutdated = [];

  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    const cleanId = String(id).trim();
    const hubRecTime = getRecordTimestamp(rec);

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
    }
  }

  return missingOrOutdated;
}

function computeClientMissingOnHub(clientDigest, entityType) {
  if (!clientDigest || !Array.isArray(clientDigest.items)) {
    return [];
  }
  const norm = String(entityType || clientDigest.entityType || '').toLowerCase().trim();
  const isT2 = norm === 'inventory' || norm === 'inventory_item' || norm === 'products' ||
               norm === 'customers' || norm === 'customer' ||
               norm === 'staff' || norm === 'salespeople' || norm === 'users';

  const store = getStoreByEntityType(norm);
  const hubMap = new Map();
  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    hubMap.set(String(id).trim(), rec);
  }

  const missingOnHubIds = [];
  for (const item of clientDigest.items) {
    if (!item || item.id == null) continue;
    const cleanId = String(item.id).trim();
    const hubRec = hubMap.get(cleanId);
    if (!hubRec) {
      missingOnHubIds.push(cleanId);
    } else if (isT2) {
      const hubUpdated = getRecordTimestamp(hubRec);
      const clientUpdated = item.updatedAt || item.timestamp || 0;
      if (clientUpdated - hubUpdated > 60000) {
        missingOnHubIds.push(cleanId);
      }
    }
  }
  return missingOnHubIds;
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
  const triggerPacket = {
    type: 'RECON_SWEEP_TRIGGER',
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
      'staff',
    ],
    isSod: Boolean(isSod),
    useSnapshotFirst: true,
    hubTimestamp: Date.now(),
    originDeviceId: `HUB-${hubBranchId}`,
  };
  try {
    clientWs.send(JSON.stringify(triggerPacket));
    console.log(`[Termux Hub] 🧹 Sent RECON_SWEEP_TRIGGER (${sweepId}${isSod ? ' [SOD Start of Day]' : ''}) to POS terminal`);
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

wss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  console.log(`[Termux Hub] 🟢 POS Terminal connected from ${remoteIp}`);

  let terminalDeviceId = null;

  // Send immediate greeting with branch identity
  try {
    const greeting = {
      type: 'HUB_GREETING',
      action: 'HUB_INFO',
      hub_id: `HUB-${hubBranchId}`,
      branch_id: hubBranchId,
      branch_name: hubBranchName,
      tenant_id: hubTenantId,
      version: '3.7.0',
      totalSales: salesStore.length,
      totalInventory: inventoryStore.length,
      lastCloudSyncTimestamp,
      message: `Connected to Saimetric Local Hub (${hubBranchName})`,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(greeting));
  } catch (e) {}

  // 3.5s delayed automatic background reconciliation sweep trigger upon connection
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
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
                hubTimestamp: Date.now(),
                originDeviceId: `HUB-${hubBranchId}`,
              }));
            } catch (err) {
              console.warn('[Termux Hub] Failed to send RECON_PUSH_BACKFILL_REQUEST:', err.message);
            }
          }

          if (missingOrOutdated.length === 0 && clientMissingOnHub.length === 0) {
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
          : ['sales', 'customer_changes', 'credit_sales', 'cash_logs', 'stock_movements', 'direct_grvs', 'expenses', 'inventory', 'customers', 'staff'];
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
          hub_id: `HUB-${hubBranchId}`,
          version: '3.4.0',
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
        creditGroupsStore = [];
        stockMovementsStore = [];
        expensesStore = [];
        cashTransfersStore = [];
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
            version: '3.4.0',
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
      // 0.45 STOCKTAKE SESSION & SEGMENT DISCOVERY (STRICT LWW)
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
          const hubIso = new Date().toISOString();
          const sIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          const incomingTime = getTimestamp(sess) || getTimestamp(packet);

          if (sIdx >= 0) {
            const existing = stocktakeSessionsStore[sIdx];
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

          const sessionObj = {
            ...sess,
            sessionId,
            title: packet.sessionName || packet.title || sess.title || `Session ${sessionId}`,
            sessionName: packet.sessionName || packet.title || sess.title || `Session ${sessionId}`,
            segments: Array.isArray(packet.segments) ? packet.segments : (sess.segments || []),
            startedBy: packet.startedBy || sess.startedBy || 'Manager',
            startedAt: packet.startedAt || sess.startedAt || hubIso,
            countType: packet.countType || sess.countType || 'DAILY_BLIND',
            branchId: packet.branchId || sess.branchId || hubBranchId,
            branchName: packet.branchName || sess.branchName || hubBranchName,
            isLockdownActive: Boolean(packet.isLockdownActive || sess.isLockdownActive),
            notes: packet.notes || sess.notes || '',
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
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
            `[Termux Hub] 📋 Synced Stocktake Session [${sessionId}] "${sessionObj.sessionName}" with ${(sessionObj.segments || []).length} segments stamped at ${hubIso}.`
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

          // Broadcast to all other peers
          const sessBroadcastStr = JSON.stringify({
            type: 'STOCKTAKE_SESSION_STARTED',
            action: 'STOCKTAKE_SESSION_STARTED',
            sessionId,
            session: sessionObj,
            payload: sessionObj,
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
          ws.send(
            JSON.stringify({
              type: 'STOCKTAKE_SESSION_LIST',
              action: 'STOCKTAKE_SESSION_LIST',
              sessions: stocktakeSessionsStore,
              segments: stocktakeSegmentsStore,
              zoneAssignments: zoneAssignmentsStore,
              timestamp: Date.now(),
            })
          );
          console.log(
            `[Termux Hub] 📋 Replied to STOCKTAKE_SESSION_LIST_REQUEST with ${stocktakeSessionsStore.length} session(s), ${stocktakeSegmentsStore.length} segment(s), and ${zoneAssignmentsStore.length} zone assignments.`
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
            zoneRec.teamA = { deviceId, staffId, staffName, claimedAt: new Date().toISOString(), submitted: true };
          }
          zoneRec.teamA.submitted = true;
          zoneRec.teamA.submittedAt = new Date().toISOString();
          zoneRec.teamA.lineCount = Array.isArray(lines) ? lines.length : 0;
          if (!zoneRec.teamB?.submitted) zoneRec.status = 'AWAITING_DOUBLE_COUNT';
        } else if (slot === 'B') {
          if (!zoneRec.teamB) {
            zoneRec.teamB = { deviceId, staffId, staffName, claimedAt: new Date().toISOString(), submitted: true };
          }
          zoneRec.teamB.submitted = true;
          zoneRec.teamB.submittedAt = new Date().toISOString();
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
                seg.counterAId = staffId;
                seg.counterAName = staffName;
                if (!seg.count2Submitted) seg.status = 'AWAITING_DOUBLE_COUNT';
              } else if (slot === 'B') {
                seg.hasCountB = true;
                seg.count2Submitted = true;
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
          staffId,
          staffName,
          teamAStaffName: hubBlindStore[sessionId][zoneId].A?.staffName,
          teamBStaffName: hubBlindStore[sessionId][zoneId].B?.staffName,
          hasCountA: Boolean(hubBlindStore[sessionId][zoneId].A),
          hasCountB: Boolean(hubBlindStore[sessionId][zoneId].B),
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
            console.log(`[Termux Hub] ✅ Zone ${zoneId} DOUBLE-COUNT MATCHED 100% (${verifiedCounts.length} lines verified).`);
            if (zoneRec) {
              zoneRec.status = 'VERIFIED';
              zoneRec.verifiedCounts = verifiedCounts;
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
                }
              }
            }
            scheduleSave();

            const verifiedPacket = {
              type: 'STOCKTAKE_MATCH_VERIFIED',
              sessionId,
              zoneId,
              status: 'VERIFIED',
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
            console.log(`[Termux Hub] ⚠️ Zone ${zoneId} DISCREPANCY: ${discrepancies.length} variance item(s). Alerting Teams A & B.`);
            if (zoneRec) {
              zoneRec.status = 'VARIANCE_FLAGGED';
              zoneRec.discrepancies = discrepancies;
            }
            if (sessIdx >= 0) {
              const sess = stocktakeSessionsStore[sessIdx];
              if (Array.isArray(sess.segments)) {
                const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
                if (seg) {
                  seg.status = 'DISCREPANCY_RECOUNT';
                  seg.discrepancies = discrepancies;
                  seg.discrepancyCount = discrepancies.length;
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
        const existingTime = existingZone?.jointRecount?.resolvedAt ? getTimestamp({ updatedAt: existingZone.jointRecount.resolvedAt }) : (existingZone ? getTimestamp(existingZone) : 0);
        if (existingTime > 0 && incomingTime > 0 && existingTime > (incomingTime + 60000)) {
          console.log(`[Termux Hub] 🛡️ LWW Reject: Stale STOCKTAKE_JOINT_FINALIZED for Zone ${packet.zoneId}`);
          return;
        }

        const sessionId = packet.sessionId;
        const zoneId = packet.zoneId;
        const resolvedLines = packet.resolvedLines || packet.lines || [];
        const staffName = packet.resolvedByName || packet.staffName || 'Dual Counters';

        console.log(`[Termux Hub] 🏆 Zone ${zoneId} JOINT RECOUNT FINALIZED & VERIFIED by ${staffName} (${resolvedLines.length} lines).`);

        let zoneRec = zoneAssignmentsStore.find((z) => z.zoneId === zoneId && (!sessionId || z.sessionId === sessionId));
        if (zoneRec) {
          zoneRec.status = 'VERIFIED';
          zoneRec.verifiedCounts = resolvedLines;
          if (!zoneRec.jointRecount) zoneRec.jointRecount = {};
          zoneRec.jointRecount.signedByA = true;
          zoneRec.jointRecount.signedByB = true;
          zoneRec.jointRecount.resolvedAt = Date.now();
          zoneRec.jointRecount.resolvedByName = staffName;
          zoneRec.jointRecount.lines = resolvedLines;
        }

        const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        if (sessIdx >= 0) {
          const sess = stocktakeSessionsStore[sessIdx];
          if (Array.isArray(sess.segments)) {
            const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
            if (seg) {
              seg.status = 'VERIFIED';
              seg.verifiedCounts = resolvedLines;
              seg.discrepancies = [];
              seg.discrepancyCount = 0;
            }
          }
        }

        const segIdx = stocktakeSegmentsStore.findIndex((sg) => (sg.segmentId || sg.id) === zoneId);
        if (segIdx >= 0) {
          stocktakeSegmentsStore[segIdx].status = 'VERIFIED';
          stocktakeSegmentsStore[segIdx].verifiedCounts = resolvedLines;
          stocktakeSegmentsStore[segIdx].discrepancies = [];
          stocktakeSegmentsStore[segIdx].discrepancyCount = 0;
        }

        scheduleSave();

        // Broadcast verification & status updates to all peers
        const verifiedPacket = {
          type: 'STOCKTAKE_MATCH_VERIFIED',
          sessionId,
          zoneId,
          status: 'VERIFIED',
          verifiedCounts: resolvedLines,
          resolvedByName: staffName,
          source: 'JOINT_RECOUNT',
          timestamp: Date.now(),
        };

        const statusPacket = {
          type: 'STOCKTAKE_ZONE_STATUS_UPDATE',
          sessionId,
          zoneId,
          status: 'VERIFIED',
          verifiedCounts: resolvedLines,
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
                const cur = Number(inventoryStore[retIdx].totalUnits || 0);
                const retUnits = Number((cur + Number(ex.returnedItem.quantity || 1)).toFixed(3));
                inventoryStore[retIdx].totalUnits = retUnits;
                inventoryStore[retIdx].stockSingles = retUnits;
                broadcastInventorySnapshot(inventoryStore[retIdx]);
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
                broadcastInventorySnapshot(inventoryStore[invIdx]);
              } else {
                const newInvRecord = {
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
      const isCustomerChangePacket =
        pType === 'CUSTOMER_CHANGE' ||
        pType === 'CUSTOMER_CHANGE_SYNC' ||
        pType === 'customer_change' ||
        sheetName === 'CustomerChange' ||
        packet.entityType === 'customer_change';
      const changeId = payload ? (payload.changeId || payload.id) : null;

      if (isCustomerChangePacket && payload && changeId) {
        const normChange = { ...payload, id: changeId, changeId };
        const exIdx = customerChangesStore.findIndex((c) => c.changeId === changeId || c.id === changeId);
        if (exIdx >= 0) {
          customerChangesStore[exIdx] = { ...customerChangesStore[exIdx], ...normChange };
        } else {
          customerChangesStore.unshift(normChange);
          console.log(`[Termux Hub] 📥 Accepted Customer Change [${changeId}] (Append-Only)`);
        }
        scheduleSave();
      }

      const isCreditSalePacket =
        pType === 'CREDIT_SALE' ||
        pType === 'CREDIT_SALE_SYNC' ||
        pType === 'credit_sale' ||
        sheetName === 'CreditSales' ||
        packet.entityType === 'credit_sale';
      const creditId = payload ? (payload.creditId || payload.id) : null;

      if (isCreditSalePacket && payload && creditId) {
        const normCredit = { ...payload, id: creditId, creditId };
        const exIdx = creditSalesStore.findIndex((c) => c.creditId === creditId || c.id === creditId);
        if (exIdx >= 0) {
          creditSalesStore[exIdx] = { ...creditSalesStore[exIdx], ...normCredit };
        } else {
          creditSalesStore.unshift(normCredit);
          console.log(`[Termux Hub] 📥 Accepted Credit Sale [${creditId}] (Append-Only)`);
        }
        scheduleSave();
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
        const exIdx = creditGroupsStore.findIndex((g) => g.id === groupId || g.groupId === groupId);
        const incomingTime = getTimestamp(payload) || Date.now();
        if (exIdx >= 0) {
          const existingTime = getTimestamp(creditGroupsStore[exIdx]) || 0;
          if (incomingTime >= existingTime - 60000) {
            creditGroupsStore[exIdx] = { ...creditGroupsStore[exIdx], ...payload, id: groupId };
            console.log(`[Termux Hub] 🔄 Updated Credit Group [${groupId}] via LWW`);
          }
        } else {
          creditGroupsStore.push({ ...payload, id: groupId });
          console.log(`[Termux Hub] 📥 Added new Credit Group [${groupId}]`);
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
        if (sId) {
          const exIdx = suppliersStore.findIndex((s) => (s.supplierId || s.id || s.SupplierID) === sId);
          if (exIdx >= 0) {
            suppliersStore[exIdx] = { ...suppliersStore[exIdx], ...suppObj, supplierId: sId };
          } else {
            suppliersStore.unshift({ ...suppObj, supplierId: sId });
            console.log(`[Termux Hub] 📥 Accepted Supplier [${sId}] (Append-Only)`);
          }
          scheduleSave();
        }
      }

      const isAdminSale = pType === 'ADMIN_SALES' || pType === 'ADMIN_SALES_SYNC' || pType === 'admin_sales' || sheetName === 'AdminSales';
      if (isAdminSale && payload) {
        const asId = payload.id || `AS-${payload.date}-${payload.staffId}`;
        if (asId) {
          const exIdx = adminSalesStore.findIndex((a) => a.id === asId);
          if (exIdx >= 0) {
            adminSalesStore[exIdx] = { ...adminSalesStore[exIdx], ...payload, id: asId };
          } else {
            adminSalesStore.unshift({ ...payload, id: asId });
            console.log(`[Termux Hub] 📥 Accepted Admin Sale [${asId}] (Append-Only)`);
          }
          scheduleSave();
        }
      }

      const isCashCount = pType === 'CASH_COUNT' || pType === 'CASH_COUNT_SYNC' || pType === 'cash_count' || sheetName === 'CashCounts';
      if (isCashCount && payload) {
        const ccId = payload.id;
        if (ccId) {
          const exIdx = cashCountsStore.findIndex((c) => c.id === ccId);
          if (exIdx >= 0) {
            cashCountsStore[exIdx] = { ...cashCountsStore[exIdx], ...payload, id: ccId };
          } else {
            cashCountsStore.unshift({ ...payload, id: ccId });
            console.log(`[Termux Hub] 📥 Accepted Cash Count [${ccId}] (Append-Only)`);
          }
          scheduleSave();
        }
      }

      const isVoucher = pType === 'VOUCHER' || pType === 'VOUCHER_SYNC' || pType === 'voucher' || pType === 'supplier_invoice' || sheetName === 'SupplierInvoices' || sheetName === 'Vouchers';
      if (isVoucher && payload) {
        const vId = payload.voucherId || payload.id;
        if (vId) {
          const exIdx = vouchersStore.findIndex((v) => (v.voucherId || v.id) === vId);
          if (exIdx >= 0) {
            vouchersStore[exIdx] = { ...vouchersStore[exIdx], ...payload, voucherId: vId };
          } else {
            vouchersStore.unshift({ ...payload, voucherId: vId });
            console.log(`[Termux Hub] 📥 Accepted Voucher [${vId}] (Append-Only)`);
          }
          scheduleSave();
        }
      }

      // =====================================================================
      // 9.06 TRANSACTIONAL DATA: BUSINESS DAY CLOSURES & SETTLEMENTS (T1 APPEND-ONLY)
      // =====================================================================
      const isClosure = pType === 'CLOSURE_SYNC' || pType === 'CLOSURE' || pType === 'closure' || pType === 'EOD' || sheetName === 'BusinessDayClosures' || sheetName === 'Closures';
      if (isClosure && payload) {
        const cId = payload.id || `EOD-${payload.date}-${payload.branchId || 'BR-MAIN'}`;
        if (cId) {
          const exIdx = businessDayClosuresStore.findIndex((c) => c.id === cId || (c.date === payload.date && c.branchId === payload.branchId));
          if (exIdx >= 0) {
            businessDayClosuresStore[exIdx] = { ...businessDayClosuresStore[exIdx], ...payload, id: cId };
          } else {
            businessDayClosuresStore.unshift({ ...payload, id: cId });
            console.log(`[Termux Hub] 📥 Accepted Closure [${cId}] (Append-Only)`);
          }
          scheduleSave();
        }
      }

      const isSettlement = pType === 'SETTLEMENT_SYNC' || pType === 'SETTLEMENT' || pType === 'settlement' || sheetName === 'ElectronicSettlements' || sheetName === 'Settlements';
      if (isSettlement && payload) {
        const sId = payload.id || `SETTLE-${payload.date}-${payload.branchId || 'BR-MAIN'}`;
        if (sId) {
          const exIdx = electronicSettlementsStore.findIndex((s) => s.id === sId || (s.date === payload.date && s.branchId === payload.branchId));
          if (exIdx >= 0) {
            electronicSettlementsStore[exIdx] = { ...electronicSettlementsStore[exIdx], ...payload, id: sId };
          } else {
            electronicSettlementsStore.unshift({ ...payload, id: sId });
            console.log(`[Termux Hub] 📥 Accepted Electronic Settlement [${sId}] (Append-Only)`);
          }
          scheduleSave();
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
            categoriesStore = rawCats;
            console.log(`[Termux Hub] 📥 Accepted Categories update (${rawCats.length} categories, LWW Accepted)`);
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
      const isStaff =
        pType === 'STAFF' ||
        pType === 'STAFF_SYNC' ||
        pType === 'STAFF_RECORD' ||
        pType === 'STAFF_PERMISSION' ||
        pType === 'STAFF_PERMISSION_RECORD' ||
        sheetName === 'Salespeople' ||
        sheetName === 'users' ||
        !!staffObj;
      if (isStaff && staffObj && staffObj.id) {
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();
        if (Array.isArray(staffObj.branchAssignments) && staffObj.branchAssignments.length > 0) {
          staffObj.assignedBranchIds = staffObj.branchAssignments.map((a) => a.branchId).filter(Boolean);
        } else if (staffObj.branchId && !Array.isArray(staffObj.assignedBranchIds)) {
          staffObj.assignedBranchIds = [staffObj.branchId];
        }
        const sIdx = salespeopleStore.findIndex((s) => s.id === staffObj.id);
        const incomingTime = getTimestamp(staffObj);
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
          staffObj.updatedAt = hubNow;
          staffObj.hubTimestamp = hubNow;
          staffObj.lastUpdated = hubIso;

          let mergedStaff = staffObj;
          if (sIdx >= 0) {
            mergedStaff = { ...salespeopleStore[sIdx], ...staffObj };
            delete mergedStaff.pin;
            salespeopleStore[sIdx] = mergedStaff;
          } else {
            salespeopleStore.unshift(mergedStaff);
          }
          scheduleSave();
          console.log(`[Termux Hub] 👤 Synced Staff account securely: ${mergedStaff.name} (${mergedStaff.id} - ${mergedStaff.role}) stamped at ${hubIso}`);

          // Send SYNC_ACK
          try {
            ws.send(JSON.stringify({
              type: 'SYNC_ACK',
              action: 'SYNC_ACK',
              entityType: 'STAFF',
              id: mergedStaff.id,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
            }));
          } catch (e) {}

          // Broadcast merged staff record to other peers
          const staffBroadcastStr = JSON.stringify({
            type: 'STAFF',
            action: 'STAFF_SYNC',
            staff: mergedStaff,
            payload: mergedStaff,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            origin_device_id: packet.origin_device_id || packet.originDeviceId || 'LOCAL_HUB',
            origin_device_name: packet.origin_device_name || packet.originDeviceName || 'Termux Local Hub',
            timestamp: hubNow,
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try { client.send(staffBroadcastStr); } catch (e) {}
            }
          });

          // Edge Gateway: Background HTTP push to Cloud Bridge (App Scripts / Supabase)
          pushToCloud('STAFF', mergedStaff);
        }
        return;
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
            permissionsMatrixStore = { rules: incomingRules, updatedAt: hubNow };
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
            roleConfigsStore = { definitions: incomingDefs, updatedAt: hubNow };
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
          }
        }
        return;
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
          custObj.updatedAt = hubNow;
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

          // Edge Gateway: Background HTTP push to Cloud Bridge (App Scripts / Supabase)
          pushToCloud('CUSTOMER', custObj);
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

      if (isBranch && rawBranchObj && (rawBranchObj.branchId || rawBranchObj.id || rawBranchObj.branch_id)) {
        const bId = rawBranchObj.branchId || rawBranchObj.id || rawBranchObj.branch_id;
        const hubNow = Date.now();
        const hubIso = new Date().toISOString();
        const bIdx = branchesStore.findIndex((b) => (b.branchId || b.id || b.branch_id) === bId);
        const incomingTime = getTimestamp(rawBranchObj);
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
          const stamped = {
            ...rawBranchObj,
            branchId: bId,
            id: bId,
            branch_id: bId,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
          };

          if (bIdx >= 0) {
            branchesStore[bIdx] = { ...branchesStore[bIdx], ...stamped };
          } else {
            branchesStore.unshift(stamped);
          }
          scheduleSave();
          console.log(`[Termux Hub] 🏢 Synced Branch: ${stamped.branchName || bId} (${bId}) stamped at ${hubIso}`);

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
        const aIdx = cashAccountsStore.findIndex((a) => (a.account_id || a.id) === accId);
        const incomingTime = getTimestamp(rawCashAccObj);
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
                type: 'CASH_ACCOUNT',
                action: 'CASH_ACCOUNT_SYNC',
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
          const stamped = {
            ...rawCashAccObj,
            account_id: accId,
            id: accId,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            updated_at: hubIso,
          };

          if (aIdx >= 0) {
            cashAccountsStore[aIdx] = { ...cashAccountsStore[aIdx], ...stamped };
          } else {
            cashAccountsStore.unshift(stamped);
          }
          scheduleSave();
          console.log(`[Termux Hub] 💰 Synced Cash Account: ${stamped.account_name || accId} (${accId}) stamped at ${hubIso}`);

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

          // Broadcast updated cash account to other peers
          const accBroadcastStr = JSON.stringify({
            type: 'CASH_ACCOUNT',
            action: 'CASH_ACCOUNT_SYNC',
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
      // 9.4 TOMBSTONES / SOFT DELETES (STRICT ROUTING & SYNC)
      // =====================================================================
      const isTombstone = pType === 'TOMBSTONE_SYNC' || pType === 'tombstone' || entityType === 'tombstone';
      if (isTombstone) {
        const tombObj = packet.tombstone || payload || packet;
        if (tombObj && tombObj.entityId && tombObj.entityType) {
          const tId = tombObj.id || `TOMB-${tombObj.entityType}-${tombObj.entityId}`;
          const exIdx = tombstonesStore.findIndex((t) => t.id === tId || (t.entityType === tombObj.entityType && t.entityId === tombObj.entityId));
          const stampedTomb = {
            ...tombObj,
            id: tId,
            isDeleted: true,
            deletedAt: tombObj.deletedAt || Date.now(),
            hubTimestamp: Date.now(),
          };

          if (exIdx >= 0) {
            tombstonesStore[exIdx] = stampedTomb;
          } else {
            tombstonesStore.unshift(stampedTomb);
          }
          scheduleSave();
          console.log(`[Termux Hub] 🪦 Recorded Tombstone for ${tombObj.entityType} #${tombObj.entityId}`);

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
          .filter((i) => isMatch(i, reqComp, reqBranch, true))
          .map((i) => ({
            ...i,
            totalUnits: Number(i.totalUnits || 0),
            stockSingles: Number(i.stockSingles !== undefined ? i.stockSingles : i.totalUnits || 0),
            snapshotTimestamp: i.snapshotTimestamp || getTimestamp(i) || Date.now(),
          }));

        try {
          ws.send(JSON.stringify({
            type: 'INVENTORY_SNAPSHOT_RESPONSE',
            action: 'INVENTORY_SNAPSHOT_RESPONSE',
            items,
            count: items.length,
            snapshotTimestamp: Date.now(),
            origin_device_id: 'LOCAL_HUB',
            origin_device_name: 'Termux Local Hub',
            timestamp: Date.now(),
          }));
          console.log(`[Termux Hub] 📸 Dispatched full inventory snapshot (${items.length} items) to peer`);
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
        const missedInventory = inventoryStore.filter((i) => isMatch(i, reqComp, reqBranch, true) && (getTimestamp(i) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashLogs = cashLogsStore.filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashLifts = cashLiftsStore.filter((l) => isMatch(l, reqComp, reqBranch) && (getTimestamp(l) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashMovements = cashMovementsStore.filter((m) => isMatch(m, reqComp, reqBranch) && (getTimestamp(m) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCustomerChanges = customerChangesStore.filter((ch) => isMatch(ch, reqComp, reqBranch) && (getTimestamp(ch) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCreditSales = creditSalesStore.filter((cs) => isMatch(cs, reqComp, reqBranch) && (getTimestamp(cs) >= sinceTime || packet.isForced || isExplicitZero));
        const missedStockMovements = stockMovementsStore.filter((sm) => isMatch(sm, reqComp, reqBranch) && (getTimestamp(sm) >= sinceTime || packet.isForced || isExplicitZero));
        const missedExpenses = expensesStore.filter((ex) => isMatch(ex, reqComp, reqBranch) && (getTimestamp(ex) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashTransfers = cashTransfersStore.filter((tr) => isMatch(tr, reqComp, reqBranch) && (getTimestamp(tr) >= sinceTime || packet.isForced || isExplicitZero));
        const missedSuppliers = suppliersStore.filter((s) => isMatch(s, reqComp, reqBranch) && (getTimestamp(s) >= sinceTime || packet.isForced || isExplicitZero));
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

        const missedSalespeople = salespeopleStore.filter((s) => isMatch(s, reqComp, 'ALL') && (getTimestamp(s) >= staffSinceTime || packet.isForced || isExplicitZero || isStaffExplicitZero));
        const missedCustomers = customersStore.filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero));
        const missedBranches = branchesStore.filter((b) => isValidBranchRecord(b) && isMatch(b, reqComp, reqBranch) && (getTimestamp(b) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashAccounts = cashAccountsStore.filter((a) => isMatch(a, reqComp, reqBranch) && (getTimestamp(a) >= sinceTime || packet.isForced || isExplicitZero));
        const missedTombstones = tombstonesStore.filter((t) => isMatch(t, reqComp, reqBranch) && (getTimestamp(t) >= sinceTime || packet.isForced || isExplicitZero));

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
            suppliers: missedSuppliers,
            adminSales: missedAdminSales,
            cashCounts: missedCashCounts,
            vouchers: missedVouchers,
            casualWorkers: casualWorkersStore,
            zoneAssignments: zoneAssignmentsStore,
            branchLockdowns: branchLockdownsStore,
            salespeople: missedSalespeople,
            customers: missedCustomers,
            branches: missedBranches,
            cashAccounts: missedCashAccounts,
            businessDayClosures: businessDayClosuresStore,
            electronicSettlements: electronicSettlementsStore,
            categories: categoriesStore,
            creditGroups: creditGroupsStore,
            stocktakeSessions: stocktakeSessionsStore,
            stocktakeSegments: stocktakeSegmentsStore,
            tombstones: missedTombstones,
            ...(Array.isArray(permissionsMatrixStore.rules) && permissionsMatrixStore.rules.length > 0 && ((permissionsMatrixStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero)
              ? { permissionsMatrix: permissionsMatrixStore }
              : {}),
            ...(roleConfigsStore.definitions && ((roleConfigsStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero)
              ? { roleConfigs: roleConfigsStore }
              : {}),
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
            `${categoriesStore.length} categories.`
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
  console.log(`🚀 Saimetric POS - Standalone Local Hub (v3.6.0)`);
  console.log(`📡 WebSocket URL:  ws://0.0.0.0:${PORT}`);
  console.log(`🌐 HTTP Status:    http://0.0.0.0:${PORT}/health`);
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
  if (!supabaseUrl || !supabaseKey) {
    return;
  }

  const cleanBase = supabaseUrl.replace(/\/+$/, '');
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

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
                // T2: 60000ms LWW
                const cloudUpdated = getRecordTimestamp(cRec);
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
          batchToPush.forEach((r) => { r.isCloudSynced = true; });
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

// Edge-to-Cloud Sync: Every 10 minutes (and 10s after startup)
setTimeout(() => { syncEdgeToCloudSupabase(); }, 10000);
const CLOUD_SYNC_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  syncEdgeToCloudSupabase();
}, CLOUD_SYNC_INTERVAL_MS);


