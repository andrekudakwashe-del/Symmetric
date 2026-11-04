import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { meshSyncService, MeshSyncProgress } from '../../services/meshSyncService';

export const SyncProgressIndicator: React.FC = () => {
  const [progress, setProgress] = useState<MeshSyncProgress>(() => meshSyncService.getSyncProgress());
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    // 1. Subscribe to meshSyncService progress callbacks
    const unsub = meshSyncService.subscribeSyncProgress((prog) => {
      setProgress(prog);
      if (prog.isActive || (prog.total > 0 && prog.current >= prog.total && prog.percentage === 100)) {
        setVisible(true);
      }
    });

    // 2. Also listen for window custom events as a decoupled fallback
    const handleEvent = (e: Event) => {
      const customEvt = e as CustomEvent<MeshSyncProgress>;
      if (customEvt.detail) {
        setProgress(customEvt.detail);
        if (customEvt.detail.isActive || customEvt.detail.percentage === 100) {
          setVisible(true);
        }
      }
    };

    window.addEventListener('saimetric_sync_progress', handleEvent);

    return () => {
      unsub();
      window.removeEventListener('saimetric_sync_progress', handleEvent);
    };
  }, []);

  // Auto-hide 2 seconds after completion
  useEffect(() => {
    if (!progress.isActive && progress.percentage === 100) {
      const timer = setTimeout(() => {
        setVisible(false);
      }, 2000);
      return () => clearTimeout(timer);
    } else if (!progress.isActive && progress.total === 0) {
      setVisible(false);
    }
  }, [progress.isActive, progress.percentage, progress.total]);

  if (!visible || (progress.total === 0 && !progress.isActive)) {
    return null;
  }

  const isCompleted = !progress.isActive && progress.percentage === 100;

  return (
    <aside
      aria-label="Data Synchronization Progress"
      aria-live="polite"
      className="fixed bottom-20 right-4 sm:top-4 sm:bottom-auto sm:right-4 z-[9999] pointer-events-none select-none transition-all duration-300 animate-in fade-in slide-in-from-top-2"
    >
      <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md border border-indigo-500/30 text-white rounded-2xl p-3 sm:p-3.5 shadow-2xl flex flex-col gap-2 min-w-[260px] max-w-xs ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {isCompleted ? (
              <div className="w-6 h-6 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            ) : (
              <div className="w-6 h-6 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              </div>
            )}
            <div className="min-w-0">
              <span className="text-xs font-black tracking-tight text-slate-100 block truncate">
                {isCompleted ? 'Sync Complete' : progress.message || `Syncing ${progress.current}/${progress.total} items...`}
              </span>
              <span className="text-[10px] text-slate-400 block font-mono">
                {isCompleted ? `${progress.total} records updated` : `${progress.percentage}% complete • Main thread free`}
              </span>
            </div>
          </div>
          <span className="text-[11px] font-mono font-bold text-indigo-300 shrink-0">
            {progress.percentage}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden p-0.5 border border-slate-700/50">
          <div
            className={`h-full rounded-full transition-all duration-200 ease-out ${
              isCompleted
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
                : 'bg-gradient-to-r from-indigo-500 via-indigo-400 to-cyan-400 shadow-[0_0_8px_rgba(99,102,241,0.5)]'
            }`}
            style={{ width: `${Math.max(4, Math.min(100, progress.percentage))}%` }}
          />
        </div>
      </div>
    </aside>
  );
};
