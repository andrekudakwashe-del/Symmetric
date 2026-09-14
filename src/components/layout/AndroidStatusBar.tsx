import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Battery, Zap, ShieldCheck, Radio } from 'lucide-react';
import { isOfflineModeForced } from '../../db/roomDatabase';
import { meshSyncService } from '../../services/meshSyncService';

interface AndroidStatusBarProps {
  isOffline: boolean;
  onToggleOffline?: () => void;
  onOpenConnectivity?: () => void;
}

export const AndroidStatusBar: React.FC<AndroidStatusBarProps> = ({
  isOffline,
  onToggleOffline,
  onOpenConnectivity,
}) => {
  const [time, setTime] = useState<string>('');
  const [peerCount, setPeerCount] = useState<number>(0);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsub = meshSyncService.subscribePeers((count) => {
      setPeerCount(count);
    });
    return () => unsub();
  }, []);

  return (
    <div className="w-full bg-[#18113c] text-white/90 text-xs px-4 py-1.5 flex items-center justify-between font-mono-num select-none border-b border-purple-900/30">
      <div className="flex items-center space-x-2">
        <span className="font-bold text-[13px] tracking-tight">{time || '09:41'}</span>
        <span className="text-[10px] bg-purple-500/20 text-purple-200 px-1.5 py-0.5 rounded font-sans font-medium">
          SAIMETRIC OS
        </span>
      </div>

      <div className="flex items-center space-x-2.5 text-slate-300">
        {/* Clickable P2P Mesh Connectivity Indicator */}
        <button
          type="button"
          onClick={onOpenConnectivity}
          title="Open P2P WiFi Mesh Connections & Setup"
          className={`flex items-center space-x-1 px-2 py-0.5 rounded-full border text-[11px] font-sans font-medium transition active:scale-95 cursor-pointer ${
            peerCount > 0
              ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/40 text-emerald-200'
              : 'bg-indigo-500/20 hover:bg-indigo-500/30 border-indigo-400/30 text-indigo-200'
          }`}
        >
          <Wifi className={`w-3.5 h-3.5 ${peerCount > 0 ? 'text-emerald-300 animate-bounce' : 'text-indigo-300 animate-pulse'}`} />
          <span>Mesh: <strong className="text-white font-mono">{peerCount > 0 ? `${peerCount + 1} Terminals` : '1 Terminal'}</strong></span>
        </button>

        <div className="flex items-center space-x-1">
          {isOffline ? (
            <button
              type="button"
              onClick={onToggleOffline}
              className="flex items-center text-amber-300 text-[11px] font-sans font-medium hover:underline"
            >
              <WifiOff className="w-3.5 h-3.5 mr-0.5" /> Offline Room
            </button>
          ) : (
            <span className="flex items-center text-emerald-400 text-[11px] font-sans font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
              <span>5G Sync</span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1 text-slate-200">
          <span className="text-[11px]">98%</span>
          <Battery className="w-4 h-4 text-emerald-400 fill-emerald-400" />
        </div>
      </div>
    </div>
  );
};
