# Implementation Plan: Real-Time Cross-Device Inventory Management & Price Synchronization

## 1. Problem Statement
The user reported:
> "in terms of inventory management when i change prices it won't reflect in the other device. When i add a new product it only shows in the next device after i have sold it."

## 2. Root Cause Analysis
1. **`branchOverrides` Shadowing Prices**:
   - `getProducts()`, `getInventoryItems()`, and `inventoryItemToProduct()` calculate retail and cost prices by checking `override = item.branchOverrides?.[currentBranch]`.
   - When an item had overrides, `override.sellPriceUnit` took precedence over `item.sellPriceUnit`.
   - When prices were broadcast across the mesh, `ingestMeshInventoryItem()` did not update `branchOverrides`. As a result, the peer device retained old branch overrides that shadowed incoming price edits.
2. **Branch Isolation Dropping Shared Company Catalog Items**:
   - `getAllInventoryItems()` and `getInventoryItems()` strictly filtered items using `isRecordInBranchScope(item.branch_id, currentBranch)`.
   - When a product was created on Device A, its `branch_id` was stamped with Device A's branch. On Device B (different branch), `isRecordInBranchScope` evaluated to `false`, hiding newly added products until an initial sale created a branch-specific entry on Device B.
3. **`getAllInventoryItems()` Overwriting Raw Storage**:
   - `ingestMeshInventoryItem()` called `getAllInventoryItems()` (which returns a filtered subset for the active branch) and wrote it back with `setStored(STORAGE_KEYS.INVENTORY_ITEMS, allItems)`, stripping other branch items and corrupting unassigned company products.
4. **Clock Skew / Timestamp Drops on Offline Android Devices**:
   - `ingestMeshInventoryItem()` previously had a strict `existingTime > incomingTime` drop that discarded legitimate price changes and product updates if the receiving phone's clock was slightly ahead of the sender.
5. **Transport-Level Branch Mismatch Dropping Catalog Packets**:
   - `broadcastInventoryItem()` did not specify `target_branch_id: 'ALL'`. Packets were dropped at `sendPacketToAllTransports` and `handleIncomingMeshPacket` if terminals were on different branches.
6. **Local Hub Catch-Up Branch Filtering**:
   - In `termux-hub.js` and `public/termux-hub.js`, `missedInventory = inventoryStore.filter((i) => isMatch(i, reqComp, reqBranch) ...)` filtered inventory by `reqBranch`, preventing peer devices on other branches from catching up on newly added company products.
7. **POS Register UI Event Listener Gap**:
   - `POSRegister.tsx` only subscribed to `subscribeToDatabase()`. It did not listen for `saimetric_inventory_updated`, `saimetric_products_updated`, or `mesh-inventory-received`, resulting in delayed re-renders.

## 3. Implemented Fixes

### A. Room Database Engine (`src/db/roomDatabase.ts`)
- **Shared Company Catalog Scope**:
  - In `getAllInventoryItems()` and `getInventoryItems()`, items without explicit `assignedBranchIds` are now correctly treated as company-wide catalog items available to all branches of that company.
- **Robust Ingestion in `ingestMeshInventoryItem()`**:
  - Replaced `getAllInventoryItems()` with `getRawStoredInventoryItems()` so full storage is preserved.
  - Price and name modifications are detected directly (`priceChanged`, `nameChanged`). Clocks drifting on peer Android devices will never drop price updates or product creations.
  - All branch keys in `branchOverrides` are synchronized with the incoming unit and case prices, ensuring stale overrides never shadow new prices.
  - `STORAGE_KEYS.PRODUCTS` is immediately updated from the deduplicated inventory list.
  - Fires `saimetric_inventory_updated`, `saimetric_products_updated`, and `mesh-inventory-received` window events.
- **Clean Ingestion in `ingestMeshInventoryDelete()`**:
  - Replaced `getAllInventoryItems()` with `getRawStoredInventoryItems()`.

### B. Mesh Synchronization Relay (`src/services/meshSyncService.ts`)
- **Target All Branches for Catalog**:
  - `broadcastInventoryItem()` now stamps `target_branch_id: 'ALL'` and `branchId: item.branch_id || 'ALL'`.
- **Exempt Catalog Packets from Branch Drops**:
  - `sendPacketToAllTransports()` and `handleIncomingMeshPacket()` exempt `inventory` and `product` topics from branch mismatch drops.
- **Instant Local Hub & P2P Ingestion**:
  - Dispatches `saimetric_inventory_updated`, `saimetric_products_updated`, and `mesh-inventory-received`.
  - Invokes `this.scheduleBatchUiUpdate()` and `this.notifyPeerSubscribers()`.
- **Catchup Replay**:
  - Dispatches `saimetric_products_updated` alongside `saimetric_inventory_updated`.

### C. POS Register UI (`src/components/pos/POSRegister.tsx`)
- Added real-time window event listeners for:
  - `saimetric_inventory_updated`
  - `saimetric_products_updated`
  - `mesh-inventory-received`
  - `mesh-catchup-completed`
  - `saimetric_customers_updated`
- POS catalog now reloads instantly on the counter without requiring page reloads or an initial sale.

### D. Inventory Master UI (`src/components/inventory/InventoryMasterView.tsx`)
- Added listeners for `mesh-inventory-received`, `mesh-catchup-completed`, and `saimetric_products_updated`.

### E. Termux Hub (`termux-hub.js` & `public/termux-hub.js`)
- Updated `isMatch(rec, reqComp, reqBranch, isCatalog = false)` to support catalog matching across all branches in a company.
- In catchup requests, `missedInventory` matches company-wide products so waking/reconnecting devices receive all product additions and price changes.
- Stamped `updatedAt` on all incoming inventory items to guarantee they qualify for catchup replaying.

## 4. Verification
- `tsc --noEmit` (`lint_applet`): Passed with 0 errors.
- `npm run build` (`compile_applet`): Passed with 0 errors.
