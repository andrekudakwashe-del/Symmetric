import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  ArrowLeft,
  Search,
  MapPin,
  FileSpreadsheet,
  Layers,
  X,
  ShieldAlert,
  Lock,
  Users,
  BadgeCheck,
  Check,
  Briefcase,
} from 'lucide-react';
import {
  getBranches,
  saveBranch,
  deleteBranch,
  getSalespeople,
  getCurrentBranchId,
  getCurrentCompany,
  subscribeRoomDatabase,
  addAuditLog,
  isStaffAssignedToBranch,
  getStaffRoleInBranch,
  updateStaffBranchAssignments,
} from '../../db/roomDatabase';
import { Branch, Salesperson, StaffBranchAssignment } from '../../types';

interface BranchSetupScreenProps {
  currentUser?: Salesperson | null;
  onNavigateHome?: () => void;
  onNavigateTab?: (tab: any) => void;
}

export const BranchSetupScreen: React.FC<BranchSetupScreenProps> = ({
  currentUser,
  onNavigateHome,
  onNavigateTab,
}) => {
  const [branches, setBranches] = useState<Branch[]>(() => getBranches());
  const [staffList, setStaffList] = useState<Salesperson[]>(() => getSalespeople());
  const [searchTerm, setSearchTerm] = useState('');
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Dedicated Team Setup Modal states
  const [selectedBranchForTeam, setSelectedBranchForTeam] = useState<Branch | null>(null);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [teamSearchTerm, setTeamSearchTerm] = useState('');
  const [teamAssignments, setTeamAssignments] = useState<
    Record<string, { assigned: boolean; role: 'BRANCH_MANAGER' | 'SUPERVISOR' | 'CASHIER' | 'STOCK_CLERK' }>
  >({});

  // Form states (Add/Edit Branch)
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formSheetId, setFormSheetId] = useState('');
  const [formManagerId, setFormManagerId] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState('');
  const [showFormTeamConfig, setShowFormTeamConfig] = useState(false);

  const company = getCurrentCompany();

  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    (currentUser?.role as string) === 'super_admin' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';
  const isOwner = currentUser?.role === 'OWNER';
  const canManageBranches = isSuperAdmin || isOwner;
  const userAssignedBranchId = currentUser?.branchId || currentUser?.branch_id;

  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      setBranches(getBranches());
      setStaffList(getSalespeople());
    });
    return unsub;
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleOpenAdd = () => {
    if (!canManageBranches) {
      showToast('Permission Denied: Only Business Owners or Super Admins can add new branches.');
      return;
    }
    setEditingBranch(null);
    setFormName('');
    const count = branches.length + 1;
    setFormCode(`BR-0${count}`);
    setFormAddress('');
    setFormSheetId(`POS_${company.company_name.replace(/\s+/g, '_')}_Branch${count}_2026.xlsx`);
    setFormManagerId(staffList[0]?.id || '');
    setFormIsActive(true);
    setFormError('');
    setShowFormTeamConfig(false);

    // Initialize team assignments with unassigned default
    const initAssign: Record<string, { assigned: boolean; role: 'BRANCH_MANAGER' | 'SUPERVISOR' | 'CASHIER' | 'STOCK_CLERK' }> = {};
    staffList.forEach((s) => {
      initAssign[s.id] = { assigned: false, role: 'CASHIER' };
    });
    setTeamAssignments(initAssign);

    setIsModalOpen(true);
  };

  const handleOpenEdit = (branch: Branch) => {
    if (!canManageBranches) {
      showToast('Permission Denied: Only Business Owners or Super Admins can edit branch configuration.');
      return;
    }
    const bId = branch.branchId || branch.id || (branch as any).branch_id;
    setEditingBranch(branch);
    setFormName(branch.name);
    setFormCode(branch.code || '');
    setFormAddress(branch.address || branch.location || '');
    setFormSheetId(branch.sheet_id || '');
    setFormManagerId(branch.manager_id || '');
    setFormIsActive(branch.is_active ?? true);
    setFormError('');
    setShowFormTeamConfig(false);

    // Initialize team assignments for this branch
    const initAssign: Record<string, { assigned: boolean; role: 'BRANCH_MANAGER' | 'SUPERVISOR' | 'CASHIER' | 'STOCK_CLERK' }> = {};
    staffList.forEach((s) => {
      const assigned = isStaffAssignedToBranch(s, bId);
      const role = getStaffRoleInBranch(s, bId);
      initAssign[s.id] = {
        assigned,
        role: (['BRANCH_MANAGER', 'SUPERVISOR', 'CASHIER', 'STOCK_CLERK'].includes(role) ? role : 'CASHIER') as any,
      };
    });
    setTeamAssignments(initAssign);

    setIsModalOpen(true);
  };

  const handleOpenTeamSetup = (branch: Branch) => {
    if (!canManageBranches) {
      showToast('Permission Denied: Only Business Owners can configure branch teams and roles.');
      return;
    }
    const bId = branch.branchId || branch.id || (branch as any).branch_id;
    const initAssign: Record<string, { assigned: boolean; role: 'BRANCH_MANAGER' | 'SUPERVISOR' | 'CASHIER' | 'STOCK_CLERK' }> = {};
    
    staffList.forEach((s) => {
      const assigned = isStaffAssignedToBranch(s, bId);
      const role = getStaffRoleInBranch(s, bId);
      initAssign[s.id] = {
        assigned,
        role: (['BRANCH_MANAGER', 'SUPERVISOR', 'CASHIER', 'STOCK_CLERK'].includes(role) ? role : 'CASHIER') as any,
      };
    });

    setSelectedBranchForTeam(branch);
    setTeamAssignments(initAssign);
    setTeamSearchTerm('');
    setIsTeamModalOpen(true);
  };

  const handleSaveTeamSetup = () => {
    if (!selectedBranchForTeam) return;
    const bId = selectedBranchForTeam.branchId || selectedBranchForTeam.id || (selectedBranchForTeam as any).branch_id;
    
    let assignedManagerId = selectedBranchForTeam.manager_id || '';
    let assignedManagerName = selectedBranchForTeam.manager_name || '';

    // Persist assignments for each staff member
    staffList.forEach((staff) => {
      const config = teamAssignments[staff.id];
      if (!config) return;

      const existing = (staff.branchAssignments || []).filter((a) => a.branchId !== bId);

      if (config.assigned) {
        existing.push({
          branchId: bId,
          branchName: selectedBranchForTeam.name,
          role: config.role,
          assignedAt: new Date().toISOString(),
          isPrimary: existing.length === 0,
        });

        if (config.role === 'BRANCH_MANAGER') {
          assignedManagerId = staff.id;
          assignedManagerName = staff.name;
        }
      }

      updateStaffBranchAssignments(staff.id, existing);
    });

    // If manager changed, update branch record too
    if (assignedManagerId !== selectedBranchForTeam.manager_id) {
      const updatedBranch: Branch = {
        ...selectedBranchForTeam,
        manager_id: assignedManagerId,
        manager_name: assignedManagerName || undefined,
      };
      saveBranch(updatedBranch);
    }

    setStaffList(getSalespeople());
    setBranches(getBranches());
    setIsTeamModalOpen(false);
    showToast(`Team setup & roles saved for ${selectedBranchForTeam.name}!`);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageBranches) {
      setFormError('Access Denied: Only Business Owners or Super Admins can save branches.');
      return;
    }
    if (!formName.trim()) {
      setFormError('Branch name is required.');
      return;
    }
    if (!formCode.trim()) {
      setFormError('Branch code is required (e.g. HQ-01, BR-02).');
      return;
    }

    const assignedManager = staffList.find((s) => s.id === formManagerId);
    const branchId = editingBranch
      ? editingBranch.branchId || editingBranch.id || `BR-${Date.now()}`
      : `BR-${Date.now().toString(36).toUpperCase()}`;

    const newBranch: Branch = {
      branchId,
      id: branchId,
      company_id: company.company_id || '1',
      name: formName.trim(),
      code: formCode.trim().toUpperCase(),
      location: formAddress.trim(),
      address: formAddress.trim(),
      sheet_id: formSheetId.trim() || `POS_${company.company_name}_${formCode.trim()}_2026.xlsx`,
      manager_id: formManagerId,
      manager_name: assignedManager ? assignedManager.name : undefined,
      is_active: formIsActive,
      isMain: editingBranch ? editingBranch.isMain : branches.length === 0,
    };

    saveBranch(newBranch);

    // Save any configured team member assignments for this branch
    staffList.forEach((staff) => {
      const config = teamAssignments[staff.id];
      if (!config) return;

      const existing = (staff.branchAssignments || []).filter((a) => a.branchId !== branchId);

      if (config.assigned) {
        existing.push({
          branchId,
          branchName: newBranch.name,
          role: config.role,
          assignedAt: new Date().toISOString(),
          isPrimary: existing.length === 0,
        });
      }

      updateStaffBranchAssignments(staff.id, existing);
    });

    // Audit log
    addAuditLog({
      action: 'SYSTEM_SETTINGS_UPDATE',
      severity: 'INFO',
      staffId: currentUser?.id || 'SYS',
      staffName: currentUser?.name || 'Administrator',
      staffRole: currentUser?.role || 'Admin',
      company_id: company.company_id,
      branch_id: branchId,
      details: editingBranch
        ? `Updated branch details for '${newBranch.name}' (${newBranch.code}). Manager: ${newBranch.manager_name || 'None'}`
        : `Created new branch partition '${newBranch.name}' (${newBranch.code}). Manager: ${newBranch.manager_name || 'None'}`,
    });

    setIsModalOpen(false);
    showToast(editingBranch ? 'Branch updated successfully!' : 'New branch created successfully with team assignments!');
  };

  const handleDelete = (branchId: string) => {
    if (!canManageBranches) {
      showToast('Permission Denied: Only Business Owners or Super Admins can delete branches.');
      return;
    }
    if (branchId === '1' || branchId === 'BR-MAIN') {
      alert('Cannot delete the primary Head Office branch.');
      return;
    }

    const b = branches.find((item) => item.branchId === branchId || item.id === branchId);
    const success = deleteBranch(branchId);
    if (success) {
      addAuditLog({
        action: 'SYSTEM_SETTINGS_UPDATE',
        severity: 'WARNING',
        staffId: currentUser?.id || 'SYS',
        staffName: currentUser?.name || 'Administrator',
        staffRole: currentUser?.role || 'Admin',
        company_id: company.company_id,
        branch_id: branchId,
        details: `Deleted branch '${b?.name || branchId}' (${b?.code || ''})`,
      });
      showToast('Branch deleted.');
    }
    setConfirmDeleteId(null);
  };

  const q = (searchTerm || '').trim().toLowerCase();
  const filteredBranches = branches.filter(
    (b) =>
      !q ||
      (b.name && b.name.toLowerCase().includes(q)) ||
      (b.code && b.code.toLowerCase().includes(q)) ||
      (b.address && b.address.toLowerCase().includes(q)) ||
      (b.location && b.location.toLowerCase().includes(q))
  );

  return (
    <div id="branch-setup-screen" className="space-y-4 pb-28 animate-fadeIn select-none">
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 text-white rounded-3xl p-4 sm:p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            {onNavigateHome && (
              <button
                type="button"
                onClick={onNavigateHome}
                className="w-10 h-10 rounded-2xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition active:scale-95 text-white mr-1"
                title="Return to Home"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-md">
              <Building2 className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black tracking-tight">
                  Branch Setup & Multi-Location Isolation
                </h1>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-bold border border-amber-300/30 uppercase">
                  SaaS Sharded
                </span>
              </div>
              <p className="text-xs text-blue-100/80">
                Configure dedicated branch spreadsheets, branch codes, locations & assign managers
              </p>
            </div>
          </div>

          {canManageBranches ? (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="self-start sm:self-auto px-4 py-2.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs flex items-center space-x-1.5 shadow-lg shadow-amber-400/20 transition active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Branch</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 text-white/90 text-xs font-semibold border border-white/20 select-none">
              <Lock className="w-3.5 h-3.5 text-amber-300" />
              <span>Owner Access Only</span>
            </div>
          )}
        </div>
      </div>

      {/* Read-Only Notice for Managers & Staff */}
      {!canManageBranches && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs font-medium flex items-center gap-2.5 shadow-sm">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Read-Only Notice:</strong> Branch partition creation and configuration is restricted to the Business Owner and Platform Super Admin. Branch Managers and staff can only access their assigned location.
          </span>
        </div>
      )}

      {/* Toast Banner */}
      {toastMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-sm animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 2. Top Stats & Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Current Tenant</span>
            <Building2 className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-sm font-black text-slate-900 truncate">
            {company.company_name || 'SAIMETRIC Retail'}
          </p>
          <span className="text-[10px] text-slate-400 font-mono">
            ID: {company.company_id || '1'} • {company.plan || 'PROFESSIONAL'}
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Total Branches</span>
            <Layers className="w-4 h-4 text-purple-600" />
          </div>
          <p className="text-xl font-black text-slate-900">
            {branches.length} <span className="text-xs font-normal text-slate-500">Partitions</span>
          </p>
          <span className="text-[10px] text-emerald-600 font-bold">
            {branches.filter((b) => b.is_active !== false).length} Active Branches
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">Isolation Schema</span>
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xs font-mono font-bold text-slate-800 truncate">
            POS_[Company]_[Branch]_2026
          </p>
          <span className="text-[10px] text-slate-500">
            1 Sheet per branch + Monthly tab sharding
          </span>
        </div>
      </div>

      {/* 3. Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search branches by name, code, or address..."
          className="w-full bg-white border border-slate-300 rounded-2xl pl-10 pr-4 py-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600 shadow-sm"
        />
      </div>

      {/* 4. Branches List / Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredBranches.map((branch, branchIdx) => {
          const manager = staffList.find((s) => s.id === branch.manager_id);
          const isMainBranch = branch.isMain || branch.branchId === '1' || branch.branchId === 'BR-MAIN';
          const isUserBranch = userAssignedBranchId && (branch.branchId === userAssignedBranchId || branch.id === userAssignedBranchId);
          const bKey = branch.branchId || branch.id || (branch as any).branch_id || `branch-${branchIdx}`;

          return (
            <div
              key={`${bKey}-${branchIdx}`}
              className={`bg-white rounded-3xl border ${isUserBranch ? 'border-indigo-400 ring-2 ring-indigo-400/20' : 'border-slate-200'} p-5 shadow-sm space-y-4 hover:shadow-md transition-shadow relative overflow-hidden`}
            >
              {isMainBranch && (
                <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-black uppercase px-3 py-0.5 rounded-bl-xl tracking-wider">
                  Head Office / Central
                </div>
              )}
              {isUserBranch && !isMainBranch && (
                <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-black uppercase px-3 py-0.5 rounded-bl-xl tracking-wider">
                  Your Assigned Branch
                </div>
              )}

              {/* Branch Title & Code */}
              <div className="flex items-start justify-between pr-16">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-slate-900">{branch.name}</h2>
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 font-mono text-[10px] font-black">
                      {branch.code || 'BR-01'}
                    </span>
                    {isUserBranch && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-200">
                        Assigned Location
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{branch.address || branch.location || 'No physical address specified'}</span>
                  </p>
                </div>
              </div>

              {/* Manager & Partition details */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <UserCheck className="w-3 h-3 text-blue-600" />
                    Assigned Manager
                  </span>
                  <p className="font-bold text-slate-800 truncate">
                    {manager ? manager.name : branch.manager_name || 'Unassigned'}
                  </p>
                  <span className="text-[10px] text-slate-500 block">
                    {manager ? `Role: ${manager.role}` : 'Click edit to assign'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-0.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                    <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
                    Branch Sheet ID
                  </span>
                  <p className="font-mono text-[11px] font-bold text-slate-700 truncate" title={branch.sheet_id || ''}>
                    {branch.sheet_id || 'Auto-Provisioned'}
                  </p>
                  <span className="text-[10px] text-emerald-600 font-bold block">
                    {branch.is_active !== false ? '● Active Ingress' : '○ Suspended'}
                  </span>
                </div>
              </div>

              {/* Assigned Staff Overview & Actions Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        branch.is_active !== false ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <span className="text-[11px] font-bold text-slate-600">
                      {branch.is_active !== false ? 'Active Branch' : 'Inactive'}
                    </span>
                  </div>
                  {/* Assigned Staff Count */}
                  {(() => {
                    const assignedStaffCount = staffList.filter((s) => isStaffAssignedToBranch(s, bKey)).length;
                    return (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-200 flex items-center gap-1">
                        <Users className="w-3 h-3 text-indigo-500" />
                        <span>{assignedStaffCount} Assigned</span>
                      </span>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-2">
                  {canManageBranches ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenTeamSetup(branch)}
                        className="px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer border border-indigo-200 shadow-sm"
                        title="Configure branch team members and assign explicit roles"
                      >
                        <Users className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Team Setup</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenEdit(branch)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                        <span>Edit</span>
                      </button>

                      {!isMainBranch && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(branch.branchId || branch.id || '')}
                          className="p-1.5 rounded-xl text-rose-500 hover:bg-rose-50 transition cursor-pointer"
                          title="Delete Branch"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-50 text-slate-400 text-[11px] font-semibold border border-slate-100 select-none">
                      <Lock className="w-3 h-3 text-slate-400" />
                      <span>Config Locked</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 5. Delete Confirmation Dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm p-5 space-y-4 shadow-2xl border border-slate-200 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-black text-slate-900">Delete Branch Partition?</h3>
              <p className="text-xs text-slate-500">
                Are you sure you want to delete this branch? Existing sales will remain archived in the monthly spreadsheet.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Add / Edit Branch Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl p-5 space-y-4 text-slate-900 border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="w-9 h-9 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md">
                  <Building2 className="w-5 h-5" />
                </div>
                <h3 className="text-base font-black text-slate-900">
                  {editingBranch ? `Edit Branch: ${editingBranch.name}` : 'Create New Branch Partition'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Branch Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Westgate Retail Branch"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Branch Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                    placeholder="e.g. BR-02"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-mono font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Assigned Manager
                  </label>
                  <select
                    value={formManagerId}
                    onChange={(e) => setFormManagerId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                  >
                    <option value="">-- No Manager Assigned --</option>
                    {staffList.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} ({staff.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Physical Address / Location
                </label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="e.g. Shop 14, Westgate Shopping Mall, Harare"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-medium text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Dedicated Branch Sheet ID or Filename
                </label>
                <input
                  type="text"
                  value={formSheetId}
                  onChange={(e) => setFormSheetId(e.target.value)}
                  placeholder="e.g. POS_Company_Branch_2026.xlsx or Google Sheet ID"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-mono text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Leave default to auto-create dedicated partition in Google Drive
                </span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="branch-active-toggle"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <label htmlFor="branch-active-toggle" className="text-xs font-bold text-slate-800 cursor-pointer">
                  Branch is Active & Accepting Ingress Sales
                </label>
              </div>

              {/* Collapsible Branch Team Setup section */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowFormTeamConfig(!showFormTeamConfig)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 transition text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-600" />
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">
                        Branch Team Setup & Roles
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {Object.values(teamAssignments).filter((c: any) => c?.assigned).length} staff selected for this branch
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-indigo-600">
                    {showFormTeamConfig ? 'Hide' : 'Configure'}
                  </span>
                </button>

                {showFormTeamConfig && (
                  <div className="mt-2.5 p-3 rounded-2xl bg-indigo-50/40 border border-indigo-100 space-y-2 max-h-56 overflow-y-auto">
                    <p className="text-[10px] text-indigo-900 font-medium leading-relaxed">
                      Assign team members and define their specific role for this branch (e.g. Cashier here, Manager elsewhere).
                    </p>
                    <div className="space-y-1.5">
                      {staffList.map((staff) => {
                        const config = teamAssignments[staff.id] || { assigned: false, role: 'CASHIER' };
                        return (
                          <div
                            key={staff.id}
                            className={`p-2 rounded-xl flex items-center justify-between gap-2 border text-xs transition-colors ${
                              config.assigned
                                ? 'bg-white border-indigo-300 shadow-xs'
                                : 'bg-slate-50/80 border-slate-200 opacity-75'
                            }`}
                          >
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={config.assigned}
                                onChange={(e) => {
                                  setTeamAssignments((prev) => ({
                                    ...prev,
                                    [staff.id]: {
                                      ...config,
                                      assigned: e.target.checked,
                                    },
                                  }));
                                }}
                                className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                              />
                              <div className="min-w-0">
                                <span className="font-bold text-slate-800 truncate block text-[11px]">
                                  {staff.name}
                                </span>
                                <span className="text-[9px] text-slate-400 truncate block">
                                  Default: {staff.role}
                                </span>
                              </div>
                            </label>

                            {config.assigned && (
                              <select
                                value={config.role}
                                onChange={(e) => {
                                  const newRole = e.target.value as any;
                                  setTeamAssignments((prev) => ({
                                    ...prev,
                                    [staff.id]: {
                                      ...config,
                                      role: newRole,
                                    },
                                  }));
                                  if (newRole === 'BRANCH_MANAGER') {
                                    setFormManagerId(staff.id);
                                  }
                                }}
                                className="bg-white border border-indigo-200 text-indigo-900 rounded-lg py-1 px-2 text-[10px] font-bold focus:outline-none focus:border-indigo-500 shrink-0"
                              >
                                <option value="BRANCH_MANAGER">Branch Manager</option>
                                <option value="SUPERVISOR">Supervisor</option>
                                <option value="CASHIER">Cashier</option>
                                <option value="STOCK_CLERK">Stock Clerk</option>
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition"
                >
                  {editingBranch ? 'Update Branch' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Dedicated Branch Team Setup Modal */}
      {isTeamModalOpen && selectedBranchForTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-900 border border-slate-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900">
                      Team Setup: {selectedBranchForTeam.name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 text-amber-300 font-mono text-[10px] font-black">
                      {selectedBranchForTeam.code || 'BR-01'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Assign staff to this branch partition and define their explicit local role
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTeamModalOpen(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanatory Policy Callout */}
            <div className="p-4 bg-indigo-50/60 border-b border-indigo-100 flex items-start gap-2.5">
              <BadgeCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div className="text-[11px] text-indigo-950 space-y-0.5 leading-relaxed">
                <span className="font-bold block">Multi-Branch Role Flexibility</span>
                <p>
                  Staff can be registered to multiple branches with explicit, distinct roles per branch (e.g. Manager in Branch A and Cashier in Branch B).
                  When this user signs into this branch terminal, their role and permissions will adapt automatically.
                </p>
              </div>
            </div>

            {/* Filter & Quick Actions */}
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                <input
                  type="text"
                  value={teamSearchTerm}
                  onChange={(e) => setTeamSearchTerm(e.target.value)}
                  placeholder="Filter team members by name or role..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const updated = { ...teamAssignments };
                    staffList.forEach((s) => {
                      updated[s.id] = { assigned: true, role: updated[s.id]?.role || 'CASHIER' };
                    });
                    setTeamAssignments(updated);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold border border-indigo-200 transition"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const updated = { ...teamAssignments };
                    staffList.forEach((s) => {
                      updated[s.id] = { assigned: false, role: 'CASHIER' };
                    });
                    setTeamAssignments(updated);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold transition"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Staff List with Roles */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {staffList
                .filter(
                  (s) =>
                    !teamSearchTerm.trim() ||
                    s.name.toLowerCase().includes(teamSearchTerm.toLowerCase()) ||
                    s.role.toLowerCase().includes(teamSearchTerm.toLowerCase())
                )
                .map((staff) => {
                  const config = teamAssignments[staff.id] || { assigned: false, role: 'CASHIER' };
                  const bId = selectedBranchForTeam.branchId || selectedBranchForTeam.id || (selectedBranchForTeam as any).branch_id;
                  const otherAssignments = (staff.branchAssignments || []).filter((a) => a.branchId !== bId);

                  return (
                    <div
                      key={staff.id}
                      className={`p-3 rounded-2xl border transition-all ${
                        config.assigned
                          ? 'bg-white border-indigo-300 shadow-sm'
                          : 'bg-slate-50/70 border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={config.assigned}
                            onChange={(e) => {
                              setTeamAssignments((prev) => ({
                                ...prev,
                                [staff.id]: {
                                  ...config,
                                  assigned: e.target.checked,
                                },
                              }));
                            }}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                          />
                          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs border border-slate-200 shrink-0">
                            {staff.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900">{staff.name}</span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[9px] uppercase font-bold">
                                Default: {staff.role}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 block font-mono">
                              PIN: •••• | ID: {staff.id}
                            </span>
                            {/* Other branch assignments */}
                            {otherAssignments.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                <span className="text-[9px] text-slate-400 font-medium">Other Roles:</span>
                                {otherAssignments.map((oa, oaIdx) => (
                                  <span
                                    key={oaIdx}
                                    className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[9px] font-bold border border-slate-200"
                                  >
                                    {oa.branchName || oa.branchId}: {oa.role}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </label>

                        {/* Role selection if assigned */}
                        <div className="sm:text-right pl-7 sm:pl-0">
                          {config.assigned ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-indigo-900">
                                Role in {selectedBranchForTeam.name}:
                              </span>
                              <select
                                value={config.role}
                                onChange={(e) => {
                                  const newRole = e.target.value as any;
                                  setTeamAssignments((prev) => ({
                                    ...prev,
                                    [staff.id]: {
                                      ...config,
                                      role: newRole,
                                    },
                                  }));
                                }}
                                className="bg-indigo-50/80 border border-indigo-300 text-indigo-950 rounded-xl py-1.5 px-3 text-xs font-bold focus:outline-none focus:border-indigo-600 shadow-xs"
                              >
                                <option value="BRANCH_MANAGER">Branch Manager</option>
                                <option value="SUPERVISOR">Supervisor</option>
                                <option value="CASHIER">Cashier</option>
                                <option value="STOCK_CLERK">Stock Clerk</option>
                              </select>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium italic">
                              Not assigned to this branch
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="text-xs text-slate-500 font-medium">
                <span className="font-bold text-slate-800">
                  {Object.values(teamAssignments).filter((c: any) => c?.assigned).length}
                </span>{' '}
                of {staffList.length} staff members assigned to {selectedBranchForTeam.name}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsTeamModalOpen(false)}
                  className="py-2.5 px-4 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTeamSetup}
                  className="py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Team Setup</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
