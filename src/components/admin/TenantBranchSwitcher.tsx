import React, { useState, useEffect } from 'react';
import {
  Building2,
  ChevronDown,
  Shield,
  Layers,
  Sparkles,
  Sliders,
  Crown,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Lock,
} from 'lucide-react';
import {
  getCurrentCompany,
  getCurrentBranch,
  getBranches,
  setCurrentBranchId,
  subscribeRoomDatabase,
  setSessionUser,
  saveSalesperson,
} from '../../db/roomDatabase';
import { Branch, Salesperson } from '../../types';

interface TenantBranchSwitcherProps {
  currentUser?: Salesperson | null;
  onOpenPermissions?: () => void;
  onOpenSuperAdmin?: () => void;
}

export const TenantBranchSwitcher: React.FC<TenantBranchSwitcherProps> = ({
  currentUser,
  onOpenPermissions,
  onOpenSuperAdmin,
}) => {
  const [company, setCompany] = useState(() => getCurrentCompany());
  const [branch, setBranch] = useState(() => getCurrentBranch());
  const [allBranches, setAllBranches] = useState<Branch[]>(() => getBranches());
  const [isOpen, setIsOpen] = useState(false);

  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    (currentUser?.role as string) === 'super_admin' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  const isOwner = currentUser?.role === 'OWNER';

  // Only Business Owners and Super Admins can switch between branches.
  // Store Managers, Supervisors, and Cashiers MUST only access their assigned branch!
  const canSwitchBranch = isSuperAdmin || isOwner;

  // Enforce branch isolation for managers and cashiers
  useEffect(() => {
    if (!canSwitchBranch && currentUser) {
      const assignedBranchId = currentUser.branchId || currentUser.branch_id;
      if (assignedBranchId && branch.branchId !== assignedBranchId) {
        setCurrentBranchId(assignedBranchId);
      }
    }
  }, [canSwitchBranch, currentUser, branch.branchId]);

  useEffect(() => {
    const unsub = subscribeRoomDatabase(() => {
      setCompany(getCurrentCompany());
      setBranch(getCurrentBranch());
      setAllBranches(getBranches());
    });
    return unsub;
  }, []);

  const handleSelectBranch = (branchId: string) => {
    if (!canSwitchBranch) return;
    setCurrentBranchId(branchId);
    
    // Ensure currentUser session branch is synchronized so any new POS sale is attributed to this branch
    if (currentUser) {
      const targetBranch = allBranches.find((b) => (b.branchId || b.id) === branchId);
      const updatedUser: Salesperson = {
        ...currentUser,
        branchId,
        branch_id: branchId,
        branchName: targetBranch?.name || currentUser.branchName,
      };
      setSessionUser(updatedUser);
      saveSalesperson(updatedUser);
    }
    
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left">
      <div className="flex items-center gap-2">
        {/* Header Breadcrumb: [Company Name] > [Branch Name] */}
        {canSwitchBranch ? (
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 text-xs text-white transition-all shadow-sm cursor-pointer"
            title={`${isSuperAdmin ? 'SuperAdmin' : 'Owner'}: Switch Tenant Branch`}
          >
            <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-semibold text-slate-300 max-w-[120px] truncate">
              {company.company_name}
            </span>
            <span className="text-slate-500 font-bold">&gt;</span>
            <span className="font-bold text-white max-w-[130px] truncate">{branch.name}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-900 text-amber-400 font-mono text-[10px]">
              {branch.code || 'HQ-01'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
          </button>
        ) : (
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-slate-800/80 border border-slate-700/80 text-xs text-white shadow-sm select-none"
            title={`Assigned Branch: ${company.company_name} > ${branch.name} (Locked to your assigned branch)`}
          >
            <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="font-semibold text-slate-300 max-w-[120px] truncate">
              {company.company_name}
            </span>
            <span className="text-slate-500 font-bold">&gt;</span>
            <span className="font-bold text-white max-w-[130px] truncate">{branch.name}</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-900/90 text-amber-400 font-mono text-[10px] flex items-center gap-1">
              <Lock className="w-2.5 h-2.5 text-amber-400" />
              <span>{branch.code || 'HQ-01'}</span>
            </span>
          </div>
        )}

        {/* 52 Permissions Button (Only for Owners and Admins) */}
        {onOpenPermissions && (isSuperAdmin || isOwner) && (
          <button
            type="button"
            onClick={onOpenPermissions}
            className="p-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-amber-400 transition-colors cursor-pointer"
            title="52 Granular Permissions Matrix"
          >
            <Shield className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Super Admin / SaaS Billing Button (ONLY for Super Admin) */}
        {isSuperAdmin && onOpenSuperAdmin && (
          <button
            type="button"
            onClick={onOpenSuperAdmin}
            className="p-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
            title="SaaS Platform & Multi-Tenant Dashboard"
          >
            <Crown className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown Menu */}
      {isOpen && canSwitchBranch && (
        <div className="absolute left-0 mt-2 w-72 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-2 z-50 animate-fadeIn">
          {/* Company Info Header */}
          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 mb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                {company.company_name}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold font-mono">
                {company.subscription_status}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              Plan: {company.plan} • Shard: Monthly
            </p>
          </div>

          <div className="text-[11px] font-bold text-slate-400 px-3 py-1 uppercase tracking-wider">
            Select Active Branch
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {allBranches.map((b, bIdx) => {
              const bId = b.branchId || b.id || (b as any).branch_id || `br-${bIdx}`;
              const isSelected = bId === branch.branchId;
              return (
                <button
                  key={`${bId}-${bIdx}`}
                  type="button"
                  onClick={() => handleSelectBranch(bId)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-all ${
                    isSelected
                      ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{b.name}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">{b.code}</span>
                </button>
              );
            })}
          </div>

          {/* Single Active Branch Enforced Notice */}
          <div className="mt-2 pt-2 border-t border-slate-800 px-2 pb-1">
            <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800 text-[10px] text-slate-400 leading-tight space-y-1">
              <span className="font-bold text-amber-400 block flex items-center gap-1">
                <Shield className="w-3 h-3 text-amber-400" />
                Sales Attribution Guarantee
              </span>
              <p>
                One active branch is enforced per session. Switching branches sets the exact location for all new transactions and receipt logs.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
