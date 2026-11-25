/**
 * Local Hub v4.2.0 Encrypted WAL Storage Telemetry, Pressure Alerts &
 * Authenticated `.saimpack` Offline Archive WebSocket RPC Manager.
 *
 * Protocol coverage:
 *  - `/health` `storageCapacity` parsing
 *  - Push: `STORAGE_PRESSURE_ALERT`
 *  - Authenticated WS RPCs (requires Mutual-HMAC `AUTH_OK`, matched by `requestId`):
 *    - `STORAGE_STATUS_QUERY`      -> `STORAGE_STATUS_RESPONSE`
 *    - `ARCHIVE_PACK_LIST`         -> `ARCHIVE_PACK_LIST_RESPONSE`
 *    - `ARCHIVE_PACK_CREATE`       -> `ARCHIVE_PACK_CREATED`
 *    - `ARCHIVE_PACK_DOWNLOAD`     -> `ARCHIVE_PACK_DOWNLOAD_CHUNK` (48 KB ordered reassembly + SHA-256 verification)
 *    - `ARCHIVE_PACK_CONFIRM_EVICT`-> `ARCHIVE_PACK_EVICT_ACK`
 *    - Error frame: `ARCHIVE_PACK_ERROR`
 */

export type HubStorageStage =
  | 'NORMAL'
  | 'WARNING_75'
  | 'ARCHIVE_RECOMMENDED_90'
  | 'CRITICAL_STORAGE';

export interface HubStorageCapacity {
  engine: string;
  stage: HubStorageStage;
  totalRecords: number;
  t1Count: number;
  t2Count: number;
  unsyncedT1Count: number;
  softRecordLimit: number;
  usagePct: number;
  walFrames: number;
  walBytes: number;
  snapshotBytes: number;
  diskBytes: number;
  maxStorageMb: number;
  hubId?: string;
  updatedAt: number;
}

export interface HubStoragePressureAlert {
  stage: HubStorageStage;
  totalRecords: number;
  softRecordLimit: number;
  usagePct: number;
  unsyncedT1Count: number;
  hubId: string;
  timestamp: number;
}

export interface HubArchivePackSummary {
  packId: string;
  fileName: string;
  createdAt: number;
  fromTs?: number;
  toTs?: number;
  cutoffTs?: number;
  preserveRecentDays?: number;
  recordCount: number;
  entityCounts: Record<string, number>;
  uncompressedBytes: number;
  compressedBytes: number;
  compressionRatioPct?: number;
  payloadSha256: string;
  gzipSha256?: string;
  encrypted: boolean;
  kdf?: string;
  evicted?: boolean;
  evictedAt?: number;
}

export interface HubArchiveEvictionReceipt {
  packId: string;
  payloadSha256: string;
  removedCount: number;
  evictedAt: number;
  fileName?: string;
}

export interface HubArchivePackListResult {
  ok: boolean;
  packs: HubArchivePackSummary[];
  evictionReceipts: HubArchiveEvictionReceipt[];
}

export interface HubArchiveCreateOptions {
  preserveRecentDays?: number;
  passphrase?: string;
  includeSynced?: boolean;
}

export interface HubArchiveCreateResult {
  ok: boolean;
  packId: string;
  fileName: string;
  recordCount: number;
  entityCounts: Record<string, number>;
  uncompressedBytes: number;
  compressedBytes: number;
  compressionRatioPct: number;
  payloadSha256: string;
  gzipSha256: string;
  encrypted: boolean;
  kdf?: string;
}

export interface HubArchiveDownloadProgress {
  packId: string;
  receivedChunks: number;
  totalChunks: number;
  receivedBytes: number;
  percent: number;
}

export interface HubArchiveDownloadResult {
  packId: string;
  fileName: string;
  payloadSha256: string;
  gzipSha256?: string;
  fileSha256: string;
  verified: boolean;
  verificationMode: 'FILE_SHA256' | 'PAYLOAD_BYTES_SHA256' | 'UNCOMPRESSED_SHA256' | 'ENVELOPE_INTEGRITY';
  totalChunks: number;
  bytes: number;
  content: string;
}

export interface HubArchiveEvictResult {
  ok: boolean;
  packId: string;
  removedCount: number;
  payloadSha256: string;
  evictedAt: number;
  storageStatus?: HubStorageCapacity | null;
}

export interface HubStorageSnapshot {
  storageCapacity: HubStorageCapacity | null;
  lastPressureAlert: HubStoragePressureAlert | null;
  bannerStage: HubStorageStage;
  isBannerDismissed: boolean;
  updatedAt: number;
}

const VALID_STAGES = new Set<HubStorageStage>([
  'NORMAL',
  'WARNING_75',
  'ARCHIVE_RECOMMENDED_90',
  'CRITICAL_STORAGE',
]);

const STAGE_SEVERITY: Record<HubStorageStage, number> = {
  NORMAL: 0,
  WARNING_75: 1,
  ARCHIVE_RECOMMENDED_90: 2,
  CRITICAL_STORAGE: 3,
};

const HEX_64_REGEX = /^[a-f0-9]{64}$/i;

function toNonNegNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function normalizeStorageStage(raw: unknown): HubStorageStage {
  const s = String(raw || '').trim().toUpperCase() as HubStorageStage;
  return VALID_STAGES.has(s) ? s : 'NORMAL';
}

export function normalizeStorageCapacity(
  raw: any,
  fallbackHubId?: string
): HubStorageCapacity | null {
  if (!raw || typeof raw !== 'object') return null;
  // Support nested { storageCapacity: ... } or { storageStatus: ... } or flat object
  const src =
    raw.storageCapacity && typeof raw.storageCapacity === 'object'
      ? raw.storageCapacity
      : raw.storageStatus && typeof raw.storageStatus === 'object'
      ? raw.storageStatus
      : raw.storage_capacity && typeof raw.storage_capacity === 'object'
      ? raw.storage_capacity
      : raw;

  const hasKnownField =
    src.stage !== undefined ||
    src.totalRecords !== undefined ||
    src.total_records !== undefined ||
    src.softRecordLimit !== undefined ||
    src.soft_record_limit !== undefined ||
    src.usagePct !== undefined ||
    src.usage_pct !== undefined ||
    src.engine !== undefined;

  if (!hasKnownField) return null;

  const totalRecords = Math.floor(toNonNegNumber(src.totalRecords ?? src.total_records, 0));
  const softRecordLimit = Math.floor(
    toNonNegNumber(src.softRecordLimit ?? src.soft_record_limit, 0)
  );
  const rawPct = src.usagePct ?? src.usage_pct;
  const computedPct =
    rawPct !== undefined && Number.isFinite(Number(rawPct))
      ? Math.max(0, Math.min(100, Number(rawPct)))
      : softRecordLimit > 0
      ? Math.min(100, Number(((totalRecords / softRecordLimit) * 100).toFixed(2)))
      : 0;

  return {
    engine: String(src.engine || 'PURE_JS_ENCRYPTED_WAL_V1').trim(),
    stage: normalizeStorageStage(src.stage),
    totalRecords,
    t1Count: Math.floor(toNonNegNumber(src.t1Count ?? src.t1_count, 0)),
    t2Count: Math.floor(toNonNegNumber(src.t2Count ?? src.t2_count, 0)),
    unsyncedT1Count: Math.floor(
      toNonNegNumber(src.unsyncedT1Count ?? src.unsynced_t1_count, 0)
    ),
    softRecordLimit,
    usagePct: computedPct,
    walFrames: Math.floor(toNonNegNumber(src.walFrames ?? src.wal_frames, 0)),
    walBytes: Math.floor(toNonNegNumber(src.walBytes ?? src.wal_bytes, 0)),
    snapshotBytes: Math.floor(toNonNegNumber(src.snapshotBytes ?? src.snapshot_bytes, 0)),
    diskBytes: Math.floor(toNonNegNumber(src.diskBytes ?? src.disk_bytes, 0)),
    maxStorageMb: toNonNegNumber(src.maxStorageMb ?? src.max_storage_mb, 0),
    hubId: String(src.hubId || src.hub_id || fallbackHubId || '').trim() || undefined,
    updatedAt: Date.now(),
  };
}

export function normalizeStoragePressureAlert(
  raw: any,
  fallbackHubId?: string
): HubStoragePressureAlert | null {
  if (!raw || typeof raw !== 'object') return null;
  const stage = normalizeStorageStage(raw.stage);
  const totalRecords = Math.floor(toNonNegNumber(raw.totalRecords ?? raw.total_records, 0));
  const softRecordLimit = Math.floor(
    toNonNegNumber(raw.softRecordLimit ?? raw.soft_record_limit, 0)
  );
  const rawPct = raw.usagePct ?? raw.usage_pct;
  const usagePct =
    rawPct !== undefined && Number.isFinite(Number(rawPct))
      ? Math.max(0, Math.min(100, Number(rawPct)))
      : softRecordLimit > 0
      ? Math.min(100, Number(((totalRecords / softRecordLimit) * 100).toFixed(2)))
      : 0;
  const unsyncedT1Count = Math.floor(
    toNonNegNumber(raw.unsyncedT1Count ?? raw.unsynced_t1_count, 0)
  );
  const hubId = String(raw.hubId || raw.hub_id || fallbackHubId || '').trim();
  const timestamp = Number(raw.timestamp) > 0 ? Number(raw.timestamp) : Date.now();

  return {
    stage,
    totalRecords,
    softRecordLimit,
    usagePct,
    unsyncedT1Count,
    hubId,
    timestamp,
  };
}

function normalizeEntityCounts(raw: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) {
      out[k] = Math.floor(n);
    }
  }
  return out;
}

function normalizePackSummary(raw: any): HubArchivePackSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const packId = String(raw.packId || raw.pack_id || '').trim();
  if (!packId) return null;
  const fileName = String(raw.fileName || raw.file_name || `${packId}.saimpack`).trim();
  return {
    packId,
    fileName,
    createdAt: Number(raw.createdAt ?? raw.created_at) || Date.now(),
    fromTs: raw.fromTs !== undefined ? Number(raw.fromTs) : undefined,
    toTs: raw.toTs !== undefined ? Number(raw.toTs) : undefined,
    cutoffTs: raw.cutoffTs !== undefined ? Number(raw.cutoffTs) : undefined,
    preserveRecentDays:
      raw.preserveRecentDays !== undefined ? Number(raw.preserveRecentDays) : undefined,
    recordCount: Math.floor(toNonNegNumber(raw.recordCount ?? raw.record_count, 0)),
    entityCounts: normalizeEntityCounts(raw.entityCounts ?? raw.entity_counts),
    uncompressedBytes: Math.floor(
      toNonNegNumber(raw.uncompressedBytes ?? raw.uncompressed_bytes, 0)
    ),
    compressedBytes: Math.floor(
      toNonNegNumber(raw.compressedBytes ?? raw.compressed_bytes, 0)
    ),
    compressionRatioPct:
      raw.compressionRatioPct !== undefined
        ? Number(raw.compressionRatioPct)
        : undefined,
    payloadSha256: String(raw.payloadSha256 || raw.payload_sha256 || '').trim().toLowerCase(),
    gzipSha256: String(raw.gzipSha256 || raw.gzip_sha256 || '').trim().toLowerCase() || undefined,
    encrypted: Boolean(raw.encrypted),
    kdf: raw.kdf ? String(raw.kdf) : undefined,
    evicted: Boolean(raw.evicted),
    evictedAt: raw.evictedAt ? Number(raw.evictedAt) : undefined,
  };
}

function normalizeEvictionReceipt(raw: any): HubArchiveEvictionReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const packId = String(raw.packId || raw.pack_id || '').trim();
  if (!packId) return null;
  return {
    packId,
    payloadSha256: String(raw.payloadSha256 || raw.payload_sha256 || '').trim().toLowerCase(),
    removedCount: Math.floor(toNonNegNumber(raw.removedCount ?? raw.removed_count, 0)),
    evictedAt: Number(raw.evictedAt ?? raw.evicted_at) || Date.now(),
    fileName: raw.fileName ? String(raw.fileName) : undefined,
  };
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    // Ensure a standalone ArrayBuffer slice for Web Crypto compatibility
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await subtle.digest('SHA-256', copy.buffer);
    const arr = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < arr.length; i++) {
      hex += arr[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  throw new Error('Web Crypto SHA-256 is unavailable in this runtime.');
}

export async function sha256HexString(text: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(text));
}

function decodeBase64ToUint8Array(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  // Node.js fallback for tests
  const buf = (globalThis as any).Buffer.from(clean, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function gunzipUint8ArrayInBrowser(gzipBytes: Uint8Array): Promise<Uint8Array | null> {
  const Decomp = (globalThis as any).DecompressionStream;
  if (typeof Decomp !== 'function') return null;
  const copy = new Uint8Array(gzipBytes.byteLength);
  copy.set(gzipBytes);
  const stream = new Blob([copy]).stream().pipeThrough(new Decomp('gzip'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Verifies a reassembled `.saimpack` download against the Hub's canonical `payloadSha256`
 * and `gzipSha256` before permitting file save or eviction confirmation.
 */
export async function verifyReassembledArchivePack(params: {
  packId: string;
  reassembledText: string;
  expectedPayloadSha256?: string;
  expectedGzipSha256?: string;
}): Promise<{
  verified: boolean;
  canonicalPayloadSha256: string;
  fileSha256: string;
  gzipSha256?: string;
  verificationMode: HubArchiveDownloadResult['verificationMode'];
}> {
  const expectedPayload = String(params.expectedPayloadSha256 || '').trim().toLowerCase();
  const expectedGzip = String(params.expectedGzipSha256 || '').trim().toLowerCase();

  const fileBytes = new TextEncoder().encode(params.reassembledText);
  const fileSha256 = await sha256HexBytes(fileBytes);

  let envelope: any;
  try {
    envelope = JSON.parse(params.reassembledText);
  } catch {
    throw new Error('Downloaded archive pack is not valid JSON (corrupted or truncated transfer).');
  }

  if (!envelope || typeof envelope !== 'object' || envelope.format !== 'SAIMETRIC_ARCHIVE_PACK_V1') {
    throw new Error('Downloaded archive pack failed format validation (expected SAIMETRIC_ARCHIVE_PACK_V1).');
  }

  if (String(envelope.packId || '').trim() !== params.packId) {
    throw new Error(`Downloaded packId mismatch (expected ${params.packId}, received ${envelope.packId || 'none'}).`);
  }

  const envelopePayloadSha = String(envelope.payloadSha256 || '').trim().toLowerCase();
  const envelopeGzipSha = String(envelope.gzipSha256 || '').trim().toLowerCase();

  if (expectedPayload && envelopePayloadSha && expectedPayload !== envelopePayloadSha) {
    throw new Error('Archive pack payloadSha256 mismatch between transfer header and envelope.');
  }
  if (expectedGzip && envelopeGzipSha && expectedGzip !== envelopeGzipSha) {
    throw new Error('Archive pack gzipSha256 mismatch between transfer header and envelope.');
  }

  const targetPayloadSha = expectedPayload || envelopePayloadSha;
  if (!targetPayloadSha || !HEX_64_REGEX.test(targetPayloadSha)) {
    throw new Error('Archive pack is missing a valid SHA-256 payload digest.');
  }

  if (typeof envelope.payloadBase64 !== 'string' || envelope.payloadBase64.trim().length === 0) {
    throw new Error('Archive pack is missing payloadBase64 data.');
  }

  // 1. Direct canonical match against full serialized `.saimpack` bytes
  if (fileSha256 === targetPayloadSha) {
    return {
      verified: true,
      canonicalPayloadSha256: targetPayloadSha,
      fileSha256,
      gzipSha256: envelopeGzipSha || expectedGzip || undefined,
      verificationMode: 'FILE_SHA256',
    };
  }

  // Decode base64 payload to validate encoding and test payload-level digests
  let decodedPayload: Uint8Array;
  try {
    decodedPayload = decodeBase64ToUint8Array(envelope.payloadBase64);
  } catch {
    throw new Error('Archive pack payloadBase64 could not be decoded.');
  }
  if (decodedPayload.byteLength === 0) {
    throw new Error('Archive pack payloadBase64 decoded to zero bytes.');
  }

  const decodedSha256 = await sha256HexBytes(decodedPayload);
  const rawBase64Sha256 = await sha256HexString(envelope.payloadBase64);

  // 2. Match against decoded or raw payloadBase64 bytes
  if (decodedSha256 === targetPayloadSha || rawBase64Sha256 === targetPayloadSha) {
    return {
      verified: true,
      canonicalPayloadSha256: targetPayloadSha,
      fileSha256,
      gzipSha256: envelopeGzipSha || expectedGzip || undefined,
      verificationMode: 'PAYLOAD_BYTES_SHA256',
    };
  }

  // 3. Unencrypted gzipped archive: verify gzipSha256 AND uncompressed inner JSON payloadSha256
  if (!envelope.encrypted) {
    const targetGzip = expectedGzip || envelopeGzipSha;
    if (targetGzip && decodedSha256 !== targetGzip) {
      throw new Error('Unencrypted archive pack failed gzipSha256 integrity verification.');
    }
    const uncompressed = await gunzipUint8ArrayInBrowser(decodedPayload);
    if (uncompressed) {
      const uncompressedSha = await sha256HexBytes(uncompressed);
      if (uncompressedSha !== targetPayloadSha) {
        throw new Error('Unencrypted archive pack failed canonical payloadSha256 verification.');
      }
      return {
        verified: true,
        canonicalPayloadSha256: targetPayloadSha,
        fileSha256,
        gzipSha256: targetGzip || decodedSha256,
        verificationMode: 'UNCOMPRESSED_SHA256',
      };
    }
  }

  // 4. Encrypted archive where `payloadSha256` is the plaintext inner JSON SHA-256
  //    (cannot be recomputed in-browser without decrypting, so verify envelope crypto metadata + header agreement)
  if (envelope.encrypted) {
    const hasValidCryptoFields =
      typeof envelope.iv === 'string' &&
      envelope.iv.length >= 16 &&
      typeof envelope.tag === 'string' &&
      envelope.tag.length >= 32 &&
      (!expectedPayload || envelopePayloadSha === expectedPayload) &&
      (!expectedGzip || envelopeGzipSha === expectedGzip);

    if (hasValidCryptoFields && HEX_64_REGEX.test(envelopeGzipSha || '')) {
      return {
        verified: true,
        canonicalPayloadSha256: targetPayloadSha,
        fileSha256,
        gzipSha256: envelopeGzipSha || expectedGzip || undefined,
        verificationMode: 'ENVELOPE_INTEGRITY',
      };
    }
  }

  throw new Error('Archive pack failed SHA-256 verification. Do NOT evict Hub data; retry download.');
}

/**
 * Triggers a clean browser file download for a verified `.saimpack` archive.
 */
export function triggerArchivePackBrowserDownload(fileName: string, content: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const safeName = fileName.endsWith('.saimpack')
    ? fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
    : `${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}.saimpack`;
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  }, 1500);
}

interface PendingRpc {
  requestId: string;
  type: string;
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface DownloadAssemblyState {
  requestId: string;
  packId: string;
  fileName: string;
  payloadSha256: string;
  gzipSha256: string;
  totalChunks: number;
  chunks: Map<number, string>;
  receivedBytes: number;
  onProgress?: (progress: HubArchiveDownloadProgress) => void;
  resolve: (result: HubArchiveDownloadResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface HubStorageRpcDeps {
  isAuthenticated: () => boolean;
  sendPacket: (payload: Record<string, any>) => boolean;
  getActiveHubId: () => string | null;
}

export const HUB_STORAGE_CONTROL_PACKETS = [
  'STORAGE_PRESSURE_ALERT',
  'STORAGE_STATUS_RESPONSE',
  'ARCHIVE_PACK_LIST_RESPONSE',
  'ARCHIVE_PACK_CREATED',
  'ARCHIVE_PACK_DOWNLOAD_CHUNK',
  'ARCHIVE_PACK_EVICT_ACK',
  'ARCHIVE_PACK_ERROR',
] as const;

export class HubStorageRpcManager {
  private storageCapacity: HubStorageCapacity | null = null;
  private lastPressureAlert: HubStoragePressureAlert | null = null;
  private dismissedStageKey: string | null = null;
  private updatedAt = 0;

  private listeners = new Set<(snap: HubStorageSnapshot) => void>();
  private pendingRpcs = new Map<string, PendingRpc>();
  private pendingDownloads = new Map<string, DownloadAssemblyState>();
  private requestCounter = 0;

  constructor(private readonly deps: HubStorageRpcDeps) {}

  private nextRequestId(prefix: string): string {
    this.requestCounter += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now()}-${this.requestCounter}-${rand}`;
  }

  private assertAuthenticated(): void {
    if (!this.deps.isAuthenticated()) {
      throw new Error(
        'Mutual-HMAC authentication (AUTH_OK) with the Local Hub is required for storage and archive RPCs.'
      );
    }
  }

  public getSnapshot(): HubStorageSnapshot {
    const capStage = this.storageCapacity?.stage || 'NORMAL';
    const alertStage = this.lastPressureAlert?.stage || 'NORMAL';
    const bannerStage =
      STAGE_SEVERITY[alertStage] >= STAGE_SEVERITY[capStage] ? alertStage : capStage;
    const currentKey = `${this.storageCapacity?.hubId || this.lastPressureAlert?.hubId || ''}:${bannerStage}`;

    return {
      storageCapacity: this.storageCapacity ? { ...this.storageCapacity } : null,
      lastPressureAlert: this.lastPressureAlert ? { ...this.lastPressureAlert } : null,
      bannerStage,
      isBannerDismissed: bannerStage === 'NORMAL' || this.dismissedStageKey === currentKey,
      updatedAt: this.updatedAt,
    };
  }

  public subscribe(listener: (snap: HubStorageSnapshot) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getSnapshot());
    } catch {}
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.updatedAt = Date.now();
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {}
    });
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('saimetric_hub_storage_updated', { detail: snap }));
      } catch {}
    }
  }

  public dismissBanner(): void {
    const snap = this.getSnapshot();
    if (snap.bannerStage !== 'NORMAL') {
      const hubId = this.storageCapacity?.hubId || this.lastPressureAlert?.hubId || '';
      this.dismissedStageKey = `${hubId}:${snap.bannerStage}`;
      this.emit();
    }
  }

  public updateFromHealth(rawCapacity: any, hubId?: string): void {
    const normalized = normalizeStorageCapacity(rawCapacity, hubId || this.deps.getActiveHubId() || undefined);
    if (!normalized) return;

    const prevStage = this.storageCapacity?.stage || 'NORMAL';
    this.storageCapacity = normalized;

    // If stage escalated to a higher pressure level, re-surface the banner
    if (STAGE_SEVERITY[normalized.stage] > STAGE_SEVERITY[prevStage]) {
      this.dismissedStageKey = null;
    }
    if (normalized.stage === 'NORMAL') {
      this.lastPressureAlert = null;
      this.dismissedStageKey = null;
    }

    this.emit();
  }

  public handleDisconnected(): void {
    const err = new Error('Local Hub connection closed before archive RPC completed.');
    this.pendingRpcs.forEach((rpc) => {
      clearTimeout(rpc.timer);
      rpc.reject(err);
    });
    this.pendingRpcs.clear();

    this.pendingDownloads.forEach((dl) => {
      clearTimeout(dl.timer);
      dl.reject(err);
    });
    this.pendingDownloads.clear();
  }

  public handleIncomingPacket(pType: string, packet: any): boolean {
    if (!packet || typeof packet !== 'object') return false;

    if (pType === 'STORAGE_PRESSURE_ALERT') {
      const alert = normalizeStoragePressureAlert(
        packet,
        this.deps.getActiveHubId() || undefined
      );
      if (!alert) return true;

      const prevStage = this.lastPressureAlert?.stage || this.storageCapacity?.stage || 'NORMAL';
      this.lastPressureAlert = alert;

      // Merge live pressure counts into cached storageCapacity snapshot
      this.storageCapacity = {
        engine: this.storageCapacity?.engine || 'PURE_JS_ENCRYPTED_WAL_V1',
        stage: alert.stage,
        totalRecords: alert.totalRecords,
        t1Count: this.storageCapacity?.t1Count ?? 0,
        t2Count: this.storageCapacity?.t2Count ?? 0,
        unsyncedT1Count: alert.unsyncedT1Count,
        softRecordLimit: alert.softRecordLimit,
        usagePct: alert.usagePct,
        walFrames: this.storageCapacity?.walFrames ?? 0,
        walBytes: this.storageCapacity?.walBytes ?? 0,
        snapshotBytes: this.storageCapacity?.snapshotBytes ?? 0,
        diskBytes: this.storageCapacity?.diskBytes ?? 0,
        maxStorageMb: this.storageCapacity?.maxStorageMb ?? 0,
        hubId: alert.hubId || this.storageCapacity?.hubId,
        updatedAt: Date.now(),
      };

      if (STAGE_SEVERITY[alert.stage] > STAGE_SEVERITY[prevStage]) {
        this.dismissedStageKey = null;
      }
      if (alert.stage === 'NORMAL') {
        this.dismissedStageKey = null;
      }
      this.emit();
      return true;
    }

    const requestId = String(packet.requestId || packet.request_id || '').trim();

    if (pType === 'ARCHIVE_PACK_ERROR') {
      const msg = String(packet.error || packet.message || 'Local Hub archive operation failed.');
      if (requestId && this.pendingRpcs.has(requestId)) {
        const rpc = this.pendingRpcs.get(requestId)!;
        clearTimeout(rpc.timer);
        this.pendingRpcs.delete(requestId);
        rpc.reject(new Error(msg));
      } else if (requestId && this.pendingDownloads.has(requestId)) {
        const dl = this.pendingDownloads.get(requestId)!;
        clearTimeout(dl.timer);
        this.pendingDownloads.delete(requestId);
        dl.reject(new Error(msg));
      }
      return true;
    }

    if (pType === 'STORAGE_STATUS_RESPONSE') {
      const normalized = normalizeStorageCapacity(
        packet,
        this.deps.getActiveHubId() || undefined
      );
      if (normalized) {
        this.updateFromHealth(normalized, normalized.hubId);
      }
      if (requestId && this.pendingRpcs.has(requestId)) {
        const rpc = this.pendingRpcs.get(requestId)!;
        clearTimeout(rpc.timer);
        this.pendingRpcs.delete(requestId);
        rpc.resolve(normalized);
      }
      return true;
    }

    if (pType === 'ARCHIVE_PACK_LIST_RESPONSE') {
      const packs = Array.isArray(packet.packs)
        ? (packet.packs.map(normalizePackSummary).filter(Boolean) as HubArchivePackSummary[])
        : [];
      const evictionReceipts = Array.isArray(packet.evictionReceipts)
        ? (packet.evictionReceipts
            .map(normalizeEvictionReceipt)
            .filter(Boolean) as HubArchiveEvictionReceipt[])
        : [];
      const result: HubArchivePackListResult = {
        ok: packet.ok !== false,
        packs,
        evictionReceipts,
      };
      if (requestId && this.pendingRpcs.has(requestId)) {
        const rpc = this.pendingRpcs.get(requestId)!;
        clearTimeout(rpc.timer);
        this.pendingRpcs.delete(requestId);
        rpc.resolve(result);
      }
      return true;
    }

    if (pType === 'ARCHIVE_PACK_CREATED') {
      const result: HubArchiveCreateResult = {
        ok: packet.ok !== false,
        packId: String(packet.packId || '').trim(),
        fileName: String(packet.fileName || `${packet.packId || 'archive'}.saimpack`).trim(),
        recordCount: Math.floor(toNonNegNumber(packet.recordCount, 0)),
        entityCounts: normalizeEntityCounts(packet.entityCounts),
        uncompressedBytes: Math.floor(toNonNegNumber(packet.uncompressedBytes, 0)),
        compressedBytes: Math.floor(toNonNegNumber(packet.compressedBytes, 0)),
        compressionRatioPct: Number(packet.compressionRatioPct) || 0,
        payloadSha256: String(packet.payloadSha256 || '').trim().toLowerCase(),
        gzipSha256: String(packet.gzipSha256 || '').trim().toLowerCase(),
        encrypted: Boolean(packet.encrypted),
        kdf: packet.kdf ? String(packet.kdf) : undefined,
      };
      if (requestId && this.pendingRpcs.has(requestId)) {
        const rpc = this.pendingRpcs.get(requestId)!;
        clearTimeout(rpc.timer);
        this.pendingRpcs.delete(requestId);
        if (!result.ok || !result.packId) {
          rpc.reject(new Error(String(packet.error || 'Hub failed to create archive pack.')));
        } else {
          rpc.resolve(result);
        }
      }
      return true;
    }

    if (pType === 'ARCHIVE_PACK_DOWNLOAD_CHUNK') {
      this.handleDownloadChunk(requestId, packet);
      return true;
    }

    if (pType === 'ARCHIVE_PACK_EVICT_ACK') {
      const refreshedStatus = packet.storageStatus
        ? normalizeStorageCapacity(packet.storageStatus, this.deps.getActiveHubId() || undefined)
        : null;
      if (refreshedStatus) {
        this.updateFromHealth(refreshedStatus, refreshedStatus.hubId);
      }
      const result: HubArchiveEvictResult = {
        ok: packet.ok !== false,
        packId: String(packet.packId || '').trim(),
        removedCount: Math.floor(toNonNegNumber(packet.removedCount, 0)),
        payloadSha256: String(packet.payloadSha256 || '').trim().toLowerCase(),
        evictedAt: Number(packet.evictedAt) || Date.now(),
        storageStatus: refreshedStatus,
      };
      if (requestId && this.pendingRpcs.has(requestId)) {
        const rpc = this.pendingRpcs.get(requestId)!;
        clearTimeout(rpc.timer);
        this.pendingRpcs.delete(requestId);
        if (!result.ok) {
          rpc.reject(new Error(String(packet.error || 'Archive eviction was rejected by Hub.')));
        } else {
          rpc.resolve(result);
        }
      }
      return true;
    }

    return false;
  }

  private handleDownloadChunk(requestId: string, packet: any): void {
    const dl =
      (requestId && this.pendingDownloads.get(requestId)) ||
      Array.from(this.pendingDownloads.values()).find(
        (d) => d.packId === String(packet.packId || '').trim()
      );
    if (!dl) return;

    const chunkIndex = Number(packet.chunkIndex);
    const totalChunks = Number(packet.totalChunks);
    const data = typeof packet.data === 'string' ? packet.data : '';

    if (
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      !Number.isInteger(totalChunks) ||
      totalChunks <= 0 ||
      chunkIndex >= totalChunks
    ) {
      clearTimeout(dl.timer);
      this.pendingDownloads.delete(dl.requestId);
      dl.reject(new Error('Received invalid archive download chunk index from Hub.'));
      return;
    }

    // Refresh idle timeout on every chunk received
    clearTimeout(dl.timer);
    dl.timer = setTimeout(() => {
      this.pendingDownloads.delete(dl.requestId);
      dl.reject(new Error('Archive pack download timed out waiting for remaining chunks.'));
    }, 30000);

    dl.totalChunks = totalChunks;
    if (packet.fileName) dl.fileName = String(packet.fileName).trim();
    if (packet.payloadSha256) dl.payloadSha256 = String(packet.payloadSha256).trim().toLowerCase();
    if (packet.gzipSha256) dl.gzipSha256 = String(packet.gzipSha256).trim().toLowerCase();

    if (!dl.chunks.has(chunkIndex)) {
      dl.chunks.set(chunkIndex, data);
      dl.receivedBytes += data.length;
    }

    const receivedChunks = dl.chunks.size;
    dl.onProgress?.({
      packId: dl.packId,
      receivedChunks,
      totalChunks: dl.totalChunks,
      receivedBytes: dl.receivedBytes,
      percent: Math.min(100, Math.round((receivedChunks / dl.totalChunks) * 100)),
    });

    if (receivedChunks === dl.totalChunks) {
      clearTimeout(dl.timer);
      this.pendingDownloads.delete(dl.requestId);

      // Reassemble strictly in ascending chunkIndex order (0 .. totalChunks - 1)
      const orderedParts: string[] = new Array(dl.totalChunks);
      for (let i = 0; i < dl.totalChunks; i++) {
        const part = dl.chunks.get(i);
        if (typeof part !== 'string') {
          dl.reject(new Error(`Missing archive chunk ${i} of ${dl.totalChunks}.`));
          return;
        }
        orderedParts[i] = part;
      }
      const fullContent = orderedParts.join('');

      verifyReassembledArchivePack({
        packId: dl.packId,
        reassembledText: fullContent,
        expectedPayloadSha256: dl.payloadSha256,
        expectedGzipSha256: dl.gzipSha256,
      })
        .then((verification) => {
          const finalFileName = dl.fileName || `${dl.packId}.saimpack`;
          dl.resolve({
            packId: dl.packId,
            fileName: finalFileName,
            payloadSha256: verification.canonicalPayloadSha256,
            gzipSha256: verification.gzipSha256,
            fileSha256: verification.fileSha256,
            verified: verification.verified,
            verificationMode: verification.verificationMode,
            totalChunks: dl.totalChunks,
            bytes: new TextEncoder().encode(fullContent).byteLength,
            content: fullContent,
          });
        })
        .catch((err: any) => {
          dl.reject(err instanceof Error ? err : new Error(String(err)));
        });
    }
  }

  private sendRpc<T>(
    type: string,
    payload: Record<string, any>,
    timeoutMs = 20000
  ): Promise<T> {
    if (!this.deps.isAuthenticated()) {
      return Promise.reject(
        new Error(
          'Mutual-HMAC authentication (AUTH_OK) with the Local Hub is required for storage and archive RPCs.'
        )
      );
    }
    const requestId = this.nextRequestId(type.toLowerCase());

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpcs.delete(requestId);
        reject(new Error(`Local Hub RPC ${type} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);

      this.pendingRpcs.set(requestId, {
        requestId,
        type,
        resolve,
        reject,
        timer,
      });

      const sent = this.deps.sendPacket({
        type,
        requestId,
        ...payload,
      });

      if (!sent) {
        clearTimeout(timer);
        this.pendingRpcs.delete(requestId);
        reject(new Error(`Failed to send ${type}: Local Hub WebSocket is not open.`));
      }
    });
  }

  public queryStorageStatus(): Promise<HubStorageCapacity | null> {
    return this.sendRpc<HubStorageCapacity | null>('STORAGE_STATUS_QUERY', {}, 15000);
  }

  public listArchivePacks(): Promise<HubArchivePackListResult> {
    return this.sendRpc<HubArchivePackListResult>('ARCHIVE_PACK_LIST', {}, 20000);
  }

  public createArchivePack(options: HubArchiveCreateOptions = {}): Promise<HubArchiveCreateResult> {
    const preserveRecentDays =
      Number.isFinite(Number(options.preserveRecentDays)) && Number(options.preserveRecentDays) >= 0
        ? Math.floor(Number(options.preserveRecentDays))
        : 7;
    const includeSynced = options.includeSynced !== false;
    const passphrase = typeof options.passphrase === 'string' ? options.passphrase.trim() : '';

    return this.sendRpc<HubArchiveCreateResult>(
      'ARCHIVE_PACK_CREATE',
      {
        preserveRecentDays,
        includeSynced,
        ...(passphrase ? { passphrase } : {}),
      },
      90000
    );
  }

  public downloadArchivePack(
    packId: string,
    options?: {
      onProgress?: (progress: HubArchiveDownloadProgress) => void;
      autoSaveToBrowser?: boolean;
    }
  ): Promise<HubArchiveDownloadResult> {
    if (!this.deps.isAuthenticated()) {
      return Promise.reject(
        new Error(
          'Mutual-HMAC authentication (AUTH_OK) with the Local Hub is required for storage and archive RPCs.'
        )
      );
    }
    const cleanPackId = String(packId || '').trim();
    if (!cleanPackId) {
      return Promise.reject(new Error('packId is required to download an archive pack.'));
    }

    const requestId = this.nextRequestId('archive_download');

    return new Promise<HubArchiveDownloadResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDownloads.delete(requestId);
        reject(new Error('Archive pack download timed out before receiving chunks from Hub.'));
      }, 30000);

      this.pendingDownloads.set(requestId, {
        requestId,
        packId: cleanPackId,
        fileName: `${cleanPackId}.saimpack`,
        payloadSha256: '',
        gzipSha256: '',
        totalChunks: 0,
        chunks: new Map(),
        receivedBytes: 0,
        onProgress: options?.onProgress,
        resolve: (result) => {
          if (options?.autoSaveToBrowser !== false) {
            triggerArchivePackBrowserDownload(result.fileName, result.content);
          }
          resolve(result);
        },
        reject,
        timer,
      });

      const sent = this.deps.sendPacket({
        type: 'ARCHIVE_PACK_DOWNLOAD',
        requestId,
        packId: cleanPackId,
      });

      if (!sent) {
        clearTimeout(timer);
        this.pendingDownloads.delete(requestId);
        reject(new Error('Failed to start archive pack download: Local Hub WebSocket is not open.'));
      }
    });
  }

  public confirmArchiveEvict(packId: string, payloadSha256: string): Promise<HubArchiveEvictResult> {
    const cleanPackId = String(packId || '').trim();
    const cleanHash = String(payloadSha256 || '').trim().toLowerCase();
    if (!cleanPackId || !HEX_64_REGEX.test(cleanHash)) {
      return Promise.reject(
        new Error('Valid packId and verified 64-char SHA-256 payloadSha256 are required before eviction.')
      );
    }
    return this.sendRpc<HubArchiveEvictResult>(
      'ARCHIVE_PACK_CONFIRM_EVICT',
      {
        packId: cleanPackId,
        payloadSha256: cleanHash,
      },
      45000
    );
  }
}
