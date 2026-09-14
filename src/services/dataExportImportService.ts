import {
  InventoryItem,
  Customer,
  Supplier,
  CashLogEntry,
  CashCountRecord,
  CreditSaleEntry,
  CustomerChangeEntry,
  ShiftReconciliation,
  GoodsReceivedEntry,
  StockMovementEntry,
  SaleInvoice,
  Salesperson,
} from '../types';
import {
  getInventoryItems,
  saveInventoryItem,
  getCustomers,
  addCustomer,
  getSuppliers,
  addSupplier,
  updateSupplier,
  getCashCounts,
  getCashLogs,
  getExpenses,
  getCreditSales,
  getCustomerChanges,
  getReconciliations,
  getGoodsReceived,
  getSupplierInvoiceVouchers,
  getStockMovements,
  getSales,
  getSalespeople,
  getCustomerCreditReport,
  getCustomerChangeReport,
  getDailyGoodsReceivedReport,
} from '../db/roomDatabase';

// ==========================================
// CSV & FILE UTILITY HELPERS
// ==========================================

export function escapeCsvValue(val: any): string {
  if (val === undefined || val === null) return '';
  const str = String(val).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function triggerBrowserDownload(content: string, filename: string, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Robust CSV parser that handles quotes, escaped quotes, commas inside quotes, and multiline cells.
 */
export function parseCsvText(text: string): string[][] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip \n
      }
      currentRow.push(currentVal.trim());
      if (currentRow.some((val) => val.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((val) => val.length > 0)) {
      lines.push(currentRow);
    }
  }

  return lines;
}

// ==========================================
// 1. INVENTORY IMPORT / EXPORT
// ==========================================

export const INVENTORY_CSV_HEADERS = [
  'Item ID',
  'Item Name',
  'Category',
  'Can Sell As Case (Y/N)',
  'Units Per Case',
  'Cost Per Case ($)',
  'Cost Per Unit ($)',
  'Sell Price Case ($)',
  'Sell Price Unit ($)',
  'Stock Cases',
  'Stock Singles',
  'Total Units',
  'Reorder Level Cases',
  'Reorder Level Units',
  'SKU',
  'Barcode',
  'Description',
];

export function exportInventoryToCsv(customItems?: InventoryItem[]): string {
  const items = customItems || getInventoryItems();
  const rows: string[] = [INVENTORY_CSV_HEADERS.join(',')];

  items.forEach((item) => {
    const row = [
      escapeCsvValue(item.itemId),
      escapeCsvValue(item.itemName),
      escapeCsvValue(item.category || 'General'),
      escapeCsvValue(item.canSellAsCase ? 'Y' : 'N'),
      escapeCsvValue(item.unitsPerCase || 1),
      escapeCsvValue(item.costPerCase?.toFixed(2) || '0.00'),
      escapeCsvValue(item.costPerUnit?.toFixed(2) || '0.00'),
      escapeCsvValue(item.sellPriceCase?.toFixed(2) || '0.00'),
      escapeCsvValue(item.sellPriceUnit?.toFixed(2) || '0.00'),
      escapeCsvValue(item.stockCases || 0),
      escapeCsvValue(item.stockSingles || 0),
      escapeCsvValue(item.totalUnits || (item.stockCases * item.unitsPerCase + item.stockSingles)),
      escapeCsvValue(item.reorderLevelCases || 1),
      escapeCsvValue(item.reorderLevelUnits || 5),
      escapeCsvValue(item.sku || item.itemId),
      escapeCsvValue(item.barcode || ''),
      escapeCsvValue(item.description || ''),
    ];
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

export function downloadInventoryCsv(customItems?: InventoryItem[]) {
  const csv = exportInventoryToCsv(customItems);
  const dateStr = new Date().toISOString().split('T')[0];
  triggerBrowserDownload(csv, `Saimetric_Inventory_Export_${dateStr}.csv`);
}

export function downloadInventoryJson(customItems?: InventoryItem[]) {
  const items = customItems || getInventoryItems();
  const json = JSON.stringify(items, null, 2);
  const dateStr = new Date().toISOString().split('T')[0];
  triggerBrowserDownload(json, `Saimetric_Inventory_Export_${dateStr}.json`, 'application/json');
}

export function downloadInventoryTemplateCsv() {
  const sampleRows = [
    INVENTORY_CSV_HEADERS.join(','),
    [
      'MAZ001',
      'Mazoe Orange Crush 2L',
      'Beverages & Cordials',
      'Y',
      '6',
      '18.00',
      '3.00',
      '22.50',
      '4.00',
      '15',
      '4',
      '94',
      '3',
      '6',
      'SKU-MAZ001',
      '600123456789',
      'Mazoe Orange 2 Litre cordial bottle',
    ].map(escapeCsvValue).join(','),
    [
      'SUG001',
      'Huletts SunSweet White Sugar 2kg',
      'Dry Grocery & Staples',
      'N',
      '10',
      '17.50',
      '1.75',
      '21.00',
      '2.25',
      '8',
      '0',
      '80',
      '2',
      '5',
      'SKU-SUG001',
      '600987654321',
      'Refined white granulated sugar 2kg packets',
    ].map(escapeCsvValue).join(','),
    [
      'OIL002',
      'PureDrop Cooking Oil 2L',
      'Edible Oils',
      'Y',
      '12',
      '36.00',
      '3.00',
      '42.00',
      '3.80',
      '5',
      '2',
      '62',
      '2',
      '6',
      'SKU-OIL002',
      '600555666777',
      'Pure vegetable cooking oil 2L',
    ].map(escapeCsvValue).join(','),
  ];
  triggerBrowserDownload(sampleRows.join('\n'), 'Saimetric_Inventory_Template.csv');
}

export interface ParsedInventoryResult {
  items: InventoryItem[];
  errors: string[];
  totalParsed: number;
}

export function parseInventoryCsv(csvText: string): ParsedInventoryResult {
  const rows = parseCsvText(csvText);
  const errors: string[] = [];
  const items: InventoryItem[] = [];

  if (rows.length < 2) {
    return { items: [], errors: ['CSV file is empty or missing headers.'], totalParsed: 0 };
  }

  const rawHeaders = rows[0].map((h) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  // Header mapping indices
  const getColIdx = (keywords: string[]) => {
    return rawHeaders.findIndex((h) => keywords.some((k) => h.includes(k)));
  };

  const idIdx = getColIdx(['itemid', 'id', 'code', 'productid', 'sku']);
  const nameIdx = getColIdx(['itemname', 'name', 'description', 'title', 'product']);
  const catIdx = getColIdx(['category', 'dept', 'group']);
  const caseSellIdx = getColIdx(['cansellascase', 'sellcase', 'casesale', 'sellascase']);
  const unitsPerCaseIdx = getColIdx(['unitspercase', 'unitsincase', 'unitsperpack', 'packsize', 'ratio']);
  const costCaseIdx = getColIdx(['costpercase', 'casecost', 'costcase', 'buycase']);
  const costUnitIdx = getColIdx(['costperunit', 'unitcost', 'costunit', 'buyunit']);
  const sellCaseIdx = getColIdx(['sellpricecase', 'caseprice', 'sellcase', 'pricecase']);
  const sellUnitIdx = getColIdx(['sellpriceunit', 'unitprice', 'sellunit', 'priceunit', 'price']);
  const stockCaseIdx = getColIdx(['stockcases', 'casesinstock', 'qtycases', 'cases']);
  const stockSingleIdx = getColIdx(['stocksingles', 'singlesinstock', 'qtysingles', 'singles', 'units']);
  const skuIdx = getColIdx(['sku', 'code']);
  const barcodeIdx = getColIdx(['barcode', 'ean', 'upc']);
  const descIdx = getColIdx(['description', 'notes', 'details']);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowNum = r + 1;

    const rawId = idIdx >= 0 ? row[idIdx]?.trim() : '';
    const rawName = nameIdx >= 0 ? row[nameIdx]?.trim() : '';

    if (!rawName && !rawId) {
      continue; // Skip empty row
    }

    const itemId = rawId || `ITM-${Date.now()}-${r}`;
    const itemName = rawName || `Unnamed Item ${itemId}`;

    const category = (catIdx >= 0 && row[catIdx]?.trim()) || 'General';
    const canSellAsCase =
      caseSellIdx >= 0
        ? ['y', 'yes', 'true', '1'].includes(row[caseSellIdx]?.toLowerCase().trim())
        : false;

    const unitsPerCase = Math.max(1, parseInt(unitsPerCaseIdx >= 0 ? row[unitsPerCaseIdx] : '1', 10) || 1);
    let costPerCase = parseFloat(costCaseIdx >= 0 ? row[costCaseIdx]?.replace(/[^0-9.]/g, '') : '0') || 0;
    let costPerUnit = parseFloat(costUnitIdx >= 0 ? row[costUnitIdx]?.replace(/[^0-9.]/g, '') : '0') || 0;

    if (costPerCase > 0 && costPerUnit === 0) {
      costPerUnit = costPerCase / unitsPerCase;
    } else if (costPerUnit > 0 && costPerCase === 0) {
      costPerCase = costPerUnit * unitsPerCase;
    }

    let sellPriceUnit = parseFloat(sellUnitIdx >= 0 ? row[sellUnitIdx]?.replace(/[^0-9.]/g, '') : '0') || 0;
    let sellPriceCase = parseFloat(sellCaseIdx >= 0 ? row[sellCaseIdx]?.replace(/[^0-9.]/g, '') : '0') || 0;

    if (sellPriceUnit > 0 && sellPriceCase === 0) {
      sellPriceCase = sellPriceUnit * unitsPerCase;
    }

    const stockCases = Math.max(0, parseInt(stockCaseIdx >= 0 ? row[stockCaseIdx] : '0', 10) || 0);
    const stockSingles = Math.max(0, parseInt(stockSingleIdx >= 0 ? row[stockSingleIdx] : '0', 10) || 0);
    const totalUnits = stockCases * unitsPerCase + stockSingles;

    const sku = (skuIdx >= 0 && row[skuIdx]?.trim()) || itemId;
    const barcode = (barcodeIdx >= 0 && row[barcodeIdx]?.trim()) || '';
    const description = (descIdx >= 0 && row[descIdx]?.trim()) || '';

    const item: InventoryItem = {
      itemId,
      itemName,
      category,
      canSellAsCase,
      unitsPerCase,
      costPerCase,
      costPerUnit,
      sellPriceCase,
      sellPriceUnit,
      stockCases,
      stockSingles,
      totalUnits,
      reorderLevelCases: 2,
      reorderLevelUnits: Math.max(5, unitsPerCase),
      sku,
      barcode,
      description,
      lastUpdated: new Date().toISOString(),
    };

    items.push(item);
  }

  return { items, errors, totalParsed: items.length };
}

export function importInventoryItems(
  items: InventoryItem[],
  mode: 'merge' | 'replace' = 'merge'
): { added: number; updated: number; errors: string[] } {
  const currentItems = getInventoryItems();
  let added = 0;
  let updated = 0;
  const errors: string[] = [];

  if (mode === 'replace') {
    // In replace mode, clear and save all parsed items
    try {
      localStorage.setItem('saimetric_inventory_items', JSON.stringify(items));
      return { added: items.length, updated: 0, errors: [] };
    } catch (err: any) {
      errors.push(`Failed to replace inventory: ${err?.message || 'Storage error'}`);
      return { added: 0, updated: 0, errors };
    }
  }

  // Merge mode
  const currentMap = new Map<string, InventoryItem>();
  currentItems.forEach((i) => currentMap.set(i.itemId.toUpperCase(), i));

  items.forEach((item) => {
    try {
      const exists = currentMap.has(item.itemId.toUpperCase());
      saveInventoryItem(item);
      if (exists) {
        updated++;
      } else {
        added++;
      }
    } catch (err: any) {
      errors.push(`Error saving item ${item.itemName} (${item.itemId}): ${err?.message || 'Unknown'}`);
    }
  });

  return { added, updated, errors };
}

// ==========================================
// 2. CUSTOMERS IMPORT / EXPORT
// ==========================================

export const CUSTOMER_CSV_HEADERS = [
  'Customer ID',
  'Customer Name',
  'Phone Number',
  'Physical Address',
  'Created Date',
  'Created By Staff ID',
  'Credit Limit ($)',
  'Notes',
];

export function exportCustomersToCsv(customCustomers?: Customer[]): string {
  const customers = customCustomers || getCustomers();
  const creditReport = getCustomerCreditReport();
  const changeReport = getCustomerChangeReport();

  const headers = [
    'Customer ID',
    'Customer Name',
    'Phone Number',
    'Physical Address',
    'Registered Date',
    'Created By Staff',
    'Outstanding Debt ($)',
    'Trust Change Balance ($)',
    'Status',
  ];

  const rows: string[] = [headers.join(',')];

  customers.forEach((c) => {
    const cName = (c.name || '').toLowerCase().trim();
    const creditEntry = creditReport.items.find(
      (item) =>
        (c.customerId && item.customerId === c.customerId) ||
        (item.customerName && cName && item.customerName.toLowerCase().trim() === cName)
    );
    const changeEntry = changeReport.items.find(
      (item) =>
        (c.customerId && item.customerId === c.customerId) ||
        (item.customerName && cName && item.customerName.toLowerCase().trim() === cName)
    );

    const debt = creditEntry ? creditEntry.netDebtOwed.toFixed(2) : '0.00';
    const change = changeEntry ? changeEntry.netChangeOwed.toFixed(2) : '0.00';
    const status = creditEntry?.status || (Number(debt) > 0 ? 'Owing' : 'Good Standing');

    const row = [
      escapeCsvValue(c.customerId),
      escapeCsvValue(c.name),
      escapeCsvValue(c.phone || ''),
      escapeCsvValue(c.address || ''),
      escapeCsvValue(c.createdDate || ''),
      escapeCsvValue(c.createdBy || '001'),
      escapeCsvValue(debt),
      escapeCsvValue(change),
      escapeCsvValue(status),
    ];
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

export function downloadCustomersCsv(customCustomers?: Customer[]) {
  const csv = exportCustomersToCsv(customCustomers);
  const dateStr = new Date().toISOString().split('T')[0];
  triggerBrowserDownload(csv, `Saimetric_Customers_Export_${dateStr}.csv`);
}

export function downloadCustomersJson(customCustomers?: Customer[]) {
  const customers = customCustomers || getCustomers();
  const json = JSON.stringify(customers, null, 2);
  const dateStr = new Date().toISOString().split('T')[0];
  triggerBrowserDownload(json, `Saimetric_Customers_Export_${dateStr}.json`, 'application/json');
}

export function downloadCustomerTemplateCsv() {
  const sampleRows = [
    CUSTOMER_CSV_HEADERS.join(','),
    ['C001', 'Givemore Gondo', '+263 77 123 4567', '45 Enterprise Rd, Highlands, Harare', '2026-01-15', '001', '500.00', 'Loyal wholesale grocery customer'].map(escapeCsvValue).join(','),
    ['C002', 'Tendai Mashingaidze', '+263 71 987 6543', 'Stand 12, Highfield, Harare', '2026-02-10', '001', '250.00', 'Local tuckshop owner'].map(escapeCsvValue).join(','),
    ['C003', 'Grace Chidzero', '+263 78 555 4321', '8 Samora Machel Ave, Harare', '2026-03-01', '002', '300.00', 'Bakery operator'].map(escapeCsvValue).join(','),
  ];
  triggerBrowserDownload(sampleRows.join('\n'), 'Saimetric_Customers_Template.csv');
}

export function parseCustomersCsv(csvText: string): { customers: Customer[]; errors: string[] } {
  const rows = parseCsvText(csvText);
  const errors: string[] = [];
  const customers: Customer[] = [];

  if (rows.length < 2) {
    return { customers: [], errors: ['CSV file is empty or missing headers.'] };
  }

  const rawHeaders = rows[0].map((h) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  const getColIdx = (keywords: string[]) => {
    return rawHeaders.findIndex((h) => keywords.some((k) => h.includes(k)));
  };

  const idIdx = getColIdx(['customerid', 'id', 'code', 'custid']);
  const nameIdx = getColIdx(['customername', 'name', 'client', 'fullname']);
  const phoneIdx = getColIdx(['phone', 'mobile', 'cell', 'telephone', 'contact']);
  const addressIdx = getColIdx(['address', 'location', 'street', 'city', 'stand']);
  const dateIdx = getColIdx(['date', 'createddate', 'created', 'registered']);
  const byIdx = getColIdx(['createdby', 'staffid', 'staff', 'creator']);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawName = nameIdx >= 0 ? row[nameIdx]?.trim() : '';
    const rawId = idIdx >= 0 ? row[idIdx]?.trim() : '';

    if (!rawName && !rawId) continue;

    const customerId = rawId || `C${String(r).padStart(3, '0')}`;
    const name = rawName || `Customer ${customerId}`;
    const phone = phoneIdx >= 0 ? row[phoneIdx]?.trim() : '';
    const address = addressIdx >= 0 ? row[addressIdx]?.trim() : '';
    const createdDate = (dateIdx >= 0 && row[dateIdx]?.trim()) || new Date().toISOString().split('T')[0];
    const createdBy = (byIdx >= 0 && row[byIdx]?.trim()) || '001';

    customers.push({
      customerId,
      name,
      phone,
      address,
      createdDate,
      createdBy,
    });
  }

  return { customers, errors };
}

export function importCustomersList(
  customers: Customer[],
  mode: 'merge' | 'replace' = 'merge'
): { added: number; updated: number; errors: string[] } {
  const currentList = getCustomers();
  let added = 0;
  let updated = 0;
  const errors: string[] = [];

  if (mode === 'replace') {
    try {
      localStorage.setItem('saimetric_customers', JSON.stringify(customers));
      return { added: customers.length, updated: 0, errors: [] };
    } catch (err: any) {
      errors.push(`Failed to replace customers: ${err?.message || 'Storage error'}`);
      return { added: 0, updated: 0, errors };
    }
  }

  const currentMap = new Map<string, Customer>();
  currentList.forEach((c) => currentMap.set(c.customerId.toUpperCase(), c));

  const merged = [...currentList];

  customers.forEach((c) => {
    const key = c.customerId.toUpperCase();
    const idx = merged.findIndex((existing) => existing.customerId.toUpperCase() === key);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...c };
      updated++;
    } else {
      merged.unshift(c);
      added++;
    }
  });

  try {
    localStorage.setItem('saimetric_customers', JSON.stringify(merged));
  } catch (err: any) {
    errors.push(`Error saving customers to storage: ${err?.message || 'Storage error'}`);
  }

  return { added, updated, errors };
}

// ==========================================
// 3. SUPPLIERS IMPORT / EXPORT
// ==========================================

export const SUPPLIER_CSV_HEADERS = [
  'Supplier ID',
  'Supplier Name',
  'Category',
  'Contact Person',
  'Phone Number',
  'Email Address',
  'Physical Address',
  'City',
  'Payment Terms',
  'Tax/VAT Number',
  'Bank Account Number',
  'Status (Active/Inactive)',
  'Created Date',
  'Notes',
];

export function exportSuppliersToCsv(customSuppliers?: Supplier[]): string {
  const suppliers = customSuppliers || getSuppliers();
  const vouchers = getSupplierInvoiceVouchers();

  const headers = [
    'Supplier ID',
    'Supplier Name',
    'Category',
    'Contact Person',
    'Phone Number',
    'Email Address',
    'Physical Address',
    'City',
    'Payment Terms',
    'Tax/VAT Number',
    'Bank Account Number',
    'Status',
    'Total Spend ($)',
    'Total Invoices',
    'Created Date',
    'Notes',
  ];

  const rows: string[] = [headers.join(',')];

  suppliers.forEach((s) => {
    const sName = (s.name || '').toLowerCase().trim();
    const supVouchers = vouchers.filter(
      (v) => (v.supplier || '').toLowerCase().trim() === sName
    );
    const totalSpend = supVouchers.reduce((acc, v) => acc + v.totalInvoiceAmount, 0);

    const row = [
      escapeCsvValue(s.supplierId),
      escapeCsvValue(s.name),
      escapeCsvValue(s.category || 'General FMCG'),
      escapeCsvValue(s.contactPerson || ''),
      escapeCsvValue(s.phone || ''),
      escapeCsvValue(s.email || ''),
      escapeCsvValue(s.address || ''),
      escapeCsvValue(s.city || 'Harare'),
      escapeCsvValue(s.paymentTerms || '30-Day Account Credit'),
      escapeCsvValue(s.taxNumber || ''),
      escapeCsvValue(s.accountNumber || ''),
      escapeCsvValue(s.status || 'Active'),
      escapeCsvValue(totalSpend.toFixed(2)),
      escapeCsvValue(supVouchers.length),
      escapeCsvValue(s.createdDate || ''),
      escapeCsvValue(s.notes || ''),
    ];
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

export function downloadSuppliersCsv(customSuppliers?: Supplier[]) {
  const csv = exportSuppliersToCsv(customSuppliers);
  const dateStr = new Date().toISOString().split('T')[0];
  triggerBrowserDownload(csv, `Saimetric_Suppliers_Export_${dateStr}.csv`);
}

export function downloadSuppliersJson(customSuppliers?: Supplier[]) {
  const suppliers = customSuppliers || getSuppliers();
  const json = JSON.stringify(suppliers, null, 2);
  const dateStr = new Date().toISOString().split('T')[0];
  triggerBrowserDownload(json, `Saimetric_Suppliers_Export_${dateStr}.json`, 'application/json');
}

export function downloadSupplierTemplateCsv() {
  const sampleRows = [
    SUPPLIER_CSV_HEADERS.join(','),
    [
      'SUP-001',
      'National Foods Wholesalers',
      'Groceries & Milling',
      'Farai Mutasa',
      '+263 77 222 3344',
      'orders@natfood.co.zw',
      '10 Stirling Rd, Workington',
      'Harare',
      '30-Day Account Credit',
      'VAT-10029384',
      'CABS ACC #90218844',
      'Active',
      '2026-01-10',
      'Primary supplier of Red Seal, Gloria, Mahatma Rice',
    ].map(escapeCsvValue).join(','),
    [
      'SUP-002',
      'Delta Beverages Distribution',
      'Beverages & Soft Drinks',
      'Chipo Moyo',
      '+263 71 333 4455',
      'sales@delta.co.zw',
      'Sable House, Northridge Park',
      'Harare',
      'Cash on Delivery',
      'VAT-99881122',
      'Stanbic ACC #11002233',
      'Active',
      '2026-01-12',
      'Mazoe, Minute Maid, Schweppes',
    ].map(escapeCsvValue).join(','),
    [
      'SUP-003',
      'Dairibord Zimbabwe Limited',
      'Dairy & Juices',
      'Kudakwashe Nyoni',
      '+263 78 444 5566',
      'distribution@dairibord.co.zw',
      'Rekayi Tangwena Ave',
      'Harare',
      '14-Day Credit',
      'VAT-44556677',
      'FBC ACC #55443322',
      'Active',
      '2026-02-01',
      'Fresh milk, chimombe, lacto, cascade juices',
    ].map(escapeCsvValue).join(','),
  ];
  triggerBrowserDownload(sampleRows.join('\n'), 'Saimetric_Suppliers_Template.csv');
}

export function parseSuppliersCsv(csvText: string): { suppliers: Supplier[]; errors: string[] } {
  const rows = parseCsvText(csvText);
  const errors: string[] = [];
  const suppliers: Supplier[] = [];

  if (rows.length < 2) {
    return { suppliers: [], errors: ['CSV file is empty or missing headers.'] };
  }

  const rawHeaders = rows[0].map((h) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

  const getColIdx = (keywords: string[]) => {
    return rawHeaders.findIndex((h) => keywords.some((k) => h.includes(k)));
  };

  const idIdx = getColIdx(['supplierid', 'id', 'code', 'vendorid']);
  const nameIdx = getColIdx(['suppliername', 'name', 'vendor', 'company']);
  const catIdx = getColIdx(['category', 'type', 'industry']);
  const contactIdx = getColIdx(['contactperson', 'contact', 'representative', 'person', 'rep']);
  const phoneIdx = getColIdx(['phone', 'mobile', 'cell', 'telephone']);
  const emailIdx = getColIdx(['email', 'mail']);
  const addressIdx = getColIdx(['address', 'location', 'street']);
  const cityIdx = getColIdx(['city', 'town', 'province']);
  const termsIdx = getColIdx(['paymentterms', 'terms', 'payment']);
  const taxIdx = getColIdx(['taxnumber', 'vat', 'tax', 'tin']);
  const accIdx = getColIdx(['accountnumber', 'bankaccount', 'accno', 'account']);
  const statusIdx = getColIdx(['status', 'active']);
  const dateIdx = getColIdx(['date', 'createddate', 'created']);
  const notesIdx = getColIdx(['notes', 'remarks', 'description']);

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawName = nameIdx >= 0 ? row[nameIdx]?.trim() : '';
    const rawId = idIdx >= 0 ? row[idIdx]?.trim() : '';

    if (!rawName && !rawId) continue;

    const supplierId = rawId || `SUP-${String(r).padStart(3, '0')}`;
    const name = rawName || `Supplier ${supplierId}`;
    const category = (catIdx >= 0 && row[catIdx]?.trim()) || 'Groceries & FMCG';
    const contactPerson = (contactIdx >= 0 && row[contactIdx]?.trim()) || '';
    const phone = (phoneIdx >= 0 && row[phoneIdx]?.trim()) || '';
    const email = (emailIdx >= 0 && row[emailIdx]?.trim()) || '';
    const address = (addressIdx >= 0 && row[addressIdx]?.trim()) || '';
    const city = (cityIdx >= 0 && row[cityIdx]?.trim()) || 'Harare';
    const paymentTerms = (termsIdx >= 0 && row[termsIdx]?.trim()) || '30-Day Account Credit';
    const taxNumber = (taxIdx >= 0 && row[taxIdx]?.trim()) || '';
    const accountNumber = (accIdx >= 0 && row[accIdx]?.trim()) || '';
    const rawStatus = (statusIdx >= 0 && row[statusIdx]?.trim().toLowerCase()) || 'active';
    const status = rawStatus.startsWith('inact') || rawStatus === 'n' || rawStatus === 'no' ? 'Inactive' : 'Active';
    const createdDate = (dateIdx >= 0 && row[dateIdx]?.trim()) || new Date().toISOString().split('T')[0];
    const notes = (notesIdx >= 0 && row[notesIdx]?.trim()) || '';

    suppliers.push({
      supplierId,
      name,
      category,
      contactPerson,
      phone,
      email,
      address,
      city,
      paymentTerms,
      taxNumber,
      accountNumber,
      status,
      createdDate,
      notes,
    });
  }

  return { suppliers, errors };
}

export function importSuppliersList(
  suppliers: Supplier[],
  mode: 'merge' | 'replace' = 'merge'
): { added: number; updated: number; errors: string[] } {
  const currentList = getSuppliers();
  let added = 0;
  let updated = 0;
  const errors: string[] = [];

  if (mode === 'replace') {
    try {
      localStorage.setItem('saimetric_suppliers', JSON.stringify(suppliers));
      return { added: suppliers.length, updated: 0, errors: [] };
    } catch (err: any) {
      errors.push(`Failed to replace suppliers: ${err?.message || 'Storage error'}`);
      return { added: 0, updated: 0, errors };
    }
  }

  const currentMap = new Map<string, Supplier>();
  currentList.forEach((s) => currentMap.set(s.supplierId.toUpperCase(), s));

  const merged = [...currentList];

  suppliers.forEach((s) => {
    const key = s.supplierId.toUpperCase();
    const idx = merged.findIndex((existing) => existing.supplierId.toUpperCase() === key);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...s };
      updated++;
    } else {
      merged.unshift(s);
      added++;
    }
  });

  try {
    localStorage.setItem('saimetric_suppliers', JSON.stringify(merged));
  } catch (err: any) {
    errors.push(`Error saving suppliers to storage: ${err?.message || 'Storage error'}`);
  }

  return { added, updated, errors };
}

// ==========================================
// 4. EXPORT ALL REPORTS (EXPORT ONLY CENTER)
// ==========================================

export type SystemReportType =
  | 'FORM1_CASH_COUNT'
  | 'FORM2_CASH_LOGS'
  | 'FORM2_EXPENSES'
  | 'FORM3_CREDIT_SALES'
  | 'FORM3_CUSTOMER_CHANGE'
  | 'FORM4_RECONCILIATION'
  | 'GRN_DAILY_REPORT'
  | 'GRN_VOUCHERS'
  | 'STOCK_MOVEMENTS'
  | 'POS_SALES_ORDERS'
  | 'STAFF_SALESPEOPLE'
  | 'EXECUTIVE_SUMMARY';

export interface ReportExportMeta {
  type: SystemReportType;
  title: string;
  category: 'Cash Balancing' | 'Debtors & Change' | 'Inventory & Warehouse' | 'POS & Sales' | 'System';
  description: string;
  badge: string;
  color: string;
}

export const ALL_SYSTEM_REPORTS: ReportExportMeta[] = [
  {
    type: 'FORM1_CASH_COUNT',
    title: 'Form 1: Cash Count & Denominations',
    category: 'Cash Balancing',
    description: 'Physical cash notes audit ($100, $50, $20, $10, $5, $1, $2, $0.50 coins) recorded per shift.',
    badge: 'Form 1',
    color: 'from-amber-500 to-orange-600',
  },
  {
    type: 'FORM2_CASH_LOGS',
    title: 'Form 2: Cash Movements Register (In / Out)',
    category: 'Cash Balancing',
    description: 'Complete chronological audit of cash deposits, payouts, staff advances, and till transfers.',
    badge: 'Form 2',
    color: 'from-emerald-600 to-teal-700',
  },
  {
    type: 'FORM2_EXPENSES',
    title: 'Form 2: Operational Expenses Ledger',
    category: 'Cash Balancing',
    description: 'Petty cash expenses with line classifications, staff references, and vendor descriptions.',
    badge: 'Expenses',
    color: 'from-rose-500 to-red-700',
  },
  {
    type: 'FORM3_CREDIT_SALES',
    title: 'Form 3: Customer Credit Sales & Debtor Ledger',
    category: 'Debtors & Change',
    description: 'Aging debt summary, credit issued, repayments, overdue balances, and customer credit limits.',
    badge: 'Debtors',
    color: 'from-orange-600 to-amber-700',
  },
  {
    type: 'FORM3_CUSTOMER_CHANGE',
    title: 'Form 3: Customer Change Held in Trust',
    category: 'Debtors & Change',
    description: 'Unsettled change left behind by customers at the counter, payout settlements, and trust balances.',
    badge: 'Change Trust',
    color: 'from-teal-600 to-emerald-800',
  },
  {
    type: 'FORM4_RECONCILIATION',
    title: 'Form 4: Cash Drawer Balancing & Audit Reconciliation',
    category: 'Cash Balancing',
    description: 'Calculated expected drawer cash vs counted cash, surplus/shortage variances, and admin sign-offs.',
    badge: 'Reconciliation',
    color: 'from-purple-600 to-indigo-800',
  },
  {
    type: 'GRN_DAILY_REPORT',
    title: 'Daily Goods Received Admin Inward Report',
    category: 'Inventory & Warehouse',
    description: 'Daily stock valuation inward by branch, supplier, category, cases & singles breakdown, and Rule A logs.',
    badge: 'Daily GRN',
    color: 'from-blue-600 to-indigo-700',
  },
  {
    type: 'GRN_VOUCHERS',
    title: 'Supplier Delivery Invoices & GRN Vouchers',
    category: 'Inventory & Warehouse',
    description: 'Itemized supplier receiving invoices with purchase orders, unit packaging ratios, and costings.',
    badge: 'Vouchers',
    color: 'from-cyan-600 to-blue-800',
  },
  {
    type: 'STOCK_MOVEMENTS',
    title: 'Stock Movements & Case-Break Audit Trail',
    category: 'Inventory & Warehouse',
    description: 'Immutable ledger of goods receipts, automatic Rule A case breaks, POS sales dips, and closing stock.',
    badge: 'Audit Trail',
    color: 'from-emerald-700 to-green-900',
  },
  {
    type: 'POS_SALES_ORDERS',
    title: 'POS Sales Receipts & Customer Invoices',
    category: 'POS & Sales',
    description: 'Every sale ticket, cashier ID, payment method, items breakdown, line discounts, and totals.',
    badge: 'Sales Orders',
    color: 'from-violet-600 to-purple-800',
  },
  {
    type: 'STAFF_SALESPEOPLE',
    title: 'Staff Directory, Roles & Permissions Matrix',
    category: 'System',
    description: 'Cashier accounts, roles, authorization permissions, and active status.',
    badge: 'Staff',
    color: 'from-slate-600 to-slate-800',
  },
  {
    type: 'EXECUTIVE_SUMMARY',
    title: 'Executive Financial & Operational Summary',
    category: 'System',
    description: 'High-level aggregated key performance indicators, gross sales, net margins, inventory valuation, and cash standing.',
    badge: 'Executive KPI',
    color: 'from-indigo-600 to-pink-600',
  },
];

export function generateReportCsv(reportType: SystemReportType): string {
  switch (reportType) {
    case 'FORM1_CASH_COUNT': {
      const records = getCashCounts();
      const headers = ['Record ID', 'Timestamp', 'Date', 'Staff ID', 'Staff Name', 'Total Cash Out ($)', 'Denominations Breakdown', 'Notes'];
      const lines = [headers.join(',')];
      records.forEach((r) => {
        const denomStr = Object.entries(r.denominations || {})
          .map(([k, v]) => `$${k}x${v}`)
          .join('; ');
        lines.push([
          escapeCsvValue(r.id),
          escapeCsvValue(r.timestamp),
          escapeCsvValue(r.date),
          escapeCsvValue(r.staffId),
          escapeCsvValue(r.staffName),
          escapeCsvValue(r.finalCashOutTotal.toFixed(2)),
          escapeCsvValue(denomStr),
          escapeCsvValue(r.notes || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'FORM2_CASH_LOGS': {
      const logs = getCashLogs();
      const headers = ['Log ID', 'Timestamp', 'Date', 'Staff ID', 'Staff Name', 'Line / Category', 'Description', 'Cash In ($)', 'Cash Out ($)', 'Reference'];
      const lines = [headers.join(',')];
      logs.forEach((l) => {
        lines.push([
          escapeCsvValue(l.id),
          escapeCsvValue(l.timestamp),
          escapeCsvValue(l.date),
          escapeCsvValue(l.staffId),
          escapeCsvValue(l.staffName),
          escapeCsvValue(l.line),
          escapeCsvValue(l.description),
          escapeCsvValue(l.in.toFixed(2)),
          escapeCsvValue(l.out.toFixed(2)),
          escapeCsvValue(l.reference || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'FORM2_EXPENSES': {
      const expenses = getExpenses();
      const headers = ['Expense ID', 'Date', 'Category', 'Description', 'Amount ($)', 'Staff ID', 'Staff Name', 'Payment Method', 'Receipt Ref'];
      const lines = [headers.join(',')];
      expenses.forEach((e) => {
        lines.push([
          escapeCsvValue(e.id),
          escapeCsvValue(e.date),
          escapeCsvValue(e.category),
          escapeCsvValue(e.description),
          escapeCsvValue(e.amount.toFixed(2)),
          escapeCsvValue(e.staffId),
          escapeCsvValue(e.staffName),
          escapeCsvValue(e.paymentMethod),
          escapeCsvValue(e.receiptRef || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'FORM3_CREDIT_SALES': {
      const credits = getCreditSales();
      const headers = ['Credit ID', 'Timestamp', 'Date', 'Customer ID', 'Customer Name', 'Amount Given ($)', 'Repaid In ($)', 'Out Standing ($)', 'Item Description', 'Due Date', 'Status', 'Staff ID', 'Staff Name', 'Notes'];
      const lines = [headers.join(',')];
      credits.forEach((c) => {
        lines.push([
          escapeCsvValue(c.id),
          escapeCsvValue(c.timestamp),
          escapeCsvValue(c.date),
          escapeCsvValue(c.customerId || ''),
          escapeCsvValue(c.customerName),
          escapeCsvValue(c.amount.toFixed(2)),
          escapeCsvValue((c.in || 0).toFixed(2)),
          escapeCsvValue((c.out || c.amount).toFixed(2)),
          escapeCsvValue(c.itemDescription || ''),
          escapeCsvValue(c.dueDate || ''),
          escapeCsvValue(c.status),
          escapeCsvValue(c.staffId),
          escapeCsvValue(c.staffName),
          escapeCsvValue(c.notes || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'FORM3_CUSTOMER_CHANGE': {
      const changes = getCustomerChanges();
      const headers = ['Change ID', 'Timestamp', 'Date', 'Customer ID', 'Customer Name', 'Change Deposited In ($)', 'Change Settled Out ($)', 'Staff ID', 'Staff Name', 'Notes'];
      const lines = [headers.join(',')];
      changes.forEach((c) => {
        lines.push([
          escapeCsvValue(c.id),
          escapeCsvValue(c.timestamp),
          escapeCsvValue(c.date),
          escapeCsvValue(c.customerId || ''),
          escapeCsvValue(c.customerName),
          escapeCsvValue(c.in.toFixed(2)),
          escapeCsvValue(c.out.toFixed(2)),
          escapeCsvValue(c.staffId),
          escapeCsvValue(c.staffName),
          escapeCsvValue(c.notes || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'FORM4_RECONCILIATION': {
      const recons = getReconciliations();
      const headers = ['Recon ID', 'Timestamp', 'Date', 'Staff ID', 'Staff Name', 'Opening Float ($)', 'Actual Cash Count ($)', 'Expected Cash ($)', 'Variance Amount ($)', 'Status', 'Notes'];
      const lines = [headers.join(',')];
      recons.forEach((r) => {
        lines.push([
          escapeCsvValue(r.id),
          escapeCsvValue(r.timestamp),
          escapeCsvValue(r.date),
          escapeCsvValue(r.staffId),
          escapeCsvValue(r.staffName),
          escapeCsvValue(r.openingFloat.toFixed(2)),
          escapeCsvValue(r.actualCashCount.toFixed(2)),
          escapeCsvValue(r.expectedCash.toFixed(2)),
          escapeCsvValue(r.variance.toFixed(2)),
          escapeCsvValue(r.status),
          escapeCsvValue(r.notes || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'GRN_DAILY_REPORT': {
      const summary = getDailyGoodsReceivedReport();
      const headers = ['GRN Voucher ID', 'Invoice No', 'PO No', 'Date', 'Branch', 'Supplier', 'Item ID', 'Item Name', 'Category', 'Units/Case', 'Receive As', 'Rec Cases', 'Rec Singles', 'Cost/Case ($)', 'Cost/Unit ($)', 'Selling Price ($)', 'Margin %', 'Line Total ($)', 'Rule A Auto-Break'];
      const lines = [headers.join(',')];
      summary.itemizedLines.forEach((l) => {
        lines.push([
          escapeCsvValue(l.grnId),
          escapeCsvValue(l.invoiceNo),
          escapeCsvValue(l.purchaseOrderNo || ''),
          escapeCsvValue(l.date),
          escapeCsvValue(l.branchName),
          escapeCsvValue(l.supplier),
          escapeCsvValue(l.itemId),
          escapeCsvValue(l.itemName),
          escapeCsvValue(l.category),
          escapeCsvValue(l.unitsPerCase),
          escapeCsvValue(l.receiveAs),
          escapeCsvValue(l.receivedCases),
          escapeCsvValue(l.receivedSingles),
          escapeCsvValue(l.costPerCase.toFixed(2)),
          escapeCsvValue(l.costPerUnit.toFixed(2)),
          escapeCsvValue(l.sellingPrice?.toFixed(2) || '0.00'),
          escapeCsvValue(l.marginPercent?.toFixed(1) || '0.0'),
          escapeCsvValue(l.lineTotal.toFixed(2)),
          escapeCsvValue(l.autoBrokenRuleA ? 'YES' : 'NO'),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'GRN_VOUCHERS': {
      const vouchers = getSupplierInvoiceVouchers();
      const headers = ['Voucher ID', 'Invoice No', 'PO No', 'Date', 'Supplier', 'Branch', 'Payment Terms', 'Total Cases', 'Total Singles', 'Total Units', 'Total Amount ($)', 'Rule A Triggers', 'Staff ID', 'Staff Name', 'Notes'];
      const lines = [headers.join(',')];
      vouchers.forEach((v) => {
        lines.push([
          escapeCsvValue(v.voucherId),
          escapeCsvValue(v.invoiceNo),
          escapeCsvValue(v.purchaseOrderNo || ''),
          escapeCsvValue(v.date),
          escapeCsvValue(v.supplier),
          escapeCsvValue(v.branchName || 'Main Branch'),
          escapeCsvValue(v.paymentTerms || '30-Day Credit'),
          escapeCsvValue(v.totalCases),
          escapeCsvValue(v.totalSingles),
          escapeCsvValue(v.totalUnits),
          escapeCsvValue(v.totalInvoiceAmount.toFixed(2)),
          escapeCsvValue(v.ruleATriggeredCount || 0),
          escapeCsvValue(v.staffId),
          escapeCsvValue(v.staffName),
          escapeCsvValue(v.notes || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'STOCK_MOVEMENTS': {
      const movements = getStockMovements();
      const headers = ['Txn ID', 'Timestamp', 'Date', 'Item ID', 'Item Name', 'Txn Type', 'Cases Change', 'Singles Change', 'Closing Cases', 'Closing Singles', 'Action / Prompt Reason', 'Reference ID', 'Staff ID', 'Staff Name'];
      const lines = [headers.join(',')];
      movements.forEach((m) => {
        lines.push([
          escapeCsvValue(m.txnId),
          escapeCsvValue(m.timestamp),
          escapeCsvValue(m.date),
          escapeCsvValue(m.itemId),
          escapeCsvValue(m.itemName),
          escapeCsvValue(m.txnType),
          escapeCsvValue(m.casesChange !== undefined ? m.casesChange : m.qtyCases),
          escapeCsvValue(m.singlesChange !== undefined ? m.singlesChange : m.qtySingles),
          escapeCsvValue(m.closingCases),
          escapeCsvValue(m.closingSingles),
          escapeCsvValue(m.promptShown || m.actionTaken || m.reason || ''),
          escapeCsvValue(m.referenceId || ''),
          escapeCsvValue(m.staffId),
          escapeCsvValue(m.staffName || ''),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'POS_SALES_ORDERS': {
      const sales = getSales();
      const headers = ['Invoice ID', 'Timestamp', 'Date', 'Customer Name', 'Customer ID', 'Payment Method', 'Subtotal ($)', 'Discount ($)', 'Total ($)', 'Amount Tendered ($)', 'Change ($)', 'Cashier ID', 'Cashier Name', 'Items Count', 'Item Summary'];
      const lines = [headers.join(',')];
      sales.forEach((s) => {
        const itemSummary = (s.items || [])
          .map((i) => `${i.name} (x${i.quantity} @ $${i.unitPrice})`)
          .join('; ');
        lines.push([
          escapeCsvValue(s.id),
          escapeCsvValue(s.timestamp),
          escapeCsvValue(s.date),
          escapeCsvValue(s.customerName),
          escapeCsvValue(s.customerId || ''),
          escapeCsvValue(s.paymentMethod),
          escapeCsvValue(s.subtotal.toFixed(2)),
          escapeCsvValue((s.discount || 0).toFixed(2)),
          escapeCsvValue(s.total.toFixed(2)),
          escapeCsvValue((s.cashTendered || s.total).toFixed(2)),
          escapeCsvValue((s.changeDue || 0).toFixed(2)),
          escapeCsvValue(s.staffId),
          escapeCsvValue(s.staffName),
          escapeCsvValue((s.items || []).length),
          escapeCsvValue(itemSummary),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'STAFF_SALESPEOPLE': {
      const staff = getSalespeople();
      const headers = ['Staff ID', 'Full Name', 'Role', 'Phone Number', 'Active Status', 'Can Edit Prices', 'Can Apply Discounts', 'Can Manage Inventory', 'Can Access Reports'];
      const lines = [headers.join(',')];
      staff.forEach((s) => {
        lines.push([
          escapeCsvValue(s.id),
          escapeCsvValue(s.name),
          escapeCsvValue(s.role),
          escapeCsvValue(s.phone || ''),
          escapeCsvValue(s.active),
          escapeCsvValue(s.permissions?.canEditCartPrice ? 'YES' : 'NO'),
          escapeCsvValue(s.permissions?.canApplyCartDiscount ? 'YES' : 'NO'),
          escapeCsvValue(s.permissions?.canManageInventory ? 'YES' : 'NO'),
          escapeCsvValue(s.permissions?.canAccessReports ? 'YES' : 'NO'),
        ].join(','));
      });
      return lines.join('\n');
    }

    case 'EXECUTIVE_SUMMARY': {
      const items = getInventoryItems();
      const sales = getSales();
      const credits = getCustomerCreditReport();
      const changes = getCustomerChangeReport();
      const recons = getReconciliations();

      const totalInventoryValuation = items.reduce(
        (acc, i) => acc + (i.stockCases * i.costPerCase + i.stockSingles * i.costPerUnit),
        0
      );
      const totalInventorySellValue = items.reduce(
        (acc, i) => acc + (i.stockCases * (i.sellPriceCase || i.sellPriceUnit * i.unitsPerCase) + i.stockSingles * i.sellPriceUnit),
        0
      );
      const totalSalesRevenue = sales.reduce((acc, s) => acc + s.total, 0);
      const totalCreditDebt = credits.summary.totalOutstandingDebt;
      const totalCustomerTrustChange = changes.summary.totalChangeOwed;

      const lines = [
        'Executive Operational KPI,Metric Value ($),Notes',
        `Total Master Inventory Items,${items.length},Active SKU catalog`,
        `Total Inventory Stock Valuation (At Cost),$${totalInventoryValuation.toFixed(2)},Current warehouse cost valuation`,
        `Total Inventory Retail Valuation,$${totalInventorySellValue.toFixed(2)},Potential sales revenue`,
        `Total Lifetime POS Revenue,$${totalSalesRevenue.toFixed(2)},Completed POS transactions (${sales.length} receipts)`,
        `Total Outstanding Customer Credit Debt,$${totalCreditDebt.toFixed(2)},${credits.summary.totalDebtorsCount} debtors owing`,
        `Total Customer Change Held in Trust,$${totalCustomerTrustChange.toFixed(2)},Unsettled change balances`,
        `Total Form 4 Shift Balancing Audits,${recons.length},Historical cash drawer reconciliations`,
      ];
      return lines.join('\n');
    }
  }
}

export function downloadReportCsv(reportType: SystemReportType) {
  const csv = generateReportCsv(reportType);
  const dateStr = new Date().toISOString().split('T')[0];
  const meta = ALL_SYSTEM_REPORTS.find((r) => r.type === reportType);
  const cleanTitle = (meta?.title || reportType).replace(/[^a-zA-Z0-9]/g, '_');
  triggerBrowserDownload(csv, `Saimetric_${cleanTitle}_${dateStr}.csv`);
}

export function downloadAllReportsCombinedJson() {
  const bundle = {
    exportDate: new Date().toISOString(),
    system: 'Saimetric POS & Inventory Suite',
    inventory: getInventoryItems(),
    customers: getCustomers(),
    suppliers: getSuppliers(),
    cashCounts: getCashCounts(),
    cashLogs: getCashLogs(),
    expenses: getExpenses(),
    creditSales: getCreditSales(),
    customerChanges: getCustomerChanges(),
    reconciliations: getReconciliations(),
    supplierInvoices: getSupplierInvoiceVouchers(),
    stockMovements: getStockMovements(),
    posSales: getSales(),
    staff: getSalespeople(),
    creditReportSummary: getCustomerCreditReport().summary,
    changeReportSummary: getCustomerChangeReport().summary,
  };

  const json = JSON.stringify(bundle, null, 2);
  const dateStr = new Date().toISOString().split('T')[0];
  triggerBrowserDownload(json, `Saimetric_ALL_REPORTS_MASTER_BACKUP_${dateStr}.json`, 'application/json');
}
