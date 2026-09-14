import {
  Salesperson,
  StaffBranchAssignment,
  Role,
  Customer,
  Supplier,
  Branch,
  CashCountRecord,
  CashLogEntry,
  SaleInvoice,
  ExpenseEntry,
  ShiftReconciliation,
  CustomerChangeEntry,
  CreditSaleEntry,
  AdminSalesEntry,
  SyncQueueItem,
  SheetName,
  GoogleSheetsConfig,
  CustomerChangeReportItem,
  CustomerCreditReportItem,
  Product,
  CartItem,
  ParkedSale,
  InventoryItem,
  PackagingVariant,
  GoodsReceivedEntry,
  SupplierInvoiceVoucher,
  SupplierInvoiceLineItem,
  StockMovementEntry,
  StockTxnType,
  StockPromptResponse,
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  StocktakeVerifiedLine,
  StocktakeConsolidatedItem,
  StockBatch,
  NegativeBalanceEntry,
  AuditLogEntry,
  AuditAction,
  DirectGrv,
  DirectGrvItem,
  DirectGrvTillPayment,
  GrvStatus,
  GrvType,
} from '../types';
import {
  Company,
  SaaSBranch,
  SaaSUser,
  PermissionRule,
  MASTER_PERMISSIONS_52,
  SEED_COMPANIES,
  SEED_BRANCHES,
  SEED_USERS,
} from '../data/saasData';
import {
  INITIAL_SALESPEOPLE,
  INITIAL_CUSTOMERS,
  INITIAL_SUPPLIERS,
  INITIAL_BRANCHES,
  INITIAL_CASH_LOGS,
  INITIAL_SALES,
  INITIAL_EXPENSES,
  INITIAL_CUSTOMER_CHANGES,
  INITIAL_CREDIT_SALES,
  INITIAL_PRODUCTS,
  INITIAL_INVENTORY_ITEMS,
  INITIAL_GOODS_RECEIVED,
  INITIAL_SUPPLIER_INVOICES,
  INITIAL_STOCK_MOVEMENTS,
  INITIAL_STOCKTAKE_SESSIONS,
  INITIAL_AUDIT_LOGS,
} from '../data/initialData';

const STORAGE_KEYS = {
  SALESPEOPLE: 'saimetric_room_salespeople',
  CUSTOMERS: 'saimetric_room_customers',
  SUPPLIERS: 'saimetric_room_suppliers',
  BRANCHES: 'saimetric_room_branches',
  PRODUCTS: 'saimetric_room_products',
  INVENTORY_ITEMS: 'saimetric_room_inventory_items',
  GOODS_RECEIVED: 'saimetric_room_goods_received',
  SUPPLIER_INVOICES: 'saimetric_room_supplier_invoices',
  STOCK_MOVEMENTS: 'saimetric_room_stock_movements',
  STOCKTAKE_SESSIONS: 'saimetric_room_stocktake_sessions',
  CASH_COUNTS: 'saimetric_room_cash_counts',
  CASH_LOGS: 'saimetric_room_cash_logs',
  CUSTOMER_CHANGES: 'saimetric_room_customer_changes',
  CREDIT_SALES: 'saimetric_room_credit_sales',
  SALES: 'saimetric_room_sales',
  EXPENSES: 'saimetric_room_expenses',
  RECONCILIATIONS: 'saimetric_room_reconciliations',
  ADMIN_SALES: 'saimetric_room_admin_sales',
  SYNC_QUEUE: 'saimetric_room_sync_queue',
  SESSION_USER: 'saimetric_room_session_user',
  SHEETS_CONFIG: 'saimetric_room_sheets_config',
  OFFLINE_MODE: 'saimetric_room_offline_mode',
  PARKED_SALES: 'saimetric_room_parked_sales',
  STOCK_BATCHES: 'saimetric_room_stock_batches',
  NEGATIVE_BALANCES: 'saimetric_room_negative_balances',
  CATEGORIES: 'saimetric_room_categories',
  AUDIT_LOGS: 'saimetric_room_audit_logs',
  DIRECT_GRVS: 'saimetric_room_direct_grvs',
  COMPANIES: 'saimetric_room_companies',
  CURRENT_COMPANY_ID: 'saimetric_room_current_company_id',
  CURRENT_BRANCH_ID: 'saimetric_room_current_branch_id',
  PERMISSIONS: 'saimetric_room_permissions',
};

type Listener = () => void;
const listeners: Set<Listener> = new Set();

export const subscribeToDatabase = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const subscribeRoomDatabase = subscribeToDatabase;

let notifyScheduled = false;
let notifyDepth = 0;
const MAX_NOTIFY_DEPTH = 8;

const notifyListeners = () => {
  if (notifyScheduled) return;
  notifyScheduled = true;
  // Use queueMicrotask to ensure state updates never occur synchronously during another component's render phase
  queueMicrotask(() => {
    notifyScheduled = false;
    if (notifyDepth >= MAX_NOTIFY_DEPTH) {
      console.warn('Database notification depth limit reached. Breaking potential notification loop.');
      notifyDepth = 0;
      return;
    }
    notifyDepth++;
    try {
      listeners.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error('Listener error:', e);
        }
      });
    } finally {
      queueMicrotask(() => {
        notifyDepth = 0;
      });
    }
  });
};

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${key} from storage:`, err);
    return fallback;
  }
}

function setStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    notifyListeners();
  } catch (err) {
    console.error(`Error writing ${key} to storage:`, err);
  }
}

// Initialize Database with Defaults if empty
export const initRoomDatabase = () => {
  if (!localStorage.getItem(STORAGE_KEYS.SALESPEOPLE)) {
    setStored(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  }
  if (!localStorage.getItem(STORAGE_KEYS.CUSTOMERS)) {
    setStored(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.SUPPLIERS)) {
    setStored(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.BRANCHES)) {
    setStored(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.SUPPLIER_INVOICES)) {
    setStored(STORAGE_KEYS.SUPPLIER_INVOICES, INITIAL_SUPPLIER_INVOICES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.INVENTORY_ITEMS)) {
    setStored(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  }
  
  // Unify PRODUCTS with INVENTORY_ITEMS so POS Counter and Inventory Master share the same database
  const currentInv = getStored<InventoryItem[]>(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  setStored(STORAGE_KEYS.PRODUCTS, currentInv.map(inventoryItemToProduct));

  if (!localStorage.getItem(STORAGE_KEYS.CASH_LOGS)) {
    setStored(STORAGE_KEYS.CASH_LOGS, INITIAL_CASH_LOGS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.CUSTOMER_CHANGES)) {
    setStored(STORAGE_KEYS.CUSTOMER_CHANGES, INITIAL_CUSTOMER_CHANGES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.CREDIT_SALES)) {
    setStored(STORAGE_KEYS.CREDIT_SALES, INITIAL_CREDIT_SALES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.SALES)) {
    setStored(STORAGE_KEYS.SALES, INITIAL_SALES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.EXPENSES)) {
    setStored(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
  }
  if (!localStorage.getItem(STORAGE_KEYS.CASH_COUNTS)) {
    setStored(STORAGE_KEYS.CASH_COUNTS, []);
  }
  if (!localStorage.getItem(STORAGE_KEYS.GOODS_RECEIVED)) {
    setStored(STORAGE_KEYS.GOODS_RECEIVED, INITIAL_GOODS_RECEIVED);
  }
  if (!localStorage.getItem(STORAGE_KEYS.STOCK_MOVEMENTS)) {
    setStored(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.STOCKTAKE_SESSIONS)) {
    setStored(STORAGE_KEYS.STOCKTAKE_SESSIONS, INITIAL_STOCKTAKE_SESSIONS);
  }
  if (!localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS)) {
    setStored(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
  }

  // Migrate any existing Staff roles and assign existing users to company_id=COMP-001, branch_id=BR-MAIN with role=OWNER
  const currentSalespeople = getStored<Salesperson[]>(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  let updatedSalespeople = false;
  const migratedPeople = currentSalespeople.map((sp) => {
    let p = { ...sp };
    if (!p.companyId && !p.company_id) {
      p.companyId = 'COMP-001';
      p.company_id = 'COMP-001';
      updatedSalespeople = true;
    }
    if (!p.branchId && !p.branch_id) {
      p.branchId = 'BR-MAIN';
      p.branch_id = 'BR-MAIN';
      p.branchName = 'Head Office - Main Central Distribution & Warehouse';
      updatedSalespeople = true;
    }
    // Migration: Move existing users to OWNER role for initial company
    if (p.id === '001' || p.id === '002' || (p.role as string) === 'Admin' || (p.role as string) === 'Staff') {
      p.role = 'OWNER';
      updatedSalespeople = true;
    }
    return p;
  });

  // Ensure there is at least one active Manager or Owner
  if (!migratedPeople.some((s) => (s.role === 'Manager' || s.role === 'OWNER') && s.active === 'Y')) {
    const candidate = migratedPeople[0];
    if (candidate) {
      candidate.role = 'OWNER';
      candidate.active = 'Y';
      updatedSalespeople = true;
    }
  }

  if (updatedSalespeople) {
    setStored(STORAGE_KEYS.SALESPEOPLE, migratedPeople);
  }

  // Migration: Move existing "Sample Branch" data to "Head Office" branch in Master
  const currentBranches = getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  let branchesUpdated = false;
  const migratedBranches: Branch[] = [];
  const seenMigrationIds = new Set<string>();

  for (const b of currentBranches) {
    let candidate = { ...b };
    if (candidate.name === 'Sample Branch' || candidate.name === 'Main Central Distribution & Warehouse') {
      branchesUpdated = true;
      candidate = {
        ...candidate,
        branchId: 'BR-MAIN',
        name: 'Head Office - Main Central Distribution & Warehouse',
        code: 'HQ-01',
        isMain: true,
        companyId: candidate.companyId || 'COMP-001',
        company_id: candidate.company_id || 'COMP-001',
      };
    }
    if (!candidate.companyId && !candidate.company_id) {
      branchesUpdated = true;
      candidate = { ...candidate, companyId: 'COMP-001', company_id: 'COMP-001' };
    }
    const id = candidate.branchId || candidate.id || (candidate as any).branch_id || 'BR-MAIN';
    candidate.branchId = id;
    candidate.id = id;

    if (seenMigrationIds.has(id)) {
      branchesUpdated = true;
      continue;
    }
    seenMigrationIds.add(id);
    migratedBranches.push(candidate);
  }

  if (branchesUpdated) {
    setStored(STORAGE_KEYS.BRANCHES, migratedBranches);
  }

  // Ensure seed companies (including COMP-001 and COMP-002) exist in companies store
  // and sanitize any non-functional placeholder sheet IDs
  const currentCompanies = getStored<Company[]>(STORAGE_KEYS.COMPANIES, SEED_COMPANIES);
  let compCleaned = false;
  const sanitizedCompanies = currentCompanies.map((c) => {
    if (
      c.sheet_id &&
      (c.sheet_id.includes('_Tenant_Sheet_') ||
        c.sheet_id.includes('Metro_Bulawayo') ||
        c.sheet_id.includes('Dedicated'))
    ) {
      compCleaned = true;
      return { ...c, sheet_id: '' };
    }
    return c;
  });
  const existingCompanyIds = new Set(sanitizedCompanies.map((c) => c.company_id));
  const missingCompanies = SEED_COMPANIES.filter((c) => !existingCompanyIds.has(c.company_id));
  if (missingCompanies.length > 0 || compCleaned) {
    setStored(STORAGE_KEYS.COMPANIES, [...sanitizedCompanies, ...missingCompanies]);
  }

  // Ensure initial branches for all demo companies exist in branches store
  const branchList = getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  const existingBranchIds = new Set(branchList.map((b) => b.branchId));
  const missingBranches = INITIAL_BRANCHES.filter((b) => !existingBranchIds.has(b.branchId));
  if (missingBranches.length > 0) {
    setStored(STORAGE_KEYS.BRANCHES, [...branchList, ...missingBranches]);
  }

  // Ensure initial salespeople for all demo companies exist in salespeople store
  const staffList = getStored<Salesperson[]>(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  const existingStaffIds = new Set(staffList.map((s) => s.id));
  const missingStaff = INITIAL_SALESPEOPLE.filter((s) => !existingStaffIds.has(s.id));
  if (missingStaff.length > 0) {
    setStored(STORAGE_KEYS.SALESPEOPLE, [...staffList, ...missingStaff]);
  }

  // Ensure initial inventory items for all demo companies exist in inventory store
  const allInvStore = getStored<InventoryItem[]>(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  const existingInvKeys = new Set(allInvStore.map((i) => `${i.itemId}-${i.company_id || (i as any).companyId || 'COMP-001'}`));
  const missingInv = INITIAL_INVENTORY_ITEMS.filter((i) => !existingInvKeys.has(`${i.itemId}-${i.company_id || (i as any).companyId || 'COMP-001'}`));
  if (missingInv.length > 0) {
    setStored(STORAGE_KEYS.INVENTORY_ITEMS, [...allInvStore, ...missingInv]);
  }

  // Ensure initial sales for all demo companies exist in sales store
  const currentSales = getStored<SaleInvoice[]>(STORAGE_KEYS.SALES, INITIAL_SALES);
  const existingSaleIds = new Set(currentSales.map((s) => s.id));
  const missingSales = INITIAL_SALES.filter((s) => !existingSaleIds.has(s.id));
  if (missingSales.length > 0) {
    setStored(STORAGE_KEYS.SALES, [...currentSales, ...missingSales]);
  }

  // Backfill company_id and branch_id for any existing records in local storage
  const backfillCompanyBranch = <T extends Record<string, any>>(key: string, defaultList: T[]): void => {
    const list = getStored<T[]>(key, defaultList);
    let changed = false;
    const migrated = list.map((item) => {
      if (!item.company_id && !item.companyId) {
        changed = true;
        return {
          ...item,
          company_id: 'COMP-001',
          companyId: 'COMP-001',
          branch_id: item.branch_id || item.branchId || 'BR-MAIN',
          branchId: item.branchId || item.branch_id || 'BR-MAIN',
        };
      }
      return item;
    });
    if (changed) {
      setStored(key, migrated);
    }
  };

  backfillCompanyBranch(STORAGE_KEYS.SALES, INITIAL_SALES);
  backfillCompanyBranch(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS);
  backfillCompanyBranch(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
  backfillCompanyBranch(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  backfillCompanyBranch(STORAGE_KEYS.CASH_LOGS, INITIAL_CASH_LOGS);
  backfillCompanyBranch(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
  backfillCompanyBranch(STORAGE_KEYS.CUSTOMER_CHANGES, INITIAL_CUSTOMER_CHANGES);
  backfillCompanyBranch(STORAGE_KEYS.CREDIT_SALES, INITIAL_CREDIT_SALES);
  backfillCompanyBranch(STORAGE_KEYS.DIRECT_GRVS, INITIAL_DIRECT_GRVS);
  backfillCompanyBranch(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
  backfillCompanyBranch(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
  backfillCompanyBranch(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  backfillCompanyBranch(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  backfillCompanyBranch(STORAGE_KEYS.STOCKTAKE_SESSIONS, INITIAL_STOCKTAKE_SESSIONS);
  backfillCompanyBranch(STORAGE_KEYS.CASH_COUNTS, []);
  backfillCompanyBranch(STORAGE_KEYS.RECONCILIATIONS, []);
  backfillCompanyBranch(STORAGE_KEYS.ADMIN_SALES, []);
  backfillCompanyBranch(STORAGE_KEYS.NEGATIVE_BALANCES, []);

  // Login: Required on app open - Clear persisted session user on startup
  localStorage.removeItem(STORAGE_KEYS.SESSION_USER);

  if (!localStorage.getItem(STORAGE_KEYS.RECONCILIATIONS)) {
    setStored(STORAGE_KEYS.RECONCILIATIONS, []);
  }
  if (!localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE)) {
    setStored(STORAGE_KEYS.SYNC_QUEUE, []);
  }
  if (!localStorage.getItem(STORAGE_KEYS.SHEETS_CONFIG)) {
    const defaultConfig: GoogleSheetsConfig = {
      webhookUrl: '',
      spreadsheetId: '1Saimetric_Sync_Live_MasterSheet',
      sheetNameMap: {
        Customers: 'Customers',
        Suppliers: 'Suppliers',
        CashLog: 'CashLog',
        Sales: 'Sales',
        Expenses: 'Expenses',
        Reconciliations: 'Reconciliations',
        Salespeople: 'Salespeople',
        CustomerChange: 'CustomerChange',
        CreditSales: 'CreditSales',
        Products: 'Products',
        companies: 'companies',
        branches: 'branches',
        users: 'users',
        Direct_GRV: 'Direct_GRV',
        Audit_Log: 'Audit_Log',
        StockMovement: 'StockMovement',
        GoodsReceived: 'GoodsReceived',
      },
      autoSync: true,
      simulateSyncLatency: true,
    };
    setStored(STORAGE_KEYS.SHEETS_CONFIG, defaultConfig);
  }
};

// ==================== AUTH & SESSION ====================
export const getSessionUser = (): Salesperson | null => {
  return getStored<Salesperson | null>(STORAGE_KEYS.SESSION_USER, null);
};

export const setSessionUser = (user: Salesperson | null): void => {
  setStored(STORAGE_KEYS.SESSION_USER, user);
  if (user) {
    const compId = user.company_id || user.companyId;
    if (compId) {
      setStored(STORAGE_KEYS.CURRENT_COMPANY_ID, compId);
    }
    const brId = user.branch_id || user.branchId;
    if (brId) {
      setStored(STORAGE_KEYS.CURRENT_BRANCH_ID, brId);
    }
  }
  notifyListeners();
};

export const getCurrentUser = getSessionUser;
export const setCurrentUser = setSessionUser;
export const initializeRoomDatabase = initRoomDatabase;

// ==================== AUDIT LOG DAO ====================
export const getAllAuditLogs = (): AuditLogEntry[] => {
  return getStored<AuditLogEntry[]>(STORAGE_KEYS.AUDIT_LOGS, INITIAL_AUDIT_LOGS);
};

export const getAuditLogs = (): AuditLogEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllAuditLogs();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((a) => {
    const cId = a.company_id || a.companyId;
    if (!cId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return cId === currentCompany;
  });
};

export const addAuditLog = (
  entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'date' | 'time'> & {
    timestamp?: string;
    date?: string;
    time?: string;
    id?: string;
    company_id?: string;
    companyId?: string;
    branch_id?: string;
    branchId?: string;
  }
): AuditLogEntry => {
  const all = getAllAuditLogs();
  const now = new Date();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const dateStr = entry.date || now.toISOString().split('T')[0];
  const timeStr = entry.time || now.toTimeString().split(' ')[0];
  const id = entry.id || `AUD-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
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
  setStored(STORAGE_KEYS.AUDIT_LOGS, updated);
  enqueueSync('Audit_Log', 'INSERT', newLog);
  return newLog;
};

export const logLogin = (staff: Salesperson): void => {
  addAuditLog({
    action: 'LOGIN',
    severity: 'INFO',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `User ${staff.name} (${staff.role}) successfully authenticated with 4-digit PIN.`,
  });
};

export const logLogout = (staff: Salesperson, reason: string = 'User clicked Logout'): void => {
  addAuditLog({
    action: 'LOGOUT',
    severity: 'INFO',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `User ${staff.name} (${staff.role}) signed out. Reason: ${reason}.`,
  });
};

export const logSessionTimeout = (staff: Salesperson): void => {
  addAuditLog({
    action: 'SESSION_TIMEOUT',
    severity: 'WARNING',
    staffId: staff.id,
    staffName: staff.name,
    staffRole: staff.role,
    details: `Security Auto-Lock: User ${staff.name} (${staff.role}) automatically logged out after 5 minutes of inactivity.`,
  });
};

export const logManagerOverride = (params: {
  action: 'DISCOUNT_OVERRIDE' | 'VOID_CART' | 'REFUND_INVOICE' | 'VOID_INVOICE';
  manager: Salesperson;
  cashier?: Salesperson | null;
  details: string;
  amount?: number;
  referenceId?: string;
  metadata?: Record<string, any>;
}): void => {
  const cashierStaff = params.cashier || getCurrentUser() || params.manager;
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

// ==================== SALESPERSON DAO ====================
export const getAllSalespeople = (): Salesperson[] => {
  return getStored<Salesperson[]>(STORAGE_KEYS.SALESPEOPLE, INITIAL_SALESPEOPLE);
};

export const getSalespeople = (): Salesperson[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllSalespeople();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((s) => {
    const sComp = s.companyId || s.company_id;
    if (!sComp) {
      return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    }
    return sComp === currentCompany;
  });
};

export const getSalespeopleForCompany = (companyId?: string): Salesperson[] => {
  const targetCompany = companyId || getCurrentCompanyId();
  const all = getAllSalespeople();
  return all.filter((s) => {
    const sComp = s.companyId || s.company_id;
    if (!sComp) {
      return targetCompany === 'COMP-001' || targetCompany === 'COMP-MASTER';
    }
    return sComp === targetCompany;
  });
};

export const getNextSalespersonId = (): string => {
  const list = getAllSalespeople();
  const numericIds = list
    .map((s) => parseInt(s.id, 10))
    .filter((n) => !isNaN(n));
  const max = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  const next = max + 1;
  return String(next).padStart(3, '0');
};

export const addSalesperson = (person: Omit<Salesperson, 'id'> & { id?: string }): Salesperson => {
  const all = getAllSalespeople();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const newId = person.id || getNextSalespersonId();
  const compId = person.companyId || person.company_id || currentCompany;
  const brId = person.branchId || person.branch_id || currentBranch;
  const created: Salesperson = {
    ...person,
    id: newId,
    companyId: compId,
    company_id: compId,
    branchId: brId,
    branch_id: brId,
  };
  const updated = [...all, created];
  setStored(STORAGE_KEYS.SALESPEOPLE, updated);
  
  // Queue sync
  enqueueSync('Salespeople', 'INSERT', created);
  enqueueSync('users', 'INSERT', created);
  return created;
};

export const getOwnerDefaultPermissions = () => ({
  canEditCartPrice: true,
  canApplyCartDiscount: true,
  canDeleteCartItem: true,
  canClearCart: true,
  canManageInventory: true,
  canEditPriceCost: true,
  canSellNegativeStock: true,
  canReceiveGRN: true,
  canBreakCases: true,
  canAccessReports: true,
  canManageExpenses: true,
  canPerformShiftEnd: true,
  canManageStaff: true,
  canCreateDirectGrv: true,
  canApproveDirectGrv: true,
  canUseCustomerChange: true,
  canIssueCustomerCredit: true,
  canSubmitEOD: true,
  canApproveEOD: true,
  canViewVarianceInvestigation: true,
  canViewAuditLog: true,
  canPinOverride: true,
  canManageCompany: true,
  canEditMasterPrice: true,
  canSeeMargin: true,
});

export const saveSalesperson = (person: Salesperson): Salesperson => {
  const all = getAllSalespeople();
  const compId = person.companyId || person.company_id || getCurrentCompanyId();
  const normalizedEmail = (person.email || '').trim().toLowerCase();
  
  // Find by ID, or by same email within same company
  const index = all.findIndex((s) => {
    if (s.id === person.id) return true;
    const sComp = s.companyId || s.company_id;
    if (normalizedEmail && s.email && s.email.trim().toLowerCase() === normalizedEmail && sComp === compId) {
      return true;
    }
    return false;
  });

  const merged: Salesperson = {
    ...person,
    companyId: compId,
    company_id: compId,
    active: person.active || 'Y',
    permissions: person.permissions || getOwnerDefaultPermissions(),
  };

  if (index >= 0) {
    all[index] = { ...all[index], ...merged };
    setStored(STORAGE_KEYS.SALESPEOPLE, all);
    notifyListeners();
    return all[index];
  } else {
    const updated = [...all, merged];
    setStored(STORAGE_KEYS.SALESPEOPLE, updated);
    notifyListeners();
    return merged;
  }
};

export const updateSalesperson = (id: string, updates: Partial<Salesperson>): Salesperson | null => {
  const all = getAllSalespeople();
  const index = all.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const updatedPerson = { ...all[index], ...updates };
  all[index] = updatedPerson;
  setStored(STORAGE_KEYS.SALESPEOPLE, all);

  // Update session if editing current logged-in user
  const current = getSessionUser();
  if (current && current.id === id) {
    setSessionUser(updatedPerson);
  }

  enqueueSync('Salespeople', 'UPDATE', updatedPerson);
  enqueueSync('users', 'UPDATE', updatedPerson);
  return updatedPerson;
};

export const toggleSalespersonActive = (id: string): Salesperson | null => {
  const all = getAllSalespeople();
  const index = all.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const newStatus = all[index].active === 'Y' ? 'N' : 'Y';
  return updateSalesperson(id, { active: newStatus });
};

// ==================== STAFF MULTI-BRANCH ASSIGNMENTS ====================
export const getStaffBranchAssignments = (staff: Salesperson): StaffBranchAssignment[] => {
  if (staff.branchAssignments && Array.isArray(staff.branchAssignments) && staff.branchAssignments.length > 0) {
    return staff.branchAssignments;
  }
  const defaultBranchId = staff.branchId || staff.branch_id || '1';
  return [
    {
      branchId: defaultBranchId,
      branchName: staff.branchName || 'Main Branch',
      role: staff.role || 'CASHIER',
    },
  ];
};

export const getStaffRoleInBranch = (staff: Salesperson, branchId: string): Role => {
  if (staff.role === 'OWNER' || staff.role === 'SUPER_ADMIN') {
    return staff.role;
  }
  if (staff.branchAssignments && Array.isArray(staff.branchAssignments)) {
    const match = staff.branchAssignments.find((b) => b.branchId === branchId);
    if (match && match.role) {
      return match.role;
    }
  }
  if ((staff.branchId || staff.branch_id) === branchId) {
    return staff.role;
  }
  return staff.role || 'CASHIER';
};

export const isStaffAssignedToBranch = (staff: Salesperson, branchId: string): boolean => {
  if (staff.role === 'OWNER' || staff.role === 'SUPER_ADMIN') {
    return true; // Owner has an account across the company, but must select which branch to log in to
  }
  if (staff.branchAssignments && Array.isArray(staff.branchAssignments) && staff.branchAssignments.length > 0) {
    return staff.branchAssignments.some((b) => b.branchId === branchId);
  }
  const assigned = staff.branchId || staff.branch_id;
  return !assigned || assigned === branchId || assigned === 'ALL' || assigned === '1';
};

export const updateStaffBranchAssignments = (
  staffId: string,
  assignments: StaffBranchAssignment[]
): Salesperson | null => {
  const staff = getAllSalespeople().find((s) => s.id === staffId);
  if (!staff) return null;
  const primaryBranch = assignments[0]?.branchId || staff.branchId || '1';
  const primaryRole = assignments[0]?.role || staff.role;
  return updateSalesperson(staffId, {
    branchAssignments: assignments,
    branchId: primaryBranch,
    branch_id: primaryBranch,
    role: primaryRole,
  });
};

// ==================== CUSTOMER DAO ====================
export const getAllCustomers = (): Customer[] => {
  const stored = getStored<Customer[]>(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS);
  // Ensure any initial customers not in stored get included (e.g. Givemore Gondo)
  const existingIds = new Set(stored.map((c) => c.customerId));
  const missing = INITIAL_CUSTOMERS.filter((c) => !existingIds.has(c.customerId));
  if (missing.length > 0) {
    const merged = [...stored, ...missing];
    setStored(STORAGE_KEYS.CUSTOMERS, merged);
    return merged;
  }
  return stored;
};

export const getCustomers = (): Customer[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllCustomers();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((c) => {
    const compId = c.company_id || c.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getNextCustomerId = (): string => {
  const list = getAllCustomers();
  const numericParts = list
    .map((c) => {
      const match = c.customerId.match(/^C?(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numericParts.length > 0 ? Math.max(...numericParts) : 0;
  const next = max + 1;
  return `C${String(next).padStart(3, '0')}`;
};

export const addCustomer = (customerData: Omit<Customer, 'customerId' | 'createdDate'> & { customerId?: string; createdDate?: string; company_id?: string; companyId?: string }): Customer => {
  const all = getAllCustomers();
  const currentCompany = getCurrentCompanyId();
  const nextId = customerData.customerId || getNextCustomerId();
  const compId = customerData.company_id || customerData.companyId || currentCompany;
  const created: Customer = {
    customerId: nextId,
    name: customerData.name.trim(),
    phone: customerData.phone?.trim() || '',
    address: customerData.address?.trim() || '',
    createdDate: customerData.createdDate || new Date().toISOString().split('T')[0],
    createdBy: customerData.createdBy,
    company_id: compId,
    companyId: compId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.CUSTOMERS, updated);

  // Save to Sheet "Customers": CustomerID, Name, Phone, Address, CreatedDate, CreatedBy
  enqueueSync('Customers', 'INSERT', {
    company_id: compId,
    CustomerID: created.customerId,
    Name: created.name,
    Phone: created.phone,
    Address: created.address,
    CreatedDate: created.createdDate,
    CreatedBy: created.createdBy,
  });

  return created;
};

export const ensureCustomerExists = (
  name: string,
  staffId: string,
  phone?: string,
  address?: string
): Customer => {
  const trimmed = name.trim();
  if (!trimmed) {
    return {
      customerId: 'C_UNKNOWN',
      name: 'Walk-in Customer',
      createdDate: new Date().toISOString().split('T')[0],
      createdBy: staffId,
    };
  }
  const list = getCustomers();
  const existing = list.find((c) => (c.name || '').trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  return addCustomer({
    name: trimmed,
    createdBy: staffId,
    phone: phone || '',
    address: address || '',
    createdDate: new Date().toISOString().split('T')[0],
  });
};

// ==================== SUPPLIER DAO ====================
export const getAllSuppliers = (): Supplier[] => {
  const stored = getStored<Supplier[]>(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
  const existingIds = new Set(stored.map((s) => s.supplierId));
  const missing = INITIAL_SUPPLIERS.filter((s) => !existingIds.has(s.supplierId));
  if (missing.length > 0) {
    const merged = [...stored, ...missing];
    setStored(STORAGE_KEYS.SUPPLIERS, merged);
    return merged;
  }
  return stored;
};

export const getSuppliers = (): Supplier[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllSuppliers();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((s) => {
    const compId = s.company_id || s.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getSupplierById = (supplierId: string): Supplier | undefined => {
  if (!supplierId) return undefined;
  const target = supplierId.trim().toLowerCase();
  return getSuppliers().find(
    (s) => s.supplierId === supplierId || (s.name && s.name.trim().toLowerCase() === target)
  );
};

export const getNextSupplierId = (): string => {
  const list = getAllSuppliers();
  const numericParts = list
    .map((s) => {
      const match = s.supplierId.match(/^SUP-?(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numericParts.length > 0 ? Math.max(...numericParts) : 0;
  const next = max + 1;
  return `SUP-${String(next).padStart(3, '0')}`;
};

export const addSupplier = (
  supplierData: Omit<Supplier, 'supplierId' | 'createdDate' | 'status'> & {
    supplierId?: string;
    createdDate?: string;
    status?: 'Active' | 'Inactive';
    company_id?: string;
    companyId?: string;
  }
): Supplier => {
  const all = getAllSuppliers();
  const currentCompany = getCurrentCompanyId();
  const nextId = supplierData.supplierId || getNextSupplierId();
  const compId = supplierData.company_id || supplierData.companyId || currentCompany;
  const created: Supplier = {
    supplierId: nextId,
    name: supplierData.name.trim(),
    category: supplierData.category?.trim() || 'Groceries & FMCG',
    contactPerson: supplierData.contactPerson?.trim() || '',
    phone: supplierData.phone?.trim() || '',
    email: supplierData.email?.trim() || '',
    address: supplierData.address?.trim() || '',
    city: supplierData.city?.trim() || 'Harare',
    paymentTerms: supplierData.paymentTerms?.trim() || '30-Day Account Credit',
    taxNumber: supplierData.taxNumber?.trim() || '',
    accountNumber: supplierData.accountNumber?.trim() || '',
    status: supplierData.status || 'Active',
    createdDate: supplierData.createdDate || new Date().toISOString().split('T')[0],
    notes: supplierData.notes?.trim() || '',
    company_id: compId,
    companyId: compId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.SUPPLIERS, updated);

  enqueueSync('Suppliers', 'INSERT', {
    company_id: compId,
    SupplierID: created.supplierId,
    Name: created.name,
    Category: created.category,
    Phone: created.phone,
    Address: created.address,
    City: created.city,
    PaymentTerms: created.paymentTerms,
    TaxNumber: created.taxNumber,
  });

  return created;
};

export const updateSupplier = (
  supplierId: string,
  updates: Partial<Supplier>
): Supplier | null => {
  const all = getAllSuppliers();
  const idx = all.findIndex((s) => s.supplierId === supplierId);
  if (idx === -1) return null;
  const updated = { ...all[idx], ...updates };
  all[idx] = updated;
  setStored(STORAGE_KEYS.SUPPLIERS, all);
  enqueueSync('Suppliers', 'UPDATE', updated);
  return updated;
};

export const deleteSupplier = (supplierId: string): boolean => {
  const all = getAllSuppliers();
  const filtered = all.filter((s) => s.supplierId !== supplierId);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.SUPPLIERS, filtered);
  enqueueSync('Suppliers', 'DELETE', { supplierId, company_id: getCurrentCompanyId() });
  return true;
};

export const getSupplierInvoices = (supplierNameOrId: string): SupplierInvoiceVoucher[] => {
  if (!supplierNameOrId) return [];
  const allVouchers = getSupplierInvoiceVouchers();
  const supplier = getSupplierById(supplierNameOrId);
  const targetName = (supplier ? supplier.name : supplierNameOrId || '').toLowerCase().trim();
  return allVouchers.filter(
    (v) =>
      (v.supplier || '').toLowerCase().trim() === targetName ||
      (supplier && supplier.name && (v.supplier || '').toLowerCase().includes(supplier.name.toLowerCase()))
  );
};

export const getSupplierStats = (
  supplierNameOrId: string
): { totalSpend: number; invoiceCount: number; totalUnits: number; lastDeliveryDate?: string } => {
  const invoices = getSupplierInvoices(supplierNameOrId);
  const totalSpend = invoices.reduce((acc, inv) => acc + inv.totalInvoiceAmount, 0);
  const totalUnits = invoices.reduce((acc, inv) => acc + inv.totalUnits, 0);
  const sortedDates = [...invoices].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  return {
    totalSpend,
    invoiceCount: invoices.length,
    totalUnits,
    lastDeliveryDate: sortedDates[0]?.date,
  };
};

// ==================== BRANCH DAO ====================
export const getAllBranches = (): Branch[] => {
  const stored = getStored<Branch[]>(STORAGE_KEYS.BRANCHES, INITIAL_BRANCHES);
  const seenIds = new Set<string>();
  const deduplicated: Branch[] = [];
  let hadDuplicates = false;

  for (const b of stored) {
    const id = b.branchId || b.id || (b as any).branch_id;
    if (!id) continue;
    if (seenIds.has(id)) {
      hadDuplicates = true;
      continue;
    }
    seenIds.add(id);
    deduplicated.push({
      ...b,
      branchId: id,
      id: id,
    });
  }

  // Ensure any missing branches from INITIAL_BRANCHES are included
  for (const initB of INITIAL_BRANCHES) {
    const id = initB.branchId || initB.id;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      deduplicated.push({
        ...initB,
        branchId: id,
        id: id,
      });
      hadDuplicates = true;
    }
  }

  if (hadDuplicates || deduplicated.length !== stored.length) {
    setStored(STORAGE_KEYS.BRANCHES, deduplicated);
  }
  return deduplicated;
};

export const getBranches = (): Branch[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllBranches();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((b) => {
    const compId = b.company_id || b.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getBranchesForCompany = (companyId?: string): Branch[] => {
  const targetCompany = companyId || getCurrentCompanyId();
  const all = getAllBranches();
  const seenIds = new Set<string>();
  return all.filter((b) => {
    const compId = b.company_id || b.companyId;
    const matchesCompany = !compId
      ? targetCompany === 'COMP-001' || targetCompany === 'COMP-MASTER'
      : compId === targetCompany;
    if (!matchesCompany) return false;
    const id = b.branchId || b.id || (b as any).branch_id;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
};

export const getBranchById = (branchId: string): Branch | undefined => {
  return getAllBranches().find((b) => b.branchId === branchId || b.code === branchId);
};

export const saveBranch = (branch: Branch): void => {
  const branches = getAllBranches();
  const currentCompany = getCurrentCompanyId();
  const compId = branch.company_id || branch.companyId || currentCompany;
  const id = branch.branchId || branch.id || (branch as any).branch_id || 'BR-MAIN';
  const normalized: Branch = {
    ...branch,
    branchId: id,
    id: id,
    company_id: compId,
    companyId: compId,
  };
  const index = branches.findIndex(
    (b) =>
      b.branchId === id ||
      b.id === id ||
      (b as any).branch_id === id
  );
  let updated: Branch[];
  if (index >= 0) {
    updated = [...branches];
    updated[index] = normalized;
  } else {
    updated = [...branches, normalized];
  }
  setStored(STORAGE_KEYS.BRANCHES, updated);
  notifyListeners();
};

export const deleteBranch = (branchId: string): boolean => {
  const branches = getAllBranches();
  const filtered = branches.filter((b) => b.branchId !== branchId && b.id !== branchId);
  setStored(STORAGE_KEYS.BRANCHES, filtered);
  notifyListeners();
  return true;
};

// ==================== PRODUCT DAO (POS INVENTORY UNIFIED BRIDGE) ====================

export const inventoryItemToProduct = (item: InventoryItem): Product => {
  return {
    id: item.itemId,
    name: item.itemName,
    sku: item.sku || item.itemId,
    category: item.category || 'General',
    price: item.sellPriceUnit !== undefined ? item.sellPriceUnit : 0,
    costPrice: item.costPerUnit,
    stockQuantity: item.stockSingles !== undefined ? item.stockSingles : 0,
    unit: item.sellByFraction
      ? (item.fractionUnit || 'kg')
      : (item.unitsPerCase > 1 ? `Unit (1cs=${item.unitsPerCase})` : 'Unit'),
    description: item.description || `${item.itemName} - ${item.stockCases} Cases (${item.unitsPerCase}/cs) & ${item.stockSingles} Singles`,
    barcode: item.barcode || '',
    sellByFraction: Boolean(item.sellByFraction),
    fractionUnit: item.fractionUnit || (item.sellByFraction ? 'kg' : undefined),
    canSellAsCase: item.canSellAsCase ?? false,
    unitsPerCase: item.unitsPerCase,
    costPerCase: item.costPerCase,
    sellPriceCase: item.sellPriceCase,
    sellPriceUnit: item.sellPriceUnit,
    stockCases: item.stockCases,
    stockSingles: item.stockSingles,
    totalUnits: item.totalUnits,
    reorderLevelCases: item.reorderLevelCases,
    reorderLevelUnits: item.reorderLevelUnits,
    packagingVariants: item.packagingVariants || [],
    companyId: item.companyId || item.company_id,
    company_id: item.companyId || item.company_id,
    branchId: item.branchId || item.branch_id,
    branch_id: item.branchId || item.branch_id,
  };
};

export const productToInventoryItem = (prod: Product): InventoryItem => {
  const unitsPerCase = Math.max(1, prod.unitsPerCase || 1);
  const sellPriceUnit = prod.sellPriceUnit !== undefined ? Number(prod.sellPriceUnit) : (Number(prod.price) || 0);
  const sellPriceCase = prod.sellPriceCase !== undefined ? Number(prod.sellPriceCase) : (sellPriceUnit * unitsPerCase);
  const costPerUnit = prod.costPrice !== undefined ? Number(prod.costPrice) : 0;
  const costPerCase = prod.costPerCase !== undefined ? Number(prod.costPerCase) : (costPerUnit * unitsPerCase);
  const stockCases = prod.stockCases !== undefined ? Math.max(0, Number(prod.stockCases)) : 0;
  const stockSingles = prod.stockSingles !== undefined ? Math.max(0, Number(prod.stockSingles)) : Math.max(0, Number(prod.stockQuantity) || 0);
  const totalUnits = (stockCases * unitsPerCase) + stockSingles;

  return {
    itemId: prod.id,
    itemName: prod.name,
    category: prod.category || 'General',
    sellByFraction: Boolean(prod.sellByFraction),
    fractionUnit: prod.fractionUnit,
    canSellAsCase: prod.canSellAsCase ?? false,
    unitsPerCase,
    costPerCase,
    costPerUnit,
    sellPriceCase,
    sellPriceUnit,
    stockCases,
    stockSingles,
    totalUnits,
    reorderLevelCases: prod.reorderLevelCases || 1,
    reorderLevelUnits: prod.reorderLevelUnits || 5,
    sku: prod.sku || prod.id,
    barcode: prod.barcode || '',
    description: prod.description || '',
    packagingVariants: prod.packagingVariants || [],
    companyId: prod.companyId || prod.company_id,
    company_id: prod.companyId || prod.company_id,
    branchId: prod.branchId || prod.branch_id,
    branch_id: prod.branchId || prod.branch_id,
    lastUpdated: new Date().toISOString(),
  };
};

export const getProducts = (): Product[] => {
  const invItems = getInventoryItems();
  if (invItems && invItems.length > 0) {
    const list: Product[] = [];
    invItems.forEach((item) => {
      const hasCaseSelling = item.canSellAsCase && item.sellPriceCase && item.sellPriceCase > 0;
      const variants = item.packagingVariants || [];
      const compId = item.company_id || item.companyId;
      const brId = item.branch_id || item.branchId;

      // 1. Single / Each / Fractional item
      list.push({
        id: hasCaseSelling || variants.length > 0 ? `${item.itemId}-UNIT` : item.itemId,
        name: hasCaseSelling || variants.length > 0 ? `${item.itemName} Each` : item.itemName,
        sku: item.sku || item.itemId,
        category: item.category || 'General',
        price: item.sellPriceUnit !== undefined ? item.sellPriceUnit : 0,
        costPrice: item.costPerUnit,
        stockQuantity: item.stockSingles !== undefined ? item.stockSingles : 0,
        unit: item.sellByFraction ? (item.fractionUnit || 'kg') : 'Each',
        description: `${item.itemName} (${item.sellByFraction ? `Sold by ${item.fractionUnit || 'kg'}` : 'Single Unit'})`,
        barcode: item.barcode || '',
        sellByFraction: Boolean(item.sellByFraction),
        fractionUnit: item.fractionUnit || (item.sellByFraction ? 'kg' : undefined),
        canSellAsCase: Boolean(item.canSellAsCase),
        unitsPerCase: item.unitsPerCase,
        costPerCase: item.costPerCase,
        sellPriceCase: item.sellPriceCase,
        sellPriceUnit: item.sellPriceUnit,
        stockCases: item.stockCases,
        stockSingles: item.stockSingles,
        totalUnits: item.totalUnits,
        reorderLevelCases: item.reorderLevelCases,
        reorderLevelUnits: item.reorderLevelUnits,
        packagingVariants: variants,
        companyId: compId,
        company_id: compId,
        branchId: brId,
        branch_id: brId,
      });

      // 2. Case (if enabled)
      if (hasCaseSelling) {
        list.push({
          id: `${item.itemId}-CASE`,
          name: `${item.itemName} Case`,
          sku: item.sku ? `${item.sku}-CS` : `${item.itemId}-CS`,
          category: item.category || 'General',
          price: item.sellPriceCase,
          costPrice: item.costPerCase,
          stockQuantity: item.stockCases !== undefined ? item.stockCases : 0,
          unit: `Case (${item.unitsPerCase}/cs)`,
          description: `${item.itemName} (Full Case of ${item.unitsPerCase})`,
          barcode: item.barcode || '',
          sellByFraction: false,
          canSellAsCase: true,
          unitsPerCase: item.unitsPerCase,
          costPerCase: item.costPerCase,
          sellPriceCase: item.sellPriceCase,
          sellPriceUnit: item.sellPriceUnit,
          stockCases: item.stockCases,
          stockSingles: item.stockSingles,
          totalUnits: item.totalUnits,
          reorderLevelCases: item.reorderLevelCases,
          reorderLevelUnits: item.reorderLevelUnits,
          packagingVariants: variants,
          companyId: compId,
          company_id: compId,
          branchId: brId,
          branch_id: brId,
        });
      }

      // 3. Packaging Variants / Prepacks (e.g. Prepack 5s, 10s, 2s)
      variants.forEach((v) => {
        const estAvailablePacks = item.totalUnits ? Math.floor(item.totalUnits / Math.max(1, v.unitsPerPack)) : 0;
        list.push({
          id: `${item.itemId}__${v.id}`,
          name: `${item.itemName} (${v.name})`,
          sku: v.sku || `${item.sku || item.itemId}-${v.id}`,
          category: item.category || 'General',
          price: v.sellPrice,
          costPrice: v.costPrice || item.costPerUnit * v.unitsPerPack,
          stockQuantity: estAvailablePacks,
          unit: v.name,
          description: `${item.itemName} - ${v.name} (${v.unitsPerPack} units)`,
          barcode: v.barcode || '',
          sellByFraction: false,
          canSellAsCase: Boolean(item.canSellAsCase),
          unitsPerCase: item.unitsPerCase,
          costPerCase: item.costPerCase,
          sellPriceCase: item.sellPriceCase,
          sellPriceUnit: item.sellPriceUnit,
          stockCases: item.stockCases,
          stockSingles: item.stockSingles,
          totalUnits: item.totalUnits,
          reorderLevelCases: item.reorderLevelCases,
          reorderLevelUnits: item.reorderLevelUnits,
          packagingVariants: variants,
          variantId: v.id,
          unitsPerPack: v.unitsPerPack,
          companyId: compId,
          company_id: compId,
          branchId: brId,
          branch_id: brId,
        });
      });
    });
    return list;
  }
  return [];
};

export const getProductById = (id: string): Product | undefined => {
  const isCase = id.endsWith('-CASE');
  const isUnit = id.endsWith('-UNIT');
  const isVariant = id.includes('__');

  let baseId = id;
  let variantId: string | undefined;

  if (isCase) {
    baseId = id.replace(/-CASE$/, '');
  } else if (isUnit) {
    baseId = id.replace(/-UNIT$/, '');
  } else if (isVariant) {
    const parts = id.split('__');
    baseId = parts[0];
    variantId = parts[1];
  }

  const item = getInventoryItemById(baseId);
  if (!item) return undefined;

  if (isVariant && variantId) {
    const variant = (item.packagingVariants || []).find((v) => v.id === variantId);
    if (variant) {
      const estPacks = item.totalUnits ? Math.floor(item.totalUnits / Math.max(1, variant.unitsPerPack)) : 0;
      return {
        id: `${item.itemId}__${variant.id}`,
        name: `${item.itemName} (${variant.name})`,
        sku: variant.sku || `${item.sku || item.itemId}-${variant.id}`,
        category: item.category || 'General',
        price: variant.sellPrice,
        costPrice: variant.costPrice || item.costPerUnit * variant.unitsPerPack,
        stockQuantity: estPacks,
        unit: variant.name,
        description: `${item.itemName} - ${variant.name} (${variant.unitsPerPack} units)`,
        barcode: variant.barcode || '',
        canSellAsCase: Boolean(item.canSellAsCase),
        unitsPerCase: item.unitsPerCase,
        costPerCase: item.costPerCase,
        sellPriceCase: item.sellPriceCase,
        sellPriceUnit: item.sellPriceUnit,
        stockCases: item.stockCases,
        stockSingles: item.stockSingles,
        totalUnits: item.totalUnits,
        reorderLevelCases: item.reorderLevelCases,
        reorderLevelUnits: item.reorderLevelUnits,
        packagingVariants: item.packagingVariants || [],
        variantId: variant.id,
        unitsPerPack: variant.unitsPerPack,
      };
    }
  }

  if (isCase) {
    return {
      id: `${item.itemId}-CASE`,
      name: `${item.itemName} Case`,
      sku: item.sku ? `${item.sku}-CS` : `${item.itemId}-CS`,
      category: item.category || 'General',
      price: item.sellPriceCase !== undefined ? item.sellPriceCase : 0,
      costPrice: item.costPerCase,
      stockQuantity: item.stockCases !== undefined ? item.stockCases : 0,
      unit: `Case (${item.unitsPerCase}/cs)`,
      description: `${item.itemName} (Full Case of ${item.unitsPerCase})`,
      barcode: item.barcode || '',
      canSellAsCase: true,
      unitsPerCase: item.unitsPerCase,
      costPerCase: item.costPerCase,
      sellPriceCase: item.sellPriceCase,
      sellPriceUnit: item.sellPriceUnit,
      stockCases: item.stockCases,
      stockSingles: item.stockSingles,
      totalUnits: item.totalUnits,
      reorderLevelCases: item.reorderLevelCases,
      reorderLevelUnits: item.reorderLevelUnits,
      packagingVariants: item.packagingVariants || [],
    };
  }

  if (isUnit) {
    return {
      id: `${item.itemId}-UNIT`,
      name: `${item.itemName} Each`,
      sku: item.sku || item.itemId,
      category: item.category || 'General',
      price: item.sellPriceUnit !== undefined ? item.sellPriceUnit : 0,
      costPrice: item.costPerUnit,
      stockQuantity: item.stockSingles !== undefined ? item.stockSingles : 0,
      unit: item.sellByFraction ? (item.fractionUnit || 'kg') : 'Each',
      description: `${item.itemName} (${item.sellByFraction ? `Sold by ${item.fractionUnit || 'kg'}` : 'Single Unit'})`,
      barcode: item.barcode || '',
      sellByFraction: Boolean(item.sellByFraction),
      fractionUnit: item.fractionUnit || (item.sellByFraction ? 'kg' : undefined),
      canSellAsCase: item.canSellAsCase ?? false,
      unitsPerCase: item.unitsPerCase,
      costPerCase: item.costPerCase,
      sellPriceCase: item.sellPriceCase,
      sellPriceUnit: item.sellPriceUnit,
      stockCases: item.stockCases,
      stockSingles: item.stockSingles,
      totalUnits: item.totalUnits,
      reorderLevelCases: item.reorderLevelCases,
      reorderLevelUnits: item.reorderLevelUnits,
      packagingVariants: item.packagingVariants || [],
    };
  }

  return inventoryItemToProduct(item);
};

export const getNextProductId = (): string => {
  const items = getInventoryItems();
  const count = items.length + 1;
  return `ITM-${String(count).padStart(3, '0')}`;
};

export const saveProduct = (productData: Omit<Product, 'id'> & { id?: string }): Product => {
  const id = productData.id || getNextProductId();
  const fullProduct: Product = {
    ...productData,
    id,
    sku: productData.sku || `SKU-${id}`,
    price: Number(productData.price) || 0,
    costPrice: productData.costPrice !== undefined ? Number(productData.costPrice) : undefined,
    stockQuantity: Number(productData.stockQuantity) || 0,
    packagingVariants: productData.packagingVariants || [],
  };

  const invItem = productToInventoryItem(fullProduct);
  const saved = saveInventoryItem(invItem);
  return inventoryItemToProduct(saved);
};

export const deleteProduct = (id: string): void => {
  deleteInventoryItem(id);
  const list = getStored<Product[]>(STORAGE_KEYS.PRODUCTS, []);
  setStored(STORAGE_KEYS.PRODUCTS, list.filter((p) => p.id !== id));
  enqueueSync('Products', 'DELETE', { ProductID: id });
};

export const updateProductStock = (id: string, deltaQty: number, isCase?: boolean, unitsPerPack?: number): void => {
  let realId = id;
  let sellAsCase = Boolean(isCase);
  let unitsToDeductPerQty = 1;

  if (id.endsWith('-CASE')) {
    realId = id.replace(/-CASE$/, '');
    sellAsCase = true;
  } else if (id.endsWith('-UNIT')) {
    realId = id.replace(/-UNIT$/, '');
    sellAsCase = false;
  } else if (id.includes('__')) {
    const parts = id.split('__');
    realId = parts[0];
    sellAsCase = false;
    const variantId = parts[1];
    const item = getInventoryItemById(realId);
    const variant = (item?.packagingVariants || []).find((v) => v.id === variantId);
    if (variant) {
      unitsToDeductPerQty = variant.unitsPerPack;
    } else if (unitsPerPack && unitsPerPack > 0) {
      unitsToDeductPerQty = unitsPerPack;
    }
  } else if (unitsPerPack && unitsPerPack > 1) {
    unitsToDeductPerQty = unitsPerPack;
  }

    const item = getInventoryItemById(realId);
  if (item) {
    if (deltaQty < 0) {
      const unitsToDeduct = sellAsCase
        ? Math.abs(deltaQty) * item.unitsPerCase
        : Math.abs(deltaQty) * unitsToDeductPerQty;
      const currentUser = getCurrentUser();
      deductStockFIFO({
        itemId: realId,
        quantityUnits: unitsToDeduct,
        staffId: currentUser?.id || '001',
        staffName: currentUser?.name || 'Staff',
        allowNegative: true,
      });
    }

    let newCases = item.stockCases;
    let newSingles = item.stockSingles;

    if (sellAsCase) {
      newCases = newCases + deltaQty;
      if (newCases < 0) {
        newSingles = newSingles + (newCases * item.unitsPerCase);
        newCases = 0;
      }
    } else {
      const netSinglesDelta = deltaQty * unitsToDeductPerQty;
      newSingles = newSingles + netSinglesDelta;
      // If selling singles/variants and singles run out, but cases are available, auto-break case
      if (newSingles < 0 && newCases > 0) {
        const casesNeeded = Math.ceil(Math.abs(newSingles) / item.unitsPerCase);
        if (casesNeeded <= newCases) {
          newCases -= casesNeeded;
          newSingles += casesNeeded * item.unitsPerCase;
        } else {
          newSingles += newCases * item.unitsPerCase;
          newCases = 0;
        }
      }
    }

    const finalSingles = Number(newSingles.toFixed(3));
    const finalCases = Math.max(0, newCases);
    const finalTotalUnits = Number(((finalCases * item.unitsPerCase) + finalSingles).toFixed(3));

    const updatedItem: InventoryItem = {
      ...item,
      stockCases: finalCases,
      stockSingles: finalSingles,
      totalUnits: finalTotalUnits,
      lastUpdated: new Date().toISOString(),
    };
    saveInventoryItem(updatedItem);
  }
};

export const addPackagingVariant = (
  itemId: string,
  variant: Omit<PackagingVariant, 'id'> & { id?: string }
): PackagingVariant | null => {
  const item = getInventoryItemById(itemId);
  if (!item) return null;

  const currentVariants = item.packagingVariants || [];
  const variantId = variant.id || `VAR-${Date.now().toString().slice(-4)}`;
  const costPrice = variant.costPrice !== undefined ? variant.costPrice : item.costPerUnit * variant.unitsPerPack;

  const newVariant: PackagingVariant = {
    ...variant,
    id: variantId,
    costPrice,
    unitsPerPack: Math.max(1, variant.unitsPerPack),
    sellPrice: Math.max(0, variant.sellPrice),
  };

  const updatedVariants = [...currentVariants.filter((v) => v.id !== variantId), newVariant];
  const updatedItem: InventoryItem = {
    ...item,
    packagingVariants: updatedVariants,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);
  return newVariant;
};

export const deletePackagingVariant = (itemId: string, variantId: string): boolean => {
  const item = getInventoryItemById(itemId);
  if (!item || !item.packagingVariants) return false;

  const filtered = item.packagingVariants.filter((v) => v.id !== variantId);
  const updatedItem: InventoryItem = {
    ...item,
    packagingVariants: filtered,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);
  return true;
};

// ==================== PARKED SALES DAO ====================
export const getAllParkedSales = (): ParkedSale[] => {
  return getStored<ParkedSale[]>(STORAGE_KEYS.PARKED_SALES, []);
};

export const getParkedSales = (): ParkedSale[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllParkedSales();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((p) => {
    const compId = p.company_id || p.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const saveParkedSale = (data: {
  id?: string;
  customerName?: string;
  customerId?: string;
  items: CartItem[];
  subtotal: number;
  total: number;
  notes?: string;
  company_id?: string;
  companyId?: string;
  branch_id?: string;
  branchId?: string;
}): ParkedSale => {
  const list = getAllParkedSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = data.company_id || data.companyId || currentCompany;
  const brId = data.branch_id || data.branchId || currentBranch;

  const newParked: ParkedSale = {
    id: data.id || `PARK-${Date.now()}`,
    timestamp: new Date().toISOString(),
    customerName: data.customerName || 'Walk-in Customer',
    customerId: data.customerId,
    items: data.items,
    subtotal: data.subtotal,
    total: data.total,
    notes: data.notes,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const filtered = list.filter((p) => p.id !== newParked.id);
  const updated = [newParked, ...filtered];
  setStored(STORAGE_KEYS.PARKED_SALES, updated);
  return newParked;
};

export const deleteParkedSale = (id: string): void => {
  const list = getAllParkedSales();
  const updated = list.filter((p) => p.id !== id);
  setStored(STORAGE_KEYS.PARKED_SALES, updated);
};

export const clearParkedSales = (): void => {
  const currentCompany = getCurrentCompanyId();
  const list = getAllParkedSales();
  const updated = list.filter((p) => {
    const compId = p.company_id || p.companyId;
    return compId && compId !== currentCompany;
  });
  setStored(STORAGE_KEYS.PARKED_SALES, updated);
};

// ==================== CASH LOG DAO (FORM 2 & FORM 1) ====================
export const getAllCashLogs = (): CashLogEntry[] => {
  const logs = getStored<CashLogEntry[]>(STORAGE_KEYS.CASH_LOGS, INITIAL_CASH_LOGS);
  if (!Array.isArray(logs)) return [];

  // Auto-heal duplicate IDs if any exist in stored state
  const seenIds = new Set<string>();
  let hasDuplicates = false;
  const numbers = logs
    .map((c) => {
      const match = c?.id?.match?.(/^CL-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  const sanitized = logs.map((item) => {
    if (!item || !item.id || seenIds.has(item.id)) {
      hasDuplicates = true;
      const newId = `CL-${String(nextCounter++).padStart(3, '0')}`;
      seenIds.add(newId);
      return { ...item, id: newId };
    }
    seenIds.add(item.id);
    return item;
  });

  if (hasDuplicates) {
    try {
      localStorage.setItem(STORAGE_KEYS.CASH_LOGS, JSON.stringify(sanitized));
    } catch (_) {}
  }
  return sanitized;
};

export const getCashLogs = (): CashLogEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllCashLogs();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((l) => {
    const compId = l.company_id || l.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getNextCashLogId = (): string => {
  const list = getAllCashLogs();
  const numbers = list
    .map((c) => {
      const match = c.id?.match?.(/^CL-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `CL-${String(next).padStart(3, '0')}`;
};

export const addCashLog = (entry: Omit<CashLogEntry, 'id' | 'synced'> & { id?: string; company_id?: string; companyId?: string; branch_id?: string; branchId?: string }): CashLogEntry => {
  const all = getAllCashLogs();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branch_id || entry.branchId || currentBranch;
  const newEntry: CashLogEntry = {
    ...entry,
    id: entry.id || getNextCashLogId(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [newEntry, ...all];
  setStored(STORAGE_KEYS.CASH_LOGS, updated);

  // Save to Sheet "CashLog": Timestamp, Date, StaffID, StaffName, Line, Description, In, Out
  enqueueSync('CashLog', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: newEntry.timestamp,
    Date: newEntry.date,
    StaffID: newEntry.staffId,
    StaffName: newEntry.staffName,
    Line: newEntry.line,
    Description: newEntry.description,
    In: newEntry.in,
    Out: newEntry.out,
  });

  return newEntry;
};

export const deleteCashLog = (id: string): boolean => {
  const all = getAllCashLogs();
  const filtered = all.filter((item) => item.id !== id);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.CASH_LOGS, filtered);
  enqueueSync('CashLog', 'DELETE', { id, company_id: getCurrentCompanyId() });
  return true;
};

// ==================== DATE & DAILY REPORT HELPERS ====================
export const getTodayDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getCashCountForStaffAndDate = (staffId: string, date: string): CashCountRecord | undefined => {
  const counts = getCashCounts();
  return counts.find((c) => c.staffId === staffId && c.date === date);
};

export const getCashLogsForStaffAndDate = (staffId: string, date: string): CashLogEntry[] => {
  const logs = getCashLogs();
  return logs.filter((l) => l.staffId === staffId && l.date === date);
};

export const getCustomerChangesForStaffAndDate = (staffId: string, date: string): CustomerChangeEntry[] => {
  const changes = getCustomerChanges();
  return changes.filter((c) => c.staffId === staffId && c.date === date);
};

export const getCreditSalesForStaffAndDate = (staffId: string, date: string): CreditSaleEntry[] => {
  const creditSales = getCreditSales();
  return creditSales.filter((c) => c.staffId === staffId && c.date === date);
};

export const saveDailyCashLogSheet = (
  date: string,
  staffId: string,
  staffName: string,
  entries: Array<{
    line: string;
    description: string;
    in: number;
    out: number;
    reference?: string;
  }>
): CashLogEntry[] => {
  const currentLogs = getCashLogs();
  // Filter out other days / staff to preserve them, but replace this specific staff + date daily report
  const otherLogs = currentLogs.filter((l) => !(l.staffId === staffId && l.date === date));

  // Filter out any non-zero entries to save
  const validEntries = entries.filter(
    (e) => e.in > 0 || e.out > 0 || e.line === 'Float' || e.line === 'Final Cash Out' || e.line === 'Float & Closeout'
  );
  
  const createdList: CashLogEntry[] = [];
  const now = new Date();

  // Find max ID counter once to avoid duplicate IDs in batch insertion
  const numbers = currentLogs
    .map((c) => {
      const match = c.id?.match?.(/^CL-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  // Create new entries for the valid lines with unique sequential IDs
  validEntries.forEach((entry, idx) => {
    const newEntry: CashLogEntry = {
      id: `CL-${String(nextCounter++).padStart(3, '0')}`,
      timestamp: new Date(now.getTime() + idx * 100).toISOString(),
      date,
      staffId,
      staffName,
      line: entry.line,
      description: entry.description || entry.line,
      in: entry.in || 0,
      out: entry.out || 0,
      category: entry.line,
      reference: entry.reference,
      synced: false,
    };
    createdList.push(newEntry);

    enqueueSync('CashLog', 'INSERT', {
      Timestamp: newEntry.timestamp,
      Date: newEntry.date,
      StaffID: newEntry.staffId,
      StaffName: newEntry.staffName,
      Line: newEntry.line,
      Description: newEntry.description,
      In: newEntry.in,
      Out: newEntry.out,
    });
  });

  const updatedAll = [...createdList, ...otherLogs];
  setStored(STORAGE_KEYS.CASH_LOGS, updatedAll);
  return createdList;
};

// ==================== CASH COUNT DAO (FORM 1) ====================
export const getAllCashCounts = (): CashCountRecord[] => {
  return getStored<CashCountRecord[]>(STORAGE_KEYS.CASH_COUNTS, []);
};

export const getCashCounts = (): CashCountRecord[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllCashCounts();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((c) => {
    const compId = (c as any).company_id || (c as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const saveFinalCashCount = (data: {
  staffId: string;
  staffName: string;
  denominations: Record<string, number>;
  finalCashOutTotal: number;
  notes?: string;
  date?: string;
}): { countRecord: CashCountRecord; cashLogRecord: CashLogEntry } => {
  const now = new Date();
  const dateStr = data.date || getTodayDateString();
  const currentCounts = getAllCashCounts();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const existingCountIndex = currentCounts.findIndex(
    (c) => {
      const compId = (c as any).company_id || (c as any).companyId || 'COMP-001';
      return compId === currentCompany && c.staffId === data.staffId && c.date === dateStr;
    }
  );

  let countRecord: CashCountRecord;

  if (existingCountIndex >= 0) {
    // Update existing count record in place for this salesperson and date
    const existing = currentCounts[existingCountIndex];
    countRecord = {
      ...existing,
      timestamp: now.toISOString(),
      staffName: data.staffName,
      denominations: data.denominations,
      finalCashOutTotal: data.finalCashOutTotal,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      company_id: (existing as any).company_id || currentCompany,
      companyId: (existing as any).companyId || currentCompany,
      branch_id: (existing as any).branch_id || currentBranch,
      branchId: (existing as any).branchId || currentBranch,
      synced: false,
    };
    const updatedCounts = [...currentCounts];
    updatedCounts[existingCountIndex] = countRecord;
    setStored(STORAGE_KEYS.CASH_COUNTS, updatedCounts);
  } else {
    // New cash count record
    const countId = `CNT-${Date.now()}`;
    countRecord = {
      id: countId,
      timestamp: now.toISOString(),
      date: dateStr,
      staffId: data.staffId,
      staffName: data.staffName,
      denominations: data.denominations,
      finalCashOutTotal: data.finalCashOutTotal,
      notes: data.notes || '',
      company_id: currentCompany,
      companyId: currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
      synced: false,
    } as any;
    setStored(STORAGE_KEYS.CASH_COUNTS, [countRecord, ...currentCounts]);
  }

  // SPEC: Update or Add to Sheet "CashLog": Timestamp, Date, StaffID, StaffName, Line, Description="Final Cash Out", In=0, Out=finalCashOutTotal
  const currentLogs = getCashLogs();
  const existingFinalLogIdx = currentLogs.findIndex(
    (l) =>
      l.staffId === data.staffId &&
      l.date === dateStr &&
      (l.line === 'Final Cash Out' || l.description?.toLowerCase().includes('final cash out'))
  );

  let cashLogRecord: CashLogEntry;

  if (existingFinalLogIdx >= 0) {
    cashLogRecord = {
      ...currentLogs[existingFinalLogIdx],
      timestamp: countRecord.timestamp,
      out: data.finalCashOutTotal,
      staffName: data.staffName,
      reference: countRecord.id,
      synced: false,
    };
    const updatedLogs = [...currentLogs];
    updatedLogs[existingFinalLogIdx] = cashLogRecord;
    setStored(STORAGE_KEYS.CASH_LOGS, updatedLogs);
  } else {
    cashLogRecord = addCashLog({
      timestamp: countRecord.timestamp,
      date: countRecord.date,
      staffId: data.staffId,
      staffName: data.staffName,
      line: 'Final Cash Out',
      description: 'Final Cash Out',
      in: 0,
      out: data.finalCashOutTotal,
      category: 'Float & Closeout',
      reference: countRecord.id,
    });
  }

  return { countRecord, cashLogRecord };
};

// ==================== CUSTOMER CHANGE DAO (FORM 3) ====================
export const getAllCustomerChanges = (): CustomerChangeEntry[] => {
  return getStored<CustomerChangeEntry[]>(STORAGE_KEYS.CUSTOMER_CHANGES, INITIAL_CUSTOMER_CHANGES);
};

export const getCustomerChanges = (): CustomerChangeEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllCustomerChanges();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((c) => {
    const compId = c.company_id || c.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getNextCustomerChangeId = (): string => {
  const list = getAllCustomerChanges();
  const numbers = list
    .map((c) => {
      const match = c.id?.match?.(/^CHG-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `CHG-${String(next).padStart(3, '0')}`;
};

export const addCustomerChange = (
  entry: Omit<CustomerChangeEntry, 'id' | 'synced'> & { id?: string; company_id?: string; companyId?: string; branch_id?: string; branchId?: string }
): CustomerChangeEntry => {
  const all = getAllCustomerChanges();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branch_id || entry.branchId || currentBranch;
  const created: CustomerChangeEntry = {
    ...entry,
    id: entry.id || getNextCustomerChangeId(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.CUSTOMER_CHANGES, updated);

  enqueueSync('CustomerChange', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    Date: created.date,
    StaffID: created.staffId,
    StaffName: created.staffName,
    CustomerID: created.customerId || '',
    CustomerName: created.customerName,
    In: created.in,
    Out: created.out,
    Notes: created.notes || '',
    Reference: created.reference || created.id,
  });

  return created;
};

export const deleteCustomerChange = (id: string): boolean => {
  const all = getAllCustomerChanges();
  const filtered = all.filter((c) => c.id !== id);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.CUSTOMER_CHANGES, filtered);
  enqueueSync('CustomerChange', 'DELETE', { id, company_id: getCurrentCompanyId() });
  return true;
};

export const saveDailyCustomerChangeSheet = (
  date: string,
  staffId: string,
  staffName: string,
  entries: Array<{
    customerName: string;
    customerId?: string;
    in: number;
    out: number;
    notes?: string;
  }>
): CustomerChangeEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCustomerChanges();
  // Keep records for other companies or other staff/dates in this company
  const otherChanges = all.filter((c) => {
    const compId = c.company_id || c.companyId || 'COMP-001';
    if (compId !== currentCompany) return true;
    return !(c.staffId === staffId && c.date === date);
  });
  const valid = entries.filter((e) => e.customerName.trim() !== '' && (e.in > 0 || e.out > 0));
  if (valid.length === 0) {
    setStored(STORAGE_KEYS.CUSTOMER_CHANGES, otherChanges);
    return [];
  }

  const createdList: CustomerChangeEntry[] = [];
  const now = new Date();
  const numbers = all
    .map((c) => {
      const match = c.id?.match?.(/^CHG-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  valid.forEach((item, idx) => {
    const cust = ensureCustomerExists(item.customerName, staffId);

    const newEntry: CustomerChangeEntry = {
      id: `CHG-${String(nextCounter++).padStart(3, '0')}`,
      timestamp: new Date(now.getTime() + idx * 100).toISOString(),
      date,
      staffId,
      staffName,
      customerId: cust.customerId,
      customerName: cust.name,
      in: item.in || 0,
      out: item.out || 0,
      notes: item.notes || '',
      synced: false,
      company_id: currentCompany,
      companyId: currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
    };
    createdList.push(newEntry);

    enqueueSync('CustomerChange', 'INSERT', {
      company_id: currentCompany,
      branch_id: currentBranch,
      Timestamp: newEntry.timestamp,
      Date: newEntry.date,
      StaffID: newEntry.staffId,
      StaffName: newEntry.staffName,
      CustomerID: newEntry.customerId,
      CustomerName: newEntry.customerName,
      In: newEntry.in,
      Out: newEntry.out,
      Notes: newEntry.notes,
    });
  });

  setStored(STORAGE_KEYS.CUSTOMER_CHANGES, [...createdList, ...otherChanges]);
  return createdList;
};

// ==================== CREDIT SALES DAO (FORM 3) ====================
export const getAllCreditSales = (): CreditSaleEntry[] => {
  return getStored<CreditSaleEntry[]>(STORAGE_KEYS.CREDIT_SALES, INITIAL_CREDIT_SALES);
};

export const getCreditSales = (): CreditSaleEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllCreditSales();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((c) => {
    const compId = c.company_id || c.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getNextCreditSaleId = (): string => {
  const list = getAllCreditSales();
  const numbers = list
    .map((c) => {
      const match = c.id?.match?.(/^CR-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `CR-${String(next).padStart(3, '0')}`;
};

export const addCreditSale = (
  entry: Omit<CreditSaleEntry, 'id' | 'synced'> & { id?: string; company_id?: string; companyId?: string; branch_id?: string; branchId?: string }
): CreditSaleEntry => {
  const all = getAllCreditSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branch_id || entry.branchId || currentBranch;
  const created: CreditSaleEntry = {
    ...entry,
    id: entry.id || getNextCreditSaleId(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.CREDIT_SALES, updated);

  enqueueSync('CreditSales', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    CreditID: created.id,
    Date: created.date,
    StaffID: created.staffId,
    StaffName: created.staffName,
    CustomerID: created.customerId || '',
    CustomerName: created.customerName,
    Amount: created.amount,
    In: created.in || 0,
    Out: created.out || created.amount,
    ItemDescription: created.itemDescription,
    DueDate: created.dueDate || '',
    Notes: created.notes || '',
    Status: created.status,
  });

  return created;
};

export const deleteCreditSale = (id: string): boolean => {
  const all = getAllCreditSales();
  const filtered = all.filter((c) => c.id !== id);
  if (filtered.length === all.length) return false;
  setStored(STORAGE_KEYS.CREDIT_SALES, filtered);
  enqueueSync('CreditSales', 'DELETE', { id, company_id: getCurrentCompanyId() });
  return true;
};

export const saveDailyCreditSalesSheet = (
  date: string,
  staffId: string,
  staffName: string,
  entries: Array<{
    customerName: string;
    customerId?: string;
    amount: number;
    in?: number;
    out?: number;
    itemDescription: string;
    dueDate?: string;
    notes?: string;
  }>
): CreditSaleEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const all = getAllCreditSales();
  // Keep records for other companies or other staff/dates in this company
  const otherCredits = all.filter((c) => {
    const compId = c.company_id || c.companyId || 'COMP-001';
    if (compId !== currentCompany) return true;
    return !(c.staffId === staffId && c.date === date);
  });
  const valid = entries.filter(
    (e) =>
      e.customerName.trim() !== '' &&
      ((e.amount && e.amount > 0) || (e.out && e.out > 0) || (e.in && e.in > 0))
  );
  if (valid.length === 0) {
    setStored(STORAGE_KEYS.CREDIT_SALES, otherCredits);
    return [];
  }

  const createdList: CreditSaleEntry[] = [];
  const now = new Date();
  const numbers = all
    .map((c) => {
      const match = c.id?.match?.(/^CR-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  let nextCounter = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;

  valid.forEach((item, idx) => {
    const cust = ensureCustomerExists(item.customerName, staffId);
    const creditGiven = (item.out !== undefined && item.out > 0) ? item.out : (item.amount || 0);
    const creditRepaid = item.in || 0;

    const newEntry: CreditSaleEntry = {
      id: `CR-${String(nextCounter++).padStart(3, '0')}`,
      timestamp: new Date(now.getTime() + idx * 100).toISOString(),
      date,
      staffId,
      staffName,
      customerId: cust.customerId,
      customerName: cust.name,
      amount: creditGiven,
      out: creditGiven,
      in: creditRepaid,
      itemDescription: item.itemDescription || 'Goods on Credit',
      dueDate: item.dueDate || '',
      notes: item.notes || '',
      status: creditRepaid >= creditGiven && creditGiven > 0 ? 'Paid' : (creditRepaid > 0 ? 'Partial' : 'Pending'),
      synced: false,
      company_id: currentCompany,
      companyId: currentCompany,
      branch_id: currentBranch,
      branchId: currentBranch,
    };
    createdList.push(newEntry);

    enqueueSync('CreditSales', 'INSERT', {
      company_id: currentCompany,
      branch_id: currentBranch,
      Timestamp: newEntry.timestamp,
      CreditID: newEntry.id,
      Date: newEntry.date,
      StaffID: newEntry.staffId,
      StaffName: newEntry.staffName,
      CustomerID: newEntry.customerId,
      CustomerName: newEntry.customerName,
      Amount: newEntry.amount,
      In: newEntry.in,
      Out: newEntry.out,
      ItemDescription: newEntry.itemDescription,
      DueDate: newEntry.dueDate,
      Notes: newEntry.notes,
      Status: newEntry.status,
    });
  });

  setStored(STORAGE_KEYS.CREDIT_SALES, [...createdList, ...otherCredits]);
  return createdList;
};

// ==================== SALES / INVOICE DAO (FORM 3) ====================
export const getAllSales = (): SaleInvoice[] => {
  return getStored<SaleInvoice[]>(STORAGE_KEYS.SALES, INITIAL_SALES);
};

export const getSales = (): SaleInvoice[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllSales();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((s) => {
    const compId = s.company_id || s.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getNextInvoiceId = (): string => {
  const list = getAllSales();
  const numbers = list
    .map((s) => {
      const match = s.id.match(/^INV-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `INV-${String(next).padStart(3, '0')}`;
};

type SaleCreationListener = (sale: SaleInvoice) => void;
const saleCreationListeners: Set<SaleCreationListener> = new Set();

export const onSaleCreated = (listener: SaleCreationListener) => {
  saleCreationListeners.add(listener);
  return () => {
    saleCreationListeners.delete(listener);
  };
};

export const ingestMeshSale = (sale: SaleInvoice): boolean => {
  const list = getAllSales();
  if (list.some((s) => s.id === sale.id)) {
    return false; // Already present
  }
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const normalized: SaleInvoice = {
    ...sale,
    company_id: sale.company_id || sale.companyId || currentCompany,
    companyId: sale.company_id || sale.companyId || currentCompany,
    branch_id: sale.branch_id || sale.branchId || currentBranch,
    branchId: sale.branch_id || sale.branchId || currentBranch,
  };
  const updated = [normalized, ...list];
  setStored(STORAGE_KEYS.SALES, updated);

  // Decrement product stock in inventory
  if (Array.isArray(normalized.items)) {
    normalized.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, -item.quantity);
      }
    });
  }

  // Ensure customer exists
  if (normalized.customerName && normalized.customerName !== 'Walk-in Customer') {
    ensureCustomerExists(normalized.customerName, normalized.staffId);
  }

  // Cash log entry
  if (normalized.paymentMethod === 'Cash') {
    const actualCash = Math.max(0, normalized.total - (normalized.customerCreditUsed || 0));
    addCashLog({
      timestamp: normalized.timestamp,
      date: normalized.date,
      staffId: normalized.staffId,
      staffName: normalized.staffName,
      line: 'Sales',
      description: `Mesh Sale #${normalized.id} - ${normalized.customerName} (${normalized.itemsSummary})`,
      in: actualCash,
      out: 0,
      category: 'Sales Cash',
      reference: normalized.id,
      company_id: normalized.company_id,
      branch_id: normalized.branch_id,
    });
  }

  notifyListeners();
  return true;
};

export const addSale = (
  saleData: Omit<SaleInvoice, 'id' | 'synced'> & {
    id?: string;
    recordCashLog?: boolean;
    recordCreditEntry?: boolean;
    recordChangeEntry?: boolean;
    fromMesh?: boolean;
    company_id?: string;
    companyId?: string;
    branch_id?: string;
    branchId?: string;
  }
): SaleInvoice => {
  const all = getAllSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = saleData.company_id || saleData.companyId || currentCompany;
  const brId = saleData.branch_id || saleData.branchId || currentBranch;
  const invId = saleData.id || getNextInvoiceId();
  const created: SaleInvoice = {
    ...saleData,
    id: invId,
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.SALES, updated);

  // 1. Decrement product stock in inventory
  if (Array.isArray(created.items)) {
    created.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, -item.quantity);
      }
    });
  }

  // 2. Ensure customer exists in unified customer database
  if (created.customerName && created.customerName !== 'Walk-in Customer') {
    ensureCustomerExists(created.customerName, created.staffId);
  }

  // 2b. If customer used existing store credit / change funds, record deduction in CustomerChange (Form 3)
  if (created.customerCreditUsed && created.customerCreditUsed > 0) {
    addCustomerChange({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      customerId: created.customerId,
      customerName: created.customerName,
      in: 0,
      out: created.customerCreditUsed,
      notes: `Applied customer credit/change fund to POS Invoice #${created.id}`,
      reference: created.id,
    });
  }

  // 3. If Cash sale, log to CashLog (Form 2)
  if (created.paymentMethod === 'Cash' && saleData.recordCashLog !== false) {
    // Actual cash received is total minus any applied store credit
    const actualCashCollected = Math.max(0, created.total - (created.customerCreditUsed || 0));
    addCashLog({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      line: 'Sales',
      description: `Cash sale #${created.id} - ${created.customerName} (${created.itemsSummary})${created.customerCreditUsed ? ` (Includes $${created.customerCreditUsed.toFixed(2)} store credit used)` : ''}`,
      in: actualCashCollected,
      out: 0,
      category: 'Sales Cash',
      reference: created.id,
    });

    // If customer leaves change behind with the shop, automatically record in Form 3 Customer Change
    // Supports custom editable changeAmountLeftBehind or defaults to full changeDue
    const amountToLeaveBehind =
      created.changeAmountLeftBehind !== undefined
        ? Number(created.changeAmountLeftBehind)
        : (created.changeDue || 0);

    if (created.changeLeftBehind && amountToLeaveBehind > 0 && saleData.recordChangeEntry !== false) {
      addCustomerChange({
        timestamp: created.timestamp,
        date: created.date,
        staffId: created.staffId,
        staffName: created.staffName,
        customerId: created.customerId,
        customerName: created.customerName,
        in: amountToLeaveBehind,
        out: 0,
        notes: `Change left behind ($${amountToLeaveBehind.toFixed(2)}) from POS Invoice #${created.id}`,
        reference: created.id,
      });
    }
  }

  // 4. If Credit sale, AUTOMATICALLY FILL AND RECORD CREDIT FORM (Form 3 Credit Sales)
  if (created.paymentMethod === 'Credit' && saleData.recordCreditEntry !== false) {
    const deposit = Number(created.creditDeposit) || 0;
    const totalCreditAmount = created.total;
    const creditStatus: 'Paid' | 'Partial' | 'Pending' =
      deposit >= totalCreditAmount && totalCreditAmount > 0
        ? 'Paid'
        : deposit > 0
        ? 'Partial'
        : 'Pending';

    addCreditSale({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      customerId: created.customerId,
      customerName: created.customerName,
      amount: totalCreditAmount,
      out: totalCreditAmount, // goods value taken on credit
      in: deposit, // cash deposit paid upfront
      itemDescription: created.itemsSummary || 'POS Goods on Credit',
      dueDate: created.creditDueDate || '',
      notes: `POS Credit Sale Invoice #${created.id}${deposit > 0 ? ` ($${deposit.toFixed(2)} deposit paid)` : ''}`,
      status: creditStatus,
    });

    // If partial deposit paid in cash, record the deposit into CashLog (Form 2)
    if (deposit > 0) {
      addCashLog({
        timestamp: created.timestamp,
        date: created.date,
        staffId: created.staffId,
        staffName: created.staffName,
        line: 'Sales',
        description: `Cash deposit for Credit Invoice #${created.id} - ${created.customerName}`,
        in: deposit,
        out: 0,
        category: 'Credit Deposit',
        reference: created.id,
      });
    }
  }

  // Save to Sheet "Sales"
  enqueueSync('Sales', 'INSERT', {
    company_id: created.company_id,
    branch_id: created.branch_id,
    Timestamp: created.timestamp,
    InvoiceID: created.id,
    CustomerID: created.customerId,
    CustomerName: created.customerName,
    ItemsSummary: created.itemsSummary,
    Subtotal: created.subtotal,
    Discount: created.discount,
    Total: created.total,
    PaymentMethod: created.paymentMethod,
    StaffID: created.staffId,
    StaffName: created.staffName,
    Status: created.status,
  });

  // Notify listeners so meshSyncService broadcasts the sale in real time
  if (!saleData.fromMesh) {
    saleCreationListeners.forEach((fn) => {
      try {
        fn(created);
      } catch (e) {
        console.error('saleCreationListener error:', e);
      }
    });
  }

  return created;
};

export const refundSaleInvoice = (params: {
  invoiceId: string;
  manager: Salesperson;
  cashier?: Salesperson;
  reason: string;
}): { success: boolean; message: string; invoice?: SaleInvoice } => {
  const sales = getSales();
  const invoice = sales.find((s) => s.id === params.invoiceId);
  if (!invoice) {
    return { success: false, message: `Invoice #${params.invoiceId} not found.` };
  }
  if (invoice.status === 'Refunded') {
    return { success: false, message: `Invoice #${params.invoiceId} is already refunded.` };
  }

  const now = new Date();
  invoice.status = 'Refunded';
  invoice.refundReason = params.reason;
  invoice.refundedAt = now.toISOString();
  invoice.refundApprovedBy = params.manager.name;
  invoice.refundApprovedById = params.manager.id;

  setStored(STORAGE_KEYS.SALES, sales);

  // Restore inventory stock for refunded items
  if (Array.isArray(invoice.items)) {
    invoice.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, item.quantity);
      }
    });
  }

  // If cash sale, add Cash Log (Form 2) payout entry for cash drawer balance
  if (invoice.paymentMethod === 'Cash') {
    addCashLog({
      timestamp: now.toISOString(),
      date: now.toISOString().split('T')[0],
      staffId: params.manager.id,
      staffName: params.manager.name,
      line: 'Refunds / Returns',
      description: `Cash refund for Invoice #${invoice.id} (${params.reason})`,
      in: 0,
      out: invoice.total,
      category: 'Refund',
      reference: invoice.id,
    });
  }

  // Record in Audit Log
  logManagerOverride({
    action: 'REFUND_INVOICE',
    manager: params.manager,
    cashier: params.cashier,
    referenceId: invoice.id,
    amount: invoice.total,
    details: `Refund processed for Invoice #${invoice.id} ($${invoice.total.toFixed(2)}). Authorized by ${params.manager.role} ${params.manager.name}. Reason: ${params.reason}`,
    metadata: {
      customerName: invoice.customerName,
      paymentMethod: invoice.paymentMethod,
    },
  });

  return { success: true, message: `Invoice #${invoice.id} successfully refunded.`, invoice };
};

export const voidSaleInvoice = (params: {
  invoiceId: string;
  manager: Salesperson;
  cashier?: Salesperson;
  reason: string;
}): { success: boolean; message: string; invoice?: SaleInvoice } => {
  const sales = getSales();
  const invoice = sales.find((s) => s.id === params.invoiceId);
  if (!invoice) {
    return { success: false, message: `Invoice #${params.invoiceId} not found.` };
  }

  const now = new Date();
  invoice.status = 'Voided';
  invoice.voidReason = params.reason;
  invoice.voidedAt = now.toISOString();
  invoice.voidApprovedBy = params.manager.name;
  invoice.voidApprovedById = params.manager.id;

  setStored(STORAGE_KEYS.SALES, sales);

  // If cash sale, add Cash Log (Form 2) reversal entry
  if (invoice.paymentMethod === 'Cash') {
    addCashLog({
      timestamp: now.toISOString(),
      date: now.toISOString().split('T')[0],
      staffId: params.manager.id,
      staffName: params.manager.name,
      line: 'Voids / Reversals',
      description: `Cash reversal for Voided Invoice #${invoice.id} (${params.reason})`,
      in: 0,
      out: invoice.total,
      category: 'Refund',
      reference: invoice.id,
    });
  }

  // Restore inventory stock for voided items
  if (Array.isArray(invoice.items)) {
    invoice.items.forEach((item) => {
      if (item.id && item.quantity > 0) {
        updateProductStock(item.id, item.quantity);
      }
    });
  }

  logManagerOverride({
    action: 'VOID_INVOICE',
    manager: params.manager,
    cashier: params.cashier,
    referenceId: invoice.id,
    amount: invoice.total,
    details: `Invoice #${invoice.id} ($${invoice.total.toFixed(2)}) voided by ${params.manager.role} ${params.manager.name}. Reason: ${params.reason}`,
  });

  return { success: true, message: `Invoice #${invoice.id} voided successfully.`, invoice };
};

// ==================== EXPENSE DAO ====================
export const getAllExpenses = (): ExpenseEntry[] => {
  return getStored<ExpenseEntry[]>(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
};

export const getExpenses = (): ExpenseEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllExpenses();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((e) => {
    const compId = e.company_id || e.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getNextExpenseId = (): string => {
  const list = getAllExpenses();
  const numbers = list
    .map((e) => {
      const match = e.id.match(/^EXP-(\d+)$/i);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((n): n is number => n !== null);
  const max = numbers.length > 0 ? Math.max(...numbers) : 0;
  const next = max + 1;
  return `EXP-${String(next).padStart(3, '0')}`;
};

export const addExpense = (
  expenseData: Omit<ExpenseEntry, 'id' | 'synced'> & {
    id?: string;
    recordCashLog?: boolean;
    company_id?: string;
    companyId?: string;
    branch_id?: string;
    branchId?: string;
  }
): ExpenseEntry => {
  const all = getAllExpenses();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = expenseData.company_id || expenseData.companyId || currentCompany;
  const brId = expenseData.branch_id || expenseData.branchId || currentBranch;
  const expId = expenseData.id || getNextExpenseId();
  const created: ExpenseEntry = {
    ...expenseData,
    id: expId,
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const updated = [created, ...all];
  setStored(STORAGE_KEYS.EXPENSES, updated);

  // If cash expense, add to CashLog
  if (expenseData.paymentMethod === 'Cash' && expenseData.recordCashLog !== false) {
    addCashLog({
      timestamp: created.timestamp,
      date: created.date,
      staffId: created.staffId,
      staffName: created.staffName,
      line: 'Operations',
      description: `Expense #${created.id} - ${created.category}: ${created.description}`,
      in: 0,
      out: created.amount,
      category: created.category,
      reference: created.id,
      company_id: compId,
      branch_id: brId,
    });
  }

  // Save to Sheet "Expenses"
  enqueueSync('Expenses', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    ExpenseID: created.id,
    Date: created.date,
    Category: created.category,
    VendorOrCustomer: created.vendorOrCustomer || '',
    Amount: created.amount,
    PaymentMethod: created.paymentMethod,
    StaffID: created.staffId,
    StaffName: created.staffName,
    Description: created.description,
    ReceiptRef: created.receiptRef || '',
  });

  return created;
};

// ==================== RECONCILIATIONS DAO (FORM 4) ====================
export const getAllReconciliations = (): ShiftReconciliation[] => {
  return getStored<ShiftReconciliation[]>(STORAGE_KEYS.RECONCILIATIONS, []);
};

export const getReconciliations = (): ShiftReconciliation[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllReconciliations();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((r) => {
    const compId = (r as any).company_id || (r as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const saveReconciliation = (recData: Omit<ShiftReconciliation, 'id' | 'synced' | 'timestamp'> & { id?: string }): ShiftReconciliation => {
  const list = getAllReconciliations();
  const compId = (recData as any).company_id || (recData as any).companyId || getCurrentCompanyId();
  const brId = (recData as any).branch_id || (recData as any).branchId || getCurrentBranchId();
  const created: ShiftReconciliation = {
    ...recData,
    id: recData.id || `REC-${Date.now()}`,
    timestamp: new Date().toISOString(),
    synced: false,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  } as any;
  const updated = [created, ...list];
  setStored(STORAGE_KEYS.RECONCILIATIONS, updated);

  // Save to Sheet "Reconciliations"
  enqueueSync('Reconciliations', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: created.timestamp,
    Date: created.date,
    StaffID: created.staffId,
    StaffName: created.staffName,
    OpeningFloat: created.openingFloat,
    CashSales: created.cashSales,
    OtherCashIn: created.otherCashIn,
    CashExpenses: created.cashExpenses,
    BankDrops: created.bankDrops,
    ExpectedCash: created.expectedCash,
    ActualCashCount: created.actualCashCount,
    Variance: created.variance,
    Status: created.status,
    Notes: created.notes,
  });

  return created;
};

// ==================== ADMIN SALES & RECONCILIATION BALANCING DAO (FORM 4) ====================
export const getAllAdminSales = (): AdminSalesEntry[] => {
  return getStored<AdminSalesEntry[]>(STORAGE_KEYS.ADMIN_SALES, []);
};

export const getAdminSales = (): AdminSalesEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllAdminSales();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((s) => {
    const compId = (s as any).company_id || (s as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getAdminSalesForDate = (date: string): AdminSalesEntry[] => {
  const all = getAdminSales();
  return all.filter((s) => s.date === date);
};

export const getAdminSaleForStaffAndDate = (staffId: string, date: string): AdminSalesEntry | undefined => {
  const all = getAdminSales();
  return all.find((s) => s.staffId === staffId && s.date === date);
};

export const saveAdminSalesEntry = (
  date: string,
  staffId: string,
  staffName: string,
  salesAmount: number,
  notes?: string
): AdminSalesEntry => {
  const all = getAllAdminSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const id = `AS-${date}-${staffId}`;
  const now = new Date().toISOString();
  const existingIdx = all.findIndex((s) => {
    const compId = (s as any).company_id || (s as any).companyId || 'COMP-001';
    return compId === currentCompany && s.staffId === staffId && s.date === date;
  });

  const entry: AdminSalesEntry = {
    id,
    date,
    staffId,
    staffName,
    salesAmount: Math.max(0, salesAmount || 0),
    notes: notes || '',
    timestamp: now,
    company_id: currentCompany,
    companyId: currentCompany,
    branch_id: currentBranch,
    branchId: currentBranch,
    synced: false,
  } as any;

  let updated: AdminSalesEntry[];
  if (existingIdx >= 0) {
    updated = [...all];
    updated[existingIdx] = entry;
  } else {
    updated = [entry, ...all];
  }

  setStored(STORAGE_KEYS.ADMIN_SALES, updated);
  return entry;
};

export const saveAllAdminSalesEntries = (
  date: string,
  entries: Array<{
    staffId: string;
    staffName: string;
    salesAmount: number;
    notes?: string;
  }>
): AdminSalesEntry[] => {
  const all = getAllAdminSales();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  // Filter out any entries for this specific date and company that we are updating
  const otherEntries = all.filter((s) => {
    const compId = (s as any).company_id || (s as any).companyId || 'COMP-001';
    return compId !== currentCompany || s.date !== date;
  });
  const now = new Date().toISOString();

  const newDateEntries: AdminSalesEntry[] = entries.map((e) => ({
    id: `AS-${date}-${e.staffId}`,
    date,
    staffId: e.staffId,
    staffName: e.staffName,
    salesAmount: Math.max(0, e.salesAmount || 0),
    notes: e.notes || '',
    timestamp: now,
    company_id: currentCompany,
    companyId: currentCompany,
    branch_id: currentBranch,
    branchId: currentBranch,
    synced: false,
  } as any));

  const updatedAll = [...newDateEntries, ...otherEntries];
  setStored(STORAGE_KEYS.ADMIN_SALES, updatedAll);
  return newDateEntries;
};

/**
 * Calculates the exact cash position, net sums, should have, and variance for a salesperson on a given date.
 * Formulas as requested:
 * - Form 2 Net = Form 2 In - Form 2 Out
 * - Form 3 Net = Form 3 In - Form 3 Out (Customer Change + Credit Sales)
 * - Sum of Form 2 & 3 Net = Form 2 Net + Form 3 Net
 * - Should Have = (Sum of Form 2 & 3 Net) - Sales
 * - Variance = Sales - (Sum of Form 2 & 3 Net)
 */
export const calculateSalespersonCashBalancing = (
  staffId: string,
  staffName: string,
  date: string,
  overrideSales?: number
) => {
  // Form 2 Logs
  const form2Logs = getCashLogsForStaffAndDate(staffId, date);
  const form2In = form2Logs.reduce((sum, l) => sum + (l.in || 0), 0);
  const form2Out = form2Logs.reduce((sum, l) => sum + (l.out || 0), 0);
  const form2Net = form2In - form2Out;

  // Form 3 Customer Change
  const form3Changes = getCustomerChangesForStaffAndDate(staffId, date);
  const changeIn = form3Changes.reduce((sum, c) => sum + (c.in || 0), 0);
  const changeOut = form3Changes.reduce((sum, c) => sum + (c.out || 0), 0);

  // Form 3 Credit Sales
  const form3Credits = getCreditSalesForStaffAndDate(staffId, date);
  const creditIn = form3Credits.reduce((sum, c) => sum + (c.in || 0), 0);
  const creditOut = form3Credits.reduce((sum, c) => sum + (c.out || c.amount || 0), 0);

  const form3In = changeIn + creditIn;
  const form3Out = changeOut + creditOut;
  const form3Net = form3In - form3Out;

  // Sum of Form 2 & 3 Net
  const sumForm2And3Net = form2Net + form3Net;

  // Sales (from Admin entry or override)
  const savedAdminSale = getAdminSaleForStaffAndDate(staffId, date);
  const sales = overrideSales !== undefined ? overrideSales : (savedAdminSale?.salesAmount || 0);

  // Should Have = Net of Form 2 + Net of Form 3 + Sales = (Sum of Form 2 & 3 Net) + Sales
  const shouldHave = sumForm2And3Net + sales;

  // Variance = 0 - Should Have
  const variance = 0 - shouldHave;

  // Status
  let status: 'Balanced' | 'Over' | 'Shortage' | 'No Activity' = 'Balanced';
  const hasActivity = form2Logs.length > 0 || form3Changes.length > 0 || form3Credits.length > 0 || sales > 0;
  if (!hasActivity) {
    status = 'No Activity';
  } else if (Math.abs(variance) < 0.01) {
    status = 'Balanced';
  } else if (variance < 0) {
    // Variance < 0 (i.e. Should Have > 0) => Shortage / Deficit
    status = 'Shortage';
  } else {
    // Variance > 0 (i.e. Should Have < 0) => Cash Over / Surplus
    status = 'Over';
  }

  // Form 1 Physical Count for reference
  const countRecord = getCashCountForStaffAndDate(staffId, date);
  const form1Counted = countRecord ? countRecord.finalCashOutTotal : null;

  return {
    staffId,
    staffName,
    date,
    form2In,
    form2Out,
    form2Net,
    form3In,
    form3Out,
    form3Net,
    changeIn,
    changeOut,
    creditIn,
    creditOut,
    sumForm2And3Net,
    sales,
    shouldHave,
    variance,
    status,
    hasActivity,
    form1Counted,
    notes: savedAdminSale?.notes || '',
    form2LogsCount: form2Logs.length,
    form3ChangesCount: form3Changes.length,
    form3CreditsCount: form3Credits.length,
  };
};

// ==================== SYNC QUEUE DAO ====================
export const getSyncQueue = (): SyncQueueItem[] => {
  return getStored<SyncQueueItem[]>(STORAGE_KEYS.SYNC_QUEUE, []);
};

export const enqueueSync = (sheetName: SheetName, action: 'INSERT' | 'UPDATE' | 'DELETE', payload: Record<string, any>) => {
  const current = getSyncQueue();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionUser = getSessionUser();

  const enhancedPayload = {
    company_id: payload.company_id || currentCompany,
    branch_id: payload.branch_id || currentBranch,
    user_branch_id: payload.user_branch_id || sessionUser?.branch_id || currentBranch,
    user_id: payload.user_id || sessionUser?.user_id || 'USR-001',
    user_role: payload.user_role || sessionUser?.role || 'CASHIER',
    ...payload,
  };

  const newItem: SyncQueueItem = {
    id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    sheetName,
    action,
    payload: enhancedPayload,
    timestamp: Date.now(),
    retries: 0,
    status: 'pending',
  };
  setStored(STORAGE_KEYS.SYNC_QUEUE, [...current, newItem]);
};

export const updateSyncQueueItem = (id: string, updates: Partial<SyncQueueItem>) => {
  const current = getSyncQueue();
  const updated = current.map((item) => (item.id === id ? { ...item, ...updates } : item));
  setStored(STORAGE_KEYS.SYNC_QUEUE, updated);
};

export const clearSyncedQueueItems = () => {
  const current = getSyncQueue();
  const filtered = current.filter((item) => item.status !== 'synced');
  setStored(STORAGE_KEYS.SYNC_QUEUE, filtered);
};

export const purgeSyncedRecords = clearSyncedQueueItems;

export const getSheetsConfig = (): GoogleSheetsConfig => {
  const base = getStored<GoogleSheetsConfig>(STORAGE_KEYS.SHEETS_CONFIG, {
    webhookUrl: '',
    spreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    masterSpreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    branchIsolationMode: 'ROW_LEVEL',
    sheetNameMap: {
      Customers: 'Customers',
      Suppliers: 'Suppliers',
      CashLog: 'CashLog',
      Sales: 'Sales',
      Expenses: 'Expenses',
      Reconciliations: 'Reconciliations',
      Salespeople: 'Salespeople',
      CustomerChange: 'CustomerChange',
      CreditSales: 'CreditSales',
      Products: 'Products',
      companies: 'companies',
      branches: 'branches',
      users: 'users',
      Direct_GRV: 'Direct_GRV',
      Audit_Log: 'Audit_Log',
      StockMovement: 'StockMovement',
      GoodsReceived: 'GoodsReceived',
    },
    autoSync: true,
    simulateSyncLatency: true,
  });

  // Dynamically resolve tenant-specific sheet from active company (Option A: Separate Sheet File per Tenant)
  const currentCompany = getCurrentCompany();
  const currentCompId = currentCompany?.company_id || 'COMP-001';

  // Per-tenant override if exists in tenantConfigs
  const tenantOverride = base.tenantConfigs?.[currentCompId];
  const dedicatedSheetId =
    tenantOverride?.spreadsheetId ||
    currentCompany?.sheet_id ||
    (currentCompId === 'COMP-001' ? '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE' : '');
  const dedicatedWebhookUrl = tenantOverride?.webhookUrl || currentCompany?.webhook_url || base.webhookUrl || '';
  const branchIsolation =
    tenantOverride?.branchIsolationMode || currentCompany?.branch_isolation_mode || base.branchIsolationMode || 'ROW_LEVEL';

  return {
    ...base,
    masterSpreadsheetId: base.masterSpreadsheetId || '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    spreadsheetId: dedicatedSheetId,
    webhookUrl: dedicatedWebhookUrl,
    branchIsolationMode: branchIsolation,
  };
};

export const updateSheetsConfig = (updates: Partial<GoogleSheetsConfig>) => {
  const current = getStored<GoogleSheetsConfig>(STORAGE_KEYS.SHEETS_CONFIG, {
    webhookUrl: '',
    spreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    masterSpreadsheetId: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    branchIsolationMode: 'ROW_LEVEL',
    sheetNameMap: {
      Customers: 'Customers',
      Suppliers: 'Suppliers',
      CashLog: 'CashLog',
      Sales: 'Sales',
      Expenses: 'Expenses',
      Reconciliations: 'Reconciliations',
      Salespeople: 'Salespeople',
      CustomerChange: 'CustomerChange',
      CreditSales: 'CreditSales',
      Products: 'Products',
      companies: 'companies',
      branches: 'branches',
      users: 'users',
      Direct_GRV: 'Direct_GRV',
      Audit_Log: 'Audit_Log',
      StockMovement: 'StockMovement',
      GoodsReceived: 'GoodsReceived',
    },
    autoSync: true,
    simulateSyncLatency: true,
  });

  const currentCompany = getCurrentCompany();
  const currentCompId = currentCompany?.company_id || 'COMP-001';

  // If updates contain spreadsheetId, webhookUrl, or branchIsolationMode, persist per-tenant
  const updatedTenantConfigs = { ...(current.tenantConfigs || {}) };
  if (updates.spreadsheetId || updates.webhookUrl !== undefined || updates.branchIsolationMode) {
    const existingTenant = updatedTenantConfigs[currentCompId];
    updatedTenantConfigs[currentCompId] = {
      companyId: currentCompId,
      companyName: currentCompany?.company_name || 'Tenant',
      spreadsheetId: updates.spreadsheetId || existingTenant?.spreadsheetId || currentCompany?.sheet_id || current.spreadsheetId,
      webhookUrl: updates.webhookUrl !== undefined ? updates.webhookUrl : (existingTenant?.webhookUrl || currentCompany?.webhook_url || current.webhookUrl),
      branchIsolationMode: updates.branchIsolationMode || existingTenant?.branchIsolationMode || currentCompany?.branch_isolation_mode || 'ROW_LEVEL',
      lastSyncTimestamp: updates.lastSyncTimestamp || existingTenant?.lastSyncTimestamp,
    };

    // Also synchronize back to the Company entity in Room DB
    if (currentCompany) {
      saveCompany({
        ...currentCompany,
        sheet_id: updates.spreadsheetId || currentCompany.sheet_id,
        webhook_url: updates.webhookUrl !== undefined ? updates.webhookUrl : currentCompany.webhook_url,
        branch_isolation_mode: updates.branchIsolationMode || currentCompany.branch_isolation_mode,
      });
    }
  }

  const updated: GoogleSheetsConfig = {
    ...current,
    ...updates,
    tenantConfigs: updatedTenantConfigs,
  };
  setStored(STORAGE_KEYS.SHEETS_CONFIG, updated);
  return updated;
};

export const saveSheetsConfig = updateSheetsConfig;

export const updateTenantSheetBinding = (
  companyId: string,
  sheetId: string,
  webhookUrl?: string,
  isolationMode?: 'ROW_LEVEL' | 'BRANCH_TABS' | 'HYBRID'
) => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (comp) {
    comp.sheet_id = sheetId;
    if (webhookUrl !== undefined) comp.webhook_url = webhookUrl;
    if (isolationMode) comp.branch_isolation_mode = isolationMode;
    saveCompany(comp);
  }

  const currentConfig = getStored<GoogleSheetsConfig>(STORAGE_KEYS.SHEETS_CONFIG, getSheetsConfig());
  const tenantConfigs = { ...(currentConfig.tenantConfigs || {}) };
  tenantConfigs[companyId] = {
    companyId,
    companyName: comp?.company_name || companyId,
    spreadsheetId: sheetId,
    webhookUrl: webhookUrl !== undefined ? webhookUrl : comp?.webhook_url,
    branchIsolationMode: isolationMode || comp?.branch_isolation_mode || 'ROW_LEVEL',
  };
  setStored(STORAGE_KEYS.SHEETS_CONFIG, { ...currentConfig, tenantConfigs });
};

export const isOfflineModeForced = (): boolean => {
  return getStored<boolean>(STORAGE_KEYS.OFFLINE_MODE, false);
};

export const setOfflineModeForced = (forced: boolean): void => {
  setStored(STORAGE_KEYS.OFFLINE_MODE, forced);
};

// ==================== CUSTOMER CHANGE & CREDIT REPORTS ====================

/**
 * Calculates days elapsed between a date string (YYYY-MM-DD) and today's date
 */
export const calculateDaysElapsed = (dateStr?: string): number => {
  if (!dateStr) return 0;
  try {
    const target = new Date(dateStr + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffTime = today.getTime() - target.getTime();
    return Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  } catch (err) {
    return 0;
  }
};

/**
 * Generates the Customer Change Report (Change Owed to Customers)
 * Groups by customer, calculates total IN (change left with business),
 * total OUT (change returned), net change owed, and days since change was left.
 */
export const getCustomerChangeReport = (): {
  items: CustomerChangeReportItem[];
  summary: {
    totalChangeOwed: number;
    totalCustomersOwingChange: number;
    totalInHistorical: number;
    totalOutHistorical: number;
    aged0To7DaysTotal: number;
    aged8To14DaysTotal: number;
    aged15PlusDaysTotal: number;
  };
} => {
  const allChanges = getCustomerChanges();
  const allCustomers = getCustomers();

  // Map to group change entries by customer
  const customerMap = new Map<string, {
    customerId: string;
    customerName: string;
    phone?: string;
    address?: string;
    entries: CustomerChangeEntry[];
  }>();

  // First initialize from known customers in DB
  allCustomers.forEach((cust) => {
    customerMap.set(cust.customerId, {
      customerId: cust.customerId,
      customerName: cust.name,
      phone: cust.phone,
      address: cust.address,
      entries: [],
    });
  });

  // Group all change entries
  allChanges.forEach((entry) => {
    let key = entry.customerId;
    const cleanEntryName = (entry.customerName || '').trim().toLowerCase();
    if (!key) {
      const match = allCustomers.find(
        (c) => (c.name || '').trim().toLowerCase() === cleanEntryName
      );
      key = match ? match.customerId : `unregistered_${cleanEntryName || 'walkin'}`;
    }

    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerId: entry.customerId || 'C-NEW',
        customerName: entry.customerName || 'Walk-in Customer',
        entries: [],
      });
    }

    customerMap.get(key)!.entries.push(entry);
  });

  const items: CustomerChangeReportItem[] = [];
  let totalChangeOwed = 0;
  let totalInHistorical = 0;
  let totalOutHistorical = 0;
  let aged0To7DaysTotal = 0;
  let aged8To14DaysTotal = 0;
  let aged15PlusDaysTotal = 0;

  customerMap.forEach((data) => {
    const { entries, customerId, customerName, phone, address } = data;
    if (entries.length === 0) return; // Skip customers with zero change history

    // Sort entries chronologically
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let totalIn = 0;
    let totalOut = 0;
    const inDates: string[] = [];

    entries.forEach((e) => {
      const inVal = Number(e.in) || 0;
      const outVal = Number(e.out) || 0;
      totalIn += inVal;
      totalOut += outVal;
      if (inVal > 0 && e.date) {
        inDates.push(e.date);
      }
    });

    const netChangeOwed = Math.round((totalIn - totalOut) * 100) / 100;
    const firstInDate = inDates.length > 0 ? inDates[0] : undefined;
    const latestInDate = inDates.length > 0 ? inDates[inDates.length - 1] : undefined;

    const daysSinceFirstIn = calculateDaysElapsed(firstInDate);
    const daysSinceLatestIn = calculateDaysElapsed(latestInDate);

    let status: 'Owed' | 'Cleared' | 'Overpaid' = 'Cleared';
    if (netChangeOwed > 0.001) {
      status = 'Owed';
      totalChangeOwed += netChangeOwed;

      if (daysSinceFirstIn <= 7) {
        aged0To7DaysTotal += netChangeOwed;
      } else if (daysSinceFirstIn <= 14) {
        aged8To14DaysTotal += netChangeOwed;
      } else {
        aged15PlusDaysTotal += netChangeOwed;
      }
    } else if (netChangeOwed < -0.001) {
      status = 'Overpaid';
    }

    totalInHistorical += totalIn;
    totalOutHistorical += totalOut;

    items.push({
      customerId,
      customerName,
      phone,
      address,
      totalIn,
      totalOut,
      netChangeOwed,
      firstInDate,
      latestInDate,
      daysSinceFirstIn,
      daysSinceLatestIn,
      unsettledInAmount: Math.max(0, netChangeOwed),
      transactionsCount: entries.length,
      transactions: entries,
      status,
    });
  });

  // Sort report items: Active change owed first (highest days / highest amount), then settled
  items.sort((a, b) => {
    if (a.status === 'Owed' && b.status !== 'Owed') return -1;
    if (b.status === 'Owed' && a.status !== 'Owed') return 1;
    if (a.netChangeOwed !== b.netChangeOwed) return b.netChangeOwed - a.netChangeOwed;
    return b.daysSinceFirstIn - a.daysSinceFirstIn;
  });

  const totalCustomersOwingChange = items.filter((i) => i.status === 'Owed').length;

  return {
    items,
    summary: {
      totalChangeOwed,
      totalCustomersOwingChange,
      totalInHistorical,
      totalOutHistorical,
      aged0To7DaysTotal,
      aged8To14DaysTotal,
      aged15PlusDaysTotal,
    },
  };
};

/**
 * Calculates the current available net store credit / change balance left behind by a customer.
 * Returns positive number if customer has unclaimed change funds with the shop.
 */
export const getCustomerChangeBalance = (customerId?: string, customerName?: string): number => {
  if (!customerId && !customerName) return 0;
  const entries = getCustomerChanges();
  const normId = customerId?.trim().toLowerCase();
  const normName = customerName?.trim().toLowerCase();

  const customerEntries = entries.filter((e) => {
    if (normId && e.customerId && e.customerId.trim().toLowerCase() === normId) return true;
    if (normName && e.customerName && e.customerName.trim().toLowerCase() === normName) return true;
    return false;
  });

  const totalIn = customerEntries.reduce((sum, e) => sum + (Number(e.in) || 0), 0);
  const totalOut = customerEntries.reduce((sum, e) => sum + (Number(e.out) || 0), 0);
  const net = totalIn - totalOut;
  return net > 0 ? Math.round(net * 100) / 100 : 0;
};

/**
 * Generates the Credit Sales Report (Customer Debt Owed to Business)
 * Groups by customer, calculates total Credit Taken (IN/Amount),
 * total Repaid (OUT), net debt owed, and days owing since credit collection.
 */
export const getCustomerCreditReport = (): {
  items: CustomerCreditReportItem[];
  summary: {
    totalOutstandingDebt: number;
    totalDebtorsCount: number;
    totalCreditIssued: number;
    totalRepayments: number;
    overdueCount: number;
    overdueAmount: number;
    aged0To7DaysTotal: number;
    aged8To14DaysTotal: number;
    aged15PlusDaysTotal: number;
  };
} => {
  const allCredits = getCreditSales();
  const allCustomers = getCustomers();
  const todayStr = new Date().toISOString().split('T')[0];

  const customerMap = new Map<string, {
    customerId: string;
    customerName: string;
    phone?: string;
    address?: string;
    entries: CreditSaleEntry[];
  }>();

  allCustomers.forEach((cust) => {
    customerMap.set(cust.customerId, {
      customerId: cust.customerId,
      customerName: cust.name,
      phone: cust.phone,
      address: cust.address,
      entries: [],
    });
  });

  allCredits.forEach((entry) => {
    let key = entry.customerId;
    const cleanEntryName = (entry.customerName || '').trim().toLowerCase();
    if (!key) {
      const match = allCustomers.find(
        (c) => (c.name || '').trim().toLowerCase() === cleanEntryName
      );
      key = match ? match.customerId : `unregistered_${cleanEntryName || 'walkin'}`;
    }

    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerId: entry.customerId || 'C-NEW',
        customerName: entry.customerName || 'Walk-in Customer',
        entries: [],
      });
    }

    customerMap.get(key)!.entries.push(entry);
  });

  const items: CustomerCreditReportItem[] = [];
  let totalOutstandingDebt = 0;
  let totalCreditIssued = 0;
  let totalRepayments = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  let aged0To7DaysTotal = 0;
  let aged8To14DaysTotal = 0;
  let aged15PlusDaysTotal = 0;

  customerMap.forEach((data) => {
    const { entries, customerId, customerName, phone, address } = data;
    if (entries.length === 0) return;

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let totalCreditIn = 0;
    let totalRepaidOut = 0;
    const creditDates: string[] = [];
    const itemDescriptions: string[] = [];
    let earliestDueDate: string | undefined = undefined;

    entries.forEach((e) => {
      let creditGiven = 0;
      let creditRepaid = 0;

      const rawAmount = Number(e.amount) || 0;
      const rawOut = Number(e.out) || 0;
      const rawIn = Number(e.in) || 0;

      const isRepaymentRecord =
        e.itemDescription?.toLowerCase().includes('repayment') ||
        e.itemDescription?.toLowerCase().includes('settlement') ||
        (e.status === 'Paid' && rawAmount === 0);

      if (isRepaymentRecord) {
        creditRepaid = rawIn > 0 ? rawIn : (rawOut > 0 ? rawOut : rawAmount);
        creditGiven = 0;
      } else {
        // Standard Credit Sale:
        // Form 3 saves: out = goods value given on credit, in = deposit/repayment
        if (rawOut > 0) {
          creditGiven = rawOut;
          creditRepaid = rawIn;
        } else if (rawAmount > 0) {
          creditGiven = rawAmount;
          creditRepaid = rawIn;
        } else if (rawIn > 0) {
          // If only in is provided without goods value, it's a debt repayment
          creditRepaid = rawIn;
        }
      }

      totalCreditIn += creditGiven;
      totalRepaidOut += creditRepaid;

      if (creditGiven > 0 && e.date) {
        creditDates.push(e.date);
      }

      if (e.itemDescription && !itemDescriptions.includes(e.itemDescription)) {
        itemDescriptions.push(e.itemDescription);
      }

      if (e.dueDate) {
        if (!earliestDueDate || new Date(e.dueDate) < new Date(earliestDueDate)) {
          earliestDueDate = e.dueDate;
        }
      }
    });

    const netDebtOwed = Math.round((totalCreditIn - totalRepaidOut) * 100) / 100;
    const firstCreditDate = creditDates.length > 0 ? creditDates[0] : undefined;
    const latestCreditDate = creditDates.length > 0 ? creditDates[creditDates.length - 1] : undefined;
    const daysOwing = calculateDaysElapsed(firstCreditDate);

    const isOverdue = Boolean(
      netDebtOwed > 0.001 && earliestDueDate && earliestDueDate < todayStr
    );

    let status: 'Owing' | 'Settled' | 'Overpaid' = 'Settled';
    if (netDebtOwed > 0.001) {
      status = 'Owing';
      totalOutstandingDebt += netDebtOwed;

      if (isOverdue) {
        overdueCount += 1;
        overdueAmount += netDebtOwed;
      }

      if (daysOwing <= 7) {
        aged0To7DaysTotal += netDebtOwed;
      } else if (daysOwing <= 14) {
        aged8To14DaysTotal += netDebtOwed;
      } else {
        aged15PlusDaysTotal += netChangeOwedForBucket(daysOwing, netDebtOwed);
      }
    } else if (netDebtOwed < -0.001) {
      status = 'Overpaid';
    }

    totalCreditIssued += totalCreditIn;
    totalRepayments += totalRepaidOut;

    items.push({
      customerId,
      customerName,
      phone,
      address,
      totalCreditIn,
      totalRepaidOut,
      netDebtOwed,
      firstCreditDate,
      latestCreditDate,
      daysOwing,
      dueDate: earliestDueDate,
      isOverdue,
      itemDescriptions,
      transactionsCount: entries.length,
      transactions: entries,
      status,
    });
  });

  function netChangeOwedForBucket(days: number, amount: number) {
    if (days >= 15) return amount;
    return 0;
  }

  // Sort debtors first (highest debt owed, then longest days owing)
  items.sort((a, b) => {
    if (a.status === 'Owing' && b.status !== 'Owing') return -1;
    if (b.status === 'Owing' && a.status !== 'Owing') return 1;
    if (a.netDebtOwed !== b.netDebtOwed) return b.netDebtOwed - a.netDebtOwed;
    return b.daysOwing - a.daysOwing;
  });

  const totalDebtorsCount = items.filter((i) => i.status === 'Owing').length;

  return {
    items,
    summary: {
      totalOutstandingDebt,
      totalDebtorsCount,
      totalCreditIssued,
      totalRepayments,
      overdueCount,
      overdueAmount,
      aged0To7DaysTotal,
      aged8To14DaysTotal,
      aged15PlusDaysTotal,
    },
  };
};

/**
 * Helper to quickly record a change payout (returning change to customer)
 */
export const settleCustomerChangePayout = (
  customerId: string,
  customerName: string,
  amountOut: number,
  staffId: string,
  staffName: string,
  notes?: string
): CustomerChangeEntry => {
  const todayStr = new Date().toISOString().split('T')[0];
  return addCustomerChange({
    timestamp: new Date().toISOString(),
    date: todayStr,
    staffId,
    staffName,
    customerId,
    customerName,
    in: 0,
    out: amountOut,
    notes: notes || `Settlement payout of customer change balance ($${amountOut.toFixed(2)})`,
  });
};

/**
 * Helper to quickly record a customer credit repayment (debt settlement)
 */
export const recordCustomerCreditPayment = (
  customerId: string,
  customerName: string,
  amountRepaid: number,
  staffId: string,
  staffName: string,
  notes?: string
): CreditSaleEntry => {
  const todayStr = new Date().toISOString().split('T')[0];
  return addCreditSale({
    timestamp: new Date().toISOString(),
    date: todayStr,
    staffId,
    staffName,
    customerId,
    customerName,
    amount: 0,
    out: 0,
    in: amountRepaid,
    itemDescription: 'Credit Debt Repayment / Settlement',
    notes: notes || `Customer debt repayment received ($${amountRepaid.toFixed(2)})`,
    status: 'Paid',
  });
};

// ============================================================================
// INVENTORY MANAGEMENT MODULE (Cases + Singles Flexible Engine)
// Rules A, B, C, D Implementation
// ============================================================================

export const getAllInventoryItems = (): InventoryItem[] => {
  return getStored<InventoryItem[]>(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
};

export const getInventoryItems = (): InventoryItem[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllInventoryItems();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((item) => {
    const compId = item.company_id || (item as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getInventoryItemById = (itemId: string): InventoryItem | null => {
  const items = getInventoryItems();
  return items.find((i) => i.itemId.toUpperCase() === itemId.toUpperCase() || i.sku?.toUpperCase() === itemId.toUpperCase()) || null;
};

export const saveInventoryItem = (item: InventoryItem): InventoryItem => {
  const allItems = getAllInventoryItems();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();

  const compId = item.company_id || (item as any).companyId || currentCompany;
  const brId = item.branch_id || (item as any).branchId || currentBranch;

  const index = allItems.findIndex((i) => {
    const iComp = i.company_id || (i as any).companyId || 'COMP-001';
    return (
      iComp === compId &&
      (i.itemId.toUpperCase() === item.itemId.toUpperCase() ||
        (Boolean(i.sku) && Boolean(item.sku) && i.sku.toUpperCase() === item.sku.toUpperCase()))
    );
  });

  // Enforce mathematical formulas (allow negative singles/total units if selling negative):
  const unitsPerCase = Math.max(1, item.unitsPerCase || 1);
  const costPerCase = item.costPerCase || 0;
  const costPerUnit = costPerCase / unitsPerCase;
  const stockCases = Math.max(0, item.stockCases || 0);
  const stockSingles = item.stockSingles !== undefined ? item.stockSingles : 0;
  const totalUnits = (stockCases * unitsPerCase) + stockSingles;

  const normalized: InventoryItem = {
    ...item,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
    unitsPerCase,
    costPerCase,
    costPerUnit,
    stockCases,
    stockSingles,
    totalUnits,
    lastUpdated: new Date().toISOString(),
  };

  if (index >= 0) {
    allItems[index] = normalized;
  } else {
    allItems.unshift(normalized);
  }

  setStored(STORAGE_KEYS.INVENTORY_ITEMS, allItems);
  return normalized;
};

// ============================================================================
// CORE RULE 1: BATCH TRACKING & CORE RULE 2: FIFO DEDUCTION WITH NEGATIVE BALANCES
// ============================================================================

export const getAllStockBatches = (): StockBatch[] => {
  return getStored<StockBatch[]>(STORAGE_KEYS.STOCK_BATCHES, []);
};

export const getStockBatches = (): StockBatch[] => {
  let batches = getAllStockBatches();
  if (batches.length === 0) {
    // Bootstrap initial batches from all inventory items if none exist
    const items = getAllInventoryItems();
    const generated: StockBatch[] = [];
    const now = new Date();

    items.forEach((item, idx) => {
      const totalUnits = (item.stockCases * item.unitsPerCase) + item.stockSingles;
      if (totalUnits > 0) {
        // Create 1-2 realistic batches with varying expiry and received dates
        const daysAgo = (idx % 4) * 22 + 5; // e.g. 5, 27, 49, 71 days ago
        const recDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Expiry date: some close (<30 days), some medium, some far
        const expDays = idx % 5 === 0 ? 14 : idx % 5 === 1 ? 26 : idx % 5 === 2 ? 60 : 180;
        const expDate = new Date(now.getTime() + expDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        generated.push({
          id: `BAT-${recDate.replace(/-/g, '')}-${String(idx + 1).padStart(3, '0')}`,
          batchNumber: `BATCH-2026-${String(idx + 1).padStart(3, '0')}`,
          itemId: item.itemId,
          itemName: item.itemName,
          qtyReceived: totalUnits,
          qtyOnHand: totalUnits,
          cost: totalUnits * item.costPerUnit,
          costPerUnit: item.costPerUnit,
          costPerCase: item.costPerCase,
          expiryDate: expDate,
          receivedDate: recDate,
          supplier: idx % 2 === 0 ? 'National Foods Wholesalers' : 'Delta Beverages Ltd',
          grnId: `GRN-${recDate.replace(/-/g, '')}-001`,
          invoiceNo: `INV-SUP-${9000 + idx}`,
          createdAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
          companyId: item.companyId || (item as any).company_id || 'COMP-001',
          company_id: item.company_id || (item as any).companyId || 'COMP-001',
          branchId: item.branchId || (item as any).branch_id || 'BR-MAIN',
          branch_id: item.branch_id || (item as any).branchId || 'BR-MAIN',
        });
      }
    });

    if (generated.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEYS.STOCK_BATCHES, JSON.stringify(generated));
      } catch (err) {
        console.error('Error bootstrapping stock batches:', err);
      }
      batches = generated;
    }
  }

  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return batches;
  }
  return batches.filter((b) => {
    const compId = b.company_id || b.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getBatchesByItemId = (itemId: string): StockBatch[] => {
  const batches = getStockBatches();
  return batches.filter((b) => b.itemId.toUpperCase() === itemId.toUpperCase());
};

export const saveStockBatch = (batch: StockBatch): StockBatch => {
  const batches = getAllStockBatches();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = batch.company_id || batch.companyId || currentCompany;
  const brId = batch.branch_id || batch.branchId || currentBranch;
  const index = batches.findIndex((b) => b.id === batch.id);
  const normalized: StockBatch = {
    ...batch,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
    qtyOnHand: Math.max(0, batch.qtyOnHand), // Core constraint: batch qty can NEVER be negative
  };
  if (index >= 0) {
    batches[index] = normalized;
  } else {
    batches.unshift(normalized);
  }
  setStored(STORAGE_KEYS.STOCK_BATCHES, batches);
  return normalized;
};

export const deleteStockBatch = (batchId: string): boolean => {
  const batches = getAllStockBatches();
  const filtered = batches.filter((b) => b.id !== batchId);
  if (filtered.length !== batches.length) {
    setStored(STORAGE_KEYS.STOCK_BATCHES, filtered);
    return true;
  }
  return false;
};

export const getAllNegativeBalances = (): NegativeBalanceEntry[] => {
  return getStored<NegativeBalanceEntry[]>(STORAGE_KEYS.NEGATIVE_BALANCES, []);
};

export const getNegativeBalances = (): NegativeBalanceEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllNegativeBalances();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((n) => {
    const compId = (n as any).company_id || (n as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const saveNegativeBalance = (entry: NegativeBalanceEntry): NegativeBalanceEntry => {
  const list = getAllNegativeBalances();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const normalized: NegativeBalanceEntry = {
    ...entry,
    company_id: (entry as any).company_id || (entry as any).companyId || currentCompany,
    companyId: (entry as any).companyId || (entry as any).company_id || currentCompany,
    branch_id: (entry as any).branch_id || (entry as any).branchId || currentBranch,
    branchId: (entry as any).branchId || (entry as any).branch_id || currentBranch,
  } as any;
  const index = list.findIndex((e) => e.id === entry.id);
  if (index >= 0) {
    list[index] = normalized;
  } else {
    list.unshift(normalized);
  }
  setStored(STORAGE_KEYS.NEGATIVE_BALANCES, list);
  return normalized;
};

export const getOpenNegativeBalances = (itemId?: string): NegativeBalanceEntry[] => {
  const list = getNegativeBalances();
  return list.filter(
    (e) => e.status === 'OPEN' && (!itemId || e.itemId.toUpperCase() === itemId.toUpperCase())
  );
};

/**
 * Deduct from batches using FIFO. Order by Expiry Date ASC, then Received Date ASC.
 * If total stock is 0 and allowNegative is true, create a Negative Balance entry.
 */
export const deductStockFIFO = (params: {
  itemId: string;
  quantityUnits: number;
  staffId: string;
  staffName?: string;
  saleInvoiceId?: string;
  allowNegative?: boolean;
}): {
  success: boolean;
  deductedFromBatches: { batchId: string; qty: number; expiryDate?: string }[];
  negativeQty: number;
  negativeEntry?: NegativeBalanceEntry;
  error?: string;
} => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return { success: false, deductedFromBatches: [], negativeQty: 0, error: 'Product not found' };
  }

  const batches = getStockBatches();
  // Filter active batches for this product with qtyOnHand > 0
  const itemBatches = batches.filter(
    (b) => b.itemId.toUpperCase() === item.itemId.toUpperCase() && b.qtyOnHand > 0
  );

  // CORE RULE 2: Order by Expiry Date ASC, then Received Date ASC
  itemBatches.sort((a, b) => {
    if (a.expiryDate && b.expiryDate) {
      const expDiff = new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      if (expDiff !== 0) return expDiff;
    } else if (a.expiryDate && !b.expiryDate) {
      return -1;
    } else if (!a.expiryDate && b.expiryDate) {
      return 1;
    }
    return new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime();
  });

  let remainingToDeduct = params.quantityUnits;
  const deductedBatches: { batchId: string; qty: number; expiryDate?: string }[] = [];

  for (const batch of itemBatches) {
    if (remainingToDeduct <= 0) break;
    const canTake = Math.min(batch.qtyOnHand, remainingToDeduct);
    batch.qtyOnHand -= canTake;
    remainingToDeduct -= canTake;
    deductedBatches.push({ batchId: batch.id, qty: canTake, expiryDate: batch.expiryDate });
  }

  // Save all updated batches
  setStored(STORAGE_KEYS.STOCK_BATCHES, batches);

  // If remainingToDeduct > 0 (all available batches depleted, goes below 0)
  if (remainingToDeduct > 0) {
    if (!params.allowNegative) {
      return {
        success: false,
        deductedFromBatches: deductedBatches,
        negativeQty: 0,
        error: `Insufficient stock for ${item.itemName} (${item.totalUnits} on hand). Negative selling permission required.`,
      };
    }

    // CORE RULE 2: When selling negative: Do NOT assign an expiry/batch. Create a "Negative Balance" entry.
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split('T')[0];
    const negId = `NEG-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

    const negEntry: NegativeBalanceEntry = {
      id: negId,
      itemId: item.itemId,
      itemName: item.itemName,
      negativeQty: remainingToDeduct,
      clearedQty: 0,
      saleCost: item.costPerUnit,
      salePrice: item.sellPriceUnit,
      saleDate: dateStr,
      timestamp,
      saleInvoiceId: params.saleInvoiceId,
      soldBy: params.staffId,
      soldByName: params.staffName,
      status: 'OPEN',
      potentialLoss: 0,
    };

    saveNegativeBalance(negEntry);

    return {
      success: true,
      deductedFromBatches: deductedBatches,
      negativeQty: remainingToDeduct,
      negativeEntry: negEntry,
    };
  }

  return {
    success: true,
    deductedFromBatches: deductedBatches,
    negativeQty: 0,
  };
};

/**
 * On next Goods Receiving: First, use the new received qty to clear any Negative Balance.
 * Fulfills negative sales from newest batch received, and computes potential loss if new cost > old sale cost.
 */
export const clearNegativeBalancesOnGRN = (params: {
  itemId: string;
  receivedUnits: number;
  newCostPerUnit: number;
  grnId: string;
}): {
  clearedUnits: number;
  remainingUnitsForNewBatch: number;
  totalPotentialLoss: number;
  clearedEntries: NegativeBalanceEntry[];
} => {
  const openBalances = getOpenNegativeBalances(params.itemId);
  // Sort oldest first (FIFO clearing)
  openBalances.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let availableUnits = params.receivedUnits;
  let totalCleared = 0;
  let totalPotentialLoss = 0;
  const clearedEntries: NegativeBalanceEntry[] = [];
  const timestamp = new Date().toISOString();

  for (const neg of openBalances) {
    if (availableUnits <= 0) break;
    const remainingNeeded = neg.negativeQty - neg.clearedQty;
    const toClear = Math.min(availableUnits, remainingNeeded);

    neg.clearedQty += toClear;
    availableUnits -= toClear;
    totalCleared += toClear;

    // CORE RULE 3: FRAUD / LOSS DETECTION
    // If New Cost > Cost At Time Of Negative Sale: Potential Loss = Negative Qty * (New Cost - Old Cost)
    if (params.newCostPerUnit > neg.saleCost) {
      const loss = toClear * (params.newCostPerUnit - neg.saleCost);
      neg.potentialLoss = Number(((neg.potentialLoss || 0) + loss).toFixed(2));
      totalPotentialLoss += loss;
    }

    neg.newCostAtClearing = params.newCostPerUnit;

    if (neg.clearedQty >= neg.negativeQty) {
      neg.status = 'CLEARED';
      neg.clearedAt = timestamp;
      neg.clearingGrnId = params.grnId;
    }

    saveNegativeBalance(neg);
    clearedEntries.push(neg);
  }

  return {
    clearedUnits: totalCleared,
    remainingUnitsForNewBatch: Math.max(0, availableUnits),
    totalPotentialLoss,
    clearedEntries,
  };
};

/**
 * Audit Trail & Fraud Logging for Price and Cost changes in Inventory Master
 */
export const recordPriceCostChangeAudit = (params: {
  itemId: string;
  itemName: string;
  fieldChanged: 'PRICE' | 'COST';
  oldValue: number;
  newValue: number;
  reason: string;
  staffId: string;
  staffName?: string;
  userRole?: string;
}): StockMovementEntry => {
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const txnId = `AUDIT-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const percentChange = params.oldValue > 0
    ? Number((((params.newValue - params.oldValue) / params.oldValue) * 100).toFixed(2))
    : 100;

  const entry: StockMovementEntry = {
    txnId,
    movementId: txnId,
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName || 'Staff',
    itemId: params.itemId,
    itemName: params.itemName,
    txnType: params.fieldChanged === 'PRICE' ? 'PRICE_CHANGE' : 'COST_CHANGE',
    movementType: params.fieldChanged === 'PRICE' ? 'PRICE_CHANGE' : 'COST_CHANGE',
    qtyCases: 0,
    qtySingles: 0,
    casesChange: 0,
    singlesChange: 0,
    closingCases: 0,
    closingSingles: 0,
    oldValue: params.oldValue,
    newValue: params.newValue,
    percentChange,
    fieldChanged: params.fieldChanged,
    reason: params.reason.trim(),
    userRole: params.userRole || 'Staff',
    timestamp,
    synced: false,
  };

  addStockMovement(entry);
  return entry;
};

export const deleteInventoryItem = (itemId: string): boolean => {
  const currentCompany = getCurrentCompanyId();
  const allItems = getAllInventoryItems();
  const filtered = allItems.filter((i) => {
    const compId = i.company_id || (i as any).companyId || 'COMP-001';
    if (compId === currentCompany && i.itemId.toUpperCase() === itemId.toUpperCase()) {
      return false;
    }
    return true;
  });
  if (filtered.length !== allItems.length) {
    setStored(STORAGE_KEYS.INVENTORY_ITEMS, filtered);
    return true;
  }
  return false;
};

export const getAllSupplierInvoiceVouchers = (): SupplierInvoiceVoucher[] => {
  return getStored<SupplierInvoiceVoucher[]>(STORAGE_KEYS.SUPPLIER_INVOICES, INITIAL_SUPPLIER_INVOICES);
};

export const getSupplierInvoiceVouchers = (): SupplierInvoiceVoucher[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllSupplierInvoiceVouchers();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((v) => {
    const compId = v.company_id || v.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getSupplierInvoiceVoucherById = (voucherId: string): SupplierInvoiceVoucher | undefined => {
  if (!voucherId) return undefined;
  const target = voucherId.trim().toLowerCase();
  return getSupplierInvoiceVouchers().find(
    (v) => v.voucherId === voucherId || (v.invoiceNo && v.invoiceNo.trim().toLowerCase() === target)
  );
};

export const saveSupplierInvoiceVoucher = (voucher: SupplierInvoiceVoucher): SupplierInvoiceVoucher => {
  const all = getAllSupplierInvoiceVouchers();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = voucher.company_id || voucher.companyId || currentCompany;
  const brId = voucher.branchId || voucher.branch_id || currentBranch;
  const normalized: SupplierInvoiceVoucher = {
    ...voucher,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  const filtered = all.filter((v) => v.voucherId !== normalized.voucherId);
  const updated = [normalized, ...filtered];
  setStored(STORAGE_KEYS.SUPPLIER_INVOICES, updated);
  return normalized;
};

export const receiveSupplierInvoice = (params: {
  invoiceNo: string;
  purchaseOrderNo?: string;
  supplier: string;
  branchId?: string;
  branchName?: string;
  date: string;
  paymentTerms?: string;
  staffId: string;
  staffName?: string;
  notes?: string;
  items: {
    itemId: string;
    receiveAs?: 'Cases' | 'Singles' | 'Variant';
    receiveVariantId?: string;
    receiveVariantName?: string;
    unitsPerReceivePack?: number;
    receivedCases: number;
    receivedSingles: number;
    receivedPacks?: number;
    lastCost?: number;
    costPerCase?: number;
    costPerUnit?: number;
    costPerPack?: number;
    sellingPrice?: number;
    marginPercent?: number;
    expiryDate?: string;
    batchNumber?: string;
  }[];
}): {
  success: boolean;
  message: string;
  voucher?: SupplierInvoiceVoucher;
  itemsProcessed: number;
  ruleATriggeredCount: number;
} => {
  if (!params.items || params.items.length === 0) {
    return {
      success: false,
      message: 'Please add at least one product to the supplier invoice voucher.',
      itemsProcessed: 0,
      ruleATriggeredCount: 0,
    };
  }

  const timestamp = new Date().toISOString();
  const dateStr = params.date || timestamp.split('T')[0];
  const voucherId = `GRN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const invoiceNo = params.invoiceNo?.trim() || `INV-${Date.now().toString().slice(-5)}`;
  const purchaseOrderNo = params.purchaseOrderNo?.trim() || '';
  const supplierName = params.supplier?.trim() || 'General Supplier';
  const staffId = params.staffId || '001';
  const staffName = params.staffName || 'Administrator';
  const branchId = params.branchId || 'BR001';
  const branchName = params.branchName || 'Main Central Distribution & Warehouse';

  const lineItems: SupplierInvoiceLineItem[] = [];
  let totalCases = 0;
  let totalSingles = 0;
  let totalUnitsReceived = 0;
  let totalInvoiceAmount = 0;
  let ruleATriggeredCount = 0;

  for (const rawItem of params.items) {
    const item = getInventoryItemById(rawItem.itemId);
    if (!item) continue;

    const isReceivingVariant = rawItem.receiveAs === 'Variant';
    const isReceivingSingles = rawItem.receiveAs === 'Singles';
    const isReceivingCases = !isReceivingVariant && !isReceivingSingles;

    const unitsPerPack = rawItem.unitsPerReceivePack || 1;
    const recPacks = Math.max(0, Number(rawItem.receivedPacks) || 0);
    const recCases = isReceivingCases ? Math.max(0, Number(rawItem.receivedCases) || 0) : 0;
    const recSingles = isReceivingSingles
      ? Math.max(0, Number(rawItem.receivedSingles) || 0)
      : isReceivingVariant
      ? recPacks * unitsPerPack
      : Math.max(0, Number(rawItem.receivedSingles) || 0);

    if (recCases === 0 && recSingles === 0 && (!isReceivingVariant || recPacks === 0)) continue;

    const lastCost = rawItem.lastCost !== undefined ? rawItem.lastCost : item.costPerCase;
    let costPerCase = item.costPerCase;
    let costPerUnit = item.costPerUnit;
    let costPerPack = rawItem.costPerPack;

    if (isReceivingVariant) {
      if (rawItem.costPerPack !== undefined && rawItem.costPerPack >= 0) {
        costPerPack = rawItem.costPerPack;
        costPerUnit = unitsPerPack > 0 ? costPerPack / unitsPerPack : costPerPack;
      } else if (rawItem.costPerUnit !== undefined && rawItem.costPerUnit >= 0) {
        costPerUnit = rawItem.costPerUnit;
        costPerPack = costPerUnit * unitsPerPack;
      } else {
        costPerPack = item.costPerUnit * unitsPerPack;
        costPerUnit = item.costPerUnit;
      }
      costPerCase = costPerUnit * (item.unitsPerCase || 1);
    } else if (isReceivingSingles) {
      if (rawItem.costPerUnit !== undefined && rawItem.costPerUnit >= 0) {
        costPerUnit = rawItem.costPerUnit;
      } else if (rawItem.costPerCase !== undefined && rawItem.costPerCase >= 0) {
        costPerUnit = rawItem.costPerCase;
      }
      costPerCase = costPerUnit * (item.unitsPerCase || 1);
    } else {
      if (rawItem.costPerCase !== undefined && rawItem.costPerCase >= 0) {
        costPerCase = rawItem.costPerCase;
      }
      costPerUnit = item.unitsPerCase > 0 ? costPerCase / item.unitsPerCase : costPerCase;
    }

    const sellingPrice =
      rawItem.sellingPrice !== undefined && rawItem.sellingPrice > 0
        ? rawItem.sellingPrice
        : item.sellPriceUnit;
    const marginPercent =
      sellingPrice > 0
        ? ((sellingPrice - costPerUnit) / sellingPrice) * 100
        : rawItem.marginPercent || 0;

    const canSellAsCase = Boolean(item.canSellAsCase);
    let finalRecCases = recCases;
    let finalRecSingles = recSingles;
    let autoBroken = false;
    let convertedCasesToSingles = false;
    let autoBreakNote = '';

    if (!canSellAsCase && recCases > 0) {
      convertedCasesToSingles = true;
      const gainedSingles = recCases * item.unitsPerCase;
      finalRecCases = 0;
      finalRecSingles = recSingles + gainedSingles;
      autoBreakNote = ` [Converted ${recCases} received case(s) into ${gainedSingles} singles because 'Sell as Case' is deactivated]`;
    } else if (canSellAsCase && recCases > 0 && item.stockSingles === 0) {
      autoBroken = true;
      ruleATriggeredCount++;
      finalRecCases = recCases - 1;
      finalRecSingles = recSingles + item.unitsPerCase;
      autoBreakNote = ` [Rule A Triggered: Auto-broke 1 case to ${item.unitsPerCase} singles because StockSingles was 0]`;
    } else if (isReceivingVariant) {
      autoBreakNote = ` [Received as ${recPacks} x ${rawItem.receiveVariantName || 'Variant'} (${unitsPerPack} units/pack = ${recSingles} total singles)]`;
    }

    // Total gross units received in this line item
    const lineTotalUnits = isReceivingVariant
      ? recPacks * unitsPerPack
      : (recCases * item.unitsPerCase) + recSingles;

    // CORE RULE 2 & 3: Clear any Negative Balance first with newly received qty
    const clearing = clearNegativeBalancesOnGRN({
      itemId: item.itemId,
      receivedUnits: lineTotalUnits,
      newCostPerUnit: costPerUnit,
      grnId: voucherId,
    });

    let clearingNote = '';
    if (clearing.clearedUnits > 0) {
      clearingNote = ` [Cleared ${clearing.clearedUnits} negative balance units from previous sale(s)`;
      if (clearing.totalPotentialLoss > 0) {
        clearingNote += ` • Potential Loss Realized: $${clearing.totalPotentialLoss.toFixed(2)}`;
      }
      clearingNote += `]`;
    }

    // CORE RULE 1: Create a new batch for this Goods Receiving
    const batchId = `BAT-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${item.itemId}`;
    const batchNumber = rawItem.batchNumber || `BATCH-${dateStr.replace(/-/g, '')}-${item.itemId}`;
    const newBatch: StockBatch = {
      id: batchId,
      batchNumber,
      itemId: item.itemId,
      itemName: item.itemName,
      qtyReceived: lineTotalUnits,
      qtyOnHand: clearing.remainingUnitsForNewBatch, // Individual batch Qty On Hand is whatever is left after clearing negative balances
      cost: lineTotalUnits * costPerUnit,
      costPerUnit,
      costPerCase,
      expiryDate: rawItem.expiryDate,
      receivedDate: dateStr,
      supplier: supplierName,
      grnId: voucherId,
      invoiceNo,
      branchId,
      notes: (params.notes || '') + autoBreakNote + clearingNote,
      createdAt: timestamp,
    };
    saveStockBatch(newBatch);

    // CORE RULE 1 & 2: Total Qty On Hand in Inventory Master = Sum of all batch Qty On Hand minus remaining open negative balances
    const allItemBatches = getBatchesByItemId(item.itemId);
    const sumBatchesOnHand = allItemBatches.reduce((sum, b) => sum + (b.qtyOnHand || 0), 0);
    const openNegs = getOpenNegativeBalances(item.itemId);
    const totalOpenNegQty = openNegs.reduce((sum, n) => sum + (n.negativeQty - n.clearedQty), 0);
    const effectiveTotalUnits = sumBatchesOnHand - totalOpenNegQty;

    let newStockCases = 0;
    let newStockSingles = 0;
    if (effectiveTotalUnits > 0) {
      if (item.canSellAsCase && item.unitsPerCase > 1) {
        newStockCases = Math.floor(effectiveTotalUnits / item.unitsPerCase);
        newStockSingles = effectiveTotalUnits % item.unitsPerCase;
      } else {
        newStockCases = 0;
        newStockSingles = effectiveTotalUnits;
      }
    } else {
      newStockCases = 0;
      newStockSingles = effectiveTotalUnits;
    }

    const prevStockCases = item.stockCases;
    const prevStockSingles = item.stockSingles;

    // Update item in inventory (including cost and optionally selling price)
    const updatedItem: InventoryItem = {
      ...item,
      costPerCase: costPerCase,
      costPerUnit: costPerUnit,
      sellPriceUnit: sellingPrice,
      sellPriceCase: item.sellPriceCase > 0 ? item.sellPriceCase : sellingPrice * item.unitsPerCase,
      stockCases: newStockCases,
      stockSingles: newStockSingles,
      totalUnits: effectiveTotalUnits,
      lastUpdated: timestamp,
    };
    saveInventoryItem(updatedItem);

    const lineTotal = isReceivingVariant && costPerPack !== undefined
      ? recPacks * costPerPack
      : recCases * costPerCase + recSingles * costPerUnit;

    totalCases += recCases;
    totalSingles += recSingles;
    totalUnitsReceived += lineTotalUnits;
    totalInvoiceAmount += lineTotal;

    lineItems.push({
      itemId: item.itemId,
      itemName: item.itemName,
      category: item.category,
      unitsPerCase: item.unitsPerCase,
      receiveAs: rawItem.receiveAs || 'Cases',
      receiveVariantId: rawItem.receiveVariantId,
      receiveVariantName: rawItem.receiveVariantName,
      unitsPerReceivePack: rawItem.unitsPerReceivePack,
      receivedCases: recCases,
      receivedSingles: isReceivingVariant ? 0 : recSingles,
      receivedPacks: isReceivingVariant ? recPacks : undefined,
      lastCost,
      costPerCase,
      costPerUnit,
      costPerPack,
      sellingPrice,
      marginPercent,
      lineTotal,
      autoBrokenRuleA: autoBroken,
      convertedCasesToSingles,
      prevStockCases,
      prevStockSingles,
      newStockCases,
      newStockSingles,
    });

    // Add individual GoodsReceivedEntry log for audit sheet
    const grnEntry: GoodsReceivedEntry = {
      grnId: voucherId,
      invoiceNo,
      purchaseOrderNo,
      date: dateStr,
      supplier: supplierName,
      branchId,
      branchName,
      itemId: item.itemId,
      itemName: item.itemName,
      receivedCases: recCases,
      receivedSingles: recSingles,
      receivedPacks: isReceivingVariant ? recPacks : undefined,
      receiveAs: rawItem.receiveAs || 'Cases',
      receiveVariantId: rawItem.receiveVariantId,
      receiveVariantName: rawItem.receiveVariantName,
      unitsPerReceivePack: rawItem.unitsPerReceivePack,
      lastCost,
      costPerCase,
      costPerUnit,
      sellingPrice,
      marginPercent,
      lineTotal,
      autoBreakCaseToSingles: autoBroken,
      convertedCasesToSingles,
      notes: (params.notes || '') + autoBreakNote + clearingNote,
      staffId,
      staffName,
      timestamp,
      synced: false,
    };
    addGoodsReceived(grnEntry);

    // Add StockMovement log
    const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${item.itemId}`;
    const movement: StockMovementEntry = {
      txnId,
      movementId: txnId,
      date: dateStr,
      staffId,
      staffName,
      itemId: item.itemId,
      itemName: item.itemName,
      txnType: 'RECEIVE',
      qtyCases: recCases,
      qtySingles: recSingles,
      casesChange: finalRecCases,
      singlesChange: finalRecSingles,
      closingCases: newStockCases,
      closingSingles: newStockSingles,
      resultingStockCases: newStockCases,
      resultingStockSingles: newStockSingles,
      promptShown: convertedCasesToSingles
        ? 'Converted Cases to Singles (Sell as Case Deactivated)'
        : autoBroken
        ? 'Rule A: Auto-Break on Zero Singles'
        : isReceivingVariant
        ? `Received ${recPacks} x ${rawItem.receiveVariantName || 'Variant'}`
        : `Supplier Invoice: ${invoiceNo}`,
      actionTaken: convertedCasesToSingles
        ? 'CONVERTED_TO_SINGLES_NO_CASE_SALE'
        : autoBroken
        ? 'AUTO_BREAK_RULE_A'
        : 'GOODS_RECEIVED',
      referenceId: `${voucherId} / ${invoiceNo}${purchaseOrderNo ? ` / PO: ${purchaseOrderNo}` : ''}`,
      timestamp,
      synced: false,
    };
    addStockMovement(movement);
  }

  if (lineItems.length === 0) {
    return {
      success: false,
      message: 'No valid products with quantities > 0 were received on this invoice.',
      itemsProcessed: 0,
      ruleATriggeredCount: 0,
    };
  }

  const voucher: SupplierInvoiceVoucher = {
    voucherId,
    invoiceNo,
    purchaseOrderNo,
    supplier: supplierName,
    branchId,
    branchName,
    date: dateStr,
    paymentTerms: params.paymentTerms || 'Standard Terms',
    staffId,
    staffName,
    notes: params.notes || '',
    items: lineItems,
    totalCases,
    totalSingles,
    totalUnits: totalUnitsReceived,
    totalInvoiceAmount,
    ruleATriggeredCount,
    timestamp,
    synced: false,
  };

  saveSupplierInvoiceVoucher(voucher);

  return {
    success: true,
    message: `Recorded Supplier Invoice ${invoiceNo} (${supplierName}) with ${lineItems.length} products (Total: $${totalInvoiceAmount.toFixed(2)}).`,
    voucher,
    itemsProcessed: lineItems.length,
    ruleATriggeredCount,
  };
};

// ==================== PACKAGING RATIO RECALCULATION & VARIANT CREATION ====================
export const recalculateItemPackagingRatio = (
  itemId: string,
  newUnitsPerCase: number,
  newCostPerCaseOrStaffId?: number | string,
  staffId?: string
): {
  item: InventoryItem;
  prevCases: number;
  prevSingles: number;
  newCases: number;
  newSingles: number;
  totalUnits: number;
} | null => {
  const item = getInventoryItemById(itemId);
  if (!item || newUnitsPerCase <= 0) return null;

  const costPerCaseParam =
    typeof newCostPerCaseOrStaffId === 'number' ? newCostPerCaseOrStaffId : undefined;
  const staffIdParam =
    typeof newCostPerCaseOrStaffId === 'string' ? newCostPerCaseOrStaffId : staffId;

  const totalUnits =
    item.totalUnits !== undefined
      ? item.totalUnits
      : item.stockCases * item.unitsPerCase + item.stockSingles;
  const prevCases = item.stockCases;
  const prevSingles = item.stockSingles;

  const newStockCases = Math.floor(totalUnits / newUnitsPerCase);
  const newStockSingles = totalUnits % newUnitsPerCase;
  const costPerCase =
    costPerCaseParam !== undefined && costPerCaseParam >= 0 ? costPerCaseParam : item.costPerCase;
  const costPerUnit = costPerCase / newUnitsPerCase;

  const updated: InventoryItem = {
    ...item,
    unitsPerCase: newUnitsPerCase,
    costPerCase,
    costPerUnit,
    stockCases: newStockCases,
    stockSingles: newStockSingles,
    totalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updated);

  // Add stock movement log for audit trail
  const txnId = `TXN-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-RECALC`;
  addStockMovement({
    txnId,
    movementId: txnId,
    date: new Date().toISOString().split('T')[0],
    staffId: staffIdParam || getCurrentUser()?.id || '001',
    staffName: getCurrentUser()?.name || 'Administrator',
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'ADJUSTMENT',
    qtyCases: newStockCases - prevCases,
    qtySingles: newStockSingles - prevSingles,
    closingCases: newStockCases,
    closingSingles: newStockSingles,
    promptShown: `Packaging ratio updated from ${item.unitsPerCase} to ${newUnitsPerCase} units/case`,
    actionTaken: `RECALCULATE_PACKAGING_RATIO`,
    referenceId: `RATIO-CHANGE-${newUnitsPerCase}UN`,
    timestamp: new Date().toISOString(),
    synced: false,
  });

  return {
    item: updated,
    prevCases,
    prevSingles,
    newCases: newStockCases,
    newSingles: newStockSingles,
    totalUnits,
  };
};

export const createPackagingVariant = (
  sourceItemId: string,
  newUnitsPerCase: number,
  variantCostPerCaseOrName?: number | string,
  variantSellingPrice?: number
): InventoryItem | null => {
  const source = getInventoryItemById(sourceItemId);
  if (!source) return null;

  const customName =
    typeof variantCostPerCaseOrName === 'string' ? variantCostPerCaseOrName : undefined;
  const costNumber =
    typeof variantCostPerCaseOrName === 'number' ? variantCostPerCaseOrName : undefined;

  const newId = `${source.itemId}_C${newUnitsPerCase}`;
  const costPerCase =
    costNumber !== undefined && costNumber > 0
      ? costNumber
      : source.costPerUnit * newUnitsPerCase;
  const costPerUnit = costPerCase / newUnitsPerCase;
  const sellPriceUnit =
    variantSellingPrice !== undefined && variantSellingPrice > 0
      ? variantSellingPrice
      : source.sellPriceUnit;
  const sellPriceCase = sellPriceUnit * newUnitsPerCase * 0.95; // 5% bulk discount

  const variantItem: InventoryItem = {
    itemId: newId,
    itemName: customName || `${source.itemName} (Case of ${newUnitsPerCase})`,
    category: source.category,
    canSellAsCase: true,
    unitsPerCase: newUnitsPerCase,
    costPerCase,
    costPerUnit,
    sellPriceCase,
    sellPriceUnit,
    stockCases: 0,
    stockSingles: 0,
    totalUnits: 0,
    reorderLevelCases: 2,
    reorderLevelUnits: newUnitsPerCase,
    sku: `${source.sku || source.itemId}-C${newUnitsPerCase}`,
    barcode: '',
    description: `Packaging variant: ${newUnitsPerCase} units per case.`,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(variantItem);
  return variantItem;
};

// ==================== DAILY GOODS RECEIVED ADMIN REPORT ====================
export interface DailyGRNReportSummary {
  date: string;
  branchId?: string;
  branchName: string;
  totalValuation: number;
  totalCases: number;
  totalSingles: number;
  totalUnits: number;
  totalInvoices: number;
  ruleACount: number;
  supplierBreakdown: {
    supplier: string;
    invoiceCount: number;
    cases: number;
    singles: number;
    totalUnits: number;
    totalAmount: number;
    percentageOfTotal: number;
  }[];
  categoryBreakdown: {
    category: string;
    cases: number;
    singles: number;
    totalUnits: number;
    totalAmount: number;
  }[];
  vouchers: SupplierInvoiceVoucher[];
  itemizedLines: {
    grnId: string;
    invoiceNo: string;
    purchaseOrderNo?: string;
    date: string;
    branchName: string;
    supplier: string;
    itemId: string;
    itemName: string;
    category: string;
    unitsPerCase: number;
    receiveAs: string;
    receivedCases: number;
    receivedSingles: number;
    costPerCase: number;
    costPerUnit: number;
    lastCost?: number;
    sellingPrice?: number;
    marginPercent?: number;
    lineTotal: number;
    autoBrokenRuleA: boolean;
  }[];
}

export const getDailyGoodsReceivedReport = (
  targetDate?: string,
  branchId?: string
): DailyGRNReportSummary => {
  const date = targetDate || new Date().toISOString().split('T')[0];
  const allVouchers = getSupplierInvoiceVouchers();
  const branches = getBranches();

  // Filter vouchers for this date and optionally branch
  const vouchers = allVouchers.filter((v) => {
    const matchesDate = v.date === date || (v.timestamp && v.timestamp.startsWith(date));
    const matchesBranch = !branchId || branchId === 'ALL' || v.branchId === branchId;
    return matchesDate && matchesBranch;
  });

  const selectedBranch =
    branchId && branchId !== 'ALL' ? branches.find((b) => b.branchId === branchId) : undefined;
  const branchName = selectedBranch ? selectedBranch.name : 'All Branches / Outlets';

  let totalValuation = 0;
  let totalCases = 0;
  let totalSingles = 0;
  let totalUnits = 0;
  let ruleACount = 0;

  const supplierMap = new Map<
    string,
    { invoiceCount: number; cases: number; singles: number; totalUnits: number; totalAmount: number }
  >();
  const categoryMap = new Map<
    string,
    { cases: number; singles: number; totalUnits: number; totalAmount: number }
  >();
  const itemizedLines: DailyGRNReportSummary['itemizedLines'] = [];

  for (const v of vouchers) {
    totalValuation += v.totalInvoiceAmount;
    totalCases += v.totalCases;
    totalSingles += v.totalSingles;
    totalUnits += v.totalUnits;
    ruleACount += v.ruleATriggeredCount || 0;

    const suppEntry = supplierMap.get(v.supplier) || {
      invoiceCount: 0,
      cases: 0,
      singles: 0,
      totalUnits: 0,
      totalAmount: 0,
    };
    suppEntry.invoiceCount++;
    suppEntry.cases += v.totalCases;
    suppEntry.singles += v.totalSingles;
    suppEntry.totalUnits += v.totalUnits;
    suppEntry.totalAmount += v.totalInvoiceAmount;
    supplierMap.set(v.supplier, suppEntry);

    for (const item of v.items) {
      const cat = item.category || 'General Merchandise';
      const catEntry = categoryMap.get(cat) || {
        cases: 0,
        singles: 0,
        totalUnits: 0,
        totalAmount: 0,
      };
      catEntry.cases += item.receivedCases;
      catEntry.singles += item.receivedSingles;
      catEntry.totalUnits += item.receivedCases * item.unitsPerCase + item.receivedSingles;
      catEntry.totalAmount += item.lineTotal;
      categoryMap.set(cat, catEntry);

      itemizedLines.push({
        grnId: v.voucherId,
        invoiceNo: v.invoiceNo,
        purchaseOrderNo: v.purchaseOrderNo,
        date: v.date,
        branchName: v.branchName || 'Main Central Distribution & Warehouse',
        supplier: v.supplier,
        itemId: item.itemId,
        itemName: item.itemName,
        category: cat,
        unitsPerCase: item.unitsPerCase,
        receiveAs: item.receiveAs || 'Cases',
        receivedCases: item.receivedCases,
        receivedSingles: item.receivedSingles,
        costPerCase: item.costPerCase,
        costPerUnit: item.costPerUnit,
        lastCost: item.lastCost,
        sellingPrice: item.sellingPrice,
        marginPercent: item.marginPercent,
        lineTotal: item.lineTotal,
        autoBrokenRuleA: Boolean(item.autoBrokenRuleA),
      });
    }
  }

  const supplierBreakdown = Array.from(supplierMap.entries()).map(([supplier, data]) => ({
    supplier,
    ...data,
    percentageOfTotal: totalValuation > 0 ? (data.totalAmount / totalValuation) * 100 : 0,
  }));

  const categoryBreakdown = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    ...data,
  }));

  return {
    date,
    branchId,
    branchName,
    totalValuation,
    totalCases,
    totalSingles,
    totalUnits,
    totalInvoices: vouchers.length,
    ruleACount,
    supplierBreakdown,
    categoryBreakdown,
    vouchers,
    itemizedLines,
  };
};

export const getAllGoodsReceived = (): GoodsReceivedEntry[] => {
  return getStored<GoodsReceivedEntry[]>(STORAGE_KEYS.GOODS_RECEIVED, INITIAL_GOODS_RECEIVED);
};

export const getGoodsReceived = (): GoodsReceivedEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllGoodsReceived();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((g) => {
    const compId = g.company_id || g.companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const addGoodsReceived = (entry: GoodsReceivedEntry): GoodsReceivedEntry => {
  const all = getAllGoodsReceived();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = entry.company_id || entry.companyId || currentCompany;
  const brId = entry.branchId || entry.branch_id || currentBranch;
  const normalized: GoodsReceivedEntry = {
    ...entry,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  };
  all.unshift(normalized);
  setStored(STORAGE_KEYS.GOODS_RECEIVED, all);

  enqueueSync('GoodsReceived', 'INSERT', {
    company_id: compId,
    branch_id: brId,
    Timestamp: normalized.timestamp,
    GRNID: normalized.grnId,
    InvoiceNo: normalized.invoiceNo,
    Date: normalized.date,
    Supplier: normalized.supplier,
    ItemID: normalized.itemId,
    ItemName: normalized.itemName,
    ReceivedCases: normalized.receivedCases,
    ReceivedSingles: normalized.receivedSingles,
    CostPerCase: normalized.costPerCase,
    CostPerUnit: normalized.costPerUnit,
    LineTotal: normalized.lineTotal,
    StaffID: normalized.staffId,
  });

  return normalized;
};

export const getAllStockMovements = (): StockMovementEntry[] => {
  const rawList = getStored<StockMovementEntry[]>(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  return rawList.map((m) => ({
    ...m,
    movementId: m.movementId || m.txnId,
    movementType: m.movementType || (m.txnType === 'RECEIVE' ? 'GOODS_RECEIVED' : m.txnType),
    casesChange: m.casesChange !== undefined ? m.casesChange : (m.txnType === 'RECEIVE' ? m.qtyCases : -m.qtyCases),
    singlesChange: m.singlesChange !== undefined ? m.singlesChange : (m.txnType === 'RECEIVE' || m.txnType === 'BREAK_CASE' ? m.qtySingles : -m.qtySingles),
    resultingStockCases: m.resultingStockCases !== undefined ? m.resultingStockCases : m.closingCases,
    resultingStockSingles: m.resultingStockSingles !== undefined ? m.resultingStockSingles : m.closingSingles,
  }));
};

export const getStockMovements = (): StockMovementEntry[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllStockMovements();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((m) => {
    const compId = (m as any).company_id || (m as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const addStockMovement = (entry: StockMovementEntry): StockMovementEntry => {
  const list = getStored<StockMovementEntry[]>(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = (entry as any).company_id || (entry as any).companyId || currentCompany;
  const brId = (entry as any).branch_id || (entry as any).branchId || currentBranch;
  const normalized: StockMovementEntry = {
    ...entry,
    movementId: entry.movementId || entry.txnId,
    movementType: entry.movementType || entry.txnType,
    casesChange: entry.casesChange !== undefined ? entry.casesChange : entry.qtyCases,
    singlesChange: entry.singlesChange !== undefined ? entry.singlesChange : entry.qtySingles,
    resultingStockCases: entry.resultingStockCases !== undefined ? entry.resultingStockCases : entry.closingCases,
    resultingStockSingles: entry.resultingStockSingles !== undefined ? entry.resultingStockSingles : entry.closingSingles,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  } as any;
  list.unshift(normalized);
  setStored(STORAGE_KEYS.STOCK_MOVEMENTS, list);
  return normalized;
};

export const recordMovement = (params: {
  itemId: string;
  movementType: 'ADJUSTMENT' | 'DAMAGE_LOSS' | 'RETURN' | 'BREAK_CASE' | 'GOODS_RECEIVED' | 'SALE';
  casesChange: number;
  singlesChange: number;
  resultingStockCases: number;
  resultingStockSingles: number;
  referenceId?: string;
  staffId: string;
  staffName?: string;
  reason?: string;
  triggerRule?: string;
}): { success: boolean; message: string; movement?: StockMovementEntry } => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return { success: false, message: `Item not found: ${params.itemId}` };
  }

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: Math.max(0, params.resultingStockCases),
    stockSingles: Math.max(0, params.resultingStockSingles),
    totalUnits: (Math.max(0, params.resultingStockCases) * item.unitsPerCase) + Math.max(0, params.resultingStockSingles),
    lastUpdated: new Date().toISOString(),
  };
  saveInventoryItem(updatedItem);

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  const movement: StockMovementEntry = {
    txnId,
    movementId: txnId,
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: params.movementType === 'GOODS_RECEIVED' ? 'RECEIVE' : params.movementType,
    movementType: params.movementType,
    qtyCases: Math.abs(params.casesChange),
    qtySingles: Math.abs(params.singlesChange),
    casesChange: params.casesChange,
    singlesChange: params.singlesChange,
    promptShown: params.triggerRule || 'Manual Adjustment',
    actionTaken: params.movementType,
    closingCases: updatedItem.stockCases,
    closingSingles: updatedItem.stockSingles,
    resultingStockCases: updatedItem.stockCases,
    resultingStockSingles: updatedItem.stockSingles,
    referenceId: params.referenceId || 'ADJ-MANUAL',
    triggerRule: params.triggerRule,
    reason: params.reason,
    timestamp,
    synced: false,
  };

  addStockMovement(movement);

  return {
    success: true,
    message: `Logged ${params.movementType} for ${item.itemName}. New stock: ${updatedItem.stockCases} Cases, ${updatedItem.stockSingles} Singles.`,
    movement,
  };
};

const DEFAULT_CATEGORIES: import('../types').InventoryCategory[] = [
  { categoryId: 'CAT-01', categoryName: 'Beverages', description: 'Soft drinks, water, juices & energy cans', itemCount: 12 },
  { categoryId: 'CAT-02', categoryName: 'Confectionery & Sweets', description: 'Chocolates, biscuits, candies & snacks', itemCount: 18 },
  { categoryId: 'CAT-03', categoryName: 'Dry Grocery & Staples', description: 'Sugar, rice, flour, salt & pasta', itemCount: 14 },
  { categoryId: 'CAT-04', categoryName: 'Cooking Oil & Fats', description: 'Pure vegetable oil, margarine & spreads', itemCount: 6 },
  { categoryId: 'CAT-05', categoryName: 'Dairy & Refrigerated', description: 'Milk, cheese, yogurts & butter', itemCount: 8 },
  { categoryId: 'CAT-06', categoryName: 'Hygiene & Cleaning', description: 'Soaps, washing powders & detergents', itemCount: 10 },
];

export const getCategories = (): import('../types').InventoryCategory[] => {
  const stored = getStored<import('../types').InventoryCategory[]>('saimetric_room_categories', DEFAULT_CATEGORIES);
  const items = getInventoryItems();
  return stored.map((cat) => ({
    ...cat,
    itemCount: items.filter((i) => (i.category || '').toLowerCase() === (cat.categoryName || '').toLowerCase()).length,
  }));
};

export const saveCategories = (categories: import('../types').InventoryCategory[]): void => {
  setStored('saimetric_room_categories', categories);
};

export const ensureCategoryExists = (categoryName: string): void => {
  if (!categoryName || !categoryName.trim()) return;
  const name = categoryName.trim();
  const cats = getCategories();
  if (!cats.some((c) => (c.categoryName || '').toLowerCase() === name.toLowerCase())) {
    const newCat: import('../types').InventoryCategory = {
      categoryId: `CAT-${String(cats.length + 1).padStart(2, '0')}`,
      categoryName: name,
      description: `Custom category: ${name}`,
      itemCount: 0,
    };
    saveCategories([...cats, newCat]);
  }
};

export const resetRoomDatabase = (): void => {
  localStorage.removeItem(STORAGE_KEYS.INVENTORY_ITEMS);
  localStorage.removeItem(STORAGE_KEYS.GOODS_RECEIVED);
  localStorage.removeItem(STORAGE_KEYS.SUPPLIER_INVOICES);
  localStorage.removeItem(STORAGE_KEYS.STOCK_MOVEMENTS);
  localStorage.removeItem('saimetric_room_categories');
  setStored(STORAGE_KEYS.INVENTORY_ITEMS, INITIAL_INVENTORY_ITEMS);
  setStored(STORAGE_KEYS.GOODS_RECEIVED, INITIAL_GOODS_RECEIVED);
  setStored(STORAGE_KEYS.SUPPLIER_INVOICES, INITIAL_SUPPLIER_INVOICES);
  setStored(STORAGE_KEYS.STOCK_MOVEMENTS, INITIAL_STOCK_MOVEMENTS);
  setStored('saimetric_room_categories', DEFAULT_CATEGORIES);
  notifyListeners();
};

/**
 * RULE A: RECEIVING STOCK (Cases or Singles)
 * - If we receive Cases and StockSingles = 0, automatically break 1 Case into Singles immediately so item can be sold.
 */
export const receiveStock = (params: {
  itemId: string;
  receivedCases: number;
  receivedSingles: number;
  supplier: string;
  staffId: string;
  staffName?: string;
  notes?: string;
}): {
  success: boolean;
  message: string;
  grn?: GoodsReceivedEntry;
  updatedItem?: InventoryItem;
  autoBroken: boolean;
  convertedCasesToSingles?: boolean;
} => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return {
      success: false,
      message: `Item not found: ${params.itemId}`,
      autoBroken: false,
      convertedCasesToSingles: false,
    };
  }

  const recCases = Math.max(0, Number(params.receivedCases) || 0);
  const recSingles = Math.max(0, Number(params.receivedSingles) || 0);

  if (recCases === 0 && recSingles === 0) {
    return {
      success: false,
      message: 'Received quantities cannot both be zero',
      autoBroken: false,
      convertedCasesToSingles: false,
    };
  }

  const canSellAsCase = Boolean(item.canSellAsCase);
  let finalRecCases = recCases;
  let finalRecSingles = recSingles;
  let autoBroken = false;
  let convertedCasesToSingles = false;
  let autoBreakNote = '';

  // 1. If "Sell as Case" is deactivated (default), convert all received cases into singles immediately
  if (!canSellAsCase && recCases > 0) {
    convertedCasesToSingles = true;
    const gainedSingles = recCases * item.unitsPerCase;
    finalRecCases = 0;
    finalRecSingles = recSingles + gainedSingles;
    autoBreakNote = ` [Converted ${recCases} received case(s) into ${gainedSingles} singles because 'Sell as Case' is deactivated]`;
  }
  // 2. If "Sell as Case" is activated: Rule A check (if received cases > 0 and current StockSingles is 0, auto-break 1 case)
  else if (canSellAsCase && recCases > 0 && item.stockSingles === 0) {
    autoBroken = true;
    finalRecCases = recCases - 1;
    finalRecSingles = recSingles + item.unitsPerCase;
    autoBreakNote = ` [Rule A Triggered: Auto-broke 1 case to ${item.unitsPerCase} singles because StockSingles was 0]`;
  }

  // Update Stock
  const newStockCases = item.stockCases + finalRecCases;
  const newStockSingles = item.stockSingles + finalRecSingles;
  const newTotalUnits = (newStockCases * item.unitsPerCase) + newStockSingles;

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: newStockCases,
    stockSingles: newStockSingles,
    totalUnits: newTotalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const grnId = `GRN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  // Log to GoodsReceived
  const grn: GoodsReceivedEntry = {
    grnId,
    date: dateStr,
    supplier: params.supplier || 'General Supplier',
    itemId: item.itemId,
    itemName: item.itemName,
    receivedCases: recCases,
    receivedSingles: recSingles,
    autoBreakCaseToSingles: autoBroken,
    convertedCasesToSingles,
    notes: (params.notes || '') + autoBreakNote,
    staffId: params.staffId,
    staffName: params.staffName,
    timestamp,
    synced: false,
  };
  addGoodsReceived(grn);

  // Log to StockMovement
  const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const movement: StockMovementEntry = {
    txnId,
    date: dateStr,
    staffId: params.staffId,
    staffName: params.staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'RECEIVE',
    qtyCases: recCases,
    qtySingles: recSingles,
    promptShown: convertedCasesToSingles
      ? 'Auto-Converted Cases to Singles (Sell as Case Deactivated)'
      : autoBroken
      ? 'Rule A: Auto-Break on Zero Singles'
      : 'None',
    actionTaken: convertedCasesToSingles
      ? 'CONVERTED_TO_SINGLES_NO_CASE_SALE'
      : autoBroken
      ? 'AUTO_BREAK_RULE_A'
      : 'GOODS_RECEIVED',
    closingCases: newStockCases,
    closingSingles: newStockSingles,
    referenceId: grnId,
    timestamp,
    synced: false,
  };
  addStockMovement(movement);

  let msg = '';
  if (convertedCasesToSingles) {
    msg = `Received ${recCases} Cases of ${item.itemName}. Converted directly to ${recCases * item.unitsPerCase} singles ('Sell as Case' disabled). New stock: ${newStockSingles} Singles.`;
  } else if (autoBroken) {
    msg = `Received ${recCases} Cases. Rule A auto-broke 1 case to ${item.unitsPerCase} singles. New stock: ${newStockCases} Cases, ${newStockSingles} Singles (${newTotalUnits} total units).`;
  } else {
    msg = `Successfully received ${recCases} Cases and ${recSingles} Singles for ${item.itemName}. New stock: ${newStockCases} Cases, ${newStockSingles} Singles.`;
  }

  return {
    success: true,
    message: msg,
    grn,
    updatedItem,
    autoBroken,
    convertedCasesToSingles,
  };
};

/**
 * RULE B, C, D: SELLING STOCK
 * - Rule B: If StockSingles < QtySingles and StockCases > 0, prompt to break case.
 * - Rule C: If QtySingles >= UnitsPerCase and case is cheaper, prompt to sell as case.
 * - Rule D: Never allow negative stock.
 */
export const sellStock = (params: {
  itemId: string;
  qtyCases: number;
  qtySingles: number;
  staffId: string;
  staffName?: string;
  referenceId?: string;
  autoBreakConfirmed?: boolean;
  bypassBulkPrompt?: boolean;
}): {
  success: boolean;
  promptRequired?: boolean;
  promptType?: 'BREAK_CASE' | 'BULK_DISCOUNT';
  message: string;
  suggestedCases?: number;
  remainderSingles?: number;
  potentialSavings?: number;
  casesNeeded?: number;
  unitsToGain?: number;
  updatedItem?: InventoryItem;
} => {
  const item = getInventoryItemById(params.itemId);
  if (!item) {
    return { success: false, message: `Item not found: ${params.itemId}` };
  }

  const reqCases = Math.max(0, Number(params.qtyCases) || 0);
  const reqSingles = Math.max(0, Number(params.qtySingles) || 0);

  if (reqCases === 0 && reqSingles === 0) {
    return { success: false, message: 'Sell quantity cannot be zero' };
  }

  // CORE RULE 2: FIFO DEDUCTION WITH NEGATIVE ALLOWED
  const totalUnitsRequired = (reqCases * item.unitsPerCase) + reqSingles;
  const staff = getSalespeople().find((s) => s.id === params.staffId) || getCurrentUser();
  const canSellNegative = Boolean(staff?.role === 'Admin' || staff?.permissions?.canSellNegativeStock);

  if (totalUnitsRequired > item.totalUnits && !canSellNegative) {
    return {
      success: false,
      message: `Insufficient stock for ${item.itemName}! Required: ${totalUnitsRequired} total units, Available: ${item.totalUnits} (${item.stockCases} cases, ${item.stockSingles} singles). Negative stock sales disabled for your user account.`,
    };
  }

  // If selling negative stock is triggered
  if (totalUnitsRequired > item.totalUnits && canSellNegative) {
    // Run FIFO batch deduction & negative entry creation
    const fifoResult = deductStockFIFO({
      itemId: item.itemId,
      quantityUnits: totalUnitsRequired,
      staffId: params.staffId,
      staffName: params.staffName,
      saleInvoiceId: params.referenceId,
      allowNegative: true,
    });

    const newTotalUnits = item.totalUnits - totalUnitsRequired;
    const finalCases = 0;
    const finalSingles = newTotalUnits;

    const updatedItem: InventoryItem = {
      ...item,
      stockCases: finalCases,
      stockSingles: finalSingles,
      totalUnits: newTotalUnits,
      lastUpdated: new Date().toISOString(),
    };
    saveInventoryItem(updatedItem);

    // Log negative SALE movement
    const timestampSale = new Date().toISOString();
    const dateStrSale = timestampSale.split('T')[0];
    const txnIdSale = `TXN-${dateStrSale.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
    addStockMovement({
      txnId: txnIdSale,
      date: dateStrSale,
      staffId: params.staffId,
      staffName: params.staffName,
      itemId: item.itemId,
      itemName: item.itemName,
      txnType: 'SALE',
      qtyCases: reqCases,
      qtySingles: reqSingles,
      promptShown: 'Negative Stock Sale Authorized',
      actionTaken: 'SOLD_NEGATIVE_BALANCE',
      closingCases: finalCases,
      closingSingles: finalSingles,
      referenceId: params.referenceId || 'INV-001',
      isNegativeSale: true,
      reason: `Negative stock sale by ${params.staffName || params.staffId}. Negative Qty: ${fifoResult.negativeQty} units.`,
      timestamp: timestampSale,
      synced: false,
    });

    return {
      success: true,
      promptRequired: false,
      message: `Completed Negative Stock Sale for ${item.itemName} (${totalUnitsRequired} units). New balance: ${newTotalUnits} units. Negative balance entry recorded.`,
      updatedItem,
    };
  }

  // RULE C: BULK SINGLES PROMPT
  // If selling singles >= unitsPerCase, prompt customer to buy as case if cheaper
  if (reqSingles >= item.unitsPerCase && !params.bypassBulkPrompt) {
    const potentialCases = Math.floor(reqSingles / item.unitsPerCase);
    const remainderSingles = reqSingles % item.unitsPerCase;
    const singlesCost = (potentialCases * item.unitsPerCase) * item.sellPriceUnit;
    const caseCost = potentialCases * item.sellPriceCase;
    const potentialSavings = singlesCost - caseCost;

    if (potentialSavings > 0) {
      return {
        success: true,
        promptRequired: true,
        promptType: 'BULK_DISCOUNT',
        message: `Sell as ${potentialCases} Case(s) + ${remainderSingles} Single(s) instead? It's cheaper. (Customer saves $${potentialSavings.toFixed(2)})`,
        suggestedCases: potentialCases,
        remainderSingles,
        potentialSavings,
      };
    }
  }

  // RULE B: SELLING SINGLES WHEN STOCKSINGLES IS INSUFFICIENT
  let currentCases = item.stockCases;
  let currentSingles = item.stockSingles;
  let brokenCasesCount = 0;

  if (reqSingles > currentSingles) {
    if (currentCases <= 0) {
      return {
        success: false,
        message: `Not enough singles in stock (${currentSingles}) and no cases left to break.`,
      };
    }

    const singlesDeficit = reqSingles - currentSingles;
    const casesNeeded = Math.ceil(singlesDeficit / item.unitsPerCase);

    if (casesNeeded > currentCases) {
      return {
        success: false,
        message: `Cannot satisfy ${reqSingles} singles. Breaking all ${currentCases} cases only yields ${currentSingles + (currentCases * item.unitsPerCase)} singles.`,
      };
    }

    // If autoBreak is not yet confirmed by the user, return promptRequired
    if (!params.autoBreakConfirmed) {
      return {
        success: true,
        promptRequired: true,
        promptType: 'BREAK_CASE',
        message: `Break ${casesNeeded} Case to ${casesNeeded * item.unitsPerCase} Singles to fulfill sale?`,
        casesNeeded,
        unitsToGain: casesNeeded * item.unitsPerCase,
      };
    }

    // Auto break confirmed: convert cases to singles
    brokenCasesCount = casesNeeded;
    currentCases -= casesNeeded;
    currentSingles += casesNeeded * item.unitsPerCase;

    // Log the Break Case transaction
    const timestampBreak = new Date().toISOString();
    const dateStrBreak = timestampBreak.split('T')[0];
    const txnIdBreak = `TXN-${dateStrBreak.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
    addStockMovement({
      txnId: txnIdBreak,
      date: dateStrBreak,
      staffId: params.staffId,
      staffName: params.staffName,
      itemId: item.itemId,
      itemName: item.itemName,
      txnType: 'BREAK_CASE',
      qtyCases: casesNeeded,
      qtySingles: casesNeeded * item.unitsPerCase,
      promptShown: `Rule B: Break ${casesNeeded} Case to ${casesNeeded * item.unitsPerCase} Singles`,
      actionTaken: 'CASE_BROKEN_FOR_SALE',
      closingCases: currentCases,
      closingSingles: currentSingles,
      referenceId: params.referenceId || 'POS-SALE',
      timestamp: timestampBreak,
      synced: false,
    });
  }

  // Deduct sold cases & singles via FIFO batch tracking
  deductStockFIFO({
    itemId: item.itemId,
    quantityUnits: totalUnitsRequired,
    staffId: params.staffId,
    staffName: params.staffName,
    saleInvoiceId: params.referenceId,
    allowNegative: false,
  });

  const finalCases = currentCases - reqCases;
  const finalSingles = currentSingles - reqSingles;
  const finalTotalUnits = (finalCases * item.unitsPerCase) + finalSingles;

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: finalCases,
    stockSingles: finalSingles,
    totalUnits: finalTotalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);

  // Log SALE movement
  const timestampSale = new Date().toISOString();
  const dateStrSale = timestampSale.split('T')[0];
  const txnIdSale = `TXN-${dateStrSale.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  addStockMovement({
    txnId: txnIdSale,
    date: dateStrSale,
    staffId: params.staffId,
    staffName: params.staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'SALE',
    qtyCases: reqCases,
    qtySingles: reqSingles,
    promptShown: brokenCasesCount > 0 ? 'Break Case Confirmed' : 'None',
    actionTaken: brokenCasesCount > 0 ? 'AUTO_BROKE_AND_SOLD' : 'SOLD',
    closingCases: finalCases,
    closingSingles: finalSingles,
    referenceId: params.referenceId || 'INV-001',
    timestamp: timestampSale,
    synced: false,
  });

  return {
    success: true,
    promptRequired: false,
    message: `Sold ${reqCases > 0 ? `${reqCases} Case(s) ` : ''}${reqSingles > 0 ? `${reqSingles} Single(s)` : ''} for ${item.itemName}. Remaining: ${finalCases} Cases, ${finalSingles} Singles.`,
    updatedItem,
  };
};

/**
 * MANUAL BREAK CASE
 * - Manually converts N cases into N * UnitsPerCase singles
 */
export const breakCase = (
  itemId: string,
  casesToBreak: number,
  staffId: string,
  staffName?: string
): {
  success: boolean;
  message: string;
  updatedItem?: InventoryItem;
} => {
  const item = getInventoryItemById(itemId);
  if (!item) {
    return { success: false, message: `Item not found: ${itemId}` };
  }

  const numCases = Math.max(1, Number(casesToBreak) || 1);
  if (item.stockCases < numCases) {
    return {
      success: false,
      message: `Cannot break ${numCases} case(s). Only ${item.stockCases} case(s) available in stock.`,
    };
  }

  const newStockCases = item.stockCases - numCases;
  const singlesGained = numCases * item.unitsPerCase;
  const newStockSingles = item.stockSingles + singlesGained;
  const newTotalUnits = (newStockCases * item.unitsPerCase) + newStockSingles;

  const updatedItem: InventoryItem = {
    ...item,
    stockCases: newStockCases,
    stockSingles: newStockSingles,
    totalUnits: newTotalUnits,
    lastUpdated: new Date().toISOString(),
  };

  saveInventoryItem(updatedItem);

  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  addStockMovement({
    txnId,
    date: dateStr,
    staffId,
    staffName,
    itemId: item.itemId,
    itemName: item.itemName,
    txnType: 'BREAK_CASE',
    qtyCases: numCases,
    qtySingles: singlesGained,
    promptShown: 'Manual Case Break',
    actionTaken: 'MANUAL_CASE_BREAK',
    closingCases: newStockCases,
    closingSingles: newStockSingles,
    referenceId: 'MANUAL-BREAK',
    timestamp,
    synced: false,
  });

  return {
    success: true,
    message: `Successfully broke ${numCases} case(s) into ${singlesGained} singles for ${item.itemName}. New stock: ${newStockCases} Cases, ${newStockSingles} Singles.`,
    updatedItem,
  };
};

// ============================================================================
// STOCKTAKE & DOUBLE-COUNT ENGINE DAO
// Multi-Segment, Blind Double-Count, Automatic Recount Generator, Consolidation & Approval
// ============================================================================

export const getAllStocktakeSessions = (): StocktakeSession[] => {
  return getStored<StocktakeSession[]>(STORAGE_KEYS.STOCKTAKE_SESSIONS, INITIAL_STOCKTAKE_SESSIONS);
};

export const getStocktakeSessions = (): StocktakeSession[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllStocktakeSessions();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((s) => {
    const compId = (s as any).company_id || (s as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getStocktakeSessionById = (sessionId: string): StocktakeSession | undefined => {
  const sessions = getStocktakeSessions();
  return sessions.find((s) => s.sessionId.toUpperCase() === sessionId.toUpperCase());
};

export const saveStocktakeSession = (session: StocktakeSession): StocktakeSession => {
  const sessions = getAllStocktakeSessions();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = (session as any).company_id || (session as any).companyId || currentCompany;
  const brId = (session as any).branch_id || (session as any).branchId || currentBranch;
  const normalized: StocktakeSession = {
    ...session,
    company_id: compId,
    companyId: compId,
    branch_id: brId,
    branchId: brId,
  } as any;
  const index = sessions.findIndex((s) => s.sessionId.toUpperCase() === session.sessionId.toUpperCase());
  if (index >= 0) {
    sessions[index] = normalized;
  } else {
    sessions.unshift(normalized);
  }
  setStored(STORAGE_KEYS.STOCKTAKE_SESSIONS, sessions);
  return normalized;
};

export const deleteStocktakeSession = (sessionId: string): boolean => {
  const sessions = getAllStocktakeSessions();
  const filtered = sessions.filter((s) => s.sessionId.toUpperCase() !== sessionId.toUpperCase());
  if (filtered.length !== sessions.length) {
    setStored(STORAGE_KEYS.STOCKTAKE_SESSIONS, filtered);
    return true;
  }
  return false;
};

export const getNextStocktakeSessionId = (): string => {
  const sessions = getStocktakeSessions();
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const count = sessions.length + 1;
  return `STK-${dateStr}-${String(count).padStart(3, '0')}`;
};

export const createStocktakeSession = (params: {
  title: string;
  date?: string;
  branchId?: string;
  branchName?: string;
  notes?: string;
  segmentNames?: string[];
  staffId: string;
  staffName: string;
}): StocktakeSession => {
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const sessionId = getNextStocktakeSessionId();
  const timestamp = new Date().toISOString();
  const date = params.date || timestamp.split('T')[0];

  const defaultSegments = params.segmentNames && params.segmentNames.length > 0
    ? params.segmentNames
    : [
        'Aisle 1 - Beverages & Coolers',
        'Aisle 2 - Groceries, Sugar & Oils',
        'Aisle 3 - Bulk Rice & Flours',
        'Front Counter - Toiletries & Razors',
      ];

  const segments: StocktakeSegment[] = defaultSegments.map((name, idx) => ({
    segmentId: `SEG-${String(idx + 1).padStart(3, '0')}`,
    name,
    description: `Shop floor physical count location #${idx + 1}`,
    locationCode: `LOC-0${idx + 1}`,
    status: 'PENDING',
    count1: [],
    count2: [],
    verifiedCounts: [],
    discrepancyCount: 0,
  }));

  const session: StocktakeSession = {
    sessionId,
    title: params.title || `Stocktake Audit - ${date}`,
    date,
    status: 'DRAFT',
    branchId: params.branchId || currentBranch,
    branchName: params.branchName || 'Main Central Distribution & Warehouse',
    createdBy: params.staffId,
    createdByName: params.staffName,
    segments,
    consolidatedItems: [],
    totalSystemUnits: 0,
    totalCountedUnits: 0,
    varianceUnits: 0,
    varianceCostValue: 0,
    varianceRetailValue: 0,
    notes: params.notes || '',
    timestamp,
    synced: false,
    company_id: currentCompany,
    companyId: currentCompany,
  } as any;

  saveStocktakeSession(session);
  return session;
};

export const addStocktakeSegment = (
  sessionId: string,
  params: { name: string; description?: string; locationCode?: string }
): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  const nextNum = session.segments.length + 1;
  const newSegment: StocktakeSegment = {
    segmentId: `SEG-${String(nextNum).padStart(3, '0')}`,
    name: params.name.trim(),
    description: params.description || `Segment #${nextNum}`,
    locationCode: params.locationCode || `LOC-${String(nextNum).padStart(2, '0')}`,
    status: 'PENDING',
    count1: [],
    count2: [],
    verifiedCounts: [],
    discrepancyCount: 0,
  };

  session.segments.push(newSegment);
  if (session.status === 'DRAFT') {
    session.status = 'COUNTING';
  }
  return saveStocktakeSession(session);
};

export const deleteStocktakeSegment = (sessionId: string, segmentId: string): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  session.segments = session.segments.filter((s) => s.segmentId !== segmentId);
  return saveStocktakeSession(session);
};

/**
 * SUBMIT DOUBLE-BLIND SEGMENT COUNT (Counter A or Counter B)
 * - Records Count 1 or Count 2
 * - When BOTH Counter A & B have completed their independent counts:
 *   - Compares every line item
 *   - If identical (Cases & Singles match): marks verified directly
 *   - If quantities differ: flags as DISCREPANCY_RECOUNT and creates recount list!
 */
export const submitSegmentCount = (
  sessionId: string,
  segmentId: string,
  counterSlot: 'A' | 'B',
  lines: StocktakeLineCount[],
  staffId: string,
  staffName: string
): { success: boolean; message: string; session: StocktakeSession; discrepanciesCount: number } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) {
    throw new Error(`Stocktake session ${sessionId} not found.`);
  }

  const segmentIndex = session.segments.findIndex((s) => s.segmentId === segmentId);
  if (segmentIndex < 0) {
    throw new Error(`Segment ${segmentId} not found in session.`);
  }

  const segment = session.segments[segmentIndex];
  const timestamp = new Date().toISOString();

  // Normalize lines
  const normalizedLines = lines.map((l) => {
    const upc = Math.max(1, Number(l.unitsPerCase) || 1);
    const cs = Math.max(0, Number(l.cases) || 0);
    const ea = Math.max(0, Number(l.singles) || 0);
    const tot = (cs * upc) + ea;
    return {
      ...l,
      unitsPerCase: upc,
      cases: cs,
      singles: ea,
      totalUnits: tot,
      countedBy: staffId,
      countedByName: staffName,
      timestamp,
    };
  });

  if (counterSlot === 'A') {
    segment.counterAId = staffId;
    segment.counterAName = staffName;
    segment.counterATimestamp = timestamp;
    segment.count1 = normalizedLines;
  } else {
    segment.counterBId = staffId;
    segment.counterBName = staffName;
    segment.counterBTimestamp = timestamp;
    segment.count2 = normalizedLines;
  }

  let discrepanciesCount = 0;

  // Check if BOTH counts are now present:
  const hasCount1 = segment.count1 && segment.count1.length > 0;
  const hasCount2 = segment.count2 && segment.count2.length > 0;

  if (hasCount1 && hasCount2) {
    // Perform Double-Count Comparison!
    const mapA = new Map<string, StocktakeLineCount>();
    const mapB = new Map<string, StocktakeLineCount>();

    segment.count1.forEach((l) => mapA.set(l.itemId.toUpperCase(), l));
    segment.count2.forEach((l) => mapB.set(l.itemId.toUpperCase(), l));

    const allItemIds = Array.from(new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]));
    const matchedVerified: StocktakeVerifiedLine[] = [];
    const recountNeeded: StocktakeLineCount[] = [];

    allItemIds.forEach((itemId) => {
      const itemA = mapA.get(itemId);
      const itemB = mapB.get(itemId);

      const aTotal = itemA?.totalUnits || 0;
      const bTotal = itemB?.totalUnits || 0;
      const aCases = itemA?.cases || 0;
      const bCases = itemB?.cases || 0;
      const aSingles = itemA?.singles || 0;
      const bSingles = itemB?.singles || 0;

      const baseItem = itemA || itemB!;

      if (aTotal === bTotal && aCases === bCases && aSingles === bSingles && itemA && itemB) {
        // MATCHED! Both Counter A and B agree exactly
        matchedVerified.push({
          itemId: baseItem.itemId,
          itemName: baseItem.itemName,
          category: baseItem.category,
          sku: baseItem.sku,
          unitsPerCase: baseItem.unitsPerCase,
          cases: aCases,
          singles: aSingles,
          totalUnits: aTotal,
          source: 'MATCHED',
          count1TotalUnits: aTotal,
          count2TotalUnits: bTotal,
        });
      } else {
        // DISCREPANCY! Mismatch between Count 1 and Count 2
        discrepanciesCount++;
        recountNeeded.push({
          itemId: baseItem.itemId,
          itemName: baseItem.itemName,
          category: baseItem.category,
          sku: baseItem.sku,
          barcode: baseItem.barcode,
          unitsPerCase: baseItem.unitsPerCase,
          cases: aCases, // seeded with A as starting point
          singles: aSingles,
          totalUnits: aTotal,
        });
      }
    });

    segment.discrepancyCount = discrepanciesCount;

    if (discrepanciesCount === 0) {
      segment.status = 'VERIFIED';
      segment.verifiedCounts = matchedVerified;
      segment.recount = [];
    } else {
      segment.status = 'DISCREPANCY_RECOUNT';
      segment.recount = recountNeeded;
      segment.verifiedCounts = matchedVerified; // keep verified matches
    }
  } else {
    segment.status = 'COUNTING';
  }

  session.segments[segmentIndex] = segment;

  // Check overall session status
  const allVerified = session.segments.every((s) => s.status === 'VERIFIED');
  const hasDiscrepancy = session.segments.some((s) => s.status === 'DISCREPANCY_RECOUNT');

  if (allVerified) {
    session.status = 'COUNTING';
  } else if (hasDiscrepancy) {
    session.status = 'RECOUNTING';
  } else {
    session.status = 'COUNTING';
  }

  saveStocktakeSession(session);

  let message = `Recorded Counter ${counterSlot} submission (${normalizedLines.length} products).`;
  if (hasCount1 && hasCount2) {
    if (discrepanciesCount === 0) {
      message = `Double-count verified! All product quantities matched between Counter A and B. Segment marked VERIFIED.`;
    } else {
      message = `Double-count compared: ${discrepanciesCount} item(s) have mismatched quantities between Counter A and B. A Recount List has been generated!`;
    }
  }

  return {
    success: true,
    message,
    session,
    discrepanciesCount,
  };
};

/**
 * RESOLVE SEGMENT RECOUNT
 * - Applies the supervisor/recounter's verified physical count for discrepancy items
 * - Combines with matched items to complete verifiedCounts
 * - Marks segment as VERIFIED
 */
export const resolveSegmentRecount = (
  sessionId: string,
  segmentId: string,
  resolvedRecountLines: StocktakeLineCount[],
  staffId: string,
  staffName: string
): { success: boolean; message: string; session: StocktakeSession } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found.`);

  const segIndex = session.segments.findIndex((s) => s.segmentId === segmentId);
  if (segIndex < 0) throw new Error(`Segment ${segmentId} not found.`);

  const segment = session.segments[segIndex];
  const timestamp = new Date().toISOString();

  segment.recounterId = staffId;
  segment.recounterName = staffName;
  segment.recountedAt = timestamp;

  // Map of existing matched lines
  const verifiedMap = new Map<string, StocktakeVerifiedLine>();
  segment.verifiedCounts.forEach((v) => verifiedMap.set(v.itemId.toUpperCase(), v));

  const mapA = new Map<string, StocktakeLineCount>();
  const mapB = new Map<string, StocktakeLineCount>();
  segment.count1.forEach((l) => mapA.set(l.itemId.toUpperCase(), l));
  segment.count2.forEach((l) => mapB.set(l.itemId.toUpperCase(), l));

  // Merge recount lines
  resolvedRecountLines.forEach((r) => {
    const upc = Math.max(1, Number(r.unitsPerCase) || 1);
    const cs = Math.max(0, Number(r.cases) || 0);
    const ea = Math.max(0, Number(r.singles) || 0);
    const tot = (cs * upc) + ea;

    const count1Units = mapA.get(r.itemId.toUpperCase())?.totalUnits || 0;
    const count2Units = mapB.get(r.itemId.toUpperCase())?.totalUnits || 0;

    verifiedMap.set(r.itemId.toUpperCase(), {
      itemId: r.itemId,
      itemName: r.itemName,
      category: r.category,
      sku: r.sku,
      unitsPerCase: upc,
      cases: cs,
      singles: ea,
      totalUnits: tot,
      source: 'RESOLVED_RECOUNT',
      resolvedBy: staffName,
      count1TotalUnits: count1Units,
      count2TotalUnits: count2Units,
    });
  });

  segment.verifiedCounts = Array.from(verifiedMap.values());
  segment.discrepancyCount = 0;
  segment.status = 'VERIFIED';
  segment.recount = resolvedRecountLines;

  session.segments[segIndex] = segment;

  // Check if all segments are now verified
  const allVerified = session.segments.every((s) => s.status === 'VERIFIED');
  if (allVerified && session.status === 'RECOUNTING') {
    session.status = 'COUNTING';
  }

  saveStocktakeSession(session);

  return {
    success: true,
    message: `Recount resolved for ${resolvedRecountLines.length} item(s). Segment '${segment.name}' is now fully VERIFIED.`,
    session,
  };
};

/**
 * CONSOLIDATE STOCKTAKE SESSION
 * - Aggregates verified physical counts across ALL segments for every SKU
 * - Compares with current System SOH (InventoryItem)
 * - Calculates Unit & Financial Variances (@ Cost & @ Sell Price)
 * - Updates status to 'CONSOLIDATED'
 */
export const consolidateStocktakeSession = (
  sessionId: string
): { success: boolean; message: string; session: StocktakeSession } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) throw new Error(`Stocktake session ${sessionId} not found.`);

  const unverifiedSegments = session.segments.filter((s) => s.status !== 'VERIFIED');
  if (unverifiedSegments.length > 0) {
    return {
      success: false,
      message: `Cannot consolidate: ${unverifiedSegments.length} segment(s) are not verified yet (${unverifiedSegments.map((s) => s.name).join(', ')}). Please verify all segment counts first.`,
      session,
    };
  }

  // 1. Aggregate physical counts across segments
  interface SkuConsolidationAccumulator {
    itemId: string;
    itemName: string;
    category: string;
    sku: string;
    unitsPerCase: number;
    countedCases: number;
    countedSingles: number;
    countedTotalUnits: number;
    segmentBreakdown: {
      segmentId: string;
      segmentName: string;
      cases: number;
      singles: number;
      totalUnits: number;
    }[];
  }

  const skuMap = new Map<string, SkuConsolidationAccumulator>();

  session.segments.forEach((seg) => {
    seg.verifiedCounts.forEach((line) => {
      const key = line.itemId.toUpperCase();
      let acc = skuMap.get(key);
      if (!acc) {
        acc = {
          itemId: line.itemId,
          itemName: line.itemName,
          category: line.category,
          sku: line.sku,
          unitsPerCase: line.unitsPerCase || 1,
          countedCases: 0,
          countedSingles: 0,
          countedTotalUnits: 0,
          segmentBreakdown: [],
        };
        skuMap.set(key, acc);
      }

      acc.countedCases += line.cases;
      acc.countedSingles += line.singles;
      acc.countedTotalUnits += line.totalUnits;
      acc.segmentBreakdown.push({
        segmentId: seg.segmentId,
        segmentName: seg.name,
        cases: line.cases,
        singles: line.singles,
        totalUnits: line.totalUnits,
      });
    });
  });

  // Also include any catalog inventory items that might not have been counted (count = 0)
  const allMasterItems = getInventoryItems();
  allMasterItems.forEach((invItem) => {
    const key = invItem.itemId.toUpperCase();
    if (!skuMap.has(key)) {
      skuMap.set(key, {
        itemId: invItem.itemId,
        itemName: invItem.itemName,
        category: invItem.category,
        sku: invItem.sku || invItem.itemId,
        unitsPerCase: invItem.unitsPerCase || 1,
        countedCases: 0,
        countedSingles: 0,
        countedTotalUnits: 0,
        segmentBreakdown: [],
      });
    }
  });

  // 2. Build consolidated items with SOH comparisons
  const consolidatedItems: StocktakeConsolidatedItem[] = [];
  let totalSystemUnits = 0;
  let totalCountedUnits = 0;
  let totalVarianceUnits = 0;
  let totalVarianceCostValue = 0;
  let totalVarianceRetailValue = 0;

  skuMap.forEach((accum) => {
    const master = getInventoryItemById(accum.itemId);
    const unitsPerCase = master?.unitsPerCase || accum.unitsPerCase || 1;
    const costPerUnit = master?.costPerUnit || (master?.costPerCase ? master.costPerCase / unitsPerCase : 0);
    const costPerCase = master?.costPerCase || costPerUnit * unitsPerCase;
    const sellPriceUnit = master?.sellPriceUnit || 0;
    const sellPriceCase = master?.sellPriceCase || sellPriceUnit * unitsPerCase;

    const systemCases = master?.stockCases || 0;
    const systemSingles = master?.stockSingles || 0;
    const systemTotalUnits = (systemCases * unitsPerCase) + systemSingles;
    const systemCostValue = systemTotalUnits * costPerUnit;
    const systemRetailValue = systemTotalUnits * sellPriceUnit;

    const countedCases = accum.countedCases;
    const countedSingles = accum.countedSingles;
    const countedTotalUnits = (countedCases * unitsPerCase) + countedSingles;
    const countedCostValue = countedTotalUnits * costPerUnit;
    const countedRetailValue = countedTotalUnits * sellPriceUnit;

    const varianceCases = countedCases - systemCases;
    const varianceSingles = countedSingles - systemSingles;
    const varianceTotalUnits = countedTotalUnits - systemTotalUnits;
    const varianceCostValue = varianceTotalUnits * costPerUnit;
    const varianceRetailValue = varianceTotalUnits * sellPriceUnit;

    let status: 'MATCH' | 'SHORTAGE' | 'OVERAGE' | 'RECOUNT_FLAGGED' = 'MATCH';
    if (varianceTotalUnits < 0) {
      status = 'SHORTAGE';
    } else if (varianceTotalUnits > 0) {
      status = 'OVERAGE';
    }

    totalSystemUnits += systemTotalUnits;
    totalCountedUnits += countedTotalUnits;
    totalVarianceUnits += varianceTotalUnits;
    totalVarianceCostValue += varianceCostValue;
    totalVarianceRetailValue += varianceRetailValue;

    consolidatedItems.push({
      itemId: accum.itemId,
      itemName: master?.itemName || accum.itemName,
      category: master?.category || accum.category,
      sku: master?.sku || accum.sku,
      barcode: master?.barcode,
      unitsPerCase,
      costPerUnit,
      costPerCase,
      sellPriceUnit,
      sellPriceCase,
      systemCases,
      systemSingles,
      systemTotalUnits,
      systemCostValue,
      systemRetailValue,
      countedCases,
      countedSingles,
      countedTotalUnits,
      countedCostValue,
      countedRetailValue,
      varianceCases,
      varianceSingles,
      varianceTotalUnits,
      varianceCostValue,
      varianceRetailValue,
      status,
      segmentBreakdown: accum.segmentBreakdown,
    });
  });

  // Sort consolidated items: Variances first (Shortages, then Overages, then Matched)
  consolidatedItems.sort((a, b) => {
    if (a.status !== 'MATCH' && b.status === 'MATCH') return -1;
    if (a.status === 'MATCH' && b.status !== 'MATCH') return 1;
    return Math.abs(b.varianceCostValue) - Math.abs(a.varianceCostValue);
  });

  session.consolidatedItems = consolidatedItems;
  session.totalSystemUnits = totalSystemUnits;
  session.totalCountedUnits = totalCountedUnits;
  session.varianceUnits = totalVarianceUnits;
  session.varianceCostValue = totalVarianceCostValue;
  session.varianceRetailValue = totalVarianceRetailValue;
  session.status = 'CONSOLIDATED';

  saveStocktakeSession(session);

  return {
    success: true,
    message: `Consolidated ${consolidatedItems.length} SKUs across ${session.segments.length} segments. Total variance: ${totalVarianceUnits >= 0 ? `+${totalVarianceUnits}` : totalVarianceUnits} units ($${totalVarianceCostValue.toFixed(2)} cost value).`,
    session,
  };
};

/**
 * REQUEST TARGETED VARIANCE RECOUNT FOR A SPECIFIC SKU
 * - Allows supervisor to flag high-variance items for a quick double-check before final approval
 */
export const requestSkuVarianceRecount = (
  sessionId: string,
  itemId: string,
  notes?: string
): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  const item = session.consolidatedItems.find((i) => i.itemId.toUpperCase() === itemId.toUpperCase());
  if (item) {
    item.recountRequested = true;
    item.status = 'RECOUNT_FLAGGED';
    item.recountNotes = notes || 'Floor recount requested to verify variance.';
    session.status = 'AUDIT_REVIEW';
    return saveStocktakeSession(session);
  }
  return null;
};

/**
 * SUBMIT TARGETED VARIANCE RECOUNT FOR A SPECIFIC SKU
 */
export const submitSkuVarianceRecount = (
  sessionId: string,
  itemId: string,
  recountCases: number,
  recountSingles: number,
  staffId: string,
  staffName: string
): StocktakeSession | null => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) return null;

  const itemIndex = session.consolidatedItems.findIndex((i) => i.itemId.toUpperCase() === itemId.toUpperCase());
  if (itemIndex < 0) return null;

  const item = session.consolidatedItems[itemIndex];
  const unitsPerCase = item.unitsPerCase || 1;
  const rcCases = Math.max(0, Number(recountCases) || 0);
  const rcSingles = Math.max(0, Number(recountSingles) || 0);
  const rcTotalUnits = (rcCases * unitsPerCase) + rcSingles;

  item.countedCases = rcCases;
  item.countedSingles = rcSingles;
  item.countedTotalUnits = rcTotalUnits;
  item.countedCostValue = rcTotalUnits * item.costPerUnit;
  item.countedRetailValue = rcTotalUnits * item.sellPriceUnit;

  item.varianceCases = rcCases - item.systemCases;
  item.varianceSingles = rcSingles - item.systemSingles;
  item.varianceTotalUnits = rcTotalUnits - item.systemTotalUnits;
  item.varianceCostValue = item.varianceTotalUnits * item.costPerUnit;
  item.varianceRetailValue = item.varianceTotalUnits * item.sellPriceUnit;

  item.recountRequested = false;
  item.recountCases = rcCases;
  item.recountSingles = rcSingles;
  item.recountTotalUnits = rcTotalUnits;
  item.recountedBy = staffName;
  item.recountedAt = new Date().toISOString();

  if (item.varianceTotalUnits === 0) {
    item.status = 'MATCH';
  } else if (item.varianceTotalUnits < 0) {
    item.status = 'SHORTAGE';
  } else {
    item.status = 'OVERAGE';
  }

  // Recalculate session totals
  let totSys = 0;
  let totCnt = 0;
  let totVar = 0;
  let totVarCost = 0;
  let totVarRetail = 0;

  session.consolidatedItems.forEach((ci) => {
    totSys += ci.systemTotalUnits;
    totCnt += ci.countedTotalUnits;
    totVar += ci.varianceTotalUnits;
    totVarCost += ci.varianceCostValue;
    totVarRetail += ci.varianceRetailValue;
  });

  session.totalSystemUnits = totSys;
  session.totalCountedUnits = totCnt;
  session.varianceUnits = totVar;
  session.varianceCostValue = totVarCost;
  session.varianceRetailValue = totVarRetail;

  const anyRecountsPending = session.consolidatedItems.some((i) => i.recountRequested);
  if (!anyRecountsPending) {
    session.status = 'CONSOLIDATED';
  }

  return saveStocktakeSession(session);
};

/**
 * ADMIN SUPER USER APPROVAL & INVENTORY MASTER STOCK COMMITTAL
 * - Updates master InventoryItem stockCases, stockSingles, totalUnits to match the physical count
 * - Automatically logs immutable StockMovementEntry records for audit trail
 * - Marks session as 'APPROVED_POSTED'
 */
export const approveAndCommitStocktake = (
  sessionId: string,
  adminId: string,
  adminName: string,
  notes?: string
): { success: boolean; message: string; adjustmentsCount: number; session?: StocktakeSession } => {
  const session = getStocktakeSessionById(sessionId);
  if (!session) {
    return { success: false, message: `Session ${sessionId} not found.`, adjustmentsCount: 0 };
  }

  if (session.status === 'APPROVED_POSTED') {
    return { success: false, message: `This stocktake session was already approved and posted.`, adjustmentsCount: 0 };
  }

  if (!session.consolidatedItems || session.consolidatedItems.length === 0) {
    // Attempt auto-consolidation first if needed
    const consResult = consolidateStocktakeSession(sessionId);
    if (!consResult.success) {
      return { success: false, message: consResult.message, adjustmentsCount: 0 };
    }
  }

  const timestamp = new Date().toISOString();
  const dateStr = session.date || timestamp.split('T')[0];
  let adjustmentsCount = 0;

  // Process all items that have variances
  session.consolidatedItems.forEach((cItem) => {
    if (cItem.varianceTotalUnits !== 0) {
      const invItem = getInventoryItemById(cItem.itemId);
      if (invItem) {
        const prevCases = invItem.stockCases;
        const prevSingles = invItem.stockSingles;
        const newCases = cItem.countedCases;
        const newSingles = cItem.countedSingles;
        const newTotalUnits = (newCases * invItem.unitsPerCase) + newSingles;

        // 1. Update Inventory Master Stock Levels
        const updatedMaster: InventoryItem = {
          ...invItem,
          stockCases: newCases,
          stockSingles: newSingles,
          totalUnits: newTotalUnits,
          lastUpdated: timestamp,
        };
        saveInventoryItem(updatedMaster);

        // 2. Log StockMovementEntry (ADJUSTMENT)
        const txnId = `TXN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}-${cItem.itemId}`;
        const movement: StockMovementEntry = {
          txnId,
          movementId: txnId,
          date: dateStr,
          staffId: adminId,
          staffName: adminName,
          itemId: invItem.itemId,
          itemName: invItem.itemName,
          txnType: 'ADJUSTMENT',
          qtyCases: cItem.varianceCases,
          qtySingles: cItem.varianceSingles,
          casesChange: cItem.varianceCases,
          singlesChange: cItem.varianceSingles,
          closingCases: newCases,
          closingSingles: newSingles,
          resultingStockCases: newCases,
          resultingStockSingles: newSingles,
          promptShown: `Stocktake Audit Approval #${sessionId}`,
          actionTaken: cItem.varianceTotalUnits < 0 ? 'STOCKTAKE_SHRINKAGE_ADJUSTMENT' : 'STOCKTAKE_OVERAGE_ADJUSTMENT',
          referenceId: `${sessionId} (Approved by ${adminName})`,
          triggerRule: 'Super User Stocktake Committal',
          reason: `Physical count variance adjustment: ${cItem.varianceTotalUnits >= 0 ? `+${cItem.varianceTotalUnits}` : cItem.varianceTotalUnits} units. Previous: ${prevCases}cs/${prevSingles}ea -> New: ${newCases}cs/${newSingles}ea`,
          timestamp,
          synced: false,
        };
        addStockMovement(movement);
        adjustmentsCount++;
      }
    }
  });

  session.status = 'APPROVED_POSTED';
  session.approvedBy = adminId;
  session.approvedByName = adminName;
  session.approvedAt = timestamp;
  if (notes) {
    session.notes = (session.notes ? `${session.notes}\n` : '') + `[Approval Note]: ${notes}`;
  }

  saveStocktakeSession(session);

  return {
    success: true,
    message: `Stocktake approved successfully! ${adjustmentsCount} inventory item(s) updated in Inventory Master with physical counts. Audit ledger entries created.`,
    adjustmentsCount,
    session,
  };
};

// ============================================================================
// SAAS MULTI-TENANT & BRANCH ISOLATION DAO
// ============================================================================

export function getCompanies(): Company[] {
  return getStored<Company[]>(STORAGE_KEYS.COMPANIES, SEED_COMPANIES);
}

export function saveCompany(company: Company): void {
  const list = getCompanies();
  const index = list.findIndex((c) => c.company_id === company.company_id);
  if (index >= 0) {
    list[index] = company;
  } else {
    list.push(company);
  }
  setStored(STORAGE_KEYS.COMPANIES, list);
  notifyListeners();
}

export function getCurrentCompanyId(): string {
  const user = getSessionUser();
  if (user && user.role !== 'SUPER_ADMIN') {
    const userComp = user.company_id || user.companyId;
    if (userComp) {
      return userComp;
    }
  }
  const current = getStored<string>(STORAGE_KEYS.CURRENT_COMPANY_ID, 'COMP-001');
  return current;
}

export function setCurrentCompanyId(companyId: string): void {
  setStored(STORAGE_KEYS.CURRENT_COMPANY_ID, companyId);
  notifyListeners();
}

export function getCurrentCompany(): Company {
  const id = getCurrentCompanyId();
  const list = getCompanies();
  return list.find((c) => c.company_id === id) || list[0] || SEED_COMPANIES[0];
}

export function getCurrentBranchId(): string {
  const user = getSessionUser();
  if (user && (user.branchId || user.branch_id)) {
    return (user.branchId || user.branch_id)!;
  }
  return getStored<string>(STORAGE_KEYS.CURRENT_BRANCH_ID, 'BR-MAIN');
}

export function setCurrentBranchId(branchId: string): void {
  setStored(STORAGE_KEYS.CURRENT_BRANCH_ID, branchId);
  const user = getSessionUser();
  if (user) {
    user.branchId = branchId;
    user.branch_id = branchId;
    const branches = getBranches();
    const br = branches.find((b) => b.branchId === branchId);
    if (br) user.branchName = br.name;
    setSessionUser(user);
  }
  notifyListeners();
}

export function getCurrentBranch(): Branch {
  const branchId = getCurrentBranchId();
  const branches = getBranches();
  const found = branches.find((b) => b.branchId === branchId);
  if (found) return found;
  return branches[0] || {
    branchId: 'BR-MAIN',
    name: 'Harare Main',
    code: 'HQ-01',
    location: '4th Street Commercial Center, Harare',
    isMain: true,
  };
}

// ============================================================================
// SAAS TENANT ONBOARDING & SUBSCRIPTION TRIAL MANAGEMENT
// ============================================================================

export interface SubscriptionStatusInfo {
  isExpired: boolean;
  isTrial: boolean;
  isActive: boolean;
  isSuspended: boolean;
  daysRemaining: number;
  message: string;
  nextBillingDate: string;
  plan: string;
  companyName: string;
  ownerEmail: string;
  offlineActivationCode?: string;
}

export const getSubscriptionStatus = (companyOrId?: Company | string | null): SubscriptionStatusInfo => {
  let company: Company | undefined;
  if (!companyOrId) {
    company = getCurrentCompany();
  } else if (typeof companyOrId === 'string') {
    company = getCompanies().find((c) => c.company_id === companyOrId);
  } else {
    company = companyOrId;
  }

  if (!company) {
    company = getCurrentCompany();
  }

  // Developer / Super Admin Master account never expires
  if (
    company.company_id === 'COMP-001' ||
    company.company_id === 'COMP-MASTER' ||
    (company.owner_email && company.owner_email.toLowerCase() === 'andrekudakwashe@gmail.com')
  ) {
    return {
      isExpired: false,
      isTrial: false,
      isActive: true,
      isSuspended: false,
      daysRemaining: 999,
      message: 'Permanent Super Admin Master Account',
      nextBillingDate: company.next_billing_date || '2030-01-01',
      plan: 'ENTERPRISE',
      companyName: company.company_name,
      ownerEmail: company.owner_email,
      offlineActivationCode: 'SAI-MASTER',
    };
  }

  if (company.subscription_status === 'ACTIVE') {
    return {
      isExpired: false,
      isTrial: false,
      isActive: true,
      isSuspended: false,
      daysRemaining: 999,
      message: `Active ${company.plan} Subscription (Paid & Confirmed)`,
      nextBillingDate: company.next_billing_date,
      plan: company.plan,
      companyName: company.company_name,
      ownerEmail: company.owner_email,
      offlineActivationCode: company.offline_activation_code,
    };
  }

  if (company.subscription_status === 'CANCELLED' || company.subscription_status === 'PAST_DUE') {
    return {
      isExpired: true,
      isTrial: false,
      isActive: false,
      isSuspended: true,
      daysRemaining: 0,
      message: 'Account Suspended - Contact System Owner',
      nextBillingDate: company.next_billing_date,
      plan: company.plan,
      companyName: company.company_name,
      ownerEmail: company.owner_email,
      offlineActivationCode: company.offline_activation_code,
    };
  }

  // TRIAL MODE: Calculate 14-day window
  const now = new Date();
  const billingDate = new Date(company.next_billing_date + 'T23:59:59');
  const diffTime = billingDate.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  const isExpired = daysRemaining <= 0;

  return {
    isExpired,
    isTrial: true,
    isActive: !isExpired,
    isSuspended: false,
    daysRemaining,
    message: isExpired
      ? '14-Day Free Trial Expired - Payment Confirmation Required'
      : `${daysRemaining} Day${daysRemaining === 1 ? '' : 's'} Remaining in 14-Day Free Trial`,
    nextBillingDate: company.next_billing_date,
    plan: company.plan,
    companyName: company.company_name,
    ownerEmail: company.owner_email,
    offlineActivationCode: company.offline_activation_code,
  };
};

export const getStaffForCompany = (companyId: string): Salesperson[] => {
  const allStaff = getSalespeople();
  return allStaff.filter(
    (s) => s.companyId === companyId || s.company_id === companyId || (!s.companyId && companyId === 'COMP-001')
  );
};


export interface RegisterTenantParams {
  companyName: string;
  businessCategory?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone?: string;
  branchName?: string;
  branchCode?: string;
  branchLocation?: string;
  ownerPin: string;
}

export const registerTenantCompany = (
  params: RegisterTenantParams
): { company: Company; branch: Branch; owner: Salesperson } => {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const billingDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const randSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const companyId = `COMP-${Date.now().toString(36).toUpperCase()}`;
  const branchId = `BR-${randSuffix}-01`;
  const ownerId = `USR-${randSuffix}-01`;
  const offlineCode = `SAI-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const company: Company = {
    company_id: companyId,
    company_name: params.companyName.trim(),
    owner_name: params.ownerName.trim(),
    owner_email: params.ownerEmail.trim().toLowerCase(),
    phone: params.ownerPhone?.trim() || '',
    business_category: params.businessCategory || 'Grocery & FMCG',
    sheet_folder_id: '',
    trial_start_date: todayStr,
    subscription_status: 'TRIAL',
    plan: 'PROFESSIONAL',
    next_billing_date: billingDate,
    offline_activation_code: offlineCode,
    trial_days_remaining: 14,
  };

  saveCompany(company);

  const branch: Branch = {
    branchId: branchId,
    name: params.branchName?.trim() || 'Main Branch',
    code: params.branchCode?.trim().toUpperCase() || `${params.companyName.slice(0, 3).toUpperCase()}-01`,
    location: params.branchLocation?.trim() || 'Central Store',
    isMain: true,
    companyId: companyId,
    company_id: companyId,
  } as any;

  saveBranch(branch);

  const owner: Salesperson = {
    id: ownerId,
    name: params.ownerName.trim(),
    pin: params.ownerPin.trim() || '1234',
    role: 'OWNER',
    email: params.ownerEmail.trim().toLowerCase(),
    phone: params.ownerPhone?.trim() || '',
    active: 'Y',
    companyId: companyId,
    company_id: companyId,
    branchId: branchId,
    branch_id: branchId,
    branchName: branch.name,
    permissions: {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: true,
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: true,
      canCreateDirectGrv: true,
      canApproveDirectGrv: true,
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: true,
      canApproveEOD: true,
      canViewVarianceInvestigation: true,
      canViewAuditLog: true,
      canPinOverride: true,
      canManageCompany: true,
      canEditMasterPrice: true,
      canSeeMargin: true,
    },
  };

  addSalesperson(owner);

  // Switch context to newly created tenant
  setCurrentCompanyId(companyId);
  setCurrentBranchId(branchId);
  setSessionUser(owner);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'INFO',
    staffId: ownerId,
    staffName: owner.name,
    staffRole: 'OWNER',
    company_id: companyId,
    branch_id: branchId,
    details: `SaaS 14-Day Trial registered for company '${company.company_name}' (${companyId}). Trial active until ${billingDate}.`,
  });

  notifyListeners();
  return { company, branch, owner };
};

export const confirmCompanyPayment = (
  companyId: string,
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' = 'PROFESSIONAL',
  durationMonths: number = 1,
  confirmedBy: string = 'Andre Kudakwashe (Super Admin)',
  notes?: string
): { success: boolean; company?: Company; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) {
    return { success: false, message: 'Company account not found.' };
  }

  const now = new Date();
  const currentNext = new Date(comp.next_billing_date);
  const baseDate = currentNext.getTime() > now.getTime() ? currentNext : now;
  const newBillingDate = new Date(baseDate.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  comp.subscription_status = 'ACTIVE';
  comp.plan = plan;
  comp.next_billing_date = newBillingDate;
  comp.payment_confirmed_at = now.toISOString();
  comp.payment_confirmed_by = confirmedBy;
  if (notes) comp.notes = notes;

  saveCompany(comp);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'SECURITY',
    staffId: 'SUPER_ADMIN',
    staffName: confirmedBy,
    staffRole: 'SUPER_ADMIN',
    company_id: companyId,
    details: `Payment confirmed and license activated for '${comp.company_name}'. Plan: ${plan}, Next Billing: ${newBillingDate}.`,
  });

  notifyListeners();
  return {
    success: true,
    company: comp,
    message: `Payment confirmed for ${comp.company_name}! Account upgraded to ${plan} until ${newBillingDate}.`,
  };
};

export const extendCompanyTrial = (
  companyId: string,
  extraDays: number = 14,
  confirmedBy: string = 'Andre Kudakwashe'
): { success: boolean; company?: Company; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) {
    return { success: false, message: 'Company account not found.' };
  }

  const now = new Date();
  const currentNext = new Date(comp.next_billing_date);
  const baseDate = currentNext.getTime() > now.getTime() ? currentNext : now;
  const newBillingDate = new Date(baseDate.getTime() + extraDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  comp.subscription_status = 'TRIAL';
  comp.next_billing_date = newBillingDate;

  saveCompany(comp);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'WARNING',
    staffId: 'SUPER_ADMIN',
    staffName: confirmedBy,
    staffRole: 'SUPER_ADMIN',
    company_id: companyId,
    details: `14-Day Free Trial extended by ${extraDays} days for '${comp.company_name}' until ${newBillingDate}.`,
  });

  notifyListeners();
  return {
    success: true,
    company: comp,
    message: `Trial extended by ${extraDays} days for ${comp.company_name} (New expiry: ${newBillingDate}).`,
  };
};

export const suspendCompany = (
  companyId: string,
  reason: string = 'Payment Overdue / Cancelled'
): { success: boolean; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) return { success: false, message: 'Company not found.' };

  comp.subscription_status = 'CANCELLED';
  saveCompany(comp);

  addAuditLog({
    action: 'SYSTEM_SETTINGS_UPDATE',
    severity: 'CRITICAL',
    staffId: 'SUPER_ADMIN',
    staffName: 'Andre Kudakwashe',
    staffRole: 'SUPER_ADMIN',
    company_id: companyId,
    details: `Suspended SaaS tenant '${comp.company_name}'. Reason: ${reason}`,
  });

  notifyListeners();
  return { success: true, message: `Company ${comp.company_name} has been suspended.` };
};

export const activateCompanyWithCode = (
  companyId: string,
  enteredCode: string
): { success: boolean; message: string } => {
  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) return { success: false, message: 'Company not found.' };

  const cleanEntered = enteredCode.trim().toUpperCase();
  const validOffline = comp.offline_activation_code?.trim().toUpperCase();
  const masterBypass = 'SAI-ACTIVATE-2026';

  if (cleanEntered === validOffline || cleanEntered === masterBypass) {
    return confirmCompanyPayment(companyId, 'PROFESSIONAL', 1, 'Offline Key Activation');
  }

  return { success: false, message: 'Invalid activation key. Please contact Andre Kudakwashe.' };
};

// ============================================================================
// 52 GRANULAR PERMISSIONS DAO
// ============================================================================

export const getPermissionsList = (): PermissionRule[] => {
  return getStored<PermissionRule[]>(STORAGE_KEYS.PERMISSIONS, MASTER_PERMISSIONS_52);
};

export const savePermissionsList = (rules: PermissionRule[]): void => {
  setStored(STORAGE_KEYS.PERMISSIONS, rules);
  notifyListeners();
};

export const updatePermissionRule = (id: string, allowed: boolean): void => {
  const list = getPermissionsList();
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) {
    list[idx].allowed = allowed;
    setStored(STORAGE_KEYS.PERMISSIONS, list);
    notifyListeners();
  }
};

export const hasStaffPermission = (role: string, module: string, action: string): boolean => {
  const normalized = (role || 'CASHIER').toUpperCase();
  if (normalized === 'OWNER' || normalized === 'ADMIN' || normalized === 'SUPER_ADMIN') {
    return true;
  }
  const rules = getPermissionsList();
  const match = rules.find(
    (r) => r.role.toUpperCase() === normalized && r.module === module && (r.action === action || r.action === '*')
  );
  if (match) {
    return Boolean(match.allowed);
  }
  // Default fallbacks for Supervisor vs Cashier
  if (normalized === 'SUPERVISOR') {
    if (action === 'approve' || action === 'view_variance' || action === 'pin_override') return true;
  }
  if (normalized === 'CASHIER') {
    if (action === 'edit_price' || action === 'approve' || action === 'void_sale') return false;
    if (action === 'create' || action === 'change_use' || action === 'credit_issue') return true;
  }
  return false;
};

// ============================================================================
// DIRECT SUPPLIER DELIVERIES (DIRECT GRV) DAO
// ============================================================================

const INITIAL_DIRECT_GRVS: DirectGrv[] = [
  {
    id: 'DGRV-20260905-001',
    grvNumber: 'DGRV-20260905-001',
    type: 'DIRECT',
    status: 'APPROVED',
    companyId: 'COMP-001',
    branchId: 'BR-MAIN',
    branchName: 'Harare Main',
    supplierId: 'SUP-001',
    supplierName: 'National Foods Wholesalers',
    invoiceNo: 'SUP-INV-4401',
    purchaseOrderNo: 'PO-2026-081',
    date: '2026-09-05',
    items: [
      {
        productId: 'SUG001',
        productName: 'White Sugar 2kg',
        quantity: 10,
        costPrice: 1.30,
        sellingPrice: 1.80,
        lineTotal: 13.00,
        markupPercent: 38.46,
        profit: 5.00,
        unitsPerCase: 20,
        unit: 'Singles',
      },
      {
        productId: 'OIL002',
        productName: 'Pure Cooking Oil 2L',
        quantity: 5,
        costPrice: 2.50,
        sellingPrice: 3.50,
        lineTotal: 12.50,
        markupPercent: 40.00,
        profit: 5.00,
        unitsPerCase: 12,
        unit: 'Singles',
      },
    ],
    totalCost: 25.50,
    totalSellingPrice: 35.50,
    payFromTill: true,
    payments: [
      {
        userId: 'USR-003',
        userName: 'Tariro Moyo',
        amount: 25.50,
        pinConfirmed: true,
        confirmedAt: '2026-09-05T10:15:00Z',
      },
    ],
    receivedByStaffId: 'USR-003',
    receivedByStaffName: 'Tariro Moyo',
    approvedByStaffId: 'USR-002',
    approvedByStaffName: 'Supervisor Harare',
    approvedAt: '2026-09-05T10:30:00Z',
    createdAt: '2026-09-05T10:15:00Z',
    synced: true,
  },
  {
    id: 'DGRV-20260906-002',
    grvNumber: 'DGRV-20260906-002',
    type: 'DIRECT',
    status: 'PENDING_APPROVAL',
    companyId: 'COMP-001',
    branchId: 'BR-MAIN',
    branchName: 'Harare Main',
    supplierId: 'SUP-002',
    supplierName: 'Delta Beverages Distribution',
    invoiceNo: 'DLT-99812',
    purchaseOrderNo: 'PO-2026-092',
    date: '2026-09-06',
    items: [
      {
        productId: 'BEV006',
        productName: 'Cola Spark Soft Drink 300ml',
        quantity: 24,
        costPrice: 0.50,
        sellingPrice: 0.75,
        lineTotal: 12.00,
        markupPercent: 50.00,
        profit: 6.00,
        unitsPerCase: 24,
        unit: 'Singles',
      },
    ],
    totalCost: 12.00,
    totalSellingPrice: 18.00,
    payFromTill: true,
    payments: [
      {
        userId: 'USR-003',
        userName: 'Tariro Moyo',
        amount: 12.00,
        pinConfirmed: true,
        confirmedAt: '2026-09-06T08:00:00Z',
      },
    ],
    receivedByStaffId: 'USR-003',
    receivedByStaffName: 'Tariro Moyo',
    createdAt: '2026-09-06T08:00:00Z',
    synced: false,
  },
];

export const getAllDirectGrvs = (): DirectGrv[] => {
  return getStored<DirectGrv[]>(STORAGE_KEYS.DIRECT_GRVS, INITIAL_DIRECT_GRVS);
};

export const getDirectGrvs = (): DirectGrv[] => {
  const currentCompany = getCurrentCompanyId();
  const sessionUser = getSessionUser();
  const all = getAllDirectGrvs();
  if (sessionUser?.role === 'SUPER_ADMIN' && (!currentCompany || currentCompany === 'COMP-MASTER')) {
    return all;
  }
  return all.filter((g) => {
    const compId = (g as any).company_id || (g as any).companyId;
    if (!compId) return currentCompany === 'COMP-001' || currentCompany === 'COMP-MASTER';
    return compId === currentCompany;
  });
};

export const getDirectGrvById = (id: string): DirectGrv | null => {
  const list = getDirectGrvs();
  return list.find((g) => g.id === id || g.grvNumber === id) || null;
};

export const saveDirectGrv = (grv: DirectGrv): DirectGrv => {
  const list = getAllDirectGrvs();
  const currentCompany = getCurrentCompanyId();
  const currentBranch = getCurrentBranchId();
  const compId = (grv as any).company_id || (grv as any).companyId || currentCompany;
  const brId = (grv as any).branch_id || (grv as any).branchId || currentBranch;
  const normalized: DirectGrv = {
    ...grv,
    companyId: compId,
    company_id: compId,
    branchId: brId,
    branch_id: brId,
  } as any;
  const index = list.findIndex((g) => g.id === grv.id);
  if (index >= 0) {
    list[index] = normalized;
  } else {
    list.unshift(normalized);
  }
  setStored(STORAGE_KEYS.DIRECT_GRVS, list);

  // Log audit
  addAuditLog({
    action: 'DIRECT_GRV_CREATE',
    severity: 'INFO',
    staffId: grv.receivedByStaffId,
    staffName: grv.receivedByStaffName,
    staffRole: 'CASHIER',
    details: `Direct Supplier Delivery ${grv.grvNumber} created. Supplier: ${grv.supplierName}. Total Cost: $${grv.totalCost.toFixed(2)}. Status: ${grv.status}`,
    referenceId: grv.grvNumber,
    amount: grv.totalCost,
  });

  notifyListeners();
  return grv;
};

/**
 * Approve Direct GRV:
 * 1. Sets status = 'APPROVED'
 * 2. Updates Stock in Inventory Master
 * 3. Records Till Payout / Cash Log OUT
 * 4. Writes Forensic Audit Log
 */
export const approveDirectGrv = (
  id: string,
  approverId: string,
  approverName: string
): { success: boolean; message: string; grv?: DirectGrv } => {
  const list = getDirectGrvs();
  const grv = list.find((g) => g.id === id || g.grvNumber === id);
  if (!grv) {
    return { success: false, message: 'GRV voucher not found.' };
  }
  if (grv.status === 'APPROVED') {
    return { success: false, message: 'GRV voucher is already approved.' };
  }

  const now = new Date().toISOString();
  grv.status = 'APPROVED';
  grv.approvedByStaffId = approverId;
  grv.approvedByStaffName = approverName;
  grv.approvedAt = now;

  // 1. Increment inventory for each item
  const inventory = getInventoryItems();
  grv.items.forEach((item) => {
    const pName = (item.productName || '').toLowerCase();
    const invItem = inventory.find((i) => i.itemId === item.productId || (i.itemName && pName && i.itemName.toLowerCase() === pName));
    if (invItem) {
      invItem.stockSingles += item.quantity;
      invItem.totalUnits = (invItem.stockCases * invItem.unitsPerCase) + invItem.stockSingles;
      invItem.costPerUnit = item.costPrice;
      invItem.lastUpdated = now;
      saveInventoryItem(invItem);
    }
  });

  // 2. Till Payouts -> create Cash Log OUT & Expense entries
  if (grv.payFromTill && grv.payments && grv.payments.length > 0) {
    grv.payments.forEach((p) => {
      if (p.amount > 0) {
        addCashLog({
          timestamp: now,
          date: now.split('T')[0],
          staffId: p.userId,
          staffName: p.userName,
          line: '1',
          description: `Direct Supplier Delivery Payout: ${grv.supplierName} (${grv.grvNumber})`,
          in: 0,
          out: p.amount,
        });

        addExpense({
          timestamp: now,
          date: now.split('T')[0],
          category: 'Direct Supplier Delivery Payout',
          amount: p.amount,
          paymentMethod: 'Cash',
          staffId: p.userId,
          staffName: p.userName,
          vendorOrCustomer: grv.supplierName,
          description: `Till payout for Direct Delivery voucher ${grv.grvNumber}`,
          receiptRef: grv.invoiceNo || grv.grvNumber,
        });
      }
    });
  }

  // 3. Save GRV
  setStored(STORAGE_KEYS.DIRECT_GRVS, list);

  // 4. Audit Log
  addAuditLog({
    action: 'DIRECT_GRV_APPROVE',
    severity: 'SECURITY',
    staffId: approverId,
    staffName: approverName,
    staffRole: 'SUPERVISOR',
    details: `Approved Direct GRV ${grv.grvNumber} for ${grv.supplierName}. Total Cost: $${grv.totalCost.toFixed(2)}. Till Payout: $${grv.payFromTill ? grv.totalCost.toFixed(2) : '0.00'}. Stock updated.`,
    referenceId: grv.grvNumber,
    amount: grv.totalCost,
  });

  notifyListeners();
  return {
    success: true,
    message: `Direct Delivery ${grv.grvNumber} approved successfully. Stock increased and Till Payout recorded.`,
    grv,
  };
};

export const rejectDirectGrv = (
  id: string,
  rejectorId: string,
  rejectorName: string,
  reason: string
): { success: boolean; message: string; grv?: DirectGrv } => {
  const list = getDirectGrvs();
  const grv = list.find((g) => g.id === id || g.grvNumber === id);
  if (!grv) {
    return { success: false, message: 'GRV voucher not found.' };
  }

  grv.status = 'REJECTED';
  grv.rejectedReason = reason;
  setStored(STORAGE_KEYS.DIRECT_GRVS, list);

  addAuditLog({
    action: 'DIRECT_GRV_REJECT',
    severity: 'SECURITY',
    staffId: rejectorId,
    staffName: rejectorName,
    staffRole: 'SUPERVISOR',
    details: `Rejected Direct Delivery Voucher ${grv.grvNumber}. Reason: ${reason}`,
    referenceId: grv.grvNumber,
  });

  notifyListeners();
  return { success: true, message: `GRV ${grv.grvNumber} rejected.`, grv };
};

// ============================================================================
// BRANCH DATA ISOLATION QUERIES
// ============================================================================

export const getSalesForCurrentBranch = (): SaleInvoice[] => {
  const branchId = getCurrentBranchId();
  const sales = getSales();
  return sales.filter((s) => !s.id || (s as any).branchId === branchId || !(s as any).branchId);
};

export const getDirectGrvsForCurrentBranch = (): DirectGrv[] => {
  const branchId = getCurrentBranchId();
  const grvs = getDirectGrvs();
  return grvs.filter((g) => !g.branchId || g.branchId === branchId);
};

export const getCashLogsForCurrentBranch = (): CashLogEntry[] => {
  const logs = getCashLogs();
  return logs;
};




