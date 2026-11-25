/**
 * Pure, testable state machine for checkout-safe PWA updates (Phase 4A).
 * Separated from `virtual:pwa-register` so it can be unit-tested in Node/tsx.
 */

export interface PWAUpdateState {
  updateAvailable: boolean;
  offlineReady: boolean;
  isCheckoutBusy: boolean;
  autoApplyWhenIdle: boolean;
  isApplyingUpdate: boolean;
  dismissedForSession: boolean;
  lastCheckedAt: number | null;
}

export interface PWAUpdateControllerDeps {
  isCheckoutActive: () => boolean;
  triggerUpdateSW: (reloadPage?: boolean) => Promise<void>;
  checkRegistrationUpdate: () => Promise<void>;
  onReloadFallback: () => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  idleApplyDelayMs?: number;
}

const DEFAULT_IDLE_APPLY_DELAY_MS = 650;

export function isChunkLoadErrorMessage(message: unknown): boolean {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('failed to fetch dynamically imported module') ||
    text.includes('importing a module script failed') ||
    text.includes('loading chunk') ||
    text.includes('chunkloaderror') ||
    text.includes('error loading dynamically imported module')
  );
}

export function createPWAUpdateController(deps: PWAUpdateControllerDeps) {
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((id) => clearTimeout(id));
  const idleDelayMs = deps.idleApplyDelayMs ?? DEFAULT_IDLE_APPLY_DELAY_MS;

  let state: PWAUpdateState = {
    updateAvailable: false,
    offlineReady: false,
    isCheckoutBusy: deps.isCheckoutActive(),
    autoApplyWhenIdle: false,
    isApplyingUpdate: false,
    dismissedForSession: false,
    lastCheckedAt: null,
  };

  let idleApplyTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(next: PWAUpdateState) => void>();

  const emit = () => {
    const snapshot = { ...state };
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {}
    });
  };

  const setState = (patch: Partial<PWAUpdateState>) => {
    state = { ...state, ...patch };
    emit();
  };

  const cancelIdleApplyTimer = () => {
    if (idleApplyTimer) {
      clearTimer(idleApplyTimer);
      idleApplyTimer = null;
    }
  };

  const executeApply = async (): Promise<boolean> => {
    if (state.isApplyingUpdate) return false;
    cancelIdleApplyTimer();
    setState({ isApplyingUpdate: true, autoApplyWhenIdle: false });
    try {
      await deps.triggerUpdateSW(true);
      return true;
    } catch (err) {
      console.warn('[PWAUpdateManager] triggerUpdateSW failed, using reload fallback:', err);
      deps.onReloadFallback();
      return true;
    }
  };

  const refreshCheckoutStatus = () => {
    const busy = deps.isCheckoutActive();
    if (busy !== state.isCheckoutBusy) {
      setState({ isCheckoutBusy: busy });
    }

    if (!busy && state.updateAvailable && state.autoApplyWhenIdle && !state.isApplyingUpdate) {
      cancelIdleApplyTimer();
      idleApplyTimer = setTimer(() => {
        if (!deps.isCheckoutActive() && state.updateAvailable && state.autoApplyWhenIdle) {
          void executeApply();
        }
      }, idleDelayMs);
    } else if (busy) {
      cancelIdleApplyTimer();
    }
  };

  const notifyNeedRefresh = () => {
    const busy = deps.isCheckoutActive();
    setState({
      updateAvailable: true,
      isCheckoutBusy: busy,
      dismissedForSession: false,
      lastCheckedAt: Date.now(),
    });
  };

  const notifyOfflineReady = () => {
    setState({
      offlineReady: true,
      lastCheckedAt: Date.now(),
    });
  };

  const clearOfflineReady = () => {
    if (state.offlineReady) {
      setState({ offlineReady: false });
    }
  };

  /**
   * Requests applying the waiting Service Worker.
   * If checkout is active and `force` is not explicitly true, automatically
   * arms `autoApplyWhenIdle` instead of interrupting the active customer cart.
   */
  const requestApplyUpdate = async (
    options?: { force?: boolean }
  ): Promise<'applied' | 'queued' | 'noop'> => {
    if (!state.updateAvailable || state.isApplyingUpdate) return 'noop';
    const busy = deps.isCheckoutActive();
    if (busy && !options?.force) {
      setState({ isCheckoutBusy: true, autoApplyWhenIdle: true, dismissedForSession: false });
      return 'queued';
    }
    await executeApply();
    return 'applied';
  };

  const queueUpdateAfterCheckout = () => {
    if (!state.updateAvailable) return;
    setState({
      autoApplyWhenIdle: true,
      dismissedForSession: false,
      isCheckoutBusy: deps.isCheckoutActive(),
    });
    refreshCheckoutStatus();
  };

  const cancelQueuedUpdate = () => {
    cancelIdleApplyTimer();
    setState({ autoApplyWhenIdle: false });
  };

  const dismissPrompt = () => {
    cancelIdleApplyTimer();
    setState({ dismissedForSession: true, autoApplyWhenIdle: false });
  };

  const checkForUpdate = async () => {
    setState({ lastCheckedAt: Date.now() });
    try {
      await deps.checkRegistrationUpdate();
    } catch {}
  };

  const getState = (): PWAUpdateState => ({ ...state });

  const subscribe = (listener: (next: PWAUpdateState) => void): (() => void) => {
    listeners.add(listener);
    listener(getState());
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getState,
    subscribe,
    notifyNeedRefresh,
    notifyOfflineReady,
    clearOfflineReady,
    refreshCheckoutStatus,
    requestApplyUpdate,
    queueUpdateAfterCheckout,
    cancelQueuedUpdate,
    dismissPrompt,
    checkForUpdate,
  };
}
