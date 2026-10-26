import React, { useState, useEffect, useRef } from 'react';
import { Radio, RefreshCw, X } from 'lucide-react';
import { meshSyncService, MeshConnectionMode } from '../../services/meshSyncService';
import { LocalHubSettingsModal } from '../sync/LocalHubSettingsModal';

interface OfflineIndicatorProps {
  isSimulatedOffline?: boolean;
  onOpenHubSettings?: () => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  isSimulatedOffline,
  onOpenHubSettings,
}) => {
  const [isBrowserOnline, setIsBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [dismissed, setDismissed] = useState(false);
  const [connMode, setConnMode] = useState<MeshConnectionMode>(() => meshSyncService.getConnectionMode());
  const [connDetails, setConnDetails] = useState<any>(() => meshSyncService.getConnectionStatus());
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Industry Standard (Toast / Microsoft Dynamics 365 POS):
  // Track previous connection loss state to trigger an alert EXACTLY ONCE per disconnect incident.
  // Subsequent background reconnect attempts (every 5 seconds) must NEVER re-pop the alert.
  const prevIsLostRef = useRef<boolean>(false);
  const autoDismissTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true);
    };
    const handleOffline = () => {
      setIsBrowserOnline(false);
      // When browser drops network completely, alert once
      setDismissed(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial state check
    const currentStatus = meshSyncService.getConnectionStatus();
    prevIsLostRef.current = Boolean(currentStatus.isLocalHubLost);

    const unsubMode = meshSyncService.subscribeConnectionMode((mode, details) => {
      setConnMode(mode);
      setConnDetails(details);

      const isLostNow = Boolean(details.isLocalHubLost);
      const wasLostBefore = prevIsLostRef.current;

      // Toast / Dynamics 365 Rule: ALERT ONCE on transition from Connected -> Lost.
      // Do NOT show it again for subsequent failed reconnect attempts every 5s.
      if (!wasLostBefore && isLostNow) {
        prevIsLostRef.current = true;
        setDismissed(false);

        // Auto-dismiss after 10s so the cashier's touch screen is not permanently blocked
        if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
        autoDismissTimerRef.current = window.setTimeout(() => {
          setDismissed(true);
        }, 10000);
      } else if (!isLostNow && (details.isConnected || details.isLocalHubConnected)) {
        // Connection successfully restored: Reset transition tracker so a future drop alerts once
        prevIsLostRef.current = false;
        if (autoDismissTimerRef.current) {
          clearTimeout(autoDismissTimerRef.current);
          autoDismissTimerRef.current = null;
        }
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubMode();
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
      }
    };
  }, []);

  const handleOpenSettings = () => {
    if (onOpenHubSettings) {
      onOpenHubSettings();
    } else {
      setIsModalOpen(true);
    }
  };

  const handleDismiss = () => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
    // Dismiss stays active for the entire duration of this disconnect episode
    setDismissed(true);
  };

  // If fully online in Cloud Mesh and no simulation, banner is not needed
  const isOnlineCloud = isBrowserOnline && !isSimulatedOffline && connMode === 'CLOUD_MESH';
  if (isOnlineCloud || dismissed) {
    return (
      <LocalHubSettingsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    );
  }

  // 1. Alert Once Banner (Toast / Dynamics 365 style):
  if (connDetails.isLocalHubLost) {
    return (
      <>
        <aside
          id="pwa-offline-banner"
          aria-label="Offline Mode: Reconnecting in background"
          className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 flex items-center justify-between gap-3 rounded-2xl bg-slate-900/95 text-white px-4 py-3 text-xs font-bold shadow-2xl backdrop-blur-md border border-amber-500/40 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
              <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            </div>
            <div className="truncate">
              <p className="font-extrabold text-[11px] uppercase tracking-wider text-amber-200">
                Offline Mode: Reconnecting in background
              </p>
              <p className="text-[10px] opacity-80 truncate text-slate-300">
                Local Hub disconnected • Outgoing sales queued in Room DB.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenSettings}
              className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-bold px-2.5 py-1.5 rounded-lg border border-amber-500/40 transition cursor-pointer active:scale-95"
            >
              Configure
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-slate-800 transition cursor-pointer active:scale-95 flex items-center gap-1"
              title="Dismiss alert"
            >
              <X className="w-3.5 h-3.5" />
              <span>Dismiss</span>
            </button>
          </div>
        </aside>

        <LocalHubSettingsModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  }

  // 2. Connected to Local WebSocket Hub: 🔵 Local Hub Connected
  if (connMode === 'LOCAL_HUB' && connDetails.isConnected) {
    return (
      <>
        <aside
          id="pwa-offline-banner"
          aria-label="Local WebSocket Hub status"
          className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 flex items-center justify-between gap-3 rounded-2xl bg-blue-600/95 text-white px-4 py-2.5 text-xs font-bold shadow-2xl backdrop-blur-md border border-blue-400/60 transition-all animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-6 h-6 rounded-full bg-black/25 flex items-center justify-center shrink-0">
              <Radio className="w-3.5 h-3.5 text-blue-200" />
            </div>
            <div className="truncate">
              <p className="font-extrabold text-[11px] uppercase tracking-wider text-blue-100 flex items-center gap-1.5">
                <span>🔵 Local Hub Connected</span>
                {connDetails.forceLocalHub && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-blue-900/60 font-mono">
                    FORCED
                  </span>
                )}
              </p>
              <p className="text-[10px] opacity-90 truncate text-blue-200 font-mono">
                {connDetails.localHubUrl || 'ws://192.168.43.1:8080'} • Zero internet needed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenSettings}
              className="text-[10px] bg-black/30 hover:bg-black/40 px-2 py-1 rounded-lg border border-white/20 transition cursor-pointer active:scale-95"
            >
              Hub
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-[11px] underline font-black px-1.5 py-0.5 hover:opacity-75 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </aside>

        <LocalHubSettingsModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  }

  // 3. Silent Reconnect Grace Period:
  // If disconnected but under 2 minutes (not marked as isLocalHubLost), show NO banner.
  // The app silently reconnects in the background without disturbing the cashier or cashier UI.
  if (connDetails.isReconnecting || !connDetails.isLocalHubLost) {
    return (
      <LocalHubSettingsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    );
  }

  // Fallback modal container
  return (
    <LocalHubSettingsModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
    />
  );
};
