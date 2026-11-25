# SAIMETRIC POS PWA — Performance & Architecture Guardrails

This document defines the permanent engineering rules and automated gates that keep the SAIMETRIC POS PWA fast, offline-resilient, and scalable as features evolve.

## Single Pre-Merge / Release Gate

Run one command before merging or deploying any change:

```bash
npm run verify
```

`npm run verify` runs five sequential gates and fails immediately on any violation:
1. `npm run lint` — TypeScript strict type-checking across `src/`.
2. `npm test` — Automated regression test suite (`scripts/run-regression-tests.ts`) covering `.saimpack` decryption & T1 ingest rules, browser quota pruning & T2 protection, modular DAOs, checkout-safe PWA updates, and sync resilience (jittered backoff, DLQ quarantine, circuit breaker, cross-tab lock).
3. `npm run build` — Production Vite bundle + Workbox service worker precache manifest generation.
4. `npm run check:budgets` — Enforces minified gzip bundle ceilings and static asset size ceilings.
5. `npm run check:arch` — Enforces monolith line ceilings, boot-path dependency hygiene, list virtualization retention, zero blocking dialogs in resilience flows, and built PWA manifest/SW integrity.

---

## Hard Performance Budgets (`scripts/check-budgets.mjs`)

| Metric | Phase 5 Hard Ceiling | Scope |
| --- | --- | --- |
| Entry JS bundle (`index-*.js`) | `<= 420 KB gz` | Main boot entry chunk |
| Total Initial Boot Preload JS | `<= 600 KB gz` | Entry + all `modulepreload` vendor chunks |
| Largest App Lazy Chunk | `<= 100 KB gz` | Any non-vendor lazy screen chunk |
| `public/` Static Assets | `<= 2 MB` | Uncompressed icons, fonts, and static assets |

Vendor heavyweights (`vendor-xlsx`, `vendor-charts`, `vendor-qr`, `vendor-mqtt`, `vendor-firebase`, `vendor-react`, `vendor-icons`, `vendor-genai`) are isolated via manual chunks and MUST only load on demand when their feature is opened.

---

## Architectural Guardrails (`scripts/check-architecture.mjs`)

### 1. Boot-Path Dependency Hygiene
- Never import `xlsx`, `recharts`, `html5-qrcode`, `mqtt`, or `qrcode` eagerly in `src/App.tsx`, `src/main.tsx`, or `src/index.tsx`.
- Every secondary screen, modal workflow, or reporting tool (e.g., Cash Balancing, Form 4, Stocktake Hub, Admin Audit, Hub Storage Archive) must remain `React.lazy(...)` loaded.

### 2. Monolith Containment & Modular DAOs
- Hard line ceilings prevent unbounded growth in legacy core files:
  - `src/db/roomDatabase.ts <= 27,500 lines`
  - `src/services/meshSyncService.ts <= 10,150 lines`
  - `src/App.tsx <= 1,850 lines`
- New database tables, queries, and write paths MUST be implemented as standalone DAO modules under `src/db/daos/` (following `auditLogDao.ts` and `expenseDao.ts`) and delegated from `roomDatabase.ts`.

### 3. High-Volume List Virtualization
- Any operational table or ledger that can grow past ~100 rows MUST render via `src/components/VirtualWindow.tsx` (currently enforced on `AuditLogView.tsx`, `POSOrdersHistory.tsx`, and `InventoryMasterView.tsx`).
- Avoid rendering unbounded `.map(...)` tables over sales history, audit logs, or SKU catalogs.

### 4. Storage Tiering & Browser Quota Safety
- **T2 Operational Data** (active inventory, pending sync queue, current open shifts, tax/compliance records, active cart) is **never auto-pruned** by `storageQuotaGuard.ts`.
- Only **T1 Cold Telemetry** (aged audit logs, already-synced historical receipts/cash counts beyond retention windows) may be pruned when browser storage pressure exceeds warning/critical thresholds.
- `.saimpack` archive ingestion strictly enforces Hub v4.2.0 PBKDF2 + AES-256-GCM verification and T1-only restoration rules.

### 5. Checkout-Safe PWA Updates & Workbox Precaching
- Never call `skipWaiting()` automatically while a cashier has an active cart, open payment modal, or active checkout lock (`pwaUpdateController.ts`). Queue the update and apply automatically only once checkout returns to idle or on explicit user confirmation.
- Never use blocking browser dialogs (`window.alert`, `window.confirm`, `window.prompt`) inside PWA update or sync resilience modules.
- Built `dist/sw.js` must precache app shell & runtime bundles while excluding server/hub scripts (`Code.gs`, `termux-hub.js`, `hub-ota`).

### 6. Sync Engine Resilience
- All outbound sync loops must pass through `syncResilience.ts`:
  - **Jittered exponential backoff** for transient network/5xx errors.
  - **Dead-Letter Quarantine (DLQ)** classification for permanent 4xx/validation/schema errors so poison records never stall the queue.
  - **Circuit breaker** trip/half-open probe on sustained hub outages.
  - **Cross-tab leader lock** (`withCrossTabSyncLock`) so multiple open browser tabs never duplicate writes or race sync cursors.

---

## Pre-Release Checklist for Future PRs

- [ ] New screens and heavy utilities are lazy-loaded; no heavy vendor imports added to boot files.
- [ ] New DB logic lives in `src/db/daos/` rather than expanding `roomDatabase.ts`.
- [ ] Large tables use `VirtualWindow` with stable row keys and measured heights.
- [ ] T2 active operational data remains protected from automated quota pruning.
- [ ] `npm run verify` passes with zero errors and all budgets within Phase 5 ceilings.
