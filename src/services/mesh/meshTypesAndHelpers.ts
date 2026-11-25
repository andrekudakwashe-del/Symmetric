import {
  getCurrentCompany,
  getTransactionsDigest,
} from '../../db/roomDatabase';
import { EntitySnapshot } from '../sync/SyncEnvelope';

export type PackageSyncMode =
  | 'CLOUD_ONLY_SUPABASE'
  | 'CLOUD_ONLY_APPSCRIPTS'
  | 'HUB_ONLY'
  | 'HUB_CLOUD';

export type MeshConnectionMode =
  | 'CLOUD_MESH'
  | 'LOCAL_HUB'
  | 'LOCAL_OFFLINE'
  | 'CLOUD_ONLY';

export interface MeshSyncProgress {
  isActive: boolean;
  current: number;
  total: number;
  message: string;
  percentage: number;
}

export interface MeshEventLog {
  id: string;
  timestamp: string;
  type:
    | 'DISCOVERY'
    | 'BROADCAST'
    | 'EPIDEMIC_HOP'
    | 'CONFLICT_RESOLVED'
    | 'CLOUD_SYNC'
    | 'ACK'
    | 'SECURITY_DROP'
    | 'STORAGE';
  message: string;
  sourceDevice: string;
  targetDevice?: string;
  ttl?: number;
  uuid?: string;
}

export interface VirtualDevice {
  id: string;
  name: string;
  companyId: string;
  branchCode: string;
  branchId: string;
  isOnline: boolean;
  hasInternet: boolean;
  sales: Array<{
    uuid: string;
    deviceId: string;
    timestamp: number;
    invoiceNumber: string;
    totalAmount: number;
    syncStatus: 'pending' | 'synced';
    hash: string;
  }>;
  pendingQueue: Array<{
    uuid: string;
    recordUuid: string;
    tableName: string;
    deviceId: string;
    timestamp: number;
    syncStatus: 'pending' | 'synced';
    hash: string;
    payload: any;
  }>;
}

// Keys for localStorage persistence
export const PREFS_BRANCH_KEY = 'saimetric_mesh_branch_code';
export const PREFS_BRANCH_ID_KEY = 'saimetric_mesh_branch_id';
export const PREFS_DEVICE_KEY = 'saimetric_mesh_device_name';
export const PREFS_DEVICE_ID_KEY = 'saimetric_mesh_device_id';
export const PREFS_COMPANY_KEY = 'saimetric_mesh_company_id';
export const PREFS_AUTODETECT_KEY = 'saimetric_mesh_autodetect';

// Public Zero-Config Secure WebSocket MQTT Brokers for Instant Cross-Device P2P
export const PUBLIC_MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

/**
 * 32-bit FNV-1a Checksum over sorted array of IDs
 */
export const computeIdsChecksum = (ids: string[]): string => {
  if (!Array.isArray(ids) || ids.length === 0) return '00000000';
  const sorted = [...ids].sort();
  let hash = 0x811c9dc5;
  for (const id of sorted) {
    const str = String(id);
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 124; // '|'
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/**
 * Generates compact aggregate snapshot for an entity type: count, totalSum, and idHash
 */
export const generateEntitySnapshot = (
  entityType: string,
  startDate?: string,
  endDate?: string
): EntitySnapshot => {
  const digest = getTransactionsDigest(entityType, startDate, endDate);
  const ids = digest.items.map((it) => String(it.id));
  const idHash = computeIdsChecksum(ids);

  return {
    entityType: digest.entityType,
    startDate,
    endDate,
    count: digest.count,
    totalSum: Number(digest.totalSum.toFixed(2)),
    idHash,
    generatedAt: Date.now(),
  };
};

export const getPackageSyncMode = (): PackageSyncMode => {
  try {
    const comp = getCurrentCompany();
    const strategy = comp?.sync_strategy || 'HUB_CLOUD';
    const backendType =
      comp?.backend_type ||
      comp?.backend_config?.backendType ||
      (comp?.sheet_id ? 'sheets_appscript' : 'room');

    if (strategy === 'CLOUD_ONLY') {
      if (backendType === 'supabase') {
        return 'CLOUD_ONLY_SUPABASE';
      }
      return 'CLOUD_ONLY_APPSCRIPTS';
    }
    if (strategy === 'HUB_ONLY') {
      return 'HUB_ONLY';
    }
    return 'HUB_CLOUD';
  } catch {
    return 'HUB_CLOUD';
  }
};

export function calculateRecordHash(
  uuid: string,
  deviceId: string,
  timestamp: number,
  total: number
): string {
  const raw = `${uuid}:${deviceId}:${timestamp}:${total}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'H-' + Math.abs(hash).toString(16);
}

let lastChimeTime = 0;
export function playChime(): void {
  const nowMs = Date.now();
  if (nowMs - lastChimeTime < 1200) return; // Rate-limit chimes
  lastChimeTime = nowMs;

  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.1); // A5
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
    setTimeout(() => {
      try {
        ctx.close();
      } catch {}
    }, 500);
  } catch {}
}

export type SyncCoreListener = (envelope: any) => void;
const syncCoreListeners: Set<SyncCoreListener> = new Set();

export const registerSyncCoreListener = (
  handler: SyncCoreListener
): (() => void) => {
  syncCoreListeners.add(handler);
  return () => {
    syncCoreListeners.delete(handler);
  };
};

export const notifySyncCoreListeners = (envelope: any): void => {
  syncCoreListeners.forEach((fn) => {
    try {
      fn(envelope);
    } catch {}
  });
};
