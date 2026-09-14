import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

interface OfflineIndicatorProps {
  isSimulatedOffline?: boolean;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ isSimulatedOffline }) => {
  const [isBrowserOnline, setIsBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [dismissed, setDismissed] = useState(false);

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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isActuallyOffline = !isBrowserOnline || isSimulatedOffline;

  if (!isActuallyOffline || dismissed) return null;

  return (
    <aside
      id="pwa-offline-banner"
      aria-label="Offline status notice"
      className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 flex items-center justify-between gap-3 rounded-2xl bg-amber-500/95 text-slate-950 px-4 py-2.5 text-xs font-bold shadow-2xl backdrop-blur-md border border-amber-300/60 transition-all"
    >
      <div className="flex items-center space-x-2.5 min-w-0">
        <div className="w-6 h-6 rounded-full bg-slate-950/20 flex items-center justify-center shrink-0">
          <WifiOff className="w-3.5 h-3.5 text-slate-950" />
        </div>
        <div className="truncate">
          <p className="font-extrabold text-[11px] uppercase tracking-wider">
            {!isBrowserOnline ? 'Network Disconnected (Offline)' : 'Simulated Offline Mode'}
          </p>
          <p className="text-[10px] opacity-90 truncate">
            POS, inventory, cash count &amp; local Room DB running offline.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[11px] underline font-black shrink-0 px-1.5 py-0.5 hover:opacity-75"
      >
        Dismiss
      </button>
    </aside>
  );
};
