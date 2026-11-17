import { useEffect, useState } from 'react';

export const MAX_ALLOWED_CLOCK_DRIFT_MS = 5 * 60 * 1000; // 5 minutes (300,000 ms)
const STORAGE_KEY_HWM = 'saimetric_clock_hwm_ms';
const STORAGE_KEY_ALERTS = 'saimetric_clock_security_alerts';
const STORAGE_KEY_OFFSET = 'saimetric_clock_trusted_offset_ms';
const CLOCK_SECURITY_EVENT = 'saimetric_clock_security_changed';

export type TrustedTimeSource =
  | 'CAPACITOR'
  | 'SERVER_PING'
  | 'LOCAL_HUB'
  | 'CLOUD_SERVER'
  | 'MONOTONIC_HWM'
  | 'LOCAL';

export interface ClockSecurityAlert {
  id: string;
  type: 'CLOCK_TAMPERING' | 'HUB_REJECTED_BACKDATE' | 'SUSPICIOUS_BACKDATE';
  deviceId: string;
  deviceName?: string;
  staffName?: string;
  packetType?: string;
  invoiceId?: string;
  claimedDate?: string;
  claimedTimestamp?: string | number;
  serverReceivedAt?: string;
  hubTimestamp?: number;
  driftMs?: number;
  message: string;
  createdAt: string;
  acknowledged?: boolean;
}

export interface ClockSecurityState {
  isClockTampered: boolean;
  isDeviceAutoTime: boolean;
  driftMs: number | null;
  trustedOffsetMs: number;
  trustedSource: TrustedTimeSource;
  reason: string | null;
  lastCheckedAt: number;
  hubRejectedLock: boolean;
}

export interface DeviceAutoTimeCheckResult {
  isAutomatic: boolean;
  isClockTampered: boolean;
  source: TrustedTimeSource;
  trustedTimeMs: number | null;
  driftMs: number | null;
  reason?: string;
}

let inMemoryCheckPromise: Promise<DeviceAutoTimeCheckResult> | null = null;

function readStoredNumber(key: string): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeStoredNumber(key: string, val: number): void {
  try {
    if (typeof localStorage !== 'undefined' && Number.isFinite(val)) {
      localStorage.setItem(key, String(val));
    }
  } catch {}
}

export function getSecurityAlerts(): ClockSecurityAlert[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY_ALERTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSecurityAlerts(alerts: ClockSecurityAlert[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(alerts.slice(0, 120)));
    }
  } catch {}
}

const storedOffset = readStoredNumber(STORAGE_KEY_OFFSET) ?? 0;

let state: ClockSecurityState = {
  isClockTampered: false,
  isDeviceAutoTime: true,
  driftMs: null,
  trustedOffsetMs: storedOffset,
  trustedSource: storedOffset !== 0 ? 'MONOTONIC_HWM' : 'LOCAL',
  reason: null,
  lastCheckedAt: 0,
  hubRejectedLock: false,
};

function notifyClockSecurityListeners(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CLOCK_SECURITY_EVENT, { detail: { ...state } }));
  }
}

export function getClockSecurityState(): ClockSecurityState {
  return { ...state };
}

export function getTrustedNowMs(): number {
  const localNow = Date.now();
  const hwm = readStoredNumber(STORAGE_KEY_HWM) || 0;
  const adjusted = state.trustedOffsetMs !== 0 ? localNow + state.trustedOffsetMs : localNow;
  return Math.max(adjusted, hwm > localNow ? hwm : adjusted);
}

export function getTrustedTodayDateString(): string {
  const d = new Date(getTrustedNowMs());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function recordSecurityAlert(alert: Omit<ClockSecurityAlert, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): ClockSecurityAlert {
  const existing = getSecurityAlerts();
  const newAlert: ClockSecurityAlert = {
    ...alert,
    id: alert.id || `SEC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    createdAt: alert.createdAt || new Date().toISOString(),
    acknowledged: Boolean(alert.acknowledged),
  };

  // Avoid duplicate alerts for identical invoice/packet IDs
  const filtered = existing.filter((a) => {
    if (newAlert.id && a.id === newAlert.id) return false;
    if (
      newAlert.invoiceId &&
      a.invoiceId === newAlert.invoiceId &&
      a.type === newAlert.type
    ) {
      return false;
    }
    return true;
  });

  const next = [newAlert, ...filtered].slice(0, 120);
  saveSecurityAlerts(next);
  notifyClockSecurityListeners();
  return newAlert;
}

export function acknowledgeSecurityAlert(alertId: string): void {
  const existing = getSecurityAlerts();
  const next = existing.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a));
  saveSecurityAlerts(next);
  notifyClockSecurityListeners();
}

export function clearAcknowledgedSecurityAlerts(): void {
  const existing = getSecurityAlerts();
  saveSecurityAlerts(existing.filter((a) => !a.acknowledged));
  notifyClockSecurityListeners();
}

/**
 * Checks native Capacitor OS `Settings.Global.AUTO_TIME` if available.
 * Returns null if running in plain browser/PWA or no native settings plugin is attached.
 */
async function checkCapacitorAutoTime(): Promise<boolean | null> {
  if (typeof window === 'undefined') return null;
  const w = window as any;

  // Check native Android WebView JS bridge if provided by wrapper
  try {
    if (typeof w.AndroidBridge?.getGlobalSetting === 'function') {
      const val = await Promise.resolve(w.AndroidBridge.getGlobalSetting('auto_time'));
      if (val !== undefined && val !== null && val !== '') {
        return val === 1 || val === '1' || val === true || val === 'true';
      }
    }
    if (typeof w.AndroidBridge?.isAutoTimeEnabled === 'function') {
      const val = await Promise.resolve(w.AndroidBridge.isAutoTimeEnabled());
      if (typeof val === 'boolean') return val;
    }
  } catch {}

  const cap = w.Capacitor;
  if (!cap) return null;
  const isNative = typeof cap.isNativePlatform === 'function' ? Boolean(cap.isNativePlatform()) : false;
  if (!isNative && !cap.Plugins) return null;

  const plugins = cap.Plugins || {};
  try {
    const sysPlugin = plugins.SystemSettings || plugins.Settings || plugins.DeviceSettings;
    if (sysPlugin) {
      if (typeof sysPlugin.getAutoTime === 'function') {
        const res = await sysPlugin.getAutoTime();
        if (res && typeof res.enabled === 'boolean') return res.enabled;
        if (res && res.value !== undefined) return Number(res.value) === 1 || res.value === true;
      }
      if (typeof sysPlugin.getGlobal === 'function') {
        const res = await sysPlugin.getGlobal({ setting: 'auto_time' });
        if (res && res.value !== undefined) return Number(res.value) === 1 || res.value === true;
      }
    }
    const devTimePlugin = plugins.DeviceTime || plugins.ClockSettings;
    if (devTimePlugin && typeof devTimePlugin.isAutoTimeEnabled === 'function') {
      const res = await devTimePlugin.isAutoTimeEnabled();
      if (typeof res === 'boolean') return res;
      if (res && typeof res.enabled === 'boolean') return res.enabled;
      if (res && res.autoTime !== undefined) return Number(res.autoTime) === 1 || res.autoTime === true;
    }
  } catch {}

  return null;
}

/**
 * Fetches fresh authoritative time from `/api/health` (RTT-midpoint adjusted).
 * Also checks the HTTP `Date` response header if JSON timestamp is absent.
 */
async function fetchNetworkServerTimeMs(): Promise<number | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

  try {
    const t0 = Date.now();
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
    });
    const t1 = Date.now();
    const rttHalf = Math.max(0, Math.round((t1 - t0) / 2));

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.timestamp === 'number' && data.timestamp > 1_600_000_000_000) {
        return data.timestamp + rttHalf;
      }
      const hdrDate = res.headers.get('date');
      if (hdrDate) {
        const parsed = Date.parse(hdrDate);
        if (Number.isFinite(parsed) && parsed > 1_600_000_000_000) {
          return parsed + rttHalf;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Updates trusted time watermark & compares current `Date.now()` against trusted time.
 * Called automatically when Local Hub (`HUB_INFO`, `PONG`) or Cloud (`Code.gs`, Supabase, Express) returns a timestamp.
 */
export function reportTrustedTimeSample(
  trustedTimeMs: number,
  source: TrustedTimeSource = 'LOCAL_HUB'
): ClockSecurityState {
  if (!Number.isFinite(trustedTimeMs) || trustedTimeMs < 1_600_000_000_000) {
    return getClockSecurityState();
  }

  const localNow = Date.now();
  const driftMs = localNow - trustedTimeMs; // negative means device clock is set in the past
  const isExcessiveDrift = Math.abs(driftMs) > MAX_ALLOWED_CLOCK_DRIFT_MS;
  const prevHwm = readStoredNumber(STORAGE_KEY_HWM) || 0;
  if (trustedTimeMs > prevHwm) {
    writeStoredNumber(STORAGE_KEY_HWM, trustedTimeMs);
  }

  const offset = trustedTimeMs - localNow;
  writeStoredNumber(STORAGE_KEY_OFFSET, offset);

  if (isExcessiveDrift) {
    const diffMins = Math.round(Math.abs(driftMs) / 60000);
    const direction = driftMs < 0 ? 'behind' : 'ahead of';
    const reason = `Device clock is ${diffMins} minute(s) ${direction} verified ${source} time.`;
    state = {
      ...state,
      isClockTampered: true,
      isDeviceAutoTime: false,
      driftMs,
      trustedOffsetMs: offset,
      trustedSource: source,
      reason,
      lastCheckedAt: localNow,
    };
    recordSecurityAlert({
      type: 'CLOCK_TAMPERING',
      deviceId: (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_mesh_device_id')) || 'LOCAL-PWA',
      driftMs,
      claimedTimestamp: localNow,
      hubTimestamp: trustedTimeMs,
      message: reason,
    });
    notifyClockSecurityListeners();
  } else {
    // Clock matches verified server/hub time within 5 minutes
    const shouldClearHubLock = state.hubRejectedLock && state.isDeviceAutoTime;
    state = {
      ...state,
      isClockTampered: !state.isDeviceAutoTime ? true : false,
      hubRejectedLock: shouldClearHubLock ? false : state.hubRejectedLock,
      driftMs,
      trustedOffsetMs: offset,
      trustedSource: source,
      reason: state.isDeviceAutoTime ? null : state.reason,
      lastCheckedAt: localNow,
    };
    notifyClockSecurityListeners();
  }

  return getClockSecurityState();
}

/**
 * Triggers a security lock directly (e.g., when Termux Hub rejects a packet and sends `SECURITY_ALERT`).
 */
export function triggerClockTamperLock(
  reason: string,
  meta?: {
    deviceId?: string;
    deviceName?: string;
    packetType?: string;
    invoiceId?: string;
    claimedTimestamp?: number;
    hubTimestamp?: number;
    lockCurrentDevice?: boolean;
  }
): ClockSecurityAlert {
  const lockThisDevice = meta?.lockCurrentDevice !== false;
  const driftMs =
    meta?.claimedTimestamp && meta?.hubTimestamp
      ? meta.claimedTimestamp - meta.hubTimestamp
      : state.driftMs;

  if (lockThisDevice) {
    state = {
      ...state,
      isClockTampered: true,
      isDeviceAutoTime: false,
      hubRejectedLock: true,
      driftMs: driftMs ?? state.driftMs,
      reason,
      lastCheckedAt: Date.now(),
    };
  }

  const alert = recordSecurityAlert({
    type: 'HUB_REJECTED_BACKDATE',
    deviceId: meta?.deviceId || 'UNKNOWN-DEVICE',
    deviceName: meta?.deviceName,
    packetType: meta?.packetType,
    invoiceId: meta?.invoiceId,
    claimedTimestamp: meta?.claimedTimestamp,
    hubTimestamp: meta?.hubTimestamp,
    driftMs: driftMs ?? undefined,
    message: reason,
  });

  notifyClockSecurityListeners();
  return alert;
}

/**
 * PART A Utility: `isDeviceTimeAutomatic()`
 * - In Capacitor: checks OS-level `Settings.Global.AUTO_TIME`.
 * - In PWA: pings fresh server/network time and checks monotonic high-water mark against `Date.now()`.
 * - Flags `isClockTampered = true` if OS Auto-Time is off OR drift > 5 minutes (300,000 ms).
 */
export async function isDeviceTimeAutomatic(): Promise<DeviceAutoTimeCheckResult> {
  if (inMemoryCheckPromise) {
    return inMemoryCheckPromise;
  }

  inMemoryCheckPromise = (async (): Promise<DeviceAutoTimeCheckResult> => {
    const localNow = Date.now();
    const prevHwm = readStoredNumber(STORAGE_KEY_HWM) || 0;

    // 1. OS-level check when running inside Capacitor Android wrapper
    const nativeAutoTime = await checkCapacitorAutoTime();
    if (nativeAutoTime === false) {
      const reason = 'Android OS Automatic Date & Time (Settings.Global.AUTO_TIME) is disabled.';
      state = {
        ...state,
        isClockTampered: true,
        isDeviceAutoTime: false,
        trustedSource: 'CAPACITOR',
        reason,
        lastCheckedAt: localNow,
      };
      recordSecurityAlert({
        type: 'CLOCK_TAMPERING',
        deviceId: (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_mesh_device_id')) || 'CAPACITOR-POS',
        claimedTimestamp: localNow,
        message: reason,
      });
      notifyClockSecurityListeners();
      return {
        isAutomatic: false,
        isClockTampered: true,
        source: 'CAPACITOR',
        trustedTimeMs: null,
        driftMs: state.driftMs,
        reason,
      };
    }

    // 2. Monotonic Rollback Guard (catches offline clock-rolling immediately even without network)
    if (prevHwm > 0 && localNow < prevHwm - MAX_ALLOWED_CLOCK_DRIFT_MS) {
      const driftMs = localNow - prevHwm;
      const reason = `Device clock was rolled backward by ${Math.round(Math.abs(driftMs) / 60000)} minute(s) below last verified time.`;
      state = {
        ...state,
        isClockTampered: true,
        isDeviceAutoTime: false,
        driftMs,
        trustedSource: 'MONOTONIC_HWM',
        reason,
        lastCheckedAt: localNow,
      };
      recordSecurityAlert({
        type: 'CLOCK_TAMPERING',
        deviceId: (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_mesh_device_id')) || 'LOCAL-PWA',
        driftMs,
        claimedTimestamp: localNow,
        hubTimestamp: prevHwm,
        message: reason,
      });
      notifyClockSecurityListeners();
      return {
        isAutomatic: false,
        isClockTampered: true,
        source: 'MONOTONIC_HWM',
        trustedTimeMs: prevHwm,
        driftMs,
        reason,
      };
    }

    // 3. Fresh network server ping heuristic
    const serverMs = await fetchNetworkServerTimeMs();
    if (serverMs !== null) {
      const driftMs = localNow - serverMs;
      const isExcessiveDrift = Math.abs(driftMs) > MAX_ALLOWED_CLOCK_DRIFT_MS;
      const offset = serverMs - localNow;
      writeStoredNumber(STORAGE_KEY_OFFSET, offset);
      if (serverMs > prevHwm) {
        writeStoredNumber(STORAGE_KEY_HWM, serverMs);
      }

      if (isExcessiveDrift) {
        const diffMins = Math.round(Math.abs(driftMs) / 60000);
        const reason = `Device clock differs from server time by ${diffMins} minute(s).`;
        state = {
          ...state,
          isClockTampered: true,
          isDeviceAutoTime: false,
          driftMs,
          trustedOffsetMs: offset,
          trustedSource: 'SERVER_PING',
          reason,
          lastCheckedAt: localNow,
        };
        recordSecurityAlert({
          type: 'CLOCK_TAMPERING',
          deviceId: (typeof localStorage !== 'undefined' && localStorage.getItem('saimetric_mesh_device_id')) || 'LOCAL-PWA',
          driftMs,
          claimedTimestamp: localNow,
          hubTimestamp: serverMs,
          message: reason,
        });
        notifyClockSecurityListeners();
        return {
          isAutomatic: false,
          isClockTampered: true,
          source: 'SERVER_PING',
          trustedTimeMs: serverMs,
          driftMs,
          reason,
        };
      }

      // Healthy clock verified against network server
      state = {
        ...state,
        isClockTampered: false,
        isDeviceAutoTime: true,
        hubRejectedLock: false,
        driftMs,
        trustedOffsetMs: offset,
        trustedSource: nativeAutoTime === true ? 'CAPACITOR' : 'SERVER_PING',
        reason: null,
        lastCheckedAt: localNow,
      };
      notifyClockSecurityListeners();
      return {
        isAutomatic: true,
        isClockTampered: false,
        source: state.trustedSource,
        trustedTimeMs: serverMs,
        driftMs,
      };
    }

    // 4. Offline fallback using cached Hub/Server offset or monotonic HWM
    const cachedOffset = readStoredNumber(STORAGE_KEY_OFFSET);
    if (cachedOffset !== null && Math.abs(cachedOffset) > MAX_ALLOWED_CLOCK_DRIFT_MS) {
      const trustedEst = localNow + cachedOffset;
      const reason = 'Device clock offset exceeds 5 minutes from last verified Hub/Server time.';
      state = {
        ...state,
        isClockTampered: true,
        isDeviceAutoTime: false,
        driftMs: -cachedOffset,
        trustedOffsetMs: cachedOffset,
        trustedSource: state.trustedSource || 'LOCAL_HUB',
        reason,
        lastCheckedAt: localNow,
      };
      notifyClockSecurityListeners();
      return {
        isAutomatic: false,
        isClockTampered: true,
        source: state.trustedSource,
        trustedTimeMs: trustedEst,
        driftMs: -cachedOffset,
        reason,
      };
    }

    if (localNow > prevHwm) {
      writeStoredNumber(STORAGE_KEY_HWM, localNow);
    }

    const isStillTampered = state.hubRejectedLock || state.isClockTampered;
    state = {
      ...state,
      isDeviceAutoTime: !isStillTampered,
      isClockTampered: isStillTampered,
      trustedSource: nativeAutoTime === true ? 'CAPACITOR' : state.trustedSource,
      lastCheckedAt: localNow,
    };
    notifyClockSecurityListeners();
    return {
      isAutomatic: !state.isClockTampered,
      isClockTampered: state.isClockTampered,
      source: state.trustedSource,
      trustedTimeMs: null,
      driftMs: state.driftMs,
      reason: state.reason || undefined,
    };
  })().finally(() => {
    inMemoryCheckPromise = null;
  });

  return inMemoryCheckPromise;
}

/**
 * Computes whether a claimed date/timestamp represents a backdated transaction
 * relative to a server receipt time (defaulting to current trusted/server time).
 */
export function evaluateSuspiciousBackdate(
  claimedDate?: string,
  claimedTimestamp?: string | number,
  serverReceivedAtMs: number = Date.now()
): { server_received_at: string; suspicious_backdate: boolean } {
  const serverIso = new Date(serverReceivedAtMs).toISOString();
  const serverDay = serverIso.slice(0, 10);

  let claimedDay = '';
  if (claimedDate && typeof claimedDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(claimedDate.trim())) {
    claimedDay = claimedDate.trim().slice(0, 10);
  } else if (claimedTimestamp) {
    const parsed =
      typeof claimedTimestamp === 'number'
        ? claimedTimestamp
        : Date.parse(String(claimedTimestamp));
    if (Number.isFinite(parsed) && parsed > 0) {
      claimedDay = new Date(parsed).toISOString().slice(0, 10);
    }
  }

  const suspicious_backdate = Boolean(claimedDay && claimedDay < serverDay);
  return {
    server_received_at: serverIso,
    suspicious_backdate,
  };
}

export function useClockSecurity() {
  const [snapshot, setSnapshot] = useState<ClockSecurityState>(() => getClockSecurityState());
  const [alerts, setAlerts] = useState<ClockSecurityAlert[]>(() => getSecurityAlerts());

  useEffect(() => {
    const handleChange = () => {
      setSnapshot(getClockSecurityState());
      setAlerts(getSecurityAlerts());
    };
    window.addEventListener(CLOCK_SECURITY_EVENT, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(CLOCK_SECURITY_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  return {
    ...snapshot,
    alerts,
    recheckClock: isDeviceTimeAutomatic,
    acknowledgeAlert: acknowledgeSecurityAlert,
    clearAcknowledgedAlerts: clearAcknowledgedSecurityAlerts,
  };
}
