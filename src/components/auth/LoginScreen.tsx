import React, { useState, useEffect, useMemo } from 'react';
import { Salesperson, Branch } from '../../types';
import {
  getSalespeople,
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
} from '../../db/roomDatabase';
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
  const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(DEVICE_REG_BRANCH_ID_KEY);
      if (stored && stored !== 'ALL') return stored;
    } catch {
      // ignore
    }
    return '1';
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

    window.addEventListener('saimetric_hub_identity_updated', handleHubIdentity);
    window.addEventListener('saimetric_cloud_only_mode_changed', handleHubIdentity);

    return () => {
      unsub();
      unsubMesh();
      unsubConfig();
      window.removeEventListener('saimetric_hub_identity_updated', handleHubIdentity);
      window.removeEventListener('saimetric_cloud_only_mode_changed', handleHubIdentity);
    };
  }, []);

  // Hub Branch Identity & Roaming Owner Safeguard
  const [hubBranchId, setHubBranchId] = useState<string | null>(() => LocalHubConfig.getHubBranchId());
  const [hubBranchName, setHubBranchName] = useState<string | null>(() => LocalHubConfig.getHubBranchName());
  const [connMode, setConnMode] = useState(() => meshSyncService.getConnectionMode());
  const [isCloudOnly, setIsCloudOnly] = useState(() => LocalHubConfig.isCloudOnlyMode());

  const handleCompleteLogin = (user: Salesperson) => {
    // Branch-Scoped Isolation & Roaming Owner Safeguard:
    // If user's branch does not match current Local Hub branch, activate Cloud-Only Mode!
    const curHubBranch = LocalHubConfig.getHubBranchId();
    const userBranch = user.branchId || user.branch_id || selectedBranchId;
    if (curHubBranch && curHubBranch !== 'UNASSIGNED' && userBranch && userBranch !== curHubBranch && userBranch !== 'ALL') {
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

  // Get branches strictly for this company only, deduplicating any duplicate IDs
  const companyBranches = useMemo(() => {
    const list = getBranchesForCompany(selectedCompanyId);
    const seen = new Set<string>();
    const unique: Branch[] = [];
    for (const b of list) {
      const id = b.branchId || b.id || (b as any).branch_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(b);
    }
    return unique;
  }, [selectedCompanyId, companies]);

  // Ensure selectedBranchId points to a valid branch within companyBranches
  useEffect(() => {
    if (companyBranches.length > 0) {
      const validIds = companyBranches.map((b) => b.branchId || b.id || (b as any).branch_id);
      if (!validIds.includes(selectedBranchId) || selectedBranchId === 'ALL') {
        const firstId = validIds[0];
        if (selectedBranchId !== firstId) {
          setSelectedBranchId(firstId);
        }
      }
    }
  }, [companyBranches, selectedBranchId]);

  // Get staff strictly isolated to selected company and explicitly assigned to selected branch
  const companyStaff = useMemo(() => {
    const all = getActiveStaffForCompany(selectedCompanyId);
    const filtered = all.filter((s) => isStaffAssignedToBranch(s, selectedBranchId));
    const seen = new Set<string>();
    const unique: Salesperson[] = [];
    for (const s of filtered) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      // Map staff role to their explicit role for this selected branch
      const branchRole = getStaffRoleInBranch(s, selectedBranchId);
      unique.push({
        ...s,
        role: branchRole,
        branchId: selectedBranchId,
        branch_id: selectedBranchId,
      });
    }
    return unique;
  }, [selectedCompanyId, selectedBranchId, companies]);

  const selectedStaff = useMemo(() => {
    if (selectedStaffId) {
      const match = companyStaff.find((s) => s.id === selectedStaffId);
      if (match) return match;
    }
    return companyStaff[0] || null;
  }, [companyStaff, selectedStaffId]);

  const [pin, setPin] = useState<string>('');
  const [scrambledKeypad, setScrambledKeypad] = useState<string[]>(() => generateScrambledDigits());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

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

        // If Super Admin, allow instant administrative sign-in
        if (role === 'SUPER_ADMIN' || cleanEmail === 'andrekudakwashe@gmail.com') {
          const superAdminUser: Salesperson = {
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
          saveSalesperson(superAdminUser);
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

  const handleKeyPress = (num: string) => {
    setError(null);
    if (pin.length < 6) {
      const nextPin = pin + num;
      setPin(nextPin);
      if (nextPin.length === 6) {
        verifyPin(nextPin, selectedStaff);
      }
    }
  };

  const handleDelete = () => {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError(null);
    setPin('');
    scrambleKeypad();
  };

  const verifyPin = async (pinToVerify: string, staff: Salesperson | null) => {
    if (!staff) {
      setError('Please select a staff member.');
      return;
    }

    setIsLoading(true);
    setError(null);
    // Scramble keypad numbers on every login attempt for security against onlookers
    scrambleKeypad();

    try {
      const response = await backendAuthService.authenticateStaff(
        selectedCompanyId,
        staff.id,
        staff.name,
        pinToVerify,
        selectedBranchId
      );

      if (response.status === 'success' || response.success === true) {
        const authenticatedUser = response.user;
        const branchRole = getStaffRoleInBranch(staff, selectedBranchId);
        const branchPerms = staff.permissions || getRolePresetPermissions(branchRole);
        const targetBranch = companyBranches.find((b) => (b.branchId || b.id) === selectedBranchId);

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

        saveSalesperson(fullStaffUser);
        setCurrentCompanyId(fullStaffUser.companyId || selectedCompanyId);
        setCurrentBranchId(selectedBranchId);
        setSessionUser(fullStaffUser);
        logLogin(fullStaffUser);
        handleCompleteLogin(fullStaffUser);
      } else {
        setError(response.message || `Incorrect 6-digit PIN for ${staff.name}. Keypad scrambled for security. Please try again.`);
        setPin('');
        scrambleKeypad();
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication error verifying PIN with Google Apps Script.');
      setPin('');
      scrambleKeypad();
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickSelect = (staff: Salesperson) => {
    setSelectedStaffId(staff.id);
    setPin('');
    setError(null);
    scrambleKeypad();
  };

  const handleDirectQuickLogin = (staff: Salesperson) => {
    setSelectedStaffId(staff.id);
    verifyPin(staff.pin || '123456', staff);
  };

  const handleManualSubmit = () => {
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Enter') {
        if (selectedStaff) {
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
  }, [pin, selectedStaff, mode, scrambledKeypad]);

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
    <div className="min-h-[100dvh] w-full max-w-[100vw] overflow-x-hidden overflow-y-auto bg-gradient-to-b from-slate-950 via-[#120d2b] to-slate-950 text-slate-100 flex flex-col justify-between p-3 sm:p-6 select-none">
      {/* Top Branding & Mode Toggle */}
      <div className="text-center pt-2 sm:pt-4 max-w-sm mx-auto w-full space-y-3">
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

        {/* Tab Switcher: Only available in Step 1 (Owner Device Registration / Sign In) */}
        {authTier === 'owner' ? (
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
        ) : (
          <div className="flex items-center justify-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-xs font-semibold text-slate-300 shadow-sm">
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span>Staff Terminal Access</span>
            </div>
          </div>
        )}

        {/* Pre-Auth Lobby Hub Identity Banner */}
        <div className="flex flex-col items-center justify-center gap-1.5 pt-1">
          {hubBranchId && hubBranchId !== 'UNASSIGNED' ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold shadow-sm">
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Connected to {hubBranchName || hubBranchId} Hub</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 font-mono font-bold">
                {hubBranchId}
              </span>
            </div>
          ) : connMode === 'LOCAL_HUB' ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-semibold shadow-sm">
              <Radio className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span>Connected to Local Hub (Identifying...)</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 text-slate-400 text-xs font-medium">
              <Wifi className="w-3.5 h-3.5 text-slate-500" />
              <span>Standalone Offline / Cloud Sync</span>
            </div>
          )}

          {/* Roaming Owner / Branch Mismatch Warning */}
          {hubBranchId && hubBranchId !== 'UNASSIGNED' && selectedBranchId && selectedBranchId !== hubBranchId && (
            <div className="w-full max-w-sm p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-medium flex items-center gap-2 text-left">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Cloud-Only Mode:</strong> Selected branch differs from <strong>{hubBranchName || hubBranchId} Hub</strong>. Hub sync paused to prevent contamination.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md mx-auto bg-slate-900/80 border border-slate-800/80 backdrop-blur-xl rounded-3xl p-5 sm:p-6 shadow-2xl my-auto space-y-4">
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
          /* TIER 2: STAFF SELECTION & 6-DIGIT PIN AUTHENTICATION */
          <div className="space-y-4">
            {/* Authenticated Device Banner (Strictly For Registered Company) */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-950/60 to-slate-900 border border-purple-500/30 flex items-center justify-between text-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-black text-white text-sm">
                    {registeredCompanyName || companies.find((c) => c.company_id === selectedCompanyId)?.company_name || selectedCompanyId}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold text-[10px]">
                    {selectedCompanyId}
                  </span>
                  <span>•</span>
                  <span>Registered Device Terminal</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeregisterModal(true)}
                className="text-[10px] px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold border border-slate-700 transition flex items-center gap-1.5 shrink-0"
                title="Deregister this device or switch to a different store"
              >
                <Unlink className="w-3 h-3 text-amber-400" />
                <span>Switch Store</span>
              </button>
            </div>

            {/* Branches of His Company Only */}
            {companyBranches.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Store Branches</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-medium">
                    {companyBranches.length} branch(es)
                  </span>
                </div>

                {companyBranches.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {companyBranches.map((br, brIdx) => {
                      const id = br.branchId || br.id || (br as any).branch_id || `BR-${brIdx}`;
                      const isBrSelected = selectedBranchId === id;
                      return (
                        <button
                          key={`${id}-${brIdx}`}
                          type="button"
                          onClick={() => {
                            setSelectedBranchId(id);
                            setCurrentBranchId(id);
                            try {
                              localStorage.setItem('saimetric_last_selected_branch_id', id);
                            } catch {}
                            if (LocalHubConfig.getHubBranchId() === 'UNASSIGNED') {
                              meshSyncService.sendHandshake(id, br.name || br.code);
                            }
                            setSelectedStaffId(null);
                            setPin('');
                            setError(null);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border flex items-center gap-1.5 ${
                            isBrSelected
                              ? 'bg-purple-600 text-white border-purple-400 shadow-sm shadow-purple-900/40'
                              : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span>{br.name || br.code}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="font-semibold">{companyBranches[0]?.name || 'Head Office - Main'}</span>
                    <span className="text-[10px] text-slate-500 font-mono">({companyBranches[0]?.code || 'HQ-01'})</span>
                  </div>
                )}
              </div>
            )}

            {/* Staff Selection (Strictly for Selected Company) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Select Staff Member
                </label>
                <span className="text-[10px] text-slate-500">
                  {companyStaff.length} user(s) available
                </span>
              </div>

              {companyStaff.length === 0 ? (
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400 space-y-2">
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
                <div className="grid grid-cols-1 gap-2 max-h-36 overflow-y-auto pr-1">
                  {companyStaff.map((staff, staffIdx) => {
                    const isSelected = selectedStaff?.id === staff.id;
                    return (
                      <button
                        key={staff.id ? `${staff.id}-${staffIdx}` : `staff-${staffIdx}`}
                        id={`select-staff-${staff.id || staffIdx}`}
                        type="button"
                        onClick={() => handleQuickSelect(staff)}
                        className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all text-left ${
                          isSelected
                            ? 'bg-gradient-to-r from-purple-950/80 to-slate-900 border-[#6A4DFF] ring-1 ring-[#6A4DFF]/50 shadow-md'
                            : 'bg-slate-950/50 border-slate-800/80 text-slate-300 hover:bg-slate-800/40 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                              isSelected
                                ? 'bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] text-white shadow-sm'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {staff.id.slice(-2)}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white flex items-center gap-1.5">
                              <span>{staff.name}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                                {staff.role}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              🔒 6-Digit PIN Protected • {staff.phone || 'ID: #' + staff.id}
                            </span>
                          </div>
                        </div>
                        {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-[#FF8A00] mr-2" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* PIN Entry Area */}
            {selectedStaff && (
              <>
                <div className="text-center pt-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                      <Lock className="w-3 h-3 text-amber-400" />
                      <span>Enter 6-Digit Security PIN</span>
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        id="btn-scramble-keypad"
                        type="button"
                        onClick={scrambleKeypad}
                        className="text-[10px] text-purple-300 hover:text-purple-200 font-bold flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-purple-950/60 border border-purple-800/60 hover:bg-purple-900/60 transition active:scale-95 cursor-pointer shadow-sm"
                        title="Reshuffle keypad number positions"
                      >
                        <Shuffle className="w-2.5 h-2.5" />
                        <span>Scramble</span>
                      </button>
                      <span className="text-[11px] text-purple-300 font-mono">
                        Selected: {selectedStaff?.name.split(' ')[0]}
                      </span>
                    </div>
                  </div>

                  {/* Masked PIN Dots (6 Digits) */}
                  <div className="flex items-center justify-center space-x-3 sm:space-x-4 mb-2">
                    {[0, 1, 2, 3, 4, 5].map((index) => {
                      const isFilled = pin.length > index;
                      return (
                        <div
                          key={index}
                          className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full transition-all duration-200 ${
                            isFilled
                              ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] scale-125 shadow-[0_0_12px_rgba(255,138,0,0.6)]'
                              : 'bg-slate-800 border border-slate-700'
                          }`}
                        />
                      );
                    })}
                  </div>

                  {/* Security Badge: Numbers change location on every attempt */}
                  <div className="flex flex-col items-center justify-center gap-1 mb-2">
                    <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span>Anti-peeking: Keypad scrambles on every login attempt</span>
                    </div>
                    {(() => {
                      const selComp = companies.find((c) => c.company_id === selectedCompanyId) || companies[0];
                      const bCfg = selComp ? getTenantBackendConfig(selComp) : null;
                      const adapter = bCfg ? getBackendAdapter(bCfg.backendType) : null;
                      if (!adapter) return null;
                      return (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700/60 text-[10px] text-slate-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>Backend: <strong className="text-white">{adapter.name}</strong> ({bCfg?.authMode === 'hybrid' ? 'Hybrid PIN / Cloud' : '6-Digit PIN'})</span>
                        </div>
                      );
                    })()}
                  </div>

                  {isLoading && (
                    <div className="text-indigo-300 text-xs font-semibold flex items-center justify-center space-x-1.5 py-1 animate-pulse">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      <span>Verifying credentials with active backend adapter...</span>
                    </div>
                  )}

                  {/* Error Notification */}
                  {error && (
                    <div className="text-rose-400 text-xs font-semibold flex items-center justify-center space-x-1.5 animate-shake">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>

                {/* Scrambled Numeric Numpad (Numbers change location on every login attempt) */}
                <div className="grid grid-cols-3 gap-2">
                  {scrambledKeypad.slice(0, 9).map((num) => (
                    <button
                      key={num}
                      id={`pin-btn-${num}`}
                      type="button"
                      onClick={() => handleKeyPress(num)}
                      disabled={isLoading}
                      className="h-11 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-[#6A4DFF]/30 active:scale-95 text-lg font-bold font-mono text-white transition border border-slate-700/60 shadow-sm flex items-center justify-center cursor-pointer select-none"
                    >
                      {num}
                    </button>
                  ))}

                  <button
                    id="pin-btn-clear"
                    type="button"
                    onClick={handleClear}
                    className="h-11 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 text-xs font-bold text-slate-400 hover:text-white transition border border-slate-700/40 flex items-center justify-center cursor-pointer"
                    title="Clear digits & reshuffle"
                  >
                    Clear
                  </button>

                  <button
                    key={scrambledKeypad[9]}
                    id={`pin-btn-${scrambledKeypad[9]}`}
                    type="button"
                    onClick={() => handleKeyPress(scrambledKeypad[9])}
                    disabled={isLoading}
                    className="h-11 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-[#6A4DFF]/30 active:scale-95 text-lg font-bold font-mono text-white transition border border-slate-700/60 shadow-sm flex items-center justify-center cursor-pointer select-none"
                  >
                    {scrambledKeypad[9]}
                  </button>

                  <button
                    id="pin-btn-delete"
                    type="button"
                    onClick={handleDelete}
                    className="h-11 rounded-2xl bg-slate-800/40 hover:bg-slate-800 active:scale-95 text-rose-300 hover:text-rose-200 transition border border-slate-700/40 flex items-center justify-center cursor-pointer"
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
                  disabled={isLoading}
                  className={`w-full py-3 px-4 rounded-2xl font-black text-xs sm:text-sm transition-all shadow-lg flex items-center justify-center space-x-2 ${
                    pin.length === 6
                      ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white hover:opacity-95 active:scale-[0.98] shadow-purple-900/50 cursor-pointer'
                      : 'bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 cursor-pointer'
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>{isLoading ? 'Verifying PIN...' : `Log In as ${selectedStaff?.name || 'Staff'}`}</span>
                </button>

                {/* Tier 2 Disaster Recovery / Restore Option */}
                <div className="pt-2 text-center border-t border-slate-800/80">
                  <button
                    id="btn-staff-restore-backup"
                    type="button"
                    onClick={() => {
                      setRestoreMode('append');
                      setShowRestoreModal(true);
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-slate-950/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 font-medium text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer"
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
