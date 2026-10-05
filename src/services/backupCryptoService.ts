/**
 * Bank-grade Client-Side AES-256-GCM Encryption & Decryption Service
 * Uses standard Web Crypto API (SubtleCrypto) with PBKDF2 key derivation.
 * Works natively in all modern browsers and Node runtimes with zero external dependencies.
 */

export interface EncryptedBackupEnvelope {
  magic: 'SAIMETRIC_ENCRYPTED_BACKUP';
  version: 1;
  createdAt: string;
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
  data: string; // Base64 ciphertext
}

// Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

// Calculate SHA-256 checksum of string
async function calculateSha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hashBuffer);
}

// Derive AES-GCM-256 key from passphrase and salt via PBKDF2
async function deriveKeyFromPassphrase(
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

/**
 * Encrypt a JSON-serializable payload with a passphrase using AES-GCM 256
 */
export async function encryptBackupPayload(
  payload: any,
  passphrase: string
): Promise<string> {
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error('Encryption passphrase is required.');
  }

  const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const checksum = await calculateSha256(plaintext);

  // Generate 16 bytes random salt for PBKDF2
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);

  // Generate 12 bytes random IV for AES-GCM
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const iterations = 100000;
  const key = await deriveKeyFromPassphrase(passphrase, salt, iterations);

  const encoder = new TextEncoder();
  const encodedPlaintext = encoder.encode(plaintext);

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as any,
    },
    key,
    encodedPlaintext
  );

  const envelope: EncryptedBackupEnvelope = {
    magic: 'SAIMETRIC_ENCRYPTED_BACKUP',
    version: 1,
    createdAt: new Date().toISOString(),
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
    },
    cipher: {
      algorithm: 'AES-GCM',
      length: 256,
      iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    },
    checksum,
    data: arrayBufferToBase64(encryptedBuffer),
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Decrypt an encrypted backup file back into the original payload
 */
export async function decryptBackupPayload(
  rawEncryptedJson: string,
  passphrase: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    if (!passphrase || passphrase.trim().length === 0) {
      return { success: false, error: 'Password cannot be empty.' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawEncryptedJson);
    } catch {
      return { success: false, error: 'Invalid backup file: Not valid JSON.' };
    }

    // Check if it's already an unencrypted backup JSON
    if (parsed && parsed.manifest && parsed.tables) {
      return { success: true, data: parsed };
    }

    if (!parsed || parsed.magic !== 'SAIMETRIC_ENCRYPTED_BACKUP') {
      return { success: false, error: 'Unrecognized backup format. Please select a valid Saimetric backup file.' };
    }

    const envelope = parsed as EncryptedBackupEnvelope;
    const salt = base64ToUint8Array(envelope.kdf.salt);
    const iv = base64ToUint8Array(envelope.cipher.iv);
    const ciphertext = base64ToUint8Array(envelope.data);
    const iterations = envelope.kdf.iterations || 100000;

    let key: CryptoKey;
    try {
      key = await deriveKeyFromPassphrase(passphrase, salt, iterations);
    } catch (e: any) {
      return { success: false, error: `Key derivation failed: ${e.message}` };
    }

    let decryptedBuffer: ArrayBuffer;
    try {
      decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as any,
        },
        key,
        ciphertext as any
      );
    } catch {
      // AES-GCM fails authentication tag when password is incorrect
      return {
        success: false,
        error: 'Incorrect decryption password. Verification failed (authentication tag mismatch).',
      };
    }

    const decoder = new TextDecoder();
    const plaintext = decoder.decode(decryptedBuffer);

    // Verify SHA-256 checksum
    if (envelope.checksum) {
      const calculatedChecksum = await calculateSha256(plaintext);
      if (calculatedChecksum !== envelope.checksum) {
        return {
          success: false,
          error: 'Backup file integrity compromised: Checksum verification mismatch.',
        };
      }
    }

    const payload = JSON.parse(plaintext);
    return { success: true, data: payload };
  } catch (err: any) {
    return { success: false, error: `Decryption error: ${err.message}` };
  }
}

export const backupCryptoService = {
  encryptBackupPayload,
  decryptBackupPayload,
};
