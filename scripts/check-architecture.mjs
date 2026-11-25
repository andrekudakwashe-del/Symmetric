#!/usr/bin/env node
/**
 * SAIMETRIC Automated Architecture & PWA Governance Gate (Phase 5)
 *
 * Enforces permanent guardrails so future feature changes cannot regress
 * Phases 1–4 speed, offline reliability, checkout safety, or modularization:
 *  1. Monolith line-count ceilings (forces new DAOs into src/db/daos/ & sync into src/services/sync/).
 *  2. Zero static heavy-vendor imports in entry boot path (App.tsx, main.tsx, roomDatabase.ts).
 *  3. Virtualization retention on high-row screens (AuditLogView, POSOrdersHistory, InventoryMasterView).
 *  4. Production PWA compliance & checkout-safe Workbox Service Worker audit on dist/.
 *  5. Zero blocking window.alert / window.confirm calls in PWA & sync resilience modules.
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const failures = [];
const warnings = [];

function readFileSafe(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

// 1. Monolith Regrowth Ceilings
const MONOLITH_CEILINGS = [
  { file: 'src/db/roomDatabase.ts', maxLines: 27500, guidance: 'Extract new DAOs into src/db/daos/ instead of growing roomDatabase.ts' },
  { file: 'src/services/meshSyncService.ts', maxLines: 10150, guidance: 'Extract new sync helpers into src/services/sync/ instead of growing meshSyncService.ts' },
  { file: 'src/App.tsx', maxLines: 1850, guidance: 'Keep new screens lazy-loaded in dedicated components instead of expanding App.tsx' },
];

for (const rule of MONOLITH_CEILINGS) {
  const content = readFileSafe(rule.file);
  if (!content) {
    failures.push(`Expected file missing: ${rule.file}`);
    continue;
  }
  const count = lineCount(content);
  if (count > rule.maxLines) {
    failures.push(`${rule.file} has ${count} lines (ceiling ${rule.maxLines}). ${rule.guidance}`);
  } else {
    console.log(`[ArchGate] Monolith ceiling OK: ${rule.file} (${count} / ${rule.maxLines} lines)`);
  }
}

// 2. Forbidden static heavy-vendor imports on initial boot path
const BOOT_FILES = ['src/main.tsx', 'src/App.tsx', 'src/db/roomDatabase.ts'];
const HEAVY_VENDORS = ['xlsx', 'recharts', 'html5-qrcode', 'mqtt', 'qrcode'];

for (const rel of BOOT_FILES) {
  const content = readFileSafe(rel);
  if (!content) continue;
  for (const pkg of HEAVY_VENDORS) {
    const staticImportRe = new RegExp(`^\\s*import\\s+[^;]*from\\s+['"]${pkg}(?:/[^'"]*)?['"]`, 'm');
    if (staticImportRe.test(content)) {
      failures.push(`Forbidden eager static import of "${pkg}" in ${rel} (must be dynamically imported)`);
    }
  }
}
console.log('[ArchGate] Boot-path vendor isolation OK (no eager xlsx/recharts/mqtt/qr imports)');

// 3. Virtualization retention on high-row screens
const VIRTUALIZED_VIEWS = [
  'src/components/admin/AuditLogView.tsx',
  'src/components/pos/POSOrdersHistory.tsx',
  'src/components/inventory/InventoryMasterView.tsx',
];

for (const rel of VIRTUALIZED_VIEWS) {
  const content = readFileSafe(rel);
  if (!content) {
    failures.push(`Expected virtualized view missing: ${rel}`);
    continue;
  }
  if (!content.includes('VirtualWindow')) {
    failures.push(`${rel} no longer imports VirtualWindow — high-row virtualization regression detected`);
  }
}
console.log('[ArchGate] High-row UI virtualization retention OK (AuditLog, POSReceipts, InventoryMaster)');

// 4. Zero blocking browser dialogs in PWA & sync resilience modules
const NON_BLOCKING_MODULES = [
  'src/services/pwaUpdateController.ts',
  'src/services/pwaUpdateManager.ts',
  'src/components/pwa/PWAUpdateBanner.tsx',
  'src/services/sync/syncResilience.ts',
  'src/db/storageQuotaGuard.ts',
];

for (const rel of NON_BLOCKING_MODULES) {
  const content = readFileSafe(rel);
  if (!content) {
    failures.push(`Expected resilience module missing: ${rel}`);
    continue;
  }
  if (/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(content)) {
    failures.push(`Blocking browser dialog found in ${rel} (forbidden in POS/iframe-safe modules)`);
  }
}
console.log('[ArchGate] Non-blocking POS & resilience module checks OK');

// 5. Production PWA & Checkout-Safe Service Worker Audit (dist/)
const distDir = path.join(ROOT, 'dist');
if (!fs.existsSync(distDir)) {
  warnings.push('dist/ not found — run `npm run build` before `npm run check:arch` for full PWA audit.');
} else {
  const manifestRaw = readFileSafe('dist/manifest.json');
  const swRaw = readFileSafe('dist/sw.js');
  const htmlRaw = readFileSafe('dist/index.html');

  if (!manifestRaw) {
    failures.push('dist/manifest.json missing (VitePWA manifest generation broken)');
  } else {
    const manifest = JSON.parse(manifestRaw);
    if (!manifest.id || !manifest.name || !manifest.short_name || manifest.display !== 'standalone') {
      failures.push('dist/manifest.json missing required fields (id, name, short_name, display: standalone)');
    }
    if (String(manifest.short_name || '').length > 12) {
      failures.push(`dist/manifest.json short_name "${manifest.short_name}" exceeds 12 chars`);
    }
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    const has192 = icons.some((i) => i.sizes === '192x192' && i.type === 'image/png' && i.purpose === 'any');
    const has512 = icons.some((i) => i.sizes === '512x512' && i.type === 'image/png' && i.purpose === 'any');
    const hasMaskable = icons.some((i) => i.sizes === '512x512' && i.type === 'image/png' && i.purpose === 'maskable');
    if (!has192 || !has512 || !hasMaskable) {
      failures.push('dist/manifest.json must declare 192x192 (any), 512x512 (any), and 512x512 (maskable) PNG icons');
    }
  }

  if (!htmlRaw || !htmlRaw.includes('manifest.json') || !htmlRaw.includes('apple-touch-icon.png')) {
    failures.push('dist/index.html must reference manifest.json and PNG apple-touch-icon.png for iOS Safari');
  }

  if (!swRaw) {
    failures.push('dist/sw.js missing (Workbox service worker build broken)');
  } else {
    const precacheEntries = swRaw.match(/url:"[^"]+"/g) || [];
    if (precacheEntries.length < 20) {
      failures.push(`dist/sw.js precache manifest too small (${precacheEntries.length} entries; expected >= 20 built assets)`);
    }
    const forbiddenPrecache = precacheEntries.filter((u) => /Code\.gs|termux-hub|hub-ota/i.test(u));
    if (forbiddenPrecache.length > 0) {
      failures.push(`dist/sw.js precached forbidden server/Hub scripts: ${forbiddenPrecache.join(', ')}`);
    }
    if (!swRaw.includes('SKIP_WAITING')) {
      failures.push('dist/sw.js missing prompt-only SKIP_WAITING message listener (checkout-safe update broken)');
    }
    console.log(`[ArchGate] PWA & Workbox SW audit OK (${precacheEntries.length} precached offline assets, prompt-only updates)`);
  }
}

if (warnings.length > 0) {
  warnings.forEach((w) => console.warn(`[ArchGate] WARNING: ${w}`));
}

if (failures.length > 0) {
  console.error('\n[ArchGate] FAILED:');
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

console.log('[ArchGate] ALL ARCHITECTURE & PWA GUARDRAILS PASSED');
