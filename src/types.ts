// SAIMETRIC Type Definitions

export type ActiveTab = any;
export type AdminSalesEntry = any;
export type AppCurrency = any;
export type AuditAction = any;
export type AuditLogEntry = any;
export type Branch = any;
export type CartItem = any;
export type CashCountRecord = any;
export type CashLiftRecord = any;
export type CashLogEntry = any;
export type CashMovement = any;
export type CashMovementDirection = any;
export type CashMovementSource = any;
export type CashMovementStatus = any;
export type CashMovementType = any;
export interface CompanyBranchSharingSettings {
  shareCustomersAcrossBranches: boolean;
  shareSuppliersAcrossBranches: boolean;
  form4AuditPassword?: string;
  eodVerificationMode?: 'SINGLE' | 'DUAL';
}
export type CreditPolicyMode = any;
export type CreditSaleEntry = any;
export type CurrencyRateConfig = any;
export interface Customer {
  id?: string;
  customerId?: string;
  name?: string;
  phone?: string;
  address?: string;
  createdDate?: string;
  createdBy?: string;
  company_id?: string;
  companyId?: string;
  branch_id?: string;
  branchId?: string;
  currentBalance?: number;
  creditAllowed?: boolean;
  creditLimit?: number;
  maxCreditReceiptCount?: number;
  creditApprovedBy?: string;
  creditApprovalDate?: string;
  creditGroupId?: string;
  creditGroupName?: string;
  isCustomLimit?: boolean;
  [key: string]: any;
}

export interface CreditGroup {
  id: string;
  name: string;
  groupLimit: number;
  description?: string;
  createdAt?: string;
  createdBy?: string;
  isDefault?: boolean;
  updatedAt?: number;
  lastUpdated?: string;
}
export type CustomerChangeEntry = any;
export type CustomerChangeReportItem = any;
export type CustomerCreditReportItem = any;
export type CustomerGoodsLeftBehind = any;
export type CustomerLedgerEntry = any;
export type CustomerLedgerType = any;
export type DataDictionaryItem = any;
export type DirectGrv = any;
export type DirectGrvItem = any;
export type DirectGrvTillPayment = any;
export type ExpenseEntry = any;
export type FastMovingChecklistItem = any;
export type FilterOperator = any;
export type Form4BalancingResult = any;
export type GoodsReceivedEntry = any;
export type GoodsReceivedNote = any;
export type GoogleSheetsConfig = any;
export type GrnLineItem = any;
export type GrnTotals = any;
export type GrvStatus = any;
export type GrvType = any;
export type InventoryItem = any;
export type LandedCostItem = any;
export type MultiCurrencyConfig = any;
export type NegativeBalanceEntry = any;
export type P2PMeshConfig = any;
export type P2PMeshPeer = any;
export type P2PPacket = any;
export type PackagingVariant = any;
export type ParkedSale = any;
export type ProcurementTripManifest = any;
export type Product = any;
export type ReportExecutionResult = any;
export type ReportJsonConfig = any;
export type ReportPermission = any;
export type Role = any;
export type RoleId = any;
export type SaleInvoice = any;
export interface BranchFloorSegment {
  segmentId: string;
  name: string;
  locationCode: string;
  description?: string;
  sortOrder?: number;
}

export interface StocktakeVarianceCommentEntry {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  reasonCode: StocktakeVarianceReasonCode;
  comment: string;
  actionTaken?: string;
  createdAt: string;
}

export interface Salesperson {
  id: string;
  name: string;
  role: Role | string;
  pin?: string;          // Deprecated: stripped on boot migration
  pin_hash?: string;     // One-way SHA-256 hash (salt:pin)
  pin_salt?: string;     // Cryptographic salt
  pinVersion?: number;   // Monotonic counter incremented only on explicit PIN change
  pinUpdatedAt?: number; // Timestamp of last explicit PIN change
  version?: number;      // Monotonic logical version (0 = seed, >= 1 = user edits)
  mutationSource?: 'SEED' | 'USER_EDIT' | 'MIGRATION';
  updatedAt?: number;
  lastUpdated?: string;
  isDirty?: boolean;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  branchName?: string;
  email?: string;
  phone?: string;
  active?: 'Y' | 'N';
  permissions?: StaffPermissions;
  branchAssignments?: StaffBranchAssignment[];
  // Runtime Stocktake Session Isolation Flags (T3 session-local)
  isCasual?: boolean;
  isVisitingCounter?: boolean;
  isExternalConsultant?: boolean;
  tempRole?: 'COUNTER' | 'AUDITOR';
  restrictedToSessionId?: string;
  guestPassId?: string;
  homeBranchId?: string;
  homeBranchName?: string;
  assignedGroup?: 'GROUP_1' | 'GROUP_2';
  assignedSegmentId?: string;
  assignedSegmentIds?: string[];
  badgeNumber?: string;
  [key: string]: any;
}
export type SavedReportTemplate = any;
export type SheetName = any;
export type ShiftReconciliation = any;
export type StaffBranchAssignment = any;
export interface StaffPermissions {
  canEditCartPrice?: boolean;
  canApplyCartDiscount?: boolean;
  canDeleteCartItem?: boolean;
  canClearCart?: boolean;
  canManageInventory?: boolean;
  canEditPriceCost?: boolean;
  canSellNegativeStock?: boolean;
  canReceiveGRN?: boolean;
  canBreakCases?: boolean;
  canAccessReports?: boolean;
  canManageExpenses?: boolean;
  canPerformShiftEnd?: boolean;
  canManageStaff?: boolean;
  canCreateDirectGrv?: boolean;
  canApproveDirectGrv?: boolean;
  canUseCustomerChange?: boolean;
  canIssueCustomerCredit?: boolean;
  canSubmitEOD?: boolean;
  canApproveEOD?: boolean;
  canViewVarianceInvestigation?: boolean;
  canViewAuditLog?: boolean;
  canPinOverride?: boolean;
  canManageCompany?: boolean;
  canEditMasterPrice?: boolean;
  canEditExchangeRate?: boolean;
  canSeeMargin?: boolean;

  // Cash Custody Chain & Accounts Clerk Permissions
  canCreateCashTransferFloat?: boolean;      // cash_transfer.create_float
  canCollectTillTransfer?: boolean;          // cash_transfer.collect_till
  canPaySupplierTransfer?: boolean;          // cash_transfer.pay_supplier
  canCreateBankDepositTransfer?: boolean;    // cash_transfer.bank_deposit
  canReceiveHqTransfer?: boolean;            // hq_safe.receive_transfer
  canExecuteOwnerOverride?: boolean;         // hq_safe.owner_override
  canAccessWhereIsMyMoney?: boolean;         // Explicit access to Where Is My Money report
  canAccessDualCashCustody?: boolean;        // Explicit access to Dual Cash Custody / Safe

  // Stocktake Accessibility & Governance Permissions
  canAuditStocktake?: boolean;               // Can supervise & certify stocktakes without necessarily owning committal
  canPerformDailyBlindCount?: boolean;       // Can run Daily Blind Counts (Fast Movers) without full admin access

  [key: string]: any;
}
export type StockBatch = any;
export type StockMovementEntry = any;
export type StockPromptResponse = any;
export type StockTxnType = any;

export type StocktakeCountType =
  | 'DAILY_BLIND'
  | 'SPOT_CHECK'
  | 'WEEKLY_STRATEGIC'
  | 'FULL_LOCKDOWN'
  | string;

export type StocktakeStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COUNTING'
  | 'RECOUNTING'
  | 'AUDIT_REVIEW'
  | 'CONSOLIDATED'
  | 'READY_FOR_COMMITTAL'
  | 'APPROVED_POSTED'
  | 'CANCELLED'
  | string;

export type StocktakeVarianceReasonCode =
  | 'THEFT_SHRINKAGE'
  | 'DAMAGED_EXPIRED'
  | 'GRN_RECEIVING_ERROR'
  | 'CASHIER_SKU_SWAP'
  | 'UNRECORDED_SHOP_USE'
  | 'PREVIOUS_COUNT_ERROR'
  | 'SUPPLIER_SHORT_DELIVERY'
  | 'OTHER'
  | string;

export type StocktakeVarianceReviewStatus =
  | 'NOT_REQUIRED'
  | 'PENDING_MANAGER_COMMENTS'
  | 'COMMENTS_SUBMITTED'
  | 'CLOSED';

export interface StocktakeGuestPass {
  id: string;
  sessionId: string;
  staffId: string;
  staffName: string;
  staffRole?: string;
  passRole?: 'COUNTER' | 'AUDITOR';
  homeBranchId: string;
  homeBranchName?: string;
  hostBranchId: string;
  hostBranchName?: string;
  assignedGroup?: 'GROUP_1' | 'GROUP_2';
  assignedSegmentIds?: string[];
  grantedById: string;
  grantedByName: string;
  createdAt: string;
  updatedAt?: number;
  active: boolean;
  revokedAt?: string;
}

export interface StocktakeConsolidatedItem {
  itemId: string;
  itemName: string;
  category?: string;
  sku?: string;
  barcode?: string;
  unitsPerCase: number;
  costPerUnit: number;
  costPerCase?: number;
  sellPriceUnit: number;
  sellPriceCase?: number;
  systemCases: number;
  systemSingles: number;
  systemTotalUnits: number;
  systemCostValue?: number;
  systemRetailValue?: number;
  countedCases: number;
  countedSingles: number;
  countedTotalUnits: number;
  countedCostValue?: number;
  countedRetailValue?: number;
  customerHeldStockUnits?: number;
  emergencySoldUnits?: number;
  adjustedPhysicalUnits?: number;
  trueVarianceUnits?: number;
  varianceCases: number;
  varianceSingles: number;
  varianceTotalUnits: number;
  varianceCostValue: number;
  varianceRetailValue: number;
  status: 'MATCH' | 'SHORTAGE' | 'OVERAGE' | 'RECOUNT_FLAGGED' | string;
  wasCountedInSession?: boolean;
  originalCountedCases?: number;
  originalCountedSingles?: number;
  originalCountedTotalUnits?: number;
  originalVarianceTotalUnits?: number;
  originalVarianceCostValue?: number;
  recountRequested?: boolean;
  recountSheetStatus?: 'REQUESTED' | 'COMPLETED';
  recountNotes?: string;
  recountReason?: string;
  recountCases?: number;
  recountSingles?: number;
  recountTotalUnits?: number;
  recountedBy?: string;
  recountedById?: string;
  recountWitnessId?: string;
  recountWitnessName?: string;
  recountedAt?: string;
  recountReversalAlert?: boolean;
  segmentBreakdown?: {
    segmentId: string;
    segmentName: string;
    cases: number;
    singles: number;
    totalUnits: number;
  }[];
  // Post-Commit Manager Variance Commentary
  reasonCode?: StocktakeVarianceReasonCode;
  managerComment?: string;
  actionTaken?: string;
  commentedById?: string;
  commentedByName?: string;
  commentedAt?: string;
  varianceComments?: StocktakeVarianceCommentEntry[];
  ownerAckStatus?: 'PENDING' | 'ACKNOWLEDGED' | 'DISPUTED';
  requiresExplanation?: boolean;
  [key: string]: any;
}

export type StocktakeLineCount = any;
export type StocktakeSegment = any;
export type StocktakeVerifiedLine = any;

export interface StocktakeSession {
  sessionId: string;
  title: string;
  date: string;
  countType: StocktakeCountType;
  status: StocktakeStatus;
  branchId: string;
  branchName: string;
  isLockdownActive?: boolean;
  stocktakeAuditorId?: string;
  stocktakeAuditorName?: string;
  stocktakeAuditorPhone?: string;
  auditorType?: 'BRANCH_STAFF' | 'VISITING_STAFF' | 'EXTERNAL_CONSULTANT';
  auditorGuestPassId?: string;
  auditorCasualId?: string;
  predefinedDailyItemIds?: string[];
  createdBy: string;
  createdByName: string;
  segments: StocktakeSegment[];
  consolidatedItems: StocktakeConsolidatedItem[];
  totalSystemUnits: number;
  totalCountedUnits: number;
  varianceUnits: number;
  varianceCostValue: number;
  varianceRetailValue: number;
  notes?: string;
  timestamp: string;
  synced?: boolean;
  companyId?: string;
  company_id?: string;
  // Auditor Certification vs Owner/Leader Committal
  certifiedById?: string;
  certifiedByName?: string;
  certifiedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  // Cross-Branch Visiting Counter Guest Passes
  guestPasses?: StocktakeGuestPass[];
  // Post-Commit Mandatory Manager Variance Review
  varianceReviewStatus?: StocktakeVarianceReviewStatus;
  varianceCommentDeadline?: string;
  varianceMaterialityThreshold?: number;
  varianceMinUnitThreshold?: number;
  varianceReviewWindowHours?: number;
  varianceReviewedById?: string;
  varianceReviewedByName?: string;
  varianceReviewedAt?: string;
  // SyncCore L3/L6 versioning metadata
  version?: number;
  mutationSource?: 'SEED' | 'USER_EDIT' | 'MIGRATION';
  updatedAt?: number;
  lastUpdated?: string;
  [key: string]: any;
}

export interface StocktakeZoneAssignment {
  zoneId: string;
  zoneName: string;
  sessionId: string;
  branchId: string;
  status: 'AVAILABLE' | 'IN_PROGRESS' | 'AWAITING_DOUBLE_COUNT' | 'VARIANCE_FLAGGED' | 'VERIFIED' | 'VAULTED';
  teamA?: {
    deviceId?: string;
    staffId?: string;
    staffName?: string;
    claimedAt?: string;
    submitted: boolean;
    submittedAt?: string;
    finalized?: boolean;
    finalizedAt?: string;
    lineCount?: number;
  };
  teamB?: {
    deviceId?: string;
    staffId?: string;
    staffName?: string;
    claimedAt?: string;
    submitted: boolean;
    submittedAt?: string;
    finalized?: boolean;
    finalizedAt?: string;
    lineCount?: number;
  };
  jointRecount?: {
    proposedBy?: 'A' | 'B';
    proposedByName?: string;
    proposedAt?: number;
    signedByA: boolean;
    signedByB: boolean;
    resolvedAt?: string;
    resolvedByName?: string;
    lines: any[];
  };
  comparisonFinalized?: boolean;
  comparisonFinalizedAt?: string;
  comparisonFinalizedBy?: string;
  unlockedReason?: string;
  unlockedByName?: string;
  unlockedAt?: string;
  count1?: any[];
  count2?: any[];
  verifiedCounts?: any[];
  discrepancies?: StocktakeVarianceItem[];
}

export interface StocktakeVarianceItem {
  itemId: string;
  itemName: string;
  sku: string;
  unitsPerCase: number;
  teamACases: number;
  teamASingles: number;
  teamATotalUnits: number;
  teamBCases: number;
  teamBSingles: number;
  teamBTotalUnits: number;
  differenceUnits: number;
  jointCases?: number;
  jointSingles?: number;
  jointTotalUnits?: number;
}

export interface HubBlindSubmission {
  sessionId: string;
  zoneId: string;
  teamSlot: 'A' | 'B' | 'RECOUNT';
  deviceId: string;
  staffId: string;
  staffName: string;
  timestamp: string;
  lines: any[];
}

export interface StoreCreditPolicy {
  mode: 'CUSTOMER_LIMIT' | 'TIERED' | 'DISABLED' | 'STRICT_UPFRONT' | string;
  defaultCreditLimit: number;
  defaultCreditAllowed?: boolean;
  defaultGroupLimit?: number;
  defaultMaxReceiptCount: number;
  allowCashierOverride: boolean;
  maxCustomerCreditCap: number;
  branchCreditExposureCap: number;
}
export type Supplier = any;
export type SupplierInvoiceLineItem = any;
export type SupplierInvoiceVoucher = any;
export type SyncQueueItem = any;
export type TableRelationship = any;
export interface TemporaryCasualAccount {
  id: string;
  name: string;
  pin?: string;          // Deprecated: stripped on boot migration
  pin_hash?: string;     // One-way SHA-256 hash (salt:pin)
  pin_salt?: string;     // Cryptographic salt
  sessionId: string;
  branchId: string;
  phone?: string;
  idNumber?: string;
  badgeNumber?: string;
  assignedSegmentId?: string;
  assignedGroup?: 'GROUP_1' | 'GROUP_2';
  tempRole?: 'COUNTER' | 'AUDITOR';
  isExternalConsultant?: boolean;
  active: boolean;
  createdAt: string;
  updatedAt?: number;
  lastUpdated?: string;
  version?: number;
  mutationSource?: 'SEED' | 'USER_EDIT' | 'MIGRATION';
  [key: string]: any;
}
export type TripGrnAllocationSummary = any;
export type TripItemAllocation = any;
export type TripLandedCost = any;
export type UserRole = any;
export type AuditSeverity = any;
export type ActiveStatus = any;
export type InventoryCategory = any;
export type TripFreightPaymentMethod = any;
export type LandedCostAllocationMethod = any;
export type PaymentMethod = any;
export type SaleItem = any;
export type ReportFilter = any;
export type ReportAggregate = any;
export type ReportJoin = any;
export type ReportSort = any;
export type AggregateFunc = any;

// Real Cash Flow & Multi-Wallet Financial Engine Types
export type WalletId = 'wallet_cash' | 'wallet_ecocash' | 'wallet_bank_zig' | 'wallet_bank_usd' | 'wallet_home_safe' | 'wallet_inventory';

export type WalletType = 'CASH_DRAWER' | 'ECOCASH' | 'BANK_ZIG' | 'BANK_USD' | 'HOME_SAFE' | 'INVENTORY';

export interface Wallet {
  id: WalletId;
  name: string;
  type: WalletType;
  currency: 'USD' | 'ZiG' | 'EcoCash' | string;
  balance: number;
  expectedBalance?: number;
  lastReconciledAt?: string;
  updatedAt: string;
}

export interface WalletTransfer {
  id: string;
  fromWallet: WalletId;
  toWallet: WalletId;
  amountSent: number;
  amountReceived: number;
  bankCharge: number;
  notes?: string;
  performedBy: string;
  performedByName: string;
  timestamp: string;
  date: string;
  reference?: string;
  company_id?: string;
  branch_id?: string;
}

export type ConsumptionType = 'STAFF_WELFARE' | 'OWNER_DRAWING_GROCERIES' | 'STORE_SUPPLIES';
export type ConsumptionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface InternalConsumptionItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  costPrice: number;
  retailPrice: number;
  totalCost: number;
  totalRetail: number;
}

export interface InternalConsumption {
  id: string;
  type: ConsumptionType;
  items: InternalConsumptionItem[];
  totalCost: number;
  totalRetail: number;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  date: string;
  status: ConsumptionStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  notes?: string;
  walletDeductedFrom?: WalletId;
  company_id?: string;
  branch_id?: string;
  updatedAt?: number;
  lastUpdated?: string;
}

export type OwnerDrawingCategory = 'PERSONAL' | 'FAMILY' | 'SCHOOL_FEES' | 'HOME_SAFE_TRANSIT' | 'OTHER';

export interface OwnerDrawing {
  id: string;
  amount: number;
  fromWallet: WalletId;
  category: OwnerDrawingCategory;
  recipientOrPurpose: string;
  notes?: string;
  withdrawnBy: string;
  withdrawnByName: string;
  timestamp: string;
  date: string;
  company_id?: string;
  branch_id?: string;
}

export interface SupervisorHandoverSummary {
  supervisorId: string;
  supervisorName: string;
  date: string;
  openingCash: number;
  ownCashSales: number;
  tillLiftsCollected: number;
  totalCashHandled: number;
  expensesPaidFromCash: number;
  grvPaymentsPaidFromCash: number;
  shopUsePaidFromCash: number;
  ownerDrawingsTaken: number;
  transfersToSafeOrBank: number;
  expectedHandoverCash: number;
  actualCountedCash?: number;
  variance?: number;
  status: 'Balanced' | 'Over' | 'Shortage';
}

// Monthly Fixed Costs & True Profit Proration Types
export type FixedCostCategory =
  | 'RENT'
  | 'SALARIES'
  | 'INTERNET'
  | 'LICENSES'
  | 'INSURANCE'
  | 'OTHER_FIXED'
  | string;

export interface FixedMonthlyCost {
  uuid: string; // primary key
  id?: string;
  shop_id: string; // company_id
  branch_id?: string;
  device_id: string;
  name: string;
  category: FixedCostCategory;
  monthly_amount: number;
  currency: 'USD' | 'ZiG';
  effective_from_date: string; // YYYY-MM or YYYY-MM-DD
  effective_to_date: string | null;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  synced_at?: string | null;
  sync_status: 'pending' | 'synced';
  version: number;
}

// Cash Custody Chain, Accounts Clerk & HQ Safe Types
export type CashAccountType = 'SAFE' | 'TILL' | 'CLERK_FLOAT' | 'IN_TRANSIT' | 'HQ_SAFE' | 'BANK_ACCOUNT';
export type CashAccountStatus = 'OPEN' | 'CLOSED' | 'FROZEN';

export interface CashAccount {
  account_id: string;             // e.g. "ACC-HQ-SAFE-01", "ACC-BR1-TILL-02"
  company_id: string;
  branch_id?: string;            // undefined or 'HQ' for company-wide safe
  account_type: CashAccountType;
  account_name: string;          // e.g. "Main Vault Safe", "Till #1 (Alice)"
  holder_user_id?: string;       // ID of staff currently in physical custody
  holder_user_name?: string;     // Denormalized for display
  current_balance: number;       // Base USD currency
  currency: string;              // 'USD'
  status: CashAccountStatus;
  last_reconciled_at?: string;
  created_at: string;
  updated_at: string;
  updatedAt?: number;
  lastUpdated?: string;
  hubTimestamp?: number;
  target_branch_id?: string;
}

export type CashTransferType =
  | 'FLOAT_ISSUE'           // Safe -> Till
  | 'TILL_COLLECTION'       // Till -> Safe (Cash lift / skimming / EOD handover)
  | 'BRANCH_TO_HQ'          // Branch Safe -> In Transit -> HQ Safe
  | 'HQ_TO_BRANCH'          // HQ Safe -> In Transit -> Branch Safe (Salaries / Operating cash)
  | 'SUPPLIER_PAYMENT'      // Safe / HQ Safe -> Supplier
  | 'BANK_DEPOSIT'          // Safe -> In Transit -> Bank Account
  | 'BANK_WITHDRAWAL'       // Bank Account -> In Transit -> Safe (Safe cash replenishment)
  | 'THIRD_PARTY_PAYOUT'    // Clerk Float -> In Transit -> Expense
  | 'CAPITAL_INFUSION';     // Owner / HQ Injection -> Branch Safe (Branch opening float)

export type CashTransferStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'      // Awaiting manager/owner approval
  | 'PENDING_ACCEPTANCE'    // Dispatched, awaiting receiver PIN
  | 'IN_TRANSIT'            // Physical money on the move
  | 'APPROVED'              // Approved and ready / settled
  | 'RECEIVED'              // Physically received into destination vault
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'RETURNED';             // Aborted trip returned to safe (e.g. supplier was closed)

export interface CashTransfer {
  transfer_id: string;            // e.g. "TRF-20261016-0042"
  company_id: string;
  branch_id: string;
  target_branch_id?: string;      // 'ALL' for company-wide / HQ / inter-branch transfers
  type: CashTransferType;
  from_account_id: string;
  to_account_id?: string;        // Optional for supplier or bank deposits
  amount: number;
  currency: string;
  status: CashTransferStatus;
  updatedAt?: number;
  lastUpdated?: string;
  hubTimestamp?: number;
  
  // Initiator
  created_by_user_id: string;
  created_by_user_name: string;
  created_at: string;
  
  // Dual-control signatures
  approved_by_user_id?: string;
  approved_by_user_name?: string;
  approved_at?: string;
  
  witnessed_by_user_id?: string;  // Secondary checker PIN
  witnessed_by_user_name?: string;
  witnessed_at?: string;
  
  received_by_user_id?: string;   // Cashier or Owner receiver PIN
  received_by_user_name?: string;
  received_at?: string;
  
  // Links & Metadata
  linked_grv_id?: string;         // If paying a supplier
  recipient_name?: string;        // e.g. "Gardener Joe"
  receipt_image_url?: string;     // Proof upload (bank deposit slip, receipt)
  bag_seal_number?: string;       // For branch-to-HQ transit
  notes?: string;

  // Bank details (for deposits and withdrawals)
  bank_name?: string;             // e.g. "CBZ Bank", "Stanbic Bank", "Ecobank", "CABS"
  bank_account_number?: string;
  
  // Aborted / Returned Transit handling
  returned_reason?: string;
  returned_at?: string;
  returned_by_user_id?: string;
  returned_by_user_name?: string;
  
  // Overage handling
  overage_amount?: number;
  
  // Governance
  is_owner_override: boolean;     // True if owner self-approved or bypassed clerk
  owner_override_reason?: string;
  
  // Linked Fiscal Ledger IDs
  linked_cash_log_ids?: string[]; // IDs of generated CashLog entries
}

export interface CashGovernanceConfig {
  governanceMode: 'LEAN' | 'STRICT'; // LEAN: small business / single operator bypass; STRICT: dual control
  defaultTillFloat: number;          // Default $20.00
  floatSourceAccountId: string;      // 'SAFE' | 'CLERK'
  autoAcceptTillFloat: boolean;      // In LEAN mode, auto-accepts without waiting for cashier PIN
  allowClerkCashierOverlap: boolean; // Allows accounts clerk to also operate sales till
  allowOverageLifts: boolean;        // Allows supervisor to lift cash even if exceeding book balance (for overs)
  requireWitnessForTransit: boolean; // Enforce secondary witness on transit dispatch
  defaultSupplierApprovalThreshold: number; // e.g. $50.00
  bankList: string[];                // Configured banks
  autoIssueOpeningFloatOnShiftStart?: boolean; // If false, operator/clerk must confirm float before issuance
}

export interface SaleSecurityMetadata {
  server_received_at?: string;
  suspicious_backdate?: boolean;
  isOfflineSync?: boolean;
}

