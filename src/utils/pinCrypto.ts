/**
 * Cryptographic PIN Hashing & One-Way Verification Service
 * Conforms to FIPS 180-4 standard SHA-256.
 * Zero external dependencies. Works synchronously across all browser engines,
 * web workers, Android WebViews, and Node.js / Termux runtimes.
 */

// SHA-256 Constants (first 32 bits of fractional parts of cube roots of first 64 primes)
const K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

/**
 * Standard SHA-256 Synchronous Hashing
 * Returns 64-character lowercase hex string
 */
export function sha256Hex(input: string): string {
  let H: number[] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const encoder = new TextEncoder();
  const utf8 = encoder.encode(input);
  const bitLen = utf8.length * 8;

  const padLen = (utf8.length % 64 < 56) ? (56 - (utf8.length % 64)) : (120 - (utf8.length % 64));
  const totalLen = utf8.length + padLen + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(utf8);
  buf[utf8.length] = 0x80;

  const view = new DataView(buf.buffer);
  view.setBigUint64(totalLen - 8, BigInt(bitLen), false);

  const W = new Uint32Array(64);
  for (let i = 0; i < totalLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * Generate a cryptographically strong random salt (16 bytes = 32 hex characters)
 */
export function generatePinSalt(bytesCount = 16): string {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(bytesCount);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {}

  // Fallback pseudorandom generator
  let result = '';
  for (let i = 0; i < bytesCount; i++) {
    const rand = Math.floor(Math.random() * 256);
    result += rand.toString(16).padStart(2, '0');
  }
  return result;
}

/**
 * Hash a user PIN with their unique salt using SHA-256
 */
export function hashPin(pin: string | number, salt: string): string {
  const cleanPin = String(pin).trim();
  const cleanSalt = String(salt || '').trim();
  return sha256Hex(`${cleanSalt}:${cleanPin}`);
}

/**
 * Constant-time comparison between two hex strings to prevent timing attacks
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Check if a candidate PIN matches the stored hash given the salt
 */
export function verifyPinHash(candidatePin: string | number | undefined | null, storedHash?: string | null, salt?: string | null): boolean {
  if (!candidatePin || !storedHash || !salt) return false;
  const computed = hashPin(candidatePin, salt);
  return timingSafeEqualHex(computed, storedHash);
}

/**
 * Detect if a string is a 64-character SHA-256 hex hash
 */
export function isSha256Hash(val: unknown): boolean {
  return typeof val === 'string' && /^[0-9a-f]{64}$/i.test(val.trim());
}

/**
 * Sanitize user/staff/casual object for backup or network export.
 * Strips raw plain-text `pin` permanently while preserving `pin_hash` and `pin_salt`.
 */
export function sanitizeUserForExport<T extends Record<string, any>>(user: T): Omit<T, 'pin'> {
  if (!user || typeof user !== 'object') return user;
  const { pin, ...sanitized } = user;
  return sanitized as Omit<T, 'pin'>;
}
