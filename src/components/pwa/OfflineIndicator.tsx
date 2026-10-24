import React, { useState, useEffect } from 'react';
import { WifiOff, Radio, RefreshCw, Settings, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
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

  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true);
      setDismissed(false);
    };
    const handleOffline = () => {
      setIsBrowserOnline(false);
      setDismissed(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubMode = meshSyncService.subscribeConnectionMode((mode, details) => {
      setConnMode(mode);
      setConnDetails(details);
      // Reset dismissed state when local hub drops so user is immediately notified
      if (details.isLocalHubLost) {
        setDismissed(false);
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubMode();
    };
  }, []);

  const handleOpenSettings = () => {
    if (onOpenHubSettings) {
      onOpenHubSettings();
    } else {
      setIsModalOpen(true);
    }
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

  // 1. Delayed Notification Banner (Only after 2-minute continuous disconnect):
  if (connDetails.isLocalHubLost) {
    return (
      <>
        <aside
          id="pwa-offline-banner"
          aria-label="Offline Mode: Reconnecting in background"
          className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 flex items-center justify-between gap-3 rounded-2xl bg-slate-900/95 text-white px-4 py-3 text-xs font-bold shadow-2xl backdrop-blur-md border border-amber-500/40 transition-all duration-300"
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
              className="text-[10px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-bold px-2.5 py-1.5 rounded-lg border border-amber-500/40 transition cursor-pointer"
            >
              Configure
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-[11px] text-slate-400 hover:text-white px-1.5 py-0.5 transition cursor-pointer"
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

  // 2. Connected to Local WebSocket Hub: 🔵 Local Hub Connected
  if (connMode === 'LOCAL_HUB' && connDetails.isConnected) {
    return (
      <>
        <aside
          id="pwa-offline-banner"
          aria-label="Local WebSocket Hub status"
          className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 flex items-center justify-between gap-3 rounded-2xl bg-blue-600/95 text-white px-4 py-2.5 text-xs font-bold shadow-2xl backdrop-blur-md border border-blue-400/60 transition-all"
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
              className="text-[10px] bg-black/30 hover:bg-black/40 px-2 py-1 rounded-lg border border-white/20 transition cursor-pointer"
            >
              Hub
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-[11px] underline font-black px-1.5 py-0.5 hover:opacity-75"
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
