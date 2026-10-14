import {
  BackendType,
  TenantDataSnapshot,
  PruneResult,
  TenantBackendConfig,
} from './types';
import { roomBackendAdapter } from './adapters/RoomAdapter';
import { sheetsAppScriptAdapter } from './adapters/SheetsAppScriptAdapter';
import { firebaseBackendAdapter } from './adapters/FirebaseAdapter';
import { supabaseBackendAdapter } from './adapters/SupabaseAdapter';

export interface ConvertedBackendData {
  targetBackend: BackendType;
  entityCount: number;
  payload: any;
  summary: string;
}

/**
 * Migration Engine Schema Converter:
 * Transforms universal snapshot data to/from the 4 different storage paradigms.
 */
export class MigrationFoundationEngine {
  /**
   * Converts a tenant snapshot into the target backend format
   */
  convertSnapshot(snapshot: TenantDataSnapshot, targetType: BackendType): ConvertedBackendData {
    switch (targetType) {
      case 'room':
        return this.convertToRoomFormat(snapshot);
      case 'sheets_appscript':
        return this.convertToSheetsFormat(snapshot);
      case 'firebase':
        return this.convertToFirebaseFormat(snapshot);
      case 'supabase':
        return this.convertToSupabaseFormat(snapshot);
    }
  }

  private convertToRoomFormat(snapshot: TenantDataSnapshot): ConvertedBackendData {
    return {
      targetBackend: 'room',
      entityCount:
        (snapshot.data.sales?.length || 0) +
        (snapshot.data.inventory?.length || 0) +
        (snapshot.data.customers?.length || 0),
      payload: snapshot.data,
      summary: `IndexedDB Relational Objects ready for offline local storage`,
    };
  }

  private convertToSheetsFormat(snapshot: TenantDataSnapshot): ConvertedBackendData {
    // Converts records into Tabular 2D row arrays matching Code.gs sheet schema
    const salesRows = (snapshot.data.sales || []).map((s: any) => [
      s.id || s.invoice_number || '',
      s.company_id || snapshot.tenantId,
      s.branch_id || 'BR-MAIN',
      s.date || new Date().toISOString(),
      s.cashier_name || s.salesperson_id || 'Staff',
      s.customer_name || 'Walk-in',
      s.total_amount || 0,
      s.payment_method || 'CASH',
      JSON.stringify(s.items || []),
    ]);

    const inventoryRows = (snapshot.data.inventory || []).map((item: any) => [
      item.id || item.sku || '',
      item.company_id || snapshot.tenantId,
      item.name || '',
      item.category || 'General',
      item.unit_price || item.selling_price || 0,
      item.cost_price || 0,
      item.stock_quantity || 0,
      item.barcode || '',
    ]);

    return {
      targetBackend: 'sheets_appscript',
      entityCount: salesRows.length + inventoryRows.length,
      payload: {
        sheetsData: {
          Sales: salesRows,
          Inventory: inventoryRows,
        },
      },
      summary: `Google Sheets Tabular Row Matrix (${salesRows.length} sales rows, ${inventoryRows.length} inventory rows)`,
    };
  }

  private convertToFirebaseFormat(snapshot: TenantDataSnapshot): ConvertedBackendData {
    // Converts relational arrays into hierarchical Firestore Document collections:
    // /tenants/{tenantId}/sales/{saleId}
    // /tenants/{tenantId}/inventory/{itemId}
    const firestoreDocs: Record<string, Record<string, any>> = {
      sales: {},
      inventory: {},
      customers: {},
      cashLogs: {},
    };

    (snapshot.data.sales || []).forEach((sale: any) => {
      const docId = sale.id || sale.invoice_number || `sale_${Date.now()}`;
      firestoreDocs.sales[docId] = {
        ...sale,
        tenantId: snapshot.tenantId,
        updatedAt: new Date().toISOString(),
      };
    });

    (snapshot.data.inventory || []).forEach((item: any) => {
      const docId = item.id || item.sku || `item_${Date.now()}`;
      firestoreDocs.inventory[docId] = {
        ...item,
        tenantId: snapshot.tenantId,
        updatedAt: new Date().toISOString(),
      };
    });

    (snapshot.data.customers || []).forEach((cust: any) => {
      const docId = cust.id || `cust_${Date.now()}`;
      firestoreDocs.customers[docId] = {
        ...cust,
        tenantId: snapshot.tenantId,
      };
    });

    return {
      targetBackend: 'firebase',
      entityCount:
        Object.keys(firestoreDocs.sales).length +
        Object.keys(firestoreDocs.inventory).length +
        Object.keys(firestoreDocs.customers).length,
      payload: firestoreDocs,
      summary: `Cloud Firestore Collections (/tenants/${snapshot.tenantId}/*)`,
    };
  }

  private convertToSupabaseFormat(snapshot: TenantDataSnapshot): ConvertedBackendData {
    // Converts objects to snake_case PostgreSQL normalized tables
    const sqlTables: Record<string, any[]> = {
      sales: (snapshot.data.sales || []).map((s: any) => ({
        id: s.id || s.invoice_number,
        company_id: snapshot.tenantId,
        branch_id: s.branch_id || s.branchId || 'BR-MAIN',
        sale_date: s.date || new Date().toISOString(),
        customer_id: s.customer_id || null,
        total_amount: Number(s.total_amount || 0),
        payment_method: s.payment_method || 'CASH',
        items_payload: s.items || [],
        created_at: s.created_at || new Date().toISOString(),
      })),
      inventory: (snapshot.data.inventory || []).map((i: any) => ({
        id: i.id || i.sku,
        company_id: snapshot.tenantId,
        sku: i.sku || i.id,
        name: i.name,
        selling_price: Number(i.unit_price || i.selling_price || 0),
        cost_price: Number(i.cost_price || 0),
        quantity: Number(i.stock_quantity || 0),
        barcode: i.barcode || null,
      })),
    };

    return {
      targetBackend: 'supabase',
      entityCount: sqlTables.sales.length + sqlTables.inventory.length,
      payload: sqlTables,
      summary: `PostgreSQL Relational Tables with RLS Tenant Keys (${sqlTables.sales.length} sales rows, ${sqlTables.inventory.length} inventory rows)`,
    };
  }

  /**
   * Executes a cross-backend migration between two adapter endpoints
   */
  async executeMigration(
    companyId: string,
    sourceType: BackendType,
    destinationType: BackendType
  ): Promise<{
    success: boolean;
    migratedEntities: number;
    source: BackendType;
    destination: BackendType;
    durationMs: number;
    error?: string;
  }> {
    const start = Date.now();

    try {
      // 1. Export from source (Room acts as reliable intermediate staging reader)
      const snapshot = await roomBackendAdapter.exportSnapshot(companyId);

      // 2. Validate snapshot data
      if (!snapshot || !snapshot.data) {
        throw new Error(`Failed to extract snapshot from source backend (${sourceType})`);
      }

      // 3. Convert data structures
      const converted = this.convertSnapshot(snapshot, destinationType);

      // 4. Ingest into target adapter
      if (destinationType === 'room') {
        await roomBackendAdapter.importSnapshot(companyId, snapshot);
      } else if (destinationType === 'sheets_appscript') {
        await sheetsAppScriptAdapter.importSnapshot(companyId, snapshot);
      } else if (destinationType === 'firebase') {
        await firebaseBackendAdapter.importSnapshot(companyId, snapshot);
      } else if (destinationType === 'supabase') {
        await supabaseBackendAdapter.importSnapshot(companyId, snapshot);
      }

      const durationMs = Date.now() - start;

      return {
        success: true,
        migratedEntities: converted.entityCount,
        source: sourceType,
        destination: destinationType,
        durationMs,
      };
    } catch (err: any) {
      return {
        success: false,
        migratedEntities: 0,
        source: sourceType,
        destination: destinationType,
        durationMs: Date.now() - start,
        error: err.message || String(err),
      };
    }
  }

  /**
   * 3-Month Automated & Manual Retention Pruner:
   * Safely purges historical records older than retentionMonths (default 3)
   * while keeping master catalog, products, branches, and staff intact.
   */
  async pruneHistoricalRecords(companyId: string, retentionMonths = 3): Promise<PruneResult> {
    return roomBackendAdapter.pruneHistoricalData(companyId, retentionMonths);
  }
}

export const migrationFoundationEngine = new MigrationFoundationEngine();
