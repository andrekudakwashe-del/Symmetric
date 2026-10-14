/**
 * Saimetric Unified Sync Service (JS Export)
 * Implements Local-First P2P Sync Logic:
 * if (localHostReachable) syncToLocalHost() else if (navigator.onLine) syncToCloud()
 */

export { syncService, default } from './syncService.ts';
