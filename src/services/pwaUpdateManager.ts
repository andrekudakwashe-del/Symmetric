/**
 * SAIMETRIC Checkout-Safe PWA Service Worker & Update Manager (Phase 4A)
 *
 * Guarantees:
 *  1. Full-app offline precaching via Workbox (`virtual:pwa-register` with `registerType: 'prompt'`).
 *  2. Zero mid-checkout interruptions: never calls `SKIP_WAITING` or reloads while a POS cart
 *     is active (`isPosActiveCheckout()`).
 *  3. "Apply After Sale" queueing: if a cashier/manager arms the update while ringing up a sale,
 *     the controller listens for `pos_cart_updated` and automatically activates the waiting SW
 *     shortly after the cart clears.
 *  4. One-shot `vite:preloadError` / `ChunkLoadError` recovery when online (session-guarded so
 *     it can never enter a reload loop, and never fires during active checkout).
 */

import { registerSW } from 'virtual:pwa-register';
import { isPosActiveCheckout } from '../db/roomDatabase';
import {
  PWAUpdateState,
  createPWAUpdateController,
  isChunkLoadErrorMessage,
} from './pwaUpdateController';

export type { PWAUpdateState } from './pwaUpdateController';
export { createPWAUpdateController, isChunkLoadErrorMessage } from './pwaUpdateController';

const CHUNK_RECOVERY_STORAGE_KEY = 'saimetric_chunk_recovery_ts';
const CHUNK_RECOVERY_COOLDOWN_MS = 60_000;

let initialized = false;
let activeRegistration: ServiceWorkerRegistration | null = null;
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

const controller = createPWAUpdateController({
  isCheckoutActive: () => isPosActiveCheckout(),
  triggerUpdateSW: async (reloadPage = true) => {
    if (updateSWFn) {
      await updateSWFn(reloadPage);
      return;
    }
    if (activeRegistration?.waiting) {
      activeRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    if (reloadPage && typeof window !== 'undefined') {
      window.location.reload();
    }
  },
  checkRegistrationUpdate: async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (activeRegistration) {
      await activeRegistration.update();
    } else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        activeRegistration = reg;
        await reg.update();
      }
    }
  },
  onReloadFallback: () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  },
});

function attemptOneShotChunkRecovery(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!navigator.onLine) return;
  if (isPosActiveCheckout()) {
    return;
  }
  try {
    const lastTs = Number(sessionStorage.getItem(CHUNK_RECOVERY_STORAGE_KEY) || 0);
    if (Date.now() - lastTs < CHUNK_RECOVERY_COOLDOWN_MS) {
      return;
    }
    sessionStorage.setItem(CHUNK_RECOVERY_STORAGE_KEY, String(Date.now()));
    window.location.reload();
  } catch {
    // ignore storage errors
  }
}

/**
 * Boots the Workbox Service Worker + checkout-safe update listeners (idempotent).
 * Keeps embedded dev preview iframes clean while giving standalone/production/direct-tab
 * browsers full offline chunk precaching and safe prompt-driven updates.
 */
export function initPWAUpdateManager(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const syncCheckout = () => controller.refreshCheckoutStatus();
  window.addEventListener('pos_cart_updated', syncCheckout);
  window.addEventListener('storage', syncCheckout);
  window.addEventListener('saimetric_sales_updated', syncCheckout);

  window.addEventListener('vite:preloadError', (event) => {
    if (navigator.onLine && !isPosActiveCheckout()) {
      event.preventDefault();
      attemptOneShotChunkRecovery();
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const msg = reason?.message || reason;
    if (isChunkLoadErrorMessage(msg)) {
      attemptOneShotChunkRecovery();
    }
  });

  if (!('serviceWorker' in navigator)) return;

  const isIframe = window.self !== window.top;
  if (import.meta.env.DEV && isIframe) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister().catch(() => {}))))
      .catch(() => {});
    return;
  }

  updateSWFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      controller.notifyNeedRefresh();
      window.dispatchEvent(
        new CustomEvent('saimetric_update_ready', {
          detail: { registration: activeRegistration },
        })
      );
    },
    onOfflineReady() {
      controller.notifyOfflineReady();
      window.dispatchEvent(new CustomEvent('saimetric_offline_ready'));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      activeRegistration = registration;
      if (registration.waiting) {
        controller.notifyNeedRefresh();
      }
      setInterval(() => {
        if (navigator.onLine) {
          registration.update().catch(() => {});
        }
      }, 30 * 60 * 1000);
    },
    onRegisterError(err) {
      console.warn('[PWAUpdateManager] Service Worker registration notice:', err);
    },
  });

  window.addEventListener('online', () => {
    void controller.checkForUpdate();
  });

  let lastFocusCheckAt = Date.now();
  const handleFocusUpdateCheck = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastFocusCheckAt < 60_000) return;
    lastFocusCheckAt = now;
    void controller.checkForUpdate();
  };
  document.addEventListener('visibilitychange', handleFocusUpdateCheck);
}

export type ManualUpdateCheckStatus =
  | 'offline'
  | 'unsupported'
  | 'update_ready'
  | 'up_to_date'
  | 'error';

export interface ManualUpdateCheckResult {
  status: ManualUpdateCheckStatus;
  message: string;
}

function waitForInstallingWorker(
  worker: ServiceWorker,
  timeoutMs = 10_000
): Promise<'installed' | 'timeout' | 'redundant'> {
  return new Promise((resolve) => {
    if (worker.state === 'installed') {
      resolve('installed');
      return;
    }
    if (worker.state === 'redundant') {
      resolve('redundant');
      return;
    }
    let settled = false;
    const finish = (res: 'installed' | 'timeout' | 'redundant') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('statechange', onStateChange);
      resolve(res);
    };
    const onStateChange = () => {
      if (worker.state === 'installed') finish('installed');
      else if (worker.state === 'redundant') finish('redundant');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    worker.addEventListener('statechange', onStateChange);
  });
}

/**
 * Manually checks Vercel / the origin server for a new Service Worker build right now.
 * Waits briefly if a new Service Worker starts installing so the user gets immediate feedback.
 */
export async function checkForPWAUpdateManual(): Promise<ManualUpdateCheckResult> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { status: 'unsupported', message: 'Updates are only available in a browser.' };
  }
  if (!navigator.onLine) {
    return {
      status: 'offline',
      message: 'You are offline. Connect to the internet to check for updates.',
    };
  }
  if (!('serviceWorker' in navigator)) {
    return {
      status: 'unsupported',
      message: 'Service Worker not active here. Use Force Refresh to reload the latest version.',
    };
  }

  try {
    const reg = activeRegistration || (await navigator.serviceWorker.getRegistration()) || null;
    if (reg) {
      activeRegistration = reg;
    }

    if (controller.getState().updateAvailable || reg?.waiting) {
      controller.notifyNeedRefresh();
      return {
        status: 'update_ready',
        message: 'New version is ready — tap Update Now to apply.',
      };
    }

    if (!reg) {
      return {
        status: 'unsupported',
        message: 'No active PWA cache detected. Use Force Refresh to load the latest build.',
      };
    }

    await reg.update();

    if (reg.waiting) {
      controller.notifyNeedRefresh();
      return {
        status: 'update_ready',
        message: 'New version downloaded — tap Update Now to apply.',
      };
    }

    if (reg.installing) {
      const outcome = await waitForInstallingWorker(reg.installing, 10_000);
      if (outcome === 'installed' || reg.waiting) {
        controller.notifyNeedRefresh();
        return {
          status: 'update_ready',
          message: 'New version downloaded — tap Update Now to apply.',
        };
      }
    }

    if (controller.getState().updateAvailable || reg.waiting) {
      controller.notifyNeedRefresh();
      return {
        status: 'update_ready',
        message: 'New version downloaded — tap Update Now to apply.',
      };
    }

    return {
      status: 'up_to_date',
      message: 'Already on the latest version. Use Force Refresh if you just deployed.',
    };
  } catch (err: any) {
    console.warn('[PWAUpdateManager] Manual update check failed:', err);
    return {
      status: 'error',
      message: err?.message || 'Could not check for updates. Try Force Refresh.',
    };
  }
}

/**
 * Clears ONLY static PWA asset caches & unregisters old Service Workers, then reloads fresh
 * from Vercel. Never touches IndexedDB, localStorage, sales, inventory, or offline sync queues.
 */
export async function forceRefreshAppCache(): Promise<{ ok: boolean; message: string }> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { ok: false, message: 'Reload is only available in a browser.' };
  }
  if (!navigator.onLine) {
    return {
      ok: false,
      message: 'Cannot force refresh while offline — reconnect to the internet first.',
    };
  }
  if (isPosActiveCheckout()) {
    return {
      ok: false,
      message: 'Finish or park the active POS checkout cart before refreshing.',
    };
  }

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch (err) {
    console.warn('[PWAUpdateManager] Cache clear warning before reload:', err);
  }

  window.location.reload();
  return { ok: true, message: 'Refreshing to latest version…' };
}

export const getPWAUpdateState = () => controller.getState();
export const subscribePWAUpdateState = (listener: (next: PWAUpdateState) => void) =>
  controller.subscribe(listener);
export const applyPWAUpdate = (options?: { force?: boolean }) =>
  controller.requestApplyUpdate(options);
export const queuePWAUpdateAfterCheckout = () => controller.queueUpdateAfterCheckout();
export const cancelQueuedPWAUpdate = () => controller.cancelQueuedUpdate();
export const dismissPWAUpdatePrompt = () => controller.dismissPrompt();
export const clearPWAOfflineReadyNotice = () => controller.clearOfflineReady();
export const checkForPWAUpdate = () => controller.checkForUpdate();
