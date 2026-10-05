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
  submitSkuVarianceRecount,
  approveAndCommitStocktake,
  getStocktakeSessionById,
  getCustomerGoodsLeftBehind,
  getTemporaryCasuals,
} from '../../db/roomDatabase';
import { DoubleCountTerminal } from './DoubleCountTerminal';
import { SegmentRecountModal } from './SegmentRecountModal';
import { ConsolidatedVarianceView } from './ConsolidatedVarianceView';
import { StocktakeApprovalModal } from './StocktakeApprovalModal';
import { CustomerGoodsLeftBehindTab } from './CustomerGoodsLeftBehindTab';
import { CasualWorkersTab } from './CasualWorkersTab';
import { FastMovingChecklistTab } from './FastMovingChecklistTab';
import { LockdownEmergencySalesTab } from './LockdownEmergencySalesTab';
import { P2PMeshSyncTab } from './P2PMeshSyncTab';

interface StocktakeSessionDetailScreenProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
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
  | 'AUDIT_CERT';

export const StocktakeSessionDetailScreen: React.FC<StocktakeSessionDetailScreenProps> = ({
  session: initialSession,
  currentUser,
  onBack,
  onUpdateSession,
}) => {
  const [session, setSession] = useState<StocktakeSession>(initialSession);
  const [activeTab, setActiveTab] = useState<DetailTab>('SEGMENTS');

  // Terminal state
  const [activeTerminalSegment, setActiveTerminalSegment] = useState<StocktakeSegment | null>(null);
  const [terminalCounterSlot, setTerminalCounterSlot] = useState<'A' | 'B'>('A');

  // Segment Recount Modal state
  const [activeRecountSegment, setActiveRecountSegment] = useState<StocktakeSegment | null>(null);

  // Admin Approval Modal
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // New segment form state
  const [showAddSegmentModal, setShowAddSegmentModal] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState('');
  const [newSegmentLocation, setNewSegmentLocation] = useState('');
  const [newSegmentDesc, setNewSegmentDesc] = useState('');

  // Count metrics for tabs
  const [goodsLeftBehindCount, setGoodsLeftBehindCount] = useState<number>(0);
  const [casualsCount, setCasualsCount] = useState<number>(0);

  // Toast / notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const refreshSession = (updated?: StocktakeSession) => {
    const latest = updated || getStocktakeSessionById(session.sessionId) || session;
    setSession(latest);
    onUpdateSession(latest);

    const cgl = getCustomerGoodsLeftBehind(latest.sessionId);
    setGoodsLeftBehindCount(cgl.filter((i) => !i.collected).length);

    const cas = getTemporaryCasuals(latest.sessionId);
    setCasualsCount(cas.length);
  };

  useEffect(() => {
    refreshSession();
  }, [session.sessionId]);

  // Add Segment Handler
  const handleAddSegment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSegmentName.trim()) return;

    const res = addStocktakeSegment(session.sessionId, {
      name: newSegmentName.trim(),
      locationCode: newSegmentLocation.trim() || undefined,
      description: newSegmentDesc.trim() || undefined,
    });

    if (res) {
      refreshSession(res);
      setShowAddSegmentModal(false);
      setNewSegmentName('');
      setNewSegmentLocation('');
      setNewSegmentDesc('');
      showToast('New segment added successfully.');
    }
  };

  // Delete Segment Handler
  const handleDeleteSegment = (segmentId: string) => {
    if (confirm('Are you sure you want to delete this segment?')) {
      const res = deleteStocktakeSegment(session.sessionId, segmentId);
      if (res) {
        refreshSession(res);
        showToast('Segment removed.');
      }
    }
  };

  // Launch Double-Count Terminal for a segment
  const handleLaunchTerminal = (segment: StocktakeSegment, slot: 'A' | 'B') => {
    setActiveTerminalSegment(segment);
    setTerminalCounterSlot(slot);
  };

  // Save Double-Blind Count from Terminal
  const handleSaveCountFromTerminal = (
    slot: 'A' | 'B',
    lines: StocktakeLineCount[],
    counterStaffId: string,
    counterStaffName: string
  ) => {
    if (!activeTerminalSegment) return;

    try {
      const result = submitSegmentCount(
        session.sessionId,
        activeTerminalSegment.segmentId,
        slot,
        lines,
        counterStaffId,
        counterStaffName
      );

      refreshSession(result.session);
      showToast(result.message);
      setActiveTerminalSegment(null);
    } catch (err: any) {
      alert(err.message || 'Error submitting count.');
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
      refreshSession(res.session);
      setActiveRecountSegment(null);
      showToast(res.message);
    } catch (err: any) {
      alert(err.message || 'Error resolving recount.');
    }
  };

  // Consolidate Counts
  const handleConsolidate = () => {
    try {
      const res = consolidateStocktakeSession(session.sessionId);
      refreshSession(res.session);
      if (res.success) {
        setActiveTab('VARIANCE');
        showToast(res.message);
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert(err.message || 'Error during consolidation.');
    }
  };

  // Request SKU Variance Recount
  const handleRequestSkuRecount = (itemId: string, notes?: string) => {
    const res = requestSkuVarianceRecount(session.sessionId, itemId, notes);
    if (res) {
      refreshSession(res);
      showToast(`Flagged ${itemId} for secondary floor recount.`);
    }
  };

  // Submit SKU Variance Recount
  const handleSubmitSkuRecount = (itemId: string, cases: number, singles: number) => {
    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Supervisor';
    const res = submitSkuVarianceRecount(session.sessionId, itemId, cases, singles, staffId, staffName);
    if (res) {
      refreshSession(res);
      showToast(`Updated physical recount for item. Variances recalculated.`);
    }
  };

  // Final Admin Approval
  const handleApprove = (adminId: string, adminName: string, notes?: string) => {
    const res = approveAndCommitStocktake(session.sessionId, adminId, adminName, notes);
    if (res.success && res.session) {
      refreshSession(res.session);
      setShowApprovalModal(false);
      setActiveTab('AUDIT_CERT');
      showToast(res.message);
    } else {
      alert(res.message);
    }
  };

  const handlePrintCertificate = () => {
    window.print();
  };

  // If in Double-Count Terminal mode, render full-screen terminal
  if (activeTerminalSegment) {
    return (
      <DoubleCountTerminal
        session={session}
        segment={activeTerminalSegment}
        currentUser={currentUser}
        initialCounterSlot={terminalCounterSlot}
        onSaveCount={handleSaveCountFromTerminal}
        onBack={() => setActiveTerminalSegment(null)}
      />
    );
  }

  const allSegmentsVerified =
    session.segments.length > 0 && session.segments.every((s) => s.status === 'VERIFIED');
  const hasDiscrepancy = session.segments.some((s) => s.status === 'DISCREPANCY_RECOUNT');
  const verifiedCount = session.segments.filter((s) => s.status === 'VERIFIED').length;
  const isApproved = session.status === 'APPROVED_POSTED';

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
                  {session.status.replace(/_/g, ' ')}
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

          {/* Action Hub */}
          <div className="flex items-center gap-2">
            {!isApproved && allSegmentsVerified && (
              <button
                onClick={handleConsolidate}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 flex items-center gap-2 transition"
              >
                <Layers className="w-4 h-4" />
                Consolidate & Compare SOH
              </button>
            )}

            {!isApproved && session.consolidatedItems && session.consolidatedItems.length > 0 && (
              <button
                onClick={() => setShowApprovalModal(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-2 transition"
              >
                <ShieldCheck className="w-4 h-4" />
                Owner / Auditor Committal
              </button>
            )}

            {isApproved && (
              <button
                onClick={() => setActiveTab('AUDIT_CERT')}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-800/40 rounded-xl text-xs font-bold flex items-center gap-2 transition"
              >
                <FileText className="w-4 h-4" />
                View Committal Certificate
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Navigation Tabs Bar */}
      <div className="bg-slate-900/80 border-b border-slate-800 px-6 overflow-x-auto">
        <div className="max-w-7xl mx-auto flex items-center gap-4 text-xs font-semibold whitespace-nowrap min-w-max">
          <button
            onClick={() => setActiveTab('SEGMENTS')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'SEGMENTS'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            Floor Segments ({verifiedCount}/{session.segments.length})
          </button>

          <button
            onClick={() => setActiveTab('VARIANCE')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'VARIANCE'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Consolidated Variance ({session.consolidatedItems?.length || 0})
          </button>

          <button
            onClick={() => setActiveTab('GOODS_LEFT_BEHIND')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'GOODS_LEFT_BEHIND'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <PackageOpen className="w-4 h-4" />
            Customer Goods Left Behind
            {goodsLeftBehindCount > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 font-bold rounded-full text-[10px]">
                {goodsLeftBehindCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('CASUALS')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'CASUALS'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            Casual Accounts & PINs
            {casualsCount > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-950 text-amber-300 border border-amber-800 font-bold rounded-full text-[10px]">
                {casualsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('FAST_MOVERS')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'FAST_MOVERS'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            Fast Movers Airtime Checklist
          </button>

          <button
            onClick={() => setActiveTab('LOCKDOWN')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'LOCKDOWN'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock className="w-4 h-4" />
            Lockdown & Emergency Sales
          </button>

          <button
            onClick={() => setActiveTab('P2P_SYNC')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'P2P_SYNC'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Share2 className="w-4 h-4" />
            P2P Mesh & Cloud Throttler
          </button>

          {isApproved && (
            <button
              onClick={() => setActiveTab('AUDIT_CERT')}
              className={`py-3 border-b-2 flex items-center gap-1.5 transition ${
                activeTab === 'AUDIT_CERT'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              Audit Certificate
            </button>
          )}
        </div>
      </div>

      {/* Notification Toast */}
      {toastMessage && (
        <div className="bg-blue-900/90 text-blue-100 border-b border-blue-700 px-4 py-2 text-center text-xs font-semibold flex items-center justify-center gap-2 animate-fadeIn">
          <Info className="w-4 h-4 text-blue-300" />
          {toastMessage}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
        {/* TAB 1: SEGMENTS & DOUBLE COUNTING WORKSPACE */}
        {activeTab === 'SEGMENTS' && (
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

              {!isApproved && (
                <button
                  onClick={() => setShowAddSegmentModal(true)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-400" />
                  Add New Segment
                </button>
              )}
            </div>

            {/* Segments Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {session.segments.map((seg) => {
                const count1Done = seg.count1 && seg.count1.length > 0;
                const count2Done = seg.count2 && seg.count2.length > 0;
                const count1Units = seg.count1?.reduce((acc, l) => acc + l.totalUnits, 0) || 0;
                const count2Units = seg.count2?.reduce((acc, l) => acc + l.totalUnits, 0) || 0;
                const verifiedUnits = seg.verifiedCounts?.reduce((acc, l) => acc + l.totalUnits, 0) || 0;

                return (
                  <div
                    key={seg.segmentId}
                    className={`bg-slate-900/90 rounded-2xl border p-5 flex flex-col justify-between gap-4 transition shadow-lg ${
                      seg.status === 'VERIFIED'
                        ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                        : seg.status === 'DISCREPANCY_RECOUNT'
                        ? 'border-amber-500/50 ring-1 ring-amber-500/20'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      {/* Segment Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700">
                              {seg.locationCode || seg.segmentId}
                            </span>
                            <h3 className="text-base font-bold text-white">{seg.name}</h3>
                          </div>
                          {seg.description && (
                            <p className="text-xs text-slate-400 mt-1">{seg.description}</p>
                          )}
                        </div>

                        <span
                          className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                            seg.status === 'VERIFIED'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : seg.status === 'DISCREPANCY_RECOUNT'
                              ? 'bg-amber-950 text-amber-300 border-amber-800 animate-pulse'
                              : seg.status === 'COUNTING'
                              ? 'bg-blue-950 text-blue-300 border-blue-800'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {seg.status === 'DISCREPANCY_RECOUNT'
                            ? `Recount Needed (${seg.discrepancyCount})`
                            : seg.status}
                        </span>
                      </div>

                      {/* Double Count Progress Trackers */}
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        {/* Counter A Box */}
                        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-blue-400">Count 1 (Group 1)</span>
                            {count1Done && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                          <div className="text-sm font-bold font-mono text-white mt-1">
                            {count1Done ? `${count1Units} units` : 'Not Started'}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {count1Done ? seg.counterAName || 'Counter 1' : 'Awaiting submission'}
                          </div>
                        </div>

                        {/* Counter B Box */}
                        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-purple-400">Count 2 (Group 2)</span>
                            {count2Done && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                          <div className="text-sm font-bold font-mono text-white mt-1">
                            {count2Done ? `${count2Units} units` : 'Not Started'}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {count2Done ? seg.counterBName || 'Counter 2' : 'Awaiting submission'}
                          </div>
                        </div>
                      </div>

                      {/* Discrepancy Alert / Verification summary */}
                      {seg.status === 'DISCREPANCY_RECOUNT' && (
                        <div className="mt-3 p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-xs text-amber-200 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                            <span>
                              <strong>{seg.discrepancyCount} SKU discrepancy detected</strong>{' '}
                              between Count 1 and Count 2.
                            </span>
                          </div>
                          <button
                            onClick={() => setActiveRecountSegment(seg)}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[11px] font-bold transition shrink-0 ml-2"
                          >
                            Resolve Recount
                          </button>
                        </div>
                      )}

                      {seg.status === 'VERIFIED' && (
                        <div className="mt-3 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>
                              Verified Count: <strong>{verifiedUnits} units</strong> across{' '}
                              {seg.verifiedCounts.length} SKUs.
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

                    {/* Terminal Action Buttons */}
                    <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleLaunchTerminal(seg, 'A')}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600/20 text-blue-300 hover:bg-blue-600 hover:text-white border border-blue-500/30 transition flex items-center gap-1.5"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          {count1Done ? 'Edit Count 1' : 'Start Count 1'}
                        </button>
                        <button
                          onClick={() => handleLaunchTerminal(seg, 'B')}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600/20 text-purple-300 hover:bg-purple-600 hover:text-white border border-purple-500/30 transition flex items-center gap-1.5"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          {count2Done ? 'Edit Count 2' : 'Start Count 2'}
                        </button>
                      </div>

                      {!isApproved && (
                        <button
                          onClick={() => handleDeleteSegment(seg.segmentId)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                          title="Remove Segment"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: CONSOLIDATED VARIANCE VIEW */}
        {activeTab === 'VARIANCE' && (
          <ConsolidatedVarianceView
            session={session}
            currentUser={currentUser}
            onRequestSkuRecount={handleRequestSkuRecount}
            onSubmitSkuRecount={handleSubmitSkuRecount}
            onConsolidateAgain={handleConsolidate}
          />
        )}

        {/* TAB 3: CUSTOMER GOODS LEFT BEHIND */}
        {activeTab === 'GOODS_LEFT_BEHIND' && (
          <CustomerGoodsLeftBehindTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 4: TEMPORARY CASUAL WORKER ACCOUNTS & PINS */}
        {activeTab === 'CASUALS' && (
          <CasualWorkersTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 5: FAST-MOVING AIRTIME CHECKLIST */}
        {activeTab === 'FAST_MOVERS' && (
          <FastMovingChecklistTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 6: LOCKDOWN & EMERGENCY SALES */}
        {activeTab === 'LOCKDOWN' && (
          <LockdownEmergencySalesTab
            session={session}
            currentUser={currentUser}
            onRefreshSession={refreshSession}
          />
        )}

        {/* TAB 7: P2P MESH & SYNC OPTIMIZER */}
        {activeTab === 'P2P_SYNC' && (
          <P2PMeshSyncTab session={session} />
        )}

        {/* TAB 8: AUDIT COMMITTAL CERTIFICATE */}
        {activeTab === 'AUDIT_CERT' && (
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

      {/* Admin Committal Modal */}
      {showApprovalModal && (
        <StocktakeApprovalModal
          session={session}
          currentUser={currentUser}
          onApprove={handleApprove}
          onClose={() => setShowApprovalModal(false)}
        />
      )}
    </div>
  );
};
