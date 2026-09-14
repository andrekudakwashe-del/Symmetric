import {
  getSheetsConfig,
  saveSheetsConfig,
  getCompanies,
  saveCompany,
  getBranches,
  saveBranch,
  getSalespeopleForCompany,
  saveSalesperson,
  getOwnerDefaultPermissions,
} from '../db/roomDatabase';
import { syncCompanyToCloud, fetchCompaniesFromMasterSheet } from './googleSheetsSync';
import { Company } from '../data/saasData';

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

        // If server has a configured master webhook, adopt it locally
        if (remoteConfig.masterWebhookUrl) {
          const updated = {
            ...local,
            masterWebhookUrl: remoteConfig.masterWebhookUrl,
            // If local webhookUrl was empty or default, adopt the master webhook
            webhookUrl: local.webhookUrl ? local.webhookUrl : remoteConfig.masterWebhookUrl,
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
 * Push all local tenant companies to the Master Google Sheet and central server.
 * Uses fast bulk synchronization with timeout protection so the UI never hangs.
 */
export async function pushAllLocalTenantsToCloud(
  targetWebhookUrl?: string
): Promise<{ success: boolean; pushedCount: number; message: string }> {
  const localCompanies = getCompanies();
  const branches = getBranches();
  const config = getSheetsConfig();
  const effectiveUrl = (targetWebhookUrl || config.masterWebhookUrl || config.webhookUrl || '').trim();

  // If a valid webhook is provided, broadcast and save to server configuration
  if (effectiveUrl && effectiveUrl.startsWith('http')) {
    saveGlobalSystemConfig({
      masterWebhookUrl: effectiveUrl,
      masterSpreadsheetId: config.masterSpreadsheetId,
    }).catch(() => {});
  }

  // 1. Gather all local users across all companies
  const allUsers: any[] = [];
  localCompanies.forEach((comp) => {
    const staff = getSalespeopleForCompany(comp.company_id);
    allUsers.push(...staff);
  });

  // 2. Perform fast bulk sync to Server store
  try {
    const res = await fetch('/api/saas/sync-companies-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: localCompanies,
        branches,
        users: allUsers,
        masterWebhookUrl: effectiveUrl || undefined,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.companies)) {
        // Merge any server companies back into local database
        data.companies.forEach((sc: any) => {
          if (sc && sc.company_id) {
            saveCompany(sc);
          }
        });
      }
      if (data && Array.isArray(data.branches)) {
        data.branches.forEach((sb: any) => {
          if (sb && sb.branch_id) saveBranch(sb);
        });
      }
      if (data && Array.isArray(data.users)) {
        data.users.forEach((su: any) => {
          const uComp = su.company_id || su.companyId;
          if (uComp) {
            saveSalesperson({
              id: su.id || su.user_id || `USR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
              name: su.name || su.full_name || 'Staff Member',
              role: (su.role || 'OWNER').toUpperCase() as any,
              email: su.email || '',
              pin: String(su.pin || '1234'),
              phone: su.phone || '',
              active: su.active === 'N' ? 'N' : 'Y',
              companyId: uComp,
              company_id: uComp,
              branchId: su.branch_id || su.branchId || 'BR-MAIN',
              branch_id: su.branch_id || su.branchId || 'BR-MAIN',
              permissions: getOwnerDefaultPermissions(),
            });
          }
        });
      }
    }
  } catch (err) {
    console.warn('Notice during bulk server sync:', err);
  }

  // 3. Direct client-side dispatch to Google Apps Script (in case server has restricted outbound)
  if (effectiveUrl && effectiveUrl.startsWith('http')) {
    try {
      await fetch(effectiveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync_companies_bulk',
          data: {
            companies: getCompanies(),
          },
        }),
        mode: 'no-cors',
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      console.warn('Notice pushing directly to Google Apps Script:', err);
    }
  }

  const finalCompanies = getCompanies();
  return {
    success: true,
    pushedCount: finalCompanies.length,
    message: `Synchronized ${finalCompanies.length} tenants across devices and Master Sheet.`,
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

    // 2. Query companies & users from server
    try {
      const serverRes = await fetch('/api/saas/companies', { signal: AbortSignal.timeout(5000) });
      if (serverRes.ok) {
        const serverData = await serverRes.json();
        if (serverData && Array.isArray(serverData.companies)) {
          serverData.companies.forEach((sc: any) => {
            if (sc && sc.company_id) {
              saveCompany(sc);
            }
          });
        }
        if (serverData && Array.isArray(serverData.branches)) {
          serverData.branches.forEach((sb: any) => {
            if (sb && sb.branch_id) {
              saveBranch(sb);
            }
          });
        }
        if (serverData && Array.isArray(serverData.users)) {
          serverData.users.forEach((su: any) => {
            const uComp = su.company_id || su.companyId;
            if (uComp) {
              saveSalesperson({
                id: su.id || su.user_id || `USR-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
                name: su.name || su.full_name || 'Staff Member',
                role: (su.role || 'OWNER').toUpperCase() as any,
                email: su.email || '',
                pin: String(su.pin || '1234'),
                phone: su.phone || '',
                active: su.active === 'N' ? 'N' : 'Y',
                companyId: uComp,
                company_id: uComp,
                branchId: su.branch_id || su.branchId || 'BR-MAIN',
                branch_id: su.branch_id || su.branchId || 'BR-MAIN',
                permissions: getOwnerDefaultPermissions(),
              });
            }
          });
        }
      }
    } catch {
      // ignore
    }

    // 3. Query Master Google Sheet (if configured)
    const masterRes = await fetchCompaniesFromMasterSheet().catch(() => null);

    // 4. Send any local companies that server might not have to the server
    const allCurrent = getCompanies();
    if (allCurrent.length > 0) {
      const branches = getBranches();
      const allUsers: any[] = [];
      allCurrent.forEach((comp) => {
        allUsers.push(...getSalespeopleForCompany(comp.company_id));
      });
      fetch('/api/saas/sync-companies-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companies: allCurrent,
          branches,
          users: allUsers,
        }),
        signal: AbortSignal.timeout(6000),
      }).catch(() => {});
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
