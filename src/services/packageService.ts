import { Company } from '../data/saasData';
import { getCurrentCompany, getCompanies, saveCompany } from '../db/roomDatabase';

export type AppFunctionCategory =
  | 'pos'
  | 'inventory'
  | 'purchasing'
  | 'customers'
  | 'cash_balancing'
  | 'multi_branch'
  | 'reports'
  | 'security_system';

export interface AppFunctionDefinition {
  id: string;
  name: string;
  category: AppFunctionCategory;
  categoryLabel: string;
  description: string;
  defaultStarter: boolean;
  defaultPro: boolean;
  defaultEnterprise: boolean;
}

export interface SaaSPackage {
  id: string;
  name: string;
  code: string;
  tier: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM';
  description: string;
  priceMonthly: number;
  priceAnnual: number;
  currency: string;
  maxBranches: number; // e.g. 1, 3, 999 (unlimited)
  maxStaff: number; // e.g. 2, 10, 999 (unlimited)
  isDefault: boolean;
  isActive: boolean;
  features: Record<string, boolean>; // functionId -> boolean
  createdAt: string;
  updatedAt: string;
}

// 45 Granular Application Functions across 8 System Modules
export const ALL_APP_FUNCTIONS: AppFunctionDefinition[] = [
  // 1. Point of Sale (POS)
  {
    id: 'pos_register',
    name: 'POS Register & Item Scanning',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Core POS checkout terminal with barcode scanner and item grid.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_discounts',
    name: 'Discounts (Line Item & Cart)',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Apply percentage or fixed dollar discounts to individual items or total cart.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_price_override',
    name: 'Register Price Overrides',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Authorized price editing directly on the POS checkout screen.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_hold_park_sales',
    name: 'Hold & Park Open Orders',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Temporarily park transactions to serve next queue customer and resume anytime.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_clear_cart',
    name: 'Void Active Cart',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Quick-clear and cancel all items currently loaded in the active checkout basket.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_delete_item',
    name: 'Delete Item from Cart',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Remove single mistaken line items from the current active sale order.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_weighed_items',
    name: 'Fractional & Weight-Scale Barcodes',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Support fractional decimal quantities (kg, grams, liters) and weight-embedded barcodes.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_customer_change',
    name: 'Customer Change to Digital Account',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Deposit customer change shortage into customer digital wallet credit.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_credit_sales',
    name: 'Debtor Credit Sales',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Checkout sales on customer credit account within credit limits.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'pos_thermal_receipt',
    name: 'Thermal Receipt Printing',
    category: 'pos',
    categoryLabel: 'Point of Sale',
    description: 'Print 58mm / 80mm sales slips via Bluetooth ESC/POS or USB receipt printers.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },

  // 2. Inventory & Stock Management
  {
    id: 'inv_product_catalog',
    name: 'Product Catalog & Pricing',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Create products, barcodes, categories, cost prices, and standard selling prices.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'inv_batch_expiry',
    name: 'Batch Tracking & Expiry Dates',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Track perishable products by batch/lot numbers and receive expiry warning alerts.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'inv_packaging_ratios',
    name: 'Packaging Ratios & Case Break',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Define bulk packaging ratios (e.g. 24 cans per case) and break cases automatically.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'inv_stock_adjustments',
    name: 'Stock Count Variance Adjustments',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Record stocktake counts, inventory shrinkage, breakages, and variance adjustments.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'inv_stock_movements',
    name: 'Inter-Branch Stock Transfers',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Dispatch and receive stock transfers between multiple warehouse/store locations.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'inv_direct_grv',
    name: 'Direct Goods Received (GRV)',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Fast direct intake of stock from delivery trucks with cost price capture.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'inv_grv_approvals',
    name: 'Supervisor Approval for GRV',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Enforce multi-step supervisor sign-off before received stock enters inventory.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'inv_stock_valuation',
    name: 'Real-time FIFO Stock Valuation',
    category: 'inventory',
    categoryLabel: 'Inventory & Warehousing',
    description: 'Live valuation of on-hand inventory based on historical purchase batch costs.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },

  // 3. Suppliers & Purchasing
  {
    id: 'supp_directory',
    name: 'Supplier Directory & Contacts',
    category: 'purchasing',
    categoryLabel: 'Suppliers & Purchasing',
    description: 'Maintain list of authorized vendors, credit terms, and sales rep contact numbers.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'supp_purchase_orders',
    name: 'Purchase Order (PO) Management',
    category: 'purchasing',
    categoryLabel: 'Suppliers & Purchasing',
    description: 'Generate, print, and track purchase orders against received delivery notes.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'supp_credit_tracking',
    name: 'Supplier Payables & Credit Ledger',
    category: 'purchasing',
    categoryLabel: 'Suppliers & Purchasing',
    description: 'Track outstanding invoice payments owed to distributors and suppliers.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },

  // 4. Customers & CRM
  {
    id: 'crm_directory',
    name: 'Customer Directory & Profiles',
    category: 'customers',
    categoryLabel: 'Customers & CRM',
    description: 'Register customer profiles with contact numbers, addresses, and purchase histories.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'crm_credit_accounts',
    name: 'Debtor Credit Accounts & Limits',
    category: 'customers',
    categoryLabel: 'Customers & CRM',
    description: 'Assign maximum credit lines, track unpaid balances, and enforce overdue stop orders.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'crm_change_ledger',
    name: 'Digital Change Wallet Redemption',
    category: 'customers',
    categoryLabel: 'Customers & CRM',
    description: 'Allow customers to pay using their accumulated digital change balance.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'crm_loyalty_points',
    name: 'Loyalty Points & Rewards Program',
    category: 'customers',
    categoryLabel: 'Customers & CRM',
    description: 'Award shopper loyalty points per purchase and allow checkout redemption discounts.',
    defaultStarter: false,
    defaultPro: false,
    defaultEnterprise: true,
  },

  // 5. Cash Balancing & Forms 1-4
  {
    id: 'cash_form1_count',
    name: 'Form 1: Physical Cash Count',
    category: 'cash_balancing',
    categoryLabel: 'Cash Balancing & Shift Close',
    description: 'Denomination-by-denomination till count breakdown for shift changeovers.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'cash_form2_log',
    name: 'Form 2: Cash In / Out Petty Cash Log',
    category: 'cash_balancing',
    categoryLabel: 'Cash Balancing & Shift Close',
    description: 'Log petty cash payouts, supplier till payments, and float replenishments.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'cash_form3_sales',
    name: 'Form 3: Sales Verification Entry',
    category: 'cash_balancing',
    categoryLabel: 'Cash Balancing & Shift Close',
    description: 'Record daily shift sales totals and verify against physical receipt roll z-reports.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'cash_form4_recon',
    name: 'Form 4: Day-End Balancing & Variance Lock',
    category: 'cash_balancing',
    categoryLabel: 'Cash Balancing & Shift Close',
    description: 'Final mathematical reconciliation of drawer cash, card totals, and variance sign-off.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'cash_expense_tracking',
    name: 'Operating Expense Tracking',
    category: 'cash_balancing',
    categoryLabel: 'Cash Balancing & Shift Close',
    description: 'Record store overhead expenses (electricity tokens, transport, cleaning supplies).',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },

  // 6. Multi-Branch & Distributed Operations
  {
    id: 'branch_multi_setup',
    name: 'Multi-Branch Store Setup',
    category: 'multi_branch',
    categoryLabel: 'Multi-Branch & Distributed Stores',
    description: 'Configure and operate independent branch store partitions under one business.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'branch_switching',
    name: 'Instant Branch Terminal Switcher',
    category: 'multi_branch',
    categoryLabel: 'Multi-Branch & Distributed Stores',
    description: 'Seamlessly switch active branch context with strict transaction attribution.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'branch_team_delegation',
    name: 'Branch-Specific Role Delegation',
    category: 'multi_branch',
    categoryLabel: 'Multi-Branch & Distributed Stores',
    description: 'Designate staff with distinct roles per branch (e.g. Manager in Branch A, Cashier in Branch B).',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'branch_p2p_mesh',
    name: 'Offline P2P WiFi Mesh Synchronization',
    category: 'multi_branch',
    categoryLabel: 'Multi-Branch & Distributed Stores',
    description: 'Serverless epidemic synchronization between local store tablets and terminals without internet.',
    defaultStarter: false,
    defaultPro: false,
    defaultEnterprise: true,
  },

  // 7. Analytics & Reporting
  {
    id: 'rep_daily_sales',
    name: 'Daily Sales & Shift Reports',
    category: 'reports',
    categoryLabel: 'Analytics & Reporting',
    description: 'View real-time gross revenue, tender breakdowns, cashier sales, and hourly graphs.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'rep_product_sales',
    name: 'Top Products & Margin Reports',
    category: 'reports',
    categoryLabel: 'Analytics & Reporting',
    description: 'Best-selling item rankings, profit margins, and slow-moving inventory alerts.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'rep_debtor_aging',
    name: 'Customer Debtor Aging Report',
    category: 'reports',
    categoryLabel: 'Analytics & Reporting',
    description: '30, 60, and 90+ day debtor credit aging breakdown for overdue account follow-ups.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'rep_change_audit',
    name: 'Customer Change Audit Report',
    category: 'reports',
    categoryLabel: 'Analytics & Reporting',
    description: 'Audit log of all issued customer change deposits and redemptions.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'rep_stock_audit',
    name: 'Stock Movement & Shrink Audit',
    category: 'reports',
    categoryLabel: 'Analytics & Reporting',
    description: 'Comprehensive audit trail of stock adjustments, write-offs, and transfers.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'rep_grv_history',
    name: 'Historical Goods Received Vouchers',
    category: 'reports',
    categoryLabel: 'Analytics & Reporting',
    description: 'Searchable ledger of all historical supplier deliveries and supplier invoices.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'rep_export_csv',
    name: 'Export to Excel / CSV',
    category: 'reports',
    categoryLabel: 'Analytics & Reporting',
    description: 'Download sales logs, products, customers, and reconciliations to CSV files.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },

  // 8. Security & System Administration
  {
    id: 'sys_staff_management',
    name: 'Staff Management & 4-Digit PINs',
    category: 'security_system',
    categoryLabel: 'System & Security',
    description: 'Manage staff profiles, role assignment, and fast numeric security PINs.',
    defaultStarter: true,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'sys_granular_rbac',
    name: '52 Granular Permissions Matrix',
    category: 'security_system',
    categoryLabel: 'System & Security',
    description: 'Action-level role-based access control customization per staff member.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'sys_audit_logs',
    name: 'Forensic System Audit Trail',
    category: 'security_system',
    categoryLabel: 'System & Security',
    description: 'Tamper-evident logs of price changes, refunds, voids, and cashier logins.',
    defaultStarter: false,
    defaultPro: true,
    defaultEnterprise: true,
  },
  {
    id: 'sys_offline_airgap',
    name: 'Offline Air-Gapped License Activation',
    category: 'security_system',
    categoryLabel: 'System & Security',
    description: 'Generate and validate offline cryptographic keys for remote un-networked stores.',
    defaultStarter: false,
    defaultPro: false,
    defaultEnterprise: true,
  },
];

// Seed feature sets for Default Tiers
function buildFeatureSet(tier: 'starter' | 'pro' | 'enterprise'): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  ALL_APP_FUNCTIONS.forEach((fn) => {
    if (tier === 'starter') result[fn.id] = fn.defaultStarter;
    else if (tier === 'pro') result[fn.id] = fn.defaultPro;
    else result[fn.id] = fn.defaultEnterprise;
  });
  return result;
}

export const DEFAULT_PACKAGES: SaaSPackage[] = [
  {
    id: 'pkg_starter',
    name: 'Starter Retail POS',
    code: 'STARTER',
    tier: 'STARTER',
    description: 'Essential single-store POS for small kiosks, grocery shops, and retail counters.',
    priceMonthly: 15,
    priceAnnual: 150,
    currency: 'USD',
    maxBranches: 1,
    maxStaff: 2,
    isDefault: true,
    isActive: true,
    features: buildFeatureSet('starter'),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'pkg_professional',
    name: 'Professional Multi-Store',
    code: 'PROFESSIONAL',
    tier: 'PROFESSIONAL',
    description: 'Full-featured retail ERP with multi-branch, credit debtor accounts, and day-end balancing.',
    priceMonthly: 35,
    priceAnnual: 350,
    currency: 'USD',
    maxBranches: 3,
    maxStaff: 10,
    isDefault: false,
    isActive: true,
    features: buildFeatureSet('pro'),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'pkg_enterprise',
    name: 'Enterprise Chain & Warehouse',
    code: 'ENTERPRISE',
    tier: 'ENTERPRISE',
    description: 'Unlimited branches, P2P WiFi Mesh sync, FIFO valuations, and forensic audit controls.',
    priceMonthly: 75,
    priceAnnual: 750,
    currency: 'USD',
    maxBranches: 999,
    maxStaff: 999,
    isDefault: false,
    isActive: true,
    features: buildFeatureSet('enterprise'),
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

const PACKAGES_STORAGE_KEY = 'saas_packages_v1';

// Get all packages
export function getPackages(): SaaSPackage[] {
  try {
    const raw = localStorage.getItem(PACKAGES_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(PACKAGES_STORAGE_KEY, JSON.stringify(DEFAULT_PACKAGES));
      return DEFAULT_PACKAGES;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(PACKAGES_STORAGE_KEY, JSON.stringify(DEFAULT_PACKAGES));
      return DEFAULT_PACKAGES;
    }

    // Merge in any newly introduced application functions that might not be in saved storage
    const merged = parsed.map((pkg: SaaSPackage) => {
      const features = { ...(pkg.features || {}) };
      ALL_APP_FUNCTIONS.forEach((fn) => {
        if (features[fn.id] === undefined) {
          features[fn.id] =
            pkg.tier === 'STARTER'
              ? fn.defaultStarter
              : pkg.tier === 'PROFESSIONAL'
              ? fn.defaultPro
              : fn.defaultEnterprise;
        }
      });
      return { ...pkg, features };
    });

    return merged;
  } catch (err) {
    console.error('Failed to load SaaS packages from storage:', err);
    return DEFAULT_PACKAGES;
  }
}

// Save packages
export function savePackages(packages: SaaSPackage[]): void {
  try {
    localStorage.setItem(PACKAGES_STORAGE_KEY, JSON.stringify(packages));
    window.dispatchEvent(new CustomEvent('saas_packages_updated', { detail: packages }));
  } catch (err) {
    console.error('Failed to save SaaS packages:', err);
  }
}

// Get package by ID or code
export function getPackageById(packageIdOrCode: string): SaaSPackage | null {
  const all = getPackages();
  return (
    all.find(
      (p) =>
        p.id === packageIdOrCode ||
        p.code?.toUpperCase() === packageIdOrCode.toUpperCase() ||
        p.tier?.toUpperCase() === packageIdOrCode.toUpperCase()
    ) || null
  );
}

// Get default package for new signups
export function getDefaultPackage(): SaaSPackage {
  const all = getPackages();
  return all.find((p) => p.isDefault && p.isActive) || all[0] || DEFAULT_PACKAGES[0];
}

// Create new custom package
export function createPackage(data: Partial<SaaSPackage>): SaaSPackage {
  const all = getPackages();
  const newId = `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newPackage: SaaSPackage = {
    id: newId,
    name: data.name || 'Custom Package',
    code: (data.code || 'CUSTOM').toUpperCase(),
    tier: data.tier || 'CUSTOM',
    description: data.description || 'Custom tailored application package',
    priceMonthly: data.priceMonthly ?? 25,
    priceAnnual: data.priceAnnual ?? 250,
    currency: data.currency || 'USD',
    maxBranches: data.maxBranches ?? 1,
    maxStaff: data.maxStaff ?? 3,
    isDefault: false,
    isActive: true,
    features: data.features || buildFeatureSet('pro'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updated = [...all, newPackage];
  savePackages(updated);
  return newPackage;
}

// Update package
export function updatePackage(packageId: string, updates: Partial<SaaSPackage>): SaaSPackage | null {
  const all = getPackages();
  const index = all.findIndex((p) => p.id === packageId);
  if (index === -1) return null;

  const current = all[index];
  const updatedPkg: SaaSPackage = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // If set to default, unset other defaults
  if (updates.isDefault) {
    all.forEach((p) => {
      p.isDefault = p.id === packageId;
    });
  }

  all[index] = updatedPkg;
  savePackages(all);
  return updatedPkg;
}

// Delete package
export function deletePackage(packageId: string): boolean {
  const all = getPackages();
  // Don't delete standard 3 default tiers
  if (['pkg_starter', 'pkg_professional', 'pkg_enterprise'].includes(packageId)) {
    return false;
  }
  const filtered = all.filter((p) => p.id !== packageId);
  savePackages(filtered);
  return true;
}

// Reset packages to system factory defaults
export function resetPackagesToDefaults(): SaaSPackage[] {
  savePackages(DEFAULT_PACKAGES);
  return DEFAULT_PACKAGES;
}

// Get the effective package for a company/tenant
export function getCompanyPackage(companyOrId?: Company | string | null): SaaSPackage {
  let comp: Company | null = null;
  if (!companyOrId) {
    comp = getCurrentCompany();
  } else if (typeof companyOrId === 'string') {
    const list = getCompanies();
    comp = list.find((c) => c.company_id === companyOrId) || null;
  } else {
    comp = companyOrId;
  }

  const all = getPackages();

  if (comp) {
    // 1. Check direct package_id binding
    if ((comp as any).package_id) {
      const found = all.find((p) => p.id === (comp as any).package_id);
      if (found) return found;
    }

    // 2. Fall back to matching plan string ('STARTER', 'PROFESSIONAL', 'ENTERPRISE')
    if (comp.plan) {
      const match = all.find(
        (p) =>
          p.code?.toUpperCase() === comp!.plan?.toUpperCase() ||
          p.tier?.toUpperCase() === comp!.plan?.toUpperCase()
      );
      if (match) return match;
    }
  }

  return getDefaultPackage();
}

// Assign package to a company
export function assignCompanyPackage(companyId: string, packageId: string): boolean {
  const targetPackage = getPackageById(packageId);
  if (!targetPackage) return false;

  const companies = getCompanies();
  const comp = companies.find((c) => c.company_id === companyId);
  if (!comp) return false;

  const updated: Company = {
    ...comp,
    plan: targetPackage.tier === 'CUSTOM' ? 'PROFESSIONAL' : targetPackage.tier,
    ...( { package_id: targetPackage.id } as any ),
  };

  saveCompany(updated);
  return true;
}

// Check if a specific application function is enabled for a given company
export function isAppFunctionEnabled(functionId: string, companyOrId?: Company | string | null): boolean {
  const pkg = getCompanyPackage(companyOrId);
  if (!pkg || !pkg.features) return true;
  // If explicitly declared in package, return value. Otherwise default to true to prevent accidental lockout
  if (pkg.features[functionId] !== undefined) {
    return Boolean(pkg.features[functionId]);
  }
  return true;
}
