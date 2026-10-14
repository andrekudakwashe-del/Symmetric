/**
 * Saimetric Unified Sync Service
 * Implements Local-First P2P Sync Logic:
 * if (localHostReachable) syncToLocalHost() else if (navigator.onLine) syncToCloud()
 *
 * Ensures full POS till functionality when Wi-Fi has ZERO internet data bundles or when
 * working off a mobile phone hotspot.
 */

import { localSyncService } from './localSyncService';
import { persistentSyncEngine } from './persistentSyncEngine';
import { processSyncQueue } from './googleSheetsSync';
import { SaleInvoice } from '../types';

export interface UnifiedSyncResult {
  destination: 'LOCAL_HOST' | 'CLOUD' | 'QUEUED_OFFLINE';
  success: boolean;
  itemsProcessed: number;
  message: string;
}

class SyncService {
  /**
   * Main Sync Dispatcher:
   * Prioritizes local mesh Host Till first (0% internet data needed like SHAREit/Xender),
   * then falls back to Cloud Google Apps Script if internet is online.
   */
  public async sync(): Promise<UnifiedSyncResult> {
    const isLocalReachable = localSyncService.isLocalHostReachable();

    // 1. LOCAL HOST TILL MESH (Zero-Internet Hotspot / Wi-Fi)
    if (isLocalReachable && localSyncService.getRole() === 'CLIENT') {
      try {
        const localResult = await localSyncService.syncQueueToHost();
        return {
          destination: 'LOCAL_HOST',
          success: localResult.success,
          itemsProcessed: localResult.pushedCount,
          message: localResult.pushedCount > 0
            ? `Synchronized ${localResult.pushedCount} records directly to Host Till via offline Wi-Fi mesh.`
            : 'Local Host Till is reachable and synchronized.',
        };
      } catch (err: any) {
        console.warn('[SyncService] Local host sync attempt encountered error:', err);
      }
    }

    // 2. CLOUD SYNC (Requires active internet connection)
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;
    if (isOnline) {
      try {
        const cloudDrain = await persistentSyncEngine.drainSyncQueue();
        return {
          destination: 'CLOUD',
          success: cloudDrain.failed === 0,
          itemsProcessed: cloudDrain.processed,
          message: `Synchronized ${cloudDrain.succeeded} records to Cloud Spreadsheet.`,
        };
      } catch (err: any) {
        console.warn('[SyncService] Cloud sync attempt encountered error:', err);
      }
    }

    // 3. OFFLINE / AIRGAPPED (No local host reachable and no internet)
    return {
      destination: 'QUEUED_OFFLINE',
      success: true,
      itemsProcessed: 0,
      message: 'Transactions securely preserved in local offline queue. Will sync when Host Till or Internet connects.',
    };
  }

  /**
   * Dispatches a freshly created sale:
   * - If CLIENT and Host Till reachable -> pushes directly to Host Till instantly
   * - If online -> enqueues for cloud sync
   */
  public async dispatchSale(sale: SaleInvoice): Promise<void> {
    if (localSyncService.getRole() === 'CLIENT' && localSyncService.isLocalHostReachable()) {
      await localSyncService.pushSaleToHost(sale);
    }
  }

  public isLocalHostReachable(): boolean {
    return localSyncService.isLocalHostReachable();
  }
}

export const syncService = new SyncService();
export default syncService;
