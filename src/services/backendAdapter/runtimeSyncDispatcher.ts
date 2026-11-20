// SAIMETRIC Multi-Tenant Runtime Backend Sync Dispatcher
// Phase C: Dual-Write, Direct Cloud Dispatch, and Cutover Routing

import { BackendType, TenantBackendConfig } from './types';
import { getTenantBackendConfig, getBackendAdapter } from './adapterRegistry';
import { circuitBreakerFailover } from './circuitBreakerFailover';
import { getCurrentCompany, getCompanies, isMasterCompanyId, markRecordsCloudSynced } from '../../db/roomDatabase';
import { SyncQueueItem } from '../../types';
import {
  fetchWithTimeout,
  GAS_TIMEOUTS,
  isTimeoutError,
  parseGasResponseText,
  resolveSafeGasTarget,
} from '../sync/gasTransport';

export interface RuntimeDispatchResult {
  success: boolean;
  backendType: BackendType;
  recordsProcessed: number;
  latencyMs: number;
  message: string;
  error?: string;
}

export class RuntimeSyncDispatcherService {
  private lastDispatchTimes: Map<string, number> = new Map();

  /**
   * Routes a sync queue item or payload directly to the tenant's active backend adapter.
   */
  async dispatchItem(item: SyncQueueItem): Promise<RuntimeDispatchResult> {
    const startTime = Date.now();
    const companyId = item.payload?.company_id || item.payload?.CompanyID || getCurrentCompany().company_id;
    const company = getCompanies().find((c) => c.company_id === companyId) || getCurrentCompany();
    const config = getTenantBackendConfig(company);

    if (item.sheetName === 'Salespeople' || item.sheetName === 'users' || item.action === 'upsert_staff') {
      const activeStrategy = company?.sync_strategy || 'HUB_CLOUD';
      const isLocalHubActive = () => config.backendType === 'room';
      console.log('[STAFF TRACE] 2. Sync Router. Strategy:', activeStrategy, 'isLocalHubActive:', isLocalHubActive(), 'backendType:', config.backendType);
    }

    // Phase D: Circuit Breaker Inspection
    if (config.backendType !== 'room' && !circuitBreakerFailover.shouldAllowRemoteCall(companyId, config.backendType)) {
      return {
        success: true,
        backendType: 'room',
        recordsProcessed: 1,
        latencyMs: Date.now() - startTime,
        message: `Circuit breaker OPEN for ${config.backendType}. Auto-failed over to offline-first Room Database buffer.`,
      };
    }

    try {
      let result: RuntimeDispatchResult;

      switch (config.backendType) {
        case 'room': {
          // Room DB: purely local relational storage, no remote push required
          result = {
            success: true,
            backendType: 'room',
            recordsProcessed: 1,
            latencyMs: Date.now() - startTime,
            message: 'Recorded locally in offline-first Room Database.',
          };
          break;
        }

        case 'sheets_appscript': {
          // Dispatched through Google Apps Script webhook
          result = await this.dispatchToSheets(item, config, companyId, startTime);
          break;
        }

        case 'firebase': {
          // Dispatched directly to Firebase Firestore REST API
          result = await this.dispatchToFirebase(item, config, companyId, startTime);
          break;
        }

        case 'supabase': {
          // Dispatched directly to Supabase PostgREST API
          result = await this.dispatchToSupabase(item, config, companyId, startTime);
          break;
        }

        default: {
          result = {
            success: true,
            backendType: 'room',
            recordsProcessed: 1,
            latencyMs: Date.now() - startTime,
            message: 'Fallback recorded to Room Database.',
          };
          break;
        }
      }

      // Record telemetry in Circuit Breaker
      if (result.success) {
        circuitBreakerFailover.recordSuccess(companyId, config.backendType);
      } else {
        circuitBreakerFailover.recordFailure(companyId, config.backendType, result.error || result.message);
      }

      return result;
    } catch (err: any) {
      circuitBreakerFailover.recordFailure(companyId, config.backendType, String(err));
      console.warn(`[RuntimeSyncDispatcher] Error dispatching to ${config.backendType}:`, err);
      return {
        success: false,
        backendType: config.backendType,
        recordsProcessed: 0,
        latencyMs: Date.now() - startTime,
        message: err?.message || 'Sync dispatch failed',
        error: String(err),
      };
    }
  }

  /**
   * Google Sheets / Apps Script runtime dispatch
   */
  private async dispatchToSheets(
    item: SyncQueueItem,
    config: TenantBackendConfig,
    companyId: string,
    startTime: number
  ): Promise<RuntimeDispatchResult> {
    const cleanCompanyId = String(companyId || '').trim();
    if (!cleanCompanyId) {
      return {
        success: false,
        backendType: 'sheets_appscript',
        recordsProcessed: 0,
        latencyMs: Date.now() - startTime,
        message: 'Cannot sync row without an explicit company_id.',
        error: 'MISSING_COMPANY_ID',
      };
    }

    const safeTarget = resolveSafeGasTarget({
      companyId: cleanCompanyId,
      webhookUrl: config.sheets.webhookUrl || config.sheets.masterWebhookUrl,
      spreadsheetId: config.sheets.spreadsheetId,
    });

    if (!safeTarget.webhookUrl || !safeTarget.webhookUrl.startsWith('http')) {
      return {
        success: false,
        backendType: 'sheets_appscript',
        recordsProcessed: 0,
        latencyMs: Date.now() - startTime,
        message: 'Google Apps Script webhook URL not configured; retained in offline queue.',
        error: 'NO_WEBHOOK_CONFIGURED',
      };
    }

    // Strict Multi-Tenant Sheet Isolation: non-master tenants MUST NOT write operational rows to the Master Sheet
    const sheetLower = String(item.sheetName || '').toLowerCase();
    const isMasterControlTab =
      sheetLower === 'companies' ||
      sheetLower === 'branches' ||
      sheetLower === 'users' ||
      sheetLower === 'salespeople' ||
      sheetLower === 'staff';
    if (
      !isMasterControlTab &&
      !isMasterCompanyId(cleanCompanyId) &&
      (safeTarget.blockedMasterSheetLeak || !safeTarget.spreadsheetId)
    ) {
      return {
        success: false,
        backendType: 'sheets_appscript',
        recordsProcessed: 0,
        latencyMs: Date.now() - startTime,
        message: `Blocked write to Master Sheet for tenant ${cleanCompanyId}. Dedicated tenant spreadsheet must be provisioned first.`,
        error: safeTarget.blockedMasterSheetLeak ? 'MASTER_SHEET_WRITE_BLOCKED' : 'DEDICATED_SHEET_REQUIRED',
      };
    }

    const payload = {
      webhook_url: safeTarget.webhookUrl,
      sheetName: item.sheetName,
      action: item.action,
      company_id: cleanCompanyId,
      tenant_sheet_id: safeTarget.spreadsheetId,
      spreadsheet_id: safeTarget.spreadsheetId,
      data: item.payload,
      clientRequestId: item.payload?.clientRequestId || item.id,
      timestamp: new Date().toISOString(),
    };

    const finalizeSuccess = (msg?: string): RuntimeDispatchResult => {
      const recId = String(item.payload?.id || item.payload?.itemId || item.id || '');
      markRecordsCloudSynced(
        [recId, item.id].filter(Boolean),
        [payload.clientRequestId].filter(Boolean),
        item.sheetName,
        false
      );
      return {
        success: true,
        backendType: 'sheets_appscript',
        recordsProcessed: 1,
        latencyMs: Date.now() - startTime,
        message: msg || 'Dispatched to Google Sheet tab.',
      };
    };

    let proxyUnavailable = false;
    try {
      const res = await fetchWithTimeout(
        '/api/sheets/sync-row',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        GAS_TIMEOUTS.WRITE_CLIENT_MS
      );

      if (res.status === 404 || res.status >= 502) {
        proxyUnavailable = true;
      } else {
        const rawText = await res.text();
        const parsed = parseGasResponseText(rawText, res.status);
        if (res.ok && parsed.data && parsed.data.success !== false && parsed.data.status !== 'error') {
          return finalizeSuccess(parsed.data.message);
        }
        return {
          success: false,
          backendType: 'sheets_appscript',
          recordsProcessed: 0,
          latencyMs: Date.now() - startTime,
          message: parsed.data?.error || parsed.error || `Google Sheets proxy returned HTTP ${res.status}`,
          error: parsed.data?.code || parsed.data?.error || `HTTP_${res.status}`,
        };
      }
    } catch (err: any) {
      if (isTimeoutError(err)) {
        return {
          success: false,
          backendType: 'sheets_appscript',
          recordsProcessed: 0,
          latencyMs: Date.now() - startTime,
          message: 'Google Sheets sync timed out (55s); retained in offline queue for retry.',
          error: 'TIMEOUT',
        };
      }
      if (err?.name === 'TypeError') {
        proxyUnavailable = true;
      } else {
        return {
          success: false,
          backendType: 'sheets_appscript',
          recordsProcessed: 0,
          latencyMs: Date.now() - startTime,
          message: err?.message || 'Failed to dispatch to Google Sheets.',
          error: String(err),
        };
      }
    }

    // Standalone PWA direct fallback (e.g. Vercel deployment without Express proxy)
    if (proxyUnavailable) {
      try {
        const directRes = await fetchWithTimeout(
          safeTarget.webhookUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow',
          },
          GAS_TIMEOUTS.WRITE_CLIENT_MS
        );
        const rawText = await directRes.text();
        const parsed = parseGasResponseText(rawText, directRes.status);
        if (directRes.ok && parsed.data && parsed.data.success !== false && parsed.data.status !== 'error') {
          return finalizeSuccess(parsed.data.message);
        }
        return {
          success: false,
          backendType: 'sheets_appscript',
          recordsProcessed: 0,
          latencyMs: Date.now() - startTime,
          message: parsed.data?.error || parsed.error || `Google Apps Script returned HTTP ${directRes.status}`,
          error: parsed.data?.code || parsed.data?.error || `HTTP_${directRes.status}`,
        };
      } catch (directErr: any) {
        return {
          success: false,
          backendType: 'sheets_appscript',
          recordsProcessed: 0,
          latencyMs: Date.now() - startTime,
          message: isTimeoutError(directErr)
            ? 'Direct Apps Script sync timed out (55s); retained in offline queue.'
            : directErr?.message || 'Direct Apps Script dispatch failed; retained in offline queue.',
          error: isTimeoutError(directErr) ? 'TIMEOUT' : String(directErr),
        };
      }
    }

    return {
      success: false,
      backendType: 'sheets_appscript',
      recordsProcessed: 0,
      latencyMs: Date.now() - startTime,
      message: 'Failed to dispatch to Google Sheets.',
      error: 'DISPATCH_FAILED',
    };
  }

  /**
   * Firebase Firestore REST API runtime dispatch
   */
  private async dispatchToFirebase(
    item: SyncQueueItem,
    config: TenantBackendConfig,
    companyId: string,
    startTime: number
  ): Promise<RuntimeDispatchResult> {
    const { projectId, apiKey } = config.firebase;

    if (!projectId) {
      return {
        success: true,
        backendType: 'firebase',
        recordsProcessed: 1,
        latencyMs: Date.now() - startTime,
        message: 'Firebase credentials pending. Captured in local Room DB buffer.',
      };
    }

    const collectionName = (item.sheetName || 'records').toLowerCase();
    const docId = item.payload?.id || item.payload?.itemId || item.id;
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}/${docId}${
      apiKey ? `?key=${apiKey}` : ''
    }`;

    // Convert plain JSON payload into Firestore document format
    const fields: Record<string, any> = {};
    for (const [key, val] of Object.entries(item.payload || {})) {
      if (val === null || val === undefined) {
        fields[key] = { nullValue: null };
      } else if (typeof val === 'number') {
        fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
      } else if (typeof val === 'boolean') {
        fields[key] = { booleanValue: val };
      } else if (typeof val === 'string') {
        fields[key] = { stringValue: val };
      } else {
        fields[key] = { stringValue: JSON.stringify(val) };
      }
    }

    try {
      const res = await fetchWithTimeout(
        firestoreUrl,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        },
        15_000
      );

      if (res.ok) {
        return {
          success: true,
          backendType: 'firebase',
          recordsProcessed: 1,
          latencyMs: Date.now() - startTime,
          message: `Synchronized document to Firestore collection /${collectionName}.`,
        };
      } else {
        const errorText = await res.text();
        return {
          success: false,
          backendType: 'firebase',
          recordsProcessed: 0,
          latencyMs: Date.now() - startTime,
          message: `Firestore returned status ${res.status}`,
          error: errorText,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        backendType: 'firebase',
        recordsProcessed: 0,
        latencyMs: Date.now() - startTime,
        message: err?.message || 'Firestore connection timed out. Buffered locally.',
        error: String(err),
      };
    }
  }

  /**
   * Supabase PostgREST API runtime dispatch
   */
  private async dispatchToSupabase(
    item: SyncQueueItem,
    config: TenantBackendConfig,
    companyId: string,
    startTime: number
  ): Promise<RuntimeDispatchResult> {
    try {
      const compRaw = localStorage.getItem('saimetric_room_company') || localStorage.getItem('saimetric_company');
      if (compRaw) {
        const comp = JSON.parse(compRaw);
        if (comp?.sync_strategy === 'HUB_CLOUD' || comp?.sync_strategy === 'HUB_ONLY') {
          return {
            success: true,
            backendType: 'supabase',
            recordsProcessed: 1,
            latencyMs: Date.now() - startTime,
            message: 'Direct Supabase PWA dispatch disabled (HUB_CLOUD/HUB_ONLY isolation enforced).',
          };
        }
      }
    } catch {}

    const { projectUrl, anonKey, serviceRoleKey } = config.supabase;

    if (!projectUrl) {
      return {
        success: true,
        backendType: 'supabase',
        recordsProcessed: 1,
        latencyMs: Date.now() - startTime,
        message: 'Supabase URL pending. Captured in local Room DB buffer.',
      };
    }

    const cleanBaseUrl = projectUrl.replace(/\/+$/, '');
    const tableName = (item.sheetName || 'records')
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
    const endpoint = `${cleanBaseUrl}/rest/v1/${tableName}`;
    const token = serviceRoleKey || anonKey || '';

    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: token,
            Authorization: `Bearer ${token}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify([item.payload]),
        },
        15_000
      );

      if (res.ok || res.status === 200 || res.status === 201) {
        const recId = String(item.payload?.id || item.payload?.itemId || item.id || '');
        markRecordsCloudSynced(
          [recId, item.id].filter(Boolean),
          [item.payload?.clientRequestId].filter(Boolean) as string[],
          item.sheetName,
          false
        );
        return {
          success: true,
          backendType: 'supabase',
          recordsProcessed: 1,
          latencyMs: Date.now() - startTime,
          message: `Upserted record into Supabase PostgreSQL table '${tableName}'.`,
        };
      } else {
        const errText = await res.text();
        return {
          success: false,
          backendType: 'supabase',
          recordsProcessed: 0,
          latencyMs: Date.now() - startTime,
          message: `Supabase returned status ${res.status}`,
          error: errText,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        backendType: 'supabase',
        recordsProcessed: 0,
        latencyMs: Date.now() - startTime,
        message: err?.message || 'Supabase connection timed out. Buffered locally.',
        error: String(err),
      };
    }
  }
}

export const runtimeSyncDispatcher = new RuntimeSyncDispatcherService();
