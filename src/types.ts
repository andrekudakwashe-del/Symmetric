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
export type CompanyBranchSharingSettings = any;
export type CreditPolicyMode = any;
export type CreditSaleEntry = any;
export type CurrencyRateConfig = any;
export type Customer = any;
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
export type Salesperson = any;
export type SavedReportTemplate = any;
export type SheetName = any;
export type ShiftReconciliation = any;
export type StaffBranchAssignment = any;
export type StaffPermissions = any;
export type StockBatch = any;
export type StockMovementEntry = any;
export type StockPromptResponse = any;
export type StockTxnType = any;
export type StocktakeConsolidatedItem = any;
export type StocktakeCountType = any;
export type StocktakeLineCount = any;
export type StocktakeSegment = any;
export type StocktakeSession = any;
export type StocktakeVerifiedLine = any;
export type StoreCreditPolicy = any;
export type Supplier = any;
export type SupplierInvoiceLineItem = any;
export type SupplierInvoiceVoucher = any;
export type SyncQueueItem = any;
export type TableRelationship = any;
export type TemporaryCasualAccount = any;
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


