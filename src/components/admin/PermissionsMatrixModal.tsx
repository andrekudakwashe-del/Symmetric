import React, { useState, useEffect } from 'react';
import {
  Shield,
  Lock,
  Unlock,
  Check,
  X,
  Sliders,
  Sparkles,
  Info,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  getPermissionsList,
  savePermissionsList,
  updatePermissionRule,
  subscribeRoomDatabase,
} from '../../db/roomDatabase';
import { PermissionRule, MASTER_PERMISSIONS_52 } from '../../data/saasData';

interface PermissionsMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PermissionsMatrixModal: React.FC<PermissionsMatrixModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [permissions, setPermissions] = useState<PermissionRule[]>(() => getPermissionsList());
  const [selectedRole, setSelectedRole] = useState<string>('ALL');
  const [selectedSection, setSelectedSection] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [hasChanges, setHasChanges] = useState<boolean>(false);

  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      setPermissions(getPermissionsList());
    });
    return unsub;
  }, []);

  if (!isOpen) return null;

  const roles = ['ALL', 'CASHIER', 'SUPERVISOR', 'MANAGER', 'ADMIN', 'OWNER'];
  const sections = [
    'ALL',
    'Direct Supplier Deliveries',
    'Customer Ledger',
    'End of Day (EOD)',
    'Cash Drawer & Floats',
    'Price & Discounts',
    'Point of Sale (POS)',
    'Inventory & Stock',
    'Reports & Analytics',
    'Security & Staff',
    'Multi-Tenant SaaS',
  ];

  const handleToggle = (id: string, currentVal: boolean) => {
    updatePermissionRule(id, !currentVal);
    setHasChanges(true);
  };

  const handleResetToDefaults = () => {
    savePermissionsList(MASTER_PERMISSIONS_52);
    setHasChanges(false);
  };

  const filtered = permissions.filter((p) => {
    const matchRole = selectedRole === 'ALL' || p.role.toUpperCase() === selectedRole;
    const matchSection = selectedSection === 'ALL' || p.section === selectedSection;
    const q = (searchTerm || '').trim().toLowerCase();
    const matchSearch =
      q === '' ||
      (p.label && p.label.toLowerCase().includes(q)) ||
      (p.module && p.module.toLowerCase().includes(q)) ||
      (p.action && p.action.toLowerCase().includes(q));
    return matchRole && matchSection && matchSearch;
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full p-6 shadow-2xl space-y-5 max-h-[92vh] flex flex-col animate-fadeIn">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-white">52 Granular Permissions Matrix</h2>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-bold border border-indigo-500/30">
                  Role-Based Access Control (RBAC)
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Configure module, action, and restriction policies across all tenant roles
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetToDefaults}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 transition-all"
              title="Reset 52 permissions to master blueprint"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search permission or action..."
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Role Filter */}
          <div>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  Role: {r}
                </option>
              ))}
            </select>
          </div>

          {/* Section Filter */}
          <div>
            <select
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              {sections.map((s) => (
                <option key={s} value={s}>
                  Section: {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Permissions Table */}
        <div className="overflow-y-auto flex-1 rounded-2xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300 border-collapse">
            <thead className="bg-slate-950/80 sticky top-0 uppercase font-bold text-slate-400 border-b border-slate-800 z-10">
              <tr>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Section / Category</th>
                <th className="py-3 px-4">Permission Label</th>
                <th className="py-3 px-4 font-mono">Module / Action</th>
                <th className="py-3 px-4 text-center">Restricted</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
              {filtered.map((rule) => {
                const isOwner = rule.role === 'OWNER';
                return (
                  <tr key={rule.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-4 font-bold text-white">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                          rule.role === 'CASHIER'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            : rule.role === 'SUPERVISOR'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : rule.role === 'ADMIN'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {rule.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-400">{rule.section}</td>
                    <td className="py-2.5 px-4 font-medium text-white">{rule.label}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {rule.module} : {rule.action}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {rule.restricted ? (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/30">
                          Supervisor Required
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[10px]">Standard</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button
                        type="button"
                        disabled={isOwner}
                        onClick={() => handleToggle(rule.id, rule.allowed)}
                        className={`px-3 py-1 rounded-xl font-bold text-[11px] transition-all flex items-center justify-center gap-1.5 mx-auto ${
                          rule.allowed
                            ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/50'
                            : 'bg-slate-800 text-slate-500 border border-slate-700 hover:bg-slate-700 hover:text-slate-300'
                        } ${isOwner ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {rule.allowed ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <X className="w-3.5 h-3.5 text-slate-500" />}
                        {rule.allowed ? 'Allowed' : 'Locked'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400">
          <div>
            Showing {filtered.length} of {permissions.length} total permissions
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
