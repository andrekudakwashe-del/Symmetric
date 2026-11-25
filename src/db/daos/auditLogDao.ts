import { AuditLogEntry, Branch, Salesperson } from '../../types';
import { STORAGE_KEYS } from '../storageKeys';

const TERMINAL_LAST_LOGIN_KEY = 'saimetric_terminal_last_login_map';

export interface AuditLogDaoDeps {
  getStored: <T>(key: string, defaultValue: T) => T;
  setStored: <T>(key: string, value: T) => void;
  initialAuditLogs: AuditLogEntry[];
  getCurrentBranchId: () => string;
  getCurrentCompanyId: () => string;
  getBranches: () => Branch[];
  isCompanyInTenantScope: (companyId: string | undefined, currentCompany: string) => boolean;
  isRecordInBranchScope: (
    recordBranchId: string | undefined,
    targetBranchId: string,
    branches?: Branch[],
    currentCompany?: string,
    recordCompanyId?: string
  ) => boolean;
  enqueueSync: (sheet: any, action: 'INSERT' | 'UPDATE' | 'DELETE', data: any) => void;
  getCurrentUser: () => Salesperson | null;
}

export interface AuditLogAddInput
  extends Omit<AuditLogEntry, 'id' | 'timestamp' | 'date' | 'time'> {
  timestamp?: string;
  date?: string;
  time?: string;
  id?: string;
  company_id?: string;
  companyId?: string;
  branch_id?: string;
  branchId?: string;
}

export interface ManagerOverrideLogParams {
  action:
    | 'DISCOUNT_OVERRIDE'
    | 'VOID_CART'
    | 'REFUND_INVOICE'
    | 'VOID_INVOICE'
    | 'ITEM_EXCHANGE'
    | 'REFUND_VOID';
  manager: Salesperson;
  cashier?: Salesperson | null;
  details: string;
  amount?: number;
  referenceId?: string;
  metadata?: Record<string, any>;
}

/**
 * Modular Audit Log DAO factory (Phase 3B roomDatabase decomposition).
 * Accepts runtime dependencies via getters to keep zero circular imports
 * and allow isolated unit testing.
 */
export const createAuditLogDao = (deps: AuditLogDaoDeps) => {
  const getRawStoredAuditLogs = (): AuditLogEntry[] => {
    const logs = deps.getStored<AuditLogEntry[]>(STORAGE_KEYS.AUDIT_LOGS, deps.initialAuditLogs);
    if (!Array.isArray(logs)) return [];
    const seenIds = new Set<string>();
    let hasDuplicates = false;
    const sanitized = logs.map((l, index) => {
      const rawId = (l?.id || '').trim();
      if (!rawId || seenIds.has(rawId)) {
        hasDuplicates = true;
        const baseId = rawId || 'AUD';
        const uniqueId = `${baseId}-dup-${index + 1}-${Math.floor(1000 + Math.random() * 9000)}`;
        seenIds.add(uniqueId);
        return { ...l, id: uniqueId };
      }
      seenIds.add(rawId);
      return { ...l, id: rawId };
    });
    if (hasDuplicates) {
      deps.setStored(STORAGE_KEYS.AUDIT_LOGS, sanitized);
    }
    return sanitized;
  };

  const getAllAuditLogs = (branchId?: string): AuditLogEntry[] => {
    const currentBranch = branchId || deps.getCurrentBranchId();
    const currentCompany = deps.getCurrentCompanyId();
    const raw = getRawStoredAuditLogs();
    if (!currentBranch || currentBranch === 'ALL') {
      return raw.filter((a) =>
        deps.isCompanyInTenantScope(a.company_id || a.companyId, currentCompany)
      );
    }
    const branches = deps.getBranches();
    return raw.filter((a) => {
      const cId = a.company_id || a.companyId;
      const brId = a.branch_id || a.branchId;
      return deps.isRecordInBranchScope(brId, currentBranch, branches, currentCompany, cId);
    });
  };

  const getAuditLogs = (): AuditLogEntry[] => {
    return getAllAuditLogs();
  };

  const addAuditLog = (entry: AuditLogAddInput): AuditLogEntry => {
    const all = getRawStoredAuditLogs();
    const now = new Date();
    const currentCompany = deps.getCurrentCompanyId();
    const currentBranch = deps.getCurrentBranchId();
    const dateStr = entry.date || now.toISOString().split('T')[0];
    const timeStr = entry.time || now.toTimeString().split(' ')[0];

    let id = entry.id;
    if (!id || all.some((l) => l.id === id)) {
      const rand = Math.floor(1000 + Math.random() * 9000);
      id = `AUD-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-6)}-${rand}`;
    }
    const compId = entry.company_id || entry.companyId || currentCompany;
    const brId = entry.branch_id || entry.branchId || currentBranch;

    const newLog: AuditLogEntry = {
      id,
      timestamp: entry.timestamp || now.toISOString(),
      date: dateStr,
      time: timeStr,
      action: entry.action,
      severity: entry.severity,
      staffId: entry.staffId,
      staffName: entry.staffName,
      staffRole: entry.staffRole,
      authorizedById: entry.authorizedById,
      authorizedByName: entry.authorizedByName,
      authorizedByRole: entry.authorizedByRole,
      details: entry.details,
      referenceId: entry.referenceId,
      amount: entry.amount,
      metadata: entry.metadata,
      company_id: compId,
      companyId: compId,
      branch_id: brId,
      branchId: brId,
    };

    const updated = [newLog, ...all];
    deps.setStored(STORAGE_KEYS.AUDIT_LOGS, updated);

    // Decouple routine INFO audit logs (e.g. logins/logouts/UI checks) from the critical Sheets transactional queue.
    // Critical compliance events (price changes, overrides, voids, warnings, critical severity) are queued to Sheets.
    if (
      newLog.severity === 'WARNING' ||
      newLog.severity === 'CRITICAL' ||
      newLog.action === 'PRICE_CHANGE' ||
      newLog.action === 'DISCOUNT_OVERRIDE' ||
      newLog.action === 'REFUND_INVOICE' ||
      newLog.action === 'VOID_INVOICE'
    ) {
      deps.enqueueSync('Audit_Log', 'INSERT', newLog);
    }
    return newLog;
  };

  const getTerminalLastLoginMap = (branchId?: string): Record<string, number> => {
    try {
      if (typeof localStorage === 'undefined') return {};
      const raw = localStorage.getItem(TERMINAL_LAST_LOGIN_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const branchKey = String(branchId || deps.getCurrentBranchId() || 'BR-MAIN')
        .trim()
        .toUpperCase();
      const map = parsed?.[branchKey];
      return map && typeof map === 'object' ? map : {};
    } catch {
      return {};
    }
  };

  const recordTerminalLogin = (staffId: string, branchId?: string): void => {
    if (!staffId || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(TERMINAL_LAST_LOGIN_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const branchKey = String(branchId || deps.getCurrentBranchId() || 'BR-MAIN')
        .trim()
        .toUpperCase();
      const prevBranchMap =
        parsed[branchKey] && typeof parsed[branchKey] === 'object' ? parsed[branchKey] : {};
      parsed[branchKey] = {
        ...prevBranchMap,
        [staffId]: Date.now(),
      };
      localStorage.setItem(TERMINAL_LAST_LOGIN_KEY, JSON.stringify(parsed));
    } catch {
      // ignore storage errors
    }
  };

  const logLogin = (staff: Salesperson): void => {
    recordTerminalLogin(staff.id, staff.branchId || staff.branch_id);
    const pinLabel = staff.isCasual ? '4-digit casual PIN' : '6-digit security PIN';
    addAuditLog({
      action: 'LOGIN',
      severity: 'INFO',
      staffId: staff.id,
      staffName: staff.name,
      staffRole: staff.role,
      details: `User ${staff.name} (${staff.role}) successfully authenticated with ${pinLabel}.`,
    });
  };

  const logLogout = (staff: Salesperson, reason: string = 'User clicked Logout'): void => {
    addAuditLog({
      action: 'LOGOUT',
      severity: 'INFO',
      staffId: staff.id,
      staffName: staff.name,
      staffRole: staff.role,
      details: `User ${staff.name} (${staff.role}) signed out. Reason: ${reason}.`,
    });
  };

  const logSessionTimeout = (staff: Salesperson): void => {
    addAuditLog({
      action: 'SESSION_TIMEOUT',
      severity: 'WARNING',
      staffId: staff.id,
      staffName: staff.name,
      staffRole: staff.role,
      details: `Security Auto-Lock: User ${staff.name} (${staff.role}) automatically logged out after 5 minutes of inactivity.`,
    });
  };

  const logManagerOverride = (params: ManagerOverrideLogParams): void => {
    const cashierStaff = params.cashier || deps.getCurrentUser() || params.manager;
    addAuditLog({
      action: params.action,
      severity: params.action === 'REFUND_INVOICE' ? 'CRITICAL' : 'SECURITY',
      staffId: cashierStaff.id,
      staffName: cashierStaff.name,
      staffRole: cashierStaff.role,
      authorizedById: params.manager.id,
      authorizedByName: params.manager.name,
      authorizedByRole: params.manager.role,
      amount: params.amount,
      referenceId: params.referenceId,
      details: params.details,
      metadata: params.metadata,
    });
  };

  return {
    getRawStoredAuditLogs,
    getAllAuditLogs,
    getAuditLogs,
    addAuditLog,
    getTerminalLastLoginMap,
    recordTerminalLogin,
    logLogin,
    logLogout,
    logSessionTimeout,
    logManagerOverride,
  };
};
