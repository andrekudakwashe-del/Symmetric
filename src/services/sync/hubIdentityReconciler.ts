/**
 * Pure, testable Hub Identity & Branch/Tenant Reconciliation helpers.
 *
 * Enforces:
 *  1. `AUTH_OK.hubId` (verified via Mutual HMAC-SHA256 against `pairedHubs[hubId]`) is the
 *     single source of truth for Hub identity.
 *  2. Legacy/synthetic `HUB_INFO.hub_id` values formatted as `HUB-<branchId>` (e.g. `HUB-SAI-HQ-01`)
 *     are ignored whenever an authenticated or hardware Hub ID is already known.
 *  3. A `MUTUALLY AUTHENTICATED` Hub matching the active branch OR active tenant automatically
 *     reconciles `tetheredHubIdentity` and NEVER leaves the client in `CLOUD-ONLY MODE (HUB ISOLATED)`.
 */

const MAIN_BRANCH_ALIASES = new Set(['1', 'BR001', 'BR-MAIN', 'HQ-01', 'MAIN', 'SAI-HQ-01']);

export function canonicalizeBranchAlias(branchId?: string | null): string {
  const upper = String(branchId || '').trim().toUpperCase();
  if (!upper) return '';
  if (MAIN_BRANCH_ALIASES.has(upper)) return 'BR-MAIN';
  return upper;
}

/**
 * Returns true if `hubId` looks like a legacy/synthetic `HUB-<branchId>` identifier
 * (e.g. `HUB-SAI-HQ-01`, `HUB-BR-MAIN`, `HUB-HQ-01`, `HUB-VEN-01`) rather than a
 * hardware/cryptographic Hub ID (e.g. `HUB-92B1A869BBC5`).
 */
export function isSyntheticBranchHubId(
  hubId?: string | null,
  branchId?: string | null,
  branchCode?: string | null
): boolean {
  const cleanHub = String(hubId || '').trim().toUpperCase();
  if (!cleanHub) return false;

  // Genuine hardware/random hex Hub IDs (e.g. HUB-92B1A869BBC5) are NOT synthetic branch slugs
  if (/^HUB-[0-9A-F]{8,}$/.test(cleanHub)) {
    return false;
  }

  const normBranch = String(branchId || '').trim().toUpperCase();
  if (normBranch && (cleanHub === `HUB-${normBranch}` || cleanHub === `HUB_${normBranch}`)) {
    return true;
  }

  const normCode = String(branchCode || '').trim().toUpperCase();
  if (normCode && (cleanHub === `HUB-${normCode}` || cleanHub === `HUB_${normCode}`)) {
    return true;
  }

  // Known synthetic branch-prefixed Hub IDs produced by legacy HUB_INFO frames
  if (/^HUB-(?:SAI-|BR-|HQ-|VEN-|MAIN(?:$|-)|BRANCH[-_]|UNASSIGNED$)/.test(cleanHub)) {
    return true;
  }

  return false;
}

export interface ResolveHubIdParams {
  authenticatedHubId?: string | null;
  activeHubId?: string | null;
  incomingHubInfoId?: string | null;
  incomingBranchId?: string | null;
  activeBranchId?: string | null;
  activeBranchCode?: string | null;
  hasPairedProfileForAuthenticated: boolean;
}

/**
 * Resolves the authoritative `activeHubId` when a `HUB_INFO` packet arrives.
 * Never lets a legacy/synthetic `HUB_INFO.hub_id` overwrite a verified `AUTH_OK.hubId`.
 */
export function resolveAuthoritativeHubId(params: ResolveHubIdParams): string | null {
  const authId = String(params.authenticatedHubId || '').trim();
  if (authId && params.hasPairedProfileForAuthenticated) {
    return authId;
  }

  const currentId = String(params.activeHubId || '').trim();
  const incomingId = String(params.incomingHubInfoId || '').trim();
  if (!incomingId) {
    return authId || currentId || null;
  }

  const incomingIsSynthetic =
    isSyntheticBranchHubId(incomingId, params.incomingBranchId, params.activeBranchCode) ||
    isSyntheticBranchHubId(incomingId, params.activeBranchId, params.activeBranchCode);

  if (incomingIsSynthetic && (authId || (currentId && !isSyntheticBranchHubId(currentId)))) {
    return authId || currentId;
  }

  return incomingId;
}

export interface HubScopeMatchParams {
  hubBranchId?: string | null;
  hubTenantId?: string | null;
  activeBranchId?: string | null;
  activeBranchCode?: string | null;
  activeTenantId?: string | null;
  isMutuallyAuthenticated: boolean;
}

export function doesHubMatchActiveBranchOrTenant(params: HubScopeMatchParams): boolean {
  const rawHubBranch = String(params.hubBranchId || '').trim().toUpperCase();
  const rawActiveBranch = String(params.activeBranchId || '').trim().toUpperCase();
  const rawActiveCode = String(params.activeBranchCode || '').trim().toUpperCase();
  const hubTenant = String(params.hubTenantId || '').trim().toUpperCase();
  const activeTenant = String(params.activeTenantId || '').trim().toUpperCase();

  const hubBranchUnscoped = !rawHubBranch || rawHubBranch === 'UNASSIGNED' || rawHubBranch === 'ALL';
  const activeBranchUnscoped = !rawActiveBranch || rawActiveBranch === 'UNASSIGNED' || rawActiveBranch === 'ALL';

  const branchMatches =
    hubBranchUnscoped ||
    activeBranchUnscoped ||
    rawHubBranch === rawActiveBranch ||
    canonicalizeBranchAlias(rawHubBranch) === canonicalizeBranchAlias(rawActiveBranch) ||
    (Boolean(rawActiveCode) &&
      (rawHubBranch === rawActiveCode ||
        canonicalizeBranchAlias(rawHubBranch) === canonicalizeBranchAlias(rawActiveCode)));

  const tenantExplicitlyMatches = Boolean(hubTenant && activeTenant && hubTenant === activeTenant);
  const tenantExplicitlyMismatches = Boolean(hubTenant && activeTenant && hubTenant !== activeTenant);

  if (params.isMutuallyAuthenticated) {
    // Mutually authenticated Hub: match if branch matches OR tenant matches (unless tenant explicitly belongs to another company and branch also doesn't match)
    if (tenantExplicitlyMatches) return true;
    if (branchMatches && !tenantExplicitlyMismatches) return true;
    return false;
  }

  // Unauthenticated / legacy Hub: require strict branch match and no tenant conflict
  if (tenantExplicitlyMismatches) return false;
  return branchMatches;
}

export interface HubIdentityReconcileDecision {
  shouldIsolate: boolean;
  reconciledBranchId: string | null;
  reconciledBranchName: string | null;
  reconciledTenantId: string | null;
}

/**
 * Decides whether to isolate the Hub into Cloud-Only Mode or automatically reconcile
 * the stored `tetheredHubIdentity` on `AUTH_OK`, `PAIR_APPROVED`, or `HUB_INFO`.
 */
export function reconcileHubIdentityDecision(params: {
  hubBranchId?: string | null;
  hubBranchName?: string | null;
  hubTenantId?: string | null;
  activeBranchId?: string | null;
  activeBranchCode?: string | null;
  activeBranchName?: string | null;
  activeTenantId?: string | null;
  isMutuallyAuthenticated: boolean;
}): HubIdentityReconcileDecision {
  const matches = doesHubMatchActiveBranchOrTenant({
    hubBranchId: params.hubBranchId,
    hubTenantId: params.hubTenantId,
    activeBranchId: params.activeBranchId,
    activeBranchCode: params.activeBranchCode,
    activeTenantId: params.activeTenantId,
    isMutuallyAuthenticated: params.isMutuallyAuthenticated,
  });

  const cleanHubBranch = String(params.hubBranchId || '').trim();
  const cleanActiveBranch = String(params.activeBranchId || '').trim();
  const isHubUnassigned = !cleanHubBranch || cleanHubBranch.toUpperCase() === 'UNASSIGNED';

  if (!matches) {
    return {
      shouldIsolate: true,
      reconciledBranchId: isHubUnassigned ? null : cleanHubBranch,
      reconciledBranchName: isHubUnassigned ? null : (String(params.hubBranchName || '').trim() || cleanHubBranch),
      reconciledTenantId: String(params.hubTenantId || '').trim() || null,
    };
  }

  const effectiveBranchId = !isHubUnassigned
    ? cleanHubBranch
    : cleanActiveBranch && cleanActiveBranch.toUpperCase() !== 'UNASSIGNED'
    ? cleanActiveBranch
    : null;

  const effectiveBranchName =
    String(params.hubBranchName || '').trim() ||
    String(params.activeBranchName || '').trim() ||
    effectiveBranchId;

  const effectiveTenantId =
    String(params.hubTenantId || '').trim() ||
    String(params.activeTenantId || '').trim() ||
    null;

  return {
    shouldIsolate: false,
    reconciledBranchId: effectiveBranchId,
    reconciledBranchName: effectiveBranchName,
    reconciledTenantId: effectiveTenantId,
  };
}
