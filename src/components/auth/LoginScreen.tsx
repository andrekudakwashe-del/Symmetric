import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Salesperson, Branch, StocktakeGuestPass, TemporaryCasualAccount } from '../../types';
import {
  getSalespeople,
  getRawStoredSalespeople,
  getSalespeopleForCompany,
  setSessionUser,
  logLogin,
  getCompanies,
  getCurrentCompanyId,
  setCurrentCompanyId,
  setCurrentBranchId,
  getBranches,
  getBranchesForCompany,
  subscribeRoomDatabase,
  saveSalesperson,
  getOwnerDefaultPermissions,
  getStaffRoleInBranch,
  isStaffAssignedToBranch,
  authenticateCasualWorker,
  getTerminalLastLoginMap,
  addAuditLog,
} from '../../db/roomDatabase';
import {
  getActiveGuestPassesForBranch,
  getActiveCasualsForBranch,
  getActiveBranchStocktakeSessions,
  getActiveLockdownSession,
} from '../../services/stocktakeAccessService';
import { getRolePresetPermissions } from '../admin/StaffAccessManagementScreen';
import {
  Shield,
  Lock,
  UserCheck,
  KeyRound,
  AlertCircle,
  Sparkles,
  Delete,
  Check,
  LogIn,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Building2,
  Crown,
  ChevronDown,
  RefreshCw,
  Mail,
  Eye,
  EyeOff,
  HelpCircle,
  MapPin,
  Laptop,
  Unlink,
  Database,
  Shuffle,
  Radio,
  Wifi,
  Server,
  ClipboardCheck,
  BadgeCheck,
  Plane,
} from 'lucide-react';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { RegistrationScreen } from './RegistrationScreen';
import { DatabaseRestoreModal } from '../common/DatabaseRestoreModal';
import { initializeSystemConfigAndSync } from '../../services/systemConfig';
import {
  authenticateOwnerWithAppsScript,
  authenticateStaffWithAppsScript,
} from '../../services/googleSheetsSync';
import { backendAuthService } from '../../services/backendAdapter/backendAuthService';
import { getTenantBackendConfig, getBackendAdapter } from '../../services/backendAdapter/adapterRegistry';
import { LocalHubConfig } from '../../utils/localHubConfig';
import { meshSyncService } from '../../services/meshSyncService';

// Fisher-Yates shuffle algorithm to randomize numeric keypad locations
const generateScrambledDigits = (): string[] => {
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits;
};

const LAST_SELECTED_BRANCH_KEY = 'saimetric_last_selected_branch_id';

const formatLastLoginRelative = (ts?: number): string => {
  if (!ts || ts <= 0) return '';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

interface LoginScreenProps {
  onLoginSuccess: (user: Salesperson) => void;
  lockoutMessage?: string | null;
  initialMode?: 'login' | 'register';
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  lockoutMessage,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [companies, setCompanies] = useState(() => getCompanies());
  const [isSyncingTenants, setIsSyncingTenants] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  
  // LocalStorage device registration keys
  const DEVICE_REG_KEY = 'saimetric_device_registered';
  const DEVICE_COMPANY_ID_KEY = 'saimetric_device_registered_company_id';
  const DEVICE_COMPANY_NAME_KEY = 'saimetric_device_registered_company_name';
  const DEVICE_REG_EMAIL_KEY = 'saimetric_device_registered_email';
  const DEVICE_REG_BRANCH_ID_KEY = 'saimetric_device_registered_branch_id';
  const DEVICE_REG_ROLE_KEY = 'saimetric_device_registered_role';
  const DEVICE_REG_AT_KEY = 'saimetric_device_registered_at';

  // Check if this physical device has already completed once-off registration
  const [isDeviceRegistered, setIsDeviceRegistered] = useState<boolean>(() => {
    try {
      const reg = localStorage.getItem(DEVICE_REG_KEY);
      const savedCompId = localStorage.getItem(DEVICE_COMPANY_ID_KEY);
      return reg === 'true' && Boolean(savedCompId);
    } catch {
      return false;
    }
  });

  const [registeredCompanyId, setRegisteredCompanyId] = useState<string>(() => {
    try {
      return localStorage.getItem(DEVICE_COMPANY_ID_KEY) || '';
    } catch {
      return '';
    }
  });

  const [registeredCompanyName, setRegisteredCompanyName] = useState<string>(() => {
    try {
      return localStorage.getItem(DEVICE_COMPANY_NAME_KEY) || '';
    } catch {
      return '';
    }
  });

  const [registeredEmail, setRegisteredEmail] = useState<string>(() => {
    try {
      return localStorage.getItem(DEVICE_REG_EMAIL_KEY) || '';
    } catch {
      return '';
    }
  });

  // Selected Company for Sign-in: locked to registered company if device is registered!
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(() => {
    try {
      const savedReg = localStorage.getItem(DEVICE_COMPANY_ID_KEY);
      if (savedReg) return savedReg;
      const saved = getCurrentCompanyId();
      const list = getCompanies();
      if (saved && list.some((c) => c.company_id === saved)) {
        return saved;
      }
      return list[0]?.company_id || 'COMP-001';
    } catch {
      return 'COMP-001';
    }
  });

  // Selected branch of his company only (must be a specific branch, never 'ALL')
  // Precedence: 1) Last used branch saved on this terminal, 2) Connected Local Hub branch, 3) Registered branch
  const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
    try {
      const lastUsed = localStorage.getItem(LAST_SELECTED_BRANCH_KEY);
      if (lastUsed && lastUsed !== 'ALL') {
        const lower = lastUsed.trim().toLowerCase();
        return lower === '1' || lower === 'br-main' || lower === 'br001' ? 'BR-MAIN' : lastUsed;
      }
      const hubRaw = LocalHubConfig.getHubBranchId();
      if (hubRaw && hubRaw !== 'UNASSIGNED') {
        const lower = hubRaw.trim().toLowerCase();
        return lower === '1' || lower === 'br-main' || lower === 'br001' ? 'BR-MAIN' : hubRaw;
      }
      const stored = localStorage.getItem(DEVICE_REG_BRANCH_ID_KEY);
      if (stored && stored !== 'ALL') {
        const lower = stored.trim().toLowerCase();
        return lower === '1' || lower === 'br-main' || lower === 'br001' ? 'BR-MAIN' : stored;
      }
    } catch {
      // ignore
    }
    return 'BR-MAIN';
  });

  // Modal for unregistering / switching store
  const [showDeregisterModal, setShowDeregisterModal] = useState(false);

  // Subscribe to room database updates (e.g. cloud/server background sync)
  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      const fresh = getCompanies();
      setCompanies((prev) => {
        if (
          prev.length === fresh.length &&
          prev.every((p, idx) => p.company_id === fresh[idx]?.company_id && p.company_name === fresh[idx]?.company_name)
        ) {
          return prev;
        }
        return fresh;
      });
      setStaffVersion((v) => v + 1);
    });

    const handleHubIdentity = () => {
      setHubBranchId(LocalHubConfig.getHubBranchId());
      setHubBranchName(LocalHubConfig.getHubBranchName());
      setIsCloudOnly(LocalHubConfig.isCloudOnlyMode());
      setConnMode(meshSyncService.getConnectionMode());
    };

    const unsubMesh = meshSyncService.subscribeConnectionMode((mode) => {
      setConnMode(mode);
      handleHubIdentity();
    });

    const unsubConfig = LocalHubConfig.subscribe(() => {
      handleHubIdentity();
    });

    const handleStaffUpdate = () => {
      setStaffVersion((v) => v + 1);
    };

    window.addEventListener('saimetric_hub_identity_updated', handleHubIdentity);
    window.addEventListener('saimetric_cloud_only_mode_changed', handleHubIdentity);
    window.addEventListener('saimetric_salespeople_updated', handleStaffUpdate);
    window.addEventListener('saimetric_staff_updated', handleStaffUpdate);
    window.addEventListener('saimetric_branches_updated', handleStaffUpdate);
    window.addEventListener('saimetric_stocktake_updated', handleStaffUpdate);
    window.addEventListener('saimetric_casual_workers_updated', handleStaffUpdate);
    window.addEventListener('saimetric_casuals_updated', handleStaffUpdate);
    window.addEventListener('saimetric_stocktake_lockdown_updated', handleStaffUpdate);
    window.addEventListener('saimetric_lockdown_updated', handleStaffUpdate);

    return () => {
      unsub();
      unsubMesh();
      unsubConfig();
      window.removeEventListener('saimetric_hub_identity_updated', handleHubIdentity);
      window.removeEventListener('saimetric_cloud_only_mode_changed', handleHubIdentity);
      window.removeEventListener('saimetric_salespeople_updated', handleStaffUpdate);
      window.removeEventListener('saimetric_staff_updated', handleStaffUpdate);
      window.removeEventListener('saimetric_branches_updated', handleStaffUpdate);
      window.removeEventListener('saimetric_stocktake_updated', handleStaffUpdate);
      window.removeEventListener('saimetric_casual_workers_updated', handleStaffUpdate);
      window.removeEventListener('saimetric_casuals_updated', handleStaffUpdate);
      window.removeEventListener('saimetric_stocktake_lockdown_updated', handleStaffUpdate);
      window.removeEventListener('saimetric_lockdown_updated', handleStaffUpdate);
    };
  }, []);

  const [staffVersion, setStaffVersion] = useState<number>(0);

  // Hub Branch Identity & Roaming Owner Safeguard
  const [hubBranchId, setHubBranchId] = useState<string | null>(() => LocalHubConfig.getHubBranchId());
  const [hubBranchName, setHubBranchName] = useState<string | null>(() => LocalHubConfig.getHubBranchName());
  const [connMode, setConnMode] = useState(() => meshSyncService.getConnectionMode());
  const [isCloudOnly, setIsCloudOnly] = useState(() => LocalHubConfig.isCloudOnlyMode());

  const handleCompleteLogin = (user: Salesperson) => {
    // Branch-Scoped Isolation & Roaming Owner Safeguard:
    // If user's branch does not match current Local Hub branch, activate Cloud-Only Mode —
    // EXCEPT for visiting cross-branch counters & casuals who are legally operating inside this host branch's stocktake hub!
    const curHubBranch = LocalHubConfig.getHubBranchId();
    const userBranch = user.branchId || user.branch_id || selectedBranchId;
    if (userBranch && userBranch !== 'ALL') {
      try {
        localStorage.setItem(LAST_SELECTED_BRANCH_KEY, userBranch);
      } catch {}
    }

    if (
      curHubBranch &&
      curHubBranch !== 'UNASSIGNED' &&
      userBranch &&
      userBranch !== curHubBranch &&
      userBranch !== 'ALL' &&
      !user.isVisitingCounter &&
      !user.isCasual
    ) {
      meshSyncService.setCloudOnlyMode(true);
    } else {
      meshSyncService.setCloudOnlyMode(false);
    }

    // Re-Handshake on Login: Dispatch fresh HANDSHAKE packet to Local Hub
    meshSyncService.sendHandshake(userBranch, user.branchName);

    onLoginSuccess(user);
  };

  // Helper to get active staff, returning in-memory owner if remote sync hasn't fully loaded users yet
  const getActiveStaffForCompany = (compId: string): Salesperson[] => {
    const staff = getSalespeopleForCompany(compId).filter((s) => s.active === 'Y');
    if (staff.length > 0) {
      return staff;
    }
    // If company exists but staff list is temporarily empty, present the Owner account without mutating DB during render
    const comp = getCompanies().find((c) => c.company_id === compId);
    if (comp && (comp.owner_name || comp.owner_email)) {
      const fallbackOwner: Salesperson = {
        id: `USR-${comp.company_id}-001`,
        name: comp.owner_name || 'Business Owner',
        role: 'OWNER',
        email: comp.owner_email || '',
        pin: '1234',
        phone: comp.phone || '',
        active: 'Y',
        companyId: comp.company_id,
        company_id: comp.company_id,
        branchId: 'BR-MAIN',
        branch_id: 'BR-MAIN',
        permissions: getOwnerDefaultPermissions(),
      };
      return [fallbackOwner];
    }
    return [];
  };

  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [selectedGuestPassId, setSelectedGuestPassId] = useState<string | null>(null);
  const [selectedCasualId, setSelectedCasualId] = useState<string | null>(null);
  const [staffCategoryFilter, setStaffCategoryFilter] = useState<'all' | 'staff' | 'visiting' | 'casual'>('all');
  const hasManuallyChangedBranchRef = useRef<boolean>(false);

  // Get branches strictly for this company only, deduplicating any duplicate IDs, codes, and aliases
  const companyBranches = useMemo(() => {
    const list = getBranchesForCompany(selectedCompanyId);
    const seenIds = new Set<string>();
    const seenCodes = new Set<string>();
    const unique: Branch[] = [];
    for (const b of list) {
      const rawId = (b.branchId || b.id || (b as any).branch_id || '').trim();
      if (!rawId) continue;
      const lowerId = rawId.toLowerCase();
      const isMainAlias = lowerId === '1' || lowerId === 'br-main' || lowerId === 'br001';
      const canonicalId = isMainAlias ? 'BR-MAIN' : rawId;
      if (seenIds.has(canonicalId.toLowerCase())) continue;
      const codeUpper = String(b.code || '').trim().toUpperCase();
      if (codeUpper && codeUpper !== canonicalId.toUpperCase()) {
        if (seenCodes.has(codeUpper)) continue;
        seenCodes.add(codeUpper);
      }
      seenIds.add(canonicalId.toLowerCase());
      unique.push({
        ...b,
        branchId: canonicalId,
        id: canonicalId,
        branch_id: canonicalId,
        name: isMainAlias ? (b.name || 'Head Office - Main Central Distribution & Warehouse') : b.name,
      });
    }
    return unique;
  }, [selectedCompanyId, companies, staffVersion]);

  // Ensure selectedBranchId is valid within companyBranches without snapping back manual choices
  useEffect(() => {
    if (companyBranches.length === 0) return;
    const validIds = companyBranches.map((b) => b.branchId || b.id || (b as any).branch_id);
    const curLower = String(selectedBranchId || '').trim().toLowerCase();
    const normalizedCurrent =
      curLower === '1' || curLower === 'br-main' || curLower === 'br001'
        ? 'BR-MAIN'
        : selectedBranchId;

    if (normalizedCurrent && normalizedCurrent !== 'ALL' && validIds.includes(normalizedCurrent)) {
      if (normalizedCurrent !== selectedBranchId) {
        setSelectedBranchId(normalizedCurrent);
      }
      return;
    }

    if (hasManuallyChangedBranchRef.current) return;

    const curHub = LocalHubConfig.getHubBranchId();
    const curHubLower = String(curHub || '').trim().toLowerCase();
    const canonicalHub =
      curHubLower === '1' || curHubLower === 'br-main' || curHubLower === 'br001'
        ? 'BR-MAIN'
        : curHub;

    if (canonicalHub && validIds.includes(canonicalHub)) {
      setSelectedBranchId(canonicalHub);
    } else if (validIds.length > 0) {
      setSelectedBranchId(validIds[0]);
    }
  }, [companyBranches]);

  const terminalLastLoginMap = useMemo<Record<string, number>>(() => {
    return getTerminalLastLoginMap(selectedBranchId);
  }, [selectedBranchId, staffVersion]);

  // Get staff strictly isolated to selected company & branch, ordered by terminal lastLoginAt descending
  const companyStaff = useMemo(() => {
    const all = getActiveStaffForCompany(selectedCompanyId);
    const filtered = all.filter((s) => isStaffAssignedToBranch(s, selectedBranchId));
    const staffToUse = filtered.length > 0 ? filtered : all;
    const seen = new Set<string>();
    const unique: Salesperson[] = [];
    for (const s of staffToUse) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const branchRole = getStaffRoleInBranch(s, selectedBranchId);
      unique.push({
        ...s,
        role: branchRole || s.role,
        branchId: selectedBranchId,
        branch_id: selectedBranchId,
      });
    }

    const isPrivilegedRole = (role?: string) => {
      const r = String(role || '').toUpperCase().trim();
      return r === 'OWNER' || r === 'SUPER_ADMIN' || r === 'ADMIN';
    };

    return unique.sort((a, b) => {
      const tA = terminalLastLoginMap[a.id] || 0;
      const tB = terminalLastLoginMap[b.id] || 0;
      if (tB !== tA) return tB - tA;
      const privA = isPrivilegedRole(a.role) ? 1 : 0;
      const privB = isPrivilegedRole(b.role) ? 1 : 0;
      if (privA !== privB) return privA - privB;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [selectedCompanyId, selectedBranchId, companies, staffVersion, terminalLastLoginMap]);

  // Cross-Branch Visiting Stocktake Passes & Branch Casual Counters (ordered by recency)
  const visitingPasses = useMemo<StocktakeGuestPass[]>(() => {
    return [...getActiveGuestPassesForBranch(selectedBranchId)].sort((a, b) => {
      const tA = terminalLastLoginMap[a.staffId] || 0;
      const tB = terminalLastLoginMap[b.staffId] || 0;
      if (tB !== tA) return tB - tA;
      return String(a.staffName || '').localeCompare(String(b.staffName || ''));
    });
  }, [selectedBranchId, selectedCompanyId, staffVersion, terminalLastLoginMap]);

  const branchCasuals = useMemo<TemporaryCasualAccount[]>(() => {
    return [...getActiveCasualsForBranch(selectedBranchId)].sort((a, b) => {
      const tA = terminalLastLoginMap[a.id] || 0;
      const tB = terminalLastLoginMap[b.id] || 0;
      if (tB !== tA) return tB - tA;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [selectedBranchId, selectedCompanyId, staffVersion, terminalLastLoginMap]);

  const branchLockdownSession = useMemo(() => {
    return getActiveLockdownSession(selectedBranchId);
  }, [selectedBranchId, staffVersion]);

  const branchActiveStocktakeCount = useMemo(() => {
    return getActiveBranchStocktakeSessions(selectedBranchId).length;
  }, [selectedBranchId, staffVersion]);

  const selectedGuestPass = useMemo<StocktakeGuestPass | null>(() => {
    if (!selectedGuestPassId) return null;
    return visitingPasses.find((gp) => gp.id === selectedGuestPassId) || null;
  }, [visitingPasses, selectedGuestPassId]);

  const selectedCasual = useMemo<TemporaryCasualAccount | null>(() => {
    if (!selectedCasualId) return null;
    return branchCasuals.find((c) => c.id === selectedCasualId) || null;
  }, [branchCasuals, selectedCasualId]);

  const resolveVisitingStaffProfile = (pass: StocktakeGuestPass): Salesperson => {
    const compStaff = getActiveStaffForCompany(selectedCompanyId);
    const allStaff = compStaff.length > 0 ? compStaff : getSalespeople();
    const match = allStaff.find(
      (s) => String(s.id).trim().toUpperCase() === String(pass.staffId).trim().toUpperCase()
    );
    if (match) return match;
    return {
      id: pass.staffId,
      name: pass.staffName,
      role: (pass.staffRole || 'STOCK_CLERK') as any,
      active: 'Y',
      companyId: selectedCompanyId,
      company_id: selectedCompanyId,
      branchId: pass.homeBranchId,
      branch_id: pass.homeBranchId,
      branchName: pass.homeBranchName,
    };
  };

  // Safe default selection: prefer most recent non-privileged staff so terminal never defaults to OWNER unnecessarily
  const defaultStaff = useMemo(() => {
    if (companyStaff.length === 0) return null;
    const isPriv = (r?: string) => {
      const u = String(r || '').toUpperCase().trim();
      return u === 'OWNER' || u === 'SUPER_ADMIN' || u === 'ADMIN';
    };
    const nonPriv = companyStaff.find((s) => !isPriv(s.role));
    return nonPriv || companyStaff[0];
  }, [companyStaff]);

  const selectedStaff = useMemo(() => {
    if (selectedCasual) return null;
    if (selectedGuestPass) {
      return resolveVisitingStaffProfile(selectedGuestPass);
    }
    if (selectedStaffId) {
      const match = companyStaff.find((s) => s.id === selectedStaffId);
      if (match) return match;
    }
    return defaultStaff;
  }, [companyStaff, defaultStaff, selectedStaffId, selectedGuestPass, selectedCasual, selectedCompanyId, staffVersion]);

  // Top 2 recently logged-in accounts on this terminal for 1-tap shift handovers
  const recentQuickOperators = useMemo(() => {
    type QuickItem =
      | { key: string; label: string; badge: string; lastAt: number; kind: 'staff'; staff: Salesperson }
      | { key: string; label: string; badge: string; lastAt: number; kind: 'visiting'; pass: StocktakeGuestPass }
      | { key: string; label: string; badge: string; lastAt: number; kind: 'casual'; casual: TemporaryCasualAccount };
    const items: QuickItem[] = [];
    companyStaff.forEach((s) => {
      const ts = terminalLastLoginMap[s.id] || 0;
      if (ts > 0) {
        items.push({ key: `staff:${s.id}`, label: s.name.split(' ')[0], badge: s.role, lastAt: ts, kind: 'staff', staff: s });
      }
    });
    visitingPasses.forEach((p) => {
      const ts = terminalLastLoginMap[p.staffId] || 0;
      if (ts > 0) {
        items.push({ key: `visiting:${p.id}`, label: p.staffName.split(' ')[0], badge: 'VISITING', lastAt: ts, kind: 'visiting', pass: p });
      }
    });
    branchCasuals.forEach((c) => {
      const ts = terminalLastLoginMap[c.id] || 0;
      if (ts > 0) {
        items.push({ key: `casual:${c.id}`, label: c.name.split(' ')[0], badge: 'CASUAL', lastAt: ts, kind: 'casual', casual: c });
      }
    });
    return items.sort((a, b) => b.lastAt - a.lastAt).slice(0, 2);
  }, [companyStaff, visitingPasses, branchCasuals, terminalLastLoginMap]);

  const [pin, setPin] = useState<string>('');
  const [scrambledKeypad, setScrambledKeypad] = useState<string[]>(() => generateScrambledDigits());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // PCI-DSS Req 8.3.4 Brute-Force Protection: 5 failed PIN attempts -> progressive cooldown lock
  const [failedPinAttempts, setFailedPinAttempts] = useState<number>(0);
  const [pinLockoutUntil, setPinLockoutUntil] = useState<number>(0);
  const [lockoutRemainingSec, setLockoutRemainingSec] = useState<number>(0);

  useEffect(() => {
    if (!pinLockoutUntil || pinLockoutUntil <= Date.now()) {
      setLockoutRemainingSec(0);
      return;
    }
    const updateTick = () => {
      const rem = Math.ceil((pinLockoutUntil - Date.now()) / 1000);
      if (rem <= 0) {
        setLockoutRemainingSec(0);
        setPinLockoutUntil(0);
        setError(null);
      } else {
        setLockoutRemainingSec(rem);
      }
    };
    updateTick();
    const timer = window.setInterval(updateTick, 1000);
    return () => window.clearInterval(timer);
  }, [pinLockoutUntil]);

  const isPinLockedOut = lockoutRemainingSec > 0;

  const registerFailedAttempt = (accountName: string, accountId?: string) => {
    const nextFails = failedPinAttempts + 1;
    setFailedPinAttempts(nextFails);
    if (nextFails > 0 && nextFails % 5 === 0) {
      const rounds = Math.min(4, Math.floor(nextFails / 5));
      const lockSec = rounds * 30;
      setPinLockoutUntil(Date.now() + lockSec * 1000);
      setLockoutRemainingSec(lockSec);
      addAuditLog({
        action: 'AUTH_LOCKOUT',
        severity: 'WARNING',
        staffId: accountId || 'UNKNOWN',
        staffName: accountName,
        staffRole: 'TERMINAL',
        details: `Terminal PIN lockout triggered (${lockSec}s cooldown) after ${nextFails} consecutive failed PIN attempts targeting ${accountName}.`,
      });
      setError(`Security Cooldown: ${nextFails} failed attempts. Locked for ${lockSec}s.`);
      return true;
    }
    return false;
  };

  // Re-scramble number positions on demand or after every attempt
  const scrambleKeypad = () => {
    setScrambledKeypad(generateScrambledDigits());
  };

  // Authentication Tier:
  // 'owner': Tier 1 (Device Registration: Email + Password via Apps Script)
  // 'staff': Tier 2 (Staff PIN Login: Select Name + 4-digit PIN)
  // Starts directly at Tier 2 if device is already registered!
  const [authTier, setAuthTier] = useState<'owner' | 'staff'>(() => {
    try {
      const reg = localStorage.getItem('saimetric_device_registered');
      const savedCompId = localStorage.getItem('saimetric_device_registered_company_id');
      if (reg === 'true' && savedCompId) {
        return 'staff';
      }
    } catch {
      // fallback
    }
    return 'owner';
  });

  // Tier 1 Registration State
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [isOwnerSubmitting, setIsOwnerSubmitting] = useState(false);

  // Authenticated Device Session Information
  const [authenticatedOwnerEmail, setAuthenticatedOwnerEmail] = useState<string>(() => {
    return sessionStorage.getItem('saimetric_device_owner_email') || '';
  });
  const [authenticatedBusinessId, setAuthenticatedBusinessId] = useState<string>(() => {
    return sessionStorage.getItem('saimetric_device_business_id') || '';
  });
  const [authenticatedRole, setAuthenticatedRole] = useState<string>(() => {
    return sessionStorage.getItem('saimetric_device_role') || '';
  });

  // Forgot Password Modal (Step 3)
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);

  // Encrypted Backup Restore Modal (Stage 1 & Stage 2 Disaster Recovery)
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'append'>('replace');

  const handleDeregisterDevice = () => {
    try {
      localStorage.removeItem(DEVICE_REG_KEY);
      localStorage.removeItem(DEVICE_COMPANY_ID_KEY);
      localStorage.removeItem(DEVICE_COMPANY_NAME_KEY);
      localStorage.removeItem(DEVICE_REG_EMAIL_KEY);
      localStorage.removeItem(DEVICE_REG_BRANCH_ID_KEY);
      localStorage.removeItem(DEVICE_REG_ROLE_KEY);
      localStorage.removeItem(DEVICE_REG_AT_KEY);
      sessionStorage.removeItem('saimetric_device_business_id');
      sessionStorage.removeItem('saimetric_device_owner_email');
      sessionStorage.removeItem('saimetric_device_role');
    } catch {
      // ignore
    }
    setIsDeviceRegistered(false);
    setRegisteredCompanyId('');
    setRegisteredCompanyName('');
    setRegisteredEmail('');
    setAuthTier('owner');
    setShowDeregisterModal(false);
  };

  const handleOwnerLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setOwnerError(null);

    const cleanEmail = ownerEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setOwnerError('Please enter your account email address.');
      return;
    }
    if (!ownerPassword) {
      setOwnerError('Please enter your account password.');
      return;
    }

    setIsOwnerSubmitting(true);
    try {
      const response = await backendAuthService.authenticateOwner(cleanEmail, ownerPassword, selectedCompanyId);

      if (response.status === 'success' || response.success === true) {
        const busId = response.businessId || response.company_id || 'COMP-001';
        const busName =
          response.company_name ||
          companies.find((c) => c.company_id === busId)?.company_name ||
          busId;
        const branchId = response.branch_id || 'BR-MAIN';
        const role = response.role || 'owner';

        // 1. Store in localStorage for permanent device registration (done once)
        try {
          localStorage.setItem(DEVICE_REG_KEY, 'true');
          localStorage.setItem(DEVICE_COMPANY_ID_KEY, busId);
          localStorage.setItem(DEVICE_COMPANY_NAME_KEY, busName);
          localStorage.setItem(DEVICE_REG_EMAIL_KEY, cleanEmail);
          localStorage.setItem(DEVICE_REG_BRANCH_ID_KEY, branchId);
          localStorage.setItem(DEVICE_REG_ROLE_KEY, role);
          localStorage.setItem(DEVICE_REG_AT_KEY, new Date().toISOString());
        } catch (e) {
          console.warn('Could not save device registration to localStorage:', e);
        }

        // 2. Also populate session storage
        sessionStorage.setItem('saimetric_device_business_id', busId);
        sessionStorage.setItem('saimetric_device_role', role);
        sessionStorage.setItem('saimetric_device_owner_email', cleanEmail);

        setIsDeviceRegistered(true);
        setRegisteredCompanyId(busId);
        setRegisteredCompanyName(busName);
        setRegisteredEmail(cleanEmail);
        setAuthenticatedBusinessId(busId);
        setAuthenticatedRole(role);
        setAuthenticatedOwnerEmail(cleanEmail);

        setCurrentCompanyId(busId);
        setSelectedCompanyId(busId);
        setSelectedBranchId(branchId);
        setCurrentBranchId(branchId);

        // If Super Admin, allow instant administrative sign-in without spawning duplicate staff profiles
        if (role === 'SUPER_ADMIN' || cleanEmail === 'andrekudakwashe@gmail.com') {
          const targetNameLower = String(response.full_name || 'Andre Kudakwashe')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
          const matchedExistingOwner = getRawStoredSalespeople().find((s) => {
            const sEmail = (s.email || '').trim().toLowerCase();
            if (cleanEmail && sEmail === cleanEmail) return true;
            const sName = (s.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
            const sRole = String(s.role || '').toUpperCase();
            return (
              sName === targetNameLower &&
              (sRole === 'OWNER' || sRole === 'SUPER_ADMIN' || sRole === 'ADMIN')
            );
          });

          const superAdminUser: Salesperson = matchedExistingOwner
            ? {
                ...matchedExistingOwner,
                email: matchedExistingOwner.email || cleanEmail,
                role: 'SUPER_ADMIN',
                permissions: getOwnerDefaultPermissions(),
              }
            : {
                id: response.user_id || 'USR-MASTER-001',
                name: response.full_name || 'Andre Kudakwashe',
                role: 'SUPER_ADMIN',
                email: cleanEmail,
                active: 'Y',
                pin: '1234',
                companyId: 'COMP-MASTER',
                company_id: 'COMP-MASTER',
                branchId: 'BR-MAIN',
                branch_id: 'BR-MAIN',
                branchName: 'Head Office',
                permissions: getOwnerDefaultPermissions(),
              };

          if (!matchedExistingOwner) {
            saveSalesperson(superAdminUser);
          }
          setSessionUser(superAdminUser);
          logLogin(superAdminUser);
          handleCompleteLogin(superAdminUser);
          return;
        }

        // Navigate directly to Staff Selection Screen (Tier 2)
        setAuthTier('staff');
      } else {
        setOwnerError(response.message || 'Invalid credentials. Please verify your email and password.');
      }
    } catch (err: any) {
      setOwnerError(err.message || 'An error occurred connecting to Google Apps Script.');
    } finally {
      setIsOwnerSubmitting(false);
    }
  };

  const handleManualSyncTenants = async () => {
    setIsSyncingTenants(true);
    setSyncToast(null);
    try {
      await initializeSystemConfigAndSync();
      const fresh = getCompanies();
      setCompanies(fresh);
      setSyncToast(`✓ Synced ${fresh.length} stores from Master Cloud`);
      setTimeout(() => setSyncToast(null), 3500);
    } catch {
      setSyncToast('Using local store list');
      setTimeout(() => setSyncToast(null), 3000);
    } finally {
      setIsSyncingTenants(false);
    }
  };

  const verifyCasualPin = (pinToVerify: string, casual: TemporaryCasualAccount) => {
    if (isPinLockedOut) return;
    setIsLoading(true);
    setError(null);
    scrambleKeypad();

    try {
      const authenticated = authenticateCasualWorker(pinToVerify, casual.id);
      if (!authenticated) {
        setPin('');
        scrambleKeypad();
        const locked = registerFailedAttempt(casual.name, casual.id);
        if (!locked) {
          setError(`Incorrect Casual PIN for ${casual.name}. Keypad scrambled for security.`);
        }
        return;
      }

      setFailedPinAttempts(0);
      setPinLockoutUntil(0);

      const targetBranch = companyBranches.find((b) => (b.branchId || b.id) === selectedBranchId);
      const groupLabel = authenticated.assignedGroup === 'GROUP_1' ? 'Team A' : 'Team B';
      const casualUser: Salesperson = {
        id: authenticated.id,
        name: `${authenticated.name} (${groupLabel})`,
        role: 'CASHIER',
        phone: authenticated.phone,
        companyId: selectedCompanyId,
        company_id: selectedCompanyId,
        branchId: selectedBranchId,
        branch_id: selectedBranchId,
        branchName: targetBranch?.name || 'Main Branch',
        active: 'Y',
        isCasual: true,
        restrictedToSessionId: authenticated.sessionId,
        assignedGroup: authenticated.assignedGroup,
        assignedSegmentId: authenticated.assignedSegmentId,
        badgeNumber: authenticated.badgeNumber,
      };

      setCurrentCompanyId(selectedCompanyId);
      setCurrentBranchId(selectedBranchId);
      setSessionUser(casualUser);
      logLogin(casualUser);
      handleCompleteLogin(casualUser);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (num: string) => {
    if (isPinLockedOut || isLoading) return;
    setError(null);
    if (selectedCasual) {
      if (pin.length < 6) {
        const nextPin = pin + num;
        setPin(nextPin);
        if (nextPin.length >= 4 && authenticateCasualWorker(nextPin, selectedCasual.id)) {
          verifyCasualPin(nextPin, selectedCasual);
        } else if (nextPin.length === 6) {
          verifyCasualPin(nextPin, selectedCasual);
        }
      }
      return;
    }

    if (pin.length < 6) {
      const nextPin = pin + num;
      setPin(nextPin);
      if (nextPin.length === 6) {
        verifyPin(nextPin, selectedStaff);
      }
    }
  };

  const handleDelete = () => {
    if (isPinLockedOut) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (isPinLockedOut) return;
    setError(null);
    setPin('');
    scrambleKeypad();
  };

  const verifyPin = async (pinToVerify: string, staff: Salesperson | null) => {
    if (isPinLockedOut) return;
    if (!staff) {
      setError('Please select a staff member.');
      return;
    }

    setIsLoading(true);
    setError(null);
    scrambleKeypad();

    try {
      const response = await backendAuthService.authenticateStaff(
        selectedCompanyId,
        staff.id,
        staff.name,
        pinToVerify,
        selectedGuestPass ? selectedGuestPass.homeBranchId : selectedBranchId
      );

      if (response.status === 'success' || response.success === true) {
        setFailedPinAttempts(0);
        setPinLockoutUntil(0);

        const authenticatedUser = response.user;
        const targetBranch = companyBranches.find((b) => (b.branchId || b.id) === selectedBranchId);

        if (selectedGuestPass) {
          const visitingUser: Salesperson = {
            ...staff,
            id: authenticatedUser?.id || staff.id,
            name: authenticatedUser?.name || staff.name,
            role: 'CASHIER',
            companyId: authenticatedUser?.companyId || authenticatedUser?.company_id || staff.companyId || selectedCompanyId,
            company_id: authenticatedUser?.company_id || authenticatedUser?.companyId || staff.company_id || selectedCompanyId,
            branchId: selectedBranchId,
            branch_id: selectedBranchId,
            branchName: targetBranch?.name || selectedGuestPass.hostBranchName || 'Host Branch',
            isVisitingCounter: true,
            restrictedToSessionId: selectedGuestPass.sessionId,
            guestPassId: selectedGuestPass.id,
            homeBranchId: selectedGuestPass.homeBranchId,
            homeBranchName: selectedGuestPass.homeBranchName,
            assignedGroup: selectedGuestPass.assignedGroup,
            assignedSegmentIds: selectedGuestPass.assignedSegmentIds,
          };

          setCurrentCompanyId(visitingUser.companyId || selectedCompanyId);
          setCurrentBranchId(selectedBranchId);
          setSessionUser(visitingUser);
          logLogin(visitingUser);
          handleCompleteLogin(visitingUser);
          return;
        }

        const branchRole = getStaffRoleInBranch(staff, selectedBranchId);
        const branchPerms = staff.permissions || getRolePresetPermissions(branchRole);

        const fullStaffUser: Salesperson = {
          ...staff,
          id: authenticatedUser?.id || staff.id,
          name: authenticatedUser?.name || staff.name,
          role: (branchRole || authenticatedUser?.role || staff.role) as any,
          companyId: authenticatedUser?.companyId || authenticatedUser?.company_id || staff.companyId || selectedCompanyId,
          company_id: authenticatedUser?.company_id || authenticatedUser?.companyId || staff.company_id || selectedCompanyId,
          branchId: selectedBranchId,
          branch_id: selectedBranchId,
          branchName: targetBranch?.name || staff.branchName || 'Main Branch',
          permissions: branchPerms,
        };

        const existsLocally = getSalespeopleForCompany(selectedCompanyId).some((s) => s.id === fullStaffUser.id);
        if (!existsLocally && authenticatedUser) {
          saveSalesperson(
            {
              ...authenticatedUser,
              id: authenticatedUser.id || fullStaffUser.id,
              name: authenticatedUser.name || fullStaffUser.name,
              role: (authenticatedUser.role || fullStaffUser.role) as any,
              branchId: authenticatedUser.branchId || selectedBranchId,
              branch_id: authenticatedUser.branch_id || selectedBranchId,
            },
            { fromSync: true }
          );
        }

        setCurrentCompanyId(fullStaffUser.companyId || selectedCompanyId);
        setCurrentBranchId(selectedBranchId);
        setSessionUser(fullStaffUser);
        logLogin(fullStaffUser);
        handleCompleteLogin(fullStaffUser);
      } else {
        setPin('');
        scrambleKeypad();
        const locked = registerFailedAttempt(staff.name, staff.id);
        if (!locked) {
          setError(response.message || `Incorrect 6-digit PIN for ${staff.name}. Keypad scrambled.`);
        }
      }
    } catch (err: any) {
      setPin('');
      scrambleKeypad();
      const locked = registerFailedAttempt(staff.name, staff.id);
      if (!locked) {
        setError(err?.message || 'Authentication error verifying PIN.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickSelect = (staff: Salesperson) => {
    setSelectedGuestPassId(null);
    setSelectedCasualId(null);
    setSelectedStaffId(staff.id);
    setPin('');
    setError(null);
    scrambleKeypad();
  };

  const handleSelectGuestPass = (pass: StocktakeGuestPass) => {
    setSelectedCasualId(null);
    setSelectedGuestPassId(pass.id);
    setSelectedStaffId(pass.staffId);
    setPin('');
    setError(null);
    scrambleKeypad();
  };

  const handleSelectCasual = (casual: TemporaryCasualAccount) => {
    setSelectedGuestPassId(null);
    setSelectedStaffId(null);
    setSelectedCasualId(casual.id);
    setPin('');
    setError(null);
    scrambleKeypad();
  };

  const handleBranchSelect = (branchId: string) => {
    hasManuallyChangedBranchRef.current = true;
    const targetBr = companyBranches.find((b) => (b.branchId || b.id) === branchId);
    setSelectedBranchId(branchId);
    setCurrentBranchId(branchId);
    try {
      localStorage.setItem(LAST_SELECTED_BRANCH_KEY, branchId);
    } catch {}
    if (LocalHubConfig.getHubBranchId() === 'UNASSIGNED') {
      meshSyncService.sendHandshake(branchId, targetBr?.name || targetBr?.code);
    }
    setSelectedStaffId(null);
    setSelectedGuestPassId(null);
    setSelectedCasualId(null);
    setStaffCategoryFilter('all');
    setPin('');
    setError(null);
  };

  const handleStaffDropdownChange = (val: string) => {
    if (!val) return;
    if (val.startsWith('staff:')) {
      const id = val.slice(6);
      const found = companyStaff.find((s) => s.id === id);
      if (found) handleQuickSelect(found);
    } else if (val.startsWith('visiting:')) {
      const id = val.slice(9);
      const found = visitingPasses.find((p) => p.id === id);
      if (found) handleSelectGuestPass(found);
    } else if (val.startsWith('casual:')) {
      const id = val.slice(7);
      const found = branchCasuals.find((c) => c.id === id);
      if (found) handleSelectCasual(found);
    }
  };

  const handleDirectQuickLogin = (staff: Salesperson) => {
    handleQuickSelect(staff);
  };

  const handleManualSubmit = () => {
    if (isPinLockedOut) return;
    if (selectedCasual) {
      if (pin.length < 4) {
        setError('Please enter your 4-digit Casual Stocktake PIN.');
        return;
      }
      verifyCasualPin(pin, selectedCasual);
      return;
    }
    if (!selectedStaff) {
      setError('Please select a staff member first.');
      return;
    }
    if (pin.length !== 6) {
      setError('Please enter your complete 6-digit PIN.');
      return;
    }
    verifyPin(pin, selectedStaff);
  };

  // Keyboard shortcut listener (physical keyboard 0-9, Backspace, Enter, Esc)
  useEffect(() => {
    if (mode !== 'login') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Enter') {
        if (selectedCasual) {
          if (pin.length >= 4) {
            verifyCasualPin(pin, selectedCasual);
          }
        } else if (selectedStaff) {
          if (pin.length === 6) {
            verifyPin(pin, selectedStaff);
          } else if (pin.length === 0) {
            handleDirectQuickLogin(selectedStaff);
          }
        }
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, selectedStaff, selectedCasual, selectedGuestPass, mode, scrambledKeypad, isPinLockedOut]);

  // If in Register mode, show Registration Screen
  if (mode === 'register') {
    return (
      <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden overflow-y-auto bg-gradient-to-b from-slate-950 via-[#120d2b] to-slate-950 text-slate-100 flex flex-col justify-between p-3 sm:p-6">
        <RegistrationScreen
          onRegistrationSuccess={(owner) => handleCompleteLogin(owner)}
          onSwitchToLogin={() => setMode('login')}
        />
        <div className="text-center text-xs text-slate-500 pb-2">
          <p>SAIMETRIC Multi-Tenant SaaS Architecture • Isolated Branch Data</p>
        </div>
      </div>
    );
  }

  const currentCompany = companies.find((c) => c.company_id === selectedCompanyId) || companies[0];

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden overflow-y-auto bg-gradient-to-b from-slate-950 via-[#120d2b] to-slate-950 text-slate-100 flex flex-col justify-between p-2.5 sm:p-5 select-none">
      {/* Top Branding & Mode Toggle (Compact for Mobile Single-Screen Fit) */}
      <div className={`text-center max-w-md mx-auto w-full ${authTier === 'staff' ? 'pt-1 space-y-1.5 mb-2' : 'pt-2 sm:pt-4 space-y-3'}`}>
        {authTier === 'owner' ? (
          <>
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] p-0.5 shadow-[0_8px_30px_rgba(106,77,255,0.4)] flex items-center justify-center">
              <div className="w-full h-full bg-slate-950/80 rounded-[14px] flex items-center justify-center backdrop-blur-sm">
                <span className="text-2xl font-black text-white tracking-tighter">S</span>
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-wider text-white uppercase font-sans">
                SAIMETRIC
              </h1>
              <p className="text-xs text-slate-400 font-medium">
                Multi-Tenant Cloud &amp; Offline Point of Sale
              </p>
            </div>
            <div className="flex p-1 rounded-2xl bg-slate-900 border border-slate-800 text-xs font-bold">
              <button
                type="button"
                onClick={() => setMode('login')}
                className="flex-1 py-2 rounded-xl transition-all bg-[#6A4DFF] text-white shadow-md"
              >
                Sign In to Store
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className="flex-1 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 text-amber-400 hover:text-amber-300"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>14-Day Free Trial</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] p-0.5 shadow-md flex items-center justify-center shrink-0">
                <div className="w-full h-full bg-slate-950/90 rounded-[10px] flex items-center justify-center">
                  <span className="text-sm font-black text-white">S</span>
                </div>
              </div>
              <div className="text-left min-w-0">
                <h1 className="text-sm font-black tracking-wider text-white uppercase leading-none">
                  SAIMETRIC
                </h1>
                <span className="text-[10px] text-slate-400 font-medium block truncate">
                  Staff Terminal Access
                </span>
              </div>
            </div>

            {hubBranchId && hubBranchId !== 'UNASSIGNED' ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold shrink-0">
                <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span className="max-w-[110px] truncate">{hubBranchName || hubBranchId} Hub</span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-200 font-mono font-bold">
                  {hubBranchId}
                </span>
              </div>
            ) : connMode === 'LOCAL_HUB' ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[11px] font-semibold shrink-0">
                <Radio className="w-3 h-3 text-blue-400 animate-pulse" />
                <span>Local Hub</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-slate-400 text-[11px] font-medium shrink-0">
                <Wifi className="w-3 h-3 text-slate-500" />
                <span>Offline / Cloud</span>
              </div>
            )}
          </div>
        )}

        {/* Roaming Owner / Branch Mismatch Warning */}
        {hubBranchId &&
          hubBranchId !== 'UNASSIGNED' &&
          selectedBranchId &&
          selectedBranchId !== hubBranchId &&
          !selectedGuestPass &&
          !selectedCasual && (
            <div className="w-full p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-medium flex items-center gap-2 text-left">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Cloud-Only Mode:</strong> Selected branch differs from <strong>{hubBranchName || hubBranchId} Hub</strong>. Hub sync paused.
              </span>
            </div>
          )}
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md mx-auto bg-slate-900/85 border border-slate-800/80 backdrop-blur-xl rounded-3xl p-3.5 sm:p-5 shadow-2xl my-auto space-y-3">
        {/* Session Inactivity Timeout Banner */}
        {lockoutMessage && (
          <div className="bg-amber-950/80 border border-amber-600/80 text-amber-200 rounded-2xl p-3.5 flex items-start space-x-2.5 text-xs font-semibold animate-pulse">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-300 block">Session Inactivity Lockout</span>
              <p className="text-[11px] text-amber-200/90 leading-tight mt-0.5">{lockoutMessage}</p>
            </div>
          </div>
        )}

        {/* TIER 1: ONCE-OFF DEVICE REGISTRATION */}
        {authTier === 'owner' ? (
          <form onSubmit={handleOwnerLoginSubmit} className="space-y-4">
            {/* Header Badge */}
            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-bold">
                <Laptop className="w-3.5 h-3.5 text-purple-400" />
                <span>Step 1 • Terminal Device Registration</span>
              </div>
              <h2 className="text-base font-black text-white">Register Terminal Device</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Enter your account email and password to bind this device to your company. Device registration only needs to be completed once.
              </p>
            </div>

            {/* Error Banner */}
            {ownerError && (
              <div className="p-3 rounded-2xl bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-semibold flex items-start gap-2 animate-shake">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-tight">{ownerError}</span>
              </div>
            )}

            {/* Email Field */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-purple-400" />
                <span>Account Email Address</span>
              </label>
              <div className="relative">
                <input
                  id="owner-email-input"
                  type="email"
                  required
                  value={ownerEmail}
                  onChange={(e) => {
                    setOwnerEmail(e.target.value);
                    setOwnerError(null);
                  }}
                  placeholder="owner@yourbusiness.com"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-purple-500 transition placeholder:text-slate-600"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-purple-400" />
                  <span>Password</span>
                </label>
                <button
                  id="btn-forgot-password"
                  type="button"
                  onClick={() => setShowForgotPasswordModal(true)}
                  className="text-[11px] text-amber-400 hover:text-amber-300 font-bold transition hover:underline"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <input
                  id="owner-password-input"
                  type={showOwnerPassword ? 'text' : 'password'}
                  required
                  value={ownerPassword}
                  onChange={(e) => {
                    setOwnerPassword(e.target.value);
                    setOwnerError(null);
                  }}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 pr-10 text-xs font-medium focus:outline-none focus:border-purple-500 transition font-mono placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => setShowOwnerPassword(!showOwnerPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
                  title={showOwnerPassword ? 'Hide password' : 'Show password'}
                >
                  {showOwnerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              id="btn-owner-login"
              type="submit"
              disabled={isOwnerSubmitting}
              className="w-full py-3 px-4 rounded-2xl font-black text-xs sm:text-sm transition-all shadow-lg flex items-center justify-center space-x-2 bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white hover:opacity-95 active:scale-[0.98] shadow-purple-900/50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isOwnerSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Registering Device with Apps Script...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Register Device &amp; Continue</span>
                </>
              )}
            </button>

            {/* Lost / Replacement Device Restore from Backup */}
            <div className="pt-2 text-center border-t border-slate-800/80 space-y-2">
              <button
                id="btn-login-restore-backup"
                type="button"
                onClick={() => {
                  setRestoreMode('replace');
                  setShowRestoreModal(true);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Lost or New Device? Restore from Encrypted Backup</span>
              </button>

              {/* Quick Resume Link if Device is already registered */}
              {isDeviceRegistered && (
                <button
                  type="button"
                  onClick={() => setAuthTier('staff')}
                  className="text-xs text-purple-400 hover:text-purple-300 font-semibold inline-flex items-center gap-1.5 transition"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Resume Staff PIN Login for {registeredCompanyName || selectedCompanyId}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </form>
        ) : (
          /* TIER 2: COMPACT BRANCH DROPDOWN, RECENCY-SORTED STAFF DROPDOWN & SCRAMBLED PIN PAD */
          <div className="space-y-3">
            {/* Compact Authenticated Store Bar */}
            <div className="px-3 py-2 rounded-2xl bg-gradient-to-r from-purple-950/60 to-slate-900 border border-purple-500/30 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="font-black text-white text-xs sm:text-sm truncate">
                  {registeredCompanyName || companies.find((c) => c.company_id === selectedCompanyId)?.company_name || selectedCompanyId}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold text-[10px] shrink-0">
                  {selectedCompanyId}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowDeregisterModal(true)}
                className="text-[10px] px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold border border-slate-700 transition flex items-center gap-1 shrink-0 cursor-pointer"
                title="Deregister this device or switch to a different store"
              >
                <Unlink className="w-3 h-3 text-amber-400" />
                <span>Switch Store</span>
              </button>
            </div>

            {/* Store Branch Dropdown (Persists Last Selected Branch) */}
            {companyBranches.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="select-branch-dropdown"
                    className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"
                  >
                    <Building2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Store Branch</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    {branchLockdownSession ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-200 font-bold uppercase">
                        Lockdown Active
                      </span>
                    ) : branchActiveStocktakeCount > 0 ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 font-bold uppercase">
                        Stocktake Active
                      </span>
                    ) : null}
                    <span className="text-[10px] text-slate-500 font-medium">
                      {companyBranches.length} branch(es)
                    </span>
                  </div>
                </div>

                {companyBranches.length > 1 ? (
                  <div className="relative">
                    <MapPin className="w-3.5 h-3.5 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      id="select-branch-dropdown"
                      value={selectedBranchId}
                      onChange={(e) => handleBranchSelect(e.target.value)}
                      className="w-full appearance-none bg-slate-950 border border-slate-700/80 hover:border-purple-500/60 focus:border-[#6A4DFF] focus:outline-none text-white text-xs font-bold rounded-xl pl-8 pr-8 py-2.5 transition cursor-pointer"
                    >
                      {companyBranches.map((br, brIdx) => {
                        const id = br.branchId || br.id || (br as any).branch_id || `BR-${brIdx}`;
                        const codeTag = br.code ? ` (${br.code})` : '';
                        const curHubLower = String(hubBranchId || '').trim().toLowerCase();
                        const canonicalHub =
                          curHubLower === '1' || curHubLower === 'br-main' || curHubLower === 'br001'
                            ? 'BR-MAIN'
                            : hubBranchId;
                        const isHubBr = canonicalHub && canonicalHub === id;
                        return (
                          <option key={`${id}-${brIdx}`} value={id} className="bg-slate-950 text-white">
                            {br.name || br.code || id}
                            {codeTag}
                            {isHubBr ? ' • Local Hub' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-200 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span className="font-bold truncate">{companyBranches[0]?.name || 'Main Branch'}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {companyBranches[0]?.code || 'HQ-01'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Staff Dropdown Ordered by Terminal Last Login (Preserving Visiting & Casual Counters) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="select-staff-dropdown"
                  className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"
                >
                  <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                  <span>Select Operator</span>
                </label>

                {(visitingPasses.length > 0 || branchCasuals.length > 0) ? (
                  <div className="flex items-center gap-1 bg-slate-950/90 p-0.5 rounded-lg border border-slate-800 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setStaffCategoryFilter('all')}
                      className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                        staffCategoryFilter === 'all' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStaffCategoryFilter('staff');
                        if (selectedCasual || selectedGuestPass) {
                          if (defaultStaff) handleQuickSelect(defaultStaff);
                          else {
                            setSelectedGuestPassId(null);
                            setSelectedCasualId(null);
                            setSelectedStaffId(null);
                          }
                        }
                      }}
                      className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                        staffCategoryFilter === 'staff' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Staff ({companyStaff.length})
                    </button>
                    {visitingPasses.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setStaffCategoryFilter('visiting');
                          if (!selectedGuestPass && visitingPasses[0]) {
                            handleSelectGuestPass(visitingPasses[0]);
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                          staffCategoryFilter === 'visiting' ? 'bg-cyan-600 text-white' : 'text-cyan-300/80 hover:text-cyan-200'
                        }`}
                      >
                        Visiting ({visitingPasses.length})
                      </button>
                    )}
                    {branchCasuals.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setStaffCategoryFilter('casual');
                          if (!selectedCasual && branchCasuals[0]) {
                            handleSelectCasual(branchCasuals[0]);
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                          staffCategoryFilter === 'casual' ? 'bg-emerald-600 text-white' : 'text-emerald-300/80 hover:text-emerald-200'
                        }`}
                      >
                        Casual ({branchCasuals.length})
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-[10px] text-slate-500">
                    {companyStaff.length} user(s) • sorted by last login
                  </span>
                )}
              </div>

              {companyStaff.length === 0 && visitingPasses.length === 0 && branchCasuals.length === 0 ? (
                <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400 space-y-2">
                  <p>No staff accounts currently assigned to this branch.</p>
                  <button
                    type="button"
                    onClick={() => setShowDeregisterModal(true)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs inline-block cursor-pointer transition"
                  >
                    Switch Store / Account
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <KeyRound
                      className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${
                        selectedCasual ? 'text-emerald-400' : selectedGuestPass ? 'text-cyan-400' : 'text-purple-400'
                      }`}
                    />
                    <select
                      id="select-staff-dropdown"
                      value={
                        selectedCasual
                          ? `casual:${selectedCasual.id}`
                          : selectedGuestPass
                            ? `visiting:${selectedGuestPass.id}`
                            : selectedStaff
                              ? `staff:${selectedStaff.id}`
                              : ''
                      }
                      onChange={(e) => handleStaffDropdownChange(e.target.value)}
                      className={`w-full appearance-none bg-slate-950 border focus:outline-none text-white text-xs font-bold rounded-xl pl-8 pr-8 py-2.5 transition cursor-pointer ${
                        selectedCasual
                          ? 'border-emerald-500/70 focus:border-emerald-400'
                          : selectedGuestPass
                            ? 'border-cyan-500/70 focus:border-cyan-400'
                            : 'border-slate-700/80 hover:border-purple-500/60 focus:border-[#6A4DFF]'
                      }`}
                    >
                      {(staffCategoryFilter === 'all' || staffCategoryFilter === 'staff') && companyStaff.length > 0 && (
                        <optgroup label="Branch Staff (Most Recent First)" className="bg-slate-950 text-slate-300">
                          {companyStaff.map((staff) => {
                            const lastTs = terminalLastLoginMap[staff.id];
                            const rel = formatLastLoginRelative(lastTs);
                            return (
                              <option key={`staff-${staff.id}`} value={`staff:${staff.id}`} className="bg-slate-950 text-white">
                                {staff.name} • {staff.role}
                                {rel ? ` (Last: ${rel})` : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}

                      {(staffCategoryFilter === 'all' || staffCategoryFilter === 'visiting') && visitingPasses.length > 0 && (
                        <optgroup label="Visiting Stocktake Team (Cross-Branch Pass)" className="bg-slate-950 text-cyan-300">
                          {visitingPasses.map((pass) => {
                            const lastTs = terminalLastLoginMap[pass.staffId];
                            const rel = formatLastLoginRelative(lastTs);
                            return (
                              <option key={`visiting-${pass.id}`} value={`visiting:${pass.id}`} className="bg-slate-950 text-cyan-200">
                                ✈ {pass.staffName} • {pass.assignedGroup === 'GROUP_1' ? 'Team A' : 'Team B'} ({pass.homeBranchName || pass.homeBranchId})
                                {rel ? ` • ${rel}` : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}

                      {(staffCategoryFilter === 'all' || staffCategoryFilter === 'casual') && branchCasuals.length > 0 && (
                        <optgroup label="Casual Stocktake Counters (4-Digit PIN)" className="bg-slate-950 text-emerald-300">
                          {branchCasuals.map((casual) => {
                            const lastTs = terminalLastLoginMap[casual.id];
                            const rel = formatLastLoginRelative(lastTs);
                            return (
                              <option key={`casual-${casual.id}`} value={`casual:${casual.id}`} className="bg-slate-950 text-emerald-200">
                                📋 {casual.name}
                                {casual.badgeNumber ? ` #${casual.badgeNumber}` : ''} • {casual.assignedGroup === 'GROUP_1' ? 'Team A' : 'Team B'}
                                {rel ? ` • ${rel}` : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  {/* Quick 1-Tap Recent Shift Switch Chips */}
                  {recentQuickOperators.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-500 font-semibold">Recent:</span>
                      {recentQuickOperators.map((item) => {
                        const isItemSelected =
                          (item.kind === 'staff' && !selectedGuestPass && !selectedCasual && selectedStaff?.id === item.staff.id) ||
                          (item.kind === 'visiting' && selectedGuestPass?.id === item.pass.id) ||
                          (item.kind === 'casual' && selectedCasual?.id === item.casual.id);
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => {
                              if (item.kind === 'staff') handleQuickSelect(item.staff);
                              else if (item.kind === 'visiting') handleSelectGuestPass(item.pass);
                              else handleSelectCasual(item.casual);
                            }}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition cursor-pointer flex items-center gap-1 ${
                              isItemSelected
                                ? 'bg-purple-600/30 border-purple-400 text-white'
                                : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600'
                            }`}
                          >
                            <span>{item.label}</span>
                            <span className="text-[9px] opacity-75">({item.badge})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* PIN Entry Area */}
            {(selectedStaff || selectedCasual) && (
              <>
                <div className="text-center pt-0.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                      <Lock className={`w-3 h-3 ${selectedCasual ? 'text-emerald-400' : selectedGuestPass ? 'text-cyan-400' : 'text-amber-400'}`} />
                      <span>
                        {selectedCasual
                          ? '4-Digit Casual PIN'
                          : selectedGuestPass
                            ? 'Home 6-Digit Security PIN'
                            : '6-Digit Security PIN'}
                      </span>
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        id="btn-scramble-keypad"
                        type="button"
                        onClick={scrambleKeypad}
                        disabled={isPinLockedOut}
                        className="text-[10px] text-purple-300 hover:text-purple-200 font-bold flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-purple-950/60 border border-purple-800/60 hover:bg-purple-900/60 transition active:scale-95 cursor-pointer shadow-sm disabled:opacity-40"
                        title="Reshuffle keypad number positions"
                      >
                        <Shuffle className="w-2.5 h-2.5" />
                        <span>Scramble</span>
                      </button>
                      <span className={`text-[11px] font-mono ${selectedCasual ? 'text-emerald-300' : selectedGuestPass ? 'text-cyan-300' : 'text-purple-300'}`}>
                        {(selectedCasual?.name || selectedStaff?.name || '').split(' ')[0]}
                      </span>
                    </div>
                  </div>

                  {/* Masked PIN Dots (4 Digits for Casual or 6 Digits for Staff/Visiting) */}
                  <div className="flex items-center justify-center space-x-3 sm:space-x-4 mb-1.5">
                    {(selectedCasual && pin.length <= 4 ? [0, 1, 2, 3] : [0, 1, 2, 3, 4, 5]).map((index) => {
                      const isFilled = pin.length > index;
                      return (
                        <div
                          key={index}
                          className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                            isFilled
                              ? selectedCasual
                                ? 'bg-gradient-to-r from-emerald-500 to-cyan-400 scale-125 shadow-[0_0_12px_rgba(16,185,129,0.6)]'
                                : 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] scale-125 shadow-[0_0_12px_rgba(255,138,0,0.6)]'
                              : 'bg-slate-800 border border-slate-700'
                          }`}
                        />
                      );
                    })}
                  </div>

                  {/* Compact Security / Sandbox Status Pill */}
                  <div className="flex items-center justify-center gap-1.5 mb-1.5 flex-wrap">
                    {selectedCasual ? (
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-[10px] text-emerald-200">
                        <BadgeCheck className="w-3 h-3 text-emerald-400" />
                        <span>Casual Blind Sandbox • Auto-expires on commit</span>
                      </div>
                    ) : selectedGuestPass ? (
                      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-500/40 text-[10px] text-cyan-200">
                        <Plane className="w-3 h-3 text-cyan-400" />
                        <span>Visiting Pass • Home roster untouched</span>
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>Anti-peeking scrambled keypad</span>
                        {(() => {
                          const selComp = companies.find((c) => c.company_id === selectedCompanyId) || companies[0];
                          const bCfg = selComp ? getTenantBackendConfig(selComp) : null;
                          const adapter = bCfg ? getBackendAdapter(bCfg.backendType) : null;
                          if (!adapter) return null;
                          return (
                            <span className="text-slate-500">• {adapter.name}</span>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {isLoading && (
                    <div className="text-indigo-300 text-xs font-semibold flex items-center justify-center space-x-1.5 py-0.5 animate-pulse">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      <span>Verifying PIN...</span>
                    </div>
                  )}

                  {/* Lockout / Error Notification */}
                  {isPinLockedOut ? (
                    <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-bold flex items-center justify-center gap-1.5 mb-1">
                      <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span>Locked for {lockoutRemainingSec}s after failed PIN attempts</span>
                    </div>
                  ) : error ? (
                    <div className="text-rose-400 text-xs font-semibold flex items-center justify-center space-x-1.5 animate-shake mb-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  ) : null}
                </div>

                {/* Scrambled Numeric Numpad (Compact height so entire pad stays above mobile fold) */}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {scrambledKeypad.slice(0, 9).map((num) => (
                    <button
                      key={num}
                      id={`pin-btn-${num}`}
                      type="button"
                      onClick={() => handleKeyPress(num)}
                      disabled={isLoading || isPinLockedOut}
                      className="h-10 sm:h-11 rounded-2xl bg-slate-800/85 hover:bg-slate-700/80 active:bg-[#6A4DFF]/30 active:scale-95 text-lg font-bold font-mono text-white transition border border-slate-700/60 shadow-sm flex items-center justify-center cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {num}
                    </button>
                  ))}

                  <button
                    id="pin-btn-clear"
                    type="button"
                    onClick={handleClear}
                    disabled={isPinLockedOut}
                    className="h-10 sm:h-11 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 text-xs font-bold text-slate-400 hover:text-white transition border border-slate-700/40 flex items-center justify-center cursor-pointer disabled:opacity-40"
                    title="Clear digits & reshuffle"
                  >
                    Clear
                  </button>

                  <button
                    key={scrambledKeypad[9]}
                    id={`pin-btn-${scrambledKeypad[9]}`}
                    type="button"
                    onClick={() => handleKeyPress(scrambledKeypad[9])}
                    disabled={isLoading || isPinLockedOut}
                    className="h-10 sm:h-11 rounded-2xl bg-slate-800/85 hover:bg-slate-700/80 active:bg-[#6A4DFF]/30 active:scale-95 text-lg font-bold font-mono text-white transition border border-slate-700/60 shadow-sm flex items-center justify-center cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {scrambledKeypad[9]}
                  </button>

                  <button
                    id="pin-btn-delete"
                    type="button"
                    onClick={handleDelete}
                    disabled={isPinLockedOut}
                    className="h-10 sm:h-11 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 text-rose-300 hover:text-rose-200 transition border border-slate-700/40 flex items-center justify-center cursor-pointer disabled:opacity-40"
                    title="Delete digit"
                  >
                    <Delete className="w-5 h-5" />
                  </button>
                </div>

                {/* Submit Button */}
                <button
                  id="btn-submit-login"
                  type="button"
                  onClick={handleManualSubmit}
                  disabled={isLoading || isPinLockedOut}
                  className={`w-full py-2.5 sm:py-3 px-4 rounded-2xl font-black text-xs sm:text-sm transition-all shadow-lg flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                    (selectedCasual ? pin.length >= 4 : pin.length === 6)
                      ? selectedCasual
                        ? 'bg-gradient-to-r from-emerald-600 to-cyan-500 text-white hover:opacity-95 active:scale-[0.98] shadow-emerald-900/50 cursor-pointer'
                        : 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white hover:opacity-95 active:scale-[0.98] shadow-purple-900/50 cursor-pointer'
                      : 'bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 cursor-pointer'
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>
                    {isPinLockedOut
                      ? `Terminal Locked (${lockoutRemainingSec}s)`
                      : isLoading
                        ? 'Verifying PIN...'
                        : selectedCasual
                          ? `Log In as Casual (${selectedCasual.name})`
                          : selectedGuestPass
                            ? `Log In as Visiting (${selectedGuestPass.staffName})`
                            : `Log In as ${selectedStaff?.name || 'Staff'}`}
                  </span>
                </button>

                {/* Tier 2 Disaster Recovery / Restore Option */}
                <div className="pt-1 text-center border-t border-slate-800/80">
                  <button
                    id="btn-staff-restore-backup"
                    type="button"
                    onClick={() => {
                      setRestoreMode('append');
                      setShowRestoreModal(true);
                    }}
                    className="w-full py-1.5 px-3 rounded-xl bg-slate-950/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 font-medium text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer"
                    title="Restore or append records from encrypted backup file (.saimetric.enc)"
                  >
                    <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>Disaster Recovery &amp; Restore from Backup</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Forgot Password Modal (Step 3 Teaser & Spec) */}
      {showForgotPasswordModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-black text-white">Forgot Password</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForgotPasswordModal(false);
                  setRecoveryStatus(null);
                }}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter your registered owner email. In <span className="text-amber-400 font-bold">Step 3</span>, this will initiate the internationally approved password recovery flow (secure token verification) connecting directly to your Google Apps Script &amp; Sheets backend.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Registered Owner Email
                </label>
                <input
                  type="email"
                  value={recoveryEmail || ownerEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="owner@yourbusiness.com"
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:border-amber-500"
                />
              </div>

              {recoveryStatus && (
                <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-xs font-medium">
                  {recoveryStatus}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryStatus('Password recovery protocol is staged for Step 3. Your email has been validated.');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition shadow-md"
                >
                  Request Reset Token
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPasswordModal(false);
                    setRecoveryStatus(null);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deregister / Switch Store Modal */}
      {showDeregisterModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Unlink className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-black text-white">Switch Store / Terminal</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDeregisterModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This terminal is currently bound to{' '}
              <strong className="text-white">
                {registeredCompanyName || companies.find((c) => c.company_id === selectedCompanyId)?.company_name || selectedCompanyId}
              </strong>
              .
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Unlinking will return this device to Step 1 (Terminal Registration) so another store or business owner can register it.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleDeregisterDevice}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-1.5"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Unlink Terminal</span>
              </button>
              <button
                type="button"
                onClick={() => setShowDeregisterModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Encrypted Backup Restore Modal (Stage 1 & Stage 2) */}
      <DatabaseRestoreModal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        defaultMode={restoreMode}
        onRestoreSuccess={() => {
          // Force page refresh so restored company, staff, and state are immediately active
          window.location.reload();
        }}
      />

      {/* Footer info & Install App option */}
      <div className="text-center text-xs text-slate-500 pb-2 flex flex-col items-center space-y-2 max-w-sm mx-auto w-full">
        <PWAInstallButton variant="pill" />
        <p>SAIMETRIC Multi-Tenant SaaS Architecture • Isolated Branch Data</p>
      </div>
    </div>
  );
};
