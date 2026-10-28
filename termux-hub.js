#!/usr/bin/env node
/**
 * Saimetric POS - Standalone High-Reliability Local Hub for Termux Android / Local LAN (v3.0)
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
 * 3. Bi-directional Catch-Up Sync: Replays ALL missed deltas when an offline device reconnects.
 * 4. Inventory Reconciliation: Adjusts stock on inward deliveries and sales deductions.
 * 5. Echo-Free Broadcast: Never reflects packets back to sender, completely eliminating loops.
 *
 * Quick Start on Termux:
 *   pkg update && pkg install nodejs
 *   npm install ws
 *   node termux-hub.js --port 8080
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';

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

      console.log(
        `[Termux Hub] Loaded from disk: [Branch: ${hubBranchId} - ${hubBranchName}], ${salesStore.length} sales, ${directGrvsStore.length} direct GRVs, ${inventoryStore.length} items.`
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
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
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
        hub: 'Saimetric Termux Local Hub v3.0 (Full-Store Multi-Entity)',
        port: PORT,
        clientsCount: wss ? wss.clients.size : 0,
        totalSalesStored: salesStore.length,
        totalDirectGrvsStored: directGrvsStore.length,
        totalInventoryItems: inventoryStore.length,
        totalCashMovements: cashMovementsStore.length,
        totalCashLifts: cashLiftsStore.length,
        totalCashLogs: cashLogsStore.length,
        packetsProcessed: packetCounter,
        uptimeSec: Math.round(process.uptime()),
      })
    );
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(
    `Saimetric Termux Local Hub v3.0 Running on Port ${PORT}\nConnected Clients: ${wss ? wss.clients.size : 0}\nTotal Sales: ${salesStore.length}\nDirect GRVs: ${directGrvsStore.length}\nInventory Items: ${inventoryStore.length}\nCash Movements: ${cashMovementsStore.length}\nCash Lifts: ${cashLiftsStore.length}\nPackets Processed: ${packetCounter}\n`
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
        pType === 'RECEIPT';
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
          version: '3.1.0',
          totalRecords: salesStore.length + directGrvsStore.length,
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
        seenPacketIds.clear();

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
          message: 'Local Hub memory wiped and branch identity reset successfully.',
          timestamp: Date.now(),
        };
        try {
          ws.send(JSON.stringify(resetAck));
        } catch (_) {}
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

        // Store sale in hub history
        const existingIdx = salesStore.findIndex((s) => s.id === saleId);
        if (existingIdx >= 0) {
          salesStore[existingIdx] = { ...salesStore[existingIdx], ...(saleObj || packet) };
        } else {
          salesStore.unshift(saleObj || packet);
        }

        // Deduct inventory units & monitor variance
        if (saleObj && Array.isArray(saleObj.items)) {
          for (const it of saleObj.items) {
            if (!it || !it.id) continue;
            const invIdx = inventoryStore.findIndex((i) => i.itemId === it.id || i.id === it.id);
            if (invIdx >= 0) {
              const curUnits = Number(inventoryStore[invIdx].totalUnits || 0);
              const deductQty = Number(it.quantity || 0);
              const newUnits = Number((curUnits - deductQty).toFixed(3));
              inventoryStore[invIdx].totalUnits = newUnits;
              inventoryStore[invIdx].stockSingles = newUnits;
              if (newUnits < 0) {
                console.warn(
                  `[STOCK_VARIANCE] ⚠️ Stock fell negative on Hub for "${inventoryStore[invIdx].itemName || it.id}": ${newUnits} units (Invoice #${saleId})`
                );
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
          } catch (ackErr) {
            console.warn('[Termux Hub] Failed to send SYNC_RECEIPT ACK:', ackErr.message);
          }
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

          // Stock Inward: If voucher is APPROVED or posted, increment stock in inventoryStore
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

          // If paid from till, record till payment cash movement into cashMovementsStore
          if (grv.status !== 'REJECTED' && grv.payFromTill !== false && grv.paymentMethod !== 'INVOICE_ON_ACCOUNT') {
            const shiftDate = grv.date || (grv.createdAt ? grv.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]);
            const payments = Array.isArray(grv.payments) && grv.payments.length > 0 ? grv.payments : [{ userId: grv.receivedByStaffId || 'USR-003', userName: grv.receivedByStaffName || 'Cashier', amount: grv.totalCost || 0 }];

            payments.forEach((p, pIdx) => {
              const pAmt = Number(p.amount) || 0;
              if (pAmt <= 0) return;
              const moveId = `MOVE-GRV-${grv.grvNumber}-${pIdx + 1}`;
              const mIdx = cashMovementsStore.findIndex((m) => m.id === moveId || m.sourceRef === grv.grvNumber);
              const moveRecord = {
                id: moveId,
                shiftId: `SHIFT-${p.userId}-${shiftDate}`,
                staffId: p.userId,
                staffName: p.userName,
                terminalId: p.drawerId || 'Till 1',
                date: shiftDate,
                timestamp: grv.createdAt || new Date().toISOString(),
                type: 'supplier_payment',
                amount: pAmt,
                currency: 'USD',
                direction: 'out',
                affectsDrawer: true,
                status: 'approved',
                sourceModule: 'DirectGRV',
                sourceRef: grv.grvNumber,
                notes: `Direct Supplier Delivery: ${grv.supplierName} (${grv.grvNumber})`,
                company_id: grv.companyId || grv.company_id || 'COMP-001',
                branch_id: grv.branchId || grv.branch_id || 'BR-MAIN',
              };
              if (mIdx >= 0) {
                cashMovementsStore[mIdx] = { ...cashMovementsStore[mIdx], ...moveRecord };
              } else {
                cashMovementsStore.unshift(moveRecord);
              }
            });
          }

          scheduleSave();
          console.log(`[Termux Hub] Ingested Direct Delivery ${grv.grvNumber} for ${grv.supplierName}. Total: $${(grv.totalCost || 0).toFixed(2)}.`);
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
        console.log(`[Termux Hub] Upserted ${items.length} product catalog record(s). Catalog size: ${inventoryStore.length}`);
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
          console.log(`[Termux Hub] Ingested Cash Movement ${move.id} (${move.type}: $${move.amount}).`);
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
          console.log(`[Termux Hub] Ingested Cash Lift ${liftId} ($${lift.amount}).`);
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
      const isCustomerChange =
        pType === 'CUSTOMER_CHANGE' ||
        sheetName === 'CustomerChange' ||
        (payload && payload.changeId);

      if (isCustomerChange && payload && payload.changeId) {
        const exIdx = customerChangesStore.findIndex((c) => c.changeId === payload.changeId || c.id === payload.changeId);
        if (exIdx >= 0) {
          customerChangesStore[exIdx] = { ...customerChangesStore[exIdx], ...payload };
        } else {
          customerChangesStore.unshift(payload);
        }
        scheduleSave();
      }

      const isCreditSale =
        pType === 'CREDIT_SALE' ||
        sheetName === 'CreditSales' ||
        (payload && payload.creditId);

      if (isCreditSale && payload && payload.creditId) {
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
      const isStockMovement =
        pType === 'STOCK_MOVEMENT' ||
        sheetName === 'StockMovement' ||
        entityType === 'stock_movement' ||
        (payload && payload.movementType);

      if (isStockMovement && payload && (payload.id || payload.movementId)) {
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
      if (pType === 'EXPENSE' || sheetName === 'Expenses' || entityType === 'expense') {
        if (payload && payload.id) {
          const exIdx = expensesStore.findIndex((e) => e.id === payload.id);
          if (exIdx >= 0) {
            expensesStore[exIdx] = { ...expensesStore[exIdx], ...payload };
          } else {
            expensesStore.unshift(payload);
          }
          scheduleSave();
        }
      }

      if (pType === 'CASH_TRANSFER' || sheetName === 'CashTransfers' || entityType === 'cash_transfer') {
        if (payload && payload.id) {
          const exIdx = cashTransfersStore.findIndex((t) => t.id === payload.id);
          if (exIdx >= 0) {
            cashTransfersStore[exIdx] = { ...cashTransfersStore[exIdx], ...payload };
          } else {
            cashTransfersStore.unshift(payload);
          }
          scheduleSave();
        }
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

        const catchupResponse = {
          type: 'catchup_response',
          action: 'CATCHUP_RESPONSE',
          packet_id: `CRS-HUB-${Date.now()}`,
          originDeviceId: 'LOCAL_HUB',
          originDeviceName: 'Termux Local Hub',
          targetDeviceId: reqDeviceId,
          sinceTimestamp,
          cutoffTimestamp: new Date().toISOString(),
          isReciprocal: true, // Prevents ping-pong loops
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
          },
        };

        try {
          ws.send(JSON.stringify(catchupResponse));
          console.log(
            `[Termux Hub] Replayed catch-up to ${reqDeviceId}: ${missedSales.length} sales, ${missedDirectGrvs.length} GRVs, ${missedCashLogs.length} cash logs, ${missedCashLifts.length} cash lifts, ${missedInventory.length} items (since ${new Date(sinceTime).toLocaleTimeString()}).`
          );
        } catch (e) {
          console.warn('[Termux Hub] Failed to send catchup response:', e.message);
        }
        return; // Handled directly, do NOT broadcast catchup_request to other peers!
      }

      // =====================================================================
      // 11. STRICT SENDER EXCLUSION BROADCAST (ANTI-ECHO)
      // =====================================================================
      // Forward real sales and mutations to all other connected devices, never back to sender
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
  console.log(` Saimetric Local Hub v3.0 running on ws://0.0.0.0:${PORT}`);
  console.log(` Portable Hotspot Default IP: ws://192.168.43.1:${PORT}`);
  console.log(` Ready for 100% offline branch store synchronization.`);
  console.log(`====================================================`);
});
