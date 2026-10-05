import React, { useState, useMemo } from 'react';
import { ActiveTab, Salesperson } from '../../types';
import {
  ALL_SYSTEM_MODULES,
  SystemModuleInfo,
  CoreFunctionCategory,
  getRoleDefinitionForUser,
  getUserPrimaryModules,
  isModuleAllowedForUser,
  getModuleIcon,
} from '../../services/roleNavigationService';
import {
  X,
  Search,
  Star,
  ChevronRight,
  Shield,
  User,
  LogOut,
  Lock,
  Sparkles,
  ShoppingBag,
  Scale,
  Users,
  Package,
  Truck,
  TrendingUp,
  FileSpreadsheet,
  Settings,
  Building2,
  CheckCircle2,
  Printer,
  Crown,
  Layers,
} from 'lucide-react';
import { getCurrentCompany, getCurrentBranchId, getBranches } from '../../db/roomDatabase';

interface FunctionalHamburgerMenuProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Salesperson | null;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onLogout: () => void;
  onOpenPrinterModal?: () => void;
  onOpenSuperAdmin?: () => void;
}

const CATEGORY_METADATA: Record<
  CoreFunctionCategory,
  { title: string; subtitle: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  pos: {
    title: 'Point of Sale & Register',
    subtitle: 'Counter sales, parked carts & registers',
    icon: ShoppingBag,
    color: 'from-purple-500 to-indigo-600',
  },
  cash: {
    title: 'Cash & Balancing Drawer',
    subtitle: 'Form 4 shift reconciliation, floats & counts',
    icon: Scale,
    color: 'from-emerald-500 to-teal-600',
  },
  customers: {
    title: 'Customer Accounts & Credit',
    subtitle: 'Debtors, credit line book & owed change',
    icon: Users,
    color: 'from-amber-500 to-orange-600',
  },
  inventory: {
    title: 'Inventory & Stock Control',
    subtitle: 'Product catalog, transfers & stocktake',
    icon: Package,
    color: 'from-blue-500 to-cyan-600',
  },
  receiving: {
    title: 'Receiving & Supply Chain',
    subtitle: 'Direct GRV vouchers, GRN & suppliers',
    icon: Truck,
    color: 'from-rose-500 to-pink-600',
  },
  sales: {
    title: 'Sales & Operations',
    subtitle: 'Daily transactions & cashier balancing',
    icon: TrendingUp,
    color: 'from-violet-500 to-purple-600',
  },
  reports: {
    title: 'Reports & Intelligence',
    subtitle: 'Financial statements & custom query builder',
    icon: FileSpreadsheet,
    color: 'from-sky-500 to-blue-600',
  },
  admin: {
    title: 'Administration & Security',
    subtitle: 'Staff ranking, data backups & audit logs',
    icon: Settings,
    color: 'from-slate-600 to-slate-800',
  },
};

export const FunctionalHamburgerMenu: React.FC<FunctionalHamburgerMenuProps> = ({
  isOpen,
  onClose,
  currentUser,
  activeTab,
  onSelectTab,
  onLogout,
  onOpenPrinterModal,
  onOpenSuperAdmin,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  const roleDef = useMemo(() => getRoleDefinitionForUser(currentUser), [currentUser]);
  const primaryModules = useMemo(() => getUserPrimaryModules(currentUser), [currentUser]);

  const branches = useMemo(() => getBranches(), []);
  const currentBranch = useMemo(() => {
    const bId = currentUser?.branch_id || getCurrentBranchId();
    return branches.find((b) => (b.branchId || b.id) === bId) || { name: 'Main Store' };
  }, [currentUser, branches]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  // Group modules by core category, filtering for permitted modules
  const groupedModules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const categories: CoreFunctionCategory[] = [
      'pos',
      'cash',
      'customers',
      'inventory',
      'receiving',
      'sales',
      'reports',
      'admin',
    ];

    const result: { category: CoreFunctionCategory; meta: (typeof CATEGORY_METADATA)[CoreFunctionCategory]; modules: SystemModuleInfo[] }[] = [];

    categories.forEach((cat) => {
      const allowedInCat = ALL_SYSTEM_MODULES.filter((m) => {
        if (m.category !== cat) return false;
        if (!isModuleAllowedForUser(currentUser, m.id)) return false;
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.shortLabel.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.categoryLabel.toLowerCase().includes(q)
        );
      });

      if (allowedInCat.length > 0) {
        result.push({
          category: cat,
          meta: CATEGORY_METADATA[cat],
          modules: allowedInCat,
        });
      }
    });

    return result;
  }, [currentUser, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex animate-fadeIn">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <aside
        id="functional-hamburger-drawer"
        className="relative w-full max-w-md sm:max-w-lg bg-slate-900 border-r border-purple-500/30 text-white shadow-2xl flex flex-col h-full z-10 transform transition-transform duration-300 ease-in-out"
      >
        {/* Header with User Role & Profile */}
        <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] p-4 sm:p-5 relative shadow-lg shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center font-black text-xl text-white shadow-md">
                {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : 'S'}
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                  <span>{currentUser?.name || 'Staff Member'}</span>
                  <span className="text-[10px] font-mono font-bold bg-white/25 px-2 py-0.5 rounded-full text-white">
                    #{currentUser?.id || '001'}
                  </span>
                </h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs bg-slate-950/40 text-amber-300 font-bold px-2.5 py-0.5 rounded-full border border-amber-400/40 flex items-center gap-1">
                    <Shield className="w-3 h-3 text-amber-400" />
                    <span>{roleDef.roleName}</span>
                  </span>
                  <span className="text-[11px] text-white/90 font-medium flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-white/70" />
                    <span>{currentBranch.name}</span>
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              id="btn-close-hamburger-drawer"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-black/25 hover:bg-black/40 flex items-center justify-center text-white transition active:scale-95 border border-white/20 cursor-pointer"
              title="Close Menu (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Notice of Role Filter */}
          <div className="bg-black/30 rounded-xl px-3 py-1.5 text-[11px] text-white/90 flex items-center justify-between border border-white/15">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              <span>Menu arranged for <strong>{roleDef.roleName}</strong></span>
            </span>
            <span className="text-[10px] text-amber-200 font-bold bg-amber-500/20 px-2 py-0.5 rounded-md">
              {roleDef.primaryModules.length} Primary Functions
            </span>
          </div>

          {/* Search Bar */}
          <div className="mt-3 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/70 pointer-events-none" />
            <input
              id="input-hamburger-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search functions, stock, cash balancing..."
              className="w-full bg-slate-950/60 border border-white/25 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-4 custom-scrollbar">
          {/* PLATFORM SUPER ADMIN EXCLUSIVE CONSOLE CARD */}
          {isSuperAdmin && (
            <div className="bg-gradient-to-r from-amber-950/70 via-purple-950/70 to-amber-950/70 border-2 border-amber-500/50 rounded-2xl p-3.5 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black shadow-md">
                    <Crown className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-amber-300 uppercase tracking-wider">
                      Platform Super Admin Console
                    </h4>
                    <p className="text-[10px] text-amber-200/80">
                      System Owner: {currentUser?.name || 'Andre Kudakwashe'}
                    </p>
                  </div>
                </div>
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 shadow-sm">
                  ROOT
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-2">
                Multi-tenant allocations, Google Sheets master routing, system audit logs &amp; diagnostics.
              </p>
              <button
                type="button"
                id="btn-hamburger-super-admin"
                onClick={() => {
                  onClose();
                  if (onOpenSuperAdmin) onOpenSuperAdmin();
                  else onSelectTab('super_admin');
                }}
                className="mt-2.5 w-full py-2 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 shadow-md transition cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Open Super Admin Dashboard</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* THERMAL PRINTER HARDWARE SETUP & PAIRING */}
          {onOpenPrinterModal && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                  <Printer className="w-4 h-4" />
                </div>
                <div>
                  <h5 className="text-xs font-bold text-white">Thermal Receipt Printer</h5>
                  <p className="text-[10px] text-slate-400">ESC/POS 58mm / 80mm Bluetooth pairing</p>
                </div>
              </div>
              <button
                type="button"
                id="btn-hamburger-printer-setup"
                onClick={() => {
                  onClose();
                  onOpenPrinterModal();
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm transition cursor-pointer shrink-0"
              >
                Printer Setup
              </button>
            </div>
          )}

          {/* 1. TOP PRIMARY WORKFLOW SECTION (Ranked by Importance) */}
          {!searchQuery && primaryModules.length > 0 && (
            <div className="bg-gradient-to-br from-purple-950/50 via-slate-900 to-amber-950/30 border border-purple-500/30 rounded-2xl p-3.5 shadow-lg">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 rounded-lg bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-amber-300">
                      Your Primary Workflow
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Ranked in order of importance for {roleDef.roleName}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded-full border border-purple-800">
                  Priority #1 - #{primaryModules.length}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {primaryModules.map((mod, idx) => {
                  const Icon = getModuleIcon(mod.iconName);
                  const isCurrent = activeTab === mod.id;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      id={`hamburger-primary-${mod.id}`}
                      onClick={() => {
                        onSelectTab(mod.id);
                        onClose();
                      }}
                      className={`relative flex items-center space-x-2.5 p-2 rounded-xl text-left transition border group cursor-pointer ${
                        isCurrent
                          ? 'bg-gradient-to-r from-[#6A4DFF]/40 to-[#FF8A00]/40 border-amber-400 text-white shadow-md'
                          : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700/80 text-slate-200'
                      }`}
                    >
                      <div className="relative">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isCurrent
                              ? 'bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] text-white shadow'
                              : 'bg-slate-700 text-amber-300 group-hover:scale-105 transition-transform'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="absolute -top-1.5 -left-1.5 bg-amber-400 text-slate-950 text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-slate-900 shadow">
                          {idx + 1}
                        </span>
                      </div>
                      <div className="overflow-hidden flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-white truncate">
                            {mod.shortLabel}
                          </p>
                          {idx === 0 && (
                            <span className="text-[8px] font-extrabold text-amber-300 uppercase px-1 rounded bg-amber-400/20">
                              Landing
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">
                          {mod.categoryLabel}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. FUNCTIONAL GROUPED CATEGORIES */}
          <div className="space-y-3">
            {groupedModules.map(({ category, meta, modules }) => {
              const CatIcon = meta.icon;
              const isCollapsed = !!collapsedCategories[category];

              return (
                <div
                  key={category}
                  className="bg-slate-950/60 border border-slate-800 rounded-2xl overflow-hidden shadow-sm transition"
                >
                  {/* Category Header */}
                  <button
                    type="button"
                    onClick={() => toggleCategory(category)}
                    className="w-full p-3 flex items-center justify-between text-left hover:bg-slate-800/50 transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2.5">
                      <div
                        className={`w-8 h-8 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center text-white shadow-sm shrink-0`}
                      >
                        <CatIcon className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>{meta.title}</span>
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.2 rounded">
                            {modules.length}
                          </span>
                        </h4>
                        <p className="text-[10px] text-slate-400">{meta.subtitle}</p>
                      </div>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 text-slate-400 transition-transform ${
                        isCollapsed ? '' : 'rotate-90'
                      }`}
                    />
                  </button>

                  {/* Modules in Category */}
                  {!isCollapsed && (
                    <div className="p-2 pt-0 space-y-1 divide-y divide-slate-800/50">
                      {modules.map((mod) => {
                        const Icon = getModuleIcon(mod.iconName);
                        const isCurrent = activeTab === mod.id;
                        const primaryIdx = roleDef.primaryModules.indexOf(mod.id);
                        const isPrimary = primaryIdx >= 0;

                        return (
                          <button
                            key={mod.id}
                            type="button"
                            id={`hamburger-mod-${mod.id}`}
                            onClick={() => {
                              onSelectTab(mod.id);
                              onClose();
                            }}
                            className={`w-full flex items-center justify-between p-2.5 rounded-xl transition text-left cursor-pointer ${
                              isCurrent
                                ? 'bg-gradient-to-r from-purple-900/60 to-orange-950/40 border border-amber-400/60 text-white'
                                : 'hover:bg-slate-800/70 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center space-x-3 overflow-hidden">
                              <div
                                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                  isCurrent
                                    ? 'bg-[#FF8A00] text-slate-950 font-bold'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="overflow-hidden">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-white truncate">
                                    {mod.name}
                                  </span>
                                  {isPrimary && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 flex items-center gap-0.5 shrink-0">
                                      <Star className="w-2.5 h-2.5 fill-amber-300" />
                                      <span>#{primaryIdx + 1}</span>
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-400 line-clamp-1">
                                  {mod.description}
                                </p>
                              </div>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0 ml-2" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {groupedModules.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-xs">
                No matching functions found for query "{searchQuery}".
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            id="btn-hamburger-lock"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold flex items-center justify-center space-x-1.5 transition border border-amber-500/20"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock Terminal</span>
          </button>

          <button
            type="button"
            id="btn-hamburger-logout"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="flex-1 py-2 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold flex items-center justify-center space-x-1.5 transition border border-rose-500/30"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Switch Staff</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
