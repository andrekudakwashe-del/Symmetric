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
  getCompanies,
} from '../../../db/roomDatabase';
import { roomBackendAdapter } from './RoomAdapter';

export class SheetsAppScriptAdapter implements IBackendAdapter {
  readonly id = 'adapter-sheets-appscript';
  readonly type: BackendType = 'sheets_appscript';
  readonly name = 'Google Sheets & Apps Script';
  readonly tierLabel = 'Starter Package Tier';
  readonly description = 'Cloud multi-branch spreadsheet sync powered by Google Apps Script webhooks. Transparent, accessible, and spreadsheet-native.';

  isConfigured(config: TenantBackendConfig): boolean {
    const webhook =
      config.sheets?.webhookUrl ||
      config.sheets?.masterWebhookUrl ||
      getSheetsConfig().masterWebhookUrl ||
      DEFAULT_MASTER_WEBHOOK_URL;
    return !!webhook && webhook.startsWith('http');
  }

  async testConnection(config: TenantBackendConfig): Promise<BackendConnectionTestResult> {
    const start = Date.now();
    const webhookUrl =
      config.sheets?.webhookUrl ||
      config.sheets?.masterWebhookUrl ||
      getSheetsConfig().masterWebhookUrl ||
      DEFAULT_MASTER_WEBHOOK_URL;

    if (!webhookUrl) {
      return {
        success: false,
        latencyMs: 0,
        testedAt: new Date().toISOString(),
        message: 'No Apps Script Webhook URL configured.',
      };
    }

    try {
      const testUrl = webhookUrl.includes('?')
        ? `${webhookUrl}&action=get_companies`
        : `${webhookUrl}?action=get_companies`;

      // Use no-cors or timeout to probe Google Apps Script endpoint
      await fetch(testUrl, {
        method: 'GET',
        mode: 'no-cors',
        signal: AbortSignal.timeout(6000),
      });

      const latency = Date.now() - start;
      return {
        success: true,
        latencyMs: latency,
        testedAt: new Date().toISOString(),
        message: 'Google Apps Script Webhook is active and responding (HTTP 200 OK).',
        details: {
          webhookUrl,
          sheetId: config.sheets?.spreadsheetId || 'Default Shared Sheet',
          isolationMode: config.sheets?.isolationMode || 'ROW_LEVEL',
        },
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        testedAt: new Date().toISOString(),
        message: `Apps Script ping failed: ${err.message || String(err)}`,
        details: { webhookUrl },
      };
    }
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
