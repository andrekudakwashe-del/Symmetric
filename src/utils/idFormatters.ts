// Centralized Short Readable Sequential ID Generator & Display Formatter
// Formats:
//   - Invoice (includes staff initials):  [BR]-[USR]-[DEV4]-[SEQ]   e.g. HQ-KM-X9K4-0001
//   - Customer (no staff initials):       C-[BR]-[DEV4]-[SEQ]       e.g. C-HQ-X9K4-0001
//   - Supplier (no staff initials):       S-[BR]-[DEV4]-[SEQ]       e.g. S-HQ-X9K4-0001
//   - Inventory (no staff initials):      I-[BR]-[DEV4]-[SEQ]       e.g. I-HQ-X9K4-0001
//
// Sequence is continuous and unlimited: 0001 .. 9999 -> 10000 -> 10001 ... (never rolls over).

export type SequentialEntityType = 'invoice' | 'customer' | 'supplier' | 'inventory';

const DEVICE_ID_STORAGE_KEY = 'saimetric_mesh_device_id';
const SEQ_COUNTERS_STORAGE_KEY = 'saimetric_seq_counters_v1';

const GENERIC_DEVICE_PLACEHOLDERS = new Set([
  '',
  'TERMINAL-LOCAL',
  'LOCAL-PWA',
  'DEV-LOCAL',
  'UNKNOWN-DEVICE',
  'CAPACITOR-POS',
]);

const GENERIC_BRANCH_PLACEHOLDERS = new Set([
  '',
  '1',
  'BR-1',
  'BR-01',
  'BR-001',
  'BR001',
  'BR-MAIN',
  'MAIN',
  'DEFAULT',
  'SAI-01',
]);

const BASE36_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const randomBase36 = (length: number): string => {
  let out = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      for (let i = 0; i < length; i++) {
        out += BASE36_CHARS[bytes[i] % BASE36_CHARS.length];
      }
      return out;
    }
  } catch {
    // Fallback below
  }
  while (out.length < length) {
    out += Math.random().toString(36).substring(2).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  return out.slice(0, length);
};

/**
 * Guarantees every device/browser has a unique, persisted device ID (e.g. DEV-X9K4P2).
 * Replaces legacy hardcoded fallbacks like 'terminal-local' or 'LOCAL-PWA' so two offline
 * devices can never share the same device code.
 */
export const getOrCreatePersistentDeviceId = (): string => {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = String(localStorage.getItem(DEVICE_ID_STORAGE_KEY) || '').trim();
      if (existing && !GENERIC_DEVICE_PLACEHOLDERS.has(existing.toUpperCase())) {
        return existing;
      }
      const minted = `DEV-${randomBase36(6)}`;
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, minted);
      return minted;
    }
  } catch {
    // Ignore storage quota/sandbox errors
  }
  return `DEV-${randomBase36(6)}`;
};

/**
 * Extracts a deterministic 4-character alphanumeric slice from the persistent device ID.
 * 36^4 = 1,679,616 unique device codes per branch.
 */
export const getDeviceShortCode = (deviceId?: string): string => {
  const raw = String(deviceId || getOrCreatePersistentDeviceId()).trim().toUpperCase();
  const stripped = raw
    .replace(/^(DEV|TERM|LOCAL|DEVICE)[-_]?/i, '')
    .replace(/[^A-Z0-9]/g, '');
  if (stripped.length >= 4) {
    return stripped.slice(0, 4);
  }
  // Deterministically pad short custom IDs rather than using a static string
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = Math.abs(hash >>> 0).toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (stripped + suffix + 'X9K4').slice(0, 4);
};

/**
 * Derives crisp 2-3 character branch initials from branch code / name / id.
 * Examples:
 *  - code "HRE" -> "HRE"
 *  - name "Harare Main" -> "HM"
 *  - name "Bulawayo CBD" -> "BC"
 *  - name "Main Branch" / id "BR-MAIN" -> "HQ"
 */
export const getBranchInitials = (
  branch?: { code?: string; name?: string; branchId?: string; id?: string } | null,
  fallbackBranchId?: string
): string => {
  const rawCode = String(branch?.code || '').trim().toUpperCase();
  const cleanCode = rawCode.replace(/[^A-Z0-9]/g, '');
  if (
    cleanCode.length >= 2 &&
    cleanCode.length <= 4 &&
    !GENERIC_BRANCH_PLACEHOLDERS.has(rawCode) &&
    !GENERIC_BRANCH_PLACEHOLDERS.has(cleanCode) &&
    !/^BR0*\d+$/.test(cleanCode)
  ) {
    // Strip trailing -01 from codes like HQ-01 -> HQ
    const beforeDash = rawCode.split(/[-_]/)[0].replace(/[^A-Z0-9]/g, '');
    if (beforeDash.length >= 2 && beforeDash.length <= 3 && !/^BR$/.test(beforeDash)) {
      return beforeDash;
    }
    return cleanCode.slice(0, 3);
  }

  const rawName = String(branch?.name || '').trim();
  if (rawName) {
    const lowerName = rawName.toLowerCase();
    if (lowerName === 'main branch' || lowerName === 'headquarters' || lowerName === 'head office') {
      return 'HQ';
    }
    const words = rawName
      .replace(/[^A-Za-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0 && !['branch', 'store', 'shop', 'depot', 'the', 'of'].includes(w.toLowerCase()));
    if (words.length >= 2) {
      return words
        .slice(0, 3)
        .map((w) => w[0].toUpperCase())
        .join('')
        .slice(0, 3);
    }
    if (words.length === 1) {
      const cleanWord = words[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (cleanWord.length >= 2) return cleanWord.slice(0, 3);
    }
    // Fallback using all words if every word was generic (e.g. "Branch 2" -> "B2")
    const allWords = rawName.replace(/[^A-Za-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (allWords.length >= 2) {
      return allWords
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');
    }
  }

  const rawId = String(branch?.branchId || branch?.id || fallbackBranchId || '').trim().toUpperCase();
  if (!rawId || GENERIC_BRANCH_PLACEHOLDERS.has(rawId)) {
    return 'HQ';
  }
  const brNumMatch = rawId.match(/BR[-_]?0*(\d+)$/i);
  if (brNumMatch) {
    const num = parseInt(brNumMatch[1], 10);
    return num === 1 ? 'HQ' : `B${num}`.slice(0, 3);
  }
  const alnum = rawId.replace(/[^A-Z0-9]/g, '');
  return alnum.length >= 2 ? alnum.slice(0, 3) : 'HQ';
};

/**
 * Derives compact 2-3 char user initials for Invoices (USR segment).
 * Examples:
 *  - "Kudakwashe Andre" -> "KA"
 *  - "Kevin Moyo" -> "KM"
 *  - "Andre" -> "AN"
 *  - explicit user_prefix "KM5" -> "KM5"
 */
export const getUserInvoiceInitials = (
  staffName?: string,
  explicitPrefix?: string,
  fallbackStaffId?: string
): string => {
  const cleanExplicit = String(explicitPrefix || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleanExplicit && !cleanExplicit.startsWith('INV') && cleanExplicit.length >= 2 && cleanExplicit.length <= 4) {
    return cleanExplicit;
  }

  const rawName = String(staffName || '').trim();
  if (rawName) {
    const words = rawName
      .replace(/[^A-Za-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (words.length >= 2) {
      const initials = (words[0][0] + words[words.length - 1][0]).toUpperCase();
      if (!initials.startsWith('INV')) return initials;
    } else if (words.length === 1) {
      const clean = words[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (clean.length >= 2) return clean.slice(0, 2);
      if (clean.length === 1) return `${clean}1`;
    }
  }

  const cleanId = String(fallbackStaffId || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cleanId && !cleanId.startsWith('INV') && cleanId.length <= 4) {
    return cleanId.length >= 2 ? cleanId : `U${cleanId}`;
  }
  return 'ST';
};

// ==================== CONTINUOUS SEQUENCE STORE ====================

const loadCounters = (): Record<string, number> => {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(SEQ_COUNTERS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const saveCounters = (counters: Record<string, number>): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SEQ_COUNTERS_STORAGE_KEY, JSON.stringify(counters));
    }
  } catch {
    // Ignore storage quota issues
  }
};

const buildCounterKey = (companyId: string, entity: SequentialEntityType, scopeKey: string): string => {
  const normComp = String(companyId || 'COMP-001').trim().toUpperCase();
  const normScope = String(scopeKey || 'DEFAULT').trim().toUpperCase();
  return `${normComp}::${entity}::${normScope}`;
};

/**
 * Formats a continuous positive integer sequence:
 *  - 1..9999 -> zero-padded to 4 digits ('0001'..'9999')
 *  - 10000+  -> expands naturally ('10000', '10001', ..., '100000') with zero rollover.
 */
export const formatSequenceNumber = (seq: number): string => {
  const safe = Math.max(1, Math.floor(Number(seq) || 1));
  return String(safe).padStart(4, '0');
};

/**
 * Extracts the highest trailing numeric sequence among existing IDs matching a branch+device scope.
 * Works for both:
 *  - Invoices:  [BR]-[ANY_USR]-[DEV4]-[SEQ]
 *  - Entities:  [TAG]-[BR]-[DEV4]-[SEQ]
 */
export const findHighestExistingSequence = (
  entity: SequentialEntityType,
  branchCode: string,
  dev4: string,
  existingIds: string[]
): number => {
  if (!Array.isArray(existingIds) || existingIds.length === 0) return 0;
  const br = branchCode.toUpperCase();
  const dev = dev4.toUpperCase();

  let pattern: RegExp;
  if (entity === 'invoice') {
    // Matches BR-USR-DEV4-0001 (continuous per branch+device across all cashiers)
    pattern = new RegExp(`^${br}-[A-Z0-9]{1,5}-${dev}-(\\d+)$`, 'i');
  } else {
    const tag = entity === 'customer' ? 'C' : entity === 'supplier' ? 'S' : 'I';
    pattern = new RegExp(`^${tag}-${br}-${dev}-(\\d+)$`, 'i');
  }

  let maxSeq = 0;
  for (const raw of existingIds) {
    if (!raw) continue;
    const match = String(raw).trim().match(pattern);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }
  return maxSeq;
};

/**
 * Peeks the next sequential ID WITHOUT advancing the stored counter.
 * Ideal for UI registration modals that display a preview ID before the user clicks Save.
 */
export const peekSequentialEntityId = (params: {
  companyId: string;
  entity: SequentialEntityType;
  branchCode: string;
  dev4: string;
  userCode?: string;
  existingIds?: string[];
}): string => {
  const br = params.branchCode.toUpperCase();
  const dev = params.dev4.toUpperCase();
  const scopeKey = `${br}-${dev}`;
  const key = buildCounterKey(params.companyId, params.entity, scopeKey);

  const counters = loadCounters();
  const stored = Number(counters[key]) || 0;
  const maxExisting = findHighestExistingSequence(params.entity, br, dev, params.existingIds || []);
  const nextSeq = Math.max(stored, maxExisting) + 1;
  const seqStr = formatSequenceNumber(nextSeq);

  if (params.entity === 'invoice') {
    const usr = (params.userCode || 'ST').toUpperCase();
    return `${br}-${usr}-${dev}-${seqStr}`;
  }
  const tag = params.entity === 'customer' ? 'C' : params.entity === 'supplier' ? 'S' : 'I';
  return `${tag}-${br}-${dev}-${seqStr}`;
};

/**
 * Allocates and persists the next continuous sequential ID for an entity.
 */
export const allocateSequentialEntityId = (params: {
  companyId: string;
  entity: SequentialEntityType;
  branchCode: string;
  dev4: string;
  userCode?: string;
  existingIds?: string[];
}): string => {
  const br = params.branchCode.toUpperCase();
  const dev = params.dev4.toUpperCase();
  const scopeKey = `${br}-${dev}`;
  const key = buildCounterKey(params.companyId, params.entity, scopeKey);

  const counters = loadCounters();
  const stored = Number(counters[key]) || 0;
  const maxExisting = findHighestExistingSequence(params.entity, br, dev, params.existingIds || []);
  const nextSeq = Math.max(stored, maxExisting) + 1;

  counters[key] = nextSeq;
  saveCounters(counters);

  const seqStr = formatSequenceNumber(nextSeq);
  if (params.entity === 'invoice') {
    const usr = (params.userCode || 'ST').toUpperCase();
    return `${br}-${usr}-${dev}-${seqStr}`;
  }
  const tag = params.entity === 'customer' ? 'C' : params.entity === 'supplier' ? 'S' : 'I';
  return `${tag}-${br}-${dev}-${seqStr}`;
};

/**
 * Records a saved ID into the continuous sequence store so any previewed/synced ID
 * bumps the counter forward and can never be re-issued on this device.
 */
export const recordUsedSequentialId = (
  companyId: string,
  entity: SequentialEntityType,
  fullId?: string | null
): void => {
  if (!fullId) return;
  const clean = String(fullId).trim().toUpperCase();

  let br = '';
  let dev = '';
  let seq = 0;

  if (entity === 'invoice') {
    const m = clean.match(/^([A-Z0-9]{2,4})-[A-Z0-9]{1,5}-([A-Z0-9]{4})-(\d+)$/);
    if (!m) return;
    br = m[1];
    dev = m[2];
    seq = parseInt(m[3], 10);
  } else {
    const tag = entity === 'customer' ? 'C' : entity === 'supplier' ? 'S' : 'I';
    const m = clean.match(new RegExp(`^${tag}-([A-Z0-9]{2,4})-([A-Z0-9]{4})-(\\d+)$`));
    if (!m) return;
    br = m[1];
    dev = m[2];
    seq = parseInt(m[3], 10);
  }

  if (!br || !dev || !Number.isFinite(seq) || seq <= 0) return;

  const key = buildCounterKey(companyId, entity, `${br}-${dev}`);
  const counters = loadCounters();
  const current = Number(counters[key]) || 0;
  if (seq > current) {
    counters[key] = seq;
    saveCounters(counters);
  }
};

// ==================== DISPLAY FORMATTING (BACKWARDS-COMPATIBLE) ====================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the ID is a legacy 36-char UUID or excessively long opaque string
 * that would overflow report rows and push customer/supplier names off screen.
 */
export const isLegacyLongId = (id?: string | null): boolean => {
  const clean = String(id || '').trim();
  if (!clean) return false;
  return UUID_REGEX.test(clean) || clean.length > 22;
};

/**
 * Formats an ID for UI display while keeping the full ID intact in state, search, DB, and exports.
 *  - New sequential IDs (e.g. C-HQ-X9K4-0001, HQ-KM-X9K4-0001) -> returned untouched!
 *  - Legacy short IDs (e.g. CUST-001, SUP-001, PRD001)          -> returned untouched!
 *  - Legacy 36-char UUIDs (e.g. f47ac10b-58cc-...-0e02b2c3d479) -> shortened cleanly to e.g. C-F47A…D479
 */
export const formatDisplayId = (
  id?: string | null,
  entityType?: 'customer' | 'supplier' | 'inventory' | 'invoice'
): string => {
  const clean = String(id || '').trim();
  if (!clean) return '';

  // Legacy 36-char UUID -> compact readable badge
  if (UUID_REGEX.test(clean)) {
    const head = clean.slice(0, 4).toUpperCase();
    const tail = clean.slice(-4).toUpperCase();
    const prefix =
      entityType === 'customer'
        ? 'C-'
        : entityType === 'supplier'
        ? 'S-'
        : entityType === 'inventory'
        ? 'I-'
        : '';
    return `${prefix}${head}…${tail}`;
  }

  // Already compact (all new sequential IDs & legacy short IDs) -> show exact ID
  if (clean.length <= 22) {
    return clean;
  }

  // Other unusually long legacy strings -> show recognizable head + tail
  return `${clean.slice(0, 8)}…${clean.slice(-4)}`;
};

/**
 * Extracts an invoice reference from CashMovement sourceRef or notes across all generations:
 *  - Legacy:   INV-...
 *  - Previous: KM5-261122-143022-892
 *  - Current:  HQ-KM-X9K4-0001 (and 10000+)
 */
export const extractInvoiceRef = (sourceRef?: string | null, notes?: string | null): string | undefined => {
  const candidates = [sourceRef, notes].filter(Boolean) as string[];
  for (const text of candidates) {
    const legacyMatch = text.match(/INV-[A-Za-z0-9-]+/i);
    if (legacyMatch) return legacyMatch[0].toUpperCase();

    const hashMatch = text.match(/Invoice\s*#\s*([A-Z0-9][A-Z0-9-]{4,})/i);
    if (hashMatch) return hashMatch[1].toUpperCase();

    const newSeqMatch = text.match(/\b[A-Z0-9]{2,4}-[A-Z0-9]{1,5}-[A-Z0-9]{4}-\d{4,}\b/i);
    if (newSeqMatch) return newSeqMatch[0].toUpperCase();

    const prevTsMatch = text.match(/\b[A-Z]{1,4}\d{1,4}-\d{6}-\d{6}-\d{3}\b/i);
    if (prevTsMatch) return prevTsMatch[0].toUpperCase();
  }
  return undefined;
};
