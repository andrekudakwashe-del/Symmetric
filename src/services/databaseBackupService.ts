import {
  backupCryptoService,
} from './backupCryptoService';

export type BackupType = 'FULL' | 'DELTA' | 'EOD_HANDOVER' | 'ADMIN_MASTER_UPDATE';

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
  backupVersion: 2;
  backupType: BackupType;
  timestamp: string; // ISO string
  coverageStart?: string; // Cutoff start timestamp for delta
  coverageEnd: string;
  lastBackupTimestamp?: string | null;
  companyId?: string;
  companyName?: string;
  branchId?: string;
  exportedBy?: string;
  totalRecords: number;
  tablesCount: Record<string, number>;
  handoverSummary?: HandoverSummary;
  isMasterOnly?: boolean;
}

export interface BackupPayload {
  manifest: BackupManifest;
  tables: Record<string, any[]>;
  metadata: Record<string, any>;
}

export interface RestoreResult {
  success: boolean;
  message: string;
  backupType: BackupType;
  timestamp: string;
  recordsProcessed: number;
  recordsAdded: number;
  recordsUpdated: number;
  companyId?: string;
  branchId?: string;
  isMasterOnly?: boolean;
  protectedTablesPreserved?: number;
  error?: string;
}

// Transactional tables that must be locked & protected during an Administrative Master Push
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

// Storage key names
export const STORAGE_LAST_BACKUP_TIME = 'saimetric_last_backup_timestamp';
export const STORAGE_LAST_BACKUP_TYPE = 'saimetric_last_backup_type';
export const STORAGE_BACKUP_HISTORY = 'saimetric_backup_history';

// Complete list of application stores in localStorage
export const BACKUP_STORAGE_TABLES: { key: string; name: string; primaryKey: string; isMasterData?: boolean }[] = [
  { key: 'saimetric_companies', name: 'Companies', primaryKey: 'company_id', isMasterData: true },
  { key: 'saimetric_branches', name: 'Branches', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_salespeople', name: 'Salespeople', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_inventory_items', name: 'Inventory Items', primaryKey: 'itemId', isMasterData: true },
  { key: 'saimetric_room_products', name: 'Products', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_packaging_variants', name: 'Packaging Variants', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_categories', name: 'Product Categories', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_customers', name: 'Customers', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_suppliers', name: 'Suppliers', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_stock_batches', name: 'Stock Batches', primaryKey: 'id' },
  { key: 'saimetric_room_goods_received_notes', name: 'Goods Received Notes', primaryKey: 'id' },
  { key: 'saimetric_room_procurement_trips', name: 'Procurement Trips', primaryKey: 'id' },
  { key: 'saimetric_room_direct_grvs', name: 'Direct GRVs', primaryKey: 'id' },
  { key: 'saimetric_room_supplier_invoices', name: 'Supplier Invoices', primaryKey: 'voucherId' },
  { key: 'saimetric_supplier_payables', name: 'Supplier Payables', primaryKey: 'id' },
  { key: 'saimetric_room_cash_movements', name: 'Cash Movements', primaryKey: 'id' },
  { key: 'saimetric_room_customer_ledger', name: 'Customer Ledger', primaryKey: 'id' },
  { key: 'saimetric_room_customer_changes', name: 'Customer Changes', primaryKey: 'id' },
  { key: 'saimetric_room_credit_sales', name: 'Credit Sales', primaryKey: 'id' },
  { key: 'saimetric_room_sales', name: 'Sales Invoices', primaryKey: 'id' },
  { key: 'saimetric_room_stock_movements', name: 'Stock Movements', primaryKey: 'txnId' },
  { key: 'saimetric_room_cash_logs', name: 'Cash Logs', primaryKey: 'id' },
  { key: 'saimetric_room_cash_counts', name: 'Cash Counts', primaryKey: 'id' },
  { key: 'saimetric_room_cash_lifts', name: 'Cash Lifts', primaryKey: 'id' },
  { key: 'saimetric_room_reconciliations', name: 'Reconciliations', primaryKey: 'id' },
  { key: 'saimetric_room_admin_sales', name: 'Admin Sales', primaryKey: 'id' },
  { key: 'saimetric_room_expenses', name: 'Expenses', primaryKey: 'id' },
  { key: 'saimetric_room_stocktake_sessions', name: 'Stocktake Sessions', primaryKey: 'id' },
  { key: 'saimetric_room_fast_moving_checklist', name: 'Fast Moving Checklists', primaryKey: 'id' },
  { key: 'saimetric_room_customer_goods_left_behind', name: 'Customer Goods Left Behind', primaryKey: 'id' },
  { key: 'saimetric_room_temporary_casuals', name: 'Stocktake Casuals', primaryKey: 'id' },
  { key: 'saimetric_room_branch_lockdowns', name: 'Branch Lockdowns', primaryKey: 'id' },
  { key: 'saimetric_room_audit_logs', name: 'Audit Logs', primaryKey: 'id' },
  { key: 'saimetric_room_exchange_rates', name: 'Exchange Rates', primaryKey: 'currency', isMasterData: true },
  { key: 'saimetric_room_permissions', name: 'Permissions', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_role_configs_v1', name: 'Role Configurations', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_credit_policy', name: 'Credit Policy', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_saved_report_templates', name: 'Report Templates', primaryKey: 'id', isMasterData: true },
  { key: 'saimetric_room_report_permissions', name: 'Report Permissions', primaryKey: 'id', isMasterData: true },
];

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

  // Maintain rolling history of last 10 backups
  try {
    const rawHistory = window.localStorage.getItem(STORAGE_BACKUP_HISTORY);
    const history = rawHistory ? JSON.parse(rawHistory) : [];
    const entry = {
      timestamp,
      type,
      fileName,
      date: timestamp.split('T')[0],
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
      // Pick the earlier of the two dates
      const earlier = lastBackupDate.getTime() < startOfCurrentMonth.getTime() ? lastBackupDate : startOfCurrentMonth;
      return { cutoffDate: earlier, cutoffIso: earlier.toISOString() };
    }
  }

  return { cutoffDate: startOfCurrentMonth, cutoffIso: startOfCurrentMonth.toISOString() };
}

/**
 * Filter an array of records for delta export
 */
function filterRecordsForDelta(records: any[], cutoffIso: string, isMasterData: boolean = false): any[] {
  if (!Array.isArray(records)) return [];
  if (isMasterData) {
    // For master data like Products, Users, Branches, keep all active or modified
    return records;
  }

  const cutoffTime = new Date(cutoffIso).getTime();
  const cutoffDateStr = cutoffIso.split('T')[0];

  return records.filter((rec) => {
    if (!rec) return false;
    // Check possible timestamp fields
    const ts = rec.updatedAt || rec.timestamp || rec.createdAt;
    if (ts) {
      const recTime = new Date(ts).getTime();
      if (!isNaN(recTime) && recTime >= cutoffTime) return true;
    }
    // Check date fields
    const d = rec.date || rec.dateReceived;
    if (d && typeof d === 'string' && d >= cutoffDateStr) {
      return true;
    }
    return false;
  });
}

/**
 * Extract entire database payload (FULL, DELTA, EOD_HANDOVER, or ADMIN_MASTER_UPDATE)
 */
export function generateDatabasePayload(
  type: BackupType = 'FULL',
  exportedBy?: string,
  shiftNotes?: string
): BackupPayload {
  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = nowIso.split('T')[0];

  let coverageStart: string | undefined;
  if (type === 'DELTA') {
    const delta = calculateDeltaCutoff(now);
    coverageStart = delta.cutoffIso;
  } else if (type === 'EOD_HANDOVER') {
    // Cutoff: start of today (or past 24 hours)
    coverageStart = new Date(Date.now() - 28 * 3600 * 1000).toISOString();
  }

  const tables: Record<string, any[]> = {};
  const tablesCount: Record<string, number> = {};
  let totalRecords = 0;

  for (const table of BACKUP_STORAGE_TABLES) {
    let raw: string | null = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      raw = window.localStorage.getItem(table.key);
    }
    let parsed: any[] = [];
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          parsed = data;
        }
      } catch (err) {
        console.warn(`[DatabaseBackupService] Error parsing table ${table.name}:`, err);
      }
    }

    if (type === 'ADMIN_MASTER_UPDATE') {
      // EXCLUSIVELY master data tables (products, packaging, categories, prices, roles, settings)
      if (table.isMasterData) {
        tables[table.key] = parsed;
        tablesCount[table.name] = parsed.length;
        totalRecords += parsed.length;
      } else {
        // Deliberately empty for transactional tables
        tables[table.key] = [];
        tablesCount[table.name] = 0;
      }
    } else if ((type === 'DELTA' || type === 'EOD_HANDOVER') && coverageStart) {
      const filtered = filterRecordsForDelta(parsed, coverageStart, table.isMasterData);
      tables[table.key] = filtered;
      tablesCount[table.name] = filtered.length;
      totalRecords += filtered.length;
    } else {
      tables[table.key] = parsed;
      tablesCount[table.name] = parsed.length;
      totalRecords += parsed.length;
    }
  }

  // System & device metadata
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
      'saimetric_printer_hardware_config',
      'saimetric_saved_bluetooth_printer',
    ];
    for (const k of metaKeys) {
      const val = window.localStorage.getItem(k);
      if (val !== null) metadata[k] = val;
    }
  }

  const companyId =
    metadata['saimetric_company_id'] ||
    metadata['saimetric_device_registered_company_id'] ||
    'MAIN';
  const companyName = metadata['saimetric_device_registered_company_name'] || 'Saimetric Store';
  const branchId =
    metadata['saimetric_current_branch_id'] ||
    metadata['saimetric_device_registered_branch_id'] ||
    'BR001';

  // Compute Handover Summary if EOD_HANDOVER
  let handoverSummary: HandoverSummary | undefined;
  if (type === 'EOD_HANDOVER') {
    const allSales = tables['saimetric_room_sales'] || [];
    const todaySales = allSales.filter(
      (s: any) => s && (s.date === todayStr || (s.timestamp && s.timestamp.startsWith(todayStr)))
    );
    const totalSalesUsd = todaySales.reduce((acc: number, s: any) => acc + (Number(s.total) || 0), 0);

    const allCashLogs = tables['saimetric_room_cash_logs'] || [];
    const todayLogs = allCashLogs.filter(
      (c: any) => c && (c.date === todayStr || (c.timestamp && c.timestamp.startsWith(todayStr)))
    );
    const cashIn = todayLogs.reduce((acc: number, l: any) => acc + (Number(l.in) || 0), 0);
    const cashOut = todayLogs.reduce((acc: number, l: any) => acc + (Number(l.out) || 0), 0);

    const allRecons = tables['saimetric_room_reconciliations'] || [];
    const latestRecon = allRecons[0];
    const cashVariance = latestRecon ? Number(latestRecon.variance) || 0 : 0;

    const allChanges = tables['saimetric_room_customer_changes'] || [];
    const todayChanges = allChanges.filter(
      (c: any) => c && (c.date === todayStr || (c.timestamp && c.timestamp.startsWith(todayStr)))
    );
    const uncollectedChangeUsd = todayChanges.reduce(
      (acc: number, c: any) => acc + (Number(c.amount) || 0),
      0
    );

    const allCredits = tables['saimetric_room_credit_sales'] || [];
    const todayCredits = allCredits.filter(
      (c: any) => c && (c.date === todayStr || (c.timestamp && c.timestamp.startsWith(todayStr)))
    );
    const creditIssuedUsd = todayCredits.reduce(
      (acc: number, c: any) => acc + (Number(c.amount) || 0),
      0
    );

    handoverSummary = {
      branchName: companyName,
      supervisorName: exportedBy || 'Supervisor',
      shiftDate: todayStr,
      totalSalesUsd: Number(totalSalesUsd.toFixed(2)),
      totalSalesCount: todaySales.length,
      totalCashInDrawer: Number((cashIn - cashOut).toFixed(2)),
      cashVariance: Number(cashVariance.toFixed(2)),
      creditIssuedUsd: Number(creditIssuedUsd.toFixed(2)),
      uncollectedChangeUsd: Number(uncollectedChangeUsd.toFixed(2)),
      shiftNotes,
    };
  }

  const manifest: BackupManifest = {
    app: 'SAIMETRIC',
    version: '5.0.0',
    backupVersion: 2,
    backupType: type,
    timestamp: nowIso,
    coverageStart,
    coverageEnd: nowIso,
    lastBackupTimestamp: getLastBackupTimestamp(),
    companyId,
    companyName,
    branchId,
    exportedBy,
    totalRecords,
    tablesCount,
    handoverSummary,
    isMasterOnly: type === 'ADMIN_MASTER_UPDATE',
  };

  return {
    manifest,
    tables,
    metadata,
  };
}

/**
 * Export and encrypt database backup file (.saimetric.enc)
 */
export async function createEncryptedBackupFile(
  type: BackupType = 'DELTA',
  passphrase: string,
  exportedBy?: string,
  shiftNotes?: string
): Promise<{ fileName: string; encryptedContent: string; manifest: BackupManifest }> {
  const payload = generateDatabasePayload(type, exportedBy, shiftNotes);
  const encryptedContent = await backupCryptoService.encryptBackupPayload(payload, passphrase);

  const cleanDate = payload.manifest.timestamp.slice(0, 10);
  let typeTag = 'DELTA';
  if (type === 'FULL') typeTag = 'FULL_SNAPSHOT';
  if (type === 'EOD_HANDOVER') typeTag = 'EOD_HANDOVER';
  if (type === 'ADMIN_MASTER_UPDATE') typeTag = 'MASTER_UPDATE';

  const fileName = `SAIMETRIC_${typeTag}_${cleanDate}_${Date.now().toString().slice(-4)}.saimetric.enc`;

  recordBackupCompletion(type, payload.manifest.timestamp, fileName);

  return {
    fileName,
    encryptedContent,
    manifest: payload.manifest,
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

/**
 * Smart Upsert / Merge Engine:
 * Restores or appends records from a decrypted backup payload into local storage
 */
export function restoreDatabaseFromPayload(
  payload: BackupPayload,
  mode: 'append' | 'replace' | 'master_only' = 'append'
): RestoreResult {
  if (!payload || !payload.manifest || !payload.tables) {
    return {
      success: false,
      message: 'Invalid backup structure.',
      backupType: 'FULL',
      timestamp: new Date().toISOString(),
      recordsProcessed: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      error: 'Manifest or tables missing in decrypted file.',
    };
  }

  let recordsProcessed = 0;
  let recordsAdded = 0;
  let recordsUpdated = 0;

  const isMasterOnlyRestore =
    mode === 'master_only' ||
    payload.manifest.backupType === 'ADMIN_MASTER_UPDATE' ||
    Boolean(payload.manifest.isMasterOnly);

  let protectedTablesPreserved = 0;

  try {
    for (const tableConfig of BACKUP_STORAGE_TABLES) {
      if (isMasterOnlyRestore && PROTECTED_TRANSACTIONAL_TABLES.includes(tableConfig.key)) {
        // SAFETY GUARD: Do NOT overwrite branch sales, cash drawer, reconciliations, or customer credits!
        protectedTablesPreserved++;
        continue;
      }

      const incomingRecords = payload.tables[tableConfig.key];
      if (!Array.isArray(incomingRecords)) continue;

      recordsProcessed += incomingRecords.length;

      if (mode === 'replace') {
        // Fresh machine replace: overwrite entire table
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(tableConfig.key, JSON.stringify(incomingRecords));
        }
        recordsAdded += incomingRecords.length;
      } else {
        // Smart Append / Upsert Mode (or Master Only update)
        let currentRecords: any[] = [];
        if (typeof window !== 'undefined' && window.localStorage) {
          const raw = window.localStorage.getItem(tableConfig.key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) currentRecords = parsed;
            } catch (e) {
              currentRecords = [];
            }
          }
        }

        const pk = tableConfig.primaryKey;
        const currentMap = new Map<string, { index: number; record: any }>();
        currentRecords.forEach((rec, idx) => {
          const id = rec[pk] || rec.id || rec._id;
          if (id) currentMap.set(String(id), { index: idx, record: rec });
        });

        for (const inc of incomingRecords) {
          const incId = inc[pk] || inc.id || inc._id;
          if (!incId) {
            currentRecords.push(inc);
            recordsAdded++;
            continue;
          }

          const existing = currentMap.get(String(incId));
          if (existing) {
            // Compare timestamps: if incoming is newer or equal, update
            const incTime = new Date(inc.updatedAt || inc.timestamp || inc.createdAt || 0).getTime();
            const curTime = new Date(existing.record.updatedAt || existing.record.timestamp || existing.record.createdAt || 0).getTime();

            if (isNaN(curTime) || incTime >= curTime) {
              currentRecords[existing.index] = { ...existing.record, ...inc };
              recordsUpdated++;
            }
          } else {
            // New record: append
            currentRecords.push(inc);
            currentMap.set(String(incId), { index: currentRecords.length - 1, record: inc });
            recordsAdded++;
          }
        }

        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(tableConfig.key, JSON.stringify(currentRecords));
        }
      }
    }

    // Restore device & company metadata if present
    if (payload.metadata && typeof window !== 'undefined' && window.localStorage) {
      for (const [k, v] of Object.entries(payload.metadata)) {
        if (typeof v === 'string') {
          window.localStorage.setItem(k, v);
        }
      }
    }

    // Dispatch update notifications so UI updates live
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('saimetric_database_restored', { detail: payload.manifest }));
      window.dispatchEvent(new CustomEvent('saimetric_inventory_updated', { detail: { count: recordsProcessed } }));
      window.dispatchEvent(new CustomEvent('saimetric_customers_updated', { detail: { count: recordsProcessed } }));
      window.dispatchEvent(new CustomEvent('saimetric_suppliers_updated', { detail: { count: recordsProcessed } }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_movements_updated', { detail: { count: recordsProcessed } }));
      window.dispatchEvent(new CustomEvent('saimetric_grn_updated', { detail: { count: recordsProcessed } }));
      window.dispatchEvent(new CustomEvent('saimetric_trips_updated', { detail: { count: recordsProcessed } }));
      window.dispatchEvent(new CustomEvent('saimetric_cash_updated', { detail: { count: recordsProcessed } }));
    }

    const resultMsg = isMasterOnlyRestore
      ? `Applied Owner Master Update successfully! Updated ${recordsUpdated} catalog records (+${recordsAdded} added). All branch counter sales and cash registers were safely preserved!`
      : `Restored ${payload.manifest.backupType} backup successfully. Processed ${recordsProcessed} records (+${recordsAdded} added, ${recordsUpdated} updated).`;

    return {
      success: true,
      message: resultMsg,
      backupType: payload.manifest.backupType,
      timestamp: payload.manifest.timestamp,
      recordsProcessed,
      recordsAdded,
      recordsUpdated,
      companyId: payload.manifest.companyId,
      branchId: payload.manifest.branchId,
      isMasterOnly: isMasterOnlyRestore,
      protectedTablesPreserved,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Restore failed: ${err.message}`,
      backupType: payload.manifest.backupType,
      timestamp: payload.manifest.timestamp,
      recordsProcessed,
      recordsAdded,
      recordsUpdated,
      error: err.message,
    };
  }
}

/**
 * High-level one-step restore: Decrypts file and applies smart merge
 */
export async function restoreEncryptedBackup(
  rawContent: string,
  passphrase: string,
  mode: 'append' | 'replace' | 'master_only' = 'append'
): Promise<RestoreResult> {
  const decResult = await backupCryptoService.decryptBackupPayload(rawContent, passphrase);
  if (!decResult.success || !decResult.data) {
    return {
      success: false,
      message: decResult.error || 'Decryption failed.',
      backupType: 'FULL',
      timestamp: new Date().toISOString(),
      recordsProcessed: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      error: decResult.error,
    };
  }

  return restoreDatabaseFromPayload(decResult.data, mode);
}

export const databaseBackupService = {
  getLastBackupTimestamp,
  calculateDeltaCutoff,
  generateDatabasePayload,
  createEncryptedBackupFile,
  downloadBackupFileToDevice,
  restoreDatabaseFromPayload,
  restoreEncryptedBackup,
  recordBackupCompletion,
};
