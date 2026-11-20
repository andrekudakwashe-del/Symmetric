import {
  getSheetsConfig,
  saveSheetsConfig,
  getCompanies,
  saveCompany,
  pruneLocalCompaniesToAllowlist,
  deleteLocalCompany,
  getAllBranches,
  saveBranch,
  getSalespeopleForCompany,
  getAllSalespeople,
  saveSalesperson,
  getOwnerDefaultPermissions,
  parseTimestampMs,
  sanitizeMasterWebhookUrl,
  isDeprecatedLegacyWebhookUrl,
} from '../db/roomDatabase';
import {
  fetchCompaniesFromMasterSheet,
  registerCompanyInCloud,
  CloudRegistrationPayload,
} from './googleSheetsSync';
import { Company } from '../data/saasData';
import { routeCloudRecordThroughSyncCore } from './sync/syncIngestBridge';
import { fetchWithTimeout, GAS_TIMEOUTS, isTimeoutError, parseGasResponseText } from './sync/gasTransport';

const PENDING_REGISTRATIONS_KEY = 'saimetric_pending_cloud_registrations';

export function savePendingCloudRegistration(payload: CloudRegistrationPayload): void {
  try {
    const raw = localStorage.getItem(PENDING_REGISTRATIONS_KEY);
    const list: CloudRegistrationPayload[] = raw ? JSON.parse(raw) : [];
    const filtered = list.filter((p) => p && p.company_id !== payload.company_id);
    filtered.push(payload);
    localStorage.setItem(PENDING_REGISTRATIONS_KEY, JSON.stringify(filtered));
  } catch {
    // ignore storage errors
  }
}

export function clearPendingCloudRegistration(companyId: string): void {
  try {
    const raw = localStorage.getItem(PENDING_REGISTRATIONS_KEY);
    if (!raw) return;
    const list: CloudRegistrationPayload[] = JSON.parse(raw);
    const remaining = list.filter((p) => p && p.company_id !== companyId);
    if (remaining.length === 0) localStorage.removeItem(PENDING_REGISTRATIONS_KEY);
    else localStorage.setItem(PENDING_REGISTRATIONS_KEY, JSON.stringify(remaining));
  } catch {
    // ignore
  }
}

export async function flushPendingCloudRegistrations(): Promise<number> {
  try {
    const raw = localStorage.getItem(PENDING_REGISTRATIONS_KEY);
    if (!raw) return 0;
    const list: CloudRegistrationPayload[] = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return 0;

    let syncedCount = 0;
    for (const item of list) {
      if (!item || !item.company_id) continue;
      const res = await registerCompanyInCloud(item);
      if (res.cloudSynced || res.code === 'DUPLICATE_EMAIL') {
        clearPendingCloudRegistration(item.company_id);
        if (res.sheet_id) {
          const existing = getCompanies().find((c) => c.company_id === item.company_id);
          if (existing) saveCompany({ ...existing, sheet_id: res.sheet_id });
        }
        syncedCount++;
      }
    }
    return syncedCount;
  } catch {
    return 0;
  }
}

async function ingestBootstrapStaffRecord(su: any): Promise<void> {
  if (!su) return;
  console.log('[STAFF TRACE] 6. AppScripts Ingest. Incoming:', JSON.stringify(su));
  const uComp = su.company_id || su.companyId;
  if (!uComp) return;

  const staffId = su.id || su.user_id || `USR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const existingStaff = getAllSalespeople().find((s) => s.id === staffId);
  const incomingTs = parseTimestampMs(su.updatedAt || su.updated_at || su.lastUpdated) || 0;
  const incomingVersion = Number(su.version || 0);
  const incomingMutationSource =
    su.mutationSource ||
    su.mutation_source ||
    (incomingTs === 0 && incomingVersion === 0 ? 'SEED' : 'MIGRATION');
  const incomingPinVersion = Number(su.pinVersion || su.pin_version || 0);
  const incomingPinUpdatedAt = parseTimestampMs(su.pinUpdatedAt || su.pin_updated_at) || incomingTs;
  const existingPinVersion = Number((existingStaff as any)?.pinVersion || 0);
  const existingPinUpdatedAt = parseTimestampMs((existingStaff as any)?.pinUpdatedAt || existingStaff?.updatedAt);
  const existingHasPin = Boolean(existingStaff?.pin_hash || existingStaff?.pin);
  const shouldKeepExistingPin =
    existingHasPin &&
    (
      !su.pin_hash ||
      (existingPinVersion > 0 && incomingPinVersion === 0) ||
      (existingPinVersion > 0 && incomingPinVersion > 0 && existingPinVersion > incomingPinVersion) ||
      (existingPinUpdatedAt > 0 && incomingPinUpdatedAt > 0 && existingPinUpdatedAt - incomingPinUpdatedAt > 5000) ||
      incomingTs === 0
    );
  const pinHash = shouldKeepExistingPin ? existingStaff?.pin_hash : (su.pin_hash || existingStaff?.pin_hash);
  const pinSalt = shouldKeepExistingPin ? existingStaff?.pin_salt : (su.pin_salt || existingStaff?.pin_salt);
  const effectivePinVersion = Math.max(existingPinVersion, incomingPinVersion);
  const effectivePinUpdatedAt = Math.max(existingPinUpdatedAt, incomingPinUpdatedAt);
  const resolvedBranchId = su.branch_id || su.branchId || existingStaff?.branchId || 'BR-MAIN';
  const resolvedBranchAssignments = su.branchAssignments || existingStaff?.branchAssignments;
  const resolvedAssignedBranchIds =
    su.assignedBranchIds ||
    (Array.isArray(resolvedBranchAssignments) && resolvedBranchAssignments.length > 0
      ? resolvedBranchAssignments.map((a: any) => a.branchId).filter(Boolean)
      : (existingStaff as any)?.assignedBranchIds);

  const staffPayload: any = {
    id: staffId,
    name: su.full_name || su.name || existingStaff?.name || 'Staff Member',
    role: (su.role || existingStaff?.role || 'OWNER').toUpperCase() as any,
    email: su.email || existingStaff?.email || '',
    ...(pinHash
      ? { pin_hash: pinHash, ...(pinSalt ? { pin_salt: pinSalt } : {}) }
      : existingStaff?.pin
      ? { pin: existingStaff.pin }
      : { pin: String(su.pin || '1234') }),
    phone: su.phone || existingStaff?.phone || '',
    active: su.is_active === false || su.active === 'N' ? 'N' : 'Y',
    companyId: uComp,
    company_id: uComp,
    branchId: resolvedBranchId,
    branch_id: resolvedBranchId,
    ...(resolvedBranchAssignments ? { branchAssignments: resolvedBranchAssignments } : {}),
    ...(resolvedAssignedBranchIds ? { assignedBranchIds: resolvedAssignedBranchIds } : {}),
    permissions: su.permissions || existingStaff?.permissions || getOwnerDefaultPermissions(),
    version: incomingVersion,
    mutationSource: incomingMutationSource,
    ...(effectivePinVersion > 0 ? { pinVersion: effectivePinVersion } : {}),
    ...(effectivePinUpdatedAt > 0 ? { pinUpdatedAt: effectivePinUpdatedAt } : {}),
    ...(incomingTs > 0 ? { updatedAt: incomingTs, lastUpdated: new Date(incomingTs).toISOString() } : {}),
  };

  await routeCloudRecordThroughSyncCore(
    {
      packetId: `SERVER-BOOTSTRAP-STAFF-${staffId}-${incomingTs}-${Math.random().toString(36).substring(2, 6)}`,
      entityType: 'staff',
      entityId: String(staffId),
      action: 'UPSERT',
      data: staffPayload,
      updatedAt: incomingTs,
      version: incomingVersion,
      mutationSource: incomingMutationSource,
      originDeviceId: 'SERVER_BOOTSTRAP',
      targetBranchId: 'ALL',
      class: 'T2',
    },
    existingStaff,
    () => {
      const savedStaff = saveSalesperson(staffPayload, { fromSync: true });
      console.log(
        '[STAFF TRACE] 7. Saved to DB. New Pin:',
        savedStaff.pin_hash,
        'New Branches:',
        (savedStaff as any).assignedBranchIds ?? savedStaff.branchAssignments?.map((b) => b.branchId),
        'Role:',
        savedStaff.role
      );
    }
  );
}

export interface GlobalSystemConfig {
  masterWebhookUrl: string;
  masterSpreadsheetId: string;
  defaultIsolationMode: string;
  updatedAt?: string;
}

/**
 * Fetch system-wide global configuration from the central server.
 * Ensures any new device immediately adopts the default Master Webhook URL.
 */
export async function fetchGlobalSystemConfig(): Promise<GlobalSystemConfig | null> {
  try {
    const res = await fetch('/api/system/config');
    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.config) {
        const remoteConfig: GlobalSystemConfig = data.config;
        const local = getSheetsConfig();

        // If server has a configured master webhook, adopt it locally (auto-upgrading deprecated legacy V1 URLs)
        if (remoteConfig.masterWebhookUrl) {
          const cleanMaster = sanitizeMasterWebhookUrl(remoteConfig.masterWebhookUrl);
          const localWebhookClean =
            local.webhookUrl && !isDeprecatedLegacyWebhookUrl(local.webhookUrl)
              ? local.webhookUrl
              : cleanMaster;
          const updated = {
            ...local,
            masterWebhookUrl: cleanMaster,
            webhookUrl: localWebhookClean,
            masterSpreadsheetId: remoteConfig.masterSpreadsheetId || local.masterSpreadsheetId,
          };
          saveSheetsConfig(updated);
        }

        return remoteConfig;
      }
    }
  } catch (err) {
    console.warn('Could not fetch global system config from server:', err);
  }
  return null;
}

/**
 * Save and broadcast system-wide global configuration to the central server.
 * This sets the Master Webhook URL for all connected devices.
 */
export async function saveGlobalSystemConfig(params: {
  masterWebhookUrl: string;
  masterSpreadsheetId?: string;
  defaultIsolationMode?: string;
}): Promise<{ success: boolean; message: string; config?: GlobalSystemConfig }> {
  try {
    const res = await fetch('/api/system/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      // Update local storage too
      const local = getSheetsConfig();
      saveSheetsConfig({
        ...local,
        masterWebhookUrl: params.masterWebhookUrl.trim(),
        webhookUrl: params.masterWebhookUrl.trim(),
        masterSpreadsheetId: params.masterSpreadsheetId?.trim() || local.masterSpreadsheetId,
      });

      return {
        success: true,
        message: data.message || 'Global Master Webhook configured successfully.',
        config: data.config,
      };
    }
    return {
      success: false,
      message: data.message || 'Failed to save system config on server.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Network error saving system config: ${err.message || String(err)}`,
    };
  }
}

/**
 * Push all local tenant companies, branches, and users to the Master Google Sheet and central server.
 * Awaits real cloud confirmation (no silent no-cors masking) and reports honest sync status.
 */
export async function pushAllLocalTenantsToCloud(
  targetWebhookUrl?: string
): Promise<{
  success: boolean;
  cloudSynced: boolean;
  pushedCount: number;
  cloudPushedCount: number;
  branchesCount?: number;
  usersCount?: number;
  message: string;
  error?: string;
}> {
  const localCompanies = getCompanies();
  const branches = getAllBranches();
  const config = getSheetsConfig();
  const effectiveUrl = sanitizeMasterWebhookUrl(targetWebhookUrl || config.masterWebhookUrl || config.webhookUrl || '');

  // If a valid webhook is provided, persist it to server config BEFORE bulk syncing
  if (effectiveUrl && effectiveUrl.startsWith('http')) {
    await saveGlobalSystemConfig({
      masterWebhookUrl: effectiveUrl,
      masterSpreadsheetId: config.masterSpreadsheetId,
    }).catch(() => {});
  }

  const BATCH_SIZE = 10;
  const companyChunks: Company[][] = [];
  if (localCompanies.length === 0) {
    companyChunks.push([]);
  } else {
    for (let i = 0; i < localCompanies.length; i += BATCH_SIZE) {
      companyChunks.push(localCompanies.slice(i, i + BATCH_SIZE));
    }
  }

  let totalCloudPushed = 0;
  let totalCloudBranches = 0;
  let totalCloudUsers = 0;
  let successfulBatches = 0;
  let lastCloudError = '';

  for (let bIdx = 0; bIdx < companyChunks.length; bIdx++) {
    const chunkCompanies = companyChunks[bIdx];
    const chunkCompIds = new Set(chunkCompanies.map((c) => String(c.company_id || '').trim().toUpperCase()));
    const chunkBranches =
      companyChunks.length === 1
        ? branches
        : branches.filter((br: any) =>
            chunkCompIds.has(String(br?.company_id || br?.companyId || br?.CompanyID || '').trim().toUpperCase())
          );
    const chunkUsers: any[] = [];
    chunkCompanies.forEach((comp) => {
      chunkUsers.push(...getSalespeopleForCompany(comp.company_id));
    });

    let batchSynced = false;
    let batchPushed = 0;
    let batchBranches = 0;
    let batchUsers = 0;
    let batchError = '';

    // 2. Primary: Server proxy bulk sync (awaited, zero CORS, 75s client timeout > 65s server timeout)
    try {
      const res = await fetchWithTimeout(
        '/api/saas/sync-companies-bulk',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companies: chunkCompanies,
            branches: chunkBranches,
            users: chunkUsers,
            masterWebhookUrl: effectiveUrl || undefined,
          }),
        },
        GAS_TIMEOUTS.HEAVY_CLIENT_MS
      );

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (bIdx === 0) {
          if (data && Array.isArray(data.companies)) {
            data.companies.forEach((sc: any) => {
              if (sc && sc.company_id) {
                saveCompany(sc);
              }
            });
          }
          if (data && Array.isArray(data.branches)) {
            data.branches.forEach((sb: any) => {
              const bComp = sb?.company_id || sb?.companyId || sb?.CompanyID;
              if (sb && bComp && (sb.branch_id || sb.branchId || sb.BranchID || sb.id)) {
                saveBranch(sb, { fromSync: true });
              }
            });
          }
          if (data && Array.isArray(data.users)) {
            for (const su of data.users) {
              await ingestBootstrapStaffRecord(su);
            }
          }
        }
        if (data?.cloudSynced === true) {
          batchSynced = true;
          batchPushed = Number(data.cloudPushedCount ?? data.pushedCount ?? chunkCompanies.length);
          batchBranches = Number(data.cloudBranchesCount ?? chunkBranches.length);
          batchUsers = Number(data.cloudUsersCount ?? chunkUsers.length);
        } else if (data?.cloudError) {
          batchError = String(data.cloudError);
        }
      } else {
        batchError = `Server returned HTTP ${res.status}`;
      }
    } catch (err: any) {
      batchError = isTimeoutError(err)
        ? `Batch ${bIdx + 1}/${companyChunks.length} timed out waiting for Master Sheet`
        : err?.message || String(err);
      console.warn(`Notice during bulk server sync (batch ${bIdx + 1}/${companyChunks.length}):`, err);
    }

    // 3. Fallback: Direct CORS-safe dispatch to Google Apps Script (text/plain avoids OPTIONS preflight, reads real JSON)
    if (!batchSynced && effectiveUrl && effectiveUrl.startsWith('http')) {
      try {
        const directRes = await fetchWithTimeout(
          effectiveUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'bulk_sync_companies',
              clientRequestId: `REQ-DIRECT-BULK-${Date.now()}-${bIdx}`,
              companies: chunkCompanies,
              branches: chunkBranches,
              users: chunkUsers,
              data: {
                companies: chunkCompanies,
                branches: chunkBranches,
                users: chunkUsers,
              },
            }),
            redirect: 'follow',
          },
          GAS_TIMEOUTS.WRITE_CLIENT_MS
        );

        if (directRes.ok) {
          const parsedBody = parseGasResponseText(await directRes.text(), directRes.status);
          const parsed = parsedBody.data;
          if (parsed && parsed.success !== false && !parsed.error) {
            batchSynced = true;
            batchError = '';
            batchPushed = Number(parsed.companies_count ?? parsed.count ?? chunkCompanies.length);
            batchBranches = Number(parsed.branches_count ?? chunkBranches.length);
            batchUsers = Number(parsed.users_count ?? chunkUsers.length);
          } else if (parsed?.error || parsed?.message || parsedBody.error) {
            batchError = String(parsed?.error || parsed?.message || parsedBody.error);
          }
        } else {
          batchError = `Apps Script returned HTTP ${directRes.status}`;
        }
      } catch (err: any) {
        const fallbackMsg = isTimeoutError(err)
          ? `Direct Apps Script batch ${bIdx + 1}/${companyChunks.length} timed out`
          : err?.message || String(err);
        if (!batchError) batchError = fallbackMsg;
        console.warn(`Notice pushing batch ${bIdx + 1}/${companyChunks.length} directly to Google Apps Script:`, err);
      }
    }

    if (batchSynced) {
      successfulBatches++;
      totalCloudPushed += batchPushed;
      totalCloudBranches += batchBranches;
      totalCloudUsers += batchUsers;
    } else if (batchError) {
      lastCloudError = batchError;
    }
  }

  const allBatchesSynced = successfulBatches === companyChunks.length && successfulBatches > 0;
  if (allBatchesSynced) {
    const batchNote = companyChunks.length > 1 ? ` across ${companyChunks.length} batches` : '';
    return {
      success: true,
      cloudSynced: true,
      pushedCount: totalCloudPushed,
      cloudPushedCount: totalCloudPushed,
      branchesCount: totalCloudBranches,
      usersCount: totalCloudUsers,
      message: `Pushed ${totalCloudPushed} tenants, ${totalCloudBranches} branches, and ${totalCloudUsers} users to Master Google Sheet${batchNote}.`,
    };
  }

  if (successfulBatches > 0) {
    return {
      success: false,
      cloudSynced: false,
      pushedCount: totalCloudPushed,
      cloudPushedCount: totalCloudPushed,
      branchesCount: totalCloudBranches,
      usersCount: totalCloudUsers,
      error: lastCloudError || 'Some batches failed to reach Master Google Sheet.',
      message: `Partially pushed ${totalCloudPushed} tenants (${successfulBatches}/${companyChunks.length} batches succeeded). ${lastCloudError}`,
    };
  }

  return {
    success: false,
    cloudSynced: false,
    pushedCount: 0,
    cloudPushedCount: 0,
    error: lastCloudError || 'Master Google Sheet did not confirm the push.',
    message: lastCloudError
      ? `Master Sheet push failed: ${lastCloudError}`
      : 'Master Google Sheet Webhook URL is not configured or unreachable.',
  };
}

let inFlightSync: Promise<{
  success: boolean;
  companies: Company[];
  message: string;
}> | null = null;

/**
 * Initialize system config and synchronize tenant companies between cloud, server, and local storage.
 */
export async function initializeSystemConfigAndSync(): Promise<{
  success: boolean;
  companies: Company[];
  message: string;
}> {
  if (inFlightSync) return inFlightSync;

  inFlightSync = (async () => {
    // 1. Fetch server system config so this device adopts the master webhook
    await fetchGlobalSystemConfig();

    // 1b. Flush any pending cloud registrations queued during temporary network issues
    await flushPendingCloudRegistrations().catch(() => {});

    // 2. Query companies & users from server
    let authoritativeCloudIds: string[] | null = null;
    try {
      const serverRes = await fetchWithTimeout(
        '/api/saas/companies',
        { method: 'GET' },
        GAS_TIMEOUTS.READ_CLIENT_MS
      );
      if (serverRes.ok) {
        const serverData = await serverRes.json();
        if (serverData && Array.isArray(serverData.companies)) {
          serverData.companies.forEach((sc: any) => {
            if (sc && sc.company_id) {
              saveCompany(sc);
            }
          });
          if (serverData.cloudSynced === true && serverData.companies.length > 0) {
            authoritativeCloudIds = serverData.companies
              .map((sc: any) => String(sc?.company_id || '').trim())
              .filter(Boolean);
          }
        }
        if (serverData && Array.isArray(serverData.branches)) {
          serverData.branches.forEach((sb: any) => {
            const bComp = sb?.company_id || sb?.companyId || sb?.CompanyID;
            if (sb && bComp && (sb.branch_id || sb.branchId || sb.BranchID || sb.id)) {
              saveBranch(sb, { fromSync: true });
            }
          });
        }
        if (serverData && Array.isArray(serverData.users)) {
          for (const su of serverData.users) {
            await ingestBootstrapStaffRecord(su);
          }
        }
      }
    } catch {
      // ignore
    }

    // 3. Query Master Google Sheet (if configured)
    const masterRes = await fetchCompaniesFromMasterSheet().catch(() => null);
    if (masterRes?.cloudSynced && Array.isArray(masterRes.companies) && masterRes.companies.length > 0) {
      authoritativeCloudIds = masterRes.companies
        .map((mc) => String(mc?.company_id || '').trim())
        .filter(Boolean);
    }

    // 3b. If we received an authoritative cloud company list, prune local deleted tenants
    // so purged test companies never resurrect from stale browser localStorage.
    if (authoritativeCloudIds && authoritativeCloudIds.length > 0) {
      pruneLocalCompaniesToAllowlist(authoritativeCloudIds);
    }

    // 4. Only push local companies back to server when we did NOT get an authoritative cloud list
    // (prevents stale browsers from re-seeding purged companies into server memory).
    const allCurrent = getCompanies();
    if (!authoritativeCloudIds && allCurrent.length > 0) {
      const branches = getAllBranches();
      const allUsers: any[] = [];
      allCurrent.forEach((comp) => {
        allUsers.push(...getSalespeopleForCompany(comp.company_id));
      });
      fetchWithTimeout(
        '/api/saas/sync-companies-bulk',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companies: allCurrent,
            branches,
            users: allUsers,
            skipCloudPush: true,
          }),
        },
        20_000
      ).catch(() => {});
    }

    return {
      success: true,
      companies: getCompanies(),
      message: masterRes?.message || 'Companies synchronized successfully',
    };
  })().finally(() => {
    inFlightSync = null;
  });

  return inFlightSync;
}

export interface PurgeTestCompaniesResult {
  success: boolean;
  cloudPurged: boolean;
  cloudError?: string;
  removedCompanies: string[];
  keptCompanies: string[];
  removedLocalCompanies: number;
  removedLocalBranches: number;
  removedLocalUsers: number;
  trashedSheetsCount: number;
  tabStats?: Record<string, { before: number; after: number; removed: number }>;
  message: string;
}

/**
 * Authoritatively purge all non-allowlisted test companies across Master Google Sheet,
 * server memory/disk, and local browser storage. COMP-001 and COMP-MASTER are always kept.
 */
export async function purgeTestCompaniesEverywhere(options?: {
  keepCompanyIds?: string[];
  trashDedicatedSheets?: boolean;
  webhookUrl?: string;
}): Promise<PurgeTestCompaniesResult> {
  const keepCompanyIds = Array.from(
    new Set(['COMP-001', 'COMP-MASTER', ...(options?.keepCompanyIds || [])])
  );
  const trashDedicatedSheets = options?.trashDedicatedSheets !== false;
  const sheetsConfig = getSheetsConfig();
  const targetWebhook = sanitizeMasterWebhookUrl(
    options?.webhookUrl || sheetsConfig.masterWebhookUrl || sheetsConfig.webhookUrl || ''
  );

  let cloudPurged = false;
  let cloudError = '';
  let removedCompanies: string[] = [];
  let trashedSheetsCount = 0;
  let tabStats: Record<string, { before: number; after: number; removed: number }> | undefined;
  let serverMessage = '';

  // 1. Primary: Server proxy (handles Master Sheet purge + server-saas-data.json prune)
  try {
    const res = await fetchWithTimeout(
      '/api/saas/purge-test-companies',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keep_company_ids: keepCompanyIds,
          trash_dedicated_sheets: trashDedicatedSheets,
          webhookUrl: targetWebhook || undefined,
        }),
      },
      75_000
    );
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data) {
        cloudPurged = Boolean(data.cloudPurged);
        if (data.cloudError) cloudError = String(data.cloudError);
        if (Array.isArray(data.removedCompanies)) removedCompanies = data.removedCompanies;
        trashedSheetsCount = Number(data.trashedSheetsCount || 0);
        tabStats = data.tabStats;
        if (data.message) serverMessage = String(data.message);
      }
    } else {
      cloudError = `Server returned HTTP ${res.status}`;
    }
  } catch (err: any) {
    cloudError = isTimeoutError(err)
      ? 'Purge request timed out while waiting for Master Google Sheet.'
      : err?.message || String(err);
  }

  // 2. Fallback: Direct Apps Script POST (for standalone PWA without Express proxy)
  if (!cloudPurged && targetWebhook && targetWebhook.startsWith('http') && !cloudError.toLowerCase().includes('unknown action')) {
    try {
      const directRes = await fetchWithTimeout(
        targetWebhook,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'purge_test_companies',
            keep_company_ids: keepCompanyIds,
            trash_dedicated_sheets: trashDedicatedSheets,
          }),
          redirect: 'follow',
        },
        70_000
      );
      if (directRes.ok) {
        const parsedBody = parseGasResponseText(await directRes.text(), directRes.status);
        const parsed = parsedBody.data;
        if (parsed && parsed.success !== false && !parsed.error) {
          cloudPurged = true;
          cloudError = '';
          if (Array.isArray(parsed.removed_companies)) removedCompanies = parsed.removed_companies;
          trashedSheetsCount = Number(parsed.trashed_sheets_count || 0);
          tabStats = parsed.tab_stats;
          serverMessage = String(parsed.message || '');
        } else if (parsed?.error || parsedBody.error) {
          cloudError = String(parsed?.error || parsedBody.error);
        }
      }
    } catch (directErr: any) {
      if (!cloudError) cloudError = directErr?.message || String(directErr);
    }
  }

  // 3. Always prune local browser storage so purged tenants vanish immediately
  const localRes = pruneLocalCompaniesToAllowlist(keepCompanyIds);

  const needsRedeploy = /unknown action|html/i.test(cloudError);
  const message = cloudPurged
    ? serverMessage ||
      `Purged ${Math.max(removedCompanies.length, localRes.removedCompanies)} test companies everywhere` +
        (trashedSheetsCount > 0 ? ` and trashed ${trashedSheetsCount} dedicated Drive sheet(s).` : '.')
    : needsRedeploy
    ? `Cleaned ${localRes.removedCompanies} test companies locally & on server, but Master Sheet Apps Script needs to be updated with the latest Code.gs (New Version) before cloud purge can run.`
    : `Cleaned ${localRes.removedCompanies} test companies locally & on server. Master Sheet warning: ${cloudError || 'unreachable'}`;

  return {
    success: true,
    cloudPurged,
    cloudError: cloudError || undefined,
    removedCompanies,
    keptCompanies: localRes.keptCompanyIds,
    removedLocalCompanies: localRes.removedCompanies,
    removedLocalBranches: localRes.removedBranches,
    removedLocalUsers: localRes.removedUsers,
    trashedSheetsCount,
    tabStats,
    message,
  };
}

export interface DeleteTenantCompanyResult {
  success: boolean;
  cloudDeleted: boolean;
  cloudError?: string;
  trashedSheetsCount: number;
  message: string;
}

/**
 * Authoritatively delete a single non-protected tenant company across Master Sheet, server, and local storage.
 */
export async function deleteTenantCompany(
  companyId: string,
  options?: { trashDedicatedSheet?: boolean; webhookUrl?: string }
): Promise<DeleteTenantCompanyResult> {
  const cleanId = String(companyId || '').trim();
  const normId = cleanId.toUpperCase();
  if (!cleanId || normId === 'COMP-001' || normId === 'COMP-MASTER') {
    return {
      success: false,
      cloudDeleted: false,
      trashedSheetsCount: 0,
      message: `${cleanId || 'This company'} is a protected core workspace and cannot be deleted.`,
    };
  }

  const trashDedicatedSheets = options?.trashDedicatedSheet !== false;
  const sheetsConfig = getSheetsConfig();
  const targetWebhook = sanitizeMasterWebhookUrl(
    options?.webhookUrl || sheetsConfig.masterWebhookUrl || sheetsConfig.webhookUrl || ''
  );

  let cloudDeleted = false;
  let cloudError = '';
  let trashedSheetsCount = 0;

  try {
    const res = await fetchWithTimeout(
      '/api/saas/delete-company',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: cleanId,
          trash_dedicated_sheets: trashDedicatedSheets,
          webhookUrl: targetWebhook || undefined,
        }),
      },
      55_000
    );
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.success !== false) {
      cloudDeleted = Boolean(data.cloudDeleted);
      if (data.cloudError) cloudError = String(data.cloudError);
      trashedSheetsCount = Number(data.trashedSheetsCount || 0);
    } else if (data?.error) {
      return {
        success: false,
        cloudDeleted: false,
        cloudError: String(data.error),
        trashedSheetsCount: 0,
        message: String(data.error),
      };
    }
  } catch (err: any) {
    cloudError = err?.message || String(err);
  }

  if (!cloudDeleted && targetWebhook && targetWebhook.startsWith('http') && !cloudError.toLowerCase().includes('unknown action')) {
    try {
      const directRes = await fetchWithTimeout(
        targetWebhook,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'delete_company',
            company_id: cleanId,
            trash_dedicated_sheets: trashDedicatedSheets,
          }),
          redirect: 'follow',
        },
        50_000
      );
      if (directRes.ok) {
        const parsedBody = parseGasResponseText(await directRes.text(), directRes.status);
        if (parsedBody.data && parsedBody.data.success !== false && !parsedBody.data.error) {
          cloudDeleted = true;
          cloudError = '';
          trashedSheetsCount = Number(parsedBody.data.trashed_sheets_count || 0);
        } else if (parsedBody.data?.error || parsedBody.error) {
          cloudError = String(parsedBody.data?.error || parsedBody.error);
        }
      }
    } catch (directErr: any) {
      if (!cloudError) cloudError = directErr?.message || String(directErr);
    }
  }

  deleteLocalCompany(cleanId);

  const needsRedeploy = /unknown action|html/i.test(cloudError);
  const message = cloudDeleted
    ? `Deleted ${cleanId} from Master Sheet, server, and this device.`
    : needsRedeploy
    ? `Removed ${cleanId} locally & on server. Redeploy latest Code.gs to also delete from Master Sheet.`
    : `Removed ${cleanId} locally & on server. Master Sheet notice: ${cloudError || 'unreachable'}`;

  return {
    success: true,
    cloudDeleted,
    cloudError: cloudError || undefined,
    trashedSheetsCount,
    message,
  };
}
