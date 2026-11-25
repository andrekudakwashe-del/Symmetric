import { P2PMeshConfig, StocktakeSession } from '../../types';
import { hashPin, generatePinSalt } from '../../utils/pinCrypto';
import { SyncAction } from '../sync/SyncEnvelope';
import { MeshEventLog } from './meshTypesAndHelpers';

export interface StocktakeTransportHost {
  getConfig: () => P2PMeshConfig;
  isLocalHubConnected: () => boolean;
  sendControlPacket: (packet: any) => boolean;
  dispatchEnvelope: (
    entityType: string,
    entityId: string,
    data: any,
    options?: {
      action?: SyncAction;
      updatedAt?: number;
      targetBranchId?: string;
      topicSuffix?: string;
      isReconPush?: boolean;
      meta?: Record<string, any>;
    }
  ) => Promise<any>;
  addLog: (
    type: MeshEventLog['type'],
    message: string,
    sourceDevice: string
  ) => void;
  notifyPeerSubscribers: () => void;
}

export class StocktakeMeshTransport {
  constructor(private readonly host: StocktakeTransportHost) {}

  public claimStocktakeZone(
    sessionId: string,
    zoneId: string,
    slot: 'A' | 'B',
    staffId: string,
    staffName: string,
    zoneName?: string
  ): void {
    const cfg = this.host.getConfig();
    void this.host.dispatchEnvelope(
      'stocktake_zone_claim',
      zoneId,
      {
        sessionId,
        zoneId,
        slot,
        staffId,
        staffName,
        zoneName: zoneName || zoneId,
        branchId: cfg.branchId,
      },
      {
        action: 'UPSERT',
        topicSuffix: 'stocktake/zone_claim',
      }
    );
  }

  public submitBlindStocktakeCount(
    sessionId: string,
    zoneId: string,
    slot: 'A' | 'B' | 'RECOUNT',
    staffId: string,
    staffName: string,
    lines: any[]
  ): void {
    const cfg = this.host.getConfig();
    void this.host.dispatchEnvelope(
      'stocktake_count_submission',
      `${sessionId}:${zoneId}:${slot}`,
      {
        sessionId,
        zoneId,
        slot,
        staffId,
        staffName,
        lines,
        branchId: cfg.branchId,
      },
      {
        action: 'APPEND',
        topicSuffix: 'stocktake/blind_count_submit',
      }
    );
    if (this.host.isLocalHubConnected()) {
      this.host.addLog(
        'EPIDEMIC_HOP',
        `Blind count for Zone ${zoneId} (Slot ${slot}) sent to Local Hub.`,
        cfg.deviceName
      );
    }
  }

  public proposeJointRecount(
    sessionId: string,
    zoneId: string,
    slot: 'A' | 'B',
    staffName: string,
    lines: any[]
  ): void {
    const cfg = this.host.getConfig();
    void this.host.dispatchEnvelope(
      'stocktake_joint_proposal',
      zoneId,
      {
        sessionId,
        zoneId,
        proposedBySlot: slot,
        proposedByName: staffName,
        recountLines: lines,
        branchId: cfg.branchId,
      },
      {
        action: 'UPSERT',
        topicSuffix: 'stocktake/joint_proposal',
      }
    );
  }

  public finalizeJointRecount(
    sessionId: string,
    zoneId: string,
    resolvedLines: any[],
    resolvedByName: string
  ): void {
    const cfg = this.host.getConfig();
    void this.host.dispatchEnvelope(
      'stocktake_joint_finalized',
      zoneId,
      {
        sessionId,
        zoneId,
        resolvedLines,
        signedByA: true,
        signedByB: true,
        resolvedByName,
        branchId: cfg.branchId,
      },
      {
        action: 'APPEND',
        topicSuffix: 'stocktake/joint_finalized',
      }
    );
  }

  public unlockStocktakeSegment(
    sessionId: string,
    segmentId: string,
    target: 'A' | 'B' | 'COMPARISON' | 'ALL',
    actorId: string,
    actorName: string,
    reason: string
  ): void {
    const cfg = this.host.getConfig();
    const now = Date.now();
    void this.host.dispatchEnvelope(
      'stocktake_segment_unlock',
      `${sessionId}:${segmentId}:${now}`,
      {
        sessionId,
        zoneId: segmentId,
        segmentId,
        target,
        actorId,
        actorName,
        reason,
        branchId: cfg.branchId,
      },
      {
        action: 'APPEND',
        updatedAt: now,
        topicSuffix: 'stocktake/segment_unlock',
      }
    );
    if (this.host.isLocalHubConnected()) {
      this.host.addLog(
        'EPIDEMIC_HOP',
        `Segment ${segmentId} (${target}) unlocked by ${actorName}: ${reason}`,
        cfg.deviceName
      );
    }
  }

  public broadcastCasualWorkers(casuals: any[]): void {
    // CRITICAL SECURITY: Ensure only pin_hash and pin_salt are transmitted over Local Hub
    let maxUpdatedAt = 0;
    const sanitized = Array.isArray(casuals)
      ? casuals.map((c) => {
          const salt = c.pin_salt || generatePinSalt();
          const hash =
            c.pin_hash ||
            (c.pin ? hashPin(c.pin, salt) : hashPin('1234', salt));
          const cUp =
            typeof c.updatedAt === 'number' && c.updatedAt > 0
              ? c.updatedAt
              : c.updatedAt
              ? new Date(c.updatedAt).getTime()
              : c.createdAt
              ? new Date(c.createdAt).getTime()
              : Date.now();
          if (cUp > maxUpdatedAt) maxUpdatedAt = cUp;
          const copy = {
            ...c,
            pin_hash: hash,
            pin_salt: salt,
            updatedAt: cUp,
            lastUpdated: c.lastUpdated || new Date(cUp).toISOString(),
          };
          delete copy.pin;
          return copy;
        })
      : [];

    const now = maxUpdatedAt || Date.now();
    void this.host.dispatchEnvelope(
      'casual_worker',
      'CASUAL_WORKERS_LIST',
      sanitized,
      {
        action: 'UPSERT',
        updatedAt: now,
        topicSuffix: 'stocktake/casual_workers_sync',
      }
    );
  }

  public broadcastStocktakeLockdown(
    branchId: string,
    sessionId: string,
    isLocked: boolean,
    lockedByName: string,
    reason?: string,
    lockedBy?: string
  ): void {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    void this.host.dispatchEnvelope(
      'branch_lockdown',
      sessionId || branchId,
      {
        branchId,
        sessionId,
        isLocked,
        lockedBy,
        lockedByName,
        lockedAt: isLocked ? nowIso : undefined,
        reason,
        updatedAt: now,
        lastUpdated: nowIso,
      },
      {
        action: 'UPSERT',
        updatedAt: now,
        targetBranchId: branchId,
        topicSuffix: 'stocktake/lockdown_broadcast',
      }
    );
  }

  public requestStocktakeSessionList(): void {
    if (!this.host.isLocalHubConnected()) return;
    const cfg = this.host.getConfig();
    try {
      this.host.sendControlPacket({
        type: 'STOCKTAKE_SESSION_LIST_REQUEST',
        action: 'STOCKTAKE_SESSION_LIST_REQUEST',
        deviceId: cfg.deviceId,
        deviceName: cfg.deviceName,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn(
        '[MeshSync] Error sending STOCKTAKE_SESSION_LIST_REQUEST:',
        e
      );
    }
  }

  public broadcastStocktakeSession(session: StocktakeSession): void {
    if (!session || !session.sessionId) return;
    const cfg = this.host.getConfig();
    const recUpdatedAt =
      typeof session.updatedAt === 'number' && session.updatedAt > 0
        ? session.updatedAt
        : session.lastUpdated
        ? new Date(session.lastUpdated).getTime()
        : session.timestamp
        ? new Date(session.timestamp).getTime()
        : Date.now();

    void this.host.dispatchEnvelope(
      'stocktake_session',
      session.sessionId,
      {
        ...session,
        sessionName: session.title,
        startedBy: session.createdByName || session.createdBy,
        startedAt: session.timestamp,
        branchId: session.branchId || cfg.branchId,
        updatedAt: recUpdatedAt,
        lastUpdated:
          session.lastUpdated || new Date(recUpdatedAt).toISOString(),
      },
      {
        action: 'UPSERT',
        updatedAt: recUpdatedAt,
        targetBranchId: session.branchId || cfg.branchId,
        topicSuffix: 'stocktake/session_started',
      }
    );
    this.host.addLog(
      'BROADCAST',
      `Stocktake session "${session.title}" [${session.sessionId}] (${session.status}) synced via SyncCore.`,
      cfg.deviceName
    );
    this.host.notifyPeerSubscribers();
  }

  public broadcastStocktakeSessionStarted(data: {
    sessionId: string;
    sessionName: string;
    segments: any[];
    startedBy: string;
    startedAt: string;
    countType?: string;
    branchId?: string;
    branchName?: string;
    isLockdownActive?: boolean;
    notes?: string;
    updatedAt?: number | string;
    [key: string]: any;
  }): void {
    const cfg = this.host.getConfig();
    const recUpdatedAt =
      typeof (data as any).updatedAt === 'number' && (data as any).updatedAt > 0
        ? (data as any).updatedAt
        : (data as any).updatedAt
        ? new Date((data as any).updatedAt).getTime()
        : data.startedAt
        ? new Date(data.startedAt).getTime()
        : Date.now();

    void this.host.dispatchEnvelope(
      'stocktake_session',
      data.sessionId,
      {
        ...data,
        branchId: data.branchId || cfg.branchId,
        updatedAt: recUpdatedAt,
      },
      {
        action: 'UPSERT',
        updatedAt: recUpdatedAt,
        targetBranchId: data.branchId || cfg.branchId,
        topicSuffix: 'stocktake/session_started',
      }
    );
    this.host.addLog(
      'BROADCAST',
      `Stocktake session "${data.sessionName}" [${data.sessionId}] started with ${data.segments.length} segment(s). Broadcasted to Hub & peers.`,
      cfg.deviceName
    );
    this.host.notifyPeerSubscribers();
  }

  public broadcastStocktakeSegmentCreated(
    sessionId: string,
    segment: any
  ): void {
    const cfg = this.host.getConfig();
    const segId = segment?.segmentId || segment?.id || sessionId;
    void this.host.dispatchEnvelope(
      'stocktake_segment',
      segId,
      { sessionId, segment },
      {
        action: 'UPSERT',
        topicSuffix: 'stocktake/segment_created',
      }
    );
    this.host.addLog(
      'BROADCAST',
      `Stocktake segment "${segment.name || segment.segmentId}" [${segment.segmentId}] created. Broadcasted to Hub & peers.`,
      cfg.deviceName
    );
    this.host.notifyPeerSubscribers();
  }
}
