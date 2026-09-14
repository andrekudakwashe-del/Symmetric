import {
  DataDictionaryItem,
  TableRelationship,
  UserRole,
  SavedReportTemplate,
  ReportPermission,
  ReportJsonConfig,
} from '../types';

// ============================================================================
// DEFAULT SEED DATA FOR DATA DICTIONARY
// ============================================================================

export const INITIAL_DATA_DICTIONARY: DataDictionaryItem[] = [
  // 1. SALES
  { id: 'dd-sales-id', table_name: 'sales', column_name: 'id', display_name: 'Invoice Number', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-date', table_name: 'sales', column_name: 'date', display_name: 'Sale Date', data_type: 'date', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-time', table_name: 'sales', column_name: 'time', display_name: 'Sale Time', data_type: 'string', is_filterable: false, is_groupable: false },
  { id: 'dd-sales-product_id', table_name: 'sales', column_name: 'product_id', display_name: 'Product ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-product_name', table_name: 'sales', column_name: 'product_name', display_name: 'Product Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-category', table_name: 'sales', column_name: 'category', display_name: 'Product Category', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-quantity', table_name: 'sales', column_name: 'quantity', display_name: 'Quantity Sold', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-sales-unit_price', table_name: 'sales', column_name: 'unit_price', display_name: 'Unit Price ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-sales-total_amount', table_name: 'sales', column_name: 'total_amount', display_name: 'Total Amount ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-sales-discount', table_name: 'sales', column_name: 'discount', display_name: 'Discount ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-sales-customer_id', table_name: 'sales', column_name: 'customer_id', display_name: 'Customer ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-customer_name', table_name: 'sales', column_name: 'customer_name', display_name: 'Customer Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-staff_id', table_name: 'sales', column_name: 'staff_id', display_name: 'Cashier ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-staff_name', table_name: 'sales', column_name: 'staff_name', display_name: 'Cashier Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-payment_method', table_name: 'sales', column_name: 'payment_method', display_name: 'Payment Method', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-sales-status', table_name: 'sales', column_name: 'status', display_name: 'Invoice Status', data_type: 'string', is_filterable: true, is_groupable: true },

  // 2. PRODUCTS
  { id: 'dd-prod-id', table_name: 'products', column_name: 'id', display_name: 'Product ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-prod-name', table_name: 'products', column_name: 'name', display_name: 'Product Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-prod-category', table_name: 'products', column_name: 'category', display_name: 'Category', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-prod-price', table_name: 'products', column_name: 'price', display_name: 'Selling Price ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-prod-cost', table_name: 'products', column_name: 'cost', display_name: 'Cost Price ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-prod-stock', table_name: 'products', column_name: 'stock', display_name: 'Current In-Stock', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-prod-supplier_id', table_name: 'products', column_name: 'supplier_id', display_name: 'Supplier ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-prod-sku', table_name: 'products', column_name: 'sku', display_name: 'Barcode / SKU', data_type: 'string', is_filterable: true, is_groupable: false },

  // 3. INVENTORY
  { id: 'dd-inv-id', table_name: 'inventory', column_name: 'id', display_name: 'Inventory ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-inv-product_id', table_name: 'inventory', column_name: 'product_id', display_name: 'Product ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-inv-name', table_name: 'inventory', column_name: 'name', display_name: 'Item Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-inv-category', table_name: 'inventory', column_name: 'category', display_name: 'Category', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-inv-stock_level', table_name: 'inventory', column_name: 'stock_level', display_name: 'Stock Level Qty', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-inv-min_stock', table_name: 'inventory', column_name: 'min_stock', display_name: 'Reorder Level', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-inv-unit_cost', table_name: 'inventory', column_name: 'unit_cost', display_name: 'Unit Cost ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-inv-total_value', table_name: 'inventory', column_name: 'total_value', display_name: 'Total Stock Valuation ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-inv-status', table_name: 'inventory', column_name: 'status', display_name: 'Stock Health', data_type: 'string', is_filterable: true, is_groupable: true },

  // 4. CUSTOMERS
  { id: 'dd-cust-id', table_name: 'customers', column_name: 'id', display_name: 'Customer ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-cust-name', table_name: 'customers', column_name: 'name', display_name: 'Customer Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-cust-phone', table_name: 'customers', column_name: 'phone', display_name: 'Phone Number', data_type: 'string', is_filterable: true, is_groupable: false },
  { id: 'dd-cust-address', table_name: 'customers', column_name: 'address', display_name: 'Address / City', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-cust-created_date', table_name: 'customers', column_name: 'created_date', display_name: 'Registration Date', data_type: 'date', is_filterable: true, is_groupable: true },

  // 5. SUPPLIERS
  { id: 'dd-supp-id', table_name: 'suppliers', column_name: 'id', display_name: 'Supplier ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-supp-name', table_name: 'suppliers', column_name: 'name', display_name: 'Supplier Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-supp-contact_person', table_name: 'suppliers', column_name: 'contact_person', display_name: 'Contact Person', data_type: 'string', is_filterable: true, is_groupable: false },
  { id: 'dd-supp-phone', table_name: 'suppliers', column_name: 'phone', display_name: 'Phone Number', data_type: 'string', is_filterable: true, is_groupable: false },
  { id: 'dd-supp-category', table_name: 'suppliers', column_name: 'category', display_name: 'Supplier Category', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-supp-payment_terms', table_name: 'suppliers', column_name: 'payment_terms', display_name: 'Payment Terms', data_type: 'string', is_filterable: true, is_groupable: true },

  // 6. STAFF
  { id: 'dd-staff-id', table_name: 'staff', column_name: 'id', display_name: 'Staff ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-staff-name', table_name: 'staff', column_name: 'name', display_name: 'Staff Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-staff-role', table_name: 'staff', column_name: 'role', display_name: 'Role', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-staff-phone', table_name: 'staff', column_name: 'phone', display_name: 'Contact Phone', data_type: 'string', is_filterable: true, is_groupable: false },
  { id: 'dd-staff-active', table_name: 'staff', column_name: 'active', display_name: 'Active Status (Y/N)', data_type: 'string', is_filterable: true, is_groupable: true },

  // 7. DELIVERIES
  { id: 'dd-del-id', table_name: 'deliveries', column_name: 'id', display_name: 'GRN / Voucher #', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-del-supplier_id', table_name: 'deliveries', column_name: 'supplier_id', display_name: 'Supplier ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-del-supplier_name', table_name: 'deliveries', column_name: 'supplier_name', display_name: 'Supplier Name', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-del-date', table_name: 'deliveries', column_name: 'date', display_name: 'Delivery Date', data_type: 'date', is_filterable: true, is_groupable: true },
  { id: 'dd-del-total_amount', table_name: 'deliveries', column_name: 'total_amount', display_name: 'Total Invoice Value ($)', data_type: 'number', is_filterable: true, is_groupable: false },
  { id: 'dd-del-received_by_id', table_name: 'deliveries', column_name: 'received_by_id', display_name: 'Receiving Staff ID', data_type: 'string', is_filterable: true, is_groupable: true },
  { id: 'dd-del-status', table_name: 'deliveries', column_name: 'status', display_name: 'Delivery Status', data_type: 'string', is_filterable: true, is_groupable: true },
];

// ============================================================================
// TABLE RELATIONSHIPS (AUTO-SUGGEST JOINS)
// ============================================================================

export const INITIAL_TABLE_RELATIONSHIPS: TableRelationship[] = [
  {
    id: 'rel-sales-products',
    from_table: 'sales',
    from_column: 'product_id',
    to_table: 'products',
    to_column: 'id',
    relationship_name: 'sales.product_id -> products.id (Line Item Product)',
  },
  {
    id: 'rel-products-suppliers',
    from_table: 'products',
    from_column: 'supplier_id',
    to_table: 'suppliers',
    to_column: 'id',
    relationship_name: 'products.supplier_id -> suppliers.id (Product Primary Supplier)',
  },
  {
    id: 'rel-sales-customers',
    from_table: 'sales',
    from_column: 'customer_id',
    to_table: 'customers',
    to_column: 'id',
    relationship_name: 'sales.customer_id -> customers.id (Sale Customer)',
  },
  {
    id: 'rel-sales-staff',
    from_table: 'sales',
    from_column: 'staff_id',
    to_table: 'staff',
    to_column: 'id',
    relationship_name: 'sales.staff_id -> staff.id (Sale Cashier)',
  },
  {
    id: 'rel-inventory-products',
    from_table: 'inventory',
    from_column: 'product_id',
    to_table: 'products',
    to_column: 'id',
    relationship_name: 'inventory.product_id -> products.id (Inventory to Master Product)',
  },
  {
    id: 'rel-deliveries-suppliers',
    from_table: 'deliveries',
    from_column: 'supplier_id',
    to_table: 'suppliers',
    to_column: 'id',
    relationship_name: 'deliveries.supplier_id -> suppliers.id (Goods Received Supplier)',
  },
  {
    id: 'rel-deliveries-staff',
    from_table: 'deliveries',
    from_column: 'received_by_id',
    to_table: 'staff',
    to_column: 'id',
    relationship_name: 'deliveries.received_by_id -> staff.id (Receiving Clerk)',
  },
];

// ============================================================================
// USER ROLES
// ============================================================================

export const INITIAL_USER_ROLES: UserRole[] = [
  { id: 'super_admin', role_name: 'Super Admin', description: 'Complete unrestricted access to create, edit, run, and share all reports.' },
  { id: 'manager', role_name: 'Manager', description: 'Store manager with operational reporting, analytical viewing, and export rights.' },
  { id: 'accountant', role_name: 'Accountant', description: 'Financial reporting, inventory valuation, debtor audits, and data exporting.' },
  { id: 'cashier', role_name: 'Cashier', description: 'Frontline POS register user with access to assigned daily sales summaries.' },
];

// ============================================================================
// INITIAL SEED SAVED REPORT TEMPLATES
// ============================================================================

export const INITIAL_REPORT_TEMPLATES: SavedReportTemplate[] = [
  {
    id: 'template-sales-by-supplier',
    name: 'Sales by Supplier',
    description: 'Aggregates sales revenue and item transaction count grouped by supplier company.',
    created_by: 'Super Admin (001)',
    created_at: '2026-08-15T08:00:00.000Z',
    json_config: {
      name: 'Sales by Supplier',
      description: 'Aggregates sales revenue and item transaction count grouped by supplier company.',
      tables: ['sales', 'products', 'suppliers'],
      joins: [
        { from: 'sales.product_id', to: 'products.id', type: 'INNER' },
        { from: 'products.supplier_id', to: 'suppliers.id', type: 'INNER' },
      ],
      columns: ['suppliers.name'],
      aggregates: [
        { column: 'sales.total_amount', func: 'SUM', alias: 'Total Revenue ($)' },
        { column: 'sales.id', func: 'COUNT', alias: 'Invoice Count' },
      ],
      group_by: ['suppliers.name'],
      filters: [
        { id: 'f1', column: 'sales.date', op: 'last_30_days' },
      ],
      sort_by: [{ column: 'SUM(sales.total_amount)', direction: 'DESC' }],
      chart_type: 'bar',
      chart_x_axis: 'suppliers.name',
      chart_y_axis: 'SUM(sales.total_amount)',
    },
  },
  {
    id: 'template-top-products',
    name: 'Top Selling Products by Revenue',
    description: 'Best-performing stock items ranked by total units sold and gross earnings.',
    created_by: 'Super Admin (001)',
    created_at: '2026-08-20T10:30:00.000Z',
    json_config: {
      name: 'Top Selling Products by Revenue',
      description: 'Best-performing stock items ranked by total units sold and gross earnings.',
      tables: ['sales', 'products'],
      joins: [
        { from: 'sales.product_id', to: 'products.id', type: 'INNER' },
      ],
      columns: ['products.name', 'products.category'],
      aggregates: [
        { column: 'sales.quantity', func: 'SUM', alias: 'Units Sold' },
        { column: 'sales.total_amount', func: 'SUM', alias: 'Gross Revenue ($)' },
      ],
      group_by: ['products.name', 'products.category'],
      filters: [
        { id: 'f2', column: 'sales.date', op: 'last_30_days' },
      ],
      sort_by: [{ column: 'SUM(sales.total_amount)', direction: 'DESC' }],
      chart_type: 'bar',
      chart_x_axis: 'products.name',
      chart_y_axis: 'SUM(sales.total_amount)',
      limit: 10,
    },
  },
  {
    id: 'template-inventory-valuation',
    name: 'Inventory Valuation by Category',
    description: 'Current on-hand stock quantities and aggregate valuation breakdown by inventory category.',
    created_by: 'Super Admin (001)',
    created_at: '2026-08-22T14:15:00.000Z',
    json_config: {
      name: 'Inventory Valuation by Category',
      description: 'Current on-hand stock quantities and aggregate valuation breakdown by inventory category.',
      tables: ['inventory'],
      joins: [],
      columns: ['inventory.category'],
      aggregates: [
        { column: 'inventory.id', func: 'COUNT', alias: 'Product Count' },
        { column: 'inventory.stock_level', func: 'SUM', alias: 'Total Units' },
        { column: 'inventory.total_value', func: 'SUM', alias: 'Total Valuation ($)' },
      ],
      group_by: ['inventory.category'],
      filters: [],
      sort_by: [{ column: 'SUM(inventory.total_value)', direction: 'DESC' }],
      chart_type: 'pie',
      chart_x_axis: 'inventory.category',
      chart_y_axis: 'SUM(inventory.total_value)',
    },
  },
  {
    id: 'template-cashier-performance',
    name: 'Cashier Sales Performance',
    description: 'Total revenue and tickets handled per staff member for commission & shift audit.',
    created_by: 'Super Admin (001)',
    created_at: '2026-08-25T09:00:00.000Z',
    json_config: {
      name: 'Cashier Sales Performance',
      description: 'Total revenue and tickets handled per staff member for commission & shift audit.',
      tables: ['sales', 'staff'],
      joins: [
        { from: 'sales.staff_id', to: 'staff.id', type: 'INNER' },
      ],
      columns: ['staff.name', 'staff.role'],
      aggregates: [
        { column: 'sales.id', func: 'COUNT', alias: 'Transactions' },
        { column: 'sales.total_amount', func: 'SUM', alias: 'Total Sales ($)' },
        { column: 'sales.discount', func: 'SUM', alias: 'Discounts Given ($)' },
      ],
      group_by: ['staff.name', 'staff.role'],
      filters: [
        { id: 'f3', column: 'sales.date', op: 'last_30_days' },
      ],
      sort_by: [{ column: 'SUM(sales.total_amount)', direction: 'DESC' }],
      chart_type: 'bar',
      chart_x_axis: 'staff.name',
      chart_y_axis: 'SUM(sales.total_amount)',
    },
  },
];

// ============================================================================
// INITIAL SEED REPORT PERMISSIONS
// ============================================================================

export const INITIAL_REPORT_PERMISSIONS: ReportPermission[] = [
  // Sales by Supplier
  { id: 'perm-1-admin', report_id: 'template-sales-by-supplier', role_id: 'super_admin', can_view: true, can_edit: true, can_export: true },
  { id: 'perm-1-mgr', report_id: 'template-sales-by-supplier', role_id: 'manager', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-1-acct', report_id: 'template-sales-by-supplier', role_id: 'accountant', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-1-cashier', report_id: 'template-sales-by-supplier', role_id: 'cashier', can_view: false, can_edit: false, can_export: false },

  // Top Products
  { id: 'perm-2-admin', report_id: 'template-top-products', role_id: 'super_admin', can_view: true, can_edit: true, can_export: true },
  { id: 'perm-2-mgr', report_id: 'template-top-products', role_id: 'manager', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-2-acct', report_id: 'template-top-products', role_id: 'accountant', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-2-cashier', report_id: 'template-top-products', role_id: 'cashier', can_view: true, can_edit: false, can_export: false },

  // Inventory Valuation
  { id: 'perm-3-admin', report_id: 'template-inventory-valuation', role_id: 'super_admin', can_view: true, can_edit: true, can_export: true },
  { id: 'perm-3-mgr', report_id: 'template-inventory-valuation', role_id: 'manager', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-3-acct', report_id: 'template-inventory-valuation', role_id: 'accountant', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-3-cashier', report_id: 'template-inventory-valuation', role_id: 'cashier', can_view: false, can_edit: false, can_export: false },

  // Cashier Performance
  { id: 'perm-4-admin', report_id: 'template-cashier-performance', role_id: 'super_admin', can_view: true, can_edit: true, can_export: true },
  { id: 'perm-4-mgr', report_id: 'template-cashier-performance', role_id: 'manager', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-4-acct', report_id: 'template-cashier-performance', role_id: 'accountant', can_view: true, can_edit: false, can_export: true },
  { id: 'perm-4-cashier', report_id: 'template-cashier-performance', role_id: 'cashier', can_view: true, can_edit: false, can_export: false },
];
