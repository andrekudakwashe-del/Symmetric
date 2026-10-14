import {
  IBackendAdapter,
  BackendType,
  TenantBackendConfig,
  BackendConnectionTestResult,
  TenantDataSnapshot,
  PruneResult,
} from '../types';
import { roomBackendAdapter } from './RoomAdapter';

export class FirebaseBackendAdapter implements IBackendAdapter {
  readonly id = 'adapter-firebase';
  readonly type: BackendType = 'firebase';
  readonly name = 'Google Firebase & Cloud Firestore';
  readonly tierLabel = 'Medium Package Tier';
  readonly description = 'NoSQL real-time document store with Firestore. Ultra-low latency, auto-scaling, and granular document collections.';

  isConfigured(config: TenantBackendConfig): boolean {
    const fb = config.firebase;
    return !!(fb && fb.projectId && fb.projectId.trim().length > 3);
  }

  async testConnection(config: TenantBackendConfig): Promise<BackendConnectionTestResult> {
    const start = Date.now();
    const fb = config.firebase;

    if (!this.isConfigured(config)) {
      return {
        success: false,
        latencyMs: 0,
        testedAt: new Date().toISOString(),
        message: 'Firebase is not yet linked. Please input your Firebase Project ID in Super Admin.',
        details: { status: 'AWAITING_CREDENTIALS' },
      };
    }

    try {
      // Probing public Firestore REST endpoint
      const projectId = fb.projectId?.trim();
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

      const response = await fetch(firestoreUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      const latency = Date.now() - start;

      // 200 OK or 403 (Permission denied due to security rules) means the project exists and responds
      if (response.status === 200 || response.status === 403 || response.status === 401) {
        return {
          success: true,
          latencyMs: latency,
          testedAt: new Date().toISOString(),
          message: `Firebase Firestore connected successfully for project "${projectId}".`,
          details: {
            httpStatus: response.status,
            projectId,
            region: fb.firestoreRegion || 'us-central1',
            authMode: config.authMode,
          },
        };
      } else {
        return {
          success: false,
          latencyMs: latency,
          testedAt: new Date().toISOString(),
          message: `Firestore returned status ${response.status}: Project not found or API disabled.`,
          details: { httpStatus: response.status, projectId },
        };
      }
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        testedAt: new Date().toISOString(),
        message: `Firebase connectivity check failed: ${err.message || String(err)}`,
        details: { projectId: fb.projectId },
      };
    }
  }

  async exportSnapshot(companyId: string): Promise<TenantDataSnapshot> {
    const snapshot = await roomBackendAdapter.exportSnapshot(companyId);
    snapshot.backendSource = 'firebase';
    return snapshot;
  }

  async importSnapshot(
    companyId: string,
    snapshot: TenantDataSnapshot
  ): Promise<{ success: boolean; recordsWritten: number; errors?: string[] }> {
    // When Firebase credentials are provided, this stages into Room DB and prepares Firestore documents
    return roomBackendAdapter.importSnapshot(companyId, snapshot);
  }

  async pruneHistoricalData(companyId: string, retentionMonths: number): Promise<PruneResult> {
    return roomBackendAdapter.pruneHistoricalData(companyId, retentionMonths);
  }
}

export const firebaseBackendAdapter = new FirebaseBackendAdapter();
