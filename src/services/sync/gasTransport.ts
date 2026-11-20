import {
  DEFAULT_MASTER_SPREADSHEET_ID,
  DEFAULT_MASTER_WEBHOOK_URL,
  getSheetsConfig,
  isMasterCompanyId,
  isMasterSpreadsheetId,
  sanitizeMasterWebhookUrl,
  sanitizeTenantSheetId,
} from '../../db/roomDatabase';

/**
 * Standardized Google Apps Script timeout hierarchy.
 * Rule: Client timeouts are ALWAYS 8-10 seconds longer than Express proxy timeouts
 * so the browser never aborts a request while the server/Apps Script is still finishing.
 */
export const GAS_TIMEOUTS = {
  AUTH_SERVER_MS: 20_000,
  AUTH_CLIENT_MS: 28_000,
  READ_SERVER_MS: 30_000,
  READ_CLIENT_MS: 38_000,
  WRITE_SERVER_MS: 45_000,
  WRITE_CLIENT_MS: 55_000,
  HEAVY_SERVER_MS: 65_000,
  HEAVY_CLIENT_MS: 75_000,
} as const;

/**
 * Universal AbortController-based fetch timeout helper.
 * Works reliably across all browsers and embedded Android WebViews (GBox, older Chrome, Safari)
 * where AbortSignal.timeout() may be unavailable or inconsistent.
 */
export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = GAS_TIMEOUTS.READ_CLIENT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const sleepMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const isTimeoutError = (err: any): boolean =>
  err?.name === 'AbortError' || err?.name === 'TimeoutError';

export interface ParsedGasBody {
  data: any | null;
  isHtml: boolean;
  error?: string;
}

/**
 * Safely parse an Apps Script response body and explicitly detect HTML error / Google Login
 * pages returned when a Web App deployment lacks "Who has access: Anyone".
 */
export const parseGasResponseText = (rawText: string, httpStatus?: number): ParsedGasBody => {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    return {
      data: null,
      isHtml: false,
      error: httpStatus ? `Empty response from Apps Script (HTTP ${httpStatus})` : 'Empty response from Apps Script',
    };
  }
  try {
    const parsed = JSON.parse(trimmed);
    return { data: parsed, isHtml: false };
  } catch {
    const isHtml =
      trimmed.startsWith('<') ||
      trimmed.toLowerCase().includes('<!doctype html') ||
      trimmed.toLowerCase().includes('<html');
    return {
      data: null,
      isHtml,
      error: isHtml
        ? 'Google Apps Script returned an HTML page instead of JSON. Verify the Web App deployment ("Execute as: Me", "Who has access: Anyone") and Master Webhook URL.'
        : `Invalid JSON from Apps Script${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${trimmed.slice(0, 120)}`,
    };
  }
};

export interface SafeGasTarget {
  webhookUrl: string;
  spreadsheetId: string;
  masterSpreadsheetId: string;
  blockedMasterSheetLeak: boolean;
}

/**
 * Resolve sanitized Apps Script webhook URL and tenant spreadsheet ID.
 * Strictly blocks assigning the Master Spreadsheet ID to non-master tenants.
 */
export const resolveSafeGasTarget = (params: {
  companyId?: string | null;
  webhookUrl?: string | null;
  spreadsheetId?: string | null;
}): SafeGasTarget => {
  const cfg = getSheetsConfig();
  const masterSpreadsheetId = cfg.masterSpreadsheetId || DEFAULT_MASTER_SPREADSHEET_ID;
  const cleanCompanyId = String(params.companyId || '').trim();
  const rawSheetId = String(params.spreadsheetId || '').trim();
  const blockedMasterSheetLeak = Boolean(
    rawSheetId &&
      cleanCompanyId &&
      !isMasterCompanyId(cleanCompanyId) &&
      isMasterSpreadsheetId(rawSheetId, masterSpreadsheetId)
  );
  const safeSheetId = cleanCompanyId
    ? sanitizeTenantSheetId(cleanCompanyId, rawSheetId, masterSpreadsheetId)
    : rawSheetId;
  const safeWebhook = sanitizeMasterWebhookUrl(
    params.webhookUrl || cfg.webhookUrl || cfg.masterWebhookUrl || DEFAULT_MASTER_WEBHOOK_URL
  );
  return {
    webhookUrl: safeWebhook,
    spreadsheetId: safeSheetId,
    masterSpreadsheetId,
    blockedMasterSheetLeak,
  };
};

export interface GasPingResult {
  online: boolean;
  latencyMs: number;
  version?: string;
  schemaVersion?: number;
  isLegacyDeployment?: boolean;
  error?: string;
}

/**
 * Real JSON health probe against Google Apps Script (`GET ?action=ping`).
 * Replaces blind `mode: 'no-cors'` probes that falsely reported broken or legacy V1 deployments as healthy.
 */
export const pingGasDeployment = async (
  webhookUrl?: string | null,
  timeoutMs: number = 18_000
): Promise<GasPingResult> => {
  const targetUrl = sanitizeMasterWebhookUrl(webhookUrl);
  const start = Date.now();
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return {
      online: false,
      latencyMs: 0,
      error: 'Google Apps Script Webhook URL is not configured.',
    };
  }

  try {
    const sep = targetUrl.includes('?') ? '&' : '?';
    const res = await fetchWithTimeout(
      `${targetUrl}${sep}action=ping&_t=${Date.now()}`,
      { method: 'GET', redirect: 'follow' },
      timeoutMs
    );
    const latencyMs = Date.now() - start;
    const text = await res.text();
    const parsed = parseGasResponseText(text, res.status);

    if (parsed.data && (parsed.data.success === true || parsed.data.status === 'online')) {
      const schemaVersion = Number(parsed.data.schema_version || 0);
      return {
        online: true,
        latencyMs,
        version: String(parsed.data.version || 'V7.0'),
        schemaVersion: schemaVersion || undefined,
        isLegacyDeployment: schemaVersion > 0 && schemaVersion < 7,
      };
    }

    if (text.includes('SAIMETRIC Google Sheets Sync Webhook is Active')) {
      return {
        online: false,
        latencyMs,
        isLegacyDeployment: true,
        error: 'Webhook points to an outdated V1 Apps Script deployment. Deploy V7.0 Code.gs.',
      };
    }

    return {
      online: false,
      latencyMs,
      error: parsed.error || String(parsed.data?.error || parsed.data?.message || `HTTP ${res.status}`),
    };
  } catch (err: any) {
    return {
      online: false,
      latencyMs: Date.now() - start,
      error: isTimeoutError(err)
        ? `Apps Script ping timed out after ${Math.round(timeoutMs / 1000)}s.`
        : err?.message || String(err),
    };
  }
};
