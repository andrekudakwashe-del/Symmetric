package com.saimetric.pos.reports

import com.saimetric.pos.reports.entities.DataDictionaryEntity
import com.saimetric.pos.reports.entities.ReportDao
import com.saimetric.pos.reports.entities.TableRelationshipEntity
import com.saimetric.pos.reports.entities.UserRoleEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * DataDictionaryManager scans Room DB tables and populates the `data_dictionary`
 * and `table_relationships` dynamically.
 *
 * Implements Part 1 & Part 4: No hardcoding. To add a new table later, simply insert
 * rows into data_dictionary without code changes.
 */
class DataDictionaryManager(private val reportDao: ReportDao) {

    suspend fun seedDataDictionaryIfEmpty() = withContext(Dispatchers.IO) {
        val existing = reportDao.getAllDataDictionary()
        if (existing.isNotEmpty()) return@withContext

        // 1. SEED DATA DICTIONARY (sales, products, inventory, customers, suppliers, staff, deliveries)
        val dictionaryItems = listOf(
            // SALES TABLE
            DataDictionaryEntity("dd_sales_id", "sales", "id", "Invoice Number", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_date", "sales", "date", "Sale Date", "date", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_time", "sales", "time", "Sale Time", "string", isFilterable = false, isGroupable = false),
            DataDictionaryEntity("dd_sales_product_id", "sales", "product_id", "Product ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_product_name", "sales", "product_name", "Product Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_category", "sales", "category", "Category", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_quantity", "sales", "quantity", "Quantity Sold", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_sales_unit_price", "sales", "unit_price", "Unit Price ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_sales_total_amount", "sales", "total_amount", "Total Sales Amount ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_sales_discount", "sales", "discount", "Discount Applied ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_sales_customer_id", "sales", "customer_id", "Customer ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_customer_name", "sales", "customer_name", "Customer Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_staff_id", "sales", "staff_id", "Cashier ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_staff_name", "sales", "staff_name", "Cashier Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_payment_method", "sales", "payment_method", "Payment Method", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_sales_status", "sales", "status", "Sale Status", "string", isFilterable = true, isGroupable = true),

            // PRODUCTS TABLE
            DataDictionaryEntity("dd_prod_id", "products", "id", "Product Code", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_prod_name", "products", "name", "Product Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_prod_category", "products", "category", "Department / Category", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_prod_price", "products", "price", "Retail Price ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_prod_cost", "products", "cost", "Cost Price ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_prod_stock", "products", "stock", "Current Stock Qty", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_prod_supplier_id", "products", "supplier_id", "Primary Supplier ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_prod_sku", "products", "sku", "Barcode / SKU", "string", isFilterable = true, isGroupable = false),

            // INVENTORY TABLE
            DataDictionaryEntity("dd_inv_id", "inventory", "id", "Inventory Batch ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_inv_product_id", "inventory", "product_id", "Product Reference", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_inv_name", "inventory", "name", "Item Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_inv_category", "inventory", "category", "Category", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_inv_stock_level", "inventory", "stock_level", "On Hand Stock", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_inv_min_stock", "inventory", "min_stock", "Reorder Level", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_inv_unit_cost", "inventory", "unit_cost", "Unit Cost ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_inv_total_value", "inventory", "total_value", "Stock Valuation ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_inv_status", "inventory", "status", "Stock Health", "string", isFilterable = true, isGroupable = true),

            // CUSTOMERS TABLE
            DataDictionaryEntity("dd_cust_id", "customers", "id", "Customer ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_cust_name", "customers", "name", "Customer Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_cust_phone", "customers", "phone", "Phone", "string", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_cust_address", "customers", "address", "City / Address", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_cust_created_date", "customers", "created_date", "Registration Date", "date", isFilterable = true, isGroupable = true),

            // SUPPLIERS TABLE
            DataDictionaryEntity("dd_supp_id", "suppliers", "id", "Supplier ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_supp_name", "suppliers", "name", "Supplier Company", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_supp_contact", "suppliers", "contact_person", "Account Manager", "string", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_supp_phone", "suppliers", "phone", "Phone Number", "string", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_supp_category", "suppliers", "category", "Supply Category", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_supp_terms", "suppliers", "payment_terms", "Payment Terms", "string", isFilterable = true, isGroupable = true),

            // STAFF TABLE
            DataDictionaryEntity("dd_staff_id", "staff", "id", "Employee ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_staff_name", "staff", "name", "Staff Full Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_staff_role", "staff", "role", "System Role", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_staff_phone", "staff", "phone", "Contact Phone", "string", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_staff_active", "staff", "active", "Active Flag", "string", isFilterable = true, isGroupable = true),

            // DELIVERIES TABLE
            DataDictionaryEntity("dd_del_id", "deliveries", "id", "GRN Voucher No", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_del_supp_id", "deliveries", "supplier_id", "Supplier ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_del_supp_name", "deliveries", "supplier_name", "Supplier Name", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_del_date", "deliveries", "date", "Delivery Date", "date", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_del_total", "deliveries", "total_amount", "Invoice Total ($)", "number", isFilterable = true, isGroupable = false),
            DataDictionaryEntity("dd_del_receiver", "deliveries", "received_by_id", "Receiving Clerk ID", "string", isFilterable = true, isGroupable = true),
            DataDictionaryEntity("dd_del_status", "deliveries", "status", "Delivery Status", "string", isFilterable = true, isGroupable = true)
        )
        reportDao.insertDataDictionary(dictionaryItems)

        // 2. SEED TABLE RELATIONSHIPS (FOR AUTO-SUGGESTING JOINS)
        val relationships = listOf(
            TableRelationshipEntity("rel_1", "sales", "product_id", "products", "id", "sales.product_id -> products.id (Product Line)"),
            TableRelationshipEntity("rel_2", "products", "supplier_id", "suppliers", "id", "products.supplier_id -> suppliers.id (Supplier)"),
            TableRelationshipEntity("rel_3", "sales", "customer_id", "customers", "id", "sales.customer_id -> customers.id (Customer)"),
            TableRelationshipEntity("rel_4", "sales", "staff_id", "staff", "id", "sales.staff_id -> staff.id (Cashier)"),
            TableRelationshipEntity("rel_5", "inventory", "product_id", "products", "id", "inventory.product_id -> products.id (Master Product)"),
            TableRelationshipEntity("rel_6", "deliveries", "supplier_id", "suppliers", "id", "deliveries.supplier_id -> suppliers.id (Supplier)"),
            TableRelationshipEntity("rel_7", "deliveries", "received_by_id", "staff", "id", "deliveries.received_by_id -> staff.id (Clerk)")
        )
        reportDao.insertRelationships(relationships)

        // 3. SEED USER ROLES
        val roles = listOf(
            UserRoleEntity("super_admin", "Super Admin"),
            UserRoleEntity("manager", "Manager"),
            UserRoleEntity("cashier", "Cashier"),
            UserRoleEntity("accountant", "Accountant")
        )
        reportDao.insertRoles(roles)
    }
}
