// SAIMETRIC Multi-Tenant Authentication Adapter Service
// Phase C: Dynamic Authentication Handling (6-Digit PIN, Native Cloud, & Hybrid Mode)

import { BackendType, BackendAuthMode } from './types';
import { getTenantBackendConfig } from './adapterRegistry';
import { Company } from '../../data/saasData';
import { getCompanies, getSalespeopleForCompany, saveSalesperson } from '../../db/roomDatabase';
import { Salesperson } from '../../types';
import { authenticateStaffWithAppsScript, authenticateOwnerWithAppsScript } from '../googleSheetsSync';

export interface AuthResult {
  status: 'success' | 'error';
  success: boolean;
  message?: string;
  user?: Partial<Salesperson>;
  authProvider: BackendType;
  authModeUsed: BackendAuthMode;
  token?: string;
  businessId?: string;
  company_id?: string;
  company_name?: string;
  branch_id?: string;
  role?: string;
  user_id?: string;
  full_name?: string;
}

export class BackendAuthService {
  /**
   * Authenticates a staff member based on the tenant's configured authMode & backend
   */
  async authenticateStaff(
    companyId: string,
    staffId: string,
    staffName: string,
    pinOrPassword: string,
    branchId?: string,
    modeOverride?: BackendAuthMode
  ): Promise<AuthResult> {
    const company = getCompanies().find((c) => c.company_id === companyId);
    const config = company ? getTenantBackendConfig(company) : null;
    const authMode = modeOverride || config?.authMode || 'pin_6_digit';
    const backendType = config?.backendType || 'sheets_appscript';

    // 1. PIN Mode: Standard 4 to 6 digit PIN verification
    const isPinFormat = /^\d{4,6}$/.test(pinOrPassword.trim());

    if (authMode === 'pin_6_digit' || (authMode === 'hybrid' && isPinFormat)) {
      return await this.verifyStaffPin(companyId, staffId, staffName, pinOrPassword.trim(), backendType);
    }

    // 2. Backend Native Mode: Cloud-based authentication
    if (authMode === 'backend_native' || (authMode === 'hybrid' && !isPinFormat)) {
      return await this.verifyStaffNativeCloud(companyId, staffId, staffName, pinOrPassword, backendType, config);
    }

    // Fallback to PIN verification
    return await this.verifyStaffPin(companyId, staffId, staffName, pinOrPassword.trim(), backendType);
  }

  /**
   * Authenticates an Owner / Super Admin
   */
  async authenticateOwner(
    email: string,
    passwordOrPin: string,
    companyId?: string
  ): Promise<AuthResult> {
    const cleanEmail = email.trim().toLowerCase();

    // Super Admin Bypass / Master check
    if (cleanEmail === 'andrekudakwashe@gmail.com') {
      const isSuperAdminMatch =
        passwordOrPin === 'Pass123' ||
        passwordOrPin === '1234' ||
        passwordOrPin === 'admin123';

      if (isSuperAdminMatch) {
        return {
          status: 'success',
          success: true,
          authProvider: 'room',
          authModeUsed: 'pin_6_digit',
          message: 'Super Admin authenticated with administrative privileges.',
          businessId: 'COMP-MASTER',
          company_id: 'COMP-MASTER',
          company_name: 'Saimetric Master Hub',
          branch_id: 'BR-MAIN',
          role: 'SUPER_ADMIN',
          user_id: 'USR-MASTER-001',
          full_name: 'Andre Kudakwashe',
          user: {
            id: 'USR-MASTER-001',
            name: 'Andre Kudakwashe',
            email: cleanEmail,
            role: 'SUPER_ADMIN' as any,
            companyId: 'COMP-MASTER',
            company_id: 'COMP-MASTER',
            branchId: 'BR-MAIN',
            branch_id: 'BR-MAIN',
            active: 'Y',
          },
        };
      }
    }

    // Try central server owner-login
    try {
      const res = await fetch('/api/saas/owner-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password: passwordOrPin }),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success' || data.success === true) {
          return {
            status: 'success',
            success: true,
            authProvider: 'sheets_appscript',
            authModeUsed: 'hybrid',
            message: data.message || 'Owner authenticated successfully.',
            token: data.token,
            businessId: data.company_id || data.businessId,
            company_id: data.company_id || data.businessId,
            company_name: data.company_name,
            branch_id: data.branch_id || 'BR-MAIN',
            role: (data.role || 'OWNER').toUpperCase(),
            user_id: data.user_id,
            full_name: data.full_name,
            user: {
              id: data.user_id,
              name: data.full_name,
              email: cleanEmail,
              role: (data.role || 'OWNER').toUpperCase() as any,
              companyId: data.company_id || data.businessId,
              company_id: data.company_id || data.businessId,
              branchId: data.branch_id || 'BR-MAIN',
              branch_id: data.branch_id || 'BR-MAIN',
              active: 'Y',
            },
          };
        }
      }
    } catch (e) {
      // Fallback to Apps Script direct
    }

    // Fall back to Google Apps Script owner auth
    try {
      const appsScriptRes = await authenticateOwnerWithAppsScript(cleanEmail, passwordOrPin);
      if (appsScriptRes.status === 'success' || appsScriptRes.success === true) {
        return {
          status: 'success',
          success: true,
          authProvider: 'sheets_appscript',
          authModeUsed: 'pin_6_digit',
          message: appsScriptRes.message || 'Owner verified via Google Apps Script.',
          businessId: appsScriptRes.businessId || companyId || 'COMP-001',
          company_id: appsScriptRes.businessId || companyId || 'COMP-001',
          company_name: appsScriptRes.company_name,
          branch_id: appsScriptRes.branch_id || 'BR-MAIN',
          role: (appsScriptRes.role || 'OWNER').toUpperCase(),
          user_id: appsScriptRes.user_id || 'USR-OWNER',
          full_name: appsScriptRes.full_name || 'Business Owner',
          user: {
            id: appsScriptRes.user_id || 'USR-OWNER',
            name: appsScriptRes.full_name || 'Business Owner',
            email: cleanEmail,
            role: (appsScriptRes.role || 'OWNER').toUpperCase() as any,
            companyId: appsScriptRes.businessId || companyId || 'COMP-001',
            company_id: appsScriptRes.businessId || companyId || 'COMP-001',
            branchId: appsScriptRes.branch_id || 'BR-MAIN',
            branch_id: appsScriptRes.branch_id || 'BR-MAIN',
            active: 'Y',
          },
        };
      }
    } catch (err) {}

    return {
      status: 'error',
      success: false,
      authProvider: 'sheets_appscript',
      authModeUsed: 'pin_6_digit',
      message: 'Invalid email or password. Please verify your credentials.',
    };
  }

  /**
   * Internal staff PIN verification
   */
  private async verifyStaffPin(
    companyId: string,
    staffId: string,
    staffName: string,
    pin: string,
    backendType: BackendType
  ): Promise<AuthResult> {
    // 1. Verify against local Room DB staff store first for zero-latency response
    const localStaffList = getSalespeopleForCompany(companyId);
    const localUser = localStaffList.find((s) => s.id === staffId || s.name.toLowerCase() === staffName.toLowerCase());

    if (localUser && localUser.pin && String(localUser.pin).trim() === pin) {
      return {
        status: 'success',
        success: true,
        authProvider: backendType,
        authModeUsed: 'pin_6_digit',
        message: `Verified via ${backendType.toUpperCase()} PIN validation.`,
        user: localUser,
      };
    }

    // 2. Verify with central server / Google Apps Script
    try {
      const response = await authenticateStaffWithAppsScript(companyId, staffId, staffName, pin);
      if (response.status === 'success' || response.success === true) {
        return {
          status: 'success',
          success: true,
          authProvider: backendType,
          authModeUsed: 'pin_6_digit',
          message: response.message || 'Staff authenticated successfully.',
          user: response.user || localUser,
        };
      } else {
        return {
          status: 'error',
          success: false,
          authProvider: backendType,
          authModeUsed: 'pin_6_digit',
          message: response.message || `Incorrect PIN for ${staffName}.`,
        };
      }
    } catch (err: any) {
      // In offline mode, if PIN was '1234' default, allow fallback for emergency POS continuity
      if (pin === '1234') {
        return {
          status: 'success',
          success: true,
          authProvider: 'room',
          authModeUsed: 'pin_6_digit',
          message: 'Offline emergency access granted with default credentials.',
          user: localUser || {
            id: staffId,
            name: staffName,
            companyId,
            company_id: companyId,
            role: 'CASHIER' as any,
          },
        };
      }

      return {
        status: 'error',
        success: false,
        authProvider: backendType,
        authModeUsed: 'pin_6_digit',
        message: err?.message || 'Authentication error verifying PIN.',
      };
    }
  }

  /**
   * Internal staff Cloud Native verification (Firebase Auth / Supabase Auth)
   */
  private async verifyStaffNativeCloud(
    companyId: string,
    staffId: string,
    staffName: string,
    passwordOrSecret: string,
    backendType: BackendType,
    config: any
  ): Promise<AuthResult> {
    // Firebase Auth REST verification
    if (backendType === 'firebase' && config?.firebaseConfig?.apiKey) {
      try {
        const email = `${staffId.toLowerCase()}@tenant.${config.firebaseConfig.projectId}.saimetric.internal`;
        const res = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.firebaseConfig.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              password: passwordOrSecret,
              returnSecureToken: true,
            }),
            signal: AbortSignal.timeout(6000),
          }
        );

        if (res.ok) {
          const data = await res.json();
          return {
            status: 'success',
            success: true,
            authProvider: 'firebase',
            authModeUsed: 'backend_native',
            token: data.idToken,
            message: 'Authenticated via Firebase Identity Platform.',
          };
        }
      } catch (e) {
        // Fall back to local check
      }
    }

    // Supabase Auth REST verification
    if (backendType === 'supabase' && config?.supabaseConfig?.projectUrl) {
      try {
        const cleanUrl = config.supabaseConfig.projectUrl.replace(/\/+$/, '');
        const email = `${staffId.toLowerCase()}@enterprise.${companyId.toLowerCase()}.saimetric.internal`;
        const res = await fetch(`${cleanUrl}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: config.supabaseConfig.anonKey || config.supabaseConfig.serviceRoleKey,
          },
          body: JSON.stringify({
            email,
            password: passwordOrSecret,
          }),
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const data = await res.json();
          return {
            status: 'success',
            success: true,
            authProvider: 'supabase',
            authModeUsed: 'backend_native',
            token: data.access_token,
            message: 'Authenticated via Supabase Enterprise Auth.',
          };
        }
      } catch (e) {}
    }

    // If native cloud fails or credentials are placeholder, fall back to checking if password matches staff pin
    return await this.verifyStaffPin(companyId, staffId, staffName, passwordOrSecret, backendType);
  }
}

export const backendAuthService = new BackendAuthService();
