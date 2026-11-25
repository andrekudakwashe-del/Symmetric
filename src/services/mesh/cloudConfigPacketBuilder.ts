import {
  getCurrentCompany,
  getRawStoredSheetsConfig,
  getSheetsConfig,
  isCloudConfigPurged,
} from '../../db/roomDatabase';
import { getTenantAuthToken, getRoutingEpoch } from '../sync/highWaterMarks';

export interface HubCloudConfigPacket {
  strategy: 'HUB_CLOUD';
  databaseType: string;
  credentials: Record<string, any>;
  companyId?: string;
  gatewayUrl?: string;
  runtimePolicy?: Record<string, any>;
}

export function buildGenericCloudConfigPacket(): HubCloudConfigPacket | null {
  try {
    const comp: any = getCurrentCompany();
    const backendCfg: any = comp?.backend_config || {};
    const rawType = String(backendCfg?.backendType || comp?.backend_type || '')
      .toLowerCase()
      .trim();
    const rawSheets = getRawStoredSheetsConfig() as any;
    const alreadyPurged = isCloudConfigPurged();
    const resolvedGatewayUrl =
      typeof window !== 'undefined' &&
      window.location?.origin &&
      /^https?:\/\//i.test(window.location.origin)
        ? `${window.location.origin}/api/sync/gateway`
        : '';
    const defaultRuntimePolicy = {
      protocolVersion: '4.0',
      pushBatchSize: 20,
      pullMaxPages: 12,
      requestTimeoutMs: 45000,
      syncIntervalMs: 5 * 60 * 1000,
      clockDriftToleranceMs: 5 * 60 * 1000,
      blockBackdatedVoidsOnly: true,
      blockedBackdateActions: ['VOID', 'REFUND'],
      blockedMasterSheetIds: ['1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE'],
      t2EntityTypes: [],
      globalBranchEntityTypes: [],
      retentionDays: 30,
      maxStorageMb: 2048,
      genericBucketMaxItems: 5000,
    };

    // 1. Check MongoDB credentials
    const mongoCfg = backendCfg?.mongodb || {};
    const mongoUri = String(
      mongoCfg?.mongoUri ||
        mongoCfg?.uri ||
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('saimetric_mongo_uri')
          : '') ||
        ''
    ).trim();
    if (rawType === 'mongodb' || mongoUri) {
      const credentials: Record<string, any> = {
        mongoUri,
        ...(mongoCfg?.url ? { url: String(mongoCfg.url).trim() } : {}),
        ...(mongoCfg?.apiKey ? { apiKey: String(mongoCfg.apiKey).trim() } : {}),
        ...(mongoCfg?.database
          ? { database: String(mongoCfg.database).trim() }
          : {}),
      };
      if (mongoUri || credentials.url || credentials.apiKey) {
        return {
          strategy: 'HUB_CLOUD',
          databaseType: 'mongodb',
          credentials,
          companyId: comp?.company_id,
          ...(resolvedGatewayUrl ? { gatewayUrl: resolvedGatewayUrl } : {}),
          runtimePolicy: defaultRuntimePolicy,
        };
      }
    }

    // 2. Check Supabase credentials (routed through frozen Cloud Sync Gateway when available)
    const sbCfg = backendCfg?.supabase || {};
    const sbUrl = String(
      sbCfg?.projectUrl ||
        sbCfg?.url ||
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('saimetric_supabase_url')
          : '') ||
        ''
    ).trim();
    const sbApiKey = String(
      sbCfg?.serviceRoleKey ||
        sbCfg?.anonKey ||
        sbCfg?.apiKey ||
        (typeof localStorage !== 'undefined'
          ? localStorage.getItem('saimetric_supabase_key')
          : '') ||
        ''
    ).trim();
    if (rawType === 'supabase' || (sbUrl && sbApiKey)) {
      if (sbUrl || sbApiKey) {
        return {
          strategy: 'HUB_CLOUD',
          databaseType: 'supabase',
          credentials: {
            url: sbUrl,
            apiKey: sbApiKey,
            ...(sbCfg?.anonKey ? { anonKey: String(sbCfg.anonKey).trim() } : {}),
            ...(sbCfg?.serviceRoleKey
              ? { serviceRoleKey: String(sbCfg.serviceRoleKey).trim() }
              : {}),
            ...(sbCfg?.schema ? { schema: String(sbCfg.schema).trim() } : {}),
          },
          companyId: comp?.company_id,
          ...(resolvedGatewayUrl ? { gatewayUrl: resolvedGatewayUrl } : {}),
          runtimePolicy: defaultRuntimePolicy,
        };
      }
    }

    // 3. Check Firebase credentials (routed through frozen Cloud Sync Gateway when available)
    const fbCfg = backendCfg?.firebase || {};
    const fbProjectId = String(fbCfg?.projectId || '').trim();
    const fbApiKey = String(fbCfg?.apiKey || '').trim();
    if (rawType === 'firebase' || fbProjectId || fbApiKey) {
      if (fbProjectId || fbApiKey) {
        return {
          strategy: 'HUB_CLOUD',
          databaseType: 'firebase',
          credentials: {
            ...(fbCfg?.databaseURL
              ? { url: String(fbCfg.databaseURL).trim() }
              : {}),
            apiKey: fbApiKey,
            projectId: fbProjectId,
            ...(fbCfg?.appId ? { appId: String(fbCfg.appId).trim() } : {}),
            ...(fbCfg?.authDomain
              ? { authDomain: String(fbCfg.authDomain).trim() }
              : {}),
            ...(fbCfg?.firestoreRegion
              ? { firestoreRegion: String(fbCfg.firestoreRegion).trim() }
              : {}),
            ...(fbCfg?.databaseId
              ? { databaseId: String(fbCfg.databaseId).trim() }
              : {}),
          },
          companyId: comp?.company_id,
          ...(resolvedGatewayUrl ? { gatewayUrl: resolvedGatewayUrl } : {}),
          runtimePolicy: defaultRuntimePolicy,
        };
      }
    }

    // 4. Check Apps Script / Google Sheets credentials (speaks the same frozen 3-action protocol natively)
    const sheetsCfg = backendCfg?.sheets || {};
    const activeSheetsCfg = alreadyPurged ? null : getSheetsConfig();
    const webhookUrl = String(
      sheetsCfg?.webhookUrl ||
        comp?.webhook_url ||
        rawSheets?.deploymentUrl ||
        rawSheets?.webhookUrl ||
        (!alreadyPurged ? activeSheetsCfg?.webhookUrl || '' : '')
    ).trim();
    const masterWebhookUrl = String(
      sheetsCfg?.masterWebhookUrl ||
        rawSheets?.masterWebhookUrl ||
        (!alreadyPurged ? activeSheetsCfg?.masterWebhookUrl || '' : '')
    ).trim();
    const spreadsheetId = String(
      sheetsCfg?.spreadsheetId ||
        comp?.sheet_id ||
        rawSheets?.spreadsheetId ||
        (!alreadyPurged ? activeSheetsCfg?.spreadsheetId || '' : '')
    ).trim();
    const sheetFolderId = String(
      sheetsCfg?.sheetFolderId || comp?.sheet_folder_id || ''
    ).trim();

    if (webhookUrl || masterWebhookUrl || spreadsheetId) {
      const compIdForTok = comp?.company_id;
      const jwtToken = getTenantAuthToken(compIdForTok);
      const routingEpoch = getRoutingEpoch(compIdForTok);
      return {
        strategy: 'HUB_CLOUD',
        databaseType: 'appscripts',
        credentials: {
          url: webhookUrl || masterWebhookUrl,
          ...(masterWebhookUrl ? { masterWebhookUrl } : {}),
          ...(spreadsheetId ? { spreadsheetId } : {}),
          ...(sheetFolderId ? { sheetFolderId } : {}),
          ...(jwtToken ? { token: jwtToken, jwt: jwtToken } : {}),
          routingEpoch,
          isolationMode:
            sheetsCfg?.isolationMode || comp?.branch_isolation_mode || 'ROW_LEVEL',
        },
        companyId: compIdForTok,
        runtimePolicy: defaultRuntimePolicy,
      };
    }
  } catch (err) {
    console.warn(
      '[MeshSync] Error reading cloud configuration for Hub handshake:',
      err
    );
  }
  return null;
}
