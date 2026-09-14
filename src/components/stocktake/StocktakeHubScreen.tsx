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
} from 'lucide-react';
import { StocktakeSession, Salesperson } from '../../types';
import {
  getStocktakeSessions,
  createStocktakeSession,
  deleteStocktakeSession,
} from '../../db/roomDatabase';
import { StocktakeSessionDetailScreen } from './StocktakeSessionDetailScreen';

interface StocktakeHubScreenProps {
  currentUser: Salesperson | null;
}

export const StocktakeHubScreen: React.FC<StocktakeHubScreenProps> = ({ currentUser }) => {
  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<StocktakeSession | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // New Session Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [title, setTitle] = useState('');
  const [branchName, setBranchName] = useState('Main Central Distribution & Warehouse');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [customSegments, setCustomSegments] = useState<string>(
    'Aisle 1 - Beverages & Coolers\nAisle 2 - Groceries, Sugar & Oils\nAisle 3 - Bulk Rice & Flours\nFront Counter - Toiletries & Razors'
  );

  const loadSessions = () => {
    const list = getStocktakeSessions();
    setSessions(list);
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    const segmentNames = customSegments
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const staffId = currentUser?.id || '001';
    const staffName = currentUser?.name || 'Sarah Chidyamakono';

    const newSession = createStocktakeSession({
      title: title.trim() || `Stocktake Audit - ${date}`,
      date,
      branchName,
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

    return matchesSearch && matchesStatus;
  });

  // KPI Metrics
  const totalAudits = sessions.length;
  const activeAudits = sessions.filter((s) => s.status !== 'APPROVED_POSTED').length;
  const recountsPending = sessions.filter(
    (s) => s.status === 'RECOUNTING' || s.segments.some((seg) => seg.status === 'DISCREPANCY_RECOUNT')
  ).length;
  const approvedAudits = sessions.filter((s) => s.status === 'APPROVED_POSTED').length;

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
                Stocktake & Double Counting Master
              </h1>
              <p className="text-xs text-slate-400">
                Segmented physical stock takes with blind double counting, recount verification & super user approval
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setShowNewModal(true)}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/30 flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          Start New Stocktake Session
        </button>
      </div>

      {/* KPI Cards */}
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="text-xs text-slate-400 font-medium">Total Audits Conducted</div>
          <div className="text-2xl font-bold font-mono text-white mt-1">{totalAudits}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Historical stocktakes</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="text-xs text-slate-400 font-medium">Active Floor Counts</div>
          <div className="text-2xl font-bold font-mono text-blue-400 mt-1">{activeAudits}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Draft, Counting & Consolidation</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="text-xs text-slate-400 font-medium">Discrepancy Recounts</div>
          <div className="text-2xl font-bold font-mono text-amber-400 mt-1">{recountsPending}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Counter A vs B mismatches</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="text-xs text-slate-400 font-medium">Committed & Approved</div>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{approvedAudits}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Master stock updated</div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="max-w-7xl mx-auto bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search audit sessions by title, ID, branch..."
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({sessions.length})
            </button>
            <button
              onClick={() => setStatusFilter('ACTIVE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusFilter === 'ACTIVE' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active ({activeAudits})
            </button>
            <button
              onClick={() => setStatusFilter('RECOUNT')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusFilter === 'RECOUNT' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Recounts ({recountsPending})
            </button>
            <button
              onClick={() => setStatusFilter('APPROVED')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                statusFilter === 'APPROVED' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Approved ({approvedAudits})
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

          return (
            <div
              key={s.sessionId}
              onClick={() => setSelectedSession(s)}
              className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl p-5 cursor-pointer transition shadow-lg flex flex-col justify-between gap-4 group"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-950 text-blue-400 border border-slate-800">
                    {s.sessionId}
                  </span>
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

                <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{s.date}</span>
                  <span>•</span>
                  <span>{s.branchName}</span>
                </div>

                {/* Segments progress bar */}
                <div className="mt-4 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-400 font-medium">Floor Segment Double Counts:</span>
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
              Start a new stocktake session to segment your shop floor and begin double counting.
            </p>
            <button
              onClick={() => setShowNewModal(true)}
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
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">Create New Stocktake Session</h3>
              </div>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Audit Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., End-of-Month Floor Double Count Audit"
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
                  <label className="block text-slate-300 font-semibold mb-1">Store / Branch</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Shop Floor Segments (One per line)
                </label>
                <textarea
                  rows={4}
                  value={customSegments}
                  onChange={(e) => setCustomSegments(e.target.value)}
                  placeholder="Aisle 1 - Beverages&#10;Aisle 2 - Groceries&#10;Back Storeroom"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Two counters will be assigned to each segment for independent double-blind verification.
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Audit Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g., Full physical count prior to monthly reconciliation."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
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
