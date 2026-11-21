import express, { type Request, type Response, type Router } from 'express';

const MASTER_SPREADSHEET_ID = '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE';
const DEFAULT_MASTER_WEBHOOK =
  'https://script.google.com/macros/s/AKfycbz6_mPX1_8RRu74w1ww39-ZCltPGfIODPxx7G_MpVgosyF_476mQHiEtLq26YNU8_fY0g/exec';

export interface GatewayRuntimePolicy {
  protocolVersion: string;
  pushBatchSize: number;
  pullMaxPages: number;
  requestTimeoutMs: number;
  syncIntervalMs: number;
  clockDriftToleranceMs: number;
  blockBackdatedVoidsOnly: boolean;
  blockedBackdateActions: string[];
  blockedMasterSheetIds: string[];
  t2EntityTypes: string[];
  globalBranchEntityTypes: string[];
  retentionDays: number;
  maxStorageMb: number;
  genericBucketMaxItems: number;
}

export const DEFAULT_HUB_RUNTIME_POLICY: GatewayRuntimePolicy = {
  protocolVersion: '4.0',
  pushBatchSize: 20,
  pullMaxPages: 12,
  requestTimeoutMs: 45000,
  syncIntervalMs: 5 * 60 * 1000,
  clockDriftToleranceMs: 5 * 60 * 1000,
  blockBackdatedVoidsOnly: true,
  blockedBackdateActions: ['VOID', 'REFUND'],
  blockedMasterSheetIds: [MASTER_SPREADSHEET_ID],
  t2EntityTypes: [],
  globalBranchEntityTypes: [],
  retentionDays: 30,
  maxStorageMb: 2048,
  genericBucketMaxItems: 5000,
};

interface GatewayDeps {
  getMasterWebhookUrl: () => string;
  getCompanyRecord?: (companyId: string) => any | undefined;
}

const ALLOWED_ENTITY_TABLE_MAP: Record<string, string> = {
  sale: 'sales',
  inventory_item: 'inventory',
  staff: 'staff',
  customer: 'customers',
  customer_change: 'customer_changes',
  credit_sale: 'credit_sales',
  credit_group: 'credit_groups',
  cash_log: 'cash_logs',
  cash_lift: 'cash_lifts',
  cash_movement: 'cash_movements',
  cash_account: 'cash_accounts',
  cash_transfer: 'cash_transfers',
  direct_grv: 'direct_grvs',
  goods_received: 'goods_received',
  expense: 'expenses',
  internal_consumption: 'internal_consumptions',
  stock_movement: 'stock_movements',
  reconciliation: 'reconciliations',
  supplier: 'suppliers',
  admin_sale: 'admin_sales',
  cash_count: 'cash_counts',
  supplier_invoice_voucher: 'supplier_invoice_vouchers',
  business_day_closure: 'business_day_closures',
  electronic_settlement: 'electronic_settlements',
  inventory_category: 'inventory_categories',
  branch: 'branches',
  casual_worker: 'casual_workers',
  branch_lockdown: 'branch_lockdowns',
  stocktake_session: 'stocktake_sessions',
  stocktake_segment: 'stocktake_segments',
  stocktake_zone_assignment: 'stocktake_zone_assignments',
  tombstone: 'tombstones',
  permissions_matrix: 'permissions_matrix',
  role_configs: 'role_configs',
  multi_currency: 'multi_currency',
  audit_log: 'audit_logs',
};

function isPrivateOrBlockedHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function validateAllowedHttpsUrl(rawUrl: string, allowedHostSuffixes?: string[]): string | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrBlockedHost(host)) return null;
    if (allowedHostSuffixes && allowedHostSuffixes.length > 0) {
      const ok = allowedHostSuffixes.some((suffix) => host === suffix || host.endsWith('.' + suffix));
      if (!ok) return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveSafeTableName(entityType: string): string {
  const clean = String(entityType || '').trim().toLowerCase();
  if (ALLOWED_ENTITY_TABLE_MAP[clean]) return ALLOWED_ENTITY_TABLE_MAP[clean];
  if (/^[a-z][a-z0-9_]{1,47}$/.test(clean)) return clean;
  return 'generic_envelopes';
}

function isMasterTenantId(companyId: string): boolean {
  const u = String(companyId || '').trim().toUpperCase();
  return u === 'COMP-001' || u === 'COMP-MASTER' || u === 'MASTER';
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; json: any; text: string; dateHeader: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(90000, Math.max(5000, timeoutMs)));
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    const trimmed = text.trim();
    let json: any = null;
    if (trimmed && !trimmed.startsWith('<')) {
      try {
        json = JSON.parse(trimmed);
      } catch {
        json = null;
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text: trimmed.slice(0, 400),
      dateHeader: res.headers.get('date'),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function handleAppsScriptGateway(
  action: 'ping' | 'push_envelopes' | 'pull_catchup',
  body: any,
  targetWebhookUrl: string,
  companyId: string,
  spreadsheetId: string
) {
  if (action === 'push_envelopes' && !isMasterTenantId(companyId)) {
    if (!spreadsheetId || spreadsheetId === MASTER_SPREADSHEET_ID) {
      return {
        httpStatus: 400,
        body: {
          success: false,
          code: 'MASTER_SHEET_WRITE_BLOCKED',
          error: 'Dedicated tenant spreadsheet_id is required before pushing operational envelopes.',
        },
      };
    }
  }

  const safeUrl = validateAllowedHttpsUrl(targetWebhookUrl, ['script.google.com', 'script.googleusercontent.com']);
  if (!safeUrl) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        code: 'INVALID_UPSTREAM_URL',
        error: 'Apps Script upstream URL must be a valid https://script.google.com deployment URL.',
      },
    };
  }

  if (action === 'ping') {
    const pingUrl = `${safeUrl}${safeUrl.includes('?') ? '&' : '?'}action=ping`;
    const res = await fetchJsonWithTimeout(pingUrl, { method: 'GET' }, 20000);
    return {
      httpStatus: res.ok && res.json ? 200 : 502,
      body: {
        success: Boolean(res.ok && res.json && res.json.success !== false),
        upstream: 'appscripts',
        upstreamPing: res.json || { status: res.status },
        server_time: new Date().toISOString(),
        policy: DEFAULT_HUB_RUNTIME_POLICY,
      },
    };
  }

  const timeoutMs = action === 'push_envelopes' ? 50000 : 35000;
  const forwardPayload = {
    ...body,
    action,
    company_id: companyId,
    ...(spreadsheetId ? { spreadsheet_id: spreadsheetId, sheet_id: spreadsheetId, tenant_sheet_id: spreadsheetId } : {}),
  };
  delete forwardPayload.backend_type;
  delete forwardPayload.credentials;
  delete forwardPayload.gateway_url;

  const res = await fetchJsonWithTimeout(
    safeUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(forwardPayload),
    },
    timeoutMs
  );

  if (!res.json) {
    return {
      httpStatus: 502,
      body: {
        success: false,
        code: 'UPSTREAM_NON_JSON',
        error: `Apps Script returned non-JSON HTTP ${res.status}`,
      },
    };
  }

  return {
    httpStatus: res.ok ? 200 : res.status,
    body: {
      ...res.json,
      policy: DEFAULT_HUB_RUNTIME_POLICY,
    },
  };
}

async function handleSupabaseGateway(
  action: 'ping' | 'push_envelopes' | 'pull_catchup',
  body: any,
  creds: Record<string, any>,
  companyId: string
) {
  const rawBase = String(creds.url || creds.projectUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(creds.serviceRoleKey || creds.apiKey || creds.anonKey || '').trim();
  const safeBase = validateAllowedHttpsUrl(rawBase, ['supabase.co', 'supabase.in']);
  if (!safeBase || !apiKey) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        code: 'INVALID_SUPABASE_CONFIG',
        error: 'Valid HTTPS Supabase project URL and API key are required.',
      },
    };
  }

  const cleanBase = safeBase.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (action === 'ping') {
    const res = await fetchJsonWithTimeout(`${cleanBase}/rest/v1/`, { method: 'GET', headers }, 15000);
    return {
      httpStatus: res.ok ? 200 : 502,
      body: {
        success: res.ok,
        upstream: 'supabase',
        server_time: new Date().toISOString(),
        policy: DEFAULT_HUB_RUNTIME_POLICY,
      },
    };
  }

  if (action === 'push_envelopes') {
    const envelopes = Array.isArray(body.envelopes) ? body.envelopes.slice(0, 50) : [];
    const ackedPacketIds: string[] = [];
    const failed: Array<{ packetId: string; error: string }> = [];
    const byTable = new Map<string, Array<{ env: any; row: any }>>();

    for (const env of envelopes) {
      if (!env || !env.entityType || !env.data) continue;
      const tbl = resolveSafeTableName(env.entityType);
      if (!byTable.has(tbl)) byTable.set(tbl, []);
      byTable.get(tbl)!.push({
        env,
        row: {
          ...env.data,
          company_id: env.data.company_id || companyId,
          updated_at: new Date(Number(env.updatedAt) || Date.now()).toISOString(),
        },
      });
    }

    for (const [tbl, entries] of byTable.entries()) {
      try {
        const res = await fetchJsonWithTimeout(
          `${cleanBase}/rest/v1/${encodeURIComponent(tbl)}`,
          {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify(entries.map((e) => e.row)),
          },
          30000
        );
        if (res.ok || res.status === 201) {
          entries.forEach((e) => ackedPacketIds.push(String(e.env.packetId || e.env.entityId || '')));
        } else {
          entries.forEach((e) =>
            failed.push({ packetId: String(e.env.packetId || ''), error: `SUPABASE_HTTP_${res.status}` })
          );
        }
      } catch (err: any) {
        entries.forEach((e) =>
          failed.push({ packetId: String(e.env.packetId || ''), error: err?.message || 'SUPABASE_PUSH_FAILED' })
        );
      }
    }

    return {
      httpStatus: 200,
      body: {
        success: failed.length === 0 || ackedPacketIds.length > 0,
        ackedPacketIds,
        failed,
        conflicts: [],
        server_received_at: new Date().toISOString(),
        policy: DEFAULT_HUB_RUNTIME_POLICY,
      },
    };
  }

  // pull_catchup translated from Supabase tables -> canonical SyncEnvelope[]
  const sinceTs = Number(body.since_ts || body.since_seq || 0);
  const sinceIso = sinceTs > 1_000_000_000_000 ? new Date(sinceTs).toISOString() : new Date(0).toISOString();
  const limit = Math.min(250, Math.max(10, Number(body.limit) || 100));
  const entityTypesToPull: string[] = Array.isArray(body.entity_types) && body.entity_types.length > 0
    ? body.entity_types.map((t: any) => String(t).trim().toLowerCase()).slice(0, 20)
    : ['sale', 'inventory_item', 'customer', 'expense', 'cash_log', 'direct_grv', 'supplier', 'staff', 'branch', 'reconciliation', 'goods_received'];

  const envelopes: any[] = [];
  let maxUpdatedMs = sinceTs;

  for (const eType of entityTypesToPull) {
    const tbl = resolveSafeTableName(eType);
    try {
      const qs = new URLSearchParams({
        company_id: `eq.${companyId}`,
        updated_at: `gt.${sinceIso}`,
        order: 'updated_at.asc',
        limit: String(limit),
      });
      const res = await fetchJsonWithTimeout(`${cleanBase}/rest/v1/${encodeURIComponent(tbl)}?${qs.toString()}`, { method: 'GET', headers }, 20000);
      if (res.ok && Array.isArray(res.json)) {
        for (const row of res.json) {
          if (!row || typeof row !== 'object') continue;
          const updMs = Date.parse(row.updated_at || row.lastUpdated || row.timestamp || '') || Date.now();
          if (updMs > maxUpdatedMs) maxUpdatedMs = updMs;
          const entityId = String(row.id || row.itemId || row.invoice_id || row.customerId || row.branchId || '').trim();
          if (!entityId) continue;
          envelopes.push({
            packetId: `SB-${eType}-${entityId}-${updMs}`,
            entityType: eType,
            entityId,
            action: 'UPSERT',
            data: row,
            updatedAt: updMs,
            serverSeq: updMs,
            originDeviceId: 'CLOUD_GATEWAY',
            targetBranchId: row.branch_id || row.branchId || 'ALL',
          });
        }
      }
    } catch {
      // Skip tables that don't exist yet on this Supabase project
    }
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      envelopes,
      server_seq: maxUpdatedMs,
      hasMore: false,
      nextCursor: null,
      server_time: new Date().toISOString(),
      policy: DEFAULT_HUB_RUNTIME_POLICY,
    },
  };
}

async function handleFirebaseGateway(
  action: 'ping' | 'push_envelopes' | 'pull_catchup',
  body: any,
  creds: Record<string, any>,
  companyId: string
) {
  const projectId = String(creds.projectId || '').trim();
  const apiKey = String(creds.apiKey || '').trim();
  if (!/^[a-z0-9-]{4,64}$/.test(projectId)) {
    return {
      httpStatus: 400,
      body: { success: false, code: 'INVALID_FIREBASE_PROJECT', error: 'Invalid Firebase projectId.' },
    };
  }
  const qs = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  if (action === 'ping') {
    return {
      httpStatus: 200,
      body: {
        success: true,
        upstream: 'firebase',
        server_time: new Date().toISOString(),
        policy: DEFAULT_HUB_RUNTIME_POLICY,
      },
    };
  }

  if (action === 'push_envelopes') {
    const envelopes = Array.isArray(body.envelopes) ? body.envelopes.slice(0, 50) : [];
    const ackedPacketIds: string[] = [];
    const failed: Array<{ packetId: string; error: string }> = [];

    for (const env of envelopes) {
      if (!env || !env.entityType || !env.entityId || !env.data) continue;
      const col = resolveSafeTableName(env.entityType);
      const docId = encodeURIComponent(`${companyId}_${String(env.entityId).replace(/[^a-zA-Z0-9._-]/g, '_')}`);
      try {
        const res = await fetchJsonWithTimeout(
          `${baseUrl}/${encodeURIComponent(col)}/${docId}${qs}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                companyId: { stringValue: companyId },
                entityType: { stringValue: String(env.entityType) },
                entityId: { stringValue: String(env.entityId) },
                updatedAt: { integerValue: String(Number(env.updatedAt) || Date.now()) },
                payloadJson: { stringValue: JSON.stringify(env.data) },
              },
            }),
          },
          20000
        );
        if (res.ok) ackedPacketIds.push(String(env.packetId || env.entityId));
        else failed.push({ packetId: String(env.packetId || ''), error: `FIREBASE_HTTP_${res.status}` });
      } catch (err: any) {
        failed.push({ packetId: String(env.packetId || ''), error: err?.message || 'FIREBASE_PUSH_FAILED' });
      }
    }

    return {
      httpStatus: 200,
      body: {
        success: failed.length === 0 || ackedPacketIds.length > 0,
        ackedPacketIds,
        failed,
        conflicts: [],
        server_received_at: new Date().toISOString(),
        policy: DEFAULT_HUB_RUNTIME_POLICY,
      },
    };
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      envelopes: [],
      server_seq: Number(body.since_seq || 0),
      hasMore: false,
      nextCursor: null,
      server_time: new Date().toISOString(),
      policy: DEFAULT_HUB_RUNTIME_POLICY,
    },
  };
}

export function createSyncGatewayRouter(deps: GatewayDeps): Router {
  const router = express.Router();

  // Lightweight GET ping + policy discovery for frozen Hub APKs
  router.get('/', async (req: Request, res: Response) => {
    const action = String(req.query.action || 'ping').trim().toLowerCase();
    if (action !== 'ping') {
      return res.status(400).json({ success: false, code: 'UNSUPPORTED_GET_ACTION', error: 'Use POST for push_envelopes and pull_catchup.' });
    }
    return res.json({
      success: true,
      gateway: 'saimetric-cloud-sync-gateway',
      protocolVersion: DEFAULT_HUB_RUNTIME_POLICY.protocolVersion,
      server_time: new Date().toISOString(),
      policy: DEFAULT_HUB_RUNTIME_POLICY,
    });
  });

  // Unified Frozen Protocol POST endpoint: ping | push_envelopes | pull_catchup
  router.post('/', async (req: Request, res: Response) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || '').trim().toLowerCase();
      if (action !== 'ping' && action !== 'push_envelopes' && action !== 'pull_catchup') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ACTION',
          error: 'Supported actions: ping, push_envelopes, pull_catchup.',
        });
      }

      if (action === 'ping' && !body.company_id && !body.backend_type) {
        return res.json({
          success: true,
          gateway: 'saimetric-cloud-sync-gateway',
          protocolVersion: DEFAULT_HUB_RUNTIME_POLICY.protocolVersion,
          server_time: new Date().toISOString(),
          policy: DEFAULT_HUB_RUNTIME_POLICY,
        });
      }

      const companyId = String(body.company_id || body.companyId || '').trim().toUpperCase();
      if (!companyId) {
        return res.status(400).json({
          success: false,
          code: 'MISSING_COMPANY_ID',
          error: 'company_id is required on all gateway sync requests.',
        });
      }

      const storedCompany = deps.getCompanyRecord ? deps.getCompanyRecord(companyId) : undefined;
      const creds: Record<string, any> =
        body.credentials && typeof body.credentials === 'object' ? { ...body.credentials } : {};
      const backendType = String(
        body.backend_type ||
          storedCompany?.backend_config?.backendType ||
          storedCompany?.backend_type ||
          'appscripts'
      )
        .trim()
        .toLowerCase();

      if (backendType === 'supabase') {
        const mergedCreds = { ...(storedCompany?.backend_config?.supabase || {}), ...creds };
        const result = await handleSupabaseGateway(action, body, mergedCreds, companyId);
        return res.status(result.httpStatus).json(result.body);
      }

      if (backendType === 'firebase') {
        const mergedCreds = { ...(storedCompany?.backend_config?.firebase || {}), ...creds };
        const result = await handleFirebaseGateway(action, body, mergedCreds, companyId);
        return res.status(result.httpStatus).json(result.body);
      }

      if (backendType === 'mongodb') {
        const mergedCreds = { ...(storedCompany?.backend_config?.mongodb || {}), ...creds };
        const dataApiUrl = validateAllowedHttpsUrl(String(mergedCreds.url || '').trim().replace(/\/+$/, ''));
        const apiKey = String(mergedCreds.apiKey || '').trim();
        if (!dataApiUrl || !apiKey) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_MONGODB_CONFIG',
            error: 'Valid HTTPS MongoDB Data API URL and API key are required for gateway sync.',
          });
        }
        if (action === 'ping') {
          return res.json({
            success: true,
            upstream: 'mongodb',
            server_time: new Date().toISOString(),
            policy: DEFAULT_HUB_RUNTIME_POLICY,
          });
        }
        if (action === 'push_envelopes') {
          const envelopes = Array.isArray(body.envelopes) ? body.envelopes.slice(0, 50) : [];
          const ackedPacketIds: string[] = [];
          const failed: Array<{ packetId: string; error: string }> = [];
          const cleanBase = dataApiUrl.replace(/\/+$/, '');
          for (const env of envelopes) {
            if (!env || !env.entityType || !env.data) continue;
            const col = resolveSafeTableName(env.entityType);
            try {
              const r = await fetchJsonWithTimeout(
                `${cleanBase}/action/updateOne`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
                  body: JSON.stringify({
                    collection: col,
                    database: String(mergedCreds.database || 'saimetric_pos'),
                    filter: { id: String(env.entityId || env.data.id || ''), company_id: companyId },
                    update: { $set: { ...env.data, company_id: companyId, updatedAt: Number(env.updatedAt) || Date.now() } },
                    upsert: true,
                  }),
                },
                20000
              );
              if (r.ok) ackedPacketIds.push(String(env.packetId || env.entityId || ''));
              else failed.push({ packetId: String(env.packetId || ''), error: `MONGO_HTTP_${r.status}` });
            } catch (e: any) {
              failed.push({ packetId: String(env.packetId || ''), error: e?.message || 'MONGO_PUSH_FAILED' });
            }
          }
          return res.json({
            success: failed.length === 0 || ackedPacketIds.length > 0,
            ackedPacketIds,
            failed,
            conflicts: [],
            server_received_at: new Date().toISOString(),
            policy: DEFAULT_HUB_RUNTIME_POLICY,
          });
        }
        return res.json({
          success: true,
          envelopes: [],
          server_seq: Number(body.since_seq || 0),
          hasMore: false,
          nextCursor: null,
          server_time: new Date().toISOString(),
          policy: DEFAULT_HUB_RUNTIME_POLICY,
        });
      }

      // Default: Google Apps Script canonical backend
      const targetWebhook = String(
        creds.url ||
          creds.webhookUrl ||
          creds.masterWebhookUrl ||
          storedCompany?.webhook_url ||
          deps.getMasterWebhookUrl() ||
          DEFAULT_MASTER_WEBHOOK
      ).trim();
      const spreadsheetId = String(
        body.spreadsheet_id ||
          body.sheet_id ||
          body.tenant_sheet_id ||
          creds.spreadsheetId ||
          creds.sheetId ||
          storedCompany?.sheet_id ||
          ''
      ).trim();

      const result = await handleAppsScriptGateway(action, body, targetWebhook, companyId, spreadsheetId);
      return res.status(result.httpStatus).json(result.body);
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      return res.status(isAbort ? 504 : 500).json({
        success: false,
        code: isAbort ? 'UPSTREAM_TIMEOUT' : 'GATEWAY_ERROR',
        error: isAbort ? 'Cloud backend timed out.' : 'Gateway sync request failed.',
      });
    }
  });

  return router;
}
