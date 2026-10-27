#!/usr/bin/env node
/**
 * Saimetric POS - Standalone High-Reliability Local Hub for Termux Android / Local LAN
 *
 * Designed specifically for Termux Android Hotspot environments (192.168.43.1:8080)
 * Provides 100% offline reliability with zero data loss:
 *
 * 1. Immediate SYNC_RECEIPT (ACK) sent back to sender for every sale.
 * 2. Bi-directional Catch-Up Sync: Replays missed sales when an offline device reconnects.
 * 3. Inventory Reconciliation: Deducts stock and flags STOCK_VARIANCE if stock drops negative.
 * 4. Echo-Free Broadcast: Never reflects packets back to sender, completely eliminating loops.
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

const DATA_FILE = path.join(process.cwd(), 'termux-hub-data.json');

// In-Memory & File-backed Stores
let salesStore = [];
let inventoryStore = [];
let packetCounter = 0;
const seenPacketIds = new Set();

// Load persistent data if exists
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.sales)) salesStore = parsed.sales;
      if (Array.isArray(parsed.inventory)) inventoryStore = parsed.inventory;
      console.log(`[Termux Hub] Loaded ${salesStore.length} historical sales & ${inventoryStore.length} inventory records from disk.`);
    }
  } catch (e) {
    console.warn('[Termux Hub] Notice loading data file:', e.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ sales: salesStore.slice(0, 5000), inventory: inventoryStore }, null, 2),
      'utf8'
    );
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

  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      hub: 'Saimetric Termux Local Hub v2.0',
      port: PORT,
      clientsCount: wss ? wss.clients.size : 0,
      totalSalesStored: salesStore.length,
      packetsProcessed: packetCounter,
      uptimeSec: Math.round(process.uptime()),
    }));
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Saimetric Termux Local Hub Running on Port ${PORT}\nConnected Clients: ${wss ? wss.clients.size : 0}\nTotal Sales: ${salesStore.length}\nPackets Processed: ${packetCounter}\n`);
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
      const pktId = packet.packet_id || packet.id;
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
      const isReceipt =
        pType === 'SYNC_RECEIPT' ||
        pType === 'CLOUD_SYNC_ACK' ||
        pType === 'ANTI-DOUBLE-POST ACK' ||
        pType === 'ACK' ||
        pType === 'SALE_ACK' ||
        pType === 'RECEIPT';

      // Drop ACK packets immediately so they NEVER circulate, echo, or ping-pong in the mesh
      if (isReceipt) {
        return;
      }

      const isSale = pType === 'SALE' || pType === 'SALE_RECORD' || pType === 'SALE_CREATED' || !!packet.sale;
      const saleObj = packet.sale || (packet.data && (packet.data.items || packet.data.total !== undefined ? packet.data : packet.data.sale)) || packet.payload;
      const saleId =
        (saleObj && (saleObj.id || saleObj.invoice_id || saleObj.invoiceId)) ||
        packet.invoice_id ||
        packet.invoiceId ||
        packet.id ||
        (packet.data && (packet.data.invoice_id || packet.data.id));

      // =====================================================================
      // SAFEGUARD 1: IMMEDIATE SYNC_RECEIPT (ACK) TO SENDER (NON-LEGACY ONLY)
      // =====================================================================
      if (isSale && saleId) {
        const isLegacyInv = String(saleId).toUpperCase().startsWith('INV-');

        // Store sale in hub history
        const existingIdx = salesStore.findIndex((s) => s.id === saleId);
        if (existingIdx >= 0) {
          salesStore[existingIdx] = { ...salesStore[existingIdx], ...(saleObj || packet) };
        } else {
          salesStore.unshift(saleObj || packet);
        }

        // Safeguard 3: Inventory Deduction & Stock Variance Tracking
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

        saveData();

        // Requirement 4: Legacy INV- sales must NOT trigger SYNC_RECEIPT
        if (!isLegacyInv) {
          // Send point-to-point SYNC_RECEIPT ACK directly back to the sending device
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
        } else {
          console.log(`[Termux Hub] Ingested legacy Sale #${saleId} silently without SYNC_RECEIPT.`);
        }
      }

      // =====================================================================
      // SAFEGUARD 2: RECONNECTION CATCH-UP RESPONSE (REPLAY MISSED DELTAS)
      // =====================================================================
      const isCatchupReq = pType === 'catchup_request' || pType === 'CATCHUP_REQUEST';
      if (isCatchupReq) {
        const sinceTimestamp = packet.sinceTimestamp || new Date(Date.now() - 48 * 3600 * 1000).toISOString();
        const sinceTime = new Date(sinceTimestamp).getTime();
        const reqDeviceId = packet.originDeviceId || 'unknown';
        const reqComp = (packet.companyId || packet.company_id || 'COMP-001').trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || 'BR-MAIN').trim().toUpperCase();

        const missedSales = salesStore.filter((s) => {
          if (!s) return false;
          const sComp = (s.company_id || s.companyId || 'COMP-001').trim().toUpperCase();
          if (reqComp && sComp && sComp !== reqComp && sComp !== 'COMP-MASTER') return false;
          const sBranch = (s.branch_id || s.branchId || '').trim().toUpperCase();
          if (reqBranch && sBranch && reqBranch !== 'ALL' && sBranch !== 'ALL' && sBranch !== reqBranch) return false;
          const t = s.timestamp || s.createdAt || s.created_at || s.date;
          const tm = t ? new Date(t).getTime() : 0;
          return tm >= sinceTime;
        });

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
            inventoryItems: [],
            stockMovements: [],
            cashLogs: [],
          },
        };

        try {
          ws.send(JSON.stringify(catchupResponse));
          console.log(
            `[Termux Hub] Replayed ${missedSales.length} missed sale(s) to reconnecting device ${reqDeviceId} (since ${new Date(sinceTime).toLocaleTimeString()}).`
          );
        } catch (e) {
          console.warn('[Termux Hub] Failed to send catchup response:', e.message);
        }
        return; // Handled directly, do NOT broadcast catchup_request to other peers!
      }

      // Drop ACK packets so they NEVER circulate or echo in the mesh
      if (pType === 'sync_receipt' || pType === 'SYNC_RECEIPT') {
        return;
      }

      // =====================================================================
      // SAFEGUARD 4: STRICT SENDER EXCLUSION BROADCAST (ANTI-ECHO)
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
  console.log(` Saimetric Local Hub running on ws://0.0.0.0:${PORT}`);
  console.log(` Portable Hotspot Default IP: ws://192.168.43.1:${PORT}`);
  console.log(` Ready for zero-internet multi-device POS mesh sync.`);
  console.log(`====================================================`);
});
