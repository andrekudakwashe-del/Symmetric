// SAIMETRIC Multi-Tenant Backend Adapter Types & Contracts
// Phase A Architecture Foundation

export type BackendType = 'room' | 'sheets_appscript' | 'firebase' | 'supabase';

export type BackendAuthMode = 'pin_6_digit' | 'backend_native' | 'hybrid';

export interface RoomConfig {
  /** If false, local Room DB caching is deactivated and all transactions rely purely on remote tier */
  keepLocalCache: boolean;
  /** Storage quota warning in MB */
  quotaMb?: number;
  /** Enable IndexedDB persistent storage */
  indexedDbEnabled: boolean;
}

export interface SheetsAppScriptConfig {
  webhookUrl?: string;
  masterWebhookUrl?: string;
  spreadsheetId?: string;
  sheetFolderId?: string;
  isolationMode?: 'ROW_LEVEL' | 'BRANCH_TABS' | 'HYBRID';
}

export interface FirebaseConfig {
  projectId?: string;
  apiKey?: string;
  firestoreRegion?: string;
  appId?: string;
  authDomain?: string;
  databaseId?: string;
}

export interface SupabaseConfig {
  projectUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  schema?: string;
}

export interface DataRetentionPolicy {
  /** When enabled, historical records older than retentionMonths are automatically pruned */
  autoDeleteEnabled: boolean;
  /** Number of months to keep operational records (Default: 3 months) */
  retentionMonths: number;
  /** Timestamp of the last data prune */
  lastPrunedAt?: string;
  /** Timestamp of the last migration snapshot backup */
  lastBackupAt?: string;
}

export interface TenantBackendConfig {
  backendType: BackendType;
  room: RoomConfig;
  sheets: SheetsAppScriptConfig;
  firebase: FirebaseConfig;
  supabase: SupabaseConfig;
  authMode: BackendAuthMode;
  retention: DataRetentionPolicy;
  isMigrating?: boolean;
  lastMigrationAt?: string;
  notes?: string;
}

export interface BackendConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  message: string;
  testedAt: string;
  details?: Record<string, any>;
}

export interface TenantDataSnapshot {
  tenantId: string;
  tenantName: string;
  exportedAt: string;
  backendSource: BackendType;
  version: string;
  data: {
    companies?: any[];
    branches?: any[];
    staff?: any[];
    products?: any[];
    inventory?: any[];
    sales?: any[];
    cashLogs?: any[];
    expenses?: any[];
    customers?: any[];
    customerChanges?: any[];
    suppliers?: any[];
    cashAccounts?: any[];
    cashTransfers?: any[];
    settings?: Record<string, any>;
  };
  metrics: {
    totalSales: number;
    totalInventoryItems: number;
    totalCustomers: number;
    totalCashLogs: number;
    snapshotSizeBytes?: number;
  };
}

export interface PruneResult {
  tenantId: string;
  prunedAt: string;
  retentionCutoffDate: string;
  totalPrunedRecords: number;
  details: {
    sales: number;
    cashLogs: number;
    expenses: number;
    auditLogs: number;
    syncQueue: number;
  };
}

export interface IBackendAdapter {
  readonly id: string;
  readonly type: BackendType;
  readonly name: string;
  readonly tierLabel: string;
  readonly description: string;

  /** Checks if the minimum required configuration/credentials are present */
  isConfigured(config: TenantBackendConfig): boolean;

  /** Tests live connectivity with the backend target */
  testConnection(config: TenantBackendConfig): Promise<BackendConnectionTestResult>;

  /** Exports a complete tenant data snapshot in the universal interchange format */
  exportSnapshot(companyId: string): Promise<TenantDataSnapshot>;

  /** Ingests/imports a universal tenant data snapshot into this backend */
  importSnapshot(
    companyId: string,
    snapshot: TenantDataSnapshot
  ): Promise<{ success: boolean; recordsWritten: number; errors?: string[] }>;

  /** Prunes records older than the specified retention window (default 3 months) */
  pruneHistoricalData(companyId: string, retentionMonths: number): Promise<PruneResult>;
}

// ============================================================================
// PHASE B MIGRATION ENGINE & STEP TYPES
// ============================================================================

export type MigrationStep =
  | 'PREFLIGHT'
  | 'EXTRACT'
  | 'TRANSFORM'
  | 'INGEST'
  | 'VERIFY'
  | 'CUTOVER'
  | 'CLEANUP';

export interface MigrationProgressEvent {
  step: MigrationStep;
  stepIndex: number;
  totalSteps: number;
  percentage: number;
  message: string;
  timestamp: string;
  details?: Record<string, any>;
}

export interface MigrationExecutionOptions {
  companyId: string;
  source: BackendType;
  destination: BackendType;
  authMode: BackendAuthMode;
  deactivateRoomDb: boolean;
  sourceRetentionPolicy: 'KEEP_3_MONTHS' | 'PURGE_SOURCE_NOW' | 'KEEP_FOREVER';
  onProgress?: (event: MigrationProgressEvent) => void;
}

export interface MigrationReport {
  id: string;
  companyId: string;
  companyName: string;
  startedAt: string;
  completedAt: string;
  source: BackendType;
  destination: BackendType;
  status: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK';
  entitiesMigrated: Record<string, number>;
  verificationPassed: boolean;
  durationMs: number;
  logs: string[];
  error?: string;
}

// ============================================================================
// PHASE D: OBSERVABILITY, CIRCUIT BREAKER, DRIFT DETECTION & DISASTER RECOVERY
// ============================================================================

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  consecutiveFailures: number;
  lastFailureTime?: string;
  lastSuccessTime?: string;
  lastTrippedAt?: string;
  autoFailoverActive: boolean;
  manualOverride: boolean;
  failureThreshold: number;
  recoveryTimeoutSeconds: number;
}

export type EntitySyncCategory = 'sales' | 'inventory' | 'customers' | 'cashLogs' | 'expenses';

export interface DriftDiscrepancy {
  entityType: EntitySyncCategory;
  displayName: string;
  localCount: number;
  remoteCount: number;
  discrepancyCount: number;
  status: 'IN_SYNC' | 'DRIFT_DETECTED' | 'REMOTE_UNAVAILABLE';
  lastDriftChecked: string;
}

export interface DriftAuditReport {
  id: string;
  companyId: string;
  companyName: string;
  backendType: BackendType;
  auditedAt: string;
  overallStatus: 'HEALTHY' | 'DRIFT_WARNING' | 'CRITICAL';
  discrepancies: DriftDiscrepancy[];
  totalDiscrepancies: number;
  isReconciled: boolean;
  reconciledAt?: string;
  suggestedResolution: string;
}

export interface DisasterRecoveryBackup {
  id: string;
  companyId: string;
  companyName: string;
  label: string;
  createdAt: string;
  backendSource: BackendType;
  snapshot: TenantDataSnapshot;
  checksum: string;
  sizeBytes: number;
  totalRecords: number;
  autoCreatedReason?: 'PRE_MIGRATION' | 'SCHEDULED_BACKUP' | 'MANUAL_SUPER_ADMIN' | 'PRE_PRUNE';
}

export interface RollbackResult {
  success: boolean;
  backupId: string;
  companyId: string;
  restoredAt: string;
  recordsRestored: number;
  message: string;
  details?: Record<string, number>;
  error?: string;
}

