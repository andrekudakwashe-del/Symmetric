import React, { useState, useEffect } from 'react';
import {
  Salesperson,
  Role,
  ActiveStatus,
  StaffPermissions,
  ActiveTab,
  Branch,
  StaffBranchAssignment,
} from '../../types';
import {
  getSalespeople,
  addSalesperson,
  updateSalesperson,
  toggleSalespersonActive,
  getNextSalespersonId,
  subscribeToDatabase,
  getBranches,
  getCurrentBranchId,
  addAuditLog,
  getCurrentCompanyId,
  updateStaffBranchAssignments,
  getStaffBranchAssignments,
  isStaffAssignedToBranch,
  getStaffRoleInBranch,
} from '../../db/roomDatabase';
import {
  Users,
  UserPlus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  KeyRound,
  Phone,
  Edit2,
  Check,
  X,
  Lock,
  Unlock,
  AlertCircle,
  Sliders,
  CheckCircle2,
  Search,
  ChevronRight,
  Sparkles,
  ArrowLeft,
  Package,
  Truck,
  Scale,
  Coins,
  CreditCard,
  Building2,
  FileSpreadsheet,
  Crown,
  BadgeCheck,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface StaffAccessManagementScreenProps {
  currentUser: Salesperson;
  onNavigateHome?: () => void;
  onNavigateTab?: (tab: ActiveTab) => void;
}

export const getRolePresetPermissions = (role: string): StaffPermissions => {
  const normRole = (role || '').toUpperCase();

  if (normRole === 'OWNER' || normRole === 'SUPER_ADMIN' || normRole === 'ADMIN') {
    return {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: true,
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: true,
      canCreateDirectGrv: true,
      canApproveDirectGrv: true,
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: true,
      canApproveEOD: true,
      canViewVarianceInvestigation: true,
      canViewAuditLog: true,
      canPinOverride: true,
      canManageCompany: true,
      canEditMasterPrice: true,
      canSeeMargin: true,
    };
  }

  if (normRole === 'BRANCH_MANAGER' || normRole === 'MANAGER') {
    return {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: false, // Edit Master Price OFF
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: true,
      canCreateDirectGrv: true,
      canApproveDirectGrv: true,
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: true,
      canApproveEOD: true,
      canViewVarianceInvestigation: true,
      canViewAuditLog: true,
      canPinOverride: true,
      canManageCompany: false, // Manage Company OFF
      canEditMasterPrice: false, // Edit Master Price OFF
      canSeeMargin: true,
    };
  }

  if (normRole === 'SUPERVISOR') {
    return {
      canEditCartPrice: true,
      canApplyCartDiscount: true,
      canDeleteCartItem: true,
      canClearCart: true,
      canManageInventory: true,
      canEditPriceCost: false,
      canSellNegativeStock: true,
      canReceiveGRN: true,
      canBreakCases: true,
      canAccessReports: true,
      canManageExpenses: true,
      canPerformShiftEnd: true,
      canManageStaff: false,
      canCreateDirectGrv: false,
      canApproveDirectGrv: true, // Approve GRV ON
      canUseCustomerChange: true,
      canIssueCustomerCredit: true,
      canSubmitEOD: false,
      canApproveEOD: true, // Approve EOD ON
      canViewVarianceInvestigation: true, // View Variance ON
      canViewAuditLog: true,
      canPinOverride: true, // PIN Override ON
      canManageCompany: false,
      canEditMasterPrice: false,
      canSeeMargin: true,
    };
  }

  if (normRole === 'CASHIER' || normRole === 'STAFF') {
    return {
      canEditCartPrice: false,
      canApplyCartDiscount: false,
      canDeleteCartItem: false, // Delete Item OFF
      canClearCart: false, // Clear Cart OFF
      canManageInventory: false,
      canEditPriceCost: false,
      canSellNegativeStock: false,
      canReceiveGRN: false,
      canBreakCases: false,
      canAccessReports: false,
      canManageExpenses: false,
      canPerformShiftEnd: false,
      canManageStaff: false,
      canCreateDirectGrv: true, // Create GRV ON
      canApproveDirectGrv: false,
      canUseCustomerChange: true, // Use Change ON
      canIssueCustomerCredit: true, // Issue Credit ON
      canSubmitEOD: true, // Submit EOD ON
      canApproveEOD: false,
      canViewVarianceInvestigation: false,
      canViewAuditLog: false,
      canPinOverride: false,
      canManageCompany: false,
      canEditMasterPrice: false,
      canSeeMargin: false, // See Margin OFF
    };
  }

  if (normRole === 'STOCK_CLERK' || normRole === 'CLERK') {
    return {
      canEditCartPrice: false,
      canApplyCartDiscount: false,
      canDeleteCartItem: false,
      canClearCart: false,
      canManageInventory: true,
      canEditPriceCost: false,
      canSellNegativeStock: false,
      canReceiveGRN: true, // GRN Only ON
      canBreakCases: true,
      canAccessReports: false,
      canManageExpenses: false,
      canPerformShiftEnd: false,
      canManageStaff: false,
      canCreateDirectGrv: false,
      canApproveDirectGrv: false,
      canUseCustomerChange: false,
      canIssueCustomerCredit: false,
      canSubmitEOD: false,
      canApproveEOD: false,
      canViewVarianceInvestigation: false,
      canViewAuditLog: false,
      canPinOverride: false,
      canManageCompany: false,
      canEditMasterPrice: false,
      canSeeMargin: false,
    };
  }

  return getRolePresetPermissions('CASHIER');
};

export const StaffAccessManagementScreen: React.FC<StaffAccessManagementScreenProps> = ({
  currentUser,
  onNavigateHome,
  onNavigateTab,
}) => {
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('All');

  // Unified Staff Editor Modal
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Salesperson | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState<'profile' | 'permissions'>('profile');

  // Form State
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPin, setFormPin] = useState('');
  const [formRole, setFormRole] = useState<string>('CASHIER');
  const [formBranchId, setFormBranchId] = useState<string>('');
  const [formBranchAssignments, setFormBranchAssignments] = useState<StaffBranchAssignment[]>([]);
  const [formPhone, setFormPhone] = useState('');
  const [formActive, setFormActive] = useState<ActiveStatus>('Y');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccessMsg, setFormSuccessMsg] = useState<string | null>(null);

  // Permission State
  const [tempPermissions, setTempPermissions] = useState<StaffPermissions>(() =>
    getRolePresetPermissions('CASHIER')
  );

  const loadData = () => {
    setSalespeople(getSalespeople());
    setBranches(getBranches());
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToDatabase(() => {
      loadData();
    });
    return () => unsubscribe();
  }, []);

  const filteredStaff = salespeople.filter((s) => {
    const q = (searchQuery || '').trim().toLowerCase();
    const matchesSearch =
      !q ||
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.id && s.id.toLowerCase().includes(q)) ||
      (s.phone && s.phone.includes(searchQuery)) ||
      (s.email && s.email.toLowerCase().includes(q));
    const matchesRole =
      selectedRoleFilter === 'All' ||
      (s.role || '').toUpperCase() === selectedRoleFilter.toUpperCase();
    return matchesSearch && matchesRole;
  });

  const handleOpenAdd = () => {
    setEditingStaff(null);
    setFormName('');
    setFormEmail('');
    setFormPin('');
    setFormRole('CASHIER');
    const defaultBId = getCurrentBranchId() || (branches[0]?.branchId || '1');
    const defaultBranch = branches.find((b) => (b.branchId || b.id) === defaultBId);
    setFormBranchId(defaultBId);
    setFormBranchAssignments([
      {
        branchId: defaultBId,
        branchName: defaultBranch?.name || 'Primary Branch',
        role: 'CASHIER',
        isPrimary: true,
        assignedAt: new Date().toISOString(),
      },
    ]);
    setFormPhone('');
    setFormActive('Y');
    setTempPermissions(getRolePresetPermissions('CASHIER'));
    setFormError(null);
    setFormSuccessMsg(null);
    setActiveEditorTab('profile');
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (staff: Salesperson, initialTab: 'profile' | 'permissions' = 'profile') => {
    setEditingStaff(staff);
    setFormName(staff.name);
    setFormEmail(staff.email || '');
    setFormPin(staff.pin);
    setFormRole(staff.role);
    const primaryBId = staff.branch_id || getCurrentBranchId() || '1';
    setFormBranchId(primaryBId);
    
    // Load multi-branch assignments or synthesize from existing branch_id
    let existingAssignments: StaffBranchAssignment[] =
      staff.branchAssignments && staff.branchAssignments.length > 0
        ? [...staff.branchAssignments]
        : [];
    if (existingAssignments.length === 0) {
      const bObj = branches.find((b) => (b.branchId || b.id) === primaryBId);
      existingAssignments = [
        {
          branchId: primaryBId,
          branchName: bObj?.name || 'Primary Branch',
          role: (['OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(staff.role)
            ? 'BRANCH_MANAGER'
            : (staff.role as any)) || 'CASHIER',
          isPrimary: true,
          assignedAt: new Date().toISOString(),
        },
      ];
    }
    setFormBranchAssignments(existingAssignments);
    setFormPhone(staff.phone || '');
    setFormActive(staff.active);
    const existingPerms = staff.permissions || getRolePresetPermissions(staff.role);
    setTempPermissions({ ...getRolePresetPermissions(staff.role), ...existingPerms });
    setFormError(null);
    setFormSuccessMsg(null);
    setActiveEditorTab(initialTab);
    setIsEditorOpen(true);
  };

  const handleRoleChange = (newRole: string) => {
    setFormRole(newRole);
    // Auto-seed permissions based on selected role preset
    const preset = getRolePresetPermissions(newRole);
    setTempPermissions(preset);
  };

  const handleSaveStaffAndPermissions = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Please provide the staff member full name.');
      return;
    }
    if (!/^\d{4}$/.test(formPin)) {
      setFormError('PIN must be exactly 4 numeric digits (e.g. 1234).');
      return;
    }

    // Ensure at least one branch assignment exists
    let finalAssignments = [...formBranchAssignments];
    if (finalAssignments.length === 0) {
      const fallbackBId = formBranchId || getCurrentBranchId() || '1';
      const fallbackBranch = branches.find((b) => (b.branchId || b.id) === fallbackBId);
      finalAssignments = [
        {
          branchId: fallbackBId,
          branchName: fallbackBranch?.name || 'Primary Branch',
          role: (['BRANCH_MANAGER', 'SUPERVISOR', 'CASHIER', 'STOCK_CLERK'].includes(formRole)
            ? (formRole as any)
            : 'CASHIER'),
          isPrimary: true,
          assignedAt: new Date().toISOString(),
        },
      ];
    }

    // Determine primary branch
    const primaryAssignment = finalAssignments.find((a) => a.isPrimary) || finalAssignments[0];
    const resolvedBranchId = primaryAssignment?.branchId || formBranchId || '1';

    try {
      if (editingStaff) {
        updateSalesperson(editingStaff.id, {
          name: formName.trim(),
          email: formEmail.trim() || undefined,
          pin: formPin,
          role: formRole as Role,
          branch_id: resolvedBranchId,
          branchAssignments: finalAssignments,
          company_id: editingStaff.company_id || getCurrentCompanyId(),
          phone: formPhone.trim() || undefined,
          active: formActive,
          permissions: tempPermissions,
        });

        updateStaffBranchAssignments(editingStaff.id, finalAssignments);

        // Audit log
        addAuditLog({
          action: 'STAFF_ROLE_CHANGE',
          severity: 'INFO',
          staffId: currentUser.id,
          staffName: currentUser.name,
          staffRole: currentUser.role,
          company_id: getCurrentCompanyId(),
          branch_id: resolvedBranchId,
          details: `Updated staff profile & multi-branch roles for ${formName} (${finalAssignments.length} branches assigned)`,
        });

        confetti({ particleCount: 30, spread: 60, origin: { y: 0.6 } });
        setFormSuccessMsg(`Staff record & branch roles for ${formName} saved!`);
        setTimeout(() => {
          setIsEditorOpen(false);
          setEditingStaff(null);
        }, 800);
      } else {
        const newId = getNextSalespersonId();
        addSalesperson({
          id: newId,
          name: formName.trim(),
          email: formEmail.trim() || undefined,
          pin: formPin,
          role: formRole as Role,
          branch_id: resolvedBranchId,
          branchAssignments: finalAssignments,
          company_id: getCurrentCompanyId(),
          phone: formPhone.trim() || undefined,
          active: formActive,
          permissions: tempPermissions,
        });

        updateStaffBranchAssignments(newId, finalAssignments);

        addAuditLog({
          action: 'STAFF_ROLE_CHANGE',
          severity: 'INFO',
          staffId: currentUser.id,
          staffName: currentUser.name,
          staffRole: currentUser.role,
          company_id: getCurrentCompanyId(),
          branch_id: resolvedBranchId,
          details: `Created new staff member ${formName} (ID: ${newId}, Multi-Branch Assignments: ${finalAssignments.length})`,
        });

        confetti({ particleCount: 45, spread: 70, origin: { y: 0.6 } });
        setFormSuccessMsg(`Staff member ${formName} created successfully with branch roles!`);
        setTimeout(() => {
          setIsEditorOpen(false);
          setEditingStaff(null);
        }, 800);
      }
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save staff record.');
    }
  };

  const handleToggleActive = (staffId: string) => {
    if (staffId === currentUser.id) {
      alert('You cannot deactivate your own currently active account.');
      return;
    }
    toggleSalespersonActive(staffId);
  };

  // Permission Items with Categories
  const permissionCategories = [
    {
      name: 'Direct Supplier Deliveries (Direct GRV)',
      icon: Truck,
      color: 'text-blue-600',
      items: [
        {
          key: 'canCreateDirectGrv' as keyof StaffPermissions,
          title: 'Create Direct GRV',
          description: 'Receive direct supplier deliveries and issue invoice vouchers at branch',
          critical: false,
        },
        {
          key: 'canApproveDirectGrv' as keyof StaffPermissions,
          title: 'Approve Direct GRV',
          description: 'Supervisor verification, cost authorization & inventory batch committal',
          critical: true,
        },
      ],
    },
    {
      name: 'Customer Ledger & Accounts',
      icon: Coins,
      color: 'text-amber-600',
      items: [
        {
          key: 'canUseCustomerChange' as keyof StaffPermissions,
          title: 'Use Customer Change',
          description: 'Apply customer owed change balance as payment tender in checkout',
          critical: false,
        },
        {
          key: 'canIssueCustomerCredit' as keyof StaffPermissions,
          title: 'Issue Customer Credit',
          description: 'Permit checkout transactions charged to customer credit line book',
          critical: true,
        },
      ],
    },
    {
      name: 'End of Day (EOD & Cash Balancing)',
      icon: Scale,
      color: 'text-emerald-600',
      items: [
        {
          key: 'canSubmitEOD' as keyof StaffPermissions,
          title: 'Submit EOD',
          description: 'Submit cashier shift cash drawer count and declared turnover (Form 4)',
          critical: false,
        },
        {
          key: 'canApproveEOD' as keyof StaffPermissions,
          title: 'Approve EOD',
          description: 'Supervisor final lock and committal of shift reconciliation',
          critical: true,
        },
        {
          key: 'canViewVarianceInvestigation' as keyof StaffPermissions,
          title: 'View Variance Investigation',
          description: 'Inspect over/short cash drawer variances and audit ledger',
          critical: true,
        },
      ],
    },
    {
      name: 'Audit Log & Security Governance',
      icon: ShieldAlert,
      color: 'text-rose-600',
      items: [
        {
          key: 'canViewAuditLog' as keyof StaffPermissions,
          title: 'View Audit Log',
          description: 'Inspect system-wide security trail, price edits, voids and supervisor overrides',
          critical: true,
        },
        {
          key: 'canPinOverride' as keyof StaffPermissions,
          title: 'PIN Override',
          description: 'Authorize supervisor overrides for voided cart lines and restricted items',
          critical: true,
        },
      ],
    },
    {
      name: 'POS Terminal & Counter Operations',
      icon: Sparkles,
      color: 'text-purple-600',
      items: [
        {
          key: 'canEditCartPrice' as keyof StaffPermissions,
          title: 'Edit Line Item Price',
          description: 'Allow staff to modify item unit price directly on the active counter',
          critical: true,
        },
        {
          key: 'canApplyCartDiscount' as keyof StaffPermissions,
          title: 'Apply Cart Discounts',
          description: 'Permit percentage or dollar discount concessions on transactions',
          critical: true,
        },
        {
          key: 'canDeleteCartItem' as keyof StaffPermissions,
          title: 'Delete Cart Line Items',
          description: 'Allow removing scanned products or items from the active cart',
          critical: false,
        },
        {
          key: 'canClearCart' as keyof StaffPermissions,
          title: 'Clear Entire Counter Cart',
          description: 'Permit emptying all items from the counter in a single action',
          critical: false,
        },
        {
          key: 'canSellNegativeStock' as keyof StaffPermissions,
          title: 'Sell Below Zero Stock',
          description: 'Allow transactions to proceed when system stock is zero or insufficient',
          critical: true,
        },
        {
          key: 'canSeeMargin' as keyof StaffPermissions,
          title: 'View Profit Margins & Markup',
          description: 'Show gross margins, product costs, and markup percentages in POS',
          critical: false,
        },
      ],
    },
    {
      name: 'Inventory Suite & Master Catalog',
      icon: Package,
      color: 'text-indigo-600',
      items: [
        {
          key: 'canManageInventory' as keyof StaffPermissions,
          title: 'Inventory Master Access',
          description: 'Access inventory product catalog, pack variants, and stock balances',
          critical: true,
        },
        {
          key: 'canReceiveGRN' as keyof StaffPermissions,
          title: 'Goods Received (GRN) Inward',
          description: 'Permit receiving new supplier stock batches and logging unit costs',
          critical: false,
        },
        {
          key: 'canBreakCases' as keyof StaffPermissions,
          title: 'Manual Case Break',
          description: 'Allow breaking bulk inventory cases into individual singles',
          critical: false,
        },
        {
          key: 'canEditPriceCost' as keyof StaffPermissions,
          title: 'Edit Master Price & Cost',
          description: 'Permit modifying catalog selling prices and last costs in Master table',
          critical: true,
        },
      ],
    },
    {
      name: 'Accounting, Expenses & Administration',
      icon: UserCheck,
      color: 'text-slate-600',
      items: [
        {
          key: 'canManageStaff' as keyof StaffPermissions,
          title: 'Manage Staff Accounts',
          description: 'Create cashiers, reset PINs, and grant or restrict permissions',
          critical: true,
        },
        {
          key: 'canManageExpenses' as keyof StaffPermissions,
          title: 'Record Cash Log Expenses',
          description: 'Permit recording daily expense cash outflows from the till (Form 2)',
          critical: false,
        },
        {
          key: 'canAccessReports' as keyof StaffPermissions,
          title: 'Access Financial & Debt Reports',
          description: 'Access Debtor Aging Ledgers, Customer Change Owed, and Shift Audits',
          critical: true,
        },
        {
          key: 'canManageCompany' as keyof StaffPermissions,
          title: 'Manage Company Profile & Billing',
          description: 'Configure tenant company details, branches, and subscription settings',
          critical: true,
        },
      ],
    },
  ];

  return (
    <div id="staff-access-management" className="space-y-4 pb-28 animate-fadeIn select-none">
      {/* 1. Header */}
      <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] text-white rounded-3xl p-4 sm:p-5 shadow-xl">
        <div className="flex items-center justify-between">
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
              <Users className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg sm:text-xl font-black tracking-tight">Staff Management</h1>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[10px] font-bold border border-amber-300/30">
                  Granular Permissions
                </span>
              </div>
              <p className="text-xs text-purple-100/80">
                Staff directory, 4-digit PINs, roles & granular multi-tenant access governance
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenAdd}
            className="px-4 py-2.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs flex items-center space-x-1.5 shadow-lg shadow-amber-400/20 transition active:scale-95"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Staff</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="mt-4 pt-4 border-t border-white/15 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-white/60 absolute left-3.5 top-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search staff by name, PIN, email or phone..."
              className="w-full bg-black/20 border border-white/20 rounded-2xl pl-10 pr-4 py-2 text-xs font-medium text-white placeholder:text-white/50 focus:outline-none focus:border-amber-300 backdrop-blur-md"
            />
          </div>

          <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
            {['All', 'OWNER', 'BRANCH_MANAGER', 'SUPERVISOR', 'CASHIER', 'STOCK_CLERK'].map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setSelectedRoleFilter(role)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition whitespace-nowrap ${
                  selectedRoleFilter === role
                    ? 'bg-white text-slate-950 shadow-md'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                {role === 'All' ? 'All Roles' : role.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Staff Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredStaff.map((staff) => {
          const isCurrentUser = staff.id === currentUser.id;
          const isActive = staff.active === 'Y';
          const perms = staff.permissions || getRolePresetPermissions(staff.role);
          const branch = branches.find((b) => b.branchId === staff.branch_id || b.id === staff.branch_id);

          return (
            <div
              key={staff.id}
              onClick={() => handleOpenEdit(staff, 'profile')}
              className={`bg-white border rounded-3xl p-4 sm:p-5 shadow-sm transition space-y-3.5 cursor-pointer hover:shadow-md hover:border-slate-300 relative overflow-hidden ${
                isActive ? 'border-slate-200' : 'border-slate-200/60 bg-slate-50 opacity-75'
              }`}
            >
              {/* Header Info */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#6A4DFF] to-indigo-700 flex items-center justify-center text-white font-black text-sm shadow-md">
                    {staff.id}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-base font-black text-slate-900">{staff.name}</h4>
                      {isCurrentUser && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          You
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 mt-0.5 text-xs text-slate-500 font-medium">
                      <span>PIN: •••• ({staff.pin})</span>
                      {staff.phone && <span>• {staff.phone}</span>}
                    </div>

                    {/* Multi-Branch Explicit Assignments Badges */}
                    {staff.branchAssignments && staff.branchAssignments.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {staff.branchAssignments.map((assignment, aIdx) => (
                          <span
                            key={`${assignment.branchId}-${aIdx}`}
                            className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold flex items-center gap-1"
                            title={`Assigned to ${assignment.branchName || assignment.branchId} as ${(assignment.role || '').replace('_', ' ')}`}
                          >
                            <Building2 className="w-2.5 h-2.5 text-indigo-600" />
                            <span>{assignment.branchName || assignment.branchId}:</span>
                            <span className="font-extrabold text-indigo-950 uppercase">
                              {(assignment.role || 'CASHIER').replace('_', ' ')}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600">
                        <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="font-semibold">{branch ? branch.name : 'Head Office'}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[10px] font-black px-2.5 py-1 rounded-xl uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200">
                    {(staff.role || 'CASHIER').replace('_', ' ')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(staff.id)}
                    title={isActive ? 'Deactivate staff account' : 'Activate staff account'}
                    className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold transition ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                    }`}
                  >
                    {isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>

              {/* Granted Feature Permission Highlights */}
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-2.5">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <span>Active Permissions</span>
                  <span className="text-slate-400 font-normal">
                    {Object.values(perms).filter(Boolean).length} Granted
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1 ${
                      perms.canCreateDirectGrv
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-slate-200/80 text-slate-500 line-through'
                    }`}
                  >
                    <span>{perms.canCreateDirectGrv ? '✓' : '✗'} Direct GRV</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1 ${
                      perms.canApproveDirectGrv
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-slate-200/80 text-slate-500 line-through'
                    }`}
                  >
                    <span>{perms.canApproveDirectGrv ? '✓' : '✗'} Approve GRV</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1 ${
                      perms.canSubmitEOD
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200/80 text-slate-500 line-through'
                    }`}
                  >
                    <span>{perms.canSubmitEOD ? '✓' : '✗'} Submit EOD</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1 ${
                      perms.canApproveEOD
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200/80 text-slate-500 line-through'
                    }`}
                  >
                    <span>{perms.canApproveEOD ? '✓' : '✗'} Approve EOD</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center space-x-1 ${
                      perms.canPinOverride
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-200/80 text-slate-500 line-through'
                    }`}
                  >
                    <span>{perms.canPinOverride ? '✓' : '✗'} PIN Override</span>
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div
                className="flex items-center space-x-2 pt-1 border-t border-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => handleOpenEdit(staff, 'profile')}
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center space-x-1 transition active:scale-[0.98]"
                >
                  <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Profile</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenEdit(staff, 'permissions')}
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-sm transition active:scale-[0.98]"
                >
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>Permissions</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Unified Staff Editor Modal (Tabs: Profile + Permissions) */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col text-slate-900 border border-slate-200">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-4 sm:p-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                  {activeEditorTab === 'profile' ? <Users className="w-5 h-5" /> : <Sliders className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-black text-white">
                    {editingStaff ? `Staff: ${editingStaff.name}` : 'Add New Staff Member'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Configure account identity, credentials, branch assignment & granular permissions
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs Navigation: Profile + Permissions */}
            <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2">
              <button
                type="button"
                onClick={() => setActiveEditorTab('profile')}
                className={`px-5 py-2.5 text-xs font-bold rounded-t-xl transition border-b-2 flex items-center space-x-2 ${
                  activeEditorTab === 'profile'
                    ? 'border-blue-600 text-blue-600 bg-white shadow-sm'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Tab 1: Profile</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveEditorTab('permissions')}
                className={`px-5 py-2.5 text-xs font-bold rounded-t-xl transition border-b-2 flex items-center space-x-2 ${
                  activeEditorTab === 'permissions'
                    ? 'border-amber-500 text-amber-600 bg-white shadow-sm'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>Tab 2: Permissions</span>
                <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                  {Object.values(tempPermissions).filter(Boolean).length}
                </span>
              </button>
            </div>

            {/* Messages */}
            {formError && (
              <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            {formSuccessMsg && (
              <div className="mx-4 mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-2 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{formSuccessMsg}</span>
              </div>
            )}

            {/* Tab 1: Profile Form */}
            {activeEditorTab === 'profile' && (
              <form onSubmit={handleSaveStaffAndPermissions} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Tendai Mtetwa"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="tendai@store.co.zw"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-medium text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      4-Digit PIN <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      required
                      value={formPin}
                      onChange={(e) => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="e.g. 1234"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-center text-base font-mono-num font-black text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Security Role (Preset auto-seeds permissions)
                    </label>
                    <select
                      value={formRole}
                      onChange={(e) => handleRoleChange(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                    >
                      <option value="OWNER">OWNER (Full Master Access)</option>
                      <option value="BRANCH_MANAGER">BRANCH_MANAGER (Branch Full Access)</option>
                      <option value="SUPERVISOR">SUPERVISOR (Approve, PIN Override, Variance)</option>
                      <option value="CASHIER">CASHIER (Till Sales, Direct GRV, EOD)</option>
                      <option value="STOCK_CLERK">STOCK_CLERK (GRN Stock Inward)</option>
                      <option value="SUPER_ADMIN">SUPER_ADMIN (Multi-Tenant Platform)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Branch Partition
                    </label>
                    <select
                      value={formBranchId}
                      onChange={(e) => setFormBranchId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                    >
                      {branches.map((b, bIdx) => {
                        const val = b.branchId || b.id || (b as any).branch_id || `BR-${bIdx}`;
                        return (
                          <option key={`${val}-${bIdx}`} value={val}>
                            {b.name} ({b.code || 'HQ-01'})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Phone (WhatsApp)</label>
                    <input
                      type="tel"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="+263 77 ..."
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Account Status</label>
                    <select
                      value={formActive}
                      onChange={(e) => setFormActive(e.target.value as ActiveStatus)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2.5 px-3 text-sm font-bold text-slate-950 focus:outline-none focus:border-blue-600 focus:bg-white"
                    >
                      <option value="Y">Active (Allowed)</option>
                      <option value="N">Inactive (Disabled)</option>
                    </select>
                  </div>
                </div>

                {/* Explicit Multi-Branch Assignment & Roles Section */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-bold text-slate-900">
                        Multi-Branch Access & Explicit Roles <span className="text-rose-500">*</span>
                      </label>
                      <p className="text-[10px] text-slate-500">
                        Explicitly authorize branch access. Staff can hold distinct roles in each branch (e.g. Manager in Branch A, Cashier in Branch B).
                      </p>
                    </div>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {formBranchAssignments.length} Assigned
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                    {branches.map((b) => {
                      const bId = b.branchId || b.id || (b as any).branch_id || '1';
                      const assignment = formBranchAssignments.find((a) => a.branchId === bId);
                      const isAssigned = !!assignment;

                      return (
                        <div
                          key={bId}
                          className={`p-2.5 rounded-2xl border transition-all ${
                            isAssigned
                              ? 'bg-white border-indigo-300 shadow-xs'
                              : 'bg-slate-50/70 border-slate-200 opacity-80'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <label className="flex items-center gap-2.5 cursor-pointer select-none flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isAssigned}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFormBranchAssignments((prev) => [
                                      ...prev,
                                      {
                                        branchId: bId,
                                        branchName: b.name,
                                        role: 'CASHIER',
                                        isPrimary: prev.length === 0,
                                        assignedAt: new Date().toISOString(),
                                      },
                                    ]);
                                  } else {
                                    setFormBranchAssignments((prev) => {
                                      const next = prev.filter((a) => a.branchId !== bId);
                                      if (assignment?.isPrimary && next.length > 0) {
                                        next[0].isPrimary = true;
                                      }
                                      return next;
                                    });
                                  }
                                }}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-slate-900 truncate">{b.name}</span>
                                  <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-mono text-[9px] font-black">
                                    {b.code || 'BR'}
                                  </span>
                                  {assignment?.isPrimary && (
                                    <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                                      Primary
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-400 block truncate">
                                  {b.address || 'Standard store branch'}
                                </span>
                              </div>
                            </label>

                            {isAssigned && (
                              <div className="flex items-center gap-2 pl-6 sm:pl-0 shrink-0">
                                <span className="text-[10px] font-bold text-indigo-900">Role:</span>
                                <select
                                  value={assignment.role}
                                  onChange={(e) => {
                                    const newRole = e.target.value as any;
                                    setFormBranchAssignments((prev) =>
                                      prev.map((a) => (a.branchId === bId ? { ...a, role: newRole } : a))
                                    );
                                  }}
                                  className="bg-indigo-50/80 border border-indigo-300 text-indigo-950 rounded-lg py-1 px-2 text-xs font-bold focus:outline-none focus:border-indigo-600"
                                >
                                  <option value="BRANCH_MANAGER">Branch Manager</option>
                                  <option value="SUPERVISOR">Supervisor</option>
                                  <option value="CASHIER">Cashier</option>
                                  <option value="STOCK_CLERK">Stock Clerk</option>
                                </select>

                                {!assignment.isPrimary && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFormBranchAssignments((prev) =>
                                        prev.map((a) => ({
                                          ...a,
                                          isPrimary: a.branchId === bId,
                                        }))
                                      );
                                      setFormBranchId(bId);
                                    }}
                                    className="text-[10px] font-bold text-slate-500 hover:text-indigo-600 transition underline decoration-dotted"
                                  >
                                    Set Primary
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs flex items-center justify-between">
                  <span className="font-semibold">
                    Role is set to <span className="font-black">{formRole}</span>. Click Permissions tab to customize.
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveEditorTab('permissions')}
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-[11px]"
                  >
                    View Permissions &rarr;
                  </button>
                </div>

                {/* Submit Actions */}
                <div className="flex items-center space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsEditorOpen(false)}
                    className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs shadow-md transition"
                  >
                    {editingStaff ? 'Save Changes' : 'Create Staff Member'}
                  </button>
                </div>
              </form>
            )}

            {/* Tab 2: Permissions Toggles */}
            {activeEditorTab === 'permissions' && (
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* Role Preset Shortcut Pills */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">Quick Role Presets:</span>
                    <span className="text-[10px] text-slate-500">Auto-sets matrix</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {['OWNER', 'BRANCH_MANAGER', 'SUPERVISOR', 'CASHIER', 'STOCK_CLERK'].map((pRole) => (
                      <button
                        key={pRole}
                        type="button"
                        onClick={() => setTempPermissions(getRolePresetPermissions(pRole))}
                        className="px-2.5 py-1 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-[11px] font-bold shadow-2xs"
                      >
                        {pRole.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Categorized Permissions */}
                <div className="space-y-4">
                  {permissionCategories.map((cat) => {
                    const CatIcon = cat.icon;
                    return (
                      <div key={cat.name} className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-black text-slate-800 uppercase tracking-wider">
                          <CatIcon className={`w-4 h-4 ${cat.color}`} />
                          <span>{cat.name}</span>
                        </div>

                        <div className="space-y-2">
                          {cat.items.map((item) => {
                            const isChecked = Boolean(tempPermissions[item.key]);

                            return (
                              <div
                                key={item.key}
                                onClick={() =>
                                  setTempPermissions((prev) => ({
                                    ...prev,
                                    [item.key]: !prev[item.key],
                                  }))
                                }
                                className={`p-3 rounded-2xl border transition cursor-pointer flex items-start justify-between space-x-3 ${
                                  isChecked
                                    ? 'bg-emerald-50/60 border-emerald-300 text-slate-900'
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                }`}
                              >
                                <div className="space-y-0.5">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-xs sm:text-sm font-black text-slate-900">
                                      {item.title}
                                    </span>
                                    {item.critical && (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                        Restricted
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-500 leading-tight">
                                    {item.description}
                                  </p>
                                </div>

                                {/* Custom Toggle Switch */}
                                <div
                                  className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 ease-in-out shrink-0 mt-0.5 ${
                                    isChecked ? 'bg-emerald-600' : 'bg-slate-300'
                                  }`}
                                >
                                  <div
                                    className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                                      isChecked ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer Save in Tab 2 */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-2xl flex items-center space-x-2 sticky bottom-0">
                  <button
                    type="button"
                    onClick={() => setActiveEditorTab('profile')}
                    className="py-2.5 px-4 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100"
                  >
                    &larr; Back to Profile
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveStaffAndPermissions}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-md flex items-center justify-center space-x-1.5 transition active:scale-[0.99]"
                  >
                    <Check className="w-4 h-4" />
                    <span>Save All Profile & Permissions</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
