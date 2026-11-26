#!/usr/bin/env node
/**
 * Saimetric Local Hub OTA Builder & Ed25519 Signer
 *
 * Bundles public/termux-hub.js (+ ws) into a single self-contained CommonJS file
 * inside public/hub-ota/ and writes public/hub-ota/manifest.json.
 *
 * Usage:
 *   1) First-time keypair generation (run ONCE on your private build machine):
 *        node scripts/build-hub-ota.mjs --keygen
 *      - Saves PRIVATE key to .hub-ota-private.pem (gitignored — NEVER commit or put in /public!)
 *      - Saves PUBLIC key to public/hub-ota/public-key.pem (embed in Android Hub APK)
 *
 *   2) Build & sign OTA release whenever public/termux-hub.js is updated:
 *        npm run build:hub-ota
 *      Optional flags:
 *        --base-url https://your-pwa-domain.example
 *        --min-shell 1.0.0
 *      Optional env var (CI/CD):
 *        HUB_OTA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const ROOT = process.cwd();
const SOURCE_HUB = path.join(ROOT, 'public', 'termux-hub.js');
const OTA_DIR = path.join(ROOT, 'public', 'hub-ota');
const MANIFEST_PATH = path.join(OTA_DIR, 'manifest.json');
const PRIVATE_KEY_PATH = path.join(ROOT, '.hub-ota-private.pem');
const PUBLIC_KEY_PATH = path.join(OTA_DIR, 'public-key.pem');

function getArg(flag, fallback = '') {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? String(process.argv[idx + 1]).trim() : fallback;
}

function extractHubVersion(sourceCode) {
  const m = sourceCode.match(/const\s+HUB_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m && m[1] ? m[1].trim() : '4.1.0';
}

function runKeygen() {
  fs.mkdirSync(OTA_DIR, { recursive: true });
  if (fs.existsSync(PRIVATE_KEY_PATH) && !process.argv.includes('--force')) {
    console.error(`[Hub OTA] Private key already exists at ${PRIVATE_KEY_PATH}. Pass --force to overwrite.`);
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const pubSpkiDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  fs.writeFileSync(PRIVATE_KEY_PATH, privPem, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, pubPem, { encoding: 'utf8' });

  console.log('================================================================');
  console.log('Ed25519 Hub OTA Keypair Generated Successfully');
  console.log('----------------------------------------------------------------');
  console.log(`PRIVATE KEY (KEEP SECRET / NEVER COMMIT): ${PRIVATE_KEY_PATH}`);
  console.log(`PUBLIC KEY (SAFE TO EMBED IN APK):        ${PUBLIC_KEY_PATH}`);
  console.log('');
  console.log('Embed this Base64 SPKI Ed25519 Public Key inside the Android Hub APK:');
  console.log(pubSpkiDerB64);
  console.log('================================================================');
}

function loadPrivateKey() {
  let envKey = String(process.env.HUB_OTA_PRIVATE_KEY || '').trim();
  if (envKey) {
    if (
      (envKey.startsWith('"') && envKey.endsWith('"')) ||
      (envKey.startsWith("'") && envKey.endsWith("'"))
    ) {
      envKey = envKey.slice(1, -1).trim();
    }
    const normalized = envKey.includes('\\n') ? envKey.replace(/\\n/g, '\n') : envKey;
    return crypto.createPrivateKey(normalized);
  }
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    return crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'));
  }
  return null;
}

async function buildOta() {
  if (!fs.existsSync(SOURCE_HUB)) {
    console.error(`[Hub OTA] Source file not found: ${SOURCE_HUB}`);
    process.exit(1);
  }

  fs.mkdirSync(OTA_DIR, { recursive: true });

  const sourceCode = fs.readFileSync(SOURCE_HUB, 'utf8');
  const version = getArg('--version', extractHubVersion(sourceCode));
  const minShellVersion = getArg('--min-shell', '1.0.0');
  const baseUrl = getArg('--base-url', process.env.HUB_OTA_BASE_URL || '').replace(/\/+$/, '');
  const bundleFilename = `hub-core-${version}.bundle.js`;
  const bundleOutPath = path.join(OTA_DIR, bundleFilename);
  const bundlePath = `/hub-ota/${bundleFilename}`;

  // Clean up previous versioned bundles in public/hub-ota/ so stale files do not accumulate
  for (const existing of fs.readdirSync(OTA_DIR)) {
    if (/^hub-core-.*\.bundle\.js$/.test(existing) && existing !== bundleFilename) {
      fs.unlinkSync(path.join(OTA_DIR, existing));
    }
  }

  // Bundle public/termux-hub.js + ws into a single zero-dependency Node CommonJS file
  await esbuild.build({
    entryPoints: [SOURCE_HUB],
    outfile: bundleOutPath,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: false,
    legalComments: 'none',
    // Keep optional native ws accelerators and optional mongodb driver external
    external: ['bufferutil', 'utf-8-validate', 'mongodb'],
    banner: {
      js: `/* Saimetric Local Hub Core OTA Bundle v${version} — Built ${new Date().toISOString()} */`,
    },
  });

  const bundleBuffer = fs.readFileSync(bundleOutPath);
  const sha256 = crypto.createHash('sha256').update(bundleBuffer).digest('hex');
  const canonicalMessage = `${version}|${minShellVersion}|${sha256}`;

  const privateKey = loadPrivateKey();
  let signature = '';
  let signed = false;

  if (privateKey) {
    signature = crypto.sign(null, Buffer.from(canonicalMessage, 'utf8'), privateKey).toString('base64');
    signed = true;

    // Self-verify signature against public key if present
    if (fs.existsSync(PUBLIC_KEY_PATH)) {
      const pubKey = crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_PATH, 'utf8'));
      const ok = crypto.verify(null, Buffer.from(canonicalMessage, 'utf8'), pubKey, Buffer.from(signature, 'base64'));
      if (!ok) {
        console.error('[Hub OTA] FATAL: Signature self-verification failed against public-key.pem!');
        process.exit(1);
      }
    }
  }

  const manifest = {
    version,
    minShellVersion,
    bundlePath,
    bundleUrl: baseUrl ? `${baseUrl}${bundlePath}` : bundlePath,
    sha256,
    sizeBytes: bundleBuffer.length,
    signature,
    signatureAlgorithm: 'Ed25519',
    signed,
    releasedAt: new Date().toISOString(),
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('================================================================');
  console.log(`[Hub OTA] Built bundle:  ${bundleOutPath} (${(bundleBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`[Hub OTA] Manifest:      ${MANIFEST_PATH}`);
  console.log(`[Hub OTA] Version:       ${version} (minShell: ${minShellVersion})`);
  console.log(`[Hub OTA] SHA-256:       ${sha256}`);
  console.log(`[Hub OTA] Signed:        ${signed ? 'YES (Ed25519 verified)' : 'NO (run --keygen on your private machine, then re-run build:hub-ota)'}`);
  console.log('================================================================');
}

if (process.argv.includes('--keygen')) {
  runKeygen();
} else {
  buildOta().catch((err) => {
    console.error('[Hub OTA] Build failed:', err);
    process.exit(1);
  });
}
