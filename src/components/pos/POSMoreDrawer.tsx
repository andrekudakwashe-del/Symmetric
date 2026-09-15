import React from 'react';
import { ActiveTab, Salesperson } from '../../types';
import {
  Banknote,
  Users,
  Coins,
  FileSpreadsheet,
  Layers,
  ShoppingBag,
  Receipt,
  UserCheck,
  TrendingUp,
  CreditCard,
  Settings,
  ChevronRight,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  X,
  Package,
  Boxes,
  ArrowDownRight,
  Activity,
  Truck,
  Building2,
  Database,
  Download,
  Upload,
  LogOut,
  Bluetooth,
  Printer,
  Wifi,
  Radio,
  QrCode,
  Share2,
  Crown,
} from 'lucide-react';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { BluetoothPrinterModal } from '../common/BluetoothPrinterModal';
import { ShareDeviceModal } from '../common/ShareDeviceModal';
import { meshSyncService } from '../../services/meshSyncService';

interface POSMoreDrawerProps {
  isOpen?: boolean;
  onClose?: () => void;
  onNavigate: (tab: ActiveTab) => void;
  currentUser: Salesperson | null;
  pendingSyncCount: number;
  onLogout?: () => void;
}

export const POSMoreDrawer: React.FC<POSMoreDrawerProps> = ({
  isOpen = true,
  onClose,
  onNavigate,
  currentUser,
  pendingSyncCount,
  onLogout,
}) => {
  const [showPrinterModal, setShowPrinterModal] = React.useState(false);
  const [showShareModal, setShowShareModal] = React.useState(false);
  const [peerCount, setPeerCount] = React.useState(0);
  const [meshConfig, setMeshConfig] = React.useState(() => meshSyncService.getConfig());
  
  const isSuperAdmin =
    currentUser?.role === 'SUPER_ADMIN' ||
    (currentUser?.role as string) === 'super_admin' ||
    currentUser?.email?.toLowerCase() === 'andrekudakwashe@gmail.com';
  const isOwner = currentUser?.role === 'OWNER';
  const isAdmin = currentUser?.role === 'Admin' || isOwner || isSuperAdmin;
  const isManager = currentUser?.role === 'MANAGER' || isAdmin;
  const canManageBranches = isSuperAdmin || isOwner;
  const canManageStaff = isSuperAdmin || isOwner || currentUser?.role === 'Admin' || currentUser?.role === 'MANAGER';
  const canManageData = isSuperAdmin || isOwner || currentUser?.role === 'Admin' || currentUser?.role === 'MANAGER';

  React.useEffect(() => {
    setMeshConfig(meshSyncService.getConfig());
    const unsub = meshSyncService.subscribePeers((count) => {
      setPeerCount(count);
    });
    return () => unsub();
  }, []);

  const menuSections = [
    {
      title: 'POS & Sales Operations',
      items: [
        {
          tab: 'home' as ActiveTab,
          label: 'POS Home (+ New Sale)',
          description: 'Launch new sale, expenses, & parked sales',
          icon: ShoppingBag,
          color: 'from-[#6A4DFF] to-[#FF8A00]',
        },
        {
          tab: 'items' as ActiveTab,
          label: 'Product Catalog & Items',
          description: 'Browse items grid, pricing & categories',
          icon: Package,
          color: 'from-blue-500 to-indigo-600',
        },
        {
          tab: 'today' as ActiveTab,
          label: "Today's Invoices & Sales",
          description: 'View sales receipt history and refunds',
          icon: Receipt,
          color: 'from-emerald-500 to-teal-600',
        },
      ],
    },
    {
      title: 'Flexible Cases + Singles Inventory Suite',
      items: [
        {
          tab: 'inventory' as ActiveTab,
          label: 'Tab 1: Inventory Master',
          description: 'Real-time stock counts in Cases & Singles, reorder alerts, and manual case breaks',
          icon: Boxes,
          color: 'from-indigo-600 to-violet-700',
          badge: 'Master',
        },
        {
          tab: 'goods_received' as ActiveTab,
          label: 'Tab 2: Goods Received (GRN)',
          description: 'Receive bulk cases/singles with Rule A auto-case breaking on zero singles',
          icon: ArrowDownRight,
          color: 'from-blue-600 to-indigo-600',
          badge: 'Rule A',
        },
        {
          tab: 'grn_daily_report' as ActiveTab,
          label: 'Tab 2b: Daily Receiving Admin Report',
          description: 'Sum inward inventory valuation per branch, date, category and supplier',
          icon: FileSpreadsheet,
          color: 'from-teal-600 to-emerald-700',
          badge: 'Daily Report',
        },
        {
          tab: 'stock_movement' as ActiveTab,
          label: 'Tab 3: Stock Movement Audit',
          description: 'Immutable ledger of goods receipts, case breaks, POS dips, and stocktake syncing',
          icon: Activity,
          color: 'from-emerald-600 to-teal-700',
          badge: 'Audit Log',
        },
        {
          tab: 'stocktake' as ActiveTab,
          label: 'Tab 3b: Double-Count Stocktake',
          description: 'Shop floor segment creation, two-user blind double count, automatic recount & master committal',
          icon: Layers,
          color: 'from-purple-600 to-indigo-700',
          badge: 'Double-Count',
        },
        {
          tab: 'inventory_setup' as ActiveTab,
          label: 'Tab 4: Inventory Setup & Rules',
          description: 'Categories, packaging ratios, automation policies, and markup margins',
          icon: Settings,
          color: 'from-amber-600 to-orange-700',
        },
      ],
    },
    {
      title: 'Cash Balancing Module (Forms 1 – 4)',
      items: [
        {
          tab: 'cash_balancing' as ActiveTab,
          label: 'Cash Balancing Hub',
          description: 'Access Forms 1, 2, 3 & 4 in one workspace',
          icon: Banknote,
          color: 'from-purple-600 to-indigo-700',
        },
        {
          tab: 'cash_count' as ActiveTab,
          label: 'Form 1: Cash Count & Denominations',
          description: 'Daily cash notes and drawer count',
          icon: Coins,
          color: 'from-amber-500 to-orange-600',
        },
        {
          tab: 'cash_log' as ActiveTab,
          label: 'Form 2: Cash Log Register (In/Out)',
          description: 'Daily cash movements and expenses',
          icon: Banknote,
          color: 'from-emerald-600 to-green-700',
        },
        {
          tab: 'sales' as ActiveTab,
          label: 'Form 3: Customer Change & Credit Entry',
          description: 'Customer credit sales and change left behind',
          icon: CreditCard,
          color: 'from-rose-500 to-pink-600',
        },
        {
          tab: 'reconciliation' as ActiveTab,
          label: 'Form 4: Admin Shift Balancing & Audit',
          description: 'Calculate variances vs external cash registers',
          icon: ShieldCheck,
          color: 'from-indigo-600 to-purple-800',
        },
      ],
    },
    {
      title: 'Customers & Debtor Ledgers',
      items: [
        {
          tab: 'customers' as ActiveTab,
          label: 'Unified Customer Database',
          description: 'Customer directory, contact numbers & account balance',
          icon: Users,
          color: 'from-blue-600 to-cyan-600',
        },
        {
          tab: 'credit_report' as ActiveTab,
          label: 'Customer Credit & Debtors Report',
          description: 'Aging summary and outstanding credit sales ledger',
          icon: TrendingUp,
          color: 'from-orange-500 to-amber-600',
        },
        {
          tab: 'change_report' as ActiveTab,
          label: 'Customer Change Left Behind Report',
          description: 'Audit unsettled change owed to customers',
          icon: Coins,
          color: 'from-emerald-500 to-teal-700',
        },
      ],
    },
    {
      title: 'Suppliers & Vendor Management',
      items: [
        {
          tab: 'suppliers' as ActiveTab,
          label: 'Supplier & Vendor Database',
          description: 'Search suppliers, contact info, payment terms, and past delivery invoices',
          icon: Building2,
          color: 'from-cyan-600 to-blue-700',
          badge: 'Suppliers',
        },
        {
          tab: 'goods_received' as ActiveTab,
          label: 'Receive Delivery (GRN Voucher)',
          description: 'Multi-product Excel spreadsheet receiving with packaging conversions',
          icon: Truck,
          color: 'from-emerald-600 to-teal-700',
        },
        {
          tab: 'grn_daily_report' as ActiveTab,
          label: 'Daily Receiving Admin Report',
          description: 'Valuation summaries per branch, date, category and supplier',
          icon: FileSpreadsheet,
          color: 'from-teal-600 to-emerald-800',
          badge: 'Report',
        },
      ],
    },
    {
      title: 'Admin Data & Reports Center',
      items: [
        {
          tab: 'sales_report' as ActiveTab,
          label: 'Sales, Profit & Top Stocks Report',
          description: 'Sales revenue, gross profit margin, items sold & top inventory velocity',
          icon: TrendingUp,
          color: 'from-[#6A4DFF] to-[#FF8A00]',
          badge: 'Financials',
        },
        ...(canManageData
          ? [
              {
                tab: 'data_management' as ActiveTab,
                label: 'Admin Data Center (Import & Export)',
                description: 'Import & Export: 1. Inventory, 2. Customers, 3. Suppliers, and Full Backups',
                icon: Database,
                color: 'from-indigo-600 to-purple-700',
                badge: 'Import/Export',
              },
              {
                tab: 'data_management' as ActiveTab,
                label: 'Export All Reports (12 Ledgers)',
                description: 'Single-click CSV export for Forms 1-4, GRN, Stock Audit, and Sales',
                icon: Download,
                color: 'from-emerald-600 to-teal-700',
                badge: 'Export Only',
              },
            ]
          : []),
      ],
    },
    {
      title: 'Connectivity, Cloud Sync & Settings',
      items: [
        {
          tab: 'p2p_mesh' as ActiveTab,
          label: 'P2P WiFi Mesh Connections & Setup',
          description: `Serverless local mesh • ${peerCount} peer devices online • Epidemic broadcast active`,
          icon: Wifi,
          color: 'from-indigo-600 to-purple-700',
          badge: `${peerCount} Peers Online`,
        },
        ...(isSuperAdmin
          ? [
              {
                tab: 'sheets' as ActiveTab,
                label: 'Google Sheets Live Sync',
                description: `${pendingSyncCount} pending queue items ready`,
                icon: FileSpreadsheet,
                color: 'from-green-600 to-emerald-700',
                badge: pendingSyncCount > 0 ? `${pendingSyncCount} Pending` : 'Synced',
              },
            ]
          : []),
        ...(canManageStaff
          ? [
              {
                tab: 'salespeople' as ActiveTab,
                label: 'Staff Management',
                description: 'Staff directory, roles, 4-digit PINs & granular permissions',
                icon: UserCheck,
                color: 'from-slate-600 to-slate-800',
              },
            ]
          : []),
        ...(canManageBranches
          ? [
              {
                tab: 'branch_setup' as ActiveTab,
                label: 'Branch Setup & Management',
                description: 'Create & configure tenant branch sheets, codes & managers',
                icon: Building2,
                color: 'from-blue-600 to-indigo-700',
                badge: 'Owner / Super Admin',
              },
            ]
          : []),
        ...(isSuperAdmin
          ? [
              {
                tab: 'super_admin' as ActiveTab,
                label: 'SaaS Multi-Tenant Management',
                description: '500+ customer tenant partitions, subscriptions & billing',
                icon: Crown,
                color: 'from-amber-600 to-orange-700',
                badge: 'Super Admin Only',
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <div className="space-y-5 pb-28 animate-fadeIn">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] text-white rounded-3xl p-4 sm:p-5 shadow-xl flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center font-black text-xl shadow-inner">
            ⚡
          </div>
          <div>
            <h2 className="text-xl font-black">All Modules & Tools</h2>
            <p className="text-xs text-white/80">
              Cashier: {currentUser?.name} ({currentUser?.role})
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      {/* Active Cashier Session & Direct Logout Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-xl flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#6A4DFF] to-[#FF8A00] flex items-center justify-center font-black text-white shadow-md">
            {currentUser?.name.charAt(0) || 'U'}
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>{currentUser?.name || 'Staff User'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                {currentUser?.role || 'Staff'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Staff #{currentUser?.id} • Active POS Terminal
            </p>
          </div>
        </div>

        {onLogout && (
          <button
            id="btn-more-drawer-logout"
            type="button"
            onClick={() => {
              if (onClose) onClose();
              onLogout();
            }}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-2xl bg-rose-600/25 hover:bg-rose-600/40 text-rose-200 border border-rose-500/30 text-xs font-black transition active:scale-95 shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        )}
      </div>

      {/* Offline PWA Installation & Chrome Support Card */}
      <div className="bg-gradient-to-r from-purple-950/40 to-slate-900 border border-purple-500/30 rounded-3xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-black text-white">Google Chrome Offline App</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
              PWA Ready
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Install on your desktop, laptop, or tablet for 100% offline access without internet.
          </p>
        </div>
        <PWAInstallButton variant="pill" className="shrink-0" />
      </div>

      {/* P2P WiFi Mesh Connectivity & Peer Setup Quick Card */}
      <div className="bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900 border border-indigo-500/40 rounded-3xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Wifi className="w-5 h-5 animate-pulse text-indigo-300" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black text-white">P2P WiFi Mesh Connectivity</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 font-mono">
                {peerCount} Peers Connected
              </span>
            </div>
            <p className="text-xs text-indigo-200/70">
              Branch: <span className="text-white font-mono font-bold">{meshConfig.branchCode}</span> • Device: <span className="text-white font-mono">{meshConfig.deviceName}</span> • NSD Discovery Active
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className="px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold text-xs flex items-center space-x-1.5 border border-emerald-500/30 shadow-md active:scale-95 transition"
            title="Scan QR Code to open on phones or other tablets"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scan QR</span>
          </button>
          <button
            id="btn-more-drawer-open-mesh"
            type="button"
            onClick={() => {
              onNavigate('p2p_mesh');
              if (onClose) onClose();
            }}
            className="px-3.5 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md active:scale-95 transition"
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>Connections &amp; Setup</span>
          </button>
        </div>
      </div>

      {/* Bluetooth 58mm / 80mm Printer & Receipt Setup Card */}
      <div className="bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-slate-900 border border-blue-500/30 rounded-3xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black text-white">Printer &amp; Receipt Setup</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold border border-blue-500/30 font-mono">
                58mm &amp; 80mm
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Configure tenant receipt branding, change returned display, auto-print on sale &amp; wireless Bluetooth hardware.
            </p>
          </div>
        </div>
        <button
          id="btn-more-drawer-open-printer"
          type="button"
          onClick={() => setShowPrinterModal(true)}
          className="shrink-0 px-3.5 py-2 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md active:scale-95 transition"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Printer &amp; Receipt Setup</span>
        </button>
      </div>

      {/* Menu Categories */}
      {menuSections.map((section, sIdx) => (
        <div key={sIdx} className="space-y-2">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider px-2">
            {section.title}
          </h3>
          <div className="space-y-1.5">
            {section.items.map((item, iIdx) => {
              const Icon = item.icon;
              return (
                <div
                  key={iIdx}
                  onClick={() => {
                    onNavigate(item.tab);
                    if (onClose) onClose();
                  }}
                  className="bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition active:scale-[0.99] group shadow-sm"
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.color} text-white flex items-center justify-center shadow-md`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-white group-hover:text-orange-400 transition">
                        {item.label}
                      </div>
                      <div className="text-xs text-slate-400">{item.description}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {item.badge && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {item.badge}
                      </span>
                    )}
                    <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-white transition" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {/* Bluetooth Printer Setup Modal */}
      {showPrinterModal && (
        <BluetoothPrinterModal
          isOpen={showPrinterModal}
          onClose={() => setShowPrinterModal(false)}
        />
      )}

      {/* Share / Connect Other Devices Modal */}
      {showShareModal && (
        <ShareDeviceModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
};
