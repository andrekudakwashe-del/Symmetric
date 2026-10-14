import {
  IBackendAdapter,
  BackendType,
  TenantBackendConfig,
  BackendConnectionTestResult,
  TenantDataSnapshot,
  PruneResult,
} from '../types';
import { roomBackendAdapter } from './RoomAdapter';

export class SupabaseBackendAdapter implements IBackendAdapter {
  readonly id = 'adapter-supabase';
  readonly type: BackendType = 'supabase';
  readonly name = 'Supabase & PostgreSQL Cloud';
  readonly tierLabel = 'Large Enterprise Tier';
  readonly description = 'Relational PostgreSQL database with enterprise row-level security (RLS), real-time replication, and high-throughput SQL analytics.';

  isConfigured(config: TenantBackendConfig): boolean {
    const sb = config.supabase;
    return !!(sb && sb.projectUrl && sb.projectUrl.startsWith('http') && sb.anonKey && sb.anonKey.trim().length > 10);
  }

  async testConnection(config: TenantBackendConfig): Promise<BackendConnectionTestResult> {
    const start = Date.now();
    const sb = config.supabase;

    if (!this.isConfigured(config)) {
      return {
        success: false,
        latencyMs: 0,
        testedAt: new Date().toISOString(),
        message: 'Supabase is not yet linked. Please input Project URL and Anon Key in Super Admin.',
        details: { status: 'AWAITING_CREDENTIALS' },
      };
    }

    try {
      const cleanUrl = sb.projectUrl?.trim().replace(/\/+$/, '');
      const healthUrl = `${cleanUrl}/rest/v1/`;

      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          apikey: sb.anonKey?.trim() || '',
          Authorization: `Bearer ${sb.anonKey?.trim() || ''}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      const latency = Date.now() - start;

      // 200 or 401/404 from the PostgREST server confirms the host is live
      if (response.status < 500) {
        return {
          success: true,
          latencyMs: latency,
          testedAt: new Date().toISOString(),
          message: `Supabase REST API is active and reachable (${response.status} OK).`,
          details: {
            projectUrl: cleanUrl,
            schema: sb.schema || 'public',
            authMode: config.authMode,
          },
        };
      } else {
        return {
          success: false,
          latencyMs: latency,
          testedAt: new Date().toISOString(),
          message: `Supabase server returned error code ${response.status}.`,
          details: { httpStatus: response.status, projectUrl: cleanUrl },
        };
      }
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        testedAt: new Date().toISOString(),
        message: `Supabase connectivity check failed: ${err.message || String(err)}`,
        details: { projectUrl: sb.projectUrl },
      };
    }
  }

  async exportSnapshot(companyId: string): Promise<TenantDataSnapshot> {
    const snapshot = await roomBackendAdapter.exportSnapshot(companyId);
    snapshot.backendSource = 'supabase';
    return snapshot;
  }

  async importSnapshot(
    companyId: string,
    snapshot: TenantDataSnapshot
  ): Promise<{ success: boolean; recordsWritten: number; errors?: string[] }> {
    return roomBackendAdapter.importSnapshot(companyId, snapshot);
  }

  async pruneHistoricalData(companyId: string, retentionMonths: number): Promise<PruneResult> {
    return roomBackendAdapter.pruneHistoricalData(companyId, retentionMonths);
  }
}

export const supabaseBackendAdapter = new SupabaseBackendAdapter();
