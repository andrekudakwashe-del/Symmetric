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
  () => import('../components/admin/BranchSetupScreen'),
  () => import('../components/sheets/GoogleSheetsSyncModal'),
  () => import('../components/admin/PermissionsMatrixModal'),
  () => import('../components/admin/SalespersonManagementModal'),
  () => import('../components/admin/TenantDiagnosticsModal'),
  () => import('../components/sync/SyncDiagnosticsModal'),
];

let isPrefetchInitiated = false;
let pausePrefetchUntil = 0;

export function prefetchAppModules(): void {
  if (isPrefetchInitiated || typeof window === 'undefined') return;
  // In Vite dev mode (including AI Studio Preview), dynamic imports trigger dozens of unbundled
  // HTTP requests per module and can trip the preview proxy rate limiter ("Rate exceeded.").
  // Prefetching is only beneficial for built production chunks.
  if (import.meta.env.DEV) return;
  isPrefetchInitiated = true;

  // Pause background prefetching briefly whenever the user clicks/taps so opening any screen
  // gets 100% of CPU & network priority with zero contention.
  const deferOnInteraction = () => {
    pausePrefetchUntil = Date.now() + 1800;
  };
  window.addEventListener('pointerdown', deferOnInteraction, { passive: true });
  window.addEventListener('keydown', deferOnInteraction, { passive: true });

  const waitForIdleSlot = (): Promise<void> =>
    new Promise((resolve) => {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => resolve(), { timeout: 1200 });
      } else {
        setTimeout(resolve, 250);
      }
    });

  const runPrefetchQueue = async () => {
    for (const loader of MODULE_LOADERS) {
      // Skip while offline, hidden, or Save-Data / 2G connection
      if (typeof navigator !== 'undefined') {
        if (!navigator.onLine) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        const conn = (navigator as any).connection;
        if (conn?.saveData || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') {
          return;
        }
      }
      if (typeof document !== 'undefined' && document.hidden) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Yield if user just tapped or interacted with the app
      const waitInteraction = pausePrefetchUntil - Date.now();
      if (waitInteraction > 0) {
        await new Promise((r) => setTimeout(r, waitInteraction));
      }

      await waitForIdleSlot();

      try {
        await loader();
      } catch {
        // Safe to ignore if network is currently unavailable
      }
      // Gentle 300ms stagger so main UI thread and active navigation remain 60fps instant
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    window.removeEventListener('pointerdown', deferOnInteraction);
    window.removeEventListener('keydown', deferOnInteraction);
  };

  // Defer prefetch start by 4s after login so landing screen and initial user actions are instant
  setTimeout(() => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(runPrefetchQueue, { timeout: 3000 });
    } else {
      setTimeout(runPrefetchQueue, 800);
    }
  }, 4000);
}
