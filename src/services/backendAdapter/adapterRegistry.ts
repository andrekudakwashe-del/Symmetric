import {
  BackendType,
  IBackendAdapter,
  TenantBackendConfig,
  PruneResult,
} from './types';
import { roomBackendAdapter } from './adapters/RoomAdapter';
import { sheetsAppScriptAdapter } from './adapters/SheetsAppScriptAdapter';
import { firebaseBackendAdapter } from './adapters/FirebaseAdapter';
import { supabaseBackendAdapter } from './adapters/SupabaseAdapter';
import { Company } from '../../data/saasData';
import { getCompanies, saveCompany, getSheetsConfig, DEFAULT_MASTER_WEBHOOK_URL } from '../../db/roomDatabase';

const ADAPTER_MAP: Record<BackendType, IBackendAdapter> = {
  room: roomBackendAdapter,
  sheets_appscript: sheetsAppScriptAdapter,
  firebase: firebaseBackendAdapter,
  supabase: supabaseBackendAdapter,
};

export const getAllAdapters = (): IBackendAdapter[] => [
  roomBackendAdapter,
  sheetsAppScriptAdapter,
  firebaseBackendAdapter,
  supabaseBackendAdapter,
];

export const getBackendAdapter = (type: BackendType): IBackendAdapter => {
  return ADAPTER_MAP[type] || roomBackendAdapter;
};

/**
 * Returns default tier backend type based on the company's SaaS Plan
 */
export const getDefaultBackendTypeForPlan = (
  plan?: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | string
): BackendType => {
  if (plan === 'ENTERPRISE') return 'supabase';
  if (plan === 'PROFESSIONAL') return 'firebase';
  // Starter defaults to Google Sheets & Apps Script
  return 'sheets_appscript';
};

/**
 * Normalizes existing Company sheet/webhook fields into the TenantBackendConfig
 * ensuring 100% backward compatibility with existing Google Apps Script setups.
 */
export const getTenantBackendConfig = (company: Company): TenantBackendConfig => {
  const existing = company.backend_config;

  // Determine active backend type
  const backendType: BackendType =
    company.backend_type ||
    existing?.backendType ||
    (company.sheet_id || company.webhook_url ? 'sheets_appscript' : 'room');

  const sheetsCfg = getSheetsConfig();

  return {
    backendType,
    room: {
      keepLocalCache: existing?.room?.keepLocalCache ?? true,
      quotaMb: existing?.room?.quotaMb ?? 50,
      indexedDbEnabled: existing?.room?.indexedDbEnabled ?? true,
    },
    sheets: {
      webhookUrl: existing?.sheets?.webhookUrl || company.webhook_url || sheetsCfg.webhookUrl || DEFAULT_MASTER_WEBHOOK_URL,
      masterWebhookUrl: existing?.sheets?.masterWebhookUrl || sheetsCfg.masterWebhookUrl || DEFAULT_MASTER_WEBHOOK_URL,
      spreadsheetId: existing?.sheets?.spreadsheetId || company.sheet_id || sheetsCfg.masterSpreadsheetId || '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
      sheetFolderId: existing?.sheets?.sheetFolderId || company.sheet_folder_id || '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
      isolationMode: existing?.sheets?.isolationMode || company.branch_isolation_mode || 'ROW_LEVEL',
    },
    firebase: {
      projectId: existing?.firebase?.projectId || '',
      apiKey: existing?.firebase?.apiKey || '',
      firestoreRegion: existing?.firebase?.firestoreRegion || 'us-central1',
      appId: existing?.firebase?.appId || '',
      authDomain: existing?.firebase?.authDomain || '',
    },
    supabase: {
      projectUrl: existing?.supabase?.projectUrl || '',
      anonKey: existing?.supabase?.anonKey || '',
      serviceRoleKey: existing?.supabase?.serviceRoleKey || '',
      schema: existing?.supabase?.schema || 'public',
    },
    authMode: existing?.authMode || 'pin_6_digit',
    retention: {
      autoDeleteEnabled: existing?.retention?.autoDeleteEnabled ?? true,
      retentionMonths: existing?.retention?.retentionMonths ?? 3,
      lastPrunedAt: existing?.retention?.lastPrunedAt,
      lastBackupAt: existing?.retention?.lastBackupAt,
    },
    isMigrating: existing?.isMigrating || false,
    lastMigrationAt: existing?.lastMigrationAt,
    notes: existing?.notes,
  };
};

/**
 * Saves updated backend configuration to the tenant and persists locally and to the server
 */
export const saveTenantBackendConfig = (
  companyId: string,
  configUpdates: Partial<TenantBackendConfig>
): Company | null => {
  const companies = getCompanies();
  const company = companies.find((c) => c.company_id === companyId);
  if (!company) return null;

  const currentCfg = getTenantBackendConfig(company);
  const mergedCfg: TenantBackendConfig = {
    ...currentCfg,
    ...configUpdates,
    room: { ...currentCfg.room, ...(configUpdates.room || {}) },
    sheets: { ...currentCfg.sheets, ...(configUpdates.sheets || {}) },
    firebase: { ...currentCfg.firebase, ...(configUpdates.firebase || {}) },
    supabase: { ...currentCfg.supabase, ...(configUpdates.supabase || {}) },
    retention: { ...currentCfg.retention, ...(configUpdates.retention || {}) },
  };

  const updatedCompany: Company = {
    ...company,
    backend_type: mergedCfg.backendType,
    backend_config: mergedCfg,
    // Keep top-level sheet and webhook in sync for existing components
    webhook_url: mergedCfg.sheets.webhookUrl,
    sheet_id: mergedCfg.sheets.spreadsheetId,
    sheet_folder_id: mergedCfg.sheets.sheetFolderId || company.sheet_folder_id,
    branch_isolation_mode: mergedCfg.sheets.isolationMode || company.branch_isolation_mode,
  };

  saveCompany(updatedCompany);

  // Sync with server if online
  if (typeof fetch !== 'undefined') {
    fetch('/api/saas/call-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upsert_company',
        company: updatedCompany,
      }),
    }).catch(() => {
      // Offline fallback is already handled in roomDatabase
    });
  }

  return updatedCompany;
};

/**
 * Checks if 3-month auto delete is enabled and executes pruning if due
 */
export const autoPruneIfEligible = async (company: Company): Promise<PruneResult | null> => {
  const config = getTenantBackendConfig(company);
  if (!config.retention.autoDeleteEnabled) return null;

  const lastPrune = config.retention.lastPrunedAt ? new Date(config.retention.lastPrunedAt).getTime() : 0;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  // Run auto-pruning if never run, or if more than 30 days have passed since last prune
  if (Date.now() - lastPrune > thirtyDaysMs) {
    const adapter = getBackendAdapter(config.backendType);
    const result = await adapter.pruneHistoricalData(company.company_id, config.retention.retentionMonths || 3);

    // Record pruning timestamp
    saveTenantBackendConfig(company.company_id, {
      retention: {
        ...config.retention,
        lastPrunedAt: new Date().toISOString(),
      },
    });

    return result;
  }

  return null;
};

/**
 * Returns the recommended backend architecture for a given SaaS package tier
 */
export const getRecommendedBackendForPackageTier = (tier?: string): BackendType => {
  const cleanTier = (tier || '').toUpperCase().trim();
  switch (cleanTier) {
    case 'FREE':
    case 'COMMUNITY':
    case 'BASIC':
      return 'room';
    case 'STARTER':
      return 'sheets_appscript';
    case 'PROFESSIONAL':
    case 'GROWTH':
    case 'MEDIUM':
      return 'firebase';
    case 'ENTERPRISE':
    case 'CORPORATE':
    case 'LARGE':
      return 'supabase';
    default:
      return 'sheets_appscript';
  }
};

/**
 * Returns descriptive metadata for package tier to backend mapping
 */
export const getPackageBackendTierSummary = (tier?: string) => {
  const recommended = getRecommendedBackendForPackageTier(tier);
  const adapter = getBackendAdapter(recommended);
  return {
    tier: (tier || 'STARTER').toUpperCase(),
    recommendedBackend: recommended,
    backendName: adapter.name,
    tierLabel: adapter.tierLabel,
    description: adapter.description,
  };
};

/**
 * Checks whether a tenant's active backend aligns with their subscription package plan
 */
export const checkPackageBackendAlignment = (
  company: Company
): {
  isAligned: boolean;
  currentBackend: BackendType;
  recommendedBackend: BackendType;
  tier: string;
  recommendationMessage: string;
} => {
  const currentCfg = getTenantBackendConfig(company);
  const recommended = getRecommendedBackendForPackageTier(company.plan);
  const isAligned = currentCfg.backendType === recommended;
  const currentAdapter = getBackendAdapter(currentCfg.backendType);
  const recAdapter = getBackendAdapter(recommended);

  let message = `Aligned: ${company.company_name} is using ${currentAdapter.name} matching their ${company.plan} plan.`;
  if (!isAligned) {
    message = `Recommendation: Plan is ${company.plan} (${recAdapter.tierLabel}). Currently on ${currentAdapter.name}. Consider migrating to ${recAdapter.name}.`;
  }

  return {
    isAligned,
    currentBackend: currentCfg.backendType,
    recommendedBackend: recommended,
    tier: company.plan || 'STARTER',
    recommendationMessage: message,
  };
};
