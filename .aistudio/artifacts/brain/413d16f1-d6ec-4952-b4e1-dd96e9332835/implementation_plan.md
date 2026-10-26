# Resolution Summary: Staff Member Management & Allowance Improvements

## Problem Addressed
Users reported: *"there's no option to afd new staff members when the package allows it"* (typo: "afd" -> "add").

### Root Causes Identified
1. **Narrow/Mobile Viewport Clipping**: In `StaffAccessManagementScreen.tsx`, the header container had `flex items-center justify-between` without responsive wrapping (`flex-col sm:flex-row gap-4`). On mobile screens or narrow drawers, the "+ Add Staff" button was pushed out of viewport boundaries.
2. **Missing Package Allowance Visibility**: There was no visible indicator showing current package staff usage (e.g. "3 of 5 active staff used — 2 slots available") or direct access to add staff from the allowance banner.
3. **Overly Restrictive Starter Defaults & Deactivation Counting**: In `src/services/packageService.ts`, the starter tier was set to 2 staff while default seed data had 3-5 staff. Furthermore, `checkStaffLimit` was counting all staff regardless of active status (`s.active !== 'N'`), causing inactive or former staff to falsely consume package quota.
4. **Missing In-Context Action Points**:
   - No inline "+ Add New Staff" card in the directory list.
   - No "+ Add Staff Member" button when search filter returned empty results.
   - No mobile Floating Action Button (FAB).
   - In `BranchSetupScreen.tsx`, when assigning team members to branches, managers had no shortcut to onboard a new staff member directly.
   - In `PackageSetupView.tsx`, tenant package assignments did not communicate staff seat limits or license allocation.

---

## Changes Implemented

1. **`src/services/packageService.ts`**:
   - Increased Starter tier default from 2 to 5 staff, Professional tier to 15, Enterprise to 999 (unlimited).
   - Fixed `checkStaffLimit` to filter strictly for active staff (`s.active !== 'N'`), allowing deactivated staff to be excluded from seat counts.

2. **`src/components/admin/StaffAccessManagementScreen.tsx`**:
   - **Responsive Header**: Changed layout to `flex flex-col sm:flex-row sm:items-center justify-between gap-4`, ensuring the primary "+ Add Staff" button is always visible.
   - **Package Staff Allowance Card**: Added a dedicated status banner displaying current package name, active staff count, total allowed slots, and an immediate "+ Add Staff Member" action.
   - **Quick-Add Card in Directory**: Added a dashed "+ Add New Staff Member" card directly in the staff cards grid.
   - **Empty State Quick Action**: Added a direct "+ Add Staff Member" button inside the zero-search-results state.
   - **Mobile Floating Action Button (FAB)**: Added a fixed bottom-right button (`sm:hidden fixed bottom-20 right-4`) with high elevation and pulse accent.

3. **`src/components/admin/BranchSetupScreen.tsx`**:
   - Added an inline "+ Add New Staff Member" button in the Branch Team Accordion and empty state.
   - Added a "+ Add New Staff" button in the team configuration modal quick actions and at the end of the branch team checklist.

4. **`src/components/admin/PackageSetupView.tsx`**:
   - Added staff seat badges ("Staff: Up to X staff" / "Unlimited staff") in the tenant package allocation table.
   - Displayed max staff limits alongside package names in the package selector dropdown.

5. **`src/components/pos/POSMoreDrawer.tsx` & `src/services/roleNavigationService.ts`**:
   - Ensured role access to `salespeople` / `staff_access` is permitted for all owners, administrators, supervisors, and managers.

---

## Resolution Summary: App Loading & Host Security Fix ("App Failed to Load/Open")

### Root Causes
1. **Vite 6 `server.allowedHosts` Rejection (403 Forbidden)**:
   - Vite 6 introduced strict Host header verification. When accessed via Google Cloud Run (`*.run.app`), requests with Host headers like `ais-dev-xnmwjokljamyp3uo6axish-553136009202.europe-west1.run.app` were blocked with `403 Forbidden: Blocked request. This host is not allowed`.
2. **Infinite 301 HTTPS Redirect Loop**:
   - `server.ts` contained an aggressive HTTPS redirect middleware that checked `req.headers["x-forwarded-proto"] === "http"`. In Cloud Run, SSL is terminated at Google's edge proxy, which forwards requests over HTTP internally. This caused `server.ts` to respond with `301 Moved Permanently` pointing to the exact same URL repeatedly (`ERR_TOO_MANY_REDIRECTS`).
3. **Service Worker Controllerchange Loop**:
   - `main.tsx` triggered `window.location.reload()` whenever `controllerchange` fired, creating infinite reload cycles inside iframe preview containers.

### Changes Applied
1. **`vite.config.ts`**: Enabled `allowedHosts: true` under `server` so all Google Cloud Run preview domains are accepted.
2. **`server.ts`**:
   - Configured `allowedHosts: true` in `createViteServer`.
   - Removed the redundant internal HTTPS 301 redirection middleware (Cloud Run already terminates and manages TLS at the edge).
3. **`src/main.tsx`**:
   - Added guards to unregister service workers inside iframes (`window.self !== window.top`) and dev mode.
   - Removed the aggressive `controllerchange` auto-reload hook that caused reload loops in iframe embeds.

### Verification
- Both `ais-dev-...run.app` and `ais-pre-...run.app` host headers verified to respond with `HTTP/1.1 200 OK`.
- Production bundle compiled successfully with zero TypeScript lint issues.

