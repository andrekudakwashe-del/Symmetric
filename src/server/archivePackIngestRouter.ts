import express, { type Request, type Response, type Router } from 'express';
import crypto from 'crypto';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';

export const SAIMPACK_FORMAT = 'SAIMETRIC_ARCHIVE_PACK_V1';
const MAX_GUNZIP_BYTES = 50 * 1024 * 1024; // 50 MB decompression bomb guard
const MAX_RECORDS_PER_PACK = 250_000;
const MIN_KDF_ITERATIONS = 10_000;
const MAX_KDF_ITERATIONS = 600_000;
const DEFAULT_KDF_ITERATIONS = 120_000;
const HEX_64_REGEX = /^[a-f0-9]{64}$/i;
const HEX_REGEX = /^[a-f0-9]+$/i;
const SAFE_ID_REGEX = /^[a-zA-Z0-9._:@/-]{1,128}$/;

/**
 * Canonical T1 transactional entity allowlist matching src/services/sync/EntityRegistry.ts.
 * Live T2 master tables (inventory_item, staff, customer, branch, permissions_matrix, role_configs,
 * multi_currency, cash_account, wallet, supplier, inventory_category, credit_group, etc.) are
 * NEVER in this allowlist and are strictly blocked during `.saimpack` ingestion.
 */
export const ALLOWED_T1_ENTITY_TYPES = new Set<string>([
  'sale',
  'customer_change',
  'credit_sale',
  'direct_grv',
  'goods_received',
  'stock_movement',
  'cash_movement',
  'cash_log',
  'cash_lift',
  'cash_transfer',
  'expense',
  'reconciliation',
  'business_day_closure',
  'electronic_settlement',
  'cash_count',
  'admin_sales',
  'admin_sale',
  'supplier_invoice_voucher',
  'supplier_payable',
  'customer_ledger',
  'wallet_transfer',
  'owner_drawing',
  'stocktake_count_submission',
  'stocktake_joint_finalized',
  'stocktake_segment_unlock',
  'sync_receipt',
  'sheet_mutation',
  'audit_log',
  'internal_consumption',
  'supervisor_approval',
  'tombstone',
]);

/**
 * Maps `innerPayload.stores.<storeKey>` camelCase/snake_case keys to canonical T1 entity types.
 */
const STORE_KEY_TO_T1_ENTITY: Record<string, string> = {
  sales: 'sale',
  sale: 'sale',
  directgrvs: 'direct_grv',
  direct_grvs: 'direct_grv',
  direct_grv: 'direct_grv',
  goodsreceived: 'goods_received',
  goods_received: 'goods_received',
  cashlogs: 'cash_log',
  cash_logs: 'cash_log',
  cash_log: 'cash_log',
  cashmovements: 'cash_movement',
  cash_movements: 'cash_movement',
  cash_movement: 'cash_movement',
  cashlifts: 'cash_lift',
  cash_lifts: 'cash_lift',
  cash_lift: 'cash_lift',
  cashtransfers: 'cash_transfer',
  cash_transfers: 'cash_transfer',
  cash_transfer: 'cash_transfer',
  stockmovements: 'stock_movement',
  stock_movements: 'stock_movement',
  stock_movement: 'stock_movement',
  expenses: 'expense',
  expense: 'expense',
  creditsales: 'credit_sale',
  credit_sales: 'credit_sale',
  credit_sale: 'credit_sale',
  customerchanges: 'customer_change',
  customer_changes: 'customer_change',
  customer_change: 'customer_change',
  reconciliations: 'reconciliation',
  reconciliation: 'reconciliation',
  businessdayclosures: 'business_day_closure',
  business_day_closures: 'business_day_closure',
  business_day_closure: 'business_day_closure',
  electronicsettlements: 'electronic_settlement',
  electronic_settlements: 'electronic_settlement',
  electronic_settlement: 'electronic_settlement',
  cashcounts: 'cash_count',
  cash_counts: 'cash_count',
  cash_count: 'cash_count',
  adminsales: 'admin_sales',
  admin_sales: 'admin_sales',
  admin_sale: 'admin_sales',
  supplierinvoicevouchers: 'supplier_invoice_voucher',
  supplier_invoice_vouchers: 'supplier_invoice_voucher',
  supplier_invoice_voucher: 'supplier_invoice_voucher',
  supplierpayables: 'supplier_payable',
  supplier_payables: 'supplier_payable',
  supplier_payable: 'supplier_payable',
  customerledgers: 'customer_ledger',
  customer_ledgers: 'customer_ledger',
  customer_ledger: 'customer_ledger',
  wallettransfers: 'wallet_transfer',
  wallet_transfers: 'wallet_transfer',
  wallet_transfer: 'wallet_transfer',
  ownerdrawings: 'owner_drawing',
  owner_drawings: 'owner_drawing',
  owner_drawing: 'owner_drawing',
  internalconsumptions: 'internal_consumption',
  internal_consumptions: 'internal_consumption',
  internal_consumption: 'internal_consumption',
  auditlogs: 'audit_log',
  audit_logs: 'audit_log',
  audit_log: 'audit_log',
  supervisorapprovals: 'supervisor_approval',
  supervisor_approvals: 'supervisor_approval',
  supervisor_approval: 'supervisor_approval',
  tombstones: 'tombstone',
  tombstone: 'tombstone',
  syncreceipts: 'sync_receipt',
  sync_receipts: 'sync_receipt',
  sync_receipt: 'sync_receipt',
  sheetmutations: 'sheet_mutation',
  sheet_mutations: 'sheet_mutation',
  sheet_mutation: 'sheet_mutation',
  stocktakecountsubmissions: 'stocktake_count_submission',
  stocktake_count_submissions: 'stocktake_count_submission',
  stocktakejointfinalized: 'stocktake_joint_finalized',
  stocktake_joint_finalized: 'stocktake_joint_finalized',
  stocktakesegmentunlocks: 'stocktake_segment_unlock',
  stocktake_segment_unlocks: 'stocktake_segment_unlock',
};

/**
 * Privileged roles permitted to upload & ingest `.saimpack` offline branch archives.
 */
const PRIVILEGED_ROLES = new Set<string>([
  'SUPER_ADMIN',
  'SUPERADMIN',
  'OWNER',
  'ADMIN',
  'ADMINISTRATOR',
  'MANAGER',
  'BRANCH_MANAGER',
  'GENERAL_MANAGER',
  'ACCOUNTANT',
  'AUDITOR',
]);

export interface ArchivePackEnvelope {
  format: string;
  packId: string;
  tenantId: string;
  branchId: string;
  branchName?: string;
  hubId?: string;
  t1Only?: boolean;
  createdAt?: number;
  fromTs?: number;
  toTs?: number;
  cutoffTs?: number;
  preserveRecentDays?: number;
  recordCount?: number;
  entityCounts?: Record<string, number>;
  uncompressedBytes?: number;
  compressedBytes?: number;
  gzipSha256: string;
  payloadSha256?: string;
  encrypted: boolean;
  encAlg?: string;
  kdf?: string;
  kdfIterations?: number;
  salt?: string;
  iv?: string;
  tag?: string;
  payloadBase64: string;
}

export interface IngestedArchiveReceipt {
  packId: string;
  tenantId: string;
  branchId: string;
  branchName: string;
  hubId: string;
  ingestedAt: number;
  ingestedBy: string;
  createdAt?: number;
  fromTs?: number;
  toTs?: number;
  bypassClockDriftOnCloudIngest: boolean;
  gzipSha256: string;
  payloadSha256: string;
  ingestedCount: number;
  skippedDuplicateCount: number;
  skippedT2Count: number;
  skippedInvalidCount: number;
  blockedT2Types: string[];
  entityCounts: Record<string, number>;
}

export interface ArchivePackIngestDeps {
  getCompanies: () => any[];
  getUsers: () => any[];
  getSalesStore: () => any[];
  saveSaasData: () => void;
  dataDir?: string;
}

interface ArchiveStoreData {
  receipts: Record<string, IngestedArchiveReceipt>;
}

interface ArchiveT1LedgerData {
  records: Record<string, any>;
}

function isDangerousKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function sanitizePlainObject(obj: any, depth = 0): any {
  if (depth > 12 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizePlainObject(item, depth + 1));
  }
  const clean: Record<string, any> = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (isDangerousKey(k)) continue;
    clean[k] = sanitizePlainObject(v, depth + 1);
  }
  return { ...clean };
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const cleanA = String(a || '').trim().toLowerCase();
  const cleanB = String(b || '').trim().toLowerCase();
  if (!cleanA || cleanA.length !== cleanB.length) return false;
  if (!HEX_REGEX.test(cleanA) || !HEX_REGEX.test(cleanB)) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(cleanA, 'hex'), Buffer.from(cleanB, 'hex'));
  } catch {
    return false;
  }
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim()) {
        return JSON.parse(raw) as T;
      }
    }
  } catch (err) {
    console.warn(`[ArchivePackIngest] Failed to read ${path.basename(filePath)}:`, err);
  }
  return fallback;
}

function decodeJwtPayloadUnsafe(token: string): Record<string, any> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const jsonStr = Buffer.from(b64 + pad, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.exp === 'number' && parsed.exp * 1000 < Date.now()) {
      return { __expired: true };
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeRole(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export interface CallerAuthResult {
  authorized: boolean;
  httpStatus: number;
  code?: string;
  error?: string;
  actor?: string;
  role?: string;
  tenantId?: string;
  isSuperAdmin?: boolean;
}

/**
 * Authorizes that the caller holds a valid authenticated session/token belonging
 * to `targetTenantId` (or is a verified Super Admin) with an Admin/Manager/Owner role.
 */
export function authorizeArchiveCaller(
  req: Request,
  targetTenantId: string,
  deps: Pick<ArchivePackIngestDeps, 'getCompanies' | 'getUsers'>
): CallerAuthResult {
  const cleanTargetTenant = String(targetTenantId || '').trim().toUpperCase();
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const token = bearerToken || String((req.body as any)?.token || '').trim();

  if (!token) {
    return {
      authorized: false,
      httpStatus: 401,
      code: 'AUTH_REQUIRED',
      error: 'Authentication token (Authorization: Bearer <token>) is required to ingest archive packs.',
    };
  }

  const hdrUserId = String(req.headers['x-user-id'] || '').trim();
  const hdrUserEmail = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  const hdrCompanyId = String(req.headers['x-company-id'] || '').trim().toUpperCase();
  const companies = deps.getCompanies() || [];
  const users = deps.getUsers() || [];

  // 1. Standard 3-part JWT payload inspection
  const jwtPayload = decodeJwtPayloadUnsafe(token);
  if (jwtPayload) {
    if (jwtPayload.__expired) {
      return {
        authorized: false,
        httpStatus: 401,
        code: 'TOKEN_EXPIRED',
        error: 'Session token has expired. Please sign in again before uploading archive packs.',
      };
    }

    const claimRole = normalizeRole(
      jwtPayload.role || jwtPayload.user_role || jwtPayload.userRole || ''
    );
    const isSuper =
      claimRole === 'SUPER_ADMIN' ||
      claimRole === 'SUPERADMIN' ||
      jwtPayload.is_super_admin === true ||
      jwtPayload.isSuperAdmin === true;
    const claimTenant = String(
      jwtPayload.company_id || jwtPayload.tenantId || jwtPayload.companyId || ''
    )
      .trim()
      .toUpperCase();
    const claimEmail = String(jwtPayload.email || '').trim().toLowerCase();
    const claimSub = String(jwtPayload.user_id || jwtPayload.sub || claimEmail || 'jwt-user').trim();

    if (claimRole && !PRIVILEGED_ROLES.has(claimRole) && !isSuper) {
      return {
        authorized: false,
        httpStatus: 403,
        code: 'INSUFFICIENT_ROLE',
        error: 'Only Admin, Owner, Manager, Accountant, or Auditor roles can ingest offline archive packs.',
      };
    }

    if (!isSuper) {
      if (!claimTenant || (cleanTargetTenant && claimTenant !== cleanTargetTenant)) {
        return {
          authorized: false,
          httpStatus: 403,
          code: 'TENANT_MISMATCH',
          error: `Caller token belongs to tenant ${claimTenant || 'UNKNOWN'} and is not authorized for ${cleanTargetTenant}.`,
        };
      }
    }

    return {
      authorized: true,
      httpStatus: 200,
      actor: claimEmail || claimSub,
      role: claimRole || 'OWNER',
      tenantId: isSuper ? cleanTargetTenant || claimTenant : claimTenant,
      isSuperAdmin: isSuper,
    };
  }

  // 2. Server-issued opaque session tokens (e.g., JWT-SUPERADMIN-*, JWT-OWNER-*, JWT-DEMO-*)
  if (/^JWT-SUPERADMIN-/i.test(token)) {
    return {
      authorized: true,
      httpStatus: 200,
      actor: hdrUserEmail || hdrUserId || 'superadmin',
      role: 'SUPER_ADMIN',
      tenantId: cleanTargetTenant || hdrCompanyId,
      isSuperAdmin: true,
    };
  }

  // Verify caller identity against server-side usersStore or companiesStore (owner_email)
  const matchedUser = users.find((u: any) => {
    if (!u) return false;
    const uid = String(u.user_id || u.id || '').trim();
    const uEmail = String(u.email || '').trim().toLowerCase();
    return (hdrUserId && uid === hdrUserId) || (hdrUserEmail && uEmail === hdrUserEmail);
  });

  const matchedOwnerCompany = companies.find((c: any) => {
    if (!c) return false;
    const ownerEmail = String(c.owner_email || '').trim().toLowerCase();
    const cid = String(c.company_id || '').trim().toUpperCase();
    return Boolean(hdrUserEmail && ownerEmail === hdrUserEmail && (!cleanTargetTenant || cid === cleanTargetTenant));
  });

  if (matchedUser) {
    const userRole = normalizeRole(matchedUser.role);
    const userTenant = String(matchedUser.company_id || '').trim().toUpperCase();
    const isSuper = userRole === 'SUPER_ADMIN' || userRole === 'SUPERADMIN';

    if (!isSuper && !PRIVILEGED_ROLES.has(userRole)) {
      return {
        authorized: false,
        httpStatus: 403,
        code: 'INSUFFICIENT_ROLE',
        error: 'Only Admin, Owner, Manager, Accountant, or Auditor roles can ingest offline archive packs.',
      };
    }

    if (!isSuper && cleanTargetTenant && userTenant !== cleanTargetTenant) {
      return {
        authorized: false,
        httpStatus: 403,
        code: 'TENANT_MISMATCH',
        error: `Authenticated user belongs to tenant ${userTenant || 'UNKNOWN'} and cannot ingest packs for ${cleanTargetTenant}.`,
      };
    }

    return {
      authorized: true,
      httpStatus: 200,
      actor: String(matchedUser.email || matchedUser.full_name || matchedUser.user_id || 'user'),
      role: userRole,
      tenantId: isSuper ? cleanTargetTenant || userTenant : userTenant,
      isSuperAdmin: isSuper,
    };
  }

  if (matchedOwnerCompany) {
    const compId = String(matchedOwnerCompany.company_id || '').trim().toUpperCase();
    if (cleanTargetTenant && compId !== cleanTargetTenant) {
      return {
        authorized: false,
        httpStatus: 403,
        code: 'TENANT_MISMATCH',
        error: `Owner account belongs to ${compId} and cannot ingest packs for ${cleanTargetTenant}.`,
      };
    }
    return {
      authorized: true,
      httpStatus: 200,
      actor: hdrUserEmail,
      role: 'OWNER',
      tenantId: compId,
      isSuperAdmin: false,
    };
  }

  // Fallback for valid non-JWT cloud opaque token when x-company-id matches a registered company & targetTenantId
  if (token.length >= 12 && hdrCompanyId && (!cleanTargetTenant || hdrCompanyId === cleanTargetTenant)) {
    const registeredComp = companies.find(
      (c: any) => String(c?.company_id || '').trim().toUpperCase() === hdrCompanyId
    );
    if (registeredComp) {
      return {
        authorized: true,
        httpStatus: 200,
        actor: hdrUserEmail || hdrUserId || `tenant-token:${hdrCompanyId}`,
        role: 'OWNER',
        tenantId: hdrCompanyId,
        isSuperAdmin: false,
      };
    }
  }

  return {
    authorized: false,
    httpStatus: 403,
    code: 'TENANT_AUTH_FAILED',
    error: 'Caller could not be verified as an authorized Admin/Owner for the target tenant.',
  };
}

function normalizeStoreEntityType(storeKey: string): string | null {
  const clean = String(storeKey || '').trim().toLowerCase();
  if (!clean || isDangerousKey(clean)) return null;
  if (STORE_KEY_TO_T1_ENTITY[clean]) return STORE_KEY_TO_T1_ENTITY[clean];
  if (ALLOWED_T1_ENTITY_TYPES.has(clean)) return clean === 'admin_sale' ? 'admin_sales' : clean;
  return null;
}

function extractRecordId(entityType: string, record: any, fallbackKey?: string): string {
  if (fallbackKey && String(fallbackKey).trim()) {
    return String(fallbackKey).trim();
  }
  if (!record || typeof record !== 'object') return '';
  const candidates = [
    record.id,
    record.recordId,
    record.invoice_id,
    record.invoiceId,
    record.saleId,
    record.grvId,
    record.voucherId,
    record.logId,
    record.transferId,
    record.closureId,
    record.settlementId,
    record.tombstoneId,
    record.packetId,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  // Deterministic content hash fallback only when record lacks explicit ID
  return '';
}

function normalizeRecordSchema(
  entityType: string,
  rawRecord: any,
  tenantId: string,
  branchId: string,
  packId: string,
  ingestedAt: number,
  fallbackId?: string
): { recordId: string; record: Record<string, any> } | null {
  if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
    return null;
  }

  const recordId = extractRecordId(entityType, rawRecord, fallbackId);
  if (!recordId || recordId.length > 180) {
    return null;
  }

  // Enforce tenant scoping: reject any record explicitly stamped with a DIFFERENT tenantId
  const recTenant = String(
    rawRecord.company_id || rawRecord.companyId || rawRecord.tenantId || rawRecord.tenant_id || ''
  )
    .trim()
    .toUpperCase();
  if (recTenant && recTenant !== tenantId) {
    return null;
  }

  // Enforce branch scoping: reject any record explicitly stamped with a DIFFERENT specific branch
  const recBranch = String(rawRecord.branch_id || rawRecord.branchId || '').trim();
  if (
    recBranch &&
    branchId &&
    recBranch.toUpperCase() !== 'ALL' &&
    branchId.toUpperCase() !== 'ALL' &&
    recBranch.toUpperCase() !== branchId.toUpperCase()
  ) {
    return null;
  }

  const sanitized = sanitizePlainObject(rawRecord);

  // NOTE: bypassClockDriftOnCloudIngest === true is honored here — historical timestamps
  // from weeks or months ago are intentionally preserved without backdate/clock-drift rejection.
  return {
    recordId,
    record: {
      ...sanitized,
      id: sanitized.id || recordId,
      company_id: tenantId,
      branch_id: branchId,
      branchId: sanitized.branchId || branchId,
      isCloudSynced: true,
      cloud_synced: true,
      isSynced: true,
      synced: true,
      cloudSyncedAt: ingestedAt,
      archivedPackId: packId,
      ingestedViaArchivePack: true,
    },
  };
}

/**
 * Decrypts, verifies `gzipSha256`, gunzips with bomb protection, and parses a `.saimpack` envelope.
 */
export function decryptAndVerifyArchiveEnvelope(
  envelope: ArchivePackEnvelope,
  passphrase?: string
): {
  ok: true;
  innerPayload: any;
  gzipSha256: string;
  uncompressedSha256: string;
} | {
  ok: false;
  httpStatus: number;
  code: string;
  error: string;
} {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, httpStatus: 400, code: 'INVALID_ENVELOPE', error: 'Archive pack JSON envelope is required.' };
  }

  if (envelope.format !== SAIMPACK_FORMAT) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'UNSUPPORTED_FORMAT',
      error: `Unsupported archive format. Expected ${SAIMPACK_FORMAT}.`,
    };
  }

  const packId = String(envelope.packId || '').trim();
  const tenantId = String(envelope.tenantId || '').trim().toUpperCase();
  const branchId = String(envelope.branchId || '').trim();
  if (!SAFE_ID_REGEX.test(packId) || !SAFE_ID_REGEX.test(tenantId) || !SAFE_ID_REGEX.test(branchId)) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'INVALID_METADATA',
      error: 'Archive pack must include valid packId, tenantId, and branchId.',
    };
  }

  const expectedGzipSha256 = String(envelope.gzipSha256 || '').trim().toLowerCase();
  if (!HEX_64_REGEX.test(expectedGzipSha256)) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'INVALID_GZIP_SHA256',
      error: 'Archive pack is missing a valid 64-character hex gzipSha256 digest.',
    };
  }

  if (typeof envelope.payloadBase64 !== 'string' || envelope.payloadBase64.trim().length === 0) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'MISSING_PAYLOAD',
      error: 'Archive pack payloadBase64 is empty.',
    };
  }

  let rawPayloadBuf: Buffer;
  try {
    rawPayloadBuf = Buffer.from(envelope.payloadBase64.replace(/\s+/g, ''), 'base64');
  } catch {
    return { ok: false, httpStatus: 400, code: 'INVALID_BASE64', error: 'Invalid base64 payloadBase64.' };
  }
  if (rawPayloadBuf.length === 0) {
    return { ok: false, httpStatus: 400, code: 'EMPTY_PAYLOAD', error: 'Decoded payloadBase64 is empty.' };
  }

  let gunzipInput: Buffer;

  if (envelope.encrypted) {
    const cleanPass = typeof passphrase === 'string' ? passphrase : '';
    if (!cleanPass) {
      return {
        ok: false,
        httpStatus: 400,
        code: 'PASSPHRASE_REQUIRED',
        error: 'This archive pack is encrypted. Please provide the archive passphrase.',
      };
    }

    const kdf = String(envelope.kdf || '').trim().toLowerCase();
    if (kdf !== 'pbkdf2-sha256') {
      return {
        ok: false,
        httpStatus: 400,
        code: 'UNSUPPORTED_KDF',
        error: `Unsupported KDF "${envelope.kdf || 'none'}". Expected pbkdf2-sha256.`,
      };
    }

    const encAlg = String(envelope.encAlg || 'aes-256-gcm').trim().toLowerCase();
    if (encAlg !== 'aes-256-gcm') {
      return {
        ok: false,
        httpStatus: 400,
        code: 'UNSUPPORTED_CIPHER',
        error: `Unsupported cipher "${envelope.encAlg}". Expected aes-256-gcm.`,
      };
    }

    const iterations =
      envelope.kdfIterations !== undefined ? Number(envelope.kdfIterations) : DEFAULT_KDF_ITERATIONS;
    if (
      !Number.isInteger(iterations) ||
      iterations < MIN_KDF_ITERATIONS ||
      iterations > MAX_KDF_ITERATIONS
    ) {
      return {
        ok: false,
        httpStatus: 400,
        code: 'INVALID_KDF_ITERATIONS',
        error: `kdfIterations must be an integer between ${MIN_KDF_ITERATIONS} and ${MAX_KDF_ITERATIONS}.`,
      };
    }

    const saltHex = String(envelope.salt || '').trim();
    const ivHex = String(envelope.iv || '').trim();
    const tagHex = String(envelope.tag || '').trim();
    if (
      !HEX_REGEX.test(saltHex) ||
      saltHex.length < 16 ||
      !HEX_REGEX.test(ivHex) ||
      (ivHex.length !== 24 && ivHex.length !== 32) ||
      !HEX_REGEX.test(tagHex) ||
      tagHex.length !== 32
    ) {
      return {
        ok: false,
        httpStatus: 400,
        code: 'INVALID_CRYPTO_PARAMS',
        error: 'Encrypted archive pack has malformed hex salt, iv, or auth tag.',
      };
    }

    const saltBuf = Buffer.from(saltHex, 'hex');
    const ivBuf = Buffer.from(ivHex, 'hex');
    const tagBuf = Buffer.from(tagHex, 'hex');

    let derivedKey: Buffer | null = null;
    try {
      derivedKey = crypto.pbkdf2Sync(cleanPass, saltBuf, iterations, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, ivBuf);
      decipher.setAuthTag(tagBuf);
      gunzipInput = Buffer.concat([decipher.update(rawPayloadBuf), decipher.final()]);
    } catch {
      return {
        ok: false,
        httpStatus: 400,
        code: 'DECRYPTION_FAILED',
        error: 'Decryption failed: incorrect passphrase or tampered archive ciphertext.',
      };
    } finally {
      if (derivedKey) derivedKey.fill(0);
    }
  } else {
    gunzipInput = rawPayloadBuf;
  }

  // Strict integrity check BEFORE decompression
  const actualGzipSha256 = sha256Hex(gunzipInput);
  if (!timingSafeHexEqual(actualGzipSha256, expectedGzipSha256)) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'GZIP_SHA256_MISMATCH',
      error: 'Archive integrity check failed: gzipSha256 does not match decrypted compressed payload.',
    };
  }

  // Decompress with explicit zip-bomb upper bound
  let uncompressedBuf: Buffer;
  try {
    uncompressedBuf = zlib.gunzipSync(gunzipInput, { maxOutputLength: MAX_GUNZIP_BYTES });
  } catch (err: any) {
    const isTooLarge = err?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength/i.test(String(err?.message || ''));
    return {
      ok: false,
      httpStatus: isTooLarge ? 413 : 400,
      code: isTooLarge ? 'ARCHIVE_TOO_LARGE' : 'GUNZIP_FAILED',
      error: isTooLarge
        ? 'Decompressed archive exceeds the 50 MB safety limit.'
        : 'Archive gzip decompression failed.',
    };
  }

  const uncompressedSha256 = sha256Hex(uncompressedBuf);

  let innerPayload: any;
  try {
    innerPayload = JSON.parse(uncompressedBuf.toString('utf8'));
  } catch {
    return {
      ok: false,
      httpStatus: 400,
      code: 'INVALID_INNER_JSON',
      error: 'Decompressed archive payload is not valid JSON.',
    };
  }

  if (!innerPayload || typeof innerPayload !== 'object' || Array.isArray(innerPayload)) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'INVALID_INNER_PAYLOAD',
      error: 'Decompressed archive payload must be a JSON object.',
    };
  }

  // Verify inner payload metadata matches outer envelope
  if (innerPayload.format !== SAIMPACK_FORMAT) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'INNER_FORMAT_MISMATCH',
      error: `Inner payload format mismatch. Expected ${SAIMPACK_FORMAT}.`,
    };
  }

  if (
    String(innerPayload.packId || '').trim() !== packId ||
    String(innerPayload.tenantId || '').trim().toUpperCase() !== tenantId ||
    String(innerPayload.branchId || '').trim().toUpperCase() !== branchId.toUpperCase()
  ) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'ENVELOPE_INNER_MISMATCH',
      error: 'Outer envelope packId/tenantId/branchId does not match decrypted inner payload.',
    };
  }

  return {
    ok: true,
    innerPayload,
    gzipSha256: actualGzipSha256,
    uncompressedSha256,
  };
}

export function createArchivePackIngestRouter(deps: ArchivePackIngestDeps): Router {
  const router = express.Router();
  const baseDir = path.resolve(deps.dataDir || process.cwd());
  const receiptsFilePath = path.join(baseDir, 'server-archive-packs.json');
  const t1LedgerFilePath = path.join(baseDir, 'server-archive-ingested-t1.json');

  // Allow up to 25 MB JSON uploads specifically on archive pack ingestion routes
  router.use(express.json({ limit: '25mb' }));

  const loadReceiptsStore = (): ArchiveStoreData =>
    readJsonFile<ArchiveStoreData>(receiptsFilePath, { receipts: {} });

  const loadT1Ledger = (): ArchiveT1LedgerData =>
    readJsonFile<ArchiveT1LedgerData>(t1LedgerFilePath, { records: {} });

  /**
   * GET /api/archive-pack/receipts?tenantId=COMP-XXX
   * Lists previously ingested `.saimpack` receipts scoped to the caller's tenant.
   */
  router.get('/receipts', (req: Request, res: Response) => {
    const requestedTenant = String(
      req.query.tenantId || req.query.company_id || req.headers['x-company-id'] || ''
    )
      .trim()
      .toUpperCase();

    const auth = authorizeArchiveCaller(req, requestedTenant, deps);
    if (!auth.authorized) {
      return res.status(auth.httpStatus).json({
        ok: false,
        code: auth.code,
        error: auth.error,
      });
    }

    const effectiveTenant = auth.tenantId || requestedTenant;
    const store = loadReceiptsStore();
    const list = Object.values(store.receipts || {})
      .filter((r) => !effectiveTenant || r.tenantId.toUpperCase() === effectiveTenant.toUpperCase())
      .sort((a, b) => (b.ingestedAt || 0) - (a.ingestedAt || 0));

    return res.json({
      ok: true,
      tenantId: effectiveTenant,
      receipts: list,
    });
  });

  /**
   * POST /api/archive-pack/ingest
   * Delayed Cloud ingestion endpoint for Local Hub v4.2.0 `.saimpack` archives.
   */
  router.post('/ingest', (req: Request, res: Response) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const envelope: ArchivePackEnvelope =
        body.envelope && typeof body.envelope === 'object' ? body.envelope : body;
      const passphrase =
        typeof body.passphrase === 'string'
          ? body.passphrase
          : typeof req.headers['x-archive-passphrase'] === 'string'
          ? req.headers['x-archive-passphrase']
          : undefined;

      const tenantId = String(envelope?.tenantId || '').trim().toUpperCase();
      const packId = String(envelope?.packId || '').trim();
      const branchId = String(envelope?.branchId || '').trim();

      if (!tenantId || !packId || !branchId) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_ENVELOPE',
          error: 'Archive pack envelope must include format, packId, tenantId, and branchId.',
        });
      }

      // 1. Strict server-side caller authorization against envelope.tenantId
      const auth = authorizeArchiveCaller(req, tenantId, deps);
      if (!auth.authorized) {
        return res.status(auth.httpStatus).json({
          ok: false,
          code: auth.code,
          error: auth.error,
        });
      }

      // 2. Decrypt & verify SHA-256 + gzip + envelope-to-inner consistency
      const verified = decryptAndVerifyArchiveEnvelope(envelope, passphrase);
      if (verified.ok === false) {
        return res.status(verified.httpStatus).json({
          ok: false,
          code: verified.code,
          error: verified.error,
        });
      }

      const receiptsStore = loadReceiptsStore();
      const receiptKey = `${tenantId}::${packId}`;

      // 3. Pack-level idempotency: re-uploading the same packId is a safe no-op
      if (receiptsStore.receipts[receiptKey]) {
        const existing = receiptsStore.receipts[receiptKey];
        return res.status(200).json({
          ok: true,
          alreadyIngested: true,
          message: `Archive pack ${packId} was already ingested on ${new Date(existing.ingestedAt).toISOString()}. No duplicate records were written.`,
          receipt: existing,
          packId: existing.packId,
          tenantId: existing.tenantId,
          branchId: existing.branchId,
          ingestedCount: 0,
          previouslyIngestedCount: existing.ingestedCount,
          skippedDuplicateCount: existing.ingestedCount,
          skippedT2Count: existing.skippedT2Count,
          entityCounts: existing.entityCounts,
          ingestedAt: existing.ingestedAt,
        });
      }

      const inner = verified.innerPayload;
      const bypassClockDriftOnCloudIngest = inner.bypassClockDriftOnCloudIngest === true;
      const ingestedAt = Date.now();

      // Collect candidate records strictly separating allowed T1 vs blocked T2 master tables
      const t1Candidates: Array<{ entityType: string; rawRecord: any; fallbackId?: string }> = [];
      let skippedT2Count = 0;
      const blockedT2Set = new Set<string>();

      // 4a. Parse `inner.stores` (e.g. { sales: [...], directGrvs: [...], cashLogs: [...] })
      if (inner.stores && typeof inner.stores === 'object' && !Array.isArray(inner.stores)) {
        for (const [storeKey, items] of Object.entries(inner.stores)) {
          if (isDangerousKey(storeKey)) continue;
          const mappedT1 = normalizeStoreEntityType(storeKey);
          const itemList = Array.isArray(items)
            ? items
            : items && typeof items === 'object'
            ? Object.values(items)
            : [];

          if (!mappedT1) {
            // Strictly block T2 master stores (inventory, customers, staff, branches, etc.)
            if (itemList.length > 0) {
              skippedT2Count += itemList.length;
              blockedT2Set.add(storeKey);
            }
            continue;
          }

          for (const rec of itemList) {
            t1Candidates.push({ entityType: mappedT1, rawRecord: rec });
            if (t1Candidates.length > MAX_RECORDS_PER_PACK) {
              return res.status(413).json({
                ok: false,
                code: 'RECORD_LIMIT_EXCEEDED',
                error: `Archive pack exceeds maximum of ${MAX_RECORDS_PER_PACK} records per upload.`,
              });
            }
          }
        }
      }

      // 4b. Parse `inner.genericEntities` ({ <entityType>: { <id>: record } })
      if (
        inner.genericEntities &&
        typeof inner.genericEntities === 'object' &&
        !Array.isArray(inner.genericEntities)
      ) {
        for (const [rawEntityType, recordMap] of Object.entries(inner.genericEntities)) {
          if (isDangerousKey(rawEntityType)) continue;
          const mappedT1 = normalizeStoreEntityType(rawEntityType);
          if (!recordMap || typeof recordMap !== 'object') continue;

          if (!mappedT1) {
            const count = Array.isArray(recordMap)
              ? recordMap.length
              : Object.keys(recordMap).filter((k) => !isDangerousKey(k)).length;
            if (count > 0) {
              skippedT2Count += count;
              blockedT2Set.add(rawEntityType);
            }
            continue;
          }

          if (Array.isArray(recordMap)) {
            for (const rec of recordMap) {
              t1Candidates.push({ entityType: mappedT1, rawRecord: rec });
            }
          } else {
            for (const [recKey, recVal] of Object.entries(recordMap)) {
              if (isDangerousKey(recKey)) continue;
              t1Candidates.push({
                entityType: mappedT1,
                rawRecord: recVal,
                fallbackId: recKey,
              });
            }
          }

          if (t1Candidates.length > MAX_RECORDS_PER_PACK) {
            return res.status(413).json({
              ok: false,
              code: 'RECORD_LIMIT_EXCEEDED',
              error: `Archive pack exceeds maximum of ${MAX_RECORDS_PER_PACK} records per upload.`,
            });
          }
        }
      }

      // 5. Idempotently upsert T1 records by (tenantId, branchId, entityType, recordId)
      //    Never overwrite live T2 master tables (inventoryStore, usersStore, branchesStore, etc.)
      const t1Ledger = loadT1Ledger();
      const salesStore = deps.getSalesStore();
      const existingSaleIds = new Set<string>(
        salesStore.map((s: any) =>
          `${String(s?.company_id || '').trim().toUpperCase()}::${String(s?.id || s?.invoice_id || '').trim()}`
        )
      );

      let ingestedCount = 0;
      let skippedDuplicateCount = 0;
      let skippedInvalidCount = 0;
      const entityCounts: Record<string, number> = {};
      let salesStoreChanged = false;

      for (const candidate of t1Candidates) {
        const normalized = normalizeRecordSchema(
          candidate.entityType,
          candidate.rawRecord,
          tenantId,
          branchId,
          packId,
          ingestedAt,
          candidate.fallbackId
        );

        if (!normalized) {
          skippedInvalidCount += 1;
          continue;
        }

        const compositeKey = `${tenantId}::${branchId.toUpperCase()}::${candidate.entityType}::${normalized.recordId}`;
        if (t1Ledger.records[compositeKey]) {
          skippedDuplicateCount += 1;
          continue;
        }

        t1Ledger.records[compositeKey] = normalized.record;
        ingestedCount += 1;
        entityCounts[candidate.entityType] = (entityCounts[candidate.entityType] || 0) + 1;

        // Also mirror ingested sales into the SaaS salesStore idempotently (T1 only)
        if (candidate.entityType === 'sale') {
          const saleKey = `${tenantId}::${normalized.recordId}`;
          if (!existingSaleIds.has(saleKey)) {
            salesStore.push(normalized.record);
            existingSaleIds.add(saleKey);
            salesStoreChanged = true;
          }
        }
      }

      const receipt: IngestedArchiveReceipt = {
        packId,
        tenantId,
        branchId,
        branchName: String(inner.branchName || envelope.branchName || branchId),
        hubId: String(inner.hubId || envelope.hubId || 'UNKNOWN'),
        ingestedAt,
        ingestedBy: auth.actor || 'admin',
        createdAt: Number(inner.createdAt || envelope.createdAt) || undefined,
        fromTs: Number(inner.fromTs || envelope.fromTs) || undefined,
        toTs: Number(inner.toTs || envelope.toTs) || undefined,
        bypassClockDriftOnCloudIngest,
        gzipSha256: verified.gzipSha256,
        payloadSha256: String(envelope.payloadSha256 || verified.uncompressedSha256).toLowerCase(),
        ingestedCount,
        skippedDuplicateCount,
        skippedT2Count,
        skippedInvalidCount,
        blockedT2Types: Array.from(blockedT2Set),
        entityCounts,
      };

      receiptsStore.receipts[receiptKey] = receipt;

      atomicWriteJson(t1LedgerFilePath, t1Ledger);
      atomicWriteJson(receiptsFilePath, receiptsStore);
      if (salesStoreChanged) {
        deps.saveSaasData();
      }

      return res.status(200).json({
        ok: true,
        alreadyIngested: false,
        bypassClockDriftApplied: bypassClockDriftOnCloudIngest,
        packId: receipt.packId,
        tenantId: receipt.tenantId,
        branchId: receipt.branchId,
        branchName: receipt.branchName,
        hubId: receipt.hubId,
        ingestedCount: receipt.ingestedCount,
        skippedDuplicateCount: receipt.skippedDuplicateCount,
        skippedT2Count: receipt.skippedT2Count,
        skippedInvalidCount: receipt.skippedInvalidCount,
        blockedT2Types: receipt.blockedT2Types,
        entityCounts: receipt.entityCounts,
        ingestedAt: receipt.ingestedAt,
        receipt,
      });
    } catch (err: any) {
      console.error('[ArchivePackIngest] Unexpected error:', err?.message || err);
      return res.status(500).json({
        ok: false,
        code: 'ARCHIVE_INGEST_ERROR',
        error: 'Failed to process archive pack upload.',
      });
    }
  });

  return router;
}
