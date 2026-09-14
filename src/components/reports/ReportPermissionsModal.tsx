import React, { useState, useEffect } from 'react';
import { ShieldCheck, X, Check, Lock, Users, Save } from 'lucide-react';
import { SavedReportTemplate, RoleId } from '../../types';
import {
  getUserRoles,
  getReportPermissions,
  updateReportPermissions,
} from '../../db/reportService';

interface ReportPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SavedReportTemplate | null;
  onPermissionsUpdated?: () => void;
}

interface RolePermState {
  role_id: RoleId;
  role_name: string;
  can_view: boolean;
  can_edit: boolean;
  can_export: boolean;
}

export const ReportPermissionsModal: React.FC<ReportPermissionsModalProps> = ({
  isOpen,
  onClose,
  report,
  onPermissionsUpdated,
}) => {
  const [rolePerms, setRolePerms] = useState<RolePermState[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!report || !isOpen) return;

    const roles = getUserRoles();
    const existingPerms = getReportPermissions(report.id);

    const initialStates: RolePermState[] = roles.map((r) => {
      const match = existingPerms.find((p) => p.role_id === r.id);
      return {
        role_id: r.id,
        role_name: r.role_name,
        can_view: r.id === 'super_admin' ? true : match ? match.can_view : false,
        can_edit: r.id === 'super_admin' ? true : match ? match.can_edit : false,
        can_export: r.id === 'super_admin' ? true : match ? match.can_export : false,
      };
    });

    setRolePerms(initialStates);
    setSaveSuccess(false);
  }, [report, isOpen]);

  if (!isOpen || !report) return null;

  const handleToggle = (roleId: RoleId, field: 'can_view' | 'can_edit' | 'can_export') => {
    if (roleId === 'super_admin') return; // Super admin cannot be locked out

    setRolePerms((prev) =>
      prev.map((item) => {
        if (item.role_id !== roleId) return item;
        const updated = { ...item, [field]: !item[field] };
        // If unchecking can_view, edit and export must also be turned off
        if (field === 'can_view' && !updated.can_view) {
          updated.can_edit = false;
          updated.can_export = false;
        }
        // If checking can_edit or can_export, can_view must be true
        if ((field === 'can_edit' || field === 'can_export') && updated[field]) {
          updated.can_view = true;
        }
        return updated;
      })
    );
  };

  const handleSave = () => {
    updateReportPermissions(report.id, rolePerms);
    setSaveSuccess(true);
    if (onPermissionsUpdated) {
      onPermissionsUpdated();
    }
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center border border-purple-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <span>Share Report &amp; Role Permissions</span>
              </h3>
              <p className="text-xs text-slate-400">
                Grant view, edit, or export privileges for{' '}
                <span className="text-purple-300 font-bold font-mono">"{report.name}"</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-permissions-modal"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Roles Table */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="grid grid-cols-12 bg-slate-800/80 px-4 py-2.5 text-[11px] font-bold text-slate-300 border-b border-slate-700">
            <div className="col-span-5 flex items-center space-x-1.5">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>User Role</span>
            </div>
            <div className="col-span-2 text-center">Can View</div>
            <div className="col-span-2 text-center">Can Edit</div>
            <div className="col-span-3 text-center">Can Export</div>
          </div>

          <div className="divide-y divide-slate-800/60 text-xs">
            {rolePerms.map((rp) => {
              const isSuper = rp.role_id === 'super_admin';
              return (
                <div
                  key={rp.role_id}
                  className="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-800/30 transition"
                >
                  <div className="col-span-5">
                    <div className="font-bold text-slate-200 flex items-center space-x-1.5">
                      <span>{rp.role_name}</span>
                      {isSuper && (
                        <span className="text-[10px] bg-purple-950 text-purple-300 font-mono px-1.5 py-0.5 rounded border border-purple-800">
                          ALL
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Role ID: {rp.role_id}
                    </div>
                  </div>

                  {/* Can View */}
                  <div className="col-span-2 flex justify-center">
                    <button
                      type="button"
                      disabled={isSuper}
                      onClick={() => handleToggle(rp.role_id, 'can_view')}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition border ${
                        rp.can_view
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-600 hover:border-slate-500'
                      } ${isSuper ? 'cursor-not-allowed opacity-80' : ''}`}
                    >
                      {rp.can_view && <Check className="w-4 h-4 stroke-[3]" />}
                    </button>
                  </div>

                  {/* Can Edit */}
                  <div className="col-span-2 flex justify-center">
                    <button
                      type="button"
                      disabled={isSuper || !rp.can_view}
                      onClick={() => handleToggle(rp.role_id, 'can_edit')}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition border ${
                        rp.can_edit
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-600 hover:border-slate-500'
                      } ${isSuper || !rp.can_view ? 'cursor-not-allowed opacity-80' : ''}`}
                    >
                      {rp.can_edit && <Check className="w-4 h-4 stroke-[3]" />}
                    </button>
                  </div>

                  {/* Can Export */}
                  <div className="col-span-3 flex justify-center">
                    <button
                      type="button"
                      disabled={isSuper || !rp.can_view}
                      onClick={() => handleToggle(rp.role_id, 'can_export')}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition border ${
                        rp.can_export
                          ? 'bg-amber-600 border-amber-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-600 hover:border-slate-500'
                      } ${isSuper || !rp.can_view ? 'cursor-not-allowed opacity-80' : ''}`}
                    >
                      {rp.can_export && <Check className="w-4 h-4 stroke-[3]" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Security Rule Footer info */}
        <div className="flex items-center justify-between text-xs text-slate-400 bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80">
          <div className="flex items-center space-x-2">
            <Lock className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              Users only see reports with <span className="text-emerald-400 font-bold">can_view=true</span> in their Reports view.
            </span>
          </div>
          {saveSuccess && (
            <span className="text-emerald-400 font-bold flex items-center space-x-1">
              <Check className="w-4 h-4" />
              <span>Saved!</span>
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
          >
            Cancel
          </button>
          <button
            type="button"
            id="btn-save-report-permissions"
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-purple-900/30 transition"
          >
            <Save className="w-4 h-4" />
            <span>Apply Role Permissions</span>
          </button>
        </div>
      </div>
    </div>
  );
};
