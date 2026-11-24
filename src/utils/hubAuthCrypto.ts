/**
 * hubAuthCrypto.ts
 * Mutual authentication & command-signing cryptographic utilities for Local Hub <-> POS PWA.
 *
 * Uses native Web Crypto (crypto.subtle) on secure origins (https:// or localhost),
 * and automatically falls back to a pure TypeScript RFC-2104 HMAC-SHA256 implementation
 * on plain HTTP LAN origins (e.g. http://192.168.1.50:3000) where browsers disable crypto.subtle.
 */

const textEncoder = new TextEncoder();

// ==================== PURE-JS SHA-256 / HMAC-SHA256 FALLBACK ====================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;

  const view = new DataView(padded.buffer);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  view.setUint32(paddedLen - 8, hi, false);
  view.setUint32(paddedLen - 4, lo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
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

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hmacSha256PureHex(secret: string, message: string): string {
  const blockSize = 64;
  let keyBytes: Uint8Array = textEncoder.encode(secret);
  if (keyBytes.length > blockSize) {
    keyBytes = sha256Bytes(keyBytes);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(keyBytes);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const msgBytes = textEncoder.encode(message);
  const innerInput = new Uint8Array(blockSize + msgBytes.length);
  innerInput.set(iKeyPad, 0);
  innerInput.set(msgBytes, blockSize);
  const innerHash = sha256Bytes(innerInput);

  const outerInput = new Uint8Array(blockSize + innerHash.length);
  outerInput.set(oKeyPad, 0);
  outerInput.set(innerHash, blockSize);
  return bytesToHex(sha256Bytes(outerInput));
}

// ==================== PUBLIC CRYPTO HELPERS ====================

/**
 * Computes lowercase hex HMAC-SHA256 using crypto.subtle when available,
 * falling back seamlessly to RFC-2104 pure JS on HTTP LAN origins.
 */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
      return bytesToHex(new Uint8Array(sig));
    } catch {
      // Fall through to pure JS RFC-2104 implementation
    }
  }
  return hmacSha256PureHex(secret, message);
}

/**
 * Constant-time string equality check for hex digests and tokens.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Proof sent by PWA to prove possession of its per-device secret for this Hub challenge.
 */
export async function computeClientAuthProof(
  deviceSecret: string,
  nonce: string,
  hubId: string,
  deviceId: string,
  timestamp: number
): Promise<string> {
  const canonical = `CLIENT:${nonce}:${hubId}:${deviceId}:${timestamp}`;
  return hmacSha256Hex(deviceSecret, canonical);
}

/**
 * Proof sent by Hub to prove it is the authentic paired Hub (stops rogue/spoofed Hubs on LAN).
 */
export async function computeHubAuthProof(
  deviceSecret: string,
  nonce: string,
  hubId: string,
  branchId: string,
  timestamp: number
): Promise<string> {
  const canonical = `HUB:${nonce}:${hubId}:${branchId}:${timestamp}`;
  return hmacSha256Hex(deviceSecret, canonical);
}

/**
 * Per-packet HMAC signature for sensitive commands (RESET_BRANCH, STAFF_SYNC, CASH_TRANSFER, etc.).
 */
export async function computeCommandSignature(
  deviceSecret: string,
  action: string,
  recordId: string,
  timestamp: number
): Promise<string> {
  const canonical = `CMD:${String(action || '').toUpperCase()}:${String(recordId || '')}:${timestamp}`;
  return hmacSha256Hex(deviceSecret, canonical);
}

/**
 * Computes a short human-readable 6-digit verification code from pairing nonce + deviceId
 * for TV-style / desktop visual confirmation without needing a camera.
 */
export function computeVisualConfirmCode(hubId: string, deviceId: string, nonce: string): string {
  const hash = sha256Bytes(textEncoder.encode(`PAIR:${hubId}:${deviceId}:${nonce}`));
  const num = ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0;
  const sixDigit = String(num % 1000000).padStart(6, '0');
  return `${sixDigit.slice(0, 3)}-${sixDigit.slice(3)}`;
}

/**
 * Generates a fresh 16-byte random hex nonce for client-initiated mutual challenge.
 */
export function generateClientNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToHex(bytes);
}

export interface ParsedPairDeepLink {
  wsUrl: string;
  pairCode?: string;
  hubId?: string;
}

/**
 * Safely parses native-camera deep-link query params (?pairHost=...&pairCode=...&hubId=...).
 * Rejects dangerous schemes (javascript:, data:, file:) and only accepts valid ws/wss/LAN host inputs.
 */
export function parsePairDeepLink(search: string): ParsedPairDeepLink | null {
  if (!search || typeof search !== 'string') return null;
  try {
    const params = new URLSearchParams(search);
    const rawHost = (params.get('pairHost') || params.get('pairHub') || '').trim();
    if (!rawHost) return null;

    const lower = rawHost.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:')) {
      return null;
    }

    let wsUrl = rawHost;
    if (lower.startsWith('https://')) {
      wsUrl = 'wss://' + rawHost.slice('https://'.length);
    } else if (lower.startsWith('http://')) {
      wsUrl = 'ws://' + rawHost.slice('http://'.length);
    } else if (!lower.startsWith('ws://') && !lower.startsWith('wss://')) {
      // Allow strictly IPv4(:port) or hostname(:port)
      if (!/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(rawHost)) {
        return null;
      }
      wsUrl = rawHost.includes(':') ? `ws://${rawHost}` : `ws://${rawHost}:8080`;
    }

    const parsedUrl = new URL(wsUrl);
    if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
      return null;
    }

    const rawCode = (params.get('pairCode') || params.get('code') || '').replace(/[^0-9A-Za-z-]/g, '').trim();
    const rawHubId = (params.get('hubId') || '').replace(/[^0-9A-Za-z_-]/g, '').trim();

    return {
      wsUrl: parsedUrl.origin.replace(/^http/, 'ws'),
      ...(rawCode ? { pairCode: rawCode } : {}),
      ...(rawHubId ? { hubId: rawHubId } : {}),
    };
  } catch {
    return null;
  }
}
