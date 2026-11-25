import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Clock, X, WifiOff } from 'lucide-react';
import {
  PWAUpdateState,
  getPWAUpdateState,
  subscribePWAUpdateState,
  applyPWAUpdate,
  queuePWAUpdateAfterCheckout,
  cancelQueuedPWAUpdate,
  dismissPWAUpdatePrompt,
  clearPWAOfflineReadyNotice,
} from '../../services/pwaUpdateManager';

/**
 * Checkout-Safe PWA Update & Offline-Ready Banner (Phase 4A).
 * - Never interrupts an active POS sale (`isCheckoutBusy`).
 * - Allows queuing an update to activate automatically as soon as the cart clears.
 * - Shows a brief auto-dismissing confirmation toast once Workbox precaches all modules offline.
 */
export const PWAUpdateBanner: React.FC = () => {
  const [state, setState] = useState<PWAUpdateState>(() => getPWAUpdateState());

  useEffect(() => {
    return subscribePWAUpdateState(setState);
  }, []);

  useEffect(() => {
    if (!state.offlineReady) return;
    const timer = setTimeout(() => {
      clearPWAOfflineReadyNotice();
    }, 4500);
    return () => clearTimeout(timer);
  }, [state.offlineReady]);

  return (
    <>
      {state.updateAvailable && !state.dismissedForSession && (
        <div
          role="alert"
          className={`fixed top-0 left-0 right-0 z-[10000] px-3 sm:px-4 py-2.5 shadow-xl border-b backdrop-blur-md transition-colors ${
            state.isCheckoutBusy
              ? 'bg-amber-950/95 border-amber-500/40 text-amber-100'
              : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-600 border-indigo-400/40 text-white'
          }`}
        >
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {state.isCheckoutBusy ? (
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <RefreshCw
                  className={`w-4 h-4 shrink-0 ${state.isApplyingUpdate ? 'animate-spin' : ''}`}
                />
              )}
              <span className="font-bold truncate">
                {state.isApplyingUpdate
                  ? 'Applying SAIMETRIC update…'
                  : state.isCheckoutBusy
                    ? state.autoApplyWhenIdle
                      ? 'Update queued — will apply automatically after this sale finishes'
                      : 'SAIMETRIC update ready — paused while checkout cart is active'
                    : 'SAIMETRIC v5.0 update ready for offline & POS terminals'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {state.isCheckoutBusy ? (
                state.autoApplyWhenIdle ? (
                  <button
                    type="button"
                    onClick={cancelQueuedPWAUpdate}
                    className="px-2.5 py-1 rounded-lg bg-amber-900/80 hover:bg-amber-800 text-amber-100 border border-amber-500/40 text-[11px] font-bold transition cursor-pointer"
                  >
                    Cancel Auto-Apply
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={queuePWAUpdateAfterCheckout}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-black transition cursor-pointer"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Apply After Sale</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={state.isApplyingUpdate}
                  onClick={() => void applyPWAUpdate()}
                  className="px-3 py-1 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 text-[11px] font-black tracking-wide uppercase transition cursor-pointer shadow-sm"
                >
                  {state.isApplyingUpdate ? 'Updating…' : 'Update Now'}
                </button>
              )}

              {!state.isApplyingUpdate && (
                <button
                  type="button"
                  onClick={dismissPWAUpdatePrompt}
                  aria-label="Dismiss update banner for now"
                  className="p-1 rounded-lg hover:bg-white/15 text-current opacity-80 hover:opacity-100 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {state.offlineReady && !state.updateAvailable && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[9998] max-w-sm rounded-xl bg-emerald-950/95 border border-emerald-500/40 text-emerald-100 px-3.5 py-2.5 shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-xs"
        >
          <WifiOff className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-semibold">
            Offline cache ready — all POS, inventory &amp; cash modules now work without internet.
          </span>
          <button
            type="button"
            onClick={clearPWAOfflineReadyNotice}
            aria-label="Dismiss offline ready notice"
            className="text-emerald-300/70 hover:text-white p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
