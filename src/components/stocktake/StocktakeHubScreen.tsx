import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { StocktakeSession, StocktakeCountType, Salesperson } from '../../types';
import {
  getStocktakeSessions,
  createStocktakeSession,
  deleteStocktakeSession,
} from '../../db/roomDatabase';
import { StocktakeSessionDetailScreen } from './StocktakeSessionDetailScreen';

interface StocktakeHubScreenProps {
  currentUser: Salesperson | null;
  onGoToMaster?: () => void;
  onGoToHome?: () => void;
}

export const StocktakeHubScreen: React.FC<StocktakeHubScreenProps> = ({ currentUser }) => {
  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<StocktakeSession | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [countTypeFilter, setCountTypeFilter] = useState<string>('ALL');

  // New Session Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [title, setTitle] = useState('');
  const [countType, setCountType] = useState<StocktakeCountType>('DAILY_BLIND');
  const [branchName, setBranchName] = useState('Main Central Distribution & Warehouse');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [stocktakeAuditorName, setStocktakeAuditorName] = useState('Kudakwashe Moyo');
  const [stocktakeAuditorPhone, setStocktakeAuditorPhone] = useState('+263 77 123 4567');
  const [isLockdownActive, setIsLockdownActive] = useState(false);
  const [notes, setNotes] = useState('');
  const [customSegments, setCustomSegments] = useState<string>(
    'Front Till 01 - Airtime & Small Items\nGas Refill Bay - Cylinders\nBakery Shelves - Bread Loaves'
  );

  const loadSessions = () => {
    const list = getStocktakeSessions();
    setSessions(list);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleSelectCountType = (type: StocktakeCountType) => {
    setCountType(type);
    if (type === 'DAILY_BLIND') {
      setIsLockdownActive(false);
      setCustomSegments(
        'Front Till 01 - Airtime & Small Items\nGas Refill Bay - Cylinders\nBakery Shelves - Bread Loaves'
      );
      if (!title || title.includes('Stocktake Audit')) {
        setTitle(`Daily Blind Count (Fast Movers) - ${date}`);
      }
    } else if (type === 'SPOT_CHECK') {
      setIsLockdownActive(false);
      setCustomSegments('Supervisor Spot-Check Verification Bay');
      if (!title || title.includes('Stocktake Audit')) {
        setTitle(`Supervisor Spot Check - ${date}`);
      }
    } else if (type === 'WEEKLY_STRATEGIC') {
      setIsLockdownActive(false);
      setCustomSegments(
        'Aisle 1 - Beverages & Coolers\nAisle 2 - Groceries, Sugar & Oils'
      );
      if (!title || title.includes('Stocktake Audit')) {
        setTitle(`Weekly Strategic Double Count - ${date}`);
      }
    } else if (type === 'FULL_LOCKDOWN') {
      setIsLockdownActive(true);
      setCustomSegments(
        'Aisle 1 - Beverages & Coolers\nAisle 2 - Groceries, Sugar & Oils\nAisle 3 - Bulk Rice & Flours\nFront Counter - Toiletries & Razors\nBack Storeroom - Pallet Bays'
      );
      if (!title || title.includes('Stocktake Audit')) {
        setTitle(`Month-End Storewide Lockdown Stocktake - ${date}`);
      }
    }
  };

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    const segmentNames = customSegments
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Sarah Chidyamakono';

    const newSession = createStocktakeSession({
      title: title.trim() || `${countType.replace('_', ' ')} Audit - ${date}`,
      date,
      countType,
      branchName,
      isLockdownActive,
      stocktakeAuditorName: stocktakeAuditorName.trim() || undefined,
      stocktakeAuditorPhone: stocktakeAuditorPhone.trim() || undefined,
      stocktakeAuditorId: stocktakeAuditorName.trim() ? 'AUD-001' : undefined,
      notes,
      segmentNames,
      staffId,
      staffName,
    });

    loadSessions();
    setShowNewModal(false);
    setTitle('');
    setNotes('');
    setSelectedSession(newSession);
  };

  const handleDelete = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm(`Are you sure you want to delete session ${sessionId}?`)) {
      deleteStocktakeSession(sessionId);
      loadSessions();
      if (selectedSession?.sessionId === sessionId) {
        setSelectedSession(null);
      }
    }
  };

  // Filtered sessions
  const q = (searchQuery || '').trim().toLowerCase();
  const filteredSessions = sessions.filter((s) => {
    const matchesSearch =
      q === '' ||
      (s.title && s.title.toLowerCase().includes(q)) ||
      (s.sessionId && s.sessionId.toLowerCase().includes(q)) ||
      (s.branchName && s.branchName.toLowerCase().includes(q));

    let matchesStatus = true;
    if (statusFilter === 'ACTIVE') {
      matchesStatus = s.status === 'COUNTING' || s.status === 'RECOUNTING' || s.status === 'DRAFT';
    } else if (statusFilter === 'RECOUNT') {
      matchesStatus = s.status === 'RECOUNTING' || s.segments.some((seg) => seg.status === 'DISCREPANCY_RECOUNT');
    } else if (statusFilter === 'APPROVED') {
      matchesStatus = s.status === 'APPROVED_POSTED';
    }

    let matchesType = true;
    if (countTypeFilter !== 'ALL') {
      matchesType = s.countType === countTypeFilter;
    }

    return matchesSearch && matchesStatus && matchesType;
  });

  // KPI Metrics
  const totalAudits = sessions.length;
  const dailyCountsCount = sessions.filter((s) => s.countType === 'DAILY_BLIND').length;
  const spotChecksCount = sessions.filter((s) => s.countType === 'SPOT_CHECK').length;
  const lockdownCount = sessions.filter((s) => s.countType === 'FULL_LOCKDOWN').length;

  if (selectedSession) {
    return (
      <StocktakeSessionDetailScreen
        session={selectedSession}
        currentUser={currentUser}
        onBack={() => {
          setSelectedSession(null);
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

        <button
          onClick={() => {
            handleSelectCountType('DAILY_BLIND');
            setShowNewModal(true);
          }}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          Initialize New Stocktake Session
        </button>
      </div>

      {/* KPI Cards */}
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
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
      <div className="max-w-7xl mx-auto bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search audit sessions by title, ID, branch..."
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Count Type Filter */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
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
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                statusFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Status: All
            </button>
            <button
              onClick={() => setStatusFilter('ACTIVE')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                statusFilter === 'ACTIVE' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter('APPROVED')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                statusFilter === 'APPROVED' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Approved
            </button>
          </div>
        </div>
      </div>

      {/* Sessions Grid */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSessions.map((s) => {
          const verifiedSegs = s.segments.filter((seg) => seg.status === 'VERIFIED').length;
          const totalSegs = s.segments.length;
          const hasRecounts = s.segments.some((seg) => seg.status === 'DISCREPANCY_RECOUNT');

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
              key={s.sessionId}
              onClick={() => setSelectedSession(s)}
              className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-5 cursor-pointer transition shadow-lg flex flex-col justify-between gap-4 group"
            >
              <div>
                {/* Header */}
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
                        : s.status === 'CONSOLIDATED'
                        ? 'bg-blue-950 text-blue-300 border-blue-800'
                        : s.status === 'RECOUNTING' || hasRecounts
                        ? 'bg-amber-950 text-amber-300 border-amber-800 animate-pulse'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {s.status.replace(/_/g, ' ')}
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

                {/* Segments progress bar */}
                <div className="mt-4 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-400 font-medium">Floor Segment Progress:</span>
                    <span className="font-mono font-bold text-white">
                      {verifiedSegs}/{totalSegs} Verified
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        verifiedSegs === totalSegs ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${totalSegs > 0 ? (verifiedSegs / totalSegs) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.segments.map((seg) => (
                      <span
                        key={seg.segmentId}
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                          seg.status === 'VERIFIED'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : seg.status === 'DISCREPANCY_RECOUNT'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {seg.locationCode || seg.segmentId}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Variance Preview */}
                {s.consolidatedItems && s.consolidatedItems.length > 0 && (
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-300 bg-slate-950/40 p-2.5 rounded-lg">
                    <span>Variance:</span>
                    <span
                      className={`font-mono font-bold ${
                        s.varianceUnits === 0
                          ? 'text-slate-400'
                          : s.varianceUnits < 0
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {s.varianceUnits >= 0 ? `+${s.varianceUnits}` : s.varianceUnits} units ($
                      {s.varianceCostValue.toFixed(2)})
                    </span>
                  </div>
                )}
              </div>

              {/* Card Footer */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400">Created: {s.createdByName}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleDelete(e, s.sessionId)}
                    className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                    title="Delete Session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-blue-400 group-hover:translate-x-1 transition flex items-center gap-1 font-semibold">
                    Open <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {filteredSessions.length === 0 && (
          <div className="col-span-full py-16 text-center bg-slate-900/40 rounded-2xl border border-slate-800">
            <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3 opacity-50" />
            <h3 className="text-base font-bold text-slate-300">No stocktake sessions found</h3>
            <p className="text-xs text-slate-500 mt-1">
              Start a new stocktake session to segment your shop floor and begin physical counting.
            </p>
            <button
              onClick={() => {
                handleSelectCountType('DAILY_BLIND');
                setShowNewModal(true);
              }}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Stocktake Session
            </button>
          </div>
        )}
      </div>

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
              {/* Count Type Selector */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Select Stocktake Count Type *
                </label>
                <div className="grid grid-cols-2 gap-2">
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
                      1. Daily Blind Count
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Fast movers (Airtime, Bread, Gas) with live freeze & timestamping during active trading.
                    </p>
                  </button>

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
                      2. Supervisor Spot Check
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Non-blind check by supervisor/owner with visible live system stock on hand.
                    </p>
                  </button>

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
                      3. Weekly Strategic
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Double-blind counts with paired staff or single count + variance recounts.
                    </p>
                  </button>

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
                      4. Full Store Lockdown
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Storewide audit: branch lockdown engaged, casual PIN accounts, uncounted items default to 0.
                    </p>
                  </button>
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

              {/* Stocktake Auditor Assignment */}
              <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <Shield className="w-4 h-4 text-amber-400" />
                  Designated Stocktake Auditor / Supervisor
                </div>
                <p className="text-[11px] text-slate-400">
                  During stocktakes, even branch managers are audited. Only this auditor and the Store Owner have authority to commit inventory.
                </p>
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
                <label className="block text-slate-300 font-semibold mb-1">
                  Floor Counting Segments (One per line)
                </label>
                <textarea
                  rows={4}
                  value={customSegments}
                  onChange={(e) => setCustomSegments(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Physical floor segments (shelves, aisles, rooms) created prior to the stocktake.
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
                  Initialize Stocktake
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
