import {
  ActiveTab,
  Salesperson,
  StocktakeConsolidatedItem,
  StocktakeCountType,
  StocktakeGuestPass,
  StocktakeSession,
} from '../types';
import {
  getBranchLockdowns,
  getCurrentBranchId,
  getStocktakeSessionById,
  getStocktakeSessions,
  getTemporaryCasuals,
  isBranchInLockdown,
} from '../db/roomDatabase';

export type StocktakePersona = 'LEADER' | 'AUDITOR' | 'AUDITED_MANAGER' | 'COUNTER';

/**
 * Draft/Prep statuses: sync freely across all devices (unlimited per branch),
 * do NOT hold the live branch slot, do NOT trigger POS lockdown, and cannot be counted until activated.
 */
const DRAFT_SESSION_STATUSES = new Set([
  'DRAFT',
  'SCHEDULED',
]);

/**
 * Live Execution statuses: max 1 per branch.
 * Includes PAUSED so a paused floor count retains its branch slot until resumed or archived.
 */
const ACTIVE_SESSION_STATUSES = new Set([
  'ACTIVE',
  'IN_PROGRESS',
  'COUNTING',
  'PAUSED',
  'RECOUNT',
  'RECOUNTING',
  'AUDIT_REVIEW',
  'CONSOLIDATED',
  'PENDING_SIGNOFF',
  'READY_FOR_COMMITTAL',
]);

const ARCHIVED_OR_CLOSED_STATUSES = new Set([
  'APPROVED_POSTED',
  'ARCHIVED',
  'CANCELLED',
]);

export const isDraftStocktakeStatus = (status?: string): boolean => {
  if (!status) return false;
  return DRAFT_SESSION_STATUSES.has(String(status).toUpperCase().trim());
};

export const isPausedStocktakeStatus = (status?: string): boolean => {
  if (!status) return false;
  return String(status).toUpperCase().trim() === 'PAUSED';
};

export const isArchivedOrClosedStocktakeStatus = (status?: string): boolean => {
  if (!status) return false;
  return ARCHIVED_OR_CLOSED_STATUSES.has(String(status).toUpperCase().trim());
};

export const isActiveStocktakeStatus = (status?: string): boolean => {
  if (!status) return false;
  return ACTIVE_SESSION_STATUSES.has(String(status).toUpperCase().trim());
};

export const isCountingPhaseStatus = (status?: string): boolean => {
  if (!status) return false;
  const s = String(status).toUpperCase().trim();
  return (
    s === 'ACTIVE' ||
    s === 'IN_PROGRESS' ||
    s === 'COUNTING' ||
    s === 'RECOUNT' ||
    s === 'RECOUNTING'
  );
};

/**
 * LEADER (Owner / Super Admin):
 * The ONLY persona legally permitted to execute approveAndCommitStocktake() into Inventory Master
 * and close post-commit variance disputes.
 */
export const isStocktakeLeader = (user: Salesperson | null): boolean => {
  if (!user) return false;
  if (user.isCasual || user.isVisitingCounter) return false;
  const role = String(user.role || '').toUpperCase().trim();
  const email = String(user.email || '').toLowerCase().trim();
  return (
    role === 'OWNER' ||
    role === 'SUPER_ADMIN' ||
    role === 'SUPER_ADMINISTRATOR' ||
    role === 'ADMIN' ||
    email === 'andrekudakwashe@gmail.com'
  );
};

/**
 * AUDITOR:
 * Designated Stocktake Auditor who supervises counts, creates segments, manages casuals/guest passes,
 * views the main Consolidated Variance Report, and certifies READY_FOR_COMMITTAL —
 * without authorizing final Inventory Master overwrite unless also LEADER.
 */
export const isStocktakeAuditor = (
  user: Salesperson | null,
  session?: StocktakeSession | null
): boolean => {
  if (!user) return false;
  const role = String(user.role || '').toUpperCase().trim();
  const isAuditorTempRole = user.tempRole === 'AUDITOR' || role === 'STOCKTAKE_AUDITOR' || role === 'AUDITOR';

  // Casual counters & visiting counters cannot audit unless explicitly designated AUDITOR via pass or temp account
  if ((user.isCasual || user.isVisitingCounter) && !isAuditorTempRole && !user.permissions?.canAuditStocktake) {
    // Also check if an active guest pass grants AUDITOR privileges
    if (user.isVisitingCounter && user.id) {
      const gp = hasActiveGuestPass(user.id, user.branchId || user.branch_id);
      if (gp?.passRole === 'AUDITOR') return true;
    }
    return false;
  }

  if (session?.stocktakeAuditorId && user.id) {
    if (String(session.stocktakeAuditorId).trim().toUpperCase() === String(user.id).trim().toUpperCase()) {
      return true;
    }
  }

  if (isAuditorTempRole) {
    return true;
  }

  if (user.permissions?.canAuditStocktake) {
    return true;
  }

  return false;
};

/**
 * AUDITED_MANAGER:
 * Branch Manager or Supervisor who is neither the Leader nor the assigned Auditor.
 * Locked out of SOH / $ variance totals during an active count/lockdown so they cannot influence counts,
 * handles Floor Progress / Emergency Lockdown Sales / Goods Left Behind,
 * and post-commit submits mandatory Manager Variance Commentary.
 */
export const isAuditedManager = (
  user: Salesperson | null,
  session?: StocktakeSession | null
): boolean => {
  if (!user) return false;
  if (user.isCasual || user.isVisitingCounter) return false;
  if (isStocktakeLeader(user)) return false;
  if (isStocktakeAuditor(user, session)) return false;
  const role = String(user.role || '').toUpperCase().trim();
  return role === 'MANAGER' || role === 'BRANCH_MANAGER' || role === 'SUPERVISOR';
};

/**
 * COUNTER:
 * Casual workers, Cross-branch visiting counters, Cashiers during active stocktake,
 * or Stock Clerks who are not acting as Auditor/Manager.
 * Strictly isolated to Blind Double-Counting / Recounting workspace.
 */
export const isStocktakeCounter = (
  user: Salesperson | null,
  session?: StocktakeSession | null
): boolean => {
  if (!user) return false;
  if (isStocktakeLeader(user)) return false;
  if (isStocktakeAuditor(user, session)) return false;
  if (user.isCasual || user.isVisitingCounter) return true;
  if (isAuditedManager(user, session)) return false;
  return true;
};

/**
 * Single authoritative persona resolver for any Stocktake UI screen.
 */
export const resolveStocktakePersona = (
  user: Salesperson | null,
  session?: StocktakeSession | null
): StocktakePersona => {
  if (!user) return 'COUNTER';
  if (isStocktakeLeader(user)) return 'LEADER';
  if (isStocktakeAuditor(user, session)) return 'AUDITOR';
  if (user.isCasual || user.isVisitingCounter) return 'COUNTER';
  if (isAuditedManager(user, session)) return 'AUDITED_MANAGER';
  return 'COUNTER';
};

const canonAccessBranch = (b?: string | null): string => {
  const u = String(b || '').trim().toUpperCase();
  if (!u || u === 'ALL') return '';
  if (u === '1' || u === 'BR001' || u === 'BR-001' || u === 'BR-MAIN' || u === 'HQ-01' || u === 'MAIN') {
    return 'BR-MAIN';
  }
  return u;
};

const resolveConcreteBranchId = (branchId?: string | null, user?: Salesperson | null): string => {
  const candidates = [branchId, user?.branchId, user?.branch_id, getCurrentBranchId()];
  for (const c of candidates) {
    const clean = String(c || '').trim();
    if (clean && clean.toUpperCase() !== 'ALL') {
      return clean;
    }
  }
  return '';
};

export const getActiveBranchStocktakeSessions = (branchId?: string): StocktakeSession[] => {
  const targetCanon = canonAccessBranch(resolveConcreteBranchId(branchId));
  if (!targetCanon) return [];
  const sessions = getStocktakeSessions();
  return sessions.filter((s) => {
    const sessCanon = canonAccessBranch(s.branchId || (s as any).branch_id || '');
    const branchMatches = Boolean(sessCanon) && sessCanon === targetCanon;
    return branchMatches && isActiveStocktakeStatus(s.status);
  });
};

export const getDraftBranchStocktakeSessions = (branchId?: string): StocktakeSession[] => {
  const targetCanon = canonAccessBranch(resolveConcreteBranchId(branchId));
  if (!targetCanon) return [];
  const sessions = getStocktakeSessions();
  return sessions.filter((s) => {
    const sessCanon = canonAccessBranch(s.branchId || (s as any).branch_id || '');
    const branchMatches = Boolean(sessCanon) && sessCanon === targetCanon;
    return branchMatches && isDraftStocktakeStatus(s.status);
  });
};

export const hasActiveBranchStocktakeSession = (branchId?: string): boolean => {
  return getActiveBranchStocktakeSessions(branchId).length > 0;
};

/**
 * Cross-Slot Blind Isolation Check:
 * Prevents the same user from claiming or submitting both Slot A and Slot B on any segment,
 * and blocks access to finalized/locked slots.
 */
export const canClaimSegmentSlot = (
  segment: any,
  slot: 'A' | 'B',
  staffId?: string
): { allowed: boolean; reason?: string } => {
  if (!segment) return { allowed: false, reason: 'Segment not found.' };
  if (segment.comparisonFinalized) {
    return { allowed: false, reason: 'Segment joint comparison is finalized & locked. Auditor unlock required.' };
  }
  const cleanStaff = String(staffId || '').trim().toUpperCase();
  if (slot === 'A') {
    if (segment.count1Finalized) {
      return { allowed: false, reason: 'Team A count is finalized & locked. Ask Auditor to unlock if correction is needed.' };
    }
    const bOwner = String(segment.counterBId || '').trim().toUpperCase();
    if (cleanStaff && bOwner && bOwner === cleanStaff) {
      return { allowed: false, reason: 'Blind isolation rule: You already counted Team B on this segment and cannot count Team A.' };
    }
  } else {
    if (segment.count2Finalized) {
      return { allowed: false, reason: 'Team B count is finalized & locked. Ask Auditor to unlock if correction is needed.' };
    }
    const aOwner = String(segment.counterAId || '').trim().toUpperCase();
    if (cleanStaff && aOwner && aOwner === cleanStaff) {
      return { allowed: false, reason: 'Blind isolation rule: You already counted Team A on this segment and cannot count Team B.' };
    }
  }
  return { allowed: true };
};

export const getActiveLockdownSession = (branchId?: string): StocktakeSession | null => {
  const targetBranch = resolveConcreteBranchId(branchId);
  if (!targetBranch) return null;

  const targetCanon = canonAccessBranch(targetBranch);
  const lockdowns = getBranchLockdowns();
  const matchedLock =
    lockdowns[targetBranch] ||
    Object.entries(lockdowns).find(
      ([k, st]) => st && (canonAccessBranch(k) === targetCanon || canonAccessBranch(st.branchId) === targetCanon)
    )?.[1];

  if (matchedLock?.isLocked && matchedLock.sessionId) {
    const linked = getStocktakeSessionById(matchedLock.sessionId);
    if (linked && isActiveStocktakeStatus(linked.status) && linked.isLockdownActive !== false) {
      return linked;
    }
  }

  // Fallback check if session flag is active in storage for THIS exact branch
  const activeSessions = getActiveBranchStocktakeSessions(targetBranch);
  const lockdownSess = activeSessions.find(
    (s) => Boolean(s.isLockdownActive) && s.status !== 'PAUSED'
  );
  return lockdownSess || null;
};

export const getActiveGuestPassesForBranch = (branchId?: string): StocktakeGuestPass[] => {
  const targetBranch = String(branchId || getCurrentBranchId() || '').trim().toUpperCase();
  const sessions = getStocktakeSessions();
  const result: StocktakeGuestPass[] = [];
  const seen = new Set<string>();

  sessions.forEach((sess) => {
    if (!isActiveStocktakeStatus(sess.status)) return;
    const passes = Array.isArray(sess.guestPasses) ? sess.guestPasses : [];
    passes.forEach((gp) => {
      if (!gp || !gp.active) return;
      const gpHost = String(gp.hostBranchId || sess.branchId || '').trim().toUpperCase();
      if (targetBranch && gpHost && gpHost !== targetBranch) return;
      const dedupeKey = `${sess.sessionId}:${gp.staffId}`.toUpperCase();
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        result.push(gp);
      }
    });
  });

  return result;
};

export const hasActiveGuestPass = (staffId: string, branchId?: string): StocktakeGuestPass | null => {
  if (!staffId) return null;
  const cleanId = String(staffId).trim().toUpperCase();
  const passes = getActiveGuestPassesForBranch(branchId);
  return passes.find((gp) => String(gp.staffId).trim().toUpperCase() === cleanId) || null;
};

/**
 * Daily Blind Count — Designated Auditor Check:
 * Only the Designated Auditor (Owner / Admin, explicitly pinned branch auditor,
 * or Branch Manager / Supervisor / Stocktake Auditor when no single person is pinned)
 * can open Daily Blind Count Results, Archive, and Product List Configuration.
 * Low-level staff (Cashiers, Stock Clerks, Casuals) can count blindly and submit,
 * and can ONLY view specific line items flagged for their own optional explanation.
 */
export const isDailyBlindDesignatedAuditor = (
  user: Salesperson | null,
  branchConfig?: { designatedAuditorId?: string } | null
): boolean => {
  if (!user) return false;
  if (user.isCasual || user.isVisitingCounter) return false;
  if (isStocktakeLeader(user)) return true;

  const cleanUserId = String(user.id || '').trim().toUpperCase();
  const pinnedAuditorId = String(branchConfig?.designatedAuditorId || '').trim().toUpperCase();
  if (pinnedAuditorId) {
    return cleanUserId !== '' && cleanUserId === pinnedAuditorId;
  }

  if (isStocktakeAuditor(user)) return true;

  const role = String(user.role || '').toUpperCase().trim();
  return (
    role === 'MANAGER' ||
    role === 'BRANCH_MANAGER' ||
    role === 'SUPERVISOR'
  );
};

/**
 * Dynamic Stocktake Module Visibility:
 * - All active authenticated staff can access the Stocktake module so anyone
 *   on the floor (including Cashiers and Clerks) can perform Daily Blind Counts.
 * - Formal stocktake creation, SOH visibility, and Daily Blind Count results
 *   remain strictly role-gated inside the module.
 */
export const canAccessStocktakeModule = (
  user: Salesperson | null,
  _branchId?: string
): boolean => {
  if (!user) return false;
  return true;
};

/**
 * Governs which Stocktake session types each role may create.
 */
export const getAllowedCreateCountTypes = (user: Salesperson | null): StocktakeCountType[] => {
  if (!user) return [];
  if (user.isCasual || user.isVisitingCounter) return [];
  if (isStocktakeLeader(user) || isStocktakeAuditor(user)) {
    return ['FULL_LOCKDOWN', 'WEEKLY_STRATEGIC', 'SPOT_CHECK', 'DAILY_BLIND'];
  }
  const role = String(user.role || '').toUpperCase().trim();
  if (role === 'MANAGER' || role === 'BRANCH_MANAGER' || role === 'SUPERVISOR') {
    return ['DAILY_BLIND', 'SPOT_CHECK', 'WEEKLY_STRATEGIC'];
  }
  if (role === 'STOCK_CLERK' || role === 'STOCK_CONTROLLER' || user.permissions?.canPerformDailyBlindCount) {
    return ['DAILY_BLIND'];
  }
  return [];
};

export const canUserCreateStocktakeSession = (user: Salesperson | null): boolean => {
  return getAllowedCreateCountTypes(user).length > 0;
};

/**
 * Branch Lockdown & Casual Session Gate:
 * Used by roleNavigationService, BottomNavigation, FunctionalHamburgerMenu, and App.tsx.
 */
export const isTabAllowedUnderLockdownOrStocktake = (
  user: Salesperson | null,
  tab: ActiveTab,
  branchId?: string
): boolean => {
  if (!user) return false;

  // Casual workers & visiting cross-branch counters are strictly locked to 'stocktake'
  if (user.isCasual || user.isVisitingCounter) {
    return tab === 'stocktake';
  }

  const effectiveBranch = resolveConcreteBranchId(branchId, user);
  const lockdownSess = getActiveLockdownSession(effectiveBranch);
  const branchLocked = (Boolean(effectiveBranch) && isBranchInLockdown(effectiveBranch)) || Boolean(lockdownSess);

  if (!branchLocked) {
    return true;
  }

  // Under FULL_LOCKDOWN:
  if (tab === 'stocktake') return true;

  // Platform Super Admin always retains access to the Super Admin console
  const normRole = String(user.role || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (
    tab === 'super_admin' &&
    (normRole === 'SUPER_ADMIN' ||
      normRole === 'SUPER_ADMINISTRATOR' ||
      String(user.email || '').trim().toLowerCase() === 'andrekudakwashe@gmail.com')
  ) {
    return true;
  }

  // Leaders and Designated Auditors retain oversight tools if needed
  if (isStocktakeLeader(user) || isStocktakeAuditor(user, lockdownSess)) {
    return tab === 'stocktake' || tab === 'dashboard' || tab === 'p2p_mesh' || tab === 'staff_access';
  }

  // Everyone else (Managers, Supervisors, Cashiers, Stock Clerks) lands ONLY inside Stocktake during lockdown
  return false;
};

/**
 * Post-Commit Mandatory Manager Variance Commentary lookup (Phase 3).
 */
export const getPostCommitPendingVarianceSessions = (branchId?: string): StocktakeSession[] => {
  const targetBranch = String(branchId || getCurrentBranchId() || '').trim().toUpperCase();
  return getStocktakeSessions().filter((s) => {
    if (s.status !== 'APPROVED_POSTED') return false;
    const sessBranch = String(s.branchId || (s as any).branch_id || '').trim().toUpperCase();
    if (targetBranch && sessBranch && sessBranch !== targetBranch) return false;
    return s.varianceReviewStatus === 'PENDING_MANAGER_COMMENTS' || s.varianceReviewStatus === 'COMMENTS_SUBMITTED';
  });
};

export const isVarianceItemMandatoryForComment = (
  item: StocktakeConsolidatedItem,
  thresholdUsd: number = 10,
  minUnits: number = 5
): boolean => {
  if (item.wasCountedInSession === false) return false;
  if (Number(item.varianceTotalUnits || 0) === 0) return false;
  if (item.requiresExplanation) return true;
  const absCost = Math.abs(Number(item.varianceCostValue || 0));
  const absUnits = Math.abs(Number(item.varianceTotalUnits || 0));
  return absCost >= thresholdUsd || absUnits >= minUnits;
};

/**
 * True Blind Payload Sanitizer:
 * Strips consolidated SOH, costPrice, variance totals, and system stock quantities
 * whenever rendering a StocktakeSession to a COUNTER persona so blind double-counting
 * cannot be gamed by reading local component state.
 */
export const sanitizeSessionForCounter = (session: StocktakeSession): StocktakeSession => {
  return {
    ...session,
    consolidatedItems: [],
    totalSystemUnits: 0,
    varianceUnits: 0,
    varianceCostValue: 0,
    varianceRetailValue: 0,
  };
};

export const getActiveCasualsForBranch = (branchId?: string) => {
  const targetBranch = String(branchId || getCurrentBranchId() || '').trim().toUpperCase();
  const activeSessions = getActiveBranchStocktakeSessions(targetBranch);
  const activeSessionIds = new Set(activeSessions.map((s) => String(s.sessionId).toUpperCase()));
  if (activeSessionIds.size === 0) return [];

  return getTemporaryCasuals().filter((c) => {
    if (!c.active) return false;
    const cBranch = String(c.branchId || '').trim().toUpperCase();
    const cSess = String(c.sessionId || '').trim().toUpperCase();
    return (!targetBranch || !cBranch || cBranch === targetBranch) && activeSessionIds.has(cSess);
  });
};
