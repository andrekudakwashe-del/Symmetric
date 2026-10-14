import {
  IBackendAdapter,
  BackendType,
  TenantBackendConfig,
  BackendConnectionTestResult,
  TenantDataSnapshot,
  PruneResult,
} from '../types';
import {
  getStored,
  setStored,
  STORAGE_KEYS,
  getCompanies,
  getBranchesForCompany,
  getSalespeopleForCompany,
  getAllSales,
  getProducts,
  getInventoryItems,
  getCustomers,
  getCashLogs,
  getExpenses,
  getSuppliers,
  getCustomerChanges,
} from '../../../db/roomDatabase';

export class RoomBackendAdapter implements IBackendAdapter {
  readonly id = 'adapter-room';
  readonly type: BackendType = 'room';
  readonly name = 'Room Database (Offline / IndexedDB)';
  readonly tierLabel = 'Free Package Tier';
  readonly description = 'Zero-cloud local storage powered by Browser IndexedDB & Memory Cache. Ultra-fast and offline-native.';

  isConfigured(_config: TenantBackendConfig): boolean {
    // Room DB requires zero external accounts or credentials
    return true;
  }

  async testConnection(config: TenantBackendConfig): Promise<BackendConnectionTestResult> {
    const start = Date.now();
    try {
      const isLocalStorageAvail = typeof window !== 'undefined' && !!window.localStorage;
      const isIdbAvail = typeof window !== 'undefined' && !!window.indexedDB;
      const latency = Date.now() - start;

      return {
        success: true,
        latencyMs: latency,
        testedAt: new Date().toISOString(),
        message: 'Local Room Database engine is operational and healthy.',
        details: {
          localStorage: isLocalStorageAvail,
          indexedDB: isIdbAvail,
          localCacheDeactivated: !config.room.keepLocalCache,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        testedAt: new Date().toISOString(),
        message: `Room Database check failed: ${err.message || String(err)}`,
      };
    }
  }

  async exportSnapshot(companyId: string): Promise<TenantDataSnapshot> {
    const companies = getCompanies().filter((c) => c.company_id === companyId);
    const company = companies[0] || { company_id: companyId, company_name: companyId };
    const branches = getBranchesForCompany(companyId);
    const staff = getSalespeopleForCompany(companyId);

    const allSales = getAllSales().filter((s: any) => (s.company_id || s.companyId) === companyId);
    const allProducts = getProducts().filter((p: any) => !p.company_id || p.company_id === companyId);
    const allInventory = getInventoryItems().filter((i: any) => !i.company_id || i.company_id === companyId);
    const allCustomers = getCustomers().filter((c: any) => !c.company_id || c.company_id === companyId);
    const allCashLogs = getCashLogs().filter((c: any) => (c.company_id || c.companyId) === companyId);
    const allExpenses = getExpenses().filter((e: any) => (e.company_id || e.companyId) === companyId);
    const allSuppliers = getSuppliers().filter((s: any) => !s.company_id || s.company_id === companyId);
    const allCustomerChanges = getCustomerChanges().filter((c: any) => !c.company_id || c.company_id === companyId);

    const snapshot: TenantDataSnapshot = {
      tenantId: companyId,
      tenantName: company.company_name || companyId,
      exportedAt: new Date().toISOString(),
      backendSource: 'room',
      version: '1.0.0',
      data: {
        companies,
        branches,
        staff,
        products: allProducts,
        inventory: allInventory,
        sales: allSales,
        cashLogs: allCashLogs,
        expenses: allExpenses,
        customers: allCustomers,
        customerChanges: allCustomerChanges,
        suppliers: allSuppliers,
      },
      metrics: {
        totalSales: allSales.length,
        totalInventoryItems: allInventory.length,
        totalCustomers: allCustomers.length,
        totalCashLogs: allCashLogs.length,
        snapshotSizeBytes: JSON.stringify(allSales).length + JSON.stringify(allInventory).length,
      },
    };

    return snapshot;
  }

  async importSnapshot(
    companyId: string,
    snapshot: TenantDataSnapshot
  ): Promise<{ success: boolean; recordsWritten: number; errors?: string[] }> {
    try {
      let written = 0;
      const errors: string[] = [];

      // 1. Sales
      if (Array.isArray(snapshot.data.sales)) {
        const existingSales = getAllSales();
        const nonTenantSales = existingSales.filter((s: any) => (s.company_id || s.companyId) !== companyId);
        const mappedSales = snapshot.data.sales.map((s) => ({
          ...s,
          company_id: companyId,
        }));
        setStored(STORAGE_KEYS.SALES, [...nonTenantSales, ...mappedSales]);
        written += mappedSales.length;
      }

      // 2. Inventory
      if (Array.isArray(snapshot.data.inventory)) {
        const existingInv = getInventoryItems();
        const nonTenantInv = existingInv.filter((i: any) => i.company_id && i.company_id !== companyId);
        const mappedInv = snapshot.data.inventory.map((i) => ({
          ...i,
          company_id: companyId,
        }));
        setStored(STORAGE_KEYS.INVENTORY_ITEMS, [...nonTenantInv, ...mappedInv]);
        written += mappedInv.length;
      }

      // 3. Customers
      if (Array.isArray(snapshot.data.customers)) {
        const existingCust = getCustomers();
        const nonTenantCust = existingCust.filter((c: any) => c.company_id && c.company_id !== companyId);
        const mappedCust = snapshot.data.customers.map((c) => ({
          ...c,
          company_id: companyId,
        }));
        setStored(STORAGE_KEYS.CUSTOMERS, [...nonTenantCust, ...mappedCust]);
        written += mappedCust.length;
      }

      return {
        success: true,
        recordsWritten: written,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        recordsWritten: 0,
        errors: [err.message || String(err)],
      };
    }
  }

  async pruneHistoricalData(companyId: string, retentionMonths: number): Promise<PruneResult> {
    const months = retentionMonths || 3;
    const cutoffMs = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs).toISOString();

    const isOlderThanCutoff = (recordDate?: string) => {
      if (!recordDate) return false;
      const parsed = new Date(recordDate).getTime();
      return !isNaN(parsed) && parsed < cutoffMs;
    };

    let prunedSales = 0;
    let prunedCash = 0;
    let prunedExpenses = 0;

    // Prune Sales
    const currentSales = getAllSales();
    const retainedSales = currentSales.filter((s: any) => {
      const matchComp = (s.company_id || s.companyId) === companyId;
      if (matchComp && isOlderThanCutoff(s.date || s.created_at || s.timestamp)) {
        prunedSales++;
        return false;
      }
      return true;
    });
    if (prunedSales > 0) {
      setStored(STORAGE_KEYS.SALES, retainedSales);
    }

    // Prune Cash Logs
    const currentCashLogs = getCashLogs();
    const retainedCashLogs = currentCashLogs.filter((c: any) => {
      const matchComp = (c.company_id || c.companyId) === companyId;
      if (matchComp && isOlderThanCutoff(c.timestamp || c.date)) {
        prunedCash++;
        return false;
      }
      return true;
    });
    if (prunedCash > 0) {
      setStored(STORAGE_KEYS.CASH_LOGS, retainedCashLogs);
    }

    // Prune Expenses
    const currentExpenses = getExpenses();
    const retainedExpenses = currentExpenses.filter((e: any) => {
      const matchComp = (e.company_id || e.companyId) === companyId;
      if (matchComp && isOlderThanCutoff(e.date || e.timestamp)) {
        prunedExpenses++;
        return false;
      }
      return true;
    });
    if (prunedExpenses > 0) {
      setStored(STORAGE_KEYS.EXPENSES, retainedExpenses);
    }

    return {
      tenantId: companyId,
      prunedAt: new Date().toISOString(),
      retentionCutoffDate: cutoffDate,
      totalPrunedRecords: prunedSales + prunedCash + prunedExpenses,
      details: {
        sales: prunedSales,
        cashLogs: prunedCash,
        expenses: prunedExpenses,
        auditLogs: 0,
        syncQueue: 0,
      },
    };
  }
}
export const roomBackendAdapter = new RoomBackendAdapter();
