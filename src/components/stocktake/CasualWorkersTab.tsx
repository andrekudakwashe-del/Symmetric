import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Plus,
  KeyRound,
  Phone,
  Shield,
  Trash2,
  CheckCircle,
  Search,
  Share2,
  Building2,
  UserPlus,
  ShieldAlert,
} from 'lucide-react';
import {
  StocktakeSession,
  TemporaryCasualAccount,
  Salesperson,
} from '../../types';
import {
  getTemporaryCasuals,
  addTemporaryCasual,
  deleteTemporaryCasual,
  getBranches,
  getSalespeople,
  isStaffAssignedToBranch,
  addStocktakeGuestPass,
  revokeStocktakeGuestPass,
} from '../../db/roomDatabase';
import {
  isStocktakeLeader,
  isStocktakeAuditor,
} from '../../services/stocktakeAccessService';
import { meshSyncService } from '../../services/meshSyncService';

interface CasualWorkersTabProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onRefreshSession: (updated?: StocktakeSession) => void;
}

export const CasualWorkersTab: React.FC<CasualWorkersTabProps> = ({
  session,
  currentUser,
  onRefreshSession,
}) => {
  const canManage = isStocktakeLeader(currentUser) || isStocktakeAuditor(currentUser, session);

  const [casuals, setCasuals] = useState<TemporaryCasualAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingDeleteCasualId, setPendingDeleteCasualId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Casual / External Consultant Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState(String(Math.floor(1000 + Math.random() * 9000)));
  const [badgeNumber, setBadgeNumber] = useState('');
  const [assignedSegmentId, setAssignedSegmentId] = useState('');
  const [assignedGroup, setAssignedGroup] = useState<'GROUP_1' | 'GROUP_2'>('GROUP_1');
  const [tempRole, setTempRole] = useState<'COUNTER' | 'AUDITOR'>('COUNTER');

  // Cross-Branch Visiting Counter Guest Pass State (Phase 2)
  const [showGuestModal, setShowGuestModal] = useState(false);
  const allBranches = useMemo(() => getBranches(), []);
  const allStaff = useMemo(
    () => getSalespeople().filter((s) => s.active !== 'N'),
    [showGuestModal]
  );
  const otherBranches = useMemo(
    () =>
      allBranches.filter(
        (b) =>
          String(b.branchId || b.id || '').trim().toUpperCase() !==
          String(session.branchId || '').trim().toUpperCase()
      ),
    [allBranches, session.branchId]
  );

  const [guestHomeBranchId, setGuestHomeBranchId] = useState<string>(() => {
    const firstOther = otherBranches[0];
    return firstOther ? firstOther.branchId || firstOther.id : '';
  });
  const [guestStaffId, setGuestStaffId] = useState<string>('');
  const [guestGroup, setGuestGroup] = useState<'GROUP_1' | 'GROUP_2'>('GROUP_1');
  const [guestPassRole, setGuestPassRole] = useState<'COUNTER' | 'AUDITOR'>('COUNTER');
  const [guestSegmentId, setGuestSegmentId] = useState<string>('');

  const availableVisitingStaff = useMemo(() => {
    if (guestHomeBranchId) {
      const assigned = allStaff.filter((s) => isStaffAssignedToBranch(s, guestHomeBranchId));
      if (assigned.length > 0) return assigned;
    }
    return allStaff;
  }, [allStaff, guestHomeBranchId]);

  const showNotice = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 4500);
  };

  const loadData = () => {
    const list = getTemporaryCasuals(session.sessionId);
    setCasuals(list);
  };

  useEffect(() => {
    loadData();
  }, [session.sessionId]);

  const handleCreateCasual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (!name.trim() || !phone.trim() || !pin.trim()) return;

    addTemporaryCasual({
      sessionId: session.sessionId,
      branchId: session.branchId,
      name: name.trim(),
      phone: phone.trim(),
      pin: pin.trim(),
      badgeNumber: badgeNumber.trim() || undefined,
      assignedSegmentId: tempRole === 'AUDITOR' ? undefined : assignedSegmentId || undefined,
      assignedGroup: tempRole === 'AUDITOR' ? undefined : assignedGroup,
      tempRole,
      isExternalConsultant: tempRole === 'AUDITOR',
    });

    const updated = getTemporaryCasuals();
    meshSyncService.broadcastCasualWorkers(updated);

    loadData();
    setShowAddModal(false);
    setName('');
    setPhone('');
    setBadgeNumber('');
    setAssignedSegmentId('');
    setTempRole('COUNTER');
    setPin(String(Math.floor(1000 + Math.random() * 9000)));
    onRefreshSession();
    showNotice(
      tempRole === 'AUDITOR'
        ? 'External Consultant Auditor registered and synced to Local Hub.'
        : 'Casual worker registered and synced to Local Hub.'
    );
  };

  const handleConfirmDeleteCasual = (id: string) => {
    if (!canManage) return;
    deleteTemporaryCasual(id);
    const updated = getTemporaryCasuals();
    meshSyncService.broadcastCasualWorkers(updated);
    setPendingDeleteCasualId(null);
    loadData();
    onRefreshSession();
    showNotice('Casual worker account removed.');
  };

  const handleSyncToHub = () => {
    const list = getTemporaryCasuals();
    meshSyncService.broadcastCasualWorkers(list);
    meshSyncService.broadcastStocktakeSession(session);
    showNotice(
      `Synced ${list.length} casual account(s) and ${(session.guestPasses || []).length} guest pass(es) to Local Wi-Fi Hub.`
    );
  };

  const handleGrantGuestPass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !guestStaffId) return;
    const staffMember = allStaff.find((s) => s.id === guestStaffId);
    if (!staffMember) return;
    const homeBranch = allBranches.find(
      (b) => (b.branchId || b.id) === guestHomeBranchId
    );

    const res = addStocktakeGuestPass(session.sessionId, {
      staffId: staffMember.id,
      staffName: staffMember.name,
      staffRole: staffMember.role,
      passRole: guestPassRole,
      homeBranchId: guestHomeBranchId || staffMember.branchId || 'HQ',
      homeBranchName: homeBranch?.name || guestHomeBranchId || 'Other Branch',
      assignedGroup: guestPassRole === 'AUDITOR' ? undefined : guestGroup,
      assignedSegmentIds: guestPassRole === 'AUDITOR' ? undefined : (guestSegmentId ? [guestSegmentId] : undefined),
      grantedById: currentUser?.id || 'AUD-LOCAL',
      grantedByName: currentUser?.name || 'Stocktake Auditor',
    });

    if (res.success && res.session) {
      meshSyncService.broadcastStocktakeSession(res.session);
      onRefreshSession(res.session);
      setShowGuestModal(false);
      setGuestStaffId('');
      setGuestSegmentId('');
      setGuestPassRole('COUNTER');
      showNotice(res.message);
    }
  };

  const handleRevokeGuestPass = (passId: string) => {
    if (!canManage) return;
    const res = revokeStocktakeGuestPass(session.sessionId, passId);
    if (res.success && res.session) {
      meshSyncService.broadcastStocktakeSession(res.session);
      onRefreshSession(res.session);
      showNotice('Visiting counter guest pass revoked.');
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredCasuals = casuals.filter((c) => {
    return (
      q === '' ||
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.badgeNumber && c.badgeNumber.toLowerCase().includes(q))
    );
  });

  const guestPasses = session.guestPasses || [];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-amber-950/60 to-slate-900 border border-amber-800/60 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Temporary Casual Staff & Cross-Branch Visiting Team Passes
            </h3>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              Manage 4-digit PIN casual counters and time-boxed Cross-Branch Visiting Stocktake Passes. All casual accounts and guest passes automatically deactivate when the Store Owner commits this stocktake.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSyncToHub}
            className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-600/40 rounded-xl text-xs font-bold shadow flex items-center gap-1.5 transition"
            title="Broadcast casual worker PINs and visiting passes to all tablets via Local Hub"
          >
            <Share2 className="w-4 h-4 text-amber-400" />
            Sync to Hub
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => {
                  const firstOther = otherBranches[0];
                  setGuestHomeBranchId(firstOther ? firstOther.branchId || firstOther.id : '');
                  setShowGuestModal(true);
                }}
                className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-900/30 flex items-center gap-1.5 transition"
              >
                <UserPlus className="w-4 h-4" />
                Grant Visiting Pass
              </button>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition"
              >
                <Plus className="w-4 h-4" />
                Register Casual Worker
              </button>
            </>
          )}
        </div>
      </div>

      {feedbackMessage && (
        <div className="bg-emerald-950/60 border border-emerald-700/70 rounded-xl p-3 text-xs text-emerald-200 font-semibold flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Active Casual Accounts</div>
          <div className="text-2xl font-bold font-mono text-white mt-1">
            {casuals.filter((c) => c.active).length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Local stocktake floor counters</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Cross-Branch Visiting Passes</div>
          <div className="text-2xl font-bold font-mono text-indigo-400 mt-1">
            {guestPasses.filter((g) => g.active).length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">External branch staff on temporary pass</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Post-Audit Expiry</div>
          <div className="text-sm font-semibold text-emerald-400 mt-1.5 flex items-center gap-1.5">
            <Shield className="w-4 h-4" /> Auto-Revoke on Commit
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Home branch rosters remain untouched</div>
        </div>
      </div>

      {/* Cross-Branch Visiting Counter Passes Section */}
      <div className="bg-slate-900/90 rounded-2xl border border-indigo-800/40 overflow-hidden shadow-lg">
        <div className="px-5 py-3.5 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-indigo-400" />
            <h4 className="text-sm font-bold text-white">
              Cross-Branch Visiting Stocktake Passes ({guestPasses.filter((g) => g.active).length} Active)
            </h4>
          </div>
          <span className="text-[11px] text-slate-400">
            Staff log in via "Visiting Stocktake Team" on Host Branch terminal using their normal 6-digit PIN
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/50 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
              <tr>
                <th className="py-2.5 px-4">Pass ID</th>
                <th className="py-2.5 px-4">Visiting Staff</th>
                <th className="py-2.5 px-4">Home Branch</th>
                <th className="py-2.5 px-4">Count Team & Scope</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {guestPasses.map((gp) => {
                const segNames = (gp.assignedSegmentIds || [])
                  .map((id) => session.segments.find((s) => s.segmentId === id)?.name || id)
                  .join(', ');
                return (
                  <tr key={gp.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-4 font-mono font-bold text-indigo-400">{gp.id}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-white">{gp.staffName}</div>
                      <div className="text-[10px] text-slate-400">{gp.staffRole || 'STAFF'} • ID #{gp.staffId}</div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-300">
                      {gp.homeBranchName || gp.homeBranchId}
                    </td>
                    <td className="py-2.5 px-4">
                      {gp.passRole === 'AUDITOR' ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-950 text-amber-300 border-amber-700">
                          AUDITOR PASS
                        </span>
                      ) : (
                        <>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              gp.assignedGroup === 'GROUP_2'
                                ? 'bg-purple-950 text-purple-300 border-purple-800'
                                : 'bg-blue-950 text-blue-300 border-blue-800'
                            }`}
                          >
                            {gp.assignedGroup === 'GROUP_2' ? 'Group 2 (Team B)' : 'Group 1 (Team A)'}
                          </span>
                          <span className="ml-2 text-[11px] text-slate-400">
                            {segNames || 'All Segments (Blind)'}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {gp.active ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                          ACTIVE PASS
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                          REVOKED
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {canManage && gp.active && (
                        <button
                          type="button"
                          onClick={() => handleRevokeGuestPass(gp.id)}
                          className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[11px] font-semibold transition"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {guestPasses.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    <Building2 className="w-8 h-8 mx-auto mb-1.5 opacity-40" />
                    <p className="font-semibold text-slate-400">No cross-branch visiting passes issued</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Grant a Visiting Pass when permanent staff from other branches assist with this lockdown stocktake.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Search Toolbar */}
      <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search casual by name, phone, badge..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Casual Workers Table */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
              <tr>
                <th className="py-3 px-4">Account ID</th>
                <th className="py-3 px-4">Casual Worker Name</th>
                <th className="py-3 px-4">Phone Number</th>
                <th className="py-3 px-4 text-center">4-Digit PIN</th>
                <th className="py-3 px-4">Badge / ID</th>
                <th className="py-3 px-4">Assigned Segment & Group</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {filteredCasuals.map((c, cIdx) => {
                const seg = session.segments.find((s) => s.segmentId === c.assignedSegmentId);

                return (
                  <tr key={`${c.id}-${cIdx}`} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">{c.id}</td>
                    <td className="py-3 px-4 font-semibold text-white">
                      {c.name}
                      {!c.active && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          EXPIRED
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 font-mono text-slate-300">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {c.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className="px-2.5 py-1 bg-slate-950/80 border border-emerald-700/60 rounded font-mono text-xs font-semibold text-emerald-400 inline-flex items-center gap-1.5"
                        title="Casual worker PIN is hashed with SHA-256 and salted"
                      >
                        <KeyRound className="w-3 h-3 text-emerald-400" />
                        •••• (Hashed)
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {c.badgeNumber || 'None'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {c.tempRole === 'AUDITOR' || c.isExternalConsultant ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-950 text-amber-300 border-amber-700">
                            EXTERNAL AUDITOR
                          </span>
                        ) : (
                          <>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                c.assignedGroup === 'GROUP_1'
                                  ? 'bg-blue-950 text-blue-300 border-blue-800'
                                  : 'bg-purple-950 text-purple-300 border-purple-800'
                              }`}
                            >
                              {c.assignedGroup === 'GROUP_1' ? 'Group 1 (Count 1)' : 'Group 2 (Count 2)'}
                            </span>
                            <span className="text-slate-400 text-[11px]">
                              {seg ? seg.name : 'Floating / All'}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {canManage &&
                        (pendingDeleteCasualId === c.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleConfirmDeleteCasual(c.id)}
                              className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteCasualId(null)}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPendingDeleteCasualId(c.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                            title="Delete casual account"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}

              {filteredCasuals.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="font-semibold text-slate-400">No temporary casual accounts registered</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Register casual counters with a phone number and 4-digit PIN so their counts are audited and tracked.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Casual Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Register Casual Worker</h3>
                  <p className="text-xs text-slate-400">Temporary counting account with PIN</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCasual} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Temporary Account Role *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTempRole('COUNTER');
                      setPin(String(Math.floor(1000 + Math.random() * 9000)));
                    }}
                    className={`py-2 px-3 rounded-lg border font-bold text-xs transition ${
                      tempRole === 'COUNTER'
                        ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                        : 'bg-slate-950 border-slate-700 text-slate-400'
                    }`}
                  >
                    Floor Counter (4-Digit PIN)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTempRole('AUDITOR');
                      setPin(String(Math.floor(100000 + Math.random() * 900000)));
                    }}
                    className={`py-2 px-3 rounded-lg border font-bold text-xs transition ${
                      tempRole === 'AUDITOR'
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                        : 'bg-slate-950 border-slate-700 text-slate-400'
                    }`}
                  >
                    External Consultant / Auditor
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  {tempRole === 'AUDITOR' ? 'Consultant Full Name *' : 'Casual Full Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Tinashe Moyo"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Phone Number *</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+263 77..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Required for post-stocktake queries</p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    {tempRole === 'AUDITOR' ? '4–6 Digit Security PIN *' : '4-Digit Security PIN *'}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      maxLength={tempRole === 'AUDITOR' ? 6 : 4}
                      required
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      placeholder={tempRole === 'AUDITOR' ? 'e.g. 482910' : 'e.g. 4821'}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold tracking-widest text-center"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setPin(
                          tempRole === 'AUDITOR'
                            ? String(Math.floor(100000 + Math.random() * 900000))
                            : String(Math.floor(1000 + Math.random() * 9000))
                        )
                      }
                      className="px-2 py-2 bg-slate-800 hover:bg-slate-700 rounded text-[10px] text-amber-300 font-semibold shrink-0"
                      title="Generate new PIN"
                    >
                      Gen
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Badge / Physical ID</label>
                  <input
                    type="text"
                    value={badgeNumber}
                    onChange={(e) => setBadgeNumber(e.target.value)}
                    placeholder="e.g. BADGE-04"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                  />
                </div>

                {tempRole === 'COUNTER' ? (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Assigned Count Group</label>
                    <select
                      value={assignedGroup}
                      onChange={(e) => setAssignedGroup(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                    >
                      <option value="GROUP_1">Group 1 (First Blind Pass)</option>
                      <option value="GROUP_2">Group 2 (Second Blind Pass)</option>
                    </select>
                  </div>
                ) : (
                  <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-2 flex items-center text-[11px] text-amber-200">
                    Can supervise segments, view consolidated variance & certify readiness. Cannot commit stock.
                  </div>
                )}
              </div>

              {tempRole === 'COUNTER' && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Assigned Segment (Optional)</label>
                  <select
                    value={assignedSegmentId}
                    onChange={(e) => setAssignedSegmentId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="">-- Floating across all segments --</option>
                    {session.segments.map((s) => (
                      <option key={s.segmentId} value={s.segmentId}>
                        {s.name} ({s.locationCode || s.segmentId})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold shadow-lg"
                >
                  Create & Issue PIN
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grant Cross-Branch Visiting Counter Guest Pass Modal */}
      {showGuestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-indigo-700/70 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Grant Visiting Stocktake Pass</h3>
                  <p className="text-xs text-slate-400">
                    Temporary blind-counter access on {session.branchName || session.branchId}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuestModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGrantGuestPass} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Staff Member Home Branch</label>
                <select
                  value={guestHomeBranchId}
                  onChange={(e) => {
                    setGuestHomeBranchId(e.target.value);
                    setGuestStaffId('');
                  }}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">-- All Branches --</option>
                  {allBranches.map((b) => {
                    const bid = b.branchId || b.id;
                    return (
                      <option key={bid} value={bid}>
                        {b.name || b.code} ({bid})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Select Visiting Staff Member *</label>
                <select
                  required
                  value={guestStaffId}
                  onChange={(e) => setGuestStaffId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">-- Choose Staff Member --</option>
                  {availableVisitingStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role} • #{s.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Pass Role on Host Branch *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setGuestPassRole('COUNTER')}
                    className={`py-2 px-3 rounded-lg border font-bold text-xs transition ${
                      guestPassRole === 'COUNTER'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                        : 'bg-slate-950 border-slate-700 text-slate-400'
                    }`}
                  >
                    Blind Floor Counter
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuestPassRole('AUDITOR')}
                    className={`py-2 px-3 rounded-lg border font-bold text-xs transition ${
                      guestPassRole === 'AUDITOR'
                        ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                        : 'bg-slate-950 border-slate-700 text-slate-400'
                    }`}
                  >
                    Visiting Stocktake Auditor
                  </button>
                </div>
              </div>

              {guestPassRole === 'COUNTER' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Assigned Count Group</label>
                    <select
                      value={guestGroup}
                      onChange={(e) => setGuestGroup(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="GROUP_1">Group 1 (Team A)</option>
                      <option value="GROUP_2">Group 2 (Team B)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Assigned Segment</label>
                    <select
                      value={guestSegmentId}
                      onChange={(e) => setGuestSegmentId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">-- Floating / All --</option>
                      {session.segments.map((s) => (
                        <option key={s.segmentId} value={s.segmentId}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-xl p-3 text-[11px] text-indigo-200 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <span>
                  {guestPassRole === 'AUDITOR'
                    ? 'Grants temporary Stocktake Auditor supervision & variance access on this session only. Expires automatically on Owner committal.'
                    : 'Pass grants Blind Counter access to this session only and expires automatically on committal without altering their home branch roster.'}
                </span>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGuestModal(false)}
                  className="px-3.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg"
                >
                  Issue Visiting Pass
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
