import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  KeyRound,
  Phone,
  Shield,
  Trash2,
  CheckCircle,
  Copy,
  Clock,
  Layers,
  Search,
  BadgeAlert,
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
} from '../../db/roomDatabase';

interface CasualWorkersTabProps {
  session: StocktakeSession;
  currentUser: Salesperson | null;
  onRefreshSession: () => void;
}

export const CasualWorkersTab: React.FC<CasualWorkersTabProps> = ({
  session,
  currentUser,
  onRefreshSession,
}) => {
  const [casuals, setCasuals] = useState<TemporaryCasualAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState(String(Math.floor(1000 + Math.random() * 9000)));
  const [badgeNumber, setBadgeNumber] = useState('');
  const [assignedSegmentId, setAssignedSegmentId] = useState('');
  const [assignedGroup, setAssignedGroup] = useState<'GROUP_1' | 'GROUP_2'>('GROUP_1');
  const [copiedPinId, setCopiedPinId] = useState<string | null>(null);

  const loadData = () => {
    const list = getTemporaryCasuals(session.sessionId);
    setCasuals(list);
  };

  useEffect(() => {
    loadData();
  }, [session.sessionId]);

  const handleCreateCasual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !pin.trim()) return;

    addTemporaryCasual({
      sessionId: session.sessionId,
      name: name.trim(),
      phone: phone.trim(),
      pin: pin.trim(),
      badgeNumber: badgeNumber.trim() || undefined,
      assignedSegmentId: assignedSegmentId || undefined,
      assignedGroup,
    });

    loadData();
    setShowAddModal(false);
    setName('');
    setPhone('');
    setBadgeNumber('');
    setAssignedSegmentId('');
    setPin(String(Math.floor(1000 + Math.random() * 9000)));
    onRefreshSession();
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this temporary casual worker account?')) {
      deleteTemporaryCasual(id);
      loadData();
      onRefreshSession();
    }
  };

  const handleCopyPin = (cPin: string, cId: string) => {
    navigator.clipboard.writeText(cPin);
    setCopiedPinId(cId);
    setTimeout(() => setCopiedPinId(null), 2000);
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredCasuals = casuals.filter((c) => {
    return (
      q === '' ||
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.badgeNumber && c.badgeNumber.toLowerCase().includes(q)) ||
      (c.pin && c.pin.includes(q))
    );
  });

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
              Temporary Casual Staff & PIN Access Control
            </h3>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              Casual workers hired for stocktake are assigned 4-digit PINs to log into organizational counting terminals. Their real names and phone numbers are registered so if any discrepancy or audit question arises later, supervisors can identify exactly who counted that segment.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-900/30 flex items-center gap-2 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Register Casual Worker
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Active Casual Accounts</div>
          <div className="text-2xl font-bold font-mono text-white mt-1">{casuals.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Assigned to floor count terminals</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Group 1 & 2 Distribution</div>
          <div className="text-sm font-semibold text-slate-200 mt-1.5 flex items-center gap-2">
            <span className="text-blue-400">
              G1: {casuals.filter((c) => c.assignedGroup === 'GROUP_1').length}
            </span>
            <span>•</span>
            <span className="text-purple-400">
              G2: {casuals.filter((c) => c.assignedGroup === 'GROUP_2').length}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Paired blind counter allocation</div>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
          <div className="text-xs text-slate-400 font-medium">Post-Audit Expiry</div>
          <div className="text-sm font-semibold text-emerald-400 mt-1.5 flex items-center gap-1.5">
            <Shield className="w-4 h-4" /> Temporary Session Scope
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Automatically archived after commit</div>
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
            placeholder="Search casual by name, phone, PIN, badge..."
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
              {filteredCasuals.map((c) => {
                const seg = session.segments.find((s) => s.segmentId === c.assignedSegmentId);

                return (
                  <tr key={c.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">{c.id}</td>
                    <td className="py-3 px-4 font-semibold text-white">{c.name}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 font-mono text-slate-300">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {c.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleCopyPin(c.pin, c.id)}
                        className="px-2.5 py-1 bg-slate-950 border border-slate-700 hover:border-amber-500 rounded font-mono font-bold text-amber-300 tracking-wider inline-flex items-center gap-1.5 transition"
                        title="Click to Copy PIN"
                      >
                        <KeyRound className="w-3 h-3 text-amber-400" />
                        {c.pin}
                        {copiedPinId === c.id && (
                          <span className="text-[10px] text-emerald-400 font-sans font-normal">
                            Copied!
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {c.badgeNumber || 'None'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
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
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition"
                        title="Delete casual account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
                <label className="block text-slate-300 font-semibold mb-1">Casual Full Name *</label>
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
                  <label className="block text-slate-300 font-semibold mb-1">4-Digit Security PIN *</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      maxLength={4}
                      required
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="e.g. 4821"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono font-bold tracking-widest text-center"
                    />
                    <button
                      type="button"
                      onClick={() => setPin(String(Math.floor(1000 + Math.random() * 9000)))}
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
              </div>

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
    </div>
  );
};
