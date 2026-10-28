# Implementation Plan: Data Isolation & Hub Identity Architecture

## Overview
This plan specifies the architecture to prevent cross-branch data contamination and enable secure hardware repurposing of Termux Local Hubs across different branches and tenants.

It resolves three core vulnerabilities:
1. **Unidentified Hub Connections (Blind Ingestion)**: Devices syncing data before knowing what branch or tenant the physical Hub represents.
2. **Roaming Owner Cross-Contamination**: A user transacting at Branch A, walking into Branch B's local hotspot, and dumping Branch A's offline sales and inventory adjustments into Branch B's Local Hub.
3. **Hardware Lock-in**: Inability to safely wipe and repurpose an Android phone running Termux Hub when moving it to a new branch or tenant.

---

## Architecture & Data Flow

```
+-----------------------------------------------------------------------------------------+
|                                    CLIENT DEVICE                                         |
+-----------------------------------------------------------------------------------------+
| 1. WebSocket Open                                                                        |
|    └─► Send {"type": "PING_HUB"} (Pre-Auth Lobby Handshake)                             |
|                                                                                         |
| 2. Receive {"type": "HUB_INFO", "branch_id": "BR-HARARE", "branch_name": "Harare Main"}|
|    ├─► Save hub_branch_id & hub_branch_name locally                                      |
|    └─► Render Hub Identity on LoginScreen & Local Hub Settings                          |
|                                                                                         |
| 3. Auth & Roaming Detection:                                                            |
|    ├─► User logs in with user.branch_id                                                 |
|    ├─► IF user.branch_id === hub_branch_id:                                             |
|    │     └─► Standard Local Hub Mode (Bi-directional Local Master-Spoke sync enabled)    |
|    └─► IF user.branch_id !== hub_branch_id:                                             |
|          └─► "Cloud-Only Mode" Activated:                                               |
|                • Local Hub sync BLOCKED (No sales/stock/cash sent to Local Hub)         |
|                • Offline queue pushed directly to Cloud (Supabase/Sheets) in background |
|                                                                                         |
| 4. Outgoing Queue Filter:                                                                |
|    ├─► For each queued item (sale, GRV, price change, movement):                        |
|    │     ├─► item.target_branch_id === hub_branch_id ──► Flush to Local Hub WebSocket    |
|    │     └─► item.target_branch_id !== hub_branch_id ──► Retain paused / push to Cloud  |
|                                                                                         |
| 5. Reset Hub Identity Workflow:                                                          |
|    └─► Admin Settings > "Reset Hub Identity" ──► Send {"type": "RESET_BRANCH"}          |
|          └─► Hub wipes local storage & resets state ──► Return to "Scan to Connect"     |
+-----------------------------------------------------------------------------------------+
```

---

## Proposed Changes & Step-by-Step Implementation

### Component 1: `termux-hub.js` (Standalone Termux Hub Engine)
- **Persistent Branch Identity**:
  - Add `hubBranchId` and `hubBranchName` to `termux-hub-data.json` and CLI args (`--branch-id`, `--branch-name`).
  - If unassigned, auto-assign identity from first authorized branch payload or default config.
- **Handshake Response (`PING_HUB`)**:
  - Listen for `{ "type": "PING_HUB" }` packet.
  - Reply immediately to the requesting socket with:
    ```json
    {
      "type": "HUB_INFO",
      "action": "HUB_INFO",
      "branch_id": hubBranchId,
      "branch_name": hubBranchName,
      "tenant_id": hubTenantId,
      "version": "3.1.0",
      "totalRecords": salesStore.length + directGrvsStore.length
    }
    ```
- **Reset Branch Handling (`RESET_BRANCH`)**:
  - Listen for `{ "type": "RESET_BRANCH" }` packet.
  - Wipe all in-memory collections (`salesStore`, `inventoryStore`, `directGrvsStore`, `cashMovementsStore`, `cashLiftsStore`, etc.).
  - Clear `hubBranchId`, `hubBranchName`, and delete or rewrite `termux-hub-data.json` to an unassigned blank template.
  - Send `{ "type": "RESET_CONFIRMED", "status": "WIPED" }` back to caller.
  - Log audit entry: `[Termux Hub] Hardware wiped & unassigned by manager command.`

---

### Component 2: `src/utils/localHubConfig.ts` & Local Storage
- Add storage keys:
  - `saimetric_hub_branch_id`: Currently tethered Local Hub branch ID.
  - `saimetric_hub_branch_name`: Name of the tethered branch (e.g., "Harare Main").
  - `saimetric_hub_tenant_id`: Tethered tenant ID.
- Add helper methods to `LocalHubConfig`:
  - `getHubBranchId(): string | null`
  - `getHubBranchName(): string | null`
  - `setHubBranchIdentity(branchId: string, branchName: string, tenantId?: string): void`
  - `clearHubBranchIdentity(): void`
  - `isCloudOnlyMode(): boolean`

---

### Component 3: `src/services/meshSyncService.ts`
- **Pre-Auth Lobby Handshake**:
  - In `connectLocalHub()`, upon `ws.onopen`:
    - Immediately send `ws.send(JSON.stringify({ type: 'PING_HUB', timestamp: Date.now() }))`.
    - Do **NOT** drain queues yet! Wait for `HUB_INFO` handshake to complete.
- **Handling `HUB_INFO`**:
  - When a `HUB_INFO` packet is received:
    - Save `hub_branch_id` and `hub_branch_name` via `LocalHubConfig.setHubBranchIdentity()`.
    - Compare `hub_branch_id` with active `user.branch_id` or current branch.
    - If user is logged in and `user.branch_id !== hub_branch_id`:
      - Set `isCloudOnlyMode = true`.
      - Broadcast mode change `CLOUD_ONLY`.
      - Block flushing sales to this Hub.
    - If `user.branch_id === hub_branch_id` (or device is in pre-auth lobby):
      - Set `isCloudOnlyMode = false`.
      - Trigger filtered `drainQueueToLocalHub()`.
      - Trigger catch-up sync strictly scoped to `hub_branch_id`.
    - Broadcast DOM event `saimetric_hub_identity_updated`.
- **Handling `RESET_BRANCH` and `RESET_CONFIRMED`**:
  - Add public method `resetHubIdentity()`:
    - Sends `{ type: 'RESET_BRANCH', deviceId: this.config.deviceId, timestamp: Date.now() }` over `localHubWs`.
    - Clears local storage `LocalHubConfig.clearHubBranchIdentity()`.
    - Resets connection state and notifies subscribers to return UI to "Scan to Connect".
- **Branch-Scoped Queue Filtering (The Roaming Owner Fix)**:
  - In `drainQueueToLocalHub()`:
    - Only flush packets and offline records where:
      ```typescript
      const targetBranchId = packet.target_branch_id || packet.branchId || packet.branch_id || sale.branchId || sale.branch_id;
      if (targetBranchId !== hubBranchId) {
        // KEEP PAUSED in local queue for Local Hub!
        // Schedule background push to Cloud (Supabase/Sheets) instead.
        this.attemptDirectCloudPush(item);
        return;
      }
      ```
  - In `sendPacketToAllTransports()`:
    - Before transmitting to `targetWs` (Local Hub), check:
      - If `this.isCloudOnlyMode`: Drop transmission to Local Hub; route only to Cloud/MQTT.
      - If `packet.target_branch_id && packet.target_branch_id !== hubBranchId`: Do not send to Local Hub; route to Cloud.
- **Direct Cloud Push Fallback**:
  - Offline items tagged for a different branch are enqueued in `persistentSyncEngine` to push directly to Supabase/Sheets whenever internet or Cloud mesh is detected, ensuring data reaches the central cloud without touching the foreign Local Hub.

---

### Component 4: `src/db/roomDatabase.ts`
- In `enqueueSync()`:
  - Ensure every offline mutation includes explicit `target_branch_id: currentBranch`.
- In `isRecordInBranchScope()`:
  - Reinforce branch isolation checks so foreign branch records are never surfaced in the active till views.

---

### Component 5: `src/components/auth/LoginScreen.tsx`
- **Pre-Auth Lobby Hub Display**:
  - Listen for `saimetric_hub_identity_updated` and `LocalHubConfig.subscribe()`.
  - In the top header / branding section:
    - If connected to a Local Hub with branch identity:
      - Render an elevated badge:
        `🟢 Connected to [Harare Main] Hub (BR-HARARE)`
        with a subtext: `"Offline Master Hub Ready • Zero Data Contamination"`.
    - If connected but awaiting identity handshake:
      - Render: `🔵 Connecting to Local Hub...`
    - If disconnected:
      - Render: `🟡 Standalone Offline Mode (Queueing)`
- **Cloud-Only Mode Warning on Staff / Owner Selection**:
  - If a staff member or owner selects or logs into a branch that differs from the connected Hub's branch:
    - Display an amber banner:
      `⚠️ Cloud-Only Mode Active: You are logging into [Bulawayo Branch], but physical device is connected to [Harare Main] Hub. Local Hub syncing is paused to prevent cross-branch contamination.`
    - Automatically configure session mode to `CLOUD_ONLY`.

---

### Component 6: `src/components/sync/LocalHubSettingsModal.tsx`
- **Tethered Hub Identity Section**:
  - Show the current Hub's assigned branch ID and name.
- **"Reset Hub Identity" Button**:
  - Place a danger-style button under Local Hub Settings:
    - Label: `"Reset Hub Identity"` with `AlertTriangle` icon.
  - On click, open confirmation modal:
    - Title: `"Reset Local Hub Identity?"`
    - Warning: `"This will wipe the Local Hub's memory and allow it to be reassigned to a new branch. Only do this if you are moving the Hub hardware."`
    - Action buttons: `"Cancel"` and `"Yes, Wipe & Reset Hub"`.
  - On confirm:
    - Call `meshSyncService.resetHubIdentity()`.
    - Show success toast: `"Hub reset command sent. Memory cleared. Re-scan to connect to a new branch."`
    - Return modal tab to "Connect to Hub" in pristine scan state.

---

## Verification Plan

### Automated / Syntax Verification
- Run `compile_applet` to verify TypeScript builds cleanly with zero type errors.

### Manual / Integration Verification Steps
1. **Pre-Auth Handshake**:
   - Start app and connect to Local Hub.
   - Verify `PING_HUB` packet is dispatched immediately upon WebSocket `open`.
   - Verify `HUB_INFO` response is processed and stored in `localStorage`.
   - Verify Login Screen displays `Connected to [Branch Name] Hub`.
2. **Roaming Owner Data Isolation**:
   - Create offline sales under Branch "BR-HARARE".
   - Switch active branch or connect to Hub with branch "BR-BULAWAYO".
   - Verify Branch "BR-HARARE" sales remain paused in the queue and are **never** transmitted to the Bulawayo Hub.
   - Verify logged-in user with mismatched branch is flagged in `Cloud-Only Mode`.
3. **Reset Hub Identity**:
   - Open Admin Settings > Local Hub Settings.
   - Click "Reset Hub Identity", verify confirmation warning.
   - Confirm reset, verify `RESET_BRANCH` packet is sent to Hub.
   - Verify local memory is cleared and state returns to "Scan to Connect".
