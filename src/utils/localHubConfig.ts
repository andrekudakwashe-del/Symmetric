/**
 * LocalHubConfig
 * Manages configuration and discovery for the offline Local WebSocket Hub (e.g. Node.js on Termux Android).
 * Stores URL in localStorage (`saimetric_local_hub_url`) and testing flags (`saimetric_force_local_hub`).
 */

export const STORAGE_KEY_LOCAL_HUB_URL = 'saimetric_local_hub_url';
export const STORAGE_KEY_FORCE_LOCAL_HUB = 'saimetric_force_local_hub';
export const STORAGE_KEY_HUB_BRANCH_ID = 'saimetric_hub_branch_id';
export const STORAGE_KEY_HUB_BRANCH_NAME = 'saimetric_hub_branch_name';
export const STORAGE_KEY_HUB_TENANT_ID = 'saimetric_hub_tenant_id';
export const STORAGE_KEY_CLOUD_ONLY_MODE = 'saimetric_cloud_only_mode';
export const DEFAULT_LOCAL_HUB_URL = 'ws://192.168.43.1:8080';

export interface LocalHubTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Normalizes user or QR-scanned input into a valid WebSocket URL.
 * Supports:
 * - Direct ws:// or wss:// URLs
 * - http:// or https:// URLs (converted to ws:// or wss://)
 * - Raw IPs like 192.168.43.1:8080 or 192.168.1.5
 * - JSON strings containing `wsUrl`, `url`, `ip`, or `host`
 */
export function normalizeHubUrl(rawInput: string): string {
  if (!rawInput) return DEFAULT_LOCAL_HUB_URL;
  let text = rawInput.trim();

  // 1. Try parsing JSON if input is a JSON string
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.wsUrl) return normalizeHubUrl(parsed.wsUrl);
      if (parsed.url) return normalizeHubUrl(parsed.url);
      if (parsed.ip || parsed.host) {
        const port = parsed.port || 8080;
        return `ws://${parsed.ip || parsed.host}:${port}`;
      }
    } catch {
      // Not valid JSON, continue with string handling
    }
  }

  // Remove trailing slashes
  text = text.replace(/\/+$/, '');

  // 2. Convert http(s) to ws(s)
  if (text.startsWith('https://')) {
    return 'wss://' + text.substring('https://'.length);
  }
  if (text.startsWith('http://')) {
    return 'ws://' + text.substring('http://'.length);
  }

  // 3. Already valid ws:// or wss://
  if (text.startsWith('ws://') || text.startsWith('wss://')) {
    return text;
  }

  // 4. Raw IP or hostname (e.g. "192.168.43.1:8080" or "192.168.43.1")
  const ipMatch = text.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?$/);
  if (ipMatch) {
    if (text.includes(':')) {
      return `ws://${text}`;
    }
    return `ws://${text}:8080`;
  }

  // Fallback: prepend ws://
  return `ws://${text}`;
}

export class LocalHubConfig {
  /**
   * Retrieves the configured Local Hub URL from localStorage.
   */
  public static getLocalHubUrl(): string {
    if (typeof window === 'undefined') return DEFAULT_LOCAL_HUB_URL;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LOCAL_HUB_URL);
      if (saved && saved.trim().length > 0) {
        return normalizeHubUrl(saved);
      }
    } catch (e) {
      console.warn('[LocalHubConfig] Failed to read hub URL from storage:', e);
    }
    return DEFAULT_LOCAL_HUB_URL;
  }

  /**
   * Updates and saves the Local Hub URL in localStorage.
   */
  public static setLocalHubUrl(rawUrl: string): string {
    const normalized = normalizeHubUrl(rawUrl);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_LOCAL_HUB_URL, normalized);
        this.dispatchConfigChange();
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to write hub URL to storage:', e);
      }
    }
    return normalized;
  }

  /**
   * Checks whether "Force Local Hub" mode is enabled.
   */
  public static getForceLocalHub(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY_FORCE_LOCAL_HUB) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Toggles "Force Local Hub" mode for offline testing.
   */
  public static setForceLocalHub(force: boolean): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_FORCE_LOCAL_HUB, force ? 'true' : 'false');
        this.dispatchConfigChange();
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to write force flag to storage:', e);
      }
    }
  }

  /**
   * Retrieves the tethered Hub's branch ID.
   */
  public static getHubBranchId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const val = localStorage.getItem(STORAGE_KEY_HUB_BRANCH_ID);
      return val && val.trim().length > 0 ? val.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves the tethered Hub's branch Name (e.g. "Harare Main").
   */
  public static getHubBranchName(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const val = localStorage.getItem(STORAGE_KEY_HUB_BRANCH_NAME);
      return val && val.trim().length > 0 ? val.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves the tethered Hub's tenant ID.
   */
  public static getHubTenantId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const val = localStorage.getItem(STORAGE_KEY_HUB_TENANT_ID);
      return val && val.trim().length > 0 ? val.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Stores the tethered Local Hub's branch identity.
   */
  public static setHubBranchIdentity(branchId: string, branchName: string, tenantId?: string): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_HUB_BRANCH_ID, branchId);
        localStorage.setItem(STORAGE_KEY_HUB_BRANCH_NAME, branchName);
        if (tenantId) {
          localStorage.setItem(STORAGE_KEY_HUB_TENANT_ID, tenantId);
        }
        this.dispatchConfigChange();
        window.dispatchEvent(
          new CustomEvent('saimetric_hub_identity_updated', {
            detail: { branch_id: branchId, branch_name: branchName, tenant_id: tenantId },
          })
        );
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to write hub identity:', e);
      }
    }
  }

  /**
   * Clears the tethered Local Hub's branch identity (e.g. after RESET_BRANCH).
   */
  public static clearHubBranchIdentity(): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY_HUB_BRANCH_ID);
        localStorage.removeItem(STORAGE_KEY_HUB_BRANCH_NAME);
        localStorage.removeItem(STORAGE_KEY_HUB_TENANT_ID);
        this.dispatchConfigChange();
        window.dispatchEvent(
          new CustomEvent('saimetric_hub_identity_updated', {
            detail: { branch_id: null, branch_name: null },
          })
        );
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to clear hub identity:', e);
      }
    }
  }

  /**
   * Checks whether the device is in Cloud-Only Mode due to branch mismatch.
   */
  public static isCloudOnlyMode(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY_CLOUD_ONLY_MODE) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Sets whether the device is in Cloud-Only Mode.
   */
  public static setCloudOnlyMode(enabled: boolean): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_CLOUD_ONLY_MODE, enabled ? 'true' : 'false');
        this.dispatchConfigChange();
        window.dispatchEvent(
          new CustomEvent('saimetric_cloud_only_mode_changed', {
            detail: { isCloudOnlyMode: enabled },
          })
        );
      } catch (e) {
        console.warn('[LocalHubConfig] Failed to set cloud only mode:', e);
      }
    }
  }

  /**
   * Tests connection to a WebSocket Hub with round-trip latency measurement.
   */
  public static async testHubConnection(rawUrl: string, timeoutMs: number = 4000): Promise<LocalHubTestResult> {
    const url = normalizeHubUrl(rawUrl);
    const startTime = performance.now();

    return new Promise((resolve) => {
      let settled = false;
      let ws: WebSocket | null = null;
      let timer: number | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (ws) {
          try {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            ws.close();
          } catch {}
          ws = null;
        }
      };

      const finish = (result: LocalHubTestResult) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(result);
        }
      };

      timer = window.setTimeout(() => {
        finish({
          success: false,
          error: `Connection timed out after ${timeoutMs}ms. Verify Termux Node server is running on ${url}.`,
        });
      }, timeoutMs);

      try {
        ws = new WebSocket(url);

        ws.onopen = () => {
          const latencyMs = Math.round(performance.now() - startTime);
          try {
            // Optional test ping packet
            ws?.send(JSON.stringify({ type: 'PING', source: 'TEST_PROBE', timestamp: Date.now() }));
          } catch {}
          finish({
            success: true,
            latencyMs,
          });
        };

        ws.onerror = () => {
          finish({
            success: false,
            error: `Unable to connect to ${url}. Ensure device is on the same Wi-Fi / Hotspot.`,
          });
        };

        ws.onclose = (ev) => {
          if (!settled) {
            finish({
              success: false,
              error: `Connection closed (${ev.code || 'Unreachable'}). Check Termux WebSocket hub status.`,
            });
          }
        };
      } catch (err: any) {
        finish({
          success: false,
          error: err?.message || 'WebSocket creation error',
        });
      }
    });
  }

  /**
   * Broadcasts a DOM event so UI and meshSyncService can react dynamically to config changes.
   */
  public static dispatchConfigChange(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('saimetric-local-hub-config-changed', {
          detail: {
            url: this.getLocalHubUrl(),
            forceLocalHub: this.getForceLocalHub(),
            hubBranchId: this.getHubBranchId(),
            hubBranchName: this.getHubBranchName(),
            isCloudOnlyMode: this.isCloudOnlyMode(),
          },
        })
      );
    }
  }

  /**
   * Subscribes to local hub configuration changes.
   */
  public static subscribe(callback: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('saimetric-local-hub-config-changed', handler);
    return () => {
      window.removeEventListener('saimetric-local-hub-config-changed', handler);
    };
  }
}
