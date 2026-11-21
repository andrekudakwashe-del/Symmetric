import {
  backupCryptoService,
  PayloadHmacBlock,
} from './backupCryptoService';
import {
  cleanupLocalStorageQuota,
  runPinHashingMigration,
  getCurrentCompanyId,
  getCurrentBranchId,
  getTombstones,
  extractRecordTimestamp,
  parseTimestampMs,
  enqueueSync,
} from '../db/roomDatabase';
import { toDateStringSafe, safeDateSlice, isSameDaySafe } from '../utils/dateUtils';
import { SyncEnvelope, SyncAction } from './sync/SyncEnvelope';
import { ENTITY_REGISTRY } from './sync/EntityRegistry';
import { SyncCore, BatchIngestResult } from './sync/syncCore';
import { SyncAdapter } from './sync/SyncAdapter';
import {
  getSyncCoreIngestBatchBridge,
  saveAndSyncThroughBridge,
} from './sync/syncIngestBridge';
import {
  lookupLocalRecordForCloudEnvelope,
  applyCloudEnvelopeToRoomDb,
} from './sync/cloudEnvelopeIngestor';

export type BackupType = 'FULL' | 'DELTA' | 'EOD_HANDOVER' | 'ADMIN_MASTER_UPDATE';

export const MAX_RECOMMENDED_BACKUP_BYTES = 15 * 1024 * 1024; // 15 MB WhatsApp/mobile safety threshold
export const FILE_IMPORT_LWW_TOLERANCE_MS = 5000; // 5000ms LWW check for T2 file imports

export interface BackupDateRange {
  startDate: string; // YYYY-MM-DD (inclusive)
  endDate: string;   // YYYY-MM-DD (inclusive)
}

export interface HandoverSummary {
  branchName?: string;
  supervisorName?: string;
  shiftDate?: string;
  totalSalesUsd: number;
  totalSalesCount: number;
  totalCashInDrawer: number;
  cashVariance: number;
  creditIssuedUsd: number;
  uncollectedChangeUsd: number;
  shiftNotes?: string;
}

export interface BackupManifest {
  app: 'SAIMETRIC';
  version: '5.0.0';
  backupVersion: 2 | 3;
  format?: 'HEXAGONAL_SYNC_ENVELOPE' | 'LEGACY_TABLE_DUMP';
  backupType: BackupType;
  timestamp: string; // ISO string
  coverageStart?: string; // Cutoff start timestamp / date
  coverageEnd: string;
  dateRange?: BackupDateRange;
  lastBackupTimestamp?: string | null;
  companyId?: string;
  companyName?: string;
  branchId?: string;
  originDeviceId?: string;
  exportedBy?: string;
  clearanceLevel?: number;
  clearanceRole?: string;
  totalRecords: number;
  t1Count?: number;
  t2Count?: number;
  tombstoneCount?: number;
  estimatedBytes?: number;
  exceeds15MB?: boolean;
  hmacProtected?: boolean;
  tablesCount: Record<string, number>;
  handoverSummary?: HandoverSummary;
  isMasterOnly?: boolean;
}

export interface BackupPayload {
  manifest: BackupManifest;
  /** Hexagonal Sync v3 canonical envelope stream */
  envelopes?: SyncEnvelope[];
  /** Legacy v2 compatibility field (still accepted on import and auto-converted to SyncEnvelope[]) */
  tables?: Record<string, any[]>;
  metadata: Record<string, any>;
  hmac?: PayloadHmacBlock;
}

export interface RestoreResult {
  success: boolean;
  message: string;
  backupType: BackupType;
  timestamp: string;
  recordsProcessed: number;
  recordsAdded: number;
  recordsUpdated: number;
  t1Accepted?: number;
  t1Deduped?: number;
  t2Accepted?: number;
  t2StaleRejected?: number;
  balancesProtected?: number;
  resurrectionBlocked?: number;
  selfOriginSkipped?: number;
  queuedForHubSync?: number;
  hmacVerified?: boolean;
  tampered?: boolean;
  companyId?: string;
  branchId?: string;
  isMasterOnly?: boolean;
  protectedTablesPreserved?: number;
  error?: string;
}

// Transactional tables / entity types protected during explicit master_only push
export const PROTECTED_TRANSACTIONAL_TABLES = [
  'saimetric_room_sales',
  'saimetric_room_cash_logs',
  'saimetric_room_cash_counts',
  'saimetric_room_cash_lifts',
  'saimetric_room_cash_movements',
  'saimetric_room_reconciliations',
  'saimetric_room_customer_changes',
  'saimetric_room_credit_sales',
];

const PROTECTED_MASTER_ONLY_ENTITY_TYPES = new Set<string>([
  'sale',
  'cash_log',
  'cash_count',
  'cash_lift',
  'cash_movement',
  'reconciliation',
  'customer_change',
  'credit_sale',
]);

// Storage key names
export const STORAGE_LAST_BACKUP_TIME = 'saimetric_last_backup_timestamp';
export const STORAGE_LAST_BACKUP_TYPE = 'saimetric_last_backup_type';
export const STORAGE_BACKUP_HISTORY = 'saimetric_backup_history';

export interface BackupEntitySourceConfig {
  key: string;
  name: string;
  primaryKey: string;
  entityType: string;
  tier: 'T1' | 'T2';
  isMasterData?: boolean;
  isSingleton?: boolean;
  isArrayPayload?: boolean;
}

/**
 * Canonical mapping of persistent storage tables to Hexagonal Sync EntityRegistry types.
 * Explicitly EXCLUDES T3 local-only scratchpads (negative_balance, customer_goods_left_behind,
 * fast_moving_checklist, parked_sale) and T4 derived mirrors (saimetric_room_products).
 */
export const BACKUP_STORAGE_TABLES: BackupEntitySourceConfig[] = [
  // ---- T2 CONFIG & MASTER ENTITIES (Full snapshot on every export; balances protected on import) ----
  { key: 'saimetric_room_companies', name: 'Companies', primaryKey: 'company_id', entityType: 'company', tier: 'T2', isMasterData: true },
  { key: 'saimetric_branches', name: 'Branches', primaryKey: 'id', entityType: 'branch', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_salespeople', name: 'Staff & Salespeople', primaryKey: 'id', entityType: 'staff', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_inventory_items', name: 'Inventory Items', primaryKey: 'itemId', entityType: 'inventory_item', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_stock_batches', name: 'Stock Batches', primaryKey: 'id', entityType: 'stock_batch', tier: 'T2', isMasterData: true },
  { key: 'saimetric_packaging_variants', name: 'Packaging Variants', primaryKey: 'id', entityType: 'packaging_variant', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_categories', name: 'Product Categories', primaryKey: 'id', entityType: 'inventory_category', tier: 'T2', isMasterData: true, isArrayPayload: true },
  { key: 'saimetric_room_customers', name: 'Customers', primaryKey: 'customerId', entityType: 'customer', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_credit_groups', name: 'Credit Groups', primaryKey: 'id', entityType: 'credit_group', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_suppliers', name: 'Suppliers', primaryKey: 'supplierId', entityType: 'supplier', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_cash_accounts', name: 'Cash Accounts', primaryKey: 'account_id', entityType: 'cash_account', tier: 'T2', isMasterData: true },
  { key: 'saimetric_wallets', name: 'Wallets', primaryKey: 'id', entityType: 'wallet', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_procurement_trips', name: 'Procurement Trips', primaryKey: 'id', entityType: 'procurement_trip', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_stocktake_sessions', name: 'Stocktake Sessions', primaryKey: 'sessionId', entityType: 'stocktake_session', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_temporary_casuals', name: 'Stocktake Casuals', primaryKey: 'id', entityType: 'casual_worker', tier: 'T2', isMasterData: true },
  { key: 'saimetric_room_exchange_rates', name: 'Exchange Rates', primaryKey: 'id', entityType: 'multi_currency', tier: 'T2', isMasterData: true, isSingleton: true },
  { key: 'saimetric_room_permissions', name: 'Permissions', primaryKey: 'id', entityType: 'permissions_matrix', tier: 'T2', isMasterData: true, isArrayPayload: true },
  { key: 'saimetric_role_configs_v1', name: 'Role Configurations', primaryKey: 'id', entityType: 'role_configs', tier: 'T2', isMasterData: true, isSingleton: true },
  { key: 'saimetric_credit_policy', name: 'Credit Policy', primaryKey: 'id', entityType: 'credit_policy', tier: 'T2', isMasterData: true, isSingleton: true },

  // ---- T1 TRANSACTIONAL LEDGER EVENTS (Filtered strictly by selected Date Range) ----
  { key: 'saimetric_room_sales', name: 'Sales Invoices', primaryKey: 'id', entityType: 'sale', tier: 'T1' },
  { key: 'saimetric_room_direct_grvs', name: 'Direct GRVs', primaryKey: 'grvNumber', entityType: 'direct_grv', tier: 'T1' },
  { key: 'saimetric_room_goods_received', name: 'Goods Received', primaryKey: 'id', entityType: 'goods_received', tier: 'T1' },
  { key: 'saimetric_room_stock_movements', name: 'Stock Movements', primaryKey: 'id', entityType: 'stock_movement', tier: 'T1' },
  { key: 'saimetric_room_expenses', name: 'Expenses', primaryKey: 'id', entityType: 'expense', tier: 'T1' },
  { key: 'saimetric_room_cash_logs', name: 'Cash Logs', primaryKey: 'id', entityType: 'cash_log', tier: 'T1' },
  { key: 'saimetric_room_cash_movements', name: 'Cash Movements', primaryKey: 'id', entityType: 'cash_movement', tier: 'T1' },
  { key: 'saimetric_room_cash_lifts', name: 'Cash Lifts', primaryKey: 'id', entityType: 'cash_lift', tier: 'T1' },
  { key: 'saimetric_room_cash_transfers', name: 'Cash Transfers', primaryKey: 'transfer_id', entityType: 'cash_transfer', tier: 'T1' },
  { key: 'saimetric_room_cash_counts', name: 'Cash Counts', primaryKey: 'id', entityType: 'cash_count', tier: 'T1' },
  { key: 'saimetric_room_reconciliations', name: 'Reconciliations', primaryKey: 'id', entityType: 'reconciliation', tier: 'T1' },
  { key: 'saimetric_room_business_day_closures', name: 'Business Day Closures', primaryKey: 'id', entityType: 'business_day_closure', tier: 'T1' },
  { key: 'saimetric_room_electronic_settlements', name: 'Electronic Settlements', primaryKey: 'id', entityType: 'electronic_settlement', tier: 'T1' },
  { key: 'saimetric_room_admin_sales', name: 'Admin Sales', primaryKey: 'id', entityType: 'admin_sales', tier: 'T1' },
  { key: 'saimetric_room_supplier_invoices', name: 'Supplier Invoices', primaryKey: 'voucherId', entityType: 'supplier_invoice_voucher', tier: 'T1' },
  { key: 'saimetric_supplier_payables', name: 'Supplier Payables', primaryKey: 'id', entityType: 'supplier_payable', tier: 'T1' },
  { key: 'saimetric_room_customer_changes', name: 'Customer Changes', primaryKey: 'id', entityType: 'customer_change', tier: 'T1' },
  { key: 'saimetric_room_credit_sales', name: 'Credit Sales', primaryKey: 'id', entityType: 'credit_sale', tier: 'T1' },
  { key: 'saimetric_room_customer_ledger', name: 'Customer Ledger', primaryKey: 'id', entityType: 'customer_ledger', tier: 'T1' },
  { key: 'saimetric_internal_consumption', name: 'Internal Consumption', primaryKey: 'id', entityType: 'internal_consumption', tier: 'T1' },
  { key: 'saimetric_wallet_transfers', name: 'Wallet Transfers', primaryKey: 'id', entityType: 'wallet_transfer', tier: 'T1' },
  { key: 'saimetric_owner_drawings', name: 'Owner Drawings', primaryKey: 'id', entityType: 'owner_drawing', tier: 'T1' },
  { key: 'saimetric_room_audit_logs', name: 'Audit Logs', primaryKey: 'id', entityType: 'audit_log', tier: 'T1' },
];

// Legacy key aliases (e.g., older backups exported 'saimetric_companies' instead of 'saimetric_room_companies')
const LEGACY_TABLE_KEY_TO_ENTITY_TYPE: Record<string, { entityType: string; primaryKey: string; tier: 'T1' | 'T2' }> = {
  saimetric_companies: { entityType: 'company', primaryKey: 'company_id', tier: 'T2' },
  saimetric_room_goods_received_notes: { entityType: 'goods_received', primaryKey: 'id', tier: 'T1' },
};

function getLocalDeviceId(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem('saimetric_mesh_sync_config');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.deviceId) return String(parsed.deviceId);
      }
      const fallback = window.localStorage.getItem('saimetric_device_id');
      if (fallback) return fallback;
    } catch {}
  }
  return 'DEV-LOCAL-FILE';
}

/**
 * Get timestamp of the last recorded backup
 */
export function getLastBackupTimestamp(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage.getItem(STORAGE_LAST_BACKUP_TIME);
}

/**
 * Record successful backup metadata in local storage
 */
export function recordBackupCompletion(type: BackupType, timestamp: string, fileName?: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(STORAGE_LAST_BACKUP_TIME, timestamp);
  window.localStorage.setItem(STORAGE_LAST_BACKUP_TYPE, type);

  try {
    const rawHistory = window.localStorage.getItem(STORAGE_BACKUP_HISTORY);
    const history = rawHistory ? JSON.parse(rawHistory) : [];
    const entry = {
      timestamp,
      type,
      fileName,
      date: toDateStringSafe(timestamp),
    };
    const updated = [entry, ...history].slice(0, 10);
    window.localStorage.setItem(STORAGE_BACKUP_HISTORY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[DatabaseBackupService] Error saving backup history:', err);
  }
}

/**
 * Compute the cutoff date for Delta Backup:
 * min(1st day of current month, lastBackupTimestamp)
 */
export function calculateDeltaCutoff(now: Date = new Date()): { cutoffDate: Date; cutoffIso: string } {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const startOfCurrentMonth = new Date(Date.UTC(currentYear, currentMonth, 1, 0, 0, 0, 0));

  const lastBackupStr = getLastBackupTimestamp();
  if (lastBackupStr) {
    const lastBackupDate = new Date(lastBackupStr);
    if (!isNaN(lastBackupDate.getTime())) {
      const earlier = lastBackupDate.getTime() < startOfCurrentMonth.getTime() ? lastBackupDate : startOfCurrentMonth;
      return { cutoffDate: earlier, cutoffIso: earlier.toISOString() };
    }
  }

  return { cutoffDate: startOfCurrentMonth, cutoffIso: startOfCurrentMonth.toISOString() };
}

/**
 * Extract canonical YYYY-MM-DD date string from any T1 record
 */
function extractRecordDateStr(rec: any): string {
  if (!rec || typeof rec !== 'object') return '';
  const directDate = rec.date || rec.dateReceived || rec.shiftDate || rec.invoiceDate;
  if (typeof directDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(directDate)) {
    return directDate.slice(0, 10);
  }
  const ts = rec.timestamp || rec.createdAt || rec.updatedAt || rec.lastUpdated;
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ts)) {
    return ts.slice(0, 10);
  }
  const ms = parseTimestampMs(ts);
  if (ms > 0) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  return '';
}

/**
 * Smart T1 date-range filter (inclusive YYYY-MM-DD bounds)
 */
function filterT1RecordsByDateRange(records: any[], dateRange?: BackupDateRange): any[] {
  if (!Array.isArray(records)) return [];
  if (!dateRange || (!dateRange.startDate && !dateRange.endDate)) return records;

  const start = dateRange.startDate ? dateRange.startDate.slice(0, 10) : '0000-01-01';
  const end = dateRange.endDate ? dateRange.endDate.slice(0, 10) : '9999-12-31';

  return records.filter((rec) => {
    if (!rec) return false;
    const recDate = extractRecordDateStr(rec);
    if (!recDate) return false;
    return recDate >= start && recDate <= end;
  });
}

function resolveRecordEntityId(rec: any, primaryKey: string, fallbackIndex: number): string {
  const candidate =
    rec?.[primaryKey] ||
    rec?.id ||
    rec?.itemId ||
    rec?.grvNumber ||
    rec?.voucherId ||
    rec?.transfer_id ||
    rec?.account_id ||
    rec?.customerId ||
    rec?.supplierId ||
    rec?.sessionId ||
    rec?.txnId ||
    rec?.movementId ||
    rec?.company_id ||
    rec?._id;
  if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
    return String(candidate).trim();
  }
  return `REC-${fallbackIndex}`;
}

function sanitizeRecordForExport(entityType: string, rec: any): any {
  if (!rec || typeof rec !== 'object') return rec;
  const sanitized = { ...rec };
  // CRITICAL SECURITY: Never export plaintext PINs
  if (entityType === 'staff' || entityType === 'casual_worker') {
    delete sanitized.pin;
  }
  // File exports MUST NOT carry isCloudSynced: true so recipients sync normally to Hub/Cloud
  if (sanitized.isCloudSynced === true) {
    sanitized.isCloudSynced = false;
  }
  return sanitized;
}

function buildSyncEnvelopeForRecord(params: {
  entityType: string;
  entityId: string;
  tier: 'T1' | 'T2';
  data: any;
  originDeviceId: string;
  branchId: string;
  exportStamp: number;
}): SyncEnvelope {
  const { entityType, entityId, tier, data, originDeviceId, branchId, exportStamp } = params;
  const action: SyncAction = tier === 'T1' ? 'APPEND' : 'UPSERT';
  const updatedAt = extractRecordTimestamp(data) || exportStamp;
  const version = data?.version !== undefined && !isNaN(Number(data.version)) ? Number(data.version) : undefined;
  const mutationSource = data?.mutationSource;

  return {
    packetId: `WAFILE-${entityType}-${entityId}-${updatedAt}-${exportStamp}`,
    entityType,
    entityId,
    action,
    data,
    updatedAt,
    ...(version !== undefined ? { version } : {}),
    ...(mutationSource ? { mutationSource } : {}),
    originDeviceId,
    targetBranchId: data?.branch_id || data?.branchId || branchId || 'ALL',
    class: tier,
    isCloudSynced: false,
    meta: {
      source: 'WHATSAPP_FILE_EXPORT',
    },
  };
}

/**
 * Estimate UTF-8 serialized byte size of a payload (for the 15MB WhatsApp warning guard)
 */
export function estimatePayloadByteSize(payload: any): number {
  try {
    const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (typeof Blob !== 'undefined') {
      return new Blob([json]).size;
    }
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return 0;
  }
}

/**
 * Generate a Hexagonal SyncEnvelope[] payload with:
 * - Smart T1 Date-Range filtering (only T1 transactions inside dateRange)
 * - Full T2 Config snapshot (all Inventory, Staff, Customers, Suppliers, Cash Accounts, Wallets, Rates, Roles)
 * - Bi-directional flexibility (no user role lockouts)
 * - HMAC-SHA256 tamper-detection signature
 * - >15MB size estimation flag
 */
export async function generateDatabasePayload(
  type: BackupType = 'DELTA',
  exportedBy?: string,
  shiftNotes?: string,
  clearanceLevel?: number,
  clearanceRole?: string,
  dateRange?: BackupDateRange
): Promise<BackupPayload> {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const todayStr = nowIso.split('T')[0];

  // Resolve effective date range for T1 transactions
  let effectiveDateRange: BackupDateRange | undefined = dateRange;
  if (!effectiveDateRange) {
    if (type === 'EOD_HANDOVER') {
      effectiveDateRange = { startDate: todayStr, endDate: todayStr };
    } else if (type === 'DELTA') {
      const delta = calculateDeltaCutoff(now);
      effectiveDateRange = { startDate: delta.cutoffIso.slice(0, 10), endDate: todayStr };
    } else if (type === 'FULL') {
      effectiveDateRange = undefined; // Full history
    }
    // Note: ADMIN_MASTER_UPDATE with no explicit dateRange exports T2 only; WITH a dateRange also exports T1 GRVs/Supplier Payments/etc.!
  }

  const originDeviceId = getLocalDeviceId();
  const metadata: Record<string, any> = {};
  if (typeof window !== 'undefined' && window.localStorage) {
    const metaKeys = [
      'saimetric_company_id',
      'saimetric_current_branch_id',
      'saimetric_room_current_company_id',
      'saimetric_room_current_branch_id',
      'saimetric_device_registered',
      'saimetric_device_registered_company_id',
      'saimetric_device_registered_company_name',
      'saimetric_device_registered_branch_id',
      'saimetric_device_registered_role',
      'saimetric_device_registered_at',
      'saimetric_system_config',
      'saimetric_credit_policy',
      'saimetric_role_configs_v1',
    ];
    for (const k of metaKeys) {
      const val = window.localStorage.getItem(k);
      if (val !== null) metadata[k] = val;
    }
  }

  const companyId =
    metadata['saimetric_company_id'] ||
    metadata['saimetric_device_registered_company_id'] ||
    getCurrentCompanyId() ||
    'COMP-001';
  const companyName = metadata['saimetric_device_registered_company_name'] || 'Saimetric Store';
  const branchId =
    metadata['saimetric_current_branch_id'] ||
    metadata['saimetric_device_registered_branch_id'] ||
    getCurrentBranchId() ||
    'BR-MAIN';

  const envelopes: SyncEnvelope[] = [];
  const tablesCount: Record<string, number> = {};
  let t1Count = 0;
  let t2Count = 0;
  let tombstoneCount = 0;

  // Keep lightweight references for EOD handover scorecard computation
  let exportedSalesForSummary: any[] = [];
  let exportedCashLogsForSummary: any[] = [];
  let exportedReconsForSummary: any[] = [];
  let exportedChangesForSummary: any[] = [];
  let exportedCreditsForSummary: any[] = [];

  // 1. Export Tombstones (soft-delete guards) so deleted T2 items stay deleted across WhatsApp files
  try {
    const tombstones = getTombstones();
    for (let idx = 0; idx < tombstones.length; idx++) {
      const t = tombstones[idx];
      if (!t || !t.entityId || !t.entityType) continue;
      envelopes.push({
        packetId: `WAFILE-tombstone-${t.entityType}-${t.entityId}-${t.deletedAt || nowMs}`,
        entityType: 'tombstone',
        entityId: `${t.entityType}:${t.entityId}`,
        action: 'APPEND',
        data: t,
        updatedAt: Number(t.deletedAt || nowMs),
        originDeviceId,
        targetBranchId: 'ALL',
        class: 'T1',
        isCloudSynced: false,
        meta: { source: 'WHATSAPP_FILE_EXPORT' },
      });
      tombstoneCount++;
    }
  } catch {}

  // 2. Export T2 (FULL snapshot) and T1 (filtered by Date Range — bi-directional, NO role restrictions)
  const includeT1 = type !== 'ADMIN_MASTER_UPDATE' || Boolean(dateRange);

  for (const table of BACKUP_STORAGE_TABLES) {
    let raw: string | null = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      raw = window.localStorage.getItem(table.key);
      // Fallback for legacy company key
      if (!raw && table.key === 'saimetric_room_companies') {
        raw = window.localStorage.getItem('saimetric_companies');
      }
    }
    if (!raw) {
      tablesCount[table.name] = 0;
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      tablesCount[table.name] = 0;
      continue;
    }

    // Handle singleton/whole-array T2 config stores (multi_currency, permissions_matrix, role_configs, inventory_category, credit_policy)
    if (table.isSingleton || table.isArrayPayload) {
      if (table.isArrayPayload && (!Array.isArray(parsed) || parsed.length === 0)) {
        tablesCount[table.name] = 0;
        continue;
      }
      if (!table.isArrayPayload && (!parsed || typeof parsed !== 'object')) {
        tablesCount[table.name] = 0;
        continue;
      }
      const env = buildSyncEnvelopeForRecord({
        entityType: table.entityType,
        entityId: table.entityType.toUpperCase(),
        tier: 'T2',
        data: parsed,
        originDeviceId,
        branchId: 'ALL',
        exportStamp: nowMs,
      });
      envelopes.push(env);
      t2Count++;
      tablesCount[table.name] = Array.isArray(parsed) ? parsed.length : 1;
      continue;
    }

    if (!Array.isArray(parsed)) {
      tablesCount[table.name] = 0;
      continue;
    }

    if (table.tier === 'T1') {
      if (!includeT1) {
        tablesCount[table.name] = 0;
        continue;
      }
      const filtered = filterT1RecordsByDateRange(parsed, effectiveDateRange);
      tablesCount[table.name] = filtered.length;

      if (table.entityType === 'sale') exportedSalesForSummary = filtered;
      else if (table.entityType === 'cash_log') exportedCashLogsForSummary = filtered;
      else if (table.entityType === 'reconciliation') exportedReconsForSummary = filtered;
      else if (table.entityType === 'customer_change') exportedChangesForSummary = filtered;
      else if (table.entityType === 'credit_sale') exportedCreditsForSummary = filtered;

      for (let i = 0; i < filtered.length; i++) {
        const cleanRec = sanitizeRecordForExport(table.entityType, filtered[i]);
        const entityId = resolveRecordEntityId(cleanRec, table.primaryKey, i);
        envelopes.push(
          buildSyncEnvelopeForRecord({
            entityType: table.entityType,
            entityId,
            tier: 'T1',
            data: cleanRec,
            originDeviceId,
            branchId,
            exportStamp: nowMs,
          })
        );
        t1Count++;
      }
    } else {
      // T2 Config: ALWAYS export full snapshot
      tablesCount[table.name] = parsed.length;
      for (let i = 0; i < parsed.length; i++) {
        const cleanRec = sanitizeRecordForExport(table.entityType, parsed[i]);
        const entityId = resolveRecordEntityId(cleanRec, table.primaryKey, i);
        envelopes.push(
          buildSyncEnvelopeForRecord({
            entityType: table.entityType,
            entityId,
            tier: 'T2',
            data: cleanRec,
            originDeviceId,
            branchId: 'ALL',
            exportStamp: nowMs,
          })
        );
        t2Count++;
      }
    }
  }

  // Compute Handover Summary if EOD_HANDOVER
  let handoverSummary: HandoverSummary | undefined;
  if (type === 'EOD_HANDOVER') {
    const targetDay = effectiveDateRange?.endDate || todayStr;
    const daySales = exportedSalesForSummary.filter(
      (s: any) => s && isSameDaySafe(s.date, s.timestamp, targetDay)
    );
    const totalSalesUsd = daySales.reduce((acc: number, s: any) => acc + (Number(s.total) || 0), 0);

    const dayLogs = exportedCashLogsForSummary.filter(
      (c: any) => c && isSameDaySafe(c.date, c.timestamp, targetDay)
    );
    const cashIn = dayLogs.reduce((acc: number, l: any) => acc + (Number(l.in) || 0), 0);
    const cashOut = dayLogs.reduce((acc: number, l: any) => acc + (Number(l.out) || 0), 0);

    const latestRecon = exportedReconsForSummary[0];
    const cashVariance = latestRecon ? Number(latestRecon.variance) || 0 : 0;

    const dayChanges = exportedChangesForSummary.filter(
      (c: any) => c && isSameDaySafe(c.date, c.timestamp, targetDay)
    );
    const uncollectedChangeUsd = dayChanges.reduce(
      (acc: number, c: any) => acc + (Number(c.amount) || 0),
      0
    );

    const dayCredits = exportedCreditsForSummary.filter(
      (c: any) => c && isSameDaySafe(c.date, c.timestamp, targetDay)
    );
    const creditIssuedUsd = dayCredits.reduce(
      (acc: number, c: any) => acc + (Number(c.amount) || 0),
      0
    );

    handoverSummary = {
      branchName: companyName,
      supervisorName: exportedBy || 'Supervisor',
      shiftDate: targetDay,
      totalSalesUsd: Number(totalSalesUsd.toFixed(2)),
      totalSalesCount: daySales.length,
      totalCashInDrawer: Number((cashIn - cashOut).toFixed(2)),
      cashVariance: Number(cashVariance.toFixed(2)),
      creditIssuedUsd: Number(creditIssuedUsd.toFixed(2)),
      uncollectedChangeUsd: Number(uncollectedChangeUsd.toFixed(2)),
      shiftNotes,
    };
  }

  const basePayload: BackupPayload = {
    manifest: {
      app: 'SAIMETRIC',
      version: '5.0.0',
      backupVersion: 3,
      format: 'HEXAGONAL_SYNC_ENVELOPE',
      backupType: type,
      timestamp: nowIso,
      coverageStart: effectiveDateRange?.startDate,
      coverageEnd: effectiveDateRange?.endDate || nowIso,
      dateRange: effectiveDateRange,
      lastBackupTimestamp: getLastBackupTimestamp(),
      companyId,
      companyName,
      branchId,
      originDeviceId,
      exportedBy,
      clearanceLevel: clearanceLevel ?? (type === 'ADMIN_MASTER_UPDATE' ? 5 : 3),
      clearanceRole: clearanceRole ?? (type === 'ADMIN_MASTER_UPDATE' ? 'OWNER' : 'STAFF'),
      totalRecords: envelopes.length,
      t1Count,
      t2Count,
      tombstoneCount,
      hmacProtected: true,
      tablesCount,
      handoverSummary,
      isMasterOnly: type === 'ADMIN_MASTER_UPDATE' && !dateRange,
    },
    envelopes,
    metadata,
  };

  // Compute serialized byte size & 15MB warning flag before signing HMAC
  const estimatedBytes = estimatePayloadByteSize(basePayload);
  basePayload.manifest.estimatedBytes = estimatedBytes;
  basePayload.manifest.exceeds15MB = estimatedBytes > MAX_RECOMMENDED_BACKUP_BYTES;

  // Sign entire payload with HMAC-SHA256 for post-export edit detection
  const signedPayload = await backupCryptoService.signBackupPayloadHmac(basePayload, companyId);
  return signedPayload;
}

/**
 * Export and encrypt database backup file (.saimetric.enc) with AES-256-GCM + dual HMAC-SHA256
 */
export async function createEncryptedBackupFile(
  type: BackupType = 'DELTA',
  passphrase: string,
  exportedBy?: string,
  shiftNotes?: string,
  clearanceLevel?: number,
  clearanceRole?: string,
  dateRange?: BackupDateRange
): Promise<{
  fileName: string;
  encryptedContent: string;
  manifest: BackupManifest;
  fileSizeBytes: number;
  exceeds15MB: boolean;
}> {
  const payload = await generateDatabasePayload(
    type,
    exportedBy,
    shiftNotes,
    clearanceLevel,
    clearanceRole,
    dateRange
  );
  const encryptedContent = await backupCryptoService.encryptBackupPayload(payload, passphrase);
  const fileSizeBytes = estimatePayloadByteSize(encryptedContent);
  const exceeds15MB = fileSizeBytes > MAX_RECOMMENDED_BACKUP_BYTES;

  const cleanDate = safeDateSlice(payload.manifest.timestamp, 0, 10);
  let typeTag = 'SYNC';
  if (type === 'FULL') typeTag = 'FULL_SNAPSHOT';
  if (type === 'EOD_HANDOVER') typeTag = 'EOD_HANDOVER';
  if (type === 'ADMIN_MASTER_UPDATE') typeTag = 'MASTER_UPDATE';

  const fileName = `SAIMETRIC_${typeTag}_${cleanDate}_${Date.now().toString().slice(-4)}.saimetric.enc`;

  recordBackupCompletion(type, payload.manifest.timestamp, fileName);

  return {
    fileName,
    encryptedContent,
    manifest: {
      ...payload.manifest,
      estimatedBytes: fileSizeBytes,
      exceeds15MB,
    },
    fileSizeBytes,
    exceeds15MB,
  };
}

/**
 * Trigger browser file download of backup
 */
export function downloadBackupFileToDevice(fileName: string, content: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type RestoreProgressCallback = (progress: {
  percent: number;
  currentTable: string;
  tableIndex: number;
  totalTables: number;
  recordsProcessed: number;
  totalRecords: number;
  stage: 'restoring' | 'done';
}) => void;

/**
 * Normalize ANY supported backup format into a canonical SyncEnvelope[] array:
 * - v3 Hexagonal SyncPayload ({ manifest, envelopes: SyncEnvelope[] })
 * - Raw SyncEnvelope[] JSON array
 * - Legacy v2 table dump ({ manifest, tables }) — converted in-memory to SyncEnvelope[]
 */
export function extractEnvelopesFromBackupPayload(rawPayload: any): {
  manifest: BackupManifest;
  envelopes: SyncEnvelope[];
  metadata: Record<string, any>;
} {
  const nowIso = new Date().toISOString();

  // Case 1: Raw SyncEnvelope[] JSON array
  if (Array.isArray(rawPayload)) {
    const validEnvelopes = rawPayload.filter(
      (e) => e && typeof e === 'object' && e.entityType && ENTITY_REGISTRY[e.entityType]
    ) as SyncEnvelope[];
    const t1Count = validEnvelopes.filter((e) => ENTITY_REGISTRY[e.entityType]?.class === 'T1').length;
    const t2Count = validEnvelopes.filter((e) => ENTITY_REGISTRY[e.entityType]?.class === 'T2').length;
    return {
      manifest: {
        app: 'SAIMETRIC',
        version: '5.0.0',
        backupVersion: 3,
        format: 'HEXAGONAL_SYNC_ENVELOPE',
        backupType: 'DELTA',
        timestamp: nowIso,
        coverageEnd: nowIso,
        totalRecords: validEnvelopes.length,
        t1Count,
        t2Count,
        tablesCount: {},
      },
      envelopes: validEnvelopes,
      metadata: {},
    };
  }

  const payload = rawPayload as BackupPayload;
  const manifest = payload.manifest;
  const metadata = payload.metadata || {};

  // Case 2: v3 Hexagonal SyncEnvelope[] payload
  if (Array.isArray(payload.envelopes)) {
    return {
      manifest,
      envelopes: payload.envelopes,
      metadata,
    };
  }

  // Case 3: Legacy v2 { manifest, tables } — convert every non-T3/T4 row into SyncEnvelope[]
  const envelopes: SyncEnvelope[] = [];
  const originDeviceId = manifest?.originDeviceId || 'LEGACY_BACKUP_FILE';
  const branchId = manifest?.branchId || 'BR-MAIN';
  const exportStamp = parseTimestampMs(manifest?.timestamp) || Date.now();
  const tables = payload.tables || {};

  for (const [storageKey, rawRecords] of Object.entries(tables)) {
    // Skip T3 local-only & T4 legacy products mirror
    if (
      storageKey === 'saimetric_room_products' ||
      storageKey === 'saimetric_room_fast_moving_checklist' ||
      storageKey === 'saimetric_room_customer_goods_left_behind' ||
      storageKey === 'saimetric_room_negative_balances'
    ) {
      continue;
    }

    const tableMeta =
      BACKUP_STORAGE_TABLES.find((t) => t.key === storageKey) ||
      LEGACY_TABLE_KEY_TO_ENTITY_TYPE[storageKey];
    if (!tableMeta) continue;

    const isSingletonTable =
      ('isSingleton' in tableMeta && Boolean(tableMeta.isSingleton)) ||
      ('isArrayPayload' in tableMeta && Boolean((tableMeta as { isArrayPayload?: boolean }).isArrayPayload));
    if (isSingletonTable) {
      envelopes.push(
        buildSyncEnvelopeForRecord({
          entityType: tableMeta.entityType,
          entityId: tableMeta.entityType.toUpperCase(),
          tier: 'T2',
          data: rawRecords,
          originDeviceId,
          branchId: 'ALL',
          exportStamp,
        })
      );
      continue;
    }

    if (!Array.isArray(rawRecords)) continue;
    for (let i = 0; i < rawRecords.length; i++) {
      const cleanRec = sanitizeRecordForExport(tableMeta.entityType, rawRecords[i]);
      const entityId = resolveRecordEntityId(cleanRec, tableMeta.primaryKey, i);
      envelopes.push(
        buildSyncEnvelopeForRecord({
          entityType: tableMeta.entityType,
          entityId,
          tier: tableMeta.tier,
          data: cleanRec,
          originDeviceId,
          branchId,
          exportStamp,
        })
      );
    }
  }

  return { manifest, envelopes, metadata };
}

/**
 * Fallback SyncCore for cold-boot restores (e.g. LoginScreen lost-device restore before meshSyncService mounts)
 */
function createStandaloneFileSyncCore(): SyncCore {
  const noopAdapter: SyncAdapter = {
    name: 'FILE_IMPORT_FALLBACK',
    isConnected: () => false,
    connect: async () => {},
    disconnect: async () => {},
    broadcast: async (env) => ({ success: false, packetId: env.packetId, error: 'OFFLINE_FILE_IMPORT' }),
    onReceive: () => () => {},
    requestCatchUp: async () => ({ envelopes: [], cutoffTimestamp: Date.now() }),
    drainOfflineQueue: async () => {},
  };
  const core = new SyncCore(noopAdapter, getLocalDeviceId());
  core.setTombstoneProvider(() => getTombstones());
  return core;
}

/**
 * Queue an accepted file-imported envelope for normal Local Hub / Cloud upload.
 * File imports MUST NEVER be marked isCloudSynced: true — they flow upstream via normal ID deduplication.
 */
function queueAcceptedFileEnvelopeForUpstreamSync(envelope: SyncEnvelope): boolean {
  if (!envelope || envelope.entityType === 'tombstone') return false;
  const spec = ENTITY_REGISTRY[envelope.entityType];
  if (!spec || !spec.requiresBroadcast) return false;

  const outboundEnvelope: SyncEnvelope = {
    ...envelope,
    isCloudSynced: false,
    meta: {
      ...(envelope.meta || {}),
      fromWhatsAppImport: true,
    },
  };

  // 1. Broadcast / enqueue through the live Hexagonal SyncCore bridge if active
  saveAndSyncThroughBridge(outboundEnvelope).catch(() => {});

  // 2. Also enqueue into persistent RoomDB sync queue so offline devices flush automatically when Hub/Cloud connects
  try {
    const queueAction: 'INSERT' | 'UPDATE' | 'DELETE' =
      envelope.action === 'DELETE'
        ? 'DELETE'
        : envelope.action === 'APPEND'
          ? 'INSERT'
          : 'UPDATE';
    enqueueSync(envelope.entityType, queueAction, {
      ...(envelope.data && typeof envelope.data === 'object' ? envelope.data : { value: envelope.data }),
      isCloudSynced: false,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hexagonal Sync Import Engine:
 * Parses file payload into SyncEnvelope[] and routes every record through SyncCore.ingestBatch():
 * - Verifies HMAC-SHA256 tamper signature (rejects edited files)
 * - Strict T1 ID deduplication (prevents double-counting Sales, GRVs, Expenses, Payments)
 * - 5000ms T2 LWW timestamp check + Tombstone Resurrection Guard + PIN Version Guard
 * - Golden Rule of Balances (protects existing Inventory/Customer/Supplier/CashAccount/Wallet/StockBatch balances)
 * - Remote GRV/GRN T1 ledger events apply their +qty stock delta cleanly ONCE
 * - Never marks file imports isCloudSynced: true; queues accepted records for normal Hub/Cloud sync
 */
export async function restoreDatabaseFromPayload(
  rawPayload: BackupPayload | SyncEnvelope[],
  mode: 'append' | 'replace' | 'master_only' = 'append',
  onProgress?: RestoreProgressCallback
): Promise<RestoreResult> {
  if (!rawPayload) {
    return {
      success: false,
      message: 'Invalid backup structure.',
      backupType: 'FULL',
      timestamp: new Date().toISOString(),
      recordsProcessed: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      error: 'Backup payload is empty.',
    };
  }

  // Defense-in-depth: verify HMAC tamper signature even if caller invoked restoreDatabaseFromPayload directly
  const hmacCheck = await backupCryptoService.verifyBackupPayloadHmac(rawPayload);
  if (!hmacCheck.valid) {
    return {
      success: false,
      tampered: true,
      hmacVerified: false,
      message: hmacCheck.error || 'FILE TAMPERING DETECTED: Backup signature verification failed.',
      backupType: 'FULL',
      timestamp: new Date().toISOString(),
      recordsProcessed: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      error: hmacCheck.error,
    };
  }

  const { manifest, envelopes: rawEnvelopes, metadata } = extractEnvelopesFromBackupPayload(rawPayload);
  if (!manifest) {
    return {
      success: false,
      message: 'Invalid backup structure: Missing manifest.',
      backupType: 'FULL',
      timestamp: new Date().toISOString(),
      recordsProcessed: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      error: 'Manifest missing in decrypted file.',
    };
  }

  cleanupLocalStorageQuota();

  const isMasterOnlyRestore =
    mode === 'master_only' ||
    Boolean(manifest.isMasterOnly && mode !== 'replace');

  let protectedTablesPreserved = 0;

  // Filter out T3/T4 and (if master_only) protected counter transactional entities
  const filteredEnvelopes = rawEnvelopes.filter((env) => {
    if (!env || !env.entityType) return false;
    const spec = ENTITY_REGISTRY[env.entityType];
    if (!spec || spec.class === 'T3' || spec.class === 'T4') return false;
    if (isMasterOnlyRestore && PROTECTED_MASTER_ONLY_ENTITY_TYPES.has(env.entityType)) {
      protectedTablesPreserved++;
      return false;
    }
    return true;
  });

  // Canonical Hexagonal ingest ordering:
  // 1) Tombstones first (prevents resurrecting deleted items)
  // 2) T2 Config snapshots next (so new catalog items/customers/wallets exist before T1 events reference them)
  // 3) T1 Ledger events last, sorted chronologically (oldest -> newest)
  const sortedEnvelopes = [...filteredEnvelopes].sort((a, b) => {
    const rank = (e: SyncEnvelope) => {
      if (e.entityType === 'tombstone') return 0;
      const cls = ENTITY_REGISTRY[e.entityType]?.class || e.class;
      return cls === 'T2' ? 1 : 2;
    };
    const rDiff = rank(a) - rank(b);
    if (rDiff !== 0) return rDiff;
    return (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0);
  });

  // Restore device & company metadata first on fresh-device replace mode so tenant/branch scope matches
  if (mode === 'replace' && metadata && typeof window !== 'undefined' && window.localStorage) {
    // Clear existing persistent arrays on fresh-device disaster recovery so every entity is NEW locally
    for (const table of BACKUP_STORAGE_TABLES) {
      try {
        window.localStorage.removeItem(table.key);
      } catch {}
    }
    for (const [k, v] of Object.entries(metadata)) {
      if (typeof v === 'string') {
        try {
          window.localStorage.setItem(k, v);
        } catch {}
      }
    }
  } else if (metadata && typeof window !== 'undefined' && window.localStorage) {
    // Only fill missing company/device metadata on merge — never overwrite active branch scope
    for (const [k, v] of Object.entries(metadata)) {
      if (typeof v === 'string' && !window.localStorage.getItem(k)) {
        try {
          window.localStorage.setItem(k, v);
        } catch {}
      }
    }
  }

  let balancesProtected = 0;
  let queuedForHubSync = 0;
  let recordsAdded = 0;
  let recordsUpdated = 0;
  const totalCount = sortedEnvelopes.length;

  try {
    // Route ALL envelopes through SyncCore.ingestBatch()
    const liveIngestBatch = getSyncCoreIngestBatchBridge();
    const runIngestBatch =
      liveIngestBatch ||
      ((envs: SyncEnvelope[], opts: any) => createStandaloneFileSyncCore().ingestBatch(envs, opts));

    const batchResult: BatchIngestResult = await runIngestBatch(sortedEnvelopes, {
      lwwToleranceMs: FILE_IMPORT_LWW_TOLERANCE_MS, // Strict 5000ms LWW timestamp check for T2
      allowSelfOrigin: mode === 'replace', // Prevent self-origin echo during normal sync; allow on wiped-device restore
      isFileImport: true,
      lookupExisting: (envelope: SyncEnvelope) => {
        if (mode === 'replace') return undefined;
        return lookupLocalRecordForCloudEnvelope(envelope);
      },
      onAcceptedPersist: async (envelope: SyncEnvelope, existingRecord?: any) => {
        if (existingRecord) recordsUpdated++;
        else recordsAdded++;

        applyCloudEnvelopeToRoomDb(envelope, 'WHATSAPP_FILE_IMPORT', {
          markCloudSynced: false, // NEVER mark file imports isCloudSynced: true!
          protectExistingBalances: mode !== 'replace', // Golden Rule of Balances active
          applyRemoteT1StockDeltas: mode !== 'replace', // Remote GRV/GRN +qty delta applied cleanly ONCE
          onBalanceProtected: () => {
            balancesProtected++;
          },
        });

        // Queue accepted file records so they sync to Hub/Cloud normally (deduped by ID upstream)
        if (queueAcceptedFileEnvelopeForUpstreamSync(envelope)) {
          queuedForHubSync++;
        }
      },
      onProgress: (prog) => {
        if (onProgress) {
          const percent = totalCount > 0 ? Math.min(99, Math.round((prog.processed / totalCount) * 100)) : 100;
          onProgress({
            percent,
            currentTable: prog.currentEntityType || 'SyncCore.ingestBatch',
            tableIndex: Math.min(prog.processed, totalCount),
            totalTables: Math.max(1, totalCount),
            recordsProcessed: prog.processed,
            totalRecords: totalCount,
            stage: 'restoring',
          });
        }
      },
    });

    // Auto-migrate any legacy plain-text PINs that may have existed in older backup files
    runPinHashingMigration();

    // Dispatch cross-module UI refresh notifications
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('saimetric_database_restored', { detail: manifest }));
      window.dispatchEvent(new CustomEvent('saimetric_inventory_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_customers_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_suppliers_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_grn_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_trips_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_wallets_updated', { detail: { count: batchResult.accepted } }));
      window.dispatchEvent(new CustomEvent('saimetric_sales_updated', { detail: { count: batchResult.accepted } }));
    }

    if (onProgress) {
      onProgress({
        percent: 100,
        currentTable: 'Complete',
        tableIndex: Math.max(1, totalCount),
        totalTables: Math.max(1, totalCount),
        recordsProcessed: batchResult.processed,
        totalRecords: totalCount,
        stage: 'done',
      });
    }

    const resultMsg = isMasterOnlyRestore
      ? `Applied Master Update via SyncCore: ${batchResult.t2Accepted} config updates accepted (${batchResult.t2StaleRejected} older skipped, ${balancesProtected} live balances protected). Counter sales & till logs preserved.`
      : `Hexagonal Sync import complete via SyncCore: ${batchResult.accepted} accepted (${batchResult.t1Accepted} new T1 ledger events, ${batchResult.t2Accepted} T2 config updates), ${batchResult.t1Deduped} duplicate T1 ignored, ${batchResult.t2StaleRejected} stale T2 rejected, ${balancesProtected} existing balances protected.`;

    return {
      success: true,
      message: resultMsg,
      backupType: manifest.backupType,
      timestamp: manifest.timestamp,
      recordsProcessed: batchResult.processed,
      recordsAdded,
      recordsUpdated,
      t1Accepted: batchResult.t1Accepted,
      t1Deduped: batchResult.t1Deduped,
      t2Accepted: batchResult.t2Accepted,
      t2StaleRejected: batchResult.t2StaleRejected,
      balancesProtected,
      resurrectionBlocked: batchResult.resurrectionBlocked,
      selfOriginSkipped: batchResult.selfOriginSkipped,
      queuedForHubSync,
      hmacVerified: hmacCheck.present && hmacCheck.valid,
      companyId: manifest.companyId,
      branchId: manifest.branchId,
      isMasterOnly: isMasterOnlyRestore,
      protectedTablesPreserved,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Restore failed: ${err.message}`,
      backupType: manifest.backupType,
      timestamp: manifest.timestamp,
      recordsProcessed: 0,
      recordsAdded,
      recordsUpdated,
      error: err.message,
    };
  }
}

/**
 * High-level one-step restore: Verifies HMAC tamper signature, decrypts file, and routes through SyncCore.ingestBatch()
 */
export async function restoreEncryptedBackup(
  rawContent: string,
  passphrase: string,
  mode: 'append' | 'replace' | 'master_only' = 'append',
  onProgress?: RestoreProgressCallback
): Promise<RestoreResult> {
  const decResult = await backupCryptoService.decryptBackupPayload(rawContent, passphrase);
  if (!decResult.success || !decResult.data) {
    return {
      success: false,
      tampered: decResult.tampered,
      hmacVerified: false,
      message: decResult.error || 'Decryption failed.',
      backupType: 'FULL',
      timestamp: new Date().toISOString(),
      recordsProcessed: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      error: decResult.error,
    };
  }

  const restoreResult = await restoreDatabaseFromPayload(decResult.data, mode, onProgress);
  return {
    ...restoreResult,
    hmacVerified: Boolean(decResult.hmacVerified || restoreResult.hmacVerified),
  };
}

export const databaseBackupService = {
  getLastBackupTimestamp,
  calculateDeltaCutoff,
  generateDatabasePayload,
  createEncryptedBackupFile,
  downloadBackupFileToDevice,
  estimatePayloadByteSize,
  extractEnvelopesFromBackupPayload,
  restoreDatabaseFromPayload,
  restoreEncryptedBackup,
  recordBackupCompletion,
  MAX_RECOMMENDED_BACKUP_BYTES,
  FILE_IMPORT_LWW_TOLERANCE_MS,
};

