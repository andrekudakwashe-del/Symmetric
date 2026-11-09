export const SAIMETRIC_LAST_STAFF_SYNC = 'saimetric_last_staff_sync';
export const SAIMETRIC_LAST_BRANCH_SYNC = 'saimetric_last_branch_sync';
export const SAIMETRIC_LAST_CUSTOMER_SYNC = 'saimetric_last_customer_sync';
export const SAIMETRIC_LAST_CASH_ACCOUNT_SYNC = 'saimetric_last_cash_account_sync';
export const SAIMETRIC_LAST_CASUAL_WORKER_SYNC = 'saimetric_last_casual_worker_sync';
export const SAIMETRIC_LAST_STOCKTAKE_SESSION_SYNC = 'saimetric_last_stocktake_session_sync';

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
