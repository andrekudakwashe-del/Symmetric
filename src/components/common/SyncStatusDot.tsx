import React, { useState } from 'react';
import { RefreshCw, Check, CloudOff } from 'lucide-react';

export interface SyncStatusDotProps {
  isSynced?: boolean;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed';
  timestamp?: string;
  targetSheet?: string;
  invoiceId?: string;
  invoiceType?: 'sale' | 'supplier_invoice' | 'grv' | 'cash_log' | 'direct_grv' | 'cash_lift' | 'expense';
  onRetry?: () => Promise<any> | any;
  showLabel?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const SyncStatusDot: React.FC<SyncStatusDotProps> = ({
  isSynced,
  syncStatus,
  timestamp,
  targetSheet = 'Cloud Sheets',
  invoiceId,
  onRetry,
  showLabel = true,
  size = 'sm',
  className = '',
}) => {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  // Resolved sync state: synced is true if either flag is explicitly synced
  const resolvedSynced = isSynced === true || syncStatus === 'synced';
  const resolvedSyncing = isRetrying || syncStatus === 'syncing';

  const dotSize =
    size === 'xs' ? 'w-2 h-2' : size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (resolvedSynced || resolvedSyncing || !onRetry) return;

    setIsRetrying(true);
    setRetryNotice('Syncing...');
    try {
      await onRetry();
      setRetryNotice('Synced!');
      setTimeout(() => setRetryNotice(null), 3000);
    } catch (err: any) {
      setRetryNotice(err?.message || 'Sync failed');
      setTimeout(() => setRetryNotice(null), 4000);
    } finally {
      setIsRetrying(false);
    }
  };

  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  if (resolvedSyncing) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-[10px] text-amber-400 select-none ${className}`}
        title={`Syncing ${invoiceId ? `#${invoiceId}` : 'record'} to ${targetSheet}...`}
      >
        <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-400 shrink-0" />
        {showLabel && <span>Syncing...</span>}
      </span>
    );
  }

  if (resolvedSynced) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono text-[10px] text-emerald-400 select-none ${className}`}
        title={`Synced to ${targetSheet}${formattedTime ? ` at ${formattedTime}` : ''} (Cloud Verified)`}
      >
        <span
          className={`${dotSize} rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)] shrink-0 inline-block`}
          aria-hidden="true"
        />
        {showLabel && (
          <span className="flex items-center gap-0.5 text-emerald-400/90 font-medium">
            <span>Synced</span>
            <Check className="w-2.5 h-2.5 text-emerald-400" />
          </span>
        )}
      </span>
    );
  }

  // Unsynchronized / Offline Staged State (Red Dot)
  return (
    <button
      type="button"
      onClick={handleRetry}
      disabled={!onRetry || isRetrying}
      title={
        onRetry
          ? `Unsynchronized (Offline Staged). Click to force sync ${invoiceId ? `#${invoiceId}` : 'voucher'} now.`
          : `Unsynchronized (Stored locally in Room DB)`
      }
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] text-rose-400 select-none group focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 rounded-md transition-all ${
        onRetry ? 'hover:text-rose-300 cursor-pointer active:scale-95' : 'cursor-default'
      } ${className}`}
    >
      <span
        className={`${dotSize} rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)] animate-pulse shrink-0 inline-block`}
        aria-hidden="true"
      />
      {showLabel && (
        <span className="flex items-center gap-1 font-medium text-rose-400/90 group-hover:underline">
          <span>{retryNotice || 'Unsynced'}</span>
          {onRetry && (
            <RefreshCw className="w-2.5 h-2.5 text-rose-400/70 group-hover:rotate-180 transition-transform duration-300" />
          )}
        </span>
      )}
    </button>
  );
};
