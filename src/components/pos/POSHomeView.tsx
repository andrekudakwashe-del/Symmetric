import React, { useState } from 'react';
import { Salesperson, ActiveTab, ParkedSale } from '../../types';
import { getParkedSales, getSales, getCashLogs } from '../../db/roomDatabase';
import {
  Menu,
  ChevronDown,
  UserPlus,
  PhoneCall,
  Search,
  ScanLine,
  Plus,
  DollarSign,
  ArrowRight,
  Sparkles,
  ShoppingBag,
  Clock,
  Trash2,
  Play,
  TrendingUp,
  Receipt,
  Banknote,
  Users,
  LogOut,
  Wifi,
} from 'lucide-react';
import { POSExpenseModal } from './POSExpenseModal';
import { meshSyncService } from '../../services/meshSyncService';

interface POSHomeViewProps {
  currentUser: Salesperson | null;
  onNavigateTab: (tab: ActiveTab, contextCustomer?: string) => void;
  onStartNewSale: () => void;
  onRestoreParkedSale?: (parked: ParkedSale) => void;
  onOpenCustomerModal?: () => void;
  onOpenMoreMenu?: () => void;
  onLogout?: () => void;
}

export const POSHomeView: React.FC<POSHomeViewProps> = ({
  currentUser,
  onNavigateTab,
  onStartNewSale,
  onRestoreParkedSale,
  onOpenCustomerModal,
  onOpenMoreMenu,
  onLogout,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showParkedModal, setShowParkedModal] = useState(false);
  const [showStoreDropdown, setShowStoreDropdown] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [meshConfig, setMeshConfig] = useState(() => meshSyncService.getConfig());

  React.useEffect(() => {
    setMeshConfig(meshSyncService.getConfig());
    const unsub = meshSyncService.subscribePeers((count) => {
      setPeerCount(count);
    });
    return () => unsub();
  }, []);

  const parkedSales = getParkedSales();
  const sales = getSales();
  const cashLogs = getCashLogs();

  const todayStr = new Date().toISOString().split('T')[0];
  const todaySales = sales.filter((s) => s.date === todayStr);
  const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onNavigateTab('items', searchQuery.trim());
    } else {
      onStartNewSale();
    }
  };

  return (
    <div className="space-y-4 pb-24 select-none animate-fadeIn">
      {/* 1. Header Bar matching Screenshot 3 with SAIMETRIC theme */}
      <div className="bg-gradient-to-r from-[#6A4DFF] via-[#7B5BFF] to-[#FF8A00] text-white rounded-3xl p-3.5 sm:p-4 shadow-xl">
        <div className="flex items-center justify-between">
          {/* Left: Menu Icon */}
          <button
            type="button"
            onClick={onOpenMoreMenu}
            title="Open Menu"
            className="w-10 h-10 rounded-2xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 text-white"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Center: Title Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowStoreDropdown(!showStoreDropdown)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-2xl bg-white/10 hover:bg-white/20 transition font-black tracking-wider text-base sm:text-lg"
            >
              <span>SAIMETRIC</span>
              <ChevronDown className="w-4 h-4 text-white/80" />
            </button>

            {showStoreDropdown && (
              <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 z-50 text-slate-200">
                <div className="text-xs font-bold text-[#FF8A00] uppercase tracking-wider mb-1">
                  Active Terminal
                </div>
                <div className="text-sm font-bold text-white">SAIMETRIC Mobile POS</div>
                <div className="text-xs text-slate-400 mt-1">Cashier: {currentUser?.name} (#{currentUser?.id})</div>
                <div className="text-xs text-slate-400">Shift: Room DB (Offline-Ready)</div>
                <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                  <span className="text-emerald-400 font-bold">● Live POS Node</span>
                  <button
                    type="button"
                    onClick={() => setShowStoreDropdown(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    Close
                  </button>
                </div>
                {onLogout && (
                  <div className="mt-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      id="btn-terminal-dropdown-logout"
                      onClick={() => {
                        setShowStoreDropdown(false);
                        onLogout();
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-rose-600/25 hover:bg-rose-600/40 text-rose-300 text-xs font-bold flex items-center justify-center space-x-2 transition"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Log Out / Switch Cashier</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Quick Actions */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onOpenCustomerModal}
              title="Add Customer"
              className="w-10 h-10 rounded-2xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 text-white"
            >
              <UserPlus className="w-5 h-5" />
            </button>
            <a
              href="tel:+263770000000"
              title="Support Hotline"
              className="w-10 h-10 rounded-2xl bg-white/15 hover:bg-white/25 flex items-center justify-center transition active:scale-95 text-white"
            >
              <PhoneCall className="w-4 h-4" />
            </a>
            {onLogout && (
              <button
                type="button"
                id="btn-pos-home-logout"
                onClick={onLogout}
                title="Log Out (Switch Salesperson)"
                className="w-10 h-10 rounded-2xl bg-rose-500/25 hover:bg-rose-500/40 border border-rose-400/30 flex items-center justify-center transition active:scale-95 text-rose-100"
              >
                <LogOut className="w-4 h-4 text-rose-200" />
              </button>
            )}
          </div>
        </div>

        {/* Search Bar matching screenshot */}
        <form onSubmit={handleSearchSubmit} className="mt-3.5 flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="I want to sell..."
              className="w-full bg-white text-slate-900 rounded-2xl pl-10 pr-4 py-3 text-sm font-medium placeholder:text-slate-400 focus:outline-none shadow-md"
            />
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('items')}
            title="Scan Barcode"
            className="w-12 h-12 rounded-2xl bg-white text-[#6A4DFF] hover:bg-slate-100 flex items-center justify-center shadow-md transition active:scale-95 shrink-0"
          >
            <ScanLine className="w-6 h-6" />
          </button>
        </form>
      </div>

      {/* 2. Big "+ NEW SALE" Card (Exact design from Screenshot 3) */}
      <div
        id="btn-pos-new-sale-card"
        onClick={onStartNewSale}
        className="bg-white hover:bg-slate-50 border border-slate-200 rounded-3xl p-7 shadow-lg flex flex-col items-center justify-center cursor-pointer transition transform active:scale-[0.98] group"
      >
        <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition duration-200">
          <Plus className="w-8 h-8 stroke-[3]" />
        </div>
        <span className="mt-3.5 text-lg font-black text-slate-800 tracking-wider">
          NEW SALE
        </span>
        <span className="text-xs text-slate-400 font-medium mt-0.5">
          Tap to browse product catalog & add to counter
        </span>
      </div>

      {/* 3. "ADD NEW EXPENSE" Card (Exact design from Screenshot 3) */}
      <div
        id="btn-pos-add-expense-card"
        onClick={() => setShowExpenseModal(true)}
        className="bg-white hover:bg-slate-50 border border-slate-200 rounded-3xl py-4 px-6 shadow-md flex items-center justify-center space-x-3 cursor-pointer transition transform active:scale-[0.98]"
      >
        <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-sm">
          🍃
        </div>
        <span className="text-sm font-black text-slate-700 tracking-wide uppercase">
          ADD NEW EXPENSE
        </span>
      </div>

      {/* 3b. Local P2P WiFi Mesh Connectivity & Device Status Card */}
      <div
        id="btn-pos-home-mesh-card"
        onClick={() => onNavigateTab('p2p_mesh')}
        className="bg-gradient-to-r from-indigo-950/80 via-purple-950/60 to-slate-900 border border-indigo-500/40 hover:border-indigo-400 rounded-3xl p-4 shadow-lg flex items-center justify-between cursor-pointer transition transform active:scale-[0.99] group"
      >
        <div className="flex items-center space-x-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-inner">
            <Wifi className="w-6 h-6 text-indigo-300 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black text-white group-hover:text-indigo-200 transition">
                P2P WiFi Mesh Connections
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold font-mono text-[10px] border border-emerald-500/30">
                {peerCount} Peers Connected
              </span>
            </div>
            <p className="text-xs text-indigo-200/80 font-medium mt-0.5">
              Branch: <span className="font-bold text-white font-mono">{meshConfig.branchCode}</span> • Terminal: <span className="font-bold text-white font-mono">{meshConfig.deviceName}</span> • NSD Discovery Active
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold text-indigo-300 hidden sm:inline group-hover:translate-x-0.5 transition">
            Connections &amp; Setup
          </span>
          <div className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-indigo-300 group-hover:translate-x-1 transition shadow">
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* 4. Promo Banner (Exact design from Screenshot 3) */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-100 border border-orange-200 rounded-3xl p-4 shadow-md flex items-center justify-between gap-4 overflow-hidden relative">
        <div className="flex items-center space-x-3.5 z-10">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#6A4DFF] to-[#FF8A00] text-white flex items-center justify-center shrink-0 shadow-md">
            <Sparkles className="w-7 h-7 text-amber-200 animate-pulse" />
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-900 tracking-tight">
              Extra Income every month!
            </h4>
            <p className="text-[11px] text-slate-600 leading-tight mt-0.5">
              Cash balancing module & auto credit sale sync activated.
            </p>
            <button
              type="button"
              onClick={() => onNavigateTab('cash_balancing')}
              className="mt-2 inline-block px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black rounded-lg uppercase tracking-wider shadow-sm transition"
            >
              CASH BALANCING MODULE
            </button>
          </div>
        </div>
      </div>

      {/* 5. Pending Sales (Park) Section (Exact design from Screenshot 3) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 sm:p-5 shadow-lg">
        <div
          onClick={() => {
            if (parkedSales.length > 0) {
              setShowParkedModal(true);
            }
          }}
          className="flex items-center justify-between cursor-pointer group"
        >
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center font-bold">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-black text-white group-hover:text-orange-400 transition">
                Pending Sales (Park) :
              </span>
              <span className="ml-2 text-xs font-bold text-slate-400 font-mono-num">
                {parkedSales.length} {parkedSales.length === 1 ? 'Cart' : 'Carts'}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-blue-400 group-hover:translate-x-1 transition shadow"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        {/* Preview of Parked Sales if any exist */}
        {parkedSales.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
            {parkedSales.slice(0, 3).map((parked) => (
              <div
                key={parked.id}
                className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-2.5 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-white">{parked.customerName || 'Walk-in Customer'}</div>
                  <div className="text-[10px] text-slate-400">
                    {parked.items.length} items • ${parked.total.toFixed(2)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (onRestoreParkedSale) onRestoreParkedSale(parked);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white font-bold text-[11px] shadow flex items-center space-x-1 hover:opacity-90 transition active:scale-95"
                >
                  <Play className="w-3 h-3 fill-white" />
                  <span>Resume</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div
          onClick={() => onNavigateTab('today')}
          className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 cursor-pointer hover:border-slate-700 transition"
        >
          <div className="text-[10px] text-slate-400 font-bold uppercase">Today's Sales</div>
          <div className="text-base font-black text-white font-mono-num mt-0.5">${todayRevenue.toFixed(2)}</div>
          <div className="text-[10px] text-emerald-400 font-medium">{todaySales.length} Invoices</div>
        </div>

        <div
          onClick={() => onNavigateTab('cash_balancing')}
          className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 cursor-pointer hover:border-slate-700 transition"
        >
          <div className="text-[10px] text-slate-400 font-bold uppercase">Drawer Net</div>
          <div className="text-base font-black text-white font-mono-num mt-0.5">
            ${cashLogs.reduce((acc, l) => acc + (l.in || 0) - (l.out || 0), 0).toFixed(2)}
          </div>
          <div className="text-[10px] text-purple-400 font-medium">Forms 1–4 Live</div>
        </div>

        <div
          onClick={() => onNavigateTab('customers')}
          className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 cursor-pointer hover:border-slate-700 transition"
        >
          <div className="text-[10px] text-slate-400 font-bold uppercase">Customers</div>
          <div className="text-base font-black text-white font-mono-num mt-0.5">Merged DB</div>
          <div className="text-[10px] text-amber-400 font-medium">Debtors & Change</div>
        </div>

        <div
          onClick={() => onNavigateTab('reports')}
          className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 cursor-pointer hover:border-slate-700 transition"
        >
          <div className="text-[10px] text-slate-400 font-bold uppercase">Audits</div>
          <div className="text-base font-black text-white font-mono-num mt-0.5">Reconciliation</div>
          <div className="text-[10px] text-blue-400 font-medium">Variance Check</div>
        </div>
      </div>

      {/* Expense Modal */}
      <POSExpenseModal
        isOpen={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        currentUser={currentUser}
      />
    </div>
  );
};
