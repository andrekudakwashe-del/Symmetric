/**
 * ============================================================================
 * SAIMETRIC SaaS V5.1 - Master Multi-Tenant Google Apps Script Router
 * Deployment Mode: Web App (Access: Anyone, Execute as: Me)
 *
 * FULL 25-TABLE ENTERPRISE ARCHITECTURE:
 * 1. Sales & Revenue: Sales, CreditSales, CashLog, CustomerChange
 * 2. Inventory & Logistics: InventoryMaster, GoodsReceived, GoodsReceivedItems,
 *    DirectGRVs, SupplierInvoices, StockMovements, StockBatches, StocktakeSessions
 * 3. Procurement & Trips: TripManifests, FixedCosts, Wallets, WalletTransfers
 * 4. Cash Drawer Auditing: CashLifts, CashCounts, Expenses, Reconciliations
 * 5. Entities & Master Data: Customers, Suppliers, Staff, Branches, AuditLog
 * ============================================================================
 */

var MASTER_COMPANY_ID = "COMP-001";
var MASTER_COMPANY_NAME = "SAIMETRIC Retail Systems";
var DEFAULT_ISOLATION_MODE = "ROW_LEVEL";

var TAB_SALES = "Sales";
var TAB_INVENTORY = "InventoryMaster";
var TAB_GOODS_RECEIVED = "GoodsReceived";
var TAB_GOODS_RECEIVED_ITEMS = "GoodsReceivedItems";
var TAB_SUPPLIER_INVOICES = "SupplierInvoices";
var TAB_DIRECT_GRVS = "DirectGRVs";
var TAB_STOCK_MOVEMENTS = "StockMovements";
var TAB_STOCK_BATCHES = "StockBatches";
var TAB_STOCKTAKE_SESSIONS = "StocktakeSessions";
var TAB_TRIP_MANIFESTS = "TripManifests";
var TAB_WALLETS = "Wallets";
var TAB_WALLET_TRANSFERS = "WalletTransfers";
var TAB_FIXED_COSTS = "FixedCosts";
var TAB_CASH_LIFTS = "CashLifts";
var TAB_CASH_COUNTS = "CashCounts";
var TAB_CUSTOMERS = "Customers";
var TAB_SUPPLIERS = "Suppliers";
var TAB_STAFF = "Staff";
var TAB_BRANCHES = "Branches";
var TAB_CASH_LOG = "CashLog";
var TAB_CUSTOMER_CHANGE = "CustomerChange";
var TAB_CREDIT_SALES = "CreditSales";
var TAB_EXPENSES = "Expenses";
var TAB_RECONCILIATIONS = "Reconciliations";
var TAB_AUDIT_LOG = "AuditLog";

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(25000);
  
  if (!hasLock) {
    return jsonResponse({
      status: "error",
      code: 429,
      error: "SERVER_BUSY",
      message: "Server busy acquiring write lock. Please retry."
    });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: "error", code: 400, message: "Empty POST body" });
    }

    var payload = JSON.parse(e.postData.contents);
    var action = String(payload.action || "INSERT").trim();
    var sheetBaseName = payload.sheet || "Sales";
    var companyId = payload.company_id || (payload.data && payload.data.company_id) || MASTER_COMPANY_ID;
    var companyName = payload.company_name || MASTER_COMPANY_NAME;
    var branchId = payload.branch_id || (payload.data && payload.data.branch_id) || "BR-MAIN";
    var branchName = payload.branch_name || (payload.data && payload.data.branch_name) || branchId;
    var userBranchId = payload.user_branch_id || branchId;
    var userRole = String(payload.user_role || "CASHIER").toUpperCase();
    var userId = payload.user_id || "USR-UNKNOWN";
    var rowData = payload.data || {};
    var explicitSheetId = payload.tenant_sheet_id || payload.sheet_id || (payload.data && (payload.data.tenant_sheet_id || payload.data.sheet_id));

    // Resolve Spreadsheet Target (Active bound sheet first, then openById)
    var ss = null;
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (actErr) {}

    if ((!ss || (explicitSheetId && ss.getId() !== explicitSheetId)) && explicitSheetId && explicitSheetId.length > 10) {
      try {
        ss = SpreadsheetApp.openById(explicitSheetId);
      } catch (openErr) {
        if (!ss) {
          lock.releaseLock();
          return jsonResponse({
            status: "error",
            code: 404,
            error: "CANNOT_OPEN_SHEET",
            message: "Cannot open target sheet: " + openErr.toString() + ". Please ensure sheet is shared with edit access."
          });
        }
      }
    }

    if (!ss) {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }

    // 1. ACTION: INITIALIZE ALL 25 BUSINESS TABS
    if (
      action === "initialize_tenant_sheet" ||
      action === "init_tenant_sheet" ||
      action === "setup_tenant_tabs" ||
      action === "setup_sheets" ||
      action === "init_tabs" ||
      action === "initialize_tabs" ||
      action === "setup_tabs" ||
      action === "initializeTabs" ||
      action === "initTabs"
    ) {
      var initialProducts = payload.initial_products || (payload.data && payload.data.initial_products) || [];
      var initResult = setupTenantSpreadsheetTabs(ss, companyId, companyName, initialProducts);
      lock.releaseLock();
      return jsonResponse({
        status: "success",
        success: true,
        code: 200,
        message: initResult.message,
        tabs: initResult.tabs,
        totalTabs: initResult.tabs.length,
        sheet_id: ss.getId(),
        sheet_name: ss.getName()
      });
    }

    // 2. ACTION: GET INVENTORY / PRODUCTS
    if (action === "get_inventory" || action === "get_products") {
      var invResult = handleGetInventory(ss, companyId);
      lock.releaseLock();
      return jsonResponse({
        status: "success",
        success: true,
        code: 200,
        items: invResult.items,
        count: invResult.items.length
      });
    }

    // 3. ACTION: SYNC INVENTORY / UPSERT PRODUCT
    if (action === "sync_inventory" || action === "upsert_product") {
      var syncResult = handleSyncInventory(ss, payload, companyId, branchId);
      lock.releaseLock();
      return jsonResponse({
        status: "success",
        success: true,
        code: 200,
        count: syncResult.count,
        items: syncResult.items
      });
    }

    // 4. ACTION: ADD SALE / INVOICE
    if (action === "add_sale" || action === "sale" || action === "SALE_RECORD" || (action === "INSERT" && (sheetBaseName === "Sales" || sheetBaseName === TAB_SALES))) {
      var saleResult = handleAddSale(ss, payload, companyId, branchId, branchName, userRole);
      lock.releaseLock();
      return jsonResponse(saleResult);
    }

    // 5. ACTION: ADD SUPPLIER INVOICE
    if (action === "add_supplier_invoice" || (action === "INSERT" && sheetBaseName === TAB_SUPPLIER_INVOICES)) {
      var invResult = handleAddSupplierInvoice(ss, payload, companyId, branchId);
      lock.releaseLock();
      return jsonResponse(invResult);
    }

    // 6. ACTION: ADD GOODS RECEIVED (GRN VOUCHER & ITEMS)
    if (action === "add_goods_received" || action === "goods_received" || (action === "INSERT" && sheetBaseName === TAB_GOODS_RECEIVED)) {
      var grnResult = handleAddGoodsReceived(ss, payload, companyId, branchId);
      lock.releaseLock();
      return jsonResponse(grnResult);
    }

    // 7. ACTION: ADD DIRECT GRV
    if (action === "add_direct_grv" || (action === "INSERT" && sheetBaseName === TAB_DIRECT_GRVS)) {
      var dGrvResult = handleAddDirectGRV(ss, payload, companyId, branchId);
      lock.releaseLock();
      return jsonResponse(dGrvResult);
    }

    // 8. ACTION: ADD STOCK MOVEMENT
    if (action === "add_stock_movement" || (action === "INSERT" && sheetBaseName === TAB_STOCK_MOVEMENTS)) {
      var smResult = handleAddStockMovement(ss, payload, companyId, branchId);
      lock.releaseLock();
      return jsonResponse(smResult);
    }

    // 9. ACTION: ADD WALLET TRANSFER
    if (action === "add_wallet_transfer" || (action === "INSERT" && sheetBaseName === TAB_WALLET_TRANSFERS)) {
      var wtResult = handleAddWalletTransfer(ss, payload, companyId, branchId);
      lock.releaseLock();
      return jsonResponse(wtResult);
    }

    // 10. ACTION: BATCH SYNC WRITES
    if (action === "batch_sync_writes" || action === "batch_sync") {
      var batchItems = Array.isArray(payload.items) ? payload.items : [];
      var batchWritten = 0;
      for (var b = 0; b < batchItems.length; b++) {
        var bItem = batchItems[b];
        if (!bItem) continue;
        var bSheet = bItem.sheetName || bItem.sheet || sheetBaseName;
        appendRecordToSheet(ss, bSheet, bItem.payload || bItem.data || bItem, companyId, branchId, branchName, userId, userRole);
        batchWritten++;
      }
      lock.releaseLock();
      return jsonResponse({
        status: "success",
        success: true,
        code: 200,
        batchCount: batchWritten,
        timestamp: new Date().toISOString()
      });
    }

    // 11. GENERIC ROW APPEND FALLBACK
    var appendResult = appendRecordToSheet(ss, sheetBaseName, rowData, companyId, branchId, branchName, userId, userRole);
    lock.releaseLock();
    return jsonResponse(appendResult);

  } catch (error) {
    lock.releaseLock();
    return jsonResponse({
      status: "error",
      success: false,
      code: 500,
      message: error.toString()
    });
  }
}

function doGet(e) {
  var params = e ? e.parameter : {};
  var action = params.action || "ping";
  var compId = params.company_id || MASTER_COMPANY_ID;

  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {}

  if (action === "ping") {
    return jsonResponse({
      status: "active",
      success: true,
      version: "5.1.0",
      tenant: compId,
      company: MASTER_COMPANY_NAME,
      isolationMode: DEFAULT_ISOLATION_MODE,
      sheet_name: ss ? ss.getName() : "Unknown",
      totalTabs: ss ? ss.getSheets().length : 0,
      service: "SAIMETRIC Dedicated Tenant Sheets Service (25 Tables Enabled)"
    });
  }

  if (action === "get_inventory" || action === "get_products") {
    if (ss) {
      var invResult = handleGetInventory(ss, compId);
      return jsonResponse({
        status: "success",
        success: true,
        items: invResult.items,
        count: invResult.items.length
      });
    }
  }

  if (
    action === "setup_sheets" ||
    action === "initialize_tenant_sheet" ||
    action === "init_tabs" ||
    action === "initialize_tabs" ||
    action === "setup_tabs" ||
    action === "setup_tenant_tabs" ||
    action === "initTabs" ||
    action === "initializeTabs"
  ) {
    if (!ss && (params.sheet_id || params.tenant_sheet_id)) {
      try {
        ss = SpreadsheetApp.openById(params.sheet_id || params.tenant_sheet_id);
      } catch (e) {}
    }
    if (!ss) {
      try {
        ss = SpreadsheetApp.getActiveSpreadsheet();
      } catch (e) {}
    }
    if (ss) {
      var init = setupTenantSpreadsheetTabs(ss, compId, MASTER_COMPANY_NAME, []);
      return jsonResponse({
        status: "success",
        success: true,
        message: init.message,
        tabs: init.tabs,
        totalTabs: init.tabs.length,
        sheet_id: ss.getId(),
        sheet_name: ss.getName()
      });
    }
  }

  if (action === "get_table_counts") {
    if (ss) {
      var counts = {};
      var allSheets = ss.getSheets();
      for (var s = 0; s < allSheets.length; s++) {
        var sh = allSheets[s];
        counts[sh.getName()] = Math.max(0, sh.getLastRow() - 1);
      }
      return jsonResponse({
        status: "success",
        success: true,
        counts: counts
      });
    }
  }

  return ContentService.createTextOutput(
    "SAIMETRIC Master Google Sheet Webhook is Online for " + MASTER_COMPANY_NAME + " (" + compId + "). 25 Tables Configured."
  );
}

/**
 * Standalone macro runner: Initializes all 25 business tabs in the active Google Sheet.
 * Select 'initializeAllTabs' in Apps Script toolbar and click 'Run'.
 */
function initializeAllTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = setupTenantSpreadsheetTabs(ss, MASTER_COMPANY_ID, MASTER_COMPANY_NAME, []);
  Logger.log(result.message);
  return result;
}

function setupTenantSheets() {
  return initializeAllTabs();
}

function setupMasterSheets() {
  return initializeAllTabs();
}

/**
 * Creates custom SAIMETRIC menu inside Google Sheet for 1-click tab setup
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('📊 SAIMETRIC SaaS')
      .addItem('⚡ Initialize / Repair All 25 Tabs', 'initializeAllTabs')
      .addSeparator()
      .addItem('🔍 Check Webhook Status', 'checkWebhookStatus')
      .addToUi();
  } catch (e) {}
}

function checkWebhookStatus() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert('SAIMETRIC Webhook Status', 'Webhook is active for ' + MASTER_COMPANY_NAME + ' (' + MASTER_COMPANY_ID + '). 25 business tables configured.', ui.ButtonSet.OK);
  } catch (e) {}
}

/**
 * Initializes all 25 required business tabs with bold dark-slate headers
 */
function setupTenantSpreadsheetTabs(ss, company_id, company_name, initial_products) {
  var dataTabsConfig = [
    { name: TAB_SALES, headers: ["SaleID", "CompanyID", "BranchID", "BranchName", "Date", "Customer", "PaymentMethod", "Subtotal", "Discount", "Tax", "Total", "CashierID", "CashierName", "ItemsCount", "Currency", "ExchangeRate", "ItemsSummary", "ItemsJSON", "Notes", "Status", "SyncedTimestamp"] },
    { name: TAB_INVENTORY, headers: ["ItemID", "CompanyID", "BranchID", "ItemName", "UnitsPerCase", "CostPerCase", "CostPerUnit", "SellingPrice", "MarkupPercent", "StockCases", "StockSingles", "TotalUnits", "SKU", "Category", "MinStock"] },
    { name: TAB_GOODS_RECEIVED, headers: ["VoucherID", "CompanyID", "BranchID", "SupplierInvoiceNo", "SupplierID", "SupplierName", "DeliveryDate", "TotalAmount", "LandedCost", "PaymentStatus", "ReceivedByID", "ReceivedByName", "ItemsCount", "Notes", "SyncedTimestamp"] },
    { name: TAB_GOODS_RECEIVED_ITEMS, headers: ["GRNID", "CompanyID", "BranchID", "ItemID", "ItemName", "ReceivedCases", "ReceivedSingles", "UnitsPerCase", "CostPerCase", "CostPerUnit", "LineTotal", "BatchNumber", "ExpiryDate"] },
    { name: TAB_SUPPLIER_INVOICES, headers: ["InvoiceID", "CompanyID", "BranchID", "InvoiceNumber", "SupplierID", "SupplierName", "InvoiceDate", "DueDate", "TotalAmount", "AmountPaid", "BalanceDue", "PaymentStatus", "GRVReferences", "SyncedTimestamp"] },
    { name: TAB_DIRECT_GRVS, headers: ["VoucherID", "CompanyID", "BranchID", "SupplierID", "SupplierName", "TotalAmount", "AmountPaidFromTill", "TillDisbursementLine", "Status", "ReceivedBy", "ApprovedBy", "SyncedTimestamp"] },
    { name: TAB_STOCK_MOVEMENTS, headers: ["MovementID", "CompanyID", "BranchID", "FromBranchID", "ToBranchID", "ItemID", "ItemName", "Quantity", "MovementType", "Reason", "StaffID", "Timestamp"] },
    { name: TAB_STOCK_BATCHES, headers: ["BatchID", "CompanyID", "BranchID", "ItemID", "BatchNumber", "ExpiryDate", "InitialQuantity", "RemainingQuantity", "Status", "Timestamp"] },
    { name: TAB_STOCKTAKE_SESSIONS, headers: ["SessionID", "CompanyID", "BranchID", "StartDate", "EndDate", "SupervisorID", "TotalVarianceValue", "Status", "Timestamp"] },
    { name: TAB_TRIP_MANIFESTS, headers: ["TripID", "CompanyID", "BranchID", "Destination", "DepartureDate", "ReturnDate", "TotalExpenses", "AllocatedLandedCost", "Status"] },
    { name: TAB_WALLETS, headers: ["WalletID", "CompanyID", "BranchID", "Currency", "Balance", "LastUpdated"] },
    { name: TAB_WALLET_TRANSFERS, headers: ["TransferID", "CompanyID", "BranchID", "FromWallet", "ToWallet", "Amount", "ExchangeRate", "StaffID", "Timestamp"] },
    { name: TAB_FIXED_COSTS, headers: ["CostID", "CompanyID", "BranchID", "Name", "Category", "MonthlyAmount", "ProratedDaily", "Active", "Timestamp"] },
    { name: TAB_CASH_LIFTS, headers: ["LiftID", "CompanyID", "BranchID", "CashierID", "SupervisorID", "Amount", "Currency", "Reason", "Timestamp"] },
    { name: TAB_CASH_COUNTS, headers: ["CountID", "CompanyID", "BranchID", "ShiftID", "CashierID", "ExpectedCash", "CountedCash", "Variance", "Timestamp"] },
    { name: TAB_CUSTOMERS, headers: ["CustomerID", "CompanyID", "BranchID", "Name", "Phone", "Address", "CreditBalance", "CreatedDate"] },
    { name: TAB_SUPPLIERS, headers: ["SupplierID", "CompanyID", "BranchID", "Name", "Category", "ContactPerson", "Phone", "Email", "Address", "PaymentTerms"] },
    { name: TAB_STAFF, headers: ["StaffID", "CompanyID", "BranchID", "Name", "Email", "Role", "Phone", "Active"] },
    { name: TAB_BRANCHES, headers: ["BranchID", "CompanyID", "Name", "Code", "Location", "IsActive"] },
    { name: TAB_CASH_LOG, headers: ["LogID", "CompanyID", "BranchID", "Timestamp", "Date", "StaffID", "StaffName", "Line", "Description", "CashIn", "CashOut"] },
    { name: TAB_CUSTOMER_CHANGE, headers: ["ChangeID", "CompanyID", "BranchID", "Timestamp", "CustomerID", "CustomerName", "Amount", "StaffID", "Notes", "Status"] },
    { name: TAB_CREDIT_SALES, headers: ["CreditID", "CompanyID", "BranchID", "Timestamp", "CustomerID", "CustomerName", "Amount", "Outflow", "Inflow", "StaffID", "Status"] },
    { name: TAB_EXPENSES, headers: ["ExpenseID", "CompanyID", "BranchID", "Timestamp", "Date", "Category", "Description", "Amount", "PaymentMethod", "StaffID"] },
    { name: TAB_RECONCILIATIONS, headers: ["ReconID", "CompanyID", "BranchID", "Timestamp", "Date", "CashierID", "ExpectedCash", "ActualCash", "Variance", "Status", "Notes"] },
    { name: TAB_AUDIT_LOG, headers: ["AuditID", "CompanyID", "BranchID", "Timestamp", "UserID", "Action", "Module", "ReferenceID", "Details"] }
  ];

  var createdTabs = [];
  for (var t = 0; t < dataTabsConfig.length; t++) {
    var cfg = dataTabsConfig[t];
    var sheet = ss.getSheetByName(cfg.name) || ss.insertSheet(cfg.name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(cfg.headers);
      sheet.getRange(1, 1, 1, cfg.headers.length).setBackground("#1E293B").setFontColor("#FFFFFF").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
    createdTabs.push(cfg.name);
  }

  // Populate initial products if provided
  if (initial_products && Array.isArray(initial_products) && initial_products.length > 0) {
    var invSheet = ss.getSheetByName(TAB_INVENTORY);
    if (invSheet) {
      var existingData = invSheet.getDataRange().getValues();
      var existingIds = {};
      for (var r = 1; r < existingData.length; r++) {
        if (existingData[r][0]) existingIds[String(existingData[r][0]).toUpperCase()] = true;
      }
      for (var p = 0; p < initial_products.length; p++) {
        var prod = initial_products[p];
        var pId = String(prod.itemId || prod.id || ("ITM-" + p)).trim();
        if (existingIds[pId.toUpperCase()]) continue;
        invSheet.appendRow([
          pId,
          company_id || "",
          prod.branch_id || "BR-MAIN",
          prod.itemName || prod.name || "",
          Number(prod.unitsPerCase) || 1,
          Number(prod.costPerCase || prod.costPrice) || 0,
          Number(prod.costPerUnit || prod.costPrice) || 0,
          Number(prod.sellPriceUnit || prod.price) || 0,
          Number(prod.markupPercent) || 0,
          Number(prod.stockCases) || 0,
          Number(prod.stockSingles || prod.stockQuantity) || 0,
          Number(prod.totalUnits || prod.stockQuantity) || 0,
          prod.sku || "",
          prod.category || "General",
          Number(prod.minStock) || 5
        ]);
        existingIds[pId.toUpperCase()] = true;
      }
    }
  }

  // Delete default empty Sheet1 if present
  try {
    var defaultSheet = ss.getSheetByName("Sheet1");
    if (defaultSheet && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
  } catch (cleanErr) {}

  return {
    success: true,
    message: "Initialized " + createdTabs.length + " business tabs in " + ss.getName(),
    tabs: createdTabs,
    sheet_id: ss.getId(),
    sheet_name: ss.getName()
  };
}

/**
 * Handle Reading Inventory from InventoryMaster
 */
function handleGetInventory(ss, company_id) {
  var sheet = ss.getSheetByName(TAB_INVENTORY);
  if (!sheet) return { items: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { items: [] };
  var headers = data[0];
  var items = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var item = {};
    for (var c = 0; c < headers.length; c++) {
      item[headers[c]] = row[c];
    }
    var rowComp = item.CompanyID || item.company_id;
    if (company_id && rowComp && rowComp !== company_id) continue;
    items.push({
      itemId: item.ItemID || item.itemId || item.id,
      itemName: item.ItemName || item.itemName || item.name,
      company_id: rowComp || company_id,
      branch_id: item.BranchID || item.branch_id || "BR-MAIN",
      unitsPerCase: Number(item.UnitsPerCase) || 1,
      costPerCase: Number(item.CostPerCase) || 0,
      costPerUnit: Number(item.CostPerUnit) || 0,
      sellPriceUnit: Number(item.SellingPrice) || 0,
      stockCases: Number(item.StockCases) || 0,
      stockSingles: Number(item.StockSingles) || 0,
      totalUnits: Number(item.TotalUnits) || 0,
      sku: item.SKU || "",
      category: item.Category || "General"
    });
  }
  return { items: items };
}

/**
 * Handle Upserting Inventory Records
 */
function handleSyncInventory(ss, payload, company_id, branch_id) {
  var sheet = ss.getSheetByName(TAB_INVENTORY);
  if (!sheet) {
    setupTenantSpreadsheetTabs(ss, company_id, MASTER_COMPANY_NAME, []);
    sheet = ss.getSheetByName(TAB_INVENTORY);
  }
  var items = Array.isArray(payload.items) ? payload.items : [payload.data || payload.item || payload];
  var data = sheet.getDataRange().getValues();
  var idToRow = {};
  for (var r = 1; r < data.length; r++) {
    if (data[r][0]) idToRow[String(data[r][0]).toUpperCase()] = r + 1;
  }
  var updated = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it) continue;
    var cleanId = String(it.itemId || it.id || "").trim();
    if (!cleanId) continue;
    var rowIdx = idToRow[cleanId.toUpperCase()];
    var rowVals = [
      cleanId,
      company_id,
      it.branch_id || branch_id || "BR-MAIN",
      it.itemName || it.name || "",
      Number(it.unitsPerCase) || 1,
      Number(it.costPerCase || it.costPrice) || 0,
      Number(it.costPerUnit || it.costPrice) || 0,
      Number(it.sellPriceUnit || it.price) || 0,
      Number(it.markupPercent) || 0,
      Number(it.stockCases) || 0,
      Number(it.stockSingles || it.stockQuantity) || 0,
      Number(it.totalUnits || it.stockQuantity) || 0,
      it.sku || "",
      it.category || "General",
      Number(it.minStock) || 5
    ];
    if (rowIdx) {
      sheet.getRange(rowIdx, 1, 1, rowVals.length).setValues([rowVals]);
    } else {
      sheet.appendRow(rowVals);
      idToRow[cleanId.toUpperCase()] = sheet.getLastRow();
    }
    updated++;
  }
  return { count: updated, items: items };
}

/**
 * Handle Appending Sales Invoices
 */
function handleAddSale(ss, payload, company_id, branch_id, branchName, userRole) {
  var sheet = ss.getSheetByName(TAB_SALES);
  if (!sheet) {
    setupTenantSpreadsheetTabs(ss, company_id, MASTER_COMPANY_NAME, []);
    sheet = ss.getSheetByName(TAB_SALES);
  }
  var s = payload.data || payload.sale || payload;
  var saleId = s.id || s.saleId || s.InvoiceID || ("SALE-" + Date.now());
  var itemsJson = "";
  try {
    itemsJson = Array.isArray(s.items) ? JSON.stringify(s.items) : "";
  } catch(e) {}

  sheet.appendRow([
    saleId,
    company_id,
    branch_id,
    branchName,
    s.date || s.Timestamp || new Date().toISOString(),
    s.customerName || s.customer || "Walk-in",
    s.paymentMethod || "CASH",
    Number(s.subtotal || s.Subtotal) || 0,
    Number(s.discount || s.Discount) || 0,
    Number(s.tax || s.Tax) || 0,
    Number(s.total || s.Total) || 0,
    s.cashierId || s.staffId || s.StaffID || "USR-001",
    s.cashierName || s.staffName || s.StaffName || "Cashier",
    (s.items && s.items.length) || 1,
    s.currency || "USD",
    Number(s.exchangeRate) || 1.0,
    s.itemsSummary || s.ItemsSummary || "",
    itemsJson,
    s.notes || "",
    s.status || "COMPLETED",
    new Date().toISOString()
  ]);
  return { status: "success", success: true, sale_id: saleId, tab: TAB_SALES };
}

/**
 * Handle Appending Supplier Invoices
 */
function handleAddSupplierInvoice(ss, payload, company_id, branch_id) {
  var sheet = ss.getSheetByName(TAB_SUPPLIER_INVOICES);
  if (!sheet) {
    setupTenantSpreadsheetTabs(ss, company_id, MASTER_COMPANY_NAME, []);
    sheet = ss.getSheetByName(TAB_SUPPLIER_INVOICES);
  }
  var d = payload.data || payload.invoice || payload;
  var invId = d.id || d.InvoiceID || ("SUP-INV-" + Date.now());
  sheet.appendRow([
    invId,
    company_id,
    branch_id,
    d.invoiceNumber || d.invoice_number || invId,
    d.supplierId || d.supplier_id || "",
    d.supplierName || d.supplier_name || "",
    d.invoiceDate || d.date || new Date().toISOString().split("T")[0],
    d.dueDate || "",
    Number(d.totalAmount || d.amount) || 0,
    Number(d.amountPaid || d.paid) || 0,
    Number(d.balanceDue || d.balance) || 0,
    d.paymentStatus || d.status || "UNPAID",
    Array.isArray(d.grvReferences) ? d.grvReferences.join(", ") : (d.grvReferences || ""),
    new Date().toISOString()
  ]);
  return { status: "success", success: true, invoice_id: invId, tab: TAB_SUPPLIER_INVOICES };
}

/**
 * Handle Appending Goods Received Vouchers & Items
 */
function handleAddGoodsReceived(ss, payload, company_id, branch_id) {
  var sheet = ss.getSheetByName(TAB_GOODS_RECEIVED);
  var itemsSheet = ss.getSheetByName(TAB_GOODS_RECEIVED_ITEMS);
  if (!sheet || !itemsSheet) {
    setupTenantSpreadsheetTabs(ss, company_id, MASTER_COMPANY_NAME, []);
    sheet = ss.getSheetByName(TAB_GOODS_RECEIVED);
    itemsSheet = ss.getSheetByName(TAB_GOODS_RECEIVED_ITEMS);
  }
  var grn = payload.data || payload.grn || payload;
  var vId = grn.id || grn.grnId || grn.voucherId || ("GRV-" + Date.now());
  sheet.appendRow([
    vId,
    company_id,
    branch_id,
    grn.supplierInvoiceNo || grn.invoiceNumber || "",
    grn.supplierId || "",
    grn.supplierName || grn.supplier || "",
    grn.deliveryDate || grn.date || new Date().toISOString().split("T")[0],
    Number(grn.totalAmount || grn.total) || 0,
    Number(grn.landedCost || grn.totalLandedCost) || 0,
    grn.paymentStatus || "UNPAID",
    grn.receivedById || grn.staffId || "",
    grn.receivedByName || grn.staffName || "",
    (grn.items && grn.items.length) || 0,
    grn.notes || "",
    new Date().toISOString()
  ]);

  if (Array.isArray(grn.items) && grn.items.length > 0 && itemsSheet) {
    for (var i = 0; i < grn.items.length; i++) {
      var it = grn.items[i];
      itemsSheet.appendRow([
        vId,
        company_id,
        branch_id,
        it.itemId || it.id || "",
        it.itemName || it.name || "",
        Number(it.receivedCases || it.cases) || 0,
        Number(it.receivedSingles || it.singles) || 0,
        Number(it.unitsPerCase) || 1,
        Number(it.costPerCase) || 0,
        Number(it.costPerUnit) || 0,
        Number(it.lineTotal || it.total) || 0,
        it.batchNumber || it.batch || "",
        it.expiryDate || ""
      ]);
    }
  }

  return { status: "success", success: true, voucher_id: vId, tab: TAB_GOODS_RECEIVED };
}

/**
 * Handle Appending Direct GRV records
 */
function handleAddDirectGRV(ss, payload, company_id, branch_id) {
  var sheet = ss.getSheetByName(TAB_DIRECT_GRVS);
  if (!sheet) {
    setupTenantSpreadsheetTabs(ss, company_id, MASTER_COMPANY_NAME, []);
    sheet = ss.getSheetByName(TAB_DIRECT_GRVS);
  }
  var d = payload.data || payload;
  var vId = d.id || ("DGRV-" + Date.now());
  sheet.appendRow([
    vId,
    company_id,
    branch_id,
    d.supplierId || "",
    d.supplierName || "",
    Number(d.totalAmount || d.total) || 0,
    Number(d.amountPaidFromTill || d.paidFromTill) || 0,
    d.tillDisbursementLine || "",
    d.status || "APPROVED",
    d.receivedBy || d.staffName || "",
    d.approvedBy || "",
    new Date().toISOString()
  ]);
  return { status: "success", success: true, direct_grv_id: vId };
}

/**
 * Handle Appending Stock Movement records
 */
function handleAddStockMovement(ss, payload, company_id, branch_id) {
  var sheet = ss.getSheetByName(TAB_STOCK_MOVEMENTS);
  if (!sheet) {
    setupTenantSpreadsheetTabs(ss, company_id, MASTER_COMPANY_NAME, []);
    sheet = ss.getSheetByName(TAB_STOCK_MOVEMENTS);
  }
  var m = payload.data || payload;
  var mId = m.id || ("MOV-" + Date.now());
  sheet.appendRow([
    mId,
    company_id,
    branch_id,
    m.fromBranchId || branch_id,
    m.toBranchId || branch_id,
    m.itemId || m.productId || "",
    m.itemName || m.productName || "",
    Number(m.quantity) || 0,
    m.movementType || m.type || "TRANSFER",
    m.reason || "",
    m.staffId || m.userId || "",
    m.timestamp || new Date().toISOString()
  ]);
  return { status: "success", success: true, movement_id: mId };
}

/**
 * Handle Appending Wallet Transfer records
 */
function handleAddWalletTransfer(ss, payload, company_id, branch_id) {
  var sheet = ss.getSheetByName(TAB_WALLET_TRANSFERS);
  if (!sheet) {
    setupTenantSpreadsheetTabs(ss, company_id, MASTER_COMPANY_NAME, []);
    sheet = ss.getSheetByName(TAB_WALLET_TRANSFERS);
  }
  var w = payload.data || payload;
  var wId = w.id || ("WTR-" + Date.now());
  sheet.appendRow([
    wId,
    company_id,
    branch_id,
    w.fromWallet || "",
    w.toWallet || "",
    Number(w.amount) || 0,
    Number(w.exchangeRate) || 1,
    w.staffId || "",
    w.timestamp || new Date().toISOString()
  ]);
  return { status: "success", success: true, transfer_id: wId };
}

/**
 * Generic Append Helper with Dynamic Isolation
 */
function appendRecordToSheet(ss, sheetBaseName, rowData, companyId, branchId, branchName, userId, userRole) {
  var targetTab = sheetBaseName;
  if (DEFAULT_ISOLATION_MODE === "BRANCH_TABS" || DEFAULT_ISOLATION_MODE === "HYBRID") {
    targetTab = sheetBaseName + "_" + branchId;
  }

  var sheet = ss.getSheetByName(targetTab) || ss.getSheetByName(sheetBaseName);
  var enrichedData = Object.assign({}, rowData);
  enrichedData.CompanyID = companyId;
  enrichedData.BranchID = branchId;
  enrichedData.BranchName = branchName;
  enrichedData.CreatedByUserID = userId;
  enrichedData.CreatedByRole = userRole;
  if (!enrichedData.SyncTimestamp) {
    enrichedData.SyncTimestamp = new Date().toISOString();
  }

  if (!sheet) {
    sheet = ss.insertSheet(targetTab);
    var headers = Object.keys(enrichedData);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground("#1E293B")
      .setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (!existingHeaders || existingHeaders.length === 0 || existingHeaders[0] === "") {
    existingHeaders = Object.keys(enrichedData);
    sheet.appendRow(existingHeaders);
  }

  var newRow = [];
  for (var i = 0; i < existingHeaders.length; i++) {
    var key = existingHeaders[i];
    var val = enrichedData[key];
    if (val === undefined || val === null) val = "";
    newRow.push(val);
  }

  sheet.appendRow(newRow);
  return {
    status: "success",
    success: true,
    code: 200,
    tenant: companyId,
    branch: branchId,
    tab: sheet.getName(),
    rowAdded: true,
    timestamp: new Date().toISOString()
  };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
