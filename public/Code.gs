/**
 * ============================================================================
 * SAIMETRIC SAAS UNIFIED GOOGLE APPS SCRIPT BACKEND (V7.0 - ENTERPRISE SCALE)
 * ============================================================================
 * Merges:
 *  - V5.0 Master Multi-Tenant SaaS Control Plane (Companies, Branches, Users,
 *    Permissions, Subscriptions, Schema Health, Migration, Merge, Auth, Trial)
 *  - V5.1 25+ Tab Operational Architecture + Server Clock Backdate Guard
 *  - V6.0 Hexagonal SyncCore Parity:
 *      * All 39 Syncable Entities (EntityRegistry.ts)
 *      * Hybrid Columns + Trailing Sync Metadata + Lossless payload_json
 *      * Canonical `push_envelopes` & `pull_catchup` with Monotonic `server_seq`
 *      * Monthly Sharded Tab Union Scans (e.g. Sales_YYYY_MM)
 *      * T1 Idempotency & State Transitions / T2 60s LWW + Tombstone Guard
 *      * Dual-Read Backward Compatibility for Legacy Header-Only Sheet Rows
 *      * Stocktake Blind Vault, Single Active Session Guard, Variance Comments,
 *        Segment Unlock Audit Log, Casual Workers & Branch Lockdowns
 *  - V7.0 Enterprise SaaS Scale Architecture:
 *      * Phase 1: Stateless HS256 JWT + CacheService Zero-Master-Open Hot Path
 *        + Cached System_Config Kill-Switches & Rate Limiting + Strict Tenant Sheet
 *      * Phase 2: One-Time TEMPLATE_TENANT (`generateMasterTemplate`), ~2s
 *        `makeCopy` Provisioning (`provisionTenantFromTemplate`), `_TenantMeta`
 *        Versioning, `routing_epoch` Invalidation, & Daily `runFleetMigration`
 *      * Phase 3: Per-Tenant Monotonic Sequences, CacheService Spin-Lease Locks
 *        (Zero Cross-Tenant Contention), & Pre-Lock Packet Dedupe Ring
 * ============================================================================
 */

var MASTER_ID = "1sZ_3414o9o9i2P_j2_m-S8p6L43fR1g0k3s3o1X9i";
var CACHE = CacheService.getScriptCache();
var CACHE_TTL_SEC = 21600; // 6 hours
var CACHE_TTL_ROUTE_SEC = 900; // 15 minutes
var CACHE_TTL_SYSTEM_CFG_SEC = 60; // 1 minute
var MAX_CACHE_BYTES = 90000;
var CURRENT_TENANT_SCHEMA_VERSION = 7;
var CODE_GS_VERSION = "V7.0-ENTERPRISE";
var DEFAULT_JWT_TTL_SEC = 43200; // 12 hours

var TENANT_COMPANY_ID = "COMP-001";
var TENANT_COMPANY_NAME = "Saimetric POS";
var BRANCH_ISOLATION_MODE = "ROW_LEVEL";

/**
 * ============================================================================
 * ONE-CLICK ENTERPRISE SETUP (Default Function for Apps Script "Run" Button)
 * ============================================================================
 * Safe & non-destructive to run on an existing Master Spreadsheet:
 *   1. Upgrades existing Master Sheet tabs & appends new V7.0 columns (no data loss)
 *   2. Creates (or verifies/heals) the TEMPLATE_TENANT spreadsheet & saves TEMPLATE_TENANT_ID
 *   3. Installs the daily 02:00 AM `runFleetMigration` auto-healing trigger
 */
function setupEnterpriseBackend() {
  var masterRes = setupMasterSheets();
  Logger.log("1/3 Master Sheet upgraded: " + JSON.stringify(masterRes));

  var props = PropertiesService.getScriptProperties();
  var existingTplId = String(props.getProperty("TEMPLATE_TENANT_ID") || "").trim();
  var tplRes = null;

  if (existingTplId) {
    try {
      var existingTplSs = SpreadsheetApp.openById(existingTplId);
      var healedTabs = setupTenantSpreadsheetTabs(existingTplSs, "TEMPLATE", existingTplSs.getName());
      writeTenantMeta(existingTplSs, {
        company_id: "TEMPLATE",
        schema_version: String(CURRENT_TENANT_SCHEMA_VERSION),
        template_version: CODE_GS_VERSION,
        updated_at: new Date().toISOString()
      });
      tplRes = {
        success: true,
        reused: true,
        template_id: existingTplId,
        url: existingTplSs.getUrl(),
        tabsCount: existingTplSs.getSheets().length,
        addedTabs: healedTabs,
        message: "Verified existing TEMPLATE_TENANT spreadsheet."
      };
    } catch (e) {
      tplRes = generateMasterTemplate();
    }
  } else {
    tplRes = generateMasterTemplate();
  }
  Logger.log("2/3 Master Tenant Template ready: " + JSON.stringify(tplRes));

  var triggerRes = installFleetMigrationTrigger();
  Logger.log("3/3 Fleet Migration Trigger: " + JSON.stringify(triggerRes));

  return {
    success: true,
    version: CODE_GS_VERSION,
    master: masterRes,
    template: tplRes,
    trigger: triggerRes
  };
}

// ============================================================================
// 1. ACTION CLASSIFICATION & HYBRID SCHEMA DEFINITIONS
// ============================================================================

var MASTER_TAB_NAMES = [
  "companies", "branches", "users", "Global_Users", "permissions",
  "Subscriptions", "request_log", "System_Config", "cache_log"
];

var HOT_PATH_ACTIONS = [
  "push_envelopes", "pull_catchup", "get_inventory", "get_stock", "get_data",
  "approve_direct_grv", "add_direct_grv", "submit_eod", "approve_eod",
  "add_sale", "sync_sale", "insert", "generic_insert", "update",
  "generic_update", "upsert", "delete", "generic_delete",
  "receive_stock", "sell_stock", "break_case", "sync_inventory", "upsert_product",
  "batch_sync_writes", "seed_sample_data", "sync_entity", "sync_customer",
  "approve_stocktake", "stocktake_blind_submit", "unlock_stocktake_segment",
  "save_stocktake_segment", "claim_stocktake_zone",
  "propose_joint_recount", "finalize_joint_recount"
];

var MASTER_CONTROL_ACTIONS = [
  "ping", "health", "setup_sheets", "init_master_sheet",
  "signup_company", "login_owner", "login_staff", "login", "refresh_token",
  "create_branch", "upsert_staff", "sync_staff_member",
  "get_tenant_context", "get_users_since", "get_branches_since",
  "lookup_company", "lookup_branch", "schema_health_check",
  "migrate_tenant", "merge_duplicate_companies", "confirm_payment",
  "extend_trial", "get_companies", "get_users",
  "sync_company", "bulk_sync_companies", "sync_companies_bulk",
  "provision_tenant_sheet", "initialize_tenant_sheet", "init_tenant_tabs",
  "allocate_tenant", "generate_master_template", "run_fleet_migration",
  "bump_routing_epoch", "purge_test_companies", "delete_company"
];

var WRITE_ACTIONS = [
  "signup_company", "login_owner", "login_staff", "login", "refresh_token",
  "create_branch", "upsert_staff", "confirm_payment", "extend_trial",
  "approve_direct_grv", "add_direct_grv", "submit_eod", "approve_eod",
  "add_sale", "insert", "generic_insert", "update", "generic_update", "upsert",
  "delete", "generic_delete", "receive_stock", "sell_stock", "break_case",
  "sync_inventory", "sync_company", "bulk_sync_companies", "sync_companies_bulk", "batch_sync_writes",
  "provision_tenant_sheet", "initialize_tenant_sheet", "init_tenant_tabs",
  "allocate_tenant", "generate_master_template", "run_fleet_migration", "bump_routing_epoch",
  "migrate_tenant", "merge_duplicate_companies", "seed_sample_data",
  "purge_test_companies", "delete_company",
  "setup_sheets", "init_master_sheet", "upsert_product",
  "push_envelopes", "sync_entity", "sync_sale", "sync_staff_member", "sync_customer",
  "approve_stocktake", "stocktake_blind_submit", "unlock_stocktake_segment",
  "save_stocktake_segment", "claim_stocktake_zone",
  "propose_joint_recount", "finalize_joint_recount"
];

var SYNC_TRAILING_HEADERS = [
  "entity_type",
  "entity_id",
  "version",
  "mutation_source",
  "client_updated_at",
  "server_updated_at",
  "server_seq",
  "is_deleted",
  "server_received_at",
  "suspicious_backdate",
  "payload_json"
];

var MONTHLY_SHARD_TABS = {
  "Sales": true,
  "CashLog": true,
  "StockMovements": true,
  "AuditLog": true
};

function withSyncCols_(cols) {
  var res = Array.isArray(cols) ? cols.slice() : [];
  for (var i = 0; i < SYNC_TRAILING_HEADERS.length; i++) {
    if (res.indexOf(SYNC_TRAILING_HEADERS[i]) === -1) {
      res.push(SYNC_TRAILING_HEADERS[i]);
    }
  }
  return res;
}

var BASE_TAB_COLUMNS = {
  // --- MASTER CONTROL PLANE TABS ---
  "companies": [
    "company_id", "company_name", "owner_name", "owner_email", "password_hash", "password_salt",
    "phone", "plan", "subscription_status", "status", "expiry",
    "trial_start_date", "next_billing_date", "sheet_id", "url",
    "routing_epoch", "provisioned_date", "webhook_url", "branch_isolation_mode",
    "activation_code", "schema_version", "created_at", "updated_at"
  ],
  "branches": ["branch_id", "company_id", "branch_name", "branch_code", "location", "location_code", "address", "phone", "is_main", "is_active", "created_at", "updated_at"],
  "users": ["user_id", "company_id", "branch_id", "full_name", "email", "phone", "role", "pin_hash", "pin_salt", "pin_version", "pin_updated_at", "assigned_branch_ids", "branch_assignments_json", "permissions_json", "is_active", "created_at", "updated_at"],
  "Global_Users": ["user_id", "email", "password_hash", "password_salt", "company_id", "role", "full_name", "branch_id", "is_active", "updated_at"],
  "permissions": ["perm_id", "company_id", "role", "module", "action", "allowed", "description", "updated_at"],
  "Subscriptions": ["SubscriptionID", "CompanyID", "Plan", "Status", "PaymentRef", "AmountPaid", "Currency", "PaidDate", "NextBillingDate", "ActivatedBy", "Notes"],
  "request_log": ["request_id", "action", "company_id", "timestamp", "status"],
  "System_Config": ["config_key", "value", "description", "updated_at"],
  "cache_log": ["timestamp", "cache_key", "action", "status"],

  // --- TENANT INTERNAL METADATA ---
  "_TenantMeta": ["meta_key", "value", "updated_at"],

  // --- OPERATIONAL POS & ACCOUNTING TABS (39 ENTITY PARITY + REPORTING) ---
  "Sales": ["InvoiceID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "Time", "StaffID", "StaffName", "CustomerName", "ItemsSummary", "TotalQty", "Subtotal", "Discount", "Total", "TaxAmount", "PaymentMethod", "Currency", "ExchangeRate", "AmountTendered", "ChangeGiven", "Status", "ReceiptHash", "Notes", "SyncedAt"],
  "InventoryMaster": ["ProductID", "CompanyID", "BranchID", "BranchName", "ItemName", "SKU", "Barcode", "Category", "UnitType", "CaseSize", "SellPriceUnit", "SellPriceCase", "CostPriceUnit", "CostPriceCase", "TotalUnits", "ReorderLevel", "SupplierName", "LastUpdated", "Active", "SyncedAt"],
  "Customers": ["CustomerID", "CompanyID", "BranchID", "BranchName", "CustomerName", "Phone", "Email", "Address", "CreditLimit", "CurrentBalance", "ChangeBalance", "LoyaltyPoints", "Notes", "UpdatedAt", "SyncedAt"],
  "CustomerChange": ["ChangeID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "CustomerID", "CustomerName", "In", "Out", "BalanceAfter", "InvoiceRef", "StaffID", "StaffName", "Notes", "Status", "SyncedAt"],
  "CreditSales": ["CreditID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "CustomerID", "CustomerName", "Phone", "CreditGroupID", "Amount", "PaidAmount", "In", "Out", "Balance", "DueDate", "ItemDescription", "StaffID", "StaffName", "Status", "Notes", "SyncedAt"],
  "CreditGroups": ["GroupID", "CompanyID", "BranchID", "Name", "Description", "CreditLimit", "MemberIds", "Status", "UpdatedAt"],
  "CashLog": ["LogID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "StaffID", "StaffName", "AccountID", "Category", "Description", "In", "Out", "Currency", "PaymentMethod", "Reference", "Status", "SyncedAt"],
  "CashLifts": ["LiftID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "StaffID", "StaffName", "Amount", "Currency", "DestinationAccount", "AuthorizedBy", "Notes", "Status", "SyncedAt"],
  "CashMovements": ["MovementID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "ShiftID", "AccountID", "Type", "Direction", "Amount", "Currency", "StaffID", "StaffName", "Description", "Reference", "SyncedAt"],
  "CashAccounts": ["AccountID", "CompanyID", "BranchID", "BranchName", "Name", "Type", "Currency", "CurrentBalance", "ExpectedBalance", "IsActive", "UpdatedAt"],
  "CashTransfers": ["TransferID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "FromAccountID", "ToAccountID", "Amount", "Currency", "Status", "Rank", "LinkedCashLogIDs", "StaffID", "StaffName", "Notes", "UpdatedAt"],
  "DirectGRVs": ["GRVID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "GRVNumber", "SupplierName", "InvoiceNumber", "ItemsCount", "TotalCost", "CashPaid", "PaymentMethod", "AccountID", "Status", "RecordedBy", "ApprovedBy", "Notes", "SyncedAt"],
  "GoodsReceived": ["GRNID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "SupplierID", "SupplierName", "InvoiceRef", "TotalAmount", "ItemsCount", "Status", "ReceivedBy", "Notes", "SyncedAt"],
  "GoodsReceivedItems": ["GRNItemID", "CompanyID", "BranchID", "GRNID", "ProductID", "ProductName", "QtyReceived", "UnitCost", "LineTotal", "BatchNo", "ExpiryDate"],
  "StockMovements": ["MovementID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "ProductID", "ProductName", "MovementType", "QtyChange", "BalanceBefore", "BalanceAfter", "ReferenceID", "StaffID", "StaffName", "Notes", "SyncedAt"],
  "StockBatches": ["BatchID", "CompanyID", "BranchID", "ProductID", "ProductName", "BatchNumber", "Quantity", "UnitCost", "ExpiryDate", "ReceivedAt", "SupplierName", "Status"],
  "Expenses": ["ExpenseID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "Category", "Description", "VendorOrCustomer", "Amount", "Currency", "PaymentMethod", "StaffID", "StaffName", "ReceiptRef", "Status", "ApprovedBy", "SyncedAt"],
  "InternalConsumption": ["ConsumptionID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "StaffID", "StaffName", "Department", "Reason", "TotalCost", "ItemsCount", "Status", "ApprovedBy", "Notes"],
  "Reconciliations": ["ReconID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "StaffID", "StaffName", "OpeningFloat", "CashSales", "OtherCashIn", "CashExpenses", "BankDrops", "ExpectedCash", "ActualCashCount", "Variance", "Status", "Notes", "ApprovedBy", "SyncedAt"],
  "BusinessDayClosures": ["ClosureID", "CompanyID", "BranchID", "BranchName", "Date", "ClosedAt", "ClosedBy", "ClosedByName", "TotalSales", "TotalExpenses", "NetCash", "Variance", "Status", "Notes"],
  "ElectronicSettlements": ["SettlementID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "Provider", "Currency", "ExpectedAmount", "SettledAmount", "Variance", "Reference", "StaffID", "Status", "Notes"],
  "CashCounts": ["CountID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "StaffID", "StaffName", "DenominationsJSON", "FinalCashOutTotal", "Notes", "Status"],
  "AdminSales": ["AdminSaleID", "CompanyID", "BranchID", "BranchName", "Date", "Timestamp", "StaffID", "StaffName", "SalesAmount", "Notes", "Status"],
  "Suppliers": ["SupplierID", "CompanyID", "BranchID", "BranchName", "SupplierName", "Category", "ContactPerson", "Phone", "Email", "Address", "City", "PaymentTerms", "TaxNumber", "Balance", "Status", "UpdatedAt", "SyncedAt"],
  "SupplierInvoices": ["VoucherID", "CompanyID", "BranchID", "BranchName", "InvoiceNo", "SupplierID", "SupplierName", "Date", "DueDate", "TotalAmount", "PaidAmount", "Status", "Notes", "UpdatedAt", "SyncedAt"],
  "Categories": ["CategoryID", "CompanyID", "BranchID", "Name", "Color", "Description", "UpdatedAt"],
  "Staff": ["UserID", "CompanyID", "BranchID", "BranchName", "FullName", "Role", "Email", "Phone", "PinHash", "PinSalt", "PinVersion", "PinUpdatedAt", "AssignedBranchIds", "Active", "LastLogin", "UpdatedAt", "SyncedAt"],
  "Branches": ["BranchID", "CompanyID", "BranchName", "BranchCode", "Location", "Address", "Phone", "ManagerName", "Status", "IsMain", "IsActive", "UpdatedAt", "SyncedAt"],
  "Wallets": ["WalletID", "CompanyID", "BranchID", "Name", "Type", "Currency", "Balance", "ExpectedBalance", "UpdatedAt"],
  "WalletTransfers": ["TransferID", "CompanyID", "BranchID", "Date", "Timestamp", "FromWallet", "ToWallet", "Amount", "Currency", "Reference", "StaffID", "StaffName", "Notes"],
  "TripManifests": ["TripID", "CompanyID", "BranchID", "Date", "DriverName", "VehicleReg", "Route", "TotalLoadedValue", "Status", "Notes"],
  "FixedCosts": ["FixedCostID", "CompanyID", "BranchID", "Name", "Category", "Amount", "Frequency", "NextDueDate", "Status"],
  "AuditLog": ["AuditID", "CompanyID", "BranchID", "BranchName", "Timestamp", "Date", "UserID", "UserName", "AuthorizedByName", "Role", "Action", "Module", "EntityID", "Details", "IPOrDevice", "Status"],

  // --- STOCKTAKE GOVERNANCE, VAULT, CASUALS & LOCKDOWN ---
  "StocktakeSessions": ["SessionID", "CompanyID", "BranchID", "BranchName", "Title", "Mode", "Status", "StartedAt", "StartedBy", "AuditorID", "AuditorName", "LockdownRequired", "VarianceThreshold", "CommentsDueBy", "CommittedAt", "CommittedBy", "VarianceCommentsJSON", "UpdatedAt"],
  "StocktakeSegments": ["SegmentID", "CompanyID", "BranchID", "SessionID", "Name", "AisleOrZone", "Status", "IsLocked", "AssignedTeamA", "AssignedTeamB", "UpdatedAt"],
  "StocktakeZoneAssignments": ["AssignmentID", "CompanyID", "BranchID", "SessionID", "ZoneID", "ZoneName", "SlotAStaffID", "SlotAStaffName", "SlotBStaffID", "SlotBStaffName", "Status", "UpdatedAt"],
  "StocktakeZoneClaims": ["ClaimID", "CompanyID", "BranchID", "SessionID", "ZoneID", "Slot", "StaffID", "StaffName", "DeviceID", "UpdatedAt"],
  "StocktakeBlindVault": ["VaultKey", "CompanyID", "BranchID", "SessionID", "ZoneID", "Slot", "StaffID", "StaffName", "IsFinalized", "FinalizedAt", "LinesCount", "LinesJSON", "SubmittedAt"],
  "StocktakeJointProposals": ["ProposalID", "CompanyID", "BranchID", "SessionID", "ZoneID", "ProposedBySlot", "ProposedByName", "RecountLinesJSON", "Timestamp"],
  "StocktakeJointFinalized": ["FinalID", "CompanyID", "BranchID", "SessionID", "ZoneID", "SignedByA", "SignedByB", "ResolvedByName", "ResolvedLinesJSON", "FinalizedAt"],
  "StocktakeUnlockLog": ["UnlockID", "CompanyID", "BranchID", "SessionID", "SegmentID", "TargetSlot", "ActorID", "ActorName", "Reason", "UnlockedAt"],
  "CasualWorkers": ["CasualID", "CompanyID", "BranchID", "SessionID", "Name", "Phone", "HomeBranchID", "WorkerType", "PassCodeHash", "AssignedZones", "ExpiresAt", "IsActive", "UpdatedAt"],
  "BranchLockdowns": ["BranchID", "CompanyID", "IsLocked", "SessionID", "LockedBy", "LockedByName", "LockedAt", "Reason", "UpdatedAt"],

  // --- SETTINGS, CONFIG & TOMBSTONES ---
  "SystemSettings": ["SettingKey", "CompanyID", "BranchID", "UpdatedAt"],
  "MultiCurrency": ["ConfigID", "CompanyID", "BranchID", "BaseCurrency", "RatesJSON", "UpdatedAt"],
  "PermissionsMatrix": ["MatrixID", "CompanyID", "BranchID", "RulesCount", "UpdatedAt"],
  "RoleConfigs": ["ConfigID", "CompanyID", "BranchID", "UpdatedAt"],
  "SheetsConfig": ["ConfigID", "CompanyID", "BranchID", "UpdatedAt"],
  "Tombstones": ["TombstoneKey", "CompanyID", "BranchID", "TargetEntityType", "TargetEntityID", "DeletedAt", "DeletedBy"]
};

var TAB_TEMPLATES = {};
(function initTabTemplates_() {
  for (var tab in BASE_TAB_COLUMNS) {
    if (!BASE_TAB_COLUMNS.hasOwnProperty(tab)) continue;
    if (tab === "_TenantMeta" || tab === "System_Config") {
      TAB_TEMPLATES[tab] = BASE_TAB_COLUMNS[tab].slice();
    } else {
      TAB_TEMPLATES[tab] = withSyncCols_(BASE_TAB_COLUMNS[tab]);
    }
  }
})();

var MASTER_BLUEPRINT = {
  schemaVersion: CURRENT_TENANT_SCHEMA_VERSION,
  versionLabel: CODE_GS_VERSION,
  tabs: TAB_TEMPLATES
};

var SHEET_ALIASES = {
  "Salespeople": "Staff",
  "StockMovement": "StockMovements",
  "Audit_Log": "AuditLog",
  "Settings": "SystemSettings",
  "Inventory": "InventoryMaster"
};

var ENTITY_TO_TAB = {
  "sale": "Sales",
  "inventory_item": "InventoryMaster",
  "staff": "Staff",
  "branch": "Branches",
  "customer": "Customers",
  "customer_change": "CustomerChange",
  "credit_sale": "CreditSales",
  "credit_group": "CreditGroups",
  "cash_log": "CashLog",
  "cash_lift": "CashLifts",
  "cash_movement": "CashMovements",
  "cash_account": "CashAccounts",
  "cash_transfer": "CashTransfers",
  "direct_grv": "DirectGRVs",
  "goods_received": "GoodsReceived",
  "stock_movement": "StockMovements",
  "expense": "Expenses",
  "internal_consumption": "InternalConsumption",
  "supervisor_approval": "AuditLog",
  "audit_log": "AuditLog",
  "reconciliation": "Reconciliations",
  "business_day_closure": "BusinessDayClosures",
  "electronic_settlement": "ElectronicSettlements",
  "cash_count": "CashCounts",
  "admin_sales": "AdminSales",
  "supplier_invoice_voucher": "SupplierInvoices",
  "supplier": "Suppliers",
  "inventory_category": "Categories",
  "wallet": "Wallets",
  "stocktake_session": "StocktakeSessions",
  "stocktake_segment": "StocktakeSegments",
  "stocktake_zone_assignment": "StocktakeZoneAssignments",
  "stocktake_zone_claim": "StocktakeZoneClaims",
  "stocktake_count_submission": "StocktakeBlindVault",
  "stocktake_joint_proposal": "StocktakeJointProposals",
  "stocktake_joint_finalized": "StocktakeJointFinalized",
  "stocktake_segment_unlock": "StocktakeUnlockLog",
  "casual_worker": "CasualWorkers",
  "branch_lockdown": "BranchLockdowns",
  "system_settings": "SystemSettings",
  "multi_currency": "MultiCurrency",
  "permissions_matrix": "PermissionsMatrix",
  "role_configs": "RoleConfigs",
  "sheets_config": "SheetsConfig",
  "tombstone": "Tombstones",
  "company": "companies"
};

var T2_ENTITY_TYPES = {
  "inventory_item": true,
  "staff": true,
  "customer": true,
  "branch": true,
  "cash_account": true,
  "wallet": true,
  "inventory_category": true,
  "supplier": true,
  "credit_group": true,
  "stocktake_session": true,
  "stocktake_segment": true,
  "stocktake_zone_assignment": true,
  "casual_worker": true,
  "branch_lockdown": true,
  "sheets_config": true,
  "system_settings": true,
  "multi_currency": true,
  "permissions_matrix": true,
  "role_configs": true
};

var CATALOG_SHARED_ENTITIES = {
  "inventory_item": true,
  "staff": true,
  "branch": true,
  "customer": true,
  "supplier": true,
  "inventory_category": true,
  "credit_group": true,
  "permissions_matrix": true,
  "role_configs": true,
  "multi_currency": true,
  "system_settings": true,
  "sheets_config": true,
  "tombstone": true
};

// ============================================================================
// 2. INFRASTRUCTURE, HS256 JWT, CACHE ROUTING, TENANT LEASES & SEQUENCES
// ============================================================================

function getMasterSpreadsheet() {
  try {
    if (MASTER_ID && MASTER_ID.indexOf("1sZ_3414o9o9i2P") === -1) {
      return SpreadsheetApp.openById(MASTER_ID);
    }
  } catch (e) {}
  try {
    var propMasterId = String(PropertiesService.getScriptProperties().getProperty("MASTER_SPREADSHEET_ID") || "").trim();
    if (propMasterId && propMasterId.length >= 15) {
      return SpreadsheetApp.openById(propMasterId);
    }
  } catch (e2) {}
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    try {
      PropertiesService.getScriptProperties().setProperty("MASTER_SPREADSHEET_ID", active.getId());
    } catch (e3) {}
  }
  return active;
}

function getOrCreateJwtSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty("JWT_HMAC_SECRET");
  if (secret && secret.length >= 32) return secret;
  var seed = Utilities.getUuid() + "::" + Date.now() + "::" + Math.random();
  var d1 = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  var generated = "";
  for (var i = 0; i < d1.length; i++) {
    var b = d1[i] < 0 ? d1[i] + 256 : d1[i];
    var h = b.toString(16);
    generated += h.length === 1 ? "0" + h : h;
  }
  props.setProperty("JWT_HMAC_SECRET", generated);
  return generated;
}

function b64UrlEncode_(input) {
  var bytes = typeof input === "string" ? Utilities.newBlob(input).getBytes() : input;
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

function b64UrlDecodeToStr_(b64Url) {
  var norm = String(b64Url || "").replace(/-/g, "+").replace(/_/g, "/");
  while (norm.length % 4 !== 0) norm += "=";
  var bytes = Utilities.base64Decode(norm);
  return Utilities.newBlob(bytes).getDataAsString("UTF-8");
}

function signJwt(claims, ttlSec) {
  var nowSec = Math.floor(Date.now() / 1000);
  var payloadObj = {};
  for (var k in claims) {
    if (claims.hasOwnProperty(k)) payloadObj[k] = claims[k];
  }
  payloadObj.iat = nowSec;
  payloadObj.exp = nowSec + Number(ttlSec || DEFAULT_JWT_TTL_SEC);

  var headerB64 = b64UrlEncode_(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  var payloadB64 = b64UrlEncode_(JSON.stringify(payloadObj));
  var signingInput = headerB64 + "." + payloadB64;
  var sigBytes = Utilities.computeHmacSha256Signature(signingInput, getOrCreateJwtSecret_());
  var sigB64 = b64UrlEncode_(sigBytes);
  return signingInput + "." + sigB64;
}

function verifyJwt(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, code: "JWT_MISSING", error: "Missing JWT token" };
  }
  var parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, code: "JWT_INVALID", error: "Malformed JWT format" };
  }
  try {
    var header = JSON.parse(b64UrlDecodeToStr_(parts[0]));
    if (!header || header.alg !== "HS256") {
      return { valid: false, code: "JWT_INVALID", error: "Unsupported JWT algorithm" };
    }
    var signingInput = parts[0] + "." + parts[1];
    var expectedBytes = Utilities.computeHmacSha256Signature(signingInput, getOrCreateJwtSecret_());
    var expectedSig = b64UrlEncode_(expectedBytes);
    var providedSig = parts[2];
    if (expectedSig.length !== providedSig.length) {
      return { valid: false, code: "JWT_INVALID", error: "JWT signature mismatch" };
    }
    var diff = 0;
    for (var i = 0; i < expectedSig.length; i++) {
      diff |= expectedSig.charCodeAt(i) ^ providedSig.charCodeAt(i);
    }
    if (diff !== 0) {
      return { valid: false, code: "JWT_INVALID", error: "JWT signature verification failed" };
    }
    var claims = JSON.parse(b64UrlDecodeToStr_(parts[1]));
    var nowSec = Math.floor(Date.now() / 1000);
    if (claims.exp && nowSec > Number(claims.exp)) {
      return { valid: false, expired: true, code: "JWT_EXPIRED", claims: claims, error: "JWT token expired" };
    }
    return { valid: true, claims: claims };
  } catch (e) {
    return { valid: false, code: "JWT_INVALID", error: "JWT decode failure: " + e.message };
  }
}

function getSystemConfigCached(masterSsOpt) {
  var cached = CACHE.get("sys:global_cfg");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  var props = PropertiesService.getScriptProperties();
  var cfg = {
    GLOBAL_SYNC_DISABLED: "FALSE",
    MAINTENANCE_MODE: "FALSE",
    MAX_ENVELOPES_PER_BATCH: 50,
    RATE_LIMIT_PER_MIN: 120,
    REQUIRE_JWT: "FALSE",
    TEMPLATE_TENANT_ID: String(props.getProperty("TEMPLATE_TENANT_ID") || "").trim()
  };

  try {
    var ss = masterSsOpt || getMasterSpreadsheet();
    var scSheet = ss ? ss.getSheetByName("System_Config") : null;
    if (scSheet && scSheet.getLastRow() >= 2) {
      var vals = scSheet.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) {
        var k = String(vals[i][0] || "").trim();
        var v = String(vals[i][1] || "").trim();
        if (!k) continue;
        if (k === "MAX_ENVELOPES_PER_BATCH" || k === "RATE_LIMIT_PER_MIN") {
          var n = Number(v);
          if (isFinite(n) && n > 0) cfg[k] = n;
        } else if (v !== "") {
          cfg[k] = v;
        }
      }
    }
  } catch (e2) {}

  putCacheSafe("sys:global_cfg", JSON.stringify(cfg), CACHE_TTL_SYSTEM_CFG_SEC);
  return cfg;
}

function checkRateLimit(companyId, limitPerMin) {
  var cap = Math.max(10, Number(limitPerMin || 120));
  var minuteBucket = Math.floor(Date.now() / 60000);
  var key = "rl:" + String(companyId || "DEFAULT").toUpperCase() + ":" + minuteBucket;
  var cur = Number(CACHE.get(key) || "0") + 1;
  try { CACHE.put(key, String(cur), 120); } catch (e) {}
  if (cur > cap) {
    var secsLeft = 60 - new Date().getSeconds();
    return {
      allowed: false,
      code: "RATE_LIMITED",
      httpStatus: 429,
      retryAfterMs: Math.max(2000, secsLeft * 1000),
      error: "Per-tenant rate limit exceeded (" + cap + " req/min). Retry shortly."
    };
  }
  return { allowed: true };
}

function getTenantRouteCached(companyId, masterSsOpt) {
  var compKey = String(companyId || TENANT_COMPANY_ID).trim().toUpperCase();
  var cacheKey = "route:" + compKey;
  var cached = CACHE.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  // Fallback read without Master if called on strict JWT path with missing cache -> still check ScriptProperties epoch override
  var ss = masterSsOpt || getMasterSpreadsheet();
  var comp = getCompany(compKey, ss);
  var props = PropertiesService.getScriptProperties();
  var propEpoch = Number(props.getProperty("ROUTE_EPOCH_" + compKey) || "1");
  if (!comp) {
    return null;
  }
  var sheetId = String(comp.sheet_id || "").trim();
  var epoch = Math.max(propEpoch, Number(comp.routing_epoch || 1));
  var route = {
    company_id: comp.company_id || compKey,
    spreadsheet_id: sheetId,
    url: comp.url || (sheetId ? "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit" : ""),
    routing_epoch: epoch,
    status: String(comp.subscription_status || comp.status || "TRIAL").toUpperCase(),
    plan: String(comp.plan || "STARTER").toUpperCase(),
    expiry: comp.next_billing_date || comp.expiry || "",
    schema_version: Number(comp.schema_version || CURRENT_TENANT_SCHEMA_VERSION)
  };
  putCacheSafe(cacheKey, JSON.stringify(route), CACHE_TTL_ROUTE_SEC);
  return route;
}

function resolveTenantSpreadsheetStrict(spreadsheetId, companyId) {
  var id = String(spreadsheetId || "").trim();
  if (!id || id.length < 15) {
    return {
      ss: null,
      code: "MISSING_TENANT_SHEET_ID",
      httpStatus: 422,
      error: "No dedicated tenant spreadsheet_id configured for company " + companyId + ". Provision tenant spreadsheet first."
    };
  }
  try {
    var ss = SpreadsheetApp.openById(id);
    if (!ss) {
      return {
        ss: null,
        code: "TENANT_SHEET_UNREACHABLE",
        httpStatus: 503,
        error: "Unable to open tenant spreadsheet " + id
      };
    }
    return { ss: ss };
  } catch (e) {
    return {
      ss: null,
      code: "TENANT_SHEET_UNREACHABLE",
      httpStatus: 503,
      error: "Tenant spreadsheet unreachable (" + id + "): " + e.message
    };
  }
}

function isMasterCompanyId_(companyId) {
  var c = String(companyId || "").trim().toUpperCase();
  return c === "COMP-001" || c === "COMP-MASTER";
}

function isMasterSpreadsheetId_(sheetId, masterSs) {
  var id = String(sheetId || "").trim();
  if (!id) return false;
  if (id === "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE") return true;
  try {
    if (masterSs && masterSs.getId() === id) return true;
  } catch (e) {}
  return false;
}

function resolveTargetSpreadsheet(masterSs, company_id, explicitSheetId) {
  var sheetId = String(explicitSheetId || "").trim();
  if (sheetId && !isMasterCompanyId_(company_id) && isMasterSpreadsheetId_(sheetId, masterSs)) {
    sheetId = "";
  }
  if (!sheetId && company_id) {
    var storedId = getSheetId(company_id, masterSs);
    if (storedId && (isMasterCompanyId_(company_id) || !isMasterSpreadsheetId_(storedId, masterSs))) {
      sheetId = storedId;
    }
  }
  if (sheetId && sheetId.length >= 15) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {}
  }
  return masterSs;
}

function extractRawToken(req, params) {
  var t = "";
  if (req && (req.jwt || req.token || req.authorization || req.Authorization)) {
    t = String(req.jwt || req.token || req.authorization || req.Authorization).trim();
  } else if (params && (params.jwt || params.token || params.authorization)) {
    t = String(params.jwt || params.token || params.authorization).trim();
  }
  if (t.toLowerCase().indexOf("bearer ") === 0) {
    t = t.slice(7).trim();
  }
  // Ignore dummy client-generated demo tokens if present
  if (t.indexOf("JWT-OWNER-") === 0 || t.indexOf("JWT-STAFF-") === 0 || t.indexOf("JWT-SUPERADMIN-") === 0) {
    return "";
  }
  return t;
}

function resolveHotPathContext(reqOrParams, actionNorm) {
  var cfg = getSystemConfigCached(null);
  if (String(cfg.GLOBAL_SYNC_DISABLED).toUpperCase() === "TRUE" || String(cfg.MAINTENANCE_MODE).toUpperCase() === "TRUE") {
    return {
      ok: false,
      response: {
        success: false,
        code: "KILL_SWITCH_ACTIVE",
        httpStatus: 503,
        retryAfterMs: 300000,
        error: "Sync paused: System maintenance kill-switch is active."
      }
    };
  }

  var token = extractRawToken(reqOrParams, reqOrParams);
  var claims = null;
  if (token) {
    var v = verifyJwt(token);
    if (!v.valid) {
      return {
        ok: false,
        response: {
          success: false,
          code: v.code || "JWT_INVALID",
          httpStatus: 401,
          error: v.error || "Unauthorized"
        }
      };
    }
    claims = v.claims;
  } else if (String(cfg.REQUIRE_JWT).toUpperCase() === "TRUE") {
    return {
      ok: false,
      response: {
        success: false,
        code: "JWT_MISSING",
        httpStatus: 401,
        error: "Signed JWT required by System_Config (REQUIRE_JWT=TRUE)."
      }
    };
  }

  var companyId = String(
    (claims && claims.company_id) ||
    reqOrParams.company_id ||
    reqOrParams.companyId ||
    (reqOrParams.data && (reqOrParams.data.company_id || reqOrParams.data.companyId)) ||
    TENANT_COMPANY_ID
  ).trim();
  var compUpper = companyId.toUpperCase();

  var rateRes = checkRateLimit(companyId, cfg.RATE_LIMIT_PER_MIN);
  if (!rateRes.allowed) {
    return { ok: false, response: rateRes };
  }

  // Zero-Master-Open check against CacheService route or ScriptProperties routing_epoch
  var props = PropertiesService.getScriptProperties();
  var propEpoch = Number(props.getProperty("ROUTE_EPOCH_" + compUpper) || "1");
  var cachedRoute = null;
  var routeRaw = CACHE.get("route:" + compUpper);
  if (routeRaw) {
    try { cachedRoute = JSON.parse(routeRaw); } catch (e) {}
  }

  var effectiveEpoch = Math.max(propEpoch, cachedRoute ? Number(cachedRoute.routing_epoch || 1) : 1);
  var reqEpoch = claims ? Number(claims.routing_epoch || 1) : (reqOrParams.routing_epoch ? Number(reqOrParams.routing_epoch) : 0);

  if (reqEpoch > 0 && reqEpoch < effectiveEpoch) {
    return {
      ok: false,
      response: {
        success: false,
        code: "ROUTING_EPOCH_STALE",
        httpStatus: 409,
        current_routing_epoch: effectiveEpoch,
        spreadsheet_id: (cachedRoute && cachedRoute.spreadsheet_id) || "",
        error: "Routing epoch stale (client=" + reqEpoch + ", current=" + effectiveEpoch + "). Refresh token & reset sync cursor."
      }
    };
  }

  var spreadsheetId = String(
    (claims && claims.spreadsheet_id) ||
    (cachedRoute && cachedRoute.spreadsheet_id) ||
    reqOrParams.spreadsheet_id ||
    reqOrParams.tenant_sheet_id ||
    reqOrParams.sheet_id ||
    ""
  ).trim();

  var masterSsLazy = null;
  if (!spreadsheetId) {
    // Cache-miss legacy path: resolve from Master once & cache route
    masterSsLazy = getMasterSpreadsheet();
    var resolvedRoute = getTenantRouteCached(companyId, masterSsLazy);
    if (resolvedRoute) {
      spreadsheetId = resolvedRoute.spreadsheet_id || "";
      effectiveEpoch = Math.max(effectiveEpoch, Number(resolvedRoute.routing_epoch || 1));
      if (reqEpoch > 0 && reqEpoch < effectiveEpoch) {
        return {
          ok: false,
          response: {
            success: false,
            code: "ROUTING_EPOCH_STALE",
            httpStatus: 409,
            current_routing_epoch: effectiveEpoch,
            spreadsheet_id: spreadsheetId,
            error: "Routing epoch stale. Refresh token & reset sync cursor."
          }
        };
      }
      if (resolvedRoute.status === "SUSPENDED" || resolvedRoute.status === "CANCELLED") {
        return {
          ok: false,
          response: {
            success: false,
            code: "TENANT_SUSPENDED",
            httpStatus: 403,
            error: "Tenant subscription status is " + resolvedRoute.status + "."
          }
        };
      }
    }
  }

  var strictOpen = resolveTenantSpreadsheetStrict(spreadsheetId, companyId);
  if (!strictOpen.ss) {
    return {
      ok: false,
      response: {
        success: false,
        code: strictOpen.code,
        httpStatus: strictOpen.httpStatus,
        error: strictOpen.error
      }
    };
  }

  return {
    ok: true,
    cfg: cfg,
    claims: claims,
    companyId: companyId,
    spreadsheetId: spreadsheetId,
    routingEpoch: effectiveEpoch,
    targetSs: strictOpen.ss,
    masterSs: masterSsLazy
  };
}

function putCacheSafe(key, valStr, ttlSec) {
  try {
    if (valStr && valStr.length < MAX_CACHE_BYTES) {
      CACHE.put(key, valStr, ttlSec || CACHE_TTL_SEC);
    }
  } catch (e) {}
}

// Per-tenant CacheService Spin-Lease Lock (Phase 3)
function acquireTenantLease(companyId, waitMs) {
  var key = "lock:tenant:" + String(companyId || TENANT_COMPANY_ID).toUpperCase();
  var nonce = Utilities.getUuid();
  var deadline = Date.now() + Number(waitMs || 15000);
  while (Date.now() < deadline) {
    var holder = CACHE.get(key);
    if (!holder) {
      CACHE.put(key, nonce, 30);
      Utilities.sleep(45);
      if (CACHE.get(key) === nonce) {
        return { acquired: true, nonce: nonce, key: key };
      }
    }
    Utilities.sleep(140 + Math.floor(Math.random() * 180));
  }
  return {
    acquired: false,
    code: "TENANT_LOCK_BUSY",
    httpStatus: 423,
    retryAfterMs: 1200 + Math.floor(Math.random() * 1500),
    error: "Tenant lock busy; retry with backoff."
  };
}

function releaseTenantLease(lease) {
  if (!lease || !lease.acquired) return;
  try {
    SpreadsheetApp.flush();
    if (CACHE.get(lease.key) === lease.nonce) {
      CACHE.remove(lease.key);
    }
  } catch (e) {}
}

// Per-Tenant Sequence Allocator (Phase 3) backed by ScriptProperties + _TenantMeta
function allocateNextServerSeq(targetSsOpt, companyIdOpt) {
  var batch = allocateServerSeqBatch(1, targetSsOpt, companyIdOpt);
  return batch.start;
}

function allocateServerSeqBatch(count, targetSsOpt, companyIdOpt) {
  var n = Math.max(1, Number(count || 1));
  var compKey = companyIdOpt ? String(companyIdOpt).trim().toUpperCase() : "";
  var propKey = compKey ? ("SEQ_" + compKey) : "NEXT_SERVER_SEQ";
  try {
    var props = PropertiesService.getScriptProperties();
    var current = Number(props.getProperty(propKey) || "0");
    if (!isFinite(current) || current < 0) current = 0;

    if (compKey && current === 0) {
      var globalFloor = Number(props.getProperty("NEXT_SERVER_SEQ") || "0");
      var metaFloor = 0;
      if (targetSsOpt) {
        var meta = readTenantMeta(targetSsOpt);
        metaFloor = Number(meta.next_server_seq || 0);
      }
      current = Math.max(metaFloor, isFinite(globalFloor) ? globalFloor : 0);
    }

    var nextEnd = current + n;
    props.setProperty(propKey, String(nextEnd));
    return { start: current + 1, end: nextEnd };
  } catch (e) {
    var now = Date.now();
    return { start: now, end: now + n - 1 };
  }
}

function flushTenantSeqMeta(targetSs, companyId, seqVal) {
  if (!targetSs || !seqVal) return;
  try {
    writeTenantMeta(targetSs, { next_server_seq: String(seqVal), company_id: companyId });
  } catch (e) {}
}

function parseTimestampMsSafe(val) {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") {
    return isFinite(val) && val > 0 ? val : 0;
  }
  if (val instanceof Date) {
    var ms = val.getTime();
    return isFinite(ms) ? ms : 0;
  }
  var s = String(val).trim();
  if (!s) return 0;
  var asNum = Number(s);
  if (!isNaN(asNum) && asNum > 1000000000000) return asNum;
  var parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}

function evaluateServerTimestampMeta(ss, claimedDateVal, claimedTsVal) {
  var nowMs = Date.now();
  var serverReceivedAt = new Date(nowMs).toISOString();
  var suspicious = false;

  try {
    var tz = (ss && ss.getSpreadsheetTimeZone) ? ss.getSpreadsheetTimeZone() : Session.getScriptTimeZone();
    var serverToday = Utilities.formatDate(new Date(nowMs), tz || "UTC", "yyyy-MM-dd");
    var cDate = String(claimedDateVal || "").trim();
    if (cDate && /^\d{4}-\d{2}-\d{2}/.test(cDate)) {
      var claimedDay = cDate.slice(0, 10);
      var diffDays = (Date.parse(serverToday) - Date.parse(claimedDay)) / 86400000;
      if (diffDays > 1 || diffDays < -1) suspicious = true;
    }
    var claimedMs = parseTimestampMsSafe(claimedTsVal);
    if (claimedMs > 0 && Math.abs(nowMs - claimedMs) > 21600000) {
      suspicious = true;
    }
  } catch (e) {}

  return {
    server_received_at: serverReceivedAt,
    suspicious_backdate: suspicious
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function mergeReqPayload(req) {
  var merged = {};
  if (req && req.data && typeof req.data === "object" && !Array.isArray(req.data)) {
    for (var k in req.data) {
      if (req.data.hasOwnProperty(k)) merged[k] = req.data[k];
    }
  }
  if (req && req.payload && typeof req.payload === "object" && !Array.isArray(req.payload)) {
    for (var k2 in req.payload) {
      if (req.payload.hasOwnProperty(k2) && merged[k2] === undefined) merged[k2] = req.payload[k2];
    }
  }
  if (req && typeof req === "object") {
    for (var k3 in req) {
      if (req.hasOwnProperty(k3) && k3 !== "data" && k3 !== "payload" && merged[k3] === undefined) {
        merged[k3] = req[k3];
      }
    }
  }
  return merged;
}

function getMonthlyTabName(baseName, dateStr) {
  if (!MONTHLY_SHARD_TABS[baseName]) return baseName;
  if (!dateStr) return baseName;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return baseName;
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1);
  if (mm.length < 2) mm = "0" + mm;
  return baseName + "_" + yyyy + "_" + mm;
}

function getOrCreateMonthlySheet(ss, baseName, dateStr) {
  var tabName = getMonthlyTabName(baseName, dateStr);
  var sheet = ss.getSheetByName(tabName);
  var template = TAB_TEMPLATES[baseName];
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    if (template && template.length > 0) {
      sheet.appendRow(template);
      sheet.getRange(1, 1, 1, template.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }
  } else if (template && template.length > 0) {
    ensureTabHeaders(sheet, template);
  }
  return sheet;
}

function getReadableSheetsForBase(ss, baseName) {
  var sheets = [];
  var all = ss.getSheets();
  var prefix = baseName + "_";
  for (var i = 0; i < all.length; i++) {
    var name = all[i].getName();
    if (name === baseName || name.indexOf(prefix) === 0) {
      sheets.push(all[i]);
    }
  }
  return sheets;
}

function ensureTabHeaders(sheet, expectedHeaders) {
  if (!sheet || !expectedHeaders || expectedHeaders.length === 0) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(expectedHeaders);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    return;
  }
  var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  var missing = [];
  for (var i = 0; i < expectedHeaders.length; i++) {
    if (currentHeaders.indexOf(expectedHeaders[i]) === -1) {
      missing.push(expectedHeaders[i]);
    }
  }
  if (missing.length > 0) {
    var startCol = lastCol + 1;
    for (var j = 0; j < missing.length; j++) {
      var cell = sheet.getRange(1, startCol + j);
      cell.setValue(missing[j]).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    }
  }
}

function ensureAllMasterTabsExist(ss) {
  if (!ss) {
    throw new Error("Master Spreadsheet not found. Open your Master Google Sheet -> Extensions -> Apps Script, OR paste your Master Spreadsheet ID into MASTER_ID at the top of Code.gs.");
  }
  var created = [];
  for (var i = 0; i < MASTER_TAB_NAMES.length; i++) {
    var tabName = MASTER_TAB_NAMES[i];
    var sheet = ss.getSheetByName(tabName);
    var cols = TAB_TEMPLATES[tabName];
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow(cols);
      sheet.getRange(1, 1, 1, cols.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      created.push(tabName);
    } else {
      ensureTabHeaders(sheet, cols);
    }
  }

  // Non-destructively seed default System_Config control switches if missing
  try {
    var scSheet = ss.getSheetByName("System_Config");
    if (scSheet) {
      var scData = scSheet.getDataRange().getValues();
      var existingKeys = {};
      for (var s = 1; s < scData.length; s++) {
        var ek = String(scData[s][0] || "").trim();
        if (ek) existingKeys[ek] = true;
      }
      var nowIso = new Date().toISOString();
      var defaults = [
        ["GLOBAL_SYNC_DISABLED", "FALSE", "Master emergency kill-switch for all sync endpoints"],
        ["MAINTENANCE_MODE", "FALSE", "Set TRUE to pause hot-path sync during upgrades"],
        ["MAX_ENVELOPES_PER_BATCH", "50", "Maximum SyncEnvelopes accepted per push_envelopes call"],
        ["RATE_LIMIT_PER_MIN", "120", "Per-tenant hot-path request cap per minute"],
        ["REQUIRE_JWT", "FALSE", "Set TRUE after all terminals upgrade to V7.0 JWT login"]
      ];
      for (var d = 0; d < defaults.length; d++) {
        if (!existingKeys[defaults[d][0]]) {
          scSheet.appendRow([defaults[d][0], defaults[d][1], defaults[d][2], nowIso]);
        }
      }
    }
  } catch (eCfg) {}

  // Non-destructively backfill Global_Users from existing companies tab if Global_Users is empty
  try {
    var guSheet = ss.getSheetByName("Global_Users");
    var cSheet = ss.getSheetByName("companies");
    if (guSheet && cSheet && guSheet.getLastRow() < 2 && cSheet.getLastRow() >= 2) {
      var cVals = cSheet.getDataRange().getValues();
      var ch = cVals[0];
      var cidIdx = ch.indexOf("company_id");
      var emailIdx = ch.indexOf("owner_email");
      var nameIdx = ch.indexOf("owner_name");
      var pwIdx = ch.indexOf("password_hash");
      var guHeaders = guSheet.getRange(1, 1, 1, guSheet.getLastColumn()).getValues()[0];
      var nowGu = new Date().toISOString();
      for (var r = 1; r < cVals.length; r++) {
        var cid = cidIdx !== -1 ? String(cVals[r][cidIdx] || "").trim() : "";
        var em = emailIdx !== -1 ? String(cVals[r][emailIdx] || "").trim().toLowerCase() : "";
        if (!cid || !em) continue;
        writeRowByHeaders(guSheet, guHeaders, {
          user_id: "USR-" + cid + "-OWNER",
          email: em,
          password_hash: pwIdx !== -1 ? String(cVals[r][pwIdx] || "") : "",
          company_id: cid,
          role: "OWNER",
          full_name: nameIdx !== -1 ? String(cVals[r][nameIdx] || "Owner") : "Owner",
          branch_id: "BR-MAIN",
          is_active: true,
          updated_at: nowGu
        });
      }
    }
  } catch (eGu) {}

  return created;
}

function checkDailyMasterTabs(ss) {
  var today = new Date().toISOString().split("T")[0];
  var lastCheck = CACHE.get("master_tabs_checked_" + today);
  if (lastCheck) return;
  ensureAllMasterTabsExist(ss);
  CACHE.put("master_tabs_checked_" + today, "1", CACHE_TTL_SEC);
}

function setupMasterSheets() {
  var ss = getMasterSpreadsheet();
  var created = ensureAllMasterTabsExist(ss);
  return {
    success: true,
    version: CODE_GS_VERSION,
    spreadsheet_id: ss.getId(),
    created: created,
    message: "Existing Master Sheet verified & upgraded non-destructively to " + CODE_GS_VERSION
  };
}

function setupSheets() {
  return setupMasterSheets();
}

function setupTenantSpreadsheetTabs(ss, companyId, companyName) {
  var created = [];
  for (var tabName in TAB_TEMPLATES) {
    if (!TAB_TEMPLATES.hasOwnProperty(tabName)) continue;
    if (MASTER_TAB_NAMES.indexOf(tabName) !== -1) continue;
    var sheet = ss.getSheetByName(tabName);
    var headers = TAB_TEMPLATES[tabName];
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      created.push(tabName);
    } else {
      ensureTabHeaders(sheet, headers);
    }
  }
  return created;
}

function readTenantMeta(ss) {
  var meta = {};
  if (!ss) return meta;
  try {
    var sh = ss.getSheetByName("_TenantMeta");
    if (!sh || sh.getLastRow() < 2) return meta;
    var vals = sh.getDataRange().getValues();
    for (var i = 1; i < vals.length; i++) {
      var k = String(vals[i][0] || "").trim();
      if (k) meta[k] = String(vals[i][1] !== undefined ? vals[i][1] : "").trim();
    }
  } catch (e) {}
  return meta;
}

function writeTenantMeta(ss, updates) {
  if (!ss || !updates) return;
  var sh = ss.getSheetByName("_TenantMeta");
  var cols = TAB_TEMPLATES["_TenantMeta"];
  if (!sh) {
    sh = ss.insertSheet("_TenantMeta");
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  }
  var vals = sh.getLastRow() >= 1 ? sh.getDataRange().getValues() : [cols];
  var rowMap = {};
  for (var i = 1; i < vals.length; i++) {
    var existingKey = String(vals[i][0] || "").trim();
    if (existingKey) rowMap[existingKey] = i + 1;
  }
  var nowIso = new Date().toISOString();
  for (var k in updates) {
    if (!updates.hasOwnProperty(k)) continue;
    var val = String(updates[k] !== undefined && updates[k] !== null ? updates[k] : "");
    if (rowMap[k]) {
      sh.getRange(rowMap[k], 2, 1, 2).setValues([[val, nowIso]]);
    } else {
      sh.appendRow([k, val, nowIso]);
    }
  }
}

function pruneRequestLogIfNeeded(ss) {
  try {
    var countKey = "req_log_write_count";
    var n = Number(CACHE.get(countKey) || "0") + 1;
    CACHE.put(countKey, String(n), 3600);
    if (n % 50 !== 0) return;

    var logSheet = ss.getSheetByName("request_log");
    if (!logSheet) return;
    var lastRow = logSheet.getLastRow();
    if (lastRow <= 1001) return;
    var cutoff = Date.now() - 7 * 86400000;
    var vals = logSheet.getRange(2, 1, lastRow - 1, Math.min(5, logSheet.getLastColumn())).getValues();
    var deleteCount = 0;
    for (var i = 0; i < vals.length - 500; i++) {
      var ts = parseTimestampMsSafe(vals[i][3]);
      if (ts > 0 && ts < cutoff) {
        deleteCount++;
      } else {
        break;
      }
    }
    if (deleteCount > 0) {
      logSheet.deleteRows(2, deleteCount);
    }
  } catch (e) {}
}

function backfillSchemaColumns(ss, sheetName) {
  var canonical = SHEET_ALIASES[sheetName] || sheetName;
  var sheet = ss.getSheetByName(canonical);
  if (!sheet) {
    sheet = ss.insertSheet(canonical);
  }
  var headers = TAB_TEMPLATES[canonical];
  if (headers) {
    ensureTabHeaders(sheet, headers);
  }
  return sheet;
}

// ============================================================================
// 3. MULTI-TENANT COMPANY & PERMISSIONS LOOKUP + CACHING
// ============================================================================

function getCompany(companyId, ss) {
  if (!companyId) return null;
  var cacheKey = "comp_" + String(companyId).trim().toUpperCase();
  var cached = CACHE.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  ss = ss || getMasterSpreadsheet();
  var sheet = ss.getSheetByName("companies");
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  var headers = data[0];
  var idCol = headers.indexOf("company_id");
  if (idCol === -1) idCol = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]).trim().toUpperCase() === String(companyId).trim().toUpperCase()) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        obj[headers[c]] = data[i][c];
      }
      obj._rowIndex = i + 1;
      putCacheSafe(cacheKey, JSON.stringify(obj));
      return obj;
    }
  }
  return null;
}

function getSheetId(companyId, ss) {
  var comp = getCompany(companyId, ss);
  return comp && comp.sheet_id ? String(comp.sheet_id).trim() : "";
}

function invalidateCompanyCache(companyId) {
  if (companyId) {
    var upper = String(companyId).trim().toUpperCase();
    CACHE.remove("comp_" + companyId);
    CACHE.remove("comp_" + upper);
    CACHE.remove("route:" + upper);
    CACHE.remove("perms_" + companyId);
    CACHE.remove("primary_branch_" + companyId);
  }
}

function getTenantPrimaryBranch(companyId, ss) {
  var cacheKey = "primary_branch_" + companyId;
  var cached = CACHE.get(cacheKey);
  if (cached) return cached;
  ss = ss || getMasterSpreadsheet();
  var bSheet = ss.getSheetByName("branches");
  if (!bSheet || bSheet.getLastRow() < 2) return "BR-MAIN";
  var data = bSheet.getDataRange().getValues();
  var h = data[0];
  var cCol = h.indexOf("company_id");
  var idCol = h.indexOf("branch_id");
  var mainCol = h.indexOf("is_main");
  var fallback = "BR-MAIN";
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cCol]).trim().toUpperCase() === String(companyId).trim().toUpperCase()) {
      var bid = String(data[i][idCol] || "BR-MAIN").trim();
      if (fallback === "BR-MAIN") fallback = bid;
      if (mainCol !== -1 && (data[i][mainCol] === true || String(data[i][mainCol]).toUpperCase() === "TRUE")) {
        CACHE.put(cacheKey, bid, CACHE_TTL_SEC);
        return bid;
      }
    }
  }
  CACHE.put(cacheKey, fallback, CACHE_TTL_SEC);
  return fallback;
}

function getUserPermissions(companyId, role, ss) {
  ss = ss || getMasterSpreadsheet();
  var pSheet = ss.getSheetByName("permissions");
  var result = {};
  if (!pSheet || pSheet.getLastRow() < 2) return result;
  var data = pSheet.getDataRange().getValues();
  var h = data[0];
  var cIdx = h.indexOf("company_id");
  var rIdx = h.indexOf("role");
  var mIdx = h.indexOf("module");
  var aIdx = h.indexOf("action");
  var alIdx = h.indexOf("allowed");
  var targetRole = String(role || "").toUpperCase();
  for (var i = 1; i < data.length; i++) {
    var rowComp = String(data[i][cIdx] || "").trim().toUpperCase();
    var rowRole = String(data[i][rIdx] || "").trim().toUpperCase();
    if ((rowComp === String(companyId).toUpperCase() || rowComp === "DEFAULT") && rowRole === targetRole) {
      var mod = String(data[i][mIdx] || "").trim();
      var act = String(data[i][aIdx] || "").trim();
      if (!result[mod]) result[mod] = {};
      result[mod][act] = data[i][alIdx] === true || String(data[i][alIdx]).toUpperCase() === "TRUE";
    }
  }
  return result;
}

function hasPermission(companyId, role, module, action, ss) {
  var r = String(role || "").toUpperCase();
  if (r === "OWNER" || r === "SUPER_ADMIN") return true;
  var perms = getUserPermissions(companyId, r, ss);
  if (perms[module] && perms[module][action] !== undefined) {
    return Boolean(perms[module][action]);
  }
  return false;
}

function hashPasswordSha256(rawText) {
  if (!rawText) return "";
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(rawText), Utilities.Charset.UTF_8);
  var hex = "";
  for (var i = 0; i < digest.length; i++) {
    var byteVal = digest[i];
    if (byteVal < 0) byteVal += 256;
    var s = byteVal.toString(16);
    if (s.length === 1) s = "0" + s;
    hex += s;
  }
  return hex;
}

function timingSafeEqualStr_(a, b) {
  var sa = String(a || "");
  var sb = String(b || "");
  if (!sa || sa.length !== sb.length) return false;
  var diff = 0;
  for (var i = 0; i < sa.length; i++) {
    diff |= (sa.charCodeAt(i) ^ sb.charCodeAt(i));
  }
  return diff === 0;
}

function verifyPasswordHashWithSalt_(rawPassword, storedHash, storedSalt) {
  var pwd = String(rawPassword || "").trim();
  var h = String(storedHash || "").trim();
  var s = String(storedSalt || "").trim();
  if (!pwd || !h) return false;
  var hLower = h.toLowerCase();
  if (s) {
    var salted = hashPasswordSha256(s + ":" + pwd);
    if (timingSafeEqualStr_(salted, hLower)) return true;
  }
  if (h.indexOf(":") !== -1) {
    var parts = h.split(":");
    if (parts.length === 2 && parts[0] && parts[1]) {
      var inlineSalted = hashPasswordSha256(parts[0] + ":" + pwd);
      if (timingSafeEqualStr_(inlineSalted, parts[1].toLowerCase())) return true;
    }
  }
  var unsalted = hashPasswordSha256(pwd);
  if (timingSafeEqualStr_(unsalted, hLower)) return true;
  if (!/^[0-9a-f]{64}$/i.test(h) && timingSafeEqualStr_(pwd, h)) return true;
  return false;
}

function logAudit(ss, companyId, branchId, userId, userName, role, action, module, details) {
  try {
    var sheet = getOrCreateMonthlySheet(ss, "AuditLog", new Date().toISOString().split("T")[0]);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var nowIso = new Date().toISOString();
    var id = "AUD-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6);
    var rec = {
      AuditID: id,
      CompanyID: companyId || TENANT_COMPANY_ID,
      BranchID: branchId || "BR-MAIN",
      BranchName: branchId || "BR-MAIN",
      Timestamp: nowIso,
      Date: nowIso.split("T")[0],
      UserID: userId || "SYSTEM",
      UserName: userName || "System",
      AuthorizedByName: userName || "System",
      Role: role || "SYSTEM",
      Action: action,
      Module: module,
      EntityID: id,
      Details: typeof details === "string" ? details : JSON.stringify(details || {}),
      IPOrDevice: "APPS_SCRIPT",
      Status: "SUCCESS",
      entity_type: "audit_log",
      entity_id: id,
      version: 1,
      mutation_source: "SERVER_AUDIT",
      client_updated_at: nowIso,
      server_updated_at: nowIso,
      server_seq: allocateNextServerSeq(ss, companyId),
      is_deleted: false,
      server_received_at: nowIso,
      suspicious_backdate: false,
      payload_json: ""
    };
    writeRowByHeaders(sheet, headers, rec);
  } catch (e) {}
}

// ============================================================================
// 4. WEB APP ENTRYPOINTS (doGet / doPost) WITH ZERO-MASTER-OPEN HOT PATH
// ============================================================================

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var actionNorm = String(params.action || "ping").trim().toLowerCase();

  try {
    if (actionNorm === "ping" || actionNorm === "health") {
      return jsonResponse({
        success: true,
        status: "online",
        version: CODE_GS_VERSION,
        schema_version: CURRENT_TENANT_SCHEMA_VERSION,
        server_time: new Date().toISOString(),
        company_id: TENANT_COMPANY_ID
      });
    }

    if (HOT_PATH_ACTIONS.indexOf(actionNorm) !== -1) {
      var hp = resolveHotPathContext(params, actionNorm);
      if (!hp.ok) return jsonResponse(hp.response);

      var hpComp = hp.companyId;
      var hpBr = String(params.branch_id || params.branchId || "ALL").trim();
      var hpRes;
      switch (actionNorm) {
        case "get_inventory":
          hpRes = handleGetInventory(params, hp.masterSs, hp.targetSs, hpComp);
          break;
        case "get_stock":
          hpRes = handleGetStock(params, hp.targetSs, hp.masterSs);
          break;
        case "get_data":
          hpRes = handleGetData(params, hp.targetSs, hp.masterSs);
          break;
        case "pull_catchup":
          hpRes = handlePullCatchup(params, hp.masterSs, hp.targetSs, hpComp, hpBr);
          break;
        default:
          return jsonResponse({ success: false, error: "Unsupported GET hot-path action: " + actionNorm });
      }
      if (hpRes && typeof hpRes === "object") {
        hpRes.routing_epoch = hp.routingEpoch;
      }
      return jsonResponse(hpRes);
    }

    // Master Control Plane GET actions
    var masterSs = getMasterSpreadsheet();
    checkDailyMasterTabs(masterSs);

    switch (actionNorm) {
      case "setup_sheets":
      case "init_master_sheet":
        return jsonResponse(setupMasterSheets());
      case "get_tenant_context":
        return jsonResponse(handleGetTenantContext(params, masterSs));
      case "get_users_since":
        return jsonResponse(handleGetUsersSince(params, masterSs));
      case "get_branches_since":
        return jsonResponse(handleGetBranchesSince(params, masterSs));
      case "lookup_company":
        return jsonResponse(handleLookupCompany(params, masterSs));
      case "lookup_branch":
        return jsonResponse(handleLookupBranch(params, masterSs));
      case "schema_health_check":
        return jsonResponse(handleSchemaHealthCheck(params, masterSs));
      case "get_companies":
        return jsonResponse(handleGetCompanies(params, masterSs));
      case "get_users":
        return jsonResponse(handleGetUsers(params, masterSs));
      case "refresh_token":
        return jsonResponse(handleRefreshToken(params, masterSs));
      default:
        return jsonResponse({ success: false, error: "Unsupported GET action: " + actionNorm });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err && err.message ? err.message : String(err) });
  }
}

function doPost(e) {
  var req = {};
  try {
    if (e && e.postData && e.postData.contents) {
      req = JSON.parse(e.postData.contents);
    }
  } catch (parseErr) {
    return jsonResponse({ success: false, error: "Invalid JSON payload: " + parseErr.message });
  }

  var actionNorm = String(req.action || (req.data && req.data.action) || "").trim().toLowerCase();
  if (!actionNorm) {
    return jsonResponse({ success: false, error: "Missing action in POST body" });
  }
  if (actionNorm === "ping" || actionNorm === "health") {
    return jsonResponse({
      success: true,
      status: "online",
      version: CODE_GS_VERSION,
      schema_version: CURRENT_TENANT_SCHEMA_VERSION,
      server_time: new Date().toISOString(),
      company_id: TENANT_COMPANY_ID
    });
  }

  var clientRequestId = String(req.clientRequestId || req.requestId || "").trim();
  var isWrite = WRITE_ACTIONS.indexOf(actionNorm) !== -1;

  if (isWrite && clientRequestId && actionNorm !== "push_envelopes") {
    var reqCacheKey = "req_done_" + clientRequestId;
    var prevRes = CACHE.get(reqCacheKey);
    if (prevRes) {
      try { return jsonResponse(JSON.parse(prevRes)); } catch (e2) {}
    }
  }

  // =========================================================================
  // HOT-PATH BRANCH (Zero Master Sheet Opens when JWT / Route Cached)
  // =========================================================================
  if (HOT_PATH_ACTIONS.indexOf(actionNorm) !== -1) {
    var hp = resolveHotPathContext(req, actionNorm);
    if (!hp.ok) return jsonResponse(hp.response);

    var companyIdHp = hp.companyId;
    var branchIdHp = String(req.branch_id || req.branchId || (req.data && (req.data.branch_id || req.data.branchId)) || "BR-MAIN").trim();
    var targetSsHp = hp.targetSs;
    var masterSsOpt = hp.masterSs; // null on valid cached hot-path calls!
    var tenantLease = null;

    // Reads like pull_catchup / get_inventory / get_data / get_stock are LOCK-FREE
    var needsTenantLock = isWrite && actionNorm !== "pull_catchup" && actionNorm !== "get_data" && actionNorm !== "get_inventory" && actionNorm !== "get_stock";

    try {
      if (needsTenantLock) {
        tenantLease = acquireTenantLease(companyIdHp, 16000);
        if (!tenantLease.acquired) {
          return jsonResponse(tenantLease);
        }
      }

      var hpResult;
      switch (actionNorm) {
        case "push_envelopes":
          hpResult = handlePushEnvelopes(req, masterSsOpt, targetSsHp, companyIdHp, branchIdHp);
          break;
        case "pull_catchup":
          hpResult = handlePullCatchup(req, masterSsOpt, targetSsHp, companyIdHp, branchIdHp);
          break;
        case "get_data":
          hpResult = handleGetData(req, targetSsHp, masterSsOpt);
          break;
        case "get_inventory":
          hpResult = handleGetInventory(req, masterSsOpt, targetSsHp, companyIdHp);
          break;
        case "get_stock":
          hpResult = handleGetStock(req, targetSsHp, masterSsOpt);
          break;
        case "add_direct_grv":
          hpResult = handleAddDirectGRV(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "approve_direct_grv":
          hpResult = handleApproveDirectGRV(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "submit_eod":
          hpResult = handleSubmitEOD(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "approve_eod":
          hpResult = handleApproveEOD(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "add_sale":
        case "sync_sale":
          hpResult = handleAddSale(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "insert":
        case "generic_insert":
          hpResult = handleGenericInsert(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "update":
        case "generic_update":
        case "upsert":
          hpResult = handleGenericUpdate(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "delete":
        case "generic_delete":
          hpResult = handleGenericDelete(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "receive_stock":
          hpResult = handleReceiveStock(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "sell_stock":
          hpResult = handleSellStock(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "break_case":
          hpResult = handleBreakCase(req, targetSsHp, masterSsOpt, companyIdHp, branchIdHp);
          break;
        case "sync_inventory":
        case "upsert_product":
          hpResult = handleSyncInventory(req, masterSsOpt, targetSsHp, companyIdHp, branchIdHp);
          break;
        case "batch_sync_writes":
          hpResult = handleBatchSyncWrites(req, masterSsOpt, targetSsHp, companyIdHp, branchIdHp);
          break;
        case "seed_sample_data":
          hpResult = seedSampleData(req, targetSsHp, companyIdHp, branchIdHp);
          break;
        case "sync_entity":
        case "sync_customer":
        case "stocktake_blind_submit":
        case "unlock_stocktake_segment":
        case "save_stocktake_segment":
        case "claim_stocktake_zone":
        case "propose_joint_recount":
        case "finalize_joint_recount":
        case "approve_stocktake":
          hpResult = handleLegacyActionAsEnvelope(actionNorm, req, masterSsOpt, targetSsHp, companyIdHp, branchIdHp);
          break;
        default:
          hpResult = { success: false, error: "Unknown hot-path action: " + actionNorm };
      }

      if (hpResult && typeof hpResult === "object") {
        hpResult.routing_epoch = hp.routingEpoch;
        if (!hpResult.spreadsheet_id) hpResult.spreadsheet_id = hp.spreadsheetId;
      }

      if (isWrite && clientRequestId && hpResult && hpResult.success !== false && actionNorm !== "push_envelopes") {
        putCacheSafe("req_done_" + clientRequestId, JSON.stringify(hpResult), 3600);
      }

      return jsonResponse(hpResult);
    } catch (hpErr) {
      return jsonResponse({
        success: false,
        error: hpErr && hpErr.message ? hpErr.message : String(hpErr)
      });
    } finally {
      releaseTenantLease(tenantLease);
    }
  }

  // =========================================================================
  // MASTER CONTROL PLANE BRANCH (ScriptLock reserved for Control Plane only)
  // =========================================================================
  var masterSs = getMasterSpreadsheet();
  checkDailyMasterTabs(masterSs);

  var companyId = String(req.company_id || req.companyId || (req.data && (req.data.company_id || req.data.companyId)) || TENANT_COMPANY_ID).trim();
  var branchId = String(req.branch_id || req.branchId || (req.data && (req.data.branch_id || req.data.branchId)) || "BR-MAIN").trim();
  var targetSs = resolveTargetSpreadsheet(masterSs, companyId, req.tenant_sheet_id || req.sheet_id);

  var controlWriteLockActions = {
    "signup_company": true, "create_branch": true, "upsert_staff": true, "sync_staff_member": true,
    "confirm_payment": true, "extend_trial": true, "sync_company": true,
    "bulk_sync_companies": true, "sync_companies_bulk": true,
    "provision_tenant_sheet": true, "initialize_tenant_sheet": true, "init_tenant_tabs": true,
    "allocate_tenant": true, "migrate_tenant": true, "merge_duplicate_companies": true,
    "generate_master_template": true, "run_fleet_migration": true, "bump_routing_epoch": true
  };

  var lock = LockService.getScriptLock();
  var acquiredLock = false;
  try {
    if (controlWriteLockActions[actionNorm]) {
      lock.waitLock(25000);
      acquiredLock = true;
    }

    var result;
    switch (actionNorm) {
      case "signup_company":
        result = handleSignup(req, masterSs);
        break;
      case "login_owner":
        result = handleOwnerLogin(req, masterSs);
        break;
      case "login_staff":
        result = handleStaffLogin(req, masterSs);
        break;
      case "login":
        result = handleLogin(req, masterSs);
        break;
      case "refresh_token":
        result = handleRefreshToken(req, masterSs);
        break;
      case "create_branch":
        result = handleCreateBranch(req, masterSs);
        break;
      case "upsert_staff":
      case "sync_staff_member":
        result = handleUpsertStaff(req, masterSs, targetSs, companyId, branchId);
        break;
      case "get_tenant_context":
        result = handleGetTenantContext(req, masterSs);
        break;
      case "get_users_since":
        result = handleGetUsersSince(req, masterSs);
        break;
      case "get_branches_since":
        result = handleGetBranchesSince(req, masterSs);
        break;
      case "lookup_company":
        result = handleLookupCompany(req, masterSs);
        break;
      case "lookup_branch":
        result = handleLookupBranch(req, masterSs);
        break;
      case "schema_health_check":
        result = handleSchemaHealthCheck(req, masterSs);
        break;
      case "migrate_tenant":
        result = handleMigrateTenant(req, masterSs);
        break;
      case "merge_duplicate_companies":
        result = handleMergeDuplicateCompanies(req, masterSs);
        break;
      case "confirm_payment":
        result = handleConfirmPayment(req, masterSs);
        break;
      case "extend_trial":
        result = handleExtendTrial(req, masterSs);
        break;
      case "setup_sheets":
      case "init_master_sheet":
        result = setupMasterSheets();
        break;
      case "get_companies":
        result = handleGetCompanies(req, masterSs);
        break;
      case "get_users":
        result = handleGetUsers(req, masterSs);
        break;
      case "sync_company":
        result = handleSyncCompany(req, masterSs);
        break;
      case "bulk_sync_companies":
      case "sync_companies_bulk":
        result = handleBulkSyncCompanies(req, masterSs);
        break;
      case "provision_tenant_sheet":
      case "initialize_tenant_sheet":
      case "init_tenant_tabs":
        result = handleProvisionTenantSheet(req, masterSs);
        break;
      case "allocate_tenant":
        result = provisionTenantFromTemplate(req, masterSs);
        break;
      case "generate_master_template":
        result = generateMasterTemplate(req, masterSs);
        break;
      case "run_fleet_migration":
        result = runFleetMigration(req, masterSs);
        break;
      case "bump_routing_epoch":
        result = handleBumpRoutingEpoch(req, masterSs);
        break;
      case "purge_test_companies":
        result = handlePurgeTestCompanies(req, masterSs);
        break;
      case "delete_company":
        result = handleDeleteCompany(req, masterSs);
        break;
      default:
        result = { success: false, error: "Unknown action: " + actionNorm };
    }

    if (isWrite && clientRequestId && result && result.success !== false) {
      try {
        putCacheSafe("req_done_" + clientRequestId, JSON.stringify(result), 3600);
        var logSheet = masterSs.getSheetByName("request_log");
        if (logSheet) {
          logSheet.appendRow([clientRequestId, actionNorm, companyId, new Date().toISOString(), "OK"]);
          pruneRequestLogIfNeeded(masterSs);
        }
      } catch (e3) {}
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err && err.message ? err.message : String(err)
    });
  } finally {
    if (acquiredLock) {
      try { lock.releaseLock(); } catch (e4) {}
    }
  }
}

// ============================================================================
// 5. V6.0/V7.0 CANONICAL ENVELOPE ENGINE (`push_envelopes` & `pull_catchup`)
// ============================================================================

function resolveTabForEntityType(entityType, data, explicitTab) {
  var cleanExplicit = explicitTab ? (SHEET_ALIASES[explicitTab] || explicitTab) : "";
  if (cleanExplicit && TAB_TEMPLATES[cleanExplicit]) {
    return cleanExplicit;
  }
  var norm = String(entityType || "").trim().toLowerCase();
  if (ENTITY_TO_TAB[norm]) return ENTITY_TO_TAB[norm];
  if (cleanExplicit) return cleanExplicit;
  return "AuditLog";
}

function firstNonEmptyVal_(arr) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] !== undefined && arr[i] !== null && String(arr[i]).trim() !== "") {
      return String(arr[i]).trim();
    }
  }
  return "";
}

function extractEntityIdFromPayload(entityType, entityId, d) {
  var normType = String(entityType || "").trim().toLowerCase();
  var cleanEnvId = entityId !== undefined && entityId !== null ? String(entityId).trim() : "";

  if (d && typeof d === "object") {
    // Heal legacy corrupted inventory envelopes where entityId was mistakenly set to "USR-001"
    if (normType === "inventory_item") {
      var invId = firstNonEmptyVal_([d.itemId, d.ItemID, d.ProductID, d.productId, d.id]);
      if (invId) return invId;
    }
    if (cleanEnvId) return cleanEnvId;

    // Entity-specific primary ID extraction FIRST (never allow user_id to hijack non-staff records)
    switch (normType) {
      case "sale":
        return firstNonEmptyVal_([d.InvoiceID, d.invoice_id, d.invoiceId, d.id, d.entityId]);
      case "customer":
        return firstNonEmptyVal_([d.customerId, d.CustomerID, d.id, d.entityId]);
      case "customer_change":
        return firstNonEmptyVal_([d.changeId, d.ChangeID, d.id, d.Reference, d.reference, d.entityId]);
      case "credit_sale":
        return firstNonEmptyVal_([d.creditId, d.CreditID, d.id, d.entityId]);
      case "credit_group":
        return firstNonEmptyVal_([d.groupId, d.GroupID, d.id, d.entityId]);
      case "expense":
        return firstNonEmptyVal_([d.ExpenseID, d.expenseId, d.id, d.entityId]);
      case "cash_log":
        return firstNonEmptyVal_([d.LogID, d.logId, d.id, d.entityId]);
      case "cash_lift":
        return firstNonEmptyVal_([d.LiftID, d.liftId, d.id, d.entityId]);
      case "cash_movement":
        return firstNonEmptyVal_([d.MovementID, d.movementId, d.id, d.entityId]);
      case "cash_account":
        return firstNonEmptyVal_([d.account_id, d.AccountID, d.accountId, d.id, d.entityId]);
      case "cash_transfer":
        return firstNonEmptyVal_([d.transfer_id, d.TransferID, d.transferId, d.id, d.entityId]);
      case "direct_grv":
        return firstNonEmptyVal_([d.grvNumber, d.GRVNumber, d.GRVID, d.id, d.entityId]);
      case "goods_received":
        return firstNonEmptyVal_([d.grnId, d.GRNID, d.id, d.reference, d.entityId]);
      case "stock_movement":
        return firstNonEmptyVal_([d.movementId, d.txnId, d.MovementID, d.id, d.entityId]);
      case "reconciliation":
        return firstNonEmptyVal_([d.ReconID, d.reconId, d.id, d.entityId]);
      case "supplier":
        return firstNonEmptyVal_([d.supplierId, d.SupplierID, d.id, d.entityId]);
      case "supplier_invoice_voucher":
        return firstNonEmptyVal_([d.voucherId, d.VoucherID, d.id, d.entityId]);
      case "staff":
        return firstNonEmptyVal_([d.id, d.UserID, d.user_id, d.staffId, d.entityId]);
      case "branch":
        return firstNonEmptyVal_([d.branchId, d.BranchID, d.branch_id, d.id, d.entityId]);
      case "audit_log":
      case "supervisor_approval":
        return firstNonEmptyVal_([d.AuditID, d.auditId, d.id, d.entityId]);
      case "branch_lockdown":
        return firstNonEmptyVal_([d.branchId, d.branch_id, d.BranchID]) || "BR-MAIN";
      case "multi_currency":
        return "MULTI_CURRENCY_CONFIG";
      case "permissions_matrix":
        return "PERMISSIONS_MATRIX";
      case "role_configs":
        return "ROLE_CONFIGS";
      case "system_settings":
        return "SYSTEM_SETTINGS";
      case "sheets_config":
        return "SHEETS_CONFIG";
      case "inventory_category":
        return firstNonEmptyVal_([d.categoryId, d.CategoryID, d.id, d.name]) || "CATEGORIES_SNAPSHOT";
      case "casual_worker":
        if (Array.isArray(d)) return "CASUAL_WORKERS_BATCH";
        return firstNonEmptyVal_([d.casualId, d.CasualID, d.id, d.entityId]);
      default:
        break;
    }

    // Generic fallback WITHOUT user_id/staffId so logged-in user_id never hijacks operational rows
    var fallback = firstNonEmptyVal_([
      d.id, d.entityId, d.itemId, d.ItemID, d.ProductID, d.InvoiceID, d.invoice_id,
      d.ExpenseID, d.expenseId, d.LogID, d.logId, d.customerId, d.CustomerID,
      d.CreditID, d.creditId, d.ChangeID, d.changeId, d.GRNID, d.grnId, d.grvNumber,
      d.account_id, d.AccountID, d.transfer_id, d.TransferID, d.supplierId, d.SupplierID,
      d.voucherId, d.VoucherID, d.ReconID, d.sessionId, d.segmentId, d.zoneId, d.ZoneID,
      d.casualId, d.CasualID, d.unlockId, d.proposalId, d.branchId, d.branch_id, d.key
    ]);
    if (fallback) return fallback;
  }

  if (cleanEnvId) return cleanEnvId;
  if (normType === "branch_lockdown") return "BR-MAIN";
  if (normType === "multi_currency") return "MULTI_CURRENCY_CONFIG";
  if (normType === "permissions_matrix") return "PERMISSIONS_MATRIX";
  if (normType === "role_configs") return "ROLE_CONFIGS";
  if (normType === "system_settings") return "SYSTEM_SETTINGS";
  if (normType === "sheets_config") return "SHEETS_CONFIG";
  if (normType === "inventory_category") return "CATEGORIES_SNAPSHOT";
  if (normType === "casual_worker" && Array.isArray(d)) return "CASUAL_WORKERS_BATCH";
  return "";
}

function buildRowObjectForEntity(entityType, entityId, d, envelope, metaObj, serverSeq, compId, branchId) {
  var obj = {};
  var isoClientUpdated = envelope.updatedAt ? new Date(Number(envelope.updatedAt)).toISOString() : new Date().toISOString();
  var isoServerNow = new Date().toISOString();
  var cleanPayload = sanitizePayloadForCloud(entityType, d);

  obj.CompanyID = compId;
  obj.company_id = compId;
  obj.BranchID = branchId;
  obj.branch_id = branchId;
  obj.BranchName = (d && (d.branchName || d.BranchName)) || branchId;

  if (d && typeof d === "object" && !Array.isArray(d)) {
    for (var k in d) {
      if (d.hasOwnProperty(k) && k !== "pin" && k !== "rawPin" && k !== "password") {
        obj[k] = d[k];
      }
    }
  }

  switch (entityType) {
    case "sale":
      var saleTotalVal = d.total !== undefined ? Number(d.total) : (d.Total !== undefined ? Number(d.Total) : 0);
      var saleSubVal = d.subtotal !== undefined ? Number(d.subtotal) : (d.Subtotal !== undefined ? Number(d.Subtotal) : saleTotalVal);
      var saleDiscVal = d.discount !== undefined ? Number(d.discount) : (d.Discount !== undefined ? Number(d.Discount) : 0);
      var saleItemsSum = d.itemsSummary || d.ItemsSummary || "";
      if (!saleItemsSum && Array.isArray(d.items) && d.items.length > 0) {
        saleItemsSum = d.items.map(function(it) {
          return (Number(it && it.quantity) || 1) + "x " + ((it && (it.name || it.itemName)) || "Item");
        }).join(", ");
      }
      var saleTotalQty = d.totalQty !== undefined ? d.totalQty : (d.TotalQty !== undefined ? d.TotalQty : "");
      if (saleTotalQty === "" && Array.isArray(d.items) && d.items.length > 0) {
        var qSum = 0;
        for (var qi = 0; qi < d.items.length; qi++) {
          qSum += Number((d.items[qi] && d.items[qi].quantity) || 0);
        }
        saleTotalQty = qSum;
      }
      var saleTs = d.timestamp || d.Timestamp || isoClientUpdated;
      var saleDate = d.date || d.Date || (typeof saleTs === "string" && /^\d{4}-\d{2}-\d{2}/.test(saleTs) ? saleTs.slice(0, 10) : isoServerNow.split("T")[0]);
      obj.InvoiceID = entityId;
      obj.Date = saleDate;
      obj.Timestamp = saleTs;
      obj.Time = d.time || d.Time || "";
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.CustomerName = d.customerName || d.CustomerName || "Walk-in";
      obj.ItemsSummary = saleItemsSum;
      obj.TotalQty = saleTotalQty;
      obj.Subtotal = saleSubVal;
      obj.Discount = saleDiscVal;
      obj.Total = saleTotalVal;
      obj.TaxAmount = Number(d.taxAmount !== undefined ? d.taxAmount : (d.TaxAmount !== undefined ? d.TaxAmount : 0));
      obj.PaymentMethod = d.paymentMethod || d.PaymentMethod || "Cash";
      obj.Currency = d.currency || d.Currency || "USD";
      obj.ExchangeRate = Number(d.exchangeRate !== undefined ? d.exchangeRate : (d.ExchangeRate !== undefined ? d.ExchangeRate : (d.exchange_rate || 1)));
      obj.AmountTendered = Number(d.amountTendered !== undefined ? d.amountTendered : (d.AmountTendered !== undefined ? d.AmountTendered : saleTotalVal));
      obj.ChangeGiven = Number(d.changeGiven !== undefined ? d.changeGiven : (d.ChangeGiven !== undefined ? d.ChangeGiven : 0));
      obj.Status = d.status || d.Status || "Completed";
      obj.ReceiptHash = d.receiptHash || d.ReceiptHash || "";
      obj.Notes = d.notes || d.Notes || "";
      obj.SyncedAt = isoServerNow;
      break;
    case "inventory_item":
      var invCaseSize = Math.max(1, Number(d.caseSize || d.unitsPerCase || d.UnitsPerCase || d.CaseSize || 1) || 1);
      var invSellUnit = Number(
        d.sellPriceUnit !== undefined ? d.sellPriceUnit :
        (d.SellPriceUnit !== undefined ? d.SellPriceUnit :
        (d.SellingPrice !== undefined ? d.SellingPrice :
        (d.price !== undefined ? d.price : 0)))
      );
      var invSellCase = Number(
        d.sellPriceCase !== undefined ? d.sellPriceCase :
        (d.SellPriceCase !== undefined ? d.SellPriceCase : invSellUnit * invCaseSize)
      );
      var invCostUnit = Number(
        d.costPriceUnit !== undefined ? d.costPriceUnit :
        (d.costPerUnit !== undefined ? d.costPerUnit :
        (d.CostPriceUnit !== undefined ? d.CostPriceUnit :
        (d.CostPerUnit !== undefined ? d.CostPerUnit :
        (d.costPrice !== undefined ? d.costPrice :
        (d.CostPrice !== undefined ? d.CostPrice : 0)))))
      );
      var invCostCase = Number(
        d.costPriceCase !== undefined ? d.costPriceCase :
        (d.costPerCase !== undefined ? d.costPerCase :
        (d.CostPriceCase !== undefined ? d.CostPriceCase :
        (d.CostPerCase !== undefined ? d.CostPerCase : invCostUnit * invCaseSize)))
      );
      var invTotalUnits = Number(
        d.totalUnits !== undefined ? d.totalUnits :
        (d.TotalUnits !== undefined ? d.TotalUnits :
        (d.stockQuantity !== undefined ? d.stockQuantity :
        (d.StockQuantity !== undefined ? d.StockQuantity : 0)))
      );
      obj.ProductID = entityId;
      obj.ItemName = d.itemName || d.ItemName || d.name || d.Name || "";
      obj.SKU = d.sku || d.SKU || "";
      obj.Barcode = d.barcode || d.Barcode || "";
      obj.Category = d.category || d.Category || "General";
      obj.UnitType = d.unitType || d.UnitType || d.unit || "Unit";
      obj.CaseSize = invCaseSize;
      obj.SellPriceUnit = invSellUnit;
      obj.SellPriceCase = invSellCase;
      obj.CostPriceUnit = invCostUnit;
      obj.CostPriceCase = invCostCase;
      obj.TotalUnits = invTotalUnits;
      obj.ReorderLevel = Number(
        d.reorderLevelUnits !== undefined ? d.reorderLevelUnits :
        (d.reorderLevel !== undefined ? d.reorderLevel :
        (d.ReorderLevel !== undefined ? d.ReorderLevel : 5))
      );
      obj.SupplierName = d.supplierName || d.SupplierName || "";
      obj.LastUpdated = d.lastUpdated || d.LastUpdated || isoClientUpdated;
      obj.Active = d.active !== false && d.active !== "N" && d.Active !== "N" ? "Y" : "N";
      obj.SyncedAt = isoServerNow;
      break;
    case "staff":
      obj.UserID = entityId;
      obj.user_id = entityId;
      obj.FullName = d.name || d.full_name || d.FullName || "Staff";
      obj.full_name = obj.FullName;
      obj.Role = String(d.role || "CASHIER").toUpperCase();
      obj.role = obj.Role;
      obj.Email = d.email || "";
      obj.email = obj.Email;
      obj.Phone = d.phone || "";
      obj.phone = obj.Phone;
      obj.PinHash = d.pin_hash || d.pinHash || "";
      obj.pin_hash = obj.PinHash;
      obj.PinSalt = d.pin_salt || d.pinSalt || "";
      obj.pin_salt = obj.PinSalt;
      obj.PinVersion = Number(d.pinVersion || d.pin_version || 0);
      obj.pin_version = obj.PinVersion;
      obj.PinUpdatedAt = d.pinUpdatedAt ? new Date(Number(d.pinUpdatedAt)).toISOString() : "";
      obj.pin_updated_at = obj.PinUpdatedAt;
      obj.AssignedBranchIds = JSON.stringify(d.assignedBranchIds || []);
      obj.assigned_branch_ids = obj.AssignedBranchIds;
      obj.branch_assignments_json = JSON.stringify(d.branchAssignments || []);
      obj.permissions_json = JSON.stringify(d.permissions || {});
      obj.Active = (d.active === "N" || d.is_active === false || d.active === false) ? "N" : "Y";
      obj.is_active = obj.Active === "Y";
      obj.UpdatedAt = isoClientUpdated;
      obj.updated_at = isoClientUpdated;
      obj.SyncedAt = isoServerNow;
      break;
    case "branch":
      obj.BranchID = entityId;
      obj.branch_id = entityId;
      obj.BranchName = d.name || d.branch_name || d.branchName || entityId;
      obj.branch_name = obj.BranchName;
      obj.BranchCode = d.code || d.branch_code || entityId;
      obj.branch_code = obj.BranchCode;
      obj.Location = d.location || d.address || "";
      obj.location = obj.Location;
      obj.Address = d.address || d.location || "";
      obj.address = obj.Address;
      obj.IsMain = Boolean(d.is_main || entityId === "BR-MAIN");
      obj.is_main = obj.IsMain;
      obj.IsActive = d.is_active !== false;
      obj.is_active = obj.IsActive;
      obj.Status = obj.IsActive ? "ACTIVE" : "INACTIVE";
      obj.UpdatedAt = isoClientUpdated;
      obj.updated_at = isoClientUpdated;
      obj.SyncedAt = isoServerNow;
      break;
    case "customer":
      obj.CustomerID = entityId;
      obj.CustomerName = d.name || d.Name || d.customerName || d.CustomerName || "";
      obj.Phone = d.phone || d.Phone || "";
      obj.Email = d.email || d.Email || "";
      obj.Address = d.address || d.Address || "";
      obj.CreditLimit = Number(d.creditLimit !== undefined ? d.creditLimit : (d.CreditLimit || 0));
      obj.CurrentBalance = Number(d.currentBalance !== undefined ? d.currentBalance : (d.creditBalance !== undefined ? d.creditBalance : (d.CurrentBalance || 0)));
      obj.ChangeBalance = Number(d.changeBalance !== undefined ? d.changeBalance : (d.ChangeBalance || 0));
      obj.Notes = d.notes || d.Notes || "";
      obj.UpdatedAt = isoClientUpdated;
      obj.SyncedAt = isoServerNow;
      break;
    case "customer_change":
      obj.ChangeID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.CustomerID = d.customerId || d.CustomerID || "";
      obj.CustomerName = d.customerName || d.CustomerName || "";
      obj.In = Number(d.in !== undefined ? d.in : (d.In || 0));
      obj.Out = Number(d.out !== undefined ? d.out : (d.Out || 0));
      obj.BalanceAfter = Number(d.balanceAfter !== undefined ? d.balanceAfter : (d.BalanceAfter || 0));
      obj.InvoiceRef = d.reference || d.Reference || d.invoiceRef || d.InvoiceRef || "";
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.Notes = d.notes || d.Notes || "";
      obj.Status = d.status || d.Status || "Recorded";
      obj.SyncedAt = isoServerNow;
      break;
    case "credit_sale":
      obj.CreditID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.CustomerID = d.customerId || d.CustomerID || "";
      obj.CustomerName = d.customerName || d.CustomerName || "";
      obj.Phone = d.phone || d.Phone || "";
      obj.CreditGroupID = d.creditGroupId || d.CreditGroupID || "";
      obj.Amount = Number(d.amount !== undefined ? d.amount : (d.Amount || 0));
      obj.PaidAmount = Number(d.paidAmount !== undefined ? d.paidAmount : (d.PaidAmount || d.in || d.In || 0));
      obj.In = Number(d.in !== undefined ? d.in : (d.In || 0));
      obj.Out = Number(d.out !== undefined ? d.out : (d.Out !== undefined ? d.Out : obj.Amount));
      obj.Balance = Number(d.balance !== undefined ? d.balance : (d.Balance !== undefined ? d.Balance : Math.max(0, obj.Out - obj.In)));
      obj.DueDate = d.dueDate || d.DueDate || "";
      obj.ItemDescription = d.itemDescription || d.ItemDescription || "";
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.Status = d.status || d.Status || "Outstanding";
      obj.Notes = d.notes || d.Notes || "";
      obj.SyncedAt = isoServerNow;
      break;
    case "cash_log":
      obj.LogID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.AccountID = d.accountId || d.AccountID || "";
      obj.Category = d.category || d.Category || d.line || d.Line || "";
      obj.Description = d.description || d.Description || "";
      obj.In = Number(d.in !== undefined ? d.in : (d.In || 0));
      obj.Out = Number(d.out !== undefined ? d.out : (d.Out || 0));
      obj.Currency = d.currency || d.Currency || "USD";
      obj.PaymentMethod = d.paymentMethod || d.PaymentMethod || "Cash";
      obj.Reference = d.reference || d.Reference || "";
      obj.Status = d.status || d.Status || "Posted";
      obj.SyncedAt = isoServerNow;
      break;
    case "expense":
      obj.ExpenseID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.Category = d.category || d.Category || "General";
      obj.Description = d.description || d.Description || "";
      obj.VendorOrCustomer = d.vendorOrCustomer || d.VendorOrCustomer || "";
      obj.Amount = Number(d.amount !== undefined ? d.amount : (d.Amount || 0));
      obj.Currency = d.currency || d.Currency || "USD";
      obj.PaymentMethod = d.paymentMethod || d.PaymentMethod || "Cash";
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.ReceiptRef = d.receiptRef || d.ReceiptRef || "";
      obj.Status = d.status || d.Status || "approved";
      obj.ApprovedBy = d.approvedByName || d.ApprovedBy || d.approvedBy || "";
      obj.SyncedAt = isoServerNow;
      break;
    case "supplier":
      obj.SupplierID = entityId;
      obj.SupplierName = d.name || d.Name || d.SupplierName || "";
      obj.Category = d.category || d.Category || "";
      obj.ContactPerson = d.contactPerson || d.ContactPerson || "";
      obj.Phone = d.phone || d.Phone || "";
      obj.Email = d.email || d.Email || "";
      obj.Address = d.address || d.Address || "";
      obj.City = d.city || d.City || "";
      obj.PaymentTerms = d.paymentTerms || d.PaymentTerms || "";
      obj.TaxNumber = d.taxNumber || d.TaxNumber || "";
      obj.Balance = Number(d.balance !== undefined ? d.balance : (d.Balance || 0));
      obj.Status = d.status || d.Status || "Active";
      obj.UpdatedAt = isoClientUpdated;
      obj.SyncedAt = isoServerNow;
      break;
    case "supplier_invoice_voucher":
      obj.VoucherID = entityId;
      obj.InvoiceNo = d.invoiceNumber || d.invoiceNo || d.InvoiceNo || "";
      obj.SupplierID = d.supplierId || d.SupplierID || "";
      obj.SupplierName = d.supplierName || d.SupplierName || "";
      obj.Date = d.invoiceDate || d.date || d.Date || isoServerNow.split("T")[0];
      obj.DueDate = d.dueDate || d.DueDate || "";
      obj.TotalAmount = Number(d.totalAmount !== undefined ? d.totalAmount : (d.TotalAmount || 0));
      obj.PaidAmount = Number(d.paidAmount !== undefined ? d.paidAmount : (d.PaidAmount || 0));
      obj.Status = d.status || d.Status || "Pending";
      obj.Notes = d.notes || d.Notes || "";
      obj.UpdatedAt = isoClientUpdated;
      obj.SyncedAt = isoServerNow;
      break;
    case "direct_grv":
      obj.GRVID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.GRVNumber = d.grvNumber || d.GRVNumber || entityId;
      obj.SupplierName = d.supplierName || d.SupplierName || d.supplier || "";
      obj.InvoiceNumber = d.invoiceNumber || d.InvoiceNumber || "";
      obj.ItemsCount = Array.isArray(d.items) ? d.items.length : Number(d.itemsCount || d.ItemsCount || 0);
      obj.TotalCost = Number(d.totalCost !== undefined ? d.totalCost : (d.TotalCost || 0));
      obj.CashPaid = Number(d.cashPaid !== undefined ? d.cashPaid : (d.CashPaid || 0));
      obj.PaymentMethod = d.paymentMethod || d.PaymentMethod || "Cash";
      obj.AccountID = d.accountId || d.AccountID || "";
      obj.Status = d.status || d.Status || "APPROVED";
      obj.RecordedBy = d.recordedByName || d.recordedBy || d.staffName || d.RecordedBy || "";
      obj.ApprovedBy = d.approvedByName || d.approvedBy || d.ApprovedBy || "";
      obj.Notes = d.notes || d.Notes || "";
      obj.SyncedAt = isoServerNow;
      break;
    case "goods_received":
      obj.GRNID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.SupplierID = d.supplierId || d.SupplierID || "";
      obj.SupplierName = d.supplier || d.Supplier || d.supplierName || d.SupplierName || "";
      obj.InvoiceRef = d.invoiceNo || d.InvoiceNo || d.invoiceRef || d.InvoiceRef || "";
      obj.TotalAmount = Number(d.lineTotal !== undefined ? d.lineTotal : (d.LineTotal !== undefined ? d.LineTotal : (d.totalAmount || d.TotalAmount || 0)));
      obj.ItemsCount = Number(d.itemsCount || d.ItemsCount || 1);
      obj.Status = d.status || d.Status || "Received";
      obj.ReceivedBy = d.staffName || d.staffId || d.StaffID || d.ReceivedBy || "";
      obj.Notes = d.notes || d.Notes || (d.itemName || d.ItemName || "");
      obj.SyncedAt = isoServerNow;
      break;
    case "stock_movement":
      obj.MovementID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.ProductID = d.itemId || d.ItemID || d.ProductID || "";
      obj.ProductName = d.itemName || d.ItemName || d.ProductName || "";
      obj.MovementType = d.movementType || d.txnType || d.MovementType || "ADJUSTMENT";
      obj.QtyChange = Number(d.singlesChange !== undefined ? d.singlesChange : (d.qtyChange !== undefined ? d.qtyChange : (d.QtyChange || 0)));
      obj.BalanceBefore = Number(d.balanceBefore !== undefined ? d.balanceBefore : (d.BalanceBefore || 0));
      obj.BalanceAfter = Number(d.closingSingles !== undefined ? d.closingSingles : (d.resultingStockSingles !== undefined ? d.resultingStockSingles : (d.BalanceAfter || 0)));
      obj.ReferenceID = d.referenceId || d.ReferenceID || "";
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.Notes = d.reason || d.notes || d.Notes || "";
      obj.SyncedAt = isoServerNow;
      break;
    case "reconciliation":
      obj.ReconID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.OpeningFloat = Number(d.openingFloat !== undefined ? d.openingFloat : (d.OpeningFloat || 0));
      obj.CashSales = Number(d.cashSales !== undefined ? d.cashSales : (d.CashSales || 0));
      obj.OtherCashIn = Number(d.otherCashIn !== undefined ? d.otherCashIn : (d.OtherCashIn || 0));
      obj.CashExpenses = Number(d.cashExpenses !== undefined ? d.cashExpenses : (d.CashExpenses || 0));
      obj.BankDrops = Number(d.bankDrops !== undefined ? d.bankDrops : (d.BankDrops || 0));
      obj.ExpectedCash = Number(d.expectedCash !== undefined ? d.expectedCash : (d.ExpectedCash || 0));
      obj.ActualCashCount = Number(d.actualCashCount !== undefined ? d.actualCashCount : (d.ActualCashCount || 0));
      obj.Variance = Number(d.variance !== undefined ? d.variance : (d.Variance || 0));
      obj.Status = d.status || d.Status || "submitted";
      obj.Notes = d.notes || d.Notes || "";
      obj.ApprovedBy = d.approvedByName || d.approvedBy || d.ApprovedBy || "";
      obj.SyncedAt = isoServerNow;
      break;
    case "cash_lift":
      obj.LiftID = entityId;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.StaffID = d.staffId || d.StaffID || "";
      obj.StaffName = d.staffName || d.StaffName || "";
      obj.Amount = Number(d.amount !== undefined ? d.amount : (d.Amount || 0));
      obj.Currency = d.currency || d.Currency || "USD";
      obj.DestinationAccount = d.destinationAccount || d.DestinationAccount || "";
      obj.AuthorizedBy = d.authorizedBy || d.supervisorName || d.AuthorizedBy || "";
      obj.Notes = d.notes || d.Notes || "";
      obj.Status = d.status || d.Status || "Completed";
      obj.SyncedAt = isoServerNow;
      break;
    case "audit_log":
    case "supervisor_approval":
      obj.AuditID = entityId;
      obj.Timestamp = d.timestamp || d.Timestamp || isoClientUpdated;
      obj.Date = d.date || d.Date || isoServerNow.split("T")[0];
      obj.UserID = d.staffId || d.userId || d.UserID || d.user_id || "";
      obj.UserName = d.staffName || d.userName || d.UserName || "";
      obj.AuthorizedByName = d.authorizedByName || d.AuthorizedByName || "";
      obj.Role = d.staffRole || d.role || d.Role || d.user_role || "";
      obj.Action = d.action || d.Action || "";
      obj.Module = d.module || d.Module || "";
      obj.EntityID = d.referenceId || d.targetId || d.EntityID || entityId;
      obj.Details = d.details || d.Details || "";
      obj.IPOrDevice = d.deviceId || d.IPOrDevice || envelope.originDeviceId || "";
      obj.Status = d.severity || d.status || d.Status || "INFO";
      break;
    case "cash_transfer":
      obj.TransferID = entityId;
      obj.Date = d.date || isoServerNow.split("T")[0];
      obj.Timestamp = d.timestamp || isoClientUpdated;
      obj.FromAccountID = d.from_account_id || d.fromAccountId || "";
      obj.ToAccountID = d.to_account_id || d.toAccountId || "";
      obj.Amount = d.amount || 0;
      obj.Currency = d.currency || "USD";
      obj.Status = d.status || "PENDING";
      obj.Rank = d.rank !== undefined ? d.rank : 0;
      obj.LinkedCashLogIDs = JSON.stringify(d.linked_cash_log_ids || []);
      obj.StaffID = d.staffId || d.createdBy || "";
      obj.StaffName = d.staffName || d.createdByName || "";
      obj.Notes = d.notes || "";
      obj.UpdatedAt = isoClientUpdated;
      break;
    case "stocktake_session":
      obj.SessionID = entityId;
      obj.Title = d.title || d.sessionName || entityId;
      obj.Mode = d.mode || d.stocktakeType || d.countType || "BLIND_DOUBLE_COUNT";
      obj.Status = d.status || "DRAFT";
      obj.StartedAt = d.startedAt || d.timestamp || isoClientUpdated;
      obj.StartedBy = d.startedBy || d.createdByName || "";
      obj.AuditorID = d.stocktakeAuditorId || d.auditorId || "";
      obj.AuditorName = d.stocktakeAuditorName || d.auditorName || "";
      obj.LockdownRequired = Boolean(d.lockdownRequested || d.lockdownRequired || d.isLockdownActive || d.isLockdown);
      obj.VarianceThreshold = d.varianceThreshold !== undefined ? d.varianceThreshold : (d.varianceMaterialityThreshold !== undefined ? d.varianceMaterialityThreshold : "");
      obj.CommentsDueBy = d.commentsDueBy || d.varianceCommentDeadline || "";
      obj.CommittedAt = d.committedAt || d.approvedAt || "";
      obj.CommittedBy = d.committedBy || d.approvedByName || d.approvedBy || "";
      obj.VarianceCommentsJSON = JSON.stringify(d.varianceComments || []);
      obj.UpdatedAt = isoClientUpdated;
      break;
    case "stocktake_segment":
      obj.SegmentID = entityId;
      obj.SessionID = d.sessionId || "";
      obj.Name = d.name || d.zoneName || entityId;
      obj.AisleOrZone = d.aisle || d.zone || "";
      obj.Status = d.status || "OPEN";
      obj.IsLocked = Boolean(d.isLocked);
      obj.AssignedTeamA = d.assignedTeamA || "";
      obj.AssignedTeamB = d.assignedTeamB || "";
      obj.UpdatedAt = isoClientUpdated;
      break;
    case "stocktake_count_submission":
      obj.VaultKey = entityId;
      obj.SessionID = d.sessionId || "";
      obj.ZoneID = d.zoneId || d.segmentId || "";
      obj.Slot = String(d.slot || "A").toUpperCase();
      obj.StaffID = d.staffId || "";
      obj.StaffName = d.staffName || "";
      obj.IsFinalized = Boolean(d.isFinalized !== false);
      obj.FinalizedAt = d.finalizedAt || isoServerNow;
      obj.LinesCount = Array.isArray(d.lines) ? d.lines.length : 0;
      obj.LinesJSON = JSON.stringify(d.lines || []);
      obj.SubmittedAt = isoClientUpdated;
      break;
    case "stocktake_segment_unlock":
      obj.UnlockID = entityId;
      obj.SessionID = d.sessionId || "";
      obj.SegmentID = d.segmentId || d.zoneId || "";
      obj.TargetSlot = String(d.target || d.slot || "ALL").toUpperCase();
      obj.ActorID = d.actorId || "";
      obj.ActorName = d.actorName || "";
      obj.Reason = d.reason || "";
      obj.UnlockedAt = d.unlockedAt || isoServerNow;
      break;
    case "casual_worker":
      obj.CasualID = entityId;
      obj.SessionID = d.sessionId || "";
      obj.Name = Array.isArray(d) ? ("Batch(" + d.length + ")") : (d.name || "");
      obj.Phone = d.phone || "";
      obj.HomeBranchID = d.homeBranchId || "";
      obj.WorkerType = d.workerType || d.role || "CASUAL_COUNTER";
      obj.PassCodeHash = d.passCodeHash || d.pinHash || "";
      obj.AssignedZones = JSON.stringify(d.assignedZones || []);
      obj.ExpiresAt = d.expiresAt || "";
      obj.IsActive = d.isActive !== false;
      obj.UpdatedAt = isoClientUpdated;
      break;
    case "branch_lockdown":
      obj.BranchID = d.branchId || branchId;
      obj.IsLocked = Boolean(d.isLocked);
      obj.SessionID = d.sessionId || "";
      obj.LockedBy = d.lockedBy || "";
      obj.LockedByName = d.lockedByName || "";
      obj.LockedAt = d.lockedAt || isoServerNow;
      obj.Reason = d.reason || "";
      obj.UpdatedAt = isoClientUpdated;
      break;
    case "tombstone":
      obj.TombstoneKey = entityId;
      obj.TargetEntityType = (d.entityType || "").toLowerCase();
      obj.TargetEntityID = String(d.entityId || "").trim();
      obj.DeletedAt = d.deletedAt || envelope.updatedAt || Date.now();
      obj.DeletedBy = d.deletedBy || envelope.originDeviceId || "";
      break;
    default:
      break;
  }

  obj.entity_type = entityType;
  obj.entity_id = entityId;
  obj.version = Number(envelope.version !== undefined ? envelope.version : (d && d.version !== undefined ? d.version : 1));
  obj.mutation_source = String(envelope.mutationSource || (d && d.mutationSource) || "USER_EDIT");
  obj.client_updated_at = isoClientUpdated;
  obj.server_updated_at = isoServerNow;
  obj.server_seq = serverSeq;
  obj.is_deleted = envelope.action === "DELETE" || Boolean(d && d.isDeleted);
  obj.server_received_at = metaObj.server_received_at || isoServerNow;
  obj.suspicious_backdate = Boolean(metaObj.suspicious_backdate);
  var serializedPayload = JSON.stringify(cleanPayload);
  // Google Sheets hard cell limit is 50,000 characters. For large stocktake sessions, compact nested
  // blind count1/count2 arrays (which are already stored safely in StocktakeBlindVault / StocktakeSegments).
  if (serializedPayload.length > 48000 && entityType === "stocktake_session" && cleanPayload && Array.isArray(cleanPayload.segments)) {
    var compactPayload = {};
    for (var pk in cleanPayload) {
      if (cleanPayload.hasOwnProperty(pk)) compactPayload[pk] = cleanPayload[pk];
    }
    compactPayload.segments = cleanPayload.segments.map(function (seg) {
      if (!seg || typeof seg !== "object") return seg;
      var sCopy = {};
      for (var sk in seg) {
        if (seg.hasOwnProperty(sk)) sCopy[sk] = seg[sk];
      }
      if (Array.isArray(sCopy.count1) && sCopy.count1.length > 0) sCopy.count1 = [];
      if (Array.isArray(sCopy.count2) && sCopy.count2.length > 0) sCopy.count2 = [];
      return sCopy;
    });
    serializedPayload = JSON.stringify(compactPayload);
  }
  obj.payload_json = serializedPayload;

  return obj;
}

function sanitizePayloadForCloud(entityType, d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return { value: d };
  var copy = {};
  for (var k in d) {
    if (!d.hasOwnProperty(k)) continue;
    if (entityType === "staff" && (k === "pin" || k === "rawPin" || k === "password" || k === "password_hash")) {
      continue;
    }
    copy[k] = d[k];
  }
  return copy;
}

function buildRowArrayByHeaders(headers, rowObj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    var val = rowObj[h];
    if (val === undefined) val = rowObj[h.toLowerCase()];
    if (val === undefined) val = "";
    if (val !== null && typeof val === "object" && !(val instanceof Date)) {
      val = JSON.stringify(val);
    }
    row.push(val);
  }
  return row;
}

function writeRowByHeaders(sheet, headers, rowObj) {
  sheet.appendRow(buildRowArrayByHeaders(headers, rowObj));
}

function updateRowByHeaders(sheet, rowIndex, headers, rowObj) {
  var row = buildRowArrayByHeaders(headers, rowObj);
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

function flushPendingSheetAppends(pendingAppendsBySheet) {
  if (!pendingAppendsBySheet) return 0;
  var totalFlushed = 0;
  for (var key in pendingAppendsBySheet) {
    if (!pendingAppendsBySheet.hasOwnProperty(key)) continue;
    var bucket = pendingAppendsBySheet[key];
    if (!bucket || !bucket.sheet || !bucket.rows || bucket.rows.length === 0) continue;
    var startRow = Math.max(2, bucket.sheet.getLastRow() + 1);
    bucket.sheet.getRange(startRow, 1, bucket.rows.length, bucket.headers.length).setValues(bucket.rows);
    totalFlushed += bucket.rows.length;
    bucket.rows = [];
    bucket.keyMap = {};
  }
  return totalFlushed;
}

function findRowIndexInSheet(sheet, headers, idColNames, targetId, companyId) {
  if (!sheet || sheet.getLastRow() < 2) return -1;
  var vals = sheet.getDataRange().getValues();
  var cleanTarget = String(targetId || "").trim().toUpperCase();
  if (!cleanTarget) return -1;

  var entityIdIdx = headers.indexOf("entity_id");
  var compIdx = headers.indexOf("CompanyID");
  if (compIdx === -1) compIdx = headers.indexOf("company_id");

  var candidateIdCols = [];
  if (entityIdIdx !== -1) candidateIdCols.push(entityIdIdx);
  for (var c = 0; c < idColNames.length; c++) {
    var idx = headers.indexOf(idColNames[c]);
    if (idx !== -1 && candidateIdCols.indexOf(idx) === -1) candidateIdCols.push(idx);
  }
  if (candidateIdCols.length === 0) candidateIdCols.push(0);

  for (var r = 1; r < vals.length; r++) {
    if (companyId && compIdx !== -1) {
      var rowComp = String(vals[r][compIdx] || "").trim().toUpperCase();
      if (rowComp && rowComp !== String(companyId).trim().toUpperCase()) continue;
    }
    for (var ci = 0; ci < candidateIdCols.length; ci++) {
      var cellVal = String(vals[r][candidateIdCols[ci]] || "").trim().toUpperCase();
      if (cellVal && cellVal === cleanTarget) {
        return r + 1;
      }
    }
  }
  return -1;
}

function extractExistingEnvelopeState(sheet, rowIndex, headers) {
  var rowVals = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var rec = {};
  for (var i = 0; i < headers.length; i++) {
    rec[String(headers[i]).trim()] = rowVals[i];
  }
  var parsedPayload = null;
  if (rec.payload_json && String(rec.payload_json).trim().charAt(0) === "{") {
    try { parsedPayload = JSON.parse(rec.payload_json); } catch (e) {}
  } else if (rec.payload_json && String(rec.payload_json).trim().charAt(0) === "[") {
    try { parsedPayload = JSON.parse(rec.payload_json); } catch (e2) {}
  }
  var updatedMs = Math.max(
    parseTimestampMsSafe(rec.client_updated_at),
    parseTimestampMsSafe(rec.UpdatedAt || rec.updated_at || rec.LastUpdated),
    parseTimestampMsSafe(parsedPayload && (parsedPayload.updatedAt || parsedPayload.lastUpdated)),
    parseTimestampMsSafe(rec.server_updated_at)
  );
  return {
    raw: rec,
    data: parsedPayload || rec,
    version: Number(rec.version || (parsedPayload && parsedPayload.version) || 0),
    mutationSource: String(rec.mutation_source || (parsedPayload && parsedPayload.mutationSource) || ""),
    updatedAt: updatedMs,
    isDeleted: rec.is_deleted === true || String(rec.is_deleted).toUpperCase() === "TRUE",
    serverSeq: Number(rec.server_seq || 0)
  };
}

function getIdColumnsForEntityType(entityType) {
  switch (entityType) {
    case "sale": return ["InvoiceID", "id"];
    case "inventory_item": return ["ProductID", "itemId", "id"];
    case "staff": return ["UserID", "user_id", "id"];
    case "branch": return ["BranchID", "branch_id", "id"];
    case "customer": return ["CustomerID", "customerId", "id"];
    case "customer_change": return ["ChangeID", "id"];
    case "credit_sale": return ["CreditID", "id"];
    case "credit_group": return ["GroupID", "id"];
    case "cash_log": return ["LogID", "id"];
    case "cash_lift": return ["LiftID", "id"];
    case "cash_movement": return ["MovementID", "id"];
    case "cash_account": return ["AccountID", "account_id", "id"];
    case "cash_transfer": return ["TransferID", "transfer_id", "id"];
    case "direct_grv": return ["GRVID", "GRVNumber", "id"];
    case "goods_received": return ["GRNID", "id"];
    case "stock_movement": return ["MovementID", "id"];
    case "expense": return ["ExpenseID", "id"];
    case "internal_consumption": return ["ConsumptionID", "id"];
    case "reconciliation": return ["ReconID", "id"];
    case "business_day_closure": return ["ClosureID", "id"];
    case "electronic_settlement": return ["SettlementID", "id"];
    case "cash_count": return ["CountID", "id"];
    case "admin_sales": return ["AdminSaleID", "id"];
    case "supplier": return ["SupplierID", "supplierId", "id"];
    case "supplier_invoice_voucher": return ["VoucherID", "voucherId", "id"];
    case "inventory_category": return ["CategoryID", "id"];
    case "wallet": return ["WalletID", "id"];
    case "stocktake_session": return ["SessionID", "sessionId", "id"];
    case "stocktake_segment": return ["SegmentID", "segmentId", "id"];
    case "stocktake_zone_assignment": return ["AssignmentID", "ZoneID", "id"];
    case "stocktake_zone_claim": return ["ClaimID", "ZoneID", "id"];
    case "stocktake_count_submission": return ["VaultKey", "entity_id"];
    case "stocktake_joint_proposal": return ["ProposalID", "ZoneID"];
    case "stocktake_joint_finalized": return ["FinalID", "ZoneID"];
    case "stocktake_segment_unlock": return ["UnlockID", "id"];
    case "casual_worker": return ["CasualID", "id"];
    case "branch_lockdown": return ["BranchID", "branchId"];
    case "tombstone": return ["TombstoneKey", "TargetEntityID"];
    default: return ["entity_id", "id"];
  }
}

function getAllTombstonesMap(ss, companyId) {
  var map = {};
  var tSheet = ss.getSheetByName("Tombstones");
  if (!tSheet || tSheet.getLastRow() < 2) return map;
  var vals = tSheet.getDataRange().getValues();
  var h = vals[0];
  var cIdx = h.indexOf("CompanyID");
  var etIdx = h.indexOf("TargetEntityType");
  var eidIdx = h.indexOf("TargetEntityID");
  var delAtIdx = h.indexOf("DeletedAt");
  for (var i = 1; i < vals.length; i++) {
    if (companyId && cIdx !== -1) {
      var rc = String(vals[i][cIdx] || "").trim().toUpperCase();
      if (rc && rc !== String(companyId).trim().toUpperCase()) continue;
    }
    var et = String(vals[i][etIdx] || "").trim().toLowerCase();
    var eid = String(vals[i][eidIdx] || "").trim().toUpperCase();
    if (!et || !eid) continue;
    var key = et + "::" + eid;
    var delAt = parseTimestampMsSafe(vals[i][delAtIdx]);
    if (!map[key] || delAt > map[key]) {
      map[key] = delAt;
    }
  }
  return map;
}

function checkActiveStocktakeSessionConflict(ss, companyId, branchId, incomingSessionId, incomingStatus, tombsMapOpt) {
  // DRAFT & SCHEDULED sessions sync freely across branches without consuming the single live slot.
  // PAUSED sessions retain the branch's live execution slot until resumed or archived.
  var activeStatuses = {
    "ACTIVE": true,
    "IN_PROGRESS": true,
    "COUNTING": true,
    "PAUSED": true,
    "RECOUNT": true,
    "RECOUNTING": true,
    "AUDIT_REVIEW": true,
    "CONSOLIDATED": true,
    "PENDING_SIGNOFF": true,
    "READY_FOR_COMMITTAL": true
  };
  var statusUpper = String(incomingStatus || "DRAFT").toUpperCase();
  if (!activeStatuses[statusUpper]) return null;
  var sheet = ss.getSheetByName("StocktakeSessions");
  if (!sheet || sheet.getLastRow() < 2) return null;
  var vals = sheet.getDataRange().getValues();
  var h = vals[0];
  var sIdIdx = h.indexOf("SessionID");
  var cIdx = h.indexOf("CompanyID");
  var bIdx = h.indexOf("BranchID");
  var stIdx = h.indexOf("Status");
  var delIdx = h.indexOf("is_deleted");
  var cliUpdIdx = h.indexOf("client_updated_at");
  var srvUpdIdx = h.indexOf("server_updated_at");
  var updIdx = h.indexOf("UpdatedAt");
  var incomingUpper = String(incomingSessionId || "").trim().toUpperCase();
  for (var i = 1; i < vals.length; i++) {
    if (delIdx !== -1 && (vals[i][delIdx] === true || String(vals[i][delIdx]).toUpperCase() === "TRUE")) continue;
    var rc = cIdx !== -1 ? String(vals[i][cIdx] || "").trim().toUpperCase() : "";
    var rb = bIdx !== -1 ? String(vals[i][bIdx] || "").trim().toUpperCase() : "";
    if (companyId && rc && rc !== String(companyId).trim().toUpperCase()) continue;
    if (branchId && rb && rb !== String(branchId).trim().toUpperCase()) continue;
    var existingId = sIdIdx !== -1 ? String(vals[i][sIdIdx] || "").trim().toUpperCase() : "";
    var existingStatus = stIdx !== -1 ? String(vals[i][stIdx] || "").trim().toUpperCase() : "";
    if (!existingId || existingId === incomingUpper || !activeStatuses[existingStatus]) continue;
    if (tombsMapOpt) {
      var tombMs = tombsMapOpt["stocktake_session::" + existingId] || 0;
      if (tombMs > 0) {
        var rowUpdatedMs = Math.max(
          cliUpdIdx !== -1 ? parseTimestampMsSafe(vals[i][cliUpdIdx]) : 0,
          srvUpdIdx !== -1 ? parseTimestampMsSafe(vals[i][srvUpdIdx]) : 0,
          updIdx !== -1 ? parseTimestampMsSafe(vals[i][updIdx]) : 0
        );
        if (rowUpdatedMs === 0 || tombMs >= rowUpdatedMs) continue;
      }
    }
    return extractExistingEnvelopeState(sheet, i + 1, h);
  }
  return null;
}

function getBranchLockdownState(ss, companyId, branchId) {
  var sheet = ss.getSheetByName("BranchLockdowns");
  if (!sheet || sheet.getLastRow() < 2) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowIdx = findRowIndexInSheet(sheet, headers, ["BranchID", "branchId", "entity_id"], branchId, companyId);
  if (rowIdx <= 0) return null;
  return extractExistingEnvelopeState(sheet, rowIdx, headers);
}

function isSegmentSlotUnlocked(ss, companyId, sessionId, segmentId, slot) {
  var uSheet = ss.getSheetByName("StocktakeUnlockLog");
  if (!uSheet || uSheet.getLastRow() < 2) return 0;
  var vals = uSheet.getDataRange().getValues();
  var h = vals[0];
  var sessIdx = h.indexOf("SessionID");
  var segIdx = h.indexOf("SegmentID");
  var slotIdx = h.indexOf("TargetSlot");
  var tsIdx = h.indexOf("UnlockedAt");
  var maxUnlockTs = 0;
  for (var i = 1; i < vals.length; i++) {
    var rSess = String(vals[i][sessIdx] || "").trim().toUpperCase();
    var rSeg = String(vals[i][segIdx] || "").trim().toUpperCase();
    var rSlot = String(vals[i][slotIdx] || "ALL").trim().toUpperCase();
    if (rSess === String(sessionId || "").trim().toUpperCase() &&
        rSeg === String(segmentId || "").trim().toUpperCase() &&
        (rSlot === "ALL" || rSlot === String(slot || "").trim().toUpperCase())) {
      var uTs = parseTimestampMsSafe(vals[i][tsIdx]);
      if (uTs > maxUnlockTs) maxUnlockTs = uTs;
    }
  }
  return maxUnlockTs;
}

function handlePushEnvelopes(req, masterSsOpt, targetSs, companyId, branchId) {
  var envelopes = [];
  if (Array.isArray(req.envelopes)) {
    envelopes = req.envelopes;
  } else if (req.envelope && typeof req.envelope === "object") {
    envelopes = [req.envelope];
  } else {
    return { success: false, error: "No envelopes array provided to push_envelopes" };
  }

  var cfg = getSystemConfigCached(masterSsOpt);
  var maxBatch = Math.max(10, Number(cfg.MAX_ENVELOPES_PER_BATCH || 50));
  if (envelopes.length > maxBatch) {
    return {
      success: false,
      code: "BATCH_TOO_LARGE",
      httpStatus: 413,
      maxBatch: maxBatch,
      error: "Batch exceeds MAX_ENVELOPES_PER_BATCH (" + maxBatch + "). Split into smaller chunks."
    };
  }

  var userRole = String(req.user_role || "CASHIER").toUpperCase();
  var userBranchId = String(req.user_branch_id || branchId || "BR-MAIN").trim();
  var serverNowIso = new Date().toISOString();
  var ackedPacketIds = [];
  var failed = [];
  var conflicts = [];
  var results = [];
  var maxServerSeq = 0;
  var compUpper = String(companyId || TENANT_COMPANY_ID).trim().toUpperCase();

  var tombsMap = getAllTombstonesMap(targetSs, companyId);
  var pendingAppendsBySheet = {};
  var sheetHeadersCache = {};
  var getCachedSheetHeaders = function(sh) {
    var sName = sh.getName();
    if (!sheetHeadersCache[sName]) {
      sheetHeadersCache[sName] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    }
    return sheetHeadersCache[sName];
  };

  for (var i = 0; i < envelopes.length; i++) {
    var env = envelopes[i];
    if (!env || !env.entityType) {
      failed.push({ packetId: env && env.packetId, error: "INVALID_ENVELOPE" });
      continue;
    }

    // Packet-level Idempotency Dedupe Ring
    if (env.packetId) {
      var dedupeKey = "done:" + compUpper + ":" + String(env.packetId).trim();
      if (CACHE.get(dedupeKey)) {
        ackedPacketIds.push(env.packetId);
        results.push({ packetId: env.packetId, entityType: env.entityType, entityId: env.entityId, deduped: true, server_received_at: serverNowIso });
        continue;
      }
    }

    var entityType = String(env.entityType).trim().toLowerCase();
    var d = env.data !== undefined ? env.data : {};
    if (typeof d === "string") {
      try { d = JSON.parse(d); } catch (pe) { d = { value: d }; }
    }
    var envComp = String((d && (d.company_id || d.companyId)) || companyId || TENANT_COMPANY_ID).trim();
    var envBranch = String((d && (d.branch_id || d.branchId)) || env.targetBranchId || branchId || "ALL").trim();

    if (userRole !== "SUPER_ADMIN" && userRole !== "OWNER" && userRole !== "AUDITOR" &&
        envBranch && envBranch !== "ALL" && userBranchId && userBranchId !== "ALL" &&
        envBranch.toUpperCase() !== userBranchId.toUpperCase() && !CATALOG_SHARED_ENTITIES[entityType]) {
      failed.push({
        packetId: env.packetId,
        entityType: entityType,
        entityId: env.entityId,
        error: "BRANCH_SECURITY_VIOLATION: " + userBranchId + " cannot write " + envBranch
      });
      continue;
    }

    var entityId = extractEntityIdFromPayload(entityType, env.entityId, d);
    if (!entityId) {
      entityId = entityType.toUpperCase() + "-" + Date.now() + "-" + i;
    }

    if (env.action === "DELETE" || entityType === "tombstone") {
      var targetTypeForTomb = entityType === "tombstone"
        ? String((d && d.entityType) || "").trim().toLowerCase()
        : entityType;
      var targetIdForTomb = entityType === "tombstone"
        ? String((d && d.entityId) || entityId).trim()
        : entityId;
      var deletedAtMs = parseTimestampMsSafe(d && d.deletedAt) || parseTimestampMsSafe(env.updatedAt) || Date.now();
      var tombSeq = allocateNextServerSeq(targetSs, envComp);
      maxServerSeq = Math.max(maxServerSeq, tombSeq);

      var tombKey = targetTypeForTomb + "::" + targetIdForTomb.toUpperCase();
      tombsMap[tombKey] = Math.max(tombsMap[tombKey] || 0, deletedAtMs);

      var tombSheet = backfillSchemaColumns(targetSs, "Tombstones");
      var tombHeaders = tombSheet.getRange(1, 1, 1, tombSheet.getLastColumn()).getValues()[0];
      var tombRowObj = buildRowObjectForEntity(
        "tombstone",
        tombKey,
        {
          entityType: targetTypeForTomb,
          entityId: targetIdForTomb,
          deletedAt: deletedAtMs,
          deletedBy: (d && d.deletedBy) || env.originDeviceId || "PWA",
          company_id: envComp,
          branch_id: envBranch
        },
        env,
        { server_received_at: serverNowIso, suspicious_backdate: false },
        tombSeq,
        envComp,
        envBranch
      );
      var existingTombRow = findRowIndexInSheet(tombSheet, tombHeaders, ["TombstoneKey", "entity_id"], tombKey, envComp);
      if (existingTombRow > 0) {
        updateRowByHeaders(tombSheet, existingTombRow, tombHeaders, tombRowObj);
      } else {
        writeRowByHeaders(tombSheet, tombHeaders, tombRowObj);
      }

      if (targetTypeForTomb && targetTypeForTomb !== "tombstone") {
        var delTabName = resolveTabForEntityType(targetTypeForTomb, d, env.meta && env.meta.sheetName);
        var delSheets = getReadableSheetsForBase(targetSs, delTabName);
        for (var ds = 0; ds < delSheets.length; ds++) {
          var delSh = delSheets[ds];
          var delHeaders = delSh.getRange(1, 1, 1, delSh.getLastColumn()).getValues()[0];
          var foundDelRow = findRowIndexInSheet(delSh, delHeaders, getIdColumnsForEntityType(targetTypeForTomb), targetIdForTomb, envComp);
          if (foundDelRow > 0) {
            var isDelCol = delHeaders.indexOf("is_deleted");
            var seqCol = delHeaders.indexOf("server_seq");
            var srvUpdCol = delHeaders.indexOf("server_updated_at");
            if (isDelCol !== -1) delSh.getRange(foundDelRow, isDelCol + 1).setValue(true);
            if (seqCol !== -1) delSh.getRange(foundDelRow, seqCol + 1).setValue(tombSeq);
            if (srvUpdCol !== -1) delSh.getRange(foundDelRow, srvUpdCol + 1).setValue(serverNowIso);
          }
        }
        // If a deleted stocktake_session currently owns BranchLockdowns, auto-release that lockdown
        if (targetTypeForTomb === "stocktake_session") {
          var lockSh = targetSs.getSheetByName("BranchLockdowns");
          if (lockSh && lockSh.getLastRow() >= 2) {
            var lockVals = lockSh.getDataRange().getValues();
            var lockH = lockVals[0];
            var lkSessCol = lockH.indexOf("SessionID");
            var lkIsCol = lockH.indexOf("IsLocked");
            var lkSeqCol = lockH.indexOf("server_seq");
            var lkUpdCol = lockH.indexOf("server_updated_at");
            var lkPayCol = lockH.indexOf("payload_json");
            var targetUpper = targetIdForTomb.toUpperCase();
            for (var lr = 1; lr < lockVals.length; lr++) {
              var rowSess = lkSessCol !== -1 ? String(lockVals[lr][lkSessCol] || "").trim().toUpperCase() : "";
              var rowLocked = lkIsCol !== -1 && (lockVals[lr][lkIsCol] === true || String(lockVals[lr][lkIsCol]).toUpperCase() === "TRUE");
              if (rowLocked && rowSess === targetUpper) {
                var unlockSeq = allocateNextServerSeq(targetSs, envComp);
                maxServerSeq = Math.max(maxServerSeq, unlockSeq);
                if (lkIsCol !== -1) lockSh.getRange(lr + 1, lkIsCol + 1).setValue(false);
                if (lkSeqCol !== -1) lockSh.getRange(lr + 1, lkSeqCol + 1).setValue(unlockSeq);
                if (lkUpdCol !== -1) lockSh.getRange(lr + 1, lkUpdCol + 1).setValue(serverNowIso);
                if (lkPayCol !== -1 && lockVals[lr][lkPayCol]) {
                  try {
                    var parsedLk = JSON.parse(String(lockVals[lr][lkPayCol]));
                    parsedLk.isLocked = false;
                    parsedLk.updatedAt = Date.now();
                    parsedLk.lastUpdated = serverNowIso;
                    lockSh.getRange(lr + 1, lkPayCol + 1).setValue(JSON.stringify(parsedLk));
                  } catch (lpe) {}
                }
              }
            }
          }
        }
      }

      if (env.packetId) putCacheSafe("done:" + compUpper + ":" + String(env.packetId).trim(), "1", CACHE_TTL_SEC);
      ackedPacketIds.push(env.packetId);
      results.push({ packetId: env.packetId, entityType: entityType, entityId: entityId, server_seq: tombSeq, server_received_at: serverNowIso });
      continue;
    }

    var incomingUpdatedMs = Number(env.updatedAt || parseTimestampMsSafe(d && (d.updatedAt || d.lastUpdated || d.hubTimestamp)) || Date.now());
    if (T2_ENTITY_TYPES[entityType]) {
      var existingTombMs = tombsMap[entityType + "::" + entityId.toUpperCase()] || 0;
      if (existingTombMs > 0 && existingTombMs >= incomingUpdatedMs) {
        conflicts.push({
          entityType: "tombstone",
          entityId: entityType + "::" + entityId.toUpperCase(),
          reason: "RESURRECTION_BLOCKED",
          updatedAt: existingTombMs,
          data: { entityType: entityType, entityId: entityId, deletedAt: existingTombMs }
        });
        if (env.packetId) putCacheSafe("done:" + compUpper + ":" + String(env.packetId).trim(), "1", CACHE_TTL_SEC);
        ackedPacketIds.push(env.packetId);
        continue;
      }
    }

    var baseTabName = resolveTabForEntityType(entityType, d, env.meta && env.meta.sheetName);
    var recDateStr = (d && (d.date || d.Date || d.timestamp || d.Timestamp)) || serverNowIso;
    var sheet = MONTHLY_SHARD_TABS[baseTabName]
      ? getOrCreateMonthlySheet(targetSs, baseTabName, recDateStr)
      : backfillSchemaColumns(targetSs, baseTabName);
    var headers = getCachedSheetHeaders(sheet);

    if (entityType === "stocktake_session") {
      var sessionConflict = checkActiveStocktakeSessionConflict(targetSs, envComp, envBranch, entityId, d.status, tombsMap);
      if (sessionConflict) {
        conflicts.push({
          entityType: "stocktake_session",
          entityId: sessionConflict.raw.SessionID || sessionConflict.raw.entity_id,
          reason: "ACTIVE_STOCKTAKE_ALREADY_EXISTS",
          updatedAt: sessionConflict.updatedAt,
          data: sessionConflict.data
        });
        var winLockState = getBranchLockdownState(targetSs, envComp, envBranch);
        if (winLockState && winLockState.data) {
          conflicts.push({
            entityType: "branch_lockdown",
            entityId: winLockState.raw.BranchID || envBranch,
            reason: "ACTIVE_STOCKTAKE_LOCKDOWN",
            updatedAt: winLockState.updatedAt,
            data: winLockState.data
          });
        }
        failed.push({ packetId: env.packetId, error: "ACTIVE_STOCKTAKE_ALREADY_EXISTS" });
        continue;
      }
    }

    if (entityType === "branch_lockdown" && d && d.sessionId) {
      var lockSessionConflict = checkActiveStocktakeSessionConflict(targetSs, envComp, envBranch, d.sessionId, "COUNTING", tombsMap);
      if (lockSessionConflict) {
        conflicts.push({
          entityType: "stocktake_session",
          entityId: lockSessionConflict.raw.SessionID || lockSessionConflict.raw.entity_id,
          reason: "BRANCH_LOCKDOWN_SESSION_MISMATCH",
          updatedAt: lockSessionConflict.updatedAt,
          data: lockSessionConflict.data
        });
        var curLockState = getBranchLockdownState(targetSs, envComp, envBranch);
        if (curLockState && curLockState.data) {
          conflicts.push({
            entityType: "branch_lockdown",
            entityId: curLockState.raw.BranchID || envBranch,
            reason: "BRANCH_LOCKDOWN_SESSION_MISMATCH",
            updatedAt: curLockState.updatedAt,
            data: curLockState.data
          });
        }
        failed.push({ packetId: env.packetId, error: "BRANCH_LOCKDOWN_SESSION_MISMATCH" });
        continue;
      }
    }

    if (entityType === "stocktake_count_submission") {
      var sessIdV = String((d && d.sessionId) || "").trim();
      var zoneIdV = String((d && (d.zoneId || d.segmentId)) || "").trim();
      var slotV = String((d && d.slot) || "A").toUpperCase();
      entityId = sessIdV + "::" + zoneIdV + "::" + slotV;
      var existingVaultRow = findRowIndexInSheet(sheet, headers, ["VaultKey", "entity_id"], entityId, envComp);
      if (existingVaultRow > 0) {
        var existingVault = extractExistingEnvelopeState(sheet, existingVaultRow, headers);
        var wasFinal = existingVault.raw.IsFinalized === true || String(existingVault.raw.IsFinalized).toUpperCase() === "TRUE";
        if (wasFinal) {
          var existingFinMs = parseTimestampMsSafe(existingVault.raw.FinalizedAt || existingVault.raw.SubmittedAt);
          var latestUnlockMs = isSegmentSlotUnlocked(targetSs, envComp, sessIdV, zoneIdV, slotV);
          if (!(latestUnlockMs > existingFinMs) && userRole !== "OWNER" && userRole !== "AUDITOR") {
            conflicts.push({
              entityType: "stocktake_count_submission",
              entityId: entityId,
              reason: "SLOT_FINALIZED_LOCKED",
              updatedAt: existingVault.updatedAt,
              data: existingVault.data
            });
            failed.push({ packetId: env.packetId, error: "SLOT_FINALIZED_LOCKED" });
            continue;
          }
        }
      }
    }

    if (entityType === "stocktake_segment_unlock") {
      var vaultSheet = backfillSchemaColumns(targetSs, "StocktakeBlindVault");
      var vHeaders = vaultSheet.getRange(1, 1, 1, vaultSheet.getLastColumn()).getValues()[0];
      var unlockSess = String((d && d.sessionId) || "").trim();
      var unlockSeg = String((d && (d.segmentId || d.zoneId)) || "").trim();
      var unlockSlot = String((d && (d.target || d.slot)) || "ALL").toUpperCase();
      var slotsToUnlock = unlockSlot === "ALL" ? ["A", "B"] : [unlockSlot];
      for (var su = 0; su < slotsToUnlock.length; su++) {
        var vk = unlockSess + "::" + unlockSeg + "::" + slotsToUnlock[su];
        var vRow = findRowIndexInSheet(vaultSheet, vHeaders, ["VaultKey", "entity_id"], vk, envComp);
        if (vRow > 0) {
          var finIdx = vHeaders.indexOf("IsFinalized");
          if (finIdx !== -1) vaultSheet.getRange(vRow, finIdx + 1).setValue(false);
        }
      }
    }

    var idCols = getIdColumnsForEntityType(entityType);
    var existingRowIdx = findRowIndexInSheet(sheet, headers, idCols, entityId, envComp);
    var matchedSheet = sheet;
    if (existingRowIdx === -1 && MONTHLY_SHARD_TABS[baseTabName]) {
      var allShards = getReadableSheetsForBase(targetSs, baseTabName);
      for (var shI = 0; shI < allShards.length; shI++) {
        if (allShards[shI].getName() === sheet.getName()) continue;
        var shHeaders = allShards[shI].getRange(1, 1, 1, allShards[shI].getLastColumn()).getValues()[0];
        var hit = findRowIndexInSheet(allShards[shI], shHeaders, idCols, entityId, envComp);
        if (hit > 0) {
          existingRowIdx = hit;
          matchedSheet = allShards[shI];
          headers = shHeaders;
          break;
        }
      }
    }

    var shouldMirrorStaffPin = (entityType === "staff" && existingRowIdx <= 0 && Boolean(d && (d.pin_hash || d.pinHash)));

    if (existingRowIdx > 0) {
      var existingState = extractExistingEnvelopeState(matchedSheet, existingRowIdx, headers);

      if (T2_ENTITY_TYPES[entityType]) {
        var inVersion = Number(env.version !== undefined ? env.version : (d && d.version) || 0);
        var inSource = String(env.mutationSource || (d && d.mutationSource) || "USER_EDIT").toUpperCase();
        var exSource = String(existingState.mutationSource || "").toUpperCase();
        var isRejectedStale = false;

        // Detect offline staff/owner password or PIN mutation (monotonic pinVersion beats clock drift)
        var isStaffNewerPin = false;
        if (entityType === "staff") {
          var exPinVer0 = existingState.data ? Number(existingState.data.pinVersion || existingState.data.pin_version || 0) : 0;
          var exPinHash0 = existingState.data ? String(existingState.data.pin_hash || existingState.data.PinHash || "").trim() : "";
          var inPinVer0 = Number(d.pinVersion || d.pin_version || 0);
          var inPinHash0 = String(d.pin_hash || d.pinHash || "").trim();
          if (inPinHash0 && (inPinVer0 > exPinVer0 || (!exPinHash0 && inPinHash0))) {
            isStaffNewerPin = true;
            shouldMirrorStaffPin = true;
          } else if (inPinHash0 && exPinHash0 && inPinHash0 !== exPinHash0 && inPinVer0 >= exPinVer0) {
            shouldMirrorStaffPin = true;
          }
        }

        if (exSource === "USER_EDIT" && (inSource === "SEED" || inSource === "MIGRATION")) {
          if (!isStaffNewerPin) isRejectedStale = true;
        } else if (existingState.version > 0 && inVersion > 0 && inVersion < existingState.version) {
          if (!isStaffNewerPin) isRejectedStale = true;
        } else if (existingState.updatedAt > 0 && incomingUpdatedMs > 0 && existingState.updatedAt > incomingUpdatedMs + 60000) {
          var hasStrictlyHigherVersion = existingState.version > 0 && inVersion > existingState.version;
          if (!(inSource === "USER_EDIT" && exSource === "SEED") && !hasStrictlyHigherVersion && !isStaffNewerPin) {
            isRejectedStale = true;
          }
        }

        if (isRejectedStale) {
          conflicts.push({
            entityType: entityType,
            entityId: entityId,
            reason: "STALE_T2",
            updatedAt: existingState.updatedAt,
            version: existingState.version,
            mutationSource: existingState.mutationSource,
            data: existingState.data
          });
          if (env.packetId) putCacheSafe("done:" + compUpper + ":" + String(env.packetId).trim(), "1", CACHE_TTL_SEC);
          ackedPacketIds.push(env.packetId);
          continue;
        }

        if (entityType === "staff" && existingState.data) {
          var exPinVer = Number(existingState.data.pinVersion || existingState.data.pin_version || 0);
          var inPinVer = Number(d.pinVersion || d.pin_version || 0);
          var exPinHash = String(existingState.data.pin_hash || existingState.data.PinHash || "").trim();
          var inPinHash = String(d.pin_hash || d.pinHash || "").trim();

          if (isStaffNewerPin && existingState.version > 0 && inVersion > 0 && inVersion < existingState.version) {
            // Preserve newer non-PIN fields from server while applying the strictly newer offline PIN
            var mergedStaff = {};
            for (var sk in existingState.data) {
              if (existingState.data.hasOwnProperty(sk)) mergedStaff[sk] = existingState.data[sk];
            }
            mergedStaff.pin_hash = inPinHash;
            mergedStaff.pinHash = inPinHash;
            if (d.pin_salt || d.pinSalt) {
              mergedStaff.pin_salt = d.pin_salt || d.pinSalt;
              mergedStaff.pinSalt = mergedStaff.pin_salt;
            }
            mergedStaff.pinVersion = Math.max(exPinVer + 1, inPinVer);
            mergedStaff.pin_version = mergedStaff.pinVersion;
            mergedStaff.pinUpdatedAt = d.pinUpdatedAt || Date.now();
            mergedStaff.version = existingState.version + 1;
            env.version = mergedStaff.version;
            d = mergedStaff;
          } else if (exPinHash && (!inPinHash || (exPinVer > 0 && (inPinVer === 0 || exPinVer > inPinVer)))) {
            d.pin_hash = exPinHash;
            d.pin_salt = existingState.data.pin_salt || existingState.data.PinSalt || d.pin_salt;
            d.pinVersion = Math.max(exPinVer, inPinVer);
            d.pinUpdatedAt = existingState.data.pinUpdatedAt || existingState.data.pin_updated_at || d.pinUpdatedAt;
          }
        }

        if (entityType === "branch" && existingState.data) {
          var rawInName = String(d.name || d.branch_name || "").trim().toLowerCase();
          var exName = existingState.data.name || existingState.data.branch_name || existingState.data.BranchName || "";
          if ((!rawInName || rawInName === "branch" || rawInName === "unnamed branch") && exName) {
            d.name = exName;
          }
        }

        if (entityType === "stocktake_session" && existingState.data && Array.isArray(existingState.data.varianceComments)) {
          var mergedComments = existingState.data.varianceComments.slice();
          var seenCIds = {};
          for (var mc = 0; mc < mergedComments.length; mc++) {
            var cid = mergedComments[mc] && (mergedComments[mc].id || mergedComments[mc].commentId);
            if (cid) seenCIds[String(cid)] = true;
          }
          if (Array.isArray(d.varianceComments)) {
            for (var ic = 0; ic < d.varianceComments.length; ic++) {
              var newC = d.varianceComments[ic];
              var ncid = newC && (newC.id || newC.commentId);
              if (!ncid || !seenCIds[String(ncid)]) {
                mergedComments.push(newC);
                if (ncid) seenCIds[String(ncid)] = true;
              }
            }
          }
          d.varianceComments = mergedComments;
        }
      } else {
        if (entityType === "cash_transfer" && existingState.data) {
          var exRank = Number(existingState.data.rank || 0);
          var inRank = Number(d.rank || 0);
          var mergedLinks = [];
          var linkMap = {};
          var oldLinks = Array.isArray(existingState.data.linked_cash_log_ids) ? existingState.data.linked_cash_log_ids : [];
          var newLinks = Array.isArray(d.linked_cash_log_ids) ? d.linked_cash_log_ids : [];
          for (var ol = 0; ol < oldLinks.length; ol++) { linkMap[oldLinks[ol]] = true; mergedLinks.push(oldLinks[ol]); }
          for (var nl = 0; nl < newLinks.length; nl++) { if (!linkMap[newLinks[nl]]) { linkMap[newLinks[nl]] = true; mergedLinks.push(newLinks[nl]); } }
          if (inRank < exRank) {
            d = existingState.data;
          }
          d.linked_cash_log_ids = mergedLinks;
        } else if (entityType === "sale") {
          var allowSaleUpdate = (d.status === "Refunded" || d.status === "Voided" ||
            d.mobileVerificationStatus === "VERIFIED" || d.mobileVerificationStatus === "FLAGGED" || Boolean(d.hasExchanges));
          if (!allowSaleUpdate && env.action === "CREATE") {
            if (env.packetId) putCacheSafe("done:" + compUpper + ":" + String(env.packetId).trim(), "1", CACHE_TTL_SEC);
            ackedPacketIds.push(env.packetId);
            results.push({ packetId: env.packetId, entityType: entityType, entityId: entityId, deduped: true, server_seq: existingState.serverSeq, server_received_at: serverNowIso });
            continue;
          }
        } else {
          var statusChanged = (d && d.status && existingState.data && d.status !== existingState.data.status);
          if (!statusChanged && env.action === "CREATE") {
            if (env.packetId) putCacheSafe("done:" + compUpper + ":" + String(env.packetId).trim(), "1", CACHE_TTL_SEC);
            ackedPacketIds.push(env.packetId);
            results.push({ packetId: env.packetId, entityType: entityType, entityId: entityId, deduped: true, server_seq: existingState.serverSeq, server_received_at: serverNowIso });
            continue;
          }
        }
      }
    }

    var seq = allocateNextServerSeq(targetSs, envComp);
    maxServerSeq = Math.max(maxServerSeq, seq);
    var metaClock = (entityType === "sale" || entityType === "cash_log")
      ? evaluateServerTimestampMeta(targetSs, d && (d.date || d.Date), (d && (d.timestamp || d.Timestamp)) || incomingUpdatedMs)
      : { server_received_at: serverNowIso, suspicious_backdate: false };

    var rowObj = buildRowObjectForEntity(entityType, entityId, d, env, metaClock, seq, envComp, envBranch);

    var requiresImmediateWrite = (
      entityType === "stocktake_session" ||
      entityType === "branch_lockdown" ||
      entityType === "stocktake_count_submission" ||
      entityType === "stocktake_segment_unlock"
    );

    if (existingRowIdx > 0) {
      updateRowByHeaders(matchedSheet, existingRowIdx, headers, rowObj);
    } else if (requiresImmediateWrite) {
      writeRowByHeaders(matchedSheet, headers, rowObj);
    } else {
      var mSheetName = matchedSheet.getName();
      if (!pendingAppendsBySheet[mSheetName]) {
        pendingAppendsBySheet[mSheetName] = {
          sheet: matchedSheet,
          headers: headers,
          rows: [],
          keyMap: {}
        };
      }
      var bucket = pendingAppendsBySheet[mSheetName];
      var dedupeRowKey = String(envComp || "").toUpperCase() + "::" + String(entityId || "").toUpperCase();
      var rowArr = buildRowArrayByHeaders(headers, rowObj);
      if (bucket.keyMap.hasOwnProperty(dedupeRowKey)) {
        bucket.rows[bucket.keyMap[dedupeRowKey]] = rowArr;
      } else {
        bucket.keyMap[dedupeRowKey] = bucket.rows.length;
        bucket.rows.push(rowArr);
      }
    }

    // V7 Zero-Master-Open Hot Path:
    // Only open Master Control Plane if explicitly requested, masterSsOpt already opened,
    // or a staff/owner password/PIN mutation occurred (rare event required for cross-device login parity).
    if (req.mirror_master === true || masterSsOpt || shouldMirrorStaffPin) {
      var mSs = masterSsOpt || getMasterSpreadsheet();
      if (entityType === "staff") {
        mirrorStaffToMasterUsers(mSs, envComp, envBranch, entityId, d, seq, serverNowIso);
      } else if (entityType === "branch") {
        mirrorBranchToMasterBranches(mSs, envComp, entityId, d, seq, serverNowIso);
      }
    }

    if (env.packetId) putCacheSafe("done:" + compUpper + ":" + String(env.packetId).trim(), "1", CACHE_TTL_SEC);
    ackedPacketIds.push(env.packetId);
    results.push({
      packetId: env.packetId,
      entityType: entityType,
      entityId: entityId,
      server_seq: seq,
      server_received_at: metaClock.server_received_at,
      suspicious_backdate: metaClock.suspicious_backdate
    });
  }

  // Commit all newly inserted rows per target sheet in a single batched setValues() RPC per tab
  flushPendingSheetAppends(pendingAppendsBySheet);

  if (maxServerSeq > 0) {
    flushTenantSeqMeta(targetSs, companyId, maxServerSeq);
  }

  return {
    success: failed.length === 0 || ackedPacketIds.length > 0,
    ok: ackedPacketIds,
    ackedPacketIds: ackedPacketIds,
    failed: failed,
    conflicts: conflicts,
    results: results,
    server_seq: maxServerSeq,
    server_received_at: serverNowIso
  };
}

function mirrorOwnerCredentialsToMasterDirectory(masterSs, compId, staffId, role, email, fullName, brId, resolvedPinHash, isActive, nowIso, resolvedPinSalt) {
  if (!masterSs || !compId || !resolvedPinHash) return;
  var roleUp = String(role || "").toUpperCase().trim();
  var emailLower = String(email || "").trim().toLowerCase();
  var compUp = String(compId).trim().toUpperCase();
  var cleanSalt = String(resolvedPinSalt || "").trim();
  var touchedCompany = false;

  // 1. Mirror into Master `Global_Users` (for OWNER/ADMIN/SUPER_ADMIN or any existing Global_Users row)
  try {
    var gSheet = backfillSchemaColumns(masterSs, "Global_Users");
    var gHeaders = gSheet.getRange(1, 1, 1, gSheet.getLastColumn()).getValues()[0];
    var gRow = findRowIndexInSheet(gSheet, gHeaders, ["user_id"], staffId, compId);
    if (gRow <= 0 && emailLower) {
      gRow = findRowIndexInSheet(gSheet, gHeaders, ["email"], emailLower, compId);
    }
    var isDirRole = (roleUp === "OWNER" || roleUp === "ADMIN" || roleUp === "SUPER_ADMIN");
    if (gRow > 0 || (isDirRole && emailLower)) {
      var gObj = {
        user_id: staffId,
        email: emailLower,
        password_hash: resolvedPinHash,
        password_salt: cleanSalt,
        company_id: compId,
        role: roleUp || "OWNER",
        full_name: fullName || "Business Owner",
        branch_id: (brId && brId !== "ALL") ? brId : "BR-MAIN",
        is_active: isActive !== false,
        updated_at: nowIso
      };
      if (gRow > 0) updateRowByHeaders(gSheet, gRow, gHeaders, gObj);
      else writeRowByHeaders(gSheet, gHeaders, gObj);
    }
  } catch (gErr) {}

  // 2. Mirror into Master `companies.password_hash` + `companies.password_salt` when user is OWNER or matches owner_email
  try {
    var cSheet = backfillSchemaColumns(masterSs, "companies");
    if (cSheet && cSheet.getLastRow() >= 2) {
      var cData = cSheet.getDataRange().getValues();
      var cHeaders = cData[0];
      var cidIdx = cHeaders.indexOf("company_id");
      var pwIdx = cHeaders.indexOf("password_hash");
      var saltIdx = cHeaders.indexOf("password_salt");
      var oeIdx = cHeaders.indexOf("owner_email");
      var updIdx = cHeaders.indexOf("updated_at");
      if (cidIdx !== -1 && pwIdx !== -1) {
        for (var r = 1; r < cData.length; r++) {
          if (String(cData[r][cidIdx] || "").trim().toUpperCase() !== compUp) continue;
          var compOwnerEmail = oeIdx !== -1 ? String(cData[r][oeIdx] || "").trim().toLowerCase() : "";
          var isOwnerMatch = (roleUp === "OWNER") || (emailLower && compOwnerEmail && emailLower === compOwnerEmail);
          if (isOwnerMatch) {
            cSheet.getRange(r + 1, pwIdx + 1).setValue(resolvedPinHash);
            if (saltIdx !== -1) cSheet.getRange(r + 1, saltIdx + 1).setValue(cleanSalt);
            if (updIdx !== -1) cSheet.getRange(r + 1, updIdx + 1).setValue(nowIso);
            touchedCompany = true;
          }
          break;
        }
      }
    }
  } catch (cErr) {}

  if (touchedCompany) {
    try { invalidateCompanyCache(compId); } catch (icErr) {}
  }
}

function mirrorStaffToMasterUsers(masterSs, compId, brId, staffId, d, seq, nowIso) {
  try {
    var uSheet = backfillSchemaColumns(masterSs, "users");
    var uHeaders = uSheet.getRange(1, 1, 1, uSheet.getLastColumn()).getValues()[0];
    var rowIdx = findRowIndexInSheet(uSheet, uHeaders, ["user_id", "entity_id"], staffId, compId);
    var emailLower = String(d.email || "").trim().toLowerCase();
    if (rowIdx <= 0 && emailLower) {
      rowIdx = findRowIndexInSheet(uSheet, uHeaders, ["email"], emailLower, compId);
    }

    var resolvedPinHash = String(d.pin_hash || d.pinHash || "").trim();
    var resolvedPinSalt = String(d.pin_salt || d.pinSalt || "").trim();
    var resolvedPinVer = Number(d.pinVersion || d.pin_version || 0);
    var resolvedPinUpdatedAt = d.pinUpdatedAt
      ? (isNaN(Number(d.pinUpdatedAt)) ? String(d.pinUpdatedAt) : new Date(Number(d.pinUpdatedAt)).toISOString())
      : (d.pin_updated_at ? String(d.pin_updated_at) : "");
    var pinAccepted = Boolean(resolvedPinHash);

    if (rowIdx > 0) {
      var prevMaster = extractExistingEnvelopeState(uSheet, rowIdx, uHeaders);
      var prevPinVer = Number(prevMaster.raw.pin_version || (prevMaster.data && (prevMaster.data.pinVersion || prevMaster.data.pin_version)) || 0);
      var prevPinHash = String(prevMaster.raw.pin_hash || (prevMaster.data && (prevMaster.data.pin_hash || prevMaster.data.PinHash)) || "").trim();
      if (prevPinHash && (!resolvedPinHash || (prevPinVer > 0 && (resolvedPinVer === 0 || prevPinVer > resolvedPinVer)))) {
        resolvedPinHash = prevPinHash;
        resolvedPinSalt = String(prevMaster.raw.pin_salt || resolvedPinSalt || "");
        resolvedPinVer = Math.max(prevPinVer, resolvedPinVer);
        resolvedPinUpdatedAt = String(prevMaster.raw.pin_updated_at || resolvedPinUpdatedAt || "");
        pinAccepted = false;
      }
    }

    var cleanForMaster = sanitizePayloadForCloud("staff", d);
    cleanForMaster.id = staffId;
    if (resolvedPinHash) cleanForMaster.pin_hash = resolvedPinHash;
    if (resolvedPinSalt) cleanForMaster.pin_salt = resolvedPinSalt;
    if (resolvedPinVer > 0) cleanForMaster.pinVersion = resolvedPinVer;

    var resolvedRole = String(d.role || "CASHIER").toUpperCase();
    var resolvedActive = (d.active !== "N" && d.is_active !== false && d.active !== false);
    var resolvedName = d.name || d.full_name || "Staff";

    var uRow = {
      user_id: staffId,
      company_id: compId,
      branch_id: brId === "ALL" ? "BR-MAIN" : brId,
      full_name: resolvedName,
      email: d.email || "",
      phone: d.phone || "",
      role: resolvedRole,
      pin_hash: resolvedPinHash,
      pin_salt: resolvedPinSalt,
      pin_version: resolvedPinVer,
      pin_updated_at: resolvedPinUpdatedAt,
      assigned_branch_ids: JSON.stringify(d.assignedBranchIds || []),
      branch_assignments_json: JSON.stringify(d.branchAssignments || []),
      permissions_json: JSON.stringify(d.permissions || {}),
      is_active: resolvedActive,
      created_at: d.createdAt || nowIso,
      updated_at: nowIso,
      entity_type: "staff",
      entity_id: staffId,
      version: Number(d.version || 1),
      mutation_source: String(d.mutationSource || "USER_EDIT"),
      client_updated_at: d.updatedAt ? new Date(Number(d.updatedAt)).toISOString() : nowIso,
      server_updated_at: nowIso,
      server_seq: seq,
      is_deleted: false,
      server_received_at: nowIso,
      suspicious_backdate: false,
      payload_json: JSON.stringify(cleanForMaster)
    };
    if (rowIdx > 0) updateRowByHeaders(uSheet, rowIdx, uHeaders, uRow);
    else writeRowByHeaders(uSheet, uHeaders, uRow);

    if (pinAccepted && resolvedPinHash) {
      mirrorOwnerCredentialsToMasterDirectory(
        masterSs, compId, staffId, resolvedRole, emailLower, resolvedName, brId, resolvedPinHash, resolvedActive, nowIso, resolvedPinSalt
      );
    }
  } catch (e) {}
}

function mirrorBranchToMasterBranches(masterSs, compId, brId, d, seq, nowIso) {
  try {
    var bSheet = backfillSchemaColumns(masterSs, "branches");
    var bHeaders = bSheet.getRange(1, 1, 1, bSheet.getLastColumn()).getValues()[0];
    var rowIdx = findRowIndexInSheet(bSheet, bHeaders, ["branch_id", "entity_id"], brId, compId);
    var bRow = {
      branch_id: brId,
      company_id: compId,
      branch_name: d.name || d.branch_name || brId,
      branch_code: d.code || d.branch_code || brId,
      location: d.location || d.address || "",
      location_code: d.code || d.branch_code || brId,
      address: d.address || d.location || "",
      phone: d.phone || "",
      is_main: Boolean(d.is_main || brId === "BR-MAIN"),
      is_active: d.is_active !== false,
      created_at: d.createdAt || nowIso,
      updated_at: nowIso,
      entity_type: "branch",
      entity_id: brId,
      version: Number(d.version || 1),
      mutation_source: String(d.mutationSource || "USER_EDIT"),
      client_updated_at: d.updatedAt ? new Date(Number(d.updatedAt)).toISOString() : nowIso,
      server_updated_at: nowIso,
      server_seq: seq,
      is_deleted: false,
      server_received_at: nowIso,
      suspicious_backdate: false,
      payload_json: JSON.stringify(sanitizePayloadForCloud("branch", d))
    };
    if (rowIdx > 0) updateRowByHeaders(bSheet, rowIdx, bHeaders, bRow);
    else writeRowByHeaders(bSheet, bHeaders, bRow);
  } catch (e) {}
}

function reconstructDataFromLegacyRow(entityType, rawObj) {
  var out = {};
  for (var k in rawObj) {
    if (!rawObj.hasOwnProperty(k)) continue;
    if (SYNC_TRAILING_HEADERS.indexOf(k) !== -1) continue;
    out[k] = rawObj[k];
  }
  switch (entityType) {
    case "sale":
      out.id = rawObj.InvoiceID || rawObj.entity_id || "";
      out.date = rawObj.Date || "";
      out.timestamp = rawObj.Timestamp || rawObj.client_updated_at || "";
      out.time = rawObj.Time || "";
      out.staffId = rawObj.StaffID || "";
      out.staffName = rawObj.StaffName || "";
      out.customerName = rawObj.CustomerName || "Walk-in";
      out.itemsSummary = rawObj.ItemsSummary || "";
      out.totalQty = Number(rawObj.TotalQty || 0);
      out.total = Number(rawObj.Total || 0);
      out.subtotal = Number(rawObj.Subtotal || out.total || 0);
      out.discount = Number(rawObj.Discount || 0);
      out.amountTendered = Number(rawObj.AmountTendered || out.total || 0);
      out.changeGiven = Number(rawObj.ChangeGiven || 0);
      out.paymentMethod = rawObj.PaymentMethod || "Cash";
      out.currency = rawObj.Currency || "USD";
      out.status = rawObj.Status || "Completed";
      break;
    case "inventory_item":
      out.itemId = rawObj.ProductID || rawObj.entity_id || "";
      out.id = out.itemId;
      out.itemName = rawObj.ItemName || rawObj.Name || "";
      out.name = out.itemName;
      out.sku = rawObj.SKU || "";
      out.barcode = rawObj.Barcode || "";
      out.category = rawObj.Category || "General";
      out.unitsPerCase = Math.max(1, Number(rawObj.CaseSize || rawObj.UnitsPerCase || 1) || 1);
      out.sellPriceUnit = Number(rawObj.SellPriceUnit !== undefined && rawObj.SellPriceUnit !== "" ? rawObj.SellPriceUnit : (rawObj.SellingPrice || 0));
      out.sellPriceCase = Number(rawObj.SellPriceCase !== undefined && rawObj.SellPriceCase !== "" ? rawObj.SellPriceCase : (out.sellPriceUnit * out.unitsPerCase));
      out.price = out.sellPriceUnit;
      out.costPriceUnit = Number(rawObj.CostPriceUnit !== undefined && rawObj.CostPriceUnit !== "" ? rawObj.CostPriceUnit : (rawObj.CostPerUnit || rawObj.CostPrice || 0));
      out.costPerUnit = out.costPriceUnit;
      out.costPriceCase = Number(rawObj.CostPriceCase !== undefined && rawObj.CostPriceCase !== "" ? rawObj.CostPriceCase : (rawObj.CostPerCase || (out.costPriceUnit * out.unitsPerCase)));
      out.costPerCase = out.costPriceCase;
      out.totalUnits = Number(rawObj.TotalUnits !== undefined && rawObj.TotalUnits !== "" ? rawObj.TotalUnits : (rawObj.StockQuantity || 0));
      out.lastUpdated = rawObj.LastUpdated || rawObj.client_updated_at || "";
      break;
    case "staff":
      out.id = rawObj.UserID || rawObj.user_id || rawObj.entity_id || "";
      out.name = rawObj.FullName || rawObj.full_name || "Staff";
      out.role = String(rawObj.Role || rawObj.role || "CASHIER").toUpperCase();
      out.email = rawObj.Email || rawObj.email || "";
      out.phone = rawObj.Phone || rawObj.phone || "";
      out.pin_hash = rawObj.PinHash || rawObj.pin_hash || "";
      out.pin_salt = rawObj.PinSalt || rawObj.pin_salt || "";
      out.pinVersion = Number(rawObj.PinVersion || rawObj.pin_version || 0);
      out.active = (rawObj.Active === "N" || rawObj.is_active === false) ? "N" : "Y";
      break;
    case "branch":
      out.id = rawObj.BranchID || rawObj.branch_id || rawObj.entity_id || "BR-MAIN";
      out.branchId = out.id;
      out.branch_id = out.id;
      out.name = rawObj.BranchName || rawObj.branch_name || out.id;
      out.code = rawObj.BranchCode || rawObj.branch_code || out.id;
      out.location = rawObj.Location || rawObj.location || "";
      break;
    case "customer":
      out.customerId = rawObj.CustomerID || rawObj.entity_id || "";
      out.id = out.customerId;
      out.name = rawObj.CustomerName || rawObj.Name || "";
      out.phone = rawObj.Phone || "";
      out.creditLimit = Number(rawObj.CreditLimit || 0);
      out.currentBalance = Number(rawObj.CurrentBalance || 0);
      break;
    default:
      out.id = out.id || rawObj.entity_id || "";
      break;
  }
  out.company_id = rawObj.CompanyID || rawObj.company_id || TENANT_COMPANY_ID;
  out.branch_id = rawObj.BranchID || rawObj.branch_id || "ALL";
  return out;
}

function handlePullCatchup(req, masterSsOpt, targetSsOpt, companyId, branchId) {
  var targetSs = targetSsOpt || resolveTargetSpreadsheet(masterSsOpt, companyId, req.tenant_sheet_id || req.sheet_id);
  var userRole = String(req.user_role || "CASHIER").toUpperCase();
  var viewerSlot = String(req.viewer_slot || "").toUpperCase();
  var sinceSeq = Number(req.since_seq !== undefined ? req.since_seq : (req.sinceSeq || 0));
  var sinceTsMs = parseTimestampMsSafe(req.since_ts || req.sinceTimestamp);
  var limit = Math.min(500, Math.max(10, Number(req.limit || 250)));
  var offset = Math.max(0, Number(req.cursor || 0));

  var requestedTypes = null;
  if (Array.isArray(req.entity_types) && req.entity_types.length > 0) {
    requestedTypes = {};
    for (var rt = 0; rt < req.entity_types.length; rt++) {
      requestedTypes[String(req.entity_types[rt]).trim().toLowerCase()] = true;
    }
  } else if (typeof req.entity_types === "string" && req.entity_types.trim()) {
    requestedTypes = {};
    var parts = req.entity_types.split(",");
    for (var rt2 = 0; rt2 < parts.length; rt2++) {
      requestedTypes[parts[rt2].trim().toLowerCase()] = true;
    }
  }

  var entityTypesToScan = [];
  for (var et in ENTITY_TO_TAB) {
    if (!ENTITY_TO_TAB.hasOwnProperty(et)) continue;
    if (et === "company") continue;
    if (requestedTypes && !requestedTypes[et]) continue;
    entityTypesToScan.push(et);
  }
  entityTypesToScan.sort(function(a, b) {
    if (a === "tombstone") return -1;
    if (b === "tombstone") return 1;
    return 0;
  });

  var envelopes = [];
  var maxSeqSeen = sinceSeq;
  var scannedTabs = {};

  for (var i = 0; i < entityTypesToScan.length; i++) {
    var eType = entityTypesToScan[i];
    var baseTab = ENTITY_TO_TAB[eType];
    if (scannedTabs[baseTab]) continue;
    scannedTabs[baseTab] = true;

    var sheets = getReadableSheetsForBase(targetSs, baseTab);
    if (sheets.length === 0 && masterSsOpt && targetSs.getId() !== masterSsOpt.getId() && (eType === "staff" || eType === "branch")) {
      sheets = getReadableSheetsForBase(masterSsOpt, eType === "staff" ? "users" : "branches");
    }

    for (var s = 0; s < sheets.length; s++) {
      var sh = sheets[s];
      if (!sh || sh.getLastRow() < 2) continue;
      var vals = sh.getDataRange().getValues();
      var headers = vals[0].map(function(h) { return String(h).trim(); });

      for (var r = 1; r < vals.length; r++) {
        var raw = {};
        for (var c = 0; c < headers.length; c++) {
          raw[headers[c]] = vals[r][c];
        }
        var rowComp = String(raw.CompanyID || raw.company_id || "").trim();
        if (companyId && rowComp && rowComp.toUpperCase() !== companyId.toUpperCase()) continue;

        var rowBranch = String(raw.BranchID || raw.branch_id || "ALL").trim();
        var resolvedType = String(raw.entity_type || eType).trim().toLowerCase();

        if (userRole !== "SUPER_ADMIN" && userRole !== "OWNER" && userRole !== "AUDITOR" &&
            branchId && branchId !== "ALL" && rowBranch && rowBranch !== "ALL" && rowBranch !== "GLOBAL" &&
            rowBranch.toUpperCase() !== branchId.toUpperCase() && !CATALOG_SHARED_ENTITIES[resolvedType]) {
          continue;
        }

        var rowSeq = Number(raw.server_seq || 0);
        var rowUpdatedMs = Math.max(
          parseTimestampMsSafe(raw.server_updated_at),
          parseTimestampMsSafe(raw.client_updated_at),
          parseTimestampMsSafe(raw.UpdatedAt || raw.updated_at || raw.LastUpdated || raw.Timestamp || raw.Date)
        );

        if (sinceSeq > 0) {
          if (rowSeq > 0 && rowSeq <= sinceSeq) continue;
          if (rowSeq === 0 && sinceTsMs > 0 && rowUpdatedMs > 0 && rowUpdatedMs < sinceTsMs) continue;
        } else if (sinceTsMs > 0 && rowUpdatedMs > 0 && rowUpdatedMs < sinceTsMs) {
          continue;
        }

        var dataPayload = null;
        if (raw.payload_json && String(raw.payload_json).trim() !== "") {
          try { dataPayload = JSON.parse(raw.payload_json); } catch (pe2) {}
        }
        if (!dataPayload) {
          dataPayload = reconstructDataFromLegacyRow(resolvedType, raw);
        } else if (typeof dataPayload === "object" && !Array.isArray(dataPayload)) {
          dataPayload.server_received_at = raw.server_received_at || dataPayload.server_received_at;
          if (raw.suspicious_backdate !== "" && raw.suspicious_backdate !== undefined) {
            dataPayload.suspicious_backdate = Boolean(raw.suspicious_backdate === true || String(raw.suspicious_backdate).toUpperCase() === "TRUE");
          }
        }

        if (resolvedType === "staff" && dataPayload && typeof dataPayload === "object") {
          delete dataPayload.pin;
          delete dataPayload.rawPin;
          delete dataPayload.password;
        }

        if (resolvedType === "stocktake_count_submission" && (viewerSlot === "A" || viewerSlot === "B") &&
            userRole !== "OWNER" && userRole !== "AUDITOR" && userRole !== "SUPER_ADMIN") {
          var countSlot = String((dataPayload && dataPayload.slot) || raw.Slot || "").toUpperCase();
          if (countSlot && countSlot !== viewerSlot) {
            dataPayload = {
              sessionId: dataPayload.sessionId || raw.SessionID,
              zoneId: dataPayload.zoneId || raw.ZoneID,
              slot: countSlot,
              staffId: dataPayload.staffId || raw.StaffID,
              staffName: dataPayload.staffName || raw.StaffName,
              isFinalized: Boolean(raw.IsFinalized),
              redactedBlindCount: true,
              lines: []
            };
          }
        }

        var resolvedId = extractEntityIdFromPayload(resolvedType, raw.entity_id, dataPayload) || (resolvedType + "-" + r);
        var isDel = raw.is_deleted === true || String(raw.is_deleted).toUpperCase() === "TRUE";
        if (rowSeq > maxSeqSeen) maxSeqSeen = rowSeq;

        envelopes.push({
          packetId: "GAS-CATCHUP-" + resolvedType + "-" + resolvedId + "-" + (rowSeq || rowUpdatedMs || r),
          entityType: isDel && resolvedType !== "tombstone" ? "tombstone" : resolvedType,
          entityId: isDel && resolvedType !== "tombstone" ? (resolvedType + "::" + resolvedId) : resolvedId,
          action: isDel ? "DELETE" : "UPSERT",
          data: isDel && resolvedType !== "tombstone"
            ? { entityType: resolvedType, entityId: resolvedId, deletedAt: rowUpdatedMs || Date.now() }
            : dataPayload,
          updatedAt: parseTimestampMsSafe(raw.client_updated_at) || rowUpdatedMs || Date.now(),
          version: Number(raw.version || (dataPayload && dataPayload.version) || 1),
          mutationSource: String(raw.mutation_source || (dataPayload && dataPayload.mutationSource) || "CLOUD_CATCHUP"),
          originDeviceId: "APPS_SCRIPT_CLOUD",
          targetBranchId: rowBranch || "ALL",
          class: T2_ENTITY_TYPES[resolvedType] ? "T2" : "T1",
          isCloudSynced: true,
          serverSeq: rowSeq,
          serverReceivedAt: raw.server_received_at || undefined
        });
      }
    }
  }

  envelopes.sort(function(a, b) {
    if (a.entityType === "tombstone" && b.entityType !== "tombstone") return -1;
    if (b.entityType === "tombstone" && a.entityType !== "tombstone") return 1;
    return (a.serverSeq || a.updatedAt || 0) - (b.serverSeq || b.updatedAt || 0);
  });

  var totalCount = envelopes.length;
  var sliced = envelopes.slice(offset, offset + limit);
  var hasMore = offset + limit < totalCount;
  var nowIso = new Date().toISOString();

  return {
    success: true,
    envelopes: sliced,
    count: sliced.length,
    totalCount: totalCount,
    server_seq: maxSeqSeen,
    hasMore: hasMore,
    nextCursor: hasMore ? (offset + limit) : null,
    cutoffTimestamp: Date.now(),
    server_received_at: nowIso
  };
}

function handleLegacyActionAsEnvelope(actionNorm, req, masterSsOpt, targetSs, companyId, branchId) {
  var d = mergeReqPayload(req);
  var entityType = String(req.entityType || d.entityType || "").trim().toLowerCase();
  if (actionNorm === "sync_customer") entityType = "customer";
  if (actionNorm === "stocktake_blind_submit") entityType = "stocktake_count_submission";
  if (actionNorm === "unlock_stocktake_segment") entityType = "stocktake_segment_unlock";
  if (actionNorm === "save_stocktake_segment") entityType = "stocktake_segment";
  if (actionNorm === "claim_stocktake_zone") entityType = "stocktake_zone_claim";
  if (actionNorm === "propose_joint_recount") entityType = "stocktake_joint_proposal";
  if (actionNorm === "finalize_joint_recount" || actionNorm === "approve_stocktake") {
    entityType = actionNorm === "approve_stocktake" ? "stocktake_session" : "stocktake_joint_finalized";
  }

  var pluralToSingular = {
    "sales": "sale",
    "customers": "customer",
    "customer_changes": "customer_change",
    "credit_sales": "credit_sale",
    "credit_groups": "credit_group",
    "cash_logs": "cash_log",
    "cash_lifts": "cash_lift",
    "cash_movements": "cash_movement",
    "cash_accounts": "cash_account",
    "cash_transfers": "cash_transfer",
    "direct_grvs": "direct_grv",
    "goods_received_notes": "goods_received",
    "stock_movements": "stock_movement",
    "expenses": "expense",
    "suppliers": "supplier",
    "categories": "inventory_category",
    "inventory": "inventory_item",
    "branches": "branch",
    "stocktake_sessions": "stocktake_session",
    "stocktake_segments": "stocktake_segment",
    "casual_workers": "casual_worker",
    "tombstones": "tombstone"
  };
  if (pluralToSingular[entityType]) entityType = pluralToSingular[entityType];

  var envelope = {
    packetId: req.clientRequestId || ("LEGACY-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6)),
    entityType: entityType || "audit_log",
    entityId: extractEntityIdFromPayload(entityType, req.entityId || d.id, d),
    action: req.deleteFlag ? "DELETE" : "UPSERT",
    data: d,
    updatedAt: Number(d.updatedAt || req.timestamp || Date.now()),
    version: Number(d.version || 1),
    mutationSource: d.mutationSource || "USER_EDIT",
    originDeviceId: req.deviceId || "LEGACY_CLIENT",
    targetBranchId: branchId || "ALL",
    class: T2_ENTITY_TYPES[entityType] ? "T2" : "T1"
  };

  return handlePushEnvelopes({
    envelopes: [envelope],
    company_id: companyId,
    branch_id: branchId,
    user_role: req.user_role || "OWNER",
    user_branch_id: req.user_branch_id || branchId,
    tenant_sheet_id: req.tenant_sheet_id || req.sheet_id
  }, masterSsOpt, targetSs, companyId, branchId);
}

// ============================================================================
// 6. V7.0 ENTERPRISE SAAS CONTROL PLANE, TEMPLATE PROVISIONING & AUTO-HEALING
// ============================================================================

function generateMasterTemplate(req, masterSsOpt) {
  var ss = masterSsOpt || getMasterSpreadsheet();
  var tplName = "TEMPLATE_TENANT_Saimetric_V" + CURRENT_TENANT_SCHEMA_VERSION;
  var tplSs = SpreadsheetApp.create(tplName);
  setupTenantSpreadsheetTabs(tplSs, "TEMPLATE", tplName);
  var defSheet = tplSs.getSheetByName("Sheet1");
  if (defSheet && tplSs.getSheets().length > 1) {
    try { tplSs.deleteSheet(defSheet); } catch (e) {}
  }
  writeTenantMeta(tplSs, {
    company_id: "TEMPLATE",
    schema_version: String(CURRENT_TENANT_SCHEMA_VERSION),
    routing_epoch: "1",
    next_server_seq: "0",
    template_version: CODE_GS_VERSION,
    created_at: new Date().toISOString()
  });

  var tplId = tplSs.getId();
  var props = PropertiesService.getScriptProperties();
  props.setProperty("TEMPLATE_TENANT_ID", tplId);

  try {
    ensureAllMasterTabsExist(ss);
    var scSheet = backfillSchemaColumns(ss, "System_Config");
    var scData = scSheet.getDataRange().getValues();
    var nowIso = new Date().toISOString();
    var updated = false;
    for (var i = 1; i < scData.length; i++) {
      if (String(scData[i][0] || "").trim() === "TEMPLATE_TENANT_ID") {
        scSheet.getRange(i + 1, 2, 1, 3).setValues([[tplId, "Master Tenant Template Spreadsheet ID", nowIso]]);
        updated = true;
        break;
      }
    }
    if (!updated) {
      scSheet.appendRow(["TEMPLATE_TENANT_ID", tplId, "Master Tenant Template Spreadsheet ID", nowIso]);
    }
    CACHE.remove("sys:global_cfg");
  } catch (e2) {}

  return {
    success: true,
    template_id: tplId,
    url: tplSs.getUrl(),
    schema_version: CURRENT_TENANT_SCHEMA_VERSION,
    tabsCount: tplSs.getSheets().length,
    message: "Generated master TEMPLATE_TENANT spreadsheet cleanly."
  };
}

function updateMasterCompanyRoutingFields(masterSs, companyId, updates) {
  var cSheet = backfillSchemaColumns(masterSs, "companies");
  var data = cSheet.getDataRange().getValues();
  var h = data[0];
  var idCol = h.indexOf("company_id");
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol] || "").trim().toUpperCase() === String(companyId).trim().toUpperCase()) {
      for (var k in updates) {
        if (!updates.hasOwnProperty(k)) continue;
        var col = h.indexOf(k);
        if (col !== -1) {
          cSheet.getRange(i + 1, col + 1).setValue(updates[k]);
        }
      }
      invalidateCompanyCache(companyId);
      return true;
    }
  }
  return false;
}

function provisionTenantFromTemplate(req, masterSs) {
  var d = mergeReqPayload(req);
  var companyId = String(d.company_id || req.company_id || TENANT_COMPANY_ID).trim();
  var companyName = String(d.company_name || req.company_name || TENANT_COMPANY_NAME).trim();
  var explicitSheetId = String(req.tenant_sheet_id || req.sheet_id || d.sheet_id || "").trim();
  var folderId = String(d.folder_id || req.folder_id || "").trim();
  var forceNew = d.force_new === true || req.force_new === true || String(d.force_new || req.force_new || "").toLowerCase() === "true";
  var cfg = getSystemConfigCached(masterSs);
  var tplId = String(cfg.TEMPLATE_TENANT_ID || PropertiesService.getScriptProperties().getProperty("TEMPLATE_TENANT_ID") || "").trim();
  var nowIso = new Date().toISOString();

  // CRITICAL GUARD: Never allow a non-master tenant to be bound to the Master Spreadsheet!
  // Also reject folderId if it was mistakenly set to the Master Spreadsheet ID.
  if (explicitSheetId && !isMasterCompanyId_(companyId) && isMasterSpreadsheetId_(explicitSheetId, masterSs)) {
    explicitSheetId = "";
  }
  if (forceNew) {
    explicitSheetId = "";
  }
  if (folderId && isMasterSpreadsheetId_(folderId, masterSs)) {
    folderId = "";
  }

  // Case 1: Caller explicitly passed an existing dedicated Sheet ID (manual bind / Initialize Tabs)
  if (explicitSheetId && explicitSheetId.length >= 15) {
    var existingSs = SpreadsheetApp.openById(explicitSheetId);
    var createdExplicit = setupTenantSpreadsheetTabs(existingSs, companyId, companyName);
    var currentMeta = readTenantMeta(existingSs);
    var epochEx = Number(currentMeta.routing_epoch || 1);
    writeTenantMeta(existingSs, {
      company_id: companyId,
      company_name: companyName,
      schema_version: String(CURRENT_TENANT_SCHEMA_VERSION),
      routing_epoch: String(epochEx),
      provisioned_at: currentMeta.provisioned_at || nowIso
    });
    updateMasterCompanyRoutingFields(masterSs, companyId, {
      sheet_id: explicitSheetId,
      url: existingSs.getUrl(),
      routing_epoch: epochEx,
      schema_version: CURRENT_TENANT_SCHEMA_VERSION,
      provisioned_date: nowIso.split("T")[0],
      updated_at: nowIso
    });
    PropertiesService.getScriptProperties().setProperty("ROUTE_EPOCH_" + companyId.toUpperCase(), String(epochEx));
    if (Array.isArray(req.initial_products) && req.initial_products.length > 0) {
      handleSyncInventory({ items: req.initial_products, user_role: "OWNER", tenant_sheet_id: explicitSheetId }, masterSs, existingSs, companyId, "ALL");
    }
    return {
      success: true,
      company_id: companyId,
      sheet_id: explicitSheetId,
      spreadsheet_id: explicitSheetId,
      url: existingSs.getUrl(),
      routing_epoch: epochEx,
      schema_version: CURRENT_TENANT_SCHEMA_VERSION,
      createdTabs: createdExplicit,
      provisioned_via: "EXPLICIT_DEDICATED_BIND",
      message: "Initialized tenant spreadsheet V7.0 cleanly."
    };
  }

  // Case 2: Instant ~2s makeCopy provisioning from TEMPLATE_TENANT_ID (with automatic fresh SpreadsheetApp.create fallback)
  var newFileId = "";
  var targetSs = null;
  var provisionedVia = "FRESH_CREATE";
  var newName = "Saimetric_POS_" + companyId + "_" + companyName.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 32);

  if (tplId && !isMasterSpreadsheetId_(tplId, masterSs)) {
    try {
      var tplFile = DriveApp.getFileById(tplId);
      var copyFile = null;
      if (folderId) {
        try {
          var targetFolder = DriveApp.getFolderById(folderId);
          copyFile = tplFile.makeCopy(newName, targetFolder);
        } catch (folderErr) {
          copyFile = tplFile.makeCopy(newName);
        }
      } else {
        copyFile = tplFile.makeCopy(newName);
      }
      newFileId = copyFile.getId();
      targetSs = SpreadsheetApp.openById(newFileId);
      provisionedVia = "TEMPLATE_MAKECOPY";
    } catch (tplErr) {
      // Fallback to fresh spreadsheet creation if template ID is stale or inaccessible
      newFileId = "";
      targetSs = null;
    }
  }

  if (!targetSs || !newFileId) {
    targetSs = SpreadsheetApp.create(newName);
    newFileId = targetSs.getId();
    provisionedVia = "FRESH_CREATE";
    setupTenantSpreadsheetTabs(targetSs, companyId, companyName);
    var s1 = targetSs.getSheetByName("Sheet1");
    if (s1 && targetSs.getSheets().length > 1) {
      try { targetSs.deleteSheet(s1); } catch (e0) {}
    }
    if (folderId) {
      try {
        var fObj = DriveApp.getFileById(newFileId);
        fObj.moveTo(DriveApp.getFolderById(folderId));
      } catch (eMove) {}
    }
  }

  // Safety check: newly created spreadsheet must NEVER be the Master Spreadsheet
  if (isMasterSpreadsheetId_(newFileId, masterSs)) {
    return {
      success: false,
      error: "Provisioning guard prevented assigning Master Spreadsheet to tenant " + companyId
    };
  }

  // Two-phase commit with Drive trash rollback if Master update fails
  try {
    writeTenantMeta(targetSs, {
      company_id: companyId,
      company_name: companyName,
      schema_version: String(CURRENT_TENANT_SCHEMA_VERSION),
      routing_epoch: "1",
      next_server_seq: "0",
      provisioned_at: nowIso
    });
    var updatedMaster = updateMasterCompanyRoutingFields(masterSs, companyId, {
      sheet_id: newFileId,
      url: targetSs.getUrl(),
      routing_epoch: 1,
      schema_version: CURRENT_TENANT_SCHEMA_VERSION,
      provisioned_date: nowIso.split("T")[0],
      updated_at: nowIso
    });
    if (!updatedMaster) {
      throw new Error("Master company row not found for " + companyId);
    }
    PropertiesService.getScriptProperties().setProperty("ROUTE_EPOCH_" + companyId.toUpperCase(), "1");
    invalidateCompanyCache(companyId);

    if (Array.isArray(req.initial_products) && req.initial_products.length > 0) {
      handleSyncInventory({ items: req.initial_products, user_role: "OWNER", tenant_sheet_id: newFileId }, masterSs, targetSs, companyId, "ALL");
    }

    return {
      success: true,
      company_id: companyId,
      sheet_id: newFileId,
      spreadsheet_id: newFileId,
      url: targetSs.getUrl(),
      routing_epoch: 1,
      schema_version: CURRENT_TENANT_SCHEMA_VERSION,
      provisioned_via: provisionedVia,
      message: "Provisioned dedicated tenant spreadsheet cleanly."
    };
  } catch (commitErr) {
    if (newFileId) {
      try { DriveApp.getFileById(newFileId).setTrashed(true); } catch (rbErr) {}
    }
    return {
      success: false,
      error: "Tenant provisioning rolled back: " + commitErr.message
    };
  }
}

function healTenantSchema(targetSs, companyId) {
  var meta = readTenantMeta(targetSs);
  var currentVer = Number(meta.schema_version || 0);
  var createdTabs = setupTenantSpreadsheetTabs(targetSs, companyId, meta.company_name || TENANT_COMPANY_NAME);
  var healedTabs = [];

  for (var baseTab in TAB_TEMPLATES) {
    if (!TAB_TEMPLATES.hasOwnProperty(baseTab)) continue;
    if (MASTER_TAB_NAMES.indexOf(baseTab) !== -1) continue;
    var matching = getReadableSheetsForBase(targetSs, baseTab);
    for (var m = 0; m < matching.length; m++) {
      ensureTabHeaders(matching[m], TAB_TEMPLATES[baseTab]);
      healedTabs.push(matching[m].getName());
    }
  }

  writeTenantMeta(targetSs, {
    company_id: companyId,
    schema_version: String(CURRENT_TENANT_SCHEMA_VERSION),
    healed_at: new Date().toISOString(),
    previous_schema_version: String(currentVer)
  });

  return {
    previousVersion: currentVer,
    newVersion: CURRENT_TENANT_SCHEMA_VERSION,
    createdTabs: createdTabs,
    healedTabsCount: healedTabs.length
  };
}

function handleBumpRoutingEpoch(req, masterSs) {
  var d = mergeReqPayload(req);
  var companyId = String(d.company_id || req.company_id || TENANT_COMPANY_ID).trim();
  var newSheetId = String(d.sheet_id || d.spreadsheet_id || req.sheet_id || "").trim();
  var comp = getCompany(companyId, masterSs);
  if (!comp) {
    return { success: false, error: "Company not found: " + companyId };
  }

  var compUpper = companyId.toUpperCase();
  var props = PropertiesService.getScriptProperties();
  var prevEpoch = Math.max(Number(comp.routing_epoch || 1), Number(props.getProperty("ROUTE_EPOCH_" + compUpper) || "1"));
  var nextEpoch = prevEpoch + 1;
  var effectiveSheetId = newSheetId || String(comp.sheet_id || "").trim();
  var nowIso = new Date().toISOString();

  var masterUpdates = {
    routing_epoch: nextEpoch,
    updated_at: nowIso
  };
  if (effectiveSheetId) {
    masterUpdates.sheet_id = effectiveSheetId;
    masterUpdates.url = "https://docs.google.com/spreadsheets/d/" + effectiveSheetId + "/edit";
  }
  updateMasterCompanyRoutingFields(masterSs, companyId, masterUpdates);
  props.setProperty("ROUTE_EPOCH_" + compUpper, String(nextEpoch));

  if (effectiveSheetId && effectiveSheetId.length >= 15) {
    try {
      var targetSs = SpreadsheetApp.openById(effectiveSheetId);
      writeTenantMeta(targetSs, { routing_epoch: String(nextEpoch), company_id: companyId });
    } catch (e) {}
  }

  invalidateCompanyCache(companyId);
  return {
    success: true,
    company_id: companyId,
    routing_epoch: nextEpoch,
    sheet_id: effectiveSheetId,
    spreadsheet_id: effectiveSheetId
  };
}

function runFleetMigration(req, masterSsOpt) {
  var ss = masterSsOpt || getMasterSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var startMs = Date.now();
  var SAFETY_BUDGET_MS = 250000; // 250s safe margin below 6m Apps Script timeout

  var cSheet = ss.getSheetByName("companies");
  if (!cSheet || cSheet.getLastRow() < 2) {
    return { success: true, migrated: 0, message: "No companies to migrate" };
  }

  var data = cSheet.getDataRange().getValues();
  var h = data[0];
  var idCol = h.indexOf("company_id");
  var shCol = h.indexOf("sheet_id");
  var svCol = h.indexOf("schema_version");
  var stCol = h.indexOf("subscription_status");
  var updCol = h.indexOf("updated_at");
  var epCol = h.indexOf("routing_epoch");

  var startIdx = Math.max(1, Number(props.getProperty("FLEET_MIGRATION_OFFSET") || "1"));
  if (startIdx >= data.length) startIdx = 1;

  var migrated = 0;
  var skipped = 0;
  var errors = [];
  var bumpEpochOnHeal = Boolean(req && req.bump_routing_epoch);
  var nowIso = new Date().toISOString();

  var i = startIdx;
  for (; i < data.length; i++) {
    if (Date.now() - startMs > SAFETY_BUDGET_MS) {
      props.setProperty("FLEET_MIGRATION_OFFSET", String(i));
      return {
        success: true,
        partial: true,
        nextOffset: i,
        migrated: migrated,
        skipped: skipped,
        errors: errors,
        targetVersion: CURRENT_TENANT_SCHEMA_VERSION
      };
    }

    var compId = String(data[i][idCol] || "").trim();
    var sheetId = shCol !== -1 ? String(data[i][shCol] || "").trim() : "";
    var rowVer = svCol !== -1 ? Number(data[i][svCol] || 0) : 0;
    var status = stCol !== -1 ? String(data[i][stCol] || "").toUpperCase() : "ACTIVE";
    if (!compId || !sheetId || sheetId.length < 15 || status === "CANCELLED") {
      skipped++;
      continue;
    }
    if (rowVer >= CURRENT_TENANT_SCHEMA_VERSION && !(req && req.force)) {
      skipped++;
      continue;
    }

    var lease = acquireTenantLease(compId, 8000);
    if (!lease.acquired) {
      errors.push({ company_id: compId, error: "TENANT_LOCK_BUSY" });
      continue;
    }

    try {
      var tSs = SpreadsheetApp.openById(sheetId);
      healTenantSchema(tSs, compId);
      if (svCol !== -1) cSheet.getRange(i + 1, svCol + 1).setValue(CURRENT_TENANT_SCHEMA_VERSION);
      if (updCol !== -1) cSheet.getRange(i + 1, updCol + 1).setValue(nowIso);
      if (bumpEpochOnHeal && epCol !== -1) {
        var curEp = Number(data[i][epCol] || 1);
        var nxtEp = curEp + 1;
        cSheet.getRange(i + 1, epCol + 1).setValue(nxtEp);
        writeTenantMeta(tSs, { routing_epoch: String(nxtEp) });
        props.setProperty("ROUTE_EPOCH_" + compId.toUpperCase(), String(nxtEp));
      }
      invalidateCompanyCache(compId);
      migrated++;
    } catch (mErr) {
      errors.push({ company_id: compId, error: mErr.message });
    } finally {
      releaseTenantLease(lease);
    }
  }

  props.setProperty("FLEET_MIGRATION_OFFSET", "1");
  return {
    success: true,
    partial: false,
    migrated: migrated,
    skipped: skipped,
    errors: errors,
    targetVersion: CURRENT_TENANT_SCHEMA_VERSION
  };
}

function installFleetMigrationTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "runFleetMigration") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("runFleetMigration").timeBased().everyDays(1).atHour(2).create();
  return { success: true, message: "Daily runFleetMigration trigger installed for 02:00 AM." };
}

function handleSignup(req, ss) {
  var d = mergeReqPayload(req);
  var companyName = String(d.company_name || d.companyName || "New Company").trim();
  var ownerName = String(d.owner_name || d.ownerName || d.full_name || d.fullName || "Owner").trim();
  var ownerEmail = String(d.owner_email || d.email || "").trim().toLowerCase();
  var password = String(d.password || d.pin || "Pass123").trim();
  var ownerPin = String(d.pin || d.password || "1234").trim();
  var phone = String(d.phone || "").trim();
  var plan = String(d.plan || "PROFESSIONAL").toUpperCase();
  var businessCategory = String(d.business_category || d.businessCategory || "Wholesale & Retail").trim();
  var forceNewTenant = d.force_new_tenant === true || d.forceNewTenant === true || String(d.force_new_tenant || "").toLowerCase() === "true";

  var cSheet = backfillSchemaColumns(ss, "companies");
  var cData = cSheet.getDataRange().getValues();
  var cHeaders = cData[0];
  var emailCol = cHeaders.indexOf("owner_email");
  var compIdCol = cHeaders.indexOf("company_id");

  var companyId = String(d.company_id || d.companyId || ("COMP-" + Math.random().toString(36).substring(2, 7).toUpperCase())).trim();
  var existingCompanyRow = -1;

  if (cData.length >= 2) {
    for (var i = 1; i < cData.length; i++) {
      var rowCompId = compIdCol !== -1 ? String(cData[i][compIdCol] || "").trim() : "";
      var rowEmail = emailCol !== -1 ? String(cData[i][emailCol] || "").trim().toLowerCase() : "";
      if (rowCompId && rowCompId.toUpperCase() === companyId.toUpperCase()) {
        existingCompanyRow = i + 1;
        break;
      }
      if (!forceNewTenant && ownerEmail && rowEmail === ownerEmail) {
        return {
          success: false,
          code: "DUPLICATE_EMAIL",
          error: "An account with this email already exists.",
          existing_company_id: rowCompId
        };
      }
    }
  }

  var branchId = String(d.branch_id || d.branchId || "BR-MAIN").trim();
  var branchName = String(d.branch_name || d.branchName || "Main Branch").trim();
  var branchCode = String(d.branch_code || d.branchCode || "HQ-01").trim().toUpperCase();
  var branchLocation = String(d.branch_location || d.branchLocation || d.address || "").trim();
  var ownerUserId = String(d.user_id || d.owner_id || d.userId || ("USR-" + companyId + "-01")).trim();

  var nowIso = new Date().toISOString();
  var trialEnd = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
  var activationCode = String(d.offline_activation_code || d.activation_code || ("SAI-" + Math.random().toString(36).substring(2, 8).toUpperCase())).trim();
  var seq = allocateNextServerSeq(ss, companyId);
  var pwHash = hashPasswordSha256(password);

  var safeIncomingSheetId = String(d.sheet_id || "").trim();
  if (safeIncomingSheetId && !isMasterCompanyId_(companyId) && isMasterSpreadsheetId_(safeIncomingSheetId, ss)) {
    safeIncomingSheetId = "";
  }
  var safeIncomingFolderId = String(d.folder_id || "").trim();
  if (safeIncomingFolderId && isMasterSpreadsheetId_(safeIncomingFolderId, ss)) {
    safeIncomingFolderId = "";
  }

  var compRow = {
    company_id: companyId,
    company_name: companyName,
    owner_name: ownerName,
    owner_email: ownerEmail,
    password_hash: pwHash,
    phone: phone,
    business_category: businessCategory,
    plan: plan,
    subscription_status: "TRIAL",
    status: "TRIAL",
    expiry: trialEnd,
    trial_start_date: nowIso.split("T")[0],
    next_billing_date: trialEnd,
    sheet_id: safeIncomingSheetId,
    url: safeIncomingSheetId ? ("https://docs.google.com/spreadsheets/d/" + safeIncomingSheetId + "/edit") : "",
    routing_epoch: 1,
    provisioned_date: safeIncomingSheetId ? nowIso.split("T")[0] : "",
    webhook_url: d.webhook_url || "",
    branch_isolation_mode: d.branch_isolation_mode || "ROW_LEVEL",
    activation_code: activationCode,
    schema_version: CURRENT_TENANT_SCHEMA_VERSION,
    created_at: nowIso,
    updated_at: nowIso,
    entity_type: "company",
    entity_id: companyId,
    version: 1,
    mutation_source: "SIGNUP",
    client_updated_at: nowIso,
    server_updated_at: nowIso,
    server_seq: seq,
    is_deleted: false,
    server_received_at: nowIso,
    suspicious_backdate: false,
    payload_json: JSON.stringify({
      company_id: companyId,
      company_name: companyName,
      owner_name: ownerName,
      owner_email: ownerEmail,
      phone: phone,
      business_category: businessCategory,
      plan: plan
    })
  };
  if (existingCompanyRow > 0) updateRowByHeaders(cSheet, existingCompanyRow, cHeaders, compRow);
  else writeRowByHeaders(cSheet, cHeaders, compRow);

  // Mirror owner to Global_Users for fast cross-device directory lookups
  try {
    var gSheet = backfillSchemaColumns(ss, "Global_Users");
    var gHeaders = gSheet.getRange(1, 1, 1, gSheet.getLastColumn()).getValues()[0];
    var existingGlobalRow = findRowIndexInSheet(gSheet, gHeaders, ["user_id", "email"], ownerUserId, companyId);
    var globalRow = {
      user_id: ownerUserId,
      email: ownerEmail,
      password_hash: pwHash,
      company_id: companyId,
      role: "OWNER",
      full_name: ownerName,
      branch_id: branchId,
      is_active: true,
      updated_at: nowIso
    };
    if (existingGlobalRow > 0) updateRowByHeaders(gSheet, existingGlobalRow, gHeaders, globalRow);
    else writeRowByHeaders(gSheet, gHeaders, globalRow);
  } catch (gErr) {}

  handleCreateBranch({
    company_id: companyId,
    branch_id: branchId,
    branch_name: branchName,
    branch_code: branchCode,
    location: branchLocation,
    address: branchLocation,
    is_main: true
  }, ss);

  handleUpsertStaff({
    company_id: companyId,
    branch_id: branchId,
    user_id: ownerUserId,
    full_name: ownerName,
    email: ownerEmail,
    phone: phone,
    role: "OWNER",
    pin: ownerPin,
    pin_hash: d.pin_hash || pwHash,
    pin_salt: d.pin_salt || "",
    is_active: true
  }, ss, ss, companyId, branchId);

  var perms = getSeedPermissions52();
  var pSheet = backfillSchemaColumns(ss, "permissions");
  var pLastCol = pSheet.getLastColumn();
  var pLastRow = pSheet.getLastRow();
  var pHeaders = pSheet.getRange(1, 1, 1, pLastCol).getValues()[0];
  var existingPermMap = {};
  if (pLastRow >= 2) {
    var pIdCol = pHeaders.indexOf("perm_id");
    if (pIdCol !== -1) {
      var pIdVals = pSheet.getRange(2, pIdCol + 1, pLastRow - 1, 1).getValues();
      for (var ep = 0; ep < pIdVals.length; ep++) {
        var key = String(pIdVals[ep][0] || "").trim();
        if (key) existingPermMap[key] = ep + 2;
      }
    }
  }
  var newPermRows = [];
  for (var p = 0; p < perms.length; p++) {
    var pId = companyId + "-" + p;
    var pObj = {
      perm_id: pId,
      company_id: companyId,
      role: perms[p].role,
      module: perms[p].module,
      action: perms[p].action,
      allowed: perms[p].allowed,
      description: perms[p].description || "",
      updated_at: nowIso
    };
    var existingPermRow = existingPermMap[pId] || -1;
    if (existingPermRow > 0) {
      updateRowByHeaders(pSheet, existingPermRow, pHeaders, pObj);
    } else {
      var rowArr = [];
      for (var hc = 0; hc < pHeaders.length; hc++) {
        var hKey = String(pHeaders[hc] || "").trim();
        rowArr.push(pObj.hasOwnProperty(hKey) ? pObj[hKey] : "");
      }
      newPermRows.push(rowArr);
    }
  }
  if (newPermRows.length > 0) {
    pSheet.getRange(pSheet.getLastRow() + 1, 1, newPermRows.length, pHeaders.length).setValues(newPermRows);
  }

  // Always auto-provision a dedicated tenant spreadsheet (via TEMPLATE_TENANT makeCopy or fresh SpreadsheetApp.create fallback)
  // unless explicitly opted out via auto_provision === false
  var provisionedInfo = null;
  var provisionError = "";
  if (d.auto_provision !== false) {
    try {
      var prov = provisionTenantFromTemplate({
        company_id: companyId,
        company_name: companyName,
        sheet_id: safeIncomingSheetId,
        folder_id: safeIncomingFolderId
      }, ss);
      if (prov && prov.success && prov.sheet_id && (isMasterCompanyId_(companyId) || !isMasterSpreadsheetId_(prov.sheet_id, ss))) {
        provisionedInfo = prov;
      } else if (prov && prov.error) {
        provisionError = String(prov.error);
      }
    } catch (provErr) {
      provisionError = provErr && provErr.message ? String(provErr.message) : String(provErr);
    }
  }

  var finalSheetId = (provisionedInfo && provisionedInfo.sheet_id) || safeIncomingSheetId || "";
  if (finalSheetId && !isMasterCompanyId_(companyId) && isMasterSpreadsheetId_(finalSheetId, ss)) {
    finalSheetId = "";
  }
  var finalEpoch = (provisionedInfo && provisionedInfo.routing_epoch) || 1;
  var jwtToken = signJwt({
    sub: ownerUserId,
    company_id: companyId,
    role: "OWNER",
    branch_id: branchId,
    spreadsheet_id: finalSheetId,
    routing_epoch: finalEpoch
  });

  invalidateCompanyCache(companyId);
  return {
    success: true,
    status: "success",
    company_id: companyId,
    company_name: companyName,
    branch_id: branchId,
    branch_name: branchName,
    branch_code: branchCode,
    user_id: ownerUserId,
    owner_name: ownerName,
    owner_email: ownerEmail,
    sheet_id: finalSheetId,
    spreadsheet_id: finalSheetId,
    dedicated_sheet_provisioned: Boolean(finalSheetId && (isMasterCompanyId_(companyId) || !isMasterSpreadsheetId_(finalSheetId, ss))),
    provisioned_via: (provisionedInfo && provisionedInfo.provisioned_via) || "",
    provision_error: provisionError || undefined,
    url: (provisionedInfo && provisionedInfo.url) || compRow.url || "",
    routing_epoch: finalEpoch,
    schema_version: CURRENT_TENANT_SCHEMA_VERSION,
    activation_code: activationCode,
    next_billing_date: trialEnd,
    token: jwtToken
  };
}

function handleOwnerLogin(req, ss) {
  var d = mergeReqPayload(req);
  var email = String(d.email || d.owner_email || "").trim().toLowerCase();
  var password = String(d.password || "").trim();
  if (!email || !password) return { status: "error", success: false, message: "Email and password are required" };

  var cSheet = ss.getSheetByName("companies");
  if (!cSheet || cSheet.getLastRow() < 2) {
    return { status: "error", success: false, message: "Company directory empty" };
  }
  var data = cSheet.getDataRange().getValues();
  var h = data[0];
  var emCol = h.indexOf("owner_email");
  var pwCol = h.indexOf("password_hash");
  var pwSaltCol = h.indexOf("password_salt");
  var idCol = h.indexOf("company_id");

  var buildSafeCompanyObj = function(rowVals) {
    var obj = {};
    for (var c = 0; c < h.length; c++) {
      if (h[c] !== "password_hash" && h[c] !== "password_salt") obj[h[c]] = rowVals[c];
    }
    return obj;
  };

  var findCompanyById = function(targetCompId) {
    var tUp = String(targetCompId || "").trim().toUpperCase();
    if (!tUp || idCol === -1) return null;
    for (var ci = 1; ci < data.length; ci++) {
      if (String(data[ci][idCol] || "").trim().toUpperCase() === tUp) {
        return { rowIndex: ci + 1, obj: buildSafeCompanyObj(data[ci]) };
      }
    }
    return null;
  };

  var matchedCompanyObj = null;
  var matchedUserId = "";
  var matchedRole = "OWNER";
  var matchedBranchId = "";
  var matchedFullName = "";
  var emailFoundInAnyTab = false;

  // Helper to verify password against Master `users` tab (supports salted pin_hash + pin_salt and unsalted pin_hash)
  var verifyAgainstMasterUsersTab = function(targetEmail, optionalCompanyId) {
    var uSheet = ss.getSheetByName("users");
    if (!uSheet || uSheet.getLastRow() < 2) return null;
    var uData = uSheet.getDataRange().getValues();
    var uH = uData[0];
    var uEmCol = uH.indexOf("email");
    var uCompCol = uH.indexOf("company_id");
    var uIdCol = uH.indexOf("user_id");
    var uRoleCol = uH.indexOf("role");
    var uNameCol = uH.indexOf("full_name");
    var uBrCol = uH.indexOf("branch_id");
    var uHashCol = uH.indexOf("pin_hash");
    var uSaltCol = uH.indexOf("pin_salt");
    var uActCol = uH.indexOf("is_active");
    var optUp = String(optionalCompanyId || "").trim().toUpperCase();

    for (var ui = 1; ui < uData.length; ui++) {
      var rowEm = uEmCol !== -1 ? String(uData[ui][uEmCol] || "").trim().toLowerCase() : "";
      var rowComp = uCompCol !== -1 ? String(uData[ui][uCompCol] || "").trim() : "";
      if (rowEm !== targetEmail) continue;
      if (optUp && rowComp.toUpperCase() !== optUp) continue;
      if (uActCol !== -1 && (uData[ui][uActCol] === false || String(uData[ui][uActCol]).toUpperCase() === "FALSE")) continue;
      emailFoundInAnyTab = true;
      var uHash = uHashCol !== -1 ? String(uData[ui][uHashCol] || "").trim() : "";
      var uSalt = uSaltCol !== -1 ? String(uData[ui][uSaltCol] || "").trim() : "";
      if (verifyPasswordHashWithSalt_(password, uHash, uSalt)) {
        return {
          company_id: rowComp,
          user_id: uIdCol !== -1 ? String(uData[ui][uIdCol] || "").trim() : "",
          role: uRoleCol !== -1 ? String(uData[ui][uRoleCol] || "OWNER").trim().toUpperCase() : "OWNER",
          full_name: uNameCol !== -1 ? String(uData[ui][uNameCol] || "").trim() : "",
          branch_id: uBrCol !== -1 ? String(uData[ui][uBrCol] || "").trim() : "",
          pin_hash: uHash,
          pin_salt: uSalt
        };
      }
    }
    return null;
  };

  // 1. Primary lookup in `companies` tab by owner_email (supports salted & unsalted password_hash + self-healing from `users` tab)
  for (var i = 1; i < data.length; i++) {
    if (emCol !== -1 && String(data[i][emCol] || "").trim().toLowerCase() === email) {
      emailFoundInAnyTab = true;
      var storedHash = pwCol !== -1 ? String(data[i][pwCol] || "").trim() : "";
      var storedSalt = pwSaltCol !== -1 ? String(data[i][pwSaltCol] || "").trim() : "";
      var compObj = buildSafeCompanyObj(data[i]);
      if (verifyPasswordHashWithSalt_(password, storedHash, storedSalt)) {
        matchedCompanyObj = compObj;
        matchedUserId = "USR-" + compObj.company_id + "-01";
        matchedFullName = compObj.owner_name || compObj.company_name;
        break;
      }
      // Legacy self-heal path: if companies.password_hash was overwritten with a salted user pin_hash without password_salt,
      // verify cryptographically against the authoritative Master `users` row for this company & email.
      var healedUser = verifyAgainstMasterUsersTab(email, compObj.company_id);
      if (healedUser) {
        matchedCompanyObj = compObj;
        matchedUserId = healedUser.user_id || ("USR-" + compObj.company_id + "-01");
        matchedRole = healedUser.role || "OWNER";
        matchedBranchId = healedUser.branch_id || "";
        matchedFullName = healedUser.full_name || compObj.owner_name || compObj.company_name;
        try {
          mirrorOwnerCredentialsToMasterDirectory(
            ss, compObj.company_id, matchedUserId, matchedRole, email, matchedFullName,
            matchedBranchId || "BR-MAIN", healedUser.pin_hash, true, new Date().toISOString(), healedUser.pin_salt
          );
        } catch (healErr) {}
        break;
      }
    }
  }

  // 2. Fallback lookup in `Global_Users` tab (supports owners/admins synced via Global_Users)
  if (!matchedCompanyObj) {
    var gSheet = ss.getSheetByName("Global_Users");
    if (gSheet && gSheet.getLastRow() >= 2) {
      var gData = gSheet.getDataRange().getValues();
      var gH = gData[0];
      var gEmCol = gH.indexOf("email");
      var gPwCol = gH.indexOf("password_hash");
      var gSaltCol = gH.indexOf("password_salt");
      var gCompCol = gH.indexOf("company_id");
      var gUidCol = gH.indexOf("user_id");
      var gRoleCol = gH.indexOf("role");
      var gNameCol = gH.indexOf("full_name");
      var gBrCol = gH.indexOf("branch_id");
      for (var g = 1; g < gData.length; g++) {
        if (gEmCol !== -1 && String(gData[g][gEmCol] || "").trim().toLowerCase() === email) {
          emailFoundInAnyTab = true;
          var gStored = gPwCol !== -1 ? String(gData[g][gPwCol] || "").trim() : "";
          var gSalt = gSaltCol !== -1 ? String(gData[g][gSaltCol] || "").trim() : "";
          var gCompId = gCompCol !== -1 ? String(gData[g][gCompCol] || "").trim() : "";
          var verifiedViaGlobal = verifyPasswordHashWithSalt_(password, gStored, gSalt);
          var healedFromUsers = !verifiedViaGlobal ? verifyAgainstMasterUsersTab(email, gCompId) : null;
          if (!verifiedViaGlobal && !healedFromUsers) continue;
          matchedUserId = (healedFromUsers && healedFromUsers.user_id) || (gUidCol !== -1 ? String(gData[g][gUidCol] || "").trim() : ("USR-" + gCompId + "-01"));
          matchedRole = (healedFromUsers && healedFromUsers.role) || (gRoleCol !== -1 ? String(gData[g][gRoleCol] || "OWNER").trim().toUpperCase() : "OWNER");
          matchedFullName = (healedFromUsers && healedFromUsers.full_name) || (gNameCol !== -1 ? String(gData[g][gNameCol] || "").trim() : "");
          matchedBranchId = (healedFromUsers && healedFromUsers.branch_id) || (gBrCol !== -1 ? String(gData[g][gBrCol] || "").trim() : "");
          var foundComp = findCompanyById(gCompId);
          if (foundComp) {
            matchedCompanyObj = foundComp.obj;
            if (healedFromUsers) {
              try {
                mirrorOwnerCredentialsToMasterDirectory(
                  ss, gCompId, matchedUserId, matchedRole, email, matchedFullName,
                  matchedBranchId || "BR-MAIN", healedFromUsers.pin_hash, true, new Date().toISOString(), healedFromUsers.pin_salt
                );
              } catch (healErr2) {}
            }
            break;
          }
        }
      }
    }
  }

  // 3. Final fallback lookup in Master `users` tab by email (supports any owner/staff user with salted or unsalted pin_hash)
  if (!matchedCompanyObj) {
    var verifiedDirectUser = verifyAgainstMasterUsersTab(email, "");
    if (verifiedDirectUser && verifiedDirectUser.company_id) {
      var compFromUser = findCompanyById(verifiedDirectUser.company_id);
      if (compFromUser) {
        matchedCompanyObj = compFromUser.obj;
        matchedUserId = verifiedDirectUser.user_id || ("USR-" + verifiedDirectUser.company_id + "-01");
        matchedRole = verifiedDirectUser.role || "OWNER";
        matchedBranchId = verifiedDirectUser.branch_id || "";
        matchedFullName = verifiedDirectUser.full_name || compFromUser.obj.owner_name || compFromUser.obj.company_name;
      }
    }
  }

  if (!matchedCompanyObj) {
    return {
      status: "error",
      success: false,
      message: emailFoundInAnyTab ? "Invalid email or password" : "Account not found"
    };
  }

  var br = matchedBranchId || getTenantPrimaryBranch(matchedCompanyObj.company_id, ss);
  var sheetId = String(matchedCompanyObj.sheet_id || "").trim();
  var compUpper = String(matchedCompanyObj.company_id || "").toUpperCase();
  var propEp = Number(PropertiesService.getScriptProperties().getProperty("ROUTE_EPOCH_" + compUpper) || "1");
  var epoch = Math.max(propEp, Number(matchedCompanyObj.routing_epoch || 1));

  // Warm route cache for subsequent hot-path calls
  getTenantRouteCached(matchedCompanyObj.company_id, ss);

  var jwtToken = signJwt({
    sub: matchedUserId || ("USR-" + matchedCompanyObj.company_id + "-01"),
    company_id: matchedCompanyObj.company_id,
    role: matchedRole || "OWNER",
    branch_id: br,
    spreadsheet_id: sheetId,
    routing_epoch: epoch
  });

  return {
    status: "success",
    success: true,
    role: matchedRole || "OWNER",
    businessId: matchedCompanyObj.company_id,
    company_id: matchedCompanyObj.company_id,
    company_name: matchedCompanyObj.company_name,
    owner_name: matchedCompanyObj.owner_name || matchedFullName || matchedCompanyObj.company_name,
    phone: matchedCompanyObj.phone || "",
    business_category: matchedCompanyObj.business_category || "Wholesale & Retail",
    plan: matchedCompanyObj.plan || "PROFESSIONAL",
    trial_start_date: matchedCompanyObj.trial_start_date || "",
    next_billing_date: matchedCompanyObj.next_billing_date || "",
    offline_activation_code: matchedCompanyObj.activation_code || matchedCompanyObj.offline_activation_code || "",
    branch_id: br,
    user_id: matchedUserId || ("USR-" + matchedCompanyObj.company_id + "-01"),
    full_name: matchedFullName || matchedCompanyObj.owner_name || matchedCompanyObj.company_name,
    email: email,
    sheet_id: sheetId,
    spreadsheet_id: sheetId,
    url: matchedCompanyObj.url || (sheetId ? "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit" : ""),
    routing_epoch: epoch,
    schema_version: Number(matchedCompanyObj.schema_version || CURRENT_TENANT_SCHEMA_VERSION),
    subscription_status: matchedCompanyObj.subscription_status || "TRIAL",
    token: jwtToken
  };
}

function handleStaffLogin(req, ss) {
  var d = mergeReqPayload(req);
  var companyId = String(d.businessId || d.company_id || d.companyId || TENANT_COMPANY_ID).trim();
  var userId = String(d.userId || d.staffId || d.user_id || "").trim();
  var name = String(d.name || d.full_name || "").trim().toLowerCase();
  var rawPin = String(d.pin || "").trim();
  var pinHash = String(d.pinHash || d.pin_hash || "").trim() || (rawPin ? hashPasswordSha256(rawPin) : "");

  var comp = getCompany(companyId, ss);
  var sheetId = comp && comp.sheet_id ? String(comp.sheet_id).trim() : "";
  var compUpper = companyId.toUpperCase();
  var propEp = Number(PropertiesService.getScriptProperties().getProperty("ROUTE_EPOCH_" + compUpper) || "1");
  var epoch = Math.max(propEp, Number((comp && comp.routing_epoch) || 1));

  var uSheet = ss.getSheetByName("users");
  if (uSheet && uSheet.getLastRow() >= 2) {
    var vals = uSheet.getDataRange().getValues();
    var h = vals[0];
    var idIdx = h.indexOf("user_id");
    var compIdx = h.indexOf("company_id");
    var nameIdx = h.indexOf("full_name");
    var hashIdx = h.indexOf("pin_hash");
    var saltIdx = h.indexOf("pin_salt");
    var actIdx = h.indexOf("is_active");

    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][compIdx]).trim().toUpperCase() !== compUpper) continue;
      var rId = String(vals[i][idIdx] || "").trim();
      var rName = String(vals[i][nameIdx] || "").trim().toLowerCase();
      if ((userId && rId === userId) || (name && rName === name)) {
        if (actIdx !== -1 && (vals[i][actIdx] === false || String(vals[i][actIdx]).toUpperCase() === "FALSE")) {
          return { status: "error", success: false, message: "Staff account is inactive" };
        }
        var storedHash = String(vals[i][hashIdx] || "").trim();
        var storedSalt = saltIdx !== -1 ? String(vals[i][saltIdx] || "").trim() : "";
        var saltedInputHash = (storedSalt && rawPin) ? hashPasswordSha256(storedSalt + ":" + rawPin) : "";
        var matched = false;
        if (!storedHash) {
          matched = (rawPin === "1234");
        } else {
          matched = (storedHash === pinHash || (saltedInputHash && storedHash === saltedInputHash) || (rawPin && storedHash === rawPin));
        }
        if (!matched) {
          return { status: "error", success: false, message: "Incorrect PIN for " + vals[i][nameIdx] };
        }
        if (rawPin && storedHash === rawPin && hashIdx !== -1) {
          uSheet.getRange(i + 1, hashIdx + 1).setValue(hashPasswordSha256(rawPin));
        }
        var userObj = {};
        for (var c = 0; c < h.length; c++) {
          if (h[c] === "pin" || h[c] === "password_hash") continue;
          userObj[h[c]] = vals[i][c];
        }
        userObj.id = rId;
        userObj.name = vals[i][nameIdx];
        userObj.companyId = companyId;
        userObj.branchId = userObj.branch_id || "BR-MAIN";

        getTenantRouteCached(companyId, ss);
        var jwtToken = signJwt({
          sub: rId,
          company_id: companyId,
          role: String(userObj.role || "CASHIER").toUpperCase(),
          branch_id: userObj.branchId,
          spreadsheet_id: sheetId,
          routing_epoch: epoch
        });

        return {
          status: "success",
          success: true,
          user: userObj,
          sheet_id: sheetId,
          spreadsheet_id: sheetId,
          routing_epoch: epoch,
          token: jwtToken,
          permissions: getUserPermissions(companyId, userObj.role, ss)
        };
      }
    }
  }

  // Fallback: check tenant spreadsheet Staff tab (allows staff added offline/hot-path without Master mirror)
  if (sheetId && sheetId.length >= 15) {
    try {
      var tenantSs = SpreadsheetApp.openById(sheetId);
      var stSheet = tenantSs.getSheetByName("Staff");
      if (stSheet && stSheet.getLastRow() >= 2) {
        var stVals = stSheet.getDataRange().getValues();
        var sh = stVals[0];
        var sIdIdx = sh.indexOf("UserID");
        var sNameIdx = sh.indexOf("FullName");
        var sHashIdx = sh.indexOf("PinHash");
        var sSaltIdx = sh.indexOf("PinSalt");
        var sActIdx = sh.indexOf("Active");
        for (var r = 1; r < stVals.length; r++) {
          var srId = String(stVals[r][sIdIdx] || "").trim();
          var srName = String(stVals[r][sNameIdx] || "").trim().toLowerCase();
          if ((userId && srId === userId) || (name && srName === name)) {
            if (sActIdx !== -1 && String(stVals[r][sActIdx]).toUpperCase() === "N") {
              return { status: "error", success: false, message: "Staff account is inactive" };
            }
            var sHash = sHashIdx !== -1 ? String(stVals[r][sHashIdx] || "").trim() : "";
            var sSalt = sSaltIdx !== -1 ? String(stVals[r][sSaltIdx] || "").trim() : "";
            var sSaltedIn = (sSalt && rawPin) ? hashPasswordSha256(sSalt + ":" + rawPin) : "";
            var sMatch = !sHash ? (rawPin === "1234") : (sHash === pinHash || (sSaltedIn && sHash === sSaltedIn) || (rawPin && sHash === rawPin));
            if (!sMatch) {
              return { status: "error", success: false, message: "Incorrect PIN for " + stVals[r][sNameIdx] };
            }
            var tUser = {};
            for (var sc = 0; sc < sh.length; sc++) {
              if (sh[sc] === "Pin" || sh[sc] === "password_hash") continue;
              tUser[sh[sc]] = stVals[r][sc];
            }
            tUser.id = srId;
            tUser.user_id = srId;
            tUser.name = stVals[r][sNameIdx];
            tUser.companyId = companyId;
            tUser.company_id = companyId;
            tUser.branchId = tUser.BranchID || tUser.branch_id || "BR-MAIN";
            tUser.role = String(tUser.Role || tUser.role || "CASHIER").toUpperCase();

            getTenantRouteCached(companyId, ss);
            var staffJwt = signJwt({
              sub: srId,
              company_id: companyId,
              role: tUser.role,
              branch_id: tUser.branchId,
              spreadsheet_id: sheetId,
              routing_epoch: epoch
            });
            return {
              status: "success",
              success: true,
              user: tUser,
              sheet_id: sheetId,
              spreadsheet_id: sheetId,
              routing_epoch: epoch,
              token: staffJwt,
              permissions: getUserPermissions(companyId, tUser.role, ss)
            };
          }
        }
      }
    } catch (eTenStaff) {}
  }

  return { status: "error", success: false, message: "Staff member not found" };
}

function handleLogin(req, ss) {
  var d = mergeReqPayload(req);
  if (d.email || d.password) return handleOwnerLogin(req, ss);
  return handleStaffLogin(req, ss);
}

function handleRefreshToken(req, masterSs) {
  var d = mergeReqPayload(req);
  var rawTok = extractRawToken(req, d);
  var companyId = String(d.company_id || d.businessId || "").trim();
  var userId = String(d.user_id || d.staffId || "USR-REFRESH").trim();
  var role = String(d.role || d.user_role || "OWNER").toUpperCase();
  var branchId = String(d.branch_id || "BR-MAIN").trim();

  if (rawTok) {
    var parts = rawTok.split(".");
    if (parts.length === 3) {
      // Allow signature check ignoring expiry so recently-expired valid tokens can refresh
      var v = verifyJwt(rawTok);
      var claims = v.claims;
      if (!v.valid && v.code !== "JWT_EXPIRED") {
        return { success: false, code: "JWT_INVALID", httpStatus: 401, error: "Cannot refresh invalid JWT." };
      }
      if (claims) {
        companyId = claims.company_id || companyId;
        userId = claims.sub || userId;
        role = claims.role || role;
        branchId = claims.branch_id || branchId;
      }
    }
  }

  if (!companyId) {
    return { success: false, error: "company_id required for refresh_token" };
  }

  invalidateCompanyCache(companyId);
  var route = getTenantRouteCached(companyId, masterSs);
  if (!route) {
    return { success: false, error: "Tenant not found: " + companyId };
  }
  if (route.status === "SUSPENDED" || route.status === "CANCELLED") {
    return { success: false, code: "TENANT_SUSPENDED", httpStatus: 403, error: "Tenant is " + route.status };
  }

  var newJwt = signJwt({
    sub: userId,
    company_id: route.company_id,
    role: role,
    branch_id: branchId,
    spreadsheet_id: route.spreadsheet_id,
    routing_epoch: route.routing_epoch
  });

  return {
    success: true,
    company_id: route.company_id,
    sheet_id: route.spreadsheet_id,
    spreadsheet_id: route.spreadsheet_id,
    url: route.url,
    routing_epoch: route.routing_epoch,
    schema_version: route.schema_version,
    token: newJwt
  };
}

function handleCreateBranch(req, ss) {
  var d = mergeReqPayload(req);
  var companyId = String(d.company_id || d.companyId || TENANT_COMPANY_ID).trim();
  var branchId = String(d.branch_id || d.branchId || ("BR-" + Math.random().toString(36).substring(2, 6).toUpperCase())).trim();
  var nowIso = new Date().toISOString();
  var seq = allocateNextServerSeq(ss, companyId);
  var bSheet = backfillSchemaColumns(ss, "branches");
  var headers = bSheet.getRange(1, 1, 1, bSheet.getLastColumn()).getValues()[0];
  var existingRow = findRowIndexInSheet(bSheet, headers, ["branch_id", "entity_id"], branchId, companyId);
  var rowObj = {
    branch_id: branchId,
    company_id: companyId,
    branch_name: d.branch_name || d.name || branchId,
    branch_code: d.branch_code || d.code || branchId,
    location: d.location || d.address || "",
    location_code: d.location_code || d.branch_code || d.code || branchId,
    address: d.address || d.location || "",
    phone: d.phone || "",
    is_main: Boolean(d.is_main || branchId === "BR-MAIN"),
    is_active: d.is_active !== false,
    created_at: nowIso,
    updated_at: nowIso,
    entity_type: "branch",
    entity_id: branchId,
    version: Number(d.version || 1),
    mutation_source: d.mutationSource || "USER_EDIT",
    client_updated_at: nowIso,
    server_updated_at: nowIso,
    server_seq: seq,
    is_deleted: false,
    server_received_at: nowIso,
    suspicious_backdate: false,
    payload_json: JSON.stringify({
      id: branchId,
      branchId: branchId,
      branch_id: branchId,
      company_id: companyId,
      name: d.branch_name || d.name || branchId,
      code: d.branch_code || d.code || branchId,
      location: d.location || d.address || "",
      is_active: d.is_active !== false,
      updatedAt: Date.now()
    })
  };
  if (existingRow > 0) updateRowByHeaders(bSheet, existingRow, headers, rowObj);
  else writeRowByHeaders(bSheet, headers, rowObj);

  invalidateCompanyCache(companyId);
  return { success: true, branch_id: branchId, branch: rowObj, server_seq: seq };
}

function handleUpsertStaff(req, masterSs, targetSs, companyId, branchId) {
  var d = mergeReqPayload(req);
  var staffId = String(d.user_id || d.id || d.staffId || ("USR-" + Date.now())).trim();
  var nowIso = new Date().toISOString();
  var uSheet = backfillSchemaColumns(masterSs, "users");
  var headers = uSheet.getRange(1, 1, 1, uSheet.getLastColumn()).getValues()[0];
  var existingRow = findRowIndexInSheet(uSheet, headers, ["user_id", "entity_id"], staffId, companyId);

  var resolvedPinHash = String(d.pin_hash || d.pinHash || "").trim();
  var resolvedPinSalt = String(d.pin_salt || d.pinSalt || "").trim();
  if (!resolvedPinHash && d.pin) {
    resolvedPinHash = hashPasswordSha256(String(d.pin).trim());
  }
  var resolvedPinVersion = Number(d.pinVersion || d.pin_version || 0);
  var resolvedPinUpdatedAt = d.pinUpdatedAt ? new Date(Number(d.pinUpdatedAt)).toISOString() : "";

  var pinAcceptedForDirectory = Boolean(resolvedPinHash);
  if (existingRow > 0) {
    var prev = extractExistingEnvelopeState(uSheet, existingRow, headers);
    var prevPinVer = Number(prev.raw.pin_version || 0);
    if (prev.raw.pin_hash && (!resolvedPinHash || (prevPinVer > 0 && (resolvedPinVersion === 0 || prevPinVer > resolvedPinVersion)))) {
      resolvedPinHash = prev.raw.pin_hash;
      resolvedPinSalt = prev.raw.pin_salt || resolvedPinSalt;
      resolvedPinVersion = Math.max(prevPinVer, resolvedPinVersion);
      resolvedPinUpdatedAt = prev.raw.pin_updated_at || resolvedPinUpdatedAt;
      pinAcceptedForDirectory = false;
    }
  }

  var sanitized = sanitizePayloadForCloud("staff", d);
  sanitized.id = staffId;
  sanitized.pin_hash = resolvedPinHash;
  if (resolvedPinSalt) sanitized.pin_salt = resolvedPinSalt;
  if (resolvedPinVersion > 0) sanitized.pinVersion = resolvedPinVersion;

  var seq = allocateNextServerSeq(targetSs || masterSs, companyId);
  var rowObj = {
    user_id: staffId,
    company_id: companyId,
    branch_id: d.branch_id || d.branchId || branchId || "BR-MAIN",
    full_name: d.full_name || d.name || "Staff",
    email: d.email || "",
    phone: d.phone || "",
    role: String(d.role || "CASHIER").toUpperCase(),
    pin_hash: resolvedPinHash,
    pin_salt: resolvedPinSalt,
    pin_version: resolvedPinVersion,
    pin_updated_at: resolvedPinUpdatedAt,
    assigned_branch_ids: JSON.stringify(d.assignedBranchIds || []),
    branch_assignments_json: JSON.stringify(d.branchAssignments || []),
    permissions_json: JSON.stringify(d.permissions || {}),
    is_active: d.is_active !== false && d.active !== "N" && d.active !== false,
    created_at: d.created_at || nowIso,
    updated_at: nowIso,
    entity_type: "staff",
    entity_id: staffId,
    version: Number(d.version || 1),
    mutation_source: d.mutationSource || "USER_EDIT",
    client_updated_at: d.updatedAt ? new Date(Number(d.updatedAt)).toISOString() : nowIso,
    server_updated_at: nowIso,
    server_seq: seq,
    is_deleted: false,
    server_received_at: nowIso,
    suspicious_backdate: false,
    payload_json: JSON.stringify(sanitized)
  };
  if (existingRow > 0) updateRowByHeaders(uSheet, existingRow, headers, rowObj);
  else writeRowByHeaders(uSheet, headers, rowObj);

  if (pinAcceptedForDirectory && resolvedPinHash) {
    mirrorOwnerCredentialsToMasterDirectory(
      masterSs,
      companyId,
      staffId,
      rowObj.role,
      rowObj.email,
      rowObj.full_name,
      rowObj.branch_id,
      resolvedPinHash,
      rowObj.is_active,
      nowIso,
      resolvedPinSalt
    );
  }

  if (targetSs && targetSs.getId() !== masterSs.getId()) {
    var stSheet = backfillSchemaColumns(targetSs, "Staff");
    var stHeaders = stSheet.getRange(1, 1, 1, stSheet.getLastColumn()).getValues()[0];
    var stRowIdx = findRowIndexInSheet(stSheet, stHeaders, ["UserID", "entity_id"], staffId, companyId);
    var stObj = buildRowObjectForEntity("staff", staffId, sanitized, {
      updatedAt: Date.now(),
      version: rowObj.version,
      mutationSource: rowObj.mutation_source
    }, { server_received_at: nowIso, suspicious_backdate: false }, seq, companyId, rowObj.branch_id);
    if (stRowIdx > 0) updateRowByHeaders(stSheet, stRowIdx, stHeaders, stObj);
    else writeRowByHeaders(stSheet, stHeaders, stObj);
  }

  return { success: true, user_id: staffId, server_seq: seq };
}

function handleGetTenantContext(req, ss) {
  var companyId = String(req.company_id || req.companyId || TENANT_COMPANY_ID).trim();
  var comp = getCompany(companyId, ss);
  if (!comp) return { success: false, error: "Tenant not found: " + companyId };
  var out = {};
  for (var k in comp) {
    if (comp.hasOwnProperty(k) && k !== "password_hash" && k !== "password_salt" && k !== "_rowIndex") out[k] = comp[k];
  }
  var compUpper = companyId.toUpperCase();
  var propEp = Number(PropertiesService.getScriptProperties().getProperty("ROUTE_EPOCH_" + compUpper) || "1");
  out.routing_epoch = Math.max(propEp, Number(out.routing_epoch || 1));
  return { success: true, tenant: out, server_time: new Date().toISOString() };
}

function handleGetUsersSince(req, ss) {
  var companyId = String(req.company_id || req.companyId || TENANT_COMPANY_ID).trim();
  var sinceMs = parseTimestampMsSafe(req.since);
  var uSheet = ss.getSheetByName("users");
  var users = [];
  if (uSheet && uSheet.getLastRow() >= 2) {
    var data = uSheet.getDataRange().getValues();
    var h = data[0];
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      for (var c = 0; c < h.length; c++) {
        if (h[c] === "pin" || h[c] === "password_hash") continue;
        obj[h[c]] = data[i][c];
      }
      if (String(obj.company_id || "").trim().toUpperCase() !== companyId.toUpperCase()) continue;
      if (obj.is_deleted === true || String(obj.is_deleted).toUpperCase() === "TRUE") continue;
      var updMs = Math.max(parseTimestampMsSafe(obj.updated_at), parseTimestampMsSafe(obj.server_updated_at), parseTimestampMsSafe(obj.client_updated_at));
      if (sinceMs > 0 && updMs > 0 && updMs < sinceMs) continue;
      try { if (obj.assigned_branch_ids) obj.assignedBranchIds = JSON.parse(obj.assigned_branch_ids); } catch (e1) {}
      try { if (obj.branch_assignments_json) obj.branchAssignments = JSON.parse(obj.branch_assignments_json); } catch (e2) {}
      try { if (obj.permissions_json) obj.permissions = JSON.parse(obj.permissions_json); } catch (e3) {}
      obj.id = obj.user_id;
      obj.name = obj.full_name;
      obj.pinVersion = Number(obj.pin_version || 0);
      obj.pinUpdatedAt = parseTimestampMsSafe(obj.pin_updated_at);
      obj.updatedAt = parseTimestampMsSafe(obj.client_updated_at) || updMs;
      obj.mutationSource = obj.mutation_source || "";
      users.push(obj);
    }
  }
  return { success: true, users: users, server_time: new Date().toISOString() };
}

function handleGetBranchesSince(req, ss) {
  var companyId = String(req.company_id || req.companyId || TENANT_COMPANY_ID).trim();
  var sinceMs = parseTimestampMsSafe(req.since);
  var bSheet = ss.getSheetByName("branches");
  var branches = [];
  if (bSheet && bSheet.getLastRow() >= 2) {
    var data = bSheet.getDataRange().getValues();
    var h = data[0];
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      for (var c = 0; c < h.length; c++) obj[h[c]] = data[i][c];
      if (String(obj.company_id || "").trim().toUpperCase() !== companyId.toUpperCase()) continue;
      if (obj.is_deleted === true || String(obj.is_deleted).toUpperCase() === "TRUE") continue;
      var updMs = Math.max(parseTimestampMsSafe(obj.updated_at), parseTimestampMsSafe(obj.server_updated_at), parseTimestampMsSafe(obj.client_updated_at));
      if (sinceMs > 0 && updMs > 0 && updMs < sinceMs) continue;
      obj.id = obj.branch_id;
      obj.branchId = obj.branch_id;
      obj.name = obj.branch_name;
      obj.code = obj.branch_code;
      obj.updatedAt = parseTimestampMsSafe(obj.client_updated_at) || updMs;
      obj.mutationSource = obj.mutation_source || "";
      branches.push(obj);
    }
  }
  return { success: true, branches: branches, server_time: new Date().toISOString() };
}

function handleLookupCompany(req, ss) {
  var emailQ = String(req.email || req.owner_email || "").trim().toLowerCase();
  var compQ = String(req.company_id || req.companyId || "").trim().toLowerCase();
  var q = String(compQ || emailQ || req.query || "").trim().toLowerCase();
  var cSheet = ss.getSheetByName("companies");
  if (!cSheet || cSheet.getLastRow() < 2) return { success: true, exists: false, error: "No companies registered" };
  var data = cSheet.getDataRange().getValues();
  var h = data[0];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var c = 0; c < h.length; c++) {
      if (h[c] !== "password_hash" && h[c] !== "password_salt") obj[h[c]] = data[i][c];
    }
    if (emailQ && !compQ) {
      if (String(obj.owner_email || "").trim().toLowerCase() === emailQ) {
        return { success: true, exists: true, company: obj };
      }
    } else if (
      String(obj.company_id || "").trim().toLowerCase() === q ||
      String(obj.owner_email || "").trim().toLowerCase() === q ||
      String(obj.company_name || "").trim().toLowerCase() === q
    ) {
      return { success: true, exists: true, company: obj };
    }
  }
  return { success: true, exists: false, error: "Company not found" };
}

function handleLookupBranch(req, ss) {
  var companyId = String(req.company_id || TENANT_COMPANY_ID).trim().toUpperCase();
  var brQuery = String(req.branch_id || req.branch_code || "").trim().toUpperCase();
  var bSheet = ss.getSheetByName("branches");
  if (!bSheet || bSheet.getLastRow() < 2) return { success: false, error: "No branches found" };
  var data = bSheet.getDataRange().getValues();
  var h = data[0];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var c = 0; c < h.length; c++) obj[h[c]] = data[i][c];
    if (String(obj.company_id || "").toUpperCase() === companyId &&
        (String(obj.branch_id || "").toUpperCase() === brQuery || String(obj.branch_code || "").toUpperCase() === brQuery)) {
      return { success: true, branch: obj };
    }
  }
  return { success: false, error: "Branch not found" };
}

function handleSchemaHealthCheck(req, ss) {
  var masterCreated = ensureAllMasterTabsExist(ss);
  var companyId = String(req.company_id || "").trim();
  var targetSs = resolveTargetSpreadsheet(ss, companyId, req.sheet_id);
  var report = { masterTabs: [], tenantTabs: [], targetSheetId: targetSs.getId(), tenantMeta: readTenantMeta(targetSs) };
  var allSheets = targetSs.getSheets();
  for (var i = 0; i < allSheets.length; i++) {
    var name = allSheets[i].getName();
    var expected = TAB_TEMPLATES[name];
    var presentCols = allSheets[i].getLastColumn() > 0 ? allSheets[i].getRange(1, 1, 1, allSheets[i].getLastColumn()).getValues()[0] : [];
    var missing = [];
    if (expected) {
      for (var e = 0; e < expected.length; e++) {
        if (presentCols.indexOf(expected[e]) === -1) missing.push(expected[e]);
      }
    }
    report.tenantTabs.push({ tab: name, rows: Math.max(0, allSheets[i].getLastRow() - 1), missingColumns: missing });
  }
  return { success: true, version: CODE_GS_VERSION, schema_version: CURRENT_TENANT_SCHEMA_VERSION, masterCreated: masterCreated, report: report };
}

function handleMigrateTenant(req, ss) {
  var companyId = String(req.company_id || TENANT_COMPANY_ID).trim();
  var targetSs = resolveTargetSpreadsheet(ss, companyId, req.sheet_id);
  ensureAllMasterTabsExist(ss);
  var heal = healTenantSchema(targetSs, companyId);

  updateMasterCompanyRoutingFields(ss, companyId, {
    schema_version: CURRENT_TENANT_SCHEMA_VERSION,
    updated_at: new Date().toISOString()
  });

  if (req.bump_routing_epoch) {
    handleBumpRoutingEpoch({ company_id: companyId, sheet_id: targetSs.getId() }, ss);
  }

  return {
    success: true,
    schema_version: CURRENT_TENANT_SCHEMA_VERSION,
    createdTabs: heal.createdTabs,
    migratedTabsCount: heal.healedTabsCount
  };
}

function handleMergeDuplicateCompanies(req, ss) {
  var cSheet = ss.getSheetByName("companies");
  if (!cSheet || cSheet.getLastRow() < 3) return { success: true, merged: 0 };
  var data = cSheet.getDataRange().getValues();
  var h = data[0];
  var emCol = h.indexOf("owner_email");
  var seen = {};
  var merged = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var em = String(data[i][emCol] || "").trim().toLowerCase();
    if (!em) continue;
    if (seen[em]) {
      cSheet.deleteRow(i + 1);
      merged++;
    } else {
      seen[em] = true;
    }
  }
  return { success: true, merged: merged };
}

// ============================================================================
// 7. V5.0/V7.0 OPERATIONAL & SAAS HANDLERS (USING MERGED PAYLOAD)
// ============================================================================

function extendObj_(base, extra) {
  var out = {};
  if (base && typeof base === "object") {
    for (var k1 in base) {
      if (base.hasOwnProperty(k1)) out[k1] = base[k1];
    }
  }
  if (extra && typeof extra === "object") {
    for (var k2 in extra) {
      if (extra.hasOwnProperty(k2)) out[k2] = extra[k2];
    }
  }
  return out;
}

function handleAddDirectGRV(req, ss, masterSsOpt, companyId, branchId) {
  var d = mergeReqPayload(req);
  d.id = d.id || d.grvNumber || ("GRV-" + Date.now());
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    entityType: "direct_grv",
    entityId: d.id,
    data: d
  }), masterSsOpt, ss, companyId, branchId);
}

function handleApproveDirectGRV(req, ss, masterSsOpt, companyId, branchId) {
  var d = mergeReqPayload(req);
  d.status = "Approved";
  d.approvedAt = new Date().toISOString();
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    entityType: "direct_grv",
    entityId: d.id || d.grvNumber,
    data: d
  }), masterSsOpt, ss, companyId, branchId);
}

function handleSubmitEOD(req, ss, masterSsOpt, companyId, branchId) {
  var d = mergeReqPayload(req);
  d.status = d.status || "SUBMITTED";
  d.id = d.id || ("REC-" + (d.date || new Date().toISOString().split("T")[0]) + "-" + branchId);
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    entityType: "reconciliation",
    entityId: d.id,
    data: d
  }), masterSsOpt, ss, companyId, branchId);
}

function handleApproveEOD(req, ss, masterSsOpt, companyId, branchId) {
  var d = mergeReqPayload(req);
  d.status = "APPROVED";
  d.approvedAt = new Date().toISOString();
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    entityType: "reconciliation",
    entityId: d.id,
    data: d
  }), masterSsOpt, ss, companyId, branchId);
}

function handleAddSale(req, ss, masterSsOpt, companyId, branchId) {
  var d = mergeReqPayload(req);
  var saleId = d.id || d.InvoiceID || d.invoice_id || ("INV-" + Date.now());
  return handleLegacyActionAsEnvelope("sync_sale", extendObj_(req, {
    entityType: "sale",
    entityId: saleId,
    data: d
  }), masterSsOpt, ss, companyId, branchId);
}

function handleConfirmPayment(req, ss) {
  var d = mergeReqPayload(req);
  var companyId = String(d.company_id || "").trim();
  var subSheet = backfillSchemaColumns(ss, "Subscriptions");
  var headers = subSheet.getRange(1, 1, 1, subSheet.getLastColumn()).getValues()[0];
  var nextDate = d.next_billing_date || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  writeRowByHeaders(subSheet, headers, {
    SubscriptionID: "SUB-" + Date.now(),
    CompanyID: companyId,
    Plan: d.plan || "PRO",
    Status: "ACTIVE",
    PaymentRef: d.payment_ref || d.reference || "",
    AmountPaid: d.amount || 0,
    Currency: d.currency || "USD",
    PaidDate: new Date().toISOString().split("T")[0],
    NextBillingDate: nextDate,
    ActivatedBy: d.activated_by || "ADMIN",
    Notes: d.notes || ""
  });
  updateMasterCompanyRoutingFields(ss, companyId, {
    subscription_status: "ACTIVE",
    status: "ACTIVE",
    plan: d.plan || "PRO",
    next_billing_date: nextDate,
    expiry: nextDate,
    updated_at: new Date().toISOString()
  });
  return { success: true, company_id: companyId, subscription_status: "ACTIVE", next_billing_date: nextDate };
}

function handleExtendTrial(req, ss) {
  var d = mergeReqPayload(req);
  var companyId = String(d.company_id || "").trim();
  var days = Number(d.days || 14);
  var nextDate = new Date(Date.now() + days * 86400000).toISOString().split("T")[0];
  var ok = updateMasterCompanyRoutingFields(ss, companyId, {
    next_billing_date: nextDate,
    expiry: nextDate,
    subscription_status: "TRIAL",
    status: "TRIAL",
    updated_at: new Date().toISOString()
  });
  if (ok) {
    return { success: true, company_id: companyId, next_billing_date: nextDate };
  }
  return { success: false, error: "Company not found" };
}

function handleGetData(req, targetSs, masterSsOpt) {
  var ss = targetSs;
  var sheetName = SHEET_ALIASES[req.sheet] || req.sheet || "Sales";
  var companyId = String(req.company_id || req.companyId || "").trim().toUpperCase();
  var branchId = String(req.branch_id || req.branchId || "").trim().toUpperCase();
  var userRole = String(req.user_role || "OWNER").toUpperCase();
  var sheets = getReadableSheetsForBase(ss, sheetName);
  if (sheets.length === 0 && masterSsOpt && masterSsOpt.getId() !== ss.getId()) {
    sheets = getReadableSheetsForBase(masterSsOpt, sheetName);
  }
  var rows = [];
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    if (sh.getLastRow() < 2) continue;
    var vals = sh.getDataRange().getValues();
    var h = vals[0];
    for (var i = 1; i < vals.length; i++) {
      var obj = {};
      for (var c = 0; c < h.length; c++) {
        if (h[c] === "password_hash" || h[c] === "password_salt" || h[c] === "pin") continue;
        obj[h[c]] = vals[i][c];
      }
      if (obj.is_deleted === true || String(obj.is_deleted).toUpperCase() === "TRUE") continue;
      var rc = String(obj.CompanyID || obj.company_id || "").trim().toUpperCase();
      var rb = String(obj.BranchID || obj.branch_id || "ALL").trim().toUpperCase();
      if (companyId && rc && rc !== companyId) continue;
      if (userRole !== "OWNER" && userRole !== "SUPER_ADMIN" && branchId && branchId !== "ALL" && rb && rb !== "ALL" && rb !== branchId) {
        continue;
      }
      rows.push(obj);
    }
  }
  return { success: true, sheet: sheetName, rows: rows, count: rows.length };
}

function handleGenericInsert(req, targetSs, masterSsOpt, companyId, branchId) {
  var sheetName = SHEET_ALIASES[req.sheet] || req.sheet || "Sales";
  var d = mergeReqPayload(req);
  var entityType = null;
  for (var et in ENTITY_TO_TAB) {
    if (ENTITY_TO_TAB[et] === sheetName) { entityType = et; break; }
  }
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    entityType: entityType || "audit_log",
    data: d
  }), masterSsOpt, targetSs, companyId, branchId);
}

function handleGenericUpdate(req, targetSs, masterSsOpt, companyId, branchId) {
  return handleGenericInsert(req, targetSs, masterSsOpt, companyId, branchId);
}

function handleGenericDelete(req, targetSs, masterSsOpt, companyId, branchId) {
  var sheetName = SHEET_ALIASES[req.sheet] || req.sheet || "InventoryMaster";
  var d = mergeReqPayload(req);
  var entityType = null;
  for (var et in ENTITY_TO_TAB) {
    if (ENTITY_TO_TAB[et] === sheetName) { entityType = et; break; }
  }
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    deleteFlag: true,
    entityType: entityType || "inventory_item",
    data: d
  }), masterSsOpt, targetSs, companyId, branchId);
}

function handleReceiveStock(req, ss, masterSsOpt, companyId, branchId) {
  var d = mergeReqPayload(req);
  d.id = d.id || ("GRN-" + Date.now());
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    entityType: "goods_received",
    entityId: d.id,
    data: d
  }), masterSsOpt, ss, companyId, branchId);
}

function handleSellStock(req, ss, masterSsOpt, companyId, branchId) {
  return handleAddSale(req, ss, masterSsOpt, companyId, branchId);
}

function handleBreakCase(req, ss, masterSsOpt, companyId, branchId) {
  var d = mergeReqPayload(req);
  return handleLegacyActionAsEnvelope("sync_entity", extendObj_(req, {
    entityType: "stock_movement",
    entityId: d.id || ("MOV-" + Date.now()),
    data: d
  }), masterSsOpt, ss, companyId, branchId);
}

function handleGetStock(req, ss, masterSsOpt) {
  return handleGetInventory(req, masterSsOpt, ss, req.company_id || req.companyId);
}

function handleGetCompanies(req, ss) {
  var cSheet = ss.getSheetByName("companies");
  var compMap = {};
  var list = [];
  if (cSheet && cSheet.getLastRow() >= 2) {
    var vals = cSheet.getDataRange().getValues();
    var h = vals[0];
    for (var i = 1; i < vals.length; i++) {
      var obj = {};
      for (var c = 0; c < h.length; c++) {
        if (h[c] === "password_hash" || h[c] === "password_salt") continue;
        obj[h[c]] = vals[i][c];
      }
      if (!obj.company_id) continue;
      if (obj.is_deleted === true || String(obj.is_deleted).toUpperCase() === "TRUE") continue;
      obj.company_id = String(obj.company_id).trim();
      if (obj.company_name !== undefined && obj.company_name !== null) obj.company_name = String(obj.company_name).trim();
      if (obj.owner_name !== undefined && obj.owner_name !== null) obj.owner_name = String(obj.owner_name).trim();
      if (obj.owner_email !== undefined && obj.owner_email !== null) obj.owner_email = String(obj.owner_email).trim();
      if (obj.phone !== undefined && obj.phone !== null) obj.phone = String(obj.phone).trim();
      if (obj.sheet_id !== undefined && obj.sheet_id !== null) obj.sheet_id = String(obj.sheet_id).trim();
      if (obj.activation_code !== undefined && obj.activation_code !== null) obj.activation_code = String(obj.activation_code).trim();
      var cKey = obj.company_id.toUpperCase();
      if (compMap[cKey] !== undefined) {
        list[compMap[cKey]] = obj;
      } else {
        compMap[cKey] = list.length;
        list.push(obj);
      }
    }
  }

  // Deduplicate branches in-memory by company_id::branch_id so bloated duplicate rows never bloat payload
  var branches = [];
  var branchMap = {};
  var bSheet = ss.getSheetByName("branches");
  if (bSheet && bSheet.getLastRow() >= 2) {
    var bVals = bSheet.getDataRange().getValues();
    var bh = bVals[0];
    for (var bi = 1; bi < bVals.length; bi++) {
      var bObj = {};
      for (var bc = 0; bc < bh.length; bc++) bObj[bh[bc]] = bVals[bi][bc];
      if (!bObj.branch_id || !bObj.company_id) continue;
      if (bObj.is_deleted === true || String(bObj.is_deleted).toUpperCase() === "TRUE") continue;
      bObj.id = bObj.branch_id;
      bObj.branchId = bObj.branch_id;
      bObj.name = bObj.branch_name || bObj.name || bObj.branch_id;
      bObj.code = bObj.branch_code || bObj.code || bObj.branch_id;
      bObj.location = bObj.location || bObj.address || "";
      var bCompKey = String(bObj.company_id).trim().toUpperCase();
      var bIdKey = String(bObj.branch_id).trim().toUpperCase();
      var bKey = bCompKey + "::" + bIdKey;
      if (branchMap[bKey] !== undefined) {
        branches[branchMap[bKey]] = bObj;
      } else {
        branchMap[bKey] = branches.length;
        branches.push(bObj);
      }
    }
  }

  // Deduplicate users in-memory by company_id::user_id
  var users = [];
  var userMap = {};
  var uSheet = ss.getSheetByName("users");
  if (uSheet && uSheet.getLastRow() >= 2) {
    var uVals = uSheet.getDataRange().getValues();
    var uh = uVals[0];
    for (var ui = 1; ui < uVals.length; ui++) {
      var uObj = {};
      for (var uc = 0; uc < uh.length; uc++) {
        if (uh[uc] === "pin" || uh[uc] === "password_hash") continue;
        uObj[uh[uc]] = uVals[ui][uc];
      }
      if (!uObj.user_id || !uObj.company_id) continue;
      if (uObj.is_deleted === true || String(uObj.is_deleted).toUpperCase() === "TRUE") continue;
      try { if (uObj.assigned_branch_ids) uObj.assignedBranchIds = JSON.parse(uObj.assigned_branch_ids); } catch (e1) {}
      try { if (uObj.branch_assignments_json) uObj.branchAssignments = JSON.parse(uObj.branch_assignments_json); } catch (e2) {}
      try { if (uObj.permissions_json) uObj.permissions = JSON.parse(uObj.permissions_json); } catch (e3) {}
      uObj.id = uObj.user_id;
      uObj.name = uObj.full_name || uObj.name || "Staff Member";
      uObj.pinVersion = Number(uObj.pin_version || 0);
      uObj.pinUpdatedAt = parseTimestampMsSafe(uObj.pin_updated_at);
      uObj.updatedAt = parseTimestampMsSafe(uObj.client_updated_at) || parseTimestampMsSafe(uObj.updated_at);
      uObj.mutationSource = uObj.mutation_source || "";
      var uKey = String(uObj.company_id).trim().toUpperCase() + "::" + String(uObj.user_id).trim().toUpperCase();
      if (userMap[uKey] !== undefined) {
        users[userMap[uKey]] = uObj;
      } else {
        userMap[uKey] = users.length;
        users.push(uObj);
      }
    }
  }

  return {
    success: true,
    companies: list,
    branches: branches,
    users: users,
    count: list.length,
    server_time: new Date().toISOString()
  };
}

function handleGetUsers(req, ss) {
  return handleGetUsersSince({ company_id: req.company_id || TENANT_COMPANY_ID, since: "" }, ss);
}

function handleSyncCompany(req, ss) {
  var d = mergeReqPayload(req);
  var companyId = String(d.company_id || d.companyId || TENANT_COMPANY_ID).trim();
  if (!companyId) return { success: false, error: "Missing company_id" };
  var cSheet = backfillSchemaColumns(ss, "companies");
  var headers = cSheet.getRange(1, 1, 1, cSheet.getLastColumn()).getValues()[0];
  var existingRow = findRowIndexInSheet(cSheet, headers, ["company_id", "entity_id"], companyId, "");
  var nowIso = new Date().toISOString();

  // Compute/preserve password_hash & password_salt if password or owner pin provided
  var resolvedPwHash = String(d.password_hash || "").trim();
  var resolvedPwSalt = String(d.password_salt || "").trim();
  if (!resolvedPwHash && d.password) {
    resolvedPwHash = hashPasswordSha256(String(d.password).trim());
    resolvedPwSalt = "";
  }
  if (!resolvedPwHash && d.owner) {
    if (d.owner.password_hash) {
      resolvedPwHash = String(d.owner.password_hash).trim();
      resolvedPwSalt = String(d.owner.password_salt || d.owner.pin_salt || "").trim();
    } else if (d.owner.pin_hash) {
      resolvedPwHash = String(d.owner.pin_hash).trim();
      resolvedPwSalt = String(d.owner.pin_salt || "").trim();
    } else if (d.owner.pin) {
      resolvedPwHash = hashPasswordSha256(String(d.owner.pin).trim());
      resolvedPwSalt = "";
    }
  }
  if (!resolvedPwHash && existingRow > 0) {
    var pwIdx = headers.indexOf("password_hash");
    var pwSaltIdx = headers.indexOf("password_salt");
    if (pwIdx !== -1) {
      resolvedPwHash = String(cSheet.getRange(existingRow, pwIdx + 1).getValue() || "").trim();
    }
    if (pwSaltIdx !== -1) {
      resolvedPwSalt = String(cSheet.getRange(existingRow, pwSaltIdx + 1).getValue() || "").trim();
    }
  }

  var safePayload = {};
  for (var k in d) {
    if (k === "password" || k === "password_hash" || k === "password_salt") continue;
    if (k === "owner" && d.owner && typeof d.owner === "object") {
      var oCopy = {};
      for (var ok in d.owner) {
        if (ok !== "pin" && ok !== "password") oCopy[ok] = d.owner[ok];
      }
      safePayload[k] = oCopy;
    } else {
      safePayload[k] = d[k];
    }
  }

  // Never let a non-master tenant sync overwrite its sheet_id with the Master Sheet ID
  var sanitizedSheetId = String(d.sheet_id || "").trim();
  if (!isMasterCompanyId_(companyId) && isMasterSpreadsheetId_(sanitizedSheetId, ss)) {
    sanitizedSheetId = "";
  }
  if (!sanitizedSheetId && existingRow > 0) {
    var sheetIdx = headers.indexOf("sheet_id");
    if (sheetIdx !== -1) {
      var existingSheetVal = String(cSheet.getRange(existingRow, sheetIdx + 1).getValue() || "").trim();
      if (existingSheetVal && (isMasterCompanyId_(companyId) || !isMasterSpreadsheetId_(existingSheetVal, ss))) {
        sanitizedSheetId = existingSheetVal;
      }
    }
  }
  var sanitizedFolderId = String(d.sheet_folder_id || "").trim();
  if (isMasterSpreadsheetId_(sanitizedFolderId, ss)) {
    sanitizedFolderId = "";
  }

  var rowObj = extendObj_(d, {
    company_id: companyId,
    company_name: d.company_name !== undefined && d.company_name !== null ? String(d.company_name).trim() : "",
    sheet_id: sanitizedSheetId,
    sheet_folder_id: sanitizedFolderId,
    owner_email: String(d.owner_email || (d.owner && d.owner.email) || "").trim().toLowerCase(),
    owner_name: String(d.owner_name || (d.owner && (d.owner.name || d.owner.full_name)) || "").trim(),
    status: d.status || d.subscription_status || "TRIAL",
    updated_at: nowIso,
    entity_type: "company",
    entity_id: companyId,
    server_updated_at: nowIso,
    server_seq: allocateNextServerSeq(ss, companyId),
    is_deleted: false,
    payload_json: JSON.stringify(safePayload)
  });
  if (resolvedPwHash) {
    rowObj.password_hash = resolvedPwHash;
    rowObj.password_salt = resolvedPwSalt;
  }
  delete rowObj.password;
  delete rowObj.owner;
  delete rowObj.branch;
  delete rowObj.users;

  if (existingRow > 0) updateRowByHeaders(cSheet, existingRow, headers, rowObj);
  else writeRowByHeaders(cSheet, headers, rowObj);

  // Sync nested branch if included
  if (d.branch && typeof d.branch === "object") {
    var br = d.branch;
    handleCreateBranch({
      company_id: companyId,
      branch_id: br.branch_id || br.branchId || br.id || "BR-MAIN",
      branch_name: br.branch_name || br.name || "Main Branch",
      branch_code: br.branch_code || br.code || "HQ-01",
      location: br.location || br.address || "",
      address: br.address || br.location || "",
      is_main: br.isMain !== false && br.is_main !== false
    }, ss);
  }

  // Sync nested owner into users & Global_Users so cross-device login works immediately
  if (d.owner && typeof d.owner === "object") {
    var ow = d.owner;
    var owId = String(ow.user_id || ow.id || ("USR-" + companyId + "-01")).trim();
    var owEmail = String(ow.email || rowObj.owner_email || "").trim().toLowerCase();
    var owBranch = String(ow.branch_id || ow.branchId || (d.branch && (d.branch.branch_id || d.branch.branchId)) || "BR-MAIN").trim();
    handleUpsertStaff({
      company_id: companyId,
      branch_id: owBranch,
      user_id: owId,
      full_name: ow.full_name || ow.name || rowObj.owner_name || "Business Owner",
      email: owEmail,
      phone: ow.phone || d.phone || "",
      role: String(ow.role || "OWNER").toUpperCase(),
      pin: ow.pin || "",
      pin_hash: ow.pin_hash || resolvedPwHash,
      pin_salt: ow.pin_salt || "",
      permissions: ow.permissions || {},
      is_active: ow.active !== "N" && ow.is_active !== false
    }, ss, ss, companyId, owBranch);

    if (owEmail) {
      try {
        var gSheet = backfillSchemaColumns(ss, "Global_Users");
        var gHeaders = gSheet.getRange(1, 1, 1, gSheet.getLastColumn()).getValues()[0];
        var gRow = findRowIndexInSheet(gSheet, gHeaders, ["user_id", "email"], owId, companyId);
        var gObj = {
          user_id: owId,
          email: owEmail,
          password_hash: resolvedPwHash || ow.pin_hash || "",
          password_salt: resolvedPwSalt || ow.pin_salt || "",
          company_id: companyId,
          role: String(ow.role || "OWNER").toUpperCase(),
          full_name: ow.full_name || ow.name || rowObj.owner_name || "Business Owner",
          branch_id: owBranch,
          is_active: ow.active !== "N" && ow.is_active !== false,
          updated_at: nowIso
        };
        if (gRow > 0) updateRowByHeaders(gSheet, gRow, gHeaders, gObj);
        else writeRowByHeaders(gSheet, gHeaders, gObj);
      } catch (gErr) {}
    }
  }

  invalidateCompanyCache(companyId);
  return { success: true, company_id: companyId };
}

function handleBulkSyncCompanies(req, ss) {
  var nested = (req && req.data && typeof req.data === "object") ? req.data : {};
  var companiesList = Array.isArray(req.companies) ? req.companies : (Array.isArray(nested.companies) ? nested.companies : []);
  var branchesList = Array.isArray(req.branches) ? req.branches : (Array.isArray(nested.branches) ? nested.branches : []);
  var usersList = Array.isArray(req.users) ? req.users : (Array.isArray(nested.users) ? nested.users : []);

  var syncedCompanies = 0;
  for (var i = 0; i < companiesList.length; i++) {
    var comp = companiesList[i];
    if (!comp || !comp.company_id) continue;
    // Attach matching owner user if present in usersList so password_hash/Global_Users are synced too
    var compCopy = extendObj_(comp, null);
    if (!compCopy.owner && usersList.length > 0) {
      var compIdUpper = String(comp.company_id).trim().toUpperCase();
      var compEmailLower = String(comp.owner_email || "").trim().toLowerCase();
      for (var ui = 0; ui < usersList.length; ui++) {
        var cand = usersList[ui];
        if (!cand) continue;
        var candComp = String(cand.company_id || cand.companyId || "").trim().toUpperCase();
        var candRole = String(cand.role || "").trim().toUpperCase();
        var candEmail = String(cand.email || "").trim().toLowerCase();
        if (candComp === compIdUpper && (candRole === "OWNER" || (compEmailLower && candEmail === compEmailLower))) {
          compCopy.owner = cand;
          break;
        }
      }
    }
    var cRes = handleSyncCompany({ data: compCopy }, ss);
    if (cRes && cRes.success) syncedCompanies++;
  }

  var syncedBranches = 0;
  var nowIso = new Date().toISOString();
  var pendingBulkAppends = {};

  var queueBulkAppend = function(sheetObj, headersArr, dedupeKey, rowObj) {
    var sName = sheetObj.getName();
    if (!pendingBulkAppends[sName]) {
      pendingBulkAppends[sName] = { sheet: sheetObj, headers: headersArr, rows: [], keyMap: {} };
    }
    var bucket = pendingBulkAppends[sName];
    var rowArr = buildRowArrayByHeaders(headersArr, rowObj);
    if (bucket.keyMap.hasOwnProperty(dedupeKey)) {
      bucket.rows[bucket.keyMap[dedupeKey]] = rowArr;
    } else {
      bucket.keyMap[dedupeKey] = bucket.rows.length;
      bucket.rows.push(rowArr);
    }
  };

  // Batch-index existing branches in one read instead of N per-row scans
  if (branchesList.length > 0) {
    var bSheet = backfillSchemaColumns(ss, "branches");
    var bVals = bSheet.getDataRange().getValues();
    var bHeaders = bVals[0] || [];
    var bIdCol = bHeaders.indexOf("branch_id");
    var bEntCol = bHeaders.indexOf("entity_id");
    var bCompCol = bHeaders.indexOf("company_id");
    var existingBranchRows = {};
    for (var brRow = 1; brRow < bVals.length; brRow++) {
      var rComp = bCompCol !== -1 ? String(bVals[brRow][bCompCol] || "").trim().toUpperCase() : "";
      var rId = String((bIdCol !== -1 ? bVals[brRow][bIdCol] : "") || (bEntCol !== -1 ? bVals[brRow][bEntCol] : "") || "").trim().toUpperCase();
      if (rComp && rId) existingBranchRows[rComp + "::" + rId] = brRow + 1;
    }

    for (var b = 0; b < branchesList.length; b++) {
      var br = branchesList[b];
      if (!br) continue;
      var bComp = String(br.company_id || br.companyId || br.CompanyID || "").trim();
      var bId = String(br.branch_id || br.branchId || br.id || "").trim();
      if (!bComp || !bId) continue;
      var bKey = bComp.toUpperCase() + "::" + bId.toUpperCase();
      var bSeq = allocateNextServerSeq(ss, bComp);
      var bRowObj = {
        branch_id: bId,
        company_id: bComp,
        branch_name: br.branch_name || br.name || bId,
        branch_code: br.branch_code || br.code || bId,
        location: br.location || br.address || "",
        location_code: br.location_code || br.branch_code || br.code || bId,
        address: br.address || br.location || "",
        phone: br.phone || "",
        is_main: Boolean(br.isMain || br.is_main || bId === "BR-MAIN"),
        is_active: br.is_active !== false,
        created_at: br.created_at || nowIso,
        updated_at: nowIso,
        entity_type: "branch",
        entity_id: bId,
        version: Number(br.version || 1),
        mutation_source: br.mutationSource || "USER_EDIT",
        client_updated_at: nowIso,
        server_updated_at: nowIso,
        server_seq: bSeq,
        is_deleted: false,
        server_received_at: nowIso,
        suspicious_backdate: false,
        payload_json: JSON.stringify({
          id: bId,
          branchId: bId,
          branch_id: bId,
          company_id: bComp,
          name: br.branch_name || br.name || bId,
          code: br.branch_code || br.code || bId,
          location: br.location || br.address || "",
          is_active: br.is_active !== false,
          updatedAt: Date.now()
        })
      };
      if (existingBranchRows[bKey]) {
        updateRowByHeaders(bSheet, existingBranchRows[bKey], bHeaders, bRowObj);
      } else {
        queueBulkAppend(bSheet, bHeaders, bKey, bRowObj);
      }
      syncedBranches++;
    }
  }

  var syncedUsers = 0;
  var gSheet = null;
  var gHeaders = null;
  var existingGlobalRows = {};
  try {
    gSheet = backfillSchemaColumns(ss, "Global_Users");
    var gVals = gSheet.getDataRange().getValues();
    gHeaders = gVals[0] || [];
    var gUidCol = gHeaders.indexOf("user_id");
    var gEmailCol = gHeaders.indexOf("email");
    var gCompCol = gHeaders.indexOf("company_id");
    for (var gr = 1; gr < gVals.length; gr++) {
      var gc = gCompCol !== -1 ? String(gVals[gr][gCompCol] || "").trim().toUpperCase() : "";
      var gu = gUidCol !== -1 ? String(gVals[gr][gUidCol] || "").trim().toUpperCase() : "";
      var ge = gEmailCol !== -1 ? String(gVals[gr][gEmailCol] || "").trim().toLowerCase() : "";
      if (gc && gu) existingGlobalRows[gc + "::U::" + gu] = gr + 1;
      if (gc && ge) existingGlobalRows[gc + "::E::" + ge] = gr + 1;
    }
  } catch (e) {}

  if (usersList.length > 0) {
    var uSheet = backfillSchemaColumns(ss, "users");
    var uVals = uSheet.getDataRange().getValues();
    var uHeaders = uVals[0] || [];
    var uIdCol = uHeaders.indexOf("user_id");
    var uEntCol = uHeaders.indexOf("entity_id");
    var uCompCol = uHeaders.indexOf("company_id");
    var uPinHashCol = uHeaders.indexOf("pin_hash");
    var uPinSaltCol = uHeaders.indexOf("pin_salt");
    var uPinVerCol = uHeaders.indexOf("pin_version");
    var uPinUpdCol = uHeaders.indexOf("pin_updated_at");
    var existingUserRows = {};
    for (var ur = 1; ur < uVals.length; ur++) {
      var uc = uCompCol !== -1 ? String(uVals[ur][uCompCol] || "").trim().toUpperCase() : "";
      var uiKey = String((uIdCol !== -1 ? uVals[ur][uIdCol] : "") || (uEntCol !== -1 ? uVals[ur][uEntCol] : "") || "").trim().toUpperCase();
      if (uc && uiKey) existingUserRows[uc + "::" + uiKey] = { rowIdx: ur + 1, rowVals: uVals[ur] };
    }

    for (var u = 0; u < usersList.length; u++) {
      var usr = usersList[u];
      if (!usr) continue;
      var uComp = String(usr.company_id || usr.companyId || "").trim();
      var uId = String(usr.user_id || usr.id || "").trim();
      if (!uComp || !uId) continue;
      var uBr = String(usr.branch_id || usr.branchId || "BR-MAIN").trim();
      var uKey = uComp.toUpperCase() + "::" + uId.toUpperCase();
      var exU = existingUserRows[uKey];

      var resolvedPinHash = String(usr.pin_hash || usr.password_hash || "").trim();
      var resolvedPinSalt = String(usr.pin_salt || "").trim();
      if (!resolvedPinHash && usr.pin) {
        resolvedPinHash = hashPasswordSha256(String(usr.pin).trim());
      }
      var resolvedPinVersion = Number(usr.pinVersion || usr.pin_version || 0);
      var resolvedPinUpdatedAt = usr.pinUpdatedAt ? new Date(Number(usr.pinUpdatedAt)).toISOString() : "";

      if (exU) {
        var prevPinHash = uPinHashCol !== -1 ? String(exU.rowVals[uPinHashCol] || "").trim() : "";
        var prevPinVer = uPinVerCol !== -1 ? Number(exU.rowVals[uPinVerCol] || 0) : 0;
        if (prevPinHash && (!resolvedPinHash || (prevPinVer > 0 && (resolvedPinVersion === 0 || prevPinVer > resolvedPinVersion)))) {
          resolvedPinHash = prevPinHash;
          resolvedPinSalt = (uPinSaltCol !== -1 ? String(exU.rowVals[uPinSaltCol] || "") : "") || resolvedPinSalt;
          resolvedPinVersion = Math.max(prevPinVer, resolvedPinVersion);
          resolvedPinUpdatedAt = (uPinUpdCol !== -1 ? String(exU.rowVals[uPinUpdCol] || "") : "") || resolvedPinUpdatedAt;
        }
      }

      var sanitizedUser = sanitizePayloadForCloud("staff", usr);
      sanitizedUser.id = uId;
      sanitizedUser.pin_hash = resolvedPinHash;
      if (resolvedPinSalt) sanitizedUser.pin_salt = resolvedPinSalt;
      if (resolvedPinVersion > 0) sanitizedUser.pinVersion = resolvedPinVersion;

      var uSeq = allocateNextServerSeq(ss, uComp);
      var uRowObj = {
        user_id: uId,
        company_id: uComp,
        branch_id: uBr,
        full_name: usr.full_name || usr.name || "Staff Member",
        email: usr.email || "",
        phone: usr.phone || "",
        role: String(usr.role || "CASHIER").toUpperCase(),
        pin_hash: resolvedPinHash,
        pin_salt: resolvedPinSalt,
        pin_version: resolvedPinVersion,
        pin_updated_at: resolvedPinUpdatedAt,
        assigned_branch_ids: JSON.stringify(usr.assignedBranchIds || []),
        branch_assignments_json: JSON.stringify(usr.branchAssignments || []),
        permissions_json: JSON.stringify(usr.permissions || {}),
        is_active: usr.active !== "N" && usr.is_active !== false,
        created_at: usr.created_at || nowIso,
        updated_at: nowIso,
        entity_type: "staff",
        entity_id: uId,
        version: Number(usr.version || 1),
        mutation_source: usr.mutationSource || "USER_EDIT",
        client_updated_at: nowIso,
        server_updated_at: nowIso,
        server_seq: uSeq,
        is_deleted: false,
        server_received_at: nowIso,
        suspicious_backdate: false,
        payload_json: JSON.stringify(sanitizedUser)
      };

      if (exU) {
        updateRowByHeaders(uSheet, exU.rowIdx, uHeaders, uRowObj);
      } else {
        queueBulkAppend(uSheet, uHeaders, uKey, uRowObj);
      }
      syncedUsers++;

      var uEmail = String(usr.email || "").trim().toLowerCase();
      var uRole = String(usr.role || "").trim().toUpperCase();
      if (gSheet && gHeaders && uEmail && (uRole === "OWNER" || uRole === "ADMIN" || uRole === "SUPER_ADMIN")) {
        try {
          var pwHash = resolvedPinHash;
          var gRowIdx =
            existingGlobalRows[uComp.toUpperCase() + "::U::" + uId.toUpperCase()] ||
            existingGlobalRows[uComp.toUpperCase() + "::E::" + uEmail] ||
            -1;
          var gObj = {
            user_id: uId,
            email: uEmail,
            password_hash: pwHash,
            company_id: uComp,
            role: uRole,
            full_name: usr.full_name || usr.name || "Owner",
            branch_id: uBr,
            is_active: usr.active !== "N" && usr.is_active !== false,
            updated_at: nowIso
          };
          if (gRowIdx > 0) {
            updateRowByHeaders(gSheet, gRowIdx, gHeaders, gObj);
          } else {
            queueBulkAppend(gSheet, gHeaders, uComp.toUpperCase() + "::" + uEmail, gObj);
          }
        } catch (gErr2) {}
      }
    }
  }

  // Commit all newly inserted branches, users, and Global_Users in ONE batched setValues() per tab
  flushPendingSheetAppends(pendingBulkAppends);

  return {
    success: true,
    count: syncedCompanies,
    companies_count: syncedCompanies,
    branches_count: syncedBranches,
    users_count: syncedUsers,
    message: "Synced " + syncedCompanies + " companies, " + syncedBranches + " branches, and " + syncedUsers + " users to Master Sheet."
  };
}

function handleGetInventory(req, masterSsOpt, targetSsOpt, companyIdOpt) {
  var companyId = String(companyIdOpt || req.company_id || req.companyId || TENANT_COMPANY_ID).trim();
  var ss = targetSsOpt || resolveTargetSpreadsheet(masterSsOpt, companyId, req.sheet_id);
  var res = handleGetData({ sheet: "InventoryMaster", company_id: companyId, branch_id: "ALL", user_role: "OWNER" }, ss, masterSsOpt);
  var items = (res.rows || []).map(function(r) {
    if (r.payload_json && String(r.payload_json).charAt(0) === "{") {
      try { return JSON.parse(r.payload_json); } catch (e) {}
    }
    return reconstructDataFromLegacyRow("inventory_item", r);
  });
  return { success: true, items: items, count: items.length };
}

function handleSyncInventory(req, masterSsOpt, targetSs, companyId, branchId) {
  var items = Array.isArray(req.items) ? req.items : (Array.isArray(req.data) ? req.data : [mergeReqPayload(req)]);
  var envelopes = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it) continue;
    var p = it.payload || it;
    envelopes.push({
      packetId: it.id || p.itemId || p.id || ("INV-" + Date.now() + "-" + i),
      entityType: "inventory_item",
      entityId: String(p.itemId || p.ProductID || p.id || ""),
      action: it.action === "DELETE" ? "DELETE" : "UPSERT",
      data: p,
      updatedAt: parseTimestampMsSafe(p.updatedAt || p.lastUpdated) || Date.now(),
      version: Number(p.version || 1),
      mutationSource: p.mutationSource || "USER_EDIT",
      targetBranchId: "ALL",
      class: "T2"
    });
  }
  return handlePushEnvelopes({
    envelopes: envelopes,
    company_id: companyId,
    branch_id: branchId || "ALL",
    user_role: req.user_role || "OWNER",
    tenant_sheet_id: req.tenant_sheet_id || req.sheet_id
  }, masterSsOpt, targetSs, companyId, branchId || "ALL");
}

function handleBatchSyncWrites(req, masterSsOpt, targetSs, companyId, branchId) {
  var items = Array.isArray(req.items) ? req.items : [];
  var envelopes = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var sheetName = SHEET_ALIASES[it.sheetName] || it.sheetName || "";
    var p = it.payload || it;
    var entityType = p.entityType || null;
    if (!entityType) {
      for (var et in ENTITY_TO_TAB) {
        if (ENTITY_TO_TAB[et] === sheetName) { entityType = et; break; }
      }
    }
    envelopes.push({
      packetId: it.id || (p && p.clientRequestId) || ("BATCH-" + Date.now() + "-" + i),
      entityType: entityType || "audit_log",
      entityId: extractEntityIdFromPayload(entityType || "audit_log", p.id, p),
      action: it.action === "DELETE" ? "DELETE" : "UPSERT",
      data: p,
      updatedAt: parseTimestampMsSafe(p.updatedAt || it.timestamp) || Date.now(),
      version: Number(p.version || 1),
      mutationSource: p.mutationSource || "USER_EDIT",
      targetBranchId: p.branch_id || branchId || "ALL",
      class: T2_ENTITY_TYPES[entityType] ? "T2" : "T1",
      meta: { sheetName: sheetName }
    });
  }
  return handlePushEnvelopes({
    envelopes: envelopes,
    company_id: companyId,
    branch_id: branchId,
    user_role: req.user_role || "OWNER",
    tenant_sheet_id: req.tenant_sheet_id || req.sheet_id
  }, masterSsOpt, targetSs, companyId, branchId);
}

function handleProvisionTenantSheet(req, masterSs) {
  return provisionTenantFromTemplate(req, masterSs);
}

function getSeedPermissions52() {
  return [
    { role: "MANAGER", module: "pos", action: "sell", allowed: true, description: "Process sales" },
    { role: "MANAGER", module: "pos", action: "void", allowed: true, description: "Void sale" },
    { role: "MANAGER", module: "pos", action: "refund", allowed: true, description: "Refund sale" },
    { role: "MANAGER", module: "inventory", action: "edit", allowed: true, description: "Edit inventory" },
    { role: "MANAGER", module: "stocktake", action: "supervise", allowed: true, description: "Supervise stocktake" },
    { role: "AUDITOR", module: "stocktake", action: "supervise", allowed: true, description: "Audit stocktake" },
    { role: "AUDITOR", module: "stocktake", action: "unlock", allowed: true, description: "Unlock stocktake slot" },
    { role: "CASHIER", module: "pos", action: "sell", allowed: true, description: "Process sales" },
    { role: "CASHIER", module: "stocktake", action: "count", allowed: true, description: "Blind count active stocktake" }
  ];
}

function seedSampleData(req, ss, companyId, branchId) {
  return { success: true, message: "Sample data hook ready for " + companyId };
}

// ============================================================================
// SAFE TEST-TENANT PURGE & SINGLE-TENANT DELETE (PROTECTING COMP-001 & MASTER)
// ============================================================================

var PROTECTED_COMPANY_IDS_MAP = {
  "COMP-001": true,
  "COMP-MASTER": true
};
var PROTECTED_MASTER_SHEET_ID_FALLBACK = "1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE";
var PROTECTED_SUPER_ADMIN_EMAIL = "andrekudakwashe@gmail.com";

function findHeaderColIndex_(headers, candidates) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || "").trim().toLowerCase().replace(/[\s\-]+/g, "_");
    for (var c = 0; c < candidates.length; c++) {
      if (h === candidates[c]) return i;
    }
  }
  return -1;
}

function rewriteMasterTabByFilter_(ss, tabName, filterFn) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { exists: false, before: 0, after: 0, removed: 0 };
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol < 1) {
    return { exists: true, before: 0, after: 0, removed: 0 };
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0];
  var keptRows = [headers];
  var beforeDataRows = values.length - 1;

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (filterFn(row, headers, r)) {
      keptRows.push(row);
    }
  }

  var afterDataRows = keptRows.length - 1;
  var removed = Math.max(0, beforeDataRows - afterDataRows);

  if (removed > 0 || keptRows.length < values.length) {
    sheet.getRange(1, 1, keptRows.length, lastCol).setValues(keptRows);
    var excessStart = keptRows.length + 1;
    var maxRows = sheet.getMaxRows();
    if (excessStart <= maxRows) {
      // Clear leftover values first; delete excess rows cleanly leaving at least 1 empty row if needed
      if (lastRow >= excessStart) {
        sheet.getRange(excessStart, 1, lastRow - keptRows.length, lastCol).clearContent();
      }
      var rowsToDelete = maxRows - Math.max(keptRows.length + 5, 20);
      if (rowsToDelete > 0) {
        try {
          sheet.deleteRows(Math.max(keptRows.length + 5, 20) + 1, rowsToDelete);
        } catch (delErr) {}
      }
    }
  }

  return {
    exists: true,
    before: beforeDataRows,
    after: afterDataRows,
    removed: removed
  };
}

/**
 * Safely purge all non-allowlisted companies from Master Control Plane tabs.
 * - Always protects COMP-001 (Saimetric Demo), COMP-MASTER, SUPER_ADMIN, and Master Spreadsheet.
 * - Deduplicates bloated branches tab in-memory and writes each tab in ONE setValues() call.
 * - Optionally moves removed companies' dedicated Google Drive spreadsheets to Trash.
 */
function handlePurgeTestCompanies(req, masterSs) {
  var ss = masterSs || getMasterSpreadsheet();
  var masterId = String(ss.getId() || PROTECTED_MASTER_SHEET_ID_FALLBACK).trim();
  var keepList = Array.isArray(req && req.keep_company_ids) ? req.keep_company_ids : ["COMP-001", "COMP-MASTER"];
  var keepSet = { "COMP-001": true, "COMP-MASTER": true };
  for (var k = 0; k < keepList.length; k++) {
    var kid = String(keepList[k] || "").trim().toUpperCase();
    if (kid) keepSet[kid] = true;
  }

  var trashDedicatedSheets = !(req && req.trash_dedicated_sheets === false);
  var dryRun = !!(req && req.dry_run === true);

  // 1. Inspect companies tab first to collect removed company IDs & their dedicated sheet IDs
  var removedCompanyIds = [];
  var keptCompanyIds = [];
  var dedicatedSheetsToTrash = {};
  var compSheet = ss.getSheetByName("companies");
  if (compSheet && compSheet.getLastRow() > 1 && compSheet.getLastColumn() >= 1) {
    var compVals = compSheet.getDataRange().getValues();
    var cHeaders = compVals[0];
    var cidIdx = findHeaderColIndex_(cHeaders, ["company_id", "companyid", "id"]);
    var sidIdx = findHeaderColIndex_(cHeaders, ["sheet_id", "sheetid", "dedicated_sheet_id", "spreadsheet_id"]);
    var fidIdx = findHeaderColIndex_(cHeaders, ["sheet_folder_id", "folder_id"]);

    if (cidIdx >= 0) {
      var seenComp = {};
      for (var r = 1; r < compVals.length; r++) {
        var cidRaw = String(compVals[r][cidIdx] || "").trim();
        var cidNorm = cidRaw.toUpperCase();
        if (!cidNorm) continue;
        if (keepSet[cidNorm]) {
          if (!seenComp[cidNorm]) {
            seenComp[cidNorm] = true;
            keptCompanyIds.push(cidRaw);
          }
        } else {
          if (!seenComp[cidNorm]) {
            seenComp[cidNorm] = true;
            removedCompanyIds.push(cidRaw);
          }
          var sids = [];
          if (sidIdx >= 0) sids.push(String(compVals[r][sidIdx] || "").trim());
          if (fidIdx >= 0) sids.push(String(compVals[r][fidIdx] || "").trim());
          for (var si = 0; si < sids.length; si++) {
            var sid = sids[si];
            if (
              sid &&
              sid.length >= 25 &&
              sid !== masterId &&
              sid !== PROTECTED_MASTER_SHEET_ID_FALLBACK &&
              sid.indexOf("http") !== 0
            ) {
              dedicatedSheetsToTrash[sid] = cidRaw;
            }
          }
        }
      }
    }
  }

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      kept_companies: keptCompanyIds,
      removed_companies: removedCompanyIds,
      removed_count: removedCompanyIds.length,
      dedicated_sheets_to_trash: Object.keys(dedicatedSheetsToTrash),
      master_sheet_protected: masterId
    };
  }

  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(25000);
  if (!gotLock) {
    return { success: false, error: "Could not acquire Master Control Plane lock. Retry shortly." };
  }

  var tabStats = {};
  var trashedSheets = [];
  var trashErrors = [];

  try {
    // 2. Rewrite companies tab (deduplicate kept rows by company_id)
    var seenKeepCompanies = {};
    tabStats.companies = rewriteMasterTabByFilter_(ss, "companies", function(row, headers) {
      var cidIdx = findHeaderColIndex_(headers, ["company_id", "companyid", "id"]);
      if (cidIdx < 0) return true;
      var cid = String(row[cidIdx] || "").trim().toUpperCase();
      if (!cid || !keepSet[cid]) return false;
      if (seenKeepCompanies[cid]) return false;
      seenKeepCompanies[cid] = true;
      return true;
    });

    // 3. Rewrite branches & Branches tabs (also deduplicates bloated 46k+ rows by company_id::branch_id)
    var branchTabs = ["branches", "Branches"];
    for (var bt = 0; bt < branchTabs.length; bt++) {
      var seenBranches = {};
      tabStats[branchTabs[bt]] = rewriteMasterTabByFilter_(ss, branchTabs[bt], function(row, headers) {
        var cidIdx = findHeaderColIndex_(headers, ["company_id", "companyid"]);
        var bidIdx = findHeaderColIndex_(headers, ["branch_id", "branchid", "id"]);
        if (cidIdx < 0) return true;
        var cid = String(row[cidIdx] || "").trim().toUpperCase();
        if (!cid || !keepSet[cid]) return false;
        var bid = bidIdx >= 0 ? String(row[bidIdx] || "").trim().toUpperCase() : "";
        var key = cid + "::" + bid;
        if (bid && seenBranches[key]) return false;
        if (bid) seenBranches[key] = true;
        return true;
      });
    }

    // 4. Rewrite users & Global_Users (always preserve SUPER_ADMIN & protected admin email)
    var userTabs = ["users", "Global_Users"];
    for (var ut = 0; ut < userTabs.length; ut++) {
      var seenUsers = {};
      tabStats[userTabs[ut]] = rewriteMasterTabByFilter_(ss, userTabs[ut], function(row, headers) {
        var cidIdx = findHeaderColIndex_(headers, ["company_id", "companyid"]);
        var roleIdx = findHeaderColIndex_(headers, ["role", "user_role"]);
        var emailIdx = findHeaderColIndex_(headers, ["email", "user_email"]);
        var uidIdx = findHeaderColIndex_(headers, ["user_id", "userid", "id"]);
        var role = roleIdx >= 0 ? String(row[roleIdx] || "").trim().toUpperCase() : "";
        var email = emailIdx >= 0 ? String(row[emailIdx] || "").trim().toLowerCase() : "";
        if (role === "SUPER_ADMIN" || email === PROTECTED_SUPER_ADMIN_EMAIL) {
          var sKey = "SA::" + email + "::" + (uidIdx >= 0 ? String(row[uidIdx] || "").trim() : "");
          if (seenUsers[sKey]) return false;
          seenUsers[sKey] = true;
          return true;
        }
        if (cidIdx < 0) return true;
        var cid = String(row[cidIdx] || "").trim().toUpperCase();
        if (!cid || !keepSet[cid]) return false;
        var uKey = cid + "::" + (email || (uidIdx >= 0 ? String(row[uidIdx] || "").trim() : ""));
        if (seenUsers[uKey]) return false;
        seenUsers[uKey] = true;
        return true;
      });
    }

    // 5. Rewrite Subscriptions, permissions, request_log
    var otherTabs = ["Subscriptions", "permissions", "request_log"];
    for (var ot = 0; ot < otherTabs.length; ot++) {
      tabStats[otherTabs[ot]] = rewriteMasterTabByFilter_(ss, otherTabs[ot], function(row, headers) {
        var cidIdx = findHeaderColIndex_(headers, ["company_id", "companyid"]);
        if (cidIdx < 0) return true;
        var cid = String(row[cidIdx] || "").trim().toUpperCase();
        if (!cid) return false;
        return !!keepSet[cid];
      });
    }

    // 6. Move removed test companies' dedicated Drive spreadsheets to Trash (NEVER Master Sheet)
    if (trashDedicatedSheets) {
      var sheetIds = Object.keys(dedicatedSheetsToTrash);
      for (var t = 0; t < sheetIds.length; t++) {
        var targetSid = sheetIds[t];
        if (!targetSid || targetSid === masterId || targetSid === PROTECTED_MASTER_SHEET_ID_FALLBACK) {
          continue;
        }
        try {
          var file = DriveApp.getFileById(targetSid);
          if (file && !file.isTrashed()) {
            file.setTrashed(true);
            trashedSheets.push({ sheet_id: targetSid, company_id: dedicatedSheetsToTrash[targetSid] });
          }
        } catch (driveErr) {
          trashErrors.push({ sheet_id: targetSid, error: driveErr && driveErr.message ? driveErr.message : String(driveErr) });
        }
      }
    }

    // 7. Invalidate tenant routing cache entries for removed companies
    try {
      for (var rc = 0; rc < removedCompanyIds.length; rc++) {
        CACHE.remove("tenant_ctx_" + removedCompanyIds[rc]);
        CACHE.remove("route_" + removedCompanyIds[rc]);
      }
      CACHE.remove("all_companies_v1");
    } catch (cErr) {}

    SpreadsheetApp.flush();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }

  return {
    success: true,
    kept_companies: keptCompanyIds,
    removed_companies: removedCompanyIds,
    removed_count: removedCompanyIds.length,
    trashed_sheets: trashedSheets,
    trashed_sheets_count: trashedSheets.length,
    trash_errors: trashErrors,
    tab_stats: tabStats,
    master_sheet_protected: masterId,
    message: "Purged " + removedCompanyIds.length + " test companies from Master Sheet" +
      (trashedSheets.length > 0 ? " and moved " + trashedSheets.length + " dedicated Drive sheet(s) to Trash." : ".")
  };
}

/**
 * Safely delete a single non-protected tenant company across all Master Sheet tabs.
 * Refuses COMP-001 and COMP-MASTER.
 */
function handleDeleteCompany(req, masterSs) {
  var ss = masterSs || getMasterSpreadsheet();
  var targetId = String((req && (req.company_id || req.companyId)) || "").trim();
  var targetNorm = targetId.toUpperCase();
  if (!targetId) {
    return { success: false, code: "MISSING_COMPANY_ID", error: "company_id is required." };
  }
  if (PROTECTED_COMPANY_IDS_MAP[targetNorm]) {
    return { success: false, code: "PROTECTED_COMPANY", error: targetId + " is a protected core workspace and cannot be deleted." };
  }

  // Build allowlist of all currently existing companies EXCEPT targetNorm
  var keepIds = ["COMP-001", "COMP-MASTER"];
  var compSheet = ss.getSheetByName("companies");
  if (compSheet && compSheet.getLastRow() > 1 && compSheet.getLastColumn() >= 1) {
    var vals = compSheet.getDataRange().getValues();
    var cidIdx = findHeaderColIndex_(vals[0], ["company_id", "companyid", "id"]);
    if (cidIdx >= 0) {
      for (var r = 1; r < vals.length; r++) {
        var cid = String(vals[r][cidIdx] || "").trim();
        if (cid && cid.toUpperCase() !== targetNorm) {
          keepIds.push(cid);
        }
      }
    }
  }

  var res = handlePurgeTestCompanies({
    keep_company_ids: keepIds,
    trash_dedicated_sheets: !(req && req.trash_dedicated_sheets === false)
  }, ss);
  res.deleted_company_id = targetId;
  return res;
}

/**
 * Standalone one-click function runnable directly inside the Google Apps Script editor.
 * Keeps ONLY COMP-001 (Saimetric Demo) and COMP-MASTER (Super Admin), deduplicates the
 * bloated branches tab, and moves removed test companies' dedicated Drive sheets to Trash.
 */
function purgeAllTestCompaniesKeepDemo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getMasterSpreadsheet();
  var res = handlePurgeTestCompanies({
    keep_company_ids: ["COMP-001", "COMP-MASTER"],
    trash_dedicated_sheets: true
  }, ss);
  Logger.log(JSON.stringify(res, null, 2));
  return res;
}
