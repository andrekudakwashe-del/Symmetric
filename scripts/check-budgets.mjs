#!/usr/bin/env node
/**
 * SAIMETRIC Automated Performance & Asset Budget Gate
 * Prevents bundle bloat, heavy vendor preload leaks, and stray oversized assets.
 * Ratchet budgets down progressively as optimization phases complete.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');
const DIST_ASSETS = path.join(DIST_DIR, 'assets');
const PUBLIC_DIR = path.join(ROOT, 'public');

const BUDGETS = {
  // Phase 5 permanent governance budgets (gzipped KB)
  maxEntryJsGzipKb: 420,          // index-*.js alone
  maxInitialPreloadJsGzipKb: 600, // Entry JS + modulepreload JS in dist/index.html
  maxSingleLazyChunkGzipKb: 200,  // Any single non-entry chunk (including vendor-core)
  maxAppLazyChunkGzipKb: 100,     // Any single non-vendor app feature lazy chunk
  maxPublicStaticMb: 2,           // Total public/ excluding public/hub-ota & termux-hub.js
  forbiddenPreloadVendors: ['vendor-mqtt', 'vendor-qr-scanner', 'vendor-qr-gen', 'vendor-xlsx', 'vendor-charts'],
};

function gzipSizeKb(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf, { level: 9 }).length / 1024;
}

function walkSizeBytes(dirPath, skipNames = new Set()) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += walkSizeBytes(full, skipNames);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function main() {
  if (!fs.existsSync(DIST_HTML) || !fs.existsSync(DIST_ASSETS)) {
    console.error('[BudgetGate] dist/ build output not found. Run `npm run build` first.');
    process.exit(1);
  }

  const html = fs.readFileSync(DIST_HTML, 'utf8');
  const scriptMatch = html.match(/<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/);
  const preloadMatches = Array.from(
    html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]*\/assets\/[^"]+\.js)"/g)
  ).map((m) => m[1]);

  const failures = [];

  if (!scriptMatch) {
    failures.push('Could not locate entry script in dist/index.html');
  } else {
    const entryAssetName = path.basename(scriptMatch[1]);
    const entryPath = path.join(DIST_ASSETS, entryAssetName);
    const entryGzKb = gzipSizeKb(entryPath);

    let totalPreloadGzKb = entryGzKb;
    const preloadedChunks = [`${entryAssetName} (${entryGzKb.toFixed(1)} KB gz)`];

    for (const href of preloadMatches) {
      const assetName = path.basename(href);
      for (const forbidden of BUDGETS.forbiddenPreloadVendors) {
        if (assetName.startsWith(forbidden)) {
          failures.push(
            `Forbidden eager preload detected in dist/index.html: ${assetName} (must be dynamically imported)`
          );
        }
      }
      const p = path.join(DIST_ASSETS, assetName);
      if (fs.existsSync(p)) {
        const gzKb = gzipSizeKb(p);
        totalPreloadGzKb += gzKb;
        preloadedChunks.push(`${assetName} (${gzKb.toFixed(1)} KB gz)`);
      }
    }

    console.log(`[BudgetGate] Initial boot scripts: ${preloadedChunks.join(', ')}`);
    console.log(
      `[BudgetGate] Total Initial Boot JS: ${totalPreloadGzKb.toFixed(1)} KB gz (budget <= ${BUDGETS.maxInitialPreloadJsGzipKb} KB gz)`
    );

    if (entryGzKb > BUDGETS.maxEntryJsGzipKb) {
      failures.push(
        `Entry JS ${entryAssetName} is ${entryGzKb.toFixed(1)} KB gz (exceeds ${BUDGETS.maxEntryJsGzipKb} KB gz limit)`
      );
    }
    if (totalPreloadGzKb > BUDGETS.maxInitialPreloadJsGzipKb) {
      failures.push(
        `Total Initial Preload JS is ${totalPreloadGzKb.toFixed(1)} KB gz (exceeds ${BUDGETS.maxInitialPreloadJsGzipKb} KB gz limit)`
      );
    }

    // Check individual lazy chunks
    let largestAppChunk = { name: '', gzKb: 0 };
    for (const file of fs.readdirSync(DIST_ASSETS)) {
      if (!file.endsWith('.js') || file === entryAssetName) continue;
      const gzKb = gzipSizeKb(path.join(DIST_ASSETS, file));
      if (gzKb > BUDGETS.maxSingleLazyChunkGzipKb) {
        failures.push(
          `Lazy chunk ${file} is ${gzKb.toFixed(1)} KB gz (exceeds ${BUDGETS.maxSingleLazyChunkGzipKb} KB gz limit)`
        );
      }
      if (!file.startsWith('vendor-')) {
        if (gzKb > largestAppChunk.gzKb) {
          largestAppChunk = { name: file, gzKb };
        }
        if (gzKb > BUDGETS.maxAppLazyChunkGzipKb) {
          failures.push(
            `App feature chunk ${file} is ${gzKb.toFixed(1)} KB gz (exceeds ${BUDGETS.maxAppLazyChunkGzipKb} KB gz limit)`
          );
        }
      }
    }
    if (largestAppChunk.name) {
      console.log(
        `[BudgetGate] Largest app feature lazy chunk: ${largestAppChunk.name} (${largestAppChunk.gzKb.toFixed(1)} KB gz, budget <= ${BUDGETS.maxAppLazyChunkGzipKb} KB gz)`
      );
    }
  }

  // Check static asset bloat in public/ (excluding OTA bundles and Hub script)
  const publicStaticBytes = walkSizeBytes(PUBLIC_DIR, new Set(['hub-ota', 'termux-hub.js', 'Code.gs']));
  const publicStaticMb = publicStaticBytes / (1024 * 1024);
  console.log(
    `[BudgetGate] public/ static assets: ${publicStaticMb.toFixed(2)} MB (budget <= ${BUDGETS.maxPublicStaticMb} MB)`
  );
  if (publicStaticMb > BUDGETS.maxPublicStaticMb) {
    failures.push(
      `public/ static assets total ${publicStaticMb.toFixed(2)} MB (exceeds ${BUDGETS.maxPublicStaticMb} MB limit)`
    );
  }

  if (failures.length > 0) {
    console.error('\n[BudgetGate] FAILED:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log('[BudgetGate] ALL BUDGETS PASSED');
}

main();
