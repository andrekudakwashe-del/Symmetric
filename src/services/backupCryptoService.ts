/**
 * Bank-grade Client-Side AES-256-GCM Encryption, Decryption & HMAC-SHA256 Integrity Service
 * Uses standard Web Crypto API (SubtleCrypto) with PBKDF2 key derivation.
 * Detects any 1-byte tampering/editing of both encrypted (.saimetric.enc) and JSON backup files.
 * Works natively in all modern browsers and Node runtimes with zero external dependencies.
 */

export interface EncryptedBackupEnvelope {
  magic: 'SAIMETRIC_ENCRYPTED_BACKUP';
  version: 1 | 2;
  createdAt: string;
  companyId?: string;
  kdf: {
    algorithm: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string; // Base64
  };
  cipher: {
    algorithm: 'AES-GCM';
    length: 256;
    iv: string; // Base64
  };
  checksum: string; // SHA-256 of plaintext
  hmac?: {
    algorithm: 'HMAC-SHA256';
    envelopeSignature: string; // Passphrase-derived HMAC over headers + ciphertext
    integritySignature: string; // Structural HMAC over headers + ciphertext (detects edits before/independently of password)
  };
  data: string; // Base64 ciphertext
}

export interface PayloadHmacBlock {
  algorithm: 'HMAC-SHA256';
  version: 1;
  scope: string;
  signedAt: string;
  signature: string; // Base64 HMAC-SHA256
}

export interface DecryptBackupResult {
  success: boolean;
  data?: any;
  error?: string;
  tampered?: boolean;
  hmacVerified?: boolean;
  legacyUnsigned?: boolean;
}

const HMAC_DOMAIN_PEPPER = 'SAIMETRIC::HEXAGONAL_SYNC_INTEGRITY::V3::2026';

// Convert ArrayBuffer to Base64 (chunked to safely handle multi-MB payloads without call-stack overflow)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

// Convert Base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Constant-time string equality check for Base64 MACs
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Calculate SHA-256 checksum of string
async function calculateSha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hashBuffer);
}

// Derive a deterministic HMAC-SHA256 structural integrity key for a company/scope
async function deriveStructuralHmacKey(scope: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const normalizedScope = String(scope || 'MAIN').trim().toUpperCase();
  const seedBytes = encoder.encode(`${HMAC_DOMAIN_PEPPER}::${normalizedScope}`);
  const keyHash = await globalThis.crypto.subtle.digest('SHA-256', seedBytes);
  return globalThis.crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function computeHmacWithKey(key: CryptoKey, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const sigBuffer = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return arrayBufferToBase64(sigBuffer);
}

// Derive legacy v1 AES-GCM-256 key directly from passphrase and salt via PBKDF2
async function deriveLegacyAesKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = 100000
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Derive split v2 keys (256-bit AES-GCM key + 256-bit HMAC-SHA256 key) from passphrase via PBKDF2
async function deriveSplitKeysFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = 100000
): Promise<{ aesKey: CryptoKey; hmacKey: CryptoKey }> {
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    512 // 256 bits AES + 256 bits HMAC
  );

  const aesRaw = derivedBits.slice(0, 32);
  const hmacRaw = derivedBits.slice(32, 64);

  const [aesKey, hmacKey] = await Promise.all([
    globalThis.crypto.subtle.importKey(
      'raw',
      aesRaw,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    ),
    globalThis.crypto.subtle.importKey(
      'raw',
      hmacRaw,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    ),
  ]);

  return { aesKey, hmacKey };
}

function buildCanonicalEncryptedSigningInput(envelope: {
  magic: string;
  version: number;
  createdAt: string;
  companyId?: string;
  kdf: { algorithm: string; hash: string; iterations: number; salt: string };
  cipher: { algorithm: string; length: number; iv: string };
  checksum: string;
  data: string;
}): string {
  return [
    `v${envelope.version}`,
    envelope.magic,
    envelope.createdAt,
    envelope.companyId || 'MAIN',
    envelope.kdf.algorithm,
    envelope.kdf.hash,
    String(envelope.kdf.iterations),
    envelope.kdf.salt,
    envelope.cipher.algorithm,
    String(envelope.cipher.length),
    envelope.cipher.iv,
    envelope.checksum,
    envelope.data,
  ].join('|');
}

function buildCanonicalPayloadSigningInput(payload: any): string {
  const clean: Record<string, any> = {};
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keys = Object.keys(payload)
      .filter((k) => k !== 'hmac')
      .sort();
    for (const k of keys) {
      clean[k] = payload[k];
    }
    return JSON.stringify(clean);
  }
  return JSON.stringify(payload);
}

/**
 * Compute and attach an HMAC-SHA256 tamper-detection block onto a BackupPayload JSON object.
 * Any post-export edit to manifest, envelopes, prices, totals, or metadata breaks this signature.
 */
export async function signBackupPayloadHmac<T extends Record<string, any>>(
  payload: T,
  scope?: string
): Promise<T & { hmac: PayloadHmacBlock }> {
  const resolvedScope =
    scope || payload?.manifest?.companyId || payload?.companyId || 'MAIN';
  const hmacKey = await deriveStructuralHmacKey(resolvedScope);
  const canonical = buildCanonicalPayloadSigningInput(payload);
  const signature = await computeHmacWithKey(hmacKey, canonical);

  return {
    ...payload,
    hmac: {
      algorithm: 'HMAC-SHA256',
      version: 1,
      scope: String(resolvedScope).trim().toUpperCase(),
      signedAt: new Date().toISOString(),
      signature,
    },
  };
}

/**
 * Verify the HMAC-SHA256 signature on an unencrypted or decrypted BackupPayload object.
 */
export async function verifyBackupPayloadHmac(
  payload: any
): Promise<{ valid: boolean; present: boolean; tampered: boolean; error?: string }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: true, present: false, tampered: false };
  }
  const hmacBlock: PayloadHmacBlock | undefined = payload.hmac;
  if (!hmacBlock || !hmacBlock.signature) {
    return { valid: true, present: false, tampered: false };
  }

  try {
    const scope = hmacBlock.scope || payload?.manifest?.companyId || 'MAIN';
    const hmacKey = await deriveStructuralHmacKey(scope);
    const canonical = buildCanonicalPayloadSigningInput(payload);
    const expected = await computeHmacWithKey(hmacKey, canonical);
    if (!timingSafeEqual(expected, String(hmacBlock.signature))) {
      return {
        valid: false,
        present: true,
        tampered: true,
        error:
          'FILE TAMPERING DETECTED: This backup file was edited or altered after export (HMAC-SHA256 signature mismatch). Import has been blocked to protect your books.',
      };
    }
    return { valid: true, present: true, tampered: false };
  } catch (err: any) {
    return {
      valid: false,
      present: true,
      tampered: true,
      error: `HMAC integrity verification failed: ${err?.message || 'corrupted signature block'}`,
    };
  }
}

/**
 * Encrypt a JSON-serializable payload with a passphrase using AES-GCM 256 + dual HMAC-SHA256 tamper protection.
 */
export async function encryptBackupPayload(
  payload: any,
  passphrase: string
): Promise<string> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('Encryption passphrase is required.');
  }

  const signedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) && !payload.hmac
      ? await signBackupPayloadHmac(payload, payload?.manifest?.companyId)
      : payload;

  const plaintext = typeof signedPayload === 'string' ? signedPayload : JSON.stringify(signedPayload);
  const checksum = await calculateSha256(plaintext);
  const companyId =
    (signedPayload && typeof signedPayload === 'object' && signedPayload?.manifest?.companyId) ||
    'MAIN';

  // Generate 16 bytes random salt for PBKDF2
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);

  // Generate 12 bytes random IV for AES-GCM
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const iterations = 100000;
  const { aesKey, hmacKey } = await deriveSplitKeysFromPassphrase(passphrase, salt, iterations);

  const encoder = new TextEncoder();
  const encodedPlaintext = encoder.encode(plaintext);

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as any,
    },
    aesKey,
    encodedPlaintext
  );

  const baseEnvelope = {
    magic: 'SAIMETRIC_ENCRYPTED_BACKUP' as const,
    version: 2 as const,
    createdAt: new Date().toISOString(),
    companyId: String(companyId).trim().toUpperCase(),
    kdf: {
      algorithm: 'PBKDF2' as const,
      hash: 'SHA-256' as const,
      iterations,
      salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
    },
    cipher: {
      algorithm: 'AES-GCM' as const,
      length: 256 as const,
      iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    },
    checksum,
    data: arrayBufferToBase64(encryptedBuffer),
  };

  const signingInput = buildCanonicalEncryptedSigningInput(baseEnvelope);
  const structuralKey = await deriveStructuralHmacKey(baseEnvelope.companyId);

  const [envelopeSignature, integritySignature] = await Promise.all([
    computeHmacWithKey(hmacKey, signingInput),
    computeHmacWithKey(structuralKey, signingInput),
  ]);

  const envelope: EncryptedBackupEnvelope = {
    ...baseEnvelope,
    hmac: {
      algorithm: 'HMAC-SHA256',
      envelopeSignature,
      integritySignature,
    },
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Helper to detect if a parsed JSON object is an unencrypted Saimetric backup
 * (v3 SyncEnvelope[] payload, raw SyncEnvelope[] array, or legacy v2 { manifest, tables })
 */
export function isUnencryptedBackupObject(parsed: any): boolean {
  if (!parsed) return false;
  if (Array.isArray(parsed)) {
    return parsed.length === 0 || Boolean(parsed[0]?.entityType && parsed[0]?.packetId);
  }
  if (typeof parsed === 'object') {
    if (parsed.manifest && Array.isArray(parsed.envelopes)) return true;
    if (parsed.manifest && parsed.tables) return true;
  }
  return false;
}

/**
 * Decrypt and verify HMAC integrity of an encrypted (.saimetric.enc) or JSON backup file
 */
export async function decryptBackupPayload(
  rawEncryptedJson: string,
  passphrase: string
): Promise<DecryptBackupResult> {
  try {
    let parsed: any;
    try {
      parsed = JSON.parse(rawEncryptedJson);
    } catch {
      return { success: false, error: 'Invalid backup file: Not valid JSON.' };
    }

    // Check if it's already an unencrypted backup JSON (v3 envelopes, raw SyncEnvelope[], or legacy v2)
    if (isUnencryptedBackupObject(parsed)) {
      const hmacCheck = await verifyBackupPayloadHmac(parsed);
      if (!hmacCheck.valid) {
        return {
          success: false,
          tampered: true,
          hmacVerified: false,
          error: hmacCheck.error,
        };
      }
      return {
        success: true,
        data: parsed,
        hmacVerified: hmacCheck.present && hmacCheck.valid,
        legacyUnsigned: !hmacCheck.present,
      };
    }

    if (!parsed || parsed.magic !== 'SAIMETRIC_ENCRYPTED_BACKUP') {
      return {
        success: false,
        error: 'Unrecognized backup format. Please select a valid Saimetric backup file (.saimetric.enc or .json).',
      };
    }

    const envelope = parsed as EncryptedBackupEnvelope;

    // Step 1: Verify structural HMAC BEFORE asking/checking password — catches any file edit immediately!
    if (envelope.version === 2 || envelope.hmac?.integritySignature) {
      if (!envelope.hmac?.integritySignature || !envelope.hmac?.envelopeSignature) {
        return {
          success: false,
          tampered: true,
          hmacVerified: false,
          error:
            'FILE TAMPERING DETECTED: Required HMAC-SHA256 signature block was stripped or altered. Import blocked.',
        };
      }
      const signingInput = buildCanonicalEncryptedSigningInput(envelope);
      const structuralKey = await deriveStructuralHmacKey(envelope.companyId || 'MAIN');
      const expectedStructuralSig = await computeHmacWithKey(structuralKey, signingInput);
      if (!timingSafeEqual(expectedStructuralSig, envelope.hmac.integritySignature)) {
        return {
          success: false,
          tampered: true,
          hmacVerified: false,
          error:
            'FILE TAMPERING DETECTED: This encrypted backup file was edited or corrupted after export (HMAC-SHA256 mismatch). Import blocked.',
        };
      }
    }

    if (!passphrase || passphrase.trim().length === 0) {
      return { success: false, error: 'Password cannot be empty.' };
    }

    const salt = base64ToUint8Array(envelope.kdf.salt);
    const iv = base64ToUint8Array(envelope.cipher.iv);
    const ciphertext = base64ToUint8Array(envelope.data);
    const iterations = envelope.kdf.iterations || 100000;

    let aesKey: CryptoKey;
    let hmacVerified = false;

    if (envelope.version === 2) {
      try {
        const split = await deriveSplitKeysFromPassphrase(passphrase, salt, iterations);
        aesKey = split.aesKey;

        // Step 2: Verify passphrase-bound HMAC over all headers + ciphertext
        const signingInput = buildCanonicalEncryptedSigningInput(envelope);
        const expectedEnvSig = await computeHmacWithKey(split.hmacKey, signingInput);
        if (!envelope.hmac?.envelopeSignature || !timingSafeEqual(expectedEnvSig, envelope.hmac.envelopeSignature)) {
          return {
            success: false,
            hmacVerified: false,
            error: 'Incorrect decryption password (HMAC authentication failed).',
          };
        }
        hmacVerified = true;
      } catch (e: any) {
        return { success: false, error: `Key derivation failed: ${e.message}` };
      }
    } else {
      // Legacy v1 encrypted backup compatibility
      try {
        aesKey = await deriveLegacyAesKeyFromPassphrase(passphrase, salt, iterations);
      } catch (e: any) {
        return { success: false, error: `Key derivation failed: ${e.message}` };
      }
    }

    let decryptedBuffer: ArrayBuffer;
    try {
      decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as any,
        },
        aesKey,
        ciphertext as any
      );
    } catch {
      return {
        success: false,
        error: 'Incorrect decryption password or corrupted ciphertext (AES-GCM authentication tag mismatch).',
      };
    }

    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decryptedBuffer);

    // Step 3: Verify SHA-256 checksum of plaintext
    if (envelope.checksum) {
      const calculatedChecksum = await calculateSha256(plaintext);
      if (!timingSafeEqual(calculatedChecksum, envelope.checksum)) {
        return {
          success: false,
          tampered: true,
          hmacVerified: false,
          error: 'FILE TAMPERING DETECTED: Plaintext SHA-256 checksum mismatch. Import blocked.',
        };
      }
    }

    const payload = JSON.parse(plaintext);

    // Step 4: Verify inner payload HMAC if present
    const innerHmacCheck = await verifyBackupPayloadHmac(payload);
    if (!innerHmacCheck.valid) {
      return {
        success: false,
        tampered: true,
        hmacVerified: false,
        error: innerHmacCheck.error,
      };
    }

    return {
      success: true,
      data: payload,
      hmacVerified: hmacVerified || (innerHmacCheck.present && innerHmacCheck.valid),
      legacyUnsigned: !hmacVerified && !innerHmacCheck.present,
    };
  } catch (err: any) {
    return { success: false, error: `Decryption error: ${err.message}` };
  }
}

export const backupCryptoService = {
  encryptBackupPayload,
  decryptBackupPayload,
  signBackupPayloadHmac,
  verifyBackupPayloadHmac,
  isUnencryptedBackupObject,
};

