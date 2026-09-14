export type SaaSUserRole =
  | 'SUPER_ADMIN'
  | 'OWNER'
  | 'BRANCH_MANAGER'
  | 'SUPERVISOR'
  | 'CASHIER'
  | 'STOCK_CLERK';

export type Role =
  | SaaSUserRole
  | 'Cashier'
  | 'Manager'
  | 'Admin'
  | 'Staff'
  | 'super_admin';

export type ActiveStatus = 'Y' | 'N';

export interface StaffPermissions {
  canEditCartPrice: boolean;      // Admin / Staff permitted to edit line item unit prices in POS Counter
  canApplyCartDiscount: boolean;  // Permitted to apply cart or item discounts
  canDeleteCartItem: boolean;     // Permitted to delete items from cart
  canClearCart: boolean;          // Permitted to clear the active cart
  canAccessReports: boolean;      // Access Debtor / Audit reports
  canManageInventory: boolean;    // Add / Edit master inventory products
  canReceiveGRN: boolean;         // Process Goods Received & supplier entries
  canBreakCases: boolean;         // Manually break cases to singles
  canManageStaff: boolean;        // Access Staff management and grant/revoke access
  canManageExpenses: boolean;     // Record Cash Log expenses
  canPerformShiftEnd: boolean;    // Form 4 shift balancing & cash count
  canSellNegativeStock?: boolean; // Permitted to complete POS sales when stock is zero/insufficient
  canEditPriceCost?: boolean;     // Permitted to modify selling price or last cost in Inventory Master
  canSeeMargin?: boolean;         // Permitted to view profit margins & markup

  // Direct GRV Permissions
  canCreateDirectGrv?: boolean;   // Create Direct Supplier Deliveries
  canApproveDirectGrv?: boolean;  // Supervisor approval of Direct GRV

  // Customer Ledger Permissions
  canUseCustomerChange?: boolean; // Use Customer Change balance
  canIssueCustomerCredit?: boolean; // Issue Customer Credit

  // EOD Permissions
  canSubmitEOD?: boolean;         // Submit shift EOD
  canApproveEOD?: boolean;        // Supervisor approve EOD
  canViewVarianceInvestigation?: boolean; // View Variance Investigation

  // Audit & Security Permissions
  canViewAuditLog?: boolean;      // View Audit Log
  canPinOverride?: boolean;       // PIN Override authority

  // SaaS Governance Permissions
  canManageCompany?: boolean;     // Manage company profile & subscription
  canEditMasterPrice?: boolean;   // Edit master price catalog
}

export interface StaffBranchAssignment {
  branchId: string;
  branchName?: string;
  role: Role;
  isPrimary?: boolean;
  assignedAt?: string;
}

export interface Salesperson {
  id: string; // Sequential starting "001" or "USR-001"
  user_id?: string;
  name: string;
  pin: string; // 4 digits
  role: Role;
  phone?: string;
  active: ActiveStatus;
  permissions?: Partial<StaffPermissions>;
  branchId?: string | null;
  branch_id?: string | null;
  branchName?: string;
  companyId?: string | null;
  company_id?: string | null;
  email?: string;
  branchAssignments?: StaffBranchAssignment[]; // Explicit multi-branch roles e.g. Manager in Branch A, Cashier in Branch B
}

export interface Customer {
  customerId: string; // Sequential starting "C001"
  name: string;
  phone?: string;
  address?: string;
  createdDate: string;
  createdBy: string; // StaffID
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
}

export interface CashCountDenomination {
  note: number;
  qty: number;
  amount: number;
}

export interface CashCountRecord {
  id: string;
  timestamp: string;
  date: string;
  staffId: string;
  staffName: string;
  denominations: Record<string, number>; // "100": 2, "50": 4...
  finalCashOutTotal: number;
  notes?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  synced: boolean;
}

export interface CashLogEntry {
  id: string; // e.g. "CL-001"
  timestamp: string;
  date: string;
  staffId: string;
  staffName: string;
  line: string; // Category / Line
  description: string;
  in: number;
  out: number;
  category?: string;
  reference?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  synced: boolean;
}

export interface PackagingVariant {
  id: string; // e.g. "VAR-01", "PREPACK-5", "PACK-10"
  name: string; // e.g. "Prepack (5s)", "Pack of 10s", "Pack of 2s"
  unitsPerPack: number; // e.g. 5, 10, 2
  sellPrice: number; // e.g. 1.00, 0.50, 0.25
  costPrice?: number; // calculated cost per pack
  barcode?: string;
  sku?: string;
}

export interface Product {
  id: string; // e.g. "SUG001", "OIL002"
  name: string;
  sku: string;
  category: string;
  price: number;
  costPrice?: number;
  stockQuantity: number;
  unit?: string;
  description?: string;
  barcode?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  // Fractional / Weight / Factor selling (e.g. Meat, Gas, Dispensed bulk liquids)
  sellByFraction?: boolean; // When true, item is sold by weight / fractional factor (e.g. 300g or $4 beef)
  fractionUnit?: string; // Unit for fractional pricing e.g. 'kg', 'g', 'Litre', 'm'
  // Flexible Cases + Singles + Prepack Variants inventory bridge attributes
  canSellAsCase?: boolean; // Default false. If false, receiving cases converts to singles automatically
  unitsPerCase?: number;
  costPerCase?: number;
  sellPriceCase?: number;
  sellPriceUnit?: number;
  stockCases?: number;
  stockSingles?: number;
  totalUnits?: number;
  reorderLevelCases?: number;
  reorderLevelUnits?: number;
  packagingVariants?: PackagingVariant[];
  variantId?: string; // If this product entry represents a specific pack variant (e.g. Prepack 5s)
  unitsPerPack?: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
  customPrice?: number;
  discountAmount?: number;
  notes?: string;
  saleType?: 'Single' | 'Case' | 'Variant' | 'Fractional';
  variantId?: string;
  variantName?: string;
  unitsPerPack?: number;
  isFractional?: boolean;
  fractionUnit?: string;
  weightFactor?: number; // e.g. 0.300 kg or 1.250 kg
}

export interface SaleItem {
  id: string;
  name: string;
  sku?: string;
  category?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isFractional?: boolean;
  fractionUnit?: string;
  weightFactor?: number;
}

export type PaymentMethod = 'Cash' | 'Card' | 'Bank Transfer' | 'EcoCash/Mobile' | 'Credit';

export interface SaleInvoice {
  id: string; // e.g. "INV-001"
  timestamp: string;
  date: string;
  customerId: string;
  customerName: string;
  items: SaleItem[];
  itemsSummary: string;
  subtotal: number;
  discount: number;
  tax?: number;
  total: number;
  cashTendered?: number;
  changeDue?: number;
  changeLeftBehind?: boolean; // if customer leaves change with shop
  changeAmountLeftBehind?: number; // specific editable amount left behind with shop
  customerCreditUsed?: number; // amount of store credit / change fund applied towards sale
  creditDueDate?: string;
  creditDeposit?: number;
  creditBalanceOwed?: number;
  paymentMethod: PaymentMethod;
  staffId: string;
  staffName: string;
  status: 'Completed' | 'Refunded' | 'Pending' | 'Voided';
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  refundReason?: string;
  refundedAt?: string;
  refundApprovedBy?: string;
  refundApprovedById?: string;
  voidReason?: string;
  voidedAt?: string;
  voidApprovedBy?: string;
  voidApprovedById?: string;
  notes?: string;
  synced: boolean;
}

export interface CustomerChangeEntry {
  id: string; // e.g. "CHG-001"
  timestamp: string;
  date: string;
  staffId: string;
  staffName: string;
  customerId?: string;
  customerName: string;
  in: number;
  out: number;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  notes?: string;
  reference?: string;
  synced: boolean;
}

export interface CreditSaleEntry {
  id: string; // e.g. "CR-001"
  timestamp: string;
  date: string;
  staffId: string;
  staffName: string;
  customerId?: string;
  customerName: string;
  amount: number;
  in?: number;
  out?: number;
  itemDescription: string;
  dueDate?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  notes?: string;
  status: 'Pending' | 'Paid' | 'Partial';
  synced: boolean;
}

export interface ExpenseEntry {
  id: string; // e.g. "EXP-001"
  timestamp: string;
  date: string;
  category: string;
  vendorOrCustomer?: string;
  customerId?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  staffId: string;
  staffName: string;
  description: string;
  receiptRef?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  synced: boolean;
}

export interface AdminSalesEntry {
  id: string; // e.g. "AS-2026-08-16-001"
  date: string;
  staffId: string;
  staffName: string;
  salesAmount: number;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  notes?: string;
  timestamp: string;
  synced?: boolean;
}

export interface ShiftReconciliation {
  id: string;
  date: string;
  staffId: string;
  staffName: string;
  openingFloat: number;
  cashSales: number;
  otherCashIn: number;
  cashExpenses: number;
  bankDrops: number;
  expectedCash: number;
  actualCashCount: number;
  variance: number;
  status: 'Balanced' | 'Over' | 'Shortage';
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  notes: string;
  timestamp: string;
  synced: boolean;
}

export type SheetName =
  | 'Customers'
  | 'Suppliers'
  | 'CashLog'
  | 'Sales'
  | 'Expenses'
  | 'Reconciliations'
  | 'Salespeople'
  | 'CustomerChange'
  | 'CreditSales'
  | 'Products'
  | 'companies'
  | 'branches'
  | 'users'
  | 'Direct_GRV'
  | 'Audit_Log'
  | 'StockMovement'
  | 'GoodsReceived';

export interface SyncQueueItem {
  id: string;
  sheetName: SheetName;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, any>;
  timestamp: number;
  retries: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface TenantSheetConfig {
  companyId: string;
  companyName: string;
  spreadsheetId: string;
  webhookUrl?: string;
  branchIsolationMode: 'ROW_LEVEL' | 'BRANCH_TABS' | 'HYBRID';
  lastSyncTimestamp?: string;
}

export interface GoogleSheetsConfig {
  webhookUrl: string;
  masterWebhookUrl?: string;
  spreadsheetId: string;
  masterSpreadsheetId?: string;
  branchIsolationMode?: 'ROW_LEVEL' | 'BRANCH_TABS' | 'HYBRID';
  tenantConfigs?: Record<string, TenantSheetConfig>;
  sheetNameMap: Record<SheetName, string>;
  autoSync: boolean;
  lastSyncTimestamp?: string;
  simulateSyncLatency: boolean;
}

export interface CustomerChangeReportItem {
  customerId: string;
  customerName: string;
  phone?: string;
  address?: string;
  totalIn: number; // Total change customer left with business
  totalOut: number; // Total change returned to customer
  netChangeOwed: number; // totalIn - totalOut (> 0 means we owe customer)
  firstInDate?: string; // Earliest date change was left
  latestInDate?: string; // Most recent date change was left
  daysSinceFirstIn: number; // Days elapsed since customer first left change
  daysSinceLatestIn: number; // Days elapsed since most recent change left
  unsettledInAmount: number; // Active unclaimed change
  transactionsCount: number;
  transactions: CustomerChangeEntry[];
  status: 'Owed' | 'Cleared' | 'Overpaid';
}

export interface CustomerCreditReportItem {
  customerId: string;
  customerName: string;
  phone?: string;
  address?: string;
  totalCreditIn: number; // Total goods taken on credit (in)
  totalRepaidOut: number; // Total debt repayments (out)
  netDebtOwed: number; // totalCreditIn - totalRepaidOut (> 0 means customer owes us)
  firstCreditDate?: string; // Earliest date customer collected credit
  latestCreditDate?: string; // Most recent date credit was taken
  daysOwing: number; // Days elapsed since credit was collected
  dueDate?: string;
  isOverdue: boolean;
  itemDescriptions: string[];
  transactionsCount: number;
  transactions: CreditSaleEntry[];
  status: 'Owing' | 'Settled' | 'Overpaid';
}

export interface ParkedSale {
  id: string;
  timestamp: string;
  customerName?: string;
  customerId?: string;
  items: CartItem[];
  subtotal: number;
  total: number;
  notes?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
}

// ----------------------------------------------------
// SAIMETRIC FLEXIBLE CASES + SINGLES INVENTORY TYPES
// ----------------------------------------------------

export interface InventoryItem {
  itemId: string; // e.g. "SUG001", "OIL002", "PRD-101"
  itemName: string;
  category: string;
  sellByFraction?: boolean; // When true, sold by weight or fraction factor (e.g. Meat/Gas)
  fractionUnit?: string; // Unit for fractional pricing e.g. 'kg', 'g', 'Litre', 'm'
  canSellAsCase?: boolean; // Default false. When false, cases received are auto-converted to singles
  unitsPerCase: number; // N (e.g. 24)
  costPerCase: number; // e.g. 24.00
  costPerUnit: number; // calculated: costPerCase / unitsPerCase -> 1.00
  sellPriceCase: number; // e.g. 30.00
  sellPriceUnit: number; // e.g. 1.50
  stockCases: number; // Cases in stock (e.g. 10)
  stockSingles: number; // Singles in stock (e.g. 5)
  totalUnits: number; // calculated: (stockCases * unitsPerCase) + stockSingles
  reorderLevelCases: number; // e.g. 2
  reorderLevelUnits: number; // e.g. 10
  sku?: string;
  barcode?: string;
  description?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  lastUpdated?: string;
  packagingVariants?: PackagingVariant[]; // Custom pack sizes e.g. Prepack 5s, 10s, 2s
}

export interface Supplier {
  supplierId: string; // e.g. "SUP-001"
  name: string; // e.g. "National Foods Wholesalers"
  category: string; // e.g. "Groceries", "Beverages", "Dairy"
  categories?: string[]; // Multiple categories supplied from Inventory Master
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  paymentTerms?: string; // e.g. "30-Day Account Credit", "Cash on Delivery"
  taxNumber?: string; // e.g. "VAT-100293"
  accountNumber?: string; // e.g. "ACC-99214"
  status: 'Active' | 'Inactive';
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  createdDate: string;
  notes?: string;
}

export interface Branch {
  branchId: string; // e.g. "BR-MAIN"
  name: string; // e.g. "Main Branch & Central Warehouse"
  code: string; // e.g. "HQ-01"
  location: string;
  isMain?: boolean;
  id?: string;
  company_id?: string;
  companyId?: string;
  address?: string;
  sheet_id?: string;
  manager_id?: string;
  manager_name?: string;
  is_active?: boolean;
}

export interface GoodsReceivedEntry {
  grnId: string; // e.g. "GRN-20260817-001"
  invoiceNo?: string; // e.g. "INV-99023"
  purchaseOrderNo?: string; // e.g. "PO-2026-004"
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  branchName?: string;
  date: string; // e.g. "2026-08-17"
  supplier: string; // e.g. "TM Pick n Pay", "Delta Beverages"
  itemId: string;
  itemName: string;
  receivedCases: number;
  receivedSingles: number;
  receivedPacks?: number; // Quantity of specific variant/prepack received
  receiveAs?: 'Cases' | 'Singles' | 'Variant';
  receiveVariantId?: string; // ID of the variant e.g. "VAR-PREPACK-5"
  receiveVariantName?: string; // Name of variant e.g. "Prepack (5s)"
  unitsPerReceivePack?: number; // Base units per pack received
  costPerCase?: number;
  costPerUnit?: number;
  lastCost?: number;
  sellingPrice?: number;
  marginPercent?: number;
  lineTotal?: number;
  autoBreakCaseToSingles: boolean; // Rule A applied: true if 1 case broken because StockSingles was 0
  convertedCasesToSingles?: boolean; // True if canSellAsCase was false and all cases were converted to singles
  notes?: string;
  staffId: string;
  staffName?: string;
  timestamp: string;
  synced?: boolean;
}

export interface SupplierInvoiceLineItem {
  itemId: string;
  itemName: string;
  category?: string;
  unitsPerCase: number;
  receiveAs?: 'Cases' | 'Singles' | 'Variant';
  receiveVariantId?: string;
  receiveVariantName?: string;
  unitsPerReceivePack?: number;
  receivedCases: number;
  receivedSingles: number;
  receivedPacks?: number;
  lastCost?: number;
  costPerCase: number;
  costPerUnit: number;
  costPerPack?: number;
  sellingPrice?: number;
  marginPercent?: number;
  lineTotal: number;
  autoBrokenRuleA: boolean;
  convertedCasesToSingles?: boolean;
  prevStockCases: number;
  prevStockSingles: number;
  newStockCases: number;
  newStockSingles: number;
}

export interface SupplierInvoiceVoucher {
  voucherId: string; // e.g. "GRN-20260826-001"
  invoiceNo: string; // e.g. "INV-88219"
  purchaseOrderNo?: string; // e.g. "PO-2026-004"
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  branchName?: string;
  supplier: string;
  date: string;
  paymentTerms?: string;
  staffId: string;
  staffName: string;
  notes?: string;
  items: SupplierInvoiceLineItem[];
  totalCases: number;
  totalSingles: number;
  totalUnits: number;
  totalInvoiceAmount: number;
  ruleATriggeredCount: number;
  timestamp: string;
  synced?: boolean;
}

export type StockTxnType =
  | 'RECEIVE'
  | 'SALE'
  | 'BREAK_CASE'
  | 'ADJUSTMENT'
  | 'RETURN'
  | 'DAMAGE_LOSS'
  | 'GOODS_RECEIVED'
  | 'PRICE_CHANGE'
  | 'COST_CHANGE';

export interface StockMovementEntry {
  txnId: string; // e.g. "TXN-20260817-001"
  movementId?: string; // alias
  date: string;
  staffId: string;
  staffName?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  itemId: string;
  itemName: string;
  txnType: StockTxnType;
  movementType?: StockTxnType; // alias for display
  qtyCases: number;
  qtySingles: number;
  casesChange?: number; // alias
  singlesChange?: number; // alias
  promptShown?: string; // e.g. "Break 1 Case to 24 Singles?" or "Sell as 1 Case instead? It's cheaper."
  actionTaken?: string; // e.g. "AUTO_BREAK", "CASE_BROKEN", "CONVERTED_TO_CASE", "SOLD_AS_SINGLES"
  closingCases: number;
  closingSingles: number;
  resultingStockCases?: number; // alias
  resultingStockSingles?: number; // alias
  referenceId?: string; // e.g. "INV-001", "GRN-001"
  triggerRule?: string;
  reason?: string;
  timestamp: string;
  synced?: boolean;
  // Audit Trail & Fraud Detection fields
  oldValue?: number;
  newValue?: number;
  percentChange?: number;
  fieldChanged?: 'PRICE' | 'COST';
  userRole?: string;
  batchId?: string;
  isNegativeSale?: boolean;
}

export interface StockBatch {
  id: string; // e.g. "BAT-20260901-001"
  batchNumber?: string;
  itemId: string; // Product Code
  itemName: string;
  qtyReceived: number;
  qtyOnHand: number; // Individual batch qty can NEVER be negative (>= 0)
  cost: number;
  costPerUnit: number;
  costPerCase?: number;
  expiryDate?: string; // YYYY-MM-DD
  receivedDate: string; // YYYY-MM-DD
  supplier?: string;
  grnId?: string;
  invoiceNo?: string;
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
  notes?: string;
  createdAt: string;
}

export interface NegativeBalanceEntry {
  id: string; // e.g. "NEG-20260901-001"
  itemId: string; // Product Code
  itemName: string;
  negativeQty: number; // Total units sold negative
  clearedQty: number; // Total units cleared by subsequent GRN
  saleCost: number; // Cost at time of negative sale (Old Cost)
  salePrice?: number;
  saleDate: string; // YYYY-MM-DD
  timestamp: string;
  saleInvoiceId?: string;
  soldBy: string; // Staff ID
  soldByName?: string;
  status: 'OPEN' | 'CLEARED';
  clearedAt?: string;
  clearingGrnId?: string;
  newCostAtClearing?: number; // New cost per unit from clearing GRN
  potentialLoss?: number; // (newCost - saleCost) * clearedQty if newCost > saleCost
  companyId?: string;
  company_id?: string;
  branchId?: string;
  branch_id?: string;
}

export interface InventoryCategory {
  categoryId: string;
  categoryName: string;
  description?: string;
  itemCount?: number;
}

export interface StockPromptResponse {
  promptRequired: boolean;
  promptType?: 'BREAK_CASE' | 'BULK_DISCOUNT';
  message?: string;
  itemId: string;
  itemName: string;
  unitsPerCase: number;
  currentStockCases: number;
  currentStockSingles: number;
  suggestedCases?: number;
  remainderSingles?: number;
  potentialSavings?: number;
}

export type ActiveTab =
  | 'home'
  | 'items'
  | 'counter'
  | 'today'
  | 'reports'
  | 'more'
  | 'pos'
  | 'orders'
  | 'dashboard'
  | 'cash_balancing'
  | 'cash_count'
  | 'cash_log'
  | 'sales'
  | 'customers'
  | 'suppliers'
  | 'reconciliation'
  | 'sheets'
  | 'salespeople'
  | 'staff_access'
  | 'change_report'
  | 'credit_report'
  | 'inventory'
  | 'goods_received'
  | 'stock_movement'
  | 'inventory_setup'
  | 'grn_daily_report'
  | 'data_management'
  | 'stocktake'
  | 'fifo_reports'
  | 'price_fraud_report'
  | 'sales_report'
  | 'audit_log'
  | 'report_builder'
  | 'custom_reports'
  | 'p2p_mesh'
  | 'connectivity'
  | 'branch_setup'
  | 'super_admin';

export interface P2PMeshConfig {
  branchCode: string; // Only setting 1
  deviceName: string; // Only setting 2
  deviceId: string;
}

export interface P2PMeshPeer {
  id: string;
  name: string;
  isOnline: boolean;
  hasInternet: boolean;
  lastSeen: number;
  pendingCount: number;
  totalSalesCount: number;
  isThisDevice?: boolean;
  ip?: string;
  branchCode?: string;
  deviceType?: string;
}

export interface P2PPacket {
  packet_id: string;
  action: 'RECORD_UPSERT' | 'SYNCED_ACK' | 'HISTORY_REQUEST' | 'HISTORY_RESPONSE';
  origin_device_id: string;
  ttl: number;
  table?: string;
  data?: any;
  synced_uuids?: string[];
  sales?: any[];
}

// ============================================================================
// STOCKTAKE & DOUBLE-COUNT MODULE TYPES
// ============================================================================

export type StocktakeStatus =
  | 'DRAFT'
  | 'COUNTING'
  | 'RECOUNTING'
  | 'CONSOLIDATED'
  | 'AUDIT_REVIEW'
  | 'APPROVED_POSTED'
  | 'CANCELLED';

export type SegmentStatus =
  | 'PENDING'
  | 'COUNTING'
  | 'DISCREPANCY_RECOUNT'
  | 'VERIFIED';

export interface StocktakeLineCount {
  itemId: string;
  itemName: string;
  category: string;
  sku: string;
  barcode?: string;
  unitsPerCase: number;
  cases: number;
  singles: number;
  totalUnits: number; // (cases * unitsPerCase) + singles
  countedBy?: string;
  countedByName?: string;
  timestamp?: string;
}

export interface StocktakeVerifiedLine {
  itemId: string;
  itemName: string;
  category: string;
  sku: string;
  unitsPerCase: number;
  cases: number;
  singles: number;
  totalUnits: number;
  source: 'MATCHED' | 'RESOLVED_RECOUNT' | 'MANUAL_SUPERVISOR';
  resolvedBy?: string;
  count1TotalUnits: number;
  count2TotalUnits: number;
}

export interface StocktakeSegment {
  segmentId: string; // e.g. "SEG-001"
  name: string; // e.g. "Aisle 1 - Beverages & Coolers"
  description?: string;
  locationCode?: string; // e.g. "A1-COOLER"
  status: SegmentStatus;
  counterAId?: string;
  counterAName?: string;
  counterATimestamp?: string;
  counterBId?: string;
  counterBName?: string;
  counterBTimestamp?: string;
  recounterId?: string;
  recounterName?: string;
  recountedAt?: string;
  count1: StocktakeLineCount[];
  count2: StocktakeLineCount[];
  recount?: StocktakeLineCount[];
  verifiedCounts: StocktakeVerifiedLine[];
  discrepancyCount: number;
}

export interface StocktakeConsolidatedItem {
  itemId: string;
  itemName: string;
  category: string;
  sku: string;
  barcode?: string;
  unitsPerCase: number;
  costPerUnit: number;
  costPerCase: number;
  sellPriceUnit: number;
  sellPriceCase: number;
  // System SOH (Stock on Hand) at time of stocktake:
  systemCases: number;
  systemSingles: number;
  systemTotalUnits: number;
  systemCostValue: number;
  systemRetailValue: number;
  // Consolidated physical count (sum across all segments):
  countedCases: number;
  countedSingles: number;
  countedTotalUnits: number;
  countedCostValue: number;
  countedRetailValue: number;
  // Variances:
  varianceCases: number; // countedCases - systemCases
  varianceSingles: number; // countedSingles - systemSingles
  varianceTotalUnits: number; // countedTotalUnits - systemTotalUnits
  varianceCostValue: number; // varianceTotalUnits * costPerUnit
  varianceRetailValue: number; // varianceTotalUnits * sellPriceUnit
  status: 'MATCH' | 'SHORTAGE' | 'OVERAGE' | 'RECOUNT_FLAGGED';
  segmentBreakdown: {
    segmentId: string;
    segmentName: string;
    cases: number;
    singles: number;
    totalUnits: number;
  }[];
  recountNotes?: string;
  recountRequested?: boolean;
  recountCases?: number;
  recountSingles?: number;
  recountTotalUnits?: number;
  recountedBy?: string;
  recountedAt?: string;
}

export interface StocktakeSession {
  sessionId: string; // e.g. "STK-20260828-001"
  title: string;
  date: string;
  status: StocktakeStatus;
  branchId?: string;
  branchName?: string;
  createdBy: string;
  createdByName: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
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
}

// ============================================================================
// AUDIT LOG & COMPLIANCE LEDGER TYPES
// ============================================================================

export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'SESSION_TIMEOUT'
  | 'DISCOUNT_APPLIED'
  | 'DISCOUNT_OVERRIDE'
  | 'VOID_CART'
  | 'VOID_ITEM'
  | 'VOID_INVOICE'
  | 'REFUND_INVOICE'
  | 'PRICE_CHANGE'
  | 'PERMISSIONS_CHANGE'
  | 'STAFF_ADDED'
  | 'STAFF_MODIFIED'
  | 'INVENTORY_ADJUSTMENT'
  | 'CASH_COUNT'
  | 'RECONCILIATION'
  | 'DIRECT_GRV_CREATE'
  | 'DIRECT_GRV_APPROVE'
  | 'DIRECT_GRV_REJECT'
  | 'EOD_APPROVE'
  | 'STAFF_ROLE_CHANGE'
  | 'BRANCH_CREATE'
  | 'BRANCH_UPDATE'
  | 'BRANCH_DELETE'
  | 'SYSTEM_SETTINGS_UPDATE'
  | 'PIN_OVERRIDE';

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'SECURITY';

export interface AuditLogEntry {
  id: string; // e.g. "AUD-20260903-001"
  timestamp: string; // ISO string
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  action: AuditAction;
  severity: AuditSeverity;
  staffId: string;
  staffName: string;
  staffRole: Role;
  company_id?: string;
  companyId?: string;
  branch_id?: string;
  branchId?: string;
  user_id?: string;
  authorizedById?: string;
  authorizedByName?: string;
  authorizedByRole?: Role;
  details: string;
  referenceId?: string; // e.g. Invoice ID, Item ID, etc.
  amount?: number;
  metadata?: Record<string, any>;
}

// ============================================================================
// NO-CODE UNIVERSAL REPORT BUILDER & PERMISSIONS TYPES
// ============================================================================

export type DataDictionaryType = 'string' | 'number' | 'date' | 'boolean';

export interface DataDictionaryItem {
  id: string;
  table_name: string;
  column_name: string;
  display_name: string;
  data_type: DataDictionaryType;
  is_filterable: boolean;
  is_groupable: boolean;
}

export interface TableRelationship {
  id: string;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  relationship_name: string;
}

export type RoleId = 'super_admin' | 'manager' | 'cashier' | 'accountant';

export interface UserRole {
  id: RoleId;
  role_name: string;
  description?: string;
}

export interface ReportPermission {
  id: string;
  report_id: string;
  role_id: RoleId;
  can_view: boolean;
  can_edit: boolean;
  can_export: boolean;
}

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'between';

export interface ReportFilter {
  id: string;
  column: string; // e.g. "sales.date" or "products.category"
  op: FilterOperator;
  value?: any;
  value2?: any;
}

export interface ReportSort {
  column: string;
  direction: 'ASC' | 'DESC';
}

export type AggregateFunc = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';

export interface ReportAggregate {
  column: string; // e.g. "sales.total_amount"
  func: AggregateFunc;
  alias?: string;
}

export interface ReportJoin {
  from: string; // e.g. "sales.product_id"
  to: string;   // e.g. "products.id"
  type?: 'INNER' | 'LEFT';
}

export interface ReportJsonConfig {
  name: string;
  description?: string;
  tables: string[];
  joins: ReportJoin[];
  columns: string[]; // e.g. ["suppliers.name", "SUM(sales.total_amount)", "COUNT(sales.id)"] or ["products.name", "products.category"]
  group_by?: string[];
  aggregates?: ReportAggregate[];
  filters: ReportFilter[];
  sort_by?: ReportSort[];
  limit?: number;
  chart_type?: 'table' | 'bar' | 'pie' | 'line';
  chart_x_axis?: string;
  chart_y_axis?: string;
}

export interface SavedReportTemplate {
  id: string;
  name: string;
  description: string;
  json_config: ReportJsonConfig;
  created_by: string;
  created_at: string;
  updated_at?: string;
}

export interface ReportExecutionResult {
  headers: Array<{ key: string; label: string; type: DataDictionaryType }>;
  rows: Array<Record<string, any>>;
  totalRows: number;
  executionTimeMs: number;
  sqlQuery: string;
  params: any[];
  isSampled?: boolean;
  warning?: string;
}

// ----------------------------------------------------
// DIRECT SUPPLIER DELIVERIES & MULTI-TENANT SAAS TYPES
// ----------------------------------------------------

export type GrvType = 'STANDARD' | 'DIRECT';
export type GrvStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export interface DirectGrvTillPayment {
  userId: string;
  userName: string;
  amount: number;
  pinConfirmed: boolean;
  confirmedAt?: string;
}

export interface DirectGrvItem {
  productId: string;
  productName: string;
  quantity: number;
  costPrice: number;
  sellingPrice?: number; // Read-only for Cashier
  lineTotal: number; // Qty * Cost Price
  markupPercent?: number;
  profit?: number;
  unitsPerCase?: number;
  unit?: string;
  sku?: string;
}

export interface DirectGrv {
  id: string; // e.g. "DGRV-20260906-001"
  grvNumber: string;
  type: GrvType;
  status: GrvStatus;
  companyId?: string;
  company_id?: string;
  branchId: string;
  branch_id?: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  invoiceNo?: string;
  purchaseOrderNo?: string;
  date: string;
  items: DirectGrvItem[];
  totalCost: number;
  totalSellingPrice?: number;
  payFromTill: boolean;
  payments: DirectGrvTillPayment[];
  notes?: string;
  receivedByStaffId: string;
  receivedByStaffName: string;
  approvedByStaffId?: string;
  approvedByStaffName?: string;
  approvedAt?: string;
  rejectedReason?: string;
  tillPayoutId?: string;
  createdAt: string;
  synced?: boolean;
}




