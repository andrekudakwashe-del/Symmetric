// SAIMETRIC Multi-Tenant Circuit Breaker & Failover Engine
// Phase D: Enterprise Resiliency, Automated Failover, and Health Telemetry

import { BackendType, CircuitBreakerState, CircuitBreakerStatus } from './types';
import { getStored, setStored } from '../../db/roomDatabase';

const STORAGE_KEY_CIRCUIT_STATUS = 'saimetric_backend_circuit_breaker_v1';

export class CircuitBreakerFailoverService {
  private inMemoryStatus: Map<string, CircuitBreakerStatus> = new Map();
  private readonly defaultThreshold = 3;
  private readonly defaultRecoveryTimeout = 60; // 60 seconds

  constructor() {
    this.hydrateFromStorage();
  }

  private getKey(companyId: string, backendType: BackendType): string {
    return `${companyId}_${backendType}`;
  }

  private hydrateFromStorage() {
    try {
      const saved = getStored<Record<string, CircuitBreakerStatus>>(STORAGE_KEY_CIRCUIT_STATUS, {});
      if (saved && typeof saved === 'object') {
        Object.entries(saved).forEach(([k, v]) => {
          this.inMemoryStatus.set(k, v);
        });
      }
    } catch {
      // fallback
    }
  }

  private persist() {
    try {
      const obj: Record<string, CircuitBreakerStatus> = {};
      this.inMemoryStatus.forEach((val, key) => {
        obj[key] = val;
      });
      setStored(STORAGE_KEY_CIRCUIT_STATUS, obj);
    } catch {
      // ignore
    }
  }

  /**
   * Retrieves or initializes the circuit breaker status for a company and backend
   */
  getStatus(companyId: string, backendType: BackendType): CircuitBreakerStatus {
    const key = this.getKey(companyId, backendType);
    let status = this.inMemoryStatus.get(key);

    if (!status) {
      status = {
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        consecutiveFailures: 0,
        autoFailoverActive: false,
        manualOverride: false,
        failureThreshold: this.defaultThreshold,
        recoveryTimeoutSeconds: this.defaultRecoveryTimeout,
      };
      this.inMemoryStatus.set(key, status);
    }

    // Check if recovery window has passed for OPEN state -> transition to HALF_OPEN
    if (status.state === 'OPEN' && status.lastTrippedAt && !status.manualOverride) {
      const trippedTime = new Date(status.lastTrippedAt).getTime();
      const elapsedSeconds = (Date.now() - trippedTime) / 1000;
      if (elapsedSeconds >= status.recoveryTimeoutSeconds) {
        status.state = 'HALF_OPEN';
        this.persist();
      }
    }

    return status;
  }

  /**
   * Checks whether traffic should be allowed to reach the remote backend.
   * If false, callers should immediately redirect to offline/Room DB cache.
   */
  shouldAllowRemoteCall(companyId: string, backendType: BackendType): boolean {
    if (backendType === 'room') return true; // Room DB is always available locally

    const status = this.getStatus(companyId, backendType);

    if (status.manualOverride) {
      // If manually tripped by admin, reject remote calls
      return status.state === 'CLOSED';
    }

    if (status.state === 'OPEN') {
      return false; // Trip active: failover to Room DB
    }

    return true; // CLOSED or HALF_OPEN allow attempts
  }

  /**
   * Records a successful communication event with the backend
   */
  recordSuccess(companyId: string, backendType: BackendType) {
    if (backendType === 'room') return;

    const key = this.getKey(companyId, backendType);
    const status = this.getStatus(companyId, backendType);

    status.successCount += 1;
    status.consecutiveFailures = 0;
    status.lastSuccessTime = new Date().toISOString();

    if (status.state === 'HALF_OPEN') {
      // Successfully recovered from degraded state!
      status.state = 'CLOSED';
      status.autoFailoverActive = false;
    }

    this.inMemoryStatus.set(key, status);
    this.persist();
  }

  /**
   * Records a failure communication event with the backend (e.g. timeout, 500, network error)
   */
  recordFailure(companyId: string, backendType: BackendType, errorMessage?: string) {
    if (backendType === 'room') return;

    const key = this.getKey(companyId, backendType);
    const status = this.getStatus(companyId, backendType);

    status.failureCount += 1;
    status.consecutiveFailures += 1;
    status.lastFailureTime = new Date().toISOString();

    if (status.state === 'HALF_OPEN') {
      // Re-trip immediately
      status.state = 'OPEN';
      status.autoFailoverActive = true;
      status.lastTrippedAt = new Date().toISOString();
    } else if (status.consecutiveFailures >= status.failureThreshold) {
      // Trip circuit breaker
      status.state = 'OPEN';
      status.autoFailoverActive = true;
      status.lastTrippedAt = new Date().toISOString();
      console.warn(
        `[CircuitBreaker] Breaker TRIPPED for ${backendType} (Tenant: ${companyId}) after ${status.consecutiveFailures} consecutive failures. Failover to Room DB activated. Error: ${errorMessage}`
      );
    }

    this.inMemoryStatus.set(key, status);
    this.persist();
  }

  /**
   * Super Admin manual override: Force Open (force failover to Room DB)
   */
  forceTripCircuit(companyId: string, backendType: BackendType) {
    const key = this.getKey(companyId, backendType);
    const status = this.getStatus(companyId, backendType);

    status.state = 'OPEN';
    status.autoFailoverActive = true;
    status.manualOverride = true;
    status.lastTrippedAt = new Date().toISOString();

    this.inMemoryStatus.set(key, status);
    this.persist();
  }

  /**
   * Super Admin manual override: Force Reset / Close (restore remote traffic)
   */
  forceResetCircuit(companyId: string, backendType: BackendType) {
    const key = this.getKey(companyId, backendType);
    const status = this.getStatus(companyId, backendType);

    status.state = 'CLOSED';
    status.autoFailoverActive = false;
    status.manualOverride = false;
    status.consecutiveFailures = 0;

    this.inMemoryStatus.set(key, status);
    this.persist();
  }

  /**
   * Probes all backends for live health telemetry metrics
   */
  getTelemetrySummary(companyId: string): Record<BackendType, { state: CircuitBreakerState; failover: boolean; failures: number }> {
    const backends: BackendType[] = ['room', 'sheets_appscript', 'firebase', 'supabase'];
    const result: any = {};

    backends.forEach((bt) => {
      const s = this.getStatus(companyId, bt);
      result[bt] = {
        state: s.state,
        failover: s.autoFailoverActive,
        failures: s.consecutiveFailures,
      };
    });

    return result;
  }
}

export const circuitBreakerFailover = new CircuitBreakerFailoverService();
