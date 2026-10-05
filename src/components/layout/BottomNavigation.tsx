import React, { useMemo } from 'react';
import { ActiveTab, Salesperson } from '../../types';
import {
  getUserPrimaryModules,
  getRoleDefinitionForUser,
  getModuleIcon,
  ALL_SYSTEM_MODULES,
} from '../../services/roleNavigationService';
import {
  LayoutGrid,
  Menu,
} from 'lucide-react';

interface BottomNavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  pendingSyncCount: number;
  cartCount?: number;
  currentUser?: Salesperson | null;
  onOpenMenu?: () => void;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  activeTab,
  onTabChange,
  pendingSyncCount,
  cartCount = 0,
  currentUser,
  onOpenMenu,
}) => {
  // Derive role-specific navigation items based on user's primary ranked modules
  const roleDef = useMemo(() => getRoleDefinitionForUser(currentUser || null), [currentUser]);
  const primaryModules = useMemo(() => getUserPrimaryModules(currentUser || null), [currentUser]);

  const navItems = useMemo(() => {
    // Take top 4 ranked primary modules for this user's role
    const topPrimary = primaryModules.slice(0, 4);

    // If fewer than 4 primary modules, fill with allowed or default modules
    if (topPrimary.length < 4) {
      const existingIds = new Set(topPrimary.map((m) => m.id));
      for (const mod of ALL_SYSTEM_MODULES) {
        if (!existingIds.has(mod.id) && (roleDef.allowedModules.includes(mod.id) || !roleDef.allowedModules.length)) {
          topPrimary.push(mod);
          existingIds.add(mod.id);
          if (topPrimary.length >= 4) break;
        }
      }
    }

    const items = topPrimary.map((mod) => {
      const Icon = getModuleIcon(mod.iconName);

      // Check if this module is currently active
      let isActive = activeTab === mod.id;
      if (mod.id === 'pos' && (activeTab === 'counter' || activeTab === 'home')) isActive = true;
      if (mod.id === 'cash_balancing' && activeTab === 'reconciliation') isActive = true;
      if (mod.id === 'inventory' && (activeTab === 'goods_received' || activeTab === 'stocktake' || activeTab === 'stock_movement')) isActive = true;

      // Badge: show cart count if on POS/Counter module
      let badge: number | undefined = undefined;
      if ((mod.id === 'pos' || mod.id === 'counter') && cartCount > 0) {
        badge = cartCount;
      }

      return {
        id: mod.id,
        label: mod.shortLabel,
        icon: Icon,
        badge,
        isActive,
      };
    });

    // 5th item is always the Hamburger "Menu" drawer button
    const isMenuTabActive =
      activeTab === 'more' ||
      !items.some((i) => i.isActive);

    items.push({
      id: 'more' as ActiveTab,
      label: 'Menu',
      icon: Menu,
      badge: pendingSyncCount > 0 ? pendingSyncCount : undefined,
      isActive: isMenuTabActive,
    });

    return items;
  }, [primaryModules, roleDef, activeTab, cartCount, pendingSyncCount]);

  const handleItemClick = (id: ActiveTab) => {
    if (id === 'more') {
      if (onOpenMenu) {
        onOpenMenu();
      } else {
        onTabChange('more');
      }
    } else {
      onTabChange(id);
    }
  };

  return (
    <nav
      id="android-bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-30 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 text-slate-400 py-1 px-1 sm:px-2 select-none shadow-[0_-4px_20px_rgba(0,0,0,0.4)] pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))]"
    >
      <div className="w-full max-w-4xl mx-auto flex items-center justify-around">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const isMenuButton = item.id === 'more';

          return (
            <button
              key={`${item.id}-${index}`}
              id={`nav-tab-${item.id}`}
              type="button"
              onClick={() => handleItemClick(item.id)}
              className={`relative flex-1 min-h-[48px] flex flex-col items-center justify-center py-1 rounded-2xl transition-all duration-200 tap-target ${
                item.isActive
                  ? 'text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 active:scale-95'
              }`}
            >
              {/* Active Tab indicator matching Material 3 / SAIMETRIC theme */}
              <div
                className={`relative flex items-center justify-center px-3.5 sm:px-4 py-1 rounded-full transition-all duration-200 ${
                  item.isActive
                    ? 'bg-gradient-to-r from-[#6A4DFF] to-[#FF8A00] text-white shadow-md'
                    : isMenuButton
                    ? 'bg-slate-800/80 text-amber-300 border border-amber-400/30'
                    : 'bg-transparent text-slate-400'
                }`}
              >
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    item.isActive ? 'scale-110' : 'scale-100'
                  }`}
                />
                {item.badge !== undefined && (
                  <span className="absolute -top-1 -right-1 bg-[#FF8A00] text-slate-950 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-slate-900 shadow">
                    {item.badge}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] mt-0.5 tracking-tight transition-colors truncate max-w-[68px] ${
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
