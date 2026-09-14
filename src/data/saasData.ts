import { Role } from '../types';

export interface PermissionRule {
  id: string;
  role: string; // 'ADMIN' | 'SUPERVISOR' | 'CASHIER' | 'OWNER'
  module: string;
  action: string;
  allowed: boolean;
  label: string;
  section: string;
  restricted: boolean;
}

export interface Company {
  company_id: string;
  company_name: string;
  owner_name?: string;
  owner_email: string;
  phone?: string;
  business_category?: string;
  sheet_folder_id: string;
  sheet_id?: string; // Dedicated Google Sheet File ID for this Tenant (Option A)
  webhook_url?: string; // Dedicated Webhook URL for this Tenant
  branch_isolation_mode?: 'ROW_LEVEL' | 'BRANCH_TABS' | 'HYBRID';
  trial_start_date: string;
  subscription_status: 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'CANCELLED';
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  package_id?: string;
  next_billing_date: string;
  payment_confirmed_at?: string;
  payment_confirmed_by?: string;
  offline_activation_code?: string;
  trial_days_remaining?: number;
  notes?: string;
}

export interface SaaSBranch {
  branch_id: string;
  company_id: string;
  branch_name: string;
  branch_code: string;
  address: string;
  sheet_id: string;
  tab_prefix?: string;
  manager_user_id: string;
  is_active: boolean;
}

export interface SaaSUser {
  user_id: string;
  company_id: string;
  branch_id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'CASHIER';
  pin: string;
  is_active: boolean;
  phone?: string;
}

// 52 Master Permission Rows for Multi-Tenant POS SaaS System
export const MASTER_PERMISSIONS_52: PermissionRule[] = [
  // ----------------------------------------------------
  // SECTION: Direct Supplier Deliveries (V4.2 Direct GRV)
  // ----------------------------------------------------
  { id: 'p1', role: 'CASHIER', module: 'direct_grv', action: 'create', allowed: true, label: 'Create Direct GRV', section: 'Direct Supplier Deliveries', restricted: false },
  { id: 'p2', role: 'SUPERVISOR', module: 'direct_grv', action: 'approve', allowed: true, label: 'Approve Direct GRV', section: 'Direct Supplier Deliveries', restricted: true },
  { id: 'p3', role: 'CASHIER', module: 'direct_grv', action: 'view_cost_only', allowed: true, label: 'View GRV Cost Only', section: 'Direct Supplier Deliveries', restricted: false },
  { id: 'p4', role: 'CASHIER', module: 'direct_grv', action: 'edit_cost', allowed: true, label: 'Edit Cost Price in GRV', section: 'Direct Supplier Deliveries', restricted: false },
  { id: 'p5', role: 'CASHIER', module: 'direct_grv', action: 'edit_price', allowed: false, label: 'Set Selling Price in GRV', section: 'Direct Supplier Deliveries', restricted: true },
  { id: 'p6', role: 'SUPERVISOR', module: 'direct_grv', action: 'edit_price', allowed: true, label: 'Set Selling Price in GRV', section: 'Direct Supplier Deliveries', restricted: true },
  { id: 'p7', role: 'CASHIER', module: 'direct_grv', action: 'till_payout', allowed: true, label: 'Contribute Till Cash to GRV', section: 'Direct Supplier Deliveries', restricted: false },
  { id: 'p8', role: 'SUPERVISOR', module: 'direct_grv', action: 'reject', allowed: true, label: 'Reject Direct Delivery Voucher', section: 'Direct Supplier Deliveries', restricted: true },
  { id: 'p9', role: 'ADMIN', module: 'direct_grv', action: 'all', allowed: true, label: 'Full Direct GRV Administration', section: 'Direct Supplier Deliveries', restricted: true },

  // ----------------------------------------------------
  // SECTION: Customer Ledger & Credit
  // ----------------------------------------------------
  { id: 'p10', role: 'CASHIER', module: 'customer', action: 'change_use', allowed: true, label: 'Use Customer Change', section: 'Customer Ledger', restricted: false },
  { id: 'p11', role: 'CASHIER', module: 'customer', action: 'credit_issue', allowed: true, label: 'Issue Customer Credit', section: 'Customer Ledger', restricted: false },
  { id: 'p12', role: 'SUPERVISOR', module: 'customer', action: 'change_view', allowed: true, label: 'View Customer Change & Credit', section: 'Customer Ledger', restricted: true },
  { id: 'p13', role: 'CASHIER', module: 'customer', action: 'credit_repay', allowed: true, label: 'Record Customer Repayments', section: 'Customer Ledger', restricted: false },
  { id: 'p14', role: 'CASHIER', module: 'customer', action: 'add_customer', allowed: true, label: 'Register New Customer', section: 'Customer Ledger', restricted: false },
  { id: 'p15', role: 'SUPERVISOR', module: 'customer', action: 'credit_limit_override', allowed: true, label: 'Override Debt Credit Limit', section: 'Customer Ledger', restricted: true },

  // ----------------------------------------------------
  // SECTION: End Of Shift (EOD & Cash Balancing)
  // ----------------------------------------------------
  { id: 'p16', role: 'CASHIER', module: 'eod', action: 'submit', allowed: true, label: 'Submit EOD', section: 'End Of Shift', restricted: false },
  { id: 'p17', role: 'SUPERVISOR', module: 'eod', action: 'approve', allowed: true, label: 'Approve EOD', section: 'End Of Shift', restricted: true },
  { id: 'p18', role: 'SUPERVISOR', module: 'eod', action: 'view_variance', allowed: true, label: 'View Variance Investigation', section: 'End Of Shift', restricted: true },
  { id: 'p19', role: 'CASHIER', module: 'eod', action: 'cash_count', allowed: true, label: 'Enter Drawer Cash Count', section: 'End Of Shift', restricted: false },
  { id: 'p20', role: 'CASHIER', module: 'eod', action: 'cash_log', allowed: true, label: 'Record Cash In/Out Log', section: 'End Of Shift', restricted: false },
  { id: 'p21', role: 'SUPERVISOR', module: 'eod', action: 'lock_day', allowed: true, label: 'Lock Day Reconciliations', section: 'End Of Shift', restricted: true },

  // ----------------------------------------------------
  // SECTION: Audit & Security
  // ----------------------------------------------------
  { id: 'p22', role: 'SUPERVISOR', module: 'audit', action: 'view', allowed: true, label: 'View Audit Log', section: 'Audit & Security', restricted: true },
  { id: 'p23', role: 'SUPERVISOR', module: 'security', action: 'pin_override', allowed: true, label: 'PIN Override', section: 'Audit & Security', restricted: true },
  { id: 'p24', role: 'ADMIN', module: 'audit', action: 'export', allowed: true, label: 'Export Forensic Audit Trail', section: 'Audit & Security', restricted: true },
  { id: 'p25', role: 'CASHIER', module: 'audit', action: 'view', allowed: false, label: 'View Audit Log', section: 'Audit & Security', restricted: true },

  // ----------------------------------------------------
  // SECTION: POS Register & Cart Operations
  // ----------------------------------------------------
  { id: 'p26', role: 'ADMIN', module: 'products', action: 'edit', allowed: true, label: 'Edit Products', section: 'Inventory', restricted: false },
  { id: 'p27', role: 'CASHIER', module: 'cart', action: 'delete_item', allowed: false, label: 'Delete Cart Items', section: 'POS', restricted: false },
  { id: 'p28', role: 'SUPERVISOR', module: 'cart', action: 'delete_item', allowed: true, label: 'Delete Cart Items', section: 'POS', restricted: false },
  { id: 'p29', role: 'CASHIER', module: 'cart', action: 'clear_cart', allowed: false, label: 'Clear Entire Cart', section: 'POS', restricted: false },
  { id: 'p30', role: 'SUPERVISOR', module: 'cart', action: 'clear_cart', allowed: true, label: 'Clear Entire Cart', section: 'POS', restricted: false },
  { id: 'p31', role: 'CASHIER', module: 'cart', action: 'edit_price', allowed: false, label: 'Edit Cart Unit Selling Price', section: 'POS', restricted: true },
  { id: 'p32', role: 'SUPERVISOR', module: 'cart', action: 'edit_price', allowed: true, label: 'Edit Cart Unit Selling Price', section: 'POS', restricted: true },
  { id: 'p33', role: 'CASHIER', module: 'cart', action: 'apply_discount', allowed: false, label: 'Apply Custom Discounts', section: 'POS', restricted: true },
  { id: 'p34', role: 'SUPERVISOR', module: 'cart', action: 'apply_discount', allowed: true, label: 'Apply Custom Discounts', section: 'POS', restricted: true },
  { id: 'p35', role: 'CASHIER', module: 'cart', action: 'void_sale', allowed: false, label: 'Void Completed Transaction', section: 'POS', restricted: true },
  { id: 'p36', role: 'SUPERVISOR', module: 'cart', action: 'void_sale', allowed: true, label: 'Void Completed Transaction', section: 'POS', restricted: true },
  { id: 'p37', role: 'CASHIER', module: 'cart', action: 'negative_stock', allowed: false, label: 'Sell Out of Stock / Negative', section: 'POS', restricted: true },
  { id: 'p38', role: 'SUPERVISOR', module: 'cart', action: 'negative_stock', allowed: true, label: 'Sell Out of Stock / Negative', section: 'POS', restricted: true },

  // ----------------------------------------------------
  // SECTION: Inventory & Warehouse Master
  // ----------------------------------------------------
  { id: 'p39', role: 'CASHIER', module: 'inventory', action: 'view', allowed: true, label: 'Browse Inventory Catalog', section: 'Inventory', restricted: false },
  { id: 'p40', role: 'CASHIER', module: 'inventory', action: 'add_product', allowed: false, label: 'Add New Master Product', section: 'Inventory', restricted: true },
  { id: 'p41', role: 'SUPERVISOR', module: 'inventory', action: 'add_product', allowed: true, label: 'Add New Master Product', section: 'Inventory', restricted: true },
  { id: 'p42', role: 'CASHIER', module: 'inventory', action: 'break_cases', allowed: true, label: 'Break Bulk Cases to Singles', section: 'Inventory', restricted: false },
  { id: 'p43', role: 'CASHIER', module: 'inventory', action: 'stocktake_count', allowed: true, label: 'Count Stocktake Lines', section: 'Inventory', restricted: false },
  { id: 'p44', role: 'SUPERVISOR', module: 'inventory', action: 'stocktake_reconcile', allowed: true, label: 'Approve Stock Variance Adjustments', section: 'Inventory', restricted: true },

  // ----------------------------------------------------
  // SECTION: Multi-Branch & Staff Administration
  // ----------------------------------------------------
  { id: 'p45', role: 'CASHIER', module: 'branches', action: 'switch', allowed: false, label: 'Switch Active Branch', section: 'Multi-Branch & Staff', restricted: true },
  { id: 'p46', role: 'SUPERVISOR', module: 'branches', action: 'switch', allowed: false, label: 'Switch Active Branch', section: 'Multi-Branch & Staff', restricted: true },
  { id: 'p47', role: 'ADMIN', module: 'branches', action: 'switch', allowed: true, label: 'Switch Active Branch', section: 'Multi-Branch & Staff', restricted: true },
  { id: 'p48', role: 'SUPERVISOR', module: 'staff', action: 'view', allowed: true, label: 'View Branch Staff Members', section: 'Multi-Branch & Staff', restricted: false },
  { id: 'p49', role: 'ADMIN', module: 'staff', action: 'manage', allowed: true, label: 'Manage Staff & Branch Assignments', section: 'Multi-Branch & Staff', restricted: true },
  { id: 'p50', role: 'ADMIN', module: 'staff', action: 'permissions', allowed: true, label: 'Configure Granular Permissions', section: 'Multi-Branch & Staff', restricted: true },

  // ----------------------------------------------------
  // SECTION: Financial Reports & Analytics
  // ----------------------------------------------------
  { id: 'p51', role: 'CASHIER', module: 'reports', action: 'profit_margin', allowed: false, label: 'View Gross Margin & Profit Reports', section: 'Financial Reports', restricted: true },
  { id: 'p52', role: 'SUPERVISOR', module: 'reports', action: 'profit_margin', allowed: true, label: 'View Gross Margin & Profit Reports', section: 'Financial Reports', restricted: true },
];

// Seed Company
export const SEED_COMPANIES: Company[] = [
  {
    company_id: 'COMP-001',
    company_name: 'Saimetric Demo',
    owner_email: 'owner@demo.com',
    sheet_folder_id: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    sheet_id: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE', // Option A: Dedicated Google Sheet for COMP-001
    webhook_url: '',
    branch_isolation_mode: 'ROW_LEVEL',
    trial_start_date: '2026-08-01',
    subscription_status: 'ACTIVE',
    plan: 'ENTERPRISE',
    next_billing_date: '2027-08-01',
  },
  {
    company_id: 'COMP-002',
    company_name: 'Metro Supermarkets Bulawayo',
    owner_name: 'Metro General Manager',
    owner_email: 'metro_owner@customer.com',
    phone: '+263 77 999 8888',
    business_category: 'Wholesale & Retail',
    sheet_folder_id: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    sheet_id: '', // Unlinked by default until real Google Sheet is linked or created from template
    webhook_url: '',
    branch_isolation_mode: 'ROW_LEVEL',
    trial_start_date: '2026-08-15',
    subscription_status: 'ACTIVE',
    plan: 'PROFESSIONAL',
    next_billing_date: '2027-08-15',
  },
];

// Seed Branches
export const SEED_BRANCHES: SaaSBranch[] = [
  {
    branch_id: 'BR-MAIN',
    company_id: 'COMP-001',
    branch_name: 'Harare Main',
    branch_code: 'HQ-01',
    address: '4th Street Commercial Center, Harare',
    sheet_id: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    tab_prefix: 'BR-MAIN',
    manager_user_id: 'USR-002',
    is_active: true,
  },
  {
    branch_id: 'BR-002',
    company_id: 'COMP-001',
    branch_name: 'Westside Supermarket Branch',
    branch_code: 'BR-02',
    address: 'Westgate Shopping Complex, Harare',
    sheet_id: '1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE',
    tab_prefix: 'BR-002',
    manager_user_id: 'USR-002',
    is_active: true,
  },
  {
    branch_id: 'BR-METRO-01',
    company_id: 'COMP-002',
    branch_name: 'Bulawayo Branch',
    branch_code: 'BUL-01',
    address: '8th Avenue Market, Bulawayo',
    sheet_id: '1Metro_Bulawayo_Tenant_Sheet_COMP002_Dedicated',
    tab_prefix: 'BR-METRO-01',
    manager_user_id: 'USR-METRO-01',
    is_active: true,
  },
];

// Seed Users per Section 5 specifications:
// owner@demo.com / Pass123 / OWNER / Harare
// supervisor@demo.com / Pass123 / SUPERVISOR / Harare
// cashier@demo.com / Pass123 / CASHIER / Harare
export const SEED_USERS: SaaSUser[] = [
  {
    user_id: 'USR-001',
    company_id: 'COMP-001',
    branch_id: 'BR-MAIN',
    full_name: 'Andre Kudakwashe',
    email: 'owner@demo.com',
    password_hash: 'Pass123',
    role: 'OWNER',
    pin: '1234',
    is_active: true,
    phone: '+263 77 123 4567',
  },
  {
    user_id: 'USR-002',
    company_id: 'COMP-001',
    branch_id: 'BR-MAIN',
    full_name: 'Supervisor Harare',
    email: 'supervisor@demo.com',
    password_hash: 'Pass123',
    role: 'SUPERVISOR',
    pin: '4321',
    is_active: true,
    phone: '+263 71 987 6543',
  },
  {
    user_id: 'USR-003',
    company_id: 'COMP-001',
    branch_id: 'BR-MAIN',
    full_name: 'Tariro Moyo',
    email: 'cashier@demo.com',
    password_hash: 'Pass123',
    role: 'CASHIER',
    pin: '0000',
    is_active: true,
    phone: '+263 73 555 1212',
  },
  {
    user_id: 'USR-METRO-01',
    company_id: 'COMP-002',
    branch_id: 'BR-METRO-01',
    full_name: 'Metro General Manager',
    email: 'metro_owner@customer.com',
    password_hash: 'Pass123',
    role: 'OWNER',
    pin: '9999',
    is_active: true,
    phone: '+263 77 999 8888',
  },
];
