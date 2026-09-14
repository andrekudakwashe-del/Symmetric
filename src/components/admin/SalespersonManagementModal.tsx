import React, { useState } from 'react';
import { Salesperson, Role, ActiveStatus } from '../../types';
import {
  getSalespeople,
  addSalesperson,
  updateSalesperson,
  toggleSalespersonActive,
  getNextSalespersonId,
} from '../../db/roomDatabase';
import { downloadCsvFile } from '../../services/googleSheetsSync';
import {
  Users,
  UserPlus,
  Shield,
  User,
  Phone,
  KeyRound,
  X,
  Check,
  Edit2,
  Power,
  PowerOff,
  Download,
  AlertCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface SalespersonManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson;
}

export const SalespersonManagementModal: React.FC<SalespersonManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const salespeople = getSalespeople();
  const nextId = getNextSalespersonId();

  const [isAdding, setIsAdding] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<Role>('Staff');
  const [phone, setPhone] = useState('');
  const [active, setActive] = useState<ActiveStatus>('Y');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartAdd = () => {
    setIsAdding(true);
    setEditingStaffId(null);
    setName('');
    setPin('');
    setRole('Staff');
    setPhone('');
    setActive('Y');
    setError(null);
  };

  const handleStartEdit = (staff: Salesperson) => {
    setIsAdding(false);
    setEditingStaffId(staff.id);
    setName(staff.name);
    setPin(staff.pin);
    setRole(staff.role);
    setPhone(staff.phone || '');
    setActive(staff.active);
    setError(null);
  };

  const handleCancelForm = () => {
    setIsAdding(false);
    setEditingStaffId(null);
    setError(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Salesperson name is required.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 numeric digits (e.g. 1234).');
      return;
    }

    try {
      if (editingStaffId) {
        updateSalesperson(editingStaffId, {
          name: name.trim(),
          pin,
          role,
          phone: phone.trim() || undefined,
          active,
        });
      } else {
        addSalesperson({
          name: name.trim(),
          pin,
          role,
          phone: phone.trim() || undefined,
          active,
        });
        confetti({
          particleCount: 30,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#6A4DFF', '#FF8A00'],
        });
      }
      handleCancelForm();
    } catch (err: any) {
      setError(err?.message || 'Failed to save salesperson.');
    }
  };

  const handleToggleStatus = (staffId: string) => {
    if (staffId === currentUser.id) {
      alert('You cannot deactivate your own currently active admin account.');
      return;
    }
    toggleSalespersonActive(staffId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn select-none">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[88vh] animate-scaleUp">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] p-4 sm:p-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">Admin: Salespeople Management</h2>
              <p className="text-xs text-white/80">
                DATABASE 1 • Add, Edit & Deactivate Sales Personnel (Starting ID 001)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Top Actions */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => downloadCsvFile('Salespeople')}
              className="py-2 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700 flex items-center space-x-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Salespeople CSV</span>
            </button>

            {!isAdding && !editingStaffId && (
              <button
                id="btn-add-salesperson-admin"
                type="button"
                onClick={handleStartAdd}
                className="py-2 px-3.5 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white text-xs font-bold shadow-md flex items-center space-x-1.5 transition"
              >
                <UserPlus className="w-4 h-4" />
                <span>+ Add Salesperson</span>
              </button>
            )}
          </div>

          {/* Add / Edit Form */}
          {(isAdding || editingStaffId) && (
            <form
              onSubmit={handleSave}
              className="bg-slate-950/80 border border-purple-500/40 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3.5 animate-fadeIn"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                  {editingStaffId ? `Edit Salesperson #${editingStaffId}` : `New Salesperson (Assigned ID: #${nextId})`}
                </span>
                <span className="text-[10px] bg-orange-500/20 text-[#FF8A00] px-2 py-0.5 rounded font-mono-num font-bold">
                  {editingStaffId ? `#${editingStaffId}` : `#${nextId}`}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Full Name *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Tendai Chikore"
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white outline-none focus:border-[#6A4DFF]"
                    required
                    autoFocus
                  />
                </div>

                {/* 4-digit PIN */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">4-Digit Security PIN *</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 5678"
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white font-mono-num outline-none focus:border-[#6A4DFF]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Role */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white outline-none"
                  >
                    <option value="Staff">Staff (Standard)</option>
                    <option value="Admin">Admin (Full Access)</option>
                  </select>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+263 77 ..."
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white font-mono-num outline-none"
                  />
                </div>

                {/* Active */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Account Status</label>
                  <select
                    value={active}
                    onChange={(e) => setActive(e.target.value as ActiveStatus)}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white outline-none"
                  >
                    <option value="Y">Active (Y)</option>
                    <option value="N">Deactivated (N)</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="p-2 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center space-x-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white text-xs font-bold shadow-md flex items-center space-x-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{editingStaffId ? 'Update Staff' : 'Save Salesperson'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Salespeople List */}
          <div className="space-y-2.5">
            {salespeople.map((staff) => {
              const isActive = staff.active === 'Y';
              const isCurrent = staff.id === currentUser.id;

              return (
                <div
                  key={staff.id}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isActive
                      ? 'bg-slate-950/60 border-slate-800/80'
                      : 'bg-slate-950/30 border-slate-900 opacity-60'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-xs font-mono-num ${
                        staff.role === 'Admin'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                      }`}
                    >
                      {staff.id}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-white">{staff.name}</span>
                        {isCurrent && (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-bold">
                            You
                          </span>
                        )}
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                            staff.role === 'Admin'
                              ? 'bg-purple-950 text-purple-300 border border-purple-800'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {staff.role}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                            isActive
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                              : 'bg-rose-950 text-rose-400 border border-rose-800/50'
                          }`}
                        >
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>

                      <div className="text-xs text-slate-400 flex items-center space-x-3 mt-1 font-mono-num">
                        <span>PIN: ****</span>
                        {staff.phone && (
                          <>
                            <span>•</span>
                            <span>{staff.phone}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(staff)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center space-x-1"
                      title="Edit details"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Edit</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleStatus(staff.id)}
                      disabled={isCurrent}
                      title={isActive ? 'Deactivate staff' : 'Activate staff'}
                      className={`p-2 rounded-xl text-xs font-semibold flex items-center space-x-1 disabled:opacity-30 ${
                        isActive
                          ? 'bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300'
                          : 'bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800 text-emerald-300'
                      }`}
                    >
                      {isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                      <span className="text-[11px]">{isActive ? 'Deactivate' : 'Activate'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
