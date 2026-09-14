import React, { useMemo } from 'react';
import { Salesperson, ActiveTab } from '../../types';
import {
  getSales,
  getCashLogs,
  getCustomers,
  getCashCounts,
  getReconciliations,
  getSyncQueue,
  getCustomerChanges,
  getCreditSales,
  getCustomerChangeReport,
  getCustomerCreditReport,
} from '../../db/roomDatabase';
import {
  Coins,
  ReceiptText,
  ArrowLeftRight,
  ShoppingBag,
  Scale,
  Users,
  FileSpreadsheet,
  ArrowRight,
  TrendingUp,
  Wallet,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Zap,
  LogOut,
  UserCheck,
  CreditCard,
  ShoppingCart,
  Receipt,
  Banknote,
  Boxes,
  Wifi,
} from 'lucide-react';

interface HomeDashboardProps {
  currentUser: Salesperson;
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenSyncModal: () => void;
  onOpenAdminModal: () => void;
  onLogout?: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  currentUser,
  onNavigateTab,
  onOpenSyncModal,
  onOpenAdminModal,
  onLogout,
}) => {
  const sales = getSales();
  const cashLogs = getCashLogs();
  const customers = getCustomers();
  const cashCounts = getCashCounts();
  const reconciliations = getReconciliations();
  const syncQueue = getSyncQueue();

  const todayStr = new Date().toISOString().split('T')[0];

  // Today's metrics
  const todaySales = useMemo(() => {
    return sales.filter((s) => s.date === todayStr);
  }, [sales, todayStr]);

  const todayRevenue = useMemo(() => {
    return todaySales.reduce((acc, s) => acc + s.total, 0);
  }, [todaySales]);

  const drawerNetCash = useMemo(() => {
    let inTotal = 0;
    let outTotal = 0;
    cashLogs.forEach((l) => {
      inTotal += l.in || 0;
      outTotal += l.out || 0;
    });
    return inTotal - outTotal;
  }, [cashLogs]);

  const todayCashCount = useMemo(() => {
    return cashCounts.find((c) => c.date === todayStr && c.staffId === currentUser.id);
  }, [cashCounts, todayStr, currentUser]);

  const todayReconciliation = useMemo(() => {
    return reconciliations.find((r) => r.date === todayStr);
  }, [reconciliations, todayStr]);

  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    (currentUser?.role as string) === 'super_admin' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  const pendingSyncCount = syncQueue.filter((i) => i.status === 'pending' || i.status === 'failed').length;

  const isAdmin = currentUser.role === 'Admin';

  const changeReport = getCustomerChangeReport();
  const creditReport = getCustomerCreditReport();

  const totalChangeOwed = changeReport?.summary?.totalChangeOwed || 0;
  const totalCreditOwed = creditReport?.summary?.totalOutstandingDebt || 0;
  const customersOwedChangeCount = changeReport?.summary?.totalCustomersOwingChange || 0;
  const customersOwingCreditCount = creditReport?.summary?.totalDebtorsCount || 0;

  const allQuickActions = [
    {
      id: 'pos' as ActiveTab,
      title: 'Mobile POS Register',
      subtitle: 'Inventory catalog, checkout, cash tendered & auto-credit form',
      icon: ShoppingCart,
      badge: 'Active POS',
      badgeColor: 'bg-emerald-500/20 text-emerald-300',
      gradient: 'from-orange-950/60 to-slate-900',
      borderColor: 'border-orange-500/40',
      iconBg: 'bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00]',
      adminOnly: false,
    },
    {
      id: 'inventory' as ActiveTab,
      title: 'Inventory & Warehouse Hub',
      subtitle: '4-Tab Suite: Cases + Singles, Goods Received (Rule A), Movement & Setup',
      icon: Boxes,
      badge: 'Master Stock',
      badgeColor: 'bg-indigo-500/20 text-indigo-300',
      gradient: 'from-indigo-950/60 to-slate-900',
      borderColor: 'border-indigo-500/40',
      iconBg: 'bg-gradient-to-tr from-indigo-600 to-purple-600',
      adminOnly: false,
    },
    {
      id: 'cash_balancing' as ActiveTab,
      title: 'Cash Balancing Module',
      subtitle: 'Unified Forms 1, 2, 3 & 4 (Reconciliation)',
      icon: Banknote,
      badge: `$${drawerNetCash.toFixed(2)} Net Cash`,
      badgeColor: 'bg-purple-500/20 text-purple-300',
      gradient: 'from-purple-900/60 to-slate-900',
      borderColor: 'border-purple-500/40',
      iconBg: 'bg-gradient-to-tr from-purple-600 to-indigo-600',
      adminOnly: false,
    },
    {
      id: 'orders' as ActiveTab,
      title: 'Sales & Invoices History',
      subtitle: 'Complete list of POS sales, thermal receipts & audit trail',
      icon: Receipt,
      badge: `${sales.length} Invoices`,
      badgeColor: 'bg-blue-500/20 text-blue-300',
      gradient: 'from-slate-900 to-blue-950/40',
      borderColor: 'border-blue-500/30',
      iconBg: 'bg-gradient-to-tr from-blue-600 to-cyan-500',
      adminOnly: false,
    },
    {
      id: 'credit_report' as ActiveTab,
      title: 'Credit Debtors Ledger',
      subtitle: 'Form 3 credit sales & customer debt tracking',
      icon: CreditCard,
      badge: `$${totalCreditOwed.toFixed(2)} Owed`,
      badgeColor: 'bg-rose-500/20 text-rose-300',
      gradient: 'from-slate-900 to-rose-950/40',
      borderColor: 'border-rose-500/30',
      iconBg: 'bg-gradient-to-tr from-rose-600 to-orange-500',
      adminOnly: false,
    },
    {
      id: 'customers' as ActiveTab,
      title: 'Customer Database (Merged)',
      subtitle: 'Unified customers across POS and Cash Balancing',
      icon: Users,
      badge: `${customers.length} Customers`,
      badgeColor: 'bg-amber-500/20 text-amber-300',
      gradient: 'from-slate-900 to-purple-950/40',
      borderColor: 'border-purple-500/30',
      iconBg: 'bg-gradient-to-tr from-purple-600 to-[#FF8A00]',
      adminOnly: false,
    },
    {
      id: 'reconciliation' as ActiveTab,
      title: 'Shift Reconciliation (Admin)',
      subtitle: 'Form 4 • Sum of Form 2 & 3 Net vs External Sales Audit',
      icon: Scale,
      badge: todayReconciliation ? todayReconciliation.status : 'Admin Sheet',
      badgeColor: todayReconciliation ? 'bg-emerald-500/20 text-emerald-300' : 'bg-purple-500/20 text-purple-300',
      gradient: 'from-purple-950/70 to-slate-900',
      borderColor: 'border-amber-500/40',
      iconBg: 'bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00]',
      adminOnly: true,
    },
  ];

  const quickActions = allQuickActions.filter((a) => !a.adminOnly || isAdmin);

  return (
    <div className="space-y-4 pb-20 select-none">
      {/* Welcome Hero Banner with Branding Accent */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-purple-950/70 to-slate-900 border border-purple-500/30 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="absolute top-0 right-0 transform translate-x-6 -translate-y-6 w-36 h-36 bg-gradient-to-br from-[#6A4DFF]/20 to-[#FF8A00]/20 rounded-full blur-2xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs uppercase font-bold tracking-wider text-[#FF8A00]">
                Welcome back, {currentUser.name.split(' ')[0]}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white font-mono-num font-bold">
                ID #{currentUser.id}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-1">
              Field Sales & Cash Flow Command
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-lg">
              Operating in offline-first Room database mode with seamless automatic synchronization to Google Sheets.
            </p>
          </div>

          <div className="flex items-center space-x-2 shrink-0 flex-wrap gap-y-2">
            <button
              id="btn-quick-new-sale"
              type="button"
              onClick={() => onNavigateTab('pos')}
              className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] hover:opacity-95 text-white font-black text-xs shadow-lg flex items-center space-x-2 transition active:scale-95"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>+ POS Register</span>
            </button>

            <button
              id="btn-quick-cash-count"
              type="button"
              onClick={() => onNavigateTab('cash_balancing')}
              className="py-2.5 px-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 flex items-center space-x-1.5 transition"
            >
              <Coins className="w-4 h-4 text-[#FF8A00]" />
              <span>Cash Balancing</span>
            </button>

            {onLogout && (
              <button
                id="btn-hero-logout"
                type="button"
                onClick={onLogout}
                title="Log Out of this session"
                className="py-2.5 px-3.5 rounded-2xl bg-rose-950/60 hover:bg-rose-900/80 text-rose-200 font-bold text-xs border border-rose-500/40 flex items-center space-x-1.5 transition active:scale-95 shadow-md"
              >
                <LogOut className="w-4 h-4 text-rose-400" />
                <span>Log Out</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Quick Stat Metric Tiles */}
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-slate-800/80">
          {/* Revenue */}
          <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Today's Revenue</span>
            <div className="text-lg font-black font-mono-num text-emerald-400 mt-0.5">
              ${todayRevenue.toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-500 font-medium font-mono-num">{todaySales.length} invoices</span>
          </div>

          {/* Net Cash Drawer */}
          <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Drawer Cash In Hand</span>
            <div className="text-lg font-black font-mono-num text-white mt-0.5">
              ${drawerNetCash.toFixed(2)}
            </div>
            <span className="text-[10px] text-purple-300 font-medium">Net calculated</span>
          </div>

          {/* Customers */}
          <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Customers (Room DB)</span>
            <div className="text-lg font-black font-mono-num text-[#FF8A00] mt-0.5">
              {customers.length}
            </div>
            <span className="text-[10px] text-slate-500 font-medium">Sheet "Customers"</span>
          </div>

          {/* Sync Status */}
          <div
            onClick={isSuperAdmin ? onOpenSyncModal : undefined}
            className={`p-3 rounded-2xl bg-slate-950/60 border border-slate-800 transition ${
              isSuperAdmin ? 'cursor-pointer hover:border-purple-500/50' : 'cursor-default'
            }`}
          >
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Sheets Sync Status</span>
            <div className="text-lg font-black font-mono-num text-purple-300 mt-0.5 flex items-center space-x-1">
              <span>{pendingSyncCount === 0 ? '✓ Live Synced' : `${pendingSyncCount} Queued`}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium">
              {isSuperAdmin ? 'Click to inspect (Super Admin)' : 'Managed by Super Admin'}
            </span>
          </div>
        </div>
      </div>

      {/* 4 Core Data Entry Forms Launcher Grid */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
            <Zap className="w-3.5 h-3.5 text-[#FF8A00]" />
            <span>Core Data Entry Forms (4 Forms)</span>
          </h3>
          <span className="text-xs text-slate-500">Auto-fills Staff: {currentUser.name}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                id={`card-launcher-${action.id}`}
                type="button"
                onClick={() => onNavigateTab(action.id)}
                className={`text-left p-4 sm:p-5 rounded-3xl bg-gradient-to-br ${action.gradient} border ${action.borderColor} shadow-lg backdrop-blur-sm hover:border-[#6A4DFF] hover:scale-[1.01] active:scale-98 transition flex flex-col justify-between group`}
              >
                <div className="flex items-start justify-between">
                  <div className={`w-12 h-12 rounded-2xl ${action.iconBg} flex items-center justify-center text-white shadow-md`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${action.badgeColor} font-mono-num`}>
                    {action.badge}
                  </span>
                </div>

                <div className="mt-4">
                  <h4 className="text-base font-bold text-white group-hover:text-purple-300 transition">
                    {action.title}
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">{action.subtitle}</p>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-bold text-[#FF8A00]">
                  <span>Open Form</span>
                  <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Secondary Row: Customers Directory & Google Sheets Manager */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Customer Directory Tile */}
        <div
          onClick={() => onNavigateTab('customers')}
          className="p-4 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-purple-500/40 shadow-md cursor-pointer transition flex items-center justify-between"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-300 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Customer Database (CRM)</h4>
              <p className="text-xs text-slate-400">{customers.length} Registered (C001, C002...)</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500" />
        </div>

        {/* Google Sheets Sync Hub Tile - Super Admin Only, or Local Data Backup for Owners */}
        {isSuperAdmin ? (
          <div
            onClick={onOpenSyncModal}
            className="p-4 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-orange-500/40 shadow-md cursor-pointer transition flex items-center justify-between"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-orange-500/20 text-[#FF8A00] flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Google Sheets Hub</h4>
                <p className="text-xs text-slate-400">View 6 Sheet Tabs &amp; Super Admin Sync</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500" />
          </div>
        ) : (
          <div
            onClick={() => onNavigateTab('data_management')}
            className="p-4 rounded-3xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/40 shadow-md cursor-pointer transition flex items-center justify-between"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Data Backup &amp; Exports</h4>
                <p className="text-xs text-slate-400">Export Local Sales &amp; Records to CSV</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500" />
          </div>
        )}

        {/* P2P WiFi Mesh Sync Tile */}
        <div
          id="btn-nav-p2p-mesh-hub"
          onClick={() => onNavigateTab('p2p_mesh')}
          className="p-4 rounded-3xl bg-gradient-to-r from-indigo-950/60 to-purple-950/60 border border-indigo-500/30 hover:border-indigo-400 shadow-md cursor-pointer transition flex items-center justify-between sm:col-span-2"
        >
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center border border-indigo-500/30">
              <Wifi className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h4 className="text-sm font-bold text-white">P2P WiFi Mesh Sync (Epidemic Broadcast)</h4>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                  3 TO 50 DEVICES
                </span>
              </div>
              <p className="text-xs text-indigo-200/70">
                Serverless peer-to-peer sync • Android NSD auto-discovery • Opportunistic Google Sheets upload
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-indigo-400" />
        </div>
      </div>

      {/* Reports & Ledgers Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Customer Change Report Tile */}
        <div
          id="btn-nav-customer-change-report"
          onClick={() => onNavigateTab('change_report')}
          className="p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 hover:border-emerald-400 shadow-lg cursor-pointer transition active:scale-98 group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center justify-center shadow-md">
              <Coins className="w-6 h-6 text-emerald-400" />
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono-num">
              {customersOwedChangeCount} Customers Owed
            </span>
          </div>

          <div className="mt-3">
            <h4 className="text-base font-bold text-white group-hover:text-emerald-300 transition">
              Customer Change Report
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Track how much change is owed by customer name & days elapsed since left in IN column.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Change Held</span>
              <span className="text-base font-black text-emerald-400 font-mono-num">
                ${totalChangeOwed.toFixed(2)}
              </span>
            </div>
            <span className="text-xs font-bold text-emerald-400 flex items-center space-x-1">
              <span>View Report</span>
              <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition" />
            </span>
          </div>
        </div>

        {/* Customer Credit Debt Report Tile */}
        <div
          id="btn-nav-customer-credit-report"
          onClick={() => onNavigateTab('credit_report')}
          className="p-4 sm:p-5 rounded-3xl bg-gradient-to-br from-orange-950/40 via-slate-900 to-slate-900 border border-orange-500/30 hover:border-orange-400 shadow-lg cursor-pointer transition active:scale-98 group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between">
            <div className="w-11 h-11 rounded-2xl bg-orange-500/20 text-[#FF8A00] border border-orange-500/30 flex items-center justify-center shadow-md">
              <CreditCard className="w-6 h-6 text-orange-400" />
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 font-mono-num">
              {customersOwingCreditCount} Owing Customers
            </span>
          </div>

          <div className="mt-3">
            <h4 className="text-base font-bold text-white group-hover:text-orange-300 transition">
              Customer Credit Debt Report
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Aging receivables, overdue alerts, and record partial/full customer repayments.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Total Credit Outstanding</span>
              <span className="text-base font-black text-[#FF8A00] font-mono-num">
                ${totalCreditOwed.toFixed(2)}
              </span>
            </div>
            <span className="text-xs font-bold text-[#FF8A00] flex items-center space-x-1">
              <span>View Report</span>
              <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition" />
            </span>
          </div>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center space-x-2">
            <Clock className="w-3.5 h-3.5 text-[#6A4DFF]" />
            <span>Recent Activity Feed</span>
          </h3>
          <span className="text-[11px] text-slate-500">Live Room DB Log</span>
        </div>

        <div className="space-y-2">
          {cashLogs.slice(0, 4).map((log, logIdx) => (
            <div
              key={`${log.id}-${log.timestamp || logIdx}`}
              className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
            >
              <div className="flex items-center space-x-2.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    log.in > 0 ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <div>
                  <span className="font-bold text-white">{log.description}</span>
                  <span className="text-[10px] text-slate-400 block font-mono-num">
                    {log.date} • {log.staffName} (#{log.staffId}) • {log.line}
                  </span>
                </div>
              </div>

              <span
                className={`font-mono-num font-black ${
                  log.in > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {log.in > 0 ? `+$${log.in.toFixed(2)}` : `-$${log.out.toFixed(2)}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Active Shift Session & User Account Management */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5 w-full sm:w-auto">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center font-black text-base text-white shadow-md shrink-0">
            {currentUser.name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-black text-white">{currentUser.name}</h4>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono-num font-bold">
                Staff #{currentUser.id}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 font-bold">
                {currentUser.role}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Active Field Session • Room DB v2.4</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 w-full sm:w-auto">
          {currentUser.role === 'Admin' && (
            <button
              type="button"
              onClick={onOpenAdminModal}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center justify-center space-x-2 border border-slate-700"
            >
              <Users className="w-4 h-4 text-purple-400" />
              <span>Admin Staff</span>
            </button>
          )}

          {onLogout && (
            <button
              type="button"
              id="btn-footer-logout"
              onClick={onLogout}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-black transition shadow-lg shadow-rose-950/40 flex items-center justify-center space-x-2 active:scale-95"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out / Switch Account</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
