import { getCompanies, getStored, setStored, addAuditLog } from '../../db/roomDatabase';
import { getTenantBackendConfig, getBackendAdapter, saveTenantBackendConfig } from './adapterRegistry';
import { PruneResult } from './types';

export interface PruneAuditRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  executedAt: string;
  executionType: 'AUTOMATED_SCHEDULED' | 'MANUAL_SUPER_ADMIN';
  retentionMonths: number;
  cutoffDate: string;
  totalPruned: number;
  details: {
    sales: number;
    cashLogs: number;
    expenses: number;
  };
}

const PRUNE_AUDIT_STORAGE_KEY = 'saimetric_retention_prune_audit_logs';

export class RetentionLifecycleService {
  /**
   * Scans all companies and executes automated 3-month pruning if due
   */
  async checkAndRunScheduledPrune(): Promise<PruneAuditRecord[]> {
    const companies = getCompanies();
    const executedRecords: PruneAuditRecord[] = [];

    for (const company of companies) {
      try {
        const config = getTenantBackendConfig(company);
        if (!config.retention.autoDeleteEnabled) continue;

        const lastPruned = config.retention.lastPrunedAt ? new Date(config.retention.lastPrunedAt).getTime() : 0;
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

        // Run if never run before, or if at least 30 days elapsed since last run
        if (Date.now() - lastPruned > thirtyDaysMs) {
          const months = config.retention.retentionMonths || 3;
          const adapter = getBackendAdapter(config.backendType);
          const res = await adapter.pruneHistoricalData(company.company_id, months);

          if (res.totalPrunedRecords > 0 || !config.retention.lastPrunedAt) {
            const auditRecord: PruneAuditRecord = {
              id: `PRUNE-${Date.now().toString(36).toUpperCase()}`,
              tenantId: company.company_id,
              tenantName: company.company_name,
              executedAt: res.prunedAt,
              executionType: 'AUTOMATED_SCHEDULED',
              retentionMonths: months,
              cutoffDate: res.retentionCutoffDate,
              totalPruned: res.totalPrunedRecords,
              details: {
                sales: res.details.sales,
                cashLogs: res.details.cashLogs,
                expenses: res.details.expenses,
              },
            };

            this.appendAuditLog(auditRecord);
            executedRecords.push(auditRecord);

            // Record timestamp in tenant backend config
            saveTenantBackendConfig(company.company_id, {
              retention: {
                ...config.retention,
                lastPrunedAt: res.prunedAt,
              },
            });

            addAuditLog({
              action: 'DATA_RETENTION_AUTO_PRUNE',
              severity: 'SECURITY',
              staffId: 'SYSTEM_CRON',
              staffName: 'Automated Retention Engine',
              staffRole: 'SUPER_ADMIN',
              details: `Auto-pruned ${res.totalPrunedRecords} records older than ${months} months for ${company.company_name}.`,
              referenceId: auditRecord.id,
            });
          }
        }
      } catch (err) {
        console.error(`Retention check failed for ${company.company_id}:`, err);
      }
    }

    return executedRecords;
  }

  /**
   * Retrieves all historical prune logs
   */
  getPruneAuditLogs(): PruneAuditRecord[] {
    return getStored<PruneAuditRecord[]>(PRUNE_AUDIT_STORAGE_KEY, []);
  }

  /**
   * Appends a new prune record to the local audit trail
   */
  appendAuditLog(record: PruneAuditRecord): void {
    const logs = this.getPruneAuditLogs();
    logs.unshift(record);
    // Keep last 100 entries
    if (logs.length > 100) logs.pop();
    setStored(PRUNE_AUDIT_STORAGE_KEY, logs);
  }
}

export const retentionLifecycleService = new RetentionLifecycleService();
