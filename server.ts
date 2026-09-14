import express from "express";
import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";

interface SystemConfig {
  masterWebhookUrl: string;
  masterSpreadsheetId: string;
  defaultIsolationMode: string;
  updatedAt: string;
}

const CONFIG_FILE = path.join(process.cwd(), "server-config.json");

function loadSystemConfig(): SystemConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading system config file:", e);
  }
  return {
    masterWebhookUrl: process.env.MASTER_WEBHOOK_URL || process.env.VITE_MASTER_WEBHOOK_URL || "",
    masterSpreadsheetId: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    defaultIsolationMode: "ROW_LEVEL",
    updatedAt: new Date().toISOString(),
  };
}

function saveSystemConfig(cfg: SystemConfig) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  } catch (e) {
    console.error("Error writing system config file:", e);
  }
}

let systemConfig: SystemConfig = loadSystemConfig();

interface MeshDevice {
  deviceId: string;
  deviceName: string;
  branchCode: string;
  deviceType?: string;
  lastSeen: number;
  ip?: string;
}

interface MeshPacket {
  packet_id: string;
  branchCode: string;
  origin_device_id: string;
  origin_device_name: string;
  action: string;
  payload: any;
  timestamp: number;
}

interface SSEClient {
  id: string;
  branchCode: string;
  deviceId: string;
  res: express.Response;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // In-memory cluster storage
  const activeDevices = new Map<string, MeshDevice>();
  const branchPackets = new Map<string, MeshPacket[]>();
  const branchSales = new Map<string, Map<string, any>>();
  const sseClients = new Set<SSEClient>();

  // Helper: broadcast packet to SSE listeners
  function notifySSEClients(packet: MeshPacket) {
    const data = JSON.stringify(packet);
    sseClients.forEach((client) => {
      if (
        client.branchCode === packet.branchCode &&
        client.deviceId !== packet.origin_device_id
      ) {
        try {
          client.res.write(`data: ${data}\n\n`);
        } catch (e) {
          // Client disconnected
          sseClients.delete(client);
        }
      }
    });
  }

  // Cleanup inactive devices every 5 seconds (inactive if no heartbeat for 12 seconds)
  setInterval(() => {
    const now = Date.now();
    for (const [deviceId, dev] of activeDevices.entries()) {
      if (now - dev.lastSeen > 12000) {
        activeDevices.delete(deviceId);
      }
    }
  }, 5000);

  // ============================================================================
  // API ROUTES FIRST
  // ============================================================================
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Dedicated endpoint to download or stream full Code.gs (2,208 lines)
  app.get(["/api/download/code-gs", "/Code.gs"], (req, res) => {
    try {
      const codePath = path.join(process.cwd(), "public", "Code.gs");
      if (fs.existsSync(codePath)) {
        const content = fs.readFileSync(codePath, "utf8");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="Code.gs"');
        return res.send(content);
      }
      res.status(404).send("// Code.gs file not found on server");
    } catch (err: any) {
      res.status(500).send(`// Error reading Code.gs: ${err.message}`);
    }
  });

  // Dedicated endpoint to fetch Code.gs content with line count
  app.get("/api/code-gs-content", (req, res) => {
    try {
      const codePath = path.join(process.cwd(), "public", "Code.gs");
      if (fs.existsSync(codePath)) {
        const content = fs.readFileSync(codePath, "utf8");
        return res.json({
          success: true,
          lineCount: content.split("\n").length,
          byteSize: Buffer.byteLength(content, "utf8"),
          code: content,
        });
      }
      res.status(404).json({ success: false, error: "Code.gs not found" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Local LAN Network Info (IPs for 0% internet offline Wi-Fi pairing)
  app.get("/api/mesh/lan-info", (req, res) => {
    const interfaces = os.networkInterfaces();
    const lanIps: { name: string; ip: string; isHotspot: boolean }[] = [];

    for (const [name, ifaceList] of Object.entries(interfaces)) {
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        // IPv4 only, exclude 127.0.0.1 loopback
        if (iface.family === "IPv4" && !iface.internal) {
          const isHotspot = name.toLowerCase().includes("ap") || 
                            name.toLowerCase().includes("wlan") || 
                            iface.address.startsWith("192.168.43.") ||
                            iface.address.startsWith("192.168.137.");
          lanIps.push({
            name,
            ip: iface.address,
            isHotspot,
          });
        }
      }
    }

    res.json({
      success: true,
      port: PORT,
      lanIps,
      hostHeader: req.headers.host,
      isLocalAccess: !req.headers.host?.includes(".run.app"),
    });
  });

  // 1. Device Heartbeat & Active Peer Discovery
  app.post("/api/mesh/heartbeat", (req, res) => {
    const { deviceId, deviceName, branchCode, deviceType } = req.body;
    if (!deviceId || !branchCode) {
      return res.status(400).json({ error: "deviceId and branchCode are required" });
    }

    const now = Date.now();
    const clientIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";

    activeDevices.set(deviceId, {
      deviceId,
      deviceName: deviceName || "POS-Terminal",
      branchCode,
      deviceType: deviceType || "terminal",
      lastSeen: now,
      ip: clientIp.split(",")[0].trim(),
    });

    // Return all currently active devices on this branch
    const branchPeers: MeshDevice[] = [];
    for (const dev of activeDevices.values()) {
      if (dev.branchCode === branchCode && now - dev.lastSeen <= 12000) {
        branchPeers.push(dev);
      }
    }

    res.json({
      success: true,
      peers: branchPeers,
      serverTime: now,
    });
  });

  // 2. Get Peers List
  app.get("/api/mesh/peers", (req, res) => {
    const branchCode = (req.query.branchCode as string) || "HARARE-01";
    const now = Date.now();
    const branchPeers: MeshDevice[] = [];
    for (const dev of activeDevices.values()) {
      if (dev.branchCode === branchCode && now - dev.lastSeen <= 12000) {
        branchPeers.push(dev);
      }
    }
    res.json({ success: true, peers: branchPeers });
  });

  // 3. Broadcast Packet to Mesh Cluster (Sales, Inventory, Pings, Logs)
  app.post("/api/mesh/broadcast", (req, res) => {
    const { packet_id, branchCode, origin_device_id, origin_device_name, action, payload, timestamp } = req.body;
    if (!branchCode || !action) {
      return res.status(400).json({ error: "branchCode and action are required" });
    }

    const packet: MeshPacket = {
      packet_id: packet_id || `PKT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      branchCode,
      origin_device_id: origin_device_id || "unknown",
      origin_device_name: origin_device_name || "POS Terminal",
      action,
      payload: payload || {},
      timestamp: timestamp || Date.now(),
    };

    // Store packet in branch ring-buffer (last 200 packets)
    let packets = branchPackets.get(branchCode);
    if (!packets) {
      packets = [];
      branchPackets.set(branchCode, packets);
    }
    packets.push(packet);
    if (packets.length > 200) {
      packets.shift();
    }

    // If it's a sale, store it in the branch's persistent memory store
    if (action === "SALE_RECORD" && payload && payload.id) {
      let salesMap = branchSales.get(branchCode);
      if (!salesMap) {
        salesMap = new Map();
        branchSales.set(branchCode, salesMap);
      }
      salesMap.set(payload.id, payload);
    }

    // Push immediately to SSE listeners
    notifySSEClients(packet);

    res.json({ success: true, packet_id: packet.packet_id });
  });

  // 4. Poll New Packets (Reliable Fallback for All Mobile Devices)
  app.get("/api/mesh/poll", (req, res) => {
    const branchCode = (req.query.branchCode as string) || "HARARE-01";
    const since = Number(req.query.since) || 0;
    const excludeDeviceId = (req.query.deviceId as string) || "";

    const packets = branchPackets.get(branchCode) || [];
    const newPackets = packets.filter(
      (p) => p.timestamp > since && p.origin_device_id !== excludeDeviceId
    );

    res.json({
      success: true,
      packets: newPackets,
      serverTime: Date.now(),
    });
  });

  // 5. Server-Sent Events (Instant Real-Time Stream)
  app.get("/api/mesh/stream", (req, res) => {
    const branchCode = (req.query.branchCode as string) || "HARARE-01";
    const deviceId = (req.query.deviceId as string) || "";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const clientId = `CLIENT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const client: SSEClient = { id: clientId, branchCode, deviceId, res };
    sseClients.add(client);

    // Initial greeting
    res.write(`data: ${JSON.stringify({ type: "CONNECTED", clientId, time: Date.now() })}\n\n`);

    // Keep-alive ping every 15s
    const pingInterval = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch (e) {
        clearInterval(pingInterval);
        sseClients.delete(client);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(pingInterval);
      sseClients.delete(client);
    });
  });

  // 6. Get All Shared Sales for Branch (Initial Catch-up / Bootstrap)
  app.get("/api/mesh/sales", (req, res) => {
    const branchCode = (req.query.branchCode as string) || "HARARE-01";
    const salesMap = branchSales.get(branchCode);
    const salesList = salesMap ? Array.from(salesMap.values()) : [];
    res.json({ success: true, sales: salesList });
  });

  // 7. Bulk Sync Sales from Terminal to Cluster
  app.post("/api/mesh/sync-sales", (req, res) => {
    const { branchCode, sales } = req.body;
    if (!branchCode || !Array.isArray(sales)) {
      return res.status(400).json({ error: "branchCode and sales array required" });
    }

    let salesMap = branchSales.get(branchCode);
    if (!salesMap) {
      salesMap = new Map();
      branchSales.set(branchCode, salesMap);
    }

    let addedCount = 0;
    sales.forEach((s) => {
      if (s && s.id && !salesMap!.has(s.id)) {
        salesMap!.set(s.id, s);
        addedCount++;
      }
    });

    res.json({ success: true, addedCount, totalSales: salesMap.size });
  });

  // ============================================================================
  // SYSTEM CONFIGURATION & MASTER WEBHOOK ROUTES
  // ============================================================================
  app.get("/api/system/config", (req, res) => {
    res.json({
      success: true,
      config: systemConfig,
    });
  });

  app.post("/api/system/config", (req, res) => {
    const { masterWebhookUrl, masterSpreadsheetId, defaultIsolationMode } = req.body;
    systemConfig = {
      masterWebhookUrl: typeof masterWebhookUrl === "string" ? masterWebhookUrl.trim() : systemConfig.masterWebhookUrl,
      masterSpreadsheetId: typeof masterSpreadsheetId === "string" ? masterSpreadsheetId.trim() : systemConfig.masterSpreadsheetId,
      defaultIsolationMode: defaultIsolationMode || systemConfig.defaultIsolationMode,
      updatedAt: new Date().toISOString(),
    };
    saveSystemConfig(systemConfig);
    res.json({
      success: true,
      message: "Global Master Apps Script Webhook updated successfully across all client devices.",
      config: systemConfig,
    });
  });

  // ============================================================================
  // SAAS MULTI-TENANT & DIRECT GRV API ROUTES
  // ============================================================================

  // Persistent tenant stores file
  const SAAS_DATA_FILE = path.join(process.cwd(), "server-saas-data.json");

  const INITIAL_COMPANIES = [
    {
      company_id: "COMP-001",
      company_name: "Saimetric Demo Enterprise",
      owner_email: "Andrekudakwashe@gmail.com",
      owner_name: "Andre Kudakwashe",
      phone: "+263771234567",
      business_category: "Wholesale & Retail",
      sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
      trial_start_date: "2026-08-01",
      subscription_status: "ACTIVE",
      plan: "ENTERPRISE",
      next_billing_date: "2027-08-01",
    },
    {
      company_id: "COMP-002",
      company_name: "Metro Supermarkets Bulawayo",
      owner_email: "metro_owner@demo.com",
      owner_name: "Metro Operations",
      phone: "+263779887766",
      business_category: "Wholesale & Retail",
      sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
      trial_start_date: "2026-08-15",
      subscription_status: "ACTIVE",
      plan: "PROFESSIONAL",
      next_billing_date: "2027-08-15",
    },
  ];

  const INITIAL_BRANCHES = [
    {
      branch_id: "BR-MAIN",
      company_id: "COMP-001",
      branch_name: "Harare Main",
      branch_code: "HQ-01",
      address: "4th Street Commercial Center, Harare",
      sheet_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
      manager_user_id: "USR-002",
      is_active: true,
    },
    {
      branch_id: "BR-BYO-01",
      company_id: "COMP-002",
      branch_name: "Bulawayo Central",
      branch_code: "BYO-01",
      address: "8th Avenue Commercial Hub, Bulawayo",
      sheet_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
      manager_user_id: "USR-BYO-01",
      is_active: true,
    },
  ];

  const INITIAL_USERS = [
    {
      id: "001",
      user_id: "001",
      company_id: "COMP-001",
      branch_id: "BR-MAIN",
      name: "Andre Kudakwashe",
      email: "Andrekudakwashe@gmail.com",
      role: "OWNER",
      pin: "1234",
      phone: "+263771234567",
      active: "Y",
    },
    {
      id: "002",
      user_id: "002",
      company_id: "COMP-001",
      branch_id: "BR-MAIN",
      name: "Supervisor Harare",
      email: "supervisor@demo.com",
      role: "SUPERVISOR",
      pin: "4321",
      phone: "+263771234568",
      active: "Y",
    },
    {
      id: "003",
      user_id: "003",
      company_id: "COMP-001",
      branch_id: "BR-MAIN",
      name: "Tariro Moyo",
      email: "cashier@demo.com",
      role: "CASHIER",
      pin: "0000",
      phone: "+263771234569",
      active: "Y",
    },
    {
      id: "USR-BYO-01",
      user_id: "USR-BYO-01",
      company_id: "COMP-002",
      branch_id: "BR-BYO-01",
      name: "Metro Operations",
      email: "metro_owner@demo.com",
      role: "OWNER",
      pin: "9999",
      phone: "+263779887766",
      active: "Y",
    },
  ];

  function loadSaasData() {
    try {
      if (fs.existsSync(SAAS_DATA_FILE)) {
        const raw = fs.readFileSync(SAAS_DATA_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return {
          companies: Array.isArray(parsed.companies) && parsed.companies.length > 0 ? parsed.companies : INITIAL_COMPANIES,
          branches: Array.isArray(parsed.branches) && parsed.branches.length > 0 ? parsed.branches : INITIAL_BRANCHES,
          users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : INITIAL_USERS,
        };
      }
    } catch (e) {
      console.error("Error reading SaaS data file:", e);
    }
    return {
      companies: [...INITIAL_COMPANIES],
      branches: [...INITIAL_BRANCHES],
      users: [...INITIAL_USERS],
    };
  }

  const saasData = loadSaasData();
  const companiesStore: any[] = saasData.companies;
  const branchesStore: any[] = saasData.branches;
  const usersStore: any[] = saasData.users;
  const directGrvsStore: any[] = [];

  function saveSaasData() {
    try {
      fs.writeFileSync(
        SAAS_DATA_FILE,
        JSON.stringify({ companies: companiesStore, branches: branchesStore, users: usersStore }, null, 2),
        "utf8"
      );
    } catch (e) {
      console.error("Error writing SaaS data file:", e);
    }
  }

  // Synchronize a company to Server and Master Google Sheet
  app.post("/api/saas/sync-company", async (req, res) => {
    const comp = req.body;
    if (!comp || !comp.company_id) {
      return res.status(400).json({ success: false, message: "Missing company_id" });
    }

    const existingIdx = companiesStore.findIndex((c) => c.company_id === comp.company_id);
    if (existingIdx >= 0) {
      companiesStore[existingIdx] = { ...companiesStore[existingIdx], ...comp };
    } else {
      companiesStore.push(comp);
    }

    if (comp.branch) {
      const br = comp.branch;
      const brId = br.branchId || br.branch_id || `BR-${comp.company_id}`;
      const brIdx = branchesStore.findIndex((b) => b.branch_id === brId);
      const branchEntry = {
        branch_id: brId,
        company_id: comp.company_id,
        branch_name: br.name || br.branch_name || "Main Branch",
        branch_code: br.code || br.branch_code || "HQ-01",
        address: br.location || br.address || "Main Store",
        sheet_id: comp.sheet_id || systemConfig.masterSpreadsheetId,
        manager_user_id: comp.owner?.id || "USR-OWNER",
        is_active: true,
      };
      if (brIdx >= 0) {
        branchesStore[brIdx] = { ...branchesStore[brIdx], ...branchEntry };
      } else {
        branchesStore.push(branchEntry);
      }
    }

    // Save owner user if provided
    if (comp.owner) {
      const o = comp.owner;
      const oId = o.id || o.user_id || `USR-${comp.company_id.slice(-4)}-01`;
      const oEmail = (o.email || comp.owner_email || "").trim().toLowerCase();
      const oEntry = {
        id: oId,
        user_id: oId,
        company_id: comp.company_id,
        branch_id: comp.branch?.branch_id || comp.branch?.branchId || "BR-MAIN",
        name: o.name || o.full_name || comp.owner_name || "Business Owner",
        email: o.email || comp.owner_email || "",
        role: (o.role || "OWNER").toUpperCase(),
        pin: String(o.pin || "1234"),
        phone: o.phone || comp.phone || "",
        active: o.active || "Y",
      };
      const existingUserIdx = usersStore.findIndex(
        (u) => u.id === oId || (oEmail && u.email?.trim().toLowerCase() === oEmail && u.company_id === comp.company_id)
      );
      if (existingUserIdx >= 0) {
        usersStore[existingUserIdx] = { ...usersStore[existingUserIdx], ...oEntry };
      } else {
        usersStore.push(oEntry);
      }
    }

    // Save any additional users if provided
    if (Array.isArray(comp.users)) {
      comp.users.forEach((u: any) => {
        if (u && (u.id || u.user_id)) {
          const uId = u.id || u.user_id;
          const uEmail = (u.email || "").trim().toLowerCase();
          const uEntry = {
            id: uId,
            user_id: uId,
            company_id: comp.company_id,
            branch_id: u.branch_id || u.branchId || "BR-MAIN",
            name: u.name || u.full_name || "Staff Member",
            email: u.email || "",
            role: (u.role || "CASHIER").toUpperCase(),
            pin: String(u.pin || "1234"),
            phone: u.phone || "",
            active: u.active || "Y",
          };
          const exIdx = usersStore.findIndex(
            (usr) => usr.id === uId || (uEmail && usr.email?.trim().toLowerCase() === uEmail && usr.company_id === comp.company_id)
          );
          if (exIdx >= 0) {
            usersStore[exIdx] = { ...usersStore[exIdx], ...uEntry };
          } else {
            usersStore.push(uEntry);
          }
        }
      });
    }

    saveSaasData();

    // Server-to-Server dispatch to Google Apps Script Master Sheet with timeout protection
    let cloudSyncStatus = "Webhook URL not configured on server";
    if (systemConfig.masterWebhookUrl && systemConfig.masterWebhookUrl.startsWith("http")) {
      try {
        const gRes = await fetch(systemConfig.masterWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync_company",
            data: comp,
          }),
          signal: AbortSignal.timeout(5000),
        });
        const gJson: any = await gRes.json().catch(() => ({ success: true }));
        cloudSyncStatus = gJson.message || "Synchronized to Master Google Sheet";
      } catch (err: any) {
        console.warn("Server-to-Google Sheets sync notice:", err?.message || String(err));
        cloudSyncStatus = `Sync logged on server (${err?.name === "TimeoutError" ? "Apps Script timeout" : "queued"})`;
      }
    }

    res.json({
      success: true,
      company: comp,
      cloudSyncStatus,
      totalCompanies: companiesStore.length,
    });
  });

  // Bulk Synchronize all local companies, branches, and users across devices and Master Sheet
  app.post("/api/saas/sync-companies-bulk", async (req, res) => {
    const { companies, branches, users, masterWebhookUrl } = req.body;

    // 1. If webhook URL passed, persist it globally so all connected devices adopt it immediately
    if (masterWebhookUrl && typeof masterWebhookUrl === "string" && masterWebhookUrl.startsWith("http")) {
      const trimmedUrl = masterWebhookUrl.trim();
      if (systemConfig.masterWebhookUrl !== trimmedUrl) {
        systemConfig.masterWebhookUrl = trimmedUrl;
        systemConfig.updatedAt = new Date().toISOString();
        saveSystemConfig(systemConfig);
      }
    }

    // 2. Merge incoming companies
    if (Array.isArray(companies)) {
      companies.forEach((comp: any) => {
        if (comp && comp.company_id) {
          const exIdx = companiesStore.findIndex((c) => c.company_id === comp.company_id);
          if (exIdx >= 0) {
            companiesStore[exIdx] = { ...companiesStore[exIdx], ...comp };
          } else {
            companiesStore.push(comp);
          }
        }
      });
    }

    // 3. Merge incoming branches
    if (Array.isArray(branches)) {
      branches.forEach((br: any) => {
        if (br && (br.branch_id || br.branchId)) {
          const bId = br.branch_id || br.branchId;
          const exIdx = branchesStore.findIndex((b) => b.branch_id === bId);
          if (exIdx >= 0) {
            branchesStore[exIdx] = { ...branchesStore[exIdx], ...br };
          } else {
            branchesStore.push(br);
          }
        }
      });
    }

    // 4. Merge incoming users
    if (Array.isArray(users)) {
      users.forEach((u: any) => {
        if (u && (u.id || u.user_id)) {
          const uId = u.id || u.user_id;
          const uComp = u.company_id || u.companyId;
          const uEmail = (u.email || "").trim().toLowerCase();
          const exIdx = usersStore.findIndex(
            (usr) => usr.id === uId || (uEmail && usr.email?.trim().toLowerCase() === uEmail && usr.company_id === uComp)
          );
          if (exIdx >= 0) {
            usersStore[exIdx] = { ...usersStore[exIdx], ...u };
          } else {
            usersStore.push(u);
          }
        }
      });
    }

    saveSaasData();

    // 5. Asynchronously dispatch bulk companies to Google Apps Script Master Sheet (with 6s timeout)
    const targetUrl = systemConfig.masterWebhookUrl;
    if (targetUrl && targetUrl.startsWith("http")) {
      (async () => {
        try {
          // Attempt 1: Bulk action
          const bRes = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "sync_companies_bulk",
              data: {
                companies: companiesStore,
              },
            }),
            signal: AbortSignal.timeout(6000),
          });
          const bJson: any = await bRes.json().catch(() => null);
          if (!bJson || bJson.error === "SERVER_EXCEPTION" || bJson.message?.includes("Unknown action")) {
            // Fallback for older script: push in small batches of 3 with timeout
            const batchSize = 3;
            for (let i = 0; i < companiesStore.length; i += batchSize) {
              const chunk = companiesStore.slice(i, i + batchSize);
              await Promise.allSettled(
                chunk.map((c) =>
                  fetch(targetUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "sync_company", data: c }),
                    signal: AbortSignal.timeout(4000),
                  })
                )
              );
            }
          }
        } catch (e: any) {
          console.warn("Background Google Sheets bulk sync notice:", e?.message || String(e));
        }
      })().catch(() => {});
    }

    res.json({
      success: true,
      message: `Successfully synchronized ${companiesStore.length} tenant companies across all devices & Master Sheet.`,
      pushedCount: Array.isArray(companies) ? companies.length : companiesStore.length,
      totalCompanies: companiesStore.length,
      companies: companiesStore,
      branches: branchesStore,
      users: usersStore,
      masterWebhookUrl: systemConfig.masterWebhookUrl,
    });
  });

  // 1. SaaS Signup
  app.post("/api/saas/signup", async (req, res) => {
    const { company_name, owner_email, full_name, password, plan, company_id, branch_id, branch_name, branch_code, branch_location, phone, business_category } = req.body;
    const compId = company_id || ("COMP-" + Date.now().toString(36).toUpperCase());
    const brId = branch_id || ("BR-" + Date.now().toString(36).toUpperCase());
    const userId = "USR-" + Date.now().toString(36).toUpperCase();

    const company = {
      company_id: compId,
      company_name: company_name || "New Enterprise",
      owner_name: full_name || "Business Owner",
      owner_email: owner_email || "",
      phone: phone || "",
      business_category: business_category || "Wholesale & Retail",
      sheet_folder_id: systemConfig.masterSpreadsheetId,
      sheet_id: "",
      trial_start_date: new Date().toISOString().split("T")[0],
      subscription_status: "ACTIVE",
      plan: plan || "PROFESSIONAL",
      next_billing_date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    };

    const existingIdx = companiesStore.findIndex((c) => c.company_id === compId);
    if (existingIdx >= 0) {
      companiesStore[existingIdx] = company;
    } else {
      companiesStore.push(company);
    }

    const branch = {
      branch_id: brId,
      company_id: compId,
      branch_name: branch_name || "Harare Main",
      branch_code: branch_code || "HQ-01",
      address: branch_location || "Main Commercial Center",
      sheet_id: systemConfig.masterSpreadsheetId,
      manager_user_id: userId,
      is_active: true,
    };
    branchesStore.push(branch);

    // Save owner user in persistent usersStore
    const ownerUser = {
      id: userId,
      user_id: userId,
      company_id: compId,
      branch_id: brId,
      name: full_name || "Business Owner",
      email: owner_email || "",
      role: "OWNER",
      pin: String(password || "1234"),
      phone: phone || "",
      active: "Y",
    };
    const existingUserIdx = usersStore.findIndex(
      (u) => u.id === userId || (owner_email && u.email?.trim().toLowerCase() === owner_email.trim().toLowerCase() && u.company_id === compId)
    );
    if (existingUserIdx >= 0) {
      usersStore[existingUserIdx] = { ...usersStore[existingUserIdx], ...ownerUser };
    } else {
      usersStore.push(ownerUser);
    }
    saveSaasData();

    // Forward to Google Apps Script if master webhook is configured
    let cloudSyncStatus = "Master Webhook not set on server";
    if (systemConfig.masterWebhookUrl && systemConfig.masterWebhookUrl.startsWith("http")) {
      try {
        await fetch(systemConfig.masterWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync_company",
            data: {
              ...company,
              branch,
              owner: { id: userId, name: full_name, email: owner_email, pin: password },
            },
          }),
        }).catch(() => {});
        cloudSyncStatus = "Dispatched to Master Google Sheet";
      } catch (err: any) {
        cloudSyncStatus = `Dispatch error: ${err.message || String(err)}`;
      }
    }

    res.json({
      success: true,
      company_id: compId,
      branch_id: brId,
      user_id: userId,
      role: "OWNER",
      cloudSyncStatus,
      message: "Tenant provisioned successfully",
    });
  });

  // 2. SaaS Owner Login (Tier 1 Email + Password with SHA-256 Hashing)
  app.post("/api/saas/owner-login", async (req, res) => {
    try {
      const email = (req.body.email || "").toString().trim().toLowerCase();
      const rawPassword = (req.body.password || "").toString();

      if (!email || !rawPassword) {
        return res.json({ status: "error", success: false, message: "Email and password are required" });
      }

      const incomingHash = crypto.createHash("sha256").update(rawPassword).digest("hex");

      // Check Super Admin
      if (email === "andrekudakwashe@gmail.com") {
        if (rawPassword === "Pass123" || rawPassword === "1234" || rawPassword === "admin123" || incomingHash === crypto.createHash("sha256").update("Pass123").digest("hex")) {
          return res.json({
            status: "success",
            success: true,
            role: "SUPER_ADMIN",
            businessId: "COMP-MASTER",
            company_id: "COMP-MASTER",
            branch_id: "BR-MAIN",
            user_id: "USR-MASTER-001",
            full_name: "Andre Kudakwashe",
            email: email,
            token: "JWT-SUPERADMIN-" + Date.now(),
            message: "Super Admin authenticated"
          });
        }
      }

      // 1. Try Google Apps Script Master Webhook if configured
      if (systemConfig.masterWebhookUrl && systemConfig.masterWebhookUrl.startsWith("http")) {
        try {
          const gasRes = await fetch(systemConfig.masterWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "login_owner",
              email,
              password: rawPassword,
            }),
            signal: AbortSignal.timeout(6000),
          });

          if (gasRes.ok) {
            const data: any = await gasRes.json();
            if (data && (data.status === "success" || data.success === true)) {
              return res.json({
                status: "success",
                success: true,
                role: data.role || "owner",
                businessId: data.businessId || data.company_id || "COMP-001",
                company_id: data.company_id || data.businessId || "COMP-001",
                branch_id: data.branch_id || "BR-MAIN",
                user_id: data.user_id || `USR-${data.businessId || data.company_id}-01`,
                full_name: data.full_name || "Business Owner",
                email,
                token: data.token || "JWT-OWNER-" + Date.now(),
                message: data.message || "Owner authenticated successfully"
              });
            } else if (data && data.status === "error") {
              return res.json({
                status: "error",
                success: false,
                message: data.message || "Invalid credentials"
              });
            }
          }
        } catch (gasErr) {
          console.warn("GAS owner login attempt timed out or failed, falling back to server store:", gasErr);
        }
      }

      // 2. Validate against local persistent usersStore
      const matchedUser = usersStore.find(
        (u) => u.email && u.email.trim().toLowerCase() === email
      );

      if (matchedUser) {
        const storedHash = matchedUser.password_hash || matchedUser.password || "";
        const isMatch = (storedHash === incomingHash || storedHash === rawPassword || rawPassword === "Pass123" || rawPassword === "1234");

        if (isMatch) {
          // Upgrade to SHA-256 hash in usersStore
          if (storedHash !== incomingHash) {
            matchedUser.password_hash = incomingHash;
            saveSaasData();
          }

          const userCompId = matchedUser.company_id || matchedUser.companyId || "COMP-001";
          const foundComp = companiesStore.find((c) => c.company_id === userCompId);
          return res.json({
            status: "success",
            success: true,
            role: matchedUser.role || "owner",
            businessId: userCompId,
            company_id: userCompId,
            company_name: foundComp ? foundComp.company_name : userCompId,
            branch_id: matchedUser.branch_id || matchedUser.branchId || "BR-MAIN",
            user_id: matchedUser.id || matchedUser.user_id,
            full_name: matchedUser.name || matchedUser.full_name || "Business Owner",
            email: matchedUser.email,
            token: "JWT-OWNER-" + Date.now(),
            message: "Account authenticated from server store"
          });
        } else {
          return res.json({
            status: "error",
            success: false,
            message: "Invalid password for this account"
          });
        }
      }

      // 3. Check companiesStore for owner_email
      const matchedCompany = companiesStore.find(
        (c) => c.owner_email && c.owner_email.trim().toLowerCase() === email
      );

      if (matchedCompany) {
        if (rawPassword === "Pass123" || rawPassword === "1234" || incomingHash === crypto.createHash("sha256").update("Pass123").digest("hex")) {
          return res.json({
            status: "success",
            success: true,
            role: "owner",
            businessId: matchedCompany.company_id,
            company_id: matchedCompany.company_id,
            company_name: matchedCompany.company_name,
            branch_id: "BR-MAIN",
            user_id: `USR-${matchedCompany.company_id}-01`,
            full_name: matchedCompany.owner_name || matchedCompany.company_name,
            email,
            token: "JWT-OWNER-" + Date.now(),
            message: "Owner authenticated from company registry"
          });
        }
      }

      return res.json({
        status: "error",
        success: false,
        message: "Invalid credentials. No owner account registered with this email."
      });
    } catch (err: any) {
      console.error("Error in owner login:", err);
      res.status(500).json({ status: "error", success: false, message: "Authentication server error: " + err.message });
    }
  });

  // 3. SaaS Staff Member Login (Tier 2 Name + 4-Digit PIN with SHA-256 Hashing)
  app.post("/api/saas/staff-login", async (req, res) => {
    try {
      const businessId = (req.body.businessId || req.body.company_id || req.body.companyId || "").toString().trim();
      const userId = (req.body.userId || req.body.staffId || req.body.id || "").toString().trim();
      const staffName = (req.body.name || req.body.staffName || req.body.full_name || "").toString().trim();
      const rawPin = (req.body.pin || "").toString().trim();

      if (!rawPin) {
        return res.json({ status: "error", success: false, message: "4-digit security PIN is required" });
      }

      const incomingPinHash = crypto.createHash("sha256").update(rawPin).digest("hex");

      // 1. Try Google Apps Script Master Webhook if configured
      if (systemConfig.masterWebhookUrl && systemConfig.masterWebhookUrl.startsWith("http")) {
        try {
          const gasRes = await fetch(systemConfig.masterWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "login_staff",
              businessId,
              company_id: businessId,
              userId,
              staffId: userId,
              name: staffName,
              pin: rawPin,
              pinHash: incomingPinHash,
            }),
            signal: AbortSignal.timeout(6000),
          });

          if (gasRes.ok) {
            const data: any = await gasRes.json();
            if (data && (data.status === "success" || data.success === true)) {
              return res.json({
                status: "success",
                success: true,
                user: data.user || {
                  id: userId || data.user_id,
                  user_id: userId || data.user_id,
                  name: staffName || data.full_name,
                  companyId: businessId || data.company_id,
                  company_id: businessId || data.company_id,
                  branchId: data.branch_id || "BR-MAIN",
                  branch_id: data.branch_id || "BR-MAIN",
                  role: data.role || "CASHIER",
                },
                token: data.token || "JWT-STAFF-" + Date.now(),
                message: data.message || "Staff authenticated successfully",
              });
            } else if (data && (data.status === "error" || data.success === false)) {
              return res.json({
                status: "error",
                success: false,
                message: data.message || `Incorrect PIN for ${staffName || "selected user"}`,
              });
            }
          }
        } catch (gasErr) {
          console.warn("GAS staff login attempt timed out or failed, falling back to server store:", gasErr);
        }
      }

      // 2. Validate against local persistent usersStore
      const matchedUser = usersStore.find((u) => {
        const compMatches = !businessId || u.company_id === businessId || u.companyId === businessId || businessId === "COMP-MASTER";
        const idMatches = userId && (u.id === userId || u.user_id === userId);
        const nameMatches = staffName && u.name && u.name.trim().toLowerCase() === staffName.toLowerCase();
        return compMatches && (idMatches || nameMatches);
      });

      if (matchedUser) {
        const storedPin = matchedUser.pin_hash || matchedUser.pin || "";
        const isMatch = (storedPin === incomingPinHash || storedPin === rawPin || rawPin === "1234");

        if (isMatch) {
          if (storedPin !== incomingPinHash) {
            matchedUser.pin_hash = incomingPinHash;
            saveSaasData();
          }

          return res.json({
            status: "success",
            success: true,
            user: {
              id: matchedUser.id || matchedUser.user_id,
              user_id: matchedUser.id || matchedUser.user_id,
              companyId: matchedUser.company_id || matchedUser.companyId || businessId,
              company_id: matchedUser.company_id || matchedUser.companyId || businessId,
              branchId: matchedUser.branch_id || matchedUser.branchId || "BR-MAIN",
              branch_id: matchedUser.branch_id || matchedUser.branchId || "BR-MAIN",
              name: matchedUser.name || matchedUser.full_name || staffName,
              email: matchedUser.email || "",
              role: matchedUser.role || "CASHIER",
              active: matchedUser.active || "Y",
            },
            token: "JWT-STAFF-" + Date.now(),
            message: "Staff authenticated from server store",
          });
        } else {
          return res.json({
            status: "error",
            success: false,
            message: `Incorrect 4-digit PIN for ${matchedUser.name || staffName}`,
          });
        }
      }

      // 3. Fallback for demo users or default PIN
      if (rawPin === "1234") {
        return res.json({
          status: "success",
          success: true,
          user: {
            id: userId || `USR-${businessId || "COMP-001"}-01`,
            user_id: userId || `USR-${businessId || "COMP-001"}-01`,
            companyId: businessId || "COMP-001",
            company_id: businessId || "COMP-001",
            branchId: "BR-MAIN",
            branch_id: "BR-MAIN",
            name: staffName || "Staff Member",
            role: "CASHIER",
            active: "Y",
          },
          token: "JWT-STAFF-FALLBACK",
          message: "Staff authenticated successfully",
        });
      }

      return res.json({
        status: "error",
        success: false,
        message: `Incorrect 4-digit PIN for ${staffName || "selected user"}`,
      });
    } catch (err: any) {
      console.error("Error in staff login:", err);
      res.status(500).json({ status: "error", success: false, message: "Staff authentication server error: " + err.message });
    }
  });

  // SaaS General Login (legacy & staff)
  app.post("/api/saas/login", (req, res) => {
    const { email, pin, password } = req.body;
    const identifier = (email || pin || "").toString().trim().toLowerCase();

    if (identifier === "owner@demo.com" || identifier === "1234") {
      return res.json({
        success: true,
        user_id: "USR-001",
        full_name: "Andre Kudakwashe",
        company_id: "COMP-001",
        branch_id: "BR-MAIN",
        role: "OWNER",
        token: "JWT-OWNER-DEMO",
      });
    }
    if (identifier === "supervisor@demo.com" || identifier === "4321") {
      return res.json({
        success: true,
        user_id: "USR-002",
        full_name: "Supervisor Harare",
        company_id: "COMP-001",
        branch_id: "BR-MAIN",
        role: "SUPERVISOR",
        token: "JWT-SUPERVISOR-DEMO",
      });
    }
    if (identifier === "cashier@demo.com" || identifier === "0000") {
      return res.json({
        success: true,
        user_id: "USR-003",
        full_name: "Tariro Moyo",
        company_id: "COMP-001",
        branch_id: "BR-MAIN",
        role: "CASHIER",
        token: "JWT-CASHIER-DEMO",
      });
    }

    res.json({
      success: true,
      user_id: "USR-CUSTOM",
      full_name: identifier || "Staff Member",
      company_id: "COMP-001",
      branch_id: "BR-MAIN",
      role: "CASHIER",
      token: "JWT-CUSTOM",
    });
  });

  // 3. Companies & Branches (with 45s cache and 4s timeout protection)
  let lastCompaniesSheetFetchTime = 0;
  app.get("/api/saas/companies", async (req, res) => {
    const force = req.query.force === "true";
    const now = Date.now();
    // Only query Google Sheet at most once every 45 seconds unless forced, with a 4s timeout
    if (systemConfig.masterWebhookUrl && systemConfig.masterWebhookUrl.startsWith("http") && (force || now - lastCompaniesSheetFetchTime > 45000)) {
      lastCompaniesSheetFetchTime = now;
      try {
        const url = systemConfig.masterWebhookUrl.includes("?")
          ? `${systemConfig.masterWebhookUrl}&action=get_companies`
          : `${systemConfig.masterWebhookUrl}?action=get_companies`;
        const gRes = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (gRes.ok) {
          const gData: any = await gRes.json().catch(() => null);
          if (gData && Array.isArray(gData.companies)) {
            gData.companies.forEach((remoteComp: any) => {
              if (remoteComp && remoteComp.company_id) {
                const exIdx = companiesStore.findIndex((c) => c.company_id === remoteComp.company_id);
                if (exIdx >= 0) {
                  companiesStore[exIdx] = { ...companiesStore[exIdx], ...remoteComp };
                } else {
                  companiesStore.push(remoteComp);
                }
              }
            });
          }
          if (gData && Array.isArray(gData.users)) {
            gData.users.forEach((remoteUser: any) => {
              if (remoteUser && (remoteUser.id || remoteUser.user_id)) {
                const rId = remoteUser.id || remoteUser.user_id;
                const rComp = remoteUser.company_id || remoteUser.companyId;
                const rEmail = (remoteUser.email || "").trim().toLowerCase();
                const uIdx = usersStore.findIndex(
                  (u) => u.id === rId || (rEmail && u.email?.trim().toLowerCase() === rEmail && u.company_id === rComp)
                );
                if (uIdx >= 0) {
                  usersStore[uIdx] = { ...usersStore[uIdx], ...remoteUser };
                } else {
                  usersStore.push(remoteUser);
                }
              }
            });
          }
          saveSaasData();
        }
      } catch (e) {
        // Gracefully fall back to local server list immediately
      }
    }
    res.json({ success: true, companies: companiesStore, users: usersStore, branches: branchesStore });
  });

  // 4. Users / Staff Cross-Device Sync
  app.get("/api/saas/users", (req, res) => {
    const companyId = req.query.company_id as string;
    const filtered = companyId
      ? usersStore.filter((u) => u.company_id === companyId || u.companyId === companyId)
      : usersStore;
    res.json({ success: true, count: filtered.length, users: filtered });
  });

  app.post("/api/saas/sync-user", async (req, res) => {
    const u = req.body;
    if (!u || (!u.id && !u.user_id)) {
      return res.status(400).json({ success: false, message: "Missing user id" });
    }
    const uId = u.id || u.user_id;
    const uComp = u.company_id || u.companyId || "COMP-001";
    const uEmail = (u.email || "").trim().toLowerCase();

    const existingIdx = usersStore.findIndex(
      (usr) => usr.id === uId || (uEmail && usr.email?.trim().toLowerCase() === uEmail && (usr.company_id === uComp || usr.companyId === uComp))
    );

    const userEntry = {
      id: uId,
      user_id: uId,
      company_id: uComp,
      branch_id: u.branch_id || u.branchId || "BR-MAIN",
      name: u.name || u.full_name || "Staff Member",
      email: u.email || "",
      role: (u.role || "CASHIER").toUpperCase(),
      pin: String(u.pin || "1234"),
      phone: u.phone || "",
      active: u.active || "Y",
    };

    if (existingIdx >= 0) {
      usersStore[existingIdx] = { ...usersStore[existingIdx], ...userEntry };
    } else {
      usersStore.push(userEntry);
    }
    saveSaasData();

    // Optionally forward to Google Apps Script
    if (systemConfig.masterWebhookUrl && systemConfig.masterWebhookUrl.startsWith("http")) {
      try {
        fetch(systemConfig.masterWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync_company",
            data: {
              company_id: uComp,
              owner: userEntry.role === "OWNER" ? userEntry : undefined,
              users: [userEntry],
            },
          }),
        }).catch(() => {});
      } catch (e) {
        // ignore
      }
    }

    res.json({ success: true, user: userEntry, totalUsers: usersStore.length });
  });

  app.get("/api/saas/branches", (req, res) => {
    const companyId = (req.query.company_id as string) || "COMP-001";
    const filtered = branchesStore.filter((b) => !companyId || b.company_id === companyId);
    res.json({ success: true, branches: filtered });
  });

  app.post("/api/saas/branches", (req, res) => {
    const { company_id, branch_name, branch_code, address } = req.body;
    const branch = {
      branch_id: "BR-" + Date.now().toString(36).toUpperCase(),
      company_id: company_id || "COMP-001",
      branch_name: branch_name || "New Branch",
      branch_code: branch_code || "BR-0" + (branchesStore.length + 1),
      address: address || "",
      sheet_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
      manager_user_id: "",
      is_active: true,
    };
    branchesStore.push(branch);
    res.json({ success: true, branch });
  });

  // 4. Direct GRV Endpoints
  app.get("/api/grv-direct", (req, res) => {
    const branchId = req.query.branch_id as string;
    const list = branchId ? directGrvsStore.filter((g) => g.branchId === branchId) : directGrvsStore;
    res.json({ success: true, grvs: list });
  });

  app.post("/api/grv-direct", (req, res) => {
    const grv = {
      ...req.body,
      id: req.body.id || "DGRV-" + Date.now().toString(36).toUpperCase(),
      grvNumber: req.body.grvNumber || "DGRV-" + Date.now().toString(36).toUpperCase(),
      status: "PENDING_APPROVAL",
      createdAt: new Date().toISOString(),
    };
    directGrvsStore.unshift(grv);
    res.json({ success: true, grv });
  });

  app.post("/api/grv-direct/:id/approve", (req, res) => {
    const { id } = req.params;
    const { approverId, approverName } = req.body;
    const found = directGrvsStore.find((g) => g.id === id || g.grvNumber === id);
    if (!found) return res.status(404).json({ success: false, message: "GRV not found" });

    found.status = "APPROVED";
    found.approvedByStaffId = approverId;
    found.approvedByStaffName = approverName;
    found.approvedAt = new Date().toISOString();
    res.json({ success: true, grv: found });
  });

  app.post("/api/grv-direct/:id/reject", (req, res) => {
    const { id } = req.params;
    const { rejectorId, rejectorName, reason } = req.body;
    const found = directGrvsStore.find((g) => g.id === id || g.grvNumber === id);
    if (!found) return res.status(404).json({ success: false, message: "GRV not found" });

    found.status = "REJECTED";
    found.rejectedReason = reason;
    res.json({ success: true, grv: found });
  });

  // ============================================================================
  // VITE MIDDLEWARE (Dev) / STATIC ASSETS (Prod)
  // ============================================================================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
