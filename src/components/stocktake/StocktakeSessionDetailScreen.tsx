import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Layers,
  UserCheck,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  ShieldCheck,
  Plus,
  Trash2,
  Boxes,
  Package,
  RotateCcw,
  Calendar,
  Building,
  Info,
  Clock,
  Printer,
  FileText,
  X,
  PackageOpen,
  Users,
  Zap,
  Lock,
  Share2,
  Shield,
  Eye,
  MessageSquare,
  LayoutGrid,
  EyeOff,
  Unlock,
  MapPin,
  ClipboardCheck,
  ArrowRight,
  Pause,
} from 'lucide-react';
import {
  StocktakeSession,
  StocktakeSegment,
  StocktakeLineCount,
  Salesperson,
} from '../../types';
import {
  addStocktakeSegment,
  deleteStocktakeSegment,
  submitSegmentCount,
  resolveSegmentRecount,
  consolidateStocktakeSession,
  requestSkuVarianceRecount,
  requestBatchVarianceRecount,
  submitSkuVarianceRecount,
  certifyStocktakeReady,
  approveAndCommitStocktakeAsync,
  StocktakeCommitProgress,
  reopenFinalizedSegmentSlot,
  getStocktakeSessionById,
  getAllStocktakeSessions,
  getAllStocktakeSegments,
  saveStocktakeSegment,
  updateZoneClaim,
  saveCountSubmission,
  getCustomerGoodsLeftBehind,
  getTemporaryCasuals,
  claimZoneSlot,
  recordBlindSubmissionLocal,
  getZoneAssignments,
} from '../../db/roomDatabase';
import {
  resolveStocktakePersona,
  sanitizeSessionForCounter,
  isStocktakeLeader,
  isStocktakeAuditor,
  canClaimSegmentSlot,
} from '../../services/stocktakeAccessService';
import { meshSyncService } from '../../services/meshSyncService';
import { DoubleCountTerminal } from './DoubleCountTerminal';
import { SegmentRecountModal } from './SegmentRecountModal';
import { JointRecountModal } from './JointRecountModal';
import { ConsolidatedVarianceView } from './ConsolidatedVarianceView';
import { StocktakeApprovalModal } from './StocktakeApprovalModal';
import { CustomerGoodsLeftBehindTab } from './CustomerGoodsLeftBehindTab';
import { CasualWorkersTab } from './CasualWorkersTab';
import { FastMovingChecklistTab } from './FastMovingChecklistTab';
import { LockdownEmergencySalesTab } from './LockdownEmergencySalesTab';
import { P2PMeshSyncTab } from './P2PMeshSyncTab';
import { VarianceCommentaryTab } from './VarianceCommentaryTab';
import { BranchSegmentsModal } from './BranchSegmentsModal';
import { BlindRecountSheetModal } from './BlindRecountSheetModal';

interface StocktakeSessionDetailScreenProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  initialView?: 'HOME' | DetailTab;
  onBack: () => void;
  onUpdateSession: (session: StocktakeSession) => void;
}

export type DetailTab =
  | 'SEGMENTS'
  | 'VARIANCE'
  | 'GOODS_LEFT_BEHIND'
  | 'CASUALS'
  | 'FAST_MOVERS'
  | 'LOCKDOWN'
  | 'P2P_SYNC'
  | 'VARIANCE_COMMENTS'
  | 'AUDIT_CERT';

export const StocktakeSessionDetailScreen: React.FC<StocktakeSessionDetailScreenProps> = ({
  session: initialSession,
  currentUser,
  initialView = 'HOME',
  onBack,
  onUpdateSession,
}) => {
  const [session, setSession] = useState<StocktakeSession>(initialSession);
  const persona = resolveStocktakePersona(currentUser, session);
  const isApproved = session.status === 'APPROVED_POSTED';
  const isBlindCounter = persona === 'COUNTER';
  const canManageStructure = persona === 'LEADER' || persona === 'AUDITOR';

  const allowedTabs: DetailTab[] = (() => {
    if (persona === 'COUNTER') {
      return session.countType === 'DAILY_BLIND'
        ? ['SEGMENTS', 'FAST_MOVERS']
        : ['SEGMENTS'];
    }
    if (persona === 'AUDITED_MANAGER') {
      const base: DetailTab[] = ['SEGMENTS', 'GOODS_LEFT_BEHIND', 'FAST_MOVERS', 'LOCKDOWN'];
      if (isApproved) {
        base.push('VARIANCE_COMMENTS', 'AUDIT_CERT');
      }
      return base;
    }
    const full: DetailTab[] = [
      'SEGMENTS',
      'VARIANCE',
      'GOODS_LEFT_BEHIND',
      'CASUALS',
      'FAST_MOVERS',
      'LOCKDOWN',
      'P2P_SYNC',
    ];
    if (isApproved) {
      full.push('VARIANCE_COMMENTS', 'AUDIT_CERT');
    }
    return full;
  })();

  const [activeView, setActiveView] = useState<'HOME' | DetailTab>(() => {
    if (initialView && initialView !== 'HOME' && allowedTabs.includes(initialView)) {
      return initialView;
    }
    return 'HOME';
  });

  // Ensure activeView remains legal whenever persona or status changes
  useEffect(() => {
    if (activeView !== 'HOME' && !allowedTabs.includes(activeView)) {
      setActiveView('HOME');
    }
  }, [persona, isApproved, session.countType]);

  // Terminal state
  const [activeTerminalSegment, setActiveTerminalSegment] = useState<StocktakeSegment | null>(null);
  const [terminalCounterSlot, setTerminalCounterSlot] = useState<'A' | 'B'>('A');

  // Segment Recount Modal state
  const [activeRecountSegment, setActiveRecountSegment] = useState<StocktakeSegment | null>(null);

  // Admin Approval Modal
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // Blind Recount Sheet & Branch Floor Map Modals
  const [showBlindRecountModal, setShowBlindRecountModal] = useState(false);
  const [showBranchSegmentsModal, setShowBranchSegmentsModal] = useState(false);

  // Auditor Unlock Modal
  const [unlockModalState, setUnlockModalState] = useState<{
    segment: StocktakeSegment;
    target: 'A' | 'B' | 'COMPARISON' | 'ALL';
  } | null>(null);
  const [unlockReason, setUnlockReason] = useState('');

  // New segment form state & inline delete confirmation
  const [showAddSegmentModal, setShowAddSegmentModal] = useState(false);
  const [pendingDeleteSegmentId, setPendingDeleteSegmentId] = useState<string | null>(null);
  const [newSegmentName, setNewSegmentName] = useState('');
  const [newSegmentLocation, setNewSegmentLocation] = useState('');
  const [newSegmentDesc, setNewSegmentDesc] = useState('');

  // Count metrics for tiles
  const [goodsLeftBehindCount, setGoodsLeftBehindCount] = useState<number>(0);
  const [casualsCount, setCasualsCount] = useState<number>(0);

  // Toast / notification (no native alert)
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastIsError, setToastIsError] = useState<boolean>(false);

  const showToast = (msg: string, isError: boolean = false) => {
    setToastIsError(isError);
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const refreshSession = (updated?: StocktakeSession) => {
    const latest = updated || getStocktakeSessionById(session.sessionId) || session;
    setSession(latest);
    onUpdateSession(latest);

    const cgl = getCustomerGoodsLeftBehind(latest.sessionId);
    setGoodsLeftBehindCount(cgl.filter((i) => !i.collected).length);

    const cas = getTemporaryCasuals(latest.sessionId);
    setCasualsCount(cas.filter((c) => c.active).length);
  };

  useEffect(() => {
    refreshSession();
  }, [session.sessionId]);

  // Add Segment Handler
  const handleAddSegment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStructure) return;
    if (!newSegmentName.trim()) return;

    const nextNum = (session.segments?.length || 0) + 1;
    const segId = `SEG-${String(nextNum).padStart(3, '0')}`;
    const newSegment: StocktakeSegment = {
      segmentId: segId,
      name: newSegmentName.trim(),
      description: newSegmentDesc.trim() || `Segment #${nextNum}`,
      locationCode: newSegmentLocation.trim() || `LOC-${String(nextNum).padStart(2, '0')}`,
      status: 'PENDING',
      count1: [],
      count2: [],
      verifiedCounts: [],
      discrepancyCount: 0,
      sessionId: session.sessionId,
    };

    // 1. Save to IndexedDB via roomDatabase.saveStocktakeSegment BEFORE updating React state
    saveStocktakeSegment(newSegment, session.sessionId);

    // 2. Broadcast to Mesh / Hub
    meshSyncService.broadcastStocktakeSegmentCreated(session.sessionId, newSegment);

    // 3. Update React state from IndexedDB & broadcast full session
    const refreshed = getStocktakeSessionById(session.sessionId);
    if (refreshed) {
      meshSyncService.broadcastStocktakeSession(refreshed);
      refreshSession(refreshed);
    }

    setShowAddSegmentModal(false);
    setNewSegmentName('');
    setNewSegmentLocation('');
    setNewSegmentDesc('');
    showToast('New segment added and synced across terminals.');
  };

  // Delete Segment Handler (inline confirm, no browser confirm())
  const handleConfirmDeleteSegment = (segmentId: string) => {
    if (!canManageStructure) return;
    const res = deleteStocktakeSegment(session.sessionId, segmentId);
    setPendingDeleteSegmentId(null);
    if (res) {
      meshSyncService.broadcastStocktakeSession(res);
      refreshSession(res);
      showToast('Segment removed and synced.');
    }
  };

  // Launch Double-Count Terminal for a segment (Enforcing Cross-Slot Blind Isolation)
  const handleLaunchTerminal = (segment: StocktakeSegment, slot: 'A' | 'B') => {
    const zoneAssignments = getZoneAssignments(session.sessionId);
    const zone = zoneAssignments.find((z) => z.zoneId === segment.segmentId);
    const mergedSeg = {
      ...segment,
      counterAId: segment.counterAId || zone?.teamA?.staffId,
      counterBId: segment.counterBId || zone?.teamB?.staffId,
    };
    const cleanStaff = String(currentUser?.id || '').trim().toUpperCase();
    const oppositeOwner = slot === 'A'
      ? String(mergedSeg.counterBId || '').trim().toUpperCase()
      : String(mergedSeg.counterAId || '').trim().toUpperCase();

    if (cleanStaff && oppositeOwner && oppositeOwner === cleanStaff) {
      showToast(
        `Blind isolation rule: You already counted Team ${slot === 'A' ? 'B' : 'A'} on this segment and cannot open Team ${slot}.`,
        true
      );
      return;
    }

    const check = canClaimSegmentSlot(mergedSeg, slot, currentUser?.id);
    if (!check.allowed && isBlindCounter) {
      showToast(check.reason || 'This slot is finalized and locked.', true);
      return;
    }

    setActiveTerminalSegment(segment);
    setTerminalCounterSlot(slot);
  };

  // Joint Recount Modal state (Peer Dual-Signature)
  const [showJointRecountModalSegment, setShowJointRecountModalSegment] = useState<StocktakeSegment | null>(null);

  // Real-time Stocktake Hub listeners
  useEffect(() => {
    const handleHubSync = () => {
      const refreshed = getStocktakeSessionById(session.sessionId);
      if (refreshed) {
        setSession(refreshed);
      }
    };
    const handleRejected = (evt: Event) => {
      const detail = (evt as CustomEvent)?.detail;
      showToast(detail?.reason || detail?.message || 'Stocktake action rejected by Hub.', true);
      handleHubSync();
    };
    window.addEventListener('saimetric_stocktake_updated', handleHubSync);
    window.addEventListener('saimetric_stocktake_zone_updated', handleHubSync);
    window.addEventListener('saimetric_stocktake_match_verified', handleHubSync);
    window.addEventListener('saimetric_stocktake_variance_alert', handleHubSync);
    window.addEventListener('saimetric_stocktake_ack_submit', handleHubSync);
    window.addEventListener('saimetric_stocktake_rejected', handleRejected);
    return () => {
      window.removeEventListener('saimetric_stocktake_updated', handleHubSync);
      window.removeEventListener('saimetric_stocktake_zone_updated', handleHubSync);
      window.removeEventListener('saimetric_stocktake_match_verified', handleHubSync);
      window.removeEventListener('saimetric_stocktake_variance_alert', handleHubSync);
      window.removeEventListener('saimetric_stocktake_ack_submit', handleHubSync);
      window.removeEventListener('saimetric_stocktake_rejected', handleRejected);
    };
  }, [session.sessionId]);

  const handleClaimZone = (segment: StocktakeSegment, slot: 'A' | 'B') => {
    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || (slot === 'A' ? 'Counter A' : 'Counter B');
    const zoneAssignments = getZoneAssignments(session.sessionId);
    const zone = zoneAssignments.find((z) => z.zoneId === segment.segmentId);
    const mergedSeg = {
      ...segment,
      counterAId: segment.counterAId || zone?.teamA?.staffId,
      counterBId: segment.counterBId || zone?.teamB?.staffId,
    };

    const check = canClaimSegmentSlot(mergedSeg, slot, staffId);
    if (!check.allowed) {
      showToast(check.reason || 'Cannot claim this slot.', true);
      return;
    }

    // 1. Save to IndexedDB via roomDatabase.updateZoneClaim BEFORE updating React state
    updateZoneClaim(
      segment.segmentId,
      slot,
      {
        staffId,
        staffName,
        deviceId: 'DEV-LOCAL',
        zoneName: segment.name,
        sessionId: session.sessionId,
      },
      session.sessionId
    );

    // 2. Broadcast to Mesh / Hub
    meshSyncService.claimStocktakeZone(session.sessionId, segment.segmentId, slot, staffId, staffName, segment.name);

    // 3. Render from IndexedDB
    const refreshed = getStocktakeSessionById(session.sessionId);
    if (refreshed) {
      refreshSession(refreshed);
    }

    showToast(`Claimed ${segment.name} as Team ${slot}!`);
    handleLaunchTerminal(segment, slot);
  };

  // Save Double-Blind Count from Terminal (Secured in Local Hub Vault)
  const handleSaveCountFromTerminal = (
    slot: 'A' | 'B',
    lines: StocktakeLineCount[],
    counterStaffId: string,
    counterStaffName: string
  ) => {
    if (!activeTerminalSegment) return;

    try {
      // 1. Save to IndexedDB via roomDatabase.saveCountSubmission BEFORE broadcasting
      saveCountSubmission(
        session.sessionId,
        activeTerminalSegment.segmentId,
        slot,
        lines,
        counterStaffId,
        counterStaffName
      );

      // 2. Point-to-Point Blind Submission to Local Hub
      meshSyncService.submitBlindStocktakeCount(
        session.sessionId,
        activeTerminalSegment.segmentId,
        slot,
        counterStaffId,
        counterStaffName,
        lines
      );

      // 3. Refresh from IndexedDB
      const refreshed = getStocktakeSessionById(session.sessionId);
      if (refreshed) {
        refreshSession(refreshed);
      }
      showToast(`Count saved to IndexedDB and submitted for Team ${slot}.`);
      setActiveTerminalSegment(null);
    } catch (err: any) {
      showToast(err.message || 'Error submitting count.', true);
    }
  };

  // Resolve Segment Recount Discrepancy
  const handleResolveRecount = (
    segmentId: string,
    resolvedRecountLines: StocktakeLineCount[],
    staffId: string,
    staffName: string
  ) => {
    try {
      const res = resolveSegmentRecount(
        session.sessionId,
        segmentId,
        resolvedRecountLines,
        staffId,
        staffName
      );
      if (res.session) {
        meshSyncService.broadcastStocktakeSession(res.session);
      }
      refreshSession(res.session);
      setActiveRecountSegment(null);
      showToast(res.message);
    } catch (err: any) {
      showToast(err.message || 'Error resolving recount.', true);
    }
  };

  // Consolidate Counts
  const handleConsolidate = () => {
    try {
      const res = consolidateStocktakeSession(session.sessionId);
      if (res.session) {
        meshSyncService.broadcastStocktakeSession(res.session);
      }
      refreshSession(res.session);
      if (res.success) {
        setActiveView('VARIANCE');
        showToast(res.message);
      } else {
        showToast(res.message, true);
      }
    } catch (err: any) {
      showToast(err.message || 'Error during consolidation.', true);
    }
  };

  // Request SKU Variance Recount
  const handleRequestSkuRecount = (itemId: string, notes?: string) => {
    const res = requestSkuVarianceRecount(session.sessionId, itemId, notes);
    if (res) {
      meshSyncService.broadcastStocktakeSession(res);
      refreshSession(res);
      showToast(`Flagged ${itemId} for secondary Blind Recount Sheet.`);
    }
  };

  // Batch Dispatch Variance SKUs to Blind Recount Sheet
  const handleBatchRequestRecount = (itemIds: string[]) => {
    const res = requestBatchVarianceRecount(session.sessionId, itemIds);
    if (res) {
      meshSyncService.broadcastStocktakeSession(res);
      refreshSession(res);
      showToast(`Dispatched ${itemIds.length} SKU(s) to Blind Recount Sheet.`);
    }
  };

  // Submit SKU Variance Recount
  const handleSubmitSkuRecount = (itemId: string, cases: number, singles: number) => {
    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Supervisor';
    const res = submitSkuVarianceRecount(session.sessionId, itemId, cases, singles, staffId, staffName);
    if (res) {
      meshSyncService.broadcastStocktakeSession(res);
      refreshSession(res);
      showToast(`Updated physical recount for item. Variances recalculated.`);
    }
  };

  // Auditor Unlock / Re-open Finalized Segment Slot
  const handleConfirmUnlockSegment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockModalState || !canManageStructure) return;
    const reason = unlockReason.trim();
    if (!reason) {
      showToast('Enter an audit reason before unlocking a finalized count.', true);
      return;
    }
    const actorId = currentUser?.id || '001';
    const actorName = currentUser?.name || 'Stocktake Auditor';
    const updated = reopenFinalizedSegmentSlot(
      session.sessionId,
      unlockModalState.segment.segmentId,
      unlockModalState.target,
      actorId,
      actorName,
      reason
    );
    meshSyncService.unlockStocktakeSegment(
      session.sessionId,
      unlockModalState.segment.segmentId,
      unlockModalState.target,
      actorId,
      actorName,
      reason
    );
    if (updated) {
      meshSyncService.broadcastStocktakeSession(updated);
      refreshSession(updated);
    }
    setUnlockModalState(null);
    setUnlockReason('');
    showToast('Finalized count slot unlocked for correction and synced.');
  };

  // Auditor Certification Step (Two-Man Integrity Phase 1)
  const handleCertifyReady = (auditorId: string, auditorName: string, notes?: string) => {
    const res = certifyStocktakeReady(session.sessionId, auditorId, auditorName, notes);
    if (res.success && res.session) {
      meshSyncService.broadcastStocktakeSession(res.session);
      refreshSession(res.session);
      setShowApprovalModal(false);
      showToast(res.message);
    } else {
      showToast(res.message, true);
    }
  };

  // Final Leader/Owner Committal (Chunked Async for Smooth Storage, Hub & Cloud Sync)
  const handleApprove = async (
    adminId: string,
    adminName: string,
    notes?: string,
    onProgress?: (progress: StocktakeCommitProgress) => void
  ) => {
    const res = await approveAndCommitStocktakeAsync(
      session.sessionId,
      adminId,
      adminName,
      notes,
      onProgress
    );
    if (res.success && res.session) {
      meshSyncService.broadcastStocktakeSession(res.session);
      meshSyncService.broadcastCasualWorkers(getTemporaryCasuals());
      if (session.isLockdownActive || session.countType === 'FULL_LOCKDOWN') {
        meshSyncService.broadcastStocktakeLockdown(
          res.session.branchId,
          res.session.sessionId,
          false,
          adminName,
          `Stocktake ${res.session.sessionId} committed & lockdown released.`,
          adminId
        );
      }
      refreshSession(res.session);
      setShowApprovalModal(false);
      setActiveView('AUDIT_CERT');
      showToast(res.message);
    } else {
      showToast(res.message, true);
    }
  };

  // Lightweight local draft summary reader (supports sparse_v2 and legacy full-array drafts)
  const getLocalDraftCount = (segmentId: string, slot: 'A' | 'B'): number => {
    try {
      const raw = localStorage.getItem(
        `saimetric_stocktake_draft_${session.sessionId}_${segmentId}_${slot}`
      );
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.lines)) return 0;
      return parsed.lines.filter(
        (l: any) => (Number(l?.totalUnits) || 0) > 0 || Boolean(l?.wasCounted)
      ).length;
    } catch {
      return 0;
    }
  };

  const handlePrintCertificate = () => {
    window.print();
  };

  const displaySession = isBlindCounter ? sanitizeSessionForCounter(session) : session;

  // If in Double-Count Terminal mode, render full-screen terminal
  if (activeTerminalSegment) {
    return (
      <DoubleCountTerminal
        session={displaySession}
        segment={activeTerminalSegment}
        currentUser={currentUser}
        initialCounterSlot={terminalCounterSlot}
        onSaveCount={handleSaveCountFromTerminal}
        onPaused={(countedCount, segName, slot) => {
          setActiveTerminalSegment(null);
          showToast(
            countedCount > 0
              ? `Paused "${segName}" (Team ${slot}) — ${countedCount} counted item(s) saved safely on this device.`
              : `Paused "${segName}" (Team ${slot}) — you can resume anytime.`
          );
        }}
        onBack={() => setActiveTerminalSegment(null)}
      />
    );
  }

  const safeSegments = Array.isArray(session.segments) ? session.segments : [];
  const allSegmentsVerified =
    safeSegments.length > 0 && safeSegments.every((s) => s.status === 'VERIFIED');
  const hasDiscrepancy = safeSegments.some((s) => s.status === 'DISCREPANCY_RECOUNT');
  const verifiedCount = safeSegments.filter((s) => s.status === 'VERIFIED').length;
  const queuedBlindRecountCount = (session.consolidatedItems || []).filter(
    (item) => item.recountSheetStatus === 'REQUESTED' || Boolean(item.recountRequested)
  ).length;
  const openView = (tab: DetailTab) => {
    if (tab === 'VARIANCE') {
      try {
        if (safeSegments.some((s) => s.status === 'VERIFIED')) {
          const res = consolidateStocktakeSession(session.sessionId, true);
          if (res && res.session) refreshSession(res.session);
        }
      } catch {}
    }
    setActiveView(tab);
  };

  // Segment visibility for blind counters assigned to specific segment(s)
  const visibleSegments = (() => {
    if (!isBlindCounter) return safeSegments;
    const assignedSet = new Set<string>();
    if (currentUser?.assignedSegmentId) assignedSet.add(currentUser.assignedSegmentId);
    if (Array.isArray(currentUser?.assignedSegmentIds)) {
      currentUser.assignedSegmentIds.forEach((id) => assignedSet.add(id));
    }
    if (assignedSet.size === 0) return safeSegments;
    const filtered = safeSegments.filter((s) => assignedSet.has(s.segmentId));
    return filtered.length > 0 ? filtered : safeSegments;
  })();

  const countTypeBadge =
    session.countType === 'DAILY_BLIND'
      ? { label: 'Daily Blind Count', color: 'bg-amber-950 text-amber-300 border-amber-800' }
      : session.countType === 'SPOT_CHECK'
      ? { label: 'Supervisor Spot Check', color: 'bg-emerald-950 text-emerald-300 border-emerald-800' }
      : session.countType === 'WEEKLY_STRATEGIC'
      ? { label: 'Weekly Strategic', color: 'bg-purple-950 text-purple-300 border-purple-800' }
      : { label: 'Full Store Lockdown', color: 'bg-rose-950 text-rose-300 border-rose-800' };

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen flex flex-col">
      {/* Top Session Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 sticky top-0 z-20 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Back to Stocktake Hub"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                  {session.sessionId}
                </span>
                <h1 className="text-lg font-bold text-white tracking-tight">{session.title}</h1>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${countTypeBadge.color}`}>
                  {countTypeBadge.label}
                </span>
                <span
                  className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                    session.status === 'APPROVED_POSTED'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : session.status === 'CONSOLIDATED'
                      ? 'bg-blue-950 text-blue-300 border-blue-800'
                      : session.status === 'RECOUNTING'
                      ? 'bg-amber-950 text-amber-300 border-amber-800 animate-pulse'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {String(session.status || 'COUNTING').replace(/_/g, ' ')}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Date: <strong className="text-slate-300">{session.date}</strong>
                </span>
                <span className="flex items-center gap-1">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  Branch: <strong className="text-slate-300">{session.branchName}</strong>
                </span>
                {session.stocktakeAuditorName && (
                  <span className="flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-amber-400" />
                    Auditor: <strong className="text-amber-300">{session.stocktakeAuditorName}</strong>
                  </span>
                )}
                <span>
                  Created by: <strong className="text-slate-300">{session.createdByName}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Action Hub (Strict Two-Man Integrity) */}
          <div className="flex flex-wrap items-center gap-2">
            {session.certifiedByName && !isApproved && (
              <span className="px-3 py-1.5 rounded-xl bg-amber-950/70 border border-amber-700/70 text-amber-200 text-xs font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                Certified Ready by {session.certifiedByName}
              </span>
            )}

            {!isApproved && allSegmentsVerified && canManageStructure && (
              <button
                onClick={handleConsolidate}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 flex items-center gap-2 transition"
              >
                <Layers className="w-4 h-4" />
                Consolidate & Compare SOH
              </button>
            )}

            {!isApproved &&
              session.consolidatedItems &&
              session.consolidatedItems.length > 0 &&
              persona === 'AUDITOR' &&
              session.status !== 'READY_FOR_COMMITTAL' && (
                <button
                  onClick={() => setShowApprovalModal(true)}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Certify Counts Ready
                </button>
              )}

            {!isApproved &&
              session.consolidatedItems &&
              session.consolidatedItems.length > 0 &&
              persona === 'LEADER' && (
                <button
                  onClick={() => setShowApprovalModal(true)}
                  className={`px-4 py-2 text-white rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 transition ${
                    session.status === 'READY_FOR_COMMITTAL'
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/40 ring-2 ring-emerald-400/50'
                      : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/30'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  Authorize & Commit Stock
                </button>
              )}

            {isApproved && allowedTabs.includes('AUDIT_CERT') && (
              <button
                onClick={() => setActiveView('AUDIT_CERT')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-800/40 rounded-xl text-xs font-bold flex items-center gap-2 transition"
              >
                <FileText className="w-4 h-4" />
                View Committal Certificate
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Sub-View Breadcrumb Bar (Replaces Horizontal Scrolling Tabs) */}
      {activeView !== 'HOME' && (
        <div className="bg-slate-900/90 border-b border-slate-800 px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setActiveView('HOME')}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-blue-400" />
              Back to Stocktake Command Home
            </button>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Active Module:</span>
              <span className="font-bold text-white px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                {activeView === 'SEGMENTS'
                  ? 'Floor Segments & Double Counting'
                  : activeView === 'VARIANCE'
                  ? 'Consolidated Variance Report'
                  : activeView === 'GOODS_LEFT_BEHIND'
                  ? 'Customer Goods Left Behind'
                  : activeView === 'CASUALS'
                  ? 'Casuals & Visiting Passes'
                  : activeView === 'FAST_MOVERS'
                  ? 'Fast Movers Checklist'
                  : activeView === 'LOCKDOWN'
                  ? 'Lockdown & Emergency Sales'
                  : activeView === 'P2P_SYNC'
                  ? 'P2P Mesh & Cloud Throttler'
                  : activeView === 'VARIANCE_COMMENTS'
                  ? 'Post-Commit Variance Commentary'
                  : 'Official Audit Certificate'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {toastMessage && (
        <div
          className={`px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2 animate-fadeIn border-b ${
            toastIsError
              ? 'bg-rose-900/90 text-rose-100 border-rose-700'
              : 'bg-blue-900/90 text-blue-100 border-blue-700'
          }`}
        >
          <Info className={`w-4 h-4 ${toastIsError ? 'text-rose-300' : 'text-blue-300'}`} />
          {toastMessage}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
        {/* VIEW 0: ROLE-AWARE STOCKTAKE COMMAND HOME (NO HORIZONTAL SCROLLING) */}
        {activeView === 'HOME' && (
          <div className="space-y-6">
            {/* Active Session Status Hero */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/30 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-blue-300 font-bold uppercase tracking-wider">
                    <LayoutGrid className="w-4 h-4" />
                    Role-Aware Stocktake Command Home • Persona: {persona.replace(/_/g, ' ')}
                  </div>
                  <h2 className="text-xl font-bold text-white mt-1">
                    {verifiedCount}/{safeSegments.length} Floor Segments Verified
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {isBlindCounter
                      ? 'Blind Counter Mode active: enter physical counts only. SOH and variance totals remain hidden.'
                      : persona === 'AUDITED_MANAGER'
                      ? 'Audited Manager Mode: manage floor operations, customer holds, emergency lockdown sales & post-commit variance comments.'
                      : 'Auditor / Leader Oversight: monitor dual counts, run consolidated variance reports, trigger blind recounts & certify committal.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openView('SEGMENTS')}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg flex items-center gap-2 transition"
                  >
                    <Layers className="w-4 h-4" />
                    Open Floor Segments
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all ${
                    allSegmentsVerified ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{
                    width: `${safeSegments.length > 0 ? (verifiedCount / safeSegments.length) * 100 : 0}%`,
                  }}
                />
              </div>

              {/* Action Alerts Inside Hero */}
              {queuedBlindRecountCount > 0 && !isApproved && (
                <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-700/70 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-xs text-amber-100">
                    <EyeOff className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      <strong>{queuedBlindRecountCount} SKU(s)</strong> flagged for independent <strong>Blind Recount Sheet</strong> verification.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBlindRecountModal(true)}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Open Blind Recount Sheet
                  </button>
                </div>
              )}

              {isApproved &&
                session.varianceReviewStatus === 'PENDING_MANAGER_COMMENTS' &&
                allowedTabs.includes('VARIANCE_COMMENTS') && (
                  <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-700/70 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-xs text-amber-100">
                      <MessageSquare className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        <strong>Post-Commit Variance Explanations Due:</strong> Manager / Supervisor commentary required on material variances.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openView('VARIANCE_COMMENTS')}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Open Variance Commentary
                    </button>
                  </div>
                )}
            </div>

            {/* Role-Filtered Command Action Tiles Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {allowedTabs.includes('SEGMENTS') && (
                <button
                  type="button"
                  onClick={() => openView('SEGMENTS')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-blue-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center">
                      <Layers className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-800">
                      {verifiedCount}/{safeSegments.length} Verified
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition">
                      Floor Segments &amp; Double Counting
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Claim Team A/B slots, pause/resume drafts, finalize locked counts, and resolve joint recounts.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('VARIANCE') && (
                <button
                  type="button"
                  onClick={() => openView('VARIANCE')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800">
                      {session.consolidatedItems?.length || 0} SKUs
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition">
                      Consolidated Variance Report
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Compare verified floor counts vs System SOH, audit recount reversals &amp; export ledger.
                    </p>
                  </div>
                </button>
              )}

              {queuedBlindRecountCount > 0 && !isApproved && (
                <button
                  type="button"
                  onClick={() => setShowBlindRecountModal(true)}
                  className="bg-amber-950/30 hover:bg-amber-950/50 border border-amber-600/50 hover:border-amber-400 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center">
                      <EyeOff className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-600 text-white">
                      {queuedBlindRecountCount} Queued
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-amber-100 group-hover:text-white transition">
                      Blind Recount Sheet
                    </h3>
                    <p className="text-xs text-amber-200/80 mt-1">
                      Independent physical recount for flagged variance SKUs with zero SOH leakage.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('GOODS_LEFT_BEHIND') && (
                <button
                  type="button"
                  onClick={() => openView('GOODS_LEFT_BEHIND')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                      <PackageOpen className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      {goodsLeftBehindCount} Pending
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-amber-300 transition">
                      Customer Goods Left Behind
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Log paid customer hold items &amp; laybys so they are excluded from variance shrinkage.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('CASUALS') && (
                <button
                  type="button"
                  onClick={() => openView('CASUALS')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
                      {casualsCount} Active
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-amber-300 transition">
                      Casuals &amp; Visiting Passes
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Issue temporary casual counter/auditor PINs &amp; cross-branch visiting staff passes.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('FAST_MOVERS') && (
                <button
                  type="button"
                  onClick={() => openView('FAST_MOVERS')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                      <Zap className="w-5 h-5" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition">
                      Fast Movers Checklist
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Track high-velocity SKUs (airtime, bread, gas) during active blind verification.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('LOCKDOWN') && (
                <button
                  type="button"
                  onClick={() => openView('LOCKDOWN')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-rose-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                      <Lock className="w-5 h-5" />
                    </div>
                    {session.isLockdownActive && (
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-700">
                        LOCKED
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-rose-300 transition">
                      Lockdown &amp; Emergency Sales
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Control branch POS lockdown status and log supervisor-approved emergency sales.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('P2P_SYNC') && (
                <button
                  type="button"
                  onClick={() => openView('P2P_SYNC')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                      <Share2 className="w-5 h-5" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition">
                      P2P Mesh &amp; Cloud Throttler
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Inspect local Hub WebSocket sync state across floor devices and batch cloud uploads.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('VARIANCE_COMMENTS') && isApproved && (
                <button
                  type="button"
                  onClick={() => openView('VARIANCE_COMMENTS')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-amber-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    {session.varianceReviewStatus === 'PENDING_MANAGER_COMMENTS' && (
                      <span className="font-mono text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950">
                        Action Due
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-amber-300 transition">
                      Post-Commit Variance Commentary
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Collaborative manager/supervisor root-cause notes, draft pause &amp; Owner sign-off.
                    </p>
                  </div>
                </button>
              )}

              {allowedTabs.includes('AUDIT_CERT') && isApproved && (
                <button
                  type="button"
                  onClick={() => openView('AUDIT_CERT')}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition">
                      Official Audit Certificate
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      View &amp; print final committed physical stocktake totals and signatory approval.
                    </p>
                  </div>
                </button>
              )}

              {canManageStructure && !isApproved && (
                <button
                  type="button"
                  onClick={() => setShowBranchSegmentsModal(true)}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-2xl p-5 text-left transition shadow-lg flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                      <MapPin className="w-5 h-5" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition">
                      Configure Branch Floor Map
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Manage persistent physical aisles &amp; shelves for your branch across future stocktakes.
                    </p>
                  </div>
                </button>
              )}
            </div>
          </div>
        )}

        {/* TAB 1: SEGMENTS & DOUBLE COUNTING WORKSPACE */}
        {activeView === 'SEGMENTS' && (
          <div className="space-y-4">
            {/* Step Explanation Banner */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Double-Blind Stocktake Workflow</h2>
                  <p className="text-xs text-slate-400">
                    1. Assign two counters per segment to count separately. 2. System automatically compares Count 1 vs Count 2 and creates a recount list for discrepancies. 3. Resolve recounts to verify each segment.
                  </p>
                </div>
              </div>

              {!isApproved && canManageStructure && (
                <button
                  onClick={() => setShowAddSegmentModal(true)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-400" />
                  Add New Segment
                </button>
              )}
            </div>

            {isBlindCounter && (
              <div className="bg-blue-950/40 border border-blue-800/60 rounded-xl p-3 text-xs text-blue-200 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400 shrink-0" />
                <span>
                  <strong>Counter Isolation Active:</strong> Select your assigned floor segment below to enter Blind Count quantities
                  {currentUser?.assignedGroup
                    ? ` (${currentUser.assignedGroup === 'GROUP_1' ? 'Group 1 / Team A' : 'Group 2 / Team B'}).`
                    : '.'}
                </span>
              </div>
            )}

            {/* Segments Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleSegments.map((seg, segIdx) => {
                const zoneAssignments = getZoneAssignments(session.sessionId);
                const zone = zoneAssignments.find((z) => z.zoneId === seg.segmentId);

                const isTeamAClaimed = Boolean(
                  seg.counterAName ||
                  seg.counterAId ||
                  zone?.teamA?.claimedAt ||
                  zone?.teamA?.staffName
                );
                const teamAName = seg.counterAName || zone?.teamA?.staffName || 'Counter A';

                const isCount1Submitted = Boolean(
                  (seg.count1 && seg.count1.length > 0) ||
                  seg.hasCountA ||
                  seg.count1Submitted ||
                  zone?.teamA?.submitted ||
                  seg.status === 'VERIFIED' ||
                  seg.status === 'DISCREPANCY_RECOUNT' ||
                  seg.status === 'AWAITING_DOUBLE_COUNT'
                );

                const isTeamBClaimed = Boolean(
                  seg.counterBName ||
                  seg.counterBId ||
                  zone?.teamB?.claimedAt ||
                  zone?.teamB?.staffName
                );
                const teamBName = seg.counterBName || zone?.teamB?.staffName || 'Counter B';

                const isCount2Submitted = Boolean(
                  (seg.count2 && seg.count2.length > 0) ||
                  seg.hasCountB ||
                  seg.count2Submitted ||
                  zone?.teamB?.submitted ||
                  seg.status === 'VERIFIED' ||
                  seg.status === 'DISCREPANCY_RECOUNT'
                );

                const discrepancyList = (seg.discrepancies && seg.discrepancies.length > 0) ? seg.discrepancies : (zone?.discrepancies || []);
                const discrepancyCount = seg.discrepancyCount || discrepancyList.length || 0;

                const effectiveStatus =
                  seg.status === 'VERIFIED' || zone?.status === 'VERIFIED'
                    ? 'VERIFIED'
                    : (seg.status === 'DISCREPANCY_RECOUNT' || zone?.status === 'VARIANCE_FLAGGED' || discrepancyList.length > 0)
                    ? 'DISCREPANCY_RECOUNT'
                    : (isCount1Submitted && isCount2Submitted)
                    ? 'COMPARING'
                    : (isCount1Submitted && !isCount2Submitted)
                    ? 'AWAITING_DOUBLE_COUNT'
                    : (isTeamAClaimed || isTeamBClaimed)
                    ? 'COUNTING'
                    : 'AVAILABLE';

                const count1Units = seg.count1?.reduce((acc: number, l: any) => acc + (Number(l.totalUnits) || 0), 0) || 0;
                const count2Units = seg.count2?.reduce((acc: number, l: any) => acc + (Number(l.totalUnits) || 0), 0) || 0;
                const verifiedList = (seg.verifiedCounts && seg.verifiedCounts.length > 0) ? seg.verifiedCounts : (zone?.verifiedCounts || []);
                const verifiedUnits = verifiedList.reduce((acc: number, l: any) => acc + (Number(l.totalUnits) || 0), 0);

                const isCount1Finalized = Boolean(seg.count1Finalized || zone?.teamA?.finalized);
                const isCount2Finalized = Boolean(seg.count2Finalized || zone?.teamB?.finalized);
                const isComparisonFinalized = Boolean(seg.comparisonFinalized || zone?.comparisonFinalized);

                const mergedForCheck = {
                  ...seg,
                  counterAId: seg.counterAId || zone?.teamA?.staffId,
                  counterBId: seg.counterBId || zone?.teamB?.staffId,
                  count1Finalized: isCount1Finalized,
                  count2Finalized: isCount2Finalized,
                  comparisonFinalized: isComparisonFinalized,
                };
                const claimCheckA = canClaimSegmentSlot(mergedForCheck, 'A', currentUser?.id);
                const claimCheckB = canClaimSegmentSlot(mergedForCheck, 'B', currentUser?.id);
                const cleanStaff = String(currentUser?.id || '').trim().toUpperCase();
                const isSameUserOtherSlotA = Boolean(
                  cleanStaff &&
                  mergedForCheck.counterBId &&
                  String(mergedForCheck.counterBId).trim().toUpperCase() === cleanStaff
                );
                const isSameUserOtherSlotB = Boolean(
                  cleanStaff &&
                  mergedForCheck.counterAId &&
                  String(mergedForCheck.counterAId).trim().toUpperCase() === cleanStaff
                );

                const draftCountA =
                  !isCount1Finalized &&
                  !(isBlindCounter && currentUser?.assignedGroup === 'GROUP_2')
                    ? getLocalDraftCount(seg.segmentId, 'A')
                    : 0;
                const draftCountB =
                  !isCount2Finalized &&
                  !(isBlindCounter && currentUser?.assignedGroup === 'GROUP_1')
                    ? getLocalDraftCount(seg.segmentId, 'B')
                    : 0;

                return (
                  <div
                    key={`${seg.segmentId}-${segIdx}`}
                    className={`bg-slate-900/90 rounded-2xl border p-5 flex flex-col justify-between gap-4 transition shadow-lg ${
                      effectiveStatus === 'VERIFIED'
                        ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                        : effectiveStatus === 'DISCREPANCY_RECOUNT'
                        ? 'border-amber-500/50 ring-1 ring-amber-500/20'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      {/* Segment Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700">
                              {seg.locationCode || seg.segmentId}
                            </span>
                            <h3 className="text-base font-bold text-white">{seg.name}</h3>
                            {isComparisonFinalized && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> COMPARISON FINALIZED
                              </span>
                            )}
                          </div>
                          {seg.description && (
                            <p className="text-xs text-slate-400 mt-1">{seg.description}</p>
                          )}
                        </div>

                        <span
                          className={`text-xs font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${
                            effectiveStatus === 'VERIFIED'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : effectiveStatus === 'DISCREPANCY_RECOUNT'
                              ? 'bg-amber-950 text-amber-300 border-amber-800 animate-pulse'
                              : effectiveStatus === 'AWAITING_DOUBLE_COUNT'
                              ? 'bg-purple-950 text-purple-300 border-purple-800'
                              : effectiveStatus === 'COUNTING' || effectiveStatus === 'COMPARING'
                              ? 'bg-blue-950 text-blue-300 border-blue-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {effectiveStatus === 'DISCREPANCY_RECOUNT'
                            ? `Recount Needed (${discrepancyCount || 1})`
                            : effectiveStatus === 'AWAITING_DOUBLE_COUNT'
                            ? 'Awaiting Team B Count'
                            : effectiveStatus === 'COMPARING'
                            ? 'Comparing Dual Counts'
                            : effectiveStatus === 'COUNTING'
                            ? 'Counting in Progress'
                            : effectiveStatus === 'VERIFIED'
                            ? 'VERIFIED'
                            : 'AVAILABLE'}
                        </span>
                      </div>

                      {/* Double Count Progress Trackers */}
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        {/* Counter A Box */}
                        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                          <div className="flex items-center justify-between text-xs gap-1">
                            <span className="font-semibold text-blue-400">Count 1 (Team A)</span>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {isCount1Finalized && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-0.5">
                                  <Lock className="w-2.5 h-2.5" /> FINALIZED
                                </span>
                              )}
                              {draftCountA > 0 && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-700/80 flex items-center gap-0.5">
                                  <Pause className="w-2.5 h-2.5" /> Paused ({draftCountA})
                                </span>
                              )}
                              {isCount1Submitted ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                              ) : isTeamAClaimed ? (
                                <Clock className="w-3.5 h-3.5 text-amber-400" />
                              ) : null}
                            </div>
                          </div>
                          <div className="text-sm font-bold font-mono text-white mt-1">
                            {isBlindCounter
                              ? isCount1Finalized
                                ? 'Finalized & Locked'
                                : isCount1Submitted
                                ? 'Count Submitted (Blind)'
                                : draftCountA > 0
                                ? `Paused Draft (${draftCountA} items)`
                                : isTeamAClaimed
                                ? 'Counting in Progress...'
                                : 'Not Started'
                              : count1Units > 0
                              ? `${count1Units} units`
                              : isCount1Submitted
                              ? effectiveStatus === 'VERIFIED' && verifiedUnits > 0
                                ? `${verifiedUnits} units (Verified)`
                                : 'Count Submitted (Vaulted)'
                              : draftCountA > 0
                              ? `Paused Draft (${draftCountA} items)`
                              : isTeamAClaimed
                              ? 'Counting in Progress...'
                              : 'Not Started'}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {isCount1Submitted
                              ? `Submitted by ${teamAName}`
                              : draftCountA > 0
                              ? 'Saved locally on this device'
                              : isTeamAClaimed
                              ? `Claimed by ${teamAName}`
                              : 'Awaiting counter'}
                          </div>
                        </div>

                        {/* Counter B Box */}
                        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                          <div className="flex items-center justify-between text-xs gap-1">
                            <span className="font-semibold text-purple-400">Count 2 (Team B)</span>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              {isCount2Finalized && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-0.5">
                                  <Lock className="w-2.5 h-2.5" /> FINALIZED
                                </span>
                              )}
                              {draftCountB > 0 && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-700/80 flex items-center gap-0.5">
                                  <Pause className="w-2.5 h-2.5" /> Paused ({draftCountB})
                                </span>
                              )}
                              {isCount2Submitted ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                              ) : isTeamBClaimed ? (
                                <Clock className="w-3.5 h-3.5 text-amber-400" />
                              ) : null}
                            </div>
                          </div>
                          <div className="text-sm font-bold font-mono text-white mt-1">
                            {isBlindCounter
                              ? isCount2Finalized
                                ? 'Finalized & Locked'
                                : isCount2Submitted
                                ? 'Count Submitted (Blind)'
                                : draftCountB > 0
                                ? `Paused Draft (${draftCountB} items)`
                                : isTeamBClaimed
                                ? 'Counting in Progress...'
                                : 'Not Started'
                              : count2Units > 0
                              ? `${count2Units} units`
                              : isCount2Submitted
                              ? effectiveStatus === 'VERIFIED' && verifiedUnits > 0
                                ? `${verifiedUnits} units (Verified)`
                                : 'Count Submitted (Vaulted)'
                              : draftCountB > 0
                              ? `Paused Draft (${draftCountB} items)`
                              : isTeamBClaimed
                              ? 'Counting in Progress...'
                              : 'Not Started'}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {isCount2Submitted
                              ? `Submitted by ${teamBName}`
                              : draftCountB > 0
                              ? 'Saved locally on this device'
                              : isTeamBClaimed
                              ? `Claimed by ${teamBName}`
                              : 'Awaiting counter'}
                          </div>
                        </div>
                      </div>

                      {/* Discrepancy Alert / Verification summary */}
                      {(effectiveStatus === 'DISCREPANCY_RECOUNT' || discrepancyList.length > 0) && (
                        <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>
                              <strong>{discrepancyCount || discrepancyList.length || 1} SKU discrepancy detected</strong>{' '}
                              between Count 1 and Count 2.
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isComparisonFinalized}
                              onClick={() => setShowJointRecountModalSegment({ ...seg, discrepancies: discrepancyList, discrepancyCount })}
                              title={isComparisonFinalized ? 'Comparison finalized. Auditor unlock required.' : 'Open Joint Recount'}
                              className="px-3 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-black shadow-md transition flex items-center gap-1.5"
                            >
                              {isComparisonFinalized ? <Lock className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                              {isComparisonFinalized ? 'Comparison Locked' : 'Joint Dual-Signature Recount'}
                            </button>
                            {canManageStructure && !isComparisonFinalized && (
                              <button
                                type="button"
                                onClick={() => setActiveRecountSegment({ ...seg, discrepancies: discrepancyList, discrepancyCount })}
                                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold border border-slate-700 transition"
                              >
                                Manual Override
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {effectiveStatus === 'VERIFIED' && (
                        <div className="mt-3 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>
                              {isBlindCounter
                                ? 'Segment Blind Double-Count Verified'
                                : `Verified Count: ${verifiedUnits} units across ${verifiedList.length} SKUs.`}
                            </span>
                          </div>
                          {seg.recountedAt && (
                            <span className="text-[10px] text-slate-400">
                              Resolved by {seg.recounterName}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Terminal Action Buttons & Self-Service Claiming */}
                    <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {(!isBlindCounter || !currentUser?.assignedGroup || currentUser.assignedGroup === 'GROUP_1') && (
                          <button
                            type="button"
                            disabled={isSameUserOtherSlotA || (!claimCheckA.allowed && isBlindCounter)}
                            title={
                              isSameUserOtherSlotA || !claimCheckA.allowed
                                ? claimCheckA.reason
                                : 'Open Team A counting terminal'
                            }
                            onClick={() => {
                              if (isCount1Submitted || isTeamAClaimed) {
                                handleLaunchTerminal(seg, 'A');
                              } else {
                                handleClaimZone(seg, 'A');
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed ${
                              isCount1Finalized
                                ? 'bg-slate-800 text-emerald-300 border border-emerald-700/60'
                                : isCount1Submitted
                                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600 hover:text-white'
                                : isTeamAClaimed
                                ? 'bg-blue-900/40 text-blue-200 border border-blue-700 hover:bg-blue-700 hover:text-white'
                                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-sm'
                            }`}
                          >
                            {isCount1Finalized ? <Lock className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                            {isSameUserOtherSlotA
                              ? 'Blocked (You Counted Team B)'
                              : isCount1Finalized
                              ? isBlindCounter
                                ? 'Team A Finalized 🔒'
                                : 'Inspect Team A (Locked)'
                              : isCount1Submitted
                              ? 'Resume Count 1 (Team A)'
                              : isTeamAClaimed
                              ? `Resume Count 1 (${teamAName})`
                              : 'Claim Zone as Team A'}
                          </button>
                        )}

                        {(!isBlindCounter || !currentUser?.assignedGroup || currentUser.assignedGroup === 'GROUP_2') && (
                          <button
                            type="button"
                            disabled={isSameUserOtherSlotB || (!claimCheckB.allowed && isBlindCounter)}
                            title={
                              isSameUserOtherSlotB || !claimCheckB.allowed
                                ? claimCheckB.reason
                                : 'Open Team B counting terminal'
                            }
                            onClick={() => {
                              if (isCount2Submitted || isTeamBClaimed) {
                                handleLaunchTerminal(seg, 'B');
                              } else {
                                handleClaimZone(seg, 'B');
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed ${
                              isCount2Finalized
                                ? 'bg-slate-800 text-emerald-300 border border-emerald-700/60'
                                : isCount2Submitted
                                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600 hover:text-white'
                                : isTeamBClaimed
                                ? 'bg-purple-900/40 text-purple-200 border border-purple-700 hover:bg-purple-700 hover:text-white'
                                : isCount1Submitted
                                ? 'bg-amber-600 text-white hover:bg-amber-500 shadow-sm animate-pulse'
                                : 'bg-purple-600 text-white hover:bg-purple-500 shadow-sm'
                            }`}
                          >
                            {isCount2Finalized ? <Lock className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                            {isSameUserOtherSlotB
                              ? 'Blocked (You Counted Team A)'
                              : isCount2Finalized
                              ? isBlindCounter
                                ? 'Team B Finalized 🔒'
                                : 'Inspect Team B (Locked)'
                              : isCount2Submitted
                              ? 'Resume Count 2 (Team B)'
                              : isTeamBClaimed
                              ? `Resume Count 2 (${teamBName})`
                              : isCount1Submitted
                              ? 'Claim Double-Count as Team B'
                              : 'Claim as Team B'}
                          </button>
                        )}

                        {canManageStructure &&
                          !isApproved &&
                          (isCount1Finalized || isCount2Finalized || isComparisonFinalized) && (
                            <button
                              type="button"
                              onClick={() => {
                                const defaultTarget: 'A' | 'B' | 'COMPARISON' | 'ALL' = isComparisonFinalized
                                  ? 'COMPARISON'
                                  : isCount1Finalized
                                  ? 'A'
                                  : 'B';
                                setUnlockModalState({ segment: seg, target: defaultTarget });
                                setUnlockReason('');
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900 text-amber-200 border border-amber-700/70 text-xs font-bold flex items-center gap-1 transition"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              Unlock / Re-open
                            </button>
                          )}
                      </div>

                      {!isApproved && canManageStructure && (
                        pendingDeleteSegmentId === seg.segmentId ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleConfirmDeleteSegment(seg.segmentId)}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteSegmentId(null)}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteSegmentId(seg.segmentId)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                            title="Remove Segment"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: CONSOLIDATED VARIANCE VIEW */}
        {activeView === 'VARIANCE' && (
          <ConsolidatedVarianceView
            session={session}
            currentUser={currentUser}
            onRequestSkuRecount={handleRequestSkuRecount}
            onSubmitSkuRecount={handleSubmitSkuRecount}
            onConsolidateAgain={handleConsolidate}
            onOpenBlindRecountSheet={() => setShowBlindRecountModal(true)}
            onBatchRequestRecount={handleBatchRequestRecount}
          />
        )}

        {/* TAB 3: CUSTOMER GOODS LEFT BEHIND */}
        {activeView === 'GOODS_LEFT_BEHIND' && (
          <CustomerGoodsLeftBehindTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 4: TEMPORARY CASUAL WORKER ACCOUNTS & PINS */}
        {activeView === 'CASUALS' && (
          <CasualWorkersTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 5: FAST-MOVING AIRTIME CHECKLIST */}
        {activeView === 'FAST_MOVERS' && (
          <FastMovingChecklistTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 6: LOCKDOWN & EMERGENCY SALES */}
        {activeView === 'LOCKDOWN' && (
          <LockdownEmergencySalesTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 7: P2P MESH & SYNC OPTIMIZER */}
        {activeView === 'P2P_SYNC' && (
          <P2PMeshSyncTab session={session} />
        )}

        {/* TAB 8: POST-COMMIT MANAGER VARIANCE COMMENTARY */}
        {activeView === 'VARIANCE_COMMENTS' && isApproved && allowedTabs.includes('VARIANCE_COMMENTS') && (
          <VarianceCommentaryTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 9: AUDIT COMMITTAL CERTIFICATE */}
        {activeView === 'AUDIT_CERT' && allowedTabs.includes('AUDIT_CERT') && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-4xl mx-auto shadow-2xl space-y-6 print:bg-white print:text-black print:border-none print:shadow-none">
            {/* Header */}
            <div className="border-b border-slate-800 pb-5 flex items-center justify-between">
              <div>
                <span className="text-xs uppercase font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2.5 py-1 rounded-full font-bold">
                  Official Audit Certificate
                </span>
                <h2 className="text-xl font-bold text-white mt-2">
                  Stocktake & Physical Verification Certificate
                </h2>
                <p className="text-xs text-slate-400">
                  {session.branchName} • {session.title}
                </p>
              </div>

              <button
                onClick={handlePrintCertificate}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition"
              >
                <Printer className="w-4 h-4" />
                Print Certificate
              </button>
            </div>

            {/* Audit Details Box */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <div>
                <div className="text-slate-400 font-medium">Session ID</div>
                <div className="font-mono font-bold text-white mt-0.5">{session.sessionId}</div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Audit Date</div>
                <div className="font-bold text-white mt-0.5">{session.date}</div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Count Scope</div>
                <div className="font-bold text-blue-400 mt-0.5">{session.countType}</div>
              </div>
              <div>
                <div className="text-slate-400 font-medium">Approved By (Owner/Auditor)</div>
                <div className="font-bold text-emerald-400 mt-0.5">{session.approvedByName || 'Authorized Auditor'}</div>
              </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">Total System Units Before</div>
                <div className="text-lg font-bold font-mono text-slate-200 mt-1">
                  {session.totalSystemUnits} units
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">Verified Physical Count</div>
                <div className="text-lg font-bold font-mono text-emerald-400 mt-1">
                  {session.totalCountedUnits} units
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">Net Variance Committed</div>
                <div
                  className={`text-lg font-bold font-mono mt-1 ${
                    session.varianceUnits === 0
                      ? 'text-slate-200'
                      : session.varianceUnits < 0
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {session.varianceUnits >= 0 ? `+${session.varianceUnits}` : session.varianceUnits} units ($
                  {session.varianceCostValue.toFixed(2)})
                </div>
              </div>
            </div>

            {/* Notes */}
            {session.notes && (
              <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 text-xs">
                <strong className="text-slate-300 block mb-1">Session Remarks & Audit Notes:</strong>
                <p className="text-slate-400 whitespace-pre-line">{session.notes}</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add Segment Modal */}
      {showAddSegmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Add Shop Floor Segment</h3>
              <button
                onClick={() => setShowAddSegmentModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSegment} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Segment Name *
                </label>
                <input
                  type="text"
                  required
                  value={newSegmentName}
                  onChange={(e) => setNewSegmentName(e.target.value)}
                  placeholder="e.g., Aisle 4 - Chilled Dairy & Milks"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Location Code / Shelf Tag
                </label>
                <input
                  type="text"
                  value={newSegmentLocation}
                  onChange={(e) => setNewSegmentLocation(e.target.value)}
                  placeholder="e.g., LOC-DAIRY-01"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Description / Bounds
                </label>
                <input
                  type="text"
                  value={newSegmentDesc}
                  onChange={(e) => setNewSegmentDesc(e.target.value)}
                  placeholder="e.g., Top 3 shelves in the dairy cooler room"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddSegmentModal(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold"
                >
                  Create Segment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Discrepancy Recount Modal */}
      {activeRecountSegment && (
        <SegmentRecountModal
          session={session}
          segment={activeRecountSegment}
          currentUser={currentUser}
          onResolveRecount={handleResolveRecount}
          onClose={() => setActiveRecountSegment(null)}
        />
      )}

      {/* Admin Committal / Auditor Certification Modal */}
      {showApprovalModal && (
        <StocktakeApprovalModal
          session={session}
          currentUser={currentUser}
          onApprove={handleApprove}
          onCertifyReady={handleCertifyReady}
          onClose={() => setShowApprovalModal(false)}
        />
      )}

      {/* Peer Dual-Signature Joint Recount Modal */}
      {showJointRecountModalSegment && (
        <JointRecountModal
          session={session}
          segment={showJointRecountModalSegment}
          currentUser={currentUser}
          onClose={() => setShowJointRecountModalSegment(null)}
          onResolved={() => {
            const updated = getStocktakeSessionById(session.sessionId);
            if (updated) refreshSession(updated);
            setShowJointRecountModalSegment(null);
            showToast('Joint Recount finalized & marked VERIFIED!');
          }}
        />
      )}

      {/* Blind Recount Sheet Modal (Zero SOH Leakage) */}
      {showBlindRecountModal && (
        <BlindRecountSheetModal
          session={displaySession}
          currentUser={currentUser}
          onClose={() => setShowBlindRecountModal(false)}
          onSubmitted={(updated) => {
            refreshSession(updated);
            setShowBlindRecountModal(false);
            showToast('Blind Recount Sheet submitted & audit variances recalculated.');
          }}
        />
      )}

      {/* Persistent Branch Floor Segments Modal */}
      {showBranchSegmentsModal && (
        <BranchSegmentsModal
          branchId={session.branchId}
          branchName={session.branchName || session.branchId}
          currentUser={currentUser}
          onClose={() => setShowBranchSegmentsModal(false)}
          onSaved={(savedSegs) => {
            showToast(`Branch floor map updated (${savedSegs.length} segments) and synced.`);
          }}
        />
      )}

      {/* Auditor / Leader Unlock Finalized Count Modal */}
      {unlockModalState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-amber-600/60 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-300 font-bold text-base">
                <Unlock className="w-5 h-5 text-amber-400" />
                Unlock Finalized Segment Count
              </div>
              <button
                type="button"
                onClick={() => setUnlockModalState(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmUnlockSegment} className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300">
                Segment: <strong className="text-white">{unlockModalState.segment.name}</strong> ({unlockModalState.segment.locationCode || unlockModalState.segment.segmentId})
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Unlock Scope</label>
                <select
                  value={unlockModalState.target}
                  onChange={(e) =>
                    setUnlockModalState((prev) =>
                      prev ? { ...prev, target: e.target.value as 'A' | 'B' | 'COMPARISON' | 'ALL' } : null
                    )
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                >
                  <option value="A">Team A Finalized Count Only</option>
                  <option value="B">Team B Finalized Count Only</option>
                  <option value="COMPARISON">Joint Variance Comparison Only</option>
                  <option value="ALL">Entire Segment (Team A, Team B &amp; Comparison)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Mandatory Audit Reason *
                </label>
                <textarea
                  rows={3}
                  required
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder="e.g. Counter mistakenly finalized Team A before counting top-shelf cartons."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUnlockModalState(null)}
                  className="px-3.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center gap-1.5"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  Confirm Unlock &amp; Sync
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
