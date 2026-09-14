const fs = require('fs');
const path = require('path');

const dataFilePath = path.join(__dirname, '..', 'server-saas-data.json');
let saasData = { companies: [], branches: [], users: [] };
if (fs.existsSync(dataFilePath)) {
  try {
    saasData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
  } catch (e) {
    console.error('Error reading saas data:', e);
  }
}

const sheetCompanies = [
  {
    company_id: "COMP-MTVQGJN1",
    company_name: "Munhumutaba",
    owner_name: "Munhumutaba",
    owner_email: "munhu@gmail.com",
    phone: "0771234567",
    business_category: "Grocery & FMCG",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-09",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-23",
    offline_activation_code: "SAI-0W7WCR",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  },
  {
    company_id: "COMP-MTVJS6B8",
    company_name: "Aipac",
    owner_name: "Aipac Owner",
    owner_email: "andrekudakwashe@gmail.com",
    phone: "0771234567",
    business_category: "Wholesale & Retail",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-09",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-23",
    offline_activation_code: "SAI-N0O24L",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  },
  {
    company_id: "COMP-MTPTQITW",
    company_name: "5668",
    owner_name: "5668 Owner",
    owner_email: "uuii@gmail.com",
    phone: "0771234567",
    business_category: "Liquor & Beverages",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-06",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-20",
    offline_activation_code: "SAI-2Z6I3A",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  },
  {
    company_id: "COMP-MTR7CC6E",
    company_name: "Chapwanya",
    owner_name: "Tatenda chapwanya",
    owner_email: "tchapwanya@gmail.com",
    phone: "0783505493",
    business_category: "Grocery & FMCG",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-07",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-21",
    offline_activation_code: "SAI-T8K2MN",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  },
  {
    company_id: "COMP-MTT1Z5V1",
    company_name: "Chinavamwe",
    owner_name: "Chinavamwe Owner",
    owner_email: "tchinavamwe@gmail.com",
    phone: "0771234567",
    business_category: "Hardware & Electrical",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-08",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-22",
    offline_activation_code: "SAI-CH1N4V",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  },
  {
    company_id: "COMP-MTWG4D2Y",
    company_name: "Simon mashura",
    owner_name: "Simon Mashura",
    owner_email: "simonashura@gmail.com",
    phone: "0771234567",
    business_category: "Pharmacy & Cosmetics",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-10",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-24",
    offline_activation_code: "SAI-S1M0NM",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  },
  {
    company_id: "COMP-MTWH988C",
    company_name: "Exquisite",
    owner_name: "Exquisite Owner",
    owner_email: "ex@gmail.com",
    phone: "0771234567",
    business_category: "Boutique & Fashion",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-10",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-24",
    offline_activation_code: "SAI-EXQU1S",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  },
  {
    company_id: "COMP-MTWGDL9V",
    company_name: "Moses chunga",
    owner_name: "Moses Chunga",
    owner_email: "moseschunga@gmail.com",
    phone: "0771234567",
    business_category: "Auto Parts & Hardware",
    sheet_folder_id: "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    trial_start_date: "2026-09-10",
    subscription_status: "TRIAL",
    plan: "PROFESSIONAL",
    next_billing_date: "2026-09-24",
    offline_activation_code: "SAI-M0S3SC",
    trial_days_remaining: 14,
    branch_isolation_mode: "ROW_LEVEL"
  }
];

const defaultPermissions = {
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
  canSeeMargin: true
};

sheetCompanies.forEach((comp) => {
  const exCompIdx = saasData.companies.findIndex((c) => c.company_id === comp.company_id);
  const branchId = `BR-${comp.company_id.replace('COMP-', '')}-01`;
  const userId = `USR-${comp.company_id.slice(-4)}-01`;

  const ownerUser = {
    id: userId,
    user_id: userId,
    name: comp.owner_name,
    email: comp.owner_email,
    pin: "1234",
    role: "OWNER",
    phone: comp.phone,
    active: "Y",
    companyId: comp.company_id,
    company_id: comp.company_id,
    branchId: branchId,
    branch_id: branchId,
    permissions: defaultPermissions
  };

  const branch = {
    branch_id: branchId,
    company_id: comp.company_id,
    branch_name: "Main Branch",
    branch_code: "HQ-01",
    address: "Main Location",
    sheet_id: comp.sheet_folder_id || "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE",
    manager_user_id: userId,
    is_active: true
  };

  const companyEntry = {
    ...comp,
    owner: {
      id: userId,
      name: comp.owner_name,
      email: comp.owner_email,
      pin: "1234",
      role: "OWNER",
      phone: comp.phone
    },
    users: [ownerUser]
  };

  if (exCompIdx >= 0) {
    saasData.companies[exCompIdx] = { ...saasData.companies[exCompIdx], ...companyEntry };
  } else {
    saasData.companies.push(companyEntry);
  }

  const exBrIdx = saasData.branches.findIndex((b) => b.branch_id === branchId || (b.company_id === comp.company_id));
  if (exBrIdx >= 0) {
    saasData.branches[exBrIdx] = { ...saasData.branches[exBrIdx], ...branch };
  } else {
    saasData.branches.push(branch);
  }

  const exUIdx = saasData.users.findIndex((u) => u.id === userId || (u.company_id === comp.company_id && u.role === 'OWNER'));
  if (exUIdx >= 0) {
    saasData.users[exUIdx] = { ...saasData.users[exUIdx], ...ownerUser };
  } else {
    saasData.users.push(ownerUser);
  }
});

fs.writeFileSync(dataFilePath, JSON.stringify(saasData, null, 2), 'utf8');
console.log(`Updated server-saas-data.json. Total companies: ${saasData.companies.length}, branches: ${saasData.branches.length}, users: ${saasData.users.length}`);
