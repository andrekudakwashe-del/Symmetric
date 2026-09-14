import React, { useState, useEffect, useRef } from 'react';
import { Salesperson, ActiveTab, Customer } from './types';
import {
  getCurrentUser,
  setCurrentUser,
  subscribeToDatabase,
  getSyncQueue,
  initializeRoomDatabase,
  logLogin,
  logLogout,
  logSessionTimeout,
  getCurrentCompany,
  getSubscriptionStatus,
} from './db/roomDatabase';
import { AndroidStatusBar } from './components/layout/AndroidStatusBar';
import { TopHeader } from './components/layout/TopHeader';
import { BottomNavigation } from './components/layout/BottomNavigation';
import { LoginScreen } from './components/auth/LoginScreen';
import { TrialExpiredLockScreen } from './components/auth/TrialExpiredLockScreen';
import { HomeDashboard } from './components/dashboard/HomeDashboard';
import { POSRegister } from './components/pos/POSRegister';
import { POSOrdersHistory } from './components/pos/POSOrdersHistory';
import { CashBalancingModule } from './components/forms/CashBalancingModule';
import { Form1CashCount } from './components/forms/Form1CashCount';
import { Form2CashLog } from './components/forms/Form2CashLog';
import { Form3SalesEntry } from './components/forms/Form3SalesEntry';
import { Form4Reconciliation } from './components/forms/Form4Reconciliation';
import { CustomerListScreen } from './components/customers/CustomerListScreen';
import { CustomerChangeReport } from './components/reports/CustomerChangeReport';
import { CustomerCreditReport } from './components/reports/CustomerCreditReport';
import { SalesReport } from './components/reports/SalesReport';
import { AuditLogView } from './components/admin/AuditLogView';
import { GoogleSheetsSyncModal } from './components/sheets/GoogleSheetsSyncModal';
import { SalespersonManagementModal } from './components/admin/SalespersonManagementModal';
import { StaffAccessManagementScreen } from './components/admin/StaffAccessManagementScreen';
import { InventoryHubScreen } from './components/inventory/InventoryHubScreen';
import { SupplierListScreen } from './components/suppliers/SupplierListScreen';
import { DailyGoodsReceivedReport } from './components/inventory/DailyGoodsReceivedReport';
import { DataManagementHub } from './components/admin/DataManagementHub';
import { OfflineIndicator } from './components/pwa/OfflineIndicator';
import { UniversalReportBuilder } from './components/reports/UniversalReportBuilder';
import { CustomReportsListView } from './components/reports/CustomReportsListView';
import { P2PMeshSyncHub } from './components/sync/P2PMeshSyncHub';
import { PermissionsMatrixModal } from './components/admin/PermissionsMatrixModal';
import { SuperAdminDashboard } from './components/admin/SuperAdminDashboard';
import { BranchSetupScreen } from './components/admin/BranchSetupScreen';
import { ShieldCheck, Clock, Wifi, Crown } from 'lucide-react';
import { initializeSystemConfigAndSync } from './services/systemConfig';

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity timeout

export default function App() {
  // Login: Required on app open
  const [currentUser, setLoggedInUser] = useState<Salesperson | null>(() => {
    initializeRoomDatabase();
    return null;
  });
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [dbVersion, setDbVersion] = useState(0);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [editingReportTemplateId, setEditingReportTemplateId] = useState<string | null>(null);

  // Inactivity tracking state
  const lastActivityRef = useRef<number>(Date.now());
  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);
  const [lockoutMessage, setLockoutMessage] = useState<string | null>(null);

  // Cross-form navigation state (e.g. from Customer directory -> create sale for customer)
  const [salePreselectedCustomer, setSalePreselectedCustomer] = useState<Customer | string | null>(null);

  // Inactivity timer effect (5 minutes)
  useEffect(() => {
    if (!currentUser) return;

    lastActivityRef.current = Date.now();

    const handleUserActivity = () => {
      lastActivityRef.current = Date.now();
      setWarningSeconds(null);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((evt) => window.addEventListener(evt, handleUserActivity, { passive: true }));

    const timer = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remainingMs = INACTIVITY_TIMEOUT_MS - elapsed;

      if (remainingMs <= 0) {
        logSessionTimeout(currentUser);
        setCurrentUser(null);
        setLoggedInUser(null);
        setWarningSeconds(null);
        setLockoutMessage('Terminal automatically locked after 5 minutes of inactivity. Please enter your PIN to resume.');
      } else if (remainingMs <= 30000) {
        setWarningSeconds(Math.ceil(remainingMs / 1000));
      } else {
        setWarningSeconds(null);
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      events.forEach((evt) => window.removeEventListener(evt, handleUserActivity));
    };
  }, [currentUser]);

  // Subscribe to Room DB changes
  useEffect(() => {
    const unsubscribe = subscribeToDatabase(() => {
      setDbVersion((v) => v + 1);
    });
    return () => unsubscribe();
  }, []);

  // Sync global system config and tenants on boot
  useEffect(() => {
    initializeSystemConfigAndSync().catch(() => {});
  }, []);

  const handleLoginSuccess = (user: Salesperson) => {
    lastActivityRef.current = Date.now();
    setWarningSeconds(null);
    setLockoutMessage(null);
    logLogin(user);
    setCurrentUser(user);
    setLoggedInUser(user);
    setActiveTab('home');
  };

  const handleLogout = (reason: string = 'User Logged Out') => {
    if (currentUser) {
      logLogout(currentUser, reason);
    }
    setCurrentUser(null);
    setLoggedInUser(null);
    setWarningSeconds(null);
    setLockoutMessage(null);
    setActiveTab('home');
  };

  const handleCreateSaleForCustomer = (customer: Customer) => {
    setSalePreselectedCustomer(customer.name);
    setActiveTab('items');
  };

  const handleNavigateWithContext = (tab: ActiveTab, contextCustomer?: string) => {
    if (contextCustomer) {
      setSalePreselectedCustomer(contextCustomer);
    }
    setActiveTab(tab);
  };

  // If user is not logged in, display the Android Material 3 Login Screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans w-full max-w-[100vw] overflow-x-hidden">
        <AndroidStatusBar
          isOffline={isOfflineMode}
          onToggleOffline={() => setIsOfflineMode(!isOfflineMode)}
        />
        <LoginScreen onLoginSuccess={handleLoginSuccess} lockoutMessage={lockoutMessage} />
        <OfflineIndicator isSimulatedOffline={isOfflineMode} />
      </div>
    );
  }

  // Check SaaS 14-day trial & license status
  const currentCompany = getCurrentCompany();
  const subStatus = getSubscriptionStatus(currentCompany);
  const isSuperAdmin =
    currentUser.role === 'SUPER_ADMIN' ||
    currentUser.email?.toLowerCase() === 'andrekudakwashe@gmail.com';

  // If trial has expired and user is not Super Admin, display the TrialExpiredLockScreen
  if (!isSuperAdmin && subStatus.isExpired) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans w-full max-w-[100vw] overflow-x-hidden">
        <AndroidStatusBar
          isOffline={isOfflineMode}
          onToggleOffline={() => setIsOfflineMode(!isOfflineMode)}
        />
        <TrialExpiredLockScreen
          onUnlockSuccess={() => setDbVersion((v) => v + 1)}
          onLogout={() => handleLogout()}
        />
      </div>
    );
  }

  // Calculate sync queue status
  const queue = getSyncQueue();
  const pendingCount = queue.filter((i) => i.status === 'pending' || i.status === 'failed').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-[#6A4DFF] selection:text-white relative w-full max-w-[100vw] overflow-x-hidden">
      {/* 5-minute inactivity countdown warning (< 30s) */}
      {warningSeconds !== null && warningSeconds > 0 && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 px-4 py-2 rounded-full shadow-2xl font-black text-xs flex items-center space-x-2 border-2 border-amber-300 animate-bounce">
          <Clock className="w-4 h-4 text-slate-950" />
          <span>Inactivity Lock in {warningSeconds}s — Move cursor or tap screen to stay active</span>
        </div>
      )}

      {/* 1. Android Simulated Status Bar */}
      <AndroidStatusBar
        isOffline={isOfflineMode}
        onToggleOffline={() => setIsOfflineMode(!isOfflineMode)}
        onOpenConnectivity={() => setActiveTab('p2p_mesh')}
      />

      {/* 2. Top Application Header with User Status, Profile & Direct Logout Button */}
      <TopHeader
        currentUser={currentUser}
        onLogout={handleLogout}
        pendingSyncCount={pendingCount}
        isOffline={isOfflineMode}
        onToggleOffline={() => setIsOfflineMode(!isOfflineMode)}
        onOpenSyncModal={() => setIsSyncModalOpen(true)}
        onOpenAdminModal={() => setIsAdminModalOpen(true)}
        onOpenPermissions={() => setIsPermissionsModalOpen(true)}
        onOpenSuperAdmin={isSuperAdmin ? () => setIsSuperAdminModalOpen(true) : undefined}
        onTabChange={(tab) => {
          if (tab !== 'pos' && tab !== 'items' && tab !== 'counter' && tab !== 'sales') {
            setSalePreselectedCustomer(null);
          }
          setActiveTab(tab);
        }}
      />

      {/* SaaS Trial Status Alert Banner */}
      {!isSuperAdmin && subStatus.isTrial && !subStatus.isExpired && (
        <div className="bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border-b border-amber-500/30 px-3 sm:px-4 py-2 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">
              <strong>14-Day Free Trial:</strong> {subStatus.daysRemaining} day(s) remaining for <strong>{currentCompany.company_name}</strong> (Expires {currentCompany.next_billing_date})
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const msg = `Hi Andre, I am enjoying my SAIMETRIC POS trial for ${currentCompany.company_name} (${currentCompany.company_id}). I want to confirm payment for the full license.`;
              navigator.clipboard.writeText(msg);
              window.open(`https://wa.me/263771234567?text=${encodeURIComponent(msg)}`, '_blank');
            }}
            className="px-2.5 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] shadow-sm shrink-0 flex items-center gap-1 cursor-pointer"
          >
            <span>Confirm Payment</span>
            <span>&rarr;</span>
          </button>
        </div>
      )}

      {/* Super Admin Session Indicator */}
      {isSuperAdmin && (
        <div className="bg-gradient-to-r from-amber-500/20 via-purple-500/20 to-amber-500/20 border-b border-amber-500/30 px-3 sm:px-4 py-1.5 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">
              Super Admin: <strong>Andre Kudakwashe</strong> • Active Workspace: <strong>{currentCompany.company_name}</strong> ({currentCompany.company_id})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsSuperAdminModalOpen(true)}
            className="px-2.5 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[10px] shrink-0 cursor-pointer"
          >
            Manage SaaS Tenants &rarr;
          </button>
        </div>
      )}

      {/* 3. Main Screen View Area */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-2 sm:px-4 pt-2 sm:pt-4 overflow-x-hidden">
        {/* POS REGISTER WORKFLOW (Screens 1, 2, 3) */}
        {(activeTab === 'home' ||
          activeTab === 'pos' ||
          activeTab === 'items' ||
          activeTab === 'counter' ||
          activeTab === 'more') && (
          <POSRegister
            currentUser={currentUser}
            onLogout={handleLogout}
            onNavigate={handleNavigateWithContext}
            preSelectedCustomerName={
              typeof salePreselectedCustomer === 'string'
                ? salePreselectedCustomer
                : salePreselectedCustomer?.name
            }
            activeGlobalTab={activeTab}
          />
        )}

        {/* TODAY / ORDERS & INVOICE HISTORY (Screenshot Tab "Today") */}
        {(activeTab === 'today' || activeTab === 'orders') && (
          <POSOrdersHistory
            currentUser={currentUser}
            onNavigate={handleNavigateWithContext}
          />
        )}

        {/* REPORTS HUB (Screenshot Tab "Reports") */}
        {activeTab === 'reports' && (
          <div className="space-y-4 pb-24 animate-fadeIn">
            <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] text-white rounded-3xl p-4 sm:p-5 shadow-xl flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black">Audit & Debtor Reports</h2>
                <p className="text-xs text-white/80">Real-time ledgers, credit aging & change reports</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Universal No-Code Report Builder & Saved Reports */}
              <div
                id="card-reports-nocode-builder"
                onClick={() => setActiveTab('custom_reports')}
                className="bg-gradient-to-br from-[#6A4DFF]/30 via-indigo-950/80 to-slate-900 border-2 border-[#6A4DFF]/60 hover:border-[#6A4DFF] rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-xl md:col-span-2 relative overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-white group-hover:text-purple-300 flex items-center gap-2">
                    <span className="text-xl">✨</span>
                    <span>Universal No-Code Report Builder &amp; Saved Reports</span>
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-purple-500/30 text-purple-200 text-xs font-bold font-mono border border-purple-500/40">
                      Data Dictionary Powered
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono border border-emerald-500/30">
                      5-Step Wizard
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-300">
                  Build ANY custom report from ANY table (Sales, Products, Inventory, Customers, Suppliers, Staff, Deliveries) without writing code. Auto-suggest joins, role-based access control, interactive charts, and CSV exports.
                </p>
              </div>

              {/* Audit Log & Security Ledger Card */}
              <div
                id="card-reports-audit-log"
                onClick={() => setActiveTab('audit_log')}
                className="bg-gradient-to-br from-purple-950/80 via-slate-900 to-slate-900 border border-purple-500/40 hover:border-purple-400 rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-lg md:col-span-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-white group-hover:text-purple-300 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-purple-400" />
                    <span>POS Terminal Audit Log &amp; Security Ledger</span>
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono border border-emerald-500/30 flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>Audit Log: ON</span>
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold font-mono">
                      Security
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-300">
                  Immutable tamper-evident records of logins, 5-minute inactivity logouts, and Manager PIN authorizations for Refunds, Voids, and Discounts &gt; 5%.
                </p>
              </div>

              {/* P2P WiFi Mesh Connections & Sync Ledger */}
              <div
                id="card-reports-p2p-mesh"
                onClick={() => setActiveTab('p2p_mesh')}
                className="bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-900 border border-indigo-500/40 hover:border-indigo-400 rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-lg md:col-span-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-white group-hover:text-indigo-300 flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-indigo-400" />
                    <span>P2P WiFi Mesh Connections &amp; Sync Ledger</span>
                  </span>
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono border border-emerald-500/30 flex items-center space-x-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>Mesh: Active</span>
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold font-mono">
                      3 to 50 Devices
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-300">
                  Inspect active peer connections, NSD auto-discovery, epidemic broadcast hops, packet delivery acknowledgments, and opportunistic Google Sheets cloud sync.
                </p>
              </div>

              <div
                onClick={() => setActiveTab('sales_report')}
                className="bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-900 border border-indigo-500/40 hover:border-indigo-400 rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-lg md:col-span-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-white group-hover:text-indigo-300 flex items-center gap-2">
                    <span className="text-indigo-400">📈</span>
                    <span>Sales, Profit & Top Stocks Report</span>
                  </span>
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono border border-emerald-500/30">
                    Financial & Stock Insights
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Comprehensive performance breakdown showing total revenue, gross profit, markup margins, product sales volume, and top moving stocks.
                </p>
              </div>

              <div
                onClick={() => setActiveTab('credit_report')}
                className="bg-slate-900 border border-slate-800 hover:border-orange-500/50 rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-white group-hover:text-orange-400">
                    Form 3 Credit Sales & Debtor Ledger
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-xs font-bold font-mono">
                    Debtors
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Track overdue balances, days owing, and customer credit limits with WhatsApp reminders.
                </p>
              </div>

              <div
                onClick={() => setActiveTab('change_report')}
                className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-white group-hover:text-emerald-400">
                    Customer Change Left Behind
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono">
                    Unsettled
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Track change held in shop trust for customers, settle balances or apply to new purchases.
                </p>
              </div>

              <div
                onClick={() => setActiveTab('cash_balancing')}
                className="bg-slate-900 border border-slate-800 hover:border-purple-500/50 rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-white group-hover:text-purple-400">
                    Forms 1–4 Cash Drawer Balancing
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold font-mono">
                    Audit
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Form 1 (Count), Form 2 (Movements), Form 3 (Credit/Change), Form 4 (Variance Audit).
                </p>
              </div>

              <div
                onClick={() => setActiveTab('data_management')}
                className="bg-gradient-to-br from-indigo-950/80 to-slate-900 border border-indigo-500/40 hover:border-indigo-400 rounded-3xl p-5 cursor-pointer transition active:scale-[0.99] space-y-2 group shadow-md md:col-span-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-white group-hover:text-indigo-300 flex items-center gap-2">
                    <span>📊</span>
                    <span>Admin Data Center & All Reports Export</span>
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold font-mono">
                    Import / Export
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Export or import Inventory, Customers, and Suppliers. Single-click CSV export for all 12 operational reports & system master backups.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* CASH BALANCING MODULE (UNIFIED FORMS 1-4) */}
        {activeTab === 'cash_balancing' && (
          <CashBalancingModule
            currentUser={currentUser}
            initialSubTab="form1"
            preselectedCustomer={
              typeof salePreselectedCustomer === 'string'
                ? salePreselectedCustomer
                : salePreselectedCustomer?.name
            }
            onNavigateHome={() => setActiveTab('home')}
            onNavigateToPOS={() => setActiveTab('pos')}
            onNavigateToCreditReport={() => setActiveTab('credit_report')}
          />
        )}

        {/* HOME & EXECUTIVE DASHBOARD */}
        {activeTab === 'dashboard' && (
          <HomeDashboard
            currentUser={currentUser}
            onNavigateTab={(tab) => setActiveTab(tab)}
            onOpenSyncModal={() => setIsSyncModalOpen(true)}
            onOpenAdminModal={() => setIsAdminModalOpen(true)}
            onLogout={handleLogout}
          />
        )}

        {/* DIRECT FORM TABS (IF LINKED DIRECTLY) */}
        {activeTab === 'cash_count' && (
          <CashBalancingModule
            currentUser={currentUser}
            initialSubTab="form1"
            onNavigateHome={() => setActiveTab('home')}
            onNavigateToPOS={() => setActiveTab('pos')}
          />
        )}

        {activeTab === 'cash_log' && (
          <CashBalancingModule
            currentUser={currentUser}
            initialSubTab="form2"
            onNavigateHome={() => setActiveTab('home')}
            onNavigateToPOS={() => setActiveTab('pos')}
          />
        )}

        {activeTab === 'sales' && (
          <CashBalancingModule
            currentUser={currentUser}
            initialSubTab="form3"
            preselectedCustomer={
              typeof salePreselectedCustomer === 'string'
                ? salePreselectedCustomer
                : salePreselectedCustomer?.name
            }
            onNavigateHome={() => setActiveTab('home')}
            onNavigateToPOS={() => setActiveTab('pos')}
          />
        )}

        {activeTab === 'reconciliation' && (
          <CashBalancingModule
            currentUser={currentUser}
            initialSubTab="form4"
            onNavigateHome={() => setActiveTab('home')}
            onNavigateToPOS={() => setActiveTab('pos')}
          />
        )}

        {/* CUSTOMER DATABASE (MERGED) */}
        {activeTab === 'customers' && (
          <CustomerListScreen
            currentUser={currentUser}
            onSelectCustomerForSale={handleCreateSaleForCustomer}
            onNavigateToCreditReport={(customerName) => {
              setSalePreselectedCustomer(customerName);
              setActiveTab('credit_report');
            }}
            onNavigateToChangeReport={(customerName) => {
              setSalePreselectedCustomer(customerName);
              setActiveTab('change_report');
            }}
          />
        )}

        {/* SALES, PROFIT & TOP STOCKS REPORT */}
        {activeTab === 'sales_report' && (
          <SalesReport
            currentUser={currentUser}
            onNavigateToPOS={() => setActiveTab('pos')}
            onNavigateToInventory={() => setActiveTab('inventory')}
            onClose={() => setActiveTab('reports')}
          />
        )}

        {/* CUSTOMER CHANGE REPORT */}
        {activeTab === 'change_report' && (
          <CustomerChangeReport
            currentUser={currentUser}
            onNavigateToForm3={(customerName) => {
              if (customerName) setSalePreselectedCustomer(customerName);
              setActiveTab('sales');
            }}
            onClose={() => setActiveTab('home')}
          />
        )}

        {/* CUSTOMER CREDIT DEBT REPORT */}
        {activeTab === 'credit_report' && (
          <CustomerCreditReport
            currentUser={currentUser}
            onNavigateToForm3={(customerName) => {
              if (customerName) setSalePreselectedCustomer(customerName);
              setActiveTab('sales');
            }}
            onClose={() => setActiveTab('home')}
          />
        )}

        {/* POS TERMINAL AUDIT LOG & SECURITY VIEW */}
        {activeTab === 'audit_log' && (
          <AuditLogView onBack={() => setActiveTab('reports')} />
        )}

        {/* SUPPLIER DATABASE (CRUD + INVOICE HISTORY) */}
        {activeTab === 'suppliers' && (
          <SupplierListScreen
            currentUser={currentUser}
            onNavigateToGRN={(supplierName) => {
              setActiveTab('goods_received');
            }}
            onNavigateHome={() => setActiveTab('home')}
          />
        )}

        {/* DAILY GOODS RECEIVED ADMIN REPORT */}
        {activeTab === 'grn_daily_report' && (
          <DailyGoodsReceivedReport
            onGoToGRN={() => setActiveTab('goods_received')}
          />
        )}

        {/* INVENTORY & WAREHOUSE SUITE (TABS 1-4 & STOCKTAKE) */}
        {(activeTab === 'inventory' ||
          activeTab === 'goods_received' ||
          activeTab === 'stock_movement' ||
          activeTab === 'stocktake' ||
          activeTab === 'inventory_setup') && (
          <InventoryHubScreen
            currentUser={currentUser}
            activeSubTab={
              activeTab === 'goods_received'
                ? 'grn'
                : activeTab === 'stock_movement'
                ? 'movement'
                : activeTab === 'stocktake'
                ? 'stocktake'
                : activeTab === 'inventory_setup'
                ? 'setup'
                : 'master'
            }
            onNavigateHome={() => setActiveTab('home')}
            onNavigateToPOS={() => setActiveTab('pos')}
          />
        )}

        {/* STAFF ACCESS & PERMISSIONS VIEW */}
        {(activeTab === 'staff_access' || activeTab === 'salespeople') && (
          <StaffAccessManagementScreen
            currentUser={currentUser}
            onNavigateHome={() => setActiveTab('home')}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {/* BRANCH SETUP & PARTITIONS VIEW */}
        {activeTab === 'branch_setup' && (
          <BranchSetupScreen
            currentUser={currentUser}
            onNavigateHome={() => setActiveTab('home')}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {/* SAAS MULTI-TENANT SUPER ADMIN VIEW */}
        {activeTab === 'super_admin' && (
          isSuperAdmin ? (
            <SuperAdminDashboard
              isOpen={true}
              currentUser={currentUser}
              onClose={() => setActiveTab('home')}
            />
          ) : (
            <div className="p-8 text-center bg-slate-900 border border-red-500/40 rounded-3xl space-y-4 max-w-lg mx-auto mt-12 shadow-2xl">
              <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto text-3xl">
                🛡️
              </div>
              <h2 className="text-xl font-black text-white">Access Restricted</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                The SaaS Multi-Tenant Management console is strictly restricted to Platform Super Administrators. Your current role (<span className="text-amber-400 font-mono font-bold">{currentUser.role}</span>) does not have access.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold transition cursor-pointer"
              >
                Return to POS Home
              </button>
            </div>
          )
        )}

        {/* ADMIN DATA CENTER (IMPORT/EXPORT & REPORTS EXPORT) */}
        {activeTab === 'data_management' && (
          <DataManagementHub
            currentUser={currentUser}
            initialTab="inventory"
            onNavigateHome={() => setActiveTab('home')}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {/* SHEETS SYNC VIEW */}
        {activeTab === 'sheets' && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4">
            <h2 className="text-xl font-bold text-white">Google Sheets Integration</h2>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Real-time synchronization for Customers, Cash Logs, Sales, Products, and Reconciliations.
            </p>
            <button
              type="button"
              onClick={() => setIsSyncModalOpen(true)}
              className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white text-xs font-bold shadow-lg"
            >
              Open Sync Controls
            </button>
          </div>
        )}

        {/* UNIVERSAL NO-CODE REPORT BUILDER (5-STEP WIZARD) */}
        {activeTab === 'report_builder' && (
          <UniversalReportBuilder
            currentUser={currentUser}
            initialTemplateId={editingReportTemplateId}
            onClose={() => {
              setEditingReportTemplateId(null);
              setActiveTab('custom_reports');
            }}
            onSaved={(saved) => {
              setEditingReportTemplateId(null);
              setActiveTab('custom_reports');
            }}
          />
        )}

        {/* SAVED CUSTOM REPORTS DIRECTORY (ROLE-PERMITTED) */}
        {activeTab === 'custom_reports' && (
          <CustomReportsListView
            currentUser={currentUser}
            onCreateNewReport={() => {
              setEditingReportTemplateId(null);
              setActiveTab('report_builder');
            }}
            onEditReport={(templateId) => {
              setEditingReportTemplateId(templateId);
              setActiveTab('report_builder');
            }}
            onBack={() => setActiveTab('reports')}
          />
        )}

        {/* SCALABLE P2P WIFI MESH SYNC HUB */}
        {(activeTab === 'p2p_mesh' || activeTab === 'connectivity') && (
          <P2PMeshSyncHub onBack={() => setActiveTab('home')} />
        )}
      </main>

      {/* 3. Android Material 3 Bottom Navigation with 5 tabs from screenshot */}
      <BottomNavigation
        activeTab={activeTab}
        currentUser={currentUser}
        pendingSyncCount={pendingCount}
        onTabChange={(tab) => {
          if (tab !== 'pos' && tab !== 'items' && tab !== 'counter' && tab !== 'sales') {
            setSalePreselectedCustomer(null);
          }
          setActiveTab(tab);
        }}
      />

      {/* 4. Google Sheets Sync Modal */}
      <GoogleSheetsSyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        onSyncCompleted={() => setDbVersion((v) => v + 1)}
      />

      {/* 5. Admin Salesperson Management Modal */}
      <SalespersonManagementModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        currentUser={currentUser}
      />

      {/* 6. 52 Granular Permissions Matrix Modal (RBAC) */}
      <PermissionsMatrixModal
        isOpen={isPermissionsModalOpen}
        onClose={() => setIsPermissionsModalOpen(false)}
      />

      {/* 7. SaaS Multi-Tenant Management Dashboard */}
      {isSuperAdmin && (
        <SuperAdminDashboard
          isOpen={isSuperAdminModalOpen}
          currentUser={currentUser}
          onClose={() => setIsSuperAdminModalOpen(false)}
        />
      )}

      {/* 8. PWA Offline Status Banner */}
      <OfflineIndicator isSimulatedOffline={isOfflineMode} />
    </div>
  );
}
