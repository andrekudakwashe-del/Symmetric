import { getCurrentCompany, getSheetsConfig, isCloudConfigPurged } from '../../db/roomDatabase';

export type ActiveDatabaseType =
  | 'supabase'
  | 'appscripts'
  | 'mongodb'
  | 'firebase'
  | 'room'
  | 'none';

export interface ResolvedCloudConfig {
  databaseType: ActiveDatabaseType;
  rawBackendType: string;
  strategy: 'HUB_CLOUD' | 'HUB_ONLY' | 'CLOUD_ONLY';
  credentials: Record<string, any>;
}

export function normalizeDatabaseType(rawType?: string | null): ActiveDatabaseType {
  const clean = String(rawType || '').toLowerCase().trim();
  if (!clean) return 'none';
  if (clean === 'supabase') return 'supabase';
  if (clean === 'mongodb' || clean === 'mongo') return 'mongodb';
  if (
    clean === 'appscripts' ||
    clean === 'sheets_appscript' ||
    clean === 'google_sheets' ||
    clean === 'appsscript'
  ) {
    return 'appscripts';
  }
  if (clean === 'firebase') return 'firebase';
  if (clean === 'room') return 'room';
  return 'none';
}

/**
 * Resolves the single active cloud databaseType and credentials for the current tenant.
 * Used by SyncCore / Hexagonal Router & all Cloud Adapters to guarantee strict single-cloud
 * routing (no dual-racing).
 */
export function getActiveCloudConfig(): ResolvedCloudConfig {
  try {
    const comp: any = getCurrentCompany();
    const strategyRaw = String(comp?.sync_strategy || '').toUpperCase().trim();
    const strategy: 'HUB_CLOUD' | 'HUB_ONLY' | 'CLOUD_ONLY' =
      strategyRaw === 'CLOUD_ONLY'
        ? 'CLOUD_ONLY'
        : strategyRaw === 'HUB_ONLY'
        ? 'HUB_ONLY'
        : 'HUB_CLOUD';

    const backendCfg: any = comp?.backend_config || {};
    const rawType = String(
      backendCfg?.backendType || comp?.backend_type || ''
    )
      .toLowerCase()
      .trim();

    let databaseType = normalizeDatabaseType(rawType);

    if (databaseType === 'none') {
      const hasMongo = Boolean(
        backendCfg?.mongodb?.mongoUri ||
          backendCfg?.mongodb?.uri ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_mongo_uri'))
      );
      const hasSupabase = Boolean(
        (backendCfg?.supabase?.projectUrl ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_supabase_url'))) &&
          (backendCfg?.supabase?.serviceRoleKey ||
            backendCfg?.supabase?.anonKey ||
            backendCfg?.supabase?.apiKey ||
            (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_supabase_key')))
      );
      if (hasMongo) databaseType = 'mongodb';
      else if (hasSupabase) databaseType = 'supabase';
      else if (comp?.sheet_id || comp?.webhook_url || backendCfg?.sheets?.webhookUrl) {
        databaseType = 'appscripts';
      } else {
        databaseType = 'room';
      }
    }

    const purged = isCloudConfigPurged() && strategy !== 'CLOUD_ONLY';

    if (databaseType === 'supabase') {
      const sb = backendCfg?.supabase || {};
      const url = String(
        sb.projectUrl ||
          sb.url ||
          (!purged && typeof localStorage !== 'undefined'
            ? localStorage.getItem('saimetric_supabase_url') || ''
            : '')
      ).trim();
      const apiKey = String(
        sb.serviceRoleKey ||
          sb.anonKey ||
          sb.apiKey ||
          (!purged && typeof localStorage !== 'undefined'
            ? localStorage.getItem('saimetric_supabase_key') || ''
            : '')
      ).trim();
      return {
        databaseType,
        rawBackendType: rawType || 'supabase',
        strategy,
        credentials: {
          url,
          projectUrl: url,
          apiKey,
          anonKey: String(sb.anonKey || apiKey || '').trim(),
          serviceRoleKey: String(sb.serviceRoleKey || '').trim(),
          schema: String(sb.schema || 'public').trim(),
        },
      };
    }

    if (databaseType === 'mongodb') {
      const mg = backendCfg?.mongodb || {};
      const mongoUri = String(
        mg.mongoUri ||
          mg.uri ||
          (!purged && typeof localStorage !== 'undefined'
            ? localStorage.getItem('saimetric_mongo_uri') || ''
            : '')
      ).trim();
      return {
        databaseType,
        rawBackendType: rawType || 'mongodb',
        strategy,
        credentials: {
          mongoUri,
          url: String(mg.url || '').trim(),
          apiKey: String(mg.apiKey || '').trim(),
          database: String(mg.database || 'saimetric_pos').trim(),
        },
      };
    }

    if (databaseType === 'firebase') {
      const fb = backendCfg?.firebase || {};
      return {
        databaseType,
        rawBackendType: rawType || 'firebase',
        strategy,
        credentials: {
          projectId: String(fb.projectId || '').trim(),
          apiKey: String(fb.apiKey || '').trim(),
          url: String(fb.databaseURL || '').trim(),
          appId: String(fb.appId || '').trim(),
          authDomain: String(fb.authDomain || '').trim(),
          databaseId: String(fb.databaseId || '').trim(),
        },
      };
    }

    if (databaseType === 'appscripts') {
      const sheets = backendCfg?.sheets || {};
      const legacy = purged ? null : getSheetsConfig();
      const url = String(
        sheets.webhookUrl ||
          comp?.webhook_url ||
          (!purged ? legacy?.webhookUrl || legacy?.masterWebhookUrl || '' : '')
      ).trim();
      const masterWebhookUrl = String(
        sheets.masterWebhookUrl || (!purged ? legacy?.masterWebhookUrl || '' : '')
      ).trim();
      const spreadsheetId = String(
        sheets.spreadsheetId || comp?.sheet_id || (!purged ? legacy?.spreadsheetId || '' : '')
      ).trim();
      return {
        databaseType,
        rawBackendType: rawType || 'sheets_appscript',
        strategy,
        credentials: {
          url: url || masterWebhookUrl,
          webhookUrl: url,
          masterWebhookUrl,
          spreadsheetId,
          sheetFolderId: String(sheets.sheetFolderId || comp?.sheet_folder_id || '').trim(),
        },
      };
    }

    return {
      databaseType,
      rawBackendType: rawType || databaseType,
      strategy,
      credentials: {},
    };
  } catch {
    return {
      databaseType: 'room',
      rawBackendType: 'room',
      strategy: 'HUB_CLOUD',
      credentials: {},
    };
  }
}

export const ENTITY_TO_CLOUD_TABLE: Record<string, string> = {
  sale: 'sales',
  sales: 'sales',
  inventory_item: 'inventory',
  inventory: 'inventory',
  staff: 'staff',
  salespeople: 'staff',
  branch: 'branches',
  branches: 'branches',
  customer: 'customers',
  customers: 'customers',
  customer_change: 'customer_changes',
  customer_changes: 'customer_changes',
  credit_sale: 'credit_sales',
  credit_sales: 'credit_sales',
  credit_group: 'credit_groups',
  cash_log: 'cash_logs',
  cash_logs: 'cash_logs',
  cash_lift: 'cash_lifts',
  cash_movement: 'cash_movements',
  cash_account: 'cash_accounts',
  cash_transfer: 'cash_transfers',
  direct_grv: 'direct_grvs',
  direct_grvs: 'direct_grvs',
  grv: 'direct_grvs',
  goods_received: 'goods_received',
  stock_movement: 'stock_movements',
  stock_movements: 'stock_movements',
  stock_adjustment: 'stock_adjustments',
  stock_adjustments: 'stock_adjustments',
  expense: 'expenses',
  expenses: 'expenses',
  internal_consumption: 'internal_consumption',
  supervisor_approval: 'audit_logs',
  audit_log: 'audit_logs',
  reconciliation: 'reconciliations',
  business_day_closure: 'business_day_closures',
  electronic_settlement: 'electronic_settlements',
  cash_count: 'cash_counts',
  admin_sales: 'admin_sales',
  supplier_invoice_voucher: 'supplier_invoices',
  supplier: 'suppliers',
  inventory_category: 'categories',
  stocktake_session: 'stocktake_sessions',
  stocktake_segment: 'stocktake_segments',
  casual_worker: 'casual_workers',
  system_settings: 'settings',
  multi_currency: 'multi_currency',
  permissions_matrix: 'permissions_matrix',
  role_configs: 'role_configs',
};

export function mapEntityTypeToCloudTable(entityType: string): string {
  const key = String(entityType || '').trim().toLowerCase();
  return ENTITY_TO_CLOUD_TABLE[key] || key || 'records';
}
