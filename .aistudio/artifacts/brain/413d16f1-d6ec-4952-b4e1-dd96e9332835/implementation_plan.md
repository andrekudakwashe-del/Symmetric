# Implementation Plan: Local WebSocket Hub Blind Double-Count Stocktake Protocol & Performance Fixes (v2.0)

## 1. Executive Summary & Operational Workflows

This updated plan incorporates the 5 critical operational workflows requested:
1. **Universal Lockdown & Self-Service Zone Claiming**: Any user who logs in during a lockdown is blocked from POS and guided directly to the Stocktake Dashboard, where they claim available zones as Team A or Team B.
2. **Casual PIN Sync via Local Hub**: Temporary casual accounts are broadcasted across the local Wi-Fi so any tablet can authenticate workers with their 4-digit PIN.
3. **True Blind Counting (Hub Secret Vault)**: Local Hub stores Team A count secretly in memory and suppresses peer broadcast until Team B submits; then automated server comparison fires verified or variance packets.
4. **The Joint Recount (Dual-Signature, No Manager Bottleneck)**: When variances occur, Team A and Team B walk to the shelf together. Either team enters the Joint Verified Count, but both Team A and Team B must tap 'Confirm' on their respective devices before the count finalizes.
5. **Performance, CCTV Limit & Termux CommonJS Discipline**: Complete preservation of CCTV 2GB storage, 30-day disk rotation, Branch Handshake (`PING_HUB`, `HANDSHAKE`, `RESET_BRANCH`), CommonJS `require()` syntax in `termux-hub.js`, O(1) Map indexing for Form 2, and `useDeferredValue` for inventory search.

---

## 2. Pillar 1: Universal Lockdown & Self-Service Zone Claiming

### Flow & Router Behavior:
- When `isBranchInLockdown === true`:
  - Upon login (or if already logged in), any user role (`Owner`, `Admin`, `Manager`, `Cashier`, `Casual`) is blocked from POS checkout.
  - Active POS views render an inescapable lockdown shield with an auto-redirect button: **"Stocktake In Progress — Proceed to Count Dashboard"**.
  - Direct URL navigation or menu switches to POS automatically redirect to `StocktakeHubScreen`.
- **The Self-Service Zone Grid**:
  - The dashboard displays a live, color-coded grid of all zones for the active session:
    - **AVAILABLE (Gray)**: Neither team has claimed. Shows button: `[Claim Zone as Team A]`.
    - **IN PROGRESS - TEAM A (Blue)**: Team A is actively on the floor counting. Shows button: `[Claim Double-Count as Team B]`.
    - **AWAITING DOUBLE-COUNT (Orange)**: Team A has submitted to the Hub Secret Vault. Waiting for Team B to claim and count. Shows button: `[Claim & Start Count as Team B]`.
    - **VARIANCE - JOINT RECOUNT (Red)**: Both submitted, quantities differ. Shows button: `[Open Joint Recount Sheet]`.
    - **VERIFIED (Green)**: 100% matched and finalized. Locked.
- **Hub Zone Locking**:
  - When User 1 taps `Claim Zone as Team A`, the app dispatches `STOCKTAKE_ZONE_CLAIM`:
    ```json
    {
      "type": "STOCKTAKE_ZONE_CLAIM",
      "sessionId": "STK-20261030-001",
      "zoneId": "ZONE-04",
      "slot": "A",
      "deviceId": "DEV-TAB-01",
      "staffId": "CAS-102",
      "staffName": "Tapelo (Casual)",
      "timestamp": "2026-10-30T11:20:00Z"
    }
    ```
  - The Hub assigns the slot and broadcasts `STOCKTAKE_ZONE_CLAIMED` to all tablets. The zone immediately displays as locked for Slot A, preventing collision.

---

## 3. Pillar 2: Casual PIN Sync via Local Hub

### Operational Workflow:
1. **Manager Creation**:
   - Manager opens the **Casual Workers** tab in the Stocktake Hub on their tablet.
   - Enters worker name, phone number, and a 4-digit PIN (e.g. `4821`).
   - Taps `Save & Sync to Hub`.
2. **WebSocket Hub Distribution**:
   - The device dispatches `CASUAL_WORKERS_SYNC` packet containing the updated list of active temporary casuals.
   - `termux-hub.js` caches `casualWorkersStore` and persists to `termux-hub-data.json`.
   - The Hub broadcasts `CASUAL_WORKERS_SYNC` to every connected tablet on the LAN.
3. **Any-Device Fast Authentication**:
   - Any worker walks to any tablet, selects **"Casual Worker Quick Login"**, and types `4821`.
   - The local tablet authenticates against the synced casual database and lands straight on the **Zone Grid**.
   - No access is granted to POS, Reports, Master Settings, or Cash Balances.

---

## 4. Pillar 3: True Blind Counting (The Hub Secret Vault)

### The Anti-Leak Protocol in `termux-hub.js`:
1. **Hub Secret Store Structure**:
   ```javascript
   // In-memory Hub Blind Store
   const hubBlindStore = {
     // [sessionId]: { [zoneId]: { A: null, B: null } }
   };
   ```
2. **When Team A Submits Count**:
   - Counter A taps `Submit Count to Hub` on their device.
   - Sends `STOCKTAKE_COUNT_SUBMIT`:
     ```json
     {
       "type": "STOCKTAKE_COUNT_SUBMIT",
       "sessionId": "STK-20261030-001",
       "zoneId": "ZONE-04",
       "slot": "A",
       "deviceId": "DEV-TAB-01",
       "staffId": "CAS-102",
       "staffName": "Tapelo",
       "lines": [
         { "itemId": "OIL001", "cases": 10, "singles": 4, "totalUnits": 124 },
         { "itemId": "SUG001", "cases": 5, "singles": 0, "totalUnits": 50 }
       ]
     }
     ```
   - **CRITICAL**: The Hub intercepts this message, stores it in `hubBlindStore[sessionId][zoneId].A`, and **SUPPRESSES BROADCAST** to all other peers. Team B never receives any packet with Team A's numbers.
   - Hub replies point-to-point only to Team A socket with `STOCKTAKE_ACK_SUBMIT`:
     ```json
     {
       "type": "STOCKTAKE_ACK_SUBMIT",
       "zoneId": "ZONE-04",
       "slot": "A",
       "status": "AWAITING_COUNTER_B",
       "message": "Count secured in Hub Vault. Awaiting Team B submission."
     }
     ```
   - Hub broadcasts a generic status packet `STOCKTAKE_ZONE_STATUS_UPDATE` (without line counts) so the dashboard flips the zone to `AWAITING DOUBLE-COUNT`.
3. **When Team B Submits Count**:
   - Counter B completes counting and submits `STOCKTAKE_COUNT_SUBMIT` with `slot: "B"`.
   - Hub stores in `hubBlindStore[sessionId][zoneId].B`.
   - Hub immediately triggers server-side line-by-line comparison:
     - **Match Case (100% agreement)**:
       - Hub creates consolidated verified list.
       - Broadcasts `STOCKTAKE_MATCH_VERIFIED` to all devices.
       - Zone turns bright green (`VERIFIED`).
     - **Variance Case (Discrepancy detected)**:
       - Hub compares lines and isolates only the mismatched item IDs.
       - Broadcasts `STOCKTAKE_VARIANCE_ALERT`:
         ```json
         {
           "type": "STOCKTAKE_VARIANCE_ALERT",
           "sessionId": "STK-20261030-001",
           "zoneId": "ZONE-04",
           "discrepancies": [
             {
               "itemId": "OIL001",
               "itemName": "Pure Drop Cooking Oil 2L",
               "teamACases": 10,
               "teamASingles": 4,
               "teamATotalUnits": 124,
               "teamBCases": 9,
               "teamBSingles": 11,
               "teamBTotalUnits": 119,
               "differenceUnits": 5
             }
           ]
         }
         ```

---

## 5. Pillar 4: The Joint Recount (Peer Dual-Signature, No Manager Bottleneck)

### Operational Flow (Field Recount):
1. **Triggering the Variance Resolution Sheet**:
   - When `STOCKTAKE_VARIANCE_ALERT` is received, the zone status becomes `VARIANCE_FLAGGED`.
   - Tapping the zone on **both Team A's and Team B's devices** opens the **Joint Variance Resolution Sheet**.
   - The sheet displays only the items that differed:
     - Item Name: *Pure Drop Cooking Oil 2L*
     - Team A Count: *10 Cases, 4 Singles (124 units)*
     - Team B Count: *9 Cases, 11 Singles (119 units)*
     - Input Box: `[Joint Verified Count: Cases & Singles]`
2. **Floor Verification**:
   - Team A and Team B walk to the shelf together and recount the disputed shelf boxes physically.
   - Either worker types the agreed number (e.g., *10 Cases, 2 Singles*).
3. **Anti-Fraud Peer Dual-Signature**:
   - As worker A enters the count, they tap `[Team A Sign & Agree]`.
   - The app broadcasts `STOCKTAKE_JOINT_PROPOSAL` over the Hub:
     ```json
     {
       "type": "STOCKTAKE_JOINT_PROPOSAL",
       "zoneId": "ZONE-04",
       "proposedBySlot": "A",
       "proposedByName": "Tapelo",
       "recountLines": [
         { "itemId": "OIL001", "cases": 10, "singles": 2, "totalUnits": 122 }
       ]
     }
     ```
   - On Team B's screen, the proposed figures appear with a pulsing prompt:
     **"Team A has proposed 10 Cases, 2 Singles for Pure Drop Cooking Oil 2L. Tap Confirm to sign and finalize."**
   - Team B inspects the physical shelf and taps `[Team B Confirm & Sign]`.
   - Once both signatures are recorded, the device sends `STOCKTAKE_JOINT_FINALIZED` to the Hub.
   - The Hub updates the permanent database with `count1`, `count2`, and `joint_verified_count`, logs the audit trail, and broadcasts `STOCKTAKE_MATCH_VERIFIED`.
   - The zone turns green. No manager intervention was needed.

---

## 6. Pillar 5: Performance, Data Integrity & Termux CommonJS Discipline

### A. Termux CommonJS Syntax Requirement:
`termux-hub.js` runs on Node.js in Termux. To prevent crashes:
- **MUST** use CommonJS `require()` syntax:
  ```javascript
  const { WebSocketServer, WebSocket } = require('ws');
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  ```
- **NO** ES module `import` / `export` statements in `termux-hub.js`.

### B. CCTV Storage & Disk Rotation Preservation:
- Keep the existing 2GB safety limit for media/CCTV attachments in `termux-hub.js`.
- Keep 30-day disk rotation logic for archiving old data payload slices.

### C. Branch Handshake & Identity Preservation:
- Preserve `PING_HUB`, `HUB_INFO`, `HANDSHAKE`, `SET_BRANCH`, and `RESET_BRANCH` packet routines.
- Strictly maintain branch isolation (`target_branch_id === hub_branch_id`).

### D. Performance Solutions:
1. **Form 2 Cash Log Slow Opening**:
   - Convert `directGrvs` scanning from `.find()` inside loops to a `Map<string, DirectGrv>` index for O(1) instant access.
   - Batch and debounce mount subscriptions so window event listeners don't cause 5 back-to-back re-renders.
   - Evaluate expense modals and lift vouchers lazily only on open.
2. **Search Keystroke Lag in POS Cart & Inventory Master**:
   - Wrap filtering in React 18 `useDeferredValue(searchQuery)`. The text field updates instantaneously at 60fps, while catalog sorting and rendering run with deferred priority.
   - Cache normalized inventory items so `normalizeInventoryItem()` is not executed on thousands of items on every single key stroke.
   - Add a 100ms debounce to the search filter pipeline.

---

## 7. Database Schema Additions (`src/types.ts` & `src/db/roomDatabase.ts`)

```typescript
export interface StocktakeZoneAssignment {
  zoneId: string;
  zoneName: string;
  sessionId: string;
  branchId: string;
  status: 'AVAILABLE' | 'IN_PROGRESS' | 'AWAITING_DOUBLE_COUNT' | 'VARIANCE_FLAGGED' | 'VERIFIED';
  teamA?: {
    deviceId: string;
    staffId: string;
    staffName: string;
    claimedAt: string;
    submitted: boolean;
    submittedAt?: string;
  };
  teamB?: {
    deviceId: string;
    staffId: string;
    staffName: string;
    claimedAt: string;
    submitted: boolean;
    submittedAt?: string;
  };
  jointRecount?: {
    proposedBy?: 'A' | 'B';
    proposedByName?: string;
    signedByA: boolean;
    signedByB: boolean;
    resolvedAt?: string;
    lines: StocktakeLineCount[];
  };
  count1?: StocktakeLineCount[];
  count2?: StocktakeLineCount[];
  verifiedCounts?: StocktakeVerifiedLine[];
  discrepancies?: StocktakeVarianceItem[];
}

export interface StocktakeVarianceItem {
  itemId: string;
  itemName: string;
  sku: string;
  unitsPerCase: number;
  teamACases: number;
  teamASingles: number;
  teamATotalUnits: number;
  teamBCases: number;
  teamBSingles: number;
  teamBTotalUnits: number;
  differenceUnits: number;
  jointCases?: number;
  jointSingles?: number;
  jointTotalUnits?: number;
}
```

---

## 8. Complete List of WebSocket Packets

| Packet | Direction | Description |
|---|---|---|
| `STOCKTAKE_LOCKDOWN_BROADCAST` | Manager/Hub -> All | Enforces or lifts branch-wide POS sale suspension. |
| `CASUAL_WORKERS_SYNC` | Manager/Hub -> All | Distributes 4-digit temporary casual PINs across LAN. |
| `STOCKTAKE_ZONE_CLAIM` | Device -> Hub | Claims Slot A or Slot B for a specific zone. |
| `STOCKTAKE_ZONE_CLAIMED` | Hub -> All | Notifies all tablets that a slot has been claimed. |
| `STOCKTAKE_COUNT_SUBMIT` | Device -> Hub ONLY | Blind count submission (never broadcasted to peers). |
| `STOCKTAKE_ACK_SUBMIT` | Hub -> Sender ONLY | Point-to-point ACK confirming count is safely vaulted. |
| `STOCKTAKE_ZONE_STATUS_UPDATE` | Hub -> All | Updates zone grid badge (e.g. Awaiting Double-Count) without leaking counts. |
| `STOCKTAKE_MATCH_VERIFIED` | Hub -> All | Notifies 100% agreement, marks zone green. |
| `STOCKTAKE_VARIANCE_ALERT` | Hub -> All | Notifies discrepancy, triggers Joint Recount Sheet on Team A & B. |
| `STOCKTAKE_JOINT_PROPOSAL` | Team A/B -> Hub & Peer | Proposes shelf recount numbers for peer confirmation. |
| `STOCKTAKE_JOINT_FINALIZED` | Devices -> Hub | Dual-signed confirmation finalizing verified counts. |

---

## 9. Step-by-Step File Modification Plan

1. **`termux-hub.js`**:
   - Rewrite with strict CommonJS `require()`.
   - Add `hubBlindStore` holding memory.
   - Implement blind suppression for `STOCKTAKE_COUNT_SUBMIT`.
   - Implement Hub automated line comparison engine.
   - Add handlers for `STOCKTAKE_ZONE_CLAIM`, `CASUAL_WORKERS_SYNC`, `STOCKTAKE_LOCKDOWN_BROADCAST`, and `STOCKTAKE_JOINT_FINALIZED`.
   - Preserve CCTV 2GB storage, 30-day rotation, and branch handshake.
2. **`src/types.ts` & `src/db/roomDatabase.ts`**:
   - Add `StocktakeZoneAssignment`, `StocktakeVarianceItem`, `HubBlindSubmission`.
   - Implement zone claim, blind count recording, dual-signature joint recount, and casual PIN sync functions.
   - Enforce branch lockdown router checks.
3. **`src/services/meshSyncService.ts`**:
   - Add packet dispatchers and listeners for all stocktake and lockdown packets.
4. **`src/components/stocktake/`**:
   - `StocktakeHubScreen.tsx`: Add Self-Service Zone Grid with live claiming, status badges, and Casual Quick-Login button.
   - `DoubleCountTerminal.tsx`: Implement blind submission mode with Local Hub ACK.
   - `JointRecountModal.tsx` / `SegmentRecountModal.tsx`: Implement peer Dual-Signature confirmation sheet.
   - `CasualWorkersTab.tsx`: Implement casual PIN creation with automatic Hub sync.
5. **`src/components/pos/POSRegister.tsx` & `POSCounterView.tsx`**:
   - Add lockdown shield auto-redirecting users to Stocktake Dashboard.
6. **Performance Optimization Edits**:
   - `src/components/forms/Form2CashLog.tsx`: Map-index GRV matching, debounce listeners, batch load.
   - `src/components/inventory/InventoryMasterView.tsx` & `src/components/pos/POSItemsView.tsx`: Integrate `useDeferredValue` and pre-cache normalized items.

---

## 10. Verification Checklist

1. **CommonJS Syntax**: Verify `node termux-hub.js` launches in Termux without module syntax errors.
2. **Lockdown Router**: Verify logging in as Cashier, Admin, or Casual during lockdown redirects immediately to Stocktake Zone Grid.
3. **Self-Service Claiming**: Verify Device 1 claims Team A -> Hub marks Slot A occupied on Device 2 in real time.
4. **Casual PIN Sync**: Create PIN `4821` on Manager device -> verify Device 2 authenticates `4821` and enters Count Terminal.
5. **True Blind Vault**: Submit from Device 1 -> verify zero count data appears on Device 2's network traffic or UI.
6. **Dual-Signature Recount**: Introduce mismatch -> verify Joint Recount Sheet opens on both devices and only finalizes when both tap Confirm.
7. **Performance Check**: Form 2 opens smoothly in <300ms, and search typing in POS and Inventory runs at 60fps without lag.
