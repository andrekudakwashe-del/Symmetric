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
