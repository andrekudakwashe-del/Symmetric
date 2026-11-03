# Implementation Plan: Real-Time Cross-Device Inventory Management & Price Synchronization

## 1. Problem Statement & User Brief
> "syncing sporadic but i have discovered that even if make certain price changes if connect to the hub prices are going through back to a default price..i changed price of the same product 'chilli' its original price was $3 in one device i changed it $4 and in another to $5. i refreshed both apps the price went back to $3....kindly diagnose and solve"

## 2. Root Cause Analysis
1. **Flawed Timestamp Logic in `ingestMeshInventoryItem` (`src/db/roomDatabase.ts`)**:
   - The condition was:
     `if (!priceChanged && !nameChanged && existing.lastUpdated && item.lastUpdated) { if (existingTime > incomingTime) return false; }`
   - When a user edited a product's price from $3 to $4 or $5, and the Local Hub (or another peer device) later sent an older snapshot where the product was still at the original $3:
     `priceChanged` was evaluated as `true` (because local $4/$5 !== incoming $3).
   - Because `priceChanged` was `true`, `!priceChanged` evaluated to `false`, and the **timestamp comparison was completely skipped**!
   - Consequently, the older $3 price from the Local Hub's catchup or message stream unconditionally stomped on and overwrote the newer local $4 and $5 prices.
2. **Catalog Packets Paused During Local Hub Outbox Flush (`src/services/meshSyncService.ts`)**:
   - In `drainQueueToLocalHub()`, outgoing packets in `pendingLocalHubQueue` were evaluated:
     `if (targetBr === currentHubBranch.toUpperCase() || !targetBr)`
   - `broadcastInventoryItem` sends `target_branch_id: 'ALL'`.
   - Because `'ALL' !== currentHubBranch` (e.g. `'BR-MAIN'`), the catalog packet was placed into `pausedPackets` and **never sent to the Local Hub**!
3. **Pending Outbox Lost on Page Refresh**:
   - `pendingLocalHubQueue` was an in-memory array. If a user edited prices and then refreshed their browser, the outbox was wiped before the WebSocket could connect and flush it.
4. **Missing Last-Write-Wins Check in Termux Hub (`termux-hub.js` & `public/termux-hub.js`)**:
   - Incoming inventory items were stored in `inventoryStore` without comparing timestamps with existing items, allowing older packets to overwrite newer ones if received out of order.
5. **`backfillCompanyBranch` Overwriting `branch_id: 'ALL'`**:
   - In `src/db/roomDatabase.ts`, `backfillCompanyBranch` on startup was setting `branch_id` from `'ALL'` to `'BR-MAIN'`, interfering with shared company catalog items.

## 3. Implemented Fixes

### A. Room Database Engine (`src/db/roomDatabase.ts`)
- **Strict Last-Write-Wins (LWW) Enforcement**:
  - In `ingestMeshInventoryItem()`, replaced the inverted `!priceChanged` check with a strict timestamp check:
    ```ts
    const existingTime = existing.lastUpdated ? new Date(existing.lastUpdated).getTime() : 0;
    const incomingTime = item.lastUpdated ? new Date(item.lastUpdated).getTime() : 0;
    if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime) {
      if (priceChanged || nameChanged) {
        window.dispatchEvent(
          new CustomEvent('saimetric_local_inventory_is_newer', { detail: existing })
        );
      }
      return false;
    }
    ```
  - An older snapshot from the Local Hub or peer can **never** downgrade a newer local price.
- **Timestamp Preservation**:
  - `savedItem` now preserves the incoming record's canonical `lastUpdated: item.lastUpdated || new Date().toISOString()`.
- **Branch Scope Preservation**:
  - In `backfillCompanyBranch()`, items with `branch_id === 'ALL'` keep `'ALL'` for `STORAGE_KEYS.INVENTORY_ITEMS`.

### B. Mesh Synchronization Relay (`src/services/meshSyncService.ts`)
- **Catalog Packets Flushed on Connect**:
  - In `drainQueueToLocalHub()`, added `isCatalog` check so packets with `target_branch_id: 'ALL'`, `branchId: 'ALL'`, or catalog types are never paused and always flush to the Local Hub.
- **Persistent Outbox Queue**:
  - Backed `pendingLocalHubQueue` with `localStorage` (`saimetric_pending_local_hub_queue`) so pending updates survive page refreshes and device restarts.
- **Reverse-Sync & Hub Catchup**:
  - Added listener for `'saimetric_local_inventory_is_newer'`. If the Hub sends a stale item, the device immediately broadcasts its newer local record back to the Hub.
  - In `drainQueueToLocalHub()`, added Step 4: automatically reconciles recently modified local catalog items (last 48 hours) with the Local Hub store upon connecting.

### C. Standalone Termux Local Hub (`termux-hub.js` & `public/termux-hub.js`)
- **Last-Write-Wins on Hub Store**:
  - Added timestamp comparison in `isInventory`: if `existingTime > incomingTime`, the older update is ignored and logged.
  - Ensures the highest timestamp price change (e.g. $5) always wins and persists on disk.

## 4. Verification
- `tsc --noEmit` (`lint_applet`): Passed with 0 errors.
- `npm run build` (`compile_applet`): Passed with 0 errors.
