import React from 'react';
import { ActiveTab, Salesperson } from '../../types';
import {
  TrendingUp,
  Receipt,
  ShoppingBag,
  ListOrdered,
  LayoutGrid,
} from 'lucide-react';

interface BottomNavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  pendingSyncCount: number;
  cartCount?: number;
  currentUser?: Salesperson | null;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  activeTab,
  onTabChange,
  pendingSyncCount,
  cartCount = 0,
  currentUser,
}) => {
  const isReportsActive =
    activeTab === 'reports' ||
    activeTab === 'change_report' ||
    activeTab === 'credit_report' ||
    activeTab === 'grn_daily_report' ||
    activeTab === 'report_builder' ||
    activeTab === 'custom_reports';

  const isTodayActive =
    activeTab === 'today' ||
    activeTab === 'orders';

  const isCounterActive =
    activeTab === 'counter' ||
    (activeTab === 'pos' && false);

  const isItemsActive =
    activeTab === 'items';

  const isMoreActive =
    activeTab === 'more' ||
    activeTab === 'cash_balancing' ||
    activeTab === 'cash_count' ||
    activeTab === 'cash_log' ||
    activeTab === 'sales' ||
    activeTab === 'customers' ||
    activeTab === 'suppliers' ||
    activeTab === 'reconciliation' ||
    activeTab === 'sheets' ||
    activeTab === 'salespeople' ||
    activeTab === 'staff_access' ||
    activeTab === 'audit_log' ||
    activeTab === 'dashboard' ||
    activeTab === 'p2p_mesh';

  // 5 navigation tabs matching user screenshots:
  // 1. Reports (Chart icon)
  // 2. Today (Receipt icon)
  // 3. Counter (Cash register / cart icon with live badge count!)
  // 4. Items (Checklist / products icon)
  // 5. More (Bento grid / menu icon)
  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    isActive: boolean;
  }[] = [
    {
      id: 'reports',
      label: 'Reports',
      icon: TrendingUp,
      isActive: isReportsActive,
    },
    {
      id: 'today',
      label: 'Today',
      icon: Receipt,
      isActive: isTodayActive,
    },
    {
      id: 'counter',
      label: 'Counter',
      icon: ShoppingBag,
      badge: cartCount > 0 ? cartCount : undefined,
      isActive: isCounterActive,
    },
    {
      id: 'items',
      label: 'Items',
      icon: ListOrdered,
      isActive: isItemsActive,
    },
    {
      id: 'more',
      label: 'More',
      icon: LayoutGrid,
      badge: pendingSyncCount > 0 ? pendingSyncCount : undefined,
      isActive: isMoreActive,
    },
  ];

  return (
    <nav
      id="android-bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-30 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 text-slate-400 py-1 px-1 sm:px-2 select-none shadow-[0_-4px_20px_rgba(0,0,0,0.4)] pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))]"
    >
      <div className="w-full max-w-4xl mx-auto flex items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              id={`nav-tab-${item.id}`}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`relative flex-1 min-h-[48px] flex flex-col items-center justify-center py-1 rounded-2xl transition-all duration-200 tap-target ${
                item.isActive
                  ? 'text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 active:scale-95'
              }`}
            >
              {/* Active Tab indicator matching Material 3 / SAIMETRIC theme */}
              <div
                className={`relative flex items-center justify-center px-4 py-1 rounded-full transition-all duration-200 ${
                  item.isActive
                    ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                    : 'bg-transparent text-slate-400'
                }`}
              >
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    item.isActive ? 'scale-110' : 'scale-100'
                  }`}
                />
                {item.badge !== undefined && (
                  <span className="absolute -top-1 -right-1 bg-[#FF8A00] text-slate-950 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-slate-900">
                    {item.badge}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] mt-0.5 tracking-tight transition-colors ${
                  item.isActive ? 'text-orange-400 font-bold' : 'text-slate-400 font-medium'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
