/**
 * Proactive background prefetcher for code-split modules.
 * Preloads all module chunks during browser idle time right after startup.
 * When the user taps any menu or tab, the chunk is already in memory & cache,
 * delivering 0ms instant offline load times with zero "Loading module..." delay.
 */

const MODULE_LOADERS: Array<() => Promise<any>> = [
  // Heavy modules preloaded in background
  () => import('../components/stocktake/StocktakeHubScreen'),
  () => import('../components/admin/DataManagementHub'),
  () => import('../components/inventory/GoodsReceivedView'),
  () => import('../components/inventory/StockMovementView'),
  () => import('../components/inventory/BatchTrackingView'),
  () => import('../components/inventory/ProcurementReorderHub'),
  () => import('../components/inventory/InventorySetupView'),
  () => import('../components/inventory/DailyGoodsReceivedReport'),
  () => import('../components/suppliers/SupplierListScreen'),
  () => import('../reports/IncomeStatement'),
  () => import('../pages/Settings/FixedCosts'),
  () => import('../components/reports/UniversalReportBuilder'),
  () => import('../components/reports/CustomReportsListView'),
  () => import('../components/sync/P2PMeshSyncHub'),
  () => import('../components/admin/BranchSetupScreen'),
  () => import('../components/admin/SuperAdminDashboard'),
  () => import('../components/sheets/GoogleSheetsSyncModal'),
  () => import('../components/admin/PermissionsMatrixModal'),
  () => import('../components/admin/SalespersonManagementModal'),
  () => import('../components/admin/TenantDiagnosticsModal'),
  () => import('../components/sync/SyncDiagnosticsModal'),
];

let isPrefetchInitiated = false;

export function prefetchAppModules(): void {
  if (isPrefetchInitiated || typeof window === 'undefined') return;
  isPrefetchInitiated = true;

  const runPrefetchQueue = async () => {
    for (const loader of MODULE_LOADERS) {
      try {
        await loader();
      } catch (e) {
        // Safe to ignore if network is currently unavailable
      }
      // Stagger by 40ms to keep main UI thread running at 60fps
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };

  // Schedule during browser idle time after initial screen renders
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(runPrefetchQueue, { timeout: 1500 });
  } else {
    setTimeout(runPrefetchQueue, 400);
  }
}
