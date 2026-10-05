import { ActiveTab, Role, Salesperson } from '../types';
import {
  ShoppingBag,
  Receipt,
  Scale,
  Coins,
  CreditCard,
  Users,
  Package,
  Truck,
  TrendingUp,
  LayoutGrid,
  FileSpreadsheet,
  Shield,
  ShieldAlert,
  Sparkles,
  Layers,
  ArrowUpDown,
  ClipboardList,
  BarChart3,
  Sliders,
  DollarSign,
  Boxes,
  Briefcase,
  History,
  CheckCircle,
  Wifi,
  Database,
  Building,
} from 'lucide-react';
import React from 'react';

// Core functional domain categories requested by user
export type CoreFunctionCategory =
  | 'pos'          // Point of Sale & Checkout
  | 'cash'         // Cash & Balancing (Form 4, Cash Counts, Floats)
  | 'customers'    // Customer Accounts, Change, Credit
  | 'inventory'    // Stock & Inventory Master
  | 'receiving'    // Direct GRV, Deliveries, Suppliers
  | 'sales'        // Sales Monitoring, Cashier Reconciliation
  | 'reports'      // Business Intelligence & Financial Reports
  | 'admin';       // Roles, Staff, Backup, Security, Multi-Branch

export interface SystemModuleInfo {
  id: ActiveTab;
  name: string;
  shortLabel: string;
  description: string;
  category: CoreFunctionCategory;
  categoryLabel: string;
  iconName: string;
  requiredPermission?: string;
  isOwnerAdminOnly?: boolean;
}

export const ALL_SYSTEM_MODULES: SystemModuleInfo[] = [
  // --- Category 1: Point of Sale & Checkout ---
  {
    id: 'pos',
    name: 'POS Register / Checkout',
    shortLabel: 'Register',
    description: 'Barcode scanning, product lookup, speed keys, cart & multi-tender checkout',
    category: 'pos',
    categoryLabel: 'Point of Sale & Register',
    iconName: 'ShoppingBag',
  },
  {
    id: 'counter',
    name: 'Sales Counter / Cart',
    shortLabel: 'Counter',
    description: 'Active shopping cart, discounts, customer pricing & payment tender',
    category: 'pos',
    categoryLabel: 'Point of Sale & Register',
    iconName: 'Sparkles',
  },
  {
    id: 'today',
    name: 'Receipts & Invoices Ledger',
    shortLabel: 'Receipts',
    description: 'View receipts, load more, reprint invoices, refund or void transactions',
    category: 'pos',
    categoryLabel: 'Point of Sale & Register',
    iconName: 'Receipt',
  },

  // --- Category 2: Cash & Balancing ---
  {
    id: 'cash_balancing',
    name: 'Cash Balancing Drawer (Form 4)',
    shortLabel: 'Cash Drawer',
    description: 'Cash drawer balancing, shift turnover declaration & over/short reconciliation',
    category: 'cash',
    categoryLabel: 'Cash & Balancing Drawer',
    iconName: 'Scale',
  },
  {
    id: 'multi_currency',
    name: 'Multi-Currency & Exchange Rates',
    shortLabel: 'Multi-Currency',
    description: 'Base currency, regional exchange rates, mobile money, and till cash-out limits',
    category: 'cash',
    categoryLabel: 'Cash & Balancing Drawer',
    iconName: 'Coins',
  },
  {
    id: 'cash_count',
    name: 'Cash Count Denominations',
    shortLabel: 'Cash Count',
    description: 'Denomination note & coin breakdown counting for drawer opening & closing',
    category: 'cash',
    categoryLabel: 'Cash & Balancing Drawer',
    iconName: 'DollarSign',
  },
  {
    id: 'cash_log',
    name: 'Cash Float & Expense Log',
    shortLabel: 'Cash Log',
    description: 'Record petty cash expenses, cash drops, and morning till float entries',
    category: 'cash',
    categoryLabel: 'Cash & Balancing Drawer',
    iconName: 'History',
  },

  // --- Category 3: Customer Accounts & Credit ---
  {
    id: 'customers',
    name: 'Customer Directory & Accounts',
    shortLabel: 'Customers',
    description: 'Customer contact records, buying history, linked phone & company accounts',
    category: 'customers',
    categoryLabel: 'Customer Accounts & Credit',
    iconName: 'Users',
  },
  {
    id: 'change_report',
    name: 'Customer Change Tracking',
    shortLabel: 'Change',
    description: 'Unpaid customer change ledger, balances owed to shoppers & redemption history',
    category: 'customers',
    categoryLabel: 'Customer Accounts & Credit',
    iconName: 'Coins',
  },
  {
    id: 'credit_report',
    name: 'Customer Credit Line Book',
    shortLabel: 'Credit',
    description: 'Debtor balances, credit sales limits, 30/60/90-day aging & payments received',
    category: 'customers',
    categoryLabel: 'Customer Accounts & Credit',
    iconName: 'CreditCard',
  },

  // --- Category 4: Inventory & Stock Control ---
  {
    id: 'inventory',
    name: 'Inventory Master Catalog',
    shortLabel: 'Inventory',
    description: 'Product master list, barcodes, unit pricing, pack sizes, stock on hand & margins',
    category: 'inventory',
    categoryLabel: 'Inventory & Stock Control',
    iconName: 'Package',
  },
  {
    id: 'stock_movement',
    name: 'Stock Movements & Transfers',
    shortLabel: 'Stock Transfer',
    description: 'Case breaking, inter-branch stock transfers, shrinkage write-offs and returns',
    category: 'inventory',
    categoryLabel: 'Inventory & Stock Control',
    iconName: 'ArrowUpDown',
  },
  {
    id: 'stocktake',
    name: 'Stocktake & Physical Count',
    shortLabel: 'Stocktake',
    description: 'Periodic stock audit, scanner counting, stock variance committal and variance logs',
    category: 'inventory',
    categoryLabel: 'Inventory & Stock Control',
    iconName: 'ClipboardList',
  },
  {
    id: 'fifo_reports',
    name: 'FIFO Batch & Expiry Tracking',
    shortLabel: 'Batch & Expiry',
    description: 'Track perishable inventory batches, expiration dates, FIFO stock consumption & aging alerts',
    category: 'inventory',
    categoryLabel: 'Inventory & Stock Control',
    iconName: 'Layers',
  },

  // --- Category 5: Receiving & Supply Chain ---
  {
    id: 'direct_grv',
    name: 'Direct Delivery Receiving Voucher (GRV)',
    shortLabel: 'Direct GRV',
    description: 'Direct supplier delivery voucher, case quantity verification & branch receiving',
    category: 'receiving',
    categoryLabel: 'Receiving & Supply Chain',
    iconName: 'Truck',
  },
  {
    id: 'goods_received',
    name: 'Goods Received Notes (GRN)',
    shortLabel: 'Receive GRN',
    description: 'Central purchase order receipting, invoice cost checking & inventory batch entry',
    category: 'receiving',
    categoryLabel: 'Receiving & Supply Chain',
    iconName: 'Boxes',
  },
  {
    id: 'suppliers',
    name: 'Supplier Management Directory',
    shortLabel: 'Suppliers',
    description: 'Supplier directory, vendor contacts, lead times, payment terms & purchase orders',
    category: 'receiving',
    categoryLabel: 'Receiving & Supply Chain',
    iconName: 'Briefcase',
  },

  // --- Category 6: Sales & Reconciliation ---
  {
    id: 'sales_report',
    name: 'Sales, Profit & Top Stocks Report',
    shortLabel: 'Sales & Profit',
    description: 'Real-time sales velocity, revenue, gross profit, margin & top-selling products',
    category: 'sales',
    categoryLabel: 'Sales & Operations',
    iconName: 'TrendingUp',
  },
  {
    id: 'reconciliation',
    name: 'Cashier Balancing & Reconciliation',
    shortLabel: 'Reconciliation',
    description: 'Check whether cashiers are balancing, supervisor approvals & variance investigations',
    category: 'sales',
    categoryLabel: 'Sales & Operations',
    iconName: 'CheckCircle',
  },
  {
    id: 'dashboard',
    name: 'Store Overview & Analytics',
    shortLabel: 'Dashboard',
    description: 'Real-time sales velocity, revenue graphs, top-selling items & active staff status',
    category: 'sales',
    categoryLabel: 'Sales & Operations',
    iconName: 'BarChart3',
  },

  // --- Category 7: Reports & Business Intelligence ---
  {
    id: 'reports',
    name: 'Executive Financial Reports',
    shortLabel: 'Reports',
    description: 'Consolidated end-of-day reports, profit & loss, cash vs credit vs digital breakdown',
    category: 'reports',
    categoryLabel: 'Reports & Intelligence',
    iconName: 'FileSpreadsheet',
  },
  {
    id: 'grn_daily_report',
    name: 'Daily Receiving & GRN Report',
    shortLabel: 'GRN Report',
    description: 'Daily delivery audit, supplier invoice cost summary & goods received log',
    category: 'reports',
    categoryLabel: 'Reports & Intelligence',
    iconName: 'Receipt',
  },
  {
    id: 'report_builder',
    name: 'Universal Report Builder',
    shortLabel: 'Report Builder',
    description: 'Interactive query builder, cross-table joins, pivot analysis & CSV exports',
    category: 'reports',
    categoryLabel: 'Reports & Intelligence',
    iconName: 'Sliders',
  },

  // --- Category 8: Administration & Security ---
  {
    id: 'staff_access',
    name: 'Staff & Role Configuration',
    shortLabel: 'Staff & Roles',
    description: 'Staff directory, 4-digit PINs, role priorities, primary modules & access permissions',
    category: 'admin',
    categoryLabel: 'Administration & Security',
    iconName: 'Shield',
    requiredPermission: 'canManageStaff',
  },
  {
    id: 'data_management',
    name: 'Data Management & Encrypted Backup',
    shortLabel: 'Data & Backup',
    description: 'Excel/CSV migration, auto-calculation formulas, full & delta AES-256 encrypted backups',
    category: 'admin',
    categoryLabel: 'Administration & Security',
    iconName: 'Database',
  },
  {
    id: 'audit_log',
    name: 'Security Audit Trail',
    shortLabel: 'Audit Log',
    description: 'Immutable security log of voids, price overrides, supervisor PIN approvals & logins',
    category: 'admin',
    categoryLabel: 'Administration & Security',
    iconName: 'ShieldAlert',
  },
  {
    id: 'p2p_mesh',
    name: 'P2P WiFi Mesh Connections',
    shortLabel: 'WiFi Mesh',
    description: 'Direct device-to-device terminal synchronisation without internet connectivity',
    category: 'admin',
    categoryLabel: 'Administration & Security',
    iconName: 'Wifi',
  },
  {
    id: 'branch_setup',
    name: 'Multi-Branch & Store Management',
    shortLabel: 'Branches',
    description: 'Branch registers, warehouse stores, physical locations and multi-outlet routing',
    category: 'admin',
    categoryLabel: 'Administration & Security',
    iconName: 'Building',
    isOwnerAdminOnly: true,
  },
];

export interface RoleDefinition {
  roleId: string;
  roleName: string;
  description: string;
  allowedModules: ActiveTab[];
  primaryModules: ActiveTab[]; // Sorted in order of importance (#1 = highest)
  defaultLandingModule: ActiveTab;
  isSystem: boolean;
}

const STORAGE_KEY_ROLE_CONFIGS = 'saimetric_role_configs_v1';

// Default system roles matching user requirements exactly
export const DEFAULT_ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  CASHIER: {
    roleId: 'CASHIER',
    roleName: 'Cashier',
    description: 'Frontline sales, till drawer operations, customer accounts & direct deliveries',
    // Cashier primary functions requested: POS register first, cash balancing drawer, change, credit, customers, direct delivery receiving voucher
    primaryModules: [
      'pos',
      'cash_balancing',
      'change_report',
      'credit_report',
      'customers',
      'direct_grv',
    ],
    allowedModules: [
      'pos',
      'counter',
      'home',
      'today',
      'cash_balancing',
      'multi_currency',
      'cash_count',
      'change_report',
      'credit_report',
      'customers',
      'direct_grv',
      'sales',
    ],
    defaultLandingModule: 'pos',
    isSystem: true,
  },

  STOCK_CLERK: {
    roleId: 'STOCK_CLERK',
    roleName: 'Stock Controller / Clerk',
    description: 'Inventory master, case breaking, supplier receiving, stocktake & movements',
    // Stock controller primary module is inventory master and may not have access to other functions
    primaryModules: [
      'inventory',
      'goods_received',
      'direct_grv',
      'stock_movement',
      'stocktake',
      'suppliers',
    ],
    allowedModules: [
      'inventory',
      'fifo_reports',
      'goods_received',
      'direct_grv',
      'stock_movement',
      'stocktake',
      'suppliers',
      'grn_daily_report',
    ],
    defaultLandingModule: 'inventory',
    isSystem: true,
  },

  SUPERVISOR: {
    roleId: 'SUPERVISOR',
    roleName: 'Supervisor',
    description: 'Check sales, check stock, verify cashier drawer balancing & authorize deliveries',
    // Supervisor primary role is to see sales, check stock, check whether cashiers are balancing
    primaryModules: [
      'sales',
      'cash_balancing',
      'inventory',
      'direct_grv',
      'reports',
      'audit_log',
    ],
    allowedModules: [
      'sales',
      'cash_balancing',
      'multi_currency',
      'reconciliation',
      'inventory',
      'fifo_reports',
      'direct_grv',
      'goods_received',
      'today',
      'cash_count',
      'cash_log',
      'customers',
      'suppliers',
      'reports',
      'change_report',
      'credit_report',
      'audit_log',
      'stocktake',
      'stock_movement',
      'grn_daily_report',
    ],
    defaultLandingModule: 'sales',
    isSystem: true,
  },

  MANAGER: {
    roleId: 'MANAGER',
    roleName: 'Store Manager',
    description: 'Full store operations, sales performance, cash balancing, inventory & staff management',
    primaryModules: [
      'dashboard',
      'sales',
      'cash_balancing',
      'inventory',
      'reports',
      'staff_access',
    ],
    allowedModules: [
      'dashboard',
      'sales',
      'cash_balancing',
      'multi_currency',
      'reconciliation',
      'inventory',
      'fifo_reports',
      'goods_received',
      'direct_grv',
      'stock_movement',
      'stocktake',
      'pos',
      'counter',
      'today',
      'customers',
      'suppliers',
      'reports',
      'change_report',
      'credit_report',
      'grn_daily_report',
      'staff_access',
      'cash_count',
      'cash_log',
      'audit_log',
      'data_management',
      'p2p_mesh',
    ],
    defaultLandingModule: 'dashboard',
    isSystem: true,
  },

  ADMIN: {
    roleId: 'ADMIN',
    roleName: 'Admin / Company Owner',
    description: 'Comprehensive business governance, multi-branch, security, reports & system administration',
    primaryModules: [
      'dashboard',
      'pos',
      'cash_balancing',
      'inventory',
      'reports',
      'staff_access',
    ],
    allowedModules: ALL_SYSTEM_MODULES.map((m) => m.id),
    defaultLandingModule: 'dashboard',
    isSystem: true,
  },
};

// Aliases for compatibility with legacy role strings
const ROLE_ALIASES: Record<string, string> = {
  STAFF: 'CASHIER',
  CLERK: 'STOCK_CLERK',
  STOCK_CONTROLLER: 'STOCK_CLERK',
  BRANCH_MANAGER: 'MANAGER',
  OWNER: 'ADMIN',
  SUPER_ADMIN: 'ADMIN',
  SUPER_ADMINISTRATOR: 'ADMIN',
};

export const normalizeRoleId = (rawRole: string | undefined): string => {
  if (!rawRole) return 'CASHIER';
  const upper = rawRole.toUpperCase().replace(/\s+/g, '_');
  return ROLE_ALIASES[upper] || upper;
};

// --- Storage & Service Methods ---

export const getStoredRoleDefinitions = (): Record<string, RoleDefinition> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ROLE_CONFIGS);
    if (!raw) {
      return { ...DEFAULT_ROLE_DEFINITIONS };
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_ROLE_DEFINITIONS,
      ...parsed,
    };
  } catch (err) {
    console.error('Failed to parse role configs from storage', err);
    return { ...DEFAULT_ROLE_DEFINITIONS };
  }
};

export const saveRoleDefinition = (roleDef: RoleDefinition): void => {
  const all = getStoredRoleDefinitions();
  all[roleDef.roleId] = {
    ...roleDef,
  };
  localStorage.setItem(STORAGE_KEY_ROLE_CONFIGS, JSON.stringify(all));
};

export const deleteCustomRole = (roleId: string): boolean => {
  const all = getStoredRoleDefinitions();
  if (DEFAULT_ROLE_DEFINITIONS[roleId]) {
    return false; // Cannot delete core system role
  }
  delete all[roleId];
  localStorage.setItem(STORAGE_KEY_ROLE_CONFIGS, JSON.stringify(all));
  return true;
};

export const resetRolesToDefault = (): void => {
  localStorage.removeItem(STORAGE_KEY_ROLE_CONFIGS);
};

export const getRoleDefinitionForUser = (user: Salesperson | null): RoleDefinition => {
  if (!user) {
    return DEFAULT_ROLE_DEFINITIONS.CASHIER;
  }
  const normId = normalizeRoleId(user.role);
  const all = getStoredRoleDefinitions();
  return (
    all[normId] ||
    all[user.role] ||
    DEFAULT_ROLE_DEFINITIONS[normId] ||
    DEFAULT_ROLE_DEFINITIONS.CASHIER
  );
};

export const getLandingTabForUser = (user: Salesperson | null): ActiveTab => {
  if (!user) return 'home';
  const roleDef = getRoleDefinitionForUser(user);
  return roleDef.defaultLandingModule || roleDef.primaryModules[0] || 'pos';
};

export const isModuleAllowedForUser = (
  user: Salesperson | null,
  tab: ActiveTab
): boolean => {
  if (!user) return false;
  // Super Admin / Owner has access to everything
  const normRole = (user.role || '').toUpperCase();
  if (
    normRole === 'SUPER_ADMIN' ||
    normRole === 'OWNER' ||
    normRole === 'ADMIN' ||
    user.email?.toLowerCase() === 'andrekudakwashe@gmail.com'
  ) {
    return true;
  }

  // Home / more / common utility tabs are always accessible
  if (tab === 'home' || tab === 'more') return true;

  const roleDef = getRoleDefinitionForUser(user);
  if (!roleDef.allowedModules || roleDef.allowedModules.length === 0) {
    return true;
  }

  // Check direct match
  if (roleDef.allowedModules.includes(tab)) {
    return true;
  }

  // Also handle alias tabs (e.g. 'pos' <-> 'counter')
  if (tab === 'counter' && roleDef.allowedModules.includes('pos')) return true;
  if (tab === 'pos' && roleDef.allowedModules.includes('counter')) return true;
  if (tab === 'reconciliation' && roleDef.allowedModules.includes('cash_balancing')) return true;
  if (tab === 'cash_balancing' && roleDef.allowedModules.includes('reconciliation')) return true;

  return false;
};

export const getModuleIcon = (iconName: string): React.ComponentType<{ className?: string }> => {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    ShoppingBag,
    Sparkles,
    Receipt,
    Scale,
    DollarSign,
    History,
    Users,
    Coins,
    CreditCard,
    Package,
    Layers,
    ArrowUpDown,
    ClipboardList,
    Truck,
    Boxes,
    Briefcase,
    TrendingUp,
    CheckCircle,
    BarChart3,
    FileSpreadsheet,
    Sliders,
    Shield,
    Database,
    ShieldAlert,
    Wifi,
    Building,
  };
  return map[iconName] || LayoutGrid;
};

export const getUserPrimaryModules = (user: Salesperson | null): SystemModuleInfo[] => {
  if (!user) return [];
  const roleDef = getRoleDefinitionForUser(user);
  const moduleMap = new Map<ActiveTab, SystemModuleInfo>();
  ALL_SYSTEM_MODULES.forEach((m) => moduleMap.set(m.id, m));

  const list: SystemModuleInfo[] = [];
  roleDef.primaryModules.forEach((modId) => {
    const mod = moduleMap.get(modId);
    if (mod) list.push(mod);
  });
  return list;
};

export const getUserAccessibleModulesGrouped = (
  user: Salesperson | null
): Record<CoreFunctionCategory, SystemModuleInfo[]> => {
  const groups: Record<CoreFunctionCategory, SystemModuleInfo[]> = {
    pos: [],
    cash: [],
    customers: [],
    inventory: [],
    receiving: [],
    sales: [],
    reports: [],
    admin: [],
  };

  ALL_SYSTEM_MODULES.forEach((mod) => {
    if (isModuleAllowedForUser(user, mod.id)) {
      groups[mod.category].push(mod);
    }
  });

  return groups;
};
