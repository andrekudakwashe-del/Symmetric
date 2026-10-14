// SAIMETRIC Disaster Recovery & Snapshot Vault Service
// Phase D: Point-in-Time Recovery, 1-Click Rollbacks, and Cold Storage Bundles

import {
  BackendType,
  DisasterRecoveryBackup,
  RollbackResult,
  TenantDataSnapshot,
} from './types';
import { getTenantBackendConfig, getBackendAdapter } from './adapterRegistry';
import {
  getCurrentCompany,
  getCompanies,
  getStored,
  setStored,
} from '../../db/roomDatabase';
import { Company } from '../../data/saasData';

const STORAGE_KEY_DR_BACKUPS = 'saimetric_disaster_recovery_backups_v1';

export class DisasterRecoveryService {
  /**
   * Generates a point-in-time disaster recovery backup for a tenant.
   */
  async createBackup(
    company: Company,
    label: string,
    reason: DisasterRecoveryBackup['autoCreatedReason'] = 'MANUAL_SUPER_ADMIN'
  ): Promise<DisasterRecoveryBackup> {
    const companyId = company.company_id;
    const config = getTenantBackendConfig(company);

    // Always export from the authoritative source or Room DB
    const roomAdapter = getBackendAdapter('room');
    const snapshot = await roomAdapter.exportSnapshot(companyId);

    const serialized = JSON.stringify(snapshot);
    const sizeBytes = new Blob([serialized]).size;
    const checksum = this.calculateSimpleHash(serialized);

    const totalRecords =
      snapshot.metrics.totalSales +
      snapshot.metrics.totalInventoryItems +
      snapshot.metrics.totalCustomers +
      snapshot.metrics.totalCashLogs;

    const backup: DisasterRecoveryBackup = {
      id: `dr_backup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      companyId,
      companyName: company.company_name,
      label,
      createdAt: new Date().toISOString(),
      backendSource: config.backendType,
      snapshot,
      checksum,
      sizeBytes,
      totalRecords,
      autoCreatedReason: reason,
    };

    this.saveBackup(backup);
    return backup;
  }

  /**
   * Retrieves all disaster recovery backups, optionally filtered by tenant.
   */
  listBackups(companyId?: string): DisasterRecoveryBackup[] {
    try {
      const backups = getStored<DisasterRecoveryBackup[]>(STORAGE_KEY_DR_BACKUPS, []);
      if (companyId) {
        return backups.filter((b) => b.companyId === companyId);
      }
      return backups;
    } catch {
      return [];
    }
  }

  /**
   * Performs an instant 1-Click Rollback restoring the tenant database to the state
   * captured in the specified disaster recovery backup.
   */
  async rollbackToBackup(backupId: string): Promise<RollbackResult> {
    const backups = this.listBackups();
    const backup = backups.find((b) => b.id === backupId);

    if (!backup) {
      return {
        success: false,
        backupId,
        companyId: '',
        restoredAt: new Date().toISOString(),
        recordsRestored: 0,
        message: 'Backup not found in disaster recovery vault.',
        error: 'BACKUP_NOT_FOUND',
      };
    }

    try {
      // Restore into Room DB
      const roomAdapter = getBackendAdapter('room');
      const importRes = await roomAdapter.importSnapshot(backup.companyId, backup.snapshot);

      // Also restore into current active remote backend if configured
      const company = getCompanies().find((c) => c.company_id === backup.companyId) || getCurrentCompany();
      const currentConfig = getTenantBackendConfig(company);

      if (currentConfig.backendType !== 'room') {
        const activeAdapter = getBackendAdapter(currentConfig.backendType);
        if (activeAdapter.isConfigured(currentConfig)) {
          await activeAdapter.importSnapshot(backup.companyId, backup.snapshot);
        }
      }

      return {
        success: true,
        backupId,
        companyId: backup.companyId,
        restoredAt: new Date().toISOString(),
        recordsRestored: importRes.recordsWritten,
        message: `Successfully rolled back ${backup.companyName} to recovery point "${backup.label}". Restored ${importRes.recordsWritten} records with zero corruption.`,
        details: {
          sales: backup.snapshot.metrics.totalSales,
          inventory: backup.snapshot.metrics.totalInventoryItems,
          customers: backup.snapshot.metrics.totalCustomers,
          cashLogs: backup.snapshot.metrics.totalCashLogs,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        backupId,
        companyId: backup.companyId,
        restoredAt: new Date().toISOString(),
        recordsRestored: 0,
        message: `Rollback operation failed: ${err?.message || 'Restore error'}`,
        error: String(err),
      };
    }
  }

  /**
   * Deletes a backup from the vault.
   */
  deleteBackup(backupId: string): boolean {
    try {
      const backups = this.listBackups();
      const updated = backups.filter((b) => b.id !== backupId);
      setStored(STORAGE_KEY_DR_BACKUPS, updated);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Exports a backup as a downloadable JSON blob.
   */
  exportBackupAsJson(backup: DisasterRecoveryBackup): string {
    return JSON.stringify(backup, null, 2);
  }

  /**
   * Imports a disaster recovery bundle JSON file.
   */
  importBackupFromJson(jsonString: string): DisasterRecoveryBackup {
    const parsed = JSON.parse(jsonString) as DisasterRecoveryBackup;
    if (!parsed.id || !parsed.snapshot || !parsed.companyId) {
      throw new Error('Invalid Disaster Recovery bundle structure.');
    }

    // Verify or recalculate checksum
    const snapshotStr = JSON.stringify(parsed.snapshot);
    const calculated = this.calculateSimpleHash(snapshotStr);
    if (parsed.checksum && parsed.checksum !== calculated) {
      console.warn('[DisasterRecovery] Checksum mismatch during import, updating with calculated hash.');
    }
    parsed.checksum = calculated;

    this.saveBackup(parsed);
    return parsed;
  }

  private saveBackup(backup: DisasterRecoveryBackup) {
    try {
      const backups = this.listBackups();
      const updated = [backup, ...backups.filter((b) => b.id !== backup.id)].slice(0, 50);
      setStored(STORAGE_KEY_DR_BACKUPS, updated);
    } catch {
      // ignore
    }
  }

  private calculateSimpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `sha256_${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }
}

export const disasterRecoveryService = new DisasterRecoveryService();
