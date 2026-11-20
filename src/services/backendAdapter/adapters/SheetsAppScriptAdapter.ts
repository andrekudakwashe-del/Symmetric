import {
  IBackendAdapter,
  BackendType,
  TenantBackendConfig,
  BackendConnectionTestResult,
  TenantDataSnapshot,
  PruneResult,
} from '../types';
import {
  DEFAULT_MASTER_WEBHOOK_URL,
  getSheetsConfig,
  getCurrentCompany,
} from '../../../db/roomDatabase';
import { pingGasDeployment, resolveSafeGasTarget } from '../../sync/gasTransport';
import { roomBackendAdapter } from './RoomAdapter';

export class SheetsAppScriptAdapter implements IBackendAdapter {
  readonly id = 'adapter-sheets-appscript';
  readonly type: BackendType = 'sheets_appscript';
  readonly name = 'Google Sheets & Apps Script';
  readonly tierLabel = 'Starter Package Tier';
  readonly description = 'Cloud multi-branch spreadsheet sync powered by Google Apps Script webhooks. Transparent, accessible, and spreadsheet-native.';

  isConfigured(config: TenantBackendConfig): boolean {
    const companyId = (config as any).companyId || getCurrentCompany()?.company_id || '';
    const target = resolveSafeGasTarget({
      companyId,
      webhookUrl:
        config.sheets?.webhookUrl ||
        config.sheets?.masterWebhookUrl ||
        getSheetsConfig().masterWebhookUrl ||
        DEFAULT_MASTER_WEBHOOK_URL,
      spreadsheetId: config.sheets?.spreadsheetId,
    });
    return !!target.webhookUrl && target.webhookUrl.startsWith('http');
  }

  async testConnection(config: TenantBackendConfig): Promise<BackendConnectionTestResult> {
    const companyId = (config as any).companyId || getCurrentCompany()?.company_id || '';
    const target = resolveSafeGasTarget({
      companyId,
      webhookUrl:
        config.sheets?.webhookUrl ||
        config.sheets?.masterWebhookUrl ||
        getSheetsConfig().masterWebhookUrl ||
        DEFAULT_MASTER_WEBHOOK_URL,
      spreadsheetId: config.sheets?.spreadsheetId,
    });

    if (!target.webhookUrl) {
      return {
        success: false,
        latencyMs: 0,
        testedAt: new Date().toISOString(),
        message: 'No Apps Script Webhook URL configured.',
      };
    }

    const ping = await pingGasDeployment(target.webhookUrl, 18_000);
    if (ping.online && !ping.isLegacyDeployment) {
      return {
        success: true,
        latencyMs: ping.latencyMs,
        testedAt: new Date().toISOString(),
        message: `Google Apps Script ${ping.version || 'V7.0'} is online (${ping.latencyMs}ms).`,
        details: {
          webhookUrl: target.webhookUrl,
          version: ping.version,
          schemaVersion: ping.schemaVersion,
          sheetId: target.spreadsheetId || 'Dedicated Sheet Pending',
          blockedMasterSheetLeak: target.blockedMasterSheetLeak,
          isolationMode: config.sheets?.isolationMode || 'DEDICATED_SHEET',
        },
      };
    }

    return {
      success: false,
      latencyMs: ping.latencyMs,
      testedAt: new Date().toISOString(),
      message: ping.error || 'Apps Script health check failed. Verify V7.0 Web App deployment.',
      details: {
        webhookUrl: target.webhookUrl,
        isLegacyDeployment: ping.isLegacyDeployment,
        schemaVersion: ping.schemaVersion,
      },
    };
  }

  async exportSnapshot(companyId: string): Promise<TenantDataSnapshot> {
    // Room DB acts as the universal local cache/staging format
    const snapshot = await roomBackendAdapter.exportSnapshot(companyId);
    snapshot.backendSource = 'sheets_appscript';
    return snapshot;
  }

  async importSnapshot(
    companyId: string,
    snapshot: TenantDataSnapshot
  ): Promise<{ success: boolean; recordsWritten: number; errors?: string[] }> {
    // Stage into local cache then trigger standard sync queue
    const result = await roomBackendAdapter.importSnapshot(companyId, snapshot);
    return {
      success: result.success,
      recordsWritten: result.recordsWritten,
      errors: result.errors,
    };
  }

  async pruneHistoricalData(companyId: string, retentionMonths: number): Promise<PruneResult> {
    // Prune locally buffered data and return report
    return roomBackendAdapter.pruneHistoricalData(companyId, retentionMonths);
  }
}

export const sheetsAppScriptAdapter = new SheetsAppScriptAdapter();
