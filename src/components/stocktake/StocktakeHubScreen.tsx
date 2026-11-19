import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Layers,
  Plus,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  Calendar,
  Building,
  ArrowRight,
  Boxes,
  Package,
  FileSpreadsheet,
  Trash2,
  Clock,
  UserCheck,
  Zap,
  Lock,
  Eye,
  Shield,
  Smartphone,
  Phone,
  KeyRound,
  MessageSquare,
  MapPin,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { StocktakeSession, StocktakeCountType, Salesperson, TemporaryCasualAccount } from '../../types';
import {
  getStocktakeSessions,
  createStocktakeSession,
  saveStocktakeSession,
  deleteStocktakeSession,
  getBranchLockdowns,
  authenticateCasualWorker,
  getSalespeople,
  getBranches,
  getCurrentBranchId,
  getBranchFloorSegments,
  addStocktakeGuestPass,
  addTemporaryCasual,
  getTemporaryCasuals,
  isStaffAssignedToBranch,
} from '../../db/roomDatabase';
import {
  isStocktakeLeader,
  isStocktakeAuditor,
  canUserCreateStocktakeSession,
  getAllowedCreateCountTypes,
  getActiveLockdownSession,
  getPostCommitPendingVarianceSessions,
  getActiveCasualsForBranch,
  getActiveBranchStocktakeSessions,
  hasActiveBranchStocktakeSession,
  isActiveStocktakeStatus,
} from '../../services/stocktakeAccessService';
import { meshSyncService } from '../../services/meshSyncService';
import { StocktakeSessionDetailScreen, DetailTab } from './StocktakeSessionDetailScreen';
import { BranchSegmentsModal } from './BranchSegmentsModal';

interface StocktakeHubScreenProps {
  currentUser: Salesperson | null;
  onGoToMaster?: () => void;
  onGoToHome?: () => void;
}

export const StocktakeHubScreen: React.FC<StocktakeHubScreenProps> = ({ currentUser }) => {
  const activeBranchId = currentUser?.branchId || currentUser?.branch_id || getCurrentBranchId();
  const branchRecord = useMemo(
    () =>
      getBranches().find(
        (b) =>
          String(b.branchId || b.id || '').trim().toUpperCase() ===
          String(activeBranchId || '').trim().toUpperCase()
      ),
    [activeBranchId]
  );

  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<StocktakeSession | null>(null);
  const [selectedInitialView, setSelectedInitialView] = useState<'HOME' | DetailTab>('HOME');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [countTypeFilter, setCountTypeFilter] = useState<string>('ALL');
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [hubNotice, setHubNotice] = useState<string | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [showBranchSegmentsModal, setShowBranchSegmentsModal] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  // New Session Modal
  const allowedCreateTypes = useMemo(() => getAllowedCreateCountTypes(currentUser), [currentUser]);
  const canCreateSession = canUserCreateStocktakeSession(currentUser);
  const allBranches = useMemo(() => getBranches(), []);
  const allActiveStaff = useMemo(
    () => getSalespeople().filter((s) => s.active !== 'N'),
    []
  );
  const branchStaffAuditors = useMemo(
    () => allActiveStaff.filter((s) => isStaffAssignedToBranch(s, activeBranchId)),
    [allActiveStaff, activeBranchId]
  );

  const [showNewModal, setShowNewModal] = useState(false);
  const [title, setTitle] = useState('');
  const [countType, setCountType] = useState<StocktakeCountType>(allowedCreateTypes[0] || 'DAILY_BLIND');
  const [branchName, setBranchName] = useState(
    currentUser?.branchName || branchRecord?.name || 'Main Central Distribution & Warehouse'
  );
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  // 3-Way Auditor Configuration
  const [auditorType, setAuditorType] = useState<'BRANCH_STAFF' | 'VISITING_STAFF' | 'EXTERNAL_CONSULTANT'>('BRANCH_STAFF');
  const [visitingAuditorBranchId, setVisitingAuditorBranchId] = useState<string>(() => {
    const other = allBranches.find(
      (b) => String(b.branchId || b.id || '').toUpperCase() !== String(activeBranchId || '').toUpperCase()
    );
    return other?.branchId || other?.id || '';
  });
  const [stocktakeAuditorId, setStocktakeAuditorId] = useState<string>('');
  const [stocktakeAuditorName, setStocktakeAuditorName] = useState('');
  const [stocktakeAuditorPhone, setStocktakeAuditorPhone] = useState('');
  const [consultantName, setConsultantName] = useState('');
  const [consultantPhone, setConsultantPhone] = useState('');
  const [consultantPin, setConsultantPin] = useState('');

  // Governance & Variance Review Settings
  const [varianceThresholdUsd, setVarianceThresholdUsd] = useState<number>(10);
  const [varianceMinUnits, setVarianceMinUnits] = useState<number>(5);
  const [varianceWindowHours, setVarianceWindowHours] = useState<number>(72);

  const [isLockdownActive, setIsLockdownActive] = useState(false);
  const [notes, setNotes] = useState('');
  const [customSegments, setCustomSegments] = useState<string>(() => {
    const floor = getBranchFloorSegments(activeBranchId);
    return floor.segments.map((s) => s.name).join('\n');
  });
  const [modalError, setModalError] = useState<string | null>(null);

  const visitingStaffCandidates = useMemo(() => {
    const targetBranch = String(visitingAuditorBranchId || '').trim().toUpperCase();
    return allActiveStaff.filter((s) => {
      const sBranch = String(s.branchId || s.branch_id || '').trim().toUpperCase();
      if (targetBranch) return sBranch === targetBranch;
      return sBranch && sBranch !== String(activeBranchId || '').trim().toUpperCase();
    });
  }, [allActiveStaff, visitingAuditorBranchId, activeBranchId]);

  const hasAutoOpenedRef = useRef(false);

  const loadSessions = () => {
    const list = getStocktakeSessions();
    setSessions(list);
  };

  useEffect(() => {
    loadSessions();
    // Always request fresh stocktake sessions, tombstones, and lockdowns from Hub on view mount
    meshSyncService.requestStocktakeSessionList();
    const handleUpdate = () => {
      loadSessions();
      setSelectedSession((prev) => {
        if (!prev) return null;
        return getStocktakeSessions().find((s) => s.sessionId === prev.sessionId) || null;
      });
    };
    const handleRejected = (evt: Event) => {
      const detail = (evt as CustomEvent)?.detail;
      if (detail?.type === 'STOCKTAKE_SESSION_CONFLICT') {
        const winName = detail?.existingSessionName || detail?.existingSessionId || 'active branch session';
        const msg = detail?.hadOfflineCounts
          ? `Branch already has active stocktake "${winName}". Your offline session was preserved read-only under Closed Archive so no counts were lost.`
          : `Branch already has active stocktake "${winName}". Switched to the active session and archived the duplicate.`;
        setHubError(msg);
      } else {
        const reason = detail?.reason || detail?.message || 'Action rejected by Hub stocktake governance.';
        setHubError(reason);
      }
      loadSessions();
    };
    window.addEventListener('saimetric_stocktake_updated', handleUpdate);
    window.addEventListener('saimetric_stocktake_zone_updated', handleUpdate);
    window.addEventListener('saimetric_stocktake_lockdown_updated', handleUpdate);
    window.addEventListener('saimetric_stocktake_rejected', handleRejected);
    return () => {
      window.removeEventListener('saimetric_stocktake_updated', handleUpdate);
      window.removeEventListener('saimetric_stocktake_zone_updated', handleUpdate);
      window.removeEventListener('saimetric_stocktake_lockdown_updated', handleUpdate);
      window.removeEventListener('saimetric_stocktake_rejected', handleRejected);
    };
  }, []);

  // Auto-open active lockdown or restricted casual/visiting session cleanly
  useEffect(() => {
    if (selectedSession || sessions.length === 0) return;
    if (currentUser?.restrictedToSessionId) {
      const target = sessions.find((s) => s.sessionId === currentUser.restrictedToSessionId);
      if (target) {
        setSelectedInitialView('HOME');
        setSelectedSession(target);
        return;
      }
    }
    if (!hasAutoOpenedRef.current) {
      const lockdownSess = getActiveLockdownSession(activeBranchId);
      if (lockdownSess) {
        hasAutoOpenedRef.current = true;
        setSelectedInitialView('HOME');
        setSelectedSession(lockdownSess);
      }
    }
  }, [sessions, selectedSession, currentUser?.restrictedToSessionId, activeBranchId]);

  const openSessionDetail = (sess: StocktakeSession, initialView: 'HOME' | DetailTab = 'HOME') => {
    setSelectedInitialView(initialView);
    setSelectedSession(sess);
  };

  const handleSelectCountType = (type: StocktakeCountType) => {
    setCountType(type);
    setModalError(null);
    if (type === 'DAILY_BLIND') {
      setIsLockdownActive(false);
      setCustomSegments(
        'Front Till 01 - Airtime & Small Items\nGas Refill Bay - Cylinders\nBakery Shelves - Bread Loaves'
      );
      if (!title || title.includes('Stocktake Audit') || title.includes('Supervisor') || title.includes('Weekly') || title.includes('Month-End') || title.includes('Daily Blind')) {
        setTitle(`Daily Blind Count (Fast Movers) - ${date}`);
      }
    } else if (type === 'SPOT_CHECK') {
      setIsLockdownActive(false);
      setCustomSegments('Supervisor Spot-Check Verification Bay');
      if (!title || title.includes('Stocktake Audit') || title.includes('Daily Blind') || title.includes('Weekly') || title.includes('Month-End') || title.includes('Supervisor')) {
        setTitle(`Supervisor Spot Check - ${date}`);
      }
    } else if (type === 'WEEKLY_STRATEGIC') {
      setIsLockdownActive(false);
      const floor = getBranchFloorSegments(activeBranchId);
      setCustomSegments(floor.segments.map((s) => s.name).join('\n'));
      if (!title || title.includes('Stocktake Audit') || title.includes('Daily Blind') || title.includes('Supervisor') || title.includes('Month-End') || title.includes('Weekly')) {
        setTitle(`Weekly Strategic Double Count - ${date}`);
      }
    } else if (type === 'FULL_LOCKDOWN') {
      setIsLockdownActive(true);
      const floor = getBranchFloorSegments(activeBranchId);
      setCustomSegments(floor.segments.map((s) => s.name).join('\n'));
      if (!title || title.includes('Stocktake Audit') || title.includes('Daily Blind') || title.includes('Supervisor') || title.includes('Weekly') || title.includes('Month-End')) {
        setTitle(`Month-End Storewide Lockdown Stocktake - ${date}`);
      }
    }
  };

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateSession) return;
    setModalError(null);
    setHubError(null);

    if (auditorType === 'EXTERNAL_CONSULTANT') {
      if (!consultantName.trim()) {
        setModalError('Enter the external consultant auditor name.');
        return;
      }
      if (!/^\d{4,6}$/.test(consultantPin.trim())) {
        setModalError('External consultant PIN must be 4 to 6 numeric digits.');
        return;
      }
    }

    const segmentNames = customSegments
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Store Supervisor';
    const pickedAuditor =
      auditorType === 'BRANCH_STAFF'
        ? (branchStaffAuditors.find((a) => a.id === stocktakeAuditorId) || allActiveStaff.find((a) => a.id === stocktakeAuditorId))
        : auditorType === 'VISITING_STAFF'
        ? visitingStaffCandidates.find((a) => a.id === stocktakeAuditorId)
        : undefined;

    const resolvedAuditorId =
      auditorType === 'EXTERNAL_CONSULTANT'
        ? undefined
        : pickedAuditor?.id || (stocktakeAuditorName.trim() ? currentUser?.id : undefined);
    const resolvedAuditorName =
      auditorType === 'EXTERNAL_CONSULTANT'
        ? consultantName.trim()
        : pickedAuditor?.name || stocktakeAuditorName.trim() || undefined;
    const resolvedAuditorPhone =
      auditorType === 'EXTERNAL_CONSULTANT'
        ? consultantPhone.trim() || undefined
        : pickedAuditor?.phone || stocktakeAuditorPhone.trim() || undefined;

    try {
      let newSession = createStocktakeSession({
        title: title.trim() || `${countType.replace('_', ' ')} Audit - ${date}`,
        date,
        countType,
        branchId: activeBranchId,
        branchName,
        isLockdownActive,
        stocktakeAuditorId: resolvedAuditorId,
        stocktakeAuditorName: resolvedAuditorName,
        stocktakeAuditorPhone: resolvedAuditorPhone,
        auditorType,
        varianceMaterialityThreshold: Math.max(0, Number(varianceThresholdUsd) || 10),
        varianceMinUnitThreshold: Math.max(1, Number(varianceMinUnits) || 5),
        varianceReviewWindowHours: Math.max(1, Number(varianceWindowHours) || 72),
        notes,
        segmentNames,
        staffId,
        staffName,
      });

      // Provision Visiting Auditor Guest Pass if applicable
      if (auditorType === 'VISITING_STAFF' && pickedAuditor) {
        const homeBranchObj = allBranches.find(
          (b) =>
            String(b.branchId || b.id || '').toUpperCase() ===
            String(pickedAuditor.branchId || pickedAuditor.branch_id || visitingAuditorBranchId || '').toUpperCase()
        );
        const passRes = addStocktakeGuestPass(newSession.sessionId, {
          staffId: pickedAuditor.id,
          staffName: pickedAuditor.name,
          staffRole: pickedAuditor.role,
          passRole: 'AUDITOR',
          homeBranchId: pickedAuditor.branchId || pickedAuditor.branch_id || visitingAuditorBranchId || activeBranchId,
          homeBranchName: homeBranchObj?.name || pickedAuditor.branchName,
          grantedById: staffId,
          grantedByName: staffName,
        });
        if (passRes.session) {
          newSession = saveStocktakeSession({
            ...passRes.session,
            auditorGuestPassId: passRes.pass?.id,
          });
        }
      }

      // Provision Temporary External Consultant Auditor Account if applicable
      if (auditorType === 'EXTERNAL_CONSULTANT' && consultantName.trim()) {
        const createdConsultant = addTemporaryCasual({
          sessionId: newSession.sessionId,
          branchId: activeBranchId,
          name: consultantName.trim(),
          phone: consultantPhone.trim() || undefined,
          pin: consultantPin.trim(),
          tempRole: 'AUDITOR',
          isExternalConsultant: true,
        } as any);
        newSession = saveStocktakeSession({
          ...newSession,
          stocktakeAuditorId: createdConsultant.id,
          auditorCasualId: createdConsultant.id,
          stocktakeAuditorName: createdConsultant.name,
          stocktakeAuditorPhone: createdConsultant.phone,
        });
        meshSyncService.broadcastCasualWorkers(getTemporaryCasuals());
      }

      // Broadcast both STOCKTAKE_SESSION_STARTED and canonical SyncCore session envelope
      meshSyncService.broadcastStocktakeSessionStarted({
        sessionId: newSession.sessionId,
        sessionName: newSession.title,
        segments: newSession.segments,
        startedBy: staffName,
        startedAt: newSession.timestamp,
        countType: newSession.countType,
        branchId: newSession.branchId,
        branchName: newSession.branchName,
        isLockdownActive: newSession.isLockdownActive,
        notes: newSession.notes,
      });
      meshSyncService.broadcastStocktakeSession(newSession);
      if (newSession.isLockdownActive) {
        meshSyncService.broadcastStocktakeLockdown(
          newSession.branchId,
          newSession.sessionId,
          true,
          staffName,
          `Lockdown initiated for ${newSession.title}`,
          staffId
        );
      }

      loadSessions();
      setShowNewModal(false);
      setTitle('');
      setNotes('');
      setConsultantName('');
      setConsultantPhone('');
      setConsultantPin('');
      openSessionDetail(newSession, 'HOME');
    } catch (err: any) {
      const msg = err?.message || 'Cannot start stocktake session.';
      setModalError(msg);
      setHubError(msg);
    }
  };

  const handleConfirmDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const cleanId = String(sessionId || '').trim().toUpperCase();
    const targetSess = sessions.find(
      (s) => String(s.sessionId || '').trim().toUpperCase() === cleanId
    );
    const targetBrId = targetSess?.branchId || activeBranchId;
    const currentLock = getBranchLockdowns()[targetBrId];
    const ownsActiveLock = Boolean(
      currentLock &&
        currentLock.isLocked &&
        String(currentLock.sessionId || '').trim().toUpperCase() === cleanId
    );

    deleteStocktakeSession(sessionId);

    // Broadcast lockdown release ONLY if the deleted session owned the active branch lock
    if (ownsActiveLock) {
      meshSyncService.broadcastStocktakeLockdown(
        targetBrId,
        sessionId,
        false,
        currentUser?.name || 'Supervisor',
        `Stocktake ${sessionId} deleted — branch lockdown released.`,
        currentUser?.id
      );
    }

    setPendingDeleteSessionId(null);
    loadSessions();
    if (selectedSession?.sessionId === sessionId) {
      setSelectedSession(null);
    }
    setHubNotice(`Deleted stocktake session ${sessionId}.`);
    setTimeout(() => setHubNotice(null), 4000);
  };

  // Single-active-session governance for this branch
  const activeBranchSessions = useMemo(() => {
    const list = getActiveBranchStocktakeSessions(activeBranchId);
    if (currentUser?.restrictedToSessionId) {
      return list.filter((s) => s.sessionId === currentUser.restrictedToSessionId);
    }
    return list;
  }, [activeBranchId, sessions, currentUser?.restrictedToSessionId]);

  const hasActiveSession = useMemo(
    () => hasActiveBranchStocktakeSession(activeBranchId),
    [activeBranchId, sessions]
  );

  // Closed archive sessions (APPROVED_POSTED / CANCELLED)
  const q = (searchQuery || '').trim().toLowerCase();
  const closedSessions = sessions.filter((s) => {
    if (isActiveStocktakeStatus(s.status)) return false;
    if (currentUser?.restrictedToSessionId && s.sessionId !== currentUser.restrictedToSessionId) {
      return false;
    }

    const matchesSearch =
      q === '' ||
      (s.title && s.title.toLowerCase().includes(q)) ||
      (s.sessionId && s.sessionId.toLowerCase().includes(q)) ||
      (s.branchName && s.branchName.toLowerCase().includes(q));

    let matchesStatus = true;
    if (statusFilter === 'APPROVED') {
      matchesStatus = s.status === 'APPROVED_POSTED';
    } else if (statusFilter === 'CANCELLED') {
      matchesStatus = s.status === 'CANCELLED';
    }

    let matchesType = true;
    if (countTypeFilter !== 'ALL') {
      matchesType = s.countType === countTypeFilter;
    }

    return matchesSearch && matchesStatus && matchesType;
  });

  // Casual Login State
  const [showCasualPinModal, setShowCasualPinModal] = useState(false);
  const [selectedCasualId, setSelectedCasualId] = useState<string>('');
  const [casualPinInput, setCasualPinInput] = useState('');
  const [casualAuthError, setCasualAuthError] = useState<string | null>(null);
  const [activeCasual, setActiveCasual] = useState<TemporaryCasualAccount | null>(null);

  const branchActiveCasuals = useMemo(
    () => getActiveCasualsForBranch(activeBranchId),
    [activeBranchId, showCasualPinModal, sessions]
  );

  const effectiveUser: Salesperson | null = activeCasual
    ? ({
        id: activeCasual.id,
        name: `${activeCasual.name} (${activeCasual.tempRole === 'AUDITOR' ? 'External Auditor' : activeCasual.assignedGroup === 'GROUP_1' ? 'Team A' : 'Team B'})`,
        role: (activeCasual.tempRole === 'AUDITOR' ? 'STOCKTAKE_AUDITOR' : 'CASHIER') as any,
        tempRole: activeCasual.tempRole,
        isExternalConsultant: activeCasual.isExternalConsultant,
        pin_hash: activeCasual.pin_hash,
        pin_salt: activeCasual.pin_salt,
        phone: activeCasual.phone,
        branchId: activeCasual.branchId || activeBranchId,
        branch_id: activeCasual.branchId || activeBranchId,
        isCasual: true,
        restrictedToSessionId: activeCasual.sessionId,
        assignedGroup: activeCasual.assignedGroup,
        assignedSegmentId: activeCasual.assignedSegmentId,
        badgeNumber: activeCasual.badgeNumber,
        active: 'Y',
      } as Salesperson)
    : currentUser;

  const handleCasualPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCasualAuthError(null);
    const pin = casualPinInput.trim();
    if (!pin) return;

    const account = authenticateCasualWorker(pin, selectedCasualId || undefined);
    if (!account) {
      setCasualAuthError('Invalid PIN. Select your profile card and verify PIN with the Stocktake Auditor.');
      return;
    }

    setActiveCasual(account);
    setShowCasualPinModal(false);
    setCasualPinInput('');
    setSelectedCasualId('');

    // Open target session
    const target =
      sessions.find((s) => s.sessionId === account.sessionId) ||
      sessions.find((s) => s.status !== 'APPROVED_POSTED') ||
      sessions[0];

    if (target) {
      setSelectedSession(target);
    } else {
      setHubNotice(`Authenticated as ${account.name}. Waiting for Auditor to initialize an active stocktake session.`);
      setTimeout(() => setHubNotice(null), 5000);
    }
  };

  const pendingVarianceSessions = useMemo(
    () =>
      effectiveUser?.isCasual || effectiveUser?.isVisitingCounter
        ? []
        : getPostCommitPendingVarianceSessions(activeBranchId),
    [activeBranchId, sessions, effectiveUser]
  );

  // KPI Metrics
  const totalAudits = sessions.length;
  const dailyCountsCount = sessions.filter((s) => s.countType === 'DAILY_BLIND').length;
  const spotChecksCount = sessions.filter((s) => s.countType === 'SPOT_CHECK').length;
  const lockdownCount = sessions.filter((s) => s.countType === 'FULL_LOCKDOWN').length;

  if (selectedSession) {
    return (
      <StocktakeSessionDetailScreen
        session={selectedSession}
        currentUser={effectiveUser}
        initialView={selectedInitialView}
        onBack={() => {
          setSelectedSession(null);
          setSelectedInitialView('HOME');
          loadSessions();
        }}
        onUpdateSession={(updated) => {
          setSelectedSession(updated);
          loadSessions();
        }}
      />
    );
  }

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen p-6 space-y-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                Stocktake & Verification Master
              </h1>
              <p className="text-xs text-slate-400">
                Daily blind counts, supervisor spot checks, weekly double counts & storewide lockdown audits
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!effectiveUser?.isCasual && !effectiveUser?.isVisitingCounter && (
            <button
              onClick={() => {
                setCasualPinInput('');
                setCasualAuthError(null);
                setSelectedCasualId(branchActiveCasuals[0]?.id || '');
                setShowCasualPinModal(true);
              }}
              className="px-4 py-2.5 bg-amber-600/90 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition"
            >
              <KeyRound className="w-4 h-4" />
              Casual PIN Fast-Login
            </button>
          )}

          {(canCreateSession || isStocktakeLeader(effectiveUser) || isStocktakeAuditor(effectiveUser)) &&
            !effectiveUser?.isCasual &&
            !effectiveUser?.isVisitingCounter && (
              <button
                type="button"
                onClick={() => setShowBranchSegmentsModal(true)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-2 transition"
              >
                <MapPin className="w-4 h-4 text-emerald-400" />
                Configure Floor Map
              </button>
            )}

          {canCreateSession && !hasActiveSession && (
            <button
              onClick={() => {
                handleSelectCountType(allowedCreateTypes[0] || 'DAILY_BLIND');
                setShowNewModal(true);
              }}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 flex items-center gap-2 transition"
            >
              <Plus className="w-4 h-4" />
              Initialize New Stocktake Session
            </button>
          )}

          {hasActiveSession && activeBranchSessions.length > 0 && (
            <button
              type="button"
              onClick={() => openSessionDetail(activeBranchSessions[0], 'HOME')}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-2 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              1 Active Session Open • Enter Command Home
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {hubNotice && (
        <div className="max-w-7xl mx-auto bg-blue-950/80 border border-blue-700 text-blue-100 rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-between">
          <span>{hubNotice}</span>
          <button type="button" onClick={() => setHubNotice(null)} className="text-blue-300 hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {hubError && (
        <div className="max-w-7xl mx-auto bg-rose-950/80 border border-rose-700 text-rose-100 rounded-xl px-4 py-2.5 text-xs font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            {hubError}
          </span>
          <button type="button" onClick={() => setHubError(null)} className="text-rose-300 hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {/* SECTION 1: ACTIVE BRANCH SESSION HERO */}
      <section className="max-w-7xl mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            Active Branch Floor Stocktake (Max 1 Active Session Rule)
          </h2>
          {hasActiveSession && (
            <span className="text-[11px] font-semibold text-amber-300 bg-amber-950/50 border border-amber-800/60 px-2.5 py-0.5 rounded-full">
              Single Active Session Rule Enforced
            </span>
          )}
        </div>

        {activeBranchSessions.length > 0 ? (
          activeBranchSessions.map((s) => {
            const segs = Array.isArray(s.segments) ? s.segments : [];
            const verifiedSegs = segs.filter((seg) => seg.status === 'VERIFIED').length;
            const totalSegs = segs.length;
            const hasRecounts = segs.some((seg) => seg.status === 'DISCREPANCY_RECOUNT');

            return (
              <div
                key={s.sessionId}
                onClick={() => openSessionDetail(s, 'HOME')}
                className="bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950/30 border border-blue-500/40 hover:border-blue-400 rounded-2xl p-6 cursor-pointer transition shadow-2xl space-y-4 group"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                        {s.sessionId}
                      </span>
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                        {String(s.countType || 'FULL_LOCKDOWN').replace(/_/g, ' ')}
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                          s.status === 'READY_FOR_COMMITTAL'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                            : s.status === 'RECOUNTING' || hasRecounts
                            ? 'bg-amber-950 text-amber-300 border-amber-700 animate-pulse'
                            : 'bg-slate-800 text-slate-200 border-slate-700'
                        }`}
                      >
                        {String(s.status || 'COUNTING').replace(/_/g, ' ')}
                      </span>
                      {s.isLockdownActive && (
                        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-700 flex items-center gap-1">
                          <Lock className="w-3 h-3" /> BRANCH LOCKDOWN ACTIVE
                        </span>
                      )}
                    </div>
                    <h3 className="text-xl font-bold text-white group-hover:text-blue-300 transition">
                      {s.title}
                    </h3>
                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" /> {s.date}
                      </span>
                      <span>•</span>
                      <span>{s.branchName}</span>
                      {s.stocktakeAuditorName && (
                        <>
                          <span>•</span>
                          <span className="text-amber-300 flex items-center gap-1">
                            <Shield className="w-3.5 h-3.5 text-amber-400" />
                            Auditor: <strong>{s.stocktakeAuditorName}</strong>
                            {s.auditorType === 'EXTERNAL_CONSULTANT' && ' (External)'}
                            {s.auditorType === 'VISITING_STAFF' && ' (Visiting Pass)'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {(isStocktakeLeader(effectiveUser) || isStocktakeAuditor(effectiveUser, s)) &&
                      (pendingDeleteSessionId === s.sessionId ? (
                        <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(e) => handleConfirmDeleteSession(e, s.sessionId)}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold"
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteSessionId(null);
                            }}
                            className="px-2.5 py-1 bg-slate-800 text-slate-300 rounded-lg text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteSessionId(s.sessionId);
                          }}
                          className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition"
                          title="Cancel / Delete Draft Session"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ))}
                    <span className="px-4 py-2.5 rounded-xl bg-blue-600 group-hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg">
                      Open Command Home <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-400 font-medium">Shop Floor Verification Progress</span>
                    <span className="font-mono font-bold text-white">
                      {verifiedSegs}/{totalSegs} Segments Verified
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        verifiedSegs === totalSegs && totalSegs > 0 ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${totalSegs > 0 ? (verifiedSegs / totalSegs) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {segs.map((seg, segIdx) => (
                      <span
                        key={`${seg.segmentId}-${segIdx}`}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono border ${
                          seg.status === 'VERIFIED'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : seg.status === 'DISCREPANCY_RECOUNT'
                            ? 'bg-amber-950 text-amber-300 border-amber-800'
                            : 'bg-slate-900 text-slate-300 border-slate-800'
                        }`}
                      >
                        {seg.locationCode || seg.segmentId} • {seg.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-12 text-center bg-slate-900/60 rounded-2xl border border-slate-800 px-6">
            <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3 opacity-60" />
            <h3 className="text-base font-bold text-slate-200">No Active Stocktake Running on Branch Floor</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xl mx-auto">
              {canCreateSession
                ? 'Configure your branch floor segments ahead of time, then initialize a single active stocktake session for your team.'
                : 'No active stocktake session is currently running for your branch. Wait for the Auditor or Manager to start one.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {(canCreateSession || isStocktakeLeader(effectiveUser) || isStocktakeAuditor(effectiveUser)) &&
                !effectiveUser?.isCasual &&
                !effectiveUser?.isVisitingCounter && (
                  <button
                    type="button"
                    onClick={() => setShowBranchSegmentsModal(true)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold inline-flex items-center gap-2 transition"
                  >
                    <MapPin className="w-4 h-4 text-emerald-400" />
                    Configure Branch Floor Map
                  </button>
                )}
              {canCreateSession && !hasActiveSession && (
                <button
                  onClick={() => {
                    handleSelectCountType(allowedCreateTypes[0] || 'DAILY_BLIND');
                    setShowNewModal(true);
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-2 shadow-lg shadow-blue-900/30"
                >
                  <Plus className="w-4 h-4" />
                  Initialize New Stocktake Session
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: POST-COMMIT VARIANCE REVIEWS DUE */}
      {pendingVarianceSessions.length > 0 && (
        <section className="max-w-7xl mx-auto space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
            Post-Commit Variance Reviews Due ({pendingVarianceSessions.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingVarianceSessions.map((ps) => {
              const dueAt = ps.varianceReviewDueAt ? new Date(ps.varianceReviewDueAt).toLocaleString() : 'Within 72h window';
              return (
                <div
                  key={ps.sessionId}
                  className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/40 border border-amber-600/60 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-bold text-amber-300">{ps.sessionId}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-900/70 text-amber-200 border border-amber-700/70">
                          {ps.varianceReviewStatus === 'COMMENTS_SUBMITTED' ? 'Awaiting Owner Closure' : 'Comments Required'}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white mt-0.5">{ps.title}</h3>
                      <p className="text-[11px] text-amber-200/80 mt-0.5">
                        Threshold: ≥${ps.varianceMaterialityThreshold ?? 10} or ≥{ps.varianceMinUnitThreshold ?? 5} units • Due: {dueAt}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openSessionDetail(ps, 'VARIANCE_COMMENTS')}
                    className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow flex items-center gap-1.5 shrink-0"
                  >
                    <span>Open Variance Commentary</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SECTION 3: COLLAPSIBLE CLOSED AUDIT ARCHIVE */}
      <section className="max-w-7xl mx-auto bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setArchiveExpanded((prev) => !prev)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-900/80 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Closed Stocktake Audit Archive
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {closedSessions.length}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Historical committed stocktakes, KPI summary & committal certificates
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <span>{archiveExpanded ? 'Hide Archive' : 'Expand Archive'}</span>
            {archiveExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {archiveExpanded && (
          <div className="p-5 pt-2 border-t border-slate-800/80 space-y-5">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
                <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-400" /> Total Audits Conducted
                </div>
                <div className="text-2xl font-bold font-mono text-white mt-1">{totalAudits}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Historical and active</div>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
                <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Daily Fast-Mover Counts
                </div>
                <div className="text-2xl font-bold font-mono text-amber-400 mt-1">{dailyCountsCount}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Airtime, bread & gas blind checks</div>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
                <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-emerald-400" /> Supervisor Spot Checks
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{spotChecksCount}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Non-blind visible shelf checks</div>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
                <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-rose-400" /> Full Store Lockdowns
                </div>
                <div className="text-2xl font-bold font-mono text-rose-400 mt-1">{lockdownCount}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Comprehensive storewide audits</div>
              </div>
            </div>

            {/* Search & Filter Toolbar */}
            <div className="bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search closed audit archive by title, ID, branch..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Count Type Filter */}
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    onClick={() => setCountTypeFilter('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      countTypeFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All Types
                  </button>
                  <button
                    onClick={() => setCountTypeFilter('DAILY_BLIND')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      countTypeFilter === 'DAILY_BLIND' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Daily Blind
                  </button>
                  <button
                    onClick={() => setCountTypeFilter('SPOT_CHECK')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      countTypeFilter === 'SPOT_CHECK' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Spot Check
                  </button>
                  <button
                    onClick={() => setCountTypeFilter('WEEKLY_STRATEGIC')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      countTypeFilter === 'WEEKLY_STRATEGIC' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Weekly
                  </button>
                  <button
                    onClick={() => setCountTypeFilter('FULL_LOCKDOWN')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      countTypeFilter === 'FULL_LOCKDOWN' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Lockdown
                  </button>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    onClick={() => setStatusFilter('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      statusFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All Closed
                  </button>
                  <button
                    onClick={() => setStatusFilter('APPROVED')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      statusFilter === 'APPROVED' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Approved
                  </button>
                  <button
                    onClick={() => setStatusFilter('CANCELLED')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      statusFilter === 'CANCELLED' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Cancelled
                  </button>
                </div>
              </div>
            </div>

            {/* Closed Sessions Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {closedSessions.map((s, sIdx) => {
                const segs = Array.isArray(s.segments) ? s.segments : [];
                const verifiedSegs = segs.filter((seg) => seg.status === 'VERIFIED').length;
                const totalSegs = segs.length;
                const typeBadge =
                  s.countType === 'DAILY_BLIND'
                    ? { label: 'Daily Blind', bg: 'bg-amber-950 text-amber-300 border-amber-800' }
                    : s.countType === 'SPOT_CHECK'
                    ? { label: 'Spot Check', bg: 'bg-emerald-950 text-emerald-300 border-emerald-800' }
                    : s.countType === 'WEEKLY_STRATEGIC'
                    ? { label: 'Weekly Strategic', bg: 'bg-purple-950 text-purple-300 border-purple-800' }
                    : { label: 'Full Lockdown', bg: 'bg-rose-950 text-rose-300 border-rose-800' };

                return (
                  <div
                    key={`${s.sessionId}-${sIdx}`}
                    onClick={() => openSessionDetail(s, 'HOME')}
                    className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-5 cursor-pointer transition shadow-lg flex flex-col justify-between gap-4 group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-950 text-blue-400 border border-slate-800">
                            {s.sessionId}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeBadge.bg}`}>
                            {typeBadge.label}
                          </span>
                        </div>

                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                            s.status === 'APPROVED_POSTED'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {String(s.status || 'APPROVED_POSTED').replace(/_/g, ' ')}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-white group-hover:text-blue-300 transition mt-2">
                        {s.title}
                      </h3>

                      <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {s.date}
                        </span>
                        <span>•</span>
                        <span>{s.branchName}</span>
                      </div>

                      {s.stocktakeAuditorName && (
                        <div className="text-[11px] text-amber-300 mt-1 flex items-center gap-1">
                          <Shield className="w-3 h-3 text-amber-400" />
                          Auditor: <strong>{s.stocktakeAuditorName}</strong>
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                        <span>Segments Verified:</span>
                        <span className="font-mono font-bold text-white">
                          {verifiedSegs}/{totalSegs}
                        </span>
                      </div>

                      {s.consolidatedItems &&
                        s.consolidatedItems.length > 0 &&
                        (isStocktakeLeader(effectiveUser) ||
                          isStocktakeAuditor(effectiveUser, s) ||
                          (!effectiveUser?.isCasual && !effectiveUser?.isVisitingCounter)) && (
                          <div className="mt-2 flex items-center justify-between text-xs text-slate-300 bg-slate-950/40 p-2.5 rounded-lg">
                            <span>Committed Variance:</span>
                            <span
                              className={`font-mono font-bold ${
                                s.varianceUnits === 0
                                  ? 'text-slate-400'
                                  : s.varianceUnits < 0
                                  ? 'text-rose-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {Number(s.varianceUnits || 0) >= 0 ? `+${Number(s.varianceUnits || 0)}` : Number(s.varianceUnits || 0)} units ($
                              {Number(s.varianceCostValue || 0).toFixed(2)})
                            </span>
                          </div>
                        )}
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                      <span className="text-slate-400">Created: {s.createdByName}</span>
                      <div className="flex items-center gap-2">
                        {(isStocktakeLeader(effectiveUser) || isStocktakeAuditor(effectiveUser, s)) &&
                          (pendingDeleteSessionId === s.sessionId ? (
                            <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => handleConfirmDeleteSession(e, s.sessionId)}
                                className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDeleteSessionId(null);
                                }}
                                className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteSessionId(s.sessionId);
                              }}
                              className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                              title="Delete Session"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        <span className="text-blue-400 group-hover:translate-x-1 transition flex items-center gap-1 font-semibold">
                          Open <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {closedSessions.length === 0 && (
                <div className="col-span-full py-10 text-center bg-slate-900/40 rounded-2xl border border-slate-800">
                  <p className="text-xs text-slate-400">No closed/archived stocktake sessions match the current filter.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* New Session Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Initialize New Stocktake Session</h3>
              </div>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {/* Count Type Selector (Filtered by Role Governance) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Select Stocktake Count Type *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {allowedCreateTypes.includes('DAILY_BLIND') && (
                    <button
                      type="button"
                      onClick={() => handleSelectCountType('DAILY_BLIND')}
                      className={`p-3 rounded-xl border text-left transition ${
                        countType === 'DAILY_BLIND'
                          ? 'bg-amber-950/60 border-amber-600 text-amber-200 ring-1 ring-amber-500/30'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1.5 text-white">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        Daily Blind Count
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Fast movers (Airtime, Bread, Gas) with live freeze & timestamping during active trading.
                      </p>
                    </button>
                  )}

                  {allowedCreateTypes.includes('SPOT_CHECK') && (
                    <button
                      type="button"
                      onClick={() => handleSelectCountType('SPOT_CHECK')}
                      className={`p-3 rounded-xl border text-left transition ${
                        countType === 'SPOT_CHECK'
                          ? 'bg-emerald-950/60 border-emerald-600 text-emerald-200 ring-1 ring-emerald-500/30'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1.5 text-white">
                        <Eye className="w-3.5 h-3.5 text-emerald-400" />
                        Supervisor Spot Check
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Non-blind check by supervisor/owner with visible live system stock on hand.
                      </p>
                    </button>
                  )}

                  {allowedCreateTypes.includes('WEEKLY_STRATEGIC') && (
                    <button
                      type="button"
                      onClick={() => handleSelectCountType('WEEKLY_STRATEGIC')}
                      className={`p-3 rounded-xl border text-left transition ${
                        countType === 'WEEKLY_STRATEGIC'
                          ? 'bg-purple-950/60 border-purple-600 text-purple-200 ring-1 ring-purple-500/30'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1.5 text-white">
                        <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                        Weekly Strategic
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Double-blind counts with paired staff or single count + variance recounts.
                      </p>
                    </button>
                  )}

                  {allowedCreateTypes.includes('FULL_LOCKDOWN') && (
                    <button
                      type="button"
                      onClick={() => handleSelectCountType('FULL_LOCKDOWN')}
                      className={`p-3 rounded-xl border text-left transition ${
                        countType === 'FULL_LOCKDOWN'
                          ? 'bg-rose-950/60 border-rose-600 text-rose-200 ring-1 ring-rose-500/30'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1.5 text-white">
                        <Lock className="w-3.5 h-3.5 text-rose-400" />
                        Full Store Lockdown
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Storewide audit: branch lockdown engaged, casual PIN accounts, uncounted items default to 0.
                      </p>
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Audit Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. End of Month Full Store Audit"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Audit Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Branch / Store Location</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Designated Stocktake Auditor Assignment (3-Way Source: Branch Staff, Visiting Staff, External Consultant) */}
              <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-white font-semibold">
                    <Shield className="w-4 h-4 text-amber-400" />
                    Designated Stocktake Auditor
                  </div>
                  <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800 px-2 py-0.5 rounded-full font-bold">
                    Independent Oversight
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Even Branch Managers are audited during stocktake. Select an auditor from branch staff, cross-branch visiting staff, or register an external consultant.
                </p>

                {/* 3-Way Selector */}
                <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setAuditorType('BRANCH_STAFF');
                      setStocktakeAuditorId('');
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition ${
                      auditorType === 'BRANCH_STAFF'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Branch Staff
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditorType('VISITING_STAFF');
                      setStocktakeAuditorId('');
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition ${
                      auditorType === 'VISITING_STAFF'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Visiting Staff Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditorType('EXTERNAL_CONSULTANT');
                      setStocktakeAuditorId('');
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition ${
                      auditorType === 'EXTERNAL_CONSULTANT'
                        ? 'bg-amber-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    External Consultant
                  </button>
                </div>

                {auditorType === 'BRANCH_STAFF' && (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">
                        Select Current Branch Staff Auditor ({branchStaffAuditors.length})
                      </label>
                      <select
                        value={stocktakeAuditorId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setStocktakeAuditorId(id);
                          const picked = branchStaffAuditors.find((a) => a.id === id) || allActiveStaff.find((a) => a.id === id);
                          if (picked) {
                            setStocktakeAuditorName(picked.name);
                            setStocktakeAuditorPhone(picked.phone || '');
                          }
                        }}
                        className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="">-- Choose Branch Staff Auditor --</option>
                        {branchStaffAuditors.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name} ({sp.role} • #{sp.id})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">Auditor Name</label>
                        <input
                          type="text"
                          value={stocktakeAuditorName}
                          onChange={(e) => setStocktakeAuditorName(e.target.value)}
                          placeholder="e.g. Kudakwashe Moyo"
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">Auditor Phone</label>
                        <input
                          type="text"
                          value={stocktakeAuditorPhone}
                          onChange={(e) => setStocktakeAuditorPhone(e.target.value)}
                          placeholder="+263 77..."
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {auditorType === 'VISITING_STAFF' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">Home Branch</label>
                        <select
                          value={visitingAuditorBranchId}
                          onChange={(e) => {
                            setVisitingAuditorBranchId(e.target.value);
                            setStocktakeAuditorId('');
                          }}
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        >
                          <option value="">All Other Branches</option>
                          {allBranches
                            .filter(
                              (b) =>
                                String(b.branchId || b.id || '').toUpperCase() !==
                                String(activeBranchId || '').toUpperCase()
                            )
                            .map((b) => (
                              <option key={b.branchId || b.id} value={b.branchId || b.id}>
                                {b.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">
                          Visiting Auditor ({visitingStaffCandidates.length})
                        </label>
                        <select
                          value={stocktakeAuditorId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setStocktakeAuditorId(id);
                            const picked = visitingStaffCandidates.find((a) => a.id === id);
                            if (picked) {
                              setStocktakeAuditorName(picked.name);
                              setStocktakeAuditorPhone(picked.phone || '');
                            }
                          }}
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        >
                          <option value="">-- Select Visiting Staff --</option>
                          {visitingStaffCandidates.map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.name} ({sp.role} • {sp.branchName || sp.branchId || 'HQ'})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-[11px] text-emerald-300/90 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      Automatically issues a Visiting Auditor Guest Pass for this branch so they can log in with their own PIN.
                    </p>
                  </div>
                )}

                {auditorType === 'EXTERNAL_CONSULTANT' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="col-span-3 sm:col-span-1">
                        <label className="block text-slate-300 font-semibold mb-1">Consultant Name *</label>
                        <input
                          type="text"
                          value={consultantName}
                          onChange={(e) => setConsultantName(e.target.value)}
                          placeholder="e.g. T. Chikwanda"
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">Phone</label>
                        <input
                          type="text"
                          value={consultantPhone}
                          onChange={(e) => setConsultantPhone(e.target.value)}
                          placeholder="+263 77..."
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">Login PIN (4-6 digits) *</label>
                        <input
                          type="text"
                          maxLength={6}
                          value={consultantPin}
                          onChange={(e) => setConsultantPin(e.target.value.replace(/\D/g, ''))}
                          placeholder="e.g. 4829"
                          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-amber-300 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-amber-300/90 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5" />
                      Creates a temporary External Consultant Auditor login that auto-expires on stocktake committal.
                    </p>
                  </div>
                )}
              </div>

              {/* Post-Commit Variance Governance Rules */}
              <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
                <div className="text-white font-semibold flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                  Post-Commit Variance Commentary Rules
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Threshold ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={varianceThresholdUsd}
                      onChange={(e) => setVarianceThresholdUsd(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Min Units</label>
                    <input
                      type="number"
                      min={1}
                      value={varianceMinUnits}
                      onChange={(e) => setVarianceMinUnits(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Deadline (Hours)</label>
                    <input
                      type="number"
                      min={1}
                      value={varianceWindowHours}
                      onChange={(e) => setVarianceWindowHours(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                    />
                    <span className="text-[10px] text-slate-500">72h = 3 Days Default</span>
                  </div>
                </div>
              </div>

              {/* Lockdown Toggle */}
              {countType === 'FULL_LOCKDOWN' && (
                <div className="bg-rose-950/30 p-3.5 rounded-xl border border-rose-800/60 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                    <div>
                      <strong className="text-rose-200 block font-semibold">
                        Engage Store Lockdown upon Creation
                      </strong>
                      <p className="text-[11px] text-rose-300/80">
                        Locks POS till doors; sales will require supervisor override with audit logging.
                      </p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isLockdownActive}
                    onChange={(e) => setIsLockdownActive(e.target.checked)}
                    className="w-4 h-4 text-rose-600 rounded bg-slate-900 border-slate-700"
                  />
                </div>
              )}

              {/* Segment Configuration */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-semibold">
                    Floor Counting Segments (One per line)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowBranchSegmentsModal(true)}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <MapPin className="w-3 h-3" /> Edit Store Floor Map
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={customSegments}
                  onChange={(e) => setCustomSegments(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Auto-hydrated from your branch&apos;s persistent Floor Map for Weekly &amp; Lockdown audits.
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Audit Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Full physical count prior to monthly financial close."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                />
              </div>

              {modalError && (
                <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-700 text-rose-200 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg"
                >
                  Start Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Casual Worker Fast Login Modal */}
      {showCasualPinModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-600/40 rounded-2xl max-w-sm w-full p-6 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Casual Worker Terminal Login</h3>
                <p className="text-xs text-slate-400">Enter your assigned 4-digit stocktake PIN</p>
              </div>
            </div>

            <form onSubmit={handleCasualPinSubmit} className="space-y-4">
              {branchActiveCasuals.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Select Casual Worker ({branchActiveCasuals.length})
                  </label>
                  <div className="grid grid-cols-1 gap-1.5 max-h-32 overflow-y-auto pr-1">
                    {branchActiveCasuals.map((c) => {
                      const isPicked = selectedCasualId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCasualId(c.id);
                            setCasualAuthError(null);
                          }}
                          className={`p-2 rounded-xl border text-left flex items-center justify-between transition ${
                            isPicked
                              ? 'bg-amber-950/60 border-amber-500 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div>
                            <div className="text-xs font-bold">{c.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {c.badgeNumber || c.id} • {c.assignedGroup === 'GROUP_1' ? 'Team A' : 'Team B'}
                            </div>
                          </div>
                          {isPicked && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <input
                  type="password"
                  maxLength={6}
                  value={casualPinInput}
                  onChange={(e) => setCasualPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •"
                  autoFocus
                  className="w-full text-center text-3xl tracking-[0.5em] font-mono py-3 bg-slate-950 border border-slate-700 rounded-xl text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {casualAuthError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-center">
                  {casualAuthError}
                </div>
              )}

              {/* Quick Onscreen Number Pad */}
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setCasualPinInput((prev) => (prev.length < 6 ? prev + num : prev))}
                    className="py-3 bg-slate-800 hover:bg-slate-700 text-white font-mono font-bold text-lg rounded-xl border border-slate-700/60 active:scale-95 transition"
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCasualPinInput('')}
                  className="py-3 bg-slate-800/60 hover:bg-slate-700 text-slate-400 font-semibold text-xs rounded-xl border border-slate-700/60 transition"
                >
                  CLEAR
                </button>
                <button
                  type="button"
                  onClick={() => setCasualPinInput((prev) => (prev.length < 6 ? prev + '0' : prev))}
                  className="py-3 bg-slate-800 hover:bg-slate-700 text-white font-mono font-bold text-lg rounded-xl border border-slate-700/60 active:scale-95 transition"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setCasualPinInput((prev) => prev.slice(0, -1))}
                  className="py-3 bg-slate-800/60 hover:bg-slate-700 text-slate-400 font-semibold text-xs rounded-xl border border-slate-700/60 transition"
                >
                  DEL
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCasualPinModal(false);
                    setCasualPinInput('');
                    setCasualAuthError(null);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={casualPinInput.length < 4}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-amber-900/30"
                >
                  Enter Terminal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Branch Persistent Floor Segments Map Modal */}
      {showBranchSegmentsModal && (
        <BranchSegmentsModal
          branchId={activeBranchId}
          branchName={branchName}
          currentUser={effectiveUser}
          onClose={() => setShowBranchSegmentsModal(false)}
          onSaved={(savedSegs) => {
            if (countType === 'FULL_LOCKDOWN' || countType === 'WEEKLY_STRATEGIC') {
              setCustomSegments(savedSegs.map((s) => s.name).join('\n'));
            }
            setHubNotice(`Branch floor map updated (${savedSegs.length} segments) and synced.`);
            setTimeout(() => setHubNotice(null), 4000);
          }}
        />
      )}
    </div>
  );
};
