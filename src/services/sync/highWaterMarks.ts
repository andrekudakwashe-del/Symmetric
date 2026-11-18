export const SAIMETRIC_LAST_STAFF_SYNC = 'saimetric_last_staff_sync';
export const SAIMETRIC_LAST_BRANCH_SYNC = 'saimetric_last_branch_sync';
export const SAIMETRIC_LAST_CUSTOMER_SYNC = 'saimetric_last_customer_sync';
export const SAIMETRIC_LAST_CASH_ACCOUNT_SYNC = 'saimetric_last_cash_account_sync';
export const SAIMETRIC_LAST_CASUAL_WORKER_SYNC = 'saimetric_last_casual_worker_sync';
export const SAIMETRIC_LAST_STOCKTAKE_SESSION_SYNC = 'saimetric_last_stocktake_session_sync';
export const SAIMETRIC_LAST_MULTI_CURRENCY_SYNC = 'saimetric_last_multi_currency_sync';

export function parseTimestampMs(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num) && num > 1000000000000) return num;
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function getStoredHwm(key: string): number {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      const stored = storage.getItem(key);
      if (stored) {
        const num = Number(stored);
        if (!isNaN(num) && num > 0) return num;
        const parsed = new Date(stored).getTime();
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  } catch (e) {
    console.warn('[HWM] Error reading HWM key:', key, e);
  }
  return 0;
}

function setStoredHwm(key: string, ts: number): void {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      storage.setItem(key, String(ts));
    }
  } catch (e) {
    console.warn('[HWM] Error writing HWM key:', key, e);
  }
}

// Staff
export function getLastStaffSync(): number {
  return getStoredHwm(SAIMETRIC_LAST_STAFF_SYNC);
}

export function setLastStaffSync(ts: number): void {
  setStoredHwm(SAIMETRIC_LAST_STAFF_SYNC, ts);
}

export function markStaffSyncComplete(hubCutoffTs: number): void {
  const valid = typeof hubCutoffTs === 'number' && !isNaN(hubCutoffTs) && hubCutoffTs > 0 ? hubCutoffTs : Date.now();
  setLastStaffSync(valid);
  console.log('[HWM] Saved staff HWM:', valid);
}

// Branches
export function getLastBranchSync(): number {
  return getStoredHwm(SAIMETRIC_LAST_BRANCH_SYNC);
}

export function setLastBranchSync(ts: number): void {
  setStoredHwm(SAIMETRIC_LAST_BRANCH_SYNC, ts);
}

export function markBranchSyncComplete(hubCutoffTs: number): void {
  const valid = typeof hubCutoffTs === 'number' && !isNaN(hubCutoffTs) && hubCutoffTs > 0 ? hubCutoffTs : Date.now();
  setLastBranchSync(valid);
  console.log('[HWM] Saved branch HWM:', valid);
}

// Customers
export function getLastCustomerSync(): number {
  return getStoredHwm(SAIMETRIC_LAST_CUSTOMER_SYNC);
}

export function setLastCustomerSync(ts: number): void {
  setStoredHwm(SAIMETRIC_LAST_CUSTOMER_SYNC, ts);
}

export function markCustomerSyncComplete(hubCutoffTs: number): void {
  const valid = typeof hubCutoffTs === 'number' && !isNaN(hubCutoffTs) && hubCutoffTs > 0 ? hubCutoffTs : Date.now();
  setLastCustomerSync(valid);
  console.log('[HWM] Saved customer HWM:', valid);
}

// Cash Accounts
export function getLastCashAccountSync(): number {
  return getStoredHwm(SAIMETRIC_LAST_CASH_ACCOUNT_SYNC);
}

export function setLastCashAccountSync(ts: number): void {
  setStoredHwm(SAIMETRIC_LAST_CASH_ACCOUNT_SYNC, ts);
}

export function markCashAccountSyncComplete(hubCutoffTs: number): void {
  const valid = typeof hubCutoffTs === 'number' && !isNaN(hubCutoffTs) && hubCutoffTs > 0 ? hubCutoffTs : Date.now();
  setLastCashAccountSync(valid);
  console.log('[HWM] Saved cash account HWM:', valid);
}

// Casual Workers
export function getLastCasualWorkerSync(): number {
  return getStoredHwm(SAIMETRIC_LAST_CASUAL_WORKER_SYNC);
}

export function setLastCasualWorkerSync(ts: number): void {
  setStoredHwm(SAIMETRIC_LAST_CASUAL_WORKER_SYNC, ts);
}

export function markCasualWorkerSyncComplete(hubCutoffTs: number): void {
  const valid = typeof hubCutoffTs === 'number' && !isNaN(hubCutoffTs) && hubCutoffTs > 0 ? hubCutoffTs : Date.now();
  setLastCasualWorkerSync(valid);
  console.log('[HWM] Saved casual worker HWM:', valid);
}

// Stocktake Sessions
export function getLastStocktakeSessionSync(): number {
  return getStoredHwm(SAIMETRIC_LAST_STOCKTAKE_SESSION_SYNC);
}

export function setLastStocktakeSessionSync(ts: number): void {
  setStoredHwm(SAIMETRIC_LAST_STOCKTAKE_SESSION_SYNC, ts);
}

export function markStocktakeSessionSyncComplete(hubCutoffTs: number): void {
  const valid = typeof hubCutoffTs === 'number' && !isNaN(hubCutoffTs) && hubCutoffTs > 0 ? hubCutoffTs : Date.now();
  setLastStocktakeSessionSync(valid);
  console.log('[HWM] Saved stocktake session HWM:', valid);
}

// Multi-Currency & Exchange Rates (T2)
export function getLastMultiCurrencySync(): number {
  return getStoredHwm(SAIMETRIC_LAST_MULTI_CURRENCY_SYNC);
}

export function setLastMultiCurrencySync(ts: number): void {
  setStoredHwm(SAIMETRIC_LAST_MULTI_CURRENCY_SYNC, ts);
}

export function markMultiCurrencySyncComplete(hubCutoffTs: number): void {
  const valid = typeof hubCutoffTs === 'number' && !isNaN(hubCutoffTs) && hubCutoffTs > 0 ? hubCutoffTs : Date.now();
  setLastMultiCurrencySync(valid);
  console.log('[HWM] Saved multi-currency HWM:', valid);
}

// Cloud Catch-Up Monotonic Sequence & Timestamp HWM (Apps Script / Cloud Adapters)
export const SAIMETRIC_CLOUD_CATCHUP_SEQ_PREFIX = 'saimetric_cloud_catchup_seq_';
export const SAIMETRIC_CLOUD_CATCHUP_TS_PREFIX = 'saimetric_cloud_catchup_ts_';

function cloudScopeSuffix(companyId?: string, branchId?: string): string {
  const comp = String(companyId || 'COMP-001').trim().toUpperCase();
  const br = String(branchId || 'ALL').trim().toUpperCase();
  return `${comp}_${br}`;
}

export function getCloudCatchupSeq(companyId?: string, branchId?: string): number {
  const key = `${SAIMETRIC_CLOUD_CATCHUP_SEQ_PREFIX}${cloudScopeSuffix(companyId, branchId)}`;
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      const val = Number(storage.getItem(key) || '0');
      return Number.isFinite(val) && val > 0 ? val : 0;
    }
  } catch {}
  return 0;
}

export function setCloudCatchupSeq(companyId: string | undefined, branchId: string | undefined, seq: number): void {
  if (!Number.isFinite(seq) || seq < 0) return;
  const key = `${SAIMETRIC_CLOUD_CATCHUP_SEQ_PREFIX}${cloudScopeSuffix(companyId, branchId)}`;
  setStoredHwm(key, Math.floor(seq));
}

export function getLastCloudCatchupTimestamp(companyId?: string, branchId?: string): number {
  return getStoredHwm(`${SAIMETRIC_CLOUD_CATCHUP_TS_PREFIX}${cloudScopeSuffix(companyId, branchId)}`);
}

export function setLastCloudCatchupTimestamp(companyId: string | undefined, branchId: string | undefined, ts: number): void {
  if (!Number.isFinite(ts) || ts < 0) return;
  setStoredHwm(`${SAIMETRIC_CLOUD_CATCHUP_TS_PREFIX}${cloudScopeSuffix(companyId, branchId)}`, ts);
}

// Tenant JWT Auth Token & Routing Epoch (V7.0 Enterprise Zero-Master-Open Routing)
export const SAIMETRIC_TENANT_JWT_PREFIX = 'saimetric_tenant_jwt_';
export const SAIMETRIC_ROUTING_EPOCH_PREFIX = 'saimetric_routing_epoch_';

function companyScopeKey(companyId?: string): string {
  return String(companyId || 'COMP-001').trim().toUpperCase();
}

export function getTenantAuthToken(companyId?: string): string {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return '';
    return String(storage.getItem(`${SAIMETRIC_TENANT_JWT_PREFIX}${companyScopeKey(companyId)}`) || '').trim();
  } catch {
    return '';
  }
}

export function setTenantAuthToken(companyId: string | undefined, token: string): void {
  try {
    const clean = String(token || '').trim();
    if (!clean) return;
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      storage.setItem(`${SAIMETRIC_TENANT_JWT_PREFIX}${companyScopeKey(companyId)}`, clean);
    }
  } catch (e) {
    console.warn('[HWM] Error saving tenant JWT token:', e);
  }
}

export function clearTenantAuthToken(companyId?: string): void {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      storage.removeItem(`${SAIMETRIC_TENANT_JWT_PREFIX}${companyScopeKey(companyId)}`);
    }
  } catch {}
}

export function getRoutingEpoch(companyId?: string): number {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      const val = Number(storage.getItem(`${SAIMETRIC_ROUTING_EPOCH_PREFIX}${companyScopeKey(companyId)}`) || '1');
      return Number.isFinite(val) && val > 0 ? Math.floor(val) : 1;
    }
  } catch {}
  return 1;
}

export function setRoutingEpoch(companyId: string | undefined, epoch: number): void {
  if (!Number.isFinite(epoch) || epoch <= 0) return;
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (storage) {
      storage.setItem(`${SAIMETRIC_ROUTING_EPOCH_PREFIX}${companyScopeKey(companyId)}`, String(Math.floor(epoch)));
    }
  } catch {}
}

export function resetCloudCatchupCursors(companyId?: string, branchId?: string): void {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return;
    const scopes = Array.from(new Set([branchId || 'ALL', 'ALL']));
    for (const br of scopes) {
      const suffix = cloudScopeSuffix(companyId, br);
      storage.setItem(`${SAIMETRIC_CLOUD_CATCHUP_SEQ_PREFIX}${suffix}`, '0');
      storage.setItem(`${SAIMETRIC_CLOUD_CATCHUP_TS_PREFIX}${suffix}`, '0');
    }
  } catch {}
}
