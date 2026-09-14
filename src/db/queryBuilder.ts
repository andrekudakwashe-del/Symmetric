import {
  ReportJsonConfig,
  ReportExecutionResult,
  DataDictionaryItem,
  FilterOperator,
} from '../types';
import {
  getSales,
  getProducts,
  getInventoryItems,
  getCustomers,
  getSuppliers,
  getSalespeople,
  getGoodsReceived,
} from './roomDatabase';
import { INITIAL_DATA_DICTIONARY } from './dataDictionary';

/**
 * Converts a ReportJsonConfig into parameterized SQL suitable for Room @RawQuery
 */
export function buildSafeSql(config: ReportJsonConfig): { sql: string; bindArgs: any[] } {
  const primaryTable = config.tables[0] || 'sales';
  const bindArgs: any[] = [];

  // Build SELECT columns
  const selectParts: string[] = [];
  
  // Non-aggregate columns or group by
  if (config.columns && config.columns.length > 0) {
    config.columns.forEach((col) => {
      // Don't duplicate if it's already an aggregate string
      if (!col.includes('(')) {
        selectParts.push(`${col} AS "${col}"`);
      }
    });
  }

  // Aggregate columns
  if (config.aggregates && config.aggregates.length > 0) {
    config.aggregates.forEach((agg) => {
      const alias = agg.alias || `${agg.func}(${agg.column})`;
      selectParts.push(`${agg.func}(${agg.column}) AS "${alias}"`);
    });
  }

  // If no columns or aggregates, default to primaryTable.*
  if (selectParts.length === 0) {
    selectParts.push(`${primaryTable}.*`);
  }

  let sql = `SELECT\n  ${selectParts.join(',\n  ')}\nFROM ${primaryTable}`;

  // Build JOINS
  if (config.joins && config.joins.length > 0) {
    config.joins.forEach((join) => {
      const toTable = join.to.split('.')[0];
      const joinType = join.type || 'INNER';
      sql += `\n${joinType} JOIN ${toTable} ON ${join.from} = ${join.to}`;
    });
  }

  // Build WHERE filters
  const whereClauses: string[] = [];
  if (config.filters && config.filters.length > 0) {
    const today = new Date();

    config.filters.forEach((f) => {
      if (!f.column) return;

      switch (f.op) {
        case 'equals':
          whereClauses.push(`${f.column} = ?`);
          bindArgs.push(f.value);
          break;
        case 'not_equals':
          whereClauses.push(`${f.column} != ?`);
          bindArgs.push(f.value);
          break;
        case 'contains':
          whereClauses.push(`${f.column} LIKE ?`);
          bindArgs.push(`%${f.value}%`);
          break;
        case 'gt':
          whereClauses.push(`${f.column} > ?`);
          bindArgs.push(f.value);
          break;
        case 'lt':
          whereClauses.push(`${f.column} < ?`);
          bindArgs.push(f.value);
          break;
        case 'gte':
          whereClauses.push(`${f.column} >= ?`);
          bindArgs.push(f.value);
          break;
        case 'lte':
          whereClauses.push(`${f.column} <= ?`);
          bindArgs.push(f.value);
          break;
        case 'last_7_days': {
          const d = new Date(today);
          d.setDate(d.getDate() - 7);
          const dateStr = d.toISOString().split('T')[0];
          whereClauses.push(`${f.column} >= ?`);
          bindArgs.push(dateStr);
          break;
        }
        case 'last_30_days': {
          const d = new Date(today);
          d.setDate(d.getDate() - 30);
          const dateStr = d.toISOString().split('T')[0];
          whereClauses.push(`${f.column} >= ?`);
          bindArgs.push(dateStr);
          break;
        }
        case 'this_month': {
          const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
          whereClauses.push(`${f.column} >= ?`);
          bindArgs.push(firstDay);
          break;
        }
        case 'between':
          whereClauses.push(`${f.column} BETWEEN ? AND ?`);
          bindArgs.push(f.value);
          bindArgs.push(f.value2);
          break;
      }
    });
  }

  if (whereClauses.length > 0) {
    sql += `\nWHERE ${whereClauses.join(' AND ')}`;
  }

  // Build GROUP BY
  if (config.group_by && config.group_by.length > 0) {
    sql += `\nGROUP BY ${config.group_by.join(', ')}`;
  }

  // Build ORDER BY
  if (config.sort_by && config.sort_by.length > 0) {
    const orderParts = config.sort_by.map((s) => `${s.column} ${s.direction}`);
    sql += `\nORDER BY ${orderParts.join(', ')}`;
  }

  // Build LIMIT
  const limit = config.limit || 500;
  sql += `\nLIMIT ${limit}`;

  return { sql, bindArgs };
}

/**
 * Fetches raw dataset for a table from Room database
 */
function getTableData(tableName: string): Record<string, any>[] {
  switch (tableName) {
    case 'sales': {
      const invoices = getSales();
      const rows: Record<string, any>[] = [];
      invoices.forEach((inv) => {
        const timeVal = inv.timestamp && inv.timestamp.includes('T')
          ? inv.timestamp.split('T')[1].slice(0, 8)
          : (inv.timestamp || '12:00:00');

        if (inv.items && inv.items.length > 0) {
          inv.items.forEach((item) => {
            rows.push({
              'sales.id': inv.id,
              'sales.date': inv.date,
              'sales.time': timeVal,
              'sales.product_id': item.id,
              'sales.product_name': item.name,
              'sales.category': item.category || 'General',
              'sales.quantity': item.quantity,
              'sales.unit_price': item.unitPrice,
              'sales.total_amount': item.total || (item.quantity * item.unitPrice),
              'sales.discount': inv.discount || 0,
              'sales.customer_id': inv.customerId || 'WALK-IN',
              'sales.customer_name': inv.customerName || 'Walk-in Customer',
              'sales.staff_id': inv.staffId,
              'sales.staff_name': inv.staffName,
              'sales.payment_method': inv.paymentMethod,
              'sales.status': inv.status,
            });
          });
        } else {
          rows.push({
            'sales.id': inv.id,
            'sales.date': inv.date,
            'sales.time': timeVal,
            'sales.product_id': 'NONE',
            'sales.product_name': 'Standard Sale',
            'sales.category': 'General',
            'sales.quantity': 1,
            'sales.unit_price': inv.total,
            'sales.total_amount': inv.total,
            'sales.discount': inv.discount || 0,
            'sales.customer_id': inv.customerId || 'WALK-IN',
            'sales.customer_name': inv.customerName || 'Walk-in Customer',
            'sales.staff_id': inv.staffId,
            'sales.staff_name': inv.staffName,
            'sales.payment_method': inv.paymentMethod,
            'sales.status': inv.status,
          });
        }
      });
      return rows;
    }

    case 'products': {
      const prods = getProducts();
      return prods.map((p) => ({
        'products.id': p.id,
        'products.name': p.name,
        'products.category': p.category,
        'products.price': p.price,
        'products.cost': p.costPrice || 0,
        'products.stock': p.stockQuantity || 0,
        'products.supplier_id': 'SUP-001',
        'products.sku': p.sku || p.barcode || p.id,
      }));
    }

    case 'inventory': {
      const invItems = getInventoryItems();
      return invItems.map((item) => {
        const units = item.totalUnits || item.stockSingles || 0;
        const reorder = item.reorderLevelUnits || 5;
        const unitCost = item.costPerUnit || 0;
        return {
          'inventory.id': item.itemId,
          'inventory.product_id': item.itemId,
          'inventory.name': item.itemName,
          'inventory.category': item.category,
          'inventory.stock_level': units,
          'inventory.min_stock': reorder,
          'inventory.unit_cost': unitCost,
          'inventory.total_value': units * unitCost,
          'inventory.status': units <= reorder ? 'Low Stock' : 'Optimal',
        };
      });
    }

    case 'customers': {
      const custs = getCustomers();
      return custs.map((c) => ({
        'customers.id': c.customerId,
        'customers.name': c.name,
        'customers.phone': c.phone || 'N/A',
        'customers.address': c.address || 'Harare CBD',
        'customers.created_date': c.createdDate,
      }));
    }

    case 'suppliers': {
      const supps = getSuppliers();
      return supps.map((s) => ({
        'suppliers.id': s.supplierId,
        'suppliers.name': s.name,
        'suppliers.contact_person': s.contactPerson || 'Sales Desk',
        'suppliers.phone': s.phone || 'N/A',
        'suppliers.category': s.category || 'General',
        'suppliers.payment_terms': s.paymentTerms || 'Net 30',
      }));
    }

    case 'staff': {
      const staffList = getSalespeople();
      return staffList.map((st) => ({
        'staff.id': st.id,
        'staff.name': st.name,
        'staff.role': st.role,
        'staff.phone': st.phone || 'N/A',
        'staff.active': st.active,
      }));
    }

    case 'deliveries': {
      const grnList = getGoodsReceived();
      return grnList.map((g) => {
        const total = g.lineTotal || ((g.receivedCases * (g.costPerCase || 0)) + (g.receivedSingles * (g.costPerUnit || 0)));
        return {
          'deliveries.id': g.grnId,
          'deliveries.supplier_id': g.supplier,
          'deliveries.supplier_name': g.supplier,
          'deliveries.date': g.date,
          'deliveries.total_amount': total,
          'deliveries.received_by_id': g.staffId || '001',
          'deliveries.status': 'Received',
        };
      });
    }

    default:
      return [];
  }
}

/**
 * Evaluates whether a row passes a filter condition
 */
function testFilter(rowValue: any, op: FilterOperator, val1?: any, val2?: any): boolean {
  if (rowValue === undefined || rowValue === null) return false;

  const today = new Date();

  switch (op) {
    case 'equals':
      return String(rowValue).toLowerCase() === String(val1).toLowerCase();

    case 'not_equals':
      return String(rowValue).toLowerCase() !== String(val1).toLowerCase();

    case 'contains':
      return String(rowValue).toLowerCase().includes(String(val1).toLowerCase());

    case 'gt':
      return Number(rowValue) > Number(val1);

    case 'lt':
      return Number(rowValue) < Number(val1);

    case 'gte':
      return Number(rowValue) >= Number(val1);

    case 'lte':
      return Number(rowValue) <= Number(val1);

    case 'last_7_days': {
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 7);
      const rowDate = new Date(rowValue);
      return rowDate >= cutoff;
    }

    case 'last_30_days': {
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 30);
      const rowDate = new Date(rowValue);
      return rowDate >= cutoff;
    }

    case 'this_month': {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const rowDate = new Date(rowValue);
      return rowDate >= firstDay;
    }

    case 'between': {
      const numVal = Number(rowValue);
      if (!isNaN(numVal)) {
        return numVal >= Number(val1) && numVal <= Number(val2);
      }
      return String(rowValue) >= String(val1) && String(rowValue) <= String(val2);
    }

    default:
      return true;
  }
}

/**
 * Universal query executor
 */
export function executeReportQuery(config: ReportJsonConfig): ReportExecutionResult {
  const startTime = performance.now();
  const { sql, bindArgs } = buildSafeSql(config);

  if (!config.tables || config.tables.length === 0) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      executionTimeMs: 0,
      sqlQuery: sql,
      params: bindArgs,
      warning: 'No data source tables selected.',
    };
  }

  const primaryTable = config.tables[0];
  let dataset = getTableData(primaryTable);

  // Performance Rule: Force date filter if dataset exceeds 10,000 rows
  let performanceWarning: string | undefined;
  if (dataset.length > 10000) {
    const hasDateFilter = config.filters.some((f) =>
      f.column.endsWith('.date') || f.column.endsWith('.created_date')
    );
    if (!hasDateFilter) {
      performanceWarning = 'Performance Optimization: Date range filter was automatically enforced because dataset exceeded 10,000 rows.';
      // Apply default last 90 days filter
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const dateKey = `${primaryTable}.date`;
      dataset = dataset.filter((r) => !r[dateKey] || new Date(r[dateKey]) >= cutoff);
    }
  }

  // Perform Joins
  if (config.joins && config.joins.length > 0) {
    config.joins.forEach((join) => {
      const toTable = join.to.split('.')[0];
      const toData = getTableData(toTable);

      const joinedResults: Record<string, any>[] = [];
      const joinType = join.type || 'INNER';

      dataset.forEach((rowA) => {
        const valA = rowA[join.from];
        const matches = toData.filter((rowB) => String(rowB[join.to]) === String(valA));

        if (matches.length > 0) {
          matches.forEach((rowB) => {
            joinedResults.push({ ...rowA, ...rowB });
          });
        } else if (joinType === 'LEFT') {
          joinedResults.push({ ...rowA });
        }
      });

      dataset = joinedResults;
    });
  }

  // Apply Filters
  if (config.filters && config.filters.length > 0) {
    dataset = dataset.filter((row) => {
      return config.filters.every((f) => {
        if (!f.column) return true;
        const rowVal = row[f.column];
        return testFilter(rowVal, f.op, f.value, f.value2);
      });
    });
  }

  // Grouping & Aggregations
  const hasGroupBy = config.group_by && config.group_by.length > 0;
  const hasAggregates = config.aggregates && config.aggregates.length > 0;

  let finalRows: Record<string, any>[] = [];

  if (hasGroupBy || hasAggregates) {
    const groups: Map<string, { groupValues: Record<string, any>; items: Record<string, any>[] }> = new Map();

    if (hasGroupBy) {
      dataset.forEach((row) => {
        const groupKey = (config.group_by || []).map((col) => String(row[col] ?? '')).join('___');
        if (!groups.has(groupKey)) {
          const groupValues: Record<string, any> = {};
          (config.group_by || []).forEach((col) => {
            groupValues[col] = row[col];
          });
          groups.set(groupKey, { groupValues, items: [] });
        }
        groups.get(groupKey)!.items.push(row);
      });
    } else {
      // Global aggregate without GROUP BY
      groups.set('ALL', { groupValues: {}, items: dataset });
    }

    groups.forEach(({ groupValues, items }) => {
      const resultRow: Record<string, any> = { ...groupValues };

      if (config.aggregates && config.aggregates.length > 0) {
        config.aggregates.forEach((agg) => {
          const key = agg.alias || `${agg.func}(${agg.column})`;
          const values = items.map((i) => Number(i[agg.column])).filter((n) => !isNaN(n));

          switch (agg.func) {
            case 'SUM':
              resultRow[key] = values.reduce((acc, v) => acc + v, 0);
              break;
            case 'COUNT':
              resultRow[key] = items.length;
              break;
            case 'AVG':
              resultRow[key] = values.length > 0 ? Number((values.reduce((acc, v) => acc + v, 0) / values.length).toFixed(2)) : 0;
              break;
            case 'MIN':
              resultRow[key] = values.length > 0 ? Math.min(...values) : 0;
              break;
            case 'MAX':
              resultRow[key] = values.length > 0 ? Math.max(...values) : 0;
              break;
          }
        });
      }

      finalRows.push(resultRow);
    });
  } else {
    // Plain projection without group by or aggregates
    finalRows = dataset.map((row) => {
      const proj: Record<string, any> = {};
      if (config.columns && config.columns.length > 0) {
        config.columns.forEach((col) => {
          proj[col] = row[col];
        });
      } else {
        Object.keys(row).forEach((k) => {
          proj[k] = row[k];
        });
      }
      return proj;
    });
  }

  // Apply Sorting
  if (config.sort_by && config.sort_by.length > 0) {
    finalRows.sort((a, b) => {
      for (const s of config.sort_by!) {
        const valA = a[s.column];
        const valB = b[s.column];
        if (valA === valB) continue;

        const isAsc = s.direction === 'ASC';
        if (typeof valA === 'number' && typeof valB === 'number') {
          return isAsc ? valA - valB : valB - valA;
        }
        return isAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
      }
      return 0;
    });
  }

  // Apply Limit
  const limit = config.limit || 500;
  const totalCount = finalRows.length;
  if (finalRows.length > limit) {
    finalRows = finalRows.slice(0, limit);
  }

  // Construct Headers
  const headerKeys: string[] = [];
  if (config.columns) {
    config.columns.forEach((col) => {
      if (!col.includes('(') && !headerKeys.includes(col)) {
        headerKeys.push(col);
      }
    });
  }
  if (config.aggregates) {
    config.aggregates.forEach((agg) => {
      const key = agg.alias || `${agg.func}(${agg.column})`;
      if (!headerKeys.includes(key)) {
        headerKeys.push(key);
      }
    });
  }
  if (headerKeys.length === 0 && finalRows.length > 0) {
    headerKeys.push(...Object.keys(finalRows[0]));
  }

  const ddMap = new Map<string, DataDictionaryItem>();
  INITIAL_DATA_DICTIONARY.forEach((dd) => {
    ddMap.set(`${dd.table_name}.${dd.column_name}`, dd);
  });

  const headers = headerKeys.map((key) => {
    const ddItem = ddMap.get(key);
    let label = key;
    let type: 'string' | 'number' | 'date' | 'boolean' = 'string';

    if (ddItem) {
      label = ddItem.display_name;
      type = ddItem.data_type;
    } else if (key.startsWith('SUM(') || key.startsWith('COUNT(') || key.startsWith('AVG(') || key.startsWith('MIN(') || key.startsWith('MAX(')) {
      label = key;
      type = 'number';
    } else if (key.includes('.')) {
      const parts = key.split('.');
      label = `${parts[0].toUpperCase()}: ${parts[1].replace(/_/g, ' ')}`;
    }

    return { key, label, type };
  });

  const endTime = performance.now();

  return {
    headers,
    rows: finalRows,
    totalRows: totalCount,
    executionTimeMs: Math.round(endTime - startTime),
    sqlQuery: sql,
    params: bindArgs,
    warning: performanceWarning,
  };
}
